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

  it('no write of any kind: every screen path reads RFC tables only, sends no HTTP request, and the UI code has no write call', async () => {
    for (const [r, i, units] of [['512851', '3', ['2000018193', '9999999999']], ['519944', '1', ['2000019210']], ['24685', '2', ['1000033499']]]) {
      const s = await screen(r, i);
      for (const u of units) await s.scan(u);
      expect(s.http).toEqual([]); // the double throws on any HTTP call and has no RFC function-call method
    }
    const mod = path.join(__dirname, '../../../app/fiori-app/webapp/modules/wm/mvt261');
    for (const f of ['controller/Scan261.controller.js', 'model/ScanSession.js', 'view/Scan261.view.xml']) {
      const src = fs.readFileSync(path.join(mod, f), 'utf8');
      expect(`${f}: ${/\.post\(|\.put\(|\.patch\(|\.delete\(|method:\s*["'](POST|PUT|PATCH|DELETE)/i.test(src)}`).toBe(`${f}: false`);
      expect(`${f}: ${/post261|onPost|postGoodsIssue|reverse/i.test(src)}`).toBe(`${f}: false`);
    }
    const cdsSrc = fs.readFileSync(path.join(__dirname, '../../../srv/wm/mvt261/service.cds'), 'utf8');
    expect(/\baction\s/.test(cdsSrc)).toBe(false); // functions only: the service accepts GET, nothing else
    const svc = fs.readFileSync(path.join(__dirname, '../../../srv/wm/mvt261/service.js'), 'utf8');
    expect(/postGoodsIssue|reverse/.test(svc)).toBe(false);
  });
});

describe('open 261 list: only where scanning is possible', () => {
  const item = (Reservation, ReservationItem, OrderID, Product, Plant, required, withdrawn) => ({
    Reservation, ReservationItem, OrderID, Product, Plant, StorageLocation: 'CS02', MatlCompRequirementDate: '/Date(1791158400000)/',
    ResvnItmRequiredQtyInBaseUnit: required, ResvnItmWithdrawnQtyInBaseUnit: withdrawn, BaseUnit: 'KG', GoodsMovementIsAllowed: true
  });
  const list = (input) => {
    const s = sap();
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
});
