#!/usr/bin/env node
// Live check of the first movement type 261 document (read-only, GET only).
// Usage: node tools/find-first-261.js <plant> [A|B|C] [material] [productionOrder] [dateFrom] [dateTo]
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.local') });
const Mvt261Adapter = require('../srv/integration/s4hana/wm/Mvt261Adapter');

const [plant, definition = 'A', material, productionOrder, dateFrom, dateTo] = process.argv.slice(2);
const flags = { excludeReversed: process.env.EXCLUDE_REVERSED === '1', manualOnly: process.env.MANUAL_ONLY === '1' };

new Mvt261Adapter().findFirst({ plant, definition, material, productionOrder, dateFrom, dateTo, ...flags }).then((r) => {
  console.log(`definition ${r.Definition} | sort key ${r.SortKey} | ${r.TotalCount} matching 261 items`);
  console.table(r.Top);
}).catch((e) => { console.error(`FAILED (${e.status || '-'}): ${e.message}`); process.exit(1); });
