'use strict';

/** QuarantineLabels controller without a UI5 runtime: validation, one request at a time, stale answers, errors. */
let ctrl;
const Service = { generateLabels: jest.fn(), labelRows: jest.fn() };
const Layout = { DEFAULT_SIZE: '4x6', STATIC_KEYS: { title: 'zqTitle' }, CAPTION_KEYS: { grnNo: 'zqGrnNo' }, EXTRA_KEYS: { retestDate: 'zqRetestDate' } };
const Pdf = { toBlob: jest.fn(), print: jest.fn() };
const Rows = { toLabels: jest.fn((rows) => rows.map((r) => ({ barcode: r.StorageUnit }))) };
const BaseController = { extend: (name, obj) => { ctrl = obj; return obj; } };
global.sap = { ui: { define: (deps, f) => f(BaseController, function () {}, Service, Layout, Pdf, Rows) } };
require('../../../app/fiori-app/webapp/modules/wm/quarantine-label/controller/QuarantineLabels.controller.js');

const PDF_B64 = Buffer.from('%PDF-1.7').toString('base64');
global.window = { atob: (s) => Buffer.from(s, 'base64').toString('latin1') };
global.URL.createObjectURL = jest.fn(() => 'blob:pdf-1');
global.Blob = global.Blob || class {};
global.URL.revokeObjectURL = jest.fn();

function subject(data) {
    const model = {
        _d: { busy: false, message: '', pdfUrl: '', materialDocument: '4900050304', year: '2026', text: '', ...data },
        getProperty(p) { return this._d[p.slice(1)]; },
        setProperty(p, v) { this._d[p.slice(1)] = v; },
        getData() { return this._d; }
    };
    const s = Object.assign(Object.create(ctrl), { getModel: () => model, getText: (k, a, d) => (d || k).replace('{0}', a && a[0]), _iRequest: 0 });
    return { s, d: model._d };
}
const ok = { MaterialDocument: '4900050304', MaterialDocumentYear: '2026', LabelCount: 2, FileName: 'QuarantineLabels_4900050304_2026.pdf', PdfBase64: PDF_B64 };

describe('QuarantineLabels controller', () => {
    beforeEach(() => jest.clearAllMocks());

    it('validates the inputs locally and does not call the service', () => {
        const { s, d } = subject({ materialDocument: 'abc', year: '26', text: 'x'.repeat(51) });
        s.onPreview();
        expect(Service.generateLabels).not.toHaveBeenCalled();
        expect([d.docState, d.yearState, d.textState]).toEqual(['Error', 'Error', 'Error']);
        expect(d.messageType).toBe('Error');
    });

    it('shows the PDF, count and file name on success', async () => {
        Service.generateLabels.mockResolvedValue(ok);
        const { s, d } = subject({ text: ' Hold ' });
        await s.onPreview();
        expect(Service.generateLabels).toHaveBeenCalledWith({ materialDocument: '4900050304', year: '2026', text: 'Hold' });
        expect(d.pdfUrl).toBe('blob:pdf-1');
        expect(d.fileName).toBe(ok.FileName);
        expect(d.message).toBe('2 label(s) ready.');
        expect(d.busy).toBe(false);
    });

    it('sends only one request while one is pending', () => {
        Service.generateLabels.mockReturnValue(new Promise(() => {}));
        const { s } = subject();
        s.onPreview();
        s.onPreview();
        expect(Service.generateLabels).toHaveBeenCalledTimes(1);
    });

    it('never shows an answer for inputs that changed meanwhile', async () => {
        let resolve;
        Service.generateLabels.mockReturnValue(new Promise((r) => { resolve = r; }));
        const { s, d } = subject();
        const p = s.onPreview();
        s.onInputChange();
        resolve(ok);
        await p;
        expect(d.pdfUrl).toBe('');
        expect(global.URL.createObjectURL).not.toHaveBeenCalled();
    });

    it('drops the shown preview when an input changes', async () => {
        Service.generateLabels.mockResolvedValue(ok);
        const { s, d } = subject();
        await s.onPreview();
        s.onInputChange();
        expect(d.pdfUrl).toBe('');
        expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:pdf-1');
    });

    it.each([[503, 'Warning'], [403, 'Error'], [404, 'Error']])('shows the server message for HTTP %i as %s', async (status, type) => {
        Service.generateLabels.mockRejectedValue(Object.assign(new Error(`server says ${status}`), { status }));
        const { s, d } = subject();
        await s.onPreview();
        expect(d.message).toBe(`server says ${status}`);
        expect(d.messageType).toBe(type);
        expect(d.pdfUrl).toBe('');
        expect(d.busy).toBe(false);
    });

    it.each([
        [{ PageSizeOk: true, LabelSize: '4x6', PageWidthPt: 288, PageHeightPt: 432 }, 'Success', '2 label(s) ready.'],
        [{ PageSizeOk: null, LabelSize: null, PageWidthPt: 595.28, PageHeightPt: 841.89 }, 'Success', '2 label(s) ready.'],
        [{ PageSizeOk: false, LabelSize: '4x6', PageWidthPt: 595.28, PageHeightPt: 841.89 }, 'Warning', '2 label(s) ready. qlPageSizeMismatch'],
        [{ PageSizeOk: false, LabelSize: '4x6', PageWidthPt: null, PageHeightPt: null }, 'Warning', '2 label(s) ready. qlPageSizeUnknown']
    ])('page size %p -> %s', async (size, type, message) => {
        Service.generateLabels.mockResolvedValue({ ...ok, ...size });
        const { s, d } = subject();
        await s.onPreview();
        expect(d.messageType).toBe(type);
        expect(d.message).toBe(message);
        expect(d.pdfUrl).toBe('blob:pdf-1'); // the PDF is still shown; the warning does not block printing
    });

    it('rejects a success answer without PDF content', async () => {
        Service.generateLabels.mockResolvedValue({ ...ok, PdfBase64: '' });
        const { s, d } = subject();
        await s.onPreview();
        expect(d.pdfUrl).toBe('');
        expect(d.messageType).toBe('Error');
    });

    describe('4x6 labels (app-drawn from SAP label rows)', () => {
        const rows = { MaterialDocument: '9900000001', MaterialDocumentYear: '2026', LabelSize: null, Rows: [{ StorageUnit: 'DEMO' }, { StorageUnit: 'DEMO2' }] };

        it('renders the rows at the default size with resolved captions and shows the PDF', async () => {
            Service.labelRows.mockResolvedValue(rows);
            Pdf.toBlob.mockResolvedValue({ blob: {}, warnings: [] });
            const { s, d } = subject();
            await s.on4x6Labels();
            expect(Service.labelRows).toHaveBeenCalledWith({ materialDocument: '4900050304', year: '2026', text: '' });
            const texts = { title: 'zqTitle', grnNo: 'zqGrnNo', retestDate: 'zqRetestDate' };
            expect(Rows.toLabels).toHaveBeenCalledWith(rows.Rows, texts);
            expect(Pdf.toBlob).toHaveBeenCalledWith([{ barcode: 'DEMO' }, { barcode: 'DEMO2' }], texts, { size: '4x6' });
            expect(d.pdfUrl).toBe('blob:pdf-1');
            expect(d.fileName).toBe('QuarantineLabels4x6_9900000001_2026.pdf');
            expect(d.messageType).toBe('Success');
            expect(d.message).toBe('ql4x6Ready');
            expect(Service.generateLabels).not.toHaveBeenCalled(); // the SAP PDF action is separate
        });
        it('uses the configured label size of the plant', async () => {
            Service.labelRows.mockResolvedValue({ ...rows, LabelSize: '4x6' });
            Pdf.toBlob.mockResolvedValue({ blob: {}, warnings: [] });
            const { s } = subject();
            await s.on4x6Labels();
            expect(Pdf.toBlob.mock.calls[0][2]).toEqual({ size: '4x6' });
        });
        it('shows render warnings (e.g. no barcode) as a warning, the PDF stays available', async () => {
            Service.labelRows.mockResolvedValue(rows);
            Pdf.toBlob.mockResolvedValue({ blob: {}, warnings: [{ label: 2, code: 'barcodeMissing', field: 'barcode' }] });
            const { s, d } = subject();
            await s.on4x6Labels();
            expect(d.messageType).toBe('Warning');
            expect(d.message).toBe('ql4x6Ready ql4x6Warnings');
            expect(d.pdfUrl).toBe('blob:pdf-1');
        });
        it('503 (SAP data interface not yet remote-enabled) is a warning and nothing is rendered', async () => {
            Service.labelRows.mockRejectedValue(Object.assign(new Error('not available yet'), { status: 503 }));
            const { s, d } = subject();
            await s.on4x6Labels();
            expect(Pdf.toBlob).not.toHaveBeenCalled();
            expect(d.messageType).toBe('Warning');
            expect(d.pdfUrl).toBe('');
            expect(d.busy).toBe(false);
        });
        it('a label that cannot be drawn names the label, shows nothing and keeps the SAP PDF action separate', async () => {
            Service.labelRows.mockResolvedValue(rows);
            Pdf.toBlob.mockRejectedValue(Object.assign(new Error('too long'), { code: 'barcodeTooLong', label: 2 }));
            const { s, d } = subject({ getTextArgs: true });
            const texts = [];
            s.getText = (k, a) => { texts.push([k, a]); return k; };
            await s.on4x6Labels();
            expect(texts).toContainEqual(['ql4x6Error_barcodeTooLong', [2]]);
            expect(d.message).toBe('ql4x6Error_barcodeTooLong');
            expect(d.messageType).toBe('Error');
            expect(d.pdfUrl).toBe('');
            expect(Service.generateLabels).not.toHaveBeenCalled();
        });
        it('validates locally before calling the service', () => {
            const { s, d } = subject({ year: '26' });
            s.on4x6Labels();
            expect(Service.labelRows).not.toHaveBeenCalled();
            expect(d.yearState).toBe('Error');
        });
        it('never shows labels for inputs that changed meanwhile', async () => {
            let resolve;
            Service.labelRows.mockReturnValue(new Promise((r) => { resolve = r; }));
            const { s, d } = subject();
            const p = s.on4x6Labels();
            s.onInputChange();
            resolve(rows);
            await p;
            expect(Pdf.toBlob).not.toHaveBeenCalled();
            expect(d.pdfUrl).toBe('');
        });
        it('prints the app-drawn labels from the exact-size print document, not the PDF', async () => {
            Service.labelRows.mockResolvedValue(rows);
            Pdf.toBlob.mockResolvedValue({ blob: {}, warnings: [] });
            Pdf.print.mockResolvedValue();
            const { s } = subject();
            await s.on4x6Labels();
            await s.onPrint();
            const texts = { title: 'zqTitle', grnNo: 'zqGrnNo', retestDate: 'zqRetestDate' };
            expect(Pdf.print).toHaveBeenCalledWith([{ barcode: 'DEMO' }, { barcode: 'DEMO2' }], texts, { size: '4x6' });
        });
        it('a print failure is shown as an error', async () => {
            Service.labelRows.mockResolvedValue(rows);
            Pdf.toBlob.mockResolvedValue({ blob: {}, warnings: [] });
            Pdf.print.mockRejectedValue(new Error('print blocked'));
            const { s, d } = subject();
            await s.on4x6Labels();
            await s.onPrint();
            expect(d.message).toBe('print blocked');
            expect(d.messageType).toBe('Error');
        });
        it('the SAP PDF afterwards prints as the PDF again (print job cleared)', async () => {
            Service.labelRows.mockResolvedValue(rows);
            Pdf.toBlob.mockResolvedValue({ blob: {}, warnings: [] });
            Service.generateLabels.mockResolvedValue(ok);
            const { s } = subject();
            await s.on4x6Labels();
            await s.onPreview();
            const frame = { style: {} };
            global.document = { createElement: jest.fn(() => frame), body: { appendChild: jest.fn() } };
            s.onPrint();
            expect(Pdf.print).not.toHaveBeenCalled();
            expect(frame.src).toBe('blob:pdf-1');
            delete global.document;
        });
    });
});
