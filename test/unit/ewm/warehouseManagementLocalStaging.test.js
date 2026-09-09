const WarehouseManagementHandler = require('../../../srv/ewm/warehouse-management/handlers/warehouseManagement.handler');
const EwmAdapter = require('../../../srv/integration/s4hana/ewm/EwmAdapter');

describe('WarehouseManagementHandler: Local Staging Persistence', () => {
    let srv;
    let handlers = {};

    beforeEach(() => {
        WarehouseManagementHandler.resetLocalStaging();
        handlers = {};
        srv = {
            on: jest.fn((event, entityOrHandler, handler) => {
                const key = typeof entityOrHandler === 'string' ? `${event}:${entityOrHandler}` : event;
                const fn = typeof entityOrHandler === 'function' ? entityOrHandler : handler;
                handlers[key] = fn;
            })
        };
        WarehouseManagementHandler.init(srv);
    });

    afterEach(() => {
        jest.restoreAllMocks();
        WarehouseManagementHandler.resetLocalStaging();
    });

    describe('createWarehouseTask fallback to local staging', () => {
        it('should stage task locally when EwmAdapter.createWarehouseTask throws SAP rejection', async () => {
            jest.spyOn(EwmAdapter, 'createWarehouseTask').mockRejectedValueOnce(
                new Error('Warehouse Task creation failed — all SAP strategies exhausted')
            );

            const req = {
                data: {
                    Warehouse: '0001',
                    Product: 'TG11',
                    Quantity: 10,
                    UnitOfMeasure: 'EA',
                    WarehouseProcessType: '1010',
                    SourceStorageType: '0010',
                    SourceStorageBin: '0010-01-01',
                    TargetStorageType: '0020',
                    TargetStorageBin: '0020-01-01'
                },
                error: jest.fn()
            };

            const result = await handlers['createWarehouseTask'](req);

            expect(result).toBeDefined();
            expect(result.Warehouse).toBe('0001');
            expect(result.WarehouseTask).toBe('WT-10001');
            expect(result.Product).toBe('TG11');
            expect(result.TargetQuantity).toBe(10);
            expect(result.BaseUnit).toBe('EA');
            expect(result.WarehouseProcessType).toBe('1010');
            expect(result.WarehouseTaskStatus).toBe('O');
            expect(result._isLocalStaging).toBe(true);
            expect(req.error).not.toHaveBeenCalled();

            const stagedList = WarehouseManagementHandler.getLocalStagedTasks();
            expect(stagedList).toHaveLength(1);
            expect(stagedList[0].WarehouseTask).toBe('WT-10001');
        });

        it('should rethrow 400 client validation errors without staging', async () => {
            const clientErr = new Error('Invalid parameter');
            clientErr.status = 400;
            jest.spyOn(EwmAdapter, 'createWarehouseTask').mockRejectedValueOnce(clientErr);

            const req = {
                data: {
                    Warehouse: '0001',
                    Product: 'TG11',
                    Quantity: 10,
                    UnitOfMeasure: 'EA',
                    WarehouseProcessType: '1010'
                },
                error: jest.fn()
            };

            await handlers['createWarehouseTask'](req);
            expect(req.error).toHaveBeenCalledWith(400, 'Invalid parameter');
            expect(WarehouseManagementHandler.getLocalStagedTasks()).toHaveLength(0);
        });

        it('should automatically stage task for warehouse W22 even when WarehouseProcessType is omitted or unconfigured in backend', async () => {
            jest.spyOn(EwmAdapter, 'createWarehouseTask').mockRejectedValueOnce(
                new Error('Warehouse process type not configured for warehouse W22 in /SCWM/T333')
            );

            const req = {
                data: {
                    Warehouse: 'W22',
                    Product: 'TG11',
                    Quantity: 15,
                    UnitOfMeasure: 'EA'
                    // WarehouseProcessType intentionally omitted
                },
                error: jest.fn()
            };

            const result = await handlers['createWarehouseTask'](req);

            expect(result).toBeDefined();
            expect(result.Warehouse).toBe('W22');
            expect(result.WarehouseTask).toBe('WT-10001');
            expect(result.WarehouseProcessType).toBe('1010');
            expect(result._isLocalStaging).toBe(true);
            expect(req.error).not.toHaveBeenCalled();

            const stagedList = WarehouseManagementHandler.getLocalStagedTasks();
            expect(stagedList).toHaveLength(1);
            expect(stagedList[0].Warehouse).toBe('W22');
        });
    });

    describe('READ WarehouseTasks with staged tasks', () => {
        it('should combine live SAP tasks with locally staged tasks', async () => {
            jest.spyOn(EwmAdapter, 'getWarehouseTasks').mockResolvedValueOnce([
                { Warehouse: '0001', WarehouseTask: 'SAP-1', WarehouseTaskStatus: 'O' }
            ]);

            // Create a staged task first
            jest.spyOn(EwmAdapter, 'createWarehouseTask').mockRejectedValueOnce(new Error('SAP offline'));
            await handlers['createWarehouseTask']({
                data: {
                    Warehouse: '0001',
                    Product: 'TG11',
                    Quantity: 5,
                    UnitOfMeasure: 'EA',
                    WarehouseProcessType: '1010'
                },
                error: jest.fn()
            });

            const req = {
                data: { Warehouse: '0001' },
                error: jest.fn()
            };

            const tasks = await handlers['READ:WarehouseTasks'](req);
            expect(tasks).toHaveLength(2);
            expect(tasks[0].WarehouseTask).toBe('SAP-1');
            expect(tasks[1].WarehouseTask).toBe('WT-10001');
            expect(tasks[1]._isLocalStaging).toBe(true);
        });

        it('should find a specific staged task by WarehouseTask key', async () => {
            jest.spyOn(EwmAdapter, 'getWarehouseTasks').mockResolvedValueOnce([]);

            jest.spyOn(EwmAdapter, 'createWarehouseTask').mockRejectedValueOnce(new Error('SAP offline'));
            await handlers['createWarehouseTask']({
                data: {
                    Warehouse: '0001',
                    Product: 'TG11',
                    Quantity: 5,
                    UnitOfMeasure: 'EA',
                    WarehouseProcessType: '1010'
                },
                error: jest.fn()
            });

            const req = {
                data: { Warehouse: '0001' },
                params: [{ WarehouseTask: 'WT-10001' }],
                error: jest.fn()
            };

            const task = await handlers['READ:WarehouseTasks'](req);
            expect(task).toBeDefined();
            expect(task.WarehouseTask).toBe('WT-10001');
            expect(task._isLocalStaging).toBe(true);
        });
    });

    describe('READ WarehouseKPIs with staged tasks', () => {
        it('should count open staged tasks in OpenTasksCount KPI', async () => {
            jest.spyOn(EwmAdapter, 'getWarehouseTasks').mockResolvedValueOnce([
                { Warehouse: '0001', WarehouseTask: 'SAP-1', WarehouseTaskStatus: 'C' } // Confirmed SAP task
            ]);
            jest.spyOn(EwmAdapter, 'getInboundDeliveries').mockResolvedValueOnce([]);
            jest.spyOn(EwmAdapter, 'getOutboundDeliveries').mockResolvedValueOnce([]);
            jest.spyOn(EwmAdapter, 'getStorageBins').mockResolvedValueOnce([]);
            jest.spyOn(EwmAdapter, 'getStorageTypes').mockResolvedValueOnce([]);

            // Create an open staged task
            jest.spyOn(EwmAdapter, 'createWarehouseTask').mockRejectedValueOnce(new Error('SAP offline'));
            await handlers['createWarehouseTask']({
                data: {
                    Warehouse: '0001',
                    Product: 'TG11',
                    Quantity: 5,
                    UnitOfMeasure: 'EA',
                    WarehouseProcessType: '1010'
                },
                error: jest.fn()
            });

            const req = {
                data: { Warehouse: '0001' },
                error: jest.fn()
            };

            const kpiResult = await handlers['READ:WarehouseKPIs'](req);
            expect(kpiResult).toHaveLength(1);
            expect(kpiResult[0].OpenTasksCount).toBe(1); // 1 open staged task
        });
    });

    describe('confirmWarehouseTask and cancelWarehouseTask on staged tasks', () => {
        it('should confirm a staged task and transition its status to C', async () => {
            jest.spyOn(EwmAdapter, 'createWarehouseTask').mockRejectedValueOnce(new Error('SAP offline'));
            await handlers['createWarehouseTask']({
                data: {
                    Warehouse: '0001',
                    Product: 'TG11',
                    Quantity: 5,
                    UnitOfMeasure: 'EA',
                    WarehouseProcessType: '1010'
                },
                error: jest.fn()
            });

            const req = {
                data: {
                    Warehouse: '0001',
                    WarehouseTask: 'WT-10001',
                    ConfirmedQuantity: 5
                },
                user: { id: 'TEST_USER' },
                error: jest.fn()
            };

            const success = await handlers['confirmWarehouseTask'](req);
            expect(success).toBe(true);

            const staged = WarehouseManagementHandler.getLocalStagedTasks()[0];
            expect(staged.WarehouseTaskStatus).toBe('C');
            expect(staged.ConfirmedQuantity).toBe(5);
            expect(staged.ConfirmedByUser).toBe('TEST_USER');
        });

        it('should cancel a staged task and transition its status to X', async () => {
            jest.spyOn(EwmAdapter, 'createWarehouseTask').mockRejectedValueOnce(new Error('SAP offline'));
            await handlers['createWarehouseTask']({
                data: {
                    Warehouse: '0001',
                    Product: 'TG11',
                    Quantity: 5,
                    UnitOfMeasure: 'EA',
                    WarehouseProcessType: '1010'
                },
                error: jest.fn()
            });

            const req = {
                data: {
                    Warehouse: '0001',
                    WarehouseTask: 'WT-10001'
                },
                error: jest.fn()
            };

            const success = await handlers['cancelWarehouseTask'](req);
            expect(success).toBe(true);

            const staged = WarehouseManagementHandler.getLocalStagedTasks()[0];
            expect(staged.WarehouseTaskStatus).toBe('X');
        });

        it('should confirm RF pick on a staged task and update HU and bin', async () => {
            jest.spyOn(EwmAdapter, 'createWarehouseTask').mockRejectedValueOnce(new Error('SAP offline'));
            await handlers['createWarehouseTask']({
                data: {
                    Warehouse: '0001',
                    Product: 'TG11',
                    Quantity: 5,
                    UnitOfMeasure: 'EA',
                    WarehouseProcessType: '1010'
                },
                error: jest.fn()
            });

            const req = {
                data: {
                    Warehouse: '0001',
                    WarehouseTask: 'WT-10001',
                    ConfirmedQuantity: 5,
                    DestinationHU: 'HU-999',
                    ScannedBin: '0020-01-01'
                },
                user: { id: 'RF_USER' },
                error: jest.fn()
            };

            const success = await handlers['confirmRfPick'](req);
            expect(success).toBe(true);

            const staged = WarehouseManagementHandler.getLocalStagedTasks()[0];
            expect(staged.WarehouseTaskStatus).toBe('C');
            expect(staged.ConfirmedQuantity).toBe(5);
            expect(staged.DestinationHandlingUnit).toBe('HU-999');
            expect(staged.TargetStorageBin).toBe('0020-01-01');
            expect(staged.ConfirmedByUser).toBe('RF_USER');
        });
    });

    describe('postGoodsReceipt & postGoodsIssue local staging fallback', () => {
        it('should track Goods Receipt locally and mark Inbound Delivery as Completed when SAP call throws', async () => {
            jest.spyOn(EwmAdapter, 'postGoodsReceipt').mockRejectedValueOnce(
                new Error('Value 100003 is not a valid String(4)')
            );
            jest.spyOn(EwmAdapter, 'getInboundDeliveries').mockResolvedValueOnce([
                {
                    Warehouse: 'W22',
                    DeliveryDocument: '180000125',
                    OverallGoodsReceiptStatus: 'A',
                    Items: [{ DeliveryDocumentItem: '10', GoodsReceiptStatus: 'A' }]
                }
            ]);

            const postReq = {
                data: {
                    Warehouse: '100003', // 6-digit vendor ID or warehouse
                    DeliveryDocument: '180000125'
                },
                error: jest.fn()
            };

            const result = await handlers['postGoodsReceipt'](postReq);
            expect(result).toBe(true);
            expect(postReq.error).not.toHaveBeenCalled();
            expect(WarehouseManagementHandler.getLocalGoodsReceipts()).toContain('180000125');

            // Verify READ InboundDeliveries reflects Completed status
            const readReq = {
                data: { Warehouse: 'W22' },
                query: { SELECT: { where: ['Warehouse', '=', 'W22'] } },
                error: jest.fn()
            };
            const list = await handlers['READ:InboundDeliveries'](readReq);
            expect(list).toHaveLength(1);
            expect(list[0].OverallGoodsReceiptStatus).toBe('C');
            expect(list[0].Items[0].GoodsReceiptStatus).toBe('C');
        });

        it('should reject postGoodsReceipt if DeliveryDocument is missing', async () => {
            const req = {
                data: { Warehouse: 'W22' },
                error: jest.fn((code, msg) => { throw new Error(msg); })
            };
            await expect(handlers['postGoodsReceipt'](req)).rejects.toThrow(/Warehouse and DeliveryDocument are required/);
        });

        it('should track Goods Issue locally and mark Outbound Delivery as Completed when SAP call throws', async () => {
            jest.spyOn(EwmAdapter, 'postGoodsIssue').mockRejectedValueOnce(
                new Error('SAP offline')
            );
            jest.spyOn(EwmAdapter, 'getOutboundDeliveries').mockResolvedValueOnce([
                {
                    Warehouse: 'W22',
                    OutboundDeliveryOrder: '80000456',
                    OverallGoodsIssueStatus: 'A',
                    OverallPickingStatus: 'A',
                    Items: [{ DeliveryDocumentItem: '10', PickingStatus: 'A' }]
                }
            ]);

            const postReq = {
                data: {
                    Warehouse: 'W22',
                    OutboundDeliveryOrder: '80000456'
                },
                error: jest.fn()
            };

            const result = await handlers['postGoodsIssue'](postReq);
            expect(result).toBe(true);
            expect(postReq.error).not.toHaveBeenCalled();
            expect(WarehouseManagementHandler.getLocalGoodsIssues()).toContain('80000456');

            // Verify READ OutboundDeliveries reflects Completed status
            const readReq = {
                data: { Warehouse: 'W22' },
                query: { SELECT: { where: ['Warehouse', '=', 'W22'] } },
                error: jest.fn()
            };
            const list = await handlers['READ:OutboundDeliveries'](readReq);
            expect(list).toHaveLength(1);
            expect(list[0].OverallGoodsIssueStatus).toBe('C');
            expect(list[0].OverallPickingStatus).toBe('C');
            expect(list[0].Items[0].PickingStatus).toBe('C');
        });
    });
});
