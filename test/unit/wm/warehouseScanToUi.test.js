/**
 * Unit Tests for WarehouseScanTo Freestyle UI5 App & Controller (Chunk 4: App 2)
 *
 * Verifies:
 * 1. View model initialization, defaults (autoConfirm=true, lgnum='W01')
 * 2. Hardware and camera scanning integration
 * 3. Transfer Requirement (TR) lookup and details population
 * 4. Pick quantity check against open TR quantity
 * 5. Dynamic batch capture requirement when material is batch-managed
 * 6. Dynamic serial number scanning, duplicate check, and count validation
 * 7. Transfer Order creation and Auto-Confirm orchestration (Status 04)
 * 8. Error handling, reset, and next scan workflow
 */

let WarehouseScanToController;

const mockMessageBox = {
    error: jest.fn(),
    success: jest.fn()
};

const mockMessageToast = {
    show: jest.fn()
};

const mockBarcodeScanService = {
    attachHardwareScanner: jest.fn(),
    detachHardwareScanner: jest.fn(),
    openCameraScanner: jest.fn((title, cb) => {
        if (typeof cb === 'function') {
            cb('SCANNED_123');
        }
    })
};

const mockWarehouseScanToService = {
    getOpenTRs: jest.fn().mockResolvedValue([
        { Tbnum: '0001001839', DisplayText: 'TR 1001839', Description: 'Raw Material Transfer' }
    ]),
    lookupTR: jest.fn(),
    createTOFromTR: jest.fn()
};

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

describe('WarehouseScanTo UI Controller (Chunk 4: Step 2 App)', () => {
    let controller;
    let viewModel;
    let mockRouter;
    let mockRoute;

    beforeAll(() => {
        global.window = global.window || {};
        global.sap = {
            ui: {
                define: (deps, factory) => {
                    const BaseController = {
                        extend: (name, proto) => {
                            WarehouseScanToController = function () {
                                Object.assign(this, proto);
                            };
                            return WarehouseScanToController;
                        }
                    };
                    factory(
                        BaseController,
                        MockJSONModel,
                        { load: jest.fn() },
                        mockMessageBox,
                        mockMessageToast,
                        jest.fn(function (opts) { Object.assign(this, opts); }),
                        { Contains: 'Contains' },
                        mockBarcodeScanService,
                        mockWarehouseScanToService
                    );
                },
                model: {
                    Filter: jest.fn(function (opts) { Object.assign(this, opts); }),
                    FilterOperator: { Contains: 'Contains' }
                }
            }
        };

        require('../../../app/fiori-app/webapp/modules/wm/warehouse-scan-to/controller/WarehouseScanTo.controller.js');
    });

    beforeEach(() => {
        jest.clearAllMocks();

        mockRoute = {
            attachPatternMatched: jest.fn()
        };
        mockRouter = {
            getRoute: jest.fn().mockReturnValue(mockRoute),
            navTo: jest.fn()
        };

        controller = new WarehouseScanToController();

        const modelStore = {};
        controller.setModel = jest.fn((m, name) => {
            modelStore[name || ''] = m;
        });
        controller.getModel = jest.fn((name) => modelStore[name || '']);
        controller.getRouter = jest.fn().mockReturnValue(mockRouter);
        controller.byId = jest.fn().mockReturnValue({ focus: jest.fn() });
        controller.getView = jest.fn().mockReturnValue({
            getId: () => 'viewId',
            addDependent: jest.fn()
        });
        controller.getText = jest.fn((key, args) => {
            if (args && args.length) {
                return `${key}: ${args.join(', ')}`;
            }
            return key;
        });

        controller.onInit();
        viewModel = controller.getModel('scanView');
    });

    describe('1. Initialization & State Defaults', () => {
        it('initializes default model values correctly', () => {
            expect(viewModel.getProperty('/lgnum')).toBe('W01');
            expect(viewModel.getProperty('/autoConfirm')).toBe(true);
            expect(viewModel.getProperty('/audioEnabled')).toBe(true);
            expect(viewModel.getProperty('/hasTR')).toBe(false);
            expect(viewModel.getProperty('/canSubmit')).toBe(false);
            expect(viewModel.getProperty('/serials')).toEqual([]);
            expect(viewModel.getProperty('/scannedTR')).toBe('');
        });

        it('attaches pattern matched listener to router on init', () => {
            expect(mockRouter.getRoute).toHaveBeenCalledWith('wmWarehouseScanTo');
            expect(mockRoute.attachPatternMatched).toHaveBeenCalledWith(expect.any(Function), controller);
        });
    });

    describe('2. Hardware & Camera Scanner Handling', () => {
        it('attaches hardware scanner on route matched', () => {
            controller._onRouteMatched();
            expect(mockBarcodeScanService.attachHardwareScanner).toHaveBeenCalledWith(expect.any(Function));
        });

        it('detaches hardware scanner on exit', () => {
            controller.onExit();
            expect(mockBarcodeScanService.detachHardwareScanner).toHaveBeenCalled();
        });

        it('handles hardware scan for TR when no TR is loaded', () => {
            const lookupSpy = jest.spyOn(controller, 'onLookupTR').mockImplementation(() => {});
            controller._onHardwareScan('0001001839');

            expect(viewModel.getProperty('/scannedTR')).toBe('0001001839');
            expect(lookupSpy).toHaveBeenCalled();
        });

        it('handles hardware scan as serial when TR is loaded and material is serial-managed', () => {
            viewModel.setProperty('/hasTR', true);
            viewModel.setProperty('/tr', { IsSerialManaged: true, OpenQty: 3 });
            viewModel.setProperty('/pickQty', 3);

            const addSerialSpy = jest.spyOn(controller, 'onAddSerial').mockImplementation(() => {});
            controller._onHardwareScan('SER-99901');

            expect(viewModel.getProperty('/serialInput')).toBe('SER-99901');
            expect(addSerialSpy).toHaveBeenCalled();
        });

        it('opens camera scanner for TR scan and triggers lookup', () => {
            const lookupSpy = jest.spyOn(controller, 'onLookupTR').mockImplementation(() => {});
            controller.onCameraScanTR();

            expect(mockBarcodeScanService.openCameraScanner).toHaveBeenCalled();
            expect(viewModel.getProperty('/scannedTR')).toBe('SCANNED_123');
            expect(lookupSpy).toHaveBeenCalled();
        });
    });

    describe('3. TR Lookup (onLookupTR)', () => {
        it('shows warning when scanning empty TR', () => {
            viewModel.setProperty('/scannedTR', '');
            controller.onLookupTR();

            expect(viewModel.getProperty('/hasMessage')).toBe(true);
            expect(viewModel.getProperty('/messageType')).toBe('Warning');
            expect(mockWarehouseScanToService.lookupTR).not.toHaveBeenCalled();
        });

        it('successfully loads standard non-batch TR and initializes pick quantity', async () => {
            mockWarehouseScanToService.lookupTR.mockResolvedValueOnce({
                WarehouseNumber: 'W01',
                TRNumber: '0001001839',
                TRItem: '0001',
                Material: '1000000156',
                MaterialDescription: 'Raw Chemical A',
                OpenQty: 25.5,
                TargetQty: 30.0,
                Unit: 'KG',
                IsBatchManaged: false,
                IsSerialManaged: false,
                Batch: ''
            });

            viewModel.setProperty('/scannedTR', '0001001839');
            await controller.onLookupTR();

            expect(viewModel.getProperty('/hasTR')).toBe(true);
            expect(viewModel.getProperty('/tr/Material')).toBe('1000000156');
            expect(viewModel.getProperty('/pickQty')).toBe(25.5);
            expect(viewModel.getProperty('/canSubmit')).toBe(true);
            expect(mockMessageToast.show).toHaveBeenCalledWith('scanToMsgTRLoaded');
        });

        it('displays error message when TR lookup fails or rejects', async () => {
            mockWarehouseScanToService.lookupTR.mockRejectedValueOnce(new Error('TR not found in warehouse W01'));

            viewModel.setProperty('/scannedTR', '9999999999');
            await controller.onLookupTR();

            expect(viewModel.getProperty('/hasTR')).toBe(false);
            expect(viewModel.getProperty('/hasMessage')).toBe(true);
            expect(viewModel.getProperty('/messageType')).toBe('Error');
            expect(viewModel.getProperty('/messageText')).toContain('TR not found');
        });
    });

    describe('4. Pick Quantity Validation & Max Qty Setting', () => {
        beforeEach(() => {
            viewModel.setProperty('/hasTR', true);
            viewModel.setProperty('/tr', {
                OpenQty: 10,
                IsBatchManaged: false,
                IsSerialManaged: false
            });
            viewModel.setProperty('/pickQty', 10);
        });

        it('sets error state when pick quantity is zero or negative', () => {
            controller.onPickQtyChange({ getParameter: () => '0' });

            expect(viewModel.getProperty('/qtyValueState')).toBe('Error');
            expect(viewModel.getProperty('/canSubmit')).toBe(false);
        });

        it('sets error state when pick quantity exceeds open TR quantity', () => {
            controller.onPickQtyChange({ getParameter: () => '15' });

            expect(viewModel.getProperty('/qtyValueState')).toBe('Error');
            expect(viewModel.getProperty('/canSubmit')).toBe(false);
        });

        it('resets to valid state when set to max open quantity', () => {
            viewModel.setProperty('/pickQty', 5);
            controller.onSetMaxQty();

            expect(viewModel.getProperty('/pickQty')).toBe(10);
            expect(viewModel.getProperty('/qtyValueState')).toBe('None');
            expect(viewModel.getProperty('/canSubmit')).toBe(true);
        });
    });

    describe('5. Batch Management Validation', () => {
        beforeEach(() => {
            viewModel.setProperty('/hasTR', true);
            viewModel.setProperty('/tr', {
                OpenQty: 10,
                IsBatchManaged: true,
                IsSerialManaged: false
            });
            viewModel.setProperty('/pickQty', 10);
            viewModel.setProperty('/batch', '');
        });

        it('blocks submission when batch is empty for batch-managed material', () => {
            controller._validateForm();
            expect(viewModel.getProperty('/canSubmit')).toBe(false);
        });

        it('enables submission when valid batch is supplied', () => {
            controller.onBatchLiveChange({ getParameter: () => 'BATCH-2026-A' });
            expect(viewModel.getProperty('/batch')).toBe('BATCH-2026-A');
            expect(viewModel.getProperty('/batchValueState')).toBe('None');
            expect(viewModel.getProperty('/canSubmit')).toBe(true);
        });
    });

    describe('6. Serial Number Capture & Validation', () => {
        beforeEach(() => {
            viewModel.setProperty('/hasTR', true);
            viewModel.setProperty('/tr', {
                OpenQty: 3,
                IsBatchManaged: false,
                IsSerialManaged: true
            });
            viewModel.setProperty('/pickQty', 3);
            viewModel.setProperty('/serials', []);
        });

        it('blocks submission until scanned serial count equals pick quantity', () => {
            controller._validateForm();
            expect(viewModel.getProperty('/canSubmit')).toBe(false);
        });

        it('adds scanned serials and updates counter status', () => {
            viewModel.setProperty('/serialInput', 'SN-001');
            controller.onAddSerial();

            expect(viewModel.getProperty('/serials').length).toBe(1);
            expect(viewModel.getProperty('/serialsStatusState')).toBe('Warning');
            expect(viewModel.getProperty('/canSubmit')).toBe(false);

            viewModel.setProperty('/serialInput', 'SN-002');
            controller.onAddSerial();
            viewModel.setProperty('/serialInput', 'SN-003');
            controller.onAddSerial();

            expect(viewModel.getProperty('/serials').length).toBe(3);
            expect(viewModel.getProperty('/serialsStatusState')).toBe('Success');
            expect(viewModel.getProperty('/canSubmit')).toBe(true);
        });

        it('prevents adding duplicate serial number', () => {
            viewModel.setProperty('/serialInput', 'SN-DUPLICATE');
            controller.onAddSerial();

            viewModel.setProperty('/serialInput', 'SN-DUPLICATE');
            controller.onAddSerial();

            expect(viewModel.getProperty('/serials').length).toBe(1);
            expect(mockMessageToast.show).toHaveBeenCalledWith(expect.stringContaining('scanToErrSerialDuplicate'));
        });

        it('removes serial and recalculates status', () => {
            viewModel.setProperty('/serialInput', 'SN-A');
            controller.onAddSerial();
            viewModel.setProperty('/serialInput', 'SN-B');
            controller.onAddSerial();

            // Mock remove event from row 0
            const mockEvent = {
                getSource: () => ({
                    getParent: () => ({
                        getBindingContext: () => ({
                            getPath: () => '/serials/0'
                        })
                    })
                })
            };

            controller.onRemoveSerial(mockEvent);

            const remaining = viewModel.getProperty('/serials');
            expect(remaining.length).toBe(1);
            expect(remaining[0].serial).toBe('SN-B');
            expect(remaining[0].index).toBe(1);
        });
    });

    describe('7. Transfer Order Processing (onProcessTO) & Auto-Confirm', () => {
        beforeEach(() => {
            viewModel.setProperty('/hasTR', true);
            viewModel.setProperty('/tr', {
                TRNumber: '0001001839',
                TRItem: '0001',
                OpenQty: 5,
                Unit: 'KG',
                IsBatchManaged: false,
                IsSerialManaged: false
            });
            viewModel.setProperty('/pickQty', 5);
            viewModel.setProperty('/autoConfirm', true);
            controller._validateForm();
        });

        it('calls createTOFromTR with autoConfirm=true and presents confirmed result', async () => {
            mockWarehouseScanToService.createTOFromTR.mockResolvedValueOnce({
                TransferOrder: '1012970',
                ConfirmationNumber: '0001',
                WarehouseNumber: 'W01',
                Status: '04 (TO Confirmed)',
                IsConfirmed: true,
                ConfirmedBy: 'SAP_OPERATOR'
            });

            await controller.onProcessTO();

            expect(mockWarehouseScanToService.createTOFromTR).toHaveBeenCalledWith({
                lgnum: 'W01',
                tbnum: '0001001839',
                tbpos: '0001',
                qty: 5,
                unit: 'KG',
                batch: '',
                serials: [],
                autoConfirm: true,
                storageUnit: ''
            });

            expect(viewModel.getProperty('/hasResult')).toBe(true);
            expect(viewModel.getProperty('/result/TransferOrder')).toBe('1012970');
            expect(viewModel.getProperty('/result/IsConfirmed')).toBe(true);
            expect(viewModel.getProperty('/hasTR')).toBe(false);
            expect(mockMessageToast.show).toHaveBeenCalledWith(expect.stringContaining('1012970'));
        });

        it('handles createTOFromTR failure gracefully via MessageBox.error', async () => {
            mockWarehouseScanToService.createTOFromTR.mockRejectedValueOnce(new Error('SAP Lock error'));

            await controller.onProcessTO();

            expect(mockMessageBox.error).toHaveBeenCalledWith('SAP Lock error');
            expect(viewModel.getProperty('/canSubmit')).toBe(true);
        });
    });

    describe('8. Reset & Next Scan Flow', () => {
        it('clears all TR, batch, serials, and result state on reset', () => {
            viewModel.setProperty('/hasResult', true);
            viewModel.setProperty('/hasTR', true);
            viewModel.setProperty('/batch', 'BATCH-1');
            viewModel.setProperty('/serials', [{ index: 1, serial: 'S1' }]);

            controller.onReset();

            expect(viewModel.getProperty('/hasResult')).toBe(false);
            expect(viewModel.getProperty('/hasTR')).toBe(false);
            expect(viewModel.getProperty('/batch')).toBe('');
            expect(viewModel.getProperty('/serials')).toEqual([]);
            expect(viewModel.getProperty('/scannedTR')).toBe('');
        });

        it('toggles audio enabled state', () => {
            expect(viewModel.getProperty('/audioEnabled')).toBe(true);
            controller.onToggleAudio();
            expect(viewModel.getProperty('/audioEnabled')).toBe(false);
            controller.onToggleAudio();
            expect(viewModel.getProperty('/audioEnabled')).toBe(true);
        });
    });
});
