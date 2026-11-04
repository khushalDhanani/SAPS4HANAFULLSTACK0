const cds = require('@sap/cds');
const purchaseOrderAdapter = require('../../../srv/integration/s4hana/mm/purchase-order/PurchaseOrderAdapter');
const validPayload = require('../../fixtures/purchase-order/validPOPayload.json');
const s4Errors = require('../../fixtures/purchase-order/s4ErrorResponses.json');
const draftResponse = require('../../fixtures/purchase-order/draftResponse.json');
const activationResponse = require('../../fixtures/purchase-order/activationResponse.json');
const { S4HttpClient } = require('../../../srv/integration/s4hana/S4HttpClient');
const cdsTest = cds.test(__dirname + '/../../../');
cdsTest.defaults.auth = { username: 'khushal', password: '' };
const { POST } = cdsTest;

describe('Integration: Create Purchase Order Action', () => {

    let createPOSpy;

    afterEach(() => {
        createPOSpy?.mockRestore();
    });

    describe('handler to S/4 HTTP boundary (adapter real, HTTP doubled)', () => {
        // The S/4 responses are the repo fixtures: this proves what we send and read, not the SAP contract.
        let s4Requests;
        let originalClient;

        beforeEach(() => {
            s4Requests = [];
            originalClient = purchaseOrderAdapter.client;
            purchaseOrderAdapter.client = new S4HttpClient({
                destinationName: 'S4_TEST',
                getDestination: async () => ({ url: 'http://s4.example.test' }),
                executeHttpRequest: async (_destination, request) => {
                    s4Requests.push(request);
                    return request.url.endsWith('/C_PurchaseOrderTP')
                        ? { status: 201, data: draftResponse, headers: { 'x-csrf-token': 'csrf-1', 'set-cookie': ['SAP_SESSIONID=abc; path=/'] } }
                        : { status: 200, data: activationResponse, headers: {} };
                }
            });
        });

        afterEach(() => {
            purchaseOrderAdapter.client = originalClient;
        });

        const draftItem = () => s4Requests[0].data.to_PurchaseOrderItemTP[0];

        it('should return the PO number from the activation response', async () => {
            const { status, data } = await POST('/odata/v4/purchase-order/createPurchaseOrder', validPayload);

            expect(status).toBe(200);
            expect(data.value).toBe('4500001001');
        });

        it('should send the mapped header and item to the S/4 draft entity', async () => {
            await POST('/odata/v4/purchase-order/createPurchaseOrder', validPayload);

            expect(s4Requests[0].method).toBe('post');
            expect(s4Requests[0].url).toBe('/sap/opu/odata/sap/MM_PUR_PO_MAINT_V2_SRV/C_PurchaseOrderTP');
            expect(s4Requests[0].data).toEqual({
                PurchaseOrderType: 'NB',
                CompanyCode: '1010',
                PurchasingOrganization: '1010',
                PurchasingGroup: '001',
                Supplier: '10300001',
                InvoicingParty: '10300001',
                DocumentCurrency: 'EUR',
                PurchaseOrderDate: '/Date(1788566400000)/',
                IncotermsClassification: 'EXW',
                IncotermsLocation1: 'MUMBAI',
                PaymentTerms: '0001',
                to_PurchaseOrderItemTP: [{
                    PurchaseOrderItem: '10',
                    Material: 'TG11',
                    Plant: '1010',
                    OrderQuantity: '10',
                    PurchaseOrderQuantityUnit: 'PC',
                    NetPriceAmount: '25.00',
                    NetPriceQuantity: '1',
                    RequisitionerName: 'khushal',
                    StorageLocation: '101A',
                    MaterialGroup: 'L001',
                    PurchaseOrderItemCategory: '0',
                    AccountAssignmentCategory: 'K',
                    TaxCode: 'V1',
                    NetAmount: '250.00',
                    to_PurOrdScheduleLineTP: [{
                        ScheduleLineOrderQuantity: '10',
                        ScheduleLineDeliveryDate: '/Date(1788566400000)/'
                    }],
                    to_PurOrdAcctAssignmentTP: [{ PurchaseOrderItem: '10', AccountAssignmentNumber: '01' }]
                }]
            });
        });

        it('should activate the draft it created with the session the draft response opened', async () => {
            await POST('/odata/v4/purchase-order/createPurchaseOrder', validPayload);

            expect(s4Requests).toHaveLength(2);
            expect(s4Requests[1].url).toBe('/sap/opu/odata/sap/MM_PUR_PO_MAINT_V2_SRV/C_PurchaseOrderTPActivation');
            expect(s4Requests[1].params.DraftUUID).toBe("guid'0050569a-7c9b-1edb-8fa4-d01c06834abc'");
            expect(s4Requests[1].headers.Cookie).toBe('SAP_SESSIONID=abc');
            expect(s4Requests[1].headers['X-CSRF-Token']).toBe('csrf-1');
        });

        it('should replace a client-supplied RequisitionerName with the authenticated user', async () => {
            const payload = { header: validPayload.header, items: [{ ...validPayload.items[0], RequisitionerName: 'ATTACKER_SPOOFED_USER' }] };

            await POST('/odata/v4/purchase-order/createPurchaseOrder', payload);

            expect(draftItem().RequisitionerName).toBe('khushal');
        });

        it('should replace a client-supplied NetAmount with quantity times price', async () => {
            const payload = { header: validPayload.header, items: [{ ...validPayload.items[0], OrderQuantity: '4', NetPriceAmount: '25.00', NetAmount: '0.01' }] };

            await POST('/odata/v4/purchase-order/createPurchaseOrder', payload);

            expect(draftItem().NetAmount).toBe('100.00');
        });

        it('should not call S/4 when the CAP validation rejects the payload', async () => {
            await expect(POST('/odata/v4/purchase-order/createPurchaseOrder', { header: { ...validPayload.header, Supplier: '' }, items: validPayload.items }))
                .rejects.toMatchObject({ response: { status: 400 } });

            expect(s4Requests).toHaveLength(0);
        });
    });

    it('should successfully accept items containing NetAmountIsEstimate without throwing HTTP 400', async () => {
        createPOSpy = jest.spyOn(purchaseOrderAdapter, 'createPurchaseOrder').mockResolvedValueOnce({
            PurchaseOrder: '4500001002',
            IsActiveEntity: true
        });

        const payloadWithEstimateFlag = {
            header: validPayload.header,
            items: validPayload.items.map(item => ({
                ...item,
                NetAmountIsEstimate: true
            }))
        };

        const { status, data } = await POST('/odata/v4/purchase-order/createPurchaseOrder', payloadWithEstimateFlag);

        expect(status).toBe(200);
        expect(data).toHaveProperty('value', '4500001002');
    });

    it('should reject with 502 Bad Gateway when SAP returns no PurchaseOrder document number', async () => {
        createPOSpy = jest.spyOn(purchaseOrderAdapter, 'createPurchaseOrder').mockResolvedValueOnce({
            PurchaseOrder: '',
            IsActiveEntity: true
        });

        try {
            await POST('/odata/v4/purchase-order/createPurchaseOrder', validPayload);
            expect(true).toBe(false); // Should not reach here
        } catch (err) {
            expect(err.response.status).toBe(502);
            expect(err.response.data.error.message).toContain('no Purchase Order document number was returned');
        }
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
