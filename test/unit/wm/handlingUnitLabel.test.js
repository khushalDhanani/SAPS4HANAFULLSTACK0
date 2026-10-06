/**
 * Unit tests for the HU label print utilities (Code 128 encoder + label HTML builder).
 */
let Barcode, Printer;
global.sap = { ui: { define: (deps, f) => { Barcode = f(); } } };
require('../../../app/fiori-app/webapp/modules/wm/handling-unit/util/Barcode.js');
global.sap.ui.define = (deps, f) => { Printer = f(Barcode); };
require('../../../app/fiori-app/webapp/modules/wm/handling-unit/util/HuLabelPrinter.js');

const header = {
    HandlingUnitExternalID: '2000019997', PackagingMaterial: '<b>', PackagingMaterialName: 'Pallet', Plant: '1120', StorageLocation: 'CS01',
    Warehouse: 'W13', StatusText: 'Active', GrossWeight: '12.5', NetWeight: '10', TareWeight: '0', WeightUnit: 'KG', GrossVolume: '0',
    Length: '1.2', Width: '0.8', Height: '0', DimensionUnit: 'M', CreatedByUser: 'KHUSHAL', CreationDateTime: '2026-10-06', ReferenceDocument: ''
};
const items = [{ HandlingUnitItem: '000001', Material: '8000007113', MaterialName: 'Pump', Batch: '', Quantity: '1', Unit: 'NOS', GoodsReceiptDate: '', ShelfLifeExpirationDate: '' }];
const serials = [{ SerialNumber: 'SR-01' }];
const texts = { huDetailTitle: 'Handling Unit', huItemsTitle: 'Items', huSerialsTitle: 'Serial Numbers', huPackagingMaterial: 'Packaging', huDimDimensions: 'Dimensions' };

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

describe('HuLabelPrinter.buildHtml', () => {
    it('builds one escaped page with barcode, facts, items and serials on 4x4 label', () => {
        const enrichedHeader = Object.assign({}, header, { PlantName: 'Genesis', StorageLocationName: 'Finished Storage' });
        const enrichedTexts = Object.assign({}, texts, { huLabelPlant: 'Plant / Plant Name', huLabelSloc: 'SLOC / SL Name' });
        const html = Printer.buildHtml([{ header: enrichedHeader, items, serials }], enrichedTexts);
        expect(html).toContain('@page{size:4in 4in');
        expect(html).toContain('&lt;b&gt; (Pallet)');
        expect(html).not.toContain('<b> (');
        expect(html).toContain(Barcode.toSvg('2000019997'));
        expect(html).toContain('<div class="num">2000019997</div>');
        expect(html).toContain('<dt>Plant / Plant Name</dt><dd>1120 / Genesis</dd>');
        expect(html).toContain('<dt>SLOC / SL Name</dt><dd>CS01 / Finished Storage</dd>');
        expect(html).toContain('8000007113');
        expect(html).toContain('SR-01');
        expect(html).toContain('1.2 x 0.8 x 0 M');
        expect(html).not.toContain('Tare');
        expect((html.match(/class="hu"/g) || []).length).toBe(1);
        expect(html).toContain('<title>2000019997</title>');
    });
    it('handles plant and sloc without description gracefully', () => {
        const html = Printer.buildHtml([{ header, items, serials }], texts);
        expect(html).toContain('@page{size:4in 4in');
        expect(html).toContain('<dt>Plant / Plant Name</dt><dd>1120</dd>');
        expect(html).toContain('<dt>SLOC / SL Name</dt><dd>CS01</dd>');
    });
    it('supports custom page size override', () => {
        const html = Printer.buildHtml([{ header, items, serials }], texts, 'A4');
        expect(html).toContain('@page{size:A4');
    });
    it('prints one section per label', () => {
        const html = Printer.buildHtml([{ header, items, serials }, { header: { HandlingUnitExternalID: '2000019990' } }], texts);
        expect((html.match(/class="hu"/g) || []).length).toBe(2);
        expect(html).toContain('<title>Handling Units (2)</title>');
    });
    it('omits the items table and serials when empty', () => {
        const html = Printer.buildHtml([{ header, items: [], serials: [] }], texts);
        expect(html).not.toContain('<table');
        expect(html).not.toContain('Serial Numbers');
    });
    it('escapes values', () => {
        expect(Printer.esc(null)).toBe('');
        expect(Printer.esc('a"b')).toBe('a&quot;b');
    });
});
