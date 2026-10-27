'use strict';

/**
 * ZQUAR quarantine label at 4 x 6 in (same layout as the SAP label, bigger barcode). Synthetic DEMO data only.
 * Design numbers come from the task (docs/label/zquar-current-layout.md); no barcode decoder is installed, so the
 * barcode is checked against the Code 128 encoder (bar count, module widths, quiet zones, dot grid).
 */
const R = '../../../app/fiori-app/webapp/modules/';
let Barcode, Hu, HuPdf, Layout, Pdf;
global.sap = { ui: { define: (d, f) => { Barcode = f(); }, require: { toUrl: () => '' } } };
require(R + 'wm/handling-unit/util/Barcode.js');
global.sap.ui.define = (d, f) => { Hu = f(Barcode); };
require(R + 'wm/handling-unit/util/HuLabelLayout.js');
global.sap.ui.define = (d, f) => { HuPdf = f(Barcode, Hu); };
require(R + 'wm/handling-unit/util/HuLabelPdf.js');
let Printer;
global.sap.ui.define = (d, f) => { Printer = f(Barcode, Hu); };
require(R + 'wm/handling-unit/util/HuLabelPrinter.js');
global.sap.ui.define = (d, f) => { Layout = f(Barcode, Hu); };
require(R + 'wm/quarantine-label/util/ZquarLabelLayout.js');
global.sap.ui.define = (d, f) => { Pdf = f(Layout, HuPdf, Printer); };
require(R + 'wm/quarantine-label/util/ZquarLabelPdf.js');
let Rows;
global.sap.ui.define = (d, f) => { Rows = f(); };
require(R + 'wm/quarantine-label/util/ZquarLabelRows.js');
const { jsPDF } = require('../../../app/fiori-app/node_modules/jspdf');
const fs = require('fs');
const path = require('path');

const EPS = 1e-6;
const MM = 72 / 25.4;
const i18n = Object.fromEntries(fs.readFileSync(path.join(__dirname, '../../../app/fiori-app/webapp/i18n/i18n_en.properties'), 'utf8')
    .split('\n').filter((l) => /^[\w.]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const TEXTS = Object.fromEntries(Object.entries({ ...Layout.STATIC_KEYS, ...Layout.CAPTION_KEYS, ...Layout.EXTRA_KEYS }).map(([k, key]) => [k, i18n[key]]));
const DEMO = {
    materialName: 'DEMO MATERIAL 01', grnNo: '9900000001', grnDate: '27.10.2026', inwNo: 'DEMO-INW-01', qtyReceived: '140.000 KG',
    containerNo: '1 OF 14', manufacturer: 'DEMO MFR', supplier: 'DEMO SUPPLIER', batchNo: 'DEMO-BATCH-01',
    mfgDate: '01.10.2026', expiryDate: '01.04.2027', netWeight: '10.000 KG', barcode: '9900000001'
};
const L4x6 = () => Layout.layout('4x6');
const textItems = (r) => r.items.filter((i) => i.kind === 'text');
const find = (r, s) => textItems(r).find((i) => i.text === s);
const top = (it) => it.y - it.pt * Layout.ASCENT;
function box(it) {
    if (it.kind === 'bar' || it.kind === 'rule') return { x0: it.x, y0: it.y, x1: it.x + it.w, y1: it.y + it.h };
    if (it.kind === 'line') return { x0: Math.min(it.x1, it.x2), y0: Math.min(it.y1, it.y2), x1: Math.max(it.x1, it.x2), y1: Math.max(it.y1, it.y2) };
    if (it.angle === 90) return { x0: it.band[0], x1: it.band[1], y0: it.y - it.len, y1: it.y };
    const w = Layout.widthPt(it.text, it.pt, it.bold);
    const x0 = it.align === 'center' ? it.x - w / 2 : it.x;
    return { x0, x1: x0 + w, y0: top(it), y1: top(it) + it.pt };
}
const pdf = (rows, opts = {}) => Buffer.from(Pdf.generate(jsPDF, rows, TEXTS, opts).doc.output('arraybuffer')).toString('latin1');

describe('ZQUAR 4 x 6 label', () => {
    it('i18n holds every static text and caption, in both bundles', () => {
        const de = fs.readFileSync(path.join(__dirname, '../../../app/fiori-app/webapp/i18n/i18n.properties'), 'utf8');
        Object.values({ ...Layout.STATIC_KEYS, ...Layout.CAPTION_KEYS, ...Layout.EXTRA_KEYS }).forEach((k) => {
            expect(i18n[k]).toBeTruthy();
            expect(de).toMatch(new RegExp(`^${k}=.+`, 'm'));
        });
    });

    it('PDF: MediaBox exactly 288 x 432 pt on every page, one page per label (14 containers)', () => {
        const rows = Array.from({ length: 14 }, (_, i) => ({ ...DEMO, containerNo: `${i + 1} OF 14`, barcode: String(9900000001 + i) }));
        const s = pdf(rows);
        const boxes = s.match(/\/MediaBox\s*\[[^\]]*\]/g);
        expect(boxes).toHaveLength(14);
        boxes.forEach((b) => expect(b.replace(/\s+/g, ' ')).toMatch(/\[0 0 288\.? 432\.?\]/));
        expect(s).toContain('/PrintScaling /None');
    });

    const fieldsOf = (row = DEMO) => Layout.render(L4x6(), row, TEXTS).fields;
    const fld = (fs, k) => fs.find((f) => f.key === k);

    it('fixed frame of the 4 x 6 design: title, rules, barcode (pt, top-left origin)', () => {
        const L = L4x6();
        expect(L.title.top).toBeCloseTo(19.8, 1);
        expect(L.ruleH.y).toBeCloseTo(51.75, 2);
        expect(L.ruleH.x1).toBeCloseTo(288 - 4 * MM, 6); // same right edge as the values
        expect(L.ruleV.x).toBe(36.7);
        expect(L.ruleV.y0).toBeCloseTo(4 * MM, 9); // both rules inside the 4 mm margin
        expect(L.ruleH.x0).toBe(L.ruleV.x);
        expect(L.barcode.top - L.ruleV.y1).toBeCloseTo(4, 0); // the side rule runs down to the barcode
        expect(L.ruleV.y1 - L.rows.lastBaseline).toBeGreaterThan(30); // room to sign under "Prepared by"
        expect(L.barcode).toMatchObject({ hrTop: 404, hrPt: 14 });
        expect(L.barcode.h).toBeCloseTo(84, 0); // ≈ 30 mm (SAP label 62 pt; 129.5 pt was too big)
        expect(L.barcode.hrTop - (L.barcode.top + L.barcode.h)).toBeCloseTo(3, 0);
    });

    it('rules: solid bars 2 printer dots thick on the dot grid; the horizontal one starts at the vertical one (solid corner)', () => {
        const L = L4x6();
        const [v, h] = Layout.render(L, DEMO, TEXTS).items.filter((i) => i.kind === 'rule');
        const onDot = (n) => Math.abs(n / L.dotPt - Math.round(n / L.dotPt)) < 1e-9;
        [v.x, v.y, v.w, v.h, h.x, h.y, h.w, h.h].forEach((n) => expect(onDot(n)).toBe(true));
        expect(v.w).toBeCloseTo(2 * 72 / 203, 12);
        expect(h.h).toBeCloseTo(2 * 72 / 203, 12);
        expect(h.x).toBe(v.x);
        expect(h.y).toBeGreaterThan(v.y);
        expect(h.x + h.w).toBeLessThanOrEqual(288 - 4 * MM + L.dotPt);
        expect(v.y).toBeGreaterThanOrEqual(4 * MM - L.dotPt);
        // barcode bars on the dot grid too
        const bars = Layout.render(L, DEMO, TEXTS).items.filter((i) => i.kind === 'bar');
        bars.forEach((b) => [b.x, b.y, b.w, b.h].forEach((n) => expect(onDot(n)).toBe(true)));
    });

    it('one centre axis: title, "Prepared by", barcode and its number are centred on the middle of the content', () => {
        const L = L4x6();
        const r = Layout.render(L, DEMO, TEXTS);
        expect(L.axis).toBeCloseTo((38.8 + 288 - 4 * MM) / 2, 9);
        expect(find(r, TEXTS.title)).toMatchObject({ align: 'center', x: L.axis });
        expect(find(r, TEXTS.preparedBy)).toMatchObject({ align: 'center', x: L.axis });
        expect(Math.abs(r.barcode.x0 + r.barcode.widthPt / 2 - L.axis)).toBeLessThanOrEqual(L.dotPt / 2 + EPS);
        expect(textItems(r).filter((i) => i.text === DEMO.barcode).pop().x).toBeCloseTo(r.barcode.x0 + r.barcode.widthPt / 2, 9);
    });

    it('caption and value of a row share one baseline (date columns: value one line below its caption)', () => {
        const fs = fieldsOf();
        fs.filter((f) => f.value && f.col === undefined).forEach((f) => expect(f.value.y).toBeCloseTo(f.caption.y, 9));
        const byRow = {};
        fs.forEach((f) => { (byRow[f.row] = byRow[f.row] || []).push(f.caption.y); });
        Object.values(byRow).forEach((ys) => ys.forEach((y) => expect(y).toBeCloseTo(ys[0], 9)));
        fs.filter((f) => f.col !== undefined).forEach((f) => expect(f.value.y - f.caption.y).toBeCloseTo(9 * Layout.LH + 3, 9));
    });

    it('rows are evenly spaced from the title rule to "Prepared by" (no reserved empty lines)', () => {
        const fs = fieldsOf();
        const rows = [...new Set(fs.map((f) => f.row))].map((r) => fs.find((f) => f.row === r));
        const gaps = rows.slice(1).map((f, i) => f.caption.y - rows[i].caption.y - (rows[i].col !== undefined ? 9 * Layout.LH + 3 : 0));
        gaps.forEach((g) => expect(g).toBeCloseTo(fs.pitch, 9));
        expect(fld(fs, 'preparedBy').caption.y).toBeCloseTo(L4x6().rows.lastBaseline, 9);
        expect(fs.pitch).toBeCloseTo(22, 9); // fixed row pitch (user request: less vertical space)
        expect(fld(fs, 'materialName').caption.y).toBeCloseTo(51.75 + 6 + 11 * Layout.ASCENT, 9);
        expect(fs.pitch).toBeGreaterThan(11 * Layout.LH);
    });

    it('a wrapped value takes a second line only when used; the rows below move, spacing stays even', () => {
        const one = fieldsOf();
        const two = fieldsOf({ ...DEMO, supplier: 'DEMO SUPPLIER WITH A LONG NAME PRIVATE LIMITED INDIA' });
        expect(fld(two, 'supplier').value.lines).toHaveLength(2);
        expect(two.pitch).toBeLessThan(one.pitch);
        expect(fld(two, 'batchNo').caption.y - fld(two, 'supplier').caption.y).toBeCloseTo(two.pitch + 11 * Layout.LH, 9);
        expect(fld(two, 'preparedBy').caption.y).toBeCloseTo(fld(one, 'preparedBy').caption.y, 9);
    });

    it('fonts: every caption 9 bold, every value 11 (no per-field sizes), title 18 bold, minimum 9 everywhere', () => {
        const r = Layout.render(L4x6(), DEMO, TEXTS);
        expect(find(r, TEXTS.title)).toMatchObject({ pt: 18, bold: true, align: 'center' });
        r.fields.forEach((f) => {
            expect(f.caption.pt).toBe(9);
            if (f.value) expect(f.value.pt).toBe(11);
        });
        // GRN No. (10 digits) and the dates fit at 11 pt: nothing shrunk
        ['grnNo', 'grnDate', 'mfgDate', 'expiryDate', 'netWeight', 'containerNo', 'qtyReceived'].forEach((k) => expect(fld(r.fields, k).value.pt).toBe(11));
        textItems(r).forEach((i) => expect(i.pt).toBeGreaterThanOrEqual(Layout.MIN_PT));
    });

    it('columns: left values at x 103.9; right pairs share one caption column; date captions sit over their values', () => {
        const fs = fieldsOf();
        ['materialName', 'grnNo', 'inwNo', 'qtyReceived', 'manufacturer', 'supplier', 'batchNo'].forEach((k) => expect(fld(fs, k).value.x).toBeCloseTo(103.9, 6));
        expect(fld(fs, 'grnDate').caption.x).toBeCloseTo(fld(fs, 'containerNo').caption.x, 9);
        fs.filter((f) => f.col !== undefined).forEach((f) => expect(f.value.x).toBe(f.caption.x));
        expect(fld(fs, 'grnNo').value.x + Layout.widthPt('0000000000', 11, false)).toBeLessThanOrEqual(fld(fs, 'grnDate').caption.x - Layout.GAP + EPS);
        expect(fld(fs, 'grnDate').value.x + Layout.widthPt('00/00/0000', 11, false)).toBeLessThanOrEqual(288 - 4 * MM + EPS);
    });

    it('every caption ends at least 4 pt before its value', () => {
        fieldsOf().filter((f) => f.value && f.col === undefined).forEach((f) => {
            const end = f.caption.x + Layout.widthPt(TEXTS[f.key], f.caption.pt, true);
            expect(f.value.x - end).toBeGreaterThanOrEqual(Layout.GAP - 0.01 - EPS);
        });
    });

    it('every field of the layout table is on the label, captions and values, plus the static texts', () => {
        const r = Layout.render(L4x6(), DEMO, TEXTS);
        const t = textItems(r).map((i) => i.text);
        Object.keys(Layout.CAPTION_KEYS).forEach((k) => expect(t).toContain(TEXTS[k]));
        Object.keys(Layout.STATIC_KEYS).forEach((k) => expect(t).toContain(TEXTS[k]));
        Object.values(DEMO).forEach((v) => expect(t).toContain(v)); // barcode value printed under the bars too
        expect(t.filter((s) => s === DEMO.barcode)).toHaveLength(2); // GRN No. and human-readable (same DEMO value)
    });

    it('strip texts: rotated 90 degrees at normal width (no stretch), inside the 4 mm margin and left of the rule', () => {
        const L = L4x6();
        const r = Layout.render(L, DEMO, TEXTS);
        const q = find(r, TEXTS.quarantine);
        const f = find(r, TEXTS.formNumber);
        [q, f].forEach((it) => {
            expect(it).toMatchObject({ angle: 90, hScale: 1 });
            const b = box(it);
            expect(b.x0).toBeGreaterThanOrEqual(4 * MM - EPS);
            expect(b.x1).toBeLessThan(L.ruleV.x);
            expect(b.y0).toBeGreaterThanOrEqual(4 * MM - EPS);
            expect(b.y1).toBeLessThanOrEqual(L.ruleV.y1 + EPS);
            expect((b.y0 + b.y1) / 2).toBeCloseTo((L.ruleV.y0 + L.ruleV.y1) / 2, 6); // centred on the rule
        });
        expect(q).toMatchObject({ pt: 14, bold: true });
        expect(f).toMatchObject({ pt: 9, bold: false });
        expect(box(q).x1).toBeLessThan(box(f).x0); // QUARANTINE first, then the form number
    });

    it('nothing overflows: every item inside the page, text 4 mm from the edges, bottom at least 10 pt', () => {
        const long = {
            ...DEMO, materialName: 'W'.repeat(120), manufacturer: 'W '.repeat(80), supplier: 'DEMO '.repeat(30),
            qtyReceived: 'W'.repeat(40), containerNo: '14 OF 14', grnNo: 'W'.repeat(20), netWeight: 'W'.repeat(20)
        };
        const L = L4x6();
        Layout.render(L, long, TEXTS).items.forEach((it) => {
            const b = box(it);
            expect(b.x0).toBeGreaterThanOrEqual(-EPS);
            expect(b.y0).toBeGreaterThanOrEqual(-0.25 - EPS);
            expect(b.x1).toBeLessThanOrEqual(288 + EPS);
            expect(b.y1).toBeLessThanOrEqual(432 - 10 + EPS);
            if (it.kind === 'text') {
                expect(b.x0).toBeGreaterThanOrEqual(4 * MM - EPS);
                expect(b.x1).toBeLessThanOrEqual(288 - 4 * MM + EPS);
                expect(b.y0).toBeGreaterThanOrEqual(4 * MM - EPS);
            }
        });
    });

    it('values stay inside their own column (no overlap with the next caption)', () => {
        const long = Object.fromEntries(Object.keys(DEMO).map((k) => [k, 'W'.repeat(60)]));
        const r = Layout.render(L4x6(), { ...long, barcode: DEMO.barcode }, TEXTS);
        r.fields.filter((f) => f.value).forEach((f) => {
            f.value.lines.forEach((line) => expect(f.value.x + Layout.widthPt(line, f.value.pt, false)).toBeLessThanOrEqual(f.value.end + EPS));
        });
    });

    describe('long values: wrap to 2 lines, then shrink to 9 pt, then "…"', () => {
        const L = L4x6();
        const f = fld(fieldsOf(), 'materialName');
        const w = f.value.end - f.value.x;
        it('wraps at 11 pt when two lines are enough', () => {
            const r = Layout.fitText('DEMO MATERIAL WITH A LONGER NAME FOR TWO LINES', w, 11, 2, false);
            expect(r).toMatchObject({ pt: 11, truncated: false });
            expect(r.lines).toHaveLength(2);
        });
        it('shrinks between 11 and 9 pt before cutting', () => {
            const r = Layout.fitText('DEMO '.repeat(10).trim(), w, 11, 2, false);
            expect(r.truncated).toBe(false);
            expect(r.pt).toBeLessThan(11);
            expect(r.pt).toBeGreaterThanOrEqual(9);
        });
        it('cuts with "…" at 9 pt and reports it', () => {
            const r = Layout.fitText('W'.repeat(200), w, 11, 2, false);
            expect(r).toMatchObject({ pt: 9, truncated: true });
            expect(r.lines[1].endsWith('…')).toBe(true);
            expect(Layout.render(L, { ...DEMO, materialName: 'W'.repeat(200) }, TEXTS).warnings).toContainEqual({ code: 'truncated', field: 'materialName' });
        });
    });

    describe('barcode: Code 128 B, bigger, whole-dot module, quiet zones', () => {
        it('10 characters -> 40 bars, 145 modules + 2 x 10 quiet, module 4 dots at 203 dpi, inside the content width', () => {
            const L = L4x6();
            const r = Layout.render(L, DEMO, TEXTS);
            const g = r.barcode;
            const bars = r.items.filter((i) => i.kind === 'bar');
            expect(Barcode.encode(DEMO.barcode, 'B')[0]).toBe(104); // start B, same symbology as today
            expect(bars).toHaveLength(40);
            expect(g.moduleDots).toBe(4);
            expect(g.modulePt).toBeCloseTo(4 * 72 / 203, 12);
            expect(g.totalModules).toBe(11 * (10 + 2) + 13 + 20);
            expect(g.widthPt).toBeCloseTo(165 * 4 * 72 / 203, 9);
            expect(bars[0].x - g.x0).toBeCloseTo(10 * g.modulePt, 9);
            const last = bars[bars.length - 1];
            expect(g.x0 + g.widthPt - (last.x + last.w)).toBeCloseTo(10 * g.modulePt, 9);
            expect(Math.abs(g.x0 + g.widthPt / 2 - L.axis)).toBeLessThanOrEqual(L.dotPt / 2 + EPS); // centred, snapped to a dot
            expect(g.x0).toBeGreaterThanOrEqual(38.8 - EPS);
            expect(g.x0 + g.widthPt).toBeLessThanOrEqual(288 - 4 * MM + EPS);
            expect(Math.abs(g.x0 / L.dotPt - Math.round(g.x0 / L.dotPt))).toBeLessThan(1e-9);
            bars.forEach((b) => {
                expect(b).toMatchObject({ y: L.barcode.top, h: L.barcode.h });
                expect(Math.abs(b.w / g.modulePt - Math.round(b.w / g.modulePt))).toBeLessThan(1e-9);
                expect([1, 2, 3, 4]).toContain(Math.round(b.w / g.modulePt));
            });
            const hrItem = textItems(r).filter((i) => i.text === DEMO.barcode).pop();
            expect(hrItem.pt).toBe(14);
            expect(hrItem.align).toBe('center'); // centred under the bars
            expect(hrItem.x).toBeCloseTo((bars[0].x + last.x + last.w) / 2, 9);
            expect(top(hrItem)).toBeCloseTo(404, 6);
        });
        it('300 dpi: target 6 whole dots when it fits; 10 characters need 237.6 pt at 6 dots, so 5 dots (largest that fits)', () => {
            const L = Layout.layout('4x6', { dpi: 300 });
            expect(Layout.barcodeGeometry(L, '990001')).toMatchObject({ moduleDots: 6 });
            const g = Layout.render(L, DEMO, TEXTS).barcode;
            expect(165 * 6 * 72 / 300).toBeGreaterThan(273.9 - g.x0);
            expect(g.moduleDots).toBe(5);
            expect(g.modulePt).toBeCloseTo(5 * 72 / 300, 12);
            expect(g.modulePt * 25.4 / 72).toBeGreaterThanOrEqual(0.375);
        });
        it('a longer value takes the largest whole-dot module that fits, never below 0.375 mm', () => {
            const g = Layout.barcodeGeometry(L4x6(), 'DEMO-123456');
            expect(g.moduleDots).toBe(3);
            expect(g.modulePt * 25.4 / 72).toBeGreaterThanOrEqual(0.375 - EPS);
            expect(g.widthPt).toBeLessThanOrEqual(273.9 - g.x0 + EPS);
        });
        it('fails with a clear error when even the minimum module does not fit (never squeezed)', () => {
            expect(() => Layout.barcodeGeometry(L4x6(), 'DEMO-1234567890123')).toThrow(/too long for the label.*0\.375 mm/);
            expect(() => Layout.layout('4x6', { dpi: 600 })).toThrow(/203, 300/);
        });
    });

    it('empty values keep their space: positions do not depend on the data', () => {
        const L = L4x6();
        const full = Layout.render(L, DEMO, TEXTS);
        const empty = Layout.render(L, { barcode: DEMO.barcode }, TEXTS);
        const capsOf = (r) => textItems(r).filter((i) => i.bold).map((i) => [i.text, i.x, i.y]);
        expect(capsOf(empty)).toEqual(capsOf(full));
        expect(textItems(empty).filter((i) => !i.bold && !i.angle).map((i) => i.text)).toEqual([DEMO.barcode]);
        expect(Layout.render(L, { ...DEMO, barcode: '' }, TEXTS).warnings).toContainEqual({ code: 'barcodeMissing', field: 'barcode' });
    });

    it('fails loudly when a static text or caption is missing', () => {
        const { title, ...rest } = TEXTS;
        expect(title).toBeTruthy();
        expect(() => Layout.render(L4x6(), DEMO, rest)).toThrow(/zqTitle/);
    });

    describe('size from config', () => {
        it('4 x 5 in lays out proportionally with everything inside the page', () => {
            const L = Layout.layout({ key: '4x5', widthIn: 4, heightIn: 5 });
            expect(L.page).toEqual({ wPt: 288, hPt: 360 });
            const r = Layout.render(L, DEMO, TEXTS);
            r.items.forEach((it) => { const b = box(it); expect(b.y1).toBeLessThanOrEqual(360 + EPS); expect(b.x1).toBeLessThanOrEqual(288 + EPS); });
            textItems(r).forEach((i) => expect(i.pt).toBeGreaterThanOrEqual(9));
            expect(pdf([DEMO], { size: { key: '4x5', widthIn: 4, heightIn: 5 } })).toMatch(/\/MediaBox\s*\[0 0 288\.? 360\.?\]/);
        });
        it('refuses a page too small and an unknown size key', () => {
            expect(() => Layout.layout({ widthIn: 4, heightIn: 3 })).toThrow(/too small/);
            expect(() => Layout.layout('A6')).toThrow(/Unknown label size/);
        });
    });

    it('refuses to render no labels', () => {
        expect(() => Pdf.generate(jsPDF, [], TEXTS, {})).toThrow(/No labels/);
    });

    it('Code 128 encoder: subset B on request, subset C stays the default for digits (HU label unchanged)', () => {
        expect(Barcode.encode('2000019997')[0]).toBe(105);
        expect(Barcode.encode('2000019997', 'B')[0]).toBe(104);
        expect(Barcode.bars('2000019997', 'B').bars).toHaveLength(40);
    });

    describe('Phase B: CAP label rows -> label fields (mapping decided with the user)', () => {
        // One CAP row as QuarantineLabelService.labelRows returns it (synthetic DEMO data)
        const capRow = {
            MaterialDescription: 'DEMO MATERIAL 01', MaterialDocument: '9900000001', PostingDate: '2026-10-27', Batch: 'DEMOB1',
            SupplierBatch: 'DM-001', SupplierName: 'DEMO SUPPLIER', BatchCharacteristics: 'DEMO-MFR', ManufacturingDate: '2026-10-01',
            DateKind: 'EXPIRY', DateValue: '2027-04-01', PostedQuantity: '140.00 KG', ContainerQuantity: '10.005', Unit: 'KG',
            Container: '1 OF 14', StorageUnit: '00000000009900000001', Text: 'DM12345678'
        };
        it('maps every label field, with DD/MM/YYYY dates, 2-decimal net weight without a space and no leading zeros', () => {
            expect(Rows.toLabels([capRow], TEXTS)).toEqual([{
                materialName: 'DEMO MATERIAL 01', grnNo: '9900000001', grnDate: '27/10/2026', inwNo: 'DM12345678',
                qtyReceived: '140.00 KG', containerNo: '1 OF 14', manufacturer: 'DEMO-MFR', supplier: 'DEMO SUPPLIER',
                batchNo: 'DM-001', mfgDate: '01/10/2026', expiryDate: '01/04/2027', netWeight: '10.01KG', barcode: '9900000001',
                captions: undefined
            }]);
        });
        it('formats match the shapes measured on the current label', () => {
            const [l] = Rows.toLabels([capRow], TEXTS);
            expect(l.grnNo).toMatch(/^\d{10}$/);
            [l.grnDate, l.mfgDate, l.expiryDate].forEach((d) => expect(d).toMatch(/^\d\d\/\d\d\/\d{4}$/));
            expect(l.qtyReceived).toMatch(/^\d+\.\d\d [A-Z]+$/);
            expect(l.netWeight).toMatch(/^\d+\.\d\d[A-Z]+$/);
            expect(l.containerNo).toMatch(/^\d+ OF \d+$/);
            expect(l.barcode).toMatch(/^\d{10}$/);
        });
        it('a retest date keeps its own caption instead of "Expiry Date"', () => {
            const [l] = Rows.toLabels([{ ...capRow, DateKind: 'RETEST' }], TEXTS);
            expect(l.captions).toEqual({ expiryDate: TEXTS.retestDate });
            const r = Layout.render(L4x6(), l, TEXTS);
            expect(textItems(r).map((i) => i.text)).toContain('Retest Date');
            expect(textItems(r).map((i) => i.text)).not.toContain(TEXTS.expiryDate);
        });
        it('empty or odd values: empty dates and weights stay empty, alphanumeric storage units keep their zeros', () => {
            const [l] = Rows.toLabels([{ Container: '1 OF 1', StorageUnit: '00DEMO', DateValue: '', ContainerQuantity: '' }], TEXTS);
            expect(l).toMatchObject({ grnDate: '', expiryDate: '', netWeight: '', barcode: '00DEMO', inwNo: '', batchNo: '' });
            expect(Rows.twoDecimals('5.000-')).toBe('5.000-'); // not a number: unchanged, never guessed
            expect(Rows.withoutLeadingZeros('0000000000')).toBe('0');
        });
        it('CAP rows -> mapping -> renderer -> PDF: one 288 x 432 pt page per container', () => {
            const rows = Array.from({ length: 3 }, (_, i) => ({ ...capRow, Container: `${i + 1} OF 3`, StorageUnit: `0000000000990000000${i + 1}` }));
            const g = Pdf.generate(jsPDF, Rows.toLabels(rows, TEXTS), TEXTS, {});
            const s = Buffer.from(g.doc.output('arraybuffer')).toString('latin1');
            expect(s.match(/\/MediaBox\s*\[[^\]]*\]/g)).toHaveLength(3);
            expect(g.warnings).toEqual([]);
        });
        it('a storage unit too long for the barcode fails with a coded error naming the label', () => {
            const rows = Rows.toLabels([capRow, { ...capRow, StorageUnit: 'DEMO-STORAGE-UNIT-20' }], TEXTS);
            expect(() => Pdf.generate(jsPDF, rows, TEXTS, {})).toThrow(expect.objectContaining({ code: 'barcodeTooLong', label: 2 }));
        });
    });
    describe('print document (exact label size, no fit-to-page)', () => {
        const rows = [DEMO, { ...DEMO, supplier: 'A & B <Ltd>', containerNo: '2 OF 14', barcode: '9900000002' }];
        const html = () => Pdf.buildHtml(rows, TEXTS, {});

        it('@page is exactly the label (288 x 432 pt) with no margin; one SVG page of that size per label', () => {
            const h = html();
            expect(h).toContain('@page{size:288pt 432pt;margin:0}');
            const svgs = h.match(/<svg [^>]*>/g);
            expect(svgs).toHaveLength(2);
            svgs.forEach((t) => expect(t).toContain('width="288pt" height="432pt" viewBox="0 0 288 432"'));
            expect(h).toMatch(/\.zq\{display:block;break-after:page/);
        });

        it('draws exactly the PDF draw list: same bars, rules and texts at the same coordinates', () => {
            const page = html().split('<svg ')[1];
            const r = Layout.render(L4x6(), DEMO, TEXTS);
            const bars = r.items.filter((i) => i.kind === 'bar');
            expect(page.match(/<rect /g)).toHaveLength(bars.length + 2); // bars + the two rules
            expect(page).toContain(`<rect x="${bars[0].x}" y="${bars[0].y}" width="${bars[0].w}" height="${bars[0].h}"`);
            expect(page).not.toContain('<line ');
            textItems(r).forEach((t) => expect(page).toContain(`translate(${t.x} ${t.y})`));
            const q = find(r, TEXTS.quarantine);
            expect(page).toContain(`translate(${q.x} ${q.y}) rotate(-90)" font-size="${q.pt}" font-weight="bold">${TEXTS.quarantine}<`);
            expect(page).toContain('text-anchor="middle">' + TEXTS.title + '<');
        });

        it('escapes values and refuses an undrawable label by number', () => {
            expect(html()).toContain('A &amp; B &lt;Ltd&gt;');
            expect(() => Pdf.buildHtml([DEMO, { ...DEMO, barcode: '9'.repeat(40) }], TEXTS, {}))
                .toThrow(expect.objectContaining({ code: 'barcodeTooLong', label: 2 }));
            expect(() => Pdf.buildHtml([], TEXTS, {})).toThrow('No labels');
        });

        it('print() hands the document to the shared HU iframe printer; errors reject without printing', async () => {
            const spy = jest.spyOn(Printer, 'printHtml').mockResolvedValue();
            await Pdf.print(rows, TEXTS, {});
            expect(spy).toHaveBeenCalledWith(html());
            spy.mockClear();
            await expect(Pdf.print([], TEXTS, {})).rejects.toThrow('No labels');
            expect(spy).not.toHaveBeenCalled();
            spy.mockRestore();
        });
    });
});
