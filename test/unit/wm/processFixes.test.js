'use strict';

/**
 * Mock tests for the 13-fix remediation of the reservation -> TR -> TO -> confirm -> goods movement process.
 * [mock only, not SAP verification] - every SAP call is a fake; nothing here proves SAP behaviour.
 */
const fs = require('fs');
const path = require('path');
const TrToAdapter = require('../../../srv/integration/s4hana/wm/TrToAdapter');
const ReservationProcessAdapter = require('../../../srv/integration/s4hana/wm/ReservationProcessAdapter');
const TrToHandler = require('../../../srv/wm/tr-to/handlers/trTo.handler');
const { STATUS, STATUS_TEXT, STATUS_CRITICALITY, UNCONFIRMED_TO } = require('../../../srv/common/wmStatus');
const { sapKey } = require('../../../srv/integration/s4hana/sapKey');
const { isToFullyConfirmed } = require('../../../srv/integration/s4hana/wm/toState');

const authorized = () => Object.assign(new Error('auth'), { key: 'USER_IS_AUTHORIZED' });

/** Fake CAP database: cds.ql queries resolve through cds.db.run; UPDATE payloads are recorded. */
async function withFakeDb(row, fn) {
  const cds = require('@sap/cds');
  const updates = [];
  const saved = cds.db;
  cds.db = {
    entities: () => ({ ReservationTrack: { name: 'ReservationTrack' }, ReservationLog: { name: 'ReservationLog' } }),
    run: jest.fn(async (q) => {
      if (q.SELECT) return typeof row === 'function' ? row() : row;
      if (q.UPDATE) { updates.push(q.UPDATE.data); return 1; }
      return 1;
    })
  };
  try { return await fn(updates); } finally { cds.db = saved; }
}
const HEADER = { LGNUM: 'W01', TBNUM: '0001001839', BWLVS: '311', RSNUM: '0000524979', NLTYP: '', NLPLA: '', VLTYP: '', VLPLA: '' };
const ITEM = (tbpos, matnr, menge, tamen) => ({ LGNUM: 'W01', TBNUM: '0001001839', TBPOS: tbpos, MATNR: matnr, WERKS: '1120', LGORT: 'HS01', CHARG: '', MENGE: menge, TAMEN: tamen, MEINS: 'KG', ELIKZ: '' });

/** Fake RFC routed by function module / table so call order does not matter. */
function fakeRfc({ fm = {}, tables = {} } = {}) {
  const rfc = {
    call: jest.fn(async (name, params) => {
      if (name === 'AUTHORITY_CHECK') throw authorized();
      const h = fm[name];
      if (!h) throw new Error(`unexpected FM ${name}`);
      return typeof h === 'function' ? h(params) : h;
    }),
    readTable: jest.fn(async (table, fields, where) => {
      const h = tables[table];
      return typeof h === 'function' ? h(where, fields) : (h || []);
    })
  };
  rfc.session = jest.fn(async (fn) => fn(rfc.call));
  return rfc;
}

describe('Fix 1: one status-code set [mock only, not SAP verification]', () => {
  it('seeds exactly the codes of wmStatus.js, with 90 = Goods Issue Error and 99 = Cancelled / Reversed', () => {
    const csv = fs.readFileSync(path.join(__dirname, '../../../db/data/saps4hana.wm-ReservationStatus.csv'), 'utf8').trim().split('\n').slice(1);
    const seeded = Object.fromEntries(csv.map((l) => { const [code, name, , crit] = l.split(';'); return [code, { name, crit: Number(crit) }]; }));
    expect(Object.keys(seeded).sort()).toEqual(Object.values(STATUS).sort());
    for (const code of Object.values(STATUS)) {
      expect(seeded[code].name).toBe(STATUS_TEXT[code]);
      expect(seeded[code].crit).toBe(STATUS_CRITICALITY[code]);
    }
    expect(STATUS.GI_ERROR).toBe('90');
    expect(STATUS_TEXT['99']).toBe('Cancelled / Reversed');
    expect(UNCONFIRMED_TO).toEqual(['03', '13']);
  });

  it('ABAP mirror constants carry the same values', () => {
    const abap = fs.readFileSync(path.join(__dirname, '../../../docs/abap/zcl_res_process.clas.abap'), 'utf8');
    for (const code of Object.values(STATUS)) expect(abap).toMatch(new RegExp(`gc_status_${code}\\s+TYPE zres_status VALUE '${code}'`));
    expect(abap).toMatch(/gc_status_99 .*Cancelled \/ Reversed/);
    expect(abap).toMatch(/iv_complete_res TYPE xfeld DEFAULT space/);
  });

  it('handler records 90 (not 99) when the goods movement fails', async () => {
    const handlers = {};
    TrToHandler.init({ on: (e, fn) => { handlers[e] = fn; } }, {
      adapter: {},
      resProcessAdapter: { checkAuthorization: jest.fn(), postGoodsMovement: jest.fn().mockRejectedValue(new Error('Posting period closed')) }
    });
    const res = await handlers.postMigoGoodsMovement({ data: { ReservationNo: '524979', MovementType: '311', Material: '8000000023', Plant: '1120', Quantity: 1, Unit: 'KG' } });
    expect(res.Status).toBe('90');
    expect(res.StatusText).toBe('Goods Issue Error');
    expect(res.ErrorStep).toBe('MIGO');
    expect(res.ProcessId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('Fix 2: NO_MORE_GR only with an explicit complete flag [mock only, not SAP verification]', () => {
  const post = async (extra) => {
    const rfc = fakeRfc({ fm: { BAPI_GOODSMVT_CREATE: { MATERIALDOCUMENT: '4900000001', MATDOCUMENTYEAR: '2026', RETURN: [] }, BAPI_TRANSACTION_COMMIT: {} } });
    await new ReservationProcessAdapter({ rfc }).postGoodsMovement({ reservationNo: '524979', movementType: '201', material: '8000000023', plant: '1120', quantity: 1, unit: 'KG', costCenter: '1011201301', ...extra });
    return rfc.call.mock.calls.find((c) => c[0] === 'BAPI_GOODSMVT_CREATE')[1].GOODSMVT_ITEM[0];
  };
  it('omits NO_MORE_GR by default and when the flag is falsy, keeps RESERV_NO/RES_ITEM', async () => {
    for (const extra of [{}, { completeReservation: false }, { completeReservation: 'X' }]) {
      const item = await post(extra);
      expect(item.NO_MORE_GR).toBeUndefined();
      expect(item).toMatchObject({ RESERV_NO: '0000524979', RES_ITEM: '0001' });
    }
  });
  it('sets NO_MORE_GR = X only when completeReservation === true', async () => {
    expect((await post({ completeReservation: true })).NO_MORE_GR).toBe('X');
  });
});

describe('Fix 3: no hardcoded warehouse / storage type / plant defaults [mock only, not SAP verification]', () => {
  it('TR header without destination: reads T333 (LGNUM + BWLVS) for NLTYP/NLPLA; source type/bin stay blank; never 921/TRANSFER/902 literals, never LQUA', async () => {
    const rfc = fakeRfc({
      fm: { Z_WM_GET_TR_MATERIAL_LIST: { ET_TR_HEADER: [HEADER], ET_TR_ITEMS: [ITEM('0001', '000000008000000023', '10.000', '0.000')] }, Z_WM_TO_CREATE_FROM_TR: { EV_SUCCESS: 'S', EV_TANUM: '0001012966' } },
      tables: { MAKT: [{ MAKTX: 'Mat' }], MARC: [{ XCHPF: '', SERNP: '' }], LTAK: [], T333: [{ NLTYP: '911', NLPLA: '' }], LQUA: [{ LGTYP: '902', LGPLA: 'X', CHARG: 'B1', VERME: '5' }] }
    });
    await new TrToAdapter({ rfc }).createTOFromTR({ tbnum: '1001839', qty: 1, autoConfirm: false });
    const item = rfc.call.mock.calls.find((c) => c[0] === 'Z_WM_TO_CREATE_FROM_TR')[1].IT_ITEMS[0];
    expect(item).toMatchObject({ NLTYP: '911', NLPLA: '', VLTYP: '', VLPLA: '', CHARG: '' }); // blank NLPLA = dynamic bin (T333 rows for 201/241)
    expect(rfc.readTable).toHaveBeenCalledWith('T333', ['NLTYP', 'NLPLA'], ["LGNUM = 'W01'", "AND BWLVS = '311'"], 1);
    expect(rfc.readTable).not.toHaveBeenCalledWith('LQUA', expect.anything(), expect.anything(), expect.anything());
  });

  it('TR header with destination: T333 is not read; no T333 row for a blank header: 400 and no TO create call', async () => {
    const withHeader = fakeRfc({
      fm: { Z_WM_GET_TR_MATERIAL_LIST: { ET_TR_HEADER: [{ ...HEADER, NLTYP: '921', NLPLA: 'TRANSFER' }], ET_TR_ITEMS: [ITEM('0001', '000000008000000023', '10.000', '0.000')] }, Z_WM_TO_CREATE_FROM_TR: { EV_SUCCESS: 'S', EV_TANUM: '0001012966' } },
      tables: { MAKT: [], MARC: [{ XCHPF: '', SERNP: '' }], LTAK: [], T333: [{ NLTYP: '999', NLPLA: 'WRONG' }] }
    });
    await new TrToAdapter({ rfc: withHeader }).createTOFromTR({ tbnum: '1001839', qty: 1, autoConfirm: false });
    expect(withHeader.call.mock.calls.find((c) => c[0] === 'Z_WM_TO_CREATE_FROM_TR')[1].IT_ITEMS[0]).toMatchObject({ NLTYP: '921', NLPLA: 'TRANSFER' });
    expect(withHeader.readTable).not.toHaveBeenCalledWith('T333', expect.anything(), expect.anything(), expect.anything());

    const noRow = fakeRfc({ fm: { Z_WM_GET_TR_MATERIAL_LIST: { ET_TR_HEADER: [HEADER], ET_TR_ITEMS: [ITEM('0001', '000000008000000023', '10.000', '0.000')] } }, tables: { MAKT: [], MARC: [{ XCHPF: '', SERNP: '' }], LTAK: [], T333: [] } });
    await expect(new TrToAdapter({ rfc: noRow }).createTOFromTR({ tbnum: '1001839', qty: 1, autoConfirm: false }))
      .rejects.toMatchObject({ status: 400, message: /No destination storage type in T333 for warehouse W01, WM movement type 311/ });
    expect(noRow.call).not.toHaveBeenCalledWith('Z_WM_TO_CREATE_FROM_TR', expect.anything());
  });

  it('resolves the warehouse from configuration when the caller sends none, and rejects an unconfigured one', async () => {
    const cds = require('@sap/cds');
    const rfc = fakeRfc({ fm: { Z_WM_GET_TR_MATERIAL_LIST: { ET_TR_HEADER: [HEADER], ET_TR_ITEMS: [] } }, tables: {} });
    await new TrToAdapter({ rfc }).getTR('1001839', '');
    expect(rfc.call).toHaveBeenCalledWith('Z_WM_GET_TR_MATERIAL_LIST', expect.objectContaining({ IV_LGNUM: cds.env.s4.warehouseNumber }));
    const saved = cds.env.s4.warehouseNumber;
    const savedEnv = process.env.S4_WAREHOUSE_NUMBER;
    delete process.env.S4_WAREHOUSE_NUMBER; delete process.env.CDS_S4_WAREHOUSE_NUMBER;
    cds.env.s4.warehouseNumber = '';
    try {
      await expect(new TrToAdapter({ rfc }).getTR('1001839', '')).rejects.toThrow(/Missing required S\/4HANA configuration: s4.warehouseNumber/);
    } finally {
      cds.env.s4.warehouseNumber = saved;
      if (savedEnv !== undefined) process.env.S4_WAREHOUSE_NUMBER = savedEnv;
    }
  });

  it('handler refuses a goods movement whose plant/movement type are neither in the request nor tracked', async () => {
    const handlers = {};
    const postGoodsMovement = jest.fn();
    TrToHandler.init({ on: (e, fn) => { handlers[e] = fn; } }, { adapter: {}, resProcessAdapter: { checkAuthorization: jest.fn(), postGoodsMovement } });
    await expect(handlers.postMigoGoodsMovement({ data: { TransferOrder: '1012966', Material: '8000000023', Quantity: 1, Unit: 'KG' } }))
      .rejects.toMatchObject({ status: 400, message: /MovementType is required/ });
    await expect(handlers.postMigoGoodsMovement({ data: { Material: '8000000023' } }))
      .rejects.toMatchObject({ status: 400, message: /ReservationNo or TransferOrder is required/ });
    expect(postGoodsMovement).not.toHaveBeenCalled();
  });
});

describe('Fix 4: batch tiers 1-3 only, batch-managed material without batch stops [mock only, not SAP verification]', () => {
  const base = { transferOrder: '1037284', movementType: '301', material: '8900000004', plant: '1120', storageLocation: 'CS01', receivingPlant: '1110', quantity: 1, unit: 'KG' };
  it('stops with 400 naming the sources checked when MARC-XCHPF = X and RESB/LTAP give no batch; LQUA is never read', async () => {
    const rfc = fakeRfc({ fm: {}, tables: { LTAP: [], RESB: [], MARC: [{ XCHPF: 'X' }], LQUA: [{ CHARG: 'GUESSED' }] } });
    await expect(new ReservationProcessAdapter({ rfc }).postGoodsMovement(base))
      .rejects.toMatchObject({ status: 400, message: /Batch is required for batch-managed material 8900000004 in plant 1120.*\(RESB\).*Transfer Order 1037284 \(LTAP\)/ });
    expect(rfc.readTable).not.toHaveBeenCalledWith('LQUA', expect.anything(), expect.anything(), expect.anything());
    expect(rfc.call).not.toHaveBeenCalledWith('BAPI_GOODSMVT_CREATE', expect.anything());
  });
  it('takes the batch from the confirmed TO (tier 3) and posts', async () => {
    const rfc = fakeRfc({ fm: { BAPI_GOODSMVT_CREATE: { MATERIALDOCUMENT: '4900000002', MATDOCUMENTYEAR: '2026', RETURN: [] }, BAPI_TRANSACTION_COMMIT: {} }, tables: { LTAP: [{ CHARG: 'INJW260001' }] } });
    const res = await new ReservationProcessAdapter({ rfc }).postGoodsMovement(base);
    expect(res.batch).toBe('INJW260001');
    expect(rfc.readTable).not.toHaveBeenCalledWith('MARC', expect.anything(), expect.anything(), expect.anything());
  });
  it('posts a non-batch-managed material without a batch', async () => {
    const rfc = fakeRfc({ fm: { BAPI_GOODSMVT_CREATE: { MATERIALDOCUMENT: '4900000003', MATDOCUMENTYEAR: '2026', RETURN: [] }, BAPI_TRANSACTION_COMMIT: {} }, tables: { LTAP: [], MARC: [{ XCHPF: '' }] } });
    const res = await new ReservationProcessAdapter({ rfc }).postGoodsMovement(base);
    expect(res.materialDocument).toBe('4900000003');
  });
});

describe('Fix 5: partial quantity and the unconfirmed-TO guard [mock only, not SAP verification]', () => {
  const tr = { ET_TR_HEADER: [HEADER], ET_TR_ITEMS: [ITEM('0001', '000000008000000023', '10.000', '4.000')] }; // 6 open after a first TO
  it('allows a second TO for the remaining quantity when the earlier TO is confirmed (LTAK KQUIT = X)', async () => {
    const rfc = fakeRfc({ fm: { Z_WM_GET_TR_MATERIAL_LIST: tr, Z_WM_TO_CREATE_FROM_TR: { EV_SUCCESS: 'S', EV_TANUM: '0001012967' }, L_TO_CONFIRM: {} },
      tables: { MAKT: [], MARC: [{ XCHPF: '', SERNP: '' }], LTAK: [{ TANUM: '0001012966', KQUIT: 'X' }], T333: [{ NLTYP: '921', NLPLA: 'TRANSFER' }] } });
    const res = await new TrToAdapter({ rfc }).createTOFromTR({ tbnum: '1001839', qty: 6, existingToNumber: '1012966', status: '04' });
    expect(res).toMatchObject({ TransferOrder: '1012967', Status: '04', Quantity: 6 });
    expect(rfc.readTable).not.toHaveBeenCalledWith('LTAP', expect.anything(), expect.anything());
  });
  it('blocks while an unconfirmed TO item (PQUIT blank) exists for the same TR item', async () => {
    const rfc = fakeRfc({ fm: { Z_WM_GET_TR_MATERIAL_LIST: tr },
      tables: { MAKT: [], MARC: [{ XCHPF: '', SERNP: '' }], LTAK: [{ TANUM: '0001012966', KQUIT: '' }], LTAP: [{ TAPOS: '0001', TBPOS: '0001' }] } });
    await expect(new TrToAdapter({ rfc }).createTOFromTR({ tbnum: '1001839', qty: 6 }))
      .rejects.toMatchObject({ status: 400, message: /Unconfirmed Transfer Order 1012966 exists for TR 1001839 item 0001/ });
    expect(rfc.call).not.toHaveBeenCalledWith('Z_WM_TO_CREATE_FROM_TR', expect.anything());
  });
  it('rejects more than the remaining open quantity', async () => {
    const rfc = fakeRfc({ fm: { Z_WM_GET_TR_MATERIAL_LIST: tr }, tables: { MAKT: [] } });
    await expect(new TrToAdapter({ rfc }).createTOFromTR({ tbnum: '1001839', qty: 7 })).rejects.toMatchObject({ status: 400, message: /exceeds open TR quantity \(6 KG\)/ });
  });
  it('handler retries confirm-only for a tracked 03/13 TO and creates a new TO for a tracked 04/05 one; each TO step has its own ProcessId', async () => {
    const calls = [];
    const adapter = { createTOFromTR: jest.fn(async (d) => { calls.push({ existingToNumber: d.existingToNumber, status: d.status }); return { TransferOrder: '1012967', Status: '04', Confirmed: true, TRItem: '0001' }; }) };
    const handlers = {};
    TrToHandler.init({ on: (e, fn) => { handlers[e] = fn; } }, { adapter, resProcessAdapter: {} });
    const rows = { '13': { TransferOrder: '1012966', Status_code: '13', ProcessId: 'P13', ReservationNo: '524979', ReservationItem: '0001' }, '04': { TransferOrder: '1012966', Status_code: '04', ProcessId: 'P04', ReservationNo: '524979', ReservationItem: '0001' } };
    for (const st of ['13', '04']) {
      const res = await withFakeDb(rows[st], () => handlers.createTOFromTR({ data: { tbnum: '1001839', qty: 1 }, user: { id: 'tester' }, error: jest.fn() }));
      if (st === '13') expect(res.ProcessId).toBe('P13');
      else { expect(res.ProcessId).toMatch(/^[0-9a-f-]{36}$/); expect(res.ProcessId).not.toBe('P04'); }
      expect(res.ConfirmedBy).toBe('tester');
    }
    expect(calls).toEqual([{ existingToNumber: '1012966', status: '13' }, { existingToNumber: undefined, status: undefined }]);
  });
});

describe('Fix 7: strict input validation before RFC filters [mock only, not SAP verification]', () => {
  it.each([
    ['tbnum', "1' OR '1"], ['tbnum', '12345678901'], ['matnr', "X' OR 1=1"], ['batch', 'B1 OR'], ['plant', '11201'], ['lgort', "HS'"], ['mvt', '31'], ['uuid', 'not-a-uuid'], ['lgnum', 'W 01']
  ])('rejects %s = %j with 400', (field, value) => {
    expect(() => sapKey(value, field)).toThrow(expect.objectContaining({ status: 400 }));
  });
  it('accepts and normalises valid keys', () => {
    expect(sapKey(' hs01 ', 'lgort')).toBe('HS01');
    expect(sapKey('8000000023', 'matnr')).toBe('8000000023');
  });
});

describe('Fix 9: goods-movement retry guard by PROCESS_ID [mock only, not SAP verification]', () => {
  const pid = '7f3e2a10-1111-4222-8333-444455556666';
  const base = { reservationNo: '524979', movementType: '201', material: '8000000023', plant: '1120', quantity: 1, unit: 'KG', costCenter: '1011201301', processId: pid };
  it('does not post again when MATDOC already holds a non-cancelled document with this PROCESS_ID in SGTXT', async () => {
    const rfc = fakeRfc({ fm: {}, tables: { MATDOC: (where) => (where.some((w) => w.includes(pid.toUpperCase())) ? [{ MBLNR: '4900050147', MJAHR: '2026' }] : []) } });
    const res = await new ReservationProcessAdapter({ rfc }).postGoodsMovement(base);
    expect(res).toMatchObject({ success: true, alreadyPosted: true, materialDocument: '4900050147', materialDocYear: '2026', processId: pid.toUpperCase() });
    expect(rfc.readTable).toHaveBeenCalledWith('MATDOC', ['MBLNR', 'MJAHR'], expect.arrayContaining([`SGTXT = '${pid.toUpperCase()}'`, "AND CANCELLED = ''", "AND REVERSAL_MOVEMENT = ''"]), 1);
    expect(rfc.call).not.toHaveBeenCalledWith('BAPI_GOODSMVT_CREATE', expect.anything());
  });
  it('does not post again when MATDOC holds document matching reservation even if SGTXT is blank (SAP standard reservation behavior)', async () => {
    const rfc = fakeRfc({ fm: {}, tables: { MATDOC: (where) => (where.some((w) => w.includes("RSNUM = '0000524979'")) ? [{ MBLNR: '4900050148', MJAHR: '2026' }] : []) } });
    const res = await new ReservationProcessAdapter({ rfc }).postGoodsMovement(base);
    expect(res).toMatchObject({ success: true, alreadyPosted: true, materialDocument: '4900050148', materialDocYear: '2026' });
    expect(rfc.call).not.toHaveBeenCalledWith('BAPI_GOODSMVT_CREATE', expect.anything());
  });
  it('posts with the full 36-character PROCESS_ID in ITEM_TEXT (SGTXT CHAR 50), never truncated', async () => {
    const rfc = fakeRfc({ fm: { BAPI_GOODSMVT_CREATE: { MATERIALDOCUMENT: '4900000009', MATDOCUMENTYEAR: '2026', RETURN: [] }, BAPI_TRANSACTION_COMMIT: {} }, tables: { MATDOC: [], RESB: [], MARC: [{ XCHPF: '' }] } });
    await new ReservationProcessAdapter({ rfc }).postGoodsMovement(base);
    const item = rfc.call.mock.calls.find((c) => c[0] === 'BAPI_GOODSMVT_CREATE')[1].GOODSMVT_ITEM[0];
    expect(item.ITEM_TEXT).toBe(pid.toUpperCase());
    expect(item.ITEM_TEXT).toHaveLength(36);
  });
  it('handler persists the ProcessId on the tracking row before posting and reuses it on retry', async () => {
    const postGoodsMovement = jest.fn().mockResolvedValue({ materialDocument: '4900000010', materialDocYear: '2026', stockEffect: 'x' });
    const handlers = {};
    TrToHandler.init({ on: (e, fn) => { handlers[e] = fn; } }, { adapter: {}, resProcessAdapter: { checkAuthorization: jest.fn(), postGoodsMovement } });
    const track = { ReservationNo: '524979', ReservationItem: '0001', MovementType: '201', Material: '8000000023', Plant: '1120', Quantity: 1, Unit: 'KG', ProcessId: null };
    const { res, updates } = await withFakeDb(track, async (updates) => ({ res: await handlers.postMigoGoodsMovement({ data: { ReservationNo: '524979' } }), updates }));
    expect(updates[0]).toEqual({ ProcessId: res.ProcessId });
    expect(postGoodsMovement).toHaveBeenCalledWith(expect.objectContaining({ processId: res.ProcessId }));
    expect(updates[1]).toMatchObject({ Status_code: '05', MaterialDocument: '4900000010' });

    postGoodsMovement.mockClear();
    await withFakeDb({ ...track, ProcessId: res.ProcessId }, () => handlers.postMigoGoodsMovement({ data: { ReservationNo: '524979' } }));
    expect(postGoodsMovement).toHaveBeenCalledWith(expect.objectContaining({ processId: res.ProcessId }));
  });
});

describe('Fix 10 + 11: explicit document type and TR item choice [mock only, not SAP verification]', () => {
  const twoItems = { ET_TR_HEADER: [HEADER], ET_TR_ITEMS: [ITEM('0001', '000000008000000023', '10.000', '0.000'), ITEM('0002', '000000008000000024', '3.000', '0.000')] };
  it('lookupTR requires docType and never falls back from TR to reservation', async () => {
    const rfc = fakeRfc({ fm: { Z_WM_GET_TR_MATERIAL_LIST: { ET_TR_HEADER: [], ET_TR_ITEMS: [] } }, tables: { RKPF: [{ RSNUM: '0000524979' }] } });
    const a = new TrToAdapter({ rfc });
    await expect(a.lookupTR('524979', 'W01')).rejects.toMatchObject({ status: 400 });
    await expect(a.lookupTR('524979', 'W01', 'TR')).rejects.toMatchObject({ status: 404, message: 'Transfer Requirement 524979 not found in warehouse W01' });
    expect(rfc.readTable).not.toHaveBeenCalledWith('RKPF', expect.anything(), expect.anything());
    expect(rfc.call).not.toHaveBeenCalledWith('Z_WM_GET_TR_MATERIAL_LIST', expect.objectContaining({ IV_RESERVATION: expect.anything() }));
  });
  it('a reservation with no TR is a backend issue (status 11), read from LTBK-RSNUM', async () => {
    const rfc = fakeRfc({ fm: {}, tables: { LTBK: [] } });
    await expect(new TrToAdapter({ rfc }).lookupTR('525866', 'W01', 'RES'))
      .rejects.toMatchObject({ status: 404, message: /Reservation 525866 has no open Transfer Requirement in warehouse W01 \(status 11 TR error, backend issue\)/ });
    expect(rfc.readTable).toHaveBeenCalledWith('LTBK', ['TBNUM', 'STATU'], ["LGNUM = 'W01'", "AND RSNUM = '0000525866'"]);
  });
  it('a reservation with one open TR resolves to that TR', async () => {
    const rfc = fakeRfc({ fm: { Z_WM_GET_TR_MATERIAL_LIST: { ET_TR_HEADER: [HEADER], ET_TR_ITEMS: [ITEM('0001', '000000008000000023', '1.000', '0.000')] } }, tables: { LTBK: [{ TBNUM: '0001001839', STATU: '' }, { TBNUM: '0001001000', STATU: 'E' }], MAKT: [], MARC: [] } });
    const d = await new TrToAdapter({ rfc }).lookupTR('525866', 'W01', 'RES');
    expect(d.TransferRequirement).toBe('1001839');
    expect(d.TRItem).toBe('0001');
  });
  it('a TR with several open items returns them all and no selected item until tbpos is given', async () => {
    const rfc = fakeRfc({ fm: { Z_WM_GET_TR_MATERIAL_LIST: twoItems }, tables: { MAKT: [{ MAKTX: 'd' }], MARC: [{ XCHPF: '', SERNP: '' }] } });
    const a = new TrToAdapter({ rfc });
    const d = await a.lookupTR('1001839', 'W01', 'TR');
    expect(d.TRItem).toBe('');
    expect(d.Items.map((i) => i.Tbpos)).toEqual(['0001', '0002']);
    const d2 = await a.lookupTR('1001839', 'W01', 'TR', '2');
    expect(d2).toMatchObject({ TRItem: '0002', Material: '8000000024', OpenQty: 3 });
    await expect(a.lookupTR('1001839', 'W01', 'TR', '0003')).rejects.toMatchObject({ status: 400, message: /no open item 0003/ });
    await expect(a.createTOFromTR({ tbnum: '1001839', qty: 1 })).rejects.toMatchObject({ status: 400, message: /2 open items \(0001, 0002\); choose one/ });
  });
});

describe('Fix 13: confirmation state read from LTAP-PQUIT, not from message 055 [mock only, not SAP verification]', () => {
  it('isToFullyConfirmed is true only when every item carries PQUIT = X', async () => {
    const rows = { all: [{ TAPOS: '0001', PQUIT: 'X' }, { TAPOS: '0002', PQUIT: 'X' }], partial: [{ TAPOS: '0001', PQUIT: 'X' }, { TAPOS: '0002', PQUIT: '' }], none: [], undef: undefined };
    for (const [k, v] of Object.entries(rows)) {
      const rfc = { readTable: jest.fn().mockResolvedValue(v) };
      expect(await isToFullyConfirmed(rfc, 'W01', '1012966')).toBe(k === 'all');
      expect(rfc.readTable).toHaveBeenCalledWith('LTAP', ['TAPOS', 'PQUIT'], ["LGNUM = 'W01'", "AND TANUM = '0001012966'"]);
    }
  });
  it('treats a rejected L_TO_CONFIRM as success only when LTAP shows the TO confirmed; a message containing 055 is not enough', async () => {
    const sapError = () => new Error('L_TO_CONFIRM: TO_CONFIRMED L3 055 already confirmed');
    const confirmed = fakeRfc({ fm: { L_TO_CONFIRM: () => { throw sapError(); } }, tables: { LTAP: [{ TAPOS: '0001', PQUIT: 'X' }] } });
    await expect(new TrToAdapter({ rfc: confirmed }).confirmTO({ lgnum: 'W01', toNumber: '1012966' })).resolves.toMatchObject({ Confirmed: true });
    const open = fakeRfc({ fm: { L_TO_CONFIRM: () => { throw sapError(); } }, tables: { LTAP: [{ TAPOS: '0001', PQUIT: '' }] } });
    await expect(new TrToAdapter({ rfc: open }).confirmTO({ lgnum: 'W01', toNumber: '1012966' })).rejects.toThrow(/055 already confirmed/);
    const openRpa = fakeRfc({ fm: { L_TO_CONFIRM: () => { throw sapError(); } }, tables: { LTAP: [] } });
    await expect(new ReservationProcessAdapter({ rfc: openRpa }).confirmTransferOrder({ warehouseNumber: 'W01', toNumber: '1012966' })).rejects.toThrow(/055/);
  });
});
