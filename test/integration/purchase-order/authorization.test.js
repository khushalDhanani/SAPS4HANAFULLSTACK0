const cds = require('@sap/cds');
const purchaseOrderAdapter = require('../../../srv/integration/s4hana/mm/purchase-order/PurchaseOrderAdapter');
const validPayload = require('../../fixtures/purchase-order/validPOPayload.json');
const purchaseOrdersFixture = require('../../fixtures/purchase-order/purchaseOrders.json');
const valueHelpsFixture = require('../../fixtures/purchase-order/valueHelps.json');
const localTokenUtil = require('../../../srv/auth/localTokenUtil');

const { POST, GET } = cds.test(__dirname + '/../../../');

describe('Security & Authorization: Purchase Order RBAC', () => {

    let readFsSpy;
    let readMaintSpy;
    let createPOSpy;

    beforeEach(() => {
        readFsSpy = jest.spyOn(purchaseOrderAdapter, 'readFsData').mockImplementation(async (query) => {
            const entityName = query?.SELECT?.from?.ref?.[0] || '';
            if (String(entityName).includes('DocumentTypeVH')) {
                return valueHelpsFixture.DocumentTypeVH;
            }
            return purchaseOrdersFixture;
        });

        readMaintSpy = jest.spyOn(purchaseOrderAdapter, 'readMaintData').mockImplementation(async () => {
            return valueHelpsFixture.SupplierVH;
        });

        createPOSpy = jest.spyOn(purchaseOrderAdapter, 'createPurchaseOrder').mockResolvedValue({
            PurchaseOrder: '4500001099',
            IsActiveEntity: true
        });
    });

    afterEach(() => {
        readFsSpy?.mockRestore();
        readMaintSpy?.mockRestore();
        createPOSpy?.mockRestore();
    });

    describe('Unauthenticated Access (Anonymous)', () => {
        it('should reject unauthenticated POST to createPurchaseOrder with 401 Unauthorized', async () => {
            try {
                await POST('/odata/v4/purchase-order/createPurchaseOrder', validPayload);
                throw new Error('Expected 401 Unauthorized but request succeeded');
            } catch (error) {
                expect(error.response).toBeDefined();
                expect(error.response.status).toBe(401);
            }
        });

        it('should reject unauthenticated GET to PurchaseOrders entity with 401 Unauthorized', async () => {
            try {
                await GET('/odata/v4/purchase-order/PurchaseOrders');
                throw new Error('Expected 401 Unauthorized but request succeeded');
            } catch (error) {
                expect(error.response).toBeDefined();
                expect(error.response.status).toBe(401);
            }
        });

        it('should reject unauthenticated GET to DocumentTypeVH value help with 401 Unauthorized', async () => {
            try {
                await GET('/odata/v4/purchase-order/DocumentTypeVH');
                throw new Error('Expected 401 Unauthorized but request succeeded');
            } catch (error) {
                expect(error.response).toBeDefined();
                expect(error.response.status).toBe(401);
            }
        });
    });

    describe('Viewer Role Authorization (bob)', () => {
        it('should allow Viewer to READ PurchaseOrders entity set', async () => {
            const { status, data } = await GET('/odata/v4/purchase-order/PurchaseOrders', {
                auth: { username: 'bob', password: '' }
            });

            expect(status).toBe(200);
            expect(data).toBeDefined();
            expect(data.value).toBeInstanceOf(Array);
        });

        it('should allow Viewer to READ Value Helps', async () => {
            const { status, data } = await GET('/odata/v4/purchase-order/DocumentTypeVH', {
                auth: { username: 'bob', password: '' }
            });

            expect(status).toBe(200);
            expect(data).toBeDefined();
        });

        it('should REJECT Viewer attempting to invoke createPurchaseOrder with 403 Forbidden', async () => {
            try {
                await POST('/odata/v4/purchase-order/createPurchaseOrder', validPayload, {
                    auth: { username: 'bob', password: '' }
                });
                throw new Error('Expected 403 Forbidden but request succeeded');
            } catch (error) {
                expect(error.response).toBeDefined();
                expect(error.response.status).toBe(403);
            }
        });
    });

    describe('PurchasingManager Role Authorization (alice)', () => {
        it('should allow PurchasingManager to invoke createPurchaseOrder action', async () => {
            const { status, data } = await POST('/odata/v4/purchase-order/createPurchaseOrder', validPayload, {
                auth: { username: 'alice', password: '' }
            });

            expect(status).toBe(200);
            expect(data).toHaveProperty('value', '4500001099');
            expect(createPOSpy).toHaveBeenCalledTimes(1);
        });

        it('should allow PurchasingManager to READ PurchaseOrders entity set', async () => {
            const { status, data } = await GET('/odata/v4/purchase-order/PurchaseOrders', {
                auth: { username: 'alice', password: '' }
            });

            expect(status).toBe(200);
            expect(data).toBeDefined();
        });
    });

    describe('Local Development Bearer Token Authorization (JWT with XSUAA Claims)', () => {
        it('should allow PurchasingManager Bearer token to invoke createPurchaseOrder', async () => {
            const token = localTokenUtil.issueToken('KHUSHAL', ['PurchasingManager', 'Viewer', 'User']).token;
            const { status, data } = await POST('/odata/v4/purchase-order/createPurchaseOrder', validPayload, {
                headers: { authorization: 'Bearer ' + token }
            });

            expect(status).toBe(200);
            expect(data).toHaveProperty('value', '4500001099');
            expect(createPOSpy).toHaveBeenCalledTimes(1);
        });

        it('should REJECT Viewer Bearer token attempting to invoke createPurchaseOrder with 403 Forbidden', async () => {
            const token = localTokenUtil.issueToken('bob_local', ['Viewer', 'User']).token;
            try {
                await POST('/odata/v4/purchase-order/createPurchaseOrder', validPayload, {
                    headers: { authorization: 'Bearer ' + token }
                });
                throw new Error('Expected 403 Forbidden but request succeeded');
            } catch (error) {
                expect(error.response).toBeDefined();
                expect(error.response.status).toBe(403);
            }
        });

        it('should allow Viewer Bearer token to READ PurchaseOrders entity set', async () => {
            const token = localTokenUtil.issueToken('bob_local', ['Viewer', 'User']).token;
            const { status, data } = await GET('/odata/v4/purchase-order/PurchaseOrders', {
                headers: { authorization: 'Bearer ' + token }
            });

            expect(status).toBe(200);
            expect(data).toBeDefined();
            expect(data.value).toBeInstanceOf(Array);
        });

        it('should reject malformed or invalid Bearer token with 401 Unauthorized', async () => {
            try {
                await POST('/odata/v4/purchase-order/createPurchaseOrder', validPayload, {
                    headers: { authorization: 'Bearer invalid.token.payload' }
                });
                throw new Error('Expected 401 Unauthorized but request succeeded');
            } catch (error) {
                expect(error.response).toBeDefined();
                expect(error.response.status).toBe(401);
            }
        });
    });
});
