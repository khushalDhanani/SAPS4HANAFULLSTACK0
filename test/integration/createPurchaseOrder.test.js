const cds = require('@sap/cds');
const purchaseOrderAdapter = require('../../srv/integration/s4hana/PurchaseOrderAdapter');
const validPayload = require('../fixtures/validPOPayload.json');
const s4Errors = require('../fixtures/s4ErrorResponses.json');
const { POST } = cds.test(__dirname + '/../../');

describe('Integration: Create Purchase Order Action', () => {

    let createPOSpy;

    afterEach(() => {
        createPOSpy?.mockRestore();
    });

    it('should successfully execute createPurchaseOrder action and return created PO ID', async () => {
        // Controlled mock returning successful creation response
        createPOSpy = jest.spyOn(purchaseOrderAdapter, 'createPurchaseOrder').mockResolvedValueOnce({
            PurchaseOrder: '4500001001',
            IsActiveEntity: true
        });

        const { status, data } = await POST('/odata/v4/purchase-order/createPurchaseOrder', validPayload);

        expect(status).toBe(200);
        expect(data).toHaveProperty('value', '4500001001');
        expect(createPOSpy).toHaveBeenCalledTimes(1);
    });

    it('should reject with 400 Bad Request when payload is missing required header fields', async () => {
        const invalidPayload = {
            header: {
                PurchaseOrderType: 'NB'
                // Missing CompanyCode, PurchasingOrganization, PurchasingGroup, Supplier, etc.
            },
            items: validPayload.items
        };

        try {
            await POST('/odata/v4/purchase-order/createPurchaseOrder', invalidPayload);
            throw new Error('Expected POST to fail with 400 Bad Request but it succeeded');
        } catch (error) {
            expect(error.response).toBeDefined();
            expect(error.response.status).toBe(400);
            expect(error.response.data.error.message).toContain('required');
        }
    });

    it('should reject with 400 Bad Request when payload contains no items', async () => {
        const payloadNoItems = {
            header: validPayload.header,
            items: []
        };

        try {
            await POST('/odata/v4/purchase-order/createPurchaseOrder', payloadNoItems);
            throw new Error('Expected POST to fail with 400 Bad Request but it succeeded');
        } catch (error) {
            expect(error.response).toBeDefined();
            expect(error.response.status).toBe(400);
            expect(error.response.data.error.message).toContain('At least one item is required');
        }
    });

    it('should return 500 with mapped S/4 business exception when backend fails', async () => {
        const backendError = new Error('Request failed with status code 400');
        backendError.response = {
            status: 400,
            data: s4Errors.addressIncompleteError
        };

        createPOSpy = jest.spyOn(purchaseOrderAdapter, 'createPurchaseOrder').mockRejectedValueOnce(backendError);

        try {
            await POST('/odata/v4/purchase-order/createPurchaseOrder', validPayload);
            throw new Error('Expected POST to fail with 500 when backend fails but it succeeded');
        } catch (error) {
            expect(error.response).toBeDefined();
            expect(error.response.status).toBe(500);
            expect(error.response.data.error.message).toContain('Address is incomplete. Please enter country/region.');
        }
    });

});
