'use strict';

/**
 * tools/check-label-pdf.py against synthetic PDFs (DEMO values only) built here with jsPDF to the 4 x 6 spec
 * (docs/abap/zmm_af_017_4x6-spec.md, section 3); one compliant PDF must PASS, each defect must FAIL its check.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const root = path.resolve(__dirname, '../../..');
let Barcode;
global.sap = { ui: { define: (d, f) => { Barcode = f(); } } };
require(path.join(root, 'app/fiori-app/webapp/modules/wm/handling-unit/util/Barcode.js'));
const { jsPDF } = require(path.join(root, 'app/fiori-app/node_modules/jspdf'));

const MM = 72 / 25.4;
const ASCENT = 0.789;
const TOOL = path.join(root, 'tools/check-label-pdf.py');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'label-check-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const DEMO = {
    'Material Name': 'DEMO MATERIAL 01', 'GRN No.': '9900000001', 'GRN Date': '27/10/2026', 'INW. No': 'DM12345678',
    'Qty. Received': '140.00 KG', 'Container No': '1 OF 14', Manufacturer: 'DEMO MFR', Supplier: 'DEMO SUPPLIER', 'Batch No': 'DM-001',
    'Mfg. Date': '01/10/2026', 'Expiry Date': '01/04/2027', 'Net Weight': '10.00KG'
};
const ROWS = [['Material Name', 13.7, 39.1, 21.0], ['GRN No.', 13.7, 39.1, 33.0], ['GRN Date', 60.2, 78.1, 33.0], ['INW. No', 13.7, 39.1, 40.5],
['Qty. Received', 13.7, 39.1, 48.0], ['Container No', 57.6, 81.2, 48.0], ['Manufacturer', 13.7, 39.1, 55.5], ['Supplier', 13.7, 39.1, 66.5],
['Batch No', 13.7, 39.1, 77.5]];
const COLS = [['Mfg. Date', 13.7], ['Expiry Date', 39.1], ['Net Weight', 66.0]];

/** A label drawn to the spec; `bad` injects one defect. Returns the PDF path. */
function makePdf(name, bad = {}) {
    const H = bad.pageH || 432;
    const doc = new jsPDF({ unit: 'pt', format: [288, H], orientation: 'portrait' });
    const text = (s, xMm, topMm, pt, bold, o = {}) => {
        doc.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(pt);
        doc.text(s, xMm * MM, topMm * MM + ASCENT * pt, o);
    };
    const width = (s, pt, bold) => { doc.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(pt); return doc.getTextWidth(s); };
    doc.setLineWidth(0.5);
    doc.line(12.9 * MM, 0, 12.9 * MM, 112 * MM);
    doc.line(13.7 * MM, 18 * MM, 96.7 * MM, 18 * MM);
    const tw = width('Aether Industries Limited', 18, true);
    text('Aether Industries Limited', (13.7 + 96.7) / 2 - tw / 2 / MM, 4.5, 18, true);
    // strip: rotated 90 degrees counter-clockwise, centred on y 56 mm, inside the 4 mm margin
    let band = 4 * MM;
    [['QUARANTINE', 14, true], ['F-06-01-SOP-WH-002-04/04/202', 9, false]].forEach(([s, pt, b]) => {
        const len = width(s, pt, b);
        doc.setFont('helvetica', b ? 'bold' : 'normal').setFontSize(pt);
        doc.text(s, band + ASCENT * pt, 56 * MM + len / 2, { angle: 90 });
        band += pt + 1.5;
    });
    ROWS.forEach(([cap, cx, vx, top]) => {
        text(cap, cx, top, 10, true);
        const v = bad.values && bad.values[cap];
        text(DEMO[cap], (v && v.x) || vx, top + ((v && v.dTopMm) || 0), (v && v.pt) || 10, false);
    });
    COLS.forEach(([cap, x]) => { text(cap, x, 86.0, 10, true); text(DEMO[cap], x, 91.5, 10, false); });
    text('Prepared by', 13.7, 102.0, 10, true);
    // barcode: Code 128 B, module 4 dots at 203 dpi, quiet zone from x 13.7, bars top 117, height 22
    const value = '9900000001';
    const g = Barcode.bars(value, bad.subset || 'B');
    const module = (bad.dots || 4) * 72 / 203;
    const x0 = (bad.noQuiet ? 13.7 * MM - 10 * module : 13.7 * MM);
    g.bars.forEach((b) => doc.rect(x0 + b.x * module, 117 * MM, b.w * module, 22 * MM, 'F'));
    const first = x0 + 10 * module;
    const last = x0 + (g.total - 10) * module;
    const hw = width(value, 13, false);
    text(value, ((first + last) / 2 - hw / 2) / MM, 140, 13, false);
    const file = path.join(tmp, `${name}.pdf`);
    fs.writeFileSync(file, Buffer.from(doc.output('arraybuffer')));
    return file;
}
const run = (file, ...args) => spawnSync('python3', [TOOL, file, '--json', ...args], { encoding: 'utf8' });
const report = (file, ...args) => JSON.parse(run(file, ...args).stdout);
const status = (rep, name) => (rep.checks.find((c) => c.check === name) || {}).status;

describe('tools/check-label-pdf.py', () => {
    it('a PDF drawn to the spec passes every check, with the measured numbers', () => {
        const r = run(makePdf('ok'));
        const rep = JSON.parse(r.stdout);
        const failed = rep.checks.filter((c) => c.status === 'FAIL');
        expect(failed).toEqual([]);
        expect(r.status).toBe(0);
        expect(rep.status).toBe('PASS');
        expect(rep.checks.find((c) => c.check === 'page size').detail).toMatch(/^288\.00 x 432\.00 pt/);
        expect(rep.checks.find((c) => c.check === 'barcode bars').detail).toMatch(/40 bars, 145 modules, Code 128 subset B, 10 characters, checksum ok/);
        expect(rep.checks.find((c) => c.check === 'barcode narrow bar').detail).toMatch(/0\.500 mm = 4\.00 dots at 203 dpi/);
        expect(rep.checks.find((c) => c.check === 'Container No: value').detail).toMatch(/baseline diff \+0\.00 pt/);
        expect(rep.checks.find((c) => c.check === 'row pitch').status).toBe('INFO');
        expect(rep.texts.some((t) => t.text === 'QUARANTINE' && t.angle === 90)).toBe(true);
    });

    it.each([
        ['wrong page size (288 x 288)', { pageH: 288 }, 'page size'],
        ['narrow bar 3 dots (0.375 mm)', { dots: 3 }, 'barcode narrow bar'],
        ['no left quiet zone', { noQuiet: true }, 'barcode quiet zones'],
        ['subset C instead of B', { subset: 'C' }, 'barcode bars'],
        ['Container No value touching its caption', { values: { 'Container No': { x: 79.0 } } }, 'Container No: value'],
        ['value off the shared baseline', { values: { 'Batch No': { dTopMm: 1.0 } } }, 'Batch No: value'],
        ['value below 9 pt', { values: { 'INW. No': { pt: 8 } } }, 'minimum font size 9 pt']
    ])('fails on %s', (name, bad, check) => {
        const r = run(makePdf(name.replace(/\W+/g, '-'), bad));
        const rep = JSON.parse(r.stdout);
        expect(r.status).toBe(1);
        expect(rep.status).toBe('FAIL');
        expect(status(rep, check)).toBe('FAIL');
    });

    it('--mask shows value shapes instead of values; static texts stay readable', () => {
        const rep = report(makePdf('mask'), '--mask');
        const texts = rep.texts.map((t) => t.text);
        expect(texts).toContain('AAAA AAAAAAAA 99');
        expect(texts).not.toContain('DEMO MATERIAL 01');
        expect(texts).toContain('Material Name');
        expect(JSON.stringify(rep.checks)).not.toContain('DEMO MATERIAL 01');
    });

    it('prints a readable report and exits 2 for something that is not a PDF', () => {
        const out = execFileSync('python3', [TOOL, makePdf('text')], { encoding: 'utf8' });
        expect(out).toMatch(/^text\.pdf page 1\/1: PASS/);
        expect(out).toMatch(/\[PASS\] barcode quiet zones: left 5\.\d\d mm, right \d\.\d\d mm/);
        const notPdf = path.join(tmp, 'x.pdf');
        fs.writeFileSync(notPdf, 'hello');
        const r = spawnSync('python3', [TOOL, notPdf], { encoding: 'utf8' });
        expect(r.status).toBe(2);
        expect(r.stderr).toMatch(/not a PDF/);
    });
});
