/**
 * Unit Tests for GoodsIssue261 Controller (Goods Issue for Order / Movement 261).
 *
 * Same harness as goodsIssue201Controller.test.js: stub sap.ui.define, mock UI5 base deps,
 * load the dependency-free GoodsIssue261Model for real (validation / payload / scan / reservation
 * mapping), and fully mock GoodsIssue261Service. Covers planned vs unplanned mode, order value help,
 * reservation resolution, and the honest QUEUED-vs-SUCCESS posting distinction.
 */

let GoodsIssue261Controller;
const RealModel = require('../../../app/fiori-app/webapp/modules/wm/goods-issue/model/GoodsIssue261Model');
const GoodsIssue261Model = RealModel;

const flush = () => new Promise((res) => setTimeout(res, 0));

const mockMessageBox = {
    error: jest.fn(),
    success: jest.fn(),
    warning: jest.fn(),
    information: jest.fn(),
    confirm: jest.fn(),
    Action: { OK: 'OK', CANCEL: 'CANCEL', CLOSE: 'CLOSE' }
};
const mockMessageToast = { show: jest.fn() };

class MockJSONModel {
    constructor(data) {
        this.data = JSON.parse(JSON.stringify(data || {}));
    }
    setData(data) {
        this.data = JSON.parse(JSON.stringify(data || {}));
    }
    getData() {
        return this.data;
    }
    refresh() { /* no-op for tests */ }
    getProperty(path) {
        const parts = path.replace(/^\//, '').split('/');
        let curr = this.data;
        for (const p of parts) {
            if (curr === undefined || curr === null) return undefined;
            curr = curr[p];
        }
        return curr;
    }
    setProperty(path, val) {
        const parts = path.replace(/^\//, '').split('/');
        let curr = this.data;
        for (let i = 0; i < parts.length - 1; i++) {
            const p = parts[i];
            if (!curr[p]) curr[p] = {};
            curr = curr[p];
        }
        curr[parts[parts.length - 1]] = val;
    }
}

const mockModel = Object.assign({}, RealModel, {
    createInitialModel: () => new MockJSONModel(RealModel.getInitialData())
});

const mockService = {
    fetchReservationItems: jest.fn().mockResolvedValue([]),
    fetchMaterialDetails: jest.fn().mockResolvedValue(null),
    fetchStockUnitsForItem: jest.fn().mockResolvedValue({ StockUnits: [] }),
    resolveScanUnit: jest.fn().mockResolvedValue({ SuExists: true }),
    fetchDistinctOrders: jest.fn().mockResolvedValue([]),
    fetchOpenReservations: jest.fn().mockResolvedValue([]),
    postGoodsIssue: jest.fn().mockResolvedValue({
        PostingStatus: 'POSTED',
        MaterialDocument: '4900000001',
        MaterialDocYear: '2025',
        Confirmed: true
    }),
    reverseGoodsIssue: jest.fn().mockResolvedValue({ ReversalMaterialDocument: '4900000002', ReversalMaterialDocYear: '2025' })
};

let lastSelectDialog = null;
function MockSelectDialog(config) {
    this.config = config;
    this._model = null;
    this.setModel = jest.fn((m) => { this._model = m; });
    this.bindAggregation = jest.fn();
    this.open = jest.fn();
    this.destroy = jest.fn();
    lastSelectDialog = this;
}
function MockStandardListItem(config) {
    this.config = config;
}

class MockFilter {
    constructor(path, operator, value) {
        if (typeof path === 'object') {
            this.filters = path.filters;
            this.and = path.and;
        } else {
            this.path = path;
            this.operator = operator;
            this.value = value;
        }
    }
}
const MockFilterOperator = { Contains: 'Contains' };

const mockRouter = {
    getRoute: jest.fn().mockReturnValue({ attachPatternMatched: jest.fn() }),
    navTo: jest.fn()
};

const mockBaseController = {
    extend: (name, proto) => {
        function Controller() {
            Object.assign(this, proto);
            this.models = {};
            this.getView = () => ({
                getId: () => 'mockViewId',
                getModel: (n) => this.models[n],
                setModel: (m, n) => { this.models[n] = m; },
                setBusy: jest.fn(),
                addDependent: jest.fn()
            });
            this.getModel = (n) => this.models[n] || null;
            this.setModel = (m, n) => { this.models[n] = m; };
            this.getRouter = () => mockRouter;
            this.getText = jest.fn((k) => k);
            this.byId = jest.fn();
        }
        return Controller;
    }
};

global.sap = {
    ui: {
        define: (deps, factory) => {
            GoodsIssue261Controller = factory(
                mockBaseController,
                MockJSONModel,
                mockMessageBox,
                mockMessageToast,
                MockSelectDialog,
                MockStandardListItem,
                MockFilter,
                MockFilterOperator,
                mockModel,
                mockService
            );
        }
    }
};

require('../../../app/fiori-app/webapp/modules/wm/goods-issue/controller/GoodsIssue261.controller');

describe('GoodsIssue261 Controller Unit Tests', () => {
    let controller;

    // Minimum set of fields that makes GoodsIssue261Model.validate() pass in PLANNED mode.
    function makeValidPlanned() {
        const m = controller._oModel;
        m.setProperty('/isUnplanned', false);
        m.setProperty('/reservationNo', '0000123456');
        m.setProperty('/reservationItem', '0001');
        m.setProperty('/material', '1000000045');
        m.setProperty('/plant', '1120');
        m.setProperty('/storageLocation', 'HS01');
        m.setProperty('/quantity', 5);
        m.setProperty('/unit', 'EA');
    }

    beforeEach(() => {
        jest.clearAllMocks();
        lastSelectDialog = null;
        mockService.fetchReservationItems.mockResolvedValue([]);
        mockService.fetchMaterialDetails.mockResolvedValue(null);
        mockService.fetchStockUnitsForItem.mockResolvedValue({ StockUnits: [] });
        mockService.resolveScanUnit.mockResolvedValue({ SuExists: true });
        mockService.fetchDistinctOrders.mockResolvedValue([]);
        mockService.fetchOpenReservations.mockResolvedValue([]);
        mockService.postGoodsIssue.mockResolvedValue({
            PostingStatus: 'POSTED',
            MaterialDocument: '4900000001',
            MaterialDocYear: '2025',
            Confirmed: true
        });
        mockService.reverseGoodsIssue.mockResolvedValue({ ReversalMaterialDocument: '4900000002', ReversalMaterialDocYear: '2025' });
        controller = new GoodsIssue261Controller();
        controller.onInit();
    });

    describe('Initialization', () => {
        it('should create the gi261 model and register the route pattern listener', () => {
            expect(controller._oModel).toBeDefined();
            expect(controller.getModel('gi261')).toBe(controller._oModel);
            expect(mockRouter.getRoute).toHaveBeenCalledWith('wmGoodsIssue261');
            expect(controller._oModel.getProperty('/movementType')).toBe('261');
            expect(controller._oModel.getProperty('/isUnplanned')).toBe(false);
        });
    });

    describe('Route matching & reset', () => {
        it('shows UNKNOWN and the SAP destination error without displaying staged quantity as zero', async () => {
            mockService.fetchStockUnitsForItem.mockResolvedValueOnce({
                StockUnits: [],
                StagingStatus: 'UNKNOWN',
                IsStagingRequired: true,
                IsFullyStaged: false,
                Message: 'Cannot verify staging: transfer destination not readable (DA 131).'
            });

            controller._detectScanMode('519366', '0001', 5);
            await flush();

            expect(controller._oModel.getProperty('/stagingStatus')).toBe('UNKNOWN');
            expect(controller._oModel.getProperty('/stagingStatusBadge')).toBe('gi261StagingUnknown');
            expect(controller._oModel.getProperty('/stagingStatusState')).toBe('Information');
            expect(controller._oModel.getProperty('/stagingWarning'))
                .toBe('Cannot verify staging: transfer destination not readable (DA 131).');
            expect(controller._oModel.getProperty('/stagedQty')).toBeNull();
            expect(controller._oModel.getProperty('/stagedQtyDisplay')).toBe('gi261StagingUnknown');
            expect(controller._oModel.getProperty('/canCompleteStaging')).toBe(false);
        });

        it('fails closed when the staging/SU read itself fails: UNKNOWN, posting blocked, specific message', async () => {
            mockService.fetchStockUnitsForItem.mockRejectedValueOnce(new Error('SAP read timeout'));

            controller._detectScanMode('519366', '0001', 5);
            await flush();

            expect(controller._oModel.getProperty('/stagingStatus')).toBe('UNKNOWN');
            expect(controller._oModel.getProperty('/isStagingRequired')).toBe(true);
            expect(controller._oModel.getProperty('/canCompleteStaging')).toBe(false);
            expect(controller._oModel.getProperty('/stagingWarning')).toBe('gi261StagingReadFailed');
            expect(controller._oModel.getProperty('/noSuDataGap')).toBe('');
            expect(controller._oModel.getProperty('/scanEnabled')).toBe(false);
        });

        it('ignores a stale staging/SU response after the user switched to another item', async () => {
            let resolveFirst;
            mockService.fetchStockUnitsForItem
                .mockImplementationOnce(() => new Promise((res) => { resolveFirst = res; }))
                .mockResolvedValueOnce({ StockUnits: [], Message: 'gap for item 0002' });

            controller._detectScanMode('519366', '0001', 5);
            controller._detectScanMode('519366', '0002', 7);
            await flush();
            // The first (stale) response arrives last with scannable units; it must be dropped.
            resolveFirst({ StockUnits: [{ StorageUnit: 'SU1', AvailableStock: 5, CurrentStock: 5 }] });
            await flush();

            expect(controller._oModel.getProperty('/scanEnabled')).toBe(false);
            expect(controller._oModel.getProperty('/noSuDataGap')).toBe('gap for item 0002');
        });

        it('proactively sets DELIVERY_CREATED and openDeliveries when OpenDeliveryCount > 0', async () => {
            mockService.fetchStockUnitsForItem.mockResolvedValueOnce({
                StockUnits: [{ StorageUnit: 'SU1', AvailableStock: 5, CurrentStock: 5 }],
                OpenDeliveryCount: 2,
                OpenDeliveries: ['0080000074', '0080000075'],
                LatestDeliveryNumber: '0080000075'
            });

            controller._detectScanMode('520615', '0001', 5);
            await flush();

            expect(controller._oModel.getProperty('/postingStatus')).toBe('DELIVERY_CREATED');
            expect(controller._oModel.getProperty('/deliveryNumber')).toBe('0080000075');
            expect(controller._oModel.getProperty('/openDeliveries')).toEqual(['0080000074', '0080000075']);
            expect(controller._oModel.getProperty('/openDeliveryCount')).toBe(2);
            expect(controller._oModel.getProperty('/hasOpenDelivery')).toBe(true);
        });

        it('_onRouteMatched without a resv query should reset and not prefill', () => {
            controller._onRouteMatched({ getParameter: () => ({}) });
            expect(mockService.fetchReservationItems).not.toHaveBeenCalled();
            expect(controller._oModel.getProperty('/fromReservation')).toBe(false);
        });

        it('_resetModel should restore initial data and clear the resolved-item cache', () => {
            controller._aResolvedItems = [{ ReservationItem: '0001' }];
            controller._oModel.setProperty('/material', 'X');
            controller._resetModel();
            expect(controller._aResolvedItems).toEqual([]);
            expect(controller._oModel.getProperty('/material')).toBe('');
        });
    });

    describe('Pending-reservation prefill', () => {
        it('should prefill from the open reservation item and pass the item plant to _loadMaterialInfo', async () => {
            mockService.fetchReservationItems.mockResolvedValueOnce([
                {
                    ReservationNo: '0000123456', ReservationItem: '0001', OrderNo: '600001',
                    Material: '1000000045', MaterialDesc: 'Test Mat', Plant: '3000',
                    StorageLocation: 'RM01', OpenQty: 4, Unit: 'KG', MovementType: '261'
                }
            ]);
            mockService.fetchMaterialDetails.mockResolvedValueOnce({ materialName: 'Test Mat', unit: 'KG', isBatchManaged: false });

            controller._onRouteMatched({ getParameter: () => ({ '?query': { resv: '0000123456' } }) });
            await flush();

            const m = controller._oModel;
            expect(m.getProperty('/fromReservation')).toBe(true);
            expect(m.getProperty('/material')).toBe('1000000045');
            expect(m.getProperty('/plant')).toBe('3000');
            expect(m.getProperty('/orderNo')).toBe('600001');
            expect(m.getProperty('/quantity')).toBe(4);
            expect(m.getProperty('/openQty')).toBe(4);
            // The reservation item's own plant and storage location must be passed to scope batches.
            expect(mockService.fetchMaterialDetails).toHaveBeenCalledWith('1000000045', '3000', 'RM01');
        });

        it('should reject an explicit item hint instead of substituting another eligible item', async () => {
            mockService.fetchReservationItems.mockResolvedValueOnce([
                {
                    ReservationNo: '123456', ReservationItem: '0002', Material: 'OTHER',
                    Plant: '3000', StorageLocation: 'RM01', OpenQty: 4, MovementType: '261'
                }
            ]);

            await controller._prefillFromReservation('0000123456', '0001');

            expect(mockMessageBox.error).toHaveBeenCalledWith('gi261PrefillNoOpenItem');
            expect(controller._oModel.getProperty('/reservationItem')).toBe('');
            expect(controller._oModel.getProperty('/material')).toBe('');
            expect(mockService.fetchMaterialDetails).not.toHaveBeenCalled();
        });

        it('should select only a matching open 261 row from SAP reservation results', async () => {
            mockService.fetchReservationItems.mockResolvedValueOnce([
                {
                    ReservationNo: '999999', ReservationItem: '0001', Material: 'UNRELATED',
                    Plant: '3000', StorageLocation: 'RM01', OpenQty: 5, MovementType: '261'
                },
                {
                    ReservationNo: '0000123456', ReservationItem: '0002', Material: '201-MATERIAL',
                    Plant: '3000', StorageLocation: 'RM01', OpenQty: 5, MovementType: '201'
                },
                {
                    ReservationNo: '0000123456', ReservationItem: '0003', Material: 'CLOSED',
                    Plant: '3000', StorageLocation: 'RM01', OpenQty: 0, MovementType: '261'
                },
                {
                    ReservationNo: '0000123456', ReservationItem: '0004', Material: '1000000045',
                    Plant: '3000', StorageLocation: 'RM01', OpenQty: 4, Unit: 'KG', MovementType: '261'
                }
            ]);

            await controller._prefillFromReservation('0000123456');

            expect(controller._oModel.getProperty('/reservationItem')).toBe('0004');
            expect(controller._oModel.getProperty('/material')).toBe('1000000045');
            expect(controller._oModel.getProperty('/quantity')).toBe(4);
        });

        it('should ask for a specific item when multiple open 261 items exist', async () => {
            mockService.fetchReservationItems.mockResolvedValueOnce([
                {
                    ReservationNo: '0000123456', ReservationItem: '0001', Material: 'MAT-1',
                    Plant: '3000', StorageLocation: 'RM01', OpenQty: 4, MovementType: '261'
                },
                {
                    ReservationNo: '0000123456', ReservationItem: '0002', Material: 'MAT-2',
                    Plant: '3000', StorageLocation: 'RM01', OpenQty: 8, MovementType: '261'
                }
            ]);

            await controller._prefillFromReservation('0000123456');

            expect(lastSelectDialog).toBeDefined();
            expect(controller._oModel.getProperty('/reservationItem')).toBe('');
            expect(controller._oModel.getProperty('/reservationNo')).toBe('0000123456');
            expect(controller._aResolvedItems).toHaveLength(2);
        });

        it('must not carry a previous item\'s unit or batch into the next selected item', async () => {
            controller._oModel.setProperty('/unit', 'KG');
            controller._oModel.setProperty('/batch', 'OLD-BATCH');

            controller._applyReservationPrefill({
                ReservationNo: '0000123456', ReservationItem: '0005', Material: 'MAT-NOUNIT',
                Plant: '3000', StorageLocation: 'RM01', OpenQty: 2, MovementType: '261'
            }, '0000123456');

            expect(controller._oModel.getProperty('/unit')).toBe('');
            expect(controller._oModel.getProperty('/batch')).toBe('');
        });

        it('should show MessageBox.error when reservation fetch fails', async () => {
            mockService.fetchReservationItems.mockRejectedValueOnce(new Error('Resv 999 missing in SAP'));
            controller._prefillFromReservation('999');
            await flush();
            expect(mockMessageBox.error).toHaveBeenCalledWith(expect.stringContaining('Resv 999 missing in SAP'));
        });
    });

    describe('_loadMaterialInfo plant preference', () => {
        it('should prefer the explicitly passed plant over the form plant', async () => {
            controller._oModel.setProperty('/plant', 'FORM');
            controller._loadMaterialInfo('1000000045', '9999');
            await flush();
            expect(mockService.fetchMaterialDetails).toHaveBeenCalledWith('1000000045', '9999');
        });

        it('should fall back to the form plant when no plant is passed', async () => {
            controller._oModel.setProperty('/plant', '1120');
            controller._loadMaterialInfo('1000000045');
            await flush();
            expect(mockService.fetchMaterialDetails).toHaveBeenCalledWith('1000000045', '1120');
        });

        it('should no-op for an empty material', async () => {
            controller._loadMaterialInfo('');
            await flush();
            expect(mockService.fetchMaterialDetails).not.toHaveBeenCalled();
        });
    });

    describe('Planned vs unplanned mode toggle', () => {
        it('onIssueModeChange to UNPLANNED should clear reservation fields and make unit editable', () => {
            controller._oModel.setProperty('/reservationNo', '0000123456');
            controller.onIssueModeChange({ getParameter: () => ({ getKey: () => 'UNPLANNED' }) });
            const m = controller._oModel;
            expect(m.getProperty('/isUnplanned')).toBe(true);
            expect(m.getProperty('/reservationNo')).toBe('');
            expect(m.getProperty('/isUnitEditable')).toBe(true);
        });

        it('onIssueModeChange to PLANNED should clear order/material and lock the unit', () => {
            controller._oModel.setProperty('/isUnplanned', true);
            controller._oModel.setProperty('/orderNo', '600001');
            controller._oModel.setProperty('/material', '1000000045');
            controller.onIssueModeChange({ getParameter: () => ({ getKey: () => 'PLANNED' }) });
            const m = controller._oModel;
            expect(m.getProperty('/isUnplanned')).toBe(false);
            expect(m.getProperty('/orderNo')).toBe('');
            expect(m.getProperty('/material')).toBe('');
            expect(m.getProperty('/isUnitEditable')).toBe(false);
        });

        it('validate should require Reservation No/Item in planned mode and Order No in unplanned mode', () => {
            const planned = mockModel.validate({ isUnplanned: false, material: '', plant: '', storageLocation: '', quantity: 1, unit: 'EA', postingDate: '2025-01-01', documentDate: '2025-01-01' });
            expect(planned.errors.reservationNo).toContain('required');
            const unplanned = mockModel.validate({ isUnplanned: true, material: '', plant: '', storageLocation: '', quantity: 1, unit: 'EA', postingDate: '2025-01-01', documentDate: '2025-01-01' });
            expect(unplanned.errors.orderNo).toContain('required');
        });
    });

    describe('Order value help', () => {
        it('onOrderValueHelp should populate the dialog from fetched orders and open it', async () => {
            mockService.fetchDistinctOrders.mockResolvedValueOnce([{ OrderNo: '600001', Description: 'Prod Order', Plant: '1120' }]);
            controller.onOrderValueHelp();
            await flush();
            expect(lastSelectDialog._model.getData()).toEqual([{ OrderNo: '600001', Description: 'Prod Order', Plant: '1120' }]);
            expect(lastSelectDialog.bindAggregation).toHaveBeenCalledWith('items', '/', expect.anything());
            expect(lastSelectDialog.open).toHaveBeenCalled();
        });

        it('onOrderValueHelp should MessageBox.error (not fabricate) when the Service fails', async () => {
            mockService.fetchDistinctOrders.mockRejectedValueOnce(new Error('Order service down'));
            controller.onOrderValueHelp();
            await flush();
            expect(mockMessageBox.error).toHaveBeenCalledWith('gi261LoadOrdersError');
        });
    });

    describe('Reservation value help & item resolution', () => {
        it('onReservationValueHelp should populate the dialog from fetched open reservations', async () => {
            mockService.fetchOpenReservations.mockResolvedValueOnce([{ ReservationNo: '0000123456', DisplayText: 'Resv 1', OrderNo: '600001' }]);
            controller.onReservationValueHelp();
            await flush();
            expect(lastSelectDialog._model.getData()).toEqual([{ ReservationNo: '0000123456', DisplayText: 'Resv 1', OrderNo: '600001' }]);
            expect(lastSelectDialog.open).toHaveBeenCalled();
        });

        it('onReservationValueHelp should MessageBox.error when open reservations cannot be loaded', async () => {
            mockService.fetchOpenReservations.mockRejectedValueOnce(new Error('Reservation list unavailable'));
            controller.onReservationValueHelp();
            await flush();
            expect(mockMessageBox.error).toHaveBeenCalledWith('giLoadReservationsError');
        });

        it('_loadReservationItems should auto-apply the single item onto the model', async () => {
            mockService.fetchReservationItems.mockResolvedValueOnce([
                { ReservationNo: '0000123456', ReservationItem: '1', Material: '1000000045', MaterialDesc: 'Mat', Plant: '1120', StorageLocation: 'HS01', Unit: 'EA', OrderNo: '600001', OpenQty: 3, MovementType: '261' }
            ]);
            await controller._loadReservationItems('0000123456');
            const m = controller._oModel;
            expect(controller._aResolvedItems).toHaveLength(1);
            expect(m.getProperty('/material')).toBe('1000000045');
            expect(m.getProperty('/plant')).toBe('1120');
            expect(m.getProperty('/reservationItem')).toBe('0001'); // padded to 4
            expect(m.getProperty('/openQty')).toBe(3);
        });

        it('_loadReservationItems should open the item picker when several items are returned', async () => {
            mockService.fetchReservationItems.mockResolvedValueOnce([
                { ReservationNo: '0000123456', ReservationItem: '1', Material: 'A', OpenQty: 1, MovementType: '261' },
                { ReservationNo: '0000123456', ReservationItem: '2', Material: 'B', OpenQty: 1, MovementType: '261' }
            ]);
            await controller._loadReservationItems('0000123456');
            expect(lastSelectDialog).not.toBeNull();
            expect(lastSelectDialog.open).toHaveBeenCalled();
        });

        it('_loadReservationItems should toast when no items are found', async () => {
            mockService.fetchReservationItems.mockResolvedValueOnce([]);
            await controller._loadReservationItems('0000123456');
            expect(mockMessageToast.show).toHaveBeenCalled();
        });

        it('onReservationItemChange should apply a cached item by padded number', () => {
            controller._aResolvedItems = [
                { ReservationItem: '2', Material: '1000000045', Plant: '1120', StorageLocation: 'HS01', Unit: 'EA', OpenQty: 9 }
            ];
            controller._oModel.setProperty('/reservationNo', '0000123456');
            controller.onReservationItemChange({ getParameter: () => '2' });
            expect(controller._oModel.getProperty('/material')).toBe('1000000045');
            expect(controller._oModel.getProperty('/reservationItem')).toBe('0002');
        });
    });

    describe('Material value help & live change', () => {
        it('onMaterialLiveChange should load details once the material is long enough', async () => {
            mockService.fetchMaterialDetails.mockResolvedValueOnce({ materialName: 'Mat', unit: 'EA', isBatchManaged: false });
            controller.onMaterialLiveChange({ getParameter: () => '10000000' });
            await flush();
            expect(controller._oModel.getProperty('/material')).toBe('10000000');
            expect(mockService.fetchMaterialDetails).toHaveBeenCalled();
        });

        it('onMaterialLiveChange should not load details for a short material string', () => {
            controller.onMaterialLiveChange({ getParameter: () => '123' });
            expect(mockService.fetchMaterialDetails).not.toHaveBeenCalled();
        });

        it('onMaterialValueHelp should fetch a material into the dialog when no OData model is bound', async () => {
            controller._oModel.setProperty('/material', '1000000045');
            mockService.fetchMaterialDetails.mockResolvedValueOnce({ Material: '1000000045', MaterialName: 'X' });
            controller.onMaterialValueHelp();
            await flush();
            expect(mockService.fetchMaterialDetails).toHaveBeenCalledWith('1000000045', expect.any(String));
            expect(lastSelectDialog.open).toHaveBeenCalled();
        });

        it('loads selectable material batches and assigns the chosen batch from value help', async () => {
            const batches = [
                { Batch: 'IN25003090', IsSelectable: true, StatusText: 'VALID', ExpiryDate: '2026-11-05' },
                { Batch: 'BLOCKED', IsSelectable: false, StatusText: 'BLOCKED' }
            ];
            controller._oModel.setProperty('/material', '1000000264');
            controller._oModel.setProperty('/plant', '1110');
            mockService.fetchMaterialDetails.mockResolvedValueOnce({
                isBatchManaged: true, batches
            });

            await controller._loadMaterialInfo('1000000264', '1110');
            expect(controller._oModel.getProperty('/availableBatches')).toEqual([batches[0]]);

            controller.onBatchValueHelp();
            expect(lastSelectDialog.open).toHaveBeenCalled();
            lastSelectDialog.config.confirm({
                getParameter: () => ({ getTitle: () => 'IN25003090' })
            });
            expect(controller._oModel.getProperty('/batch')).toBe('IN25003090');
        });
    });

    describe('Quantity live change with scan-to-complete', () => {
        it('re-targets the scan requirement to the entered quantity', () => {
            controller._oModel.setProperty('/scanEnabled', true);
            controller._oModel.setProperty('/requiredScanCount', 10);
            controller._oModel.setProperty('/availableUnits', [
                { StorageUnit: 'SU1', AvailableStock: 3, CurrentStock: 3 },
                { StorageUnit: 'SU2', AvailableStock: 3, CurrentStock: 3 }
            ]);

            controller.onQuantityLiveChange({ getParameter: () => '4' });

            expect(controller._oModel.getProperty('/quantity')).toBe(4);
            expect(controller._oModel.getProperty('/requiredScanCount')).toBe(4);
        });

        it('leaves the scan requirement alone outside scan mode and for invalid input', () => {
            controller._oModel.setProperty('/scanEnabled', false);
            controller._oModel.setProperty('/requiredScanCount', 10);
            controller.onQuantityLiveChange({ getParameter: () => '4' });
            expect(controller._oModel.getProperty('/requiredScanCount')).toBe(10);

            controller._oModel.setProperty('/scanEnabled', true);
            controller.onQuantityLiveChange({ getParameter: () => 'abc' });
            expect(controller._oModel.getProperty('/requiredScanCount')).toBe(10);
        });
    });

    describe('Serial number add / delete', () => {
        beforeEach(() => {
            controller._oModel.setProperty('/quantity', 3);
        });

        it('onAddSerialPress should add a valid serial and toast', () => {
            controller._oModel.setProperty('/serialInput', 'sn-9');
            controller.onAddSerialPress();
            expect(controller._oModel.getProperty('/serialNumbers')).toEqual(['SN-9']);
            expect(mockMessageToast.show).toHaveBeenCalled();
        });

        it('onAddSerialPress should reject an empty serial and add nothing', () => {
            controller._oModel.setProperty('/serialInput', '');
            controller.onAddSerialPress();
            expect(controller._oModel.getProperty('/serialNumbers')).toEqual([]);
            expect(mockMessageToast.show).toHaveBeenCalledWith('Serial number cannot be empty');
        });

        it('onDeleteSerial should remove the bound serial', () => {
            controller._oModel.setProperty('/serialNumbers', ['SN-1', 'SN-2']);
            const oEvent = { getSource: () => ({ getBindingContext: () => ({ getPath: () => '/serialNumbers/1' }) }) };
            controller.onDeleteSerial(oEvent);
            expect(controller._oModel.getProperty('/serialNumbers')).toEqual(['SN-1']);
        });
    });

    describe('Scan-to-complete', () => {
        beforeEach(() => {
            const m = controller._oModel;
            m.setProperty('/material', '1000000045');
            m.setProperty('/requiredScanCount', 1);
            m.setProperty('/scannedUnits', []);
            m.setProperty('/reservationNo', '0000123456');
            m.setProperty('/reservationItem', '0001');
            m.setProperty('/scanEnabled', true);
        });

        it('onScanUnit should append a matched unit and show Success feedback', async () => {
            mockService.resolveScanUnit.mockResolvedValueOnce({ SuExists: true, Material: '1000000045', DeterminedSerial: 'S1', IsSerialManaged: true });
            controller._oModel.setProperty('/scanInput', 'SU1');
            controller.onScanUnit();
            await flush();
            expect(mockService.resolveScanUnit).toHaveBeenCalledWith('SU1', '0000123456', '0001');
            expect(controller._oModel.getProperty('/scannedUnits')).toHaveLength(1);
            expect(controller._oModel.getProperty('/lastScanState')).toBe('Success');
        });

        it('onScanUnit should surface a hard SAP error (Error feedback), not a fake fill', async () => {
            mockService.resolveScanUnit.mockRejectedValueOnce(new Error('Unit not in stock'));
            controller._oModel.setProperty('/scanInput', 'BAD');
            controller.onScanUnit();
            await flush();
            expect(controller._oModel.getProperty('/scannedUnits')).toHaveLength(0);
            expect(controller._oModel.getProperty('/lastScanState')).toBe('Error');
            expect(controller._oModel.getProperty('/lastScanText')).toContain('Unit not in stock');
        });

        it('onDeleteScannedUnit should remove the scanned unit at the bound index', () => {
            controller._oModel.setProperty('/scannedUnits', [{ key: 'A' }, { key: 'B' }]);
            const oEvent = { getParameter: () => ({ getBindingContext: () => ({ getPath: () => '/scannedUnits/0' }) }) };
            controller.onDeleteScannedUnit(oEvent);
            expect(controller._oModel.getProperty('/scannedUnits')).toEqual([{ key: 'B' }]);
        });
    });

    describe('onPostGoodsIssue', () => {
        it('should block posting and MessageBox.error when the form is invalid', () => {
            controller.onPostGoodsIssue();
            expect(mockMessageBox.error).toHaveBeenCalled();
            expect(mockService.postGoodsIssue).not.toHaveBeenCalled();
        });

        it('blocks posting and shows clear error when material is missing', async () => {
            makeValidPlanned();
            controller._oModel.setProperty('/material', '');
            controller.onPostGoodsIssue();
            await flush();
            expect(mockMessageBox.error).toHaveBeenCalledWith('gi261MaterialRequired');
            expect(mockService.postGoodsIssue).not.toHaveBeenCalled();
            expect(controller._oModel.getProperty('/busy')).toBe(false);
        });

        it('blocks posting and shows clear error when plant is missing', async () => {
            makeValidPlanned();
            controller._oModel.setProperty('/plant', '');
            controller.onPostGoodsIssue();
            await flush();
            expect(mockMessageBox.error).toHaveBeenCalledWith('gi261PlantRequired');
            expect(mockService.postGoodsIssue).not.toHaveBeenCalled();
            expect(controller._oModel.getProperty('/busy')).toBe(false);
        });

        it('should post and show MessageBox.success with the SAP material document', async () => {
            makeValidPlanned();
            mockService.postGoodsIssue.mockResolvedValueOnce({
                PostingStatus: 'POSTED',
                MaterialDocument: '4900004321',
                MaterialDocYear: '2025',
                Confirmed: true
            });
            controller.onPostGoodsIssue();
            await flush();
            expect(mockService.postGoodsIssue).toHaveBeenCalledWith(expect.objectContaining({
                MovementType: '261', ReservationNo: '0000123456', Material: '1000000045', Plant: '1120', StorageLocation: 'HS01'
            }));
            expect(controller._oModel.getProperty('/hasPosted')).toBe(true);
            expect(controller._oModel.getProperty('/postedDocument')).toBe('4900004321');
            expect(mockMessageBox.success).toHaveBeenCalled();
            expect(mockMessageBox.warning).not.toHaveBeenCalled();
        });

        it('should ignore a second Post invocation while the first request is in flight', async () => {
            makeValidPlanned();
            let resolvePost;
            mockService.postGoodsIssue.mockReturnValueOnce(new Promise((resolve) => {
                resolvePost = resolve;
            }));

            controller.onPostGoodsIssue();
            expect(controller._oModel.getProperty('/busy')).toBe(true);
            controller.onPostGoodsIssue();
            expect(mockService.postGoodsIssue).toHaveBeenCalledTimes(1);

            resolvePost({
                PostingStatus: 'POSTED',
                MaterialDocument: '4900004324',
                MaterialDocYear: '2026',
                Confirmed: true
            });
            await flush();
            expect(controller._oModel.getProperty('/busy')).toBe(false);
            expect(controller._oModel.getProperty('/postingStatus')).toBe('POSTED');
        });

        it('should allow another Post only after a definitive FAILED response', async () => {
            makeValidPlanned();
            mockService.postGoodsIssue
                .mockResolvedValueOnce({ PostingStatus: 'FAILED', Success: false, Message: 'SAP rejected the request.' })
                .mockResolvedValueOnce({
                    PostingStatus: 'POSTED',
                    Success: true,
                    Confirmed: true,
                    MaterialDocument: '4900004325',
                    MaterialDocYear: '2026'
                });

            controller.onPostGoodsIssue();
            await flush();
            expect(controller._oModel.getProperty('/postingStatus')).toBe('FAILED');
            expect(controller._oModel.getProperty('/busy')).toBe(false);

            controller.onPostGoodsIssue();
            await flush();
            expect(mockService.postGoodsIssue).toHaveBeenCalledTimes(2);
            expect(controller._oModel.getProperty('/postingStatus')).toBe('POSTED');
        });

        it.each(['POSTED', 'QUEUED', 'UNKNOWN', 'DELIVERY_CREATED'])('should guard controller re-entry after %s', async (postingStatus) => {
            makeValidPlanned();
            mockService.postGoodsIssue.mockResolvedValueOnce({
                PostingStatus: postingStatus,
                ConfirmationStatus: postingStatus,
                Success: postingStatus === 'POSTED',
                Confirmed: postingStatus === 'POSTED',
                MaterialDocument: postingStatus === 'POSTED' ? '4900004326' : '',
                DeliveryNumber: postingStatus === 'DELIVERY_CREATED' ? '0080000078' : ''
            });

            controller.onPostGoodsIssue();
            await flush();
            controller.onPostGoodsIssue();
            expect(mockService.postGoodsIssue).toHaveBeenCalledTimes(1);
        });

        it('should handle DELIVERY_CREATED outcome, display information message, and set deliveryNumber', async () => {
            makeValidPlanned();
            mockService.postGoodsIssue.mockResolvedValueOnce({
                PostingStatus: 'DELIVERY_CREATED',
                ConfirmationStatus: 'DELIVERY_CREATED',
                DeliveryNumber: '0080000078',
                ReservationNo: '0000123456',
                ReservationItem: '0001',
                Message: 'SAP created outbound delivery 0080000078 for this request instead of a material document. Stock is issued only when goods issue is posted for that delivery in SAP. Do not post again.'
            });
            controller.onPostGoodsIssue();
            await flush();

            expect(controller._oModel.getProperty('/postingStatus')).toBe('DELIVERY_CREATED');
            expect(controller._oModel.getProperty('/deliveryNumber')).toBe('0080000078');
            expect(controller._oModel.getProperty('/hasPosted')).toBe(false);
            expect(controller._oModel.getProperty('/postedDocument')).toBe('');
            expect(mockMessageBox.information).toHaveBeenCalledWith(
                expect.stringContaining('0080000078'),
                expect.objectContaining({ title: 'gi261DeliveryCreatedTitle' })
            );
            expect(mockMessageBox.error).not.toHaveBeenCalled();
            expect(mockMessageBox.success).not.toHaveBeenCalled();
        });

        it('should resolve DELIVERY_CREATED from ConfirmationStatus when PostingStatus is missing', async () => {
            makeValidPlanned();
            mockService.postGoodsIssue.mockResolvedValueOnce({
                ConfirmationStatus: 'DELIVERY_CREATED',
                DeliveryNumber: '0080000079',
                Success: false,
                Confirmed: false
            });
            controller.onPostGoodsIssue();
            await flush();

            expect(controller._oModel.getProperty('/postingStatus')).toBe('DELIVERY_CREATED');
            expect(controller._oModel.getProperty('/deliveryNumber')).toBe('0080000079');
            expect(mockMessageBox.information).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ title: 'gi261DeliveryCreatedTitle' })
            );
        });

        it('should route back to Pending list with delivery query param on DELIVERY_CREATED when fromReservation', async () => {
            makeValidPlanned();
            controller._oModel.setProperty('/fromReservation', true);
            mockMessageBox.information.mockImplementationOnce((msg, opts) => {
                if (opts && typeof opts.onClose === 'function') {
                    opts.onClose();
                }
            });
            mockService.postGoodsIssue.mockResolvedValueOnce({
                PostingStatus: 'DELIVERY_CREATED',
                ConfirmationStatus: 'DELIVERY_CREATED',
                DeliveryNumber: '0080000080',
                ReservationNo: '0000123456',
                ReservationItem: '0001'
            });
            controller.onPostGoodsIssue();
            await flush();

            expect(mockRouter.navTo).toHaveBeenCalledWith('wmGoodsIssue261Pending', {
                '?query': expect.objectContaining({
                    resv: '0000123456',
                    item: '0001',
                    delivery: '0080000080'
                })
            });
        });

        // Queue tests removed — dispatch queue eliminated; direct posting only.
        // The controller now shows MessageBox.error (not warning) when no MaterialDocument is returned.

        it('should treat an empty MaterialDocument result as an error, NOT a success', async () => {
            makeValidPlanned();
            mockService.postGoodsIssue.mockResolvedValueOnce({});
            controller.onPostGoodsIssue();
            await flush();
            expect(mockMessageBox.error).toHaveBeenCalled();
            expect(mockMessageBox.success).not.toHaveBeenCalled();
            expect(controller._oModel.getProperty('/hasPosted')).toBe(false);
        });

        it('should display QUEUED independently of Success and never treat it as posted', async () => {
            makeValidPlanned();
            mockService.postGoodsIssue.mockResolvedValueOnce({
                PostingStatus: 'QUEUED',
                Success: true,
                MaterialDocument: '',
                Message: 'Safely queued; no SAP document exists yet.'
            });
            controller.onPostGoodsIssue();
            await flush();

            expect(controller._oModel.getProperty('/postingStatus')).toBe('QUEUED');
            expect(controller._oModel.getProperty('/hasPosted')).toBe(false);
            expect(mockMessageBox.information).toHaveBeenCalledWith(
                'Safely queued; no SAP document exists yet.',
                { title: 'gi261QueuedTitle' }
            );
            expect(mockMessageBox.success).not.toHaveBeenCalled();
        });

        it('should display UNKNOWN for a returned but unconfirmed document without enabling reversal', async () => {
            makeValidPlanned();
            mockService.postGoodsIssue.mockResolvedValueOnce({
                PostingStatus: 'UNKNOWN',
                Success: true,
                Confirmed: false,
                MaterialDocument: '4900004322',
                Message: 'Read-back confirmation is pending; do not post again.'
            });
            controller.onPostGoodsIssue();
            await flush();

            expect(controller._oModel.getProperty('/postingStatus')).toBe('UNKNOWN');
            expect(controller._oModel.getProperty('/postingAttemptDocument')).toBe('4900004322');
            expect(controller._oModel.getProperty('/postedDocument')).toBe('');
            expect(controller._oModel.getProperty('/hasPosted')).toBe(false);
            expect(mockMessageBox.warning).toHaveBeenCalledWith(
                expect.stringContaining('do not post again'),
                { title: 'gi261UnknownTitle' }
            );
            expect(mockMessageBox.success).not.toHaveBeenCalled();
        });

        it('should not infer POSTED from Success or a document number without confirmation', async () => {
            makeValidPlanned();
            mockService.postGoodsIssue.mockResolvedValueOnce({
                Success: true,
                MaterialDocument: '4900004323'
            });
            controller.onPostGoodsIssue();
            await flush();

            expect(controller._oModel.getProperty('/postingStatus')).toBe('UNKNOWN');
            expect(controller._oModel.getProperty('/hasPosted')).toBe(false);
            expect(mockMessageBox.warning).toHaveBeenCalled();
            expect(mockMessageBox.success).not.toHaveBeenCalled();
        });

        it('should display FAILED when the response explicitly reports a definitive failure', async () => {
            makeValidPlanned();
            mockService.postGoodsIssue.mockResolvedValueOnce({
                PostingStatus: 'FAILED',
                Success: false,
                Message: 'SAP definitively rejected the posting.'
            });
            controller.onPostGoodsIssue();
            await flush();

            expect(controller._oModel.getProperty('/postingStatus')).toBe('FAILED');
            expect(mockMessageBox.error).toHaveBeenCalledWith(
                'SAP definitively rejected the posting.',
                { title: 'gi261PostFailedTitle' }
            );
            expect(mockMessageBox.success).not.toHaveBeenCalled();
        });

        it('should display UNKNOWN when the CAP error uses the stable unknown-outcome code', async () => {
            makeValidPlanned();
            mockService.postGoodsIssue.mockRejectedValueOnce({
                message: 'The SAP outcome cannot currently be verified.',
                response: { data: { error: { code: 'GI_POSTING_UNKNOWN', message: 'The SAP outcome cannot currently be verified.' } } }
            });
            controller.onPostGoodsIssue();
            await flush();

            expect(controller._oModel.getProperty('/postingStatus')).toBe('UNKNOWN');
            expect(mockMessageBox.warning).toHaveBeenCalledWith(
                expect.stringContaining('cannot currently be verified'),
                { title: 'gi261UnknownTitle' }
            );
            expect(mockMessageBox.error).not.toHaveBeenCalled();
        });

        it('should show MessageBox.error with the SAP message when posting is rejected', async () => {
            makeValidPlanned();
            mockService.postGoodsIssue.mockRejectedValueOnce(new Error('Deficit of stock for material 1000000045'));
            controller.onPostGoodsIssue();
            await flush();
            expect(mockMessageBox.error).toHaveBeenCalledWith(
                expect.stringContaining('Deficit of stock'),
                expect.any(Object)
            );
        });

        it('should show MessageBox.error when backend posting was never reached', async () => {
            makeValidPlanned();
            mockService.postGoodsIssue.mockRejectedValueOnce(new Error('SAP S/4HANA service unreachable or posting capability unavailable (HTTP 503). The posting was not made and can be tried again.'));
            controller.onPostGoodsIssue();
            await flush();
            expect(mockMessageBox.error).toHaveBeenCalledWith(
                expect.stringContaining('unreachable or posting capability unavailable'),
                expect.any(Object)
            );
        });

        it('should show MessageBox.error pointing to SU53 on plain 403 authorization failure', async () => {
            makeValidPlanned();
            mockService.postGoodsIssue.mockRejectedValueOnce(new Error('Authorization failed for SAP Goods Issue posting. Please check your SAP authorizations in transaction SU53.'));
            controller.onPostGoodsIssue();
            await flush();
            expect(mockMessageBox.error).toHaveBeenCalledWith(
                expect.stringContaining('SU53'),
                expect.any(Object)
            );
        });

        it('should show MessageBox.warning on unknown outcome and tell the user not to post again', async () => {
            makeValidPlanned();
            mockService.postGoodsIssue.mockRejectedValueOnce(new Error('Posting outcome unconfirmed in SAP S/4HANA (timeout). The goods issue may have been posted in SAP. Please do not post again.'));
            controller.onPostGoodsIssue();
            await flush();
            expect(controller._oModel.getProperty('/postingStatus')).toBe('UNKNOWN');
            expect(mockMessageBox.warning).toHaveBeenCalledWith(
                expect.stringMatching(/may (have been posted|or may not have been posted).+do not post again/i),
                expect.any(Object)
            );
            expect(mockMessageBox.error).not.toHaveBeenCalled();
        });

        it('should post an UNPLANNED order-based issue when in unplanned mode', async () => {
            const m = controller._oModel;
            m.setProperty('/isUnplanned', true);
            m.setProperty('/orderNo', '600001');
            m.setProperty('/material', '1000000045');
            m.setProperty('/plant', '1120');
            m.setProperty('/storageLocation', 'HS01');
            m.setProperty('/quantity', 2);
            m.setProperty('/unit', 'EA');
            mockService.postGoodsIssue.mockResolvedValueOnce({
                PostingStatus: 'POSTED',
                MaterialDocument: '4900007777',
                MaterialDocYear: '2025',
                Confirmed: true
            });
            controller.onPostGoodsIssue();
            await flush();
            expect(mockService.postGoodsIssue).toHaveBeenCalledWith(expect.objectContaining({
                MovementType: '261', ReservationNo: '', OrderNo: '600001', Material: '1000000045'
            }));
            expect(mockMessageBox.success).toHaveBeenCalled();
        });

        it('should route back to the Pending list with the SAP document when completing a reservation', async () => {
            makeValidPlanned();
            controller._oModel.setProperty('/fromReservation', true);
            mockService.postGoodsIssue.mockResolvedValueOnce({
                PostingStatus: 'POSTED',
                MaterialDocument: '4900008888',
                MaterialDocYear: '2025',
                Confirmed: true
            });
            controller.onPostGoodsIssue();
            await flush();
            expect(mockRouter.navTo).toHaveBeenCalledWith('wmGoodsIssue261Pending', {
                '?query': expect.objectContaining({ resv: '0000123456', item: '0001', doc: '4900008888' })
            });
            expect(mockMessageBox.success).not.toHaveBeenCalled();
        });
    });

    describe('Reversal', () => {
        it('onReverseGoodsIssue should toast when there is no posted document', () => {
            controller._oModel.setProperty('/postedDocument', '');
            controller.onReverseGoodsIssue();
            expect(mockMessageToast.show).toHaveBeenCalled();
            expect(mockMessageBox.confirm).not.toHaveBeenCalled();
        });

        it('onReverseGoodsIssue should confirm then reverse via the Service and show success', async () => {
            controller._oModel.setProperty('/postedDocument', '4900004321');
            controller._oModel.setProperty('/postedYear', '2025');
            const sPostingDate = controller._oModel.getProperty('/postingDate');
            mockMessageBox.confirm.mockImplementationOnce((msg, opts) => opts.onClose('OK'));
            mockService.reverseGoodsIssue.mockResolvedValueOnce({ ReversalMaterialDocument: '4900005678', ReversalMaterialDocYear: '2025' });
            controller.onReverseGoodsIssue();
            await flush();
            expect(mockMessageBox.confirm).toHaveBeenCalled();
            expect(mockService.reverseGoodsIssue).toHaveBeenCalledWith('4900004321', '2025', sPostingDate, '01');
            expect(controller._oModel.getProperty('/hasReversed')).toBe(true);
            expect(mockMessageBox.success).toHaveBeenCalled();
        });

        it('_executeReversal should show MessageBox.error when the reversal is rejected', async () => {
            mockService.reverseGoodsIssue.mockRejectedValueOnce(new Error('Document already reversed'));
            controller._executeReversal('4900004321', '2025', undefined);
            await flush();
            expect(mockMessageBox.error).toHaveBeenCalledWith(
                expect.stringContaining('Document already reversed'),
                expect.any(Object)
            );
        });
    });

    describe('Formatters', () => {
        it('formatDeliveryCreatedBanner should return empty string if delivery is empty', () => {
            expect(controller.formatDeliveryCreatedBanner('')).toBe('');
            expect(controller.formatDeliveryCreatedBanner(null)).toBe('');
            expect(controller.formatDeliveryCreatedBanner(undefined)).toBe('');
        });

        it('formatDeliveryCreatedBanner should return localized text with delivery number', () => {
            const sText = controller.formatDeliveryCreatedBanner('0080000078');
            expect(sText).toBe('gi261DeliveryCreatedBannerText');
        });

        it('formatDeliveryCreatedBanner should return multiple deliveries banner when openDeliveryCount > 1', () => {
            const sText = controller.formatDeliveryCreatedBanner('0080000080', 2, ['0080000074', '0080000080']);
            expect(sText).toBe('gi261MultipleDeliveriesCreatedBannerText');
            expect(controller.getText).toHaveBeenCalledWith('gi261MultipleDeliveriesCreatedBannerText', [2, '0080000074, 0080000080']);
        });

        it('formatScanRequiredPrompt should return scan prompt with suggested SU and progress', () => {
            const prompt = controller.formatScanRequiredPrompt(
                [{ StorageUnit: '2000018955' }],
                0,
                100,
                'KG'
            );
            expect(prompt).toBe('gi261ScanRequiredPrompt');
            expect(controller.getText).toHaveBeenCalledWith('gi261ScanRequiredPrompt', ['2000018955', 0, 100, 'KG']);
        });

        it('formatScanRequiredPrompt should return empty string if no suggested unit exists', () => {
            expect(controller.formatScanRequiredPrompt([], 0, 100, 'KG')).toBe('');
        });
    });

    describe('Refresh, Reset & navigation', () => {
        it('onRefresh should re-read reservation scan mode from SAP and show toast', () => {
            controller._oModel.setProperty('/reservationNo', '520615');
            controller._oModel.setProperty('/reservationItem', '0001');
            controller._oModel.setProperty('/openQty', 100);
            jest.spyOn(controller, '_detectScanMode').mockImplementation(() => {});

            controller.onRefresh();

            expect(controller._detectScanMode).toHaveBeenCalledWith('520615', '0001', 100);
            expect(mockMessageToast.show).toHaveBeenCalledWith('gi261RefreshSuccess');
        });

        it('onResetForm should reset the model and toast when confirmed', () => {
            controller._oModel.setProperty('/material', 'X');
            mockMessageBox.confirm.mockImplementationOnce((msg, opts) => opts.onClose('OK'));
            controller.onResetForm();
            expect(controller._oModel.getProperty('/material')).toBe('');
            expect(mockMessageToast.show).toHaveBeenCalled();
        });

        it('onNavBack should go to the dashboard for an unplanned/standalone issue', () => {
            controller._oModel.setProperty('/fromReservation', false);
            controller.onNavBack();
            expect(mockRouter.navTo).toHaveBeenCalledWith('dashboard');
        });

        it('onNavBack should go to the Pending list when completing a reservation', () => {
            controller._oModel.setProperty('/fromReservation', true);
            controller.onNavBack();
            expect(mockRouter.navTo).toHaveBeenCalledWith('wmGoodsIssue261Pending');
        });
    });

    describe('Material mismatch checks (3000000015 vs 3000000415)', () => {
        it('validate should reject scanned unit if material is 3000000015 when reservation expects 3000000415', () => {
            const data = {
                scanEnabled: true,
                reservationNo: '520615',
                reservationItem: '0001',
                material: '3000000415',
                plant: '1130',
                storageLocation: 'CS02',
                quantity: 100,
                unit: 'KG',
                postingDate: '2026-10-05',
                documentDate: '2026-10-05',
                requiredScanCount: 100,
                scannedUnits: [
                    { key: '2000018955', material: '3000000015', plant: '1130', storageLocation: 'CS02', qty: 100 }
                ]
            };
            const result = GoodsIssue261Model.validate(data);
            expect(result.isValid).toBe(false);
            expect(result.errors.scannedUnits).toContain('Wrong material: scanned unit belongs to 3000000015, expected 3000000415.');
        });

        it('validate should accept matching material with normalized leading zeros', () => {
            const data = {
                scanEnabled: true,
                reservationNo: '520615',
                reservationItem: '0001',
                material: '3000000415',
                plant: '1130',
                storageLocation: 'CS02',
                quantity: 100,
                unit: 'KG',
                postingDate: '2026-10-05',
                documentDate: '2026-10-05',
                requiredScanCount: 100,
                scannedUnits: [
                    { key: '2000018955', material: '000000003000000415', plant: '1130', storageLocation: 'CS02', qty: 100 }
                ]
            };
            const result = GoodsIssue261Model.validate(data);
            expect(result.errors.scannedUnits).toBeFalsy();
            expect(result.isValid).toBe(true);
        });

        it('applyScanResolution should reject material 3000000015 when 3000000415 expected', () => {
            const data = {
                material: '3000000415',
                plant: '1130',
                storageLocation: 'CS02',
                requiredScanCount: 100,
                scannedUnits: []
            };
            const res = {
                SuExists: true,
                Material: '3000000015',
                Plant: '1130',
                StorageLocation: 'CS02',
                SuStockQty: 100
            };
            const fb = GoodsIssue261Model.applyScanResolution(data, res, '2000018955');
            expect(fb.ok).toBe(false);
            expect(fb.state).toBe('Error');
            expect(fb.text).toContain('Wrong material: scanned unit belongs to 3000000015, expected 3000000415.');
        });
    });
});
