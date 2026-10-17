#!/usr/bin/env node
// Proof: open movement type 261 items of the app vs SAP table RESB (read-only: RFC_READ_TABLE + OData GET).
// Usage: node tools/reconcile-open-261.js [plant]     exit code 1 on any difference
// Baseline SQL (same as SE16N on RESB):  BWART = '261' AND XLOEK = '' AND KZEAR = '' [AND WERKS = <plant>]
// Not compared: unit of measure (RESB holds the internal code, the service the external one).
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.local') });
const Mvt261Adapter = require('../srv/integration/s4hana/wm/Mvt261Adapter');
const { RfcClient } = require('../srv/integration/s4hana/RfcClient');

const plant = (process.argv[2] || '').toUpperCase();
if (plant && !/^[A-Z0-9]{1,4}$/.test(plant)) { console.error('invalid plant'); process.exit(1); }

/** RFC_READ_TABLE prints quantities in user format (1.234,500 or 1,234.500): the last separator is the decimal point. */
const num = (v) => {
  const s = String(v || '').replace(/\s/g, '');
  const i = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
  return i < 0 ? Number(s) : Number(`${s.slice(0, i).replace(/[.,]/g, '')}.${s.slice(i + 1)}`);
};
const strip = (v) => String(v || '').replace(/^0+(?=.)/, '');
const sapDate = (v) => (/^\d{8}$/.test(v) && v !== '00000000' ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6)}` : null);

(async () => {
  const where = ["BWART = '261'", "AND XLOEK = ''", "AND KZEAR = ''"].concat(plant ? [`AND WERKS = '${plant}'`] : []);
  const resb = await new RfcClient().readTable('RESB', ['RSNUM', 'RSPOS', 'RSART', 'MATNR', 'WERKS', 'LGORT', 'AUFNR', 'BDTER', 'BDMNG', 'ENMNG'], where);
  const adapter = new Mvt261Adapter();
  const all = await adapter.openItems({ plant, includeFullyWithdrawn: true });
  const dflt = await adapter.openItems({ plant });

  const sap = new Map(resb.map((r) => [`${strip(r.RSNUM)}/${strip(r.RSPOS)}/${r.RSART}`, {
    Material: strip(r.MATNR), Plant: r.WERKS, StorageLocation: r.LGORT, ProductionOrder: strip(r.AUFNR),
    RequirementDate: sapDate(r.BDTER), RequiredQuantity: num(r.BDMNG), WithdrawnQuantity: num(r.ENMNG)
  }]));
  const app = new Map(all.Items.map((i) => [`${strip(i.Reservation)}/${strip(i.ReservationItem)}/${i.RecordType}`, i]));

  const onlySap = [...sap.keys()].filter((k) => !app.has(k));
  const onlyApp = [...app.keys()].filter((k) => !sap.has(k));
  const fieldDiffs = [];
  for (const [k, s] of sap) {
    const a = app.get(k);
    if (!a) continue;
    for (const f of Object.keys(s)) {
      const av = ['Material', 'ProductionOrder'].includes(f) ? strip(a[f]) : a[f];
      if (av !== s[f]) fieldDiffs.push(`${k} ${f}: RESB=${s[f]} app=${av}`);
    }
  }
  const sapQtyOpen = [...sap.values()].filter((s) => s.RequiredQuantity > s.WithdrawnQuantity).length;

  const checks = [
    ['row count, all open items (RESB vs app)', sap.size, all.TotalCount],
    ['row count, SAP count reported by app', sap.size, all.SapOpenCount],
    ['row count, open quantity > 0 (RESB vs app default)', sapQtyOpen, dflt.TotalCount],
    ['keys only in RESB', 0, onlySap.length],
    ['keys only in app', 0, onlyApp.length],
    ['field differences on matched rows', 0, fieldDiffs.length],
    ['app result truncated', false, all.Truncated]
  ];
  console.log(`Selection: plant ${plant || '(all)'}`);
  let failed = false;
  for (const [name, expected, actual] of checks) {
    const ok = expected === actual;
    failed = failed || !ok;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: expected ${expected}, got ${actual}`);
  }
  [...onlySap.slice(0, 10).map((k) => `only RESB ${k}`), ...onlyApp.slice(0, 10).map((k) => `only app ${k}`), ...fieldDiffs.slice(0, 10)].forEach((l) => console.log(`  ${l}`));
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(`FAILED (${e.status || '-'}): ${e.message}`); process.exit(1); });
