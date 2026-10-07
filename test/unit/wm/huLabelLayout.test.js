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
    it('exposes four sizes A-D with B as the default', () => {
        expect(Layout.ORDER).toEqual(['A', 'B', 'C', 'D']);
        expect(Layout.DEFAULT).toBe('B');
        expect(Object.keys(Layout.SIZES)).toEqual(['A', 'B', 'C', 'D']);
    });
    it('byKey falls back to the default for an unknown key', () => {
        expect(Layout.byKey('A')).toBe('A');
        expect(Layout.byKey('A4')).toBe('B');
        expect(Layout.byKey(undefined)).toBe('B');
    });
    it('each size descriptor carries its mm dims and i18n keys', () => {
        expect(Layout.SIZES.A).toMatchObject({ key: 'A', widthMm: 50, heightMm: 25, nameKey: 'huSizeA', descKey: 'huSizeADesc' });
        expect(Layout.SIZES.D).toMatchObject({ key: 'D', widthMm: 200, heightMm: 100, nameKey: 'huSizeD', descKey: 'huSizeDDesc' });
    });
});

describe('HuLabelLayout.layout (geometry matches the spec table)', () => {
    const PAGES = { A: [50, 25], B: [100, 50], C: [150, 100], D: [200, 100] };
    it('page size, padding and inner box per size', () => {
        Object.keys(PAGES).forEach((k) => {
            const L = Layout.layout(k);
            expect([L.page.wMm, L.page.hMm]).toEqual(PAGES[k]);
            expect(L.innerW).toBe(L.page.wMm - 2 * L.pad);
            expect(L.innerH).toBe(L.page.hMm - 2 * L.pad);
            expect(L.barcode.w).toBe(L.innerW); // barcode always fills the content width
        });
    });
    it('fonts are height-derived, rounded to 0.5pt, with a 6pt floor', () => {
        // B height 50mm: caption .12->6, material .18->9, huNumber .26->13, meta .18->9
        expect(Layout.layout('B').fonts).toEqual({ caption: 6, material: 9, huNumber: 13, meta: 9 });
        // A height 25mm: no caption (ratio 0), material .24->6, huNumber .32->8, meta .24->6
        expect(Layout.layout('A').fonts).toEqual({ caption: 0, material: 6, huNumber: 8, meta: 6 });
        // D reuses the high huNumber ratio on a 100mm label -> 32pt distance number
        expect(Layout.layout('D').fonts.huNumber).toBe(32);
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

describe('HuLabelLayout.fits (Gate 1: barcode scannability)', () => {
    it('a 20-digit HU fits size A (narrow bar >= 0.25mm)', () => {
        const r = Layout.fits('12345678901234567890', 'A'); // 20 digits -> Code C, 10 data symbols
        expect(r.ok).toBe(true);
        expect(r.narrowMm).toBeGreaterThanOrEqual(0.25);
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
