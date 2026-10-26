'use strict';

const QuarantineLabelAdapter = require('../../../srv/integration/s4hana/wm/QuarantineLabelAdapter');
const { normalizeInput, FUNCTION_NAME } = QuarantineLabelAdapter;

const PDF = Buffer.from('%PDF-1.7\n...');

/** RFC fake: TFDIR / MATDOC rows and the wrapper's export parameters. */
function rfcFake({ fmode = 'R', plants = ['1120'], result = { EV_RESULT: 'OK', EV_PDF: PDF, EV_LABEL_COUNT: 3 }, tfdirError } = {}) {
    return {
        readTable: jest.fn(async (table) => {
            if (table === 'TFDIR') {
                if (tfdirError) throw new Error(tfdirError);
                return fmode === null ? [] : [{ FUNCNAME: FUNCTION_NAME, FMODE: fmode }];
            }
            if (table === 'MATDOC') return plants.flatMap((p) => [{ WERKS: p }, { WERKS: p }]);
            throw new Error(`unexpected table ${table}`);
        }),
        call: jest.fn(async () => result)
    };
}
const input = { MaterialDocument: '4900050304', MaterialDocumentYear: '2026', Text: 'Hold' };

describe('QuarantineLabelAdapter', () => {
    describe('normalizeInput', () => {
        it('pads the document number and keeps year and text', () => {
            expect(normalizeInput({ MaterialDocument: ' 50304 ', MaterialDocumentYear: '2026', Text: ' Hold ' }))
                .toEqual({ mblnr: '0000050304', mjahr: '2026', text: 'Hold' });
        });
        it.each([
            [{ MaterialDocument: '', MaterialDocumentYear: '2026' }, /up to 10 digits/],
            [{ MaterialDocument: '49000503041', MaterialDocumentYear: '2026' }, /up to 10 digits/],
            [{ MaterialDocument: "49'1", MaterialDocumentYear: '2026' }, /up to 10 digits/],
            [{ MaterialDocument: '4900050304', MaterialDocumentYear: '26' }, /4 digits/],
            [{ MaterialDocument: '4900050304', MaterialDocumentYear: '2026', Text: 'x'.repeat(51) }, /at most 50/],
            [{ MaterialDocument: '4900050304', MaterialDocumentYear: '2026', Text: 'a\u0007b' }, /unsupported character/]
        ])('rejects invalid input %#', (raw, msg) => {
            expect(() => normalizeInput(raw)).toThrow(msg);
            try { normalizeInput(raw); } catch (e) { expect(e.status).toBe(400); }
        });
    });

    describe('fails closed until the SAP wrapper exists', () => {
        it.each([[null, /not installed/], ['', /not remote-enabled/]])('TFDIR FMODE %p -> 503, wrapper and MATDOC not called', async (fmode, msg) => {
            const rfc = rfcFake({ fmode });
            await expect(new QuarantineLabelAdapter(rfc).generate({ ...input, allowedPlants: null })).rejects.toMatchObject({ status: 503, message: expect.stringMatching(msg) });
            expect(rfc.call).not.toHaveBeenCalled();
            expect(rfc.readTable).toHaveBeenCalledTimes(1);
        });
        it('TFDIR unreadable -> 503', async () => {
            const rfc = rfcFake({ tfdirError: 'RFC down' });
            await expect(new QuarantineLabelAdapter(rfc).generate({ ...input, allowedPlants: null })).rejects.toMatchObject({ status: 503 });
            expect(rfc.call).not.toHaveBeenCalled();
        });
        it('invalid input is refused before any SAP call', async () => {
            const rfc = rfcFake();
            await expect(new QuarantineLabelAdapter(rfc).generate({ MaterialDocument: 'x', MaterialDocumentYear: '2026', allowedPlants: null })).rejects.toMatchObject({ status: 400 });
            expect(rfc.readTable).not.toHaveBeenCalled();
        });
    });

    describe('plant authorization (before rendering)', () => {
        it('unknown document -> 404 without rendering', async () => {
            const rfc = rfcFake({ plants: [] });
            await expect(new QuarantineLabelAdapter(rfc).generate({ ...input, allowedPlants: null })).rejects.toMatchObject({ status: 404 });
            expect(rfc.call).not.toHaveBeenCalled();
        });
        it('a document with a plant outside the user scope -> 403 without rendering', async () => {
            const rfc = rfcFake({ plants: ['1120', '1130'] });
            await expect(new QuarantineLabelAdapter(rfc).generate({ ...input, allowedPlants: ['1120'] }))
                .rejects.toMatchObject({ status: 403, message: expect.stringContaining('1130') });
            expect(rfc.call).not.toHaveBeenCalled();
        });
        it('a user with no plants is refused', async () => {
            const rfc = rfcFake();
            await expect(new QuarantineLabelAdapter(rfc).generate({ ...input, allowedPlants: [] })).rejects.toMatchObject({ status: 403 });
        });
        it('reads plants by document and year', async () => {
            const rfc = rfcFake();
            await new QuarantineLabelAdapter(rfc).generate({ ...input, allowedPlants: ['1120'] });
            expect(rfc.readTable).toHaveBeenCalledWith('MATDOC', ['WERKS'], ["MBLNR = '4900050304'", "AND MJAHR = '2026'"]);
        });
    });

    describe('rendering', () => {
        it('returns the PDF base64-encoded with count and file name (Admin, unrestricted)', async () => {
            const rfc = rfcFake();
            const res = await new QuarantineLabelAdapter(rfc).generate({ ...input, allowedPlants: null });
            expect(rfc.call).toHaveBeenCalledWith(FUNCTION_NAME, { IV_MBLNR: '4900050304', IV_MJAHR: '2026', IV_TEXT: 'Hold' });
            expect(res).toEqual({
                MaterialDocument: '4900050304', MaterialDocumentYear: '2026', LabelCount: 3,
                FileName: 'QuarantineLabels_4900050304_2026.pdf', PdfBase64: PDF.toString('base64')
            });
        });
        it.each([
            ['NOT_FOUND', 404], ['NOT_AUTHORIZED', 403], ['NO_LABEL_ROWS', 404], ['INVALID_INPUT', 400],
            ['FORM_ERROR', 502], ['EMPTY_PDF', 502], ['SOMETHING_NEW', 502]
        ])('maps EV_RESULT %s to HTTP %i with the SAP message', async (code, status) => {
            const rfc = rfcFake({ result: { EV_RESULT: code, EV_MESSAGE: `sap says ${code}` } });
            await expect(new QuarantineLabelAdapter(rfc).generate({ ...input, allowedPlants: null }))
                .rejects.toMatchObject({ status, message: `sap says ${code}` });
        });
        it('rejects a non-PDF answer even when SAP says OK', async () => {
            const rfc = rfcFake({ result: { EV_RESULT: 'OK', EV_PDF: Buffer.from('<html>'), EV_LABEL_COUNT: 1 } });
            await expect(new QuarantineLabelAdapter(rfc).generate({ ...input, allowedPlants: null })).rejects.toMatchObject({ status: 502, message: /not return a PDF/ });
        });
        it('checks TFDIR once per adapter instance', async () => {
            const rfc = rfcFake();
            const a = new QuarantineLabelAdapter(rfc);
            await a.generate({ ...input, allowedPlants: null });
            await a.generate({ ...input, allowedPlants: null });
            expect(rfc.readTable.mock.calls.filter((c) => c[0] === 'TFDIR')).toHaveLength(1);
        });
    });
});
