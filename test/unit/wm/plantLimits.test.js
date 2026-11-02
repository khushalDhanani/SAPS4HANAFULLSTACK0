'use strict';

/**
 * A non-Admin may only act on a plant SAP reports for the document, whatever plant the request names. [mock only, not SAP verification]
 */

const GoodsReceiptAdapter = require('../../../srv/integration/s4hana/wm/GoodsReceiptAdapter');
const GoodsIssueAdapter = require('../../../srv/integration/s4hana/wm/GoodsIssueAdapter');
const initReceipt = require('../../../srv/wm/goods-receipt/handlers/goodsReceipt.handler');
const GoodsIssueHandler = require('../../../srv/wm/goods-issue/handlers/goodsIssue.handler');
const TrToHandler = require('../../../srv/wm/tr-to/handlers/trTo.handler');

const ADMIN = { is: (r) => r === 'Admin', attr: {} };
const clerk = (plant) => ({ id: `clerk-${plant}`, is: () => false, attr: { Plant: [plant] } });
const collect = (init) => {
  const handlers = {};
  init({ on: (event, a, b) => { handlers[typeof a === 'function' ? event : `${event}_${a}`] = typeof a === 'function' ? a : b; } });
  return handlers;
};
/** The failure a handler reports, whichever way it reports it: throw, req.error or req.reject. */
const outcome = async (handler, data, user) => {
  const failures = [];
  const fail = (status, message) => { failures.push({ status, message }); return { status, message }; };
  try {
    await handler({ data, user, error: jest.fn(fail), reject: jest.fn(fail), headers: {} });
  } catch (err) {
    failures.push({ status: err.status || err.statusCode, message: err.message });
  }
  return failures[0] || null;
};

afterEach(() => jest.restoreAllMocks());

describe('Goods receipt: the plant comes from the delivery in SAP', () => {
  const handlers = collect(initReceipt);
  const DATA = { DeliveryDocument: '180000003', DeliveryDocumentItem: '10', Material: 'TG11', Plant: '1120', StorageLocation: 'HS01', Quantity: 1, Unit: 'KG', Simulate: true };

  describe.each(['postGoodsReceipt', 'postGoodsReceiptWithStorageUnit'])('%s', (action) => {
    let post;
    beforeEach(() => { post = jest.spyOn(GoodsReceiptAdapter, action).mockResolvedValue({ MaterialDocument: '5000000001' }); });

    it("refuses a clerk who names their own plant on another plant's delivery", async () => {
      jest.spyOn(GoodsReceiptAdapter, 'readDeliveryPlant').mockResolvedValue('1130');
      const failure = await outcome(handlers[action], DATA, clerk('1120'));
      expect(failure).toMatchObject({ status: 403, message: expect.stringContaining('1130') });
      expect(post).not.toHaveBeenCalled();
    });

    it('fails closed when the delivery plant cannot be read', async () => {
      jest.spyOn(GoodsReceiptAdapter, 'readDeliveryPlant').mockResolvedValue('');
      const failure = await outcome(handlers[action], DATA, clerk('1120'));
      expect(failure).toMatchObject({ status: 503, message: expect.stringContaining('NOT') });
      expect(post).not.toHaveBeenCalled();
    });

    it('allows a clerk on a delivery of their own plant', async () => {
      jest.spyOn(GoodsReceiptAdapter, 'readDeliveryPlant').mockResolvedValue('1120');
      expect(await outcome(handlers[action], DATA, clerk('1120'))).toBeNull();
      expect(post).toHaveBeenCalledTimes(1);
    });

    it('does not limit an Admin', async () => {
      const read = jest.spyOn(GoodsReceiptAdapter, 'readDeliveryPlant');
      expect(await outcome(handlers[action], DATA, ADMIN)).toBeNull();
      expect(read).not.toHaveBeenCalled();
      expect(post).toHaveBeenCalledTimes(1);
    });
  });

  it('reads the plant of the delivery item from LIPS', async () => {
    const readTable = jest.fn(async (table) => (table === 'LIPS' ? [{ WERKS: '1130', MEINS: 'KG', VRKME: 'KG', LFIMG: '1.000' }] : []));
    const rfc = GoodsReceiptAdapter.rfc;
    GoodsReceiptAdapter.rfc = { readTable };
    try {
      await expect(GoodsReceiptAdapter.readDeliveryPlant('180000003', '10')).resolves.toBe('1130');
      expect(readTable.mock.calls[0][1]).toContain('WERKS');
    } finally {
      GoodsReceiptAdapter.rfc = rfc;
    }
  });
});

describe('reverseGoodsIssue: the plant comes from the material document in SAP', () => {
  const handlers = collect((srv) => GoodsIssueHandler.init(srv));
  const DATA = { MaterialDocument: '4900000001', MaterialDocYear: '2026', ReversalReason: '01', PostingDate: '2026-11-02', DocumentDate: '2026-11-02' };
  let reverse;
  beforeEach(() => { reverse = jest.spyOn(GoodsIssueAdapter, 'reverseGoodsIssue').mockResolvedValue({ MaterialDocument: '4900000002' }); });

  it("refuses a clerk on another plant's document", async () => {
    jest.spyOn(GoodsIssueAdapter, 'getDocumentPlants').mockResolvedValue(['1130']);
    expect(await outcome(handlers.reverseGoodsIssue, DATA, clerk('1120'))).toMatchObject({ status: 403 });
    expect(reverse).not.toHaveBeenCalled();
  });

  it('refuses when any item of the document is in another plant', async () => {
    jest.spyOn(GoodsIssueAdapter, 'getDocumentPlants').mockResolvedValue(['1120', '1130']);
    expect(await outcome(handlers.reverseGoodsIssue, DATA, clerk('1120'))).toMatchObject({ status: 403 });
    expect(reverse).not.toHaveBeenCalled();
  });

  it.each([
    ['no rows', async () => []],
    ['a failed read', async () => { throw new Error('RFC down'); }]
  ])('fails closed on %s', async (_name, read) => {
    jest.spyOn(GoodsIssueAdapter, 'getDocumentPlants').mockImplementation(read);
    expect(await outcome(handlers.reverseGoodsIssue, DATA, clerk('1120'))).toMatchObject({ status: 503, message: expect.stringContaining('NOT') });
    expect(reverse).not.toHaveBeenCalled();
  });

  it('allows a clerk of that plant and does not limit an Admin', async () => {
    jest.spyOn(GoodsIssueAdapter, 'getDocumentPlants').mockResolvedValue(['1120']);
    expect(await outcome(handlers.reverseGoodsIssue, DATA, clerk('1120'))).toBeNull();
    expect(await outcome(handlers.reverseGoodsIssue, DATA, ADMIN)).toBeNull();
    expect(reverse).toHaveBeenCalledTimes(2);
  });

  it('reads the plants of the document from MATDOC', async () => {
    const readTable = jest.fn(async () => [{ WERKS: '1120' }, { WERKS: '1120' }, { WERKS: '1130' }]);
    const rfc = GoodsIssueAdapter.rfc;
    GoodsIssueAdapter.rfc = { readTable };
    try {
      await expect(GoodsIssueAdapter.getDocumentPlants('4900000001', '2026')).resolves.toEqual(['1120', '1130']);
      expect(readTable).toHaveBeenCalledWith('MATDOC', ['WERKS'], ["MBLNR = '4900000001'", "AND MJAHR = '2026'"]);
    } finally {
      GoodsIssueAdapter.rfc = rfc;
    }
  });
});

describe('Transfer orders: the plant comes from the document in SAP', () => {
  const build = ({ trPlants = ['1130'], resbPlant = '1130', ltapPlant = '1130' } = {}) => {
    const adapter = {
      getTR: jest.fn(async () => ({ Items: trPlants.map((Plant) => ({ Plant })) })),
      createTOFromTR: jest.fn(async () => ({ TransferOrder: '1', Status: '04', Success: true, success: true }))
    };
    const resProcessAdapter = {
      rfc: { readTable: jest.fn(async (table) => (table === 'RESB' ? [{ WERKS: resbPlant, MATNR: 'M', LGORT: 'CS01', BDMNG: '1', MEINS: 'KG' }] : table === 'LTAP' ? [{ WERKS: ltapPlant }] : [])) },
      checkAuthorization: jest.fn(async () => {}),
      postGoodsMovement: jest.fn(async () => ({ MaterialDocument: '4900000001', MaterialDocYear: '2026' })),
      createTOFromTR: jest.fn(async () => ({ TransferOrder: '1', Status: '04', Success: true, success: true })),
      confirmTransferOrder: jest.fn(async () => ({}))
    };
    const handlers = {};
    TrToHandler.init({ on: (event, fn) => { handlers[event] = fn; } }, { adapter, resProcessAdapter });
    return { handlers, adapter, resProcessAdapter };
  };

  describe('createTOFromTR', () => {
    const DATA = { lgnum: 'W01', tbnum: '1000982', tbpos: '0001', qty: 1, unit: 'KG', autoConfirm: true };

    it.each([[['1130']], [['1120', '1130']]])('refuses a clerk of 1120 on a TR with plants %j', async (trPlants) => {
      const { handlers, adapter, resProcessAdapter } = build({ trPlants });
      expect(await outcome(handlers.createTOFromTR, DATA, clerk('1120'))).toMatchObject({ status: 403 });
      expect(adapter.createTOFromTR).not.toHaveBeenCalled();
      expect(resProcessAdapter.createTOFromTR).not.toHaveBeenCalled();
    });

    it('fails closed when the TR cannot be read', async () => {
      const { handlers, adapter } = build();
      adapter.getTR.mockRejectedValue(new Error('RFC down'));
      expect(await outcome(handlers.createTOFromTR, DATA, clerk('1120'))).toMatchObject({ status: 503, message: expect.stringContaining('NOT') });
      expect(adapter.createTOFromTR).not.toHaveBeenCalled();
    });

    it('does not read the plant for an Admin', async () => {
      const { handlers, adapter } = build();
      await outcome(handlers.createTOFromTR, DATA, ADMIN);
      expect(adapter.getTR).not.toHaveBeenCalled();
    });

    it('lets a clerk of that plant through the plant check', async () => {
      const { handlers, adapter } = build({ trPlants: ['1120'] });
      const failure = await outcome(handlers.createTOFromTR, DATA, clerk('1120'));
      expect(failure?.status).not.toBe(403);
      expect(adapter.getTR).toHaveBeenCalledWith('1000982', 'W01');
    });
  });

  describe('postMigoGoodsMovement', () => {
    const DATA = { ReservationNo: '528779', ReservationItem: '0001', MovementType: '261', Material: 'M', Plant: '1120', StorageLocation: 'CS01', Quantity: 1, Unit: 'KG', OrderId: '1011' };

    it("refuses a clerk who names their own plant on another plant's reservation", async () => {
      const { handlers, resProcessAdapter } = build({ resbPlant: '1130' });
      expect(await outcome(handlers.postMigoGoodsMovement, DATA, clerk('1120'))).toMatchObject({ status: 403 });
      expect(resProcessAdapter.postGoodsMovement).not.toHaveBeenCalled();
    });

    it("refuses a clerk on another plant's transfer order", async () => {
      const { handlers, resProcessAdapter } = build({ ltapPlant: '1130' });
      const data = { TransferOrder: '1037664', MovementType: '261', Material: 'M', Plant: '1120', StorageLocation: 'CS01', Quantity: 1, Unit: 'KG' };
      expect(await outcome(handlers.postMigoGoodsMovement, data, clerk('1120'))).toMatchObject({ status: 403 });
      expect(resProcessAdapter.postGoodsMovement).not.toHaveBeenCalled();
    });

    it('fails closed when the reservation cannot be read', async () => {
      const { handlers, resProcessAdapter } = build();
      resProcessAdapter.rfc.readTable.mockRejectedValue(new Error('RFC down'));
      expect(await outcome(handlers.postMigoGoodsMovement, DATA, clerk('1120'))).toMatchObject({ status: 503, message: expect.stringContaining('NOT') });
      expect(resProcessAdapter.postGoodsMovement).not.toHaveBeenCalled();
    });

    it('lets a clerk of that plant reach the posting, and does not limit an Admin', async () => {
      const own = build({ resbPlant: '1120' });
      await outcome(own.handlers.postMigoGoodsMovement, DATA, clerk('1120'));
      expect(own.resProcessAdapter.postGoodsMovement).toHaveBeenCalledTimes(1);

      const admin = build({ resbPlant: '1130' });
      await outcome(admin.handlers.postMigoGoodsMovement, DATA, ADMIN);
      expect(admin.resProcessAdapter.postGoodsMovement).toHaveBeenCalledTimes(1);
    });
  });
});
