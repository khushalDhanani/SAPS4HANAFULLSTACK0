#!/usr/bin/env node
// Live timing of the Goods Issue reservation list (read-only).
// Usage: node tools/time-gi-reservations.js [plant]
//  1) old query shape: full entity, 100 per page (up to 2,000 items)  2) new: $select + $orderby, 1,000 per page
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.local') });
const adapter = require('../srv/integration/s4hana/wm/GoodsIssueAdapter');

const plant = process.argv[2] || '';
const PATH = '/sap/opu/odata/sap/UI_RESERVATION_ITM_MNG_V2/ReservationDocumentItem';
let filter = "ReservationItemIsFinallyIssued eq false and ReservationItmIsMarkedForDeltn eq false and (GoodsMovementType eq '261' or GoodsMovementType eq '201' or GoodsMovementType eq '531')";
if (plant) filter += ` and Plant eq '${plant}'`;

async function oldShape() {
  let skip = 0; let n = 0; let calls = 0;
  for (;;) {
    const page = await adapter.reservations._get(PATH, `$filter=${encodeURIComponent(filter)}&$top=100&$skip=${skip}&$format=json`);
    calls++; n += page.length;
    if (page.length < 100 || n >= 2000) return { items: n, calls };
    skip += 100;
  }
}

(async () => {
  let t = Date.now();
  const o = await oldShape();
  console.log(`OLD  full entity, 100/page : ${o.items} items, ${o.calls} SAP calls, ${Date.now() - t} ms`);
  t = Date.now();
  const r = await adapter.getOpenReservations('261', plant);
  console.log(`NEW  $select+$orderby, 1000/page : ${r.totalScannedItems || 0} items -> ${r.length} reservations, ${Date.now() - t} ms${r.isTruncated ? ' (truncated at 2,000 items)' : ''}`);
  console.log(`     newest: ${r.slice(0, 5).map((x) => x.ReservationNo).join(', ')}`);
})().catch((e) => { console.error(`\nFAILED (${e.status || '-'}): ${e.message}`); process.exit(1); });
