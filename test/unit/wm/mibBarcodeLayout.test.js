'use strict';

let Barcode;
let MibBarcodeLayout;

beforeAll(() => {
    const modules = {};
    global.sap = {
        ui: {
            define: (deps, fn) => {
                if (deps.length === 0) {
                    const res = fn();
                    if (res && res.bars) {
                        Barcode = res;
                        modules['saps4hana/fiori/modules/wm/handling-unit/util/Barcode'] = res;
                    }
                } else {
                    const resolved = deps.map(d => modules[d]);
                    MibBarcodeLayout = fn(...resolved);
                }
            }
        }
    };

    require('../../../app/fiori-app/webapp/modules/wm/handling-unit/util/Barcode.js');
    require('../../../app/fiori-app/webapp/modules/wm/mib-label/util/MibBarcodeLayout.js');
});

describe('MibBarcodeLayout', () => {
    it('initializes barcode dependencies properly', () => {
        expect(Barcode).toBeDefined();
    });
    const V_LAYOUT = {
        dpi: 203,
        ptPerInch: 72,
        mmPerInch: 25.4,
        barTop: 316.374,
        barH: 84.059,
        hrTop: 403.5,
        hrPt: 13,
        ascent: 0.79
    };

    it('builds barcode bars and centered human readable text for standard text', () => {
        const items = MibBarcodeLayout.buildBarcodeItems('1000058465', V_LAYOUT, 40.43, 166, 150);
        expect(items).toBeDefined();
        expect(items.length).toBeGreaterThan(0);

        const bars = items.filter(i => i.kind === 'bar');
        expect(bars.length).toBeGreaterThan(0);
        bars.forEach(b => {
            expect(b.y).toBe(V_LAYOUT.barTop);
            expect(b.h).toBe(V_LAYOUT.barH);
        });

        const textItem = items.find(i => i.kind === 'text');
        expect(textItem).toBeDefined();
        expect(textItem.text).toBe('1000058465');
        expect(textItem.align).toBe('center');
    });

    it('falls back to centered text if barcode generation throws', () => {
        const invalidChars = 'INVALID_BARCODE_\uFFFF\uEEEE';
        const items = MibBarcodeLayout.buildBarcodeItems(invalidChars, V_LAYOUT, 40.43, 166, 150);
        expect(items).toBeDefined();
        const textItem = items.find(i => i.kind === 'text');
        expect(textItem).toBeDefined();
        expect(textItem.text).toBe(invalidChars);
        expect(textItem.x).toBe(150);
    });
});
