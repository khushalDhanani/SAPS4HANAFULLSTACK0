'use strict';

// [mock only, not SAP verification] Read operations of /odata/v4/tr-to must not write to SAP or to ReservationTrack.
const cds = require('@sap/cds');
const { RfcClient } = require('../../../srv/integration/s4hana/RfcClient');
const TrToAdapter = require('../../../srv/integration/s4hana/wm/TrToAdapter');

const { GET, POST } = cds.test(__dirname + '/../../../');
const { SELECT, INSERT, DELETE } = cds.ql;

const TRACK_ENTITY = 'saps4hana.wm.ReservationTrack';
const auth = (username) => ({ auth: { username, password: '' } });
const VIEWER = auth('test-viewer-1120');
const CLERK = auth('test-clerk-1120');
const TR = '1000849';
const RES = '0000777401';
const LOOKUP = `/odata/v4/tr-to/lookupTR(tbnum='${TR}',lgnum='W01',docType='TR',tbpos='')`;

const closedTr = {
  ET_TR_HEADER: [{ LGNUM: 'W01', TBNUM: '0001000849', BWLVS: '311', STATU: 'E', RSNUM: RES }],
  ET_TR_ITEMS: [{ LGNUM: 'W01', TBNUM: '0001000849', TBPOS: '0001', MATNR: '000000008000009754', WERKS: '1120', LGORT: 'HS01', MENGE: '1.000', TAMEN: '0.000', MEINS: 'NOS', ELIKZ: '' }]
};
const fakeTables = async (table) => {
  if (table === 'RESB') return [{ RSNUM: RES, RSPOS: '0001', BDMNG: '1.000', ENMNG: '0.000', KZEAR: '' }];
  return [];
};

describe('tr-to lookupTR is read-only', () => {
  let call;
  let spies;

  beforeEach(async () => {
    await cds.db.run(DELETE.from(TRACK_ENTITY).where({ ReservationNo: RES }));
    await cds.db.run(INSERT.into(TRACK_ENTITY).entries({
      ReservationNo: RES, ReservationItem: '0001', MovementType: '311', Material: '8000009754', Plant: '1120', StorageLocation: 'HS01',
      Quantity: 1, Unit: 'NOS', Status_code: '02', TransferRequirement: TR, WarehouseNumber: 'W01'
    }));
    call = jest.fn(async () => closedTr);
    spies = [
      jest.spyOn(RfcClient.prototype, 'call').mockImplementation(call),
      jest.spyOn(RfcClient.prototype, 'session').mockImplementation(async (fn) => fn(call)),
      jest.spyOn(RfcClient.prototype, 'readTable').mockImplementation(fakeTables)
    ];
  });

  afterEach(async () => {
    spies.forEach((s) => s.mockRestore());
    await cds.db.run(DELETE.from(TRACK_ENTITY).where({ ReservationNo: RES }));
  });

  test('a Viewer on a status-E TR never calls Z_WM_TR_CREATE and never updates ReservationTrack', async () => {
    const before = await cds.db.run(SELECT.one.from(TRACK_ENTITY).where({ ReservationNo: RES }));
    await GET(LOOKUP, VIEWER);
    expect(call).not.toHaveBeenCalledWith('Z_WM_TR_CREATE', expect.anything());
    expect(call.mock.calls.map(([fm]) => fm)).toEqual(expect.arrayContaining(['Z_WM_GET_TR_MATERIAL_LIST']));
    expect(new Set(call.mock.calls.map(([fm]) => fm))).toEqual(new Set(['Z_WM_GET_TR_MATERIAL_LIST']));
    const after = await cds.db.run(SELECT.one.from(TRACK_ENTITY).where({ ReservationNo: RES }));
    expect(after).toEqual(before);
  });

  test('lookupTR returns the recovery required result', async () => {
    const { status, data } = await GET(LOOKUP, VIEWER);
    expect(status).toBe(200);
    expect(data).toMatchObject({
      RecoveryRequired: true,
      TransferRequirement: TR,
      WarehouseNumber: 'W01',
      Status: 'E',
      StatusText: 'Recovery required'
    });
    expect(data.RecoveryMessage).toContain(TR);
  });

  test('a completed TR with no open reservation still answers 400 and writes nothing', async () => {
    RfcClient.prototype.readTable.mockImplementation(async () => []);
    await expect(GET(LOOKUP, VIEWER)).rejects.toMatchObject({ response: { status: 400 } });
    expect(call).not.toHaveBeenCalledWith('Z_WM_TR_CREATE', expect.anything());
  });
});

describe('tr-to createTOFromTR keeps the recovery', () => {
  test('a status-E TR with an open reservation is recovered through Z_WM_TR_CREATE', async () => {
    const reopened = {
      ET_TR_HEADER: [{ ...closedTr.ET_TR_HEADER[0], TBNUM: '0001000855', STATU: '', RSNUM: '' }],
      ET_TR_ITEMS: [{ ...closedTr.ET_TR_ITEMS[0], TBNUM: '0001000855' }]
    };
    const call = jest.fn(async (fm, params) => {
      if (fm === 'Z_WM_GET_TR_MATERIAL_LIST') return params.IV_TR_NUMBER === '0001000855' ? reopened : closedTr;
      if (fm === 'Z_WM_TR_CREATE') return { EV_TBNUM: '0001000855', EV_SUCCESS: 'S' };
      throw Object.assign(new Error(`stop after recovery: ${fm}`), { status: 400 });
    });
    const rfc = { call, readTable: jest.fn(fakeTables), session: jest.fn(async (fn) => fn(call)) };
    const adapter = new TrToAdapter({ rfc });
    const track = { ReservationNo: RES, ReservationItem: '0001', Material: '8000009754', Plant: '1120', StorageLocation: 'HS01', Quantity: 1, Unit: 'NOS', MovementType: '311', Status_code: '02' };
    jest.spyOn(adapter, '_findTrackedReservationForTR').mockResolvedValue(track);

    await adapter.createTOFromTR({ lgnum: 'W01', tbnum: TR, tbpos: '0001', qty: 1, unit: 'NOS' }).catch(() => {});

    expect(call).toHaveBeenCalledWith('Z_WM_TR_CREATE', expect.objectContaining({ IV_LGNUM: 'W01', IV_COMMIT: 'X' }));
  });
});

describe('tr-to read operations keep to the user plants', () => {
  const OTHER = auth('test-clerk-1130');
  const NO_PLANT = auth('test-viewer-noplant');
  const openTr = (plant) => ({
    ET_TR_HEADER: [{ LGNUM: 'W01', TBNUM: '0001000850', BWLVS: '311', STATU: '', RSNUM: '' }],
    ET_TR_ITEMS: [{ LGNUM: 'W01', TBNUM: '0001000850', TBPOS: '0001', MATNR: '000000008000009754', WERKS: plant, LGORT: 'HS01', MENGE: '1.000', TAMEN: '0.000', MEINS: 'NOS', ELIKZ: '' }]
  });
  let spies;
  const tables = (plant) => async (table) => {
    if (table === 'LTBK') return [{ LGNUM: 'W01', TBNUM: '0001000850', BWLVS: '311', STATU: '', BDATU: '20261103' }];
    if (table === 'LTBP') return [{ LGNUM: 'W01', TBNUM: '0001000850', WERKS: plant }];
    if (table === 'T320') return [{ LGNUM: 'W01', WERKS: plant }];
    return [];
  };
  const useSap = (plant) => {
    const call = jest.fn(async () => openTr(plant));
    spies = [
      jest.spyOn(RfcClient.prototype, 'call').mockImplementation(call),
      jest.spyOn(RfcClient.prototype, 'session').mockImplementation(async (fn) => fn(call)),
      jest.spyOn(RfcClient.prototype, 'readTable').mockImplementation(tables(plant))
    ];
  };
  afterEach(() => spies.forEach((s) => s.mockRestore()));

  const lookup = (lgnum) => `/odata/v4/tr-to/lookupTR(tbnum='1000850',lgnum='${lgnum}',docType='TR',tbpos='')`;

  test.each([['with lgnum', 'W01'], ['without lgnum', '']])('lookupTR %s: own plant is served', async (_label, lgnum) => {
    useSap('1120');
    const { data } = await GET(lookup(lgnum), VIEWER);
    expect(data.Plant).toBe('1120');
  });

  test.each([['with lgnum', 'W01'], ['without lgnum', '']])('lookupTR %s: another plant answers 404', async (_label, lgnum) => {
    useSap('1200');
    await expect(GET(lookup(lgnum), VIEWER)).rejects.toMatchObject({ response: { status: 404 } });
  });

  test('getTR: another plant answers 404, own plant is served', async () => {
    useSap('1200');
    await expect(GET("/odata/v4/tr-to/getTR(tbnum='1000850',lgnum='W01')", VIEWER)).rejects.toMatchObject({ response: { status: 404 } });
    spies.forEach((s) => s.mockRestore());
    useSap('1120');
    const { status } = await GET("/odata/v4/tr-to/getTR(tbnum='1000850',lgnum='W01')", VIEWER);
    expect(status).toBe(200);
  });

  test('getOpenTRs: a warehouse outside the user plants is refused', async () => {
    useSap('1120');
    expect((await GET("/odata/v4/tr-to/getOpenTRs(lgnum='W01',mvt='')", VIEWER)).status).toBe(200);
    await expect(GET("/odata/v4/tr-to/getOpenTRs(lgnum='W99',mvt='')", VIEWER)).rejects.toMatchObject({ response: { status: 403 } });
    await expect(GET("/odata/v4/tr-to/getOpenTRs(lgnum='W01',mvt='')", NO_PLANT)).rejects.toMatchObject({ response: { status: 403 } });
  });

  test('getFifoBatches: a plant is required and must be the user\'s own', async () => {
    useSap('1120');
    const url = (plant) => `/odata/v4/tr-to/getFifoBatches(material='8000009754',plant='${plant}',storageLocation='HS01',warehouseNumber='W01')`;
    expect((await GET(url('1120'), VIEWER)).status).toBe(200);
    await expect(GET(url('1200'), VIEWER)).rejects.toMatchObject({ response: { status: 403 } });
    await expect(GET(url(''), VIEWER)).rejects.toMatchObject({ response: { status: 403 } });
  });

  test('getAvailableSerials: a plant is required and must be the user\'s own', async () => {
    useSap('1120');
    const url = (plant) => `/odata/v4/tr-to/getAvailableSerials(material='8000009754',plant='${plant}',storageLocation='HS01',batch='')`;
    expect((await GET(url('1120'), VIEWER)).status).toBe(200);
    await expect(GET(url('1200'), VIEWER)).rejects.toMatchObject({ response: { status: 403 } });
  });

  test.each(['verifyMaterialDocument', 'verifyStock'])('%s: a plant outside the user plants is refused before SAP', async (action) => {
    useSap('1120');
    const body = { materialDocument: '4900000001', materialDocumentYear: '2026', movementType: '311', plant: '1200' };
    await expect(POST(`/odata/v4/tr-to/${action}`, body, CLERK)).rejects.toMatchObject({ response: { status: 403 } });
    await expect(POST(`/odata/v4/tr-to/${action}`, { ...body, plant: undefined }, CLERK)).rejects.toMatchObject({ response: { status: 403 } });
    expect(RfcClient.prototype.readTable).not.toHaveBeenCalled();
  });

  test('another clerk plant cannot read this plant through lookupTR', async () => {
    useSap('1120');
    await expect(GET(lookup('W01'), OTHER)).rejects.toMatchObject({ response: { status: 404 } });
  });

  test('no read operation calls a writing function module or changes the local tracking tables', async () => {
    useSap('1120');
    const rows = async () => [
      await cds.db.run(SELECT.from(TRACK_ENTITY)),
      await cds.db.run(SELECT.from('saps4hana.wm.ReservationLog'))
    ];
    const before = await rows();
    const doc = { materialDocument: '4900000001', materialDocumentYear: '2026', movementType: '311', plant: '1120', material: '8000009754', quantity: 1 };
    const calls = [
      () => GET("/odata/v4/tr-to/getOpenTRs(lgnum='W01',mvt='')", CLERK),
      () => GET("/odata/v4/tr-to/getTR(tbnum='1000850',lgnum='W01')", CLERK),
      () => GET(lookup('W01'), CLERK),
      () => GET("/odata/v4/tr-to/getFifoBatches(material='8000009754',plant='1120',storageLocation='HS01',warehouseNumber='W01')", CLERK),
      () => GET("/odata/v4/tr-to/getAvailableSerials(material='8000009754',plant='1120',storageLocation='HS01',batch='')", CLERK),
      () => POST('/odata/v4/tr-to/verifyMaterialDocument', doc, CLERK),
      () => POST('/odata/v4/tr-to/verifyStock', doc, CLERK),
      () => POST('/odata/v4/tr-to/verifyReservation', { reservationNumber: '525278', reservationItem: '0001' }, CLERK)
    ];
    for (const send of calls) await send().catch(() => {}); // some answer 4xx or 500 on empty SAP data; none may write either way
    const called = new Set(RfcClient.prototype.call.mock.calls.map(([fm]) => fm));
    expect([...called]).toEqual(['Z_WM_GET_TR_MATERIAL_LIST']);
    const tablesRead = RfcClient.prototype.readTable.mock.calls.map(([table]) => table);
    expect(tablesRead).toEqual(expect.arrayContaining(['LTBK', 'MATDOC', 'RESB'])); // the operations did reach their SAP reads
    expect(await rows()).toEqual(before);
  });
});

describe('tr-to handler names with no service definition', () => {
  test.each(['VerifyMaterialDocument', 'VerifyStock', 'verifyResultingStock', 'VerifyResultingStock', 'VerifyReservation', 'ExecuteReservationWarehouseFlow'])('%s cannot be reached over OData', async (name) => {
    const ReservationProcessAdapter = require('../../../srv/integration/s4hana/wm/ReservationProcessAdapter');
    const spies = ['verifyMaterialDocument', 'verifyStock', 'verifyReservation', 'executeReservationWarehouseFlow'].map((m) => jest.spyOn(ReservationProcessAdapter.prototype, m));
    const { data: metadata } = await GET('/odata/v4/tr-to/$metadata', auth('khushal'));
    expect(metadata).not.toContain(`Name="${name}"`);
    await expect(POST(`/odata/v4/tr-to/${name}`, {}, auth('khushal'))).rejects.toMatchObject({ response: { status: expect.any(Number) } });
    spies.forEach((spy) => { expect(spy).not.toHaveBeenCalled(); spy.mockRestore(); });
  });
});
