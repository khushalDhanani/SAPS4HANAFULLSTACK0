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
            this.getText = (k) => k;
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
                    StorageLocation: 'RM01', OpenQty: 4, Unit: 'KG'
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
            // The reservation item's own plant must win over the (blank) form plant.
            expect(mockService.fetchMaterialDetails).toHaveBeenCalledWith('1000000045', '3000');
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
                { ReservationItem: '1', Material: '1000000045', MaterialDesc: 'Mat', Plant: '1120', StorageLocation: 'HS01', Unit: 'EA', OrderNo: '600001', OpenQty: 3 }
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
                { ReservationItem: '1', Material: 'A' },
                { ReservationItem: '2', Material: 'B' }
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

    describe('Reset & navigation', () => {
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
});
