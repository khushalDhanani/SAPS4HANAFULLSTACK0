'use strict';

const { jsPDF } = require('../../../app/fiori-app/node_modules/jspdf');

let MibLabelPdf;

beforeAll(() => {
    // Provide minimal UI5 module environment for loading AMD modules in Jest
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
                    }
                } else {
                    const resolved = deps.map(d => modules[d]);
                    const res = fn(...resolved);
                    if (res && res.generateDoc) {
                        MibLabelPdf = res;
                    } else if (res && res.measureMm) {
                        modules['saps4hana/fiori/modules/wm/handling-unit/util/HuLabelLayout'] = res;
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
    require('../../../app/fiori-app/webapp/modules/wm/mib-label/util/MibLabelPdf.js');
});

describe('MibLabelPdf', () => {
    describe('formatDate', () => {
        it('formats ISO YYYY-MM-DD into DD/MM/YYYY matching physical sticker', () => {
            expect(MibLabelPdf.formatDate('2026-10-12')).toBe('12/10/2026');
            expect(MibLabelPdf.formatDate('2025-08-14')).toBe('14/08/2025');
        });

        it('formats SAP compact YYYYMMDD into DD/MM/YYYY', () => {
            expect(MibLabelPdf.formatDate('20261012')).toBe('12/10/2026');
            expect(MibLabelPdf.formatDate('20250814')).toBe('14/08/2025');
        });

        it('preserves already-formatted DD/MM/YYYY dates', () => {
            expect(MibLabelPdf.formatDate('12/10/2026')).toBe('12/10/2026');
        });

        it('returns hyphen for empty or falsy dates', () => {
            expect(MibLabelPdf.formatDate('')).toBe('-');
            expect(MibLabelPdf.formatDate(null)).toBe('-');
            expect(MibLabelPdf.formatDate(undefined)).toBe('-');
        });
    });

    describe('generateDoc', () => {
        const mockItem = {
            Material: '1000000940',
            MaterialDescription: 'AE198907',
            Batch: 'IN26001200',
            TransferOrder: '0001001874',
            TransferRequirement: '1013044',
            TransferDate: '2026-10-12',
            QuantityWithUom: '15.000 KG',
            StorageUnit: '1000058465',
            WeightedBy: 'CHIRAGJOSHI',
            CheckedBy: 'KEVINDESAI'
        };

        const mockMeta = {
            warehouseNumber: 'W01',
            transferOrderNumber: '0001001874',
            weightedBy: 'CHIRAGJOSHI',
            checkedBy: 'KEVINDESAI'
        };

        it('generates a 100 x 100 mm portrait PDF matching the physical sticker', () => {
            const doc = MibLabelPdf.generateDoc(jsPDF, [mockItem], mockMeta);
            expect(doc).toBeDefined();

            const pages = doc.internal.pages;
            // jsPDF 1-based page index array
            expect(pages.length).toBeGreaterThanOrEqual(2);

            const buffer = Buffer.from(doc.output('arraybuffer'));
            expect(buffer.length).toBeGreaterThan(10000);
            expect(buffer.slice(0, 5).toString('ascii')).toBe('%PDF-');
        });

        it('creates multi-page PDF when multiple items are provided', () => {
            const doc = MibLabelPdf.generateDoc(jsPDF, [mockItem, { ...mockItem, Material: '1000000490' }], mockMeta);
            expect(doc).toBeDefined();
            // 2 pages (+ 1 for jsPDF index 0)
            expect(doc.internal.pages.length).toBe(3);
        });

        it('handles items with missing or empty properties gracefully', () => {
            const doc = MibLabelPdf.generateDoc(jsPDF, [{}], {});
            expect(doc).toBeDefined();
            const buffer = Buffer.from(doc.output('arraybuffer'));
            expect(buffer.length).toBeGreaterThan(5000);
        });

        it('generates a 4" x 6" portrait (288 x 432 pt) vertical sticker PDF when variant is vertical', () => {
            const vertMeta = { ...mockMeta, variant: 'vertical' };
            const doc = MibLabelPdf.generateDoc(jsPDF, [mockItem], vertMeta);
            expect(doc).toBeDefined();

            const width = doc.internal.pageSize.getWidth();
            const height = doc.internal.pageSize.getHeight();
            expect(Math.round(width)).toBe(288);
            expect(Math.round(height)).toBe(432);

            const buffer = Buffer.from(doc.output('arraybuffer'));
            expect(buffer.length).toBeGreaterThan(10000);
            expect(buffer.slice(0, 5).toString('ascii')).toBe('%PDF-');
        });

        it('computes vertical draw items matching ZQURAN architecture (left vertical strip, rules, 16 pt title, 5% black hairlines, barcode left, logo right)', () => {
            const vertMeta = { ...mockMeta, variant: 'vertical' };
            const items = MibLabelPdf.getVerticalItems(mockItem, vertMeta);
            expect(items).toBeDefined();
            expect(items.length).toBeGreaterThan(30);

            // 1. Rules: exactly 2 rules (vertical rule and title horizontal rule)
            const rules = items.filter(i => i.kind === 'rule');
            expect(rules).toHaveLength(2);

            const vRule = rules.find(r => r.y === 0);
            expect(vRule).toBeDefined();
            expect(vRule.x).toBeCloseTo(36.18, 1);
            expect(vRule.w).toBeCloseTo(0.71, 1);
            expect(vRule.h).toBeCloseTo(310.34, 1); // terminates before barcode area

            const hRule = rules.find(r => r.y > 0);
            expect(hRule).toBeDefined();
            expect(hRule.y).toBeCloseTo(35.11, 1);
            expect(hRule.h).toBeCloseTo(0.71, 1);
            expect(hRule.w).toBeCloseTo(251.82, 1);

            // 2. Company Title: "Aether Industries Limited" (16 pt bold, centered in right header)
            const titleItem = items.find(i => i.kind === 'text' && i.text === 'Aether Industries Limited');
            expect(titleItem).toBeDefined();
            expect(titleItem.pt).toBe(16);
            expect(titleItem.bold).toBe(true);
            expect(titleItem.align).toBe('center');
            expect(titleItem.x).toBeCloseTo(155.85, 1);

            // No BATCH : header text (header is clean like ZQURAN)
            const batchHeaderItem = items.find(i => i.kind === 'text' && String(i.text).startsWith('BATCH :'));
            expect(batchHeaderItem).toBeUndefined();

            // 3. Left Rotated Strip: 14 pt bold title and 9 pt normal SOP code
            const priStrip = items.find(i => i.kind === 'text' && i.text === 'MATERIAL ISSUED TO BATCH');
            expect(priStrip).toBeDefined();
            expect(priStrip.angle).toBe(90);
            expect(priStrip.pt).toBe(14);
            expect(priStrip.bold).toBe(true);
            expect(priStrip.x).toBeCloseTo(22.89, 1);

            const secStrip = items.find(i => i.kind === 'text' && i.text === 'F-03-00-SOP-WH-003-10/10/2016');
            expect(secStrip).toBeDefined();
            expect(secStrip.angle).toBe(90);
            expect(secStrip.pt).toBe(9);
            expect(secStrip.bold).toBe(false);
            expect(secStrip.x).toBeCloseTo(33.75, 1);

            // 4. Hairline Dividers: 5% black (opacity: 0.05), full content width, none after last row
            const seps = items.filter(i => i.kind === 'sep');
            expect(seps).toHaveLength(11); // 1 at top of rows + 10 between the 11 rows
            seps.forEach(s => {
                expect(s.opacity).toBe(0.05);
                expect(s.x).toBeCloseTo(40.43, 1);
                expect(s.w).toBeCloseTo(234.80, 1);
                expect(s.h).toBeCloseTo(0.71, 1);
            });

            // 5. Body Rows: 11 captions (9 pt bold), 11 colons (9 pt bold), 11 values (10 pt normal)
            const captions = items.filter(i => i.kind === 'text' && !i.angle && i.bold === true && i.text !== ':' && i.text !== 'Aether Industries Limited');
            expect(captions).toHaveLength(11);
            captions.forEach(c => {
                expect(c.pt).toBe(9);
                expect(c.x).toBeCloseTo(40.43, 1);
            });

            const colons = items.filter(i => i.kind === 'text' && i.text === ':');
            expect(colons).toHaveLength(11);
            colons.forEach(c => {
                expect(c.pt).toBe(9);
                expect(c.x).toBeCloseTo(104.99, 1);
            });

            const values = items.filter(i => i.kind === 'text' && !i.angle && i.align === 'left' && i.bold === false);
            expect(values).toHaveLength(11);
            values.forEach(v => {
                expect(v.pt).toBe(10);
                expect(v.x).toBeCloseTo(113.50, 1);
            });

            // 6. Code 128 Barcode: 40 bars on left side, module width 1.064 pt (3 dots), starting at 40.43 pt
            const bars = items.filter(i => i.kind === 'bar');
            expect(bars).toHaveLength(40);
            expect(bars[0].x).toBeCloseTo(40.43, 1);
            bars.forEach(b => {
                expect(b.y).toBeCloseTo(316.37, 1);
                expect(b.h).toBeCloseTo(84.06, 1);
            });

            // Centered prominent human-readable number under barcode bars (13 pt)
            const hrNumber = items.find(i => i.kind === 'text' && i.text === mockItem.StorageUnit);
            expect(hrNumber).toBeDefined();
            expect(hrNumber.pt).toBe(13);
            expect(hrNumber.align).toBe('center');
            expect(hrNumber.y).toBeCloseTo(413.77, 1);

            // 7. Vector Logo on the right side: fitted, no border box
            const boxItem = items.find(i => i.kind === 'box');
            expect(boxItem).toBeUndefined();

            const logoItem = items.find(i => i.kind === 'logo');
            expect(logoItem).toBeDefined();
            expect(logoItem.paths).toHaveLength(30);
            expect(logoItem.x).toBeGreaterThan(206);
            expect(logoItem.w).toBeLessThan(65);
        });

        it('draws ZQURAN vertical architecture onto jsPDF instance', () => {
            const calls = {
                text: [],
                rect: [],
                saveGraphicsState: 0,
                restoreGraphicsState: 0,
                setGState: []
            };

            function SpiedJsPdf(...args) {
                const doc = new jsPDF(...args);
                const origText = doc.text.bind(doc);
                doc.text = function (text, x, y, opt) {
                    calls.text.push({ text, x, y, options: opt });
                    return origText(text, x, y, opt);
                };
                const origRect = doc.rect.bind(doc);
                doc.rect = function (x, y, w, h, style) {
                    calls.rect.push({ x, y, w, h, style });
                    return origRect(x, y, w, h, style);
                };
                const origSaveGState = doc.saveGraphicsState.bind(doc);
                doc.saveGraphicsState = function () {
                    calls.saveGraphicsState++;
                    return origSaveGState();
                };
                const origRestoreGState = doc.restoreGraphicsState.bind(doc);
                doc.restoreGraphicsState = function () {
                    calls.restoreGraphicsState++;
                    return origRestoreGState();
                };
                const origSetGState = doc.setGState.bind(doc);
                doc.setGState = function (gState) {
                    calls.setGState.push(gState);
                    return origSetGState(gState);
                };
                return doc;
            }
            SpiedJsPdf.prototype = jsPDF.prototype;

            const vertMeta = { ...mockMeta, variant: 'vertical' };
            const doc = MibLabelPdf.generateDoc(SpiedJsPdf, [mockItem], vertMeta);
            expect(doc).toBeDefined();

            // Verify opacity GState calls for the 11 hairlines
            expect(calls.saveGraphicsState).toBeGreaterThanOrEqual(11);
            expect(calls.restoreGraphicsState).toBeGreaterThanOrEqual(11);
            expect(calls.setGState.length).toBeGreaterThanOrEqual(11);
            calls.setGState.slice(0, 11).forEach(g => {
                expect(g.opacity).toBe(0.05);
            });
        });

        it('exports VARIANTS, SEP, and V_LAYOUT constants matching ZQURAN theme', () => {
            expect(MibLabelPdf.VARIANTS).toBeDefined();
            expect(MibLabelPdf.VARIANTS.STANDARD).toBe('standard');
            expect(MibLabelPdf.VARIANTS.VERTICAL).toBe('vertical');
            expect(MibLabelPdf.SEP).toEqual({ dots: 2, opacity: 0.05 });
            expect(MibLabelPdf.V_LAYOUT).toBeDefined();
            expect(MibLabelPdf.V_LAYOUT.page).toEqual({ w: 288, h: 432 });
            expect(MibLabelPdf.V_LAYOUT.dpi).toBe(203);
        });
    });
});
