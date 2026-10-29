'use strict';

jest.mock('../../../srv/common/logger', () => () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../../../srv/integration/s4hana/sd/customerSalesArea', () => ({
    resolveCustomerSalesArea: jest.fn().mockResolvedValue({ salesOrganization: '1000', distributionChannel: '10', division: '52' })
}));

const { CustomerReturnRfcCreator, buildInput, BAPI } = require('../../../srv/integration/s4hana/sd/customer-return/CustomerReturnRfcCreator');
const { CustomerReturnAdapter } = require('../../../srv/integration/s4hana/sd/customer-return/CustomerReturnAdapter');

const salesArea = { salesOrganization: '1000', distributionChannel: '10', division: '52' };
const payload = () => ({
    CustomerReturnType: 'ZRET', SoldToParty: '10276', ReturnsOrderReason: '008', ReferenceSDDocument: '5000446', ReferenceSDDocumentCategory: 'C',
    CustomerReturnDate: '2026-10-29', PurchaseOrderByCustomer: 'PO-9',
    Items: [{ Material: '4000000181', OrderQuantity: 10, OrderQuantityUnit: 'kg', ProductionPlant: '1130', StorageLocation: 'fg01', ReturnReason: '008', ReferenceSDDocument: '5000446', ReferenceSDDocumentItem: '000010' }]
});

function fakeRfc(answers = {}) {
    const calls = [];
    return {
        calls,
        session: async (fn) => fn(async (fm, params) => {
            calls.push({ fm, params });
            const a = answers[fm];
            if (a instanceof Error) throw a;
            return a || {};
        }),
        readTable: jest.fn()
    };
}
const ok = { SALESDOCUMENT: '0004500190', RETURN: [{ TYPE: 'S', ID: 'V1', NUMBER: '311', MESSAGE: 'Return saved' }] };

describe('buildInput: domain -> BAPI_CUSTOMERRETURN_CREATE', () => {
    it('carries reason, reference document, storage location, plant and the quantity in a dated schedule line', () => {
        const b = buildInput(payload(), salesArea);
        expect(b.RETURN_HEADER_IN).toEqual({ DOC_TYPE: 'ZRET', SALES_ORG: '1000', DISTR_CHAN: '10', DIVISION: '52', ORD_REASON: '008', REF_DOC: '0005000446', REFDOC_CAT: 'C', PURCH_NO_C: 'PO-9', DOC_DATE: '20261029' });
        expect(b.RETURN_HEADER_INX).toMatchObject({ UPDATEFLAG: 'I', ORD_REASON: 'X', REF_DOC: 'X', REFDOC_CAT: 'X', DOC_TYPE: 'X' });
        expect(b.RETURN_PARTNERS).toEqual([{ PARTN_ROLE: 'AG', PARTN_NUMB: '0000010276' }]);
        expect(b.RETURN_ITEMS_IN).toEqual([{ ITM_NUMBER: '000010', MATERIAL_LONG: '000000004000000181', PLANT: '1130', SALES_UNIT: 'KG', STORE_LOC: 'FG01', REF_DOC: '0005000446', REF_DOC_IT: '000010', REF_DOC_CA: 'C' }]);
        expect(b.RETURN_ITEMS_INX[0]).toEqual({ ITM_NUMBER: '000010', UPDATEFLAG: 'I', MATERIAL_LONG: 'X', PLANT: 'X', SALES_UNIT: 'X', STORE_LOC: 'X', REF_DOC: 'X', REF_DOC_IT: 'X', REF_DOC_CA: 'X' });
        expect(b.RETURN_SCHEDULES_IN).toEqual([{ ITM_NUMBER: '000010', SCHED_LINE: '0001', REQ_DATE: '20261029', REQ_QTY: 10 }]);
        expect(b.RETURN_SCHEDULES_INX).toEqual([{ ITM_NUMBER: '000010', SCHED_LINE: '0001', UPDATEFLAG: 'I', REQ_DATE: 'X', REQ_QTY: 'X' }]);
    });

    it('sends no reference fields when none is given and treats item reference "0" as none', () => {
        const p = payload(); delete p.ReferenceSDDocument; delete p.ReferenceSDDocumentCategory;
        p.Items[0].ReferenceSDDocument = ''; p.Items[0].ReferenceSDDocumentItem = '0'; delete p.Items[0].StorageLocation;
        const b = buildInput(p, salesArea);
        expect(b.RETURN_HEADER_IN).not.toHaveProperty('REF_DOC');
        expect(b.RETURN_ITEMS_IN[0]).toEqual({ ITM_NUMBER: '000010', MATERIAL_LONG: '000000004000000181', PLANT: '1130', SALES_UNIT: 'KG' });
    });

    it('dates the schedule line with today when the return has no date', () => {
        const p = payload(); delete p.CustomerReturnDate;
        expect(buildInput(p, salesArea).RETURN_SCHEDULES_IN[0].REQ_DATE).toBe(new Date().toISOString().slice(0, 10).replace(/-/g, ''));
    });

    it.each([
        ['no sold-to', { SoldToParty: '' }, /SoldToParty is required/],
        ['no reason', { ReturnsOrderReason: '' }, /ReturnsOrderReason is required/],
        ['no type', { CustomerReturnType: '' }, /CustomerReturnType is required/],
        ['no items', { Items: [] }, /At least one item/],
        ['bad date', { CustomerReturnDate: 'soon' }, /not a date/],
        ['zero quantity', { Items: [{ Material: 'M', OrderQuantity: 0, OrderQuantityUnit: 'KG', ProductionPlant: '1130' }] }, /OrderQuantity must be greater than 0/],
        ['no unit', { Items: [{ Material: 'M', OrderQuantity: 1, OrderQuantityUnit: '', ProductionPlant: '1130' }] }, /OrderQuantityUnit is required/],
        ['no plant', { Items: [{ Material: 'M', OrderQuantity: 1, OrderQuantityUnit: 'KG' }] }, /Plant is required/],
        ['an item reason that differs from the header reason', { Items: [{ Material: 'M', OrderQuantity: 1, OrderQuantityUnit: 'KG', ProductionPlant: '1130', ReturnReason: '005' }] }, /differs from the header reason/]
    ])('refuses %s', (_l, patch, msg) => {
        expect(() => buildInput({ ...payload(), ...patch }, salesArea)).toThrow(msg);
    });

    it('refuses a missing sales area', () => {
        expect(() => buildInput(payload(), {})).toThrow(/sales area is required/);
    });
});

describe('CustomerReturnRfcCreator.create: one LUW', () => {
    it('creates, commits with WAIT and returns the document number', async () => {
        const rfc = fakeRfc({ [BAPI]: ok, BAPI_TRANSACTION_COMMIT: { RETURN: { TYPE: '', MESSAGE: '' } } });
        const out = await new CustomerReturnRfcCreator({ rfc }).create(payload(), salesArea);
        expect(out).toMatchObject({ CustomerReturn: '0004500190', testRun: false });
        expect(rfc.calls.map((c) => c.fm)).toEqual([BAPI, 'BAPI_TRANSACTION_COMMIT']);
        expect(rfc.calls[0].params.TESTRUN).toBe('');
    });

    it('rolls back and names the SAP message; never commits', async () => {
        const rfc = fakeRfc({ [BAPI]: { SALESDOCUMENT: '', RETURN: [{ TYPE: 'E', ID: 'V1', NUMBER: '042', MESSAGE: 'Order reason is missing', MESSAGE_V1: 'VBAK', FIELD: 'AUGRU' }] } });
        await expect(new CustomerReturnRfcCreator({ rfc }).create(payload(), salesArea)).rejects.toMatchObject({ status: 400, message: expect.stringContaining('Order reason is missing [VBAK] (AUGRU)') });
        expect(rfc.calls.map((c) => c.fm)).toEqual([BAPI, 'BAPI_TRANSACTION_ROLLBACK']);
    });

    it('names the document and the Partial error when the commit fails', async () => {
        const rfc = fakeRfc({ [BAPI]: ok, BAPI_TRANSACTION_COMMIT: { RETURN: { TYPE: 'E', MESSAGE: 'Commit failed' } } });
        await expect(new CustomerReturnRfcCreator({ rfc }).create(payload(), salesArea)).rejects.toMatchObject({ CustomerReturn: '0004500190', name: 'PartialCustomerReturnError', status: 502 });
    });

    it('runs a test run without committing or rolling back', async () => {
        const rfc = fakeRfc({ [BAPI]: { RETURN: [{ TYPE: 'W', ID: 'V1', NUMBER: '555', MESSAGE: 'not yet complete' }] } });
        const out = await new CustomerReturnRfcCreator({ rfc }).create(payload(), salesArea, { testRun: true });
        expect(out.testRun).toBe(true);
        expect(rfc.calls.map((c) => c.fm)).toEqual([BAPI]);
        expect(rfc.calls[0].params.TESTRUN).toBe('X');
    });

    it('makes no RFC call when the input is invalid', async () => {
        const rfc = fakeRfc();
        await expect(new CustomerReturnRfcCreator({ rfc }).create({ ...payload(), ReturnsOrderReason: '' }, salesArea)).rejects.toThrow();
        expect(rfc.calls).toHaveLength(0);
    });

    it('reads header and items back from VBAK / VBAP with the 10-digit number', async () => {
        const rfc = fakeRfc();
        rfc.readTable.mockResolvedValueOnce([{ VBELN: '0004500190', AUGRU: '008' }]).mockResolvedValueOnce([{ POSNR: '000010' }]);
        const out = await new CustomerReturnRfcCreator({ rfc }).readBack('4500190');
        expect(rfc.readTable.mock.calls[0][2]).toEqual(["VBELN = '0004500190'"]);
        expect(out.header.AUGRU).toBe('008');
    });
});

describe('CustomerReturnAdapter.createCustomerReturnViaRfc', () => {
    const run = (creator, extra = {}, p = payload()) => {
        const self = { rfc: { readTable: jest.fn().mockResolvedValue([{ WERKS: '1130' }]) }, getCustomerReturn: jest.fn().mockResolvedValue({ TotalNetAmount: 0, TransactionCurrency: 'INR' }), ...extra };
        return CustomerReturnAdapter.prototype.createCustomerReturnViaRfc.call(self, p, { creator, ...(extra.options || {}) });
    };
    const stored = (over = {}) => ({ header: { VBELN: '0004500190', AUGRU: '008', VGBEL: '', ...over.header }, items: [{ POSNR: '000010', LGORT: 'FG01', VGBEL: '0005000446', ...over.item }] });

    it('requires a sold-to party and a reason before any RFC call', async () => {
        await expect(run({ create: jest.fn() }, {}, { ...payload(), SoldToParty: '' })).rejects.toMatchObject({ status: 400 });
        await expect(run({ create: jest.fn() }, {}, { ...payload(), ReturnsOrderReason: '' })).rejects.toMatchObject({ status: 400 });
    });

    it('passes a test run through without a read-back', async () => {
        const creator = { create: jest.fn().mockResolvedValue({ testRun: true, messages: [] }), readBack: jest.fn() };
        const out = await run(creator, { options: { testRun: true } });
        expect(out.testRun).toBe(true);
        expect(creator.readBack).not.toHaveBeenCalled();
        expect(creator.create).toHaveBeenCalledWith(expect.objectContaining({ CustomerReturnType: 'ZRET' }), salesArea, { testRun: true });
    });

    it('returns the created return after a read-back that holds reason, reference and storage location', async () => {
        const creator = { create: jest.fn().mockResolvedValue({ CustomerReturn: '0004500190', testRun: false }), readBack: jest.fn().mockResolvedValue(stored()) };
        const out = await run(creator);
        expect(out).toMatchObject({ CustomerReturn: '4500190', CustomerReturnType: 'ZRET', SoldToParty: '10276', Success: true }); // no leading zeros, like the CAP key
    });

    it.each([
        ['the order reason', { header: { AUGRU: '' } }, /order reason/],
        ['the reference document', { item: { VGBEL: '' } }, /reference document 5000446/],
        ['the storage location', { item: { LGORT: '' } }, /storage location FG01/]
    ])('fails with the document number when SAP did not store %s', async (_l, over, msg) => {
        const creator = { create: jest.fn().mockResolvedValue({ CustomerReturn: '0004500190', testRun: false }), readBack: jest.fn().mockResolvedValue(stored(over)) };
        await expect(run(creator)).rejects.toMatchObject({ CustomerReturn: '0004500190', name: 'PartialCustomerReturnError', message: expect.stringMatching(msg) });
    });

    it('fails with the document number when the committed return cannot be read back', async () => {
        const creator = { create: jest.fn().mockResolvedValue({ CustomerReturn: '0004500190', testRun: false }), readBack: jest.fn().mockResolvedValue(null) };
        await expect(run(creator)).rejects.toMatchObject({ CustomerReturn: '0004500190', name: 'PartialCustomerReturnError' });
    });

    it('refuses an unknown plant before calling the BAPI', async () => {
        const creator = { create: jest.fn() };
        await expect(run(creator, { rfc: { readTable: jest.fn().mockResolvedValue([]) } })).rejects.toMatchObject({ status: 400, message: expect.stringContaining('does not exist in SAP (T001W)') });
        expect(creator.create).not.toHaveBeenCalled();
    });
});
