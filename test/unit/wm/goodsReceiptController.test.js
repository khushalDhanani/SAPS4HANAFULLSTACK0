/**
 * Unit Tests for GoodsReceipt Controller (LE-WM Movement 101 / Storage Unit Driven)
 */

let GoodsReceiptController;
const mockMessageBox = {
    error: jest.fn(),
    success: jest.fn(),
    warning: jest.fn(),
    information: jest.fn(),
    confirm: jest.fn(),
    Action: { YES: 'YES', NO: 'NO' }
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

const mockGoodsReceiptService = {
    fetchOpenInboundDeliveries: jest.fn().mockResolvedValue([]),
    resolveStorageUnit: jest.fn(),
    fetchMaterialStorageLocations: jest.fn(),
    fetchMaterialBatches: jest.fn(),
    postGoodsReceipt: jest.fn()
};

let capturedHardwareScannerHandler = null;
const mockBarcodeScanService = {
    attachHardwareScanner: jest.fn((fn) => { capturedHardwareScannerHandler = fn; }),
    detachHardwareScanner: jest.fn(() => { capturedHardwareScannerHandler = null; }),
    openCameraScanner: jest.fn()
};

const mockHistory = {
    getInstance: jest.fn().mockReturnValue({
        getPreviousHash: jest.fn().mockReturnValue('somePreviousHash')
    })
};

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
                getModel: (name) => this.models[name],
                setModel: (m, name) => { this.models[name] = m; },
                addDependent: jest.fn()
            });
            this.getRouter = () => mockRouter;
            this.byId = jest.fn();
            this.setBusy = jest.fn();
            this.getText = (k) => k;
            this.getOwnerComponent = () => ({
                getRouter: () => mockRouter
            });
        }
        return Controller;
    }
};

global.sap = {
    ui: {
        define: (deps, factory) => {
            GoodsReceiptController = factory(
                mockBaseController,
                MockJSONModel,
                mockMessageBox,
                mockMessageToast,
                mockHistory,
                mockGoodsReceiptService,
                mockBarcodeScanService
            );
        },
        require: (deps, callback) => {
            const mocks = deps.map(dep => {
                if (dep === 'sap/m/SelectDialog') {
                    return function(config) {
                        this.config = config;
                        this.open = jest.fn();
                        this.destroy = jest.fn();
                        this.bindAggregation = jest.fn();
                    };
                }
                if (dep === 'sap/m/StandardListItem') {
                    return function(cfg) { this.config = cfg; };
                }
                if (dep === 'sap/ui/model/Filter') {
                    return function(path, op, val) { this.path = path; this.op = op; this.val = val; };
                }
                if (dep === 'sap/ui/model/FilterOperator') {
                    return { Contains: 'Contains' };
                }
                return {};
            });
            if (callback) callback(...mocks);
        },
        model: {
            json: {
                JSONModel: MockJSONModel
            }
        },
        core: {
            routing: {
                History: mockHistory
            }
        }
    }
};

// Require controller to execute sap.ui.define
require('../../../app/fiori-app/webapp/modules/wm/goods-receipt/controller/GoodsReceipt.controller.js');

describe('GoodsReceipt Controller Unit Tests', () => {
    let controller;

    beforeEach(() => {
        jest.clearAllMocks();
        controller = new GoodsReceiptController();
        controller.onInit();
    });

    afterEach(() => {
        controller.onExit();
    });

    describe('Initialization & State', () => {
        it('should initialize grView model with default values and attach hardware scanner', () => {
            const oModel = controller.getView().getModel('grView');
            expect(oModel).toBeDefined();
            expect(oModel.getProperty('/storageUnitBarcode')).toBe('');
            expect(oModel.getProperty('/hasActiveSU')).toBe(false);
            expect(oModel.getProperty('/audioEnabled')).toBe(true);
            expect(mockBarcodeScanService.attachHardwareScanner).toHaveBeenCalled();
            expect(mockGoodsReceiptService.fetchOpenInboundDeliveries).toHaveBeenCalled();
        });

        it('should toggle audio cues', () => {
            controller.onToggleAudio();
            const oModel = controller.getView().getModel('grView');
            expect(oModel.getProperty('/audioEnabled')).toBe(false);
            expect(mockMessageToast.show).toHaveBeenCalledWith('Audio cues muted');

            controller.onToggleAudio();
            expect(oModel.getProperty('/audioEnabled')).toBe(true);
            expect(mockMessageToast.show).toHaveBeenCalledWith('Audio cues enabled');
        });

        it('should reset workflow state on onResetWorkflow', () => {
            const oModel = controller.getView().getModel('grView');
            oModel.setProperty('/storageUnitBarcode', '180000001');
            oModel.setProperty('/hasActiveSU', true);

            controller.onResetWorkflow();
            expect(oModel.getProperty('/storageUnitBarcode')).toBe('');
            expect(oModel.getProperty('/hasActiveSU')).toBe(false);
            expect(mockMessageToast.show).toHaveBeenCalledWith('Workflow reset');
        });

        it('should navigate back on onNavBack', () => {
            if (typeof global.window === 'undefined') {
                global.window = {};
            }
            if (!global.window.history) {
                global.window.history = { go: jest.fn() };
            }
            const originalGo = global.window.history.go;
            global.window.history.go = jest.fn();

            controller.onNavBack();
            expect(global.window.history.go).toHaveBeenCalledWith(-1);

            global.window.history.go = originalGo;
        });
    });

    describe('Barcode Scanning & Storage Unit Resolution', () => {
        const mockSUData = {
            StorageUnit: '180000001',
            DeliveryDocument: '180000001',
            DeliveryDocumentItem: '000010',
            PurchaseOrder: '400000011',
            PurchaseOrderItem: '00010',
            Material: '1000000045',
            MaterialName: '2,2’-Dinitrobenzyl',
            Plant: '1120',
            PlantName: 'Genesis',
            StorageLocation: 'CS01',
            StorageLocationName: 'Raw Material Store',
            WarehouseStorageBin: 'BIN-01',
            Batch: 'IN25000133',
            ExpiryDate: '2026-12-31',
            BatchStatusState: 'Success',
            BatchStatusText: 'VALID',
            Quantity: 10,
            Unit: 'KG',
            Supplier: '200001',
            SupplierName: 'Dowpol Chemical International Corp.',
            SupplierCityName: 'Pudong',
            AvailableStorageLocations: [
                { StorageLocation: 'CS01', StorageLocationName: 'Raw Material Store', WarehouseStorageBin: 'BIN-01' },
                { StorageLocation: 'CS02', StorageLocationName: 'Overflow Store', WarehouseStorageBin: 'BIN-02' }
            ],
            AvailableBatches: [
                { Batch: 'IN25000133', ExpiryDate: '2026-12-31', StatusState: 'Success', StatusText: 'VALID' }
            ]
        };

        it('should show error when scanning with empty input', () => {
            controller.onScanStorageUnit();
            expect(mockMessageBox.error).toHaveBeenCalledWith('Please scan or enter a Storage Unit Number.');
        });

        it('should resolve Storage Unit and auto-populate form on successful scan', async () => {
            mockGoodsReceiptService.resolveStorageUnit.mockResolvedValueOnce(mockSUData);

            const oModel = controller.getView().getModel('grView');
            oModel.setProperty('/storageUnitBarcode', '180000001');

            await controller.onScanStorageUnit();

            expect(mockGoodsReceiptService.resolveStorageUnit).toHaveBeenCalledWith('180000001');
            expect(oModel.getProperty('/hasActiveSU')).toBe(true);
            expect(oModel.getProperty('/activeSU/StorageUnit')).toBe('180000001');
            expect(oModel.getProperty('/activeSU/Material')).toBe('1000000045');
            expect(oModel.getProperty('/activeSU/MaterialName')).toBe('2,2’-Dinitrobenzyl');
            expect(oModel.getProperty('/activeSU/Plant')).toBe('1120');
            expect(oModel.getProperty('/activeSU/StorageLocation')).toBe('CS01');
            expect(oModel.getProperty('/activeSU/Batch')).toBe('IN25000133');
            expect(oModel.getProperty('/activeSU/BatchStatusState')).toBe('Success');
            expect(mockMessageToast.show).toHaveBeenCalledWith(expect.stringContaining('resolved from SAP'));
        });

        it('should handle hardware laser scanner event and resolve Storage Unit', async () => {
            mockGoodsReceiptService.resolveStorageUnit.mockResolvedValueOnce(mockSUData);

            expect(capturedHardwareScannerHandler).toBeDefined();
            capturedHardwareScannerHandler('180000001');

            const oModel = controller.getView().getModel('grView');
            expect(oModel.getProperty('/storageUnitBarcode')).toBe('180000001');
        });

        it('should handle camera scanner callback and resolve Storage Unit', () => {
            mockGoodsReceiptService.resolveStorageUnit.mockResolvedValueOnce(mockSUData);

            controller.onCameraScanStorageUnit();
            expect(mockBarcodeScanService.openCameraScanner).toHaveBeenCalled();

            // Simulate camera scan callback
            const callback = mockBarcodeScanService.openCameraScanner.mock.calls[0][1];
            callback('180000001');

            const oModel = controller.getView().getModel('grView');
            expect(oModel.getProperty('/storageUnitBarcode')).toBe('180000001');
        });

        it('should handle Inbound Delivery dropdown selection and trigger resolve', () => {
            mockGoodsReceiptService.resolveStorageUnit.mockResolvedValueOnce(mockSUData);

            const mockEvent = {
                getParameter: (p) => (p === 'selectedItem' ? { getKey: () => '180000001' } : null)
            };

            controller.onSelectInboundDelivery(mockEvent);
            const oModel = controller.getView().getModel('grView');
            expect(oModel.getProperty('/storageUnitBarcode')).toBe('180000001');
        });

        it('should open Storage Unit Value Help dialog and handle item selection', () => {
            const oModel = controller.getView().getModel('grView');
            oModel.setProperty('/openDeliveries', [
                { DeliveryDocument: '180000001', Material: '1000000045', MaterialName: '2,2’-Dinitrobenzyl', SupplierName: 'Dowpol' }
            ]);

            controller.onStorageUnitValueHelp();
            expect(controller._oSUValueHelpDialog).toBeDefined();
            expect(controller._oSUValueHelpDialog.open).toHaveBeenCalled();

            // Simulate confirm selection
            mockGoodsReceiptService.resolveStorageUnit.mockResolvedValueOnce(mockSUData);
            const mockConfirmEvt = {
                getParameter: (p) => (p === 'selectedItem' ? { getTitle: () => '180000001' } : null)
            };
            controller._oSUValueHelpDialog.config.confirm(mockConfirmEvt);
            expect(oModel.getProperty('/storageUnitBarcode')).toBe('180000001');
        });

        it('should display error message box when Storage Unit resolution fails', async () => {
            mockGoodsReceiptService.resolveStorageUnit.mockRejectedValueOnce(
                new Error("Storage Unit '999999' not found in SAP S/4HANA (Client 220).")
            );

            const oModel = controller.getView().getModel('grView');
            oModel.setProperty('/storageUnitBarcode', '999999');

            await controller.onScanStorageUnit();

            expect(oModel.getProperty('/hasActiveSU')).toBe(false);
            expect(mockMessageBox.error).toHaveBeenCalledWith(expect.stringContaining('not found in SAP S/4HANA'), expect.any(Object));
        });
    });

    describe('Field Changes & SLED Expiry Handling', () => {
        beforeEach(async () => {
            const mockSUData = {
                StorageUnit: '180000001',
                DeliveryDocument: '180000001',
                Material: '1000000045',
                Plant: '1120',
                StorageLocation: 'CS01',
                StorageLocationName: 'Raw Material Store',
                WarehouseStorageBin: 'BIN-01',
                Batch: 'IN25000133',
                ExpiryDate: '2026-12-31',
                BatchStatusState: 'Success',
                BatchStatusText: 'VALID',
                AvailableStorageLocations: [
                    { StorageLocation: 'CS01', StorageLocationName: 'Raw Material Store', WarehouseStorageBin: 'BIN-01' },
                    { StorageLocation: 'CS02', StorageLocationName: 'Overflow Store', WarehouseStorageBin: 'BIN-02' }
                ],
                AvailableBatches: [
                    { Batch: 'IN25000133', ExpiryDate: '2026-12-31', StatusState: 'Success', StatusText: 'VALID' },
                    { Batch: 'EXPIRED_B', ExpiryDate: '2020-01-01', StatusState: 'Error', StatusText: 'EXPIRED' }
                ]
            };
            mockGoodsReceiptService.resolveStorageUnit.mockResolvedValueOnce(mockSUData);
            controller.getView().getModel('grView').setProperty('/storageUnitBarcode', '180000001');
            await controller.onScanStorageUnit();
        });

        it('should update StorageLocation and Bin when user selects a different SLoc', () => {
            const mockEvent = {
                getParameter: (p) => (p === 'selectedItem' ? { getKey: () => 'CS02' } : null)
            };
            controller.onStorageLocationChange(mockEvent);

            const oModel = controller.getView().getModel('grView');
            expect(oModel.getProperty('/activeSU/StorageLocation')).toBe('CS02');
            expect(oModel.getProperty('/activeSU/StorageLocationName')).toBe('Overflow Store');
            expect(oModel.getProperty('/activeSU/WarehouseStorageBin')).toBe('BIN-02');
        });

        it('should block selection of expired batch with hard-stop error dialog', () => {
            const mockEvent = {
                getParameter: (p) => (p === 'selectedItem' ? { getKey: () => 'EXPIRED_B' } : null)
            };
            controller.onBatchChange(mockEvent);

            expect(mockMessageBox.error).toHaveBeenCalledWith(
                expect.stringContaining('expired on 2020-01-01'),
                expect.objectContaining({ title: 'Expired Batch Blocked' })
            );

            // Verify active batch remains unchanged
            const oModel = controller.getView().getModel('grView');
            expect(oModel.getProperty('/activeSU/Batch')).toBe('IN25000133');
        });
    });

    describe('Goods Receipt Posting (101)', () => {
        beforeEach(async () => {
            const mockSUData = {
                StorageUnit: '180000001',
                DeliveryDocument: '180000001',
                Material: '1000000045',
                Plant: '1120',
                StorageLocation: 'CS01',
                Batch: 'IN25000133',
                ExpiryDate: '2026-12-31',
                BatchStatusState: 'Success',
                BatchStatusText: 'VALID',
                Quantity: 10
            };
            mockGoodsReceiptService.resolveStorageUnit.mockResolvedValueOnce(mockSUData);
            controller.getView().getModel('grView').setProperty('/storageUnitBarcode', '180000001');
            await controller.onScanStorageUnit();
        });

        it('should block onPostGoodsReceipt when quantity is zero or invalid', () => {
            const oModel = controller.getView().getModel('grView');
            oModel.setProperty('/activeSU/Quantity', 0);

            controller.onPostGoodsReceipt();
            expect(mockMessageBox.error).toHaveBeenCalledWith('Quantity must be greater than zero.');
            expect(mockMessageBox.confirm).not.toHaveBeenCalled();
        });

        it('should block onPostGoodsReceipt when batch is expired', () => {
            const oModel = controller.getView().getModel('grView');
            oModel.setProperty('/activeSU/BatchStatusState', 'Error');
            oModel.setProperty('/activeSU/BatchStatusText', 'EXPIRED');

            controller.onPostGoodsReceipt();
            expect(mockMessageBox.error).toHaveBeenCalledWith(
                expect.stringContaining('Goods Receipt blocked: Batch IN25000133 has expired'),
                expect.objectContaining({ title: 'Expired Batch Blocked' })
            );
            expect(mockMessageBox.confirm).not.toHaveBeenCalled();
        });

        it('should open confirmation dialog and execute Goods Receipt on user approval', async () => {
            mockGoodsReceiptService.postGoodsReceipt.mockResolvedValueOnce({
                Success: true,
                Message: 'Goods Receipt posted successfully in SAP for Delivery 180000001'
            });

            // Simulate user clicking YES on confirmation dialog
            mockMessageBox.confirm.mockImplementationOnce((msg, opts) => {
                opts.onClose('YES');
            });

            await controller.onPostGoodsReceipt();

            expect(mockMessageBox.confirm).toHaveBeenCalledWith(
                expect.stringContaining('Post Goods Receipt (101) in SAP for Storage Unit 180000001'),
                expect.any(Object)
            );
            expect(mockGoodsReceiptService.postGoodsReceipt).toHaveBeenCalledWith(
                expect.objectContaining({
                    StorageUnit: '180000001',
                    DeliveryDocument: '180000001',
                    Material: '1000000045',
                    Plant: '1120',
                    StorageLocation: 'CS01',
                    Batch: 'IN25000133',
                    Quantity: 10
                })
            );
            expect(mockMessageBox.success).toHaveBeenCalledWith(
                expect.stringContaining('Goods Receipt posted successfully in SAP'),
                expect.any(Object)
            );
        });

        it('should handle backend error on posting and display error dialog', async () => {
            mockGoodsReceiptService.postGoodsReceipt.mockRejectedValueOnce(
                new Error('SAP S/4HANA Backend Posting Capability Error: 501 Not Implemented')
            );

            mockMessageBox.confirm.mockImplementationOnce((msg, opts) => {
                opts.onClose('YES');
            });

            await controller.onPostGoodsReceipt();

            expect(mockMessageBox.error).toHaveBeenCalledWith(
                expect.stringContaining('Goods Receipt Failed: SAP S/4HANA Backend Posting Capability Error')
            );
        });
    });
});
