/**
 * Unit tests for the HU label print utilities: Code 128 encoder, record validation/cleaning
 * (dedupe, date formatting, injection-safety), the size-aware label HTML builder and the integrity check.
 * The iframe print() / printRecords() paths need a DOM and are exercised in the browser, not here.
 */
let Barcode, Layout, Printer, Pdf;
global.sap = { ui: { define: (deps, f) => { Barcode = f(); }, require: { toUrl: () => '' } } };
require('../../../app/fiori-app/webapp/modules/wm/handling-unit/util/Barcode.js');
global.sap.ui.define = (deps, f) => { Layout = f(Barcode); };
require('../../../app/fiori-app/webapp/modules/wm/handling-unit/util/HuLabelLayout.js');
global.sap.ui.define = (deps, f) => { Printer = f(Barcode, Layout); };
require('../../../app/fiori-app/webapp/modules/wm/handling-unit/util/HuLabelPrinter.js');
global.sap.ui.define = (deps, f) => { Pdf = f(Barcode, Layout); };
require('../../../app/fiori-app/webapp/modules/wm/handling-unit/util/HuLabelPdf.js');
const { jsPDF } = require('../../../app/fiori-app/node_modules/jspdf');

const header = { HandlingUnitExternalID: '2000019997', CreationDateTime: '2026-10-06', Plant: '1120', GrossWeight: '12.5' };
const items = [{ HandlingUnitItem: '000001', Material: '8000007113', MaterialName: 'Pump', Quantity: '1', Unit: 'NOS' }];
const serials = [{ SerialNumber: 'SR-01' }];

/** wrappers -> cleaned labels, the shape buildHtml now consumes. */
const clean = (...wrappers) => Printer.prepare(wrappers.map(Printer.toRecord)).labels;

describe('Barcode (Code 128)', () => {
    it('encodes an even-length digit string in Code C with the right checksum', () => {
        expect(Barcode.encode('2000019997')).toEqual([105, 20, 0, 1, 99, 97, 82, 106]);
    });
    it('encodes text in Code B with the right checksum', () => {
        expect(Barcode.encode('HU1')).toEqual([104, 40, 53, 17, 95, 106]);
    });
    it('falls back to Code B for odd-length digits', () => {
        expect(Barcode.encode('20001')[0]).toBe(104);
    });
    it('rejects characters outside Code 128 B and empty text', () => {
        expect(() => Barcode.encode('ü')).toThrow();
        expect(() => Barcode.encode('')).toThrow();
    });
    it('renders one rect per bar with quiet zones', () => {
        const svg = Barcode.toSvg('2000019997');
        expect(svg.startsWith('<svg')).toBe(true);
        expect((svg.match(/<rect /g) || []).length).toBe(25);
        expect(svg).toContain('viewBox="0 0 110 1"');
    });
});

describe('HuLabelPrinter.fmtDate (DD-MMM-YYYY)', () => {
    it('formats an ISO date', () => { expect(Printer.fmtDate('2026-10-06')).toBe('06-Oct-2026'); });
    it('formats a Date object', () => { expect(Printer.fmtDate(new Date(2026, 0, 2))).toBe('02-Jan-2026'); });
    it('returns "-" for blank/undefined/null', () => {
        expect(Printer.fmtDate('')).toBe('-');
        expect(Printer.fmtDate(undefined)).toBe('-');
        expect(Printer.fmtDate(null)).toBe('-');
    });
    it('returns "-" (never "Invalid Date"/"NaN") for an unparseable value', () => {
        expect(Printer.fmtDate('not a date')).toBe('-');
        expect(Printer.fmtDate('Invalid Date')).toBe('-');
    });
});

describe('HuLabelPrinter.prepare (validate / clean / dedupe)', () => {
    it('skips a record with an empty HU number', () => {
        const r = Printer.prepare([{ huNumber: '  ', materialName: 'X' }]);
        expect(r.labels).toHaveLength(0);
        expect(r.skipped).toEqual([{ huNumber: '', reason: 'empty HU number' }]);
    });
    it('skips a HU number that Code 128 cannot encode (non-ASCII)', () => {
        const r = Printer.prepare([{ huNumber: 'HUü01' }]);
        expect(r.labels).toHaveLength(0);
        expect(r.skipped[0].reason).toMatch(/encodable/);
    });
    it('keeps leading zeros (treats the HU number as a string)', () => {
        expect(Printer.prepare([{ huNumber: '0012' }]).labels[0].huNumber).toBe('0012');
    });
    it('removes duplicates by HU number (keeps the first) and counts them', () => {
        const r = Printer.prepare([{ huNumber: '10', materialName: 'A' }, { huNumber: '10', materialName: 'B' }, { huNumber: '11' }]);
        expect(r.labels.map(l => l.huNumber)).toEqual(['10', '11']);
        expect(r.labels[0].materialName).toBe('A'); // first kept
        expect(r.duplicatesRemoved).toBe(1);
    });
    it('collapses whitespace in the material name and falls back to "-"', () => {
        expect(Printer.prepare([{ huNumber: '1', materialName: '  Big   Red   Pump ' }]).labels[0].materialName).toBe('Big Red Pump');
        expect(Printer.prepare([{ huNumber: '1', materialName: '   ' }]).labels[0].materialName).toBe('-');
    });
    it('keeps a very long material name intact (data is clamped by CSS, not cut)', () => {
        const long = 'X'.repeat(150);
        expect(Printer.prepare([{ huNumber: '1', materialName: long }]).labels[0].materialName).toBe(long);
    });
    it('formats the created date and "-" for an invalid one', () => {
        expect(Printer.prepare([{ huNumber: '1', createdDate: '2026-10-06' }]).labels[0].createdDate).toBe('06-Oct-2026');
        expect(Printer.prepare([{ huNumber: '1', createdDate: 'xx' }]).labels[0].createdDate).toBe('-');
    });
    it('never yields "undefined"/"null" for srNo and stringifies a numeric one', () => {
        expect(Printer.prepare([{ huNumber: '1', srNo: undefined }]).labels[0].srNo).toBe('');
        expect(Printer.prepare([{ huNumber: '1', srNo: null }]).labels[0].srNo).toBe('');
        expect(Printer.prepare([{ huNumber: '1', srNo: 'null' }]).labels[0].srNo).toBe('');
        expect(Printer.prepare([{ huNumber: '1', srNo: 7 }]).labels[0].srNo).toBe('7');
    });
    it('reduces a detail wrapper via toRecord (first item + "+N more", first serial)', () => {
        const rec = Printer.toRecord({ header, items: [items[0], { MaterialName: 'Valve' }], serials });
        expect(rec).toMatchObject({ huNumber: '2000019997', materialName: 'Pump +1 more', srNo: 'SR-01' });
    });
});

describe('HuLabelPrinter.buildHtml (size-aware label, from clean labels)', () => {
    it('builds one page at the default B size: material, date, sr no, barcode + HU number, 100x50mm, zero margin', () => {
        const html = Printer.buildHtml(clean({ header, items, serials }), {});
        const L = Layout.layout('B');
        expect(html).toContain('@page{size:100mm 50mm;margin:0}');
        expect(html).toContain(Barcode.toSvg('2000019997', L.barcode.w, L.barcode.h));
        expect(html).toContain('>MATERIAL NAME</div>');
        expect(html).toContain('>Pump</div>');
        expect(html).toContain('>CREATED DATE</div>');
        expect(html).toContain('>06-Oct-2026</div>');
        expect(html).toContain('>SR NO</div>');
        expect(html).toContain('>SR-01</div>');
        expect(html).toContain('>2000019997</div>');
        expect(html).toContain('<title>2000019997</title>');
        expect((html.match(/class="hu"/g) || []).length).toBe(1);
    });
    it('renders the chosen size: A is 50x25mm and drops captions', () => {
        const html = Printer.buildHtml(clean({ header, items, serials }), {}, 'A');
        expect(html).toContain('@page{size:50mm 25mm;margin:0}');
        expect(html).not.toContain('MATERIAL NAME'); // A is caption-less (too tight)
        expect(html).toContain('>Pump</div>');
        expect(html).toContain('>2000019997</div>');
    });
    it('falls back to the default size for an unknown key', () => {
        expect(Printer.buildHtml(clean({ header, items }), {}, 'A4')).toContain('@page{size:100mm 50mm;margin:0}');
    });
    it('drops unlisted detail: no facts, items table, material number or plant', () => {
        const html = Printer.buildHtml(clean({ header, items, serials }), {});
        expect(html).not.toContain('<table');
        expect(html).not.toContain('8000007113');
        expect(html).not.toContain('1120');
        expect(html).not.toContain('<dl');
    });
    it('hides the sr no field when the HU has no serials', () => {
        const html = Printer.buildHtml(clean({ header, items, serials: [] }), {});
        expect(html).not.toContain('SR NO');
        expect(html).toContain('CREATED DATE');
    });
    it('shows "-" for a missing material name and date (never blank/"undefined")', () => {
        const html = Printer.buildHtml(clean({ header: { HandlingUnitExternalID: '2000019997' }, items: [], serials: [] }), {});
        expect(html).toContain('>-</div>'); // material + date fall back to "-"
        expect(html).toContain('>CREATED DATE</div>');
        expect(html).not.toContain('SR NO');
        expect(html).toContain('>2000019997</div>');
    });
    it('escapes special characters to prevent HTML injection', () => {
        const html = Printer.buildHtml(clean({ header, items: [{ Material: 'X', MaterialName: '<b>Pump & "Co"' }] }), {});
        expect(html).toContain('&lt;b&gt;Pump &amp; &quot;Co&quot;');
        expect(html).not.toContain('<b>Pump');
    });
    it('clamps the material name to the size\'s line count (B = 2 lines)', () => {
        expect(Printer.buildHtml(clean({ header, items }), {})).toContain('-webkit-line-clamp:2');
        expect(Printer.buildHtml(clean({ header, items }), {}, 'C')).toContain('-webkit-line-clamp:3');
    });
    it('falls back to the material number when no name', () => {
        expect(Printer.buildHtml(clean({ header, items: [{ Material: '8000007113' }] }), {})).toContain('>8000007113</div>');
    });
    it('prints one page per label and a combined title', () => {
        const html = Printer.buildHtml(clean({ header, items }, { header: { HandlingUnitExternalID: '2000019990' } }), {});
        expect((html.match(/class="hu"/g) || []).length).toBe(2);
        expect(html).toContain('<title>Handling Units (2)</title>');
    });
    it('page-breaks after every label except the last (no trailing blank page)', () => {
        const html = Printer.buildHtml(clean({ header, items }, { header: { HandlingUnitExternalID: '2000019990' } }), {});
        expect(html).toContain('.hu:last-child{break-after:auto;page-break-after:auto}');
    });
    it('escapes values', () => {
        expect(Printer.esc(null)).toBe('');
        expect(Printer.esc('a"b')).toBe('a&quot;b');
    });
});

describe('Barcode.bars (geometry shared with toSvg and the PDF renderer)', () => {
    it('returns bars + total consistent with toSvg rects', () => {
        const g = Barcode.bars('2000019997');
        expect(g.total).toBe(110); // matches viewBox "0 0 110 1"
        expect(g.bars.length).toBe(25); // one bar per <rect> in toSvg
        expect(g.bars[0]).toEqual({ x: 10, w: 2 }); // 10-module quiet zone, then the start bar
        g.bars.forEach((b) => { expect(b.w).toBeGreaterThan(0); expect(b.x).toBeGreaterThanOrEqual(10); expect(b.x + b.w).toBeLessThanOrEqual(100); });
    });
});

describe('HuLabelPdf.generate (size-aware mm PDF, one page per label)', () => {
    const labels = (n) => Printer.prepare(Array.from({ length: n }, (_, i) => ({ huNumber: String(2000019990 + i), materialName: 'Pump Assembly 24V Industrial Grade High-Flow ' + i, createdDate: '2026-10-06', srNo: 'SR-' + i }))).labels;
    it('makes one page per label at the chosen size in mm (no blank trailing page)', () => {
        [['A', 50, 25], ['B', 100, 50], ['C', 150, 100], ['D', 200, 100]].forEach(([k, w, h]) => {
            const doc = Pdf.generate(jsPDF, labels(3), k);
            expect(doc.getNumberOfPages()).toBe(3);
            const p = doc.internal.pageSize;
            expect(Math.round(p.getWidth())).toBe(w);
            expect(Math.round(p.getHeight())).toBe(h);
        });
    });
    it('defaults to B (Medium, 100x50mm) when no size is given', () => {
        const p = Pdf.generate(jsPDF, labels(1)).internal.pageSize;
        expect(Math.round(p.getWidth())).toBe(100);
        expect(Math.round(p.getHeight())).toBe(50);
    });
    it('draws a label with blank srNo / "-" fallbacks without throwing (every size)', () => {
        const clean = Printer.prepare([{ huNumber: '0012' }]).labels; // no material/date/serial
        expect(clean[0]).toMatchObject({ huNumber: '0012', materialName: '-', createdDate: '-', srNo: '' });
        ['A', 'B', 'C', 'D'].forEach((k) => expect(() => Pdf.generate(jsPDF, clean, k)).not.toThrow());
    });
    it('download([]) rejects (nothing to download)', async () => {
        await expect(Pdf.download([], 'x.pdf')).rejects.toThrow(/No labels/);
    });
});

describe('HuLabelPrinter.integrity (count + leaked-placeholder guard)', () => {
    it('passes when pages and barcodes both equal the label count', () => {
        const labels = clean({ header, items }, { header: { HandlingUnitExternalID: '2000019990' } });
        expect(Printer.integrity(Printer.buildHtml(labels, {}), labels.length)).toBe('');
    });
    it('fails when the rendered page count does not match the expected label count', () => {
        const html = Printer.buildHtml(clean({ header, items }), {});
        expect(Printer.integrity(html, 2)).toMatch(/integrity check failed/);
    });
    it('fails when a placeholder value leaked into a label', () => {
        expect(Printer.integrity('<section class="hu"><svg></svg><div>undefined</div></section>', 1)).toMatch(/content check failed/);
    });
});
