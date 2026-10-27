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

    describe('labelRows (rebuilt from read-only table reads; synthetic DEMO data)', () => {
        // Minimal RFC_READ_TABLE fake: every "FIELD = 'v'" in WHERE must match; repeated fields are OR'ed
        const DB = {
            MATDOC: [{ MBLNR: '4900050304', MJAHR: '2026', WERKS: 'DM01' }],
            MSEG: [
                { MBLNR: '4900050304', MJAHR: '2026', ZEILE: '0002', MATNR: 'DEMO-MAT-1', CHARG: 'DEMOB1', MENGE: '999.000', MEINS: 'KG', BUDAT_MKPF: '20261028', VBELN_IM: '', LIFNR: 'DEMOSUP02', HSDAT: '' },
                { MBLNR: '4900050304', MJAHR: '2026', ZEILE: '0001', MATNR: 'DEMO-MAT-1', CHARG: 'DEMOB1', MENGE: '120.005', MEINS: 'KG', BUDAT_MKPF: '20261027', VBELN_IM: '', LIFNR: 'DEMOSUP01', HSDAT: '20261001' },
                { MBLNR: '4900050304', MJAHR: '2026', ZEILE: '0003', MATNR: 'DEMO-MAT-2', CHARG: 'DEMOB2', MENGE: '5.000', MEINS: 'ST', BUDAT_MKPF: '20261027', VBELN_IM: '', LIFNR: '', HSDAT: '00000000' },
                { MBLNR: '4900050304', MJAHR: '2025', ZEILE: '0001', MATNR: 'DEMO-MAT-9', CHARG: 'DEMOB9', MENGE: '1.000', MEINS: 'KG', BUDAT_MKPF: '20251027', VBELN_IM: '', LIFNR: '', HSDAT: '' }
            ],
            LTAP: [
                { LGNUM: 'DM1', TANUM: '0000000012', TAPOS: '0001', MATNR: 'DEMO-MAT-1', CHARG: 'DEMOB1', VSOLM: '40.000', MEINS: 'KG', NLENR: 'DEMO-SU-0002', WENUM: '4900050304', VBELN: '', VLTYP: '920' },
                { LGNUM: 'DM1', TANUM: '0000000011', TAPOS: '0002', MATNR: 'DEMO-MAT-1', CHARG: 'DEMOB1', VSOLM: '80.000', MEINS: 'KG', NLENR: 'DEMO-SU-0001', WENUM: '4900050304', VBELN: '', VLTYP: '902' },
                { LGNUM: 'DM1', TANUM: '0000000013', TAPOS: '0001', MATNR: 'DEMO-MAT-1', CHARG: 'DEMOB1', VSOLM: '1.000', MEINS: 'KG', NLENR: 'DEMO-SU-NOTQ', WENUM: '4900050304', VBELN: '', VLTYP: '001' },
                { LGNUM: 'DM1', TANUM: '0000000014', TAPOS: '0001', MATNR: 'DEMO-MAT-2', CHARG: 'DEMOB2', VSOLM: '5.000', MEINS: 'ST', NLENR: 'DEMO-SU-0003', WENUM: '4900050304', VBELN: '', VLTYP: '920' }
            ],
            MCH1: [{ MATNR: 'DEMO-MAT-1', CHARG: 'DEMOB1', CUOBJ_BM: '123', LICHA: 'DEMO-SB-1' }],
            MAKT: [{ MATNR: 'DEMO-MAT-1', SPRAS: 'E', MAKTX: 'DEMO MATERIAL 1' }, { MATNR: 'DEMO-MAT-1', SPRAS: 'D', MAKTX: 'DEMO MATERIAL DE' }],
            BUT000: [{ PARTNER: 'DEMOSUP01', NAME_ORG1: 'DEMO SUPPLIER' }, { PARTNER: 'DEMOSUP02', NAME_ORG1: 'DEMO OTHER' }],
            AUSP: [
                { OBJEK: '000000000000000123', ATINN: '0000000818', ATWRT: 'DEMO-A', DATE_FROM: '00000000' },
                { OBJEK: '000000000000000123', ATINN: '0000000828', ATWRT: 'DEMO-B', DATE_FROM: '00000000' },
                { OBJEK: '000000000000000123', ATINN: '9999999400', ATWRT: '', DATE_FROM: '20270401' },
                { OBJEK: '000000000000000123', ATINN: '0000000999', ATWRT: 'DEMO-NOT-READ', DATE_FROM: '' }
            ]
        };
        function tableFake(db = DB) {
            const rfc = {
                where: [],
                readTable: jest.fn(async (table, fields, where = []) => {
                    rfc.where.push(...where);
                    const cond = {};
                    where.join(' ').replace(/(\w+) = '([^']*)'/g, (_, f, v) => { (cond[f] = cond[f] || []).push(v); });
                    return (db[table] || []).filter((r) => Object.entries(cond).every(([f, vs]) => vs.includes(r[f])))
                        .map((r) => Object.fromEntries(fields.map((f) => [f, r[f] ?? ''])));
                }),
                call: jest.fn()
            };
            return rfc;
        }
        const run = (rfc, extra = {}) => new QuarantineLabelAdapter(rfc).labelRows({ ...input, Text: 'DEMO TEXT', allowedPlants: ['DM01'], ...extra });

        it('one label per quarantine TO item, sorted and counted per material/batch, like ZMM_R_062', async () => {
            const res = await run(tableFake(), { resolveOutput: async () => ({ formName: null, labelSize: '4x6' }) });
            expect(res).toMatchObject({ MaterialDocument: '4900050304', MaterialDocumentYear: '2026', LabelSize: '4x6' });
            expect(res.Rows.map((r) => [r.StorageUnit, r.Container])).toEqual([
                ['DEMO-SU-0001', '1 OF 2'], ['DEMO-SU-0002', '2 OF 2'], ['DEMO-SU-0003', '1 OF 1']
            ]);
            expect(res.Rows[0]).toEqual({
                MaterialDescription: 'DEMO MATERIAL 1', MaterialDocument: '4900050304', PostingDate: '2026-10-27',
                Batch: 'DEMOB1', SupplierBatch: 'DEMO-SB-1', SupplierName: 'DEMO SUPPLIER', BatchCharacteristics: 'DEMO-A DEMO-B',
                ManufacturingDate: '2026-10-01', DateKind: 'EXPIRY', DateValue: '2027-04-01', PostedQuantity: '120.01 KG',
                ContainerQuantity: '80', Unit: 'KG', Container: '1 OF 2', StorageUnit: 'DEMO-SU-0001', Text: 'DEMO TEXT'
            });
            // no batch master / classification / supplier: empty, not invented
            expect(res.Rows[2]).toMatchObject({ Batch: '', SupplierBatch: '', SupplierName: '', BatchCharacteristics: '', DateKind: 'EXPIRY', DateValue: '', ManufacturingDate: '', PostedQuantity: '5.00 ST' });
        });
        it('prefers the retest date and labels it RETEST', async () => {
            const db = { ...DB, AUSP: [...DB.AUSP, { OBJEK: '000000000000000123', ATINN: '0000000820', ATWRT: '', DATE_FROM: '20270101' }] };
            const res = await run(tableFake(db));
            expect(res.Rows[0]).toMatchObject({ DateKind: 'RETEST', DateValue: '2027-01-01' });
        });
        it('matches LTAP by inbound delivery when the first MSEG item has one, else by document number', async () => {
            const byDoc = tableFake();
            await run(byDoc);
            expect(byDoc.where).toContain("AND WENUM = '4900050304'");
            const db = { ...DB, MSEG: DB.MSEG.map((m) => ({ ...m, VBELN_IM: 'DEMODLV01' })), LTAP: DB.LTAP.map((l) => ({ ...l, VBELN: 'DEMODLV01', WENUM: '' })) };
            const byDelivery = tableFake(db);
            const res = await run(byDelivery);
            expect(byDelivery.where).toContain("AND VBELN = 'DEMODLV01'");
            expect(byDelivery.where).not.toContain("AND WENUM = '4900050304'");
            expect(res.Rows).toHaveLength(3);
        });
        it('reads only, within the year, with RFC_READ_TABLE WHERE lines of at most 72 characters', async () => {
            const rfc = tableFake();
            await run(rfc);
            expect(rfc.call).not.toHaveBeenCalled();
            expect([...new Set(rfc.readTable.mock.calls.map((c) => c[0]))].sort()).toEqual(['AUSP', 'BUT000', 'LTAP', 'MAKT', 'MATDOC', 'MCH1', 'MSEG']);
            expect(rfc.where).toContain("AND MJAHR = '2026'");
            expect(rfc.where).toContain("AND SPRAS = 'E'");
            expect(rfc.where).toContain("AND ( VLTYP = '920' OR VLTYP = '902' )");
            rfc.where.forEach((w) => expect(w.length).toBeLessThanOrEqual(72));
        });
        it('403 before any label table is read when a plant is outside the user scope', async () => {
            const rfc = tableFake();
            await expect(run(rfc, { allowedPlants: ['DM02'] })).rejects.toMatchObject({ status: 403 });
            expect(rfc.readTable.mock.calls.map((c) => c[0])).toEqual(['MATDOC']);
        });
        it('404 when the document has no quarantine TO items', async () => {
            const db = { ...DB, LTAP: DB.LTAP.filter((l) => l.VLTYP === '001') };
            await expect(run(tableFake(db))).rejects.toMatchObject({ status: 404, message: /No quarantine label rows/ });
        });
        it('400 for invalid input before any SAP read', async () => {
            const rfc = tableFake();
            await expect(new QuarantineLabelAdapter(rfc).labelRows({ MaterialDocument: 'x', MaterialDocumentYear: '2026', allowedPlants: null })).rejects.toMatchObject({ status: 400 });
            expect(rfc.readTable).not.toHaveBeenCalled();
        });
    });

    describe('rendering', () => {
        it('returns the PDF base64-encoded with count and file name (Admin, unrestricted)', async () => {
            const rfc = rfcFake();
            const res = await new QuarantineLabelAdapter(rfc).generate({ ...input, allowedPlants: null });
            expect(rfc.call).toHaveBeenCalledWith(FUNCTION_NAME, { IV_MBLNR: '4900050304', IV_MJAHR: '2026', IV_TEXT: 'Hold' });
            expect(res).toEqual({
                MaterialDocument: '4900050304', MaterialDocumentYear: '2026', LabelCount: 3,
                FileName: 'QuarantineLabels_4900050304_2026.pdf', LabelSize: null, PdfBase64: PDF.toString('base64')
            });
        });
        it('sends IV_FORM only when a form is configured for the plants', async () => {
            const rfc = rfcFake({ plants: ['DM01'] });
            const resolveOutput = jest.fn(async () => ({ formName: 'ZDEMO_4X6', labelSize: '4x6' }));
            const res = await new QuarantineLabelAdapter(rfc).generate({ ...input, allowedPlants: null, resolveOutput });
            expect(resolveOutput).toHaveBeenCalledWith(['DM01']);
            expect(rfc.call).toHaveBeenCalledWith(FUNCTION_NAME, { IV_MBLNR: '4900050304', IV_MJAHR: '2026', IV_TEXT: 'Hold', IV_FORM: 'ZDEMO_4X6' });
            expect(res.LabelSize).toBe('4x6');
        });
        it('without configuration the call has no IV_FORM (accepted by the activated wrapper)', async () => {
            const rfc = rfcFake();
            await new QuarantineLabelAdapter(rfc).generate({ ...input, allowedPlants: null, resolveOutput: async () => ({ formName: null, labelSize: null }) });
            expect(rfc.call.mock.calls[0][1]).not.toHaveProperty('IV_FORM');
        });
        it('a settings conflict stops before rendering', async () => {
            const rfc = rfcFake();
            const resolveOutput = async () => { throw Object.assign(new Error('different settings'), { status: 409 }); };
            await expect(new QuarantineLabelAdapter(rfc).generate({ ...input, allowedPlants: null, resolveOutput })).rejects.toMatchObject({ status: 409 });
            expect(rfc.call).not.toHaveBeenCalled();
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
