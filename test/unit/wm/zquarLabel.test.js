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
global.sap.ui.define = (d, f) => { Layout = f(Barcode, Hu); };
require(R + 'wm/quarantine-label/util/ZquarLabelLayout.js');
global.sap.ui.define = (d, f) => { Pdf = f(Layout, HuPdf); };
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
    if (it.kind === 'bar') return { x0: it.x, y0: it.y, x1: it.x + it.w, y1: it.y + it.h };
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

    it('positions follow the 4 x 6 design (tops in pt, top-left origin)', () => {
        const L = L4x6();
        const cap = (k) => L.fields.find((f) => f.key === k);
        expect(L.title.top).toBeCloseTo(19.8, 1);
        expect(L.ruleH.y).toBeCloseTo(51.75, 2);
        expect(L.ruleV).toMatchObject({ x: 36.7, y0: 0 });
        expect(L.ruleV.y1).toBeCloseTo(336, 6);
        [['materialName', 58.2], ['grnNo', 101.4], ['grnDate', 102.6], ['inwNo', 125.1], ['qtyReceived', 151.2], ['containerNo', 151.2],
            ['manufacturer', 176.25], ['supplier', 216.0], ['batchNo', 249.3], ['mfgDate', 271.8], ['preparedBy', 318.75]]
            .forEach(([k, t]) => expect(cap(k).caption.top).toBeCloseTo(t, 1));
        expect(cap('mfgDate').value.top).toBeCloseTo(290.85, 1);
        expect(L.barcode).toMatchObject({ top: 340, h: 62, hrTop: 405, hrPt: 13 });
        expect(cap('materialName').value.x).toBeCloseTo(103.9, 6); // user decision: +1 pt
        expect(cap('grnDate').value.x).toBeCloseTo(226.2, 6);
        expect(cap('containerNo').value.x).toBeCloseTo(230.7, 6);
    });

    it('fonts: captions 9, values 11, GRN / net weight values 10.5, title 18 bold, minimum 9 everywhere', () => {
        const L = L4x6();
        const r = Layout.render(L, DEMO, TEXTS);
        expect(find(r, TEXTS.title)).toMatchObject({ pt: 18, bold: true, align: 'center' });
        L.fields.forEach((f) => {
            expect(f.caption.pt).toBe(9);
            if (f.value) expect(f.value.pt).toBe(['grnNo', 'grnDate', 'netWeight'].includes(f.key) ? 10.5 : 11);
        });
        textItems(r).forEach((i) => expect(i.pt).toBeGreaterThanOrEqual(Layout.MIN_PT));
    });

    it('every caption ends at least 4 pt before its value (fixes the two measured collisions)', () => {
        const L = L4x6();
        // same-row values only; the date columns print their values on the row below the captions
        L.fields.filter((f) => f.value && f.value.top === f.caption.top).forEach((f) => {
            const end = f.caption.x + Layout.widthPt(TEXTS[f.key], f.caption.pt, true);
            expect(f.value.x - end).toBeGreaterThanOrEqual(Layout.GAP - EPS);
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

    it('strip texts: rotated 90 degrees, stretched x1.5 along the strip, inside the 4 mm margin and left of the rule', () => {
        const L = L4x6();
        const r = Layout.render(L, DEMO, TEXTS);
        const q = find(r, TEXTS.quarantine);
        const f = find(r, TEXTS.formNumber);
        [q, f].forEach((it) => {
            expect(it).toMatchObject({ angle: 90, hScale: 1.5 });
            const b = box(it);
            expect(b.x0).toBeGreaterThanOrEqual(4 * MM - EPS);
            expect(b.x1).toBeLessThan(L.ruleV.x);
            expect(b.y0).toBeGreaterThanOrEqual(4 * MM - EPS);
            expect(b.y1).toBeLessThanOrEqual(L.ruleV.y1 + EPS);
            expect((b.y0 + b.y1) / 2).toBeCloseTo(L.ruleV.y1 / 2, 6); // centred on the strip
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
        const L = L4x6();
        const long = Object.fromEntries(Object.keys(DEMO).map((k) => [k, 'W'.repeat(60)]));
        const r = Layout.render(L, { ...long, barcode: DEMO.barcode }, TEXTS);
        L.fields.filter((f) => f.value).forEach((f) => {
            textItems(r).filter((i) => !i.bold && i.x === f.value.x && i.y > f.value.top && i.y < f.value.top + f.value.maxLines * f.value.pt * 1.3)
                .forEach((i) => expect(box(i).x1).toBeLessThanOrEqual(f.value.end + EPS));
        });
    });

    describe('long values: wrap to 2 lines, then shrink to 9 pt, then "…"', () => {
        const L = L4x6();
        const f = L.fields.find((x) => x.key === 'materialName');
        const w = f.value.end - f.value.x;
        it('wraps at 11 pt when two lines are enough', () => {
            const r = Layout.fitText('DEMO MATERIAL WITH A NAME FOR TWO LINES', w, 11, 2, false);
            expect(r).toMatchObject({ pt: 11, truncated: false });
            expect(r.lines).toHaveLength(2);
        });
        it('shrinks between 11 and 9 pt before cutting', () => {
            const r = Layout.fitText('DEMO '.repeat(9).trim(), w, 11, 2, false);
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
            expect(Math.abs(g.x0 - 38.8)).toBeLessThanOrEqual(L.dotPt / 2 + EPS); // quiet zone starts at x 38.8, snapped to a dot
            expect(g.x0 + g.widthPt).toBeLessThanOrEqual(273.9 + EPS);
            expect(Math.abs(g.x0 / L.dotPt - Math.round(g.x0 / L.dotPt))).toBeLessThan(1e-9);
            bars.forEach((b) => {
                expect(b).toMatchObject({ y: 340, h: 62 });
                expect(Math.abs(b.w / g.modulePt - Math.round(b.w / g.modulePt))).toBeLessThan(1e-9);
                expect([1, 2, 3, 4]).toContain(Math.round(b.w / g.modulePt));
            });
            const hrItem = textItems(r).filter((i) => i.text === DEMO.barcode).pop();
            expect(hrItem.pt).toBe(13);
            expect(hrItem.x - bars[0].x).toBeCloseTo(10.6, 6);
            expect(top(hrItem)).toBeCloseTo(405, 6);
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
});
