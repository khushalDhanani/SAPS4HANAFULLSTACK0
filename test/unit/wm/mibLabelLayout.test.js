'use strict';

let MibLabelLayout;

beforeAll(() => {
    const modules = {};
    global.sap = {
        ui: {
            define: (deps, fn) => {
                if (deps.length === 0) {
                    const res = fn();
                    if (res && res.paths) {
                        modules['saps4hana/fiori/modules/wm/quarantine-label/util/AetherLogo'] = res;
                    } else if (res && res.bars) {
                        modules['saps4hana/fiori/modules/wm/handling-unit/util/Barcode'] = res;
                    } else if (res && res.buildRowItems) {
                        modules['saps4hana/fiori/modules/wm/mib-label/util/MibLabelRows'] = res;
                    }
                } else {
                    const resolved = deps.map(d => modules[d]);
                    const res = fn(...resolved);
                    if (res && res.measureMm) {
                        modules['saps4hana/fiori/modules/wm/handling-unit/util/HuLabelLayout'] = res;
                    } else if (res && res.buildBarcodeItems) {
                        modules['saps4hana/fiori/modules/wm/mib-label/util/MibBarcodeLayout'] = res;
                    } else if (res && res.getVerticalItems) {
                        MibLabelLayout = res;
                    }
                }
            },
            require: {
                toUrl: (s) => s
            }
        }
    };

    require('../../../app/fiori-app/webapp/modules/wm/quarantine-label/util/AetherLogo.js');
    require('../../../app/fiori-app/webapp/modules/wm/handling-unit/util/Barcode.js');
    require('../../../app/fiori-app/webapp/modules/wm/handling-unit/util/HuLabelLayout.js');
    require('../../../app/fiori-app/webapp/modules/wm/mib-label/util/MibBarcodeLayout.js');
    require('../../../app/fiori-app/webapp/modules/wm/mib-label/util/MibLabelRows.js');
    require('../../../app/fiori-app/webapp/modules/wm/mib-label/util/MibLabelLayout.js');
});

describe('MibLabelLayout', () => {
    it('provides layout constants VARIANTS, SEP, and V_LAYOUT', () => {
        expect(MibLabelLayout.VARIANTS.STANDARD).toBe('standard');
        expect(MibLabelLayout.VARIANTS.VERTICAL).toBe('vertical');
        expect(MibLabelLayout.SEP.opacity).toBe(0.05);
        expect(MibLabelLayout.V_LAYOUT.dpi).toBe(203);
    });

    it('measures text width in points', () => {
        const width = MibLabelLayout.measureTextPt('TEST', 10, false);
        expect(width).toBeGreaterThan(0);
        expect(MibLabelLayout.measureTextPt('', 10, false)).toBe(0);
    });

    it('formats dates and removes leading zeros accurately', () => {
        expect(MibLabelLayout.formatDate('2026-11-20')).toBe('20/11/2026');
        expect(MibLabelLayout.withoutLeadingZeros('000123')).toBe('123');
    });

    it('generates vertical items containing rules, text, and logo', () => {
        const item = {
            Material: '1000000940',
            Batch: 'IN26001200',
            TransferOrder: '0001001874'
        };
        const items = MibLabelLayout.getVerticalItems(item, {});
        expect(items.length).toBeGreaterThan(15);
        expect(items.some(i => i.kind === 'rule')).toBe(true);
        expect(items.some(i => i.kind === 'logo')).toBe(true);
    });
});
