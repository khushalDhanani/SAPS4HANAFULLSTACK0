'use strict';
/**
 * Sample of the 4 x 6 in ZQUAR quarantine label (same layout as the SAP label, bigger barcode) with SYNTHETIC DEMO
 * data only: no SAP call, no real material, GRN, batch, supplier or quarantine record. 14 containers -> 14 pages.
 * Same layout/PDF modules and English i18n texts as the Fiori app.
 *   node tools/generate-zquar-label-sample.js [out.pdf] [--dpi 300]
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
let AetherLogo;
global.sap.ui.define = (d, f) => { AetherLogo = f(); };
require(mod('wm/quarantine-label/util/AetherLogo.js'));
global.sap.ui.define = (d, f) => { Layout = f(Barcode, Hu, AetherLogo); };
require(mod('wm/quarantine-label/util/ZquarLabelLayout.js'));
global.sap.ui.define = (d, f) => { Pdf = f(Layout, HuPdf); };
require(mod('wm/quarantine-label/util/ZquarLabelPdf.js'));
const { jsPDF } = require(path.join(root, 'app/fiori-app/node_modules/jspdf'));

const i18n = Object.fromEntries(fs.readFileSync(path.join(root, 'app/fiori-app/webapp/i18n/i18n_en.properties'), 'utf8')
  .split('\n').filter((l) => /^[\w.]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const texts = Object.fromEntries(Object.entries({ ...Layout.STATIC_KEYS, ...Layout.CAPTION_KEYS }).map(([k, key]) => {
  if (!i18n[key]) throw new Error(`i18n key missing: ${key}`);
  return [k, i18n[key]];
}));

const TOTAL = 14;
const base = {
  materialName: 'DEMO MATERIAL NAME 01', itemCode: 'DEMO-MAT-01', materialCode: 'DEMO-MAT-01', preparedBy: 'DEMO-USER', grnNo: '9900000001', grnDate: '27.10.2026', inwNo: 'DEMO-INW-01',
  inspectionLot: '010000005588',
  qtyReceived: '140.000 KG', manufacturer: 'DEMO MANUFACTURER LTD', supplier: 'DEMO SUPPLIER PVT LTD', batchNo: 'DEMO-BATCH-01',
  mfgDate: '01.10.2026', expiryDate: '01.04.2027', netWeight: '10.000 KG'
};
const rows = Array.from({ length: TOTAL }, (_, i) => ({
  ...base, containerNo: `${i + 1} of ${TOTAL}`, barcode: String(9900000001 + i)
}));
// page 2: long values (wrap -> shrink -> more lines); page 3: empty values keep their space
Object.assign(rows[1], {
  materialName: 'DEMO MATERIAL WITH LONG DESCRIPTION 0001',
  manufacturer: 'DEMO MANUFACTURER WITH AN EXTREMELY LONG REGISTERED COMPANY NAME LTD',
  supplier: 'DEMO SUPPLIER WITH A LONG NAME INDUSTRIES PRIVATE LIMITED'
});
Object.assign(rows[2], { manufacturer: '', inwNo: '', netWeight: '' });

const dpiArg = process.argv.indexOf('--dpi');
const dpi = dpiArg > 0 ? Number(process.argv[dpiArg + 1]) : undefined;
const variantArg = process.argv.indexOf('--variant');
const variant = variantArg > 0 ? process.argv[variantArg + 1] : undefined;
const out = (process.argv[2] && !process.argv[2].startsWith('--')) ? process.argv[2] : path.join(root, 'docs/label/samples/zquar-4x6-same-DEMO.pdf');
fs.mkdirSync(path.dirname(out), { recursive: true });
const r = Pdf.generate(jsPDF, rows, texts, { dpi, variant });
fs.writeFileSync(out, Buffer.from(r.doc.output('arraybuffer')));
console.log(`Wrote ${path.relative(root, out)} (${rows.length} labels)`);
r.warnings.forEach((w) => console.log(`  label ${w.label}: ${w.code} ${w.field}`));
