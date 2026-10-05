#!/usr/bin/env node
// Live check: Storage Units valid for one Goods Issue reservation line (read-only).
// Usage: node tools/test-gi-su-list.js <reservation> [item]      e.g. node tools/test-gi-su-list.js 519366
//        node tools/test-gi-su-list.js <reservation> <item> <SU>  -> also resolve that SU for the line
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.local') });
const adapter = require('../srv/integration/s4hana/wm/GoodsIssueAdapter');

const args = process.argv.slice(2);
const diag = args.includes('--diag');
const [resv, item, su] = args.filter((a) => a !== '--diag');

// --diag: widen the LQUA query step by step to see which filter drops the rows.
async function diagnose(r) {
  const rfc = adapter.stockUnits.rfc;
  const m = r.Material;
  const f = ['LGNUM', 'LENUM', 'MATNR', 'WERKS', 'LGORT', 'CHARG', 'VERME', 'BESTQ', 'SOBKZ', 'LGTYP', 'LGPLA'];
  const show = (label, rows) => {
    console.log(`  [diag] ${label}: ${rows.length} row(s)`);
    rows.slice(0, 15).forEach((q) => console.log(`         MATNR='${q.MATNR}' WH ${q.LGNUM} SU '${q.LENUM}' ${q.WERKS}/${q.LGORT} batch ${q.CHARG || '-'} ${q.VERME} BESTQ '${q.BESTQ}' SOBKZ '${q.SOBKZ}' bin ${q.LGTYP}/${q.LGPLA}`));
  };
  console.log(`  [diag] T320 for ${r.Plant}/${r.StorageLocation}:`, JSON.stringify(await rfc.readTable('T320', ['WERKS', 'LGORT', 'LGNUM'], [`WERKS = '${r.Plant}'`])));
  for (const matnr of [...new Set([m.padStart(18, '0'), m, m.padStart(40, '0')])]) {
    show(`LQUA MATNR='${matnr}' (any warehouse / plant / sloc / SU)`, await rfc.readTable('LQUA', f, [`MATNR = '${matnr}'`]));
  }
  show(`LQUA MATNR LIKE '%${m}' (any format)`, await rfc.readTable('LQUA', f, [`MATNR LIKE '%${m}'`]));
}
(async () => {
  if (!resv) return console.log('Usage: node tools/test-gi-su-list.js <reservation> [item] [SU]');
  const items = item ? [item] : (await adapter.stockUnits._get(
    '/sap/opu/odata/sap/UI_RESERVATION_ITM_MNG_V2/ReservationDocumentItem',
    `$filter=${encodeURIComponent(`Reservation eq '${resv.padStart(10, '0')}' and ReservationItemIsFinallyIssued eq false`)}&$format=json`
  )).map((r) => r.ReservationItem);
  for (const it of items) {
    const r = await adapter.listStockUnitsForReservationItem(resv, it);
    console.log(`\n== Resv ${r.ReservationNo} item ${r.ReservationItem}: material ${r.Material} ${r.Plant}/${r.StorageLocation}` +
      `${r.Batch ? ` batch ${r.Batch}` : ''} WH ${r.Warehouse || '-'} -> ${r.StockUnits.length} SU(s), ${r.ExcludedCount} hidden ${r.Message ? `| ${r.Message}` : ''}`);
    if (diag || !r.StockUnits.length) await diagnose(r);
    r.StockUnits.forEach((s) => console.log(`  SU ${s.StorageUnit.padEnd(12)} batch ${(s.Batch || '-').padEnd(12)} SLED ${s.ExpiryDate || '-'}  ${s.AvailableStock} ${s.Unit}  bin ${s.StorageType}/${s.StorageBin}`));
  }
  if (su && item) console.log('\n== resolve', JSON.stringify(await adapter.resolveStockUnitForGoodsIssue(su, resv, item), null, 2));
})().catch((e) => { console.error(`\nFAILED (${e.status || '-'}): ${e.message}`); process.exit(1); });
