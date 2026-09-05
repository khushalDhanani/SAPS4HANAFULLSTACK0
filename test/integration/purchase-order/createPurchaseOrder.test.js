const cds = require('@sap/cds');
const purchaseOrderAdapter = require('../../../srv/integration/s4hana/mm/purchase-order/PurchaseOrderAdapter');
const validPayload = require('../../fixtures/purchase-order/validPOPayload.json');
const s4Errors = require('../../fixtures/purchase-order/s4ErrorResponses.json');
const cdsTest = cds.test(__dirname + '/../../../');
cdsTest.defaults.auth = { username: 'alice', password: '' };
const { POST } = cdsTest;

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

    it('should return 422 Unprocessable Entity with mapped S/4 business validation exception when backend rejects business input', async () => {
        const backendError = new Error('Request failed with status code 400');
        backendError.response = {
            status: 400,
            data: s4Errors.addressIncompleteError
        };

        createPOSpy = jest.spyOn(purchaseOrderAdapter, 'createPurchaseOrder').mockRejectedValueOnce(backendError);

        try {
            await POST('/odata/v4/purchase-order/createPurchaseOrder', validPayload);
            throw new Error('Expected POST to fail with 422 when backend validation fails but it succeeded');
        } catch (error) {
            expect(error.response).toBeDefined();
            expect(error.response.status).toBe(422);
            expect(error.response.data.error.message).toContain('Address is incomplete. Please enter country/region.');
        }
    });

    it('should return 503 Service Unavailable when S/4 backend connection fails', async () => {
        const connError = new Error('connect ECONNREFUSED s4gateway.corp:443');
        connError.code = 'ECONNREFUSED';

        createPOSpy = jest.spyOn(purchaseOrderAdapter, 'createPurchaseOrder').mockRejectedValueOnce(connError);

        try {
            await POST('/odata/v4/purchase-order/createPurchaseOrder', validPayload);
            throw new Error('Expected POST to fail with 503 when backend is unavailable but it succeeded');
        } catch (error) {
            expect(error.response).toBeDefined();
            expect(error.response.status).toBe(503);
            expect(error.response.data.error.message).toContain('ECONNREFUSED');
        }
    });

    it('should return 403 Forbidden when S/4 backend rejects with authorization error', async () => {
        const authzError = new Error('Request failed with status code 403');
        authzError.response = {
            status: 403,
            data: {
                error: {
                    code: '/IWBEP/CX_MGW_NOT_AUTHORIZED',
                    message: { value: 'User not authorized to create PO for Purchasing Group 001' }
                }
            }
        };

        createPOSpy = jest.spyOn(purchaseOrderAdapter, 'createPurchaseOrder').mockRejectedValueOnce(authzError);

        try {
            await POST('/odata/v4/purchase-order/createPurchaseOrder', validPayload);
            throw new Error('Expected POST to fail with 403 when user is not authorized but it succeeded');
        } catch (error) {
            expect(error.response).toBeDefined();
            expect(error.response.status).toBe(403);
            expect(error.response.data.error.message).toContain('User not authorized');
        }
    });

    it('should return 409 Conflict when S/4 record is locked by another user', async () => {
        const lockError = new Error('Request failed with status code 409');
        lockError.response = {
            status: 409,
            data: {
                error: {
                    code: 'ME/006',
                    message: { value: 'Supplier 10300001 is currently locked by user CB9980000001' }
                }
            }
        };

        createPOSpy = jest.spyOn(purchaseOrderAdapter, 'createPurchaseOrder').mockRejectedValueOnce(lockError);

        try {
            await POST('/odata/v4/purchase-order/createPurchaseOrder', validPayload);
            throw new Error('Expected POST to fail with 409 when document is locked but it succeeded');
        } catch (error) {
            expect(error.response).toBeDefined();
            expect(error.response.status).toBe(409);
            expect(error.response.data.error.message).toContain('locked by user');
        }
    });

});
