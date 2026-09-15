const WarehouseManagementHandler = require('../../../srv/ewm/warehouse-management/handlers/warehouseManagement.handler');
const EwmAdapter = require('../../../srv/integration/s4hana/ewm/EwmAdapter');

/**
 * SAP S/4HANA / EWM is the only system of record for the warehouse module. When SAP rejects a
 * request the handler returns that rejection; it never stages, simulates or completes anything
 * locally (AGENTS.md, ADR-0001).
 */
describe('WarehouseManagementHandler: no local substitutes for SAP transactions', () => {
    let handlers;

    const fakeService = () => {
        const registered = {};
        const srv = {
            on: jest.fn((event, entityOrHandler, handler) => {
                const key = typeof entityOrHandler === 'string' ? `${event}:${entityOrHandler}` : event;
                registered[key] = typeof entityOrHandler === 'function' ? entityOrHandler : handler;
            })
        };
        WarehouseManagementHandler.init(srv);
        return registered;
    };

    const request = (data, extra = {}) => ({
        data,
        error: jest.fn((code, msg) => ({ code, message: msg })),
        ...extra
    });

    const sapRejection = (message, status) => {
        const err = new Error(message);
        if (status) err.status = status;
        return err;
    };

    beforeEach(() => {
        handlers = fakeService();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('exposes no local staging state or helpers', () => {
        expect(WarehouseManagementHandler.resetLocalStaging).toBeUndefined();
        expect(WarehouseManagementHandler.getLocalStagedTasks).toBeUndefined();
        expect(WarehouseManagementHandler.getLocalGoodsReceipts).toBeUndefined();
        expect(WarehouseManagementHandler.getLocalGoodsIssues).toBeUndefined();
    });

    describe('createWarehouseTask', () => {
        const validData = { Warehouse: '0001', Product: 'TG11', Quantity: 10, UnitOfMeasure: 'EA', WarehouseProcessType: '1010' };

        it('returns the task SAP created, unchanged', async () => {
            jest.spyOn(EwmAdapter, 'createWarehouseTask').mockResolvedValueOnce({ Warehouse: '0001', WarehouseTask: '10005', WarehouseTaskStatus: 'O' });
            const req = request(validData);
            const result = await handlers['createWarehouseTask'](req);
            expect(result).toEqual({ Warehouse: '0001', WarehouseTask: '10005', WarehouseTaskStatus: 'O' });
            expect(result._isLocalStaging).toBeUndefined();
            expect(req.error).not.toHaveBeenCalled();
        });

        it('returns the SAP rejection with its status and invents no task when SAP refuses', async () => {
            jest.spyOn(EwmAdapter, 'createWarehouseTask').mockRejectedValueOnce(
                sapRejection('Warehouse Task creation failed — all SAP strategies exhausted; no task was created', 422)
            );
            const req = request(validData);
            const result = await handlers['createWarehouseTask'](req);

            expect(req.error).toHaveBeenCalledTimes(1);
            expect(req.error).toHaveBeenCalledWith(422, expect.stringContaining('no task was created'));
            expect(result).toEqual(req.error.mock.results[0].value);
            expect(result.WarehouseTask).toBeUndefined();
        });

        it('passes 400 client validation errors through', async () => {
            jest.spyOn(EwmAdapter, 'createWarehouseTask').mockRejectedValueOnce(sapRejection('Invalid parameter', 400));
            const req = request(validData);
            await handlers['createWarehouseTask'](req);
            expect(req.error).toHaveBeenCalledWith(400, 'Invalid parameter');
        });

        it('uses 500 when the rejection carries no status, and still creates nothing', async () => {
            jest.spyOn(EwmAdapter, 'createWarehouseTask').mockRejectedValueOnce(sapRejection('Warehouse process type not configured for warehouse W22 in /SCWM/T333'));
            const req = request({ ...validData, Warehouse: 'W22' });
            await handlers['createWarehouseTask'](req);
            expect(req.error).toHaveBeenCalledWith(500, expect.stringContaining('/SCWM/T333'));
        });

        it('requires WarehouseProcessType instead of guessing one', async () => {
            const spy = jest.spyOn(EwmAdapter, 'createWarehouseTask');
            const req = request({ ...validData, WarehouseProcessType: '' });
            await handlers['createWarehouseTask'](req);
            expect(req.error).toHaveBeenCalledWith(400, 'WarehouseProcessType is required');
            expect(spy).not.toHaveBeenCalled();
        });
    });

    describe('reads reflect SAP only', () => {
        it('READ WarehouseTasks returns exactly the SAP tasks, also after a rejected creation', async () => {
            jest.spyOn(EwmAdapter, 'createWarehouseTask').mockRejectedValueOnce(sapRejection('SAP offline', 422));
            await handlers['createWarehouseTask'](request({ Warehouse: '0001', Product: 'TG11', Quantity: 5, UnitOfMeasure: 'EA', WarehouseProcessType: '1010' }));

            jest.spyOn(EwmAdapter, 'getWarehouseTasks').mockResolvedValue([
                { Warehouse: '0001', WarehouseTask: 'SAP-1', WarehouseTaskStatus: 'O' }
            ]);
            const list = await handlers['READ:WarehouseTasks'](request({ Warehouse: '0001' }));
            expect(list).toEqual([{ Warehouse: '0001', WarehouseTask: 'SAP-1', WarehouseTaskStatus: 'O' }]);

            const byKey = await handlers['READ:WarehouseTasks'](request({ Warehouse: '0001' }, { params: [{ WarehouseTask: 'WT-10001' }] }));
            expect(byKey).toBeNull();
        });

        it('READ WarehouseProcessTypes returns exactly what SAP configures, including an empty list', async () => {
            jest.spyOn(EwmAdapter, 'getWarehouseProcessTypes').mockResolvedValueOnce([]);
            const empty = await handlers['READ:WarehouseProcessTypes'](request({ Warehouse: 'W22' }));
            expect(empty).toEqual([]);

            jest.spyOn(EwmAdapter, 'getWarehouseProcessTypes').mockResolvedValueOnce([
                { Warehouse: '0001', WarehouseProcessType: '1010', WarehouseProcessTypeName: 'Putaway' }
            ]);
            const configured = await handlers['READ:WarehouseProcessTypes'](request({ Warehouse: '0001' }));
            expect(configured).toEqual([{ Warehouse: '0001', WarehouseProcessType: '1010', WarehouseProcessTypeName: 'Putaway' }]);
            expect(JSON.stringify(configured)).not.toMatch(/Local Staging/);
        });

        it('READ WarehouseKPIs counts only SAP tasks', async () => {
            jest.spyOn(EwmAdapter, 'getWarehouseTasks').mockResolvedValueOnce([
                { Warehouse: '0001', WarehouseTask: 'SAP-1', WarehouseTaskStatus: 'C' },
                { Warehouse: '0001', WarehouseTask: 'SAP-2', WarehouseTaskStatus: 'O' }
            ]);
            jest.spyOn(EwmAdapter, 'getInboundDeliveries').mockResolvedValueOnce([]);
            jest.spyOn(EwmAdapter, 'getOutboundDeliveries').mockResolvedValueOnce([]);
            jest.spyOn(EwmAdapter, 'getStorageBins').mockResolvedValueOnce([]);
            jest.spyOn(EwmAdapter, 'getStorageTypes').mockResolvedValueOnce([]);

            const kpi = await handlers['READ:WarehouseKPIs'](request({ Warehouse: '0001' }));
            expect(kpi).toEqual([{ Warehouse: '0001', OpenTasksCount: 1, PendingInbound: 0, PendingOutbound: 0, TotalStorageBins: 0 }]);
        });

        it('READ InboundDeliveries and OutboundDeliveries keep the SAP statuses after a rejected posting', async () => {
            jest.spyOn(EwmAdapter, 'postGoodsReceipt').mockRejectedValueOnce(sapRejection('GR rejected', 422));
            jest.spyOn(EwmAdapter, 'postGoodsIssue').mockRejectedValueOnce(sapRejection('GI rejected', 422));
            await handlers['postGoodsReceipt'](request({ Warehouse: 'W22', DeliveryDocument: '180000125' }));
            await handlers['postGoodsIssue'](request({ Warehouse: 'W22', OutboundDeliveryOrder: '80000456' }));

            jest.spyOn(EwmAdapter, 'getInboundDeliveries').mockResolvedValueOnce([
                { Warehouse: 'W22', DeliveryDocument: '180000125', OverallGoodsReceiptStatus: 'A', Items: [{ DeliveryDocumentItem: '10', GoodsReceiptStatus: 'A' }] }
            ]);
            jest.spyOn(EwmAdapter, 'getOutboundDeliveries').mockResolvedValueOnce([
                { Warehouse: 'W22', OutboundDeliveryOrder: '80000456', OverallGoodsIssueStatus: 'A', OverallPickingStatus: 'A', Items: [{ DeliveryDocumentItem: '10', PickingStatus: 'A' }] }
            ]);
            const inbound = await handlers['READ:InboundDeliveries'](request({ Warehouse: 'W22' }));
            const outbound = await handlers['READ:OutboundDeliveries'](request({ Warehouse: 'W22' }));
            expect(inbound[0].OverallGoodsReceiptStatus).toBe('A');
            expect(inbound[0].Items[0].GoodsReceiptStatus).toBe('A');
            expect(outbound[0].OverallGoodsIssueStatus).toBe('A');
            expect(outbound[0].OverallPickingStatus).toBe('A');
            expect(outbound[0].Items[0].PickingStatus).toBe('A');
        });
    });

    describe('confirm, cancel and RF confirm always go to SAP', () => {
        it('confirmWarehouseTask calls SAP and propagates its rejection', async () => {
            const spy = jest.spyOn(EwmAdapter, 'confirmWarehouseTask').mockRejectedValueOnce(sapRejection('Task WT-10001 does not exist', 404));
            const req = request({ Warehouse: '0001', WarehouseTask: 'WT-10001', ConfirmedQuantity: 5 }, { user: { id: 'TEST_USER' } });
            await handlers['confirmWarehouseTask'](req);
            expect(spy).toHaveBeenCalledWith('0001', 'WT-10001', 5);
            expect(req.error).toHaveBeenCalledWith(404, 'Task WT-10001 does not exist');
        });

        it('cancelWarehouseTask calls SAP and propagates its rejection', async () => {
            const spy = jest.spyOn(EwmAdapter, 'cancelWarehouseTask').mockRejectedValueOnce(sapRejection('Task WT-10001 does not exist', 404));
            const req = request({ Warehouse: '0001', WarehouseTask: 'WT-10001' });
            await handlers['cancelWarehouseTask'](req);
            expect(spy).toHaveBeenCalledWith('0001', 'WT-10001');
            expect(req.error).toHaveBeenCalledWith(404, 'Task WT-10001 does not exist');
        });

        it('confirmRfPick calls SAP and propagates its rejection', async () => {
            const spy = jest.spyOn(EwmAdapter, 'confirmRfPickTask').mockRejectedValueOnce(sapRejection('Task WT-10001 does not exist', 404));
            const req = request({ Warehouse: '0001', WarehouseTask: 'WT-10001', ConfirmedQuantity: 5, DestinationHU: 'HU-999', ScannedBin: '0020-01-01' }, { user: { id: 'RF_USER' } });
            await handlers['confirmRfPick'](req);
            expect(spy).toHaveBeenCalledWith('0001', 'WT-10001', 5, 'HU-999', '0020-01-01');
            expect(req.error).toHaveBeenCalledWith(404, 'Task WT-10001 does not exist');
        });

        it('confirmWarehouseTask returns true only when SAP accepted', async () => {
            jest.spyOn(EwmAdapter, 'confirmWarehouseTask').mockResolvedValueOnce({ success: true });
            const req = request({ Warehouse: '0001', WarehouseTask: '10005', ConfirmedQuantity: 5 });
            await expect(handlers['confirmWarehouseTask'](req)).resolves.toBe(true);
            expect(req.error).not.toHaveBeenCalled();
        });
    });

    describe('postGoodsReceipt and postGoodsIssue', () => {
        it('return true only when SAP posted the document', async () => {
            const gr = jest.spyOn(EwmAdapter, 'postGoodsReceipt').mockResolvedValueOnce({ success: true });
            const gi = jest.spyOn(EwmAdapter, 'postGoodsIssue').mockResolvedValueOnce({ success: true });
            await expect(handlers['postGoodsReceipt'](request({ Warehouse: 'W22', DeliveryDocument: '180000125' }))).resolves.toBe(true);
            await expect(handlers['postGoodsIssue'](request({ Warehouse: 'W22', OutboundDeliveryOrder: '80000456' }))).resolves.toBe(true);
            expect(gr).toHaveBeenCalledWith('W22', '180000125');
            expect(gi).toHaveBeenCalledWith('W22', '80000456');
        });

        it('return the SAP rejection with its status and complete nothing locally', async () => {
            jest.spyOn(EwmAdapter, 'postGoodsReceipt').mockRejectedValueOnce(sapRejection('Value 100003 is not a valid String(4)', 400));
            jest.spyOn(EwmAdapter, 'postGoodsIssue').mockRejectedValueOnce(sapRejection('SAP offline'));

            const grReq = request({ Warehouse: 'W22', DeliveryDocument: '180000125' });
            const grResult = await handlers['postGoodsReceipt'](grReq);
            expect(grReq.error).toHaveBeenCalledWith(400, 'Value 100003 is not a valid String(4)');
            expect(grResult).not.toBe(true);

            const giReq = request({ Warehouse: 'W22', OutboundDeliveryOrder: '80000456' });
            const giResult = await handlers['postGoodsIssue'](giReq);
            expect(giReq.error).toHaveBeenCalledWith(500, 'SAP offline');
            expect(giResult).not.toBe(true);
        });

        it('require both the warehouse and the document, without defaulting a warehouse', async () => {
            const gr = jest.spyOn(EwmAdapter, 'postGoodsReceipt');
            const gi = jest.spyOn(EwmAdapter, 'postGoodsIssue');

            const noDoc = request({ Warehouse: 'W22' });
            await handlers['postGoodsReceipt'](noDoc);
            expect(noDoc.error).toHaveBeenCalledWith(400, 'Warehouse and DeliveryDocument are required');

            const noWhse = request({ DeliveryDocument: '180000125' });
            await handlers['postGoodsReceipt'](noWhse);
            expect(noWhse.error).toHaveBeenCalledWith(400, 'Warehouse and DeliveryDocument are required');

            const noOdo = request({ Warehouse: 'W22' });
            await handlers['postGoodsIssue'](noOdo);
            expect(noOdo.error).toHaveBeenCalledWith(400, 'Warehouse and OutboundDeliveryOrder are required');

            expect(gr).not.toHaveBeenCalled();
            expect(gi).not.toHaveBeenCalled();
        });
    });
});
