'use strict';

/**
 * 4 x 6 in quarantine label (app-drawn): geometry, fitting, barcode and the jsPDF output. Synthetic DEMO data only.
 * No barcode decoder is installed in this repo, so the barcode is checked by bar widths, dot grid and quiet zones.
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
require(R + 'wm/quarantine-label/util/QuarLabelLayout.js');
global.sap.ui.define = (d, f) => { Pdf = f(Layout, HuPdf); };
require(R + 'wm/quarantine-label/util/QuarLabelPdf.js');
const { jsPDF } = require('../../../app/fiori-app/node_modules/jspdf');
const { pdfPageSize } = require('../../../srv/wm/quarantine-label/labelOutput');

const EPS = 1e-6;
const TEXTS = Object.fromEntries(Object.keys(Layout.CAPTION_KEYS).map((k) => [k, `CAP ${k}`]));
TEXTS.empty = '-';
const DEMO = {
    MaterialDescription: 'DEMO MATERIAL 01', MaterialDocument: '9900000001', PostingDate: '2026-10-27',
    Batch: 'DEMO-BATCH-01', SupplierBatch: 'DEMO-SB-01', SupplierName: 'DEMO SUPPLIER', BatchCharacteristics: 'DEMO-CHAR',
    ManufacturingDate: '2026-10-01', DateKind: 'RETEST', DateValue: '2027-04-01', PostedQuantity: '120 KG',
    ContainerQuantity: '40', Unit: 'KG', Container: '1 OF 3', StorageUnit: '00000000009900000001', Text: 'DEMO REMARK'
};
const PT2MM = 25.4 / 72;
const texts = (r) => r.items.filter((i) => i.kind === 'text').map((i) => i.text);

/** Box of a draw item in mm (text: from ascent above the baseline to the line height below it). */
function box(it) {
    if (it.kind === 'fill') return { x0: it.x, y0: it.y, x1: it.x + it.w, y1: it.y + it.h };
    const w = Layout.measureMm(it.text, it.pt, it.bold);
    const x0 = it.align === 'center' ? it.x - w / 2 : it.x;
    const y0 = it.y - it.pt * PT2MM * Layout.ASCENT;
    return { x0, y0, x1: x0 + w, y1: y0 + it.pt * PT2MM * Layout.LH };
}
function inside(b, s) {
    return b.x0 >= s.x - EPS && b.y0 >= s.y - EPS && b.x1 <= s.x + s.w + EPS && b.y1 <= s.y + s.h + EPS;
}
const overlap = (a, b) => a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS;
const pdfBuffer = (rows, opts = {}) => Buffer.from(Pdf.generate(jsPDF, rows, TEXTS, opts).doc.output('arraybuffer'));

describe('Quarantine 4x6 label layout', () => {
    it('page is 4 x 6 in (101.6 x 152.4 mm) with a safe area of at least 4 mm', () => {
        const L = Layout.layout('4x6');
        expect(L.page).toEqual({ wMm: 101.6, hMm: 152.4, wPt: 288, hPt: 432 });
        expect(Layout.DEFAULT_SIZE).toBe('4x6');
        expect(L.safe.x).toBeGreaterThanOrEqual(Layout.MIN_SAFE_MM);
        expect(L.page.wMm - (L.safe.x + L.safe.w)).toBeGreaterThanOrEqual(Layout.MIN_SAFE_MM - EPS);
        expect(L.page.hMm - (L.safe.y + L.safe.h)).toBeGreaterThanOrEqual(Layout.MIN_SAFE_MM - EPS);
    });

    it('PDF MediaBox is exactly 288 x 432 pt on every page, one label per page', () => {
        const buf = pdfBuffer([DEMO, { ...DEMO, StorageUnit: '00000000009900000002' }, { ...DEMO, StorageUnit: '00000000009900000003' }]);
        const boxes = buf.toString('latin1').match(/\/MediaBox\s*\[[^\]]*\]/g);
        expect(boxes).toHaveLength(3);
        expect(pdfPageSize(buf)).toEqual({ widthPt: 288, heightPt: 432 });
        expect(new Set(boxes).size).toBe(1);
        expect(buf.toString('latin1')).toContain('/PrintScaling /None');
    });

    it('blocks, barcode block and title band do not overlap and stay in the safe area', () => {
        const L = Layout.layout('4x6');
        const rects = [L.title, ...L.blocks, L.barcode];
        rects.forEach((r, i) => {
            expect(inside({ x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h }, L.safe)).toBe(true);
            rects.slice(i + 1).forEach((o) => expect(overlap(r, o)).toBe(false));
        });
    });

    it('every field of the layout is on the label: caption and value, in the defined order', () => {
        const L = Layout.layout('4x6');
        const t = texts(Layout.render(L, DEMO, TEXTS));
        expect(L.blocks.map((b) => b.key)).toEqual(['MaterialDescription', ...Layout.GRID.flat().map((c) => c.key)]);
        ['MaterialDescription', 'StorageUnit', ...Layout.GRID.flat().map((c) => c.key).filter((k) => k !== 'DateValue')]
            .forEach((k) => expect(t).toContain(`CAP ${k}`.toUpperCase()));
        expect(t).toContain('CAP retestDate'.toUpperCase()); // DateValue caption follows DateKind
        expect(texts(Layout.render(L, { ...DEMO, DateKind: 'EXPIRY' }, TEXTS))).toContain('CAP expiryDate'.toUpperCase());
        expect(t).toContain('CAP title');
        ['DEMO MATERIAL 01', '9900000001', '2026-10-27', 'DEMO-BATCH-01', 'DEMO-SB-01', 'DEMO SUPPLIER', 'DEMO-CHAR', '2026-10-01',
            '2027-04-01', '120 KG', '40 KG', '1 OF 3', '00000000009900000001', 'DEMO REMARK'].forEach((v) => expect(t).toContain(v));
    });

    it('every drawn item is inside the safe area and every text fits its block width', () => {
        const L = Layout.layout('4x6');
        const long = { ...DEMO, MaterialDescription: 'W'.repeat(40), SupplierName: 'W'.repeat(40), BatchCharacteristics: 'W'.repeat(70), Text: 'W'.repeat(50), PostedQuantity: 'W'.repeat(100) };
        Layout.render(L, long, TEXTS).items.forEach((it) => expect(inside(box(it), L.safe)).toBe(true));
    });

    describe('long values: wrap, then shrink to 6 pt, then "…"', () => {
        const L = Layout.layout('4x6');
        const block = L.blocks.find((b) => b.key === 'SupplierName');
        it('wraps at the nominal size when two lines are enough', () => {
            const f = Layout.fitText('DEMO SUPPLIER WITH A VERY LONG NAME FOR TWO LINES', block.w, block.valuePt, 6, 2, false);
            expect(f).toMatchObject({ pt: block.valuePt, truncated: false });
            expect(f.lines).toHaveLength(2);
        });
        it('shrinks below the nominal size, not below 6 pt, when wrapping is not enough', () => {
            const f = Layout.fitText('DEMO '.repeat(20).trim(), block.w, block.valuePt, 6, 2, false);
            expect(f.truncated).toBe(false);
            expect(f.pt).toBeLessThan(block.valuePt);
            expect(f.pt).toBeGreaterThanOrEqual(6);
        });
        it('cuts with "…" at 6 pt only when still too long, and reports it', () => {
            const f = Layout.fitText('W'.repeat(200), block.w, block.valuePt, 6, 2, false);
            expect(f).toMatchObject({ pt: 6, truncated: true });
            expect(f.lines[f.lines.length - 1].endsWith('…')).toBe(true);
            const r = Layout.render(L, { ...DEMO, SupplierName: 'W'.repeat(200) }, TEXTS);
            expect(r.warnings).toContainEqual({ code: 'truncated', field: 'SupplierName' });
        });
    });

    describe('barcode (Code 128 of the storage unit)', () => {
        it('is present, inside its block, on the printer dot grid, with 10-module quiet zones', () => {
            const L = Layout.layout('4x6');
            const r = Layout.render(L, DEMO, TEXTS);
            const g = Barcode.bars(DEMO.StorageUnit);
            expect(r.barcode.bars).toEqual(g.bars);
            expect(r.barcode.narrowDots).toBeGreaterThanOrEqual(Layout.MIN_DOTS);
            expect(r.barcode.narrowMm).toBeCloseTo(r.barcode.narrowDots * 25.4 / 203, 9);
            expect(Math.abs(r.barcode.x / L.dotMm - Math.round(r.barcode.x / L.dotMm))).toBeLessThan(1e-9);
            const bars = r.items.filter((i) => i.kind === 'fill' && i.y === L.barcode.barY);
            expect(bars).toHaveLength(g.bars.length);
            bars.forEach((b) => {
                expect(Math.abs(b.w / r.barcode.narrowMm - Math.round(b.w / r.barcode.narrowMm))).toBeLessThan(1e-9);
                expect(inside(box(b), L.safe)).toBe(true);
            });
            expect(bars[0].x - r.barcode.x).toBeCloseTo(10 * r.barcode.narrowMm, 9);
            const last = bars[bars.length - 1];
            expect(r.barcode.x + r.barcode.widthMm - (last.x + last.w)).toBeCloseTo(10 * r.barcode.narrowMm, 9);
            expect(r.barcode.x).toBeGreaterThanOrEqual(L.safe.x - EPS);
            expect(r.barcode.x + r.barcode.widthMm).toBeLessThanOrEqual(L.safe.x + L.safe.w + EPS);
        });
        it('uses whole 300 dpi dots when the printer is switched to 300 dpi', () => {
            const L = Layout.layout('4x6', { dpi: 300 });
            const r = Layout.render(L, DEMO, TEXTS);
            expect(L.dotMm).toBeCloseTo(25.4 / 300, 12);
            expect(r.barcode.narrowMm).toBeCloseTo(r.barcode.narrowDots * 25.4 / 300, 9);
        });
        it('rejects a dpi that is not configured', () => {
            expect(() => Layout.layout('4x6', { dpi: 600 })).toThrow(/203, 300/);
        });
        it('warns when the storage unit is too dense for whole 3-dot bars', () => {
            const r = Layout.render(Layout.layout('4x6'), { ...DEMO, StorageUnit: 'DEMO-SU-ABCDEFGHIJK' }, TEXTS);
            expect(r.barcode.narrowDots).toBeLessThan(Layout.MIN_DOTS);
            expect(r.warnings).toContainEqual({ code: 'barcodeDense', field: 'StorageUnit' });
        });
        it('draws no barcode and warns for characters Code 128 B cannot encode', () => {
            const r = Layout.render(Layout.layout('4x6'), { ...DEMO, StorageUnit: 'DEMO-Ü' }, TEXTS);
            expect(r.barcode).toBeNull();
            expect(r.warnings).toContainEqual({ code: 'barcodeInvalid', field: 'StorageUnit' });
        });
    });

    it('empty or missing fields print the empty marker, no barcode, and a warning, without failing', () => {
        const L = Layout.layout('4x6');
        const r = Layout.render(L, { MaterialDocument: '9900000001' }, TEXTS);
        expect(r.barcode).toBeNull();
        expect(r.warnings).toContainEqual({ code: 'barcodeMissing', field: 'StorageUnit' });
        expect(texts(r).filter((s) => s === '-').length).toBe(L.blocks.length); // every block but the document, + storage unit
        expect(texts(r)).toContain('CAP DateValue'.toUpperCase()); // no DateKind -> generic date caption
        r.items.forEach((it) => expect(inside(box(it), L.safe)).toBe(true));
    });

    it('fails loudly when a caption text is missing', () => {
        const { title, ...noTitle } = TEXTS;
        expect(title).toBeDefined();
        expect(() => Layout.render(Layout.layout('4x6'), DEMO, noTitle)).toThrow(/qlLabelTitle/);
    });

    describe('page size from config', () => {
        it('lays out a different size proportionally (3 x 5 in) with everything inside the page', () => {
            const L = Layout.layout({ key: '3x5', widthMm: 76.2, heightMm: 127 });
            expect(L.page).toMatchObject({ wMm: 76.2, hMm: 127 });
            expect(L.safe.x).toBeGreaterThanOrEqual(Layout.MIN_SAFE_MM);
            Layout.render(L, DEMO, TEXTS).items.forEach((it) => expect(inside(box(it), L.safe)).toBe(true));
            const buf = pdfBuffer([DEMO], { size: { key: '3x5', widthMm: 76.2, heightMm: 127 } });
            const s = pdfPageSize(buf);
            expect(s.widthPt).toBeCloseTo(216, 1);
            expect(s.heightPt).toBeCloseTo(360, 1);
        });
        it('refuses a page too small for the layout and an unknown size key', () => {
            expect(() => Layout.layout({ widthMm: 50, heightMm: 25 })).toThrow(/too small/);
            expect(() => Layout.layout('A6')).toThrow(/Unknown label size/);
        });
    });

    it('refuses to render no labels', () => {
        expect(() => Pdf.generate(jsPDF, [], TEXTS, {})).toThrow(/No labels/);
    });
});
