'use strict';

/** QuarantineLabels controller without a UI5 runtime: validation, one request at a time, stale answers, errors. */
let ctrl;
const Service = { generateLabels: jest.fn() };
const BaseController = { extend: (name, obj) => { ctrl = obj; return obj; } };
global.sap = { ui: { define: (deps, f) => f(BaseController, function () {}, Service) } };
require('../../../app/fiori-app/webapp/modules/wm/quarantine-label/controller/QuarantineLabels.controller.js');

const PDF_B64 = Buffer.from('%PDF-1.7').toString('base64');
global.window = { atob: (s) => Buffer.from(s, 'base64').toString('latin1') };
global.URL.createObjectURL = jest.fn(() => 'blob:pdf-1');
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

    it('rejects a success answer without PDF content', async () => {
        Service.generateLabels.mockResolvedValue({ ...ok, PdfBase64: '' });
        const { s, d } = subject();
        await s.onPreview();
        expect(d.pdfUrl).toBe('');
        expect(d.messageType).toBe('Error');
    });
});
