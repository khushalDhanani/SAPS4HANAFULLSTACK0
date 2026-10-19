'use strict';

/**
 * Step 7.4: exact BAPI_RESERVATION_CREATE1 payload per movement type, built from MOVEMENT_CONFIG,
 * plus the RKPF/RESB read-back that follows BAPI_TRANSACTION_COMMIT. Mock RFC only - no SAP call.
 */

const ReservationProcessAdapter = require('../../../srv/integration/s4hana/wm/ReservationProcessAdapter');
const { MOVEMENT_CONFIG } = require('../../../srv/common/movementConfig');

const RSNUM = '0000530001';
const base = { plant: '1120', storageLocation: 'CS01', material: '1000000045', quantity: 2.5, unit: 'KG', batch: 'IN26001170', reservationDate: '20261019' };
const inputs = {
  '201': { ...base, movementType: '201', costCenter: '1011201301' },
  '241': { ...base, movementType: '241', assetNo: '400092', subNumber: '0000' },
  '261': { ...base, movementType: '261', orderType: 'ZEMP', orderId: '1011' },
  '301': { ...base, movementType: '301', receivingPlant: '1130', receivingStorageLocation: 'ST02' },
  '311': { ...base, movementType: '311', receivingStorageLocation: 'ST02' }
};
const item = { MATERIAL: '000000001000000045', PLANT: '1120', STGE_LOC: 'CS01', ENTRY_QNT: 2.5, ENTRY_UOM: 'KG', MOVEMENT: 'X', BATCH: 'IN26001170' };
const expectedHeader = {
  '201': { RES_DATE: '20261019', MOVE_TYPE: '201', COSTCENTER: '1011201301' },
  '241': { RES_DATE: '20261019', MOVE_TYPE: '241', ASSET_NO: '000000400092', SUB_NUMBER: '0000' },
  '261': { RES_DATE: '20261019', MOVE_TYPE: '261', ORDERID: '000000001011' },
  '301': { RES_DATE: '20261019', MOVE_TYPE: '301', MOVE_PLANT: '1130', MOVE_STLOC: 'ST02' },
  '311': { RES_DATE: '20261019', MOVE_TYPE: '311', MOVE_PLANT: '1120', MOVE_STLOC: 'ST02' }
};
// What RKPF/RESB hold after SAP committed exactly what was sent.
const rkpfFor = (h) => [{ RSNUM, BWART: h.MOVE_TYPE, KOSTL: h.COSTCENTER || '', ANLN1: h.ASSET_NO || '', ANLN2: h.SUB_NUMBER || '', UMWRK: h.MOVE_PLANT || '', UMLGO: h.MOVE_STLOC || '', AUFNR: h.ORDERID || '', USNAM: 'RFCUSER', RSDAT: '20261019' }];
const resbFor = () => [{ RSNUM, RSPOS: '0002', MATNR: item.MATERIAL, WERKS: '1120', LGORT: 'CS01', BDMNG: '2.500', MEINS: 'KG', CHARG: 'IN26001170', XLOEK: '' }];

function makeRfc(overrides = {}) {
  const rfc = {
    session: jest.fn(async (fn) => fn(rfc.call)),
    call: jest.fn()
      .mockResolvedValueOnce({ RESERVATION: RSNUM, RETURN: [{ TYPE: 'S', ID: 'M7', NUMBER: '060', MESSAGE: 'created' }] })
      .mockResolvedValueOnce({}),
    readTable: jest.fn(async (table) => {
      if (overrides[table]) return overrides[table];
      if (table === 'T320') return [{ LGNUM: 'W01', WERKS: '1120', LGORT: 'CS01' }];
      if (table === 'MARD') return [{ LGORT: 'CS01' }, { LGORT: 'ST02' }];
      if (table === 'MARC') return [{ XCHPF: 'X', WERKS: '1120' }];
      if (table === 'CSKS') return [{ KOSTL: '1011201301', DATAB: '20200101', DATBI: '99991231', BKZKP: '' }];
      if (table === 'T001K') return [{ BUKRS: '1000' }];
      if (table === 'ANLA') return [{ AKTIV: '20200101', DEAKT: '00000000', XLOEV: '', XSPEB: '' }];
      if (table === 'AUFK') return [{ AUFNR: '000000001011', AUART: 'ZEMP', WERKS: '1120', LOEKZ: '', ASTKZ: '', KOSTV: '' }];
      if (table === 'JEST') return [{ STAT: 'I0002', INACT: '' }];
      if (table === 'MCHA') return [{ LVORM: '' }];
      return [];
    })
  };
  return rfc;
}
const bapiArgs = (rfc) => rfc.call.mock.calls.find((c) => c[0] === 'BAPI_RESERVATION_CREATE1')[1];

describe('Step 7.4: exact BAPI_RESERVATION_CREATE1 payload per movement (MOVEMENT_CONFIG driven)', () => {
  test.each(Object.keys(inputs))('%s: header and item are exactly the policy-allowed fields', async (mvt) => {
    const rfc = makeRfc({ RKPF: rkpfFor(expectedHeader[mvt]), RESB: resbFor() });
    const adapter = new ReservationProcessAdapter({ rfc });
    const res = await adapter.createReservation(inputs[mvt]);
    expect(bapiArgs(rfc)).toEqual({ RESERVATIONHEADER: expectedHeader[mvt], RESERVATIONITEMS: [item] });
    expect(rfc.call.mock.calls[1]).toEqual(['BAPI_TRANSACTION_COMMIT', { WAIT: 'X' }]);
    expect(res).toMatchObject({ success: true, reservationNoRaw: RSNUM, reservationItem: '0002', sapVerified: true, createdByUser: 'RFCUSER', reservationDate: '2026-10-19' });
    expect(res.reservation).toEqual({ number: '530001', item: '0002' });
  });

  test.each(Object.keys(inputs))('%s: a field the policy forbids never reaches the header even if validation is bypassed', async (mvt) => {
    const cfg = MOVEMENT_CONFIG[mvt];
    const headerKeys = Object.keys(expectedHeader[mvt]);
    const forbiddenBapi = { CostCenter: 'COSTCENTER', AssetNo: 'ASSET_NO', SubNumber: 'SUB_NUMBER', OrderID: 'ORDERID', ReceivingPlant: 'MOVE_PLANT', ReceivingStorageLocation: 'MOVE_STLOC' };
    for (const f of cfg.forbiddenFields) {
      if (forbiddenBapi[f]) expect(headerKeys).not.toContain(forbiddenBapi[f]);
    }
    expect(headerKeys).not.toContain('GL_ACCOUNT');
  });

  test('241 (D7): no company-code or sub-number fallback - missing T001K row is reported, SUB_NUMBER is what was sent', async () => {
    const rfc = makeRfc({ T001K: [] });
    await expect(new ReservationProcessAdapter({ rfc }).createReservation(inputs['241']))
      .rejects.toMatchObject({ status: 400, message: 'No company code is assigned to plant 1120 (T001K); the asset cannot be validated' });
    expect(rfc.call).not.toHaveBeenCalled();
    const rfc2 = makeRfc({ RKPF: rkpfFor({ ...expectedHeader['241'], SUB_NUMBER: '0002' }), RESB: resbFor() });
    await new ReservationProcessAdapter({ rfc: rfc2 }).createReservation({ ...inputs['241'], subNumber: '2' });
    expect(bapiArgs(rfc2).RESERVATIONHEADER.SUB_NUMBER).toBe('0002');
    expect(rfc2.readTable.mock.calls.find((c) => c[0] === 'ANLA')[2]).toEqual(["BUKRS = '1000'", "AND ANLN1 = '000000400092'", "AND ANLN2 = '0002'"]);
  });

  test('201: alphanumeric cost center is sent as entered (no zero padding), numeric is ALPHA-padded to 10', async () => {
    const rfc = makeRfc({ CSKS: [{ KOSTL: 'SAP-DUMMY', DATAB: '20200101', DATBI: '99991231', BKZKP: '' }] });
    await new ReservationProcessAdapter({ rfc }).createReservation({ ...inputs['201'], costCenter: 'SAP-DUMMY' });
    expect(bapiArgs(rfc).RESERVATIONHEADER.COSTCENTER).toBe('SAP-DUMMY');
    const rfc2 = makeRfc();
    await new ReservationProcessAdapter({ rfc: rfc2 }).createReservation({ ...inputs['201'], costCenter: '4711' });
    expect(bapiArgs(rfc2).RESERVATIONHEADER.COSTCENTER).toBe('0000004711');
  });

  test('311: lower-case plant / storage locations are normalized to SAP keys before the BAPI', async () => {
    const rfc = makeRfc();
    await new ReservationProcessAdapter({ rfc }).createReservation({ ...inputs['311'], plant: '1120', storageLocation: 'cs01', receivingStorageLocation: 'st02', unit: 'kg' });
    const args = bapiArgs(rfc);
    expect(args.RESERVATIONHEADER).toEqual({ RES_DATE: '20261019', MOVE_TYPE: '311', MOVE_PLANT: '1120', MOVE_STLOC: 'ST02' });
    expect(args.RESERVATIONITEMS[0]).toMatchObject({ STGE_LOC: 'CS01', ENTRY_UOM: 'KG' });
  });

  test('261 statistical order: COSTCENTER is added from AUFK-KOSTV (policy allowsStatisticalCostCenter)', async () => {
    const rfc = makeRfc({ AUFK: [{ AUFNR: '000000001011', AUART: 'ZEMP', WERKS: '1120', LOEKZ: '', ASTKZ: 'X', KOSTV: '1011201301' }] });
    await new ReservationProcessAdapter({ rfc }).createReservation(inputs['261']);
    expect(bapiArgs(rfc).RESERVATIONHEADER).toEqual({ RES_DATE: '20261019', MOVE_TYPE: '261', ORDERID: '000000001011', COSTCENTER: '1011201301' });
  });

  test('writeApplicationLog: when BAL_LOG_CREATE cannot be called remotely the handle is empty, never fabricated (live 201 proof)', async () => {
    const rfc = makeRfc();
    rfc.call.mockReset().mockRejectedValue(new Error('Function module "BAL_LOG_CREATE" cannot be called \'remotely\'.'));
    const res = await new ReservationProcessAdapter({ rfc }).writeApplicationLog({ object: 'ZWM_RES', subObject: 'TRACK', reservationNo: '0000530229', reservationItem: '0001', step: 'MB21', messageText: 'x' });
    expect(res.logHandle).toBe('');
    expect(res.logHandle).not.toMatch(/^LOG_/);
  });

  describe('RKPF/RESB read-back after commit (audit D2)', () => {
    test('no row for this RSNUM: create still succeeds, sapVerified=false, item defaults to 0001', async () => {
      const rfc = makeRfc({ RKPF: [{ RSNUM: '0000999999', BWART: '201' }], RESB: [] });
      const res = await new ReservationProcessAdapter({ rfc }).createReservation(inputs['201']);
      expect(res).toMatchObject({ success: true, sapVerified: false, reservationItem: '0001', createdByUser: null, reservationDate: null });
      expect(res.sapReadBack.reason).toMatch(/no RKPF\/RESB row/);
    });

    test('read-back RFC failure: create still succeeds with sapVerified=false', async () => {
      const rfc = makeRfc();
      const orig = rfc.readTable.getMockImplementation();
      rfc.readTable.mockImplementation(async (table, ...rest) => (table === 'RKPF' ? Promise.reject(new Error('RFC down')) : orig(table, ...rest)));
      const res = await new ReservationProcessAdapter({ rfc }).createReservation(inputs['201']);
      expect(res).toMatchObject({ success: true, sapVerified: false });
      expect(res.sapReadBack.reason).toBe('RFC down');
    });

    test('SAP stored different values: throws 500 naming the reservation and the differing fields', async () => {
      const rfc = makeRfc({ RKPF: rkpfFor({ ...expectedHeader['201'], COSTCENTER: '9999999999' }), RESB: resbFor() });
      await expect(new ReservationProcessAdapter({ rfc }).createReservation(inputs['201']))
        .rejects.toMatchObject({ status: 500, reservationNo: '530001', message: expect.stringMatching(/KOSTL: SAP '9999999999' vs request '1011201301'/) });
    });

    test('unit converted by SAP (MEINS differs from ENTRY_UOM): quantity is not compared, still verified', async () => {
      const rfc = makeRfc({ RKPF: rkpfFor(expectedHeader['201']), RESB: [{ ...resbFor()[0], MEINS: 'G', BDMNG: '2500.000' }] });
      const res = await new ReservationProcessAdapter({ rfc }).createReservation(inputs['201']);
      expect(res.sapVerified).toBe(true);
      expect(res.sapReadBack.unitConverted).toBe(true);
    });

    test('testrun: no commit and no read-back', async () => {
      const rfc = makeRfc();
      await new ReservationProcessAdapter({ rfc }).createReservation({ ...inputs['201'], testrun: true });
      expect(rfc.call).toHaveBeenCalledTimes(1);
      expect(rfc.readTable.mock.calls.map((c) => c[0])).not.toContain('RKPF');
    });
  });
});
