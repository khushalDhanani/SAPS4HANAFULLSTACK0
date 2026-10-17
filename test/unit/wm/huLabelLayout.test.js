/**
 * Unit tests for HuLabelLayout: the single source of truth for the four stock label sizes.
 * Verifies the baked geometry (page mm, fonts pt, barcode box) matches the spec table, the 6pt
 * font floor, and the Gate-1 scannability check (fits) that routes dense barcodes to a larger size.
 */
let Barcode, Layout;
global.sap = { ui: { define: (deps, f) => { Barcode = f(); } } };
require('../../../app/fiori-app/webapp/modules/wm/handling-unit/util/Barcode.js');
global.sap.ui.define = (deps, f) => { Layout = f(Barcode); };
require('../../../app/fiori-app/webapp/modules/wm/handling-unit/util/HuLabelLayout.js');

describe('HuLabelLayout config', () => {
    it('exposes the stock sizes (A,B,E,C,D) with B as the default', () => {
        expect(Layout.ORDER).toEqual(['A', 'B', 'E', 'C', 'D']);
        expect(Layout.DEFAULT).toBe('B');
        expect(Object.keys(Layout.SIZES)).toEqual(['A', 'B', 'E', 'C', 'D']);
    });
    it('byKey falls back to the default for an unknown key', () => {
        expect(Layout.byKey('A')).toBe('A');
        expect(Layout.byKey('A4')).toBe('B');
        expect(Layout.byKey(undefined)).toBe('B');
    });
    it('each size descriptor carries its mm dims and i18n keys', () => {
        expect(Layout.SIZES.A).toMatchObject({ key: 'A', widthMm: 50, heightMm: 25, nameKey: 'huSizeA', descKey: 'huSizeADesc' });
        expect(Layout.SIZES.D).toMatchObject({ key: 'D', widthMm: 200, heightMm: 100, nameKey: 'huSizeD', descKey: 'huSizeDDesc' });
        expect(Layout.SIZES.E).toMatchObject({ key: 'E', widthMm: 100, heightMm: 100, nameKey: 'huSizeE', descKey: 'huSizeEDesc' });
    });
});

describe('HuLabelLayout.layout (geometry matches the spec table)', () => {
    const PAGES = { A: [50, 25], B: [100, 50], E: [100, 100], C: [150, 100], D: [200, 100] };
    it('page size, padding and inner box per size', () => {
        Object.keys(PAGES).forEach((k) => {
            const L = Layout.layout(k);
            expect([L.page.wMm, L.page.hMm]).toEqual(PAGES[k]);
            expect(L.innerW).toBe(L.page.wMm - 2 * L.pad);
            expect(L.innerH).toBe(L.page.hMm - 2 * L.pad);
            expect(L.barcode.w).toBe(L.innerW); // barcode always fills the content width
        });
    });
    it('uses the explicit per-size type scale (pt), with C distinct from E', () => {
        expect(Layout.layout('A').fonts).toEqual({ huNumber: { pt: 9, weight: 'bold' }, material: { pt: 7, weight: 'bold', lh: 1.15 }, meta: { pt: 6, weight: 'normal' }, caption: { pt: 0, weight: 'bold' } });
        expect(Layout.layout('D').fonts.huNumber).toEqual({ pt: 36, weight: 'bold' });
        expect(Layout.layout('D').fonts.material.pt).toBe(16);
        expect(Layout.layout('C').fonts.huNumber.pt).toBe(26); // C != E (was identical under height-only scaling)
        expect(Layout.layout('E').fonts.huNumber.pt).toBe(20);
        expect(Layout.layout('C').fonts.material.pt).toBe(14);
        expect(Layout.layout('E').fonts.material.pt).toBe(13);
    });
    it('E is square (100x100), narrower than C, and points at C (wider) when too dense', () => {
        const e = Layout.layout('E');
        expect([e.page.wMm, e.page.hMm]).toEqual([100, 100]);
        expect(e.barcode.w).toBe(90); // innerW = 100 - 2*5
        expect(e.barcode.w).toBeLessThan(Layout.layout('C').barcode.w); // C (140) is wider -> a valid next-larger
        expect(e.nextLarger).toBe('C');
        expect(e.material.maxLines).toBe(3);
    });
    it('A has no captions and one material line; C has three', () => {
        expect(Layout.layout('A').showCaptions).toBe(false);
        expect(Layout.layout('A').material.maxLines).toBe(1);
        expect(Layout.layout('C').showCaptions).toBe(true);
        expect(Layout.layout('C').material.maxLines).toBe(3);
    });
    it('mm->pt factor converts a page width correctly', () => {
        expect(Layout.MM2PT).toBeCloseTo(72 / 25.4, 6);
        expect(50 * Layout.MM2PT).toBeCloseTo(141.73, 1); // A width in pt (what pdfinfo reports)
    });
});

describe('HuLabelLayout hierarchy invariants (STEP 2)', () => {
    const SIZES = ['A', 'B', 'E', 'C', 'D'];
    it('L1 HU > L2 material > L3 meta >= L4 caption, with the required ratios on every size', () => {
        SIZES.forEach((k) => {
            const f = Layout.layout(k).fonts;
            expect(f.huNumber.pt / f.material.pt).toBeGreaterThanOrEqual(k === 'A' ? 1.25 : 1.4); // HU/material
            expect(f.material.pt / f.meta.pt).toBeGreaterThanOrEqual(1.15);                        // material/meta
            expect(f.material.pt).toBeGreaterThan(f.meta.pt);                                       // L2 > L3
            expect(f.meta.pt).toBeGreaterThanOrEqual(f.caption.pt);                                 // L3 >= L4
            expect(f.meta.pt).toBeGreaterThanOrEqual(6);                                            // absolute floor
            if (f.caption.pt) { expect(f.caption.pt).toBeGreaterThanOrEqual(6.5); }                 // captions where shown
        });
    });
    it('meta is the floor (6pt) only on A', () => {
        expect(Layout.layout('A').fonts.meta.pt).toBe(6);
        SIZES.filter((k) => k !== 'A').forEach((k) => expect(Layout.layout(k).fonts.meta.pt).toBeGreaterThan(6));
    });
    it('weights in the spec: HU + material bold, meta regular, caption bold', () => {
        SIZES.forEach((k) => {
            const f = Layout.layout(k).fonts;
            expect([f.huNumber.weight, f.material.weight, f.meta.weight, f.caption.weight]).toEqual(['bold', 'bold', 'normal', 'bold']);
        });
    });
});

describe('HuLabelLayout vertical rhythm (stack model, STEP 3)', () => {
    ['A', 'B', 'E', 'C', 'D'].forEach((k) => {
        it(`${k}: gaps >= 0.8mm, bottom slack in [0.5, pad+1.5], blocks ordered without overlap and inside the page`, () => {
            const L = Layout.layout(k);
            const s = L.stack;
            s.gaps.forEach((g) => expect(g).toBeGreaterThanOrEqual(0.8 - 1e-9));
            expect(s.bottomSlackMm).toBeGreaterThanOrEqual(0.5 - 1e-9);
            expect(s.bottomSlackMm).toBeLessThanOrEqual(L.pad + 1.5 + 1e-9);
            let prevBottom = L.pad - 1e-9;
            s.blocks.forEach((b) => { expect(b.yTop).toBeGreaterThanOrEqual(prevBottom - 1e-9); prevBottom = b.yTop + b.h; });
            expect(prevBottom).toBeLessThanOrEqual(L.page.hMm - L.pad + 1e-6);
        });
    });
});

describe('HuLabelLayout shared text engine (STEP 4)', () => {
    it('measureMm is zero for empty, monotonic, and linear in pt', () => {
        expect(Layout.measureMm('', 10, true)).toBe(0);
        expect(Layout.measureMm('AAAA', 10, true)).toBeGreaterThan(Layout.measureMm('AA', 10, true));
        expect(Layout.measureMm('W', 20, true)).toBeCloseTo(2 * Layout.measureMm('W', 10, true), 6);
    });
    it('wrap keeps a short value on one line (not truncated) and never exceeds the width', () => {
        const L = Layout.layout('C');
        const w = Layout.wrap('Hydraulic Pump', L.material.w, L.fonts.material.pt, L.material.maxLines, true);
        expect(w.truncated).toBe(false);
        expect(w.lines).toEqual(['Hydraulic Pump']);
    });
    it('wrap bounds an overlong value to maxLines, ellipsizes the last line, every line within width', () => {
        const L = Layout.layout('C');
        const w = Layout.wrap('M'.repeat(152), L.material.w, L.fonts.material.pt, L.material.maxLines, true);
        expect(w.lines.length).toBeLessThanOrEqual(3);
        expect(w.truncated).toBe(true);
        expect(w.lines[w.lines.length - 1].endsWith('…')).toBe(true);
        w.lines.forEach((line) => expect(Layout.measureMm(line, L.fonts.material.pt, true)).toBeLessThanOrEqual(L.material.w + 1e-6));
    });
    it('huNumberPt keeps nominal when it fits, and shrinks (never below ~70%/6.5pt) when it would overflow', () => {
        const L = Layout.layout('D');
        expect(Layout.huNumberPt('2000019997', L.fonts.huNumber.pt, L.huNumber.usableMm)).toEqual({ pt: 36, fits: true });
        const r = Layout.huNumberPt('8'.repeat(40), 36, 30); // far too wide for 30mm
        expect(r.pt).toBeLessThan(36);
        expect(r.pt).toBeGreaterThanOrEqual(6.5);
        expect(r.fits).toBe(false); // overflows even at the floor
    });
    it('srNoText prefixes a bare serial on caption-less A only, never double-prefixes', () => {
        expect(Layout.srNoText(Layout.layout('A'), '7')).toBe('SR 7');
        expect(Layout.srNoText(Layout.layout('A'), 'SR-01')).toBe('SR-01');
        expect(Layout.srNoText(Layout.layout('B'), '7')).toBe('7');
    });
});

describe('HuLabelLayout.fits (Gate 1: barcode scannability)', () => {
    it('dot-snapping: A fits a 12-digit HU (3 dots) but not a 20-digit HU (2 dots < MIN_DOTS) -> routes to B', () => {
        const r12 = Layout.fits('200001999712', 'A'); // 12 digits -> 121 modules -> 3 whole dots @203dpi
        expect(r12.ok).toBe(true);
        expect(r12.narrowDots).toBe(3);
        const r20 = Layout.fits('12345678901234567890', 'A'); // 20 digits -> 165 modules -> 2 dots, below MIN_DOTS
        expect(r20.ok).toBe(false);
        expect(r20.narrowDots).toBe(2);
        expect(r20.nextLarger).toBe('B');
        expect(Layout.fits('12345678901234567890', 'B').ok).toBe(true); // B handles the 20-digit HU (4 dots)
    });
    it('snapBarcode yields whole dots, width <= innerW, and a dot-aligned left edge', () => {
        ['A', 'B', 'E', 'C', 'D'].forEach((k) => {
            const L = Layout.layout(k);
            const s = Layout.snapBarcode(L, 110); // 10-digit HU modules
            expect(Number.isInteger(s.narrowDots)).toBe(true);
            expect(s.widthMm).toBeLessThanOrEqual(L.innerW + 1e-9);
            expect(s.narrowMm).toBeCloseTo(s.narrowDots * Layout.DOT_MM, 9);
            expect(Math.round(s.xMm / Layout.DOT_MM)).toBeCloseTo(s.xMm / Layout.DOT_MM, 6); // left edge on a dot
        });
    });
    it('a 20-char alphanumeric HU is too dense for A and suggests B', () => {
        const r = Layout.fits('AB12CD34EF56GH78IJ90', 'A'); // 20 Code-B symbols -> many more modules
        expect(r.ok).toBe(false);
        expect(r.narrowMm).toBeLessThan(0.25);
        expect(r.nextLarger).toBe('B');
    });
    it('the largest size (D) reports no next-larger size', () => {
        expect(Layout.fits('2000019997', 'D').nextLarger).toBeNull();
    });
    it('an unencodable HU does not fit and points at the next size', () => {
        const r = Layout.fits('HUü01', 'A');
        expect(r.ok).toBe(false);
        expect(r.nextLarger).toBe('B');
    });
});
