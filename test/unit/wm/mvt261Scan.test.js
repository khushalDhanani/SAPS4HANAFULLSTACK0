/**
 * 261 scan screen, stage 1 (scan and validate only): acceptance cases T1-T7 and the no-write guarantee.
 * SAP rows are the ones read live on 2026-10-06 (RFC_READ_TABLE), trimmed to the fields the code reads.
 */
const fs = require('fs');
const path = require('path');
const Mvt261Adapter = require('../../../srv/integration/s4hana/wm/Mvt261Adapter');

let ScanSession;
global.sap = { ui: { define: (_deps, factory) => { ScanSession = factory(); } } };
require('../../../app/fiori-app/webapp/modules/wm/mvt261/model/ScanSession');

const NOT_READY = [{ storageType: 'OH1', bin: 'ONHOLD', reason: 'onHold' }, { storageType: '901', bin: 'WE-ZONE', reason: 'goodsReceiptZone' }];
const quant = (LENUM, MATNR, WERKS, LGORT, LGNUM, LGTYP, LGPLA, CHARG, VERME, over = {}) => ({
  LENUM: LENUM.padStart(20, '0'), MATNR: MATNR.padStart(18, '0'), WERKS, LGORT, LGNUM, LGTYP, LGPLA, CHARG, VERME, EINME: '0.000', AUSME: '0.000', MEINS: 'KG', BESTQ: '', WDATU: '20260912',
  SKZUA: '', SKZUE: '', SKZSA: '', SKZSE: '', SKZSI: '', SPGRU: '', ...over
});
const LQUA = [
  ...['2000018193', '2000018194', '2000018195', '2000018196'].map((su) => quant(su, '1000001001', '1130', 'CS02', 'W12', 'IP1', '0001002707', 'INHU100005', '200.000')),
  quant('2000018001', '1000001001', '1130', 'CS02', 'W12', 'IP1', '0001002707', 'INHU100005', '200.000'), // fifth drum for the over-quantity case (constructed)
  quant('1000053753', '8400000034', '1600', 'CS01', 'W01', 'GS1', '0002000589', 'PTRA260007', '120.000'),
  quant('1000053758', '8400000034', '1600', 'CS01', 'W01', 'GS1', '0002000589', 'PTRA260008', '380.000'),
  quant('1000053755', '8400000034', '1600', 'CS01', 'W01', 'GS1', 'TRANSFER', 'PTRA260009', '400.000'),
  quant('2000019210', '1000001003', '1130', 'CS02', 'W12', 'OH1', 'ONHOLD', 'IN26092256', '250.000'),
  quant('2000019211', '1000001003', '1130', 'CS02', 'W12', 'OH1', 'ONHOLD', 'IN26092256', '250.000'),
  quant('1000033499', '8300000159', '1130', 'CS01', 'W12', 'FG1', '0-L0001-00', 'IN25002833', '200.000')
];
const resb = (RSNUM, RSPOS, AUFNR, MATNR, WERKS, LGORT, BDMNG, ENMNG) => ({
  RSNUM: RSNUM.padStart(10, '0'), RSPOS: RSPOS.padStart(4, '0'), AUFNR: AUFNR.padStart(12, '0'), MATNR: MATNR.padStart(18, '0'), WERKS, LGORT,
  CHARG: '', BDTER: '20261006', BDMNG, ENMNG, MEINS: 'KG', XLOEK: '', KZEAR: '', XWAOK: 'X'
});
const RESB = [
  resb('512851', '3', '1002707', '1000001001', '1130', 'CS02', '800.000', '0.000'),
  resb('471327', '1', '2000589', '8400000034', '1600', 'CS01', '500.000', '0.000'),
  resb('519944', '1', '1002760', '1000001003', '1130', 'CS02', '600.000', '0.000'),
  resb('24685', '2', '1000109', '8300000159', '1130', 'CS01', '510.000', '509.000'),
  resb('375064', '7', '1001944', '1000000236', '2100', 'CS01', '1335.000', '0.000'),
  resb('700000', '1', '1002799', '5555555555', '1130', 'CS02', '600.000', '0.000') // constructed item for the FIFO cases
];
const LOCKED = '000001000109';

/** RFC double: answers RFC_READ_TABLE reads from the rows above and records every read. Has no write method at all. */
function sap(extraQuants = []) {
  const reads = [];
  const val = (where, field) => (new RegExp(`${field} = '([^']*)'`).exec(where.join(' ')) || [])[1];
  const readTable = async (table, _fields, where) => {
    reads.push(table);
    const w = where.join(' ');
    if (table === 'RESB') return RESB.filter((r) => r.RSNUM === val(where, 'RSNUM') && r.RSPOS === val(where, 'RSPOS'));
    if (table === 'AUFK') return [{ AUFNR: val(where, 'AUFNR'), AUART: 'ZP01', LOEKZ: '' }];
    if (table === 'JEST') return RESB.filter((r) => w.includes(`OR${r.AUFNR}`)).flatMap((r) => [{ OBJNR: `OR${r.AUFNR}`, STAT: 'I0002' }, ...(r.AUFNR === LOCKED ? [{ OBJNR: `OR${r.AUFNR}`, STAT: 'I0043' }] : [])]);
    if (table === 'LQUA') {
      const all = [...LQUA, ...extraQuants];
      if (val(where, 'LENUM')) return all.filter((q) => q.LENUM === val(where, 'LENUM'));
      if (val(where, 'MATNR')) return all.filter((q) => q.MATNR === val(where, 'MATNR') && q.WERKS === val(where, 'WERKS'));
      return all.filter((q) => q.LENUM && (!val(where, 'WERKS') || q.WERKS === val(where, 'WERKS'))); // all storage-unit quants
    }
    if (table === 'MAKT') return [{ MAKTX: 'Test material' }];
    if (table === 'MARC') return [{ XCHPF: 'X' }];
    if (table === 'MARD') return [{ LGORT: val(where, 'LGORT') || 'CS01', LABST: '99999.000' }];
    return [];
  };
  const http = [];
  const client = { get: async (p) => { http.push(`GET ${p}`); throw new Error('unexpected HTTP read'); }, post: async (p) => { http.push(`POST ${p}`); throw new Error('write attempted'); } };
  return { adapter: new Mvt261Adapter({ rfc: { readTable }, client, notReadyBins: NOT_READY }), reads, http };
}

/** Drives the screen's flow the way the controller does: precheck, SAP check, session update. */
async function screen(reservation, item, extraQuants) {
  const s = sap(extraQuants);
  const ctx = await s.adapter.scanContext({ reservation, item });
  let rows = [];
  const scan = async (unit) => {
    const pre = ScanSession.precheck(ctx, rows, unit);
    if (pre) return pre;
    const next = ScanSession.add(ctx, rows, await s.adapter.checkStorageUnit({ reservation, item, storageUnit: unit }));
    rows = next.rows;
    return next.rejection;
  };
  return { ...s, ctx, scan, rows: () => rows, total: () => ScanSession.total(rows), state: () => ScanSession.state(ctx, rows), set: (i, v) => { rows = ScanSession.setQuantity(ctx, rows, i, v); }, remove: (i) => { rows = ScanSession.remove(rows, i); } };
}

describe('261 scan screen, stage 1', () => {
  it('T1: 512851/3 - four 200 KG drums reach 800/800 and "Quantity covered"; a fifth scan is rejected as over-quantity', async () => {
    const s = await screen('512851', '3');
    expect(s.ctx).toMatchObject({ OpenQuantity: 800, OrderStatus: 'REL', Blocked: false, BatchManaged: true, StorageUnitQuantCount: 5 });
    expect(s.state()).toBe('Loaded');
    for (const su of ['2000018193', '2000018194', '2000018195']) expect(await s.scan(su)).toBeNull();
    expect([s.total(), s.state()]).toEqual([600, 'Scanning']);
    expect(await s.scan('2000018196')).toBeNull();
    expect([s.total(), ScanSession.drums(s.rows()), s.state()]).toEqual([800, 4, 'Covered']);
    expect(s.rows().every((r) => r.Accepted && r.Batch === 'INHU100005' && r.StorageBin === '0001002707' && r.Warnings.length === 0)).toBe(true);
    const lookups = s.reads.filter((t) => t === 'LQUA').length;
    expect(await s.scan('2000018001')).toMatchObject({ Reason: 'openCovered' });
    expect(s.reads.filter((t) => t === 'LQUA').length).toBe(lookups); // rejected without a lookup
    expect([s.total(), s.rows().length]).toEqual([800, 4]);
  });

  it('T2: the same storage unit scanned twice is rejected the second time', async () => {
    const s = await screen('512851', '3');
    expect(await s.scan('2000018193')).toBeNull();
    expect(await s.scan('00000000002000018193')).toMatchObject({ Reason: 'alreadyScanned', Value1: '2000018193' });
    expect(s.rows()).toHaveLength(1);
  });

  it('T3: 471327/1 - 120 KG + 380 KG, each row with its own batch, total 500', async () => {
    const s = await screen('471327', '1');
    expect(await s.scan('1000053753')).toBeNull();
    expect(await s.scan('1000053758')).toBeNull();
    expect(s.rows().map((r) => [r.StorageUnit, r.Batch, r.Quantity])).toEqual([['1000053753', 'PTRA260007', 120], ['1000053758', 'PTRA260008', 380]]);
    expect([s.total(), s.state()]).toEqual([500, 'Covered']);
  });

  it('T4: 519944/1 - drums in OH1/ONHOLD are rejected with the on-hold reason; quantity is never covered', async () => {
    const s = await screen('519944', '1');
    for (const su of ['2000019210', '2000019211']) expect(await s.scan(su)).toEqual({ Reason: 'onHold', Value1: 'OH1', Value2: 'ONHOLD' });
    expect(s.rows().map((r) => r.Accepted)).toEqual([false, false]);
    expect([s.total(), s.state()]).toEqual([0, 'Scanning']);
  });

  it('T5: 24685/2 - locked order: page context shows the reason, scans are refused, zero storage-unit lookups', async () => {
    const s = await screen('24685', '2');
    expect(s.ctx).toMatchObject({ Blocked: true, BlockReason: 'order is locked', OpenQuantity: 1, OrderStatus: 'LKD REL' });
    expect(s.state()).toBe('Blocked');
    const before = s.reads.length;
    expect(await s.scan('1000033499')).toMatchObject({ Reason: 'itemBlocked', Value1: 'order is locked' });
    expect(s.reads.length).toBe(before); // the screen issued no lookup at all
    // The service refuses as well, before reading LQUA by storage unit.
    const direct = sap();
    await expect(direct.adapter.checkStorageUnit({ reservation: '24685', item: '2', storageUnit: '1000033499' })).resolves.toMatchObject({ Accepted: false, Reason: 'itemBlocked', Value1: 'order is locked' });
    expect(direct.reads).not.toContain('LQUA');
  });

  it('T6: a storage unit of another material or plant, an unknown one, and a non-number are rejected', async () => {
    const s = await screen('512851', '3');
    expect(await s.scan('1000053753')).toEqual({ Reason: 'wrongMaterialOrPlant', Value1: '8400000034 / 1600', Value2: '1000001001 / 1130' });
    expect(await s.scan('9999999999')).toMatchObject({ Reason: 'notFound' });
    expect(await s.scan(']C100123')).toMatchObject({ Reason: 'invalidNumber' });
    expect(s.total()).toBe(0);
  });

  it('T7: a drum outside the order bin is accepted with a bin warning; a different storage location warns too', async () => {
    const s = await screen('471327', '1', [quant('1000099999', '8400000034', '1600', 'PT01', 'W01', 'GS1', '0002000589', 'PTRA260012', '50.000')]);
    expect(await s.scan('1000053755')).toBeNull();
    expect(s.rows()[0]).toMatchObject({ Accepted: true, StorageBin: 'TRANSFER', Quantity: 400, Warnings: ['notInOrderBin'] });
    expect(await s.scan('1000099999')).toBeNull();
    expect(s.rows()[1]).toMatchObject({ Accepted: true, StorageLocation: 'PT01', Warnings: ['storageLocationDiffers'] });
  });

  it('R3: block flags and pending transfer-order quantity reject, naming the cause', async () => {
    const s = await screen('512851', '3', [
      quant('3000000001', '1000001001', '1130', 'CS02', 'W12', 'IP1', '0001002707', 'B1', '200.000', { SKZUA: 'X', SPGRU: '1' }),
      quant('3000000002', '1000001001', '1130', 'CS02', 'W12', 'IP1', '0001002707', 'B1', '200.000', { AUSME: '50.000' }),
      quant('3000000003', '1000001001', '1130', 'CS02', 'W12', '901', 'WE-ZONE', 'B1', '200.000'),
      quant('3000000004', '1000001001', '1130', 'CS02', 'W12', 'IP1', '0001002707', 'B1', '0.000')
    ]);
    expect(await s.scan('3000000001')).toEqual({ Reason: 'blocked', Value1: 'SKZUA=X, SPGRU=1', Value2: '' });
    expect(await s.scan('3000000002')).toEqual({ Reason: 'inTransferOrder', Value1: '50 KG', Value2: 'AUSME' });
    expect(await s.scan('3000000003')).toEqual({ Reason: 'goodsReceiptZone', Value1: '901', Value2: 'WE-ZONE' });
    expect(await s.scan('3000000004')).toMatchObject({ Reason: 'noStock' });
  });

  it('R6: quantity defaults to the quant, is capped at the remaining open quantity, and edits are capped at both', async () => {
    const s = await screen('471327', '1');
    await s.scan('1000053755'); // 400 KG drum, 500 open
    await s.scan('1000053758'); // 380 KG drum, only 100 left
    expect(s.rows().map((r) => [r.Quantity, r.MaxQuantity])).toEqual([[400, 400], [100, 380]]);
    s.set(0, 150);
    expect(s.total()).toBe(250);
    s.set(1, 999); // capped at the quant (380) and at what is open (500 - 150 = 350)
    expect(s.rows()[1].Quantity).toBe(350);
    s.set(0, 999); // capped at the quant (400) and at what is open (500 - 350 = 150)
    expect(s.rows()[0].Quantity).toBe(150);
    s.set(0, 0); s.set(0, 'abc'); // invalid edits leave the row unchanged
    expect([s.rows()[0].Quantity, s.state()]).toEqual([150, 'Covered']);
    s.remove(0);
    expect([s.total(), s.state()]).toEqual([350, 'Scanning']);
  });

  it('R10: material with quants but none on a storage unit is reported by the page context', async () => {
    const s = sap([quant('', '8300000159', '1130', 'CS01', 'W12', '901', 'WE-ZONE', 'IN25002734', '500.000', { LENUM: '' })]);
    const ctx = await s.adapter.scanContext({ reservation: '24685', item: '2' });
    expect(ctx).toMatchObject({ QuantCount: 2, StorageUnitQuantCount: 1 });
  });

  it('scanning path reads RFC tables only and sends no HTTP write during scan validation', async () => {
    for (const [r, i, units] of [['512851', '3', ['2000018193', '9999999999']], ['519944', '1', ['2000019210']], ['24685', '2', ['1000033499']]]) {
      const s = await screen(r, i);
      for (const u of units) await s.scan(u);
      expect(s.http).toEqual([]); // the double throws on any HTTP call and has no RFC function-call method
    }
  });

  it('Stage 2 UI has post button, onPost handler, and CAP postGoodsIssue action with idempotency guard', () => {
    const mod = path.join(__dirname, '../../../app/fiori-app/webapp/modules/wm/mvt261');
    const viewSrc = fs.readFileSync(path.join(mod, 'view/Scan261.view.xml'), 'utf8');
    expect(viewSrc).toContain('id="scan261Post"');
    expect(viewSrc).toContain('press=".onPost"');

    const ctrlSrc = fs.readFileSync(path.join(mod, 'controller/Scan261.controller.js'), 'utf8');
    expect(ctrlSrc).toContain('onPost: function');
    expect(ctrlSrc).toContain('/postGoodsIssue');

    const cdsSrc = fs.readFileSync(path.join(__dirname, '../../../srv/wm/mvt261/service.cds'), 'utf8');
    expect(cdsSrc).toContain('action postGoodsIssue');

    const svcSrc = fs.readFileSync(path.join(__dirname, '../../../srv/wm/mvt261/service.js'), 'utf8');
    expect(svcSrc).toContain("this.on('postGoodsIssue'");
    expect(svcSrc).toContain('createOrGet'); // atomic idempotency claim (F3)
  });
});

describe('open 261 list: only where scanning is possible', () => {
  const item = (Reservation, ReservationItem, OrderID, Product, Plant, required, withdrawn) => ({
    Reservation, ReservationItem, OrderID, Product, Plant, StorageLocation: 'CS02', MatlCompRequirementDate: '/Date(1791158400000)/',
    ResvnItmRequiredQtyInBaseUnit: required, ResvnItmWithdrawnQtyInBaseUnit: withdrawn, BaseUnit: 'KG', GoodsMovementIsAllowed: true
  });
  const list = (input) => {
    const s = sap();
    // The list rows all sit in CS02; make it warehouse-managed so readiness is counted per warehouse
    // (the scan-screen rule), exactly as the open list now does.
    const orig = s.adapter.rfc.readTable;
    s.adapter.rfc.readTable = async (table, fields, where) => (table === 'T320' ? [{ LGORT: 'CS02', LGNUM: 'W12' }] : orig(table, fields, where));
    s.adapter.client.get = async () => ({ data: { d: { __count: '4', results: [
      item('512851', '3', '1002707', '1000001001', '1130', '800.000', '0.000'), // released, 5 ready drums
      item('519944', '1', '1002760', '1000001003', '1130', '600.000', '0.000'), // released, drums only on hold
      item('24685', '2', '1000109', '8300000159', '1130', '510.000', '509.000'), // order locked, 1 ready drum
      item('900000', '1', '1002707', '7777777777', '1130', '10.000', '0.000') // released, no storage-unit stock
    ] } } });
    return s.adapter.openItems(input);
  };

  it('flags every item and, on request, returns only those the scan page would accept scans for', async () => {
    const all = await list({});
    expect(all.Items.map((i) => [i.Reservation, i.ScanPossible, i.ReadyStorageUnits, i.ReadyQuantity])).toEqual([
      ['512851', true, 5, 1000], ['519944', false, 0, 0], ['24685', false, 1, 200], ['900000', false, 0, 0]
    ]);
    const only = await list({ scanPossibleOnly: true });
    expect(only).toMatchObject({ TotalCount: 1, SapOpenCount: 4 });
    expect(only.Items.map((i) => i.Reservation)).toEqual(['512851']);
  });

  it('fails instead of showing an empty list when readiness cannot be read', async () => {
    const s = sap();
    s.adapter.client.get = async () => ({ data: { d: { __count: '1', results: [item('512851', '3', '1002707', '1000001001', '1130', '800.000', '0.000')] } } });
    s.adapter.rfc.readTable = async () => { throw Object.assign(new Error('RFC connection not configured'), { status: 503 }); };
    await expect(s.adapter.openItems({ scanPossibleOnly: true })).rejects.toMatchObject({ status: 503 });
    await expect(s.adapter.openItems({})).resolves.toMatchObject({ TotalCount: 1 });
  });
});

describe('261 scan screen: FIFO list and FIFO check', () => {
  // Constructed storage units for the constructed item 700000/1 (600 KG open): no real item offers these combinations.
  const fifo = (su, date, over) => quant(su, '5555555555', '1130', 'CS02', 'W12', 'IP1', '0001002799', 'B1', '200.000', { WDATU: date, ...over });
  const UNITS = [
    fifo('4000000003', '20260301'), fifo('4000000001', '20260101'), fifo('4000000004', '20260401'), fifo('4000000002', '20260201'),
    fifo('4000000005', '20260401', { CHARG: 'A9' }), // same date as ...04, earlier batch
    fifo('4000000010', '20251201', { SKZUA: 'X' }), // oldest, but blocked
    fifo('4000000011', '20251101', { LGTYP: 'OH1', LGPLA: 'ONHOLD' }), // older still, on hold
    fifo('4000000012', '20251001', { BESTQ: 'Q' }), // quality stock
    fifo('4000000013', '00000000'), // no goods-receipt date
    quant('', '5555555555', '1130', 'CS02', 'W12', '901', 'WE-ZONE', 'B2', '500.000', { LENUM: '' })
  ];

  it('lists storage units oldest first (date, batch, unit), with status, age and the suggested pick list', async () => {
    const s = await screen('700000', '1', UNITS);
    expect(s.ctx.Units.map((u) => [u.Rank, u.StorageUnit, u.GoodsReceiptDate, u.Status, u.Suggested])).toEqual([
      [1, '4000000012', '2025-10-01', 'Blocked', false],
      [2, '4000000011', '2025-11-01', 'OnHold', false],
      [3, '4000000010', '2025-12-01', 'Blocked', false],
      [4, '4000000001', '2026-01-01', 'Available', true],
      [5, '4000000002', '2026-02-01', 'Available', true],
      [6, '4000000003', '2026-03-01', 'Available', true],
      [7, '4000000005', '2026-04-01', 'Available', false],
      [8, '4000000004', '2026-04-01', 'Available', false],
      [9, '4000000013', null, 'Available', false]
    ]);
    expect(s.ctx.Units[0]).toMatchObject({ Reason: 'stockCategory', Value1: 'Q' });
    expect(s.ctx.Units[3].AgeDays).toBeGreaterThan(0);
    expect(s.ctx.Units[8].AgeDays).toBeNull();
    expect(s.ctx).toMatchObject({ NoUnitQuantCount: 1, NoUnitQuantity: 500 });
  });

  it('scanning the oldest available unit gives no FIFO warning and ticks it in the list', async () => {
    const s = await screen('700000', '1', UNITS);
    expect(await s.scan('4000000001')).toBeNull();
    expect(s.rows()[0]).toMatchObject({ Accepted: true, FifoDeviation: false, Batch: 'B1', Quantity: 200 });
    expect(ScanSession.deviations(s.rows())).toBe(0);
    expect(ScanSession.units(s.ctx, s.rows()).filter((u) => u.DisplayStatus === 'Scanned').map((u) => u.StorageUnit)).toEqual(['4000000001']);
  });

  it('scanning a newer unit first is accepted with a FIFO warning naming the older one; same-day and undated units do not warn', async () => {
    const s = await screen('700000', '1', UNITS);
    expect(await s.scan('4000000003')).toBeNull();
    expect(s.rows()[0]).toMatchObject({ Accepted: true, FifoDeviation: true, OlderUnit: '4000000001', OlderDate: '2026-01-01', OlderQuantity: 200 });
    expect(await s.scan('4000000001')).toBeNull(); // now the oldest
    expect(s.rows()[1].FifoDeviation).toBe(false);
    expect(ScanSession.deviations(s.rows())).toBe(1);
    const t = await screen('700000', '1', UNITS.filter((q) => !['20260101', '20260201', '20260301'].includes(q.WDATU)));
    await t.scan('4000000004'); // 4000000005 has the same date
    await t.scan('4000000013'); // no date
    expect(t.rows().map((r) => r.FifoDeviation)).toEqual([false, false]);
  });

  it('duplicate, over-quantity, blocked, on-hold and quality-stock units are rejected', async () => {
    const s = await screen('700000', '1', UNITS);
    expect(await s.scan('4000000010')).toMatchObject({ Reason: 'blocked', Value1: 'SKZUA=X' });
    expect(await s.scan('4000000011')).toMatchObject({ Reason: 'onHold' });
    expect(await s.scan('4000000012')).toEqual({ Reason: 'stockCategory', Value1: 'Q', Value2: '' });
    for (const su of ['4000000001', '4000000002', '4000000003']) expect(await s.scan(su)).toBeNull();
    expect(await s.scan('4000000002')).toMatchObject({ Reason: 'alreadyScanned' });
    expect([s.total(), s.state()]).toEqual([600, 'Covered']);
    expect(await s.scan('4000000004')).toMatchObject({ Reason: 'openCovered' });
    expect(s.http).toEqual([]);
  });

  it('375064/7 as read live: one storage unit in quality stock without a date, staged stock has no storage unit', async () => {
    const s = await screen('375064', '7', [
      quant('1000032202', '1000000236', '2100', 'CS01', 'W26', 'RM1', '0-L0001-00', 'IN25000346', '10000.000', { BESTQ: 'Q', WDATU: '00000000' }),
      quant('', '1000000236', '2100', 'CS01', 'W26', 'IP1', '0001001944', 'IN26002959', '1335.000', { LENUM: '', WDATU: '20260620' })
    ]);
    expect(s.ctx).toMatchObject({ Blocked: false, OpenQuantity: 1335, StorageUnitQuantCount: 1, NoUnitQuantCount: 1, NoUnitQuantity: 1335 });
    expect(s.ctx.Units).toEqual([expect.objectContaining({ StorageUnit: '1000032202', Status: 'Blocked', Reason: 'stockCategory', GoodsReceiptDate: null, Suggested: false })]);
    expect(await s.scan('1000032202')).toMatchObject({ Reason: 'stockCategory', Value1: 'Q' });
    expect([s.total(), s.state()]).toEqual([0, 'Scanning']);
  });

  it('excludes storage units from disparate warehouses (W13) from FIFO list when storage location is in W01', async () => {
    const s = await screen('471327', '1', []);
    s.adapter.rfc.readTable = async (table, fields, where) => {
      if (table === 'T320') return [{ LGNUM: 'W01' }];
      if (table === 'RESB') return RESB.filter((r) => r.RSNUM === '0000471327' && r.RSPOS === '0001');
      if (table === 'AUFK') return [{ AUFNR: '000002000589', AUART: 'ZP01', LOEKZ: '' }];
      if (table === 'JEST') return [{ OBJNR: 'OR000002000589', STAT: 'I0002' }];
      if (table === 'MAKT') return [{ MAKTX: 'Test material' }];
      if (table === 'MARC') return [{ XCHPF: 'X' }];
      if (table === 'MARD') return [{ LGORT: 'CS01', LABST: '99999.000' }];
      if (table === 'LQUA') {
        const w = where.join(' ');
        if (w.includes('8400000034')) {
          return [
            quant('1000053753', '8400000034', '1600', 'CS01', 'W01', 'GS1', '0002000589', 'PTRA260007', '120.000'),
            quant('1000033424', '8400000034', '1600', 'CS01', 'W13', 'RM1', '0-L0001-00', 'PTRA260008', '240.000')
          ];
        }
      }
      return [];
    };
    const ctx = await s.adapter.scanContext({ reservation: '471327', item: '1' });
    expect(ctx.Warehouse).toBe('W01');
    expect(ctx.Units.map((u) => u.StorageUnit)).toEqual(['1000053753']);
    expect(ctx.Units.some((u) => u.StorageUnit === '1000033424')).toBe(false);
  });
});

describe('Mvt261Service postGoodsIssue action', () => {
  const Mvt261Service = require('../../../srv/wm/mvt261/service');
  const GoodsIssueAttemptStore = require('../../../srv/wm/goods-issue/GoodsIssueAttemptStore');
  let svc;
  let handlers;
  const req = (data) => ({
    data,
    user: { id: 'test-user' },
    error: jest.fn((status, msg) => {
      const err = new Error(msg);
      err.status = status;
      return err;
    }),
    warn: jest.fn()
  });

  const cycleOf = (over = {}) => ({ Material: '1000001001', Plant: '1130', StorageLocation: 'CS02', Unit: 'KG', Batch: '', OpenQuantity: 800, ...over });

  beforeEach(() => {
    handlers = {};
    svc = new Mvt261Service();
    svc.on = (evt, fn) => { handlers[evt] = fn; };
    GoodsIssueAttemptStore.clearMemoryStore();
  });
  afterEach(() => jest.restoreAllMocks());

  it('validates input and rejects empty reservation, item, or quantity <= 0 before reading SAP', async () => {
    await svc.init();
    const cycleSpy = jest.spyOn(Mvt261Adapter.prototype, 'cycle');
    const r1 = req({ reservation: '', item: '1', quantity: 10 });
    await handlers.postGoodsIssue(r1);
    expect(r1.error).toHaveBeenCalledWith(400, 'Reservation and item are required');

    const r2 = req({ reservation: '100', item: '1', quantity: 0 });
    await handlers.postGoodsIssue(r2);
    expect(r2.error).toHaveBeenCalledWith(400, 'Quantity must be greater than zero');
    expect(cycleSpy).not.toHaveBeenCalled();
  });

  it('F3: two concurrent posts - exactly one reaches the adapter, the other gets 409', async () => {
    await svc.init();
    jest.spyOn(Mvt261Adapter.prototype, 'cycle').mockResolvedValue(cycleOf());
    let release;
    const postSpy = jest.spyOn(Mvt261Adapter.prototype, 'postGoodsIssue')
      .mockImplementation(() => new Promise((res) => { release = () => res({ MaterialDocument: '4900050046', MaterialDocumentYear: '2026', Pending: false }); }));

    const r1 = req({ reservation: '512851', item: '3', quantity: 200 });
    const p1 = handlers.postGoodsIssue(r1);                 // claims the key, then the adapter call hangs
    await new Promise((r) => setImmediate(r));              // let p1 reach the hanging post with the attempt recorded
    const r2 = req({ reservation: '512851', item: '3', quantity: 200 });
    await handlers.postGoodsIssue(r2);                      // same key -> createOrGet does not create -> 409

    expect(r2.error).toHaveBeenCalledWith(409, expect.stringContaining('in progress'));
    expect(postSpy).toHaveBeenCalledTimes(1);
    release();
    await p1;
    expect(postSpy).toHaveBeenCalledTimes(1);
  });

  it('F3: fails closed when the attempt store cannot be written (503, no post)', async () => {
    await svc.init();
    jest.spyOn(Mvt261Adapter.prototype, 'cycle').mockResolvedValue(cycleOf());
    const postSpy = jest.spyOn(Mvt261Adapter.prototype, 'postGoodsIssue');
    jest.spyOn(GoodsIssueAttemptStore, 'createOrGet').mockRejectedValue(new Error('db down'));

    const r = req({ reservation: '512851', item: '3', quantity: 200 });
    await handlers.postGoodsIssue(r);
    expect(r.error).toHaveBeenCalledWith(503, expect.stringContaining('NOT posted'));
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('F3: allows consecutive partial posts (distinct open quantity -> distinct key)', async () => {
    await svc.init();
    jest.spyOn(Mvt261Adapter.prototype, 'cycle')
      .mockResolvedValueOnce(cycleOf({ OpenQuantity: 800 }))
      .mockResolvedValueOnce(cycleOf({ OpenQuantity: 600 }));
    const postSpy = jest.spyOn(Mvt261Adapter.prototype, 'postGoodsIssue')
      .mockResolvedValue({ MaterialDocument: 'X', MaterialDocumentYear: '2026', Pending: false });

    const r1 = req({ reservation: '512851', item: '3', quantity: 200 });
    const r2 = req({ reservation: '512851', item: '3', quantity: 200 });
    await handlers.postGoodsIssue(r1);
    await handlers.postGoodsIssue(r2);

    expect(r1.error).not.toHaveBeenCalled();
    expect(r2.error).not.toHaveBeenCalled();
    expect(postSpy).toHaveBeenCalledTimes(2);
  });

  it('F9: rejects a batch that does not match the batch-pinned reservation (422, no post)', async () => {
    await svc.init();
    jest.spyOn(Mvt261Adapter.prototype, 'cycle').mockResolvedValue(cycleOf({ Batch: 'IN26000333' }));
    const postSpy = jest.spyOn(Mvt261Adapter.prototype, 'postGoodsIssue');

    const r = req({ reservation: '512851', item: '3', quantity: 200, batch: 'IN26000999' });
    await handlers.postGoodsIssue(r);
    expect(r.error).toHaveBeenCalledWith(422, expect.stringContaining('does not match the reservation batch'));
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('F9: forces the reservation batch when none is supplied', async () => {
    await svc.init();
    jest.spyOn(Mvt261Adapter.prototype, 'cycle').mockResolvedValue(cycleOf({ Batch: 'IN26000333' }));
    const postSpy = jest.spyOn(Mvt261Adapter.prototype, 'postGoodsIssue')
      .mockResolvedValue({ MaterialDocument: 'X', MaterialDocumentYear: '2026', Pending: false });

    await handlers.postGoodsIssue(req({ reservation: '512851', item: '3', quantity: 200 }));
    expect(postSpy).toHaveBeenCalledWith(expect.objectContaining({ batch: 'IN26000333' }));
  });

  it("F11: records the WM delivery outcome as 'delivery_created', not 'not_posted'", async () => {
    await svc.init();
    jest.spyOn(Mvt261Adapter.prototype, 'cycle').mockResolvedValue(cycleOf());
    jest.spyOn(Mvt261Adapter.prototype, 'postGoodsIssue').mockResolvedValue({
      MaterialDocument: '', MaterialDocumentYear: '', DeliveryNumber: '0080000087', Pending: true, Message: 'delivery created'
    });
    const statusSpy = jest.spyOn(GoodsIssueAttemptStore, 'setStatus');

    await handlers.postGoodsIssue(req({ reservation: '512851', item: '3', quantity: 200 }));
    const statuses = statusSpy.mock.calls.map((c) => c[1]);
    expect(statuses).toContain('delivery_created');
    expect(statuses).not.toContain('not_posted');
  });

  it("A6: an unknown outcome (502 timeout) records 'unconfirmed' (recheck-eligible), and a blind retry is still 409", async () => {
    await svc.init();
    jest.spyOn(Mvt261Adapter.prototype, 'cycle').mockResolvedValue(cycleOf());
    jest.spyOn(Mvt261Adapter.prototype, 'postGoodsIssue').mockRejectedValue(Object.assign(new Error('… failed: timeout'), { status: 502 }));
    const statusSpy = jest.spyOn(GoodsIssueAttemptStore, 'setStatus');
    await handlers.postGoodsIssue(req({ reservation: '512851', item: '3', quantity: 200 }));
    const statuses = statusSpy.mock.calls.map((c) => c[1]);
    expect(statuses).toContain('unconfirmed');
    expect(statuses).not.toContain('rejected');
    // same key (same open qty) -> blind retry blocked
    const r2 = req({ reservation: '512851', item: '3', quantity: 200 });
    await handlers.postGoodsIssue(r2);
    expect(r2.error).toHaveBeenCalledWith(409, expect.stringContaining('in progress'));
  });

  it("A6: a definite SAP rejection (422) records 'rejected'", async () => {
    await svc.init();
    jest.spyOn(Mvt261Adapter.prototype, 'cycle').mockResolvedValue(cycleOf());
    jest.spyOn(Mvt261Adapter.prototype, 'postGoodsIssue').mockRejectedValue(Object.assign(new Error('Goods issue not possible: over-issue'), { status: 422 }));
    const statusSpy = jest.spyOn(GoodsIssueAttemptStore, 'setStatus');
    await handlers.postGoodsIssue(req({ reservation: '512851', item: '3', quantity: 200 }));
    const statuses = statusSpy.mock.calls.map((c) => c[1]);
    expect(statuses).toContain('rejected');
    expect(statuses).not.toContain('unconfirmed');
  });

  it("re-claim: a 'rejected' post is re-claimable - fix the cause and the retry posts (new generation)", async () => {
    await svc.init();
    jest.spyOn(Mvt261Adapter.prototype, 'cycle').mockResolvedValue(cycleOf());
    const postSpy = jest.spyOn(Mvt261Adapter.prototype, 'postGoodsIssue')
      .mockRejectedValueOnce(Object.assign(new Error('Goods issue not possible: staging shortfall'), { status: 422 }))
      .mockResolvedValue({ MaterialDocument: '4900050046', MaterialDocumentYear: '2026', Pending: false });

    const r1 = req({ reservation: '512851', item: '3', quantity: 200 });
    await handlers.postGoodsIssue(r1);                    // -> rejected
    expect(r1.error).toHaveBeenCalledWith(422, expect.anything());
    const r2 = req({ reservation: '512851', item: '3', quantity: 200 });
    await handlers.postGoodsIssue(r2);                    // re-claim -> posts
    expect(r2.error).not.toHaveBeenCalled();
    expect(postSpy).toHaveBeenCalledTimes(2);
  });

  it("re-claim: a 'not_posted' post (recheck confirmed nothing posted) is re-claimable", async () => {
    await svc.init();
    jest.spyOn(Mvt261Adapter.prototype, 'cycle').mockResolvedValue(cycleOf());
    const postSpy = jest.spyOn(Mvt261Adapter.prototype, 'postGoodsIssue')
      .mockRejectedValueOnce(Object.assign(new Error('timeout'), { status: 502 }))   // -> unconfirmed
      .mockResolvedValue({ MaterialDocument: '4900050046', MaterialDocumentYear: '2026', Pending: false });
    const statusSpy = jest.spyOn(GoodsIssueAttemptStore, 'setStatus');

    await handlers.postGoodsIssue(req({ reservation: '512851', item: '3', quantity: 200 }));  // -> unconfirmed
    const gen0ref = statusSpy.mock.calls.find((c) => c[1] === 'unconfirmed')[0];
    await GoodsIssueAttemptStore.setStatus(gen0ref, 'not_posted');                             // recheck outcome
    const r2 = req({ reservation: '512851', item: '3', quantity: 200 });
    await handlers.postGoodsIssue(r2);                                                         // re-claim -> posts
    expect(r2.error).not.toHaveBeenCalled();
    expect(postSpy).toHaveBeenCalledTimes(2);
  });

  it("re-claim: a 'posted' attempt blocks a re-post of the same open quantity (409)", async () => {
    await svc.init();
    jest.spyOn(Mvt261Adapter.prototype, 'cycle').mockResolvedValue(cycleOf());
    jest.spyOn(Mvt261Adapter.prototype, 'postGoodsIssue').mockResolvedValue({ MaterialDocument: 'X', MaterialDocumentYear: '2026', Pending: false });
    await handlers.postGoodsIssue(req({ reservation: '512851', item: '3', quantity: 200 }));   // -> posted
    const r2 = req({ reservation: '512851', item: '3', quantity: 200 });
    await handlers.postGoodsIssue(r2);
    expect(r2.error).toHaveBeenCalledWith(409, expect.stringContaining('in progress'));
  });

  it('re-claim: a re-claim already in flight blocks a concurrent re-claim (409 - exactly one wins)', async () => {
    await svc.init();
    jest.spyOn(Mvt261Adapter.prototype, 'cycle').mockResolvedValue(cycleOf());
    let release;
    const postSpy = jest.spyOn(Mvt261Adapter.prototype, 'postGoodsIssue')
      .mockRejectedValueOnce(Object.assign(new Error('rejected'), { status: 422 }))            // gen0 -> rejected
      .mockImplementationOnce(() => new Promise((res) => { release = () => res({ MaterialDocument: 'X', MaterialDocumentYear: '2026', Pending: false }); })); // gen1 in flight

    await handlers.postGoodsIssue(req({ reservation: '512851', item: '3', quantity: 200 }));   // gen0 rejected
    const p2 = handlers.postGoodsIssue(req({ reservation: '512851', item: '3', quantity: 200 })); // gen1 re-claim, hangs ('sending')
    await new Promise((r) => setImmediate(r));
    const r3 = req({ reservation: '512851', item: '3', quantity: 200 });
    await handlers.postGoodsIssue(r3);                                                         // gen1 still in flight -> 409
    expect(r3.error).toHaveBeenCalledWith(409, expect.stringContaining('in progress'));
    expect(postSpy).toHaveBeenCalledTimes(2);                                                  // gen0 + gen1 only; r3 never posted
    release();
    await p2;
  });
});

describe('Mvt261Service reverse action (F6)', () => {
  const Mvt261Service = require('../../../srv/wm/mvt261/service');
  const GoodsIssueAttemptStore = require('../../../srv/wm/goods-issue/GoodsIssueAttemptStore');
  let svc;
  let handlers;
  const req = (data) => ({
    data,
    user: { id: 'test-user', is: (r) => r === 'Admin' },
    error: jest.fn((status, msg) => { const e = new Error(msg); e.status = status; return e; })
  });
  const cycleWith = (over = {}) => ({
    Reservation: '512851', ReservationItem: '3', Material: '1000001001', Plant: '1130', StorageLocation: 'CS02', Unit: 'KG',
    History: [{ MaterialDocument: '4900050046', MaterialDocumentYear: '2026', MaterialDocumentItem: '0001', MovementType: '261', IsReversed: false, Quantity: 200, Batch: 'B1' }],
    ...over
  });
  const input = { reservation: '512851', item: '3', materialDocument: '4900050046', materialDocumentYear: '2026', materialDocumentItem: '1' };

  beforeEach(() => {
    handlers = {};
    svc = new Mvt261Service();
    svc.on = (evt, fn) => { handlers[evt] = fn; };
    GoodsIssueAttemptStore.clearMemoryStore();
  });
  afterEach(() => jest.restoreAllMocks());

  it('reverses a 261 document item and returns the SAP 262 document', async () => {
    await svc.init();
    jest.spyOn(Mvt261Adapter.prototype, 'cycle').mockResolvedValue(cycleWith());
    const revSpy = jest.spyOn(Mvt261Adapter.prototype, 'reverse').mockResolvedValue({ MaterialDocument: '4900050099', MaterialDocumentYear: '2026' });
    const r = req(input);
    const res = await handlers.reverse(r);
    expect(r.error).not.toHaveBeenCalled();
    expect(res).toMatchObject({ MaterialDocument: '4900050099' });
    expect(revSpy).toHaveBeenCalledWith(expect.objectContaining({ materialDocument: '4900050046', materialDocumentYear: '2026', materialDocumentItem: '1' }));
  });

  it('refuses an already-reversed document (422), no SAP call', async () => {
    await svc.init();
    jest.spyOn(Mvt261Adapter.prototype, 'cycle').mockResolvedValue(cycleWith({
      History: [{ MaterialDocument: '4900050046', MaterialDocumentYear: '2026', MaterialDocumentItem: '0001', MovementType: '261', IsReversed: true }]
    }));
    const revSpy = jest.spyOn(Mvt261Adapter.prototype, 'reverse');
    const r = req(input);
    await handlers.reverse(r);
    expect(r.error).toHaveBeenCalledWith(422, expect.stringContaining('already reversed'));
    expect(revSpy).not.toHaveBeenCalled();
  });

  it('refuses when the document is not a 261 of this reservation item (422)', async () => {
    await svc.init();
    jest.spyOn(Mvt261Adapter.prototype, 'cycle').mockResolvedValue(cycleWith({ History: [] }));
    const revSpy = jest.spyOn(Mvt261Adapter.prototype, 'reverse');
    const r = req(input);
    await handlers.reverse(r);
    expect(r.error).toHaveBeenCalledWith(422, expect.stringContaining('not a movement type 261'));
    expect(revSpy).not.toHaveBeenCalled();
  });

  it('two concurrent reversals: one reaches the adapter, the other 409', async () => {
    await svc.init();
    jest.spyOn(Mvt261Adapter.prototype, 'cycle').mockResolvedValue(cycleWith());
    let release;
    const revSpy = jest.spyOn(Mvt261Adapter.prototype, 'reverse')
      .mockImplementation(() => new Promise((res) => { release = () => res({ MaterialDocument: '4900050099', MaterialDocumentYear: '2026' }); }));
    const p1 = handlers.reverse(req(input));
    await new Promise((r) => setImmediate(r));
    const r2 = req(input);
    await handlers.reverse(r2);
    expect(r2.error).toHaveBeenCalledWith(409, expect.stringContaining('in progress'));
    expect(revSpy).toHaveBeenCalledTimes(1);
    release();
    await p1;
  });

  it('fails closed when the attempt store cannot be written (503, no reversal)', async () => {
    await svc.init();
    jest.spyOn(Mvt261Adapter.prototype, 'cycle').mockResolvedValue(cycleWith());
    const revSpy = jest.spyOn(Mvt261Adapter.prototype, 'reverse');
    jest.spyOn(GoodsIssueAttemptStore, 'createOrGet').mockRejectedValue(new Error('db down'));
    const r = req(input);
    await handlers.reverse(r);
    expect(r.error).toHaveBeenCalledWith(503, expect.stringContaining('NOT posted'));
    expect(revSpy).not.toHaveBeenCalled();
  });

  it("maps SAP's already-cancelled error to 422", async () => {
    await svc.init();
    jest.spyOn(Mvt261Adapter.prototype, 'cycle').mockResolvedValue(cycleWith());
    jest.spyOn(Mvt261Adapter.prototype, 'reverse').mockRejectedValue(Object.assign(new Error('Document 4900050046 is already cancelled'), { status: 500 }));
    const r = req(input);
    await handlers.reverse(r);
    expect(r.error).toHaveBeenCalledWith(422, expect.stringContaining('already reversed'));
  });

  it("re-claim: a 'rejected' reversal is re-claimable (e.g. a closed period, then reopened)", async () => {
    await svc.init();
    jest.spyOn(Mvt261Adapter.prototype, 'cycle').mockResolvedValue(cycleWith());
    const revSpy = jest.spyOn(Mvt261Adapter.prototype, 'reverse')
      .mockRejectedValueOnce(Object.assign(new Error('Posting period 2026 is closed'), { status: 500 }))   // -> rejected
      .mockResolvedValue({ MaterialDocument: '4900050099', MaterialDocumentYear: '2026' });

    await handlers.reverse(req(input));                  // rejected
    const r2 = req(input);
    await handlers.reverse(r2);                          // re-claim -> posts
    expect(r2.error).not.toHaveBeenCalled();
    expect(revSpy).toHaveBeenCalledTimes(2);
  });

  it("re-claim: a 'not_posted' reversal is NOT re-claimable - still 409 (the 262 recheck can mislabel a posted reversal)", async () => {
    await svc.init();
    jest.spyOn(Mvt261Adapter.prototype, 'cycle').mockResolvedValue(cycleWith());
    const revSpy = jest.spyOn(Mvt261Adapter.prototype, 'reverse')
      .mockRejectedValueOnce(Object.assign(new Error('timeout'), { status: 502 }));   // -> unconfirmed
    const statusSpy = jest.spyOn(GoodsIssueAttemptStore, 'setStatus');

    await handlers.reverse(req(input));                  // unconfirmed
    const gen0ref = statusSpy.mock.calls.find((c) => c[1] === 'unconfirmed')[0];
    await GoodsIssueAttemptStore.setStatus(gen0ref, 'not_posted');
    const r2 = req(input);
    await handlers.reverse(r2);                          // reverse policy excludes not_posted -> 409
    expect(r2.error).toHaveBeenCalledWith(409, expect.stringContaining('in progress'));
    expect(revSpy).toHaveBeenCalledTimes(1);             // no second adapter call
  });
});
