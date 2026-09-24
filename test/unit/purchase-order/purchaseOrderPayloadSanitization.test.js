/**
 * Unit & Contract Tests: Purchase Order Creation Payload Sanitization
 * Validates that NetAmountIsEstimate and UI error objects are stripped from items before dispatching to CAP OData.
 */

let PurchaseOrderService;
const mockODataClient = {
    post: jest.fn(),
    get: jest.fn()
};

beforeAll(() => {
    global.sap = {
        ui: {
            define: function (deps, factory) {
                PurchaseOrderService = factory(mockODataClient);
            }
        }
    };
    require('../../../app/fiori-app/webapp/modules/mm/purchase-order/service/PurchaseOrderService');
});

beforeEach(() => {
    jest.clearAllMocks();
});

describe('Unit: Purchase Order Creation Payload Sanitization', () => {
    it('PurchaseOrderService.createPurchaseOrder should strip errors and NetAmountIsEstimate from items', async () => {
        mockODataClient.post.mockResolvedValueOnce({ value: '4500001005' });

        const rawPayload = {
            header: {
                PurchaseOrderType: 'NB',
                CompanyCode: '1000',
                PurchasingOrganization: '1000',
                PurchasingGroup: '001',
                Supplier: '10300001',
                DocumentDate: '2026-09-21',
                Currency: 'EUR'
            },
            items: [
                {
                    PurchaseOrderItem: '10',
                    Material: '1000000003',
                    Plant: '1000',
                    StorageLocation: '1000',
                    OrderQuantity: '10',
                    UnitOfMeasure: 'EA',
                    NetPriceAmount: '25.00',
                    NetAmount: '250.00',
                    NetAmountIsEstimate: true,
                    errors: {
                        Plant: { state: 'None', text: '' },
                        OrderQuantity: { state: 'None', text: '' }
                    }
                }
            ]
        };

        const result = await PurchaseOrderService.createPurchaseOrder(rawPayload);

        expect(result).toBe('4500001005');
        expect(mockODataClient.post).toHaveBeenCalledTimes(1);

        const [callUrl, sentPayload] = mockODataClient.post.mock.calls[0];
        expect(callUrl).toBe('/odata/v4/purchase-order/createPurchaseOrder');
        expect(sentPayload.items[0]).not.toHaveProperty('NetAmountIsEstimate');
        expect(sentPayload.items[0]).not.toHaveProperty('errors');
        expect(sentPayload.items[0].PurchaseOrderItem).toBe('10');
        expect(sentPayload.items[0].Material).toBe('1000000003');
        expect(sentPayload.items[0].OrderQuantity).toBe('10');
    });

    it('PurchaseOrderService.createPurchaseOrder should strip PurchaseOrderTypeText and UI-only properties from header', async () => {
        mockODataClient.post.mockResolvedValueOnce({ value: '4500001007' });

        const rawPayload = {
            header: {
                PurchaseOrderType: 'ZDOM',
                PurchaseOrderTypeText: 'Dom. Aether In.LTD.',
                CompanyCode: '1000',
                PurchasingOrganization: '1000',
                PurchasingGroup: '001',
                Supplier: '10300001',
                DocumentDate: '2026-09-24',
                Currency: 'EUR',
                IncotermsClassification: 'EXW',
                IncotermsLocation1: 'Factory Gate',
                PaymentTerms: '0001',
                StatusText: 'Ready to Create',
                StatusState: 'Success',
                StatusIcon: 'sap-icon://accept',
                PurchasingCompletenessStatus: true,
                nonExistentField: 'leakedValue'
            },
            items: []
        };

        const result = await PurchaseOrderService.createPurchaseOrder(rawPayload);

        expect(result).toBe('4500001007');
        expect(mockODataClient.post).toHaveBeenCalledTimes(1);

        const [, sentPayload] = mockODataClient.post.mock.calls[0];
        expect(sentPayload.header.PurchaseOrderType).toBe('ZDOM');
        expect(sentPayload.header.CompanyCode).toBe('1000');
        expect(sentPayload.header.PaymentTerms).toBe('0001');

        // Verify UI-only and non-schema attributes are strictly stripped
        expect(sentPayload.header).not.toHaveProperty('PurchaseOrderTypeText');
        expect(sentPayload.header).not.toHaveProperty('StatusText');
        expect(sentPayload.header).not.toHaveProperty('StatusState');
        expect(sentPayload.header).not.toHaveProperty('StatusIcon');
        expect(sentPayload.header).not.toHaveProperty('PurchasingCompletenessStatus');
        expect(sentPayload.header).not.toHaveProperty('nonExistentField');
    });

    it('PurchaseOrderService.createPurchaseOrder should handle payload without items array gracefully', async () => {
        mockODataClient.post.mockResolvedValueOnce({ value: '4500001006' });

        const rawPayload = {
            header: { PurchaseOrderType: 'NB', PurchaseOrderTypeText: 'Standard' }
        };

        const result = await PurchaseOrderService.createPurchaseOrder(rawPayload);

        expect(result).toBe('4500001006');
        expect(mockODataClient.post).toHaveBeenCalledTimes(1);
        const [, sentPayload] = mockODataClient.post.mock.calls[0];
        expect(sentPayload.header.PurchaseOrderType).toBe('NB');
        expect(sentPayload.header).not.toHaveProperty('PurchaseOrderTypeText');
    });
});
