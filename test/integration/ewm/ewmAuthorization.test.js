const cds = require('@sap/cds');
const EwmAdapter = require('../../../srv/integration/s4hana/ewm/EwmAdapter');
const localTokenUtil = require('../../../srv/auth/localTokenUtil');

const { POST, GET } = cds.test(__dirname + '/../../../');

describe('Security & Authorization: EWM Warehouse Management RBAC', () => {

    let getWarehousesSpy;
    let getStorageTypesSpy;
    let createWarehouseTaskSpy;

    beforeEach(() => {
        getWarehousesSpy = jest.spyOn(EwmAdapter, 'getWarehouses').mockResolvedValue([
            { Warehouse: '0001', WarehouseName: 'Central Warehouse' },
            { Warehouse: 'W01', WarehouseName: '452/453 Warehouse' }
        ]);

        getStorageTypesSpy = jest.spyOn(EwmAdapter, 'getStorageTypes').mockResolvedValue([
            { Warehouse: '0001', StorageType: '0010', StorageTypeName: 'High Rack Storage' }
        ]);

        createWarehouseTaskSpy = jest.spyOn(EwmAdapter, 'createWarehouseTask').mockResolvedValue({
            Warehouse: '0001',
            WarehouseTask: '10001',
            Product: 'TG11',
            TargetQuantity: 10,
            BaseUnit: 'EA',
            WarehouseTaskStatus: 'O'
        });
    });

    afterEach(() => {
        getWarehousesSpy?.mockRestore();
        getStorageTypesSpy?.mockRestore();
        createWarehouseTaskSpy?.mockRestore();
    });

    describe('Unauthenticated Access (Anonymous)', () => {
        it('should reject unauthenticated GET to Warehouses entity with 401 Unauthorized', async () => {
            try {
                await GET('/odata/v4/warehouse-management/Warehouses');
                throw new Error('Expected 401 Unauthorized but request succeeded');
            } catch (error) {
                expect(error.response).toBeDefined();
                expect(error.response.status).toBe(401);
            }
        });

        it('should reject unauthenticated GET to StorageTypes entity with 401 Unauthorized', async () => {
            try {
                await GET('/odata/v4/warehouse-management/StorageTypes?$filter=Warehouse eq \'0001\'');
                throw new Error('Expected 401 Unauthorized but request succeeded');
            } catch (error) {
                expect(error.response).toBeDefined();
                expect(error.response.status).toBe(401);
            }
        });

        it('should reject unauthenticated POST to createWarehouseTask action with 401 Unauthorized', async () => {
            try {
                await POST('/odata/v4/warehouse-management/createWarehouseTask', {
                    Warehouse: '0001',
                    Product: 'TG11',
                    Quantity: 10,
                    UnitOfMeasure: 'EA',
                    WarehouseProcessType: '1010'
                });
                throw new Error('Expected 401 Unauthorized but request succeeded');
            } catch (error) {
                expect(error.response).toBeDefined();
                expect(error.response.status).toBe(401);
            }
        });
    });

    describe('Basic Auth (alice and bob)', () => {
        it('should allow Viewer (bob) to READ Warehouses entity set', async () => {
            const { status, data } = await GET('/odata/v4/warehouse-management/Warehouses', {
                auth: { username: 'bob', password: '' }
            });
            expect(status).toBe(200);
            expect(data.value).toHaveLength(2);
        });

        it('should allow WarehouseClerk (alice) to READ Warehouses entity set', async () => {
            const { status, data } = await GET('/odata/v4/warehouse-management/Warehouses', {
                auth: { username: 'alice', password: '' }
            });
            expect(status).toBe(200);
            expect(data.value).toHaveLength(2);
        });

        it('should REJECT Viewer (bob) attempting to invoke createWarehouseTask with 403 Forbidden', async () => {
            try {
                await POST('/odata/v4/warehouse-management/createWarehouseTask', {
                    Warehouse: '0001',
                    Product: 'TG11',
                    Quantity: 10,
                    UnitOfMeasure: 'EA',
                    WarehouseProcessType: '1010'
                }, {
                    auth: { username: 'bob', password: '' }
                });
                throw new Error('Expected 403 Forbidden but request succeeded');
            } catch (error) {
                expect(error.response).toBeDefined();
                expect(error.response.status).toBe(403);
            }
        });

        it('should allow WarehouseClerk (alice) to invoke createWarehouseTask action', async () => {
            const { status } = await POST('/odata/v4/warehouse-management/createWarehouseTask', {
                Warehouse: '0001',
                Product: 'TG11',
                Quantity: 10,
                UnitOfMeasure: 'EA',
                WarehouseProcessType: '1010'
            }, {
                auth: { username: 'alice', password: '' }
            });
            expect(status).toBe(200);
        });
    });

    describe('Local Development Bearer Token Authorization (JWT with XSUAA Claims)', () => {
        it('should allow Viewer Bearer token to READ Warehouses entity set', async () => {
            const token = localTokenUtil.issueToken('bob_local', ['Viewer', 'User']).token;
            const { status, data } = await GET('/odata/v4/warehouse-management/Warehouses', {
                headers: { authorization: 'Bearer ' + token }
            });
            expect(status).toBe(200);
            expect(data.value).toHaveLength(2);
        });

        it('should allow WarehouseClerk Bearer token to READ Warehouses entity set', async () => {
            const token = localTokenUtil.issueToken('alice_local', ['WarehouseClerk', 'Viewer', 'User']).token;
            const { status, data } = await GET('/odata/v4/warehouse-management/Warehouses', {
                headers: { authorization: 'Bearer ' + token }
            });
            expect(status).toBe(200);
            expect(data.value).toHaveLength(2);
        });

        it('should allow WarehouseClerk Bearer token to invoke createWarehouseTask action', async () => {
            const token = localTokenUtil.issueToken('clerk_local', ['WarehouseClerk', 'User']).token;
            const { status, data } = await POST('/odata/v4/warehouse-management/createWarehouseTask', {
                Warehouse: '0001',
                Product: 'TG11',
                Quantity: 10,
                UnitOfMeasure: 'EA',
                WarehouseProcessType: '1010'
            }, {
                headers: { authorization: 'Bearer ' + token }
            });
            expect(status).toBe(200);
            expect(data.WarehouseTask).toBe('10001');
        });

        it('should REJECT Viewer Bearer token attempting to invoke createWarehouseTask with 403 Forbidden', async () => {
            const token = localTokenUtil.issueToken('viewer_only', ['Viewer', 'User']).token;
            try {
                await POST('/odata/v4/warehouse-management/createWarehouseTask', {
                    Warehouse: '0001',
                    Product: 'TG11',
                    Quantity: 10,
                    UnitOfMeasure: 'EA',
                    WarehouseProcessType: '1010'
                }, {
                    headers: { authorization: 'Bearer ' + token }
                });
                throw new Error('Expected 403 Forbidden but request succeeded');
            } catch (error) {
                expect(error.response).toBeDefined();
                expect(error.response.status).toBe(403);
            }
        });

        it('should reject malformed or invalid Bearer token with 401 Unauthorized', async () => {
            try {
                await GET('/odata/v4/warehouse-management/Warehouses', {
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
