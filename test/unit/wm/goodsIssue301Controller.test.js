/**
 * Unit Tests for GoodsIssue301 Controller (LE-WM Movement 301 / Plant-to-Plant Transfer)
 *
 * Harness mirrors test/unit/wm/goodsReceiptController.test.js and trToController.test.js:
 * sap.ui.define is stubbed via global.sap, and every controller dependency
 * (BaseController, JSONModel, MessageBox, MessageToast, SelectDialog, StandardListItem,
 * Filter, FilterOperator, GoodsIssue301Model, GoodsIssue301Service) is mocked.
 *
 * These tests pin behavior that a future base-class de-duplication of GoodsIssue301 /
 * GoodsIssue311 must preserve: the model name used in setModel ("gi301"), the route name
 * ("wmGoodsIssue301"), the i18n key prefixes ("gi301*"), and which Service method each
 * handler calls.
 */

let GoodsIssue301Controller;

const flush = () => new Promise((resolve) => setImmediate(resolve));

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
    refresh() { /* no-op */ }
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

// -------- Model mock (faithful to GoodsIssue301Model behavior the controller relies on) --------
const mockGoodsIssue301Model = {
    getInitialData: () => ({
        movementType: '301',
        movementTypeName: 'Plant-to-Plant Transfer',
        postingDate: '2026-09-30',
        documentDate: '2026-09-30',
        headerText: '',
        reservationNo: '',
        reservationItem: '',
        orderNo: '',
        receivingPlant: '',
        receivingPlantName: '',
        receivingStorageLocation: '',
        receivingStorageLocationName: '',
        material: '',
        materialName: '',
        plant: '',
        storageLocation: '',
        quantity: 1,
        unit: '',
        isUnitEditable: false,
        openQty: null,
        isBatchManaged: false,
        batch: '',
        isSerialManaged: false,
        serialInput: '',
        serialNumbers: [],
        itemLoading: false,
        busy: false,
        hasPosted: false,
        postedDocument: '',
        postedYear: '',
        reversalBusy: false,
        hasReversed: false,
        reversalDocument: '',
        reversalYear: '',
        errors: {},
        isValid: false
    }),
    createInitialModel: function () {
        return new MockJSONModel(this.getInitialData());
    },
    // Default: form is invalid (empty). Tests override per-case with mockReturnValueOnce.
    validate: jest.fn(() => ({ isValid: false, errors: { reservationNo: 'Reservation Number is required' } })),
    applyReservationItem: jest.fn((oData, oItem) => {
        if (!oItem) return;
        const raw = oItem.ReservationItem != null ? String(oItem.ReservationItem).trim() : '';
        oData.reservationItem = raw ? raw.padStart(4, '0') : '';
        oData.orderNo = oItem.OrderNo || '';
        oData.material = oItem.Material || '';
        oData.materialName = oItem.MaterialDesc || '';
        oData.plant = oItem.Plant || '';
        oData.storageLocation = oItem.StorageLocation || '';
        oData.unit = oItem.Unit || '';
        oData.isSerialManaged = !!oItem.IsSerialManaged;
        oData.isBatchManaged = !!(oItem.Batch || oItem.BatchStatusState);
        oData.batch = oItem.Batch || '';
        oData.openQty = (oItem.OpenQty != null) ? oItem.OpenQty : null;
    }),
    addSerialNumber: jest.fn((oData, sRaw) => {
        const s = String(sRaw || '').replace(/[\r\n\t]/g, '').trim().toUpperCase();
        if (!s) return { success: false, message: 'Serial number cannot be empty' };
        oData.serialNumbers = Array.isArray(oData.serialNumbers) ? oData.serialNumbers : [];
        if (oData.serialNumbers.indexOf(s) !== -1) {
            return { success: false, message: "Serial number '" + s + "' already added" };
        }
        oData.serialNumbers.push(s);
        oData.serialInput = '';
        return { success: true };
    }),
    removeSerialNumber: jest.fn((oData, nIndex) => {
        if (Array.isArray(oData.serialNumbers) && nIndex >= 0 && nIndex < oData.serialNumbers.length) {
            oData.serialNumbers.splice(nIndex, 1);
        }
    }),
    toBackendPayload: jest.fn((oData) => ({
        MovementType: '301',
        ReservationNo: oData.reservationNo,
        ReservationItem: oData.reservationItem,
        Material: oData.material,
        IssueQty: Number(oData.quantity)
    }))
};

// -------- Service mock --------
const mockGoodsIssue301Service = {
    fetchOpenReservations: jest.fn().mockResolvedValue([]),
    fetchReservationItems: jest.fn().mockResolvedValue([]),
    fetchPlants: jest.fn().mockResolvedValue([]),
    fetchStorageLocations: jest.fn().mockResolvedValue([]),
    postGoodsIssue: jest.fn().mockResolvedValue({}),
    reverseGoodsIssue: jest.fn().mockResolvedValue({})
};

// -------- SelectDialog / StandardListItem / Filter mocks --------
let createdSelectDialogs = [];
function MockSelectDialog(cfg) {
    this.config = cfg || {};
    this.setModel = jest.fn();
    this.bindAggregation = jest.fn();
    this.open = jest.fn();
    this.destroy = jest.fn();
    this.getBinding = jest.fn();
    createdSelectDialogs.push(this);
}
function MockStandardListItem(cfg) {
    this.config = cfg || {};
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

// Chained extend mock: each proto in the chain (base first, subclass last) is assigned onto the
// instance, and the returned constructor itself supports .extend so the thin controller can extend
// the shared base. Scaffolding (getView/getText/getRouter/...) mimics the real BaseController.
function defineController(protoChain) {
    function Controller() {
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
        this.byId = jest.fn();
        this.getText = (k) => k;
        this.getOwnerComponent = () => ({ getRouter: () => mockRouter });
        protoChain.forEach((p) => Object.assign(this, p));
    }
    Controller.extend = (name, proto) => defineController(protoChain.concat([proto]));
    return Controller;
}
const mockBaseController = { extend: (name, proto) => defineController([proto]) };

// Load the shared transfer base controller (UI-layer deps mocked)...
let GoodsIssueTransferBase;
global.sap = {
    ui: {
        define: (deps, factory) => {
            GoodsIssueTransferBase = factory(
                mockBaseController,
                MockJSONModel,
                mockMessageBox,
                mockMessageToast,
                MockSelectDialog,
                MockStandardListItem,
                MockFilter,
                MockFilterOperator
            );
        }
    }
};
require('../../../app/fiori-app/webapp/modules/wm/goods-issue/controller/GoodsIssueTransferBaseController.js');

// ...then the thin 301 controller, which extends the base and supplies the per-type Model/Service.
global.sap.ui.define = (deps, factory) => {
    GoodsIssue301Controller = factory(GoodsIssueTransferBase, mockGoodsIssue301Model, mockGoodsIssue301Service);
};
require('../../../app/fiori-app/webapp/modules/wm/goods-issue/controller/GoodsIssue301.controller.js');

describe('GoodsIssue301 Controller Unit Tests (Movement 301)', () => {
    let controller;

    beforeEach(() => {
        jest.clearAllMocks();
        // clearAllMocks wipes call data but keeps implementations; re-assert the invalid default.
        mockGoodsIssue301Model.validate.mockReturnValue({ isValid: false, errors: { reservationNo: 'Reservation Number is required' } });
        createdSelectDialogs = [];
        controller = new GoodsIssue301Controller();
        controller.onInit();
    });

    // =============================================================
    describe('Initialization & Routing', () => {
        it('should set the gi301 model on the view during onInit', () => {
            const oModel = controller.getView().getModel('gi301');
            expect(oModel).toBeInstanceOf(MockJSONModel);
            expect(oModel.getProperty('/movementType')).toBe('301');
        });

        it('should register the wmGoodsIssue301 route pattern listener', () => {
            expect(mockRouter.getRoute).toHaveBeenCalledWith('wmGoodsIssue301');
            expect(mockRouter.getRoute('wmGoodsIssue301').attachPatternMatched).toHaveBeenCalled();
        });

        it('_onRouteMatched should reset the model and clear resolved items', () => {
            const oModel = controller.getView().getModel('gi301');
            oModel.setProperty('/reservationNo', '0000012345');
            controller._aResolvedItems = [{ ReservationItem: '1' }];

            controller._onRouteMatched();

            expect(oModel.getProperty('/reservationNo')).toBe('');
            expect(controller._aResolvedItems).toEqual([]);
            expect(mockGoodsIssue301Model.validate).toHaveBeenCalled();
        });
    });

    // =============================================================
    describe('Formatters', () => {
        it('formatSuccessBanner returns the gi301 i18n text when a document exists, empty otherwise', () => {
            expect(controller.formatSuccessBanner('4900000001', '2026')).toBe('gi301SuccessBannerText');
            expect(controller.formatSuccessBanner('', '2026')).toBe('');
        });

        it('formatReversalBanner returns the gi301 i18n text when a document exists, empty otherwise', () => {
            expect(controller.formatReversalBanner('4900000002', '2026')).toBe('gi301ReversalBannerText');
            expect(controller.formatReversalBanner(null)).toBe('');
        });

        it('formatOpenQty joins quantity and unit, empty for null/undefined', () => {
            expect(controller.formatOpenQty(15, 'KG')).toBe('15 KG');
            expect(controller.formatOpenQty(5)).toBe('5 ');
            expect(controller.formatOpenQty(null, 'KG')).toBe('');
            expect(controller.formatOpenQty(undefined)).toBe('');
        });
    });

    // =============================================================
    describe('Live Validation', () => {
        it('_validateLive writes errors/isValid to the model and returns validity', () => {
            const oModel = controller.getView().getModel('gi301');
            const bValid = controller._validateLive();

            expect(mockGoodsIssue301Model.validate).toHaveBeenCalledWith(oModel.getData());
            expect(bValid).toBe(false);
            expect(oModel.getProperty('/isValid')).toBe(false);
            expect(oModel.getProperty('/errors/reservationNo')).toBe('Reservation Number is required');
        });

        it('onFieldLiveChange re-runs validation', () => {
            mockGoodsIssue301Model.validate.mockClear();
            controller.onFieldLiveChange();
            expect(mockGoodsIssue301Model.validate).toHaveBeenCalledTimes(1);
        });

        it('onQuantityLiveChange sets numeric quantity and validates', () => {
            const oModel = controller.getView().getModel('gi301');
            controller.onQuantityLiveChange({ getParameter: () => '7' });
            expect(oModel.getProperty('/quantity')).toBe(7);
            expect(mockGoodsIssue301Model.validate).toHaveBeenCalled();
        });

        it('onQuantityLiveChange keeps raw string for a non-numeric value', () => {
            const oModel = controller.getView().getModel('gi301');
            controller.onQuantityLiveChange({ getParameter: () => 'abc' });
            expect(oModel.getProperty('/quantity')).toBe('abc');
        });
    });

    // =============================================================
    describe('Reservation Value Help & Item Resolution', () => {
        it('onReservationValueHelp loads open reservations via the service and opens the dialog', async () => {
            mockGoodsIssue301Service.fetchOpenReservations.mockResolvedValueOnce([
                { ReservationNo: '0000012345', OrderNo: 'PO1', DisplayText: 'Resv 12345' }
            ]);

            controller.onReservationValueHelp();
            await flush();

            expect(mockGoodsIssue301Service.fetchOpenReservations).toHaveBeenCalled();
            const oDialog = createdSelectDialogs[0];
            expect(oDialog.open).toHaveBeenCalled();
        });

        it('onReservationValueHelp surfaces a MessageBox.error when the service rejects', async () => {
            mockGoodsIssue301Service.fetchOpenReservations.mockRejectedValueOnce(new Error('SAP down'));

            controller.onReservationValueHelp();
            await flush();

            expect(mockMessageBox.error).toHaveBeenCalledWith('giLoadReservationsError');
        });

        it('confirming a reservation sets the number and triggers item load', async () => {
            mockGoodsIssue301Service.fetchOpenReservations.mockResolvedValueOnce([
                { ReservationNo: '0000012345', DisplayText: 'Resv 12345' }
            ]);
            mockGoodsIssue301Service.fetchReservationItems.mockResolvedValueOnce([
                { ReservationItem: '1', Material: 'MAT-1', MaterialDesc: 'Steel', Plant: '1120', StorageLocation: 'CS01', Unit: 'KG' }
            ]);

            controller.onReservationValueHelp();
            await flush();

            const oDialog = createdSelectDialogs[0];
            oDialog.config.confirm({ getParameter: () => ({ getTitle: () => '0000012345' }) });
            await flush();

            const oModel = controller.getView().getModel('gi301');
            expect(oModel.getProperty('/reservationNo')).toBe('0000012345');
            expect(mockGoodsIssue301Service.fetchReservationItems).toHaveBeenCalledWith('0000012345');
            expect(oModel.getProperty('/material')).toBe('MAT-1');
        });

        it('_loadReservationItems auto-applies when exactly one item is open', async () => {
            mockGoodsIssue301Service.fetchReservationItems.mockResolvedValueOnce([
                { ReservationItem: '2', Material: 'MAT-2', Plant: '1120', StorageLocation: 'CS01', Unit: 'EA' }
            ]);

            await controller._loadReservationItems('0000012345');

            const oModel = controller.getView().getModel('gi301');
            expect(mockGoodsIssue301Model.applyReservationItem).toHaveBeenCalledTimes(1);
            expect(oModel.getProperty('/material')).toBe('MAT-2');
            expect(oModel.getProperty('/reservationItem')).toBe('0002');
            expect(oModel.getProperty('/itemLoading')).toBe(false);
        });

        it('_loadReservationItems opens a picker dialog when multiple items are open', async () => {
            mockGoodsIssue301Service.fetchReservationItems.mockResolvedValueOnce([
                { ReservationItem: '1', Material: 'MAT-1' },
                { ReservationItem: '2', Material: 'MAT-2' }
            ]);

            await controller._loadReservationItems('0000012345');

            expect(mockGoodsIssue301Model.applyReservationItem).not.toHaveBeenCalled();
            // one picker SelectDialog created and opened
            const oPicker = createdSelectDialogs[createdSelectDialogs.length - 1];
            expect(oPicker.open).toHaveBeenCalled();
        });

        it('_loadReservationItems shows a toast when no items are open', async () => {
            mockGoodsIssue301Service.fetchReservationItems.mockResolvedValueOnce([]);

            await controller._loadReservationItems('0000012345');

            expect(mockMessageToast.show).toHaveBeenCalledWith('gi301NoItemsFound');
        });

        it('_loadReservationItems surfaces a MessageBox.error when the service rejects', async () => {
            mockGoodsIssue301Service.fetchReservationItems.mockRejectedValueOnce(new Error('item read failed'));

            await controller._loadReservationItems('0000012345');

            expect(mockMessageBox.error).toHaveBeenCalledWith('giLoadReservationItemsError');
        });

        it('onReservationItemChange applies a matching cached item (padded)', () => {
            const oModel = controller.getView().getModel('gi301');
            oModel.setProperty('/reservationNo', '0000012345');
            controller._aResolvedItems = [
                { ReservationItem: '1', Material: 'MAT-1', Plant: '1120', StorageLocation: 'CS01', Unit: 'KG' }
            ];

            controller.onReservationItemChange({ getParameter: () => '1' });

            expect(mockGoodsIssue301Model.applyReservationItem).toHaveBeenCalled();
            expect(oModel.getProperty('/material')).toBe('MAT-1');
        });

        it('onReservationItemChange shows a toast when the typed item is not in cache', () => {
            const oModel = controller.getView().getModel('gi301');
            oModel.setProperty('/reservationNo', '0000012345');
            controller._aResolvedItems = [{ ReservationItem: '1', Material: 'MAT-1' }];

            controller.onReservationItemChange({ getParameter: () => '9' });

            expect(mockMessageToast.show).toHaveBeenCalledWith('gi301NoItemsFound');
        });

        it('onReservationItemChange only validates when input or reservation is empty', () => {
            mockGoodsIssue301Model.validate.mockClear();
            controller.onReservationItemChange({ getParameter: () => '' });
            expect(mockGoodsIssue301Model.applyReservationItem).not.toHaveBeenCalled();
            expect(mockGoodsIssue301Model.validate).toHaveBeenCalledTimes(1);
        });
    });

    // =============================================================
    describe('Serial Number Management', () => {
        it('onAddSerialPress adds a serial and shows a confirmation toast', () => {
            const oModel = controller.getView().getModel('gi301');
            oModel.setProperty('/serialInput', 'sn001');

            controller.onAddSerialPress();

            expect(mockGoodsIssue301Model.addSerialNumber).toHaveBeenCalled();
            expect(oModel.getProperty('/serialNumbers')).toEqual(['SN001']);
            expect(mockMessageToast.show).toHaveBeenCalledWith('gi301SerialAdded');
        });

        it('onAddSerialPress shows the failure message and does not add on invalid input', () => {
            mockGoodsIssue301Model.addSerialNumber.mockReturnValueOnce({ success: false, message: 'Serial number cannot be empty' });
            const oModel = controller.getView().getModel('gi301');
            oModel.setProperty('/serialInput', '');

            controller.onAddSerialPress();

            expect(mockMessageToast.show).toHaveBeenCalledWith('Serial number cannot be empty');
        });

        it('onDeleteSerial removes the serial at the bound index', () => {
            const oModel = controller.getView().getModel('gi301');
            oModel.setProperty('/serialNumbers', ['SN001', 'SN002']);

            const oEvent = {
                getSource: () => ({
                    getBindingContext: (m) => (m === 'gi301' ? { getPath: () => '/serialNumbers/0' } : null)
                })
            };
            controller.onDeleteSerial(oEvent);

            expect(mockGoodsIssue301Model.removeSerialNumber).toHaveBeenCalledWith(oModel.getData(), 0);
            expect(oModel.getProperty('/serialNumbers')).toEqual(['SN002']);
            expect(mockMessageToast.show).toHaveBeenCalledWith('gi301SerialRemoved');
        });

        it('onDeleteSerial is a no-op without a binding context', () => {
            const oEvent = { getSource: () => ({ getBindingContext: () => null }) };
            controller.onDeleteSerial(oEvent);
            expect(mockGoodsIssue301Model.removeSerialNumber).not.toHaveBeenCalled();
        });
    });

    // =============================================================
    describe('Receiving Plant / Storage Location Value Helps', () => {
        it('onReceivingPlantValueHelp opens a dialog with plants from the service', async () => {
            mockGoodsIssue301Service.fetchPlants.mockResolvedValueOnce([{ Plant: '1120', PlantName: 'Genesis' }]);

            controller.onReceivingPlantValueHelp();
            await flush();

            expect(mockGoodsIssue301Service.fetchPlants).toHaveBeenCalled();
            const oDialog = createdSelectDialogs[createdSelectDialogs.length - 1];
            expect(oDialog.open).toHaveBeenCalled();
        });

        it('onReceivingPlantValueHelp calls MessageBox.error and does NOT open a dialog when the service rejects', async () => {
            mockGoodsIssue301Service.fetchPlants.mockRejectedValueOnce(new Error('plants read failed'));

            controller.onReceivingPlantValueHelp();
            await flush();

            expect(mockMessageBox.error).toHaveBeenCalledWith('giLoadReceivingPlantsError');
            const oDialog = createdSelectDialogs[createdSelectDialogs.length - 1];
            expect(oDialog.open).not.toHaveBeenCalled();
        });

        it('onReceivingStorageLocationValueHelp opens a dialog with storage locations from the service', async () => {
            mockGoodsIssue301Service.fetchStorageLocations.mockResolvedValueOnce([{ StorageLocation: 'CS01', StorageLocationName: 'Raw', Plant: '1120' }]);

            controller.onReceivingStorageLocationValueHelp();
            await flush();

            expect(mockGoodsIssue301Service.fetchStorageLocations).toHaveBeenCalledWith('1120');
            const oDialog = createdSelectDialogs[createdSelectDialogs.length - 1];
            expect(oDialog.open).toHaveBeenCalled();
        });

        it('onReceivingStorageLocationValueHelp calls MessageBox.error and does NOT open a dialog when the service rejects', async () => {
            mockGoodsIssue301Service.fetchStorageLocations.mockRejectedValueOnce(new Error('sloc read failed'));

            controller.onReceivingStorageLocationValueHelp();
            await flush();

            expect(mockMessageBox.error).toHaveBeenCalledWith('giLoadReceivingStorageLocationsError');
            const oDialog = createdSelectDialogs[createdSelectDialogs.length - 1];
            expect(oDialog.open).not.toHaveBeenCalled();
        });
    });

    // =============================================================
    describe('Post Goods Issue (301)', () => {
        it('blocks posting and shows a validation error when the form is invalid', () => {
            // default validate() => invalid
            controller.onPostGoodsIssue();
            expect(mockMessageBox.error).toHaveBeenCalledWith('gi301ValidationErrorsSummary');
            expect(mockGoodsIssue301Service.postGoodsIssue).not.toHaveBeenCalled();
        });

        it('posts and shows MessageBox.success with a SAP material document', async () => {
            mockGoodsIssue301Model.validate.mockReturnValueOnce({ isValid: true, errors: {} });
            mockGoodsIssue301Service.postGoodsIssue.mockResolvedValueOnce({ MaterialDocument: '4900000123', MaterialDocYear: '2026' });

            controller.onPostGoodsIssue();
            await flush();

            const oModel = controller.getView().getModel('gi301');
            expect(mockGoodsIssue301Service.postGoodsIssue).toHaveBeenCalled();
            expect(oModel.getProperty('/hasPosted')).toBe(true);
            expect(oModel.getProperty('/postedDocument')).toBe('4900000123');
            expect(mockMessageBox.success).toHaveBeenCalledWith('gi301PostSuccessMsg', expect.objectContaining({ title: 'gi301PostSuccessTitle' }));
        });

        it('shows MessageBox.warning and keeps hasPosted false on a queued result', async () => {
            mockGoodsIssue301Model.validate.mockReturnValueOnce({ isValid: true, errors: {} });
            mockGoodsIssue301Service.postGoodsIssue.mockResolvedValueOnce({ Queued: true, Message: 'Recorded in dispatch queue' });

            controller.onPostGoodsIssue();
            await flush();

            const oModel = controller.getView().getModel('gi301');
            expect(oModel.getProperty('/hasPosted')).toBe(false);
            expect(mockMessageBox.warning).toHaveBeenCalledWith('Recorded in dispatch queue', expect.objectContaining({ title: 'giPostQueuedTitle' }));
            expect(mockMessageBox.success).not.toHaveBeenCalled();
        });

        it('treats a missing MaterialDocument as queued (warning, not success)', async () => {
            mockGoodsIssue301Model.validate.mockReturnValueOnce({ isValid: true, errors: {} });
            mockGoodsIssue301Service.postGoodsIssue.mockResolvedValueOnce({ Message: 'No document number returned' });

            controller.onPostGoodsIssue();
            await flush();

            const oModel = controller.getView().getModel('gi301');
            expect(oModel.getProperty('/hasPosted')).toBe(false);
            expect(mockMessageBox.warning).toHaveBeenCalled();
            expect(mockMessageBox.success).not.toHaveBeenCalled();
        });

        it('shows MessageBox.error when the backend rejects the posting', async () => {
            mockGoodsIssue301Model.validate.mockReturnValueOnce({ isValid: true, errors: {} });
            mockGoodsIssue301Service.postGoodsIssue.mockRejectedValueOnce(new Error('Deficit of stock'));

            controller.onPostGoodsIssue();
            await flush();

            const oModel = controller.getView().getModel('gi301');
            expect(mockMessageBox.error).toHaveBeenCalledWith('Deficit of stock', expect.objectContaining({ title: 'gi301PostFailedTitle' }));
            expect(oModel.getProperty('/busy')).toBe(false);
        });
    });

    // =============================================================
    describe('Reversal', () => {
        it('onReverseGoodsIssue warns when there is no posted document', () => {
            controller.onReverseGoodsIssue();
            expect(mockMessageToast.show).toHaveBeenCalledWith('gi301NoDocumentToReverse');
            expect(mockMessageBox.confirm).not.toHaveBeenCalled();
        });

        it('onReverseGoodsIssue confirms and executes the reversal on OK', async () => {
            const oModel = controller.getView().getModel('gi301');
            oModel.setProperty('/postedDocument', '4900000123');
            oModel.setProperty('/postedYear', '2026');
            mockMessageBox.confirm.mockImplementationOnce((msg, opts) => opts.onClose('OK'));
            mockGoodsIssue301Service.reverseGoodsIssue.mockResolvedValueOnce({ ReversalMaterialDocument: '4900000999', ReversalMaterialDocYear: '2026' });

            controller.onReverseGoodsIssue();
            await flush();

            expect(mockMessageBox.confirm).toHaveBeenCalledWith('gi301ReverseConfirmPrompt', expect.objectContaining({ title: 'gi301ReverseConfirmTitle' }));
            expect(mockGoodsIssue301Service.reverseGoodsIssue).toHaveBeenCalledWith('4900000123', '2026', '2026-09-30', '01');
            expect(oModel.getProperty('/hasReversed')).toBe(true);
            expect(mockMessageBox.success).toHaveBeenCalledWith('gi301ReverseSuccessMsg', expect.any(Object));
        });

        it('_executeReversal shows MessageBox.error when the backend rejects', async () => {
            mockGoodsIssue301Service.reverseGoodsIssue.mockRejectedValueOnce(new Error('Reversal window closed'));

            controller._executeReversal('4900000123', '2026', '2026-09-30');
            await flush();

            const oModel = controller.getView().getModel('gi301');
            expect(mockMessageBox.error).toHaveBeenCalledWith('Reversal window closed', expect.objectContaining({ title: 'gi301ReverseFailedTitle' }));
            expect(oModel.getProperty('/reversalBusy')).toBe(false);
        });
    });

    // =============================================================
    describe('Reset & Navigation', () => {
        it('onResetForm resets the model on confirmation OK', () => {
            const oModel = controller.getView().getModel('gi301');
            oModel.setProperty('/reservationNo', '0000012345');
            mockMessageBox.confirm.mockImplementationOnce((msg, opts) => opts.onClose('OK'));

            controller.onResetForm();

            expect(oModel.getProperty('/reservationNo')).toBe('');
            expect(mockMessageToast.show).toHaveBeenCalledWith('gi301FormReset');
        });

        it('onResetForm does nothing on a non-OK action', () => {
            const oModel = controller.getView().getModel('gi301');
            oModel.setProperty('/reservationNo', '0000012345');
            mockMessageBox.confirm.mockImplementationOnce((msg, opts) => opts.onClose('CANCEL'));

            controller.onResetForm();

            expect(oModel.getProperty('/reservationNo')).toBe('0000012345');
        });

        it('onNavBack navigates to the dashboard route', () => {
            controller.onNavBack();
            expect(mockRouter.navTo).toHaveBeenCalledWith('dashboard');
        });
    });
});
