#!/usr/bin/env node
// Live read-only check of the 261 scan rules: page context of one reservation item, then one check per storage unit.
// Usage: node tools/check-261-scan.js <reservation> <item> [storageUnit ...]
//   Without storage units it lists the material's storage-unit quants in the plant (LQUA) instead.
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.local') });
const Mvt261Adapter = require('../srv/integration/s4hana/wm/Mvt261Adapter');

const [reservation, item, ...units] = process.argv.slice(2);
const adapter = new Mvt261Adapter();
adapter.client.post = () => { throw new Error('write attempted'); };

(async () => {
  const ctx = await adapter.scanContext({ reservation, item });
  console.log(`CONTEXT ${JSON.stringify(ctx)}`);
  if (!units.length) {
    const q = await adapter.rfc.readTable('LQUA', ['LENUM', 'LGNUM', 'LGTYP', 'LGPLA', 'LGORT', 'CHARG', 'VERME'],
      [`MATNR = '${ctx.Material.padStart(18, '0')}'`, `AND WERKS = '${ctx.Plant}'`, "AND LENUM <> ''", 'AND VERME > 0']);
    q.forEach((r) => console.log(`LQUA ${JSON.stringify(r)}`));
  }
  for (const storageUnit of units) console.log(`SCAN ${storageUnit} -> ${JSON.stringify(await adapter.checkStorageUnit({ reservation, item, storageUnit }))}`);
})().catch((e) => { console.error(`FAILED (${e.status || '-'}): ${e.message}`); process.exit(1); });
