'use strict';
/**
 * Writes a sample of the app-drawn 4 x 6 in quarantine label with SYNTHETIC DEMO data only (no SAP call, no real
 * HU, batch, serial or quarantine record). Same layout/PDF modules and English i18n captions as the Fiori app.
 *   node tools/generate-quar-label-sample.js [out.pdf]
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const mod = (p) => path.join(root, 'app/fiori-app/webapp/modules', p);
let Barcode, Hu, HuPdf, Layout, Pdf;
global.sap = { ui: { define: (d, f) => { Barcode = f(); }, require: { toUrl: () => '' } } };
require(mod('wm/handling-unit/util/Barcode.js'));
global.sap.ui.define = (d, f) => { Hu = f(Barcode); };
require(mod('wm/handling-unit/util/HuLabelLayout.js'));
global.sap.ui.define = (d, f) => { HuPdf = f(Barcode, Hu); };
require(mod('wm/handling-unit/util/HuLabelPdf.js'));
global.sap.ui.define = (d, f) => { Layout = f(Barcode, Hu); };
require(mod('wm/quarantine-label/util/QuarLabelLayout.js'));
global.sap.ui.define = (d, f) => { Pdf = f(Layout, HuPdf); };
require(mod('wm/quarantine-label/util/QuarLabelPdf.js'));
const { jsPDF } = require(path.join(root, 'app/fiori-app/node_modules/jspdf'));

const i18n = Object.fromEntries(fs.readFileSync(path.join(root, 'app/fiori-app/webapp/i18n/i18n_en.properties'), 'utf8')
  .split('\n').filter((l) => /^[\w.]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const texts = Object.fromEntries(Object.entries(Layout.CAPTION_KEYS).map(([k, key]) => {
  if (!i18n[key]) throw new Error(`i18n key missing: ${key}`);
  return [k, i18n[key]];
}));

const base = {
  MaterialDescription: 'DEMO MATERIAL 01', MaterialDocument: '9900000001', PostingDate: '2026-10-27', Batch: 'DEMO-BATCH-01',
  SupplierBatch: 'DEMO-SB-01', SupplierName: 'DEMO SUPPLIER LTD', BatchCharacteristics: 'DEMO-CHAR-A DEMO-CHAR-B',
  ManufacturingDate: '2026-10-01', DateKind: 'RETEST', DateValue: '2027-04-01', PostedQuantity: '120 KG',
  ContainerQuantity: '40', Unit: 'KG', Container: '1 OF 3', StorageUnit: '00000000009900000001', Text: 'DEMO SAMPLE - NOT A REAL LABEL'
};
const rows = [
  base,
  { // long values: wrap, then shrink, then "…"
    ...base, Container: '2 OF 3', StorageUnit: '00000000009900000002',
    MaterialDescription: 'DEMO MATERIAL WITH A VERY LONG NAME 0002',
    SupplierName: 'DEMO SUPPLIER WITH A VERY LONG REGISTERED NAME',
    BatchCharacteristics: 'DEMO-CHARACTERISTIC-VALUE-AAAAAAAAAA DEMO-CHARACTERISTIC-VALUE-BBBBBBBBBBBBBB',
    DateKind: 'EXPIRY', Text: 'DEMO REMARK WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW'
  },
  { // missing values: empty marker, no barcode
    MaterialDescription: 'DEMO MATERIAL 03', MaterialDocument: '9900000001', PostingDate: '2026-10-27', Container: '3 OF 3'
  }
];

const out = process.argv[2] || path.join(root, 'docs/label/samples/zquar-4x6-DEMO.pdf');
fs.mkdirSync(path.dirname(out), { recursive: true });
const r = Pdf.generate(jsPDF, rows, texts, {});
fs.writeFileSync(out, Buffer.from(r.doc.output('arraybuffer')));
console.log(`Wrote ${path.relative(root, out)} (${rows.length} labels)`);
r.warnings.forEach((w) => console.log(`  label ${w.label}: ${w.code} ${w.field}`));
