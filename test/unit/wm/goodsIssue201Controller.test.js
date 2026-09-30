/**
 * Unit Tests for GoodsIssue201 Controller (Goods Issue to Cost Center / Movement 201).
 *
 * Mirrors the harness used by trToController.test.js / goodsReceiptController.test.js:
 * stub sap.ui.define (global.sap), mock the UI5 base deps, and drive the controller under Node.
 * The pure GoodsIssue201Model is loaded for real (it is dependency-free CommonJS) so validation,
 * payload building and scan resolution are exercised authentically; createInitialModel is wrapped
 * to return a lightweight JSONModel stub. GoodsIssue201Service is fully mocked.
 */

let GoodsIssue201Controller;
const RealModel = require('../../../app/fiori-app/webapp/modules/wm/goods-issue/model/GoodsIssue201Model');

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

// Real pure-model logic, but hand out a testable JSONModel stub from createInitialModel.
const mockModel = Object.assign({}, RealModel, {
    createInitialModel: () => new MockJSONModel(RealModel.getInitialData())
});

const mockService = {
    fetchReservationItems: jest.fn().mockResolvedValue([]),
    fetchMaterialDetails: jest.fn().mockResolvedValue(null),
    fetchStockUnitsForItem: jest.fn().mockResolvedValue({ StockUnits: [] }),
    resolveScanUnit: jest.fn().mockResolvedValue({ SuExists: true }),
    fetchCostCenters: jest.fn().mockResolvedValue([]),
    fetchCostCenterDetails: jest.fn().mockResolvedValue(null),
    fetchPlants: jest.fn().mockResolvedValue([]),
    fetchStorageLocations: jest.fn().mockResolvedValue([]),
    postGoodsIssue: jest.fn().mockResolvedValue({ MaterialDocument: '4900000001', MaterialDocYear: '2025' }),
    reverseGoodsIssue: jest.fn().mockResolvedValue({ ReversalMaterialDocument: '4900000002', ReversalMaterialDocYear: '2025' })
};

// Capture the most recently constructed SelectDialog so value-help flows can be asserted.
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
            GoodsIssue201Controller = factory(
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

require('../../../app/fiori-app/webapp/modules/wm/goods-issue/controller/GoodsIssue201.controller');

describe('GoodsIssue201 Controller Unit Tests', () => {
    let controller;

    // Fill the minimum set of fields that makes GoodsIssue201Model.validate() pass.
    function makeValid() {
        const m = controller._oModel;
        m.setProperty('/costCenter', 'CC01');
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
        mockService.fetchCostCenterDetails.mockResolvedValue(null);
        mockService.fetchStockUnitsForItem.mockResolvedValue({ StockUnits: [] });
        mockService.resolveScanUnit.mockResolvedValue({ SuExists: true });
        mockService.postGoodsIssue.mockResolvedValue({ MaterialDocument: '4900000001', MaterialDocYear: '2025' });
        mockService.reverseGoodsIssue.mockResolvedValue({ ReversalMaterialDocument: '4900000002', ReversalMaterialDocYear: '2025' });
        controller = new GoodsIssue201Controller();
        controller.onInit();
    });

    describe('Initialization', () => {
        it('should create the gi201 model and register the route pattern listener', () => {
            expect(controller._oModel).toBeDefined();
            expect(controller.getModel('gi201')).toBe(controller._oModel);
            expect(mockRouter.getRoute).toHaveBeenCalledWith('wmGoodsIssue201');
        });

        it('should start with BLANK plant and storage location (no hardcoded 1120/HS01 defaults)', () => {
            expect(controller._oModel.getProperty('/plant')).toBe('');
            expect(controller._oModel.getProperty('/storageLocation')).toBe('');
            expect(controller._oModel.getProperty('/material')).toBe('');
            expect(controller._oModel.getProperty('/movementType')).toBe('201');
        });
    });

    describe('Formatters', () => {
        it('formatAvailableStock should return em dash — when stock is null, undefined, or empty', () => {
            expect(controller.formatAvailableStock(null, 'EA')).toBe('—');
            expect(controller.formatAvailableStock(undefined, 'EA')).toBe('—');
            expect(controller.formatAvailableStock('', 'EA')).toBe('—');
        });

        it('formatAvailableStock should return formatted stock string when stock is a number', () => {
            controller.getText = jest.fn().mockReturnValue('available');
            expect(controller.formatAvailableStock(150, 'EA')).toBe('150 EA available');
        });
    });

    describe('Route matching & reset', () => {
        it('_onRouteMatched without a resv query should reset the model and not prefill', () => {
            controller._onRouteMatched({ getParameter: () => ({}) });
            expect(mockService.fetchReservationItems).not.toHaveBeenCalled();
            expect(controller._oModel.getProperty('/fromReservation')).toBe(false);
        });

        it('_resetModel should restore initial data and re-run validation', () => {
            controller._oModel.setProperty('/costCenter', 'XX');
            controller._resetModel();
            expect(controller._oModel.getProperty('/costCenter')).toBe('');
            expect(controller._oModel.getProperty('/isValid')).toBe(false);
        });
    });

    describe('Pending-reservation prefill', () => {
        it('should prefill material/plant/qty from the open reservation item and mark fromReservation', async () => {
            mockService.fetchReservationItems.mockResolvedValueOnce([
                {
                    ReservationNo: '0000123456', ReservationItem: '0001', CostCenter: 'CC42',
                    Material: '1000000045', MaterialDesc: 'Test Mat', Plant: '2000',
                    StorageLocation: 'RM01', OpenQty: 7, Unit: 'KG'
                }
            ]);
            mockService.fetchMaterialDetails.mockResolvedValueOnce({ materialName: 'Test Mat', unit: 'KG', isBatchManaged: false });

            controller._onRouteMatched({
                getParameter: () => ({ '?query': { resv: '0000123456' } })
            });
            await flush();

            const m = controller._oModel;
            expect(mockService.fetchReservationItems).toHaveBeenCalledWith('0000123456');
            expect(m.getProperty('/fromReservation')).toBe(true);
            expect(m.getProperty('/material')).toBe('1000000045');
            expect(m.getProperty('/plant')).toBe('2000');
            expect(m.getProperty('/storageLocation')).toBe('RM01');
            expect(m.getProperty('/quantity')).toBe(7);
            expect(m.getProperty('/costCenter')).toBe('CC42');
        });

        it('should surface a toast (not fabricate) when the reservation has no open item', async () => {
            mockService.fetchReservationItems.mockResolvedValueOnce([]);
            controller._prefillFromReservation('0000999999');
            await flush();
            expect(mockMessageToast.show).toHaveBeenCalled();
            expect(controller._oModel.getProperty('/fromReservation')).toBe(false);
        });

        it('should show MessageBox.error when reservation fetch fails', async () => {
            mockService.fetchReservationItems.mockRejectedValueOnce(new Error('Reservation 999 not found in SAP'));
            controller._prefillFromReservation('999');
            await flush();
            expect(mockMessageBox.error).toHaveBeenCalledWith(expect.stringContaining('not found in SAP'));
        });
    });

    describe('Live validation & field changes', () => {
        it('onCostCenterLiveChange should uppercase the cost center and validate', () => {
            controller.onCostCenterLiveChange({ getParameter: () => 'cc01' });
            expect(controller._oModel.getProperty('/costCenter')).toBe('CC01');
        });

        it('onQuantityLiveChange should store a numeric quantity', () => {
            controller.onQuantityLiveChange({ getParameter: () => '12.5' });
            expect(controller._oModel.getProperty('/quantity')).toBe(12.5);
        });

        it('_validateLive should be true once all mandatory fields are valid', () => {
            makeValid();
            expect(controller._validateLive()).toBe(true);
            expect(controller._oModel.getProperty('/isValid')).toBe(true);
        });

        it('_validateLive should be false when the cost center is missing', () => {
            makeValid();
            controller._oModel.setProperty('/costCenter', '');
            expect(controller._validateLive()).toBe(false);
            expect(controller._oModel.getProperty('/errors/costCenter')).toContain('required');
        });
    });

    describe('Material info loading', () => {
        it('onMaterialChange should uppercase + trim, then load details from the Service', async () => {
            mockService.fetchMaterialDetails.mockResolvedValueOnce({
                materialName: 'Steel Bar', unit: 'KG', isBatchManaged: true, isSerialManaged: false, availableStock: 42
            });
            controller.onMaterialChange({ getParameter: () => ' 1000000045 ' });
            expect(controller._oModel.getProperty('/material')).toBe('1000000045');
            await flush();
            // plant is blank in the create form, so the loader falls back to '1120' internally
            expect(mockService.fetchMaterialDetails).toHaveBeenCalledWith('1000000045', '1120');
            expect(controller._oModel.getProperty('/materialName')).toBe('Steel Bar');
            expect(controller._oModel.getProperty('/isBatchManaged')).toBe(true);
            expect(controller._oModel.getProperty('/availableStock')).toBe(42);
        });

        it('_loadMaterialInfo should no-op the service call for an empty material', async () => {
            controller._loadMaterialInfo('');
            await flush();
            expect(mockService.fetchMaterialDetails).not.toHaveBeenCalled();
        });
    });

    describe('Serial number add / delete', () => {
        beforeEach(() => {
            controller._oModel.setProperty('/quantity', 3);
        });

        it('onAddSerialPress should add a valid serial and toast', () => {
            controller._oModel.setProperty('/serialInput', 'sn-001');
            controller.onAddSerialPress();
            expect(controller._oModel.getProperty('/serialNumbers')).toEqual(['SN-001']);
            expect(mockMessageToast.show).toHaveBeenCalled();
        });

        it('onAddSerialPress should reject an empty serial with a toast message and add nothing', () => {
            controller._oModel.setProperty('/serialInput', '   ');
            controller.onAddSerialPress();
            expect(controller._oModel.getProperty('/serialNumbers')).toEqual([]);
            expect(mockMessageToast.show).toHaveBeenCalledWith('Serial number cannot be empty');
        });

        it('onDeleteSerial should remove the serial at the bound index', () => {
            controller._oModel.setProperty('/serialNumbers', ['SN-001', 'SN-002']);
            const oEvent = {
                getSource: () => ({
                    getBindingContext: () => ({ getPath: () => '/serialNumbers/0' })
                })
            };
            controller.onDeleteSerial(oEvent);
            expect(controller._oModel.getProperty('/serialNumbers')).toEqual(['SN-002']);
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
            mockService.resolveScanUnit.mockResolvedValueOnce({
                SuExists: true, Material: '1000000045', DeterminedSerial: 'S1', IsSerialManaged: true
            });
            controller._oModel.setProperty('/scanInput', 'SU1');
            controller.onScanUnit();
            await flush();
            expect(mockService.resolveScanUnit).toHaveBeenCalledWith('SU1', '0000123456', '0001');
            expect(controller._oModel.getProperty('/scannedUnits')).toHaveLength(1);
            expect(controller._oModel.getProperty('/lastScanState')).toBe('Success');
        });

        it('onScanUnit should surface a hard SAP error via scan feedback (Error), not a fake fill', async () => {
            mockService.resolveScanUnit.mockRejectedValueOnce(new Error('Unit blocked in S/4HANA'));
            controller._oModel.setProperty('/scanInput', 'BAD');
            controller.onScanUnit();
            await flush();
            expect(controller._oModel.getProperty('/scannedUnits')).toHaveLength(0);
            expect(controller._oModel.getProperty('/lastScanState')).toBe('Error');
            expect(controller._oModel.getProperty('/lastScanText')).toContain('Unit blocked in S/4HANA');
        });

        it('onScanUnit should ignore an empty barcode', () => {
            controller._oModel.setProperty('/scanInput', '  ');
            controller.onScanUnit();
            expect(mockService.resolveScanUnit).not.toHaveBeenCalled();
        });

        it('onDeleteScannedUnit should remove the scanned unit at the bound index', () => {
            controller._oModel.setProperty('/scannedUnits', [{ key: 'A' }, { key: 'B' }]);
            const oEvent = {
                getParameter: () => ({
                    getBindingContext: () => ({ getPath: () => '/scannedUnits/1' })
                })
            };
            controller.onDeleteScannedUnit(oEvent);
            expect(controller._oModel.getProperty('/scannedUnits')).toEqual([{ key: 'A' }]);
        });
    });

    describe('Value help dialogs', () => {
        it('onCostCenterValueHelp should populate the dialog from Service results and open it', async () => {
            mockService.fetchCostCenters.mockResolvedValueOnce([
                { CostCenter: 'CC01', CostCenterName: 'Ops' }
            ]);
            controller.onCostCenterValueHelp();
            await flush();
            expect(lastSelectDialog).not.toBeNull();
            expect(lastSelectDialog._model.getData()).toEqual([{ CostCenter: 'CC01', CostCenterName: 'Ops' }]);
            expect(lastSelectDialog.bindAggregation).toHaveBeenCalledWith('items', '/', expect.anything());
            expect(lastSelectDialog.open).toHaveBeenCalled();
        });

        it('onCostCenterValueHelp should call MessageBox.error (not fabricate) when the Service fails', async () => {
            mockService.fetchCostCenters.mockRejectedValueOnce(new Error('CC service down'));
            controller.onCostCenterValueHelp();
            await flush();
            expect(mockMessageBox.error).toHaveBeenCalledWith('gi201LoadCostCentersError');
        });

        it('onPlantValueHelp should populate the dialog from fetched plants', async () => {
            mockService.fetchPlants.mockResolvedValueOnce([{ Plant: '1120', PlantName: 'Genesis' }]);
            controller.onPlantValueHelp();
            await flush();
            expect(lastSelectDialog._model.getData()).toEqual([{ Plant: '1120', PlantName: 'Genesis' }]);
            expect(lastSelectDialog.open).toHaveBeenCalled();
        });

        it('onPlantValueHelp should surface the real SAP error, never seed invented plants', async () => {
            mockService.fetchPlants.mockRejectedValueOnce(new Error('Plant read failed'));
            controller.onPlantValueHelp();
            await flush();
            expect(mockMessageBox.error).toHaveBeenCalledWith('gi201LoadPlantsError');
        });

        it('onStorageLocationValueHelp should surface the real SAP error on failure', async () => {
            mockService.fetchStorageLocations.mockRejectedValueOnce(new Error('SLoc read failed'));
            controller.onStorageLocationValueHelp();
            await flush();
            expect(mockMessageBox.error).toHaveBeenCalledWith('gi201LoadStorageLocationsError');
        });

        it('onMaterialValueHelp should fetch a material into the dialog when no OData model is bound', async () => {
            mockService.fetchMaterialDetails.mockResolvedValueOnce({ Material: '1000000045', MaterialName: 'X' });
            controller._oModel.setProperty('/material', '1000000045');
            controller.onMaterialValueHelp();
            await flush();
            expect(mockService.fetchMaterialDetails).toHaveBeenCalled();
            expect(lastSelectDialog.open).toHaveBeenCalled();
        });
    });

    describe('onPostGoodsIssue', () => {
        it('should block posting and MessageBox.error when the form is invalid', () => {
            controller.onPostGoodsIssue();
            expect(mockMessageBox.error).toHaveBeenCalled();
            expect(mockService.postGoodsIssue).not.toHaveBeenCalled();
        });

        it('should post and show MessageBox.success with the SAP material document', async () => {
            makeValid();
            mockService.postGoodsIssue.mockResolvedValueOnce({ MaterialDocument: '4900001234', MaterialDocYear: '2025' });
            controller.onPostGoodsIssue();
            await flush();
            expect(mockService.postGoodsIssue).toHaveBeenCalledWith(expect.objectContaining({
                MovementType: '201', CostCenter: 'CC01', Material: '1000000045', Plant: '1120', StorageLocation: 'HS01'
            }));
            expect(controller._oModel.getProperty('/hasPosted')).toBe(true);
            expect(controller._oModel.getProperty('/postedDocument')).toBe('4900001234');
            expect(mockMessageBox.success).toHaveBeenCalled();
            expect(mockMessageBox.warning).not.toHaveBeenCalled();
        });

        it('should treat a QUEUED result (Queued=true) as a warning, NOT a success', async () => {
            makeValid();
            mockService.postGoodsIssue.mockResolvedValueOnce({ Queued: true, Message: 'Gateway inactive - queued' });
            controller.onPostGoodsIssue();
            await flush();
            expect(mockMessageBox.warning).toHaveBeenCalledWith('Gateway inactive - queued', expect.any(Object));
            expect(mockMessageBox.success).not.toHaveBeenCalled();
            expect(controller._oModel.getProperty('/hasPosted')).toBe(false);
        });

        it('should treat an empty MaterialDocument result as a warning, NOT a success', async () => {
            makeValid();
            mockService.postGoodsIssue.mockResolvedValueOnce({});
            controller.onPostGoodsIssue();
            await flush();
            expect(mockMessageBox.warning).toHaveBeenCalled();
            expect(mockMessageBox.success).not.toHaveBeenCalled();
            expect(controller._oModel.getProperty('/hasPosted')).toBe(false);
        });

        it('should show MessageBox.error with the SAP message when posting is rejected', async () => {
            makeValid();
            mockService.postGoodsIssue.mockRejectedValueOnce(new Error('Deficit of stock 5 EA : material 1000000045'));
            controller.onPostGoodsIssue();
            await flush();
            expect(mockMessageBox.error).toHaveBeenCalledWith(
                expect.stringContaining('Deficit of stock'),
                expect.any(Object)
            );
        });

        it('should route back to the Pending list with the SAP document when completing a reservation', async () => {
            makeValid();
            controller._oModel.setProperty('/fromReservation', true);
            controller._oModel.setProperty('/reservationNo', '0000123456');
            controller._oModel.setProperty('/reservationItem', '0001');
            mockService.postGoodsIssue.mockResolvedValueOnce({ MaterialDocument: '4900009999', MaterialDocYear: '2025' });
            controller.onPostGoodsIssue();
            await flush();
            expect(mockRouter.navTo).toHaveBeenCalledWith('wmGoodsIssue201Pending', {
                '?query': expect.objectContaining({ resv: '0000123456', item: '0001', doc: '4900009999' })
            });
            expect(mockMessageBox.success).not.toHaveBeenCalled();
        });
    });

    describe('Reversal', () => {
        it('onReverseGoodsIssue should toast when there is no posted document to reverse', () => {
            controller._oModel.setProperty('/postedDocument', '');
            controller.onReverseGoodsIssue();
            expect(mockMessageToast.show).toHaveBeenCalled();
            expect(mockMessageBox.confirm).not.toHaveBeenCalled();
        });

        it('onReverseGoodsIssue should confirm, then reverse via the Service and show success', async () => {
            controller._oModel.setProperty('/postedDocument', '4900001234');
            controller._oModel.setProperty('/postedYear', '2025');
            mockMessageBox.confirm.mockImplementationOnce((msg, opts) => opts.onClose('OK'));
            mockService.reverseGoodsIssue.mockResolvedValueOnce({ ReversalMaterialDocument: '4900005678', ReversalMaterialDocYear: '2025' });
            const sPostingDate = controller._oModel.getProperty('/postingDate');
            controller.onReverseGoodsIssue();
            await flush();
            expect(mockMessageBox.confirm).toHaveBeenCalled();
            expect(mockService.reverseGoodsIssue).toHaveBeenCalledWith('4900001234', '2025', sPostingDate, '01');
            expect(controller._oModel.getProperty('/hasReversed')).toBe(true);
            expect(controller._oModel.getProperty('/reversalDocument')).toBe('4900005678');
            expect(mockMessageBox.success).toHaveBeenCalled();
        });

        it('_executeReversal should show MessageBox.error when the reversal is rejected', async () => {
            controller._oModel.setProperty('/postedDocument', '4900001234');
            mockService.reverseGoodsIssue.mockRejectedValueOnce(new Error('Document already reversed'));
            controller._executeReversal('4900001234', '2025', undefined);
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

        it('onNavBack should navigate to the dashboard', () => {
            controller.onNavBack();
            expect(mockRouter.navTo).toHaveBeenCalledWith('dashboard');
        });
    });
});
