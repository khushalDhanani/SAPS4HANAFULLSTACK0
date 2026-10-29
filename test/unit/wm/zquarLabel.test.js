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
    materialName: 'DEMO MATERIAL 01', itemCode: '000000000000123456', grnNo: '9900000001', grnDate: '27.10.2026', inwNo: 'DEMO-INW-01', qtyReceived: '140.000 KG',
    containerNo: '1 OF 14', manufacturer: 'DEMO MFR', supplier: 'DEMO SUPPLIER', batchNo: 'DEMO-BATCH-01',
    mfgDate: '01.10.2026', expiryDate: '01.04.2027', netWeight: '10.000 KG', barcode: '9900000001'
};
const L4x6 = () => Layout.layout('4x6');
const textItems = (r) => r.items.filter((i) => i.kind === 'text');
const find = (r, s) => textItems(r).find((i) => i.text === s);
const top = (it) => it.y - it.pt * Layout.ASCENT;
function box(it) {
    if (it.kind === 'bar' || it.kind === 'sep') return { x0: it.x, y0: it.y, x1: it.x + it.w, y1: it.y + it.h };
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

    it('adds 2 CSS px of outer breathing space without changing page size', () => {
        const L = L4x6();
        expect(L.edge).toBeCloseTo(4 * MM + 1.5);
        expect(L.title.top).toBe(15.5);
        expect(L.barcode.hrTop + L.barcode.hrPt).toBe(432 - 15.5);
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
    const seps = (r) => r.items.filter((i) => i.kind === 'sep');
    const ORDER = ['materialName', 'itemCode', 'grnNo', 'grnDate', 'inwNo', 'qtyReceived', 'containerNo', 'manufacturer', 'supplier', 'batchNo', 'mfgDate', 'expiryDate', 'netWeight', 'preparedBy'];

    it('one field per row, in the required order, each caption on its own line (no two fields share a baseline)', () => {
        const fs = fieldsOf();
        expect(fs.map((f) => f.key)).toEqual(ORDER);
        const ys = fs.map((f) => f.caption.y);
        ys.slice(1).forEach((y, i) => expect(y).toBeGreaterThan(ys[i] + 9)); // strictly increasing, more than a caption height apart
        expect(new Set(ys).size).toBe(14); // Prepared by is a normal row (last)
        fs.forEach((f) => expect(f.value.y).toBeCloseTo(f.caption.y, 9)); // caption and value share one baseline
    });

    it('frame: title, hairline, QUARANTINE with the SOP no. directly below, hairline, rows, then bars 100 pt high (was 84) and the number below', () => {
        const L = L4x6();
        const r = Layout.render(L, DEMO, TEXTS);
        expect(L.page).toEqual({ wPt: 288, hPt: 432 });
        expect(L.barcode.h).toBeGreaterThanOrEqual(100 - L.dotPt);
        expect(L.barcode.hrTop - (L.barcode.top + L.barcode.h)).toBeCloseTo(3, 0);
        expect(L.barcode.hrTop + L.barcode.hrPt).toBeLessThanOrEqual(432 - 10); // number inside the page, clear of the edge
        const t = box(find(r, TEXTS.title));
        const q = box(find(r, TEXTS.quarantine));
        const s = box(find(r, TEXTS.formNumber));
        const ss = seps(r);
        const first = fieldsOf()[0];
        expect(t.y0).toBeGreaterThanOrEqual(4 * MM - EPS);
        // vertical order with clear white space between every pair (no overlap)
        expect(t.y1 + 2).toBeLessThan(ss[0].y);          // title -> hairline 1
        expect(ss[0].y + ss[0].h + 6).toBeLessThan(q.y0); // hairline 1 -> QUARANTINE
        const gap = (find(r, TEXTS.formNumber).y - 0.718 * 9) - find(r, TEXTS.quarantine).y; // cap-letter baseline -> SOP cap top
        expect(gap).toBeGreaterThanOrEqual(4);            // QUARANTINE -> SOP no.: clear ...
        expect(gap).toBeLessThan(12);                     // ... and directly below
        expect(s.y1 + 2).toBeLessThan(ss[1].y);          // SOP no. -> hairline 2
        expect(ss[1].y).toBeLessThan(first.slot.y0 + 1);  // hairline 2 is the top of the first row
        expect(find(r, TEXTS.quarantine).pt).toBeGreaterThan(find(r, TEXTS.title).pt - 1); // a main title, not a row
        // last row (Prepared by) well clear of the bars
        const prep = fieldsOf().find((f) => f.key === 'preparedBy');
        expect(L.barcode.top - (prep.value.y + 0.21 * prep.value.pt)).toBeGreaterThanOrEqual(6);
    });

    it('separators: 15 hairlines (under the title, under QUARANTINE/SOP and between the rows), 5 % opacity, on the dot grid, full content width, never touching text', () => {
        const L = L4x6();
        const r = Layout.render(L, DEMO, TEXTS);
        const ss = seps(r);
        expect(ss).toHaveLength(15);
        const onDot = (n) => Math.abs(n / L.dotPt - Math.round(n / L.dotPt)) < 1e-9;
        ss.forEach((s) => {
            expect(s.opacity).toBe(0.05);
            [s.x, s.y, s.w, s.h].forEach((n) => expect(onDot(n)).toBe(true));
            expect(s.h).toBeCloseTo(2 * 72 / 203, 12);
            expect(s.x).toBeGreaterThanOrEqual(4 * MM - EPS);
            expect(s.x + s.w).toBeLessThanOrEqual(288 - 4 * MM + EPS);
        });
        // no hairline intersects any text (rows, title, QUARANTINE block, Prepared by, barcode number)
        textItems(r).forEach((t) => {
            const g0 = t.y - 0.718 * t.pt;
            const g1 = t.y + 0.21 * t.pt;
            ss.forEach((s) => expect(s.y + s.h <= g0 || s.y >= g1).toBe(true));
        });
        // equal spacing of a one-line row: hairlines one slot apart
        const ys = ss.slice(1).map((s) => s.y);
        ys.slice(1).forEach((y, i) => expect(y - ys[i]).toBeCloseTo(fieldsOf().pitch, 0));
    });

    it('one centre axis: title, QUARANTINE, SOP no., barcode and its number are centred on the page', () => {
        const L = L4x6();
        const r = Layout.render(L, DEMO, TEXTS);
        expect(L.axis).toBe(144);
        [TEXTS.title, TEXTS.quarantine, TEXTS.formNumber].forEach((s) => expect(find(r, s)).toMatchObject({ align: 'center', x: 144 }));
        expect(Math.abs(r.barcode.x0 + r.barcode.widthPt / 2 - L.axis)).toBeLessThanOrEqual(L.dotPt / 2 + EPS);
        expect(textItems(r).filter((i) => i.text === DEMO.barcode).pop().x).toBeCloseTo(r.barcode.x0 + r.barcode.widthPt / 2, 9);
    });

    it('fonts: every caption 9 bold, every value 10 (no per-field sizes), title 16 bold, QUARANTINE 18 bold, minimum 9 everywhere', () => {
        const r = Layout.render(L4x6(), DEMO, TEXTS);
        expect(find(r, TEXTS.title)).toMatchObject({ pt: 16, bold: true });
        expect(find(r, TEXTS.quarantine)).toMatchObject({ pt: 18, bold: true });
        expect(find(r, TEXTS.formNumber)).toMatchObject({ pt: 9, bold: false });
        r.fields.forEach((f) => {
            expect(f.caption.pt).toBe(9);
            expect(f.value.pt).toBe(10);
        });
        textItems(r).forEach((i) => expect(i.pt).toBeGreaterThanOrEqual(Layout.MIN_PT));
    });

    it('columns: every caption at the left margin, every value in one column right of the widest caption', () => {
        const fs = fieldsOf();
        const x = fs[0].value.x;
        fs.forEach((f) => {
            expect(f.caption.x).toBeCloseTo(4 * MM + 1.5, 9);
            expect(f.value.x).toBe(x);
            const end = f.caption.x + Layout.widthPt(TEXTS[f.key], f.caption.pt, true);
            expect(x - end).toBeGreaterThanOrEqual(Layout.GAP - EPS); // caption ends at least 4 pt before its value
        });
    });

    it('a wrapped value makes its own row taller only; the rows share the rest evenly and the block end does not move', () => {
        const one = fieldsOf();
        const two = fieldsOf({ ...DEMO, supplier: 'DEMO SUPPLIER WITH A LONG NAME PRIVATE LIMITED INDIA AND SONS TRADING' });
        expect(fld(two, 'supplier').value.lines).toHaveLength(3);
        expect(two.pitch).toBeLessThan(one.pitch);
        expect(fld(two, 'supplier').slot.y1 - fld(two, 'supplier').slot.y0).toBeCloseTo(two.pitch + 2 * two.find((f) => f.key === 'supplier').value.pt * Layout.LH, 9);
        expect(fld(two, 'preparedBy').slot.y1).toBeCloseTo(fld(one, 'preparedBy').slot.y1, 9);
    });

    it('every field of the layout table is on the label, captions and values, plus the static texts', () => {
        const r = Layout.render(L4x6(), DEMO, TEXTS);
        const t = textItems(r).map((i) => i.text);
        Object.keys(Layout.CAPTION_KEYS).forEach((k) => expect(t).toContain(TEXTS[k]));
        Object.keys(Layout.STATIC_KEYS).forEach((k) => expect(t).toContain(TEXTS[k]));
        Object.values(DEMO).forEach((v) => expect(t).toContain(v)); // barcode value printed under the bars too
        expect(t.filter((s) => s === DEMO.barcode)).toHaveLength(2); // GRN No. and human-readable (same DEMO value)
    });

    // Worst realistic row: values at SAP field lengths (MAKTX 40, two BUT000 name lines, AUSP ATWRT 70, P_TEXT 50,
    // LICHA 15), long quantities and a 3-digit container count. Every value must print in full.
    const LONGEST = {
        ...DEMO,
        materialName: 'SODIUM HYDROXIDE PELLETS EXTRA PURE 99%', // 40
        manufacturer: 'DYNAMIC CHEMICALS MANUFACTURING PRIVATE LIMITED UNIT II GUJARAT INDIA', // 70
        supplier: 'DYNAMIC MERCANTILE PRIVATE LIMITED INDIA TRADING AND DISTRIBUTION DIVISION',
        inwNo: 'INWARD 2026/10/27 GATE 3 VEHICLE GJ06AB1234 LOT 7', // 50
        batchNo: 'SUPBATCH-123456', qtyReceived: '123456.789 KG', containerNo: '100 OF 140', netWeight: '12345.67KG',
        grnDate: '27/10/2026', mfgDate: '01/10/2026', expiryDate: '30/09/2028'
    };
    const textOf = (f) => f.value.lines.join(' ');

    it('nothing overflows: every item inside the page, text 4 mm from the edges, text and barcode at least 10 pt from the bottom', () => {
        const L = L4x6();
        Layout.render(L, LONGEST, TEXTS).items.forEach((it) => {
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

    it('values stay inside their own column and rows never overlap, even with the longest values', () => {
        const r = Layout.render(L4x6(), LONGEST, TEXTS);
        r.fields.filter((f) => f.value).forEach((f) => {
            f.value.lines.forEach((line) => expect(f.value.x + Layout.widthPt(line, f.value.pt, false)).toBeLessThanOrEqual(f.value.end + EPS));
        });
        // every row's glyphs stay inside its own slot: rows never overlap and never touch a hairline
        r.fields.forEach((f) => {
            const last = f.value.y + (f.value.lines.length - 1) * f.value.pt * Layout.LH;
            expect(f.value.y - 0.718 * f.value.pt).toBeGreaterThan(f.slot.y0);
            expect(last + 0.21 * f.value.pt).toBeLessThan(f.slot.y1);
        });
        r.fields.slice(1).forEach((f, i) => expect(f.slot.y0).toBeCloseTo(r.fields[i].slot.y1, 9));
    });

    describe('long values are never cut: wrap, then shrink to 9 pt, then more lines', () => {
        const f = fld(fieldsOf(), 'materialName');
        const w = f.value.end - f.value.x;
        it('wraps at 10 pt when two lines are enough', () => {
            const r = Layout.fitText('DEMO MATERIAL WITH A LONGER NAME FOR TWO LINES', w, 10, 2, false);
            expect(r).toMatchObject({ pt: 10, truncated: false });
            expect(r.lines).toHaveLength(2);
        });
        it('shrinks between 10 and 9 pt before adding lines', () => {
            const r = Layout.fitText('DEMO '.repeat(14).trim(), w, 10, 2, false);
            expect(r.truncated).toBe(false);
            expect(r.pt).toBeLessThan(10);
            expect(r.pt).toBeGreaterThanOrEqual(9);
            expect(r.lines.join(' ')).toBe('DEMO '.repeat(14).trim());
        });
        it('at 9 pt uses more lines instead of "…"', () => {
            const s = 'DEMO MATERIAL '.repeat(8).trim();
            const r = Layout.fitText(s, w, 10, 2, false);
            expect(r).toMatchObject({ pt: 9, truncated: false });
            expect(r.lines.length).toBeGreaterThan(2);
            expect(r.lines.join(' ')).toBe(s);
        });
        it('every field of the longest realistic row prints in full: no "…", no warning', () => {
            const r = Layout.render(L4x6(), LONGEST, TEXTS);
            ['materialName', 'manufacturer', 'supplier', 'inwNo', 'batchNo', 'qtyReceived', 'containerNo', 'netWeight', 'grnNo', 'grnDate']
                .forEach((k) => expect(textOf(fld(r.fields, k))).toBe(LONGEST[k]));
            textItems(r).forEach((i) => expect(i.text).not.toContain('…'));
            expect(r.warnings).toEqual([]);
        });
        it('a label that cannot hold all its text is refused with a coded error, never printed cut', () => {
            const absurd = Object.fromEntries(Object.keys(DEMO).map((k) => [k, 'WWWW '.repeat(40).trim()]));
            expect(() => Layout.render(L4x6(), { ...absurd, barcode: DEMO.barcode }, TEXTS))
                .toThrow(expect.objectContaining({ code: 'labelTooFull' }));
            expect(() => Pdf.buildHtml([DEMO, { ...absurd, barcode: DEMO.barcode }], TEXTS, {}))
                .toThrow(expect.objectContaining({ code: 'labelTooFull', label: 2 }));
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
            expect(g.x0).toBeGreaterThanOrEqual(4 * MM - EPS);
            expect(g.x0 + g.widthPt).toBeLessThanOrEqual(288 - 4 * MM + EPS);
            expect(Math.abs(g.x0 / L.dotPt - Math.round(g.x0 / L.dotPt))).toBeLessThan(1e-9);
            bars.forEach((b) => {
                expect(b).toMatchObject({ y: L.barcode.top, h: L.barcode.h });
                expect(Math.abs(b.w / g.modulePt - Math.round(b.w / g.modulePt))).toBeLessThan(1e-9);
                expect([1, 2, 3, 4]).toContain(Math.round(b.w / g.modulePt));
            });
            const hrItem = textItems(r).filter((i) => i.text === DEMO.barcode).pop();
            expect(hrItem.pt).toBe(13);
            expect(hrItem.align).toBe('center'); // centred under the bars
            expect(hrItem.x).toBeCloseTo((bars[0].x + last.x + last.w) / 2, 9);
            expect(top(hrItem)).toBeCloseTo(L.barcode.hrTop, 6);
        });
        it('300 dpi: target 6 whole dots; 10 characters need 237.6 pt there and fit the full content width', () => {
            const L = Layout.layout('4x6', { dpi: 300 });
            const g = Layout.render(L, DEMO, TEXTS).barcode;
            expect(g.moduleDots).toBe(6);
            expect(g.modulePt).toBeCloseTo(6 * 72 / 300, 12);
            expect(g.widthPt).toBeCloseTo(165 * 6 * 72 / 300, 9);
            expect(g.x0 + g.widthPt).toBeLessThanOrEqual(288 - 4 * MM + EPS);
            expect(Layout.barcodeGeometry(L, '99000100010001')).toMatchObject({ moduleDots: 5 }); // longer value: largest whole-dot module
        });
        it('a longer value takes the largest whole-dot module that fits, never below 0.375 mm', () => {
            const g = Layout.barcodeGeometry(L4x6(), 'DEMO-12345678');
            expect(g.moduleDots).toBe(3);
            expect(g.modulePt * 25.4 / 72).toBeGreaterThanOrEqual(0.375 - EPS);
            expect(g.widthPt).toBeLessThanOrEqual(288 - 4 * MM - g.x0 + EPS);
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
        expect(textItems(empty).filter((i) => !i.bold && i.align === 'left').map((i) => i.text)).toEqual([]);
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
            MaterialDescription: 'DEMO MATERIAL 01', Material: '000000000000123456', MaterialDocument: '9900000001', PostingDate: '2026-10-27', Batch: 'DEMOB1',
            SupplierBatch: 'DM-001', SupplierName: 'DEMO SUPPLIER', BatchCharacteristics: 'DEMO-MFR', ManufacturingDate: '2026-10-01',
            DateKind: 'EXPIRY', DateValue: '2027-04-01', PostedQuantity: '140.00 KG', ContainerQuantity: '10.005', Unit: 'KG',
            Container: '1 OF 14', StorageUnit: '00000000009900000001', Text: 'DM12345678'
        };
        it('maps every label field, with DD/MM/YYYY dates, 2-decimal net weight without a space and no leading zeros', () => {
            expect(Rows.toLabels([capRow], TEXTS)).toEqual([{
                materialName: 'DEMO MATERIAL 01', itemCode: '000000000000123456', grnNo: '9900000001', grnDate: '27/10/2026', inwNo: 'DM12345678',
                qtyReceived: '140.00 KG', containerNo: '1 OF 14', manufacturer: 'DEMO-MFR', supplier: 'DEMO SUPPLIER',
                batchNo: 'DM-001', mfgDate: '01/10/2026', expiryDate: '01/04/2027', netWeight: '10.01KG', barcode: '9900000001',
                preparedBy: '', captions: undefined
            }]);
        });
        it('uses the label generator as Prepared by and keeps an unknown user blank', () => {
            expect(Rows.toLabels([capRow, capRow], TEXTS, 'DEMO-USER').map(r => r.preparedBy)).toEqual(['DEMO-USER', 'DEMO-USER']);
            expect(Rows.toLabels([capRow], TEXTS)[0].preparedBy).toBe('');
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
            expect(page.match(/<rect /g)).toHaveLength(bars.length + 15); // bars + the 15 hairlines
            expect(page).toContain(`<rect x="${bars[0].x}" y="${bars[0].y}" width="${bars[0].w}" height="${bars[0].h}"`);
            expect(page).not.toContain('<line ');
            textItems(r).forEach((t) => expect(page).toContain(`translate(${t.x} ${t.y})`));
            const s0 = r.items.find((i) => i.kind === 'sep');
            expect(page).toContain(`<rect x="${s0.x}" y="${s0.y}" width="${s0.w}" height="${s0.h}" fill="#000" fill-opacity="0.05"`);
            expect(page).toContain('text-anchor="middle">' + TEXTS.quarantine + '<');
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
