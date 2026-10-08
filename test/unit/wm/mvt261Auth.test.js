/**
 * F4: postGoodsIssue is a write and must be denied to the read-only Viewer role.
 * Boots the CAP server (mocked auth: bob=Viewer, carol=Viewer+WarehouseClerk) and spies the
 * adapter so the authorized path never reaches S/4HANA. No live posting.
 */
const cds = require('@sap/cds');
const Mvt261Adapter = require('../../../srv/integration/s4hana/wm/Mvt261Adapter');
const { RfcClient } = require('../../../srv/integration/s4hana/RfcClient');
const { S4HttpClient } = require('../../../srv/integration/s4hana/S4HttpClient');

const { POST, GET } = cds.test(__dirname + '/../../../');

describe('Mvt261Service postGoodsIssue authorization (F4)', () => {
  let spy;
  beforeEach(() => {
    spy = jest.spyOn(Mvt261Adapter.prototype, 'postGoodsIssue').mockResolvedValue({
      MaterialDocument: '4900050046', MaterialDocumentYear: '2026', DeliveryNumber: '', Pending: false, SapMessage: ''
    });
  });
  afterEach(() => spy.mockRestore());

  const call = (user) => POST('/odata/v4/mvt261/postGoodsIssue',
    { reservation: '278650', item: '1', quantity: 1 }, { auth: { username: user, password: '' } });

  it('rejects a Viewer (bob) with 403 and never reaches the adapter', async () => {
    await expect(call('bob')).rejects.toMatchObject({ response: { status: 403 } });
    expect(spy).not.toHaveBeenCalled();
  });

  it('allows a WarehouseClerk (carol) to invoke the action', async () => {
    const { status, data } = await call('carol');
    expect(status).toBe(200);
    expect(data).toMatchObject({ MaterialDocument: '4900050046' });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('Mvt261Service plant scope (F10)', () => {
  // The out-of-scope checks short-circuit in the adapter before any SAP read, so no S/4HANA call.
  const openItems = (user, plant) => GET(
    "/odata/v4/mvt261/openItems(plant='" + plant + "',material='',productionOrder='',reservation='',dateFrom='',dateTo='',includeFullyWithdrawn=false,scanPossibleOnly=false)",
    { auth: { username: user, password: '' } });

  it('an out-of-scope plant is a 403 (not an empty list)', async () => {
    // dave is a Viewer scoped to plant 1130; asking for 1120 is forbidden.
    await expect(openItems('dave', '1120')).rejects.toMatchObject({ response: { status: 403 } });
  });

  it('a user with no plant scope is a 403', async () => {
    // eve is a Viewer with no Plant attribute at all.
    await expect(openItems('eve', '1120')).rejects.toMatchObject({ response: { status: 403 } });
  });
});

describe('Mvt261Service reverse authorization (F6: managers/admin only)', () => {
  let cycleSpy;
  let revSpy;
  beforeEach(() => {
    cycleSpy = jest.spyOn(Mvt261Adapter.prototype, 'cycle').mockResolvedValue({
      Reservation: '512851', ReservationItem: '3', Material: 'M', Plant: '1120', StorageLocation: 'CS01', Unit: 'KG',
      History: [{ MaterialDocument: '4900050046', MaterialDocumentYear: '2026', MaterialDocumentItem: '0001', MovementType: '261', IsReversed: false }]
    });
    revSpy = jest.spyOn(Mvt261Adapter.prototype, 'reverse').mockResolvedValue({ MaterialDocument: '4900050099', MaterialDocumentYear: '2026' });
  });
  afterEach(() => { cycleSpy.mockRestore(); revSpy.mockRestore(); });

  const call = (user) => POST('/odata/v4/mvt261/reverse',
    { reservation: '512851', item: '3', materialDocument: '4900050046', materialDocumentYear: '2026', materialDocumentItem: '1' },
    { auth: { username: user, password: '' } });

  it('rejects a Viewer (bob) with 403 and never reaches the adapter', async () => {
    await expect(call('bob')).rejects.toMatchObject({ response: { status: 403 } });
    expect(revSpy).not.toHaveBeenCalled();
  });

  it('rejects a WarehouseClerk (carol) with 403 - reversal is managers/admin only', async () => {
    await expect(call('carol')).rejects.toMatchObject({ response: { status: 403 } });
    expect(revSpy).not.toHaveBeenCalled();
  });

  it('allows an Admin/Manager (alice) to reverse', async () => {
    const { status, data } = await call('alice');
    expect(status).toBe(200);
    expect(data).toMatchObject({ MaterialDocument: '4900050099' });
    expect(revSpy).toHaveBeenCalledTimes(1);
  });
});

describe('Mvt261Service 518006/3 empty-issue-location, end-to-end through the service (A5)', () => {
  // Drives the real adapter logic via the CAP service; only the SAP clients are mocked (no live SAP).
  const LQUA_CS01 = {
    LENUM: '1000048321', LGNUM: 'W01', LGTYP: 'RM1', LGPLA: 'B1', LGORT: 'CS01', MATNR: '000000001000000653', WERKS: '1120',
    CHARG: '', BESTQ: '', VERME: '25.000', EINME: '0.000', AUSME: '0.000', MEINS: 'KG', WDATU: '20250101',
    SKZUA: '', SKZUE: '', SKZSA: '', SKZSE: '', SKZSI: '', SPGRU: ''
  };
  const tables = {
    RESB: [{ RSNUM: '0000518006', RSPOS: '0003', AUFNR: '000001002747', MATNR: '000000001000000653', WERKS: '1120', LGORT: 'PT01', LGNUM: '', LGTYP: '', LGPLA: '', CHARG: '', PRVBE: 'IP05', RGEKZ: '', BDTER: '20260101', BDMNG: '25.000', ENMNG: '0.000', MEINS: 'KG', XLOEK: '', KZEAR: '', XWAOK: 'X' }],
    AUFK: [{ AUFNR: '000001002747', AUART: 'ZP01', LOEKZ: '' }],
    JEST: [{ OBJNR: 'OR000001002747', STAT: 'I0002' }],
    T320: [], MARD: [{ LGORT: 'PT01', LABST: '0.000' }], MCHB: [],
    PVBE: [{ PRVBE: 'IP05', LGORT: 'CS01' }],
    LQUA: [LQUA_CS01], LTBK: [], LTBP: [], LTAK: [], LTAP: [], MATDOC: [],
    MAKT: [{ MAKTX: 'Mat 653' }], MARC: [{ XCHPF: 'X' }]
  };
  const resvRow = {
    Reservation: '518006', ReservationItem: '3', RecordType: '', OrderID: '1002747', Product: '1000000653', Plant: '1120',
    StorageLocation: 'PT01', MatlCompRequirementDate: '/Date(1790000000000)/', ResvnItmRequiredQtyInBaseUnit: '25.000',
    ResvnItmWithdrawnQtyInBaseUnit: '0.000', BaseUnit: 'KG', GoodsMovementIsAllowed: true
  };
  let rfcSpy;
  let getSpy;
  beforeEach(() => {
    rfcSpy = jest.spyOn(RfcClient.prototype, 'readTable').mockImplementation(async (table) => tables[table] || []);
    getSpy = jest.spyOn(S4HttpClient.prototype, 'get').mockImplementation(async () => ({ data: { d: { __count: '1', results: [resvRow] } } }));
  });
  afterEach(() => { rfcSpy.mockRestore(); getSpy.mockRestore(); });

  it('scanContext: Blocked with the transfer reason (alice = all plants)', async () => {
    const { status, data } = await GET("/odata/v4/mvt261/scanContext(reservation='518006',item='3')", { auth: { username: 'alice', password: '' } });
    expect(status).toBe(200);
    expect(data).toMatchObject({ Blocked: true, SupplyAreaStock: 25, IssuableQuantity: 0 });
    expect(data.BlockReason).toBe('25 KG in supply area CS01; issue location PT01 is empty - transfer required');
  });

  it('openItems: the item is not ScanPossible and carries the transfer reason', async () => {
    const url = "/odata/v4/mvt261/openItems(plant='1120',material='',productionOrder='',reservation='518006',dateFrom='',dateTo='',includeFullyWithdrawn=false,scanPossibleOnly=false)";
    const { status, data } = await GET(url, { auth: { username: 'alice', password: '' } });
    expect(status).toBe(200);
    const item = (data.Items || []).find((i) => String(i.ReservationItem) === '3');
    expect(item).toMatchObject({ ScanPossible: false, Blocked: true });
    expect(item.BlockReason).toContain('in supply area CS01; issue location PT01 is empty');
  });
});
