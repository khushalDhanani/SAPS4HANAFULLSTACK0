#!/usr/bin/env node
// READ-ONLY report: open outbound deliveries (LIKP/LIPS) for every reservation item that got a
// delivery on the given day (default today). Changes nothing in SAP.
// Usage: node tools/report-open-deliveries.js [YYYYMMDD]
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.local'), quiet: true });
const adapter = require('../srv/integration/s4hana/wm/GoodsIssueAdapter');
const { RfcClient } = require('../srv/integration/s4hana/RfcClient');

const day = process.argv[2] || new Date().toISOString().slice(0, 10).replace(/-/g, '');
(async () => {
  const rows = await new RfcClient().readTable('LIPS', ['RSNUM', 'RSPOS'], [`ERDAT = '${day}'`]);
  const items = [...new Set(rows.filter((r) => r.RSNUM && !/^0+$/.test(r.RSNUM)).map((r) => `${r.RSNUM}/${r.RSPOS}`))];
  console.log(`Reservation items with a delivery created on ${day}: ${items.length}`);
  for (const key of items) {
    const [rsnum, rspos] = key.split('/');
    const open = (await adapter.findDeliveriesForReservationItem(rsnum, rspos)).filter((d) => d.Open);
    console.log(`\n${key}: ${open.length} open deliver${open.length === 1 ? 'y' : 'ies'}`);
    for (const d of open) {
      console.log(`  ${d.DeliveryNumber}  type ${d.DeliveryType}  GM-status ${d.GoodsMovementStatus || '-'}  item ${d.Item} ${d.Quantity} ${d.Unit}  created ${d.CreatedOn} ${d.CreatedTime} (SAP server time)  ext-id ${d.ExternalId || '-'}`);
    }
  }
})().catch((e) => { console.error(`FAILED (${e.status || '-'}): ${e.message}`); process.exit(1); });
