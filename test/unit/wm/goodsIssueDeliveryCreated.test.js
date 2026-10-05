'use strict';

/**
 * WM-managed 261: SAP answers 201 with an empty MaterialDocument and sap-message L9/514
 * ("Delivery & created") - it created an outbound delivery instead of a material document.
 *  1. 201 + empty doc + delivery message  -> DELIVERY_CREATED, delivery persisted, no MATDOC polling.
 *  2. Repeat click while the delivery is open -> blocked, SAP not called again.
 *  3. recheckPostingAttempts finds the delivery -> delivery_created, never not_posted.
 *  4. Unparseable sap-message header -> falls back to the UNKNOWN outcome.
 */

const cds = require('@sap/cds');
cds.test(__dirname + '/../../../');

const GoodsIssuePostingClient = require('../../../srv/integration/s4hana/wm/goods-issue/GoodsIssuePostingClient');
const attempts = require('../../../srv/wm/goods-issue/GoodsIssueAttemptStore');
const { ATTEMPT_ENTITY } = attempts;
const PerTypeGoodsIssueHandler = require('../../../srv/wm/goods-issue/handlers/goodsIssuePerType.handler');
const GoodsIssueAdapter = require('../../../srv/integration/s4hana/wm/GoodsIssueAdapter');
const GoodsIssueIssuedSuStore = require('../../../srv/wm/goods-issue/GoodsIssueIssuedSuStore');

const { SELECT, DELETE } = cds.ql;
const MIN = 60000;

const L9_514 = JSON.stringify({ code: 'L9/514', message: 'Delivery 80000074 created', severity: 'info', details: [] });
const base = { IssueQty: 100, Unit: 'KG', Plant: '1130', StorageLocation: 'CS02', PostingDate: '2026-10-05', DocumentDate: '2026-10-05', Material: '3000000415', ReservationNo: '520615', ReservationItem: '0001' };

function makeClient(sapMessageHeader) {
  const rfc = { readTable: jest.fn(async () => []) };
  const client = new GoodsIssuePostingClient({ rfc });
  client._getDestination = jest.fn().mockResolvedValue({ name: 'DEST' });
  client._post = jest.fn(async (path) => {
    if (path.includes('zui_gi_order_rsv_o4')) throw Object.assign(new Error('Not Found'), { status: 404 });
    // What API_MATERIAL_DOCUMENT_SRV returns for a WM-managed location: 201, empty document number.
    return { MaterialDocument: '', MaterialDocumentYear: '', _headers: { 'sap-message': sapMessageHeader } };
  });
  return { client, rfc };
}

describe('sap-message parsing', () => {
  test('reads code, text, severity and finds the delivery number in the main message or details', () => {
    const parsed = GoodsIssuePostingClient.parseSapMessage({ 'sap-message': L9_514 });
    expect(parsed).toMatchObject({ code: 'L9/514', text: 'Delivery 80000074 created', severity: 'info' });
    expect(GoodsIssuePostingClient.deliveryFromSapMessage(parsed)).toBe('0080000074');

    const inDetails = GoodsIssuePostingClient.parseSapMessage({ 'sap-message': JSON.stringify({
      code: 'M7/060', message: 'Other', severity: 'info', details: [{ code: 'L9/514', message: 'Delivery 0080000081 created', severity: 'info' }]
    }) });
    expect(GoodsIssuePostingClient.deliveryFromSapMessage(inDetails)).toBe('0080000081');
  });

  test('absent header -> null; non-JSON header -> parseError, no delivery', () => {
    expect(GoodsIssuePostingClient.parseSapMessage({})).toBeNull();
    const bad = GoodsIssuePostingClient.parseSapMessage({ 'sap-message': 'L9/514 Delivery 80000074 created' });
    expect(bad).toMatchObject({ parseError: true });
    expect(GoodsIssuePostingClient.deliveryFromSapMessage(bad)).toBeNull();
  });
});

describe('post261 on a WM-managed location', () => {
  const savedDelays = process.env.GI_REFERENCE_LOOKUP_DELAYS_MS;
  beforeAll(() => { process.env.GI_REFERENCE_LOOKUP_DELAYS_MS = '0,0'; });
  afterAll(() => {
    if (savedDelays === undefined) delete process.env.GI_REFERENCE_LOOKUP_DELAYS_MS;
    else process.env.GI_REFERENCE_LOOKUP_DELAYS_MS = savedDelays;
  });

  test('201 + empty MaterialDocument + L9/514 -> DELIVERY_CREATED with the delivery number, no retry, no MATDOC polling', async () => {
    const { client, rfc } = makeClient(L9_514);
    const res = await client.post261(base);
    expect(res).toMatchObject({
      PostingStatus: 'DELIVERY_CREATED',
      DeliveryNumber: '0080000074',
      MaterialDocument: '',
      Success: false
    });
    expect(res.Message).toMatch(/outbound delivery 0080000074.*Do not post again/);
    expect(rfc.readTable).not.toHaveBeenCalled();
    expect(client._post.mock.calls.filter(([p]) => p.includes('A_MaterialDocumentHeader'))).toHaveLength(1);
  });

  test('header parse failure -> falls back to UNKNOWN (no delivery outcome is guessed)', async () => {
    const { client, rfc } = makeClient('L9/514 Delivery 80000074 created');
    await expect(client.post261(base)).rejects.toMatchObject({ status: 504, code: 'GI_POSTING_UNCONFIRMED' });
    expect(rfc.readTable).toHaveBeenCalledWith('MATDOC', expect.any(Array), expect.any(Array));
  });
});

describe('delivery lookups (LIKP/LIPS)', () => {
  test('reservation-item deliveries are joined to their header; WBSTK C is closed', async () => {
    const rfc = { readTable: jest.fn(async (table) => (table === 'LIPS'
      ? [{ VBELN: '0080000074', POSNR: '000010', LFIMG: '100.000', VRKME: 'KG', BWART: '261' }, { VBELN: '0080000070', POSNR: '000010', LFIMG: '5.000', VRKME: 'KG', BWART: '261' }]
      : [{ VBELN: '0080000074', LFART: 'HOD', ERDAT: '20261005', ERZET: '103543', WBSTK: 'A', LIFEX: 'GI65GEUZ94A5JDZ0' }, { VBELN: '0080000070', LFART: 'HOD', ERDAT: '20261001', ERZET: '090000', WBSTK: 'C', LIFEX: '' }])) };
    const client = new GoodsIssuePostingClient({ rfc });
    const list = await client.findDeliveriesForReservationItem('520615', '1');
    expect(rfc.readTable).toHaveBeenCalledWith('LIPS', expect.any(Array), ["RSNUM = '0000520615'", "AND RSPOS = '0001'"]);
    expect(rfc.readTable).toHaveBeenCalledWith('LIKP', expect.any(Array), ["VBELN = '0080000074'", "OR VBELN = '0080000070'"]);
    expect(list).toEqual([
      expect.objectContaining({ DeliveryNumber: '0080000074', Open: true, Quantity: 100, ExternalId: 'GI65GEUZ94A5JDZ0' }),
      expect.objectContaining({ DeliveryNumber: '0080000070', Open: false })
    ]);
  });

  test('no RFC table access -> throws instead of reporting "no delivery"', async () => {
    const client = new GoodsIssuePostingClient({ rfc: {}, adapter: {} });
    await expect(client.findDeliveriesForReservationItem('520615', '0001')).rejects.toMatchObject({ status: 502 });
    await expect(client.findDeliveryByReference('GIX')).rejects.toMatchObject({ status: 502 });
  });
});

describe('handler + attempt store', () => {
  const handlers = {};
  PerTypeGoodsIssueHandler.init({ on: (event, fn) => { handlers[event] = fn; } });
  const makeReq = (data) => ({ data, user: { id: 'TESTUSER' }, error: jest.fn((code, msg) => ({ code, message: msg })) });
  const payload = { ...base, OrderNo: '2000623', StorageUnits: ['2000018955'] };

  beforeEach(async () => {
    await cds.db.run(DELETE.from(ATTEMPT_ENTITY));
    attempts.clearMemoryStore();
    await GoodsIssueIssuedSuStore.clear();
    jest.spyOn(GoodsIssueAdapter, 'isBatchManaged').mockResolvedValue(false);
    jest.spyOn(GoodsIssueAdapter, 'checkStagingForReservation').mockResolvedValue({ isVerified: true, stagingStatus: 'OK' });
    jest.spyOn(GoodsIssueAdapter, 'getReservationItemAuthoritative').mockResolvedValue({
      ReservationNo: '520615', ReservationItem: '0001', OrderNo: '2000623', Material: '3000000415',
      Plant: '1130', StorageLocation: 'CS02', OpenQty: 100, RequiredQty: 100
    });
    jest.spyOn(GoodsIssueAdapter, 'listStockUnitsForReservationItem').mockResolvedValue({
      ReservationNo: '520615', ReservationItem: '0001', Material: '3000000415', Plant: '1130', StorageLocation: 'CS02',
      StockUnits: [{ StorageUnit: '2000018955', AvailableStock: 100, Material: '3000000415', Plant: '1130', StorageLocation: 'CS02' }]
    });
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await cds.db.run(DELETE.from(ATTEMPT_ENTITY));
    attempts.clearMemoryStore();
    await GoodsIssueIssuedSuStore.clear();
  });

  test('delivery created is persisted, the SU claim is kept, and a repeat click is blocked while the delivery is open', async () => {
    const findDeliveries = jest.spyOn(GoodsIssueAdapter, 'findDeliveriesForReservationItem').mockResolvedValueOnce([]);
    const postSpy = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue261').mockResolvedValue({
      ReservationNo: '520615', ReservationItem: '0001', MaterialDocument: '', DeliveryNumber: '0080000074',
      PostingStatus: 'DELIVERY_CREATED', Success: false, Confirmed: false, Message: 'delivery created'
    });

    const req1 = makeReq({ ...payload, ClientAttemptId: 'CLICK-1' });
    const res1 = await handlers.postGoodsIssue261(req1);
    expect(req1.error).not.toHaveBeenCalled();
    expect(res1).toMatchObject({ PostingStatus: 'DELIVERY_CREATED', DeliveryNumber: '0080000074' });
    const [row] = await cds.db.run(SELECT.from(ATTEMPT_ENTITY));
    expect(row).toMatchObject({ Status: 'delivery_created', DeliveryNumber: '0080000074' });
    expect(await GoodsIssueIssuedSuStore.hasActiveClaimForReservation('520615', '0001')).toBe(true);

    // Identical request again: replayed from the attempt log, SAP not called.
    const replay = await handlers.postGoodsIssue261(makeReq({ ...payload, ClientAttemptId: 'CLICK-1' }));
    expect(replay).toMatchObject({ PostingStatus: 'DELIVERY_CREATED', DeliveryNumber: '0080000074' });

    // New click: SAP shows the delivery still open -> blocked before posting.
    findDeliveries.mockResolvedValue([{ DeliveryNumber: '0080000074', Open: true, Quantity: 100 }]);
    await GoodsIssueIssuedSuStore.clear(); // isolate the open-delivery guard from the claim guard
    const req2 = makeReq({ ...payload, ClientAttemptId: 'CLICK-2' });
    await handlers.postGoodsIssue261(req2);
    expect(req2.error).toHaveBeenCalledWith(409, expect.stringContaining('open outbound delivery 0080000074'));
    expect(postSpy).toHaveBeenCalledTimes(1);
  });

  test('open-delivery check that cannot read SAP blocks the post (fail closed)', async () => {
    jest.spyOn(GoodsIssueAdapter, 'findDeliveriesForReservationItem').mockRejectedValue(new Error('RFC down'));
    const postSpy = jest.spyOn(GoodsIssueAdapter, 'postGoodsIssue261');
    const req = makeReq({ ...payload, ClientAttemptId: 'CLICK-3' });
    await handlers.postGoodsIssue261(req);
    expect(req.error).toHaveBeenCalledWith(502, expect.stringContaining('could not be checked'));
    expect(postSpy).not.toHaveBeenCalled();
  });

  test('recheck finds the delivery by reference -> delivery_created, never not_posted (even past the not-posted age)', async () => {
    const created = await attempts.create({ ReferenceDocument: 'GI65GEUZ94A5JDZ0', MovementType: '261', ReservationNo: '520615', ReservationItem: '0001', IssueQty: 100, PostingDate: '2026-10-05' });
    await attempts.setStatus(created.ReferenceDocument, 'unconfirmed');
    const adapter = {
      findPostedGoodsIssueByReference: jest.fn().mockResolvedValue(null),
      findDeliveryByReference: jest.fn().mockResolvedValue({ DeliveryNumber: '0080000074', Open: true }),
      findDeliveriesForReservationItem: jest.fn()
    };
    const summary = await attempts.recheck(adapter, Date.now() + 60 * MIN);
    expect(summary).toMatchObject({ DeliveryCreated: 1, NotPosted: 0 });
    const row = await attempts.getByReference('GI65GEUZ94A5JDZ0');
    expect(row).toMatchObject({ Status: 'delivery_created', DeliveryNumber: '0080000074' });
  });

  test('recheck: several unattributable deliveries keep the attempt open; a failed lookup keeps the status', async () => {
    await attempts.create({ ReferenceDocument: 'GIAMBIG0000001', MovementType: '261', ReservationNo: '520615', ReservationItem: '0001', IssueQty: 100, PostingDate: '2026-10-05' });
    const adapter = {
      findPostedGoodsIssueByReference: jest.fn().mockResolvedValue(null),
      findDeliveryByReference: jest.fn().mockResolvedValue(null),
      findDeliveriesForReservationItem: jest.fn().mockResolvedValue([
        { DeliveryNumber: '0080000090', ExternalId: '', CreatedOn: '20261005', Quantity: 100 },
        { DeliveryNumber: '0080000091', ExternalId: '', CreatedOn: '20261005', Quantity: 100 }
      ])
    };
    expect(await attempts.recheck(adapter, Date.now() + 60 * MIN)).toMatchObject({ StillOpen: 1, NotPosted: 0 });

    adapter.findDeliveryByReference.mockRejectedValue(new Error('RFC down'));
    expect(await attempts.recheck(adapter, Date.now() + 60 * MIN)).toMatchObject({ Errors: 1, NotPosted: 0 });
    expect((await attempts.getByReference('GIAMBIG0000001')).Status).toBe('sending');
  });

  test('partial PGI (WBSTK B) -> treated as open delivery, blocks repeat post, and keeps the SU claim', async () => {
    // 1. LIKP delivery with partial PGI: WBSTK = 'B' (Partially processed)
    const rfc = { readTable: jest.fn(async (table) => (table === 'LIPS'
      ? [{ VBELN: '0080000074', POSNR: '000010', LFIMG: '100.000', VRKME: 'KG', BWART: '261' }]
      : [{ VBELN: '0080000074', LFART: 'HOD', ERDAT: '20261005', ERZET: '103543', WBSTK: 'B', LIFEX: 'GIPARTIALPGI01' }])) };
    const postingClient = new GoodsIssuePostingClient({ rfc });
    const deliveries = await postingClient.findDeliveriesForReservationItem('520615', '0001');
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({ DeliveryNumber: '0080000074', GoodsMovementStatus: 'B', Open: true });

    // 2. Handler blocks post when partial PGI delivery is open
    jest.spyOn(GoodsIssueAdapter, 'findDeliveriesForReservationItem').mockResolvedValue([
      { DeliveryNumber: '0080000074', Open: true, GoodsMovementStatus: 'B', Quantity: 100 }
    ]);
    const req = makeReq({ ...payload, ClientAttemptId: 'CLICK-PARTIAL' });
    await handlers.postGoodsIssue261(req);
    expect(req.error).toHaveBeenCalledWith(409, expect.stringContaining('open outbound delivery 0080000074'));

    // 3. Recheck links attempt to delivery with WBSTK B and keeps status delivery_created
    await attempts.create({ ReferenceDocument: 'GIPARTIALPGI01', MovementType: '261', ReservationNo: '520615', ReservationItem: '0001', IssueQty: 100, PostingDate: '2026-10-05' });
    const adapter = {
      findPostedGoodsIssueByReference: jest.fn().mockResolvedValue(null),
      findDeliveryByReference: jest.fn().mockResolvedValue({ DeliveryNumber: '0080000074', Open: true, GoodsMovementStatus: 'B' }),
      findDeliveriesForReservationItem: jest.fn()
    };
    const summary = await attempts.recheck(adapter, Date.now() + 60 * MIN);
    expect(summary).toMatchObject({ DeliveryCreated: 1, NotPosted: 0 });
    const row = await attempts.getByReference('GIPARTIALPGI01');
    expect(row).toMatchObject({ Status: 'delivery_created', DeliveryNumber: '0080000074' });
  });
});
