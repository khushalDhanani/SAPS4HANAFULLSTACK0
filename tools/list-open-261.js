#!/usr/bin/env node
// Live check of open movement type 261 reservation items (read-only, GET only).
// Usage: [ALL=1] node tools/list-open-261.js [plant] [material] [productionOrder]
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.local') });
const Mvt261Adapter = require('../srv/integration/s4hana/wm/Mvt261Adapter');

const [plant, material, productionOrder] = process.argv.slice(2);

new Mvt261Adapter().openItems({ plant, material, productionOrder, includeFullyWithdrawn: process.env.ALL === '1' }).then((r) => {
  console.log(`${r.TotalCount} items returned | ${r.SapOpenCount} open in SAP (not deleted, not final-issued)${r.Truncated ? ' | TRUNCATED' : ''}`);
  console.table(r.Items.slice(0, 20).map(({ OrderDescription: _d, MaterialName: _n, ...row }) => row));
}).catch((e) => { console.error(`FAILED (${e.status || '-'}): ${e.message}`); process.exit(1); });
