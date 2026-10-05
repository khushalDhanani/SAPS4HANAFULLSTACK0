/* global window */
/**
 * Unit Tests for TrTo Controller (Zebra MC220 RF Screen 9001 / Tcode ZTO)
 */

let TrToController;
const mockMessageBox = {
    error: jest.fn(),
    success: jest.fn((msg, opts) => {
        if (opts && typeof opts.onClose === 'function') {
            opts.onClose();
        }
    }),
    warning: jest.fn(),
    information: jest.fn()
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

const mockTrToService = {
    getOpenTRs: jest.fn().mockResolvedValue([
        { Tbnum: '0001000663', Bwlvs: '319', DisplayText: 'TR 1000663' }
    ]),
    getTR: jest.fn(),
    getAvailableSUs: jest.fn().mockResolvedValue([
        { StorageUnit: '1000041635', Material: '1000000156', AvailableStock: 1620.0 }
    ]),
    checkSU: jest.fn(),
    createTO: jest.fn()
};

const mockDialog = {
    open: jest.fn(),
    destroy: jest.fn()
};
const mockFragment = {
    load: jest.fn().mockResolvedValue(mockDialog)
};

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

let capturedHardwareScannerHandler = null;
const mockBarcodeScanService = {
    attachHardwareScanner: jest.fn((fn) => { capturedHardwareScannerHandler = fn; }),
    detachHardwareScanner: jest.fn(() => { capturedHardwareScannerHandler = null; }),
    openCameraScanner: jest.fn((title, cb) => cb && cb('1000043935'))
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
                getModel: (n) => this.models[n],
                setModel: (m, n) => { this.models[n] = m; },
                setBusy: jest.fn(),
                addDependent: jest.fn()
            });
            this.getModel = (n) => this.models[n] || (this.getView() && this.getView().getModel(n)) || null;
            this.setModel = (m, n) => { this.models[n] = m; };
            this.getRouter = () => mockRouter;
            this.byId = jest.fn().mockReturnValue({ focus: jest.fn() });
            this.getText = (k) => k;
        }
        return Controller;
    }
};

global.sap = {
    ui: {
        define: (deps, factory) => {
            TrToController = factory(
                mockBaseController,
                MockJSONModel,
                mockMessageBox,
                mockMessageToast,
                mockFragment,
                MockFilter,
                MockFilterOperator,
                mockTrToService,
                mockBarcodeScanService
            );
        }
    }
};

if (typeof global.window === 'undefined') {
    global.window = {
        addEventListener: jest.fn(),
        removeEventListener: jest.fn()
    };
}

require('../../../app/fiori-app/webapp/modules/wm/tr-to/controller/TrTo.controller');

describe('TrTo Controller Unit Tests (Zebra MC220 RF Screen 9001)', () => {
    let controller;

    beforeEach(() => {
        jest.clearAllMocks();
        controller = new TrToController();
        controller.onInit();
    });

    afterEach(() => {
        if (controller.onExit) {
            controller.onExit();
        }
    });

    describe('Initialization & Model State', () => {
        it('should initialize view model with defaults for warehouse W01', () => {
            const model = controller.getModel('trToView');
            expect(model).toBeDefined();
            expect(model.getProperty('/warehouse')).toBe('W01');
            expect(model.getProperty('/hasActiveTR')).toBe(false);
            expect(model.getProperty('/hasActiveSU')).toBe(false);
            expect(model.getProperty('/canCreateTO')).toBe(false);
            expect(model.getProperty('/openQty')).toBe('0.000');
            expect(model.getProperty('/scanQty')).toBe('0.000');
            expect(model.getProperty('/confirmImmediate')).toBeUndefined(); // create only, as ZTO
            expect(model.getProperty('/stepBadgeText')).toBe('1. ENTER TR');
        });

        it('should register route pattern listener in onInit', () => {
            expect(mockRouter.getRoute).toHaveBeenCalledWith('wmTrTo');
        });
    });

    describe('Hardware Scanner & Lifecycle Listeners', () => {
        it('should attach scanner and keyboard listeners on route matched', () => {
            const addEventSpy = jest.spyOn(window, 'addEventListener');
            controller._onRouteMatched();

            expect(mockBarcodeScanService.attachHardwareScanner).toHaveBeenCalled();
            expect(addEventSpy).toHaveBeenCalledWith('keydown', expect.any(Function), true);
            addEventSpy.mockRestore();
        });

        it('should detach scanner and keyboard listeners on exit', () => {
            const removeEventSpy = jest.spyOn(window, 'removeEventListener');
            controller.onExit();

            expect(mockBarcodeScanService.detachHardwareScanner).toHaveBeenCalled();
            expect(removeEventSpy).toHaveBeenCalledWith('keydown', expect.any(Function), true);
            removeEventSpy.mockRestore();
        });
    });

    describe('Physical F-Key Accelerators (Zebra MC220 Keypad)', () => {
        it('F1 / 112 should clear all input fields', () => {
            const clearSpy = jest.spyOn(controller, 'onClearAll');
            const event = { key: 'F1', keyCode: 112, preventDefault: jest.fn(), stopPropagation: jest.fn() };

            controller._onPhysicalKeyDown(event);
            expect(event.preventDefault).toHaveBeenCalled();
            expect(event.stopPropagation).toHaveBeenCalled();
            expect(clearSpy).toHaveBeenCalled();
        });

        it('F2 / 113 should trigger create TO when canCreateTO is true', () => {
            const createSpy = jest.spyOn(controller, 'onCreateTO').mockImplementation();
            controller.getModel('trToView').setProperty('/canCreateTO', true);

            const event = { key: 'F2', keyCode: 113, preventDefault: jest.fn(), stopPropagation: jest.fn() };
            controller._onPhysicalKeyDown(event);

            expect(event.preventDefault).toHaveBeenCalled();
            expect(createSpy).toHaveBeenCalled();
        });

        it('F2 should NOT trigger create TO when canCreateTO is false', () => {
            const createSpy = jest.spyOn(controller, 'onCreateTO').mockImplementation();
            controller.getModel('trToView').setProperty('/canCreateTO', false);

            const event = { key: 'F2', keyCode: 113, preventDefault: jest.fn(), stopPropagation: jest.fn() };
            controller._onPhysicalKeyDown(event);

            expect(createSpy).not.toHaveBeenCalled();
        });

        it('F3 / 114 should navigate back to dashboard', () => {
            const backSpy = jest.spyOn(controller, 'onNavBack');
            const event = { key: 'F3', keyCode: 114, preventDefault: jest.fn(), stopPropagation: jest.fn() };

            controller._onPhysicalKeyDown(event);
            expect(event.preventDefault).toHaveBeenCalled();
            expect(backSpy).toHaveBeenCalled();
        });
    });

    describe('Laser Barcode Scan Routing', () => {
        it('should route first scan to TR field when no TR is active', () => {
            const fetchSpy = jest.spyOn(controller, 'onFetchTR').mockImplementation();
            controller.getModel('trToView').setProperty('/hasActiveTR', false);

            controller._onHardwareScan('0001000663');
            expect(controller.getModel('trToView').getProperty('/trNumber')).toBe('0001000663');
            expect(fetchSpy).toHaveBeenCalled();
        });

        it('should route subsequent scan to SU field when TR is active', () => {
            const scanSuSpy = jest.spyOn(controller, 'onScanSU').mockImplementation();
            controller.getModel('trToView').setProperty('/hasActiveTR', true);

            controller._onHardwareScan('1000043935');
            expect(controller.getModel('trToView').getProperty('/storageUnit')).toBe('1000043935');
            expect(scanSuSpy).toHaveBeenCalled();
        });
    });

    describe('Step 1: Fetch TR (onFetchTR)', () => {
        it('should show warning if TR number is empty', () => {
            controller.getModel('trToView').setProperty('/trNumber', '');
            controller.onFetchTR();

            const model = controller.getModel('trToView');
            expect(model.getProperty('/hasMessage')).toBe(true);
            expect(model.getProperty('/messageType')).toBe('Warning');
            expect(mockTrToService.getTR).not.toHaveBeenCalled();
        });

        it('should successfully populate view model when TR exists', async () => {
            const mockTR = {
                Tbnum: '0001000663',
                Items: [
                    {
                        Tbpos: '0001',
                        Material: '1000000867',
                        MaterialDesc: 'Semi-Finished Steel Bar',
                        Batch: 'B01',
                        OpenQty: 17323.2,
                        Unit: 'KG',
                        DestStorageBin: 'PROD-01',
                        DestStorageType: '100'
                    }
                ]
            };
            mockTrToService.getTR.mockResolvedValue(mockTR);

            controller.getModel('trToView').setProperty('/trNumber', '0001000663');
            await controller.onFetchTR();

            const model = controller.getModel('trToView');
            expect(model.getProperty('/hasActiveTR')).toBe(true);
            expect(model.getProperty('/material')).toBe('1000000867');
            expect(model.getProperty('/openQty')).toBe('17323.200');
            expect(model.getProperty('/destBin')).toBe('PROD-01');
            expect(model.getProperty('/stepBadgeText')).toBe('2. SCAN SU');
            expect(model.getProperty('/stepBadgeState')).toBe('Information');
        });

        it('should handle TR not found error gracefully', async () => {
            mockTrToService.getTR.mockRejectedValue(new Error('TR 99999 not found in warehouse W01'));

            controller.getModel('trToView').setProperty('/trNumber', '99999');
            await controller.onFetchTR();

            const model = controller.getModel('trToView');
            expect(model.getProperty('/hasActiveTR')).toBe(false);
            expect(model.getProperty('/hasMessage')).toBe(true);
            expect(model.getProperty('/messageType')).toBe('Error');
            expect(model.getProperty('/messageText')).toContain('TR 99999 not found');
        });
    });

    describe('Step 2: Validate Storage Unit (onScanSU)', () => {
        beforeEach(() => {
            const model = controller.getModel('trToView');
            model.setProperty('/hasActiveTR', true);
            model.setProperty('/trNumber', '0001000663');
            model.setProperty('/openQty', '1000.000');
            model.setProperty('/unit', 'KG');
        });

        it('should show warning if SU barcode is empty', () => {
            controller.getModel('trToView').setProperty('/storageUnit', '');
            controller.onScanSU();

            const model = controller.getModel('trToView');
            expect(model.getProperty('/hasMessage')).toBe(true);
            expect(model.getProperty('/messageType')).toBe('Warning');
            expect(mockTrToService.checkSU).not.toHaveBeenCalled();
        });

        it('should successfully validate matching SU and propose quantity', async () => {
            const mockSU = {
                Lenum: '00000000001000043935',
                IsValid: true,
                Quants: [
                    {
                        Quant: '0001035375',
                        Material: '1000000867',
                        Batch: 'B01',
                        AvailableStock: 500.0
                    }
                ]
            };
            mockTrToService.checkSU.mockResolvedValue(mockSU);

            controller.getModel('trToView').setProperty('/storageUnit', '1000043935');
            await controller.onScanSU();

            const model = controller.getModel('trToView');
            expect(model.getProperty('/hasActiveSU')).toBe(true);
            expect(model.getProperty('/canCreateTO')).toBe(true);
            expect(model.getProperty('/scanQty')).toBe('500.000');
            expect(model.getProperty('/stepBadgeText')).toBe('3. READY TO CREATE');
            expect(model.getProperty('/stepBadgeState')).toBe('Success');
        });

        it('should handle invalid or mismatched SU', async () => {
            const mockSU = {
                Lenum: '1000099999',
                IsValid: false,
                ErrorCode: 'MATERIAL_MISMATCH',
                ErrorMessage: 'Material mismatch: SU contains MAT-B, TR requires MAT-A.'
            };
            mockTrToService.checkSU.mockResolvedValue(mockSU);

            controller.getModel('trToView').setProperty('/storageUnit', '1000099999');
            await controller.onScanSU();

            const model = controller.getModel('trToView');
            expect(model.getProperty('/hasActiveSU')).toBe(false);
            expect(model.getProperty('/canCreateTO')).toBe(false);
            expect(model.getProperty('/stepBadgeText')).toBe('INVALID SU');
            expect(model.getProperty('/messageType')).toBe('Error');
            expect(model.getProperty('/messageText')).toContain('Material mismatch');
        });
    });

    describe('Quantity Controls', () => {
        beforeEach(() => {
            controller.getModel('trToView').setProperty('/openQty', '100.000');
        });

        it('should disable create TO when entered quantity <= 0', () => {
            controller.onQtyChange({ getParameter: () => '0' });
            expect(controller.getModel('trToView').getProperty('/canCreateTO')).toBe(false);
        });

        it('should warn when entered quantity exceeds open quantity', () => {
            controller.onQtyChange({ getParameter: () => '150' });
            const model = controller.getModel('trToView');
            expect(model.getProperty('/canCreateTO')).toBe(true);
            expect(model.getProperty('/messageType')).toBe('Warning');
            expect(model.getProperty('/messageText')).toContain('exceeds open TR quantity');
        });

        it('onFillOpenQty should copy open quantity to scan quantity', () => {
            controller.onFillOpenQty();
            expect(controller.getModel('trToView').getProperty('/scanQty')).toBe('100.000');
        });
    });

    describe('Step 3: Create TO (onCreateTO)', () => {
        beforeEach(() => {
            const model = controller.getModel('trToView');
            model.setProperty('/warehouse', 'W01');
            model.setProperty('/trNumber', '0001000663');
            model.setProperty('/storageUnit', '1000043935');
            model.setProperty('/selectedItem', { Tbpos: '0001' });
            model.setProperty('/openQty', '100.000');
            model.setProperty('/scanQty', '50.000');
            model.setProperty('/unit', 'KG');
            model.setProperty('/confirmImmediate', true);
        });

        it('should reject when requested quantity exceeds open TR quantity', () => {
            controller.getModel('trToView').setProperty('/scanQty', '200.000');
            controller.onCreateTO();

            expect(mockTrToService.createTO).not.toHaveBeenCalled();
            expect(controller.getModel('trToView').getProperty('/messageType')).toBe('Error');
        });

        it('should call TrToService.createTO and display MessageBox.success on success', async () => {
            mockTrToService.createTO.mockResolvedValue({
                TransferOrder: '0001010943',
                Success: true,
                Confirmed: true
            });

            await controller.onCreateTO();

            expect(mockTrToService.createTO).toHaveBeenCalledWith({
                lgnum: 'W01',
                tbnum: '0001000663',
                lenum: '1000043935',
                qty: 50
            });
            expect(mockMessageBox.success).toHaveBeenCalledWith(
                'trToCreateSuccessConfirmed',
                expect.any(Object)
            );
        });

        it('should display MessageBox.error when backend rejects TO creation', async () => {
            mockTrToService.createTO.mockRejectedValue(new Error('Storage Unit blocked for stock removal'));

            await controller.onCreateTO();

            expect(mockMessageBox.error).toHaveBeenCalledWith(
                'Storage Unit blocked for stock removal',
                { title: 'trToCreateFailedTitle' }
            );
        });
    });

    describe('Clear All & Navigation', () => {
        it('onClearAll should reset all view model properties to initial state', () => {
            const model = controller.getModel('trToView');
            model.setProperty('/trNumber', '0001000663');
            model.setProperty('/storageUnit', '1000043935');
            model.setProperty('/hasActiveTR', true);
            model.setProperty('/canCreateTO', true);

            controller.onClearAll();

            expect(model.getProperty('/trNumber')).toBe('');
            expect(model.getProperty('/storageUnit')).toBe('');
            expect(model.getProperty('/hasActiveTR')).toBe(false);
            expect(model.getProperty('/canCreateTO')).toBe(false);
            expect(model.getProperty('/stepBadgeText')).toBe('1. ENTER TR');
        });

        it('onNavBack should clear fields and navigate to dashboard', () => {
            const clearSpy = jest.spyOn(controller, 'onClearAll');
            controller.onNavBack();

            expect(clearSpy).toHaveBeenCalled();
            expect(mockRouter.navTo).toHaveBeenCalledWith('dashboard');
        });
    });

    describe('Audio Toggle', () => {
        it('onToggleAudio should flip audioEnabled flag', () => {
            const model = controller.getModel('trToView');
            expect(model.getProperty('/audioEnabled')).toBe(true);

            controller.onToggleAudio();
            expect(model.getProperty('/audioEnabled')).toBe(false);
            expect(mockMessageToast.show).toHaveBeenCalledWith('trToAudioMuted');
        });
    });

    describe('Value Help for TR Selection', () => {
        it('onValueHelpTR should load open TRs and open the dialog', async () => {
            await controller.onValueHelpTR();
            expect(mockTrToService.getOpenTRs).toHaveBeenCalledWith('W01');
            expect(mockFragment.load).toHaveBeenCalledWith(expect.objectContaining({
                name: 'saps4hana.fiori.modules.wm.tr-to.view.TrSelectDialog'
            }));
            expect(mockDialog.open).toHaveBeenCalled();
            const model = controller.getModel('trToView');
            expect(model.getProperty('/openTRs')).toHaveLength(1);
        });

        it('onSearchTRValueHelp should apply filter when query is present', () => {
            const mockBinding = { filter: jest.fn() };
            const mockEvent = {
                getParameter: jest.fn((p) => p === 'value' ? '1000663' : null),
                getSource: () => ({ getBinding: () => mockBinding })
            };
            controller.onSearchTRValueHelp(mockEvent);
            expect(mockBinding.filter).toHaveBeenCalledWith(expect.any(MockFilter));
        });

        it('onSearchTRValueHelp should clear filter when query is empty', () => {
            const mockBinding = { filter: jest.fn() };
            const mockEvent = {
                getParameter: jest.fn(() => ''),
                getSource: () => ({ getBinding: () => mockBinding })
            };
            controller.onSearchTRValueHelp(mockEvent);
            expect(mockBinding.filter).toHaveBeenCalledWith([]);
        });

        it('onConfirmTRValueHelp should set TR number and trigger fetch', () => {
            const fetchSpy = jest.spyOn(controller, 'onFetchTR').mockImplementation(() => {});
            const mockEvent = {
                getParameter: jest.fn(() => ({
                    getBindingContext: () => ({
                        getProperty: (prop) => prop === 'Tbnum' ? '0001000663' : ''
                    })
                }))
            };
            controller.onConfirmTRValueHelp(mockEvent);
            expect(controller.getModel('trToView').getProperty('/trNumber')).toBe('1000663');
            expect(fetchSpy).toHaveBeenCalled();
        });

        it('onCancelTRValueHelp should reset items filter', () => {
            const mockBinding = { filter: jest.fn() };
            const mockEvent = {
                getSource: () => ({ getBinding: () => mockBinding })
            };
            controller.onCancelTRValueHelp(mockEvent);
            expect(mockBinding.filter).toHaveBeenCalledWith([]);
        });

        it('onExit should destroy select dialog if created', async () => {
            await controller.onValueHelpTR();
            expect(controller._oTrSelectDialog).toBe(mockDialog);
            controller.onExit();
            expect(mockDialog.destroy).toHaveBeenCalled();
            expect(controller._oTrSelectDialog).toBeNull();
        });
    });

    describe('Value Help & On-Page SU Selection', () => {
        it('onValueHelpSU should warn and not open dialog if no active TR', async () => {
            controller.getModel('trToView').setProperty('/hasActiveTR', false);
            await controller.onValueHelpSU();
            expect(mockDialog.open).not.toHaveBeenCalled();
            expect(controller.getModel('trToView').getProperty('/hasMessage')).toBe(true);
        });

        it('onValueHelpSU should load available SUs and open dialog if active TR', async () => {
            controller.getModel('trToView').setProperty('/hasActiveTR', true);
            controller.getModel('trToView').setProperty('/trNumber', '1000446');
            await controller.onValueHelpSU();
            expect(controller._oSuSelectDialog).toBe(mockDialog);
            expect(mockDialog.open).toHaveBeenCalled();
            expect(controller.getModel('trToView').getProperty('/availableSUs')).toHaveLength(1);
        });

        it('onSearchSUValueHelp should apply filter when query is present', () => {
            const mockBinding = { filter: jest.fn() };
            const mockEvent = {
                getParameter: () => '1000041635',
                getSource: () => ({ getBinding: () => mockBinding })
            };
            controller.onSearchSUValueHelp(mockEvent);
            expect(mockBinding.filter).toHaveBeenCalledWith(expect.any(Object));
        });

        it('onSearchSUValueHelp should clear filter when query is empty', () => {
            const mockBinding = { filter: jest.fn() };
            const mockEvent = {
                getParameter: () => '',
                getSource: () => ({ getBinding: () => mockBinding })
            };
            controller.onSearchSUValueHelp(mockEvent);
            expect(mockBinding.filter).toHaveBeenCalledWith([]);
        });

        it('onConfirmSUValueHelp should set storageUnit and trigger scanSU', () => {
            const scanSpy = jest.spyOn(controller, 'onScanSU').mockImplementation(() => {});
            const mockEvent = {
                getParameter: jest.fn(() => ({
                    getBindingContext: () => ({
                        getProperty: (prop) => prop === 'StorageUnit' ? '1000041635' : ''
                    })
                }))
            };
            controller.onConfirmSUValueHelp(mockEvent);
            expect(controller.getModel('trToView').getProperty('/storageUnit')).toBe('1000041635');
            expect(scanSpy).toHaveBeenCalled();
        });

        it('onCancelSUValueHelp should reset items filter', () => {
            const mockBinding = { filter: jest.fn() };
            const mockEvent = {
                getSource: () => ({ getBinding: () => mockBinding })
            };
            controller.onCancelSUValueHelp(mockEvent);
            expect(mockBinding.filter).toHaveBeenCalledWith([]);
        });

        it('onSelectSUFromTable should set storageUnit from table item and trigger scanSU', () => {
            const scanSpy = jest.spyOn(controller, 'onScanSU').mockImplementation(() => {});
            const mockEvent = {
                getParameter: jest.fn(() => ({
                    getBindingContext: () => ({
                        getProperty: (prop) => prop === 'StorageUnit' ? '1000041635' : ''
                    })
                }))
            };
            controller.onSelectSUFromTable(mockEvent);
            expect(controller.getModel('trToView').getProperty('/storageUnit')).toBe('1000041635');
            expect(scanSpy).toHaveBeenCalled();
        });

        it('onSelectSUButton should set storageUnit from button context and trigger scanSU', () => {
            const scanSpy = jest.spyOn(controller, 'onScanSU').mockImplementation(() => {});
            const mockEvent = {
                getSource: () => ({
                    getBindingContext: () => ({
                        getProperty: (prop) => prop === 'StorageUnit' ? '1000041636' : ''
                    })
                })
            };
            controller.onSelectSUButton(mockEvent);
            expect(controller.getModel('trToView').getProperty('/storageUnit')).toBe('1000041636');
            expect(scanSpy).toHaveBeenCalled();
        });

        it('onRefreshAvailableSUs should reload available SUs', async () => {
            controller.getModel('trToView').setProperty('/trNumber', '1000446');
            const res = await controller.onRefreshAvailableSUs();
            expect(res).toHaveLength(1);
            expect(mockTrToService.getAvailableSUs).toHaveBeenCalled();
        });

        it('onExit should destroy SuSelectDialog if created', async () => {
            controller.getModel('trToView').setProperty('/hasActiveTR', true);
            controller.getModel('trToView').setProperty('/trNumber', '1000446');
            await controller.onValueHelpSU();
            expect(controller._oSuSelectDialog).toBe(mockDialog);
            controller.onExit();
            expect(mockDialog.destroy).toHaveBeenCalled();
            expect(controller._oSuSelectDialog).toBeNull();
        });
    });
});
