// Real handler and real adapter. Doubled: the remote C_PURCHASEORDER_FS_SRV connection and the S/4 HTTP call for the
// payment term value help. Rows are hand-written from fields in srv/external, so the SAP shape is not proven here.
const purchaseOrderAdapter = require('../../../srv/integration/s4hana/mm/purchase-order/PurchaseOrderAdapter');
const { S4HttpClient } = require('../../../srv/integration/s4hana/S4HttpClient');
const registerPurchaseOrderHandlers = require('../../../srv/mm/purchase-order/handlers/purchaseOrder.handler');

function supplierDefaultsHandler() {
    const handlers = {};
    registerPurchaseOrderHandlers({ on: (event, ...args) => { handlers[event] = args[args.length - 1]; } });
    return handlers.getSupplierDefaults;
}

const lastPo = (paymentTerms) => ({
    PurchaseOrder: '300000005',
    DocumentCurrency: 'INR',
    PaymentTerms: paymentTerms,
    IncotermsClassification: '',
    IncotermsTransferLocation: ''
});

describe('Unit: getSupplierDefaults with the real adapter', () => {
    const request = { data: { Supplier: '100102', CompanyCode: '1000', PurchasingOrganization: 'AE01' } };
    let originalClient;
    let httpRequests;
    let valueHelpResponse;
    let fsQueries;
    let fsAnswer;

    beforeEach(() => {
        httpRequests = [];
        fsQueries = [];
        valueHelpResponse = async () => ({ data: { d: { results: [{ PaymentTerms: '0002' }, { PaymentTerms: 'PT00' }] } } });
        fsAnswer = async () => [lastPo('0002')];
        originalClient = purchaseOrderAdapter.client;
        purchaseOrderAdapter.client = new S4HttpClient({
            destinationName: 'S4_TEST',
            getDestination: async () => ({ url: 'http://s4.example.test' }),
            executeHttpRequest: async (_destination, httpRequest) => {
                httpRequests.push(httpRequest);
                return valueHelpResponse();
            }
        });
        purchaseOrderAdapter.s4hana = { run: async (query) => { fsQueries.push(query); return fsAnswer(query); } };
        purchaseOrderAdapter.clearMetricsCache();
    });

    afterEach(() => {
        purchaseOrderAdapter.client = originalClient;
        purchaseOrderAdapter.s4hana = null;
        purchaseOrderAdapter.clearMetricsCache();
    });

    it('should read the valid payment terms from the S/4 value help', async () => {
        await supplierDefaultsHandler()(request);

        expect(httpRequests.map(r => r.url)).toEqual(['http://s4.example.test/sap/opu/odata/sap/MM_PUR_PO_MAINT_V2_SRV/C_MM_PaymentTermValueHelp?$select=PaymentTerms&$format=json']);
    });

    it('should keep a historical payment term that S/4 customizing lists', async () => {
        const result = await supplierDefaultsHandler()(request);

        expect(result.PaymentTerms).toBe('0002');
    });

    it('should drop a historical payment term that S/4 customizing does not list, and keep the other defaults', async () => {
        fsAnswer = async () => [lastPo('ZZ99')];

        const result = await supplierDefaultsHandler()(request);

        expect(result).toEqual({
            Supplier: '100102',
            Currency: 'INR',
            PaymentTerms: '',
            IncotermsClassification: '',
            IncotermsLocation1: '',
            derived: true,
            source: 'from last PO',
            lastPurchaseOrder: '300000005'
        });
    });

    it('should keep a historical term other than AT01, AT05, AT06 when the value help cannot be read', async () => {
        valueHelpResponse = async () => { throw new Error('HTTP 503'); };
        fsAnswer = async () => [lastPo('ZZ99')];

        const result = await supplierDefaultsHandler()(request);

        expect(result.PaymentTerms).toBe('ZZ99');
    });

    it.each(['AT01', 'AT05', 'AT06'])('should drop obsolete term %s when the value help cannot be read', async (sTerm) => {
        valueHelpResponse = async () => { throw new Error('HTTP 503'); };
        fsAnswer = async () => [lastPo(sTerm)];

        const result = await supplierDefaultsHandler()(request);

        expect(result.PaymentTerms).toBe('');
    });

    it('should report "lookup failed", not "no history", when the purchase order read fails', async () => {
        fsAnswer = async () => { throw new Error('HTTP 500'); };

        const result = await supplierDefaultsHandler()(request);

        expect(result).toEqual({
            Supplier: '100102',
            Currency: '',
            PaymentTerms: '',
            IncotermsClassification: '',
            IncotermsLocation1: '',
            derived: false,
            source: 'lookup failed',
            lastPurchaseOrder: ''
        });
    });

    it('should broaden the history search step by step until only Supplier is left', async () => {
        fsAnswer = async () => [];

        await supplierDefaultsHandler()(request);

        const filterFields = fsQueries.map(q => q.SELECT.where.filter(part => part.ref).map(part => part.ref[0]));
        expect(filterFields).toEqual([
            ['Supplier', 'PurchasingOrganization', 'CompanyCode'],
            ['Supplier', 'CompanyCode'],
            ['Supplier', 'PurchasingOrganization'],
            ['Supplier']
        ]);
    });

    it('should stop searching at the first step that finds a purchase order', async () => {
        await supplierDefaultsHandler()(request);

        expect(fsQueries).toHaveLength(1);
    });
});
