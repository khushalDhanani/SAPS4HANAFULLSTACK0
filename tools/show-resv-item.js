#!/usr/bin/env node
// Print every non-empty field of one reservation item as SAP returns it (read-only).
// Usage: node tools/show-resv-item.js <reservation> [item]      e.g. node tools/show-resv-item.js 519366
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.local') });
const adapter = require('../srv/integration/s4hana/wm/GoodsIssueAdapter');

const [resv, item = '0001'] = process.argv.slice(2);
if (!resv) { console.log('Usage: node tools/show-resv-item.js <reservation> [item]'); process.exit(0); }
const filter = `Reservation eq '${resv.padStart(10, '0')}' and ReservationItem eq '${item.padStart(4, '0')}'`;
adapter.reservations._get('/sap/opu/odata/sap/UI_RESERVATION_ITM_MNG_V2/ReservationDocumentItem', `$filter=${encodeURIComponent(filter)}&$format=json`)
  .then(([r]) => {
    if (!r) return console.log('not found');
    Object.entries(r).filter(([, v]) => v !== '' && v !== null && typeof v !== 'object').forEach(([k, v]) => console.log(`${k.padEnd(45)} ${v}`));
  })
  .catch((e) => { console.error(`FAILED (${e.status || '-'}): ${e.message}`); process.exit(1); });
