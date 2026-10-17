#!/usr/bin/env node
// Live RFC check of the TR->TO adapter. Read-only unless --create is given.
// Usage: node tools/test-rfc-trto.js --list [mvt] [warehouse]
//        node tools/test-rfc-trto.js <TR> [SU] [--create <qty>]      (warehouse W01)
//        node tools/test-rfc-trto.js <TR> --sus   -> list SUs in W01 holding the TR's batches
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.local') });
const TrToAdapter = require('../srv/integration/s4hana/wm/TrToAdapter');

const [tr, su, flag, qty] = process.argv.slice(2);
const a = new TrToAdapter();
const show = (label, v) => console.log(`\n== ${label}\n${JSON.stringify(v, null, 2)}`);

(async () => {
  if (!tr) return console.log('Usage: node tools/test-rfc-trto.js --list [mvt] | <TR> [SU] [--create <qty>]');

  if (tr === '--list' || tr === 'list') {
    const mvtFilter = su;
    const wh = flag || 'W01';
    const where = [`LGNUM = '${wh}'`, "AND STATU <> 'E'"];
    if (mvtFilter) where.push(`AND BWLVS = '${mvtFilter}'`);
    const rows = await a.rfc.readTable('LTBK', ['LGNUM', 'TBNUM', 'BWLVS', 'BETYP', 'BENUM', 'RSNUM', 'STATU', 'BDATU'], where);
    console.log(`\n== ${rows.length} Open TR(s) in Warehouse ${wh}${mvtFilter ? ` (Movement Type ${mvtFilter})` : ''}:`);
    for (const r of rows.slice(0, 50)) {
      const tbnum = r.TBNUM.replace(/^0+/, '');
      const req = r.BENUM && r.BENUM !== '0000000000' ? ` Doc:${r.BENUM.replace(/^0+/, '')}` : (r.RSNUM && r.RSNUM !== '0000000000' ? ` Res:${r.RSNUM.replace(/^0+/, '')}` : '');
      console.log(`  TR ${tbnum.padEnd(10)} | Mvt ${r.BWLVS} | Date ${r.BDATU} | Type:${r.BETYP || '-'}${req}`);
    }
    if (rows.length > 50) console.log(`  ... and ${rows.length - 50} more`);
    return;
  }

  const trData = await a.getTR(tr, 'W01');
  if (su === '--sus') {
    const batches = [...new Set(trData.Items.filter((i) => i.Batch && i.OpenQty > 0).map((i) => i.Batch))];
    if (batches.length > 0) {
      for (const b of batches) {
        const rows = await a.rfc.readTable('LQUA', ['LENUM', 'MATNR', 'CHARG', 'VERME', 'MEINS', 'LGTYP', 'LGPLA'],
          ["LGNUM = 'W01'", `AND CHARG = '${b}'`, "AND LENUM <> ' '"]);
        console.log(`\n== Batch ${b}: ${rows.length} SU(s)`);
        rows.forEach((r) => console.log(`  SU ${r.LENUM.replace(/^0+/, '')}  stock ${r.VERME} ${r.MEINS}  bin ${r.LGTYP}/${r.LGPLA}`));
      }
    } else {
      const matnrs = [...new Set(trData.Items.filter((i) => i.OpenQty > 0).map((i) => i.Material))];
      for (const m of matnrs) {
        const padded = /^\d+$/.test(m) ? m.padStart(18, '0') : m;
        const rows = await a.rfc.readTable('LQUA', ['LENUM', 'MATNR', 'CHARG', 'VERME', 'MEINS', 'LGTYP', 'LGPLA'],
          ["LGNUM = 'W01'", `AND MATNR = '${padded}'`, "AND LENUM <> ' '"]);
        console.log(`\n== Material ${m}: ${rows.length} SU(s) in W01`);
        rows.forEach((r) => console.log(`  SU ${r.LENUM.replace(/^0+/, '')}  batch ${r.CHARG}  stock ${r.VERME} ${r.MEINS}  bin ${r.LGTYP}/${r.LGPLA}`));
      }
    }
    return;
  }
  show(`TR ${tr}`, trData);
  if (su) show(`SU ${su}`, await a.checkSU(su, tr, 'W01'));
  if (su && flag === '--create') show('CREATE TO', await a.createTO({ lgnum: 'W01', tbnum: tr, lenum: su, qty }));
})().catch((e) => { console.error(`\nFAILED (${e.status || '-'}): ${e.message}`); process.exit(1); });
