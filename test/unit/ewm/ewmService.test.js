/**
 * Unit Tests for EwmService
 * (app/fiori-app/webapp/modules/ewm/warehouse-cockpit/service/EwmService.js)
 *
 * Verifies strict elimination of all hardcoded business values (1120, 1, empty strings)
 * and verifies that valid inputs are enforced for warehouses, tasks, bins, resources, quantities, HUs, queues.
 */

let EwmService;
let mockODataClient;

beforeAll(() => {
    mockODataClient = {
        get: jest.fn(),
        post: jest.fn()
    };

    global.sap = {
        ui: {
            define: (deps, factory) => {
                EwmService = factory(mockODataClient);
            }
        }
    };

    require('../../../app/fiori-app/webapp/modules/ewm/warehouse-cockpit/service/EwmService');
});

beforeEach(() => {
    jest.clearAllMocks();
});

describe('Unit: EwmService - Strict Validation & Zero Fallbacks', () => {

    describe('getWarehouses', () => {
        it('should call ODataClient.get for /Warehouses without assumptions', async () => {
            mockODataClient.get.mockResolvedValueOnce({ value: [{ Warehouse: '0001' }, { Warehouse: '100' }] });
            const res = await EwmService.getWarehouses();
            expect(mockODataClient.get).toHaveBeenCalledWith('/odata/v4/warehouse-management/Warehouses');
            expect(res.value).toHaveLength(2);
        });
    });

    describe('isProjectSpecificWarehouse and filterProjectWarehouses', () => {
        it('should reject standard SAP codes and demo warehouse names', () => {
            // Standard codes
            expect(EwmService.isProjectSpecificWarehouse({ Warehouse: '0001', WarehouseName: 'Central Warehouse' })).toBe(false);
            expect(EwmService.isProjectSpecificWarehouse({ Warehouse: '001', WarehouseName: 'Central whse (full WM)' })).toBe(false);
            expect(EwmService.isProjectSpecificWarehouse({ Warehouse: '002', WarehouseName: 'Lean WM' })).toBe(false);
            expect(EwmService.isProjectSpecificWarehouse({ Warehouse: '100', WarehouseName: 'Lean WM (without stocks)' })).toBe(false);
            expect(EwmService.isProjectSpecificWarehouse({ Warehouse: 'EWM', WarehouseName: 'SCM-EWM' })).toBe(false);
            expect(EwmService.isProjectSpecificWarehouse({ Warehouse: 'MLO', WarehouseName: 'Loading Object' })).toBe(false);

            // Names matching standard patterns regardless of code
            expect(EwmService.isProjectSpecificWarehouse({ Warehouse: '9999', WarehouseName: 'Demo Warehouse' })).toBe(false);
            expect(EwmService.isProjectSpecificWarehouse({ Warehouse: '9998', WarehouseName: 'Standard Plant Warehouse' })).toBe(false);
            expect(EwmService.isProjectSpecificWarehouse({ Warehouse: '9997', WarehouseName: 'Sample Central Warehouse' })).toBe(false);

            // Invalid / empty entities
            expect(EwmService.isProjectSpecificWarehouse(null)).toBe(false);
            expect(EwmService.isProjectSpecificWarehouse({})).toBe(false);
            expect(EwmService.isProjectSpecificWarehouse({ Warehouse: '' })).toBe(false);
        });

        it('should accept authentic project-specific warehouses', () => {
            expect(EwmService.isProjectSpecificWarehouse({ Warehouse: 'W01', WarehouseName: '452/453 Warehouse' })).toBe(true);
            expect(EwmService.isProjectSpecificWarehouse({ Warehouse: 'W05', WarehouseName: 'Panoli WH' })).toBe(true);
            expect(EwmService.isProjectSpecificWarehouse({ Warehouse: 'W10', WarehouseName: 'Plant 1000 WH' })).toBe(true);
            expect(EwmService.isProjectSpecificWarehouse({ Warehouse: 'W14', WarehouseName: 'Panoli Internal WH-1' })).toBe(true);
            expect(EwmService.isProjectSpecificWarehouse({ Warehouse: 'W26', WarehouseName: 'Speciality' })).toBe(true);
        });

        it('should filter a list to retain strictly project-specific warehouses', () => {
            const raw = [
                { Warehouse: '0001', WarehouseName: 'Central Warehouse' },
                { Warehouse: '001', WarehouseName: 'Central whse (full WM)' },
                { Warehouse: '100', WarehouseName: 'Lean WM (without stocks)' },
                { Warehouse: 'EWM', WarehouseName: 'SCM-EWM' },
                { Warehouse: 'MLO', WarehouseName: 'Loading Object' },
                { Warehouse: 'W05', WarehouseName: 'Panoli WH' },
                { Warehouse: 'W10', WarehouseName: 'Plant 1000 WH' }
            ];
            const filtered = EwmService.filterProjectWarehouses(raw);
            expect(filtered).toHaveLength(2);
            expect(filtered[0].Warehouse).toBe('W05');
            expect(filtered[1].Warehouse).toBe('W10');
        });

        it('should handle non-array gracefully', () => {
            expect(EwmService.filterProjectWarehouses(null)).toEqual([]);
            expect(EwmService.filterProjectWarehouses(undefined)).toEqual([]);
        });
    });

    describe('getWarehouseProcessTypes', () => {
        it('should reject when Warehouse is missing or empty', async () => {
            await expect(EwmService.getWarehouseProcessTypes()).rejects.toThrow(/Warehouse is required/);
            await expect(EwmService.getWarehouseProcessTypes('')).rejects.toThrow(/Warehouse is required/);
            await expect(EwmService.getWarehouseProcessTypes('   ')).rejects.toThrow(/Warehouse is required/);
            expect(mockODataClient.get).not.toHaveBeenCalled();
        });

        it('should query WarehouseProcessTypes with specified warehouse filter', async () => {
            mockODataClient.get.mockResolvedValueOnce({ value: [{ Warehouse: '0001', WarehouseProcessType: '1010' }] });
            const res = await EwmService.getWarehouseProcessTypes('0001');
            expect(mockODataClient.get).toHaveBeenCalledWith(
                "/odata/v4/warehouse-management/WarehouseProcessTypes?$filter=Warehouse eq '0001'"
            );
            expect(res.value).toHaveLength(1);
        });
    });

    describe('getStorageTypes', () => {
        it('should reject when Warehouse is missing or empty (no 1120 fallback)', async () => {
            await expect(EwmService.getStorageTypes()).rejects.toThrow(/Warehouse is required/);
            await expect(EwmService.getStorageTypes('')).rejects.toThrow(/Warehouse is required/);
            await expect(EwmService.getStorageTypes('   ')).rejects.toThrow(/Warehouse is required/);
            await expect(EwmService.getStorageTypes(null)).rejects.toThrow(/Warehouse is required/);
            expect(mockODataClient.get).not.toHaveBeenCalled();
        });

        it('should query StorageTypes with specified warehouse filter', async () => {
            mockODataClient.get.mockResolvedValueOnce({ value: [] });
            await EwmService.getStorageTypes('0001');
            expect(mockODataClient.get).toHaveBeenCalledWith(
                "/odata/v4/warehouse-management/StorageTypes?$filter=Warehouse eq '0001'"
            );
        });

        it('should query StorageTypes with optional storage type filter', async () => {
            mockODataClient.get.mockResolvedValueOnce({ value: [] });
            await EwmService.getStorageTypes('0001', '0010');
            expect(mockODataClient.get).toHaveBeenCalledWith(
                "/odata/v4/warehouse-management/StorageTypes?$filter=Warehouse eq '0001' and StorageType eq '0010'"
            );
        });
    });

    describe('getStorageBins & getStorageBin', () => {
        it('should reject getStorageBins when Warehouse is missing', async () => {
            await expect(EwmService.getStorageBins()).rejects.toThrow(/Warehouse is required/);
            await expect(EwmService.getStorageBins('')).rejects.toThrow(/Warehouse is required/);
            expect(mockODataClient.get).not.toHaveBeenCalled();
        });

        it('should query StorageBins with specified warehouse, type, and bin filters', async () => {
            mockODataClient.get.mockResolvedValueOnce({ value: [] });
            await EwmService.getStorageBins('W01', 'T01', 'BIN-01');
            expect(mockODataClient.get).toHaveBeenCalledWith(
                "/odata/v4/warehouse-management/StorageBins?$filter=Warehouse eq 'W01' and StorageType eq 'T01' and StorageBin eq 'BIN-01'"
            );
        });

        it('should reject getStorageBin if Warehouse or StorageBin is missing', async () => {
            await expect(EwmService.getStorageBin('', 'BIN-01')).rejects.toThrow(/Warehouse is required/);
            await expect(EwmService.getStorageBin('0001', '')).rejects.toThrow(/StorageBin is required/);
        });

        it('should query single StorageBin with key predicate', async () => {
            mockODataClient.get.mockResolvedValueOnce({ Warehouse: '0001', StorageBin: '0010-01-01' });
            await EwmService.getStorageBin('0001', '0010-01-01');
            expect(mockODataClient.get).toHaveBeenCalledWith(
                "/odata/v4/warehouse-management/StorageBins(Warehouse='0001',StorageBin='0010-01-01')"
            );
        });
    });

    describe('getWarehouseOrders & getWarehouseOrder', () => {
        it('should reject getWarehouseOrders when Warehouse is missing', async () => {
            await expect(EwmService.getWarehouseOrders()).rejects.toThrow(/Warehouse is required/);
            await expect(EwmService.getWarehouseOrders('')).rejects.toThrow(/Warehouse is required/);
        });

        it('should query WarehouseOrders with warehouse, queue, and status filters', async () => {
            mockODataClient.get.mockResolvedValueOnce({ value: [] });
            await EwmService.getWarehouseOrders('0001', 'PICK_01', 'O');
            expect(mockODataClient.get).toHaveBeenCalledWith(
                "/odata/v4/warehouse-management/WarehouseOrders?$filter=Warehouse eq '0001' and WarehouseOrderQueue eq 'PICK_01' and WarehouseOrderStatus eq 'O'"
            );
        });

        it('should query single WarehouseOrder by key predicate', async () => {
            mockODataClient.get.mockResolvedValueOnce({ Warehouse: '0001', WarehouseOrder: '5001' });
            await EwmService.getWarehouseOrder('0001', '5001');
            expect(mockODataClient.get).toHaveBeenCalledWith(
                "/odata/v4/warehouse-management/WarehouseOrders(Warehouse='0001',WarehouseOrder='5001')"
            );
        });
    });

    describe('getWarehouseTasks & getWarehouseTask', () => {
        it('should reject getWarehouseTasks when Warehouse is missing', async () => {
            await expect(EwmService.getWarehouseTasks()).rejects.toThrow(/Warehouse is required/);
            await expect(EwmService.getWarehouseTasks('')).rejects.toThrow(/Warehouse is required/);
        });

        it('should query WarehouseTasks with warehouse and status filters', async () => {
            mockODataClient.get.mockResolvedValueOnce({ value: [] });
            await EwmService.getWarehouseTasks('0001', 'O');
            expect(mockODataClient.get).toHaveBeenCalledWith(
                "/odata/v4/warehouse-management/WarehouseTasks?$filter=Warehouse eq '0001' and WarehouseTaskStatus eq 'O'"
            );
        });

        it('should query single WarehouseTask by key predicate', async () => {
            mockODataClient.get.mockResolvedValueOnce({ Warehouse: '0001', WarehouseTask: '10001' });
            await EwmService.getWarehouseTask('0001', '10001');
            expect(mockODataClient.get).toHaveBeenCalledWith(
                "/odata/v4/warehouse-management/WarehouseTasks(Warehouse='0001',WarehouseTask='10001')"
            );
        });
    });

    describe('getInboundDeliveries & getInboundDelivery', () => {
        it('should reject getInboundDeliveries when Warehouse is missing', async () => {
            await expect(EwmService.getInboundDeliveries()).rejects.toThrow(/Warehouse is required/);
            await expect(EwmService.getInboundDeliveries('')).rejects.toThrow(/Warehouse is required/);
        });

        it('should query InboundDeliveries with expand Items', async () => {
            mockODataClient.get.mockResolvedValueOnce({ value: [] });
            await EwmService.getInboundDeliveries('0001');
            expect(mockODataClient.get).toHaveBeenCalledWith(
                "/odata/v4/warehouse-management/InboundDeliveries?$filter=Warehouse eq '0001'&$expand=Items"
            );
        });

        it('should query single InboundDelivery by key', async () => {
            mockODataClient.get.mockResolvedValueOnce({ Warehouse: '0001', DeliveryDocument: '1800001' });
            await EwmService.getInboundDelivery('0001', '1800001');
            expect(mockODataClient.get).toHaveBeenCalledWith(
                "/odata/v4/warehouse-management/InboundDeliveries(Warehouse='0001',DeliveryDocument='1800001')?$expand=Items"
            );
        });
    });

    describe('getOutboundDeliveries & getOutboundDelivery', () => {
        it('should reject getOutboundDeliveries when Warehouse is missing', async () => {
            await expect(EwmService.getOutboundDeliveries()).rejects.toThrow(/Warehouse is required/);
        });

        it('should query OutboundDeliveries with expand Items', async () => {
            mockODataClient.get.mockResolvedValueOnce({ value: [] });
            await EwmService.getOutboundDeliveries('0001');
            expect(mockODataClient.get).toHaveBeenCalledWith(
                "/odata/v4/warehouse-management/OutboundDeliveries?$filter=Warehouse eq '0001'&$expand=Items"
            );
        });

        it('should query single OutboundDelivery by key', async () => {
            mockODataClient.get.mockResolvedValueOnce({ Warehouse: '0001', OutboundDeliveryOrder: '800001' });
            await EwmService.getOutboundDelivery('0001', '800001');
            expect(mockODataClient.get).toHaveBeenCalledWith(
                "/odata/v4/warehouse-management/OutboundDeliveries(Warehouse='0001',OutboundDeliveryOrder='800001')?$expand=Items"
            );
        });
    });

    describe('getWarehouseKPIs', () => {
        it('should reject when Warehouse is missing (no 1120 fallback)', async () => {
            await expect(EwmService.getWarehouseKPIs()).rejects.toThrow(/Warehouse is required/);
            await expect(EwmService.getWarehouseKPIs('')).rejects.toThrow(/Warehouse is required/);
        });

        it('should query WarehouseKPIs with specified warehouse', async () => {
            mockODataClient.get.mockResolvedValueOnce({ value: [{ Warehouse: '0001' }] });
            await EwmService.getWarehouseKPIs('0001');
            expect(mockODataClient.get).toHaveBeenCalledWith(
                "/odata/v4/warehouse-management/WarehouseKPIs?$filter=Warehouse eq '0001'"
            );
        });
    });

    describe('getResources & getResource', () => {
        it('should reject when Warehouse is missing', async () => {
            await expect(EwmService.getResources()).rejects.toThrow(/Warehouse is required/);
            await expect(EwmService.getResources('')).rejects.toThrow(/Warehouse is required/);
        });

        it('should query Resources with filter', async () => {
            mockODataClient.get.mockResolvedValueOnce({ value: [] });
            await EwmService.getResources('0001');
            expect(mockODataClient.get).toHaveBeenCalledWith(
                "/odata/v4/warehouse-management/WarehouseResources?$filter=Warehouse eq '0001'"
            );
        });

        it('should query single Resource by key', async () => {
            mockODataClient.get.mockResolvedValueOnce({ Warehouse: '0001', Resource: 'CART-01' });
            await EwmService.getResource('0001', 'CART-01');
            expect(mockODataClient.get).toHaveBeenCalledWith(
                "/odata/v4/warehouse-management/WarehouseResources(Warehouse='0001',Resource='CART-01')"
            );
        });
    });

    describe('getQueues', () => {
        it('should reject when Warehouse is missing', async () => {
            await expect(EwmService.getQueues()).rejects.toThrow(/Warehouse is required/);
        });

        it('should extract distinct queues from actual SAP orders and resources', async () => {
            mockODataClient.get
                .mockResolvedValueOnce({
                    value: [
                        { WarehouseOrderQueue: 'PICK_STD' },
                        { WarehouseOrderQueue: 'PUT_SLOW' },
                        { WarehouseOrderQueue: 'PICK_STD' } // duplicate
                    ]
                })
                .mockResolvedValueOnce({
                    value: [
                        { AssignedQueue: 'SPECIAL_01' },
                        { AssignedQueue: 'PICK_STD' }
                    ]
                });

            const queues = await EwmService.getQueues('0001');
            expect(queues).toEqual([
                { Queue: 'PICK_STD' },
                { Queue: 'PUT_SLOW' },
                { Queue: 'SPECIAL_01' }
            ]);
        });
    });

    describe('confirmWarehouseTask', () => {
        it('should reject if Warehouse or WarehouseTask is missing', async () => {
            await expect(EwmService.confirmWarehouseTask('', '10001', 5)).rejects.toThrow(/Warehouse is required/);
            await expect(EwmService.confirmWarehouseTask('0001', '', 5)).rejects.toThrow(/WarehouseTask is required/);
        });

        it('should reject if ConfirmedQuantity is missing, 0, negative, or NaN (no default 1 fallback)', async () => {
            await expect(EwmService.confirmWarehouseTask('0001', '10001', undefined)).rejects.toThrow(/ConfirmedQuantity is required/);
            await expect(EwmService.confirmWarehouseTask('0001', '10001', null)).rejects.toThrow(/ConfirmedQuantity is required/);
            await expect(EwmService.confirmWarehouseTask('0001', '10001', 0)).rejects.toThrow(/ConfirmedQuantity is required/);
            await expect(EwmService.confirmWarehouseTask('0001', '10001', -5)).rejects.toThrow(/ConfirmedQuantity is required/);
            await expect(EwmService.confirmWarehouseTask('0001', '10001', 'not-a-number')).rejects.toThrow(/ConfirmedQuantity is required/);
            expect(mockODataClient.post).not.toHaveBeenCalled();
        });

        it('should post with exact numeric ConfirmedQuantity when valid', async () => {
            mockODataClient.post.mockResolvedValueOnce(true);
            await EwmService.confirmWarehouseTask('0001', '10001', 10.5);
            expect(mockODataClient.post).toHaveBeenCalledWith('/odata/v4/warehouse-management/confirmWarehouseTask', {
                Warehouse: '0001',
                WarehouseTask: '10001',
                ConfirmedQuantity: 10.5
            });
        });
    });

    describe('createWarehouseTask', () => {
        it('should reject if taskData or required fields are missing (no default fallbacks)', async () => {
            await expect(EwmService.createWarehouseTask(null)).rejects.toThrow(/Task data object is required/);
            await expect(EwmService.createWarehouseTask({})).rejects.toThrow(/Warehouse is required/);
            await expect(EwmService.createWarehouseTask({ Warehouse: '0001' })).rejects.toThrow(/Product is required/);
            await expect(EwmService.createWarehouseTask({ Warehouse: '0001', Product: 'TG11' })).rejects.toThrow(/Quantity is required/);
            await expect(EwmService.createWarehouseTask({ Warehouse: '0001', Product: 'TG11', Quantity: 0 })).rejects.toThrow(/Quantity is required/);
            await expect(EwmService.createWarehouseTask({ Warehouse: '0001', Product: 'TG11', Quantity: 5 })).rejects.toThrow(/UnitOfMeasure is required/);
            await expect(EwmService.createWarehouseTask({ Warehouse: '0001', Product: 'TG11', Quantity: 5, UnitOfMeasure: 'EA' })).rejects.toThrow(/WarehouseProcessType is required/);
            expect(mockODataClient.post).not.toHaveBeenCalled();
        });

        it('should post clean payload when all required fields are provided', async () => {
            mockODataClient.post.mockResolvedValueOnce({ WarehouseTask: '90001' });
            await EwmService.createWarehouseTask({
                Warehouse: '0001',
                Product: 'TG11',
                Quantity: 25,
                UnitOfMeasure: 'KG',
                WarehouseProcessType: '1010',
                SourceStorageBin: '0010-01-01',
                TargetStorageBin: '8030-01-01'
            });

            expect(mockODataClient.post).toHaveBeenCalledWith('/odata/v4/warehouse-management/createWarehouseTask', {
                Warehouse: '0001',
                Product: 'TG11',
                Quantity: 25,
                UnitOfMeasure: 'KG',
                WarehouseProcessType: '1010',
                SourceStorageBin: '0010-01-01',
                TargetStorageBin: '8030-01-01'
            });
        });

        it('should forward optional metadata fields (types, destination bin, batch, handling units) when provided', async () => {
            mockODataClient.post.mockResolvedValueOnce({ WarehouseTask: '90002' });
            await EwmService.createWarehouseTask({
                Warehouse: '0001',
                Product: 'TG11',
                Quantity: 10,
                UnitOfMeasure: 'EA',
                WarehouseProcessType: '2010',
                SourceStorageType: '0010',
                SourceStorageBin: '0010-01-01',
                TargetStorageType: '0020',
                TargetStorageBin: '0020-01-01',
                DestinationStorageBin: '0020-01-01',
                Batch: 'BATCH01',
                SourceHandlingUnit: 'HU-001',
                DestinationHandlingUnit: 'HU-002'
            });

            expect(mockODataClient.post).toHaveBeenCalledWith('/odata/v4/warehouse-management/createWarehouseTask', {
                Warehouse: '0001',
                Product: 'TG11',
                Quantity: 10,
                UnitOfMeasure: 'EA',
                WarehouseProcessType: '2010',
                SourceStorageType: '0010',
                SourceStorageBin: '0010-01-01',
                TargetStorageType: '0020',
                TargetStorageBin: '0020-01-01',
                DestinationStorageBin: '0020-01-01',
                Batch: 'BATCH01',
                SourceHandlingUnit: 'HU-001',
                DestinationHandlingUnit: 'HU-002'
            });
        });
    });

    describe('logonResource', () => {
        it('should reject if Warehouse, Resource, or Queue is missing (no empty string fallback)', async () => {
            await expect(EwmService.logonResource('', 'CART-01', 'PICK_01')).rejects.toThrow(/Warehouse is required/);
            await expect(EwmService.logonResource('0001', '', 'PICK_01')).rejects.toThrow(/Resource is required/);
            await expect(EwmService.logonResource('0001', 'CART-01', '')).rejects.toThrow(/Queue is required/);
            await expect(EwmService.logonResource('0001', 'CART-01', undefined)).rejects.toThrow(/Queue is required/);
            expect(mockODataClient.post).not.toHaveBeenCalled();
        });

        it('should post logon with all 3 parameters when valid', async () => {
            mockODataClient.post.mockResolvedValueOnce(true);
            await EwmService.logonResource('0001', 'CART-01', 'PICK_01');
            expect(mockODataClient.post).toHaveBeenCalledWith('/odata/v4/warehouse-management/logonResource', {
                Warehouse: '0001',
                Resource: 'CART-01',
                Queue: 'PICK_01'
            });
        });
    });

    describe('confirmRfPick', () => {
        it('should reject if any parameter is missing or non-positive (no fallbacks to 1 or empty strings)', async () => {
            await expect(EwmService.confirmRfPick('', '10001', 5, 'HU-101', 'BIN-01')).rejects.toThrow(/Warehouse is required/);
            await expect(EwmService.confirmRfPick('0001', '', 5, 'HU-101', 'BIN-01')).rejects.toThrow(/WarehouseTask is required/);
            await expect(EwmService.confirmRfPick('0001', '10001', 0, 'HU-101', 'BIN-01')).rejects.toThrow(/ConfirmedQuantity is required/);
            await expect(EwmService.confirmRfPick('0001', '10001', -1, 'HU-101', 'BIN-01')).rejects.toThrow(/ConfirmedQuantity is required/);
            await expect(EwmService.confirmRfPick('0001', '10001', 5, '', 'BIN-01')).rejects.toThrow(/DestinationHU is required/);
            await expect(EwmService.confirmRfPick('0001', '10001', 5, 'HU-101', '')).rejects.toThrow(/ScannedBin is required/);
            expect(mockODataClient.post).not.toHaveBeenCalled();
        });

        it('should post exact confirmation payload when all arguments are valid', async () => {
            mockODataClient.post.mockResolvedValueOnce(true);
            await EwmService.confirmRfPick('0001', '10001', 8, 'HU-101', '0010-01-01');
            expect(mockODataClient.post).toHaveBeenCalledWith('/odata/v4/warehouse-management/confirmRfPick', {
                Warehouse: '0001',
                WarehouseTask: '10001',
                ConfirmedQuantity: 8,
                DestinationHU: 'HU-101',
                ScannedBin: '0010-01-01'
            });
        });
    });

    describe('verifyRfScan', () => {
        it('should reject if any required scan parameter is missing', async () => {
            await expect(EwmService.verifyRfScan('', 'BIN', 'BIN-01', 'BIN-01')).rejects.toThrow(/Warehouse is required/);
            await expect(EwmService.verifyRfScan('0001', '', 'BIN-01', 'BIN-01')).rejects.toThrow(/ScanType is required/);
            await expect(EwmService.verifyRfScan('0001', 'BIN', '', 'BIN-01')).rejects.toThrow(/BarcodeValue is required/);
            await expect(EwmService.verifyRfScan('0001', 'BIN', 'BIN-01', '')).rejects.toThrow(/ExpectedValue is required/);
        });

        it('should post scan verification when valid', async () => {
            mockODataClient.post.mockResolvedValueOnce(true);
            await EwmService.verifyRfScan('0001', 'BIN', '0010-01-01', '0010-01-01');
            expect(mockODataClient.post).toHaveBeenCalledWith('/odata/v4/warehouse-management/verifyRfScan', {
                Warehouse: '0001',
                ScanType: 'BIN',
                BarcodeValue: '0010-01-01',
                ExpectedValue: '0010-01-01'
            });
        });
    });

    describe('cancelWarehouseTask, postGoodsReceipt, postGoodsIssue', () => {
        it('should reject cancelWarehouseTask if parameters missing', async () => {
            await expect(EwmService.cancelWarehouseTask('', '10001')).rejects.toThrow(/Warehouse is required/);
            await expect(EwmService.cancelWarehouseTask('0001', '')).rejects.toThrow(/WarehouseTask is required/);
        });

        it('should reject postGoodsReceipt if parameters missing', async () => {
            await expect(EwmService.postGoodsReceipt('', '1800001')).rejects.toThrow(/Warehouse is required/);
            await expect(EwmService.postGoodsReceipt('0001', '')).rejects.toThrow(/DeliveryDocument is required/);
        });

        it('should reject postGoodsIssue if parameters missing', async () => {
            await expect(EwmService.postGoodsIssue('', '800001')).rejects.toThrow(/Warehouse is required/);
            await expect(EwmService.postGoodsIssue('0001', '')).rejects.toThrow(/OutboundDeliveryOrder is required/);
        });
    });
});
