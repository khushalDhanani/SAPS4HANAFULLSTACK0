'use strict';

jest.mock('../../../srv/common/logger', () => () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const { SalesInquiryRfcCreator, buildInput, BAPI } = require('../../../srv/integration/s4hana/sd/sales-inquiry/SalesInquiryRfcCreator');

const header = () => ({
    SalesInquiryType: 'ZLIS', SalesOrganization: '1000', DistributionChannel: '10', OrganizationDivision: '52',
    SoldToParty: '10000', ShipToParty: '10000', TransactionCurrency: 'inr', PurchaseOrderByCustomer: 'PO-1',
    CustomerPurchaseOrderDate: '2026-10-29', SalesInquiryDate: '2026-10-29', BindingPeriodValidityStartDate: '2026-10-29',
    BindingPeriodValidityEndDate: '2026-11-28'
});
const items = () => [{ SalesInquiryItem: '000010', Material: '4000000001', OrderQuantity: '1.000', OrderQuantityUnit: 'kg', Plant: '1110', SalesInquiryItemText: 'Resin' }];

/** Fake RFC session client: records every call and answers from `answers`. */
function fakeRfc(answers = {}) {
    const calls = [];
    return {
        calls,
        session: async (fn) => fn(async (fm, params) => {
            calls.push({ fm, params });
            const a = answers[fm];
            if (a instanceof Error) throw a;
            return typeof a === 'function' ? a(params) : (a || {});
        }),
        readTable: jest.fn().mockResolvedValue([{ VBELN: '0001500200', AUART: 'ZLIS', VBTYP: 'A', KUNNR: '0000010000' }])
    };
}
const ok = { SALESDOCUMENT: '0001500200', RETURN: [{ TYPE: 'S', ID: 'V1', NUMBER: '311', MESSAGE: 'Inquiry saved' }] };

describe('buildInput: domain -> BAPI structures', () => {
    it('maps header, update flags, partners, items and schedule lines', () => {
        const b = buildInput(header(), items());
        expect(b.INQUIRY_HEADER_IN).toMatchObject({
            DOC_TYPE: 'ZLIS', SALES_ORG: '1000', DISTR_CHAN: '10', DIVISION: '52', CURRENCY: 'INR', PURCH_NO_C: 'PO-1',
            PURCH_DATE: '20261029', DOC_DATE: '20261029', QT_VALID_F: '20261029', QT_VALID_T: '20261128'
        });
        expect(b.INQUIRY_HEADER_INX).toMatchObject({ UPDATEFLAG: 'I', DOC_TYPE: 'X', SALES_ORG: 'X', CURRENCY: 'X', QT_VALID_T: 'X' });
        expect(b.INQUIRY_PARTNERS).toEqual([{ PARTN_ROLE: 'AG', PARTN_NUMB: '0000010000' }, { PARTN_ROLE: 'WE', PARTN_NUMB: '0000010000' }]);
        expect(b.INQUIRY_ITEMS_IN).toEqual([{ ITM_NUMBER: '000010', MATERIAL_LONG: '000000004000000001', SALES_UNIT: 'KG', PLANT: '1110', SHORT_TEXT: 'Resin' }]);
        expect(b.INQUIRY_ITEMS_INX[0]).toEqual({ ITM_NUMBER: '000010', UPDATEFLAG: 'I', MATERIAL_LONG: 'X', SALES_UNIT: 'X', PLANT: 'X', SHORT_TEXT: 'X' });
        expect(b.INQUIRY_SCHEDULES_IN).toEqual([{ ITM_NUMBER: '000010', SCHED_LINE: '0001', SCHED_TYPE: 'AT', REQ_DATE: '20261029', REQ_QTY: 1 }]);
        expect(b.INQUIRY_SCHEDULES_INX).toEqual([{ ITM_NUMBER: '000010', SCHED_LINE: '0001', UPDATEFLAG: 'I', SCHED_TYPE: 'X', REQ_DATE: 'X', REQ_QTY: 'X' }]);
    });

    it('sends no blank header field and flags only what it sends', () => {
        const h = { ...header(), PurchaseOrderByCustomer: '', SalesOffice: ' ' };
        const b = buildInput(h, items());
        expect(b.INQUIRY_HEADER_IN).not.toHaveProperty('PURCH_NO_C');
        expect(b.INQUIRY_HEADER_INX).not.toHaveProperty('PURCH_NO_C');
        expect(b.INQUIRY_HEADER_IN).not.toHaveProperty('SALES_OFF');
    });

    it('dates the schedule line with today when the inquiry has no date', () => {
        const h = header(); delete h.SalesInquiryDate;
        const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        expect(buildInput(h, items()).INQUIRY_SCHEDULES_IN[0].REQ_DATE).toBe(today);
    });

    it('omits the ship-to partner when none is given and numbers items itself when the item has no number', () => {
        const h = header(); delete h.ShipToParty;
        const it = items(); delete it[0].SalesInquiryItem;
        const b = buildInput(h, it);
        expect(b.INQUIRY_PARTNERS).toEqual([{ PARTN_ROLE: 'AG', PARTN_NUMB: '0000010000' }]);
        expect(b.INQUIRY_ITEMS_IN[0].ITM_NUMBER).toBe('000010');
    });

    it.each([
        ['a field with no verified BAPI field (ContactPerson)', { ContactPerson: '25641' }, /ContactPerson cannot be sent/],
        ['a field with no verified BAPI field (PortOfLoading)', { PortOfLoading: 'INMAA' }, /PortOfLoading cannot be sent/],
        ['a missing sold-to party', { SoldToParty: '' }, /SoldToParty is required/],
        ['a missing document type', { SalesInquiryType: '' }, /DOC_TYPE is required/],
        ['a bad date', { SalesInquiryDate: 'tomorrow' }, /not a date/]
    ])('refuses %s instead of dropping it', (_l, patch, msg) => {
        expect(() => buildInput({ ...header(), ...patch }, items())).toThrow(msg);
    });

    it.each([
        ['no items', []],
        ['zero quantity', [{ ...items()[0], OrderQuantity: '0' }]],
        ['no unit', [{ ...items()[0], OrderQuantityUnit: '' }]],
        ['no material', [{ ...items()[0], Material: '' }]]
    ])('refuses an item list with %s', (_l, list) => {
        expect(() => buildInput(header(), list)).toThrow();
    });
});

describe('SalesInquiryRfcCreator.create: one LUW', () => {
    it('creates, commits with WAIT and returns the document number', async () => {
        const rfc = fakeRfc({ [BAPI]: ok, BAPI_TRANSACTION_COMMIT: { RETURN: { TYPE: '', MESSAGE: '' } } });
        const out = await new SalesInquiryRfcCreator({ rfc }).create(header(), items());
        expect(out).toMatchObject({ SalesInquiry: '0001500200', testRun: false });
        expect(rfc.calls.map((c) => c.fm)).toEqual([BAPI, 'BAPI_TRANSACTION_COMMIT']);
        expect(rfc.calls[0].params.TESTRUN).toBe('');
        expect(rfc.calls[1].params).toEqual({ WAIT: 'X' });
    });

    it('rolls back and reports the SAP message when RETURN has an error; never commits', async () => {
        const rfc = fakeRfc({ [BAPI]: { SALESDOCUMENT: '', RETURN: [{ TYPE: 'E', ID: 'V1', NUMBER: '042', MESSAGE: 'Sold-to party 10000 is not defined for the sales area' }] } });
        await expect(new SalesInquiryRfcCreator({ rfc }).create(header(), items())).rejects.toMatchObject({ status: 400, message: expect.stringContaining('not defined for the sales area') });
        expect(rfc.calls.map((c) => c.fm)).toEqual([BAPI, 'BAPI_TRANSACTION_ROLLBACK']);
    });

    it('names where SAP says the error applies (variables, field, parameter) in the thrown message', async () => {
        const rfc = fakeRfc({ [BAPI]: { SALESDOCUMENT: '', RETURN: [{ TYPE: 'E', ID: 'V1', NUMBER: '311', MESSAGE: 'Document is incomplete', MESSAGE_V1: 'VBAPKOM', MESSAGE_V2: '000010', FIELD: 'KWMENG', PARAMETER: 'VBUVKOM' }] } });
        await expect(new SalesInquiryRfcCreator({ rfc }).create(header(), items())).rejects.toThrow('Document is incomplete [VBAPKOM, 000010] (KWMENG) @VBUVKOM');
    });

    it('treats an abort message (A) like an error', async () => {
        const rfc = fakeRfc({ [BAPI]: { SALESDOCUMENT: '0001500201', RETURN: [{ TYPE: 'A', MESSAGE: 'Update terminated' }] } });
        await expect(new SalesInquiryRfcCreator({ rfc }).create(header(), items())).rejects.toThrow(/Update terminated/);
        expect(rfc.calls.some((c) => c.fm === 'BAPI_TRANSACTION_COMMIT')).toBe(false);
    });

    it('rolls back and fails when SAP returns no document number', async () => {
        const rfc = fakeRfc({ [BAPI]: { SALESDOCUMENT: '', RETURN: [] } });
        await expect(new SalesInquiryRfcCreator({ rfc }).create(header(), items())).rejects.toMatchObject({ status: 502, message: expect.stringContaining('no document number') });
        expect(rfc.calls.map((c) => c.fm)).toEqual([BAPI, 'BAPI_TRANSACTION_ROLLBACK']);
    });

    it('names the document when the commit fails', async () => {
        const rfc = fakeRfc({ [BAPI]: ok, BAPI_TRANSACTION_COMMIT: { RETURN: { TYPE: 'E', MESSAGE: 'Commit failed' } } });
        await expect(new SalesInquiryRfcCreator({ rfc }).create(header(), items())).rejects.toMatchObject({ SalesInquiry: '0001500200', name: 'PartialSalesInquiryError', status: 502 });
    });

    it('runs a test run without ever committing or rolling back', async () => {
        const rfc = fakeRfc({ [BAPI]: { SALESDOCUMENT: '', RETURN: [{ TYPE: 'S', MESSAGE: 'Inquiry would be saved' }] } });
        const out = await new SalesInquiryRfcCreator({ rfc }).create(header(), items(), { testRun: true });
        expect(out).toMatchObject({ testRun: true });
        expect(out.SalesInquiry).toBeUndefined();
        expect(rfc.calls.map((c) => c.fm)).toEqual([BAPI]);
        expect(rfc.calls[0].params.TESTRUN).toBe('X');
    });

    it('keeps SAP message variables, parameter, row and field so a warning can be located', async () => {
        const rfc = fakeRfc({ [BAPI]: { RETURN: [{ TYPE: 'W', ID: 'V1', NUMBER: '555', MESSAGE: 'The sales document is not yet complete: Edit data', MESSAGE_V1: ' 0000000010 ', PARAMETER: 'INQUIRY_ITEMS_IN', ROW: '1', FIELD: 'KWMENG' }] } });
        const out = await new SalesInquiryRfcCreator({ rfc }).create(header(), items(), { testRun: true });
        expect(out.messages[0]).toMatchObject({ type: 'W', vars: ['0000000010'], parameter: 'INQUIRY_ITEMS_IN', row: 1, field: 'KWMENG' });
    });

    it('reports SAP errors of a test run', async () => {
        const rfc = fakeRfc({ [BAPI]: { RETURN: [{ TYPE: 'E', MESSAGE: 'Material 4000000001 is not maintained in plant 1110' }] } });
        await expect(new SalesInquiryRfcCreator({ rfc }).create(header(), items(), { testRun: true })).rejects.toThrow(/not maintained in plant 1110/);
    });

    it('makes no RFC call when the input is invalid', async () => {
        const rfc = fakeRfc();
        await expect(new SalesInquiryRfcCreator({ rfc }).create({ ...header(), ContactPerson: '1' }, items())).rejects.toThrow();
        expect(rfc.calls).toHaveLength(0);
    });

    it('reads the document back from VBAK', async () => {
        const rfc = fakeRfc();
        const row = await new SalesInquiryRfcCreator({ rfc }).readBack('0001500200');
        expect(rfc.readTable).toHaveBeenCalledWith('VBAK', ['VBELN', 'AUART', 'VBTYP', 'KUNNR'], ["VBELN = '0001500200'"], 1);
        expect(row.VBELN).toBe('0001500200');
    });
});

describe('SalesInquiryAdapter.createSalesInquiryViaRfc', () => {
    const { SalesInquiryAdapter } = (() => { const m = require('../../../srv/integration/s4hana/sd/sales-inquiry/SalesInquiryAdapter'); return { SalesInquiryAdapter: m.constructor }; })();

    it('returns the test run result without a read-back', async () => {
        const creator = { create: jest.fn().mockResolvedValue({ testRun: true, messages: [] }), readBack: jest.fn() };
        const out = await SalesInquiryAdapter.prototype.createSalesInquiryViaRfc.call({ rfc: {} }, header(), items(), { creator, testRun: true });
        expect(out.testRun).toBe(true);
        expect(creator.readBack).not.toHaveBeenCalled();
        expect(creator.create).toHaveBeenCalledWith(expect.anything(), expect.anything(), { testRun: true });
    });

    it('fails with the document number when the committed document cannot be read back', async () => {
        const creator = { create: jest.fn().mockResolvedValue({ SalesInquiry: '0001500200', testRun: false }), readBack: jest.fn().mockResolvedValue(null) };
        await expect(SalesInquiryAdapter.prototype.createSalesInquiryViaRfc.call({ rfc: {} }, header(), items(), { creator }))
            .rejects.toMatchObject({ SalesInquiry: '0001500200', name: 'PartialSalesInquiryError' });
    });

    it('returns the created document after a successful read-back', async () => {
        const creator = { create: jest.fn().mockResolvedValue({ SalesInquiry: '0001500200', testRun: false }), readBack: jest.fn().mockResolvedValue({ VBELN: '0001500200' }) };
        const out = await SalesInquiryAdapter.prototype.createSalesInquiryViaRfc.call({ rfc: {} }, header(), items(), { creator });
        expect(out.SalesInquiry).toBe('0001500200');
    });
});
