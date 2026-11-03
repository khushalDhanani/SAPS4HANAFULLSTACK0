'use strict';

// [mock only, not SAP verification] Read operations of /odata/v4/tr-to must not write to SAP or to ReservationTrack.
const cds = require('@sap/cds');
const { RfcClient } = require('../../../srv/integration/s4hana/RfcClient');
const TrToAdapter = require('../../../srv/integration/s4hana/wm/TrToAdapter');

const { GET } = cds.test(__dirname + '/../../../');
const { SELECT, INSERT, DELETE } = cds.ql;

const TRACK_ENTITY = 'saps4hana.wm.ReservationTrack';
const auth = (username) => ({ auth: { username, password: '' } });
const VIEWER = auth('test-viewer-1120');
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
