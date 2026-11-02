'use strict';

/**
 * Goods receipt (101) double-posting protection: attempt log, unknown outcomes, recheck, document read-back.
 * [mock only, not SAP verification] - every SAP call is a fake; nothing here proves SAP behaviour.
 */
const GoodsIssueAttemptStore = require('../../../srv/wm/goods-issue/GoodsIssueAttemptStore');
const { GoodsReceiptAdapter } = require('../../../srv/integration/s4hana/wm/GoodsReceiptAdapter');

describe('Goods receipt double-posting protection [mock only, not SAP verification]', () => {
  beforeEach(() => GoodsIssueAttemptStore.clearMemoryStore());
  afterEach(() => jest.restoreAllMocks());

  const attempts = () => Array.from(GoodsIssueAttemptStore._memoryStore.values());

  describe('handler attempt log', () => {
    const singleton = require('../../../srv/integration/s4hana/wm/GoodsReceiptAdapter');
    const init = require('../../../srv/wm/goods-receipt/handlers/goodsReceipt.handler');
    const handlers = {};
    init({ on: (event, a, b) => { handlers[typeof a === 'function' ? event : `${event}_${a}`] = typeof a === 'function' ? a : b; } });

    const ADMIN = { id: 'clerk', is: (r) => r === 'Admin', attr: {} };
    const DATA = {
      StorageUnit: '180000003', DeliveryDocument: '180000003', DeliveryDocumentItem: '10', Material: 'TG11',
      Plant: '1120', StorageLocation: 'HS01', Quantity: 1, Unit: 'KG'
    };
    const post = async (data = DATA, action = 'postGoodsReceiptWithStorageUnit') => {
      const req = { data: { ...data }, user: ADMIN, reject: jest.fn((code, msg) => ({ code, msg })), headers: {} };
      const result = await handlers[action](req);
      return { req, result };
    };
    const unknownErr = () => Object.assign(new Error('socket hang up'), { outcomeUnknown: true });
    const DOC = { Success: true, MaterialDocument: '5000000001', MaterialDocumentYear: '2026' };

    describe.each([
      ['postGoodsReceiptWithStorageUnit'],
      ['postGoodsReceipt']
    ])('%s', (action) => {
      it('records a posted attempt with the SAP document', async () => {
        jest.spyOn(singleton, action).mockResolvedValue(DOC);

        await post(DATA, action);

        expect(attempts()).toHaveLength(1);
        expect(attempts()[0]).toMatchObject({ MovementType: '101', ReservationNo: '0180000003', ReservationItem: '10', Status: 'posted', MaterialDocument: '5000000001' });
      });

      it('warns on an unknown outcome and blocks the retry, even with another quantity', async () => {
        const spy = jest.spyOn(singleton, action).mockRejectedValueOnce(unknownErr()).mockResolvedValue(DOC);

        const first = await post(DATA, action);
        const second = await post({ ...DATA, Quantity: 2 }, action);

        expect(attempts()[0].Status).toBe('unconfirmed');
        expect(first.req.reject).toHaveBeenCalledWith(504, expect.stringContaining('do not post again'));
        expect(second.req.reject).toHaveBeenCalledWith(409, expect.stringContaining('in progress'));
        expect(spy).toHaveBeenCalledTimes(1);
      });

      it('lets the retry through after a definite failure', async () => {
        const refused = Object.assign(new Error('Quantity deficit'), { statusCode: 422, status: 422 });
        const spy = jest.spyOn(singleton, action).mockRejectedValueOnce(refused).mockResolvedValue(DOC);

        const first = await post(DATA, action);
        const second = await post(DATA, action);

        expect(first.req.reject).toHaveBeenCalledWith(422, 'Quantity deficit');
        expect(attempts().map((a) => a.Status)).toEqual(['rejected', 'posted']);
        expect(second.req.reject).not.toHaveBeenCalled();
        expect(spy).toHaveBeenCalledTimes(2);
      });

      it('still allows a second partial receipt of the same quantity', async () => {
        const spy = jest.spyOn(singleton, action).mockResolvedValue(DOC);

        await post(DATA, action);
        const second = await post(DATA, action);

        expect(second.req.reject).not.toHaveBeenCalled();
        expect(spy).toHaveBeenCalledTimes(2);
      });

      it('does not post when the attempt log cannot be written', async () => {
        const spy = jest.spyOn(singleton, action).mockResolvedValue(DOC);
        jest.spyOn(GoodsIssueAttemptStore, 'createOrGet').mockRejectedValue(new Error('db down'));

        const { req } = await post(DATA, action);

        expect(req.reject).toHaveBeenCalledWith(503, expect.stringContaining('NOT posted'));
        expect(spy).not.toHaveBeenCalled();
      });
    });

    it('treats the same delivery with leading zeros as the same item', async () => {
      jest.spyOn(singleton, 'postGoodsReceiptWithStorageUnit').mockRejectedValue(unknownErr());

      await post();
      const second = await post({ ...DATA, DeliveryDocument: '0180000003', DeliveryDocumentItem: '000010' });

      expect(second.req.reject).toHaveBeenCalledWith(409, expect.stringContaining('in progress'));
    });

    it('does not log a simulation', async () => {
      jest.spyOn(singleton, 'postGoodsReceiptWithStorageUnit').mockResolvedValue({ Success: true });

      await post({ ...DATA, Simulate: true });

      expect(attempts()).toHaveLength(0);
    });
  });

  describe('storage-unit adapter path', () => {
    const PAYLOAD = {
      DeliveryDocument: '180000003', DeliveryDocumentItem: '10', Material: 'TG11',
      Plant: '1120', StorageLocation: 'HS01', Quantity: 1, Unit: 'KG'
    };
    const doc = (MBLNR, MJAHR = '2026') => ({ MBLNR, MJAHR, ZEILE: '0001', BWART: '101' });
    const LIPS = { LFIMG: '1.000', MEINS: 'KG', VRKME: 'KG', UMVKZ: '1', UMVKN: '1' };
    const make = ({ before = [], after = [], call, lips = LIPS } = {}) => {
      const adapter = new GoodsReceiptAdapter();
      let posted = false;
      const defaultCall = jest.fn(async (fm) => {
        if (fm === 'BAPI_TRANSACTION_COMMIT') posted = true;
        return { RETURN: [] };
      });
      const rfcCall = call || defaultCall;
      adapter.rfc = {
        readTable: jest.fn(async (table) => {
          if (table === 'MATDOC') return posted ? after : before;
          return table === 'LIPS' && lips ? [lips] : [];
        }),
        session: jest.fn(async (fn) => fn(rfcCall))
      };
      return { adapter, rfcCall };
    };

    it('sends the delivery item units and factors, which SAP needs to post an unpacked delivery', async () => {
      const { adapter, rfcCall } = make({ after: [doc('5000000010')] });

      await adapter.postGoodsReceiptWithStorageUnit(PAYLOAD);

      expect(rfcCall).toHaveBeenCalledWith('BAPI_INB_DELIVERY_CONFIRM_DEC', expect.objectContaining({
        ITEM_DATA: [expect.objectContaining({ DLV_QTY: '1', SALES_UNIT: 'KG', BASE_UOM: 'KG', FACT_UNIT_NOM: '1', FACT_UNIT_DENOM: '1' })]
      }));
    });

    it.each([
      ['a partial quantity', { LFIMG: '100.000' }, 'Partial receipt'],
      ['a different delivery unit', { VRKME: 'NOS', MEINS: 'NOS' }, 'cannot be posted'],
      ['a delivery unit that differs from the base unit', { VRKME: 'KG', MEINS: 'TO' }, 'cannot be posted'],
      ['a factor other than 1:1', { UMVKZ: '2' }, 'cannot be posted'],
      ['zero factors', { UMVKZ: '0', UMVKN: '0' }, 'cannot be posted']
    ])('refuses %s with 422 and never calls the BAPI', async (_name, over, text) => {
      const { adapter, rfcCall } = make({ lips: { ...LIPS, ...over } });

      await expect(adapter.postGoodsReceiptWithStorageUnit(PAYLOAD)).rejects.toMatchObject({
        statusCode: 422, message: expect.stringContaining(text)
      });
      expect(rfcCall).not.toHaveBeenCalled();
    });

    it('does not call the BAPI when the delivery item cannot be read', async () => {
      const { adapter, rfcCall } = make({ lips: null });

      await expect(adapter.postGoodsReceiptWithStorageUnit(PAYLOAD)).rejects.toMatchObject({
        statusCode: 503, message: expect.stringContaining('NOT posted')
      });
      expect(rfcCall).not.toHaveBeenCalled();
    });

    it('leaves the proven handling-unit path without the unit fields', async () => {
      const { adapter, rfcCall } = make({ after: [doc('5000000010')] });
      const readTable = adapter.rfc.readTable.getMockImplementation();
      adapter.rfc.readTable.mockImplementation(async (table, ...rest) => (table === 'VEKP'
        ? [{ EXIDV: '00000000002000018143', VHILM: 'PACK', STATUS: '0020' }]
        : readTable(table, ...rest)));

      await adapter.postGoodsReceiptWithStorageUnit({ ...PAYLOAD, StorageUnit: '2000018143', Quantity: 0.5 });

      const params = rfcCall.mock.calls.find(([fm]) => fm === 'BAPI_INB_DELIVERY_CONFIRM_DEC')[1];
      expect(params.ITEM_DATA[0]).not.toHaveProperty('FACT_UNIT_NOM');
      expect(params.ITEM_CONTROL[0]).toMatchObject({ CHG_DELQTY: 'X' });
    });

    it('reports the new document, not an earlier partial receipt listed last', async () => {
      const { adapter } = make({
        before: [doc('5000000009')],
        after: [doc('5000000010'), doc('5000000010'), doc('5000000009')]
      });

      const result = await adapter.postGoodsReceiptWithStorageUnit(PAYLOAD);

      expect(result).toMatchObject({ MaterialDocument: '5000000010', MaterialDocumentYear: '2026' });
    });

    it('filters the read-back by delivery item', async () => {
      const { adapter } = make({ after: [doc('5000000010')] });

      await adapter.postGoodsReceiptWithStorageUnit(PAYLOAD);

      expect(adapter.rfc.readTable).toHaveBeenCalledWith('MATDOC', expect.anything(),
        ["VBELN_IM = '0180000003'", "AND VBELP_IM = '000010'", "AND BWART = '101'"]);
    });

    it('does not call SAP when the existing documents cannot be read', async () => {
      const { adapter, rfcCall } = make();
      adapter.rfc.readTable.mockImplementation(async (table) => {
        if (table === 'MATDOC') throw new Error('RFC down');
        return table === 'LIPS' ? [LIPS] : [];
      });

      await expect(adapter.postGoodsReceiptWithStorageUnit(PAYLOAD)).rejects.toMatchObject({
        statusCode: 503, message: expect.stringContaining('Existing material documents')
      });
      expect(rfcCall).not.toHaveBeenCalled();
    });

    it('marks the outcome unknown when no new document is found after the commit', async () => {
      const { adapter } = make({ before: [doc('5000000009')], after: [doc('5000000009')] });

      await expect(adapter.postGoodsReceiptWithStorageUnit(PAYLOAD)).rejects.toMatchObject({ outcomeUnknown: true });
    });

    it('marks the outcome unknown when the RFC connection fails mid-call', async () => {
      const call = jest.fn().mockRejectedValue(new Error('RFC_COMMUNICATION_FAILURE'));
      const { adapter } = make({ call });

      await expect(adapter.postGoodsReceiptWithStorageUnit(PAYLOAD)).rejects.toMatchObject({ outcomeUnknown: true });
    });

    it('keeps a BAPI rejection as a definite 422', async () => {
      const call = jest.fn().mockResolvedValue({ RETURN: [{ TYPE: 'E', ID: 'M7', NUMBER: '021', MESSAGE: 'deficit' }] });
      const { adapter } = make({ call });

      const err = await adapter.postGoodsReceiptWithStorageUnit(PAYLOAD).catch((e) => e);

      expect(err.statusCode).toBe(422);
      expect(err.outcomeUnknown).toBeFalsy();
    });

    it('keeps a failed pre-check definite, because SAP was never asked to post', async () => {
      const { adapter } = make();

      const err = await adapter.postGoodsReceiptWithStorageUnit({ ...PAYLOAD, ExpiryDate: '2000-01-01' }).catch((e) => e);

      expect(err.message).toContain('Expired Batch Blocked');
      expect(err.outcomeUnknown).toBeFalsy();
    });

    it('finds a posted receipt for an attempt, searching from the day before it started', async () => {
      const { adapter } = make();
      adapter.rfc.readTable.mockResolvedValue([doc('5000000009'), doc('5000000010')]);

      const found = await adapter.findReceiptForAttempt({
        ReservationNo: '0180000003', ReservationItem: '10', createdAt: '2026-11-02T00:30:00.000Z'
      });

      expect(found).toEqual({ MaterialDocument: '5000000010', MaterialDocumentYear: '2026' });
      expect(adapter.rfc.readTable).toHaveBeenCalledWith('MATDOC', expect.anything(),
        ["VBELN_IM = '0180000003'", "AND VBELP_IM = '000010'", "AND BWART = '101'", "AND CPUDT >= '20261101'"]);
    });
  });

  describe('MMIM adapter path', () => {
    const PAYLOAD = {
      DeliveryDocument: '180000003', DeliveryDocumentItem: '10', Material: 'TG11',
      Plant: '1120', StorageLocation: 'HS01', Quantity: 1, Unit: 'KG'
    };
    const failing = (error) => {
      const adapter = new GoodsReceiptAdapter();
      jest.spyOn(adapter, '_post').mockRejectedValue(error);
      return adapter.postGoodsReceipt(PAYLOAD).catch((e) => e);
    };

    it('marks a timeout as an unknown outcome', async () => {
      expect(await failing(new Error('socket hang up'))).toMatchObject({ outcomeUnknown: true });
    });

    it('keeps an SAP 4xx definite and keeps its status', async () => {
      const err = await failing(Object.assign(new Error('Putaway check failed'), { status: 422 }));

      expect(err.status).toBe(422);
      expect(err.outcomeUnknown).toBeFalsy();
    });

    it('marks an HTTP 500 as an unknown outcome', async () => {
      expect(await failing(Object.assign(new Error('Internal Server Error'), { status: 500 }))).toMatchObject({ outcomeUnknown: true });
    });

    it('treats an error in the sap-message header as a definite refusal', async () => {
      const adapter = new GoodsReceiptAdapter();
      jest.spyOn(adapter, '_post').mockResolvedValue({
        _headers: { 'sap-message': JSON.stringify({ severity: 'error', message: 'Refused by SAP' }) }
      });

      const err = await adapter.postGoodsReceipt(PAYLOAD).catch((e) => e);

      expect(err.status).toBe(422);
      expect(err.outcomeUnknown).toBeFalsy();
    });
  });

  describe('attempt recheck', () => {
    const { GoodsIssueAttemptStore: Store } = GoodsIssueAttemptStore;
    const OLD = Date.now() + 16 * 60 * 1000; // past the not_posted age
    const SOON = Date.now() + 4 * 60 * 1000; // past the recheck age only
    const open = () => {
      const store = new Store({ db: null });
      return store.create({ ReferenceDocument: 'GRABC0', MovementType: '101', ReservationNo: '0180000003', ReservationItem: '10' })
        .then(() => store);
    };

    it('never lets the goods-issue recheck mark a receipt not_posted', async () => {
      const store = await open();
      const adapter = { findPostedGoodsIssueByReference: jest.fn().mockResolvedValue(null) };

      await store.recheck(adapter, OLD);

      expect(adapter.findPostedGoodsIssueByReference).not.toHaveBeenCalled();
      expect(store._memoryStore.get('GRABC0').Status).toBe('sending');
    });

    it('marks the attempt posted when SAP shows a receipt', async () => {
      const store = await open();
      const adapter = { findReceiptForAttempt: jest.fn().mockResolvedValue({ MaterialDocument: '5000000010', MaterialDocumentYear: '2026' }) };

      await store.recheckReceipts(adapter, SOON);

      expect(store._memoryStore.get('GRABC0')).toMatchObject({ Status: 'posted', MaterialDocument: '5000000010' });
    });

    it('keeps the attempt open while the not_posted age has not passed', async () => {
      const store = await open();

      await store.recheckReceipts({ findReceiptForAttempt: jest.fn().mockResolvedValue(null) }, SOON);

      expect(store._memoryStore.get('GRABC0').Status).toBe('sending');
    });

    it('marks the attempt not_posted once old enough with no receipt in SAP', async () => {
      const store = await open();

      await store.recheckReceipts({ findReceiptForAttempt: jest.fn().mockResolvedValue(null) }, OLD);

      expect(store._memoryStore.get('GRABC0').Status).toBe('not_posted');
    });

    it('keeps the attempt open when SAP cannot be read', async () => {
      const store = await open();

      await store.recheckReceipts({ findReceiptForAttempt: jest.fn().mockRejectedValue(new Error('RFC down')) }, OLD);

      expect(store._memoryStore.get('GRABC0').Status).toBe('sending');
    });

    it('ignores goods-issue attempts', async () => {
      const store = new Store({ db: null });
      await store.create({ ReferenceDocument: 'GIABC0', MovementType: '261', ReservationNo: '512851', ReservationItem: '3' });
      const adapter = { findReceiptForAttempt: jest.fn() };

      await store.recheckReceipts(adapter, OLD);

      expect(adapter.findReceiptForAttempt).not.toHaveBeenCalled();
    });
  });
});
