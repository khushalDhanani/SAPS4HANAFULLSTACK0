'use strict';

const QuarantineLabelAdapter = require('../../../srv/integration/s4hana/wm/QuarantineLabelAdapter');
const { normalizeInput, FUNCTION_NAME } = QuarantineLabelAdapter;

const PDF = Buffer.from('%PDF-1.7\n...');

/** RFC fake: TFDIR / MATDOC rows and the wrapper's export parameters. */
const WRAPPER_WITH_FORM = ['IV_MBLNR', 'IV_MJAHR', 'IV_TEXT', 'IV_FORM'].map((p) => ({ PARAMCLASS: 'I', PARAMETER: p }));
function rfcFake({ fmode = 'R', plants = ['1120'], result = { EV_RESULT: 'OK', EV_PDF: PDF, EV_LABEL_COUNT: 3 }, tfdirError, ifaceParams = WRAPPER_WITH_FORM } = {}) {
    return {
        readTable: jest.fn(async (table) => {
            if (table === 'TFDIR') {
                if (tfdirError) throw new Error(tfdirError);
                return fmode === null ? [] : [{ FUNCNAME: FUNCTION_NAME, FMODE: fmode }];
            }
            if (table === 'MATDOC') return plants.flatMap((p) => [{ WERKS: p }, { WERKS: p }]);
            throw new Error(`unexpected table ${table}`);
        }),
        call: jest.fn(async (fm) => (fm === 'RFC_GET_FUNCTION_INTERFACE' ? { PARAMS: ifaceParams } : result))
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
        it('a configured form fails clearly, without rendering, when the active wrapper has no IV_FORM', async () => {
            const rfc = rfcFake({ plants: ['DM01'], ifaceParams: ['IV_MBLNR', 'IV_MJAHR', 'IV_TEXT'].map((p) => ({ PARAMCLASS: 'I', PARAMETER: p })) });
            const resolveOutput = async () => ({ formName: 'ZDEMO_4X6', labelSize: '4x6' });
            await expect(new QuarantineLabelAdapter(rfc).generate({ ...input, allowedPlants: null, resolveOutput }))
                .rejects.toMatchObject({ status: 409, message: expect.stringMatching(/ZDEMO_4X6.*does not accept a form name \(IV_FORM\).*Nothing was printed/) });
            expect(rfc.call.mock.calls.map((c) => c[0])).toEqual(['RFC_GET_FUNCTION_INTERFACE']); // never rendered
        });
        it('an export parameter named IV_FORM does not count; an unreadable interface is 503', async () => {
            const resolveOutput = async () => ({ formName: 'ZDEMO_4X6', labelSize: '4x6' });
            const rfc = rfcFake({ ifaceParams: [{ PARAMCLASS: 'E', PARAMETER: 'IV_FORM' }] });
            await expect(new QuarantineLabelAdapter(rfc).generate({ ...input, allowedPlants: null, resolveOutput })).rejects.toMatchObject({ status: 409 });
            const down = rfcFake();
            down.call.mockImplementation(async (fm) => { if (fm === 'RFC_GET_FUNCTION_INTERFACE') throw new Error('RFC down'); return {}; });
            await expect(new QuarantineLabelAdapter(down).generate({ ...input, allowedPlants: null, resolveOutput })).rejects.toMatchObject({ status: 503 });
        });
        it('checks the wrapper interface only when a form is configured, once per adapter', async () => {
            const rfc = rfcFake();
            const a = new QuarantineLabelAdapter(rfc);
            await a.generate({ ...input, allowedPlants: null, resolveOutput: async () => ({ formName: null, labelSize: null }) });
            expect(rfc.call.mock.calls.map((c) => c[0])).not.toContain('RFC_GET_FUNCTION_INTERFACE');
            const withForm = async () => ({ formName: 'ZDEMO_4X6', labelSize: '4x6' });
            await a.generate({ ...input, allowedPlants: null, resolveOutput: withForm });
            await a.generate({ ...input, allowedPlants: null, resolveOutput: withForm });
            expect(rfc.call.mock.calls.filter((c) => c[0] === 'RFC_GET_FUNCTION_INTERFACE')).toHaveLength(1);
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
    describe('listDocuments (GR documents, movement type 101; read only; synthetic DEMO data)', () => {
        const { normalizeListInput, LIST_MAX_ITEMS } = QuarantineLabelAdapter;
        const MSEG = [
            { MBLNR: '5000000001', MJAHR: '2026', ZEILE: '0002', BWART: '101', WERKS: 'DM01', MATNR: 'DEMO-MAT-2', CHARG: 'B2', LIFNR: 'DEMOSUP01', BUDAT_MKPF: '20261020' },
            { MBLNR: '5000000001', MJAHR: '2026', ZEILE: '0001', BWART: '101', WERKS: 'DM01', MATNR: 'DEMO-MAT-1', CHARG: 'B1', LIFNR: 'DEMOSUP01', BUDAT_MKPF: '20261020' },
            { MBLNR: '5000000002', MJAHR: '2026', ZEILE: '0001', BWART: '101', WERKS: 'DM01', MATNR: 'DEMO-MAT-3', CHARG: '', LIFNR: '', BUDAT_MKPF: '20261025' },
            { MBLNR: '5000000003', MJAHR: '2026', ZEILE: '0001', BWART: '102', WERKS: 'DM01', MATNR: 'DEMO-MAT-1', CHARG: 'B1', LIFNR: 'DEMOSUP01', BUDAT_MKPF: '20261025' },
            { MBLNR: '5000000004', MJAHR: '2026', ZEILE: '0001', BWART: '101', WERKS: 'DM02', MATNR: 'DEMO-MAT-1', CHARG: 'B1', LIFNR: 'DEMOSUP01', BUDAT_MKPF: '20261025' },
            { MBLNR: '5000000005', MJAHR: '2026', ZEILE: '0001', BWART: '101', WERKS: 'DM01', MATNR: 'DEMO-MAT-1', CHARG: 'B1', LIFNR: 'DEMOSUP01', BUDAT_MKPF: '20260901' }
        ];
        const DB = {
            MSEG,
            MAKT: [{ MATNR: 'DEMO-MAT-1', SPRAS: 'E', MAKTX: 'DEMO MATERIAL 1' }, { MATNR: 'DEMO-MAT-1', SPRAS: 'D', MAKTX: 'DE TEXT' }, { MATNR: 'DEMO-MAT-3', SPRAS: 'E', MAKTX: 'DEMO MATERIAL 3' }],
            BUT000: [{ PARTNER: 'DEMOSUP01', NAME_ORG1: 'DEMO SUPPLIER' }]
        };
        // RFC_READ_TABLE fake for "F = 'v'" (repeated fields OR'ed) and "F BETWEEN 'a' AND 'b'"
        function listFake(db = DB) {
            const rfc = {
                readTable: jest.fn(async (table, fields, where = [], rowCount = 0) => {
                    const w = where.join(' ');
                    const between = [...w.matchAll(/(\w+) BETWEEN '([^']*)' AND '([^']*)'/g)];
                    const cond = {};
                    w.replace(/(\w+) BETWEEN '[^']*' AND '[^']*'/g, '').replace(/(\w+) = '([^']*)'/g, (_, f, v) => { (cond[f] = cond[f] || []).push(v); });
                    const rows = (db[table] || []).filter((r) => Object.entries(cond).every(([f, vs]) => vs.includes(r[f]))
                        && between.every(([, f, a, b]) => r[f] >= a && r[f] <= b))
                        .map((r) => Object.fromEntries(fields.map((f) => [f, r[f] ?? ''])));
                    return rowCount ? rows.slice(0, rowCount) : rows;
                }),
                call: jest.fn()
            };
            return rfc;
        }
        const range = { Plant: 'dm01', DateFrom: '2026-10-01', DateTo: '2026-10-27' };

        it('one row per document/year (first item), movement 101 of the plant and date range, newest first', async () => {
            const rfc = listFake();
            const res = await new QuarantineLabelAdapter(rfc).listDocuments({ ...range, allowedPlants: ['DM01'] });
            expect(res).toMatchObject({ Plant: 'DM01', DateFrom: '2026-10-01', DateTo: '2026-10-27', More: false });
            expect(res.Documents).toEqual([
                { MaterialDocument: '5000000002', MaterialDocumentYear: '2026', PostingDate: '2026-10-25', Plant: 'DM01', Material: 'DEMO-MAT-3', MaterialDescription: 'DEMO MATERIAL 3', Batch: '', SupplierName: '' },
                { MaterialDocument: '5000000001', MaterialDocumentYear: '2026', PostingDate: '2026-10-20', Plant: 'DM01', Material: 'DEMO-MAT-1', MaterialDescription: 'DEMO MATERIAL 1', Batch: 'B1', SupplierName: 'DEMO SUPPLIER' }
            ]);
            expect(rfc.readTable.mock.calls[0]).toEqual(['MSEG', ['MBLNR', 'MJAHR', 'ZEILE', 'MATNR', 'CHARG', 'LIFNR', 'BUDAT_MKPF'],
                ["BWART = '101'", "AND WERKS = 'DM01'", "AND BUDAT_MKPF BETWEEN '20261001' AND '20261027'"], LIST_MAX_ITEMS + 1]);
            expect(rfc.call).not.toHaveBeenCalled(); // read only: RFC_READ_TABLE through readTable, nothing else
            rfc.readTable.mock.calls.forEach(([, , where]) => where.forEach((l) => expect(l.length).toBeLessThanOrEqual(72)));
        });
        it('one document by number and year instead of a date range', async () => {
            const rfc = listFake();
            const res = await new QuarantineLabelAdapter(rfc).listDocuments({ Plant: 'DM01', MaterialDocument: '5000000001', MaterialDocumentYear: '2026', allowedPlants: null });
            expect(res.Documents.map((d) => d.MaterialDocument)).toEqual(['5000000001']);
            expect(res).toMatchObject({ DateFrom: null, DateTo: null });
            expect(rfc.readTable.mock.calls[0][2]).toEqual(["BWART = '101'", "AND WERKS = 'DM01'", "AND MBLNR = '5000000001'", "AND MJAHR = '2026'"]);
        });
        it('more items than the limit: says so instead of silently dropping documents', async () => {
            const many = Array.from({ length: LIST_MAX_ITEMS + 3 }, (_, i) => ({ ...MSEG[2], MBLNR: String(6000000000 + i), ZEILE: '0001' }));
            const res = await new QuarantineLabelAdapter(listFake({ ...DB, MSEG: many })).listDocuments({ ...range, allowedPlants: null });
            expect(res.More).toBe(true);
            expect(res.Documents).toHaveLength(LIST_MAX_ITEMS);
        });
        it('material texts and supplier names are read in chunks of OR lines under 72 characters', async () => {
            const many = Array.from({ length: 120 }, (_, i) => ({ ...MSEG[1], MBLNR: String(7000000000 + i), MATNR: `DEMO-MATERIAL-WITH-A-LONG-NUMBER-${String(i).padStart(5, '0')}`, LIFNR: `SUP${i}` }));
            const rfc = listFake({ ...DB, MSEG: many });
            await new QuarantineLabelAdapter(rfc).listDocuments({ ...range, allowedPlants: null });
            const tables = rfc.readTable.mock.calls.map((c) => c[0]);
            expect(tables.filter((t) => t === 'MAKT')).toHaveLength(3);
            expect(tables.filter((t) => t === 'BUT000')).toHaveLength(3);
            rfc.readTable.mock.calls.forEach(([, , where]) => where.forEach((l) => expect(l.length).toBeLessThanOrEqual(72)));
        });
        it('403 for a plant outside the user\'s plants, before any SAP read', async () => {
            const rfc = listFake();
            await expect(new QuarantineLabelAdapter(rfc).listDocuments({ ...range, allowedPlants: ['DM02'] })).rejects.toMatchObject({ status: 403 });
            await expect(new QuarantineLabelAdapter(rfc).listDocuments({ ...range, allowedPlants: [] })).rejects.toMatchObject({ status: 403 });
            expect(rfc.readTable).not.toHaveBeenCalled();
        });
        it('validates plant, dates and the 31-day range; a document needs its year', () => {
            expect(normalizeListInput(range)).toEqual({ plant: 'DM01', from: '2026-10-01', to: '2026-10-27' });
            [
                { ...range, Plant: 'DM1' }, { ...range, Plant: "DM0'" }, { ...range, DateFrom: '2026-02-30' }, { ...range, DateTo: '' },
                { ...range, DateFrom: '2026-10-28' }, { ...range, DateFrom: '2026-09-01' },
                { Plant: 'DM01', MaterialDocument: '5000000001' }, { Plant: 'DM01', MaterialDocument: 'X1', MaterialDocumentYear: '2026' }
            ].forEach((bad) => expect(() => normalizeListInput(bad)).toThrow(expect.objectContaining({ status: 400 })));
            expect(normalizeListInput({ ...range, DateFrom: '2026-09-27' })).toMatchObject({ from: '2026-09-27' }); // 31 days
        });
        it('no documents: empty list, no lookups', async () => {
            const rfc = listFake({ ...DB, MSEG: [] });
            const res = await new QuarantineLabelAdapter(rfc).listDocuments({ ...range, allowedPlants: null });
            expect(res).toMatchObject({ More: false, Documents: [] });
            expect(rfc.readTable).toHaveBeenCalledTimes(1);
        });
    });
});
