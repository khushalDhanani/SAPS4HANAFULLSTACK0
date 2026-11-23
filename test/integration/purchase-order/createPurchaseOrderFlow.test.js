const cds = require('@sap/cds');
const purchaseOrderAdapter = require('../../../srv/integration/s4hana/mm/purchase-order/PurchaseOrderAdapter');
const { S4HttpClient } = require('../../../srv/integration/s4hana/S4HttpClient');
const draftResponse = require('../../fixtures/purchase-order/draftResponse.json');
const activationResponse = require('../../fixtures/purchase-order/activationResponse.json');
const cdsTest = cds.test(__dirname + '/../../../');
cdsTest.defaults.auth = { username: 'khushal', password: '' };
const { POST } = cdsTest;

// Browser-side service -> real CAP action -> real adapter, with only the S/4 HTTP call doubled.
// The SAP responses are the repo fixtures: this does not prove the SAP contract (see test/e2e/mm/roundTripPurchaseOrder.e2e.js).
describe('Integration (S/4 HTTP doubled): UI payload through PurchaseOrderService and CAP to the S/4 draft request', () => {
    let PurchaseOrderService;
    let s4Requests;
    let originalClient;

    beforeAll(() => {
        const prevSap = global.sap;
        global.sap = {
            ui: {
                define: (_deps, factory) => {
                    PurchaseOrderService = factory({ post: (sUrl, oBody) => POST(sUrl, oBody).then(res => res.data) });
                }
            }
        };
        require('../../../app/fiori-app/webapp/modules/mm/purchase-order/service/PurchaseOrderService');
        global.sap = prevSap;
    });

    beforeEach(() => {
        s4Requests = [];
        originalClient = purchaseOrderAdapter.client;
        purchaseOrderAdapter.client = new S4HttpClient({
            destinationName: 'S4_TEST',
            getDestination: async () => ({ url: 'http://s4.example.test' }),
            executeHttpRequest: async (_destination, request) => {
                s4Requests.push(request);
                return { status: 201, data: request.url.endsWith('/C_PurchaseOrderTP') ? draftResponse : activationResponse, headers: {} };
            }
        });
    });

    afterEach(() => {
        purchaseOrderAdapter.client = originalClient;
    });

    // What the Create PO screen model holds, including its UI-only fields.
    const uiModel = () => ({
        header: {
            PurchaseOrderType: 'ZDOM',
            PurchaseOrderTypeText: 'Dom. Aether In.LTD.',
            CompanyCode: '1000',
            PurchasingOrganization: 'AE01',
            PurchasingGroup: '101',
            Supplier: '100102',
            DocumentDate: '2026-09-05',
            Currency: 'INR',
            IncotermsClassification: '',
            IncotermsLocation1: '',
            PaymentTerms: '0001',
            StatusText: 'Ready to Create',
            StatusState: 'Success',
            StatusIcon: 'sap-icon://accept',
            PurchasingCompletenessStatus: true
        },
        items: [{
            PurchaseOrderItem: '10',
            PurchaseOrderItemCategory: '0',
            AccountAssignmentCategory: '',
            Material: 'TG11',
            PurchaseOrderItemText: 'Trading Goods',
            MaterialGroup: 'L001',
            Plant: '1000',
            StorageLocation: '100A',
            OrderQuantity: '10',
            UnitOfMeasure: 'PC',
            NetPriceAmount: '25.00',
            TaxCode: 'V1',
            NetAmount: '250.00',
            NetAmountIsEstimate: true,
            RequisitionerName: 'TESTUSER',
            errors: { Plant: { state: 'None', text: '' } }
        }]
    });

    it('resolves to the PO number in the S/4 activation response', async () => {
        await expect(PurchaseOrderService.createPurchaseOrder(uiModel())).resolves.toBe('4500001001');
    });

    it('sends S/4 a draft body with the mapped fields and none of the UI-only fields', async () => {
        await PurchaseOrderService.createPurchaseOrder(uiModel());

        expect(s4Requests[0].data).toEqual({
            PurchaseOrderType: 'ZDOM',
            CompanyCode: '1000',
            PurchasingOrganization: 'AE01',
            PurchasingGroup: '101',
            Supplier: '100102',
            InvoicingParty: '100102',
            DocumentCurrency: 'INR',
            PurchaseOrderDate: '/Date(1788566400000)/',
            PaymentTerms: '0001',
            to_PurchaseOrderItemTP: [{
                PurchaseOrderItem: '10',
                Material: 'TG11',
                Plant: '1000',
                OrderQuantity: '10',
                PurchaseOrderQuantityUnit: 'PC',
                NetPriceAmount: '25.00',
                NetPriceQuantity: '1',
                RequisitionerName: 'khushal',
                PurchaseOrderItemText: 'Trading Goods',
                StorageLocation: '100A',
                MaterialGroup: 'L001',
                PurchaseOrderItemCategory: '0',
                TaxCode: 'V1',
                NetAmount: '250.00',
                to_PurOrdScheduleLineTP: [{
                    ScheduleLineOrderQuantity: '10',
                    ScheduleLineDeliveryDate: '/Date(1788566400000)/'
                }]
            }]
        });
    });

    describe('when SAP does not answer (production mode, where CAP hides 5xx text)', () => {
        const env = process.env.NODE_ENV;
        const failing = (step, error) => {
            purchaseOrderAdapter.client = new S4HttpClient({
                destinationName: 'S4_TEST',
                getDestination: async () => ({ url: 'http://s4.example.test' }),
                executeHttpRequest: async (_destination, request) => {
                    s4Requests.push(request);
                    if (request.url.endsWith(step)) throw error;
                    return { status: 201, data: request.url.endsWith('/C_PurchaseOrderTP') ? draftResponse : activationResponse, headers: {} };
                }
            });
        };
        const outcome = () => PurchaseOrderService.createPurchaseOrder(uiModel()).catch((e) => e.response.data.error);
        beforeEach(() => { process.env.NODE_ENV = 'production'; });
        afterEach(() => { process.env.NODE_ENV = env; });

        it('warns when the activation gets no answer, because SAP may have created the order', async () => {
            failing('/C_PurchaseOrderTPActivation', Object.assign(new Error('timeout of 30000ms exceeded'), { code: 'ECONNABORTED' }));

            expect(await outcome()).toMatchObject({ message: 'SAP did not answer this request, so the result is NOT confirmed: it may have been saved. Check it in SAP before trying again.' });
        });

        it('does not warn when the draft step gets no answer, because no order was activated', async () => {
            failing('/C_PurchaseOrderTP', Object.assign(new Error('timeout of 30000ms exceeded'), { code: 'ECONNABORTED' }));

            expect((await outcome()).message).not.toContain('NOT confirmed');
            expect(s4Requests.some((request) => request.url.endsWith('/C_PurchaseOrderTPActivation'))).toBe(false);
        });

        it('does not warn when SAP refused the activation', async () => {
            failing('/C_PurchaseOrderTPActivation', Object.assign(new Error('refused'), { response: { status: 400, data: { error: { message: { value: 'Item 10 is incomplete' } } } } }));

            expect((await outcome()).message).not.toContain('NOT confirmed');
        });
    });
});
