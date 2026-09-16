const EwmAdapter = require('../../../srv/integration/s4hana/ewm/EwmAdapter');

describe('Unit: EwmAdapter - Authentic Warehouse Master Data Only', () => {
    let origGet;

    beforeEach(() => {
        origGet = EwmAdapter._get;
    });

    afterEach(() => {
        EwmAdapter._get = origGet;
        jest.clearAllMocks();
    });

    describe('getWarehouses', () => {
        it('should query API_WAREHOUSE and LE_SHP_OD_LIST_SRV, but NEVER query PlantValueHelp', async () => {
            const queriedUrls = [];
            EwmAdapter._get = jest.fn().mockImplementation((path) => {
                queriedUrls.push(path);
                if (path.includes('API_WAREHOUSE/Warehouse')) {
                    return Promise.resolve([
                        { Warehouse: '0001', to_WarehouseText: { results: [{ Language: 'EN', WarehouseName: 'Central Warehouse' }] } }
                    ]);
                }
                if (path.includes('LE_SHP_OD_LIST_SRV/I_WarehouseStdVH')) {
                    return Promise.resolve([
                        { Warehouse: 'W01', Warehouse_Text: '452/453 Warehouse' },
                        { Warehouse: 'W14', Warehouse_Text: ' Panoli Internal WH-1' }
                    ]);
                }
                return Promise.resolve([]);
            });

            const result = await EwmAdapter.getWarehouses();

            // Verify called paths
            expect(queriedUrls).toContain('/sap/opu/odata/sap/API_WAREHOUSE/Warehouse');
            expect(queriedUrls).toContain('/sap/opu/odata/sap/LE_SHP_OD_LIST_SRV/I_WarehouseStdVH');
            // Explicitly assert plant service is never called
            const calledPlantService = queriedUrls.some(u => u.includes('C_MM_PlantValueHelp') || u.includes('Plant'));
            expect(calledPlantService).toBe(false);

            // Verify result contains authentic warehouses only
            expect(result).toHaveLength(3);
            expect(result).toEqual([
                { Warehouse: '0001', WarehouseName: 'Central Warehouse', IsEwm: true },
                { Warehouse: 'W01', WarehouseName: '452/453 Warehouse', IsEwm: false },
                { Warehouse: 'W14', WarehouseName: 'Panoli Internal WH-1', IsEwm: false } // verifies whitespace trimming
            ]);
        });

        it('should deduplicate warehouses across sources', async () => {
            EwmAdapter._get = jest.fn().mockImplementation((path) => {
                if (path.includes('API_WAREHOUSE/Warehouse')) {
                    return Promise.resolve([
                        { Warehouse: '0001', to_WarehouseText: { results: [{ Language: 'EN', WarehouseName: 'Central Warehouse' }] } }
                    ]);
                }
                if (path.includes('LE_SHP_OD_LIST_SRV/I_WarehouseStdVH')) {
                    return Promise.resolve([
                        { Warehouse: '0001', Warehouse_Text: 'Central Warehouse Std' },
                        { Warehouse: '001', Warehouse_Text: 'Central whse (full WM)' }
                    ]);
                }
                return Promise.resolve([]);
            });

            const result = await EwmAdapter.getWarehouses();
            expect(result).toHaveLength(2);
            expect(result[0].Warehouse).toBe('0001');
            expect(result[0].WarehouseName).toBe('Central Warehouse'); // Prioritizes EWM API name
            expect(result[0].IsEwm).toBe(true);
            expect(result[1].Warehouse).toBe('001');
            expect(result[1].IsEwm).toBe(false);
        });

        it('should sort warehouses in natural alphanumeric order', async () => {
            EwmAdapter._get = jest.fn().mockImplementation((path) => {
                if (path.includes('API_WAREHOUSE/Warehouse')) {
                    return Promise.resolve([]);
                }
                if (path.includes('LE_SHP_OD_LIST_SRV/I_WarehouseStdVH')) {
                    return Promise.resolve([
                        { Warehouse: 'W26', Warehouse_Text: 'Speciality' },
                        { Warehouse: '0001', Warehouse_Text: 'Central' },
                        { Warehouse: 'W01', Warehouse_Text: 'WH 01' },
                        { Warehouse: '100', Warehouse_Text: 'Lean WM' },
                        { Warehouse: 'EWM', Warehouse_Text: 'SCM-EWM' }
                    ]);
                }
                return Promise.resolve([]);
            });

            const result = await EwmAdapter.getWarehouses();
            const keys = result.map(w => w.Warehouse);
            expect(keys).toEqual(['0001', '100', 'EWM', 'W01', 'W26']);
        });

        it('should gracefully handle partial API failures and return available genuine warehouses', async () => {
            EwmAdapter._get = jest.fn().mockImplementation((path) => {
                if (path.includes('API_WAREHOUSE/Warehouse')) {
                    return Promise.reject(new Error('500 Internal Server Error'));
                }
                if (path.includes('LE_SHP_OD_LIST_SRV/I_WarehouseStdVH')) {
                    return Promise.resolve([
                        { Warehouse: 'W02', Warehouse_Text: '8208 - Bonded Warehouse' }
                    ]);
                }
                return Promise.resolve([]);
            });

            const result = await EwmAdapter.getWarehouses();
            expect(result).toHaveLength(1);
            expect(result[0]).toEqual({
                Warehouse: 'W02',
                WarehouseName: '8208 - Bonded Warehouse',
                IsEwm: false
            });
        });

        it('should throw 502 when all warehouse APIs fail', async () => {
            EwmAdapter._get = jest.fn().mockImplementation((path) => {
                if (path.includes('API_WAREHOUSE/Warehouse')) {
                    return Promise.reject(new Error('API_WAREHOUSE Connection Refused'));
                }
                if (path.includes('LE_SHP_OD_LIST_SRV/I_WarehouseStdVH')) {
                    return Promise.reject(new Error('Gateway Timeout 504'));
                }
                return Promise.resolve([]);
            });

            await expect(EwmAdapter.getWarehouses()).rejects.toMatchObject({
                status: 502,
                message: expect.stringContaining('Warehouse master data could not be read from SAP S/4HANA')
            });
        });
    });

    describe('createWarehouseTask', () => {
        let origPost, origGetInbound, origGetTasks, origPostGR;

        beforeEach(() => {
            origPost = EwmAdapter._post;
            origGetInbound = EwmAdapter.getInboundDeliveries;
            origGetTasks = EwmAdapter.getWarehouseTasks;
            origPostGR = EwmAdapter.postGoodsReceipt;
        });

        afterEach(() => {
            EwmAdapter._post = origPost;
            EwmAdapter.getInboundDeliveries = origGetInbound;
            EwmAdapter.getWarehouseTasks = origGetTasks;
            EwmAdapter.postGoodsReceipt = origPostGR;
        });

        it('Strategy 1: should succeed when API_WAREHOUSE_ORDER_TASK POST works', async () => {
            let capturedPath;
            let capturedPayload;
            EwmAdapter._post = jest.fn().mockImplementation((path, payload) => {
                capturedPath = path;
                capturedPayload = payload;
                return Promise.resolve({
                    Warehouse: payload.Warehouse,
                    WarehouseTask: '10005',
                    Product: payload.ProductName,
                    TargetQuantity: 15,
                    BaseUnit: payload.BaseUnit,
                    WarehouseTaskStatus: 'O'
                });
            });

            const result = await EwmAdapter.createWarehouseTask({
                Warehouse: '0001',
                WarehouseProcessType: '1010',
                Product: 'TG11',
                Quantity: 15,
                UnitOfMeasure: 'EA',
                SourceStorageType: '0010',
                SourceStorageBin: '0010-01-01',
                DestinationStorageType: '0020',
                DestinationStorageBin: '0020-01-01',
                Batch: 'B001',
                SourceHandlingUnit: 'HU1',
                DestinationHandlingUnit: 'HU2'
            });

            expect(capturedPath).toBe('/sap/opu/odata/sap/API_WAREHOUSE_ORDER_TASK/WarehouseTask');
            expect(capturedPayload).toEqual({
                Warehouse: '0001',
                WarehouseProcessType: '1010',
                ProductName: 'TG11',
                TargetQuantityInBaseUnit: '15',
                BaseUnit: 'EA',
                SourceStorageType: '0010',
                SourceStorageBin: '0010-01-01',
                DestinationStorageType: '0020',
                DestinationStorageBin: '0020-01-01',
                Batch: 'B001',
                SourceHandlingUnit: 'HU1',
                DestinationHandlingUnit: 'HU2'
            });
            expect(result.WarehouseTask).toBe('10005');
        });

        it('Strategy 2: should fall back to PICKCART_SRV when Strategy 1 fails', async () => {
            let callCount = 0;
            EwmAdapter._post = jest.fn().mockImplementation((path, payload) => {
                callCount++;
                if (path.includes('API_WAREHOUSE_ORDER_TASK')) {
                    return Promise.reject(new Error('OBJECTS_OBJREF_NOT_ASSIGNED_NO'));
                }
                if (path.includes('PICKCART_SRV')) {
                    return Promise.resolve({
                        EWMWarehouse: '0001',
                        EWMWarehouseTask: '20001',
                        Pmat: 'TG11',
                        TargetQuantityInBaseUnit: '10',
                        BaseUnit: 'PC',
                        WarehouseTaskStatus: 'O'
                    });
                }
                return Promise.resolve({});
            });

            const result = await EwmAdapter.createWarehouseTask({
                Warehouse: '0001',
                WarehouseProcessType: '1010',
                Product: 'TG11',
                Quantity: 10,
                UnitOfMeasure: 'PC'
            });

            expect(callCount).toBe(2); // Strategy 1 failed, Strategy 2 succeeded
            expect(result).toBeDefined();
        });

        it('never posts a goods receipt or reads deliveries as a side effect of task creation', async () => {
            EwmAdapter._post = jest.fn().mockRejectedValue(new Error('Service unavailable'));
            EwmAdapter.getInboundDeliveries = jest.fn().mockResolvedValue([
                { DeliveryDocument: '180000010', OverallGoodsReceiptStatus: 'A', Items: [{ Product: 'TG11' }] }
            ]);
            EwmAdapter.getWarehouseTasks = jest.fn().mockResolvedValue([]);
            EwmAdapter.postGoodsReceipt = jest.fn().mockResolvedValue(true);

            await expect(EwmAdapter.createWarehouseTask({
                Warehouse: '0001',
                WarehouseProcessType: '1010',
                Product: 'TG11',
                Quantity: 10,
                UnitOfMeasure: 'PC'
            })).rejects.toMatchObject({ status: 422 });

            expect(EwmAdapter.postGoodsReceipt).not.toHaveBeenCalled();
            expect(EwmAdapter.getInboundDeliveries).not.toHaveBeenCalled();
            expect(EwmAdapter.getWarehouseTasks).not.toHaveBeenCalled();
            // Only the two real create services are attempted
            const paths = EwmAdapter._post.mock.calls.map(c => c[0]);
            expect(paths).toEqual([
                '/sap/opu/odata/sap/API_WAREHOUSE_ORDER_TASK/WarehouseTask',
                '/sap/opu/odata/scwm/PICKCART_SRV/WarehouseTaskSet'
            ]);
        });

        it('should throw descriptive error when all strategies are exhausted', async () => {
            EwmAdapter._post = jest.fn().mockRejectedValue(new Error('Service rejected'));
            EwmAdapter.getInboundDeliveries = jest.fn().mockResolvedValue([]);

            await expect(EwmAdapter.createWarehouseTask({
                Warehouse: '0001',
                WarehouseProcessType: '1010',
                Product: 'TG11',
                Quantity: 10,
                UnitOfMeasure: 'PC'
            })).rejects.toThrow('all SAP strategies exhausted');
        });

        it('should throw error when all strategies fail and set status 422', async () => {
            EwmAdapter._post = jest.fn().mockRejectedValue(new Error('Service rejected'));
            EwmAdapter.getInboundDeliveries = jest.fn().mockResolvedValue([]);

            try {
                await EwmAdapter.createWarehouseTask({
                    Warehouse: '0001',
                    WarehouseProcessType: '1010',
                    Product: 'TG11',
                    Quantity: 10,
                    UnitOfMeasure: 'PC'
                });
                fail('Expected error to be thrown');
            } catch (err) {
                expect(err.status).toBe(422);
                expect(err.message).toContain('API_WAREHOUSE_ORDER_TASK');
                expect(err.message).toContain('PICKCART_SRV');
                expect(err.message).toContain('no task was created');
                expect(err.message).not.toContain('PostGoodsReceipt');
            }
        });

    });

    describe('getWarehouseProcessTypes', () => {
        it('should return empty array when warehouse is not provided', async () => {
            const res = await EwmAdapter.getWarehouseProcessTypes();
            expect(res).toEqual([]);
        });

        it('should query I_EWM_WhseProcTypeVH and map process types', async () => {
            EwmAdapter._get = jest.fn().mockResolvedValue([
                { EWMWarehouse: '0001', WarehouseProcessType: '1010', WarehouseProcessType_Text: 'Putaway' },
                { EWMWarehouse: '0001', WarehouseProcessType: '2010', WarehouseProcessType_Text: 'Stock Removal' }
            ]);

            const res = await EwmAdapter.getWarehouseProcessTypes('0001');
            expect(EwmAdapter._get).toHaveBeenCalledWith(
                '/sap/opu/odata/scwm/WAREHOUSE_KPIS_SRV/I_EWM_WhseProcTypeVH',
                "$filter=EWMWarehouse eq '0001'&$format=json"
            );
            expect(res).toEqual([
                { Warehouse: '0001', WarehouseProcessType: '1010', WarehouseProcessTypeName: 'Putaway' },
                { Warehouse: '0001', WarehouseProcessType: '2010', WarehouseProcessTypeName: 'Stock Removal' }
            ]);
        });
    });

    describe('Outage & Error Surfacing in EwmAdapter', () => {
        it('should throw 502 when all storage types sources fail', async () => {
            EwmAdapter._get = jest.fn().mockRejectedValue(new Error('Storage Type API Down'));
            await expect(EwmAdapter.getStorageTypes('1120')).rejects.toMatchObject({
                status: 502,
                message: expect.stringContaining('Storage types for warehouse 1120 could not be read')
            });
        });

        it('should throw 502 when all storage bins sources fail', async () => {
            EwmAdapter._get = jest.fn().mockRejectedValue(new Error('Storage Bin API Down'));
            await expect(EwmAdapter.getStorageBins('1120')).rejects.toMatchObject({
                status: 502,
                message: expect.stringContaining('Storage bins for warehouse 1120 could not be read')
            });
        });

        it('should throw 502 when inbound deliveries sources fail', async () => {
            EwmAdapter._get = jest.fn().mockRejectedValue(new Error('Inbound Delivery API Down'));
            await expect(EwmAdapter.getInboundDeliveries('1120')).rejects.toMatchObject({
                status: 502,
                message: expect.stringContaining('Inbound deliveries for warehouse 1120 could not be read')
            });
        });

        it('should throw 502 when outbound deliveries sources fail', async () => {
            EwmAdapter._get = jest.fn().mockRejectedValue(new Error('Outbound Delivery API Down'));
            await expect(EwmAdapter.getOutboundDeliveries('1120')).rejects.toMatchObject({
                status: 502,
                message: expect.stringContaining('Outbound deliveries for warehouse 1120 could not be read')
            });
        });

        it('should rethrow error with status 502 when getWarehouseTasks fails', async () => {
            EwmAdapter._get = jest.fn().mockRejectedValue(new Error('Task Service 500'));
            await expect(EwmAdapter.getWarehouseTasks('1120')).rejects.toMatchObject({
                status: 502,
                message: expect.stringContaining('Task Service 500')
            });
        });

        it('should rethrow error with status 502 when getWarehouseOrders fails', async () => {
            EwmAdapter._get = jest.fn().mockRejectedValue(new Error('Order Service 500'));
            await expect(EwmAdapter.getWarehouseOrders('1120')).rejects.toMatchObject({
                status: 502,
                message: expect.stringContaining('Order Service 500')
            });
        });

        it('should rethrow error with status 502 when getWarehouseResources fails', async () => {
            EwmAdapter._get = jest.fn().mockRejectedValue(new Error('Resource Service 500'));
            await expect(EwmAdapter.getWarehouseResources('1120')).rejects.toMatchObject({
                status: 502,
                message: expect.stringContaining('Resource Service 500')
            });
        });

        it('should rethrow error with status 502 when getWarehouseProcessTypes fails', async () => {
            EwmAdapter._get = jest.fn().mockRejectedValue(new Error('Process Type Service 500'));
            await expect(EwmAdapter.getWarehouseProcessTypes('1120')).rejects.toMatchObject({
                status: 502,
                message: expect.stringContaining('Process Type Service 500')
            });
        });
    });
});
