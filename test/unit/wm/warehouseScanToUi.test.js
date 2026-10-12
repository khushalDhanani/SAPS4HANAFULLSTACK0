/**
 * Unit Tests for WarehouseScanTo Freestyle UI5 Main & Detail Controllers
 *
 * Verifies (mock only, not browser verification):
 * 1. Main Route ("wm/scan-to"):
 *    - Open TR list loading directly on the page
 *    - Barcode input submit / lookup navigating to detail route wm/scan-to/{docType}/{number}
 *    - Open TR row press navigating to detail route wm/scan-to/TR/{Tbnum}
 *    - Value help selection navigating to detail route
 *    - Hardware and camera scanners triggering navigation
 *    - Invalid scan error handling
 *    - Main back button navigating to dashboard
 * 2. Detail Route ("wm/scan-to/{docType}/{number}"):
 *    - Route pattern parsing and loading data from number alone (direct URL, refresh, bookmark)
 *    - Invalid document number (non-digits, >10 digits) showing clear error state with no blank page
 *    - Invalid docType showing clear error state with no blank page
 *    - Detail back button with browser history fallback (history.go(-1) vs navTo wmWarehouseScanTo)
 *    - Each fixed button:
 *      * btnSetMaxQty (Max Qty button)
 *      * btnApplyFifoBatch (Apply FIFO batch)
 *      * onSelectBatchSuggestion (Select batch in FIFO table)
 *      * onSuggestionBatchSelected (Select batch suggestion in input)
 *      * btnAutoFillSerials (Auto-fill series button)
 *      * onAddSuggestedSerial (Clickable serial chip)
 *      * btnAddSerial (Add serial button)
 *      * onRemoveSerial (Remove serial button)
 *      * btnReset (Cancel button)
 *      * btnProcessTO (Create & Confirm TO button)
 *      * btnRetryMigo (Retry MIGO button)
 *      * btnScanNextTR (Scan Next TR button navigating to main list)
 */

let WarehouseScanToController;
let WarehouseScanToDetailController;

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
            cb('1000027');
        }
    })
};

const mockWarehouseScanToService = {
    getOpenTRs: jest.fn().mockResolvedValue([
        { Tbnum: '0001001839', DisplayText: 'TR 1001839', Description: 'Raw Material Transfer' }
    ]),
    lookupTR: jest.fn(),
    createTOFromTR: jest.fn(),
    postMigoGoodsMovement: jest.fn()
};

let sMockPreviousHash = undefined;
const mockHistoryInstance = {
    getPreviousHash: jest.fn(() => sMockPreviousHash)
};
const mockHistory = {
    getInstance: jest.fn(() => mockHistoryInstance)
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

describe('WarehouseScanTo UI: Main & Detail Controllers [mock only, not browser verification]', () => {

    beforeAll(() => {
        global.window = global.window || {};
        global.window.history = {
            go: jest.fn()
        };

        const BaseController = {
            extend: (name, proto) => {
                const ctor = function () {
                    Object.assign(this, proto);
                };
                if (name.endsWith('WarehouseScanToDetail')) {
                    WarehouseScanToDetailController = ctor;
                } else {
                    WarehouseScanToController = ctor;
                }
                return ctor;
            },
            prototype: {
                onNavBack: jest.fn(function (sFallback) {
                    const oHist = mockHistory.getInstance();
                    const sPrev = oHist.getPreviousHash();
                    if (sPrev !== undefined) {
                        global.window.history.go(-1);
                    } else {
                        const r = this.getRouter();
                        if (r) r.navTo(sFallback, {}, true);
                    }
                })
            }
        };

        global.sap = {
            ui: {
                define: (deps, factory) => {
                    if (deps.includes('sap/ui/core/routing/History')) {
                        // WarehouseScanToDetail
                        factory(
                            BaseController,
                            MockJSONModel,
                            mockMessageBox,
                            mockMessageToast,
                            mockHistory,
                            mockBarcodeScanService,
                            mockWarehouseScanToService
                        );
                    } else {
                        // WarehouseScanTo
                        factory(
                            BaseController,
                            MockJSONModel,
                            { load: jest.fn() },
                            mockMessageToast,
                            jest.fn(function (opts) { Object.assign(this, opts); }),
                            { Contains: 'Contains' },
                            mockBarcodeScanService,
                            mockWarehouseScanToService
                        );
                    }
                },
                core: {
                    routing: {
                        History: mockHistory
                    }
                },
                model: {
                    Filter: jest.fn(function (opts) { Object.assign(this, opts); }),
                    FilterOperator: { Contains: 'Contains' }
                }
            }
        };

        require('../../../app/fiori-app/webapp/modules/wm/warehouse-scan-to/controller/WarehouseScanTo.controller.js');
        require('../../../app/fiori-app/webapp/modules/wm/warehouse-scan-to/controller/WarehouseScanToDetail.controller.js');
    });

    describe('A. Main Controller (WarehouseScanTo) [mock only, not browser verification]', () => {
        let mainCtrl;
        let mainModel;
        let mockRouter;
        let mockRoute;

        beforeEach(() => {
            jest.clearAllMocks();

            mockRoute = { attachPatternMatched: jest.fn() };
            mockRouter = {
                getRoute: jest.fn().mockReturnValue(mockRoute),
                navTo: jest.fn()
            };

            mainCtrl = new WarehouseScanToController();
            const modelStore = {};
            mainCtrl.setModel = jest.fn((m, name) => { modelStore[name || ''] = m; });
            mainCtrl.getModel = jest.fn((name) => modelStore[name || '']);
            mainCtrl.getRouter = jest.fn().mockReturnValue(mockRouter);
            mainCtrl.byId = jest.fn().mockReturnValue({ focus: jest.fn() });
            mainCtrl.getView = jest.fn().mockReturnValue({
                getId: () => 'mainViewId',
                addDependent: jest.fn()
            });
            mainCtrl.getText = jest.fn((key, args) => args && args.length ? `${key}: ${args.join(', ')}` : key);

            mainCtrl.onInit();
            mainModel = mainCtrl.getModel('scanView');
        });

        it('initializes default model values correctly', () => {
            expect(mainModel.getProperty('/lgnum')).toBe('');
            expect(mainModel.getProperty('/docType')).toBe('TR');
            expect(mainModel.getProperty('/scannedTR')).toBe('');
            expect(mainModel.getProperty('/audioEnabled')).toBe(true);
            expect(mainModel.getProperty('/openTRs')).toEqual([]);
            expect(mainModel.getProperty('/isLoadingTRs')).toBe(false);
        });

        it('attaches pattern matched listener to router on init', () => {
            expect(mockRouter.getRoute).toHaveBeenCalledWith('wmWarehouseScanTo');
            expect(mockRoute.attachPatternMatched).toHaveBeenCalledWith(expect.any(Function), mainCtrl);
        });

        it('attaches hardware scanner and loads open TRs on route matched', async () => {
            mainCtrl._onRouteMatched();
            expect(mockBarcodeScanService.attachHardwareScanner).toHaveBeenCalledWith(expect.any(Function));
            await mainCtrl._loadOpenTRs();
            expect(mockWarehouseScanToService.getOpenTRs).toHaveBeenCalledWith('');
            expect(mainModel.getProperty('/openTRs').length).toBe(1);
        });

        it('detaches hardware scanner on exit', () => {
            mainCtrl.onExit();
            expect(mockBarcodeScanService.detachHardwareScanner).toHaveBeenCalled();
        });

        it('navigates to detail route wmWarehouseScanToDetail on TR lookup submit [mock only, not browser verification]', async () => {
            mainModel.setProperty('/scannedTR', '0001001839');
            mainModel.setProperty('/docType', 'TR');

            await mainCtrl.onLookupTR();

            expect(mockRouter.navTo).toHaveBeenCalledWith('wmWarehouseScanToDetail', {
                docType: 'TR',
                number: '0001001839'
            });
        });

        it('extracts barcode prefix (RES) and navigates to detail route with docType RES [mock only, not browser verification]', async () => {
            mainModel.setProperty('/scannedTR', 'RES 525866');

            await mainCtrl.onLookupTR();

            expect(mockRouter.navTo).toHaveBeenCalledWith('wmWarehouseScanToDetail', {
                docType: 'RES',
                number: '525866'
            });
        });

        it('shows warning when scanning empty TR without navigating', async () => {
            mainModel.setProperty('/scannedTR', '');
            await mainCtrl.onLookupTR();

            expect(mainModel.getProperty('/hasMessage')).toBe(true);
            expect(mainModel.getProperty('/messageType')).toBe('Warning');
            expect(mockRouter.navTo).not.toHaveBeenCalled();
        });

        it('shows error for non-numeric scan without navigating', async () => {
            mainModel.setProperty('/scannedTR', 'INVALID-SCAN');
            await mainCtrl.onLookupTR();

            expect(mainModel.getProperty('/hasMessage')).toBe(true);
            expect(mainModel.getProperty('/messageType')).toBe('Error');
            expect(mockRouter.navTo).not.toHaveBeenCalled();
        });

        it('row press in open TR list navigates to detail route [mock only, not browser verification]', () => {
            mainCtrl.onOpenTRPress({
                getParameter: () => null,
                getSource: () => ({ getBindingContext: () => ({ getProperty: () => '1000800' }) })
            });

            expect(mockRouter.navTo).toHaveBeenCalledWith('wmWarehouseScanToDetail', {
                docType: 'TR',
                number: '1000800'
            });
        });

        it('value help selection navigates to detail route [mock only, not browser verification]', () => {
            mainCtrl.onConfirmTRValueHelp({
                getParameter: () => ({
                    getBindingContext: () => ({ getProperty: () => '1000027' }),
                    getTitle: () => 'TR 1000027'
                })
            });

            expect(mockRouter.navTo).toHaveBeenCalledWith('wmWarehouseScanToDetail', {
                docType: 'TR',
                number: '1000027'
            });
        });

        it('camera scan triggers lookup and navigates to detail route [mock only, not browser verification]', () => {
            mainCtrl.onCameraScanTR();
            expect(mockBarcodeScanService.openCameraScanner).toHaveBeenCalled();
            expect(mockRouter.navTo).toHaveBeenCalledWith('wmWarehouseScanToDetail', {
                docType: 'TR',
                number: '1000027'
            });
        });

        it('hardware scan triggers lookup and navigates to detail route [mock only, not browser verification]', () => {
            mainCtrl._onHardwareScan('1000027');
            expect(mockRouter.navTo).toHaveBeenCalledWith('wmWarehouseScanToDetail', {
                docType: 'TR',
                number: '1000027'
            });
        });

        it('main onNavBack navigates to dashboard [mock only, not browser verification]', () => {
            sMockPreviousHash = undefined;
            mainCtrl.onNavBack();
            expect(mockRouter.navTo).toHaveBeenCalledWith('dashboard', {}, true);
        });
    });

    describe('B. Detail Controller (WarehouseScanToDetail) [mock only, not browser verification]', () => {
        let detailCtrl;
        let detailModel;
        let mockRouter;
        let mockRoute;

        beforeEach(() => {
            jest.clearAllMocks();
            sMockPreviousHash = undefined;

            mockRoute = { attachPatternMatched: jest.fn() };
            mockRouter = {
                getRoute: jest.fn().mockReturnValue(mockRoute),
                navTo: jest.fn()
            };

            detailCtrl = new WarehouseScanToDetailController();
            const modelStore = {};
            detailCtrl.setModel = jest.fn((m, name) => { modelStore[name || ''] = m; });
            detailCtrl.getModel = jest.fn((name) => modelStore[name || '']);
            detailCtrl.getRouter = jest.fn().mockReturnValue(mockRouter);
            detailCtrl.byId = jest.fn().mockReturnValue({ focus: jest.fn() });
            detailCtrl.getView = jest.fn().mockReturnValue({
                getId: () => 'detailViewId',
                addDependent: jest.fn()
            });
            detailCtrl.getText = jest.fn((key, args) => args && args.length ? `${key}: ${args.join(', ')}` : key);

            detailCtrl.onInit();
            detailModel = detailCtrl.getModel('scanView');
        });

        it('initializes detail model state and binds route wmWarehouseScanToDetail', () => {
            expect(mockRouter.getRoute).toHaveBeenCalledWith('wmWarehouseScanToDetail');
            expect(mockRoute.attachPatternMatched).toHaveBeenCalledWith(expect.any(Function), detailCtrl);
            expect(detailModel.getProperty('/hasTR')).toBe(false);
            expect(detailModel.getProperty('/autoConfirm')).toBe(true);
            expect(detailModel.getProperty('/autoPostMigo')).toBe(true);
            expect(detailModel.getProperty('/canSubmit')).toBe(false);
        });

        it('route parse: loads TR data from number alone on direct URL / refresh / bookmark [mock only, not browser verification]', async () => {
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

            const mockEvent = {
                getParameter: jest.fn((param) => {
                    if (param === 'arguments') return { docType: 'TR', number: '0001001839' };
                    return null;
                })
            };

            await detailCtrl._onRouteMatched(mockEvent);

            expect(mockWarehouseScanToService.lookupTR).toHaveBeenCalledWith('0001001839', '', 'TR', '');
            expect(detailModel.getProperty('/hasTR')).toBe(true);
            expect(detailModel.getProperty('/tr/Material')).toBe('1000000156');
            expect(detailModel.getProperty('/pickQty')).toBe(25.5);
            expect(detailModel.getProperty('/canSubmit')).toBe(true);
            expect(detailModel.getProperty('/hasMessage')).toBe(false);
        });

        it('route parse: loads reservation data from number alone [mock only, not browser verification]', async () => {
            mockWarehouseScanToService.lookupTR.mockResolvedValueOnce({
                WarehouseNumber: 'W01',
                TransferRequirement: '1000790',
                TRNumber: '1000790',
                TRItem: '0001',
                Material: '8900000004',
                OpenQty: 10,
                Unit: 'KG'
            });

            const mockEvent = {
                getParameter: jest.fn((param) => {
                    if (param === 'arguments') return { docType: 'RES', number: '525866' };
                    return null;
                })
            };

            await detailCtrl._onRouteMatched(mockEvent);

            expect(mockWarehouseScanToService.lookupTR).toHaveBeenCalledWith('525866', '', 'RES', '');
            expect(detailModel.getProperty('/hasTR')).toBe(true);
            expect(detailModel.getProperty('/docType')).toBe('TR');
        });

        it('invalid number (letters or >10 digits): sets clear error state, no blank page [mock only, not browser verification]', async () => {
            const mockEvent = {
                getParameter: jest.fn((param) => {
                    if (param === 'arguments') return { docType: 'TR', number: 'INVALID123456' };
                    return null;
                })
            };

            await detailCtrl._onRouteMatched(mockEvent);

            expect(mockWarehouseScanToService.lookupTR).not.toHaveBeenCalled();
            expect(detailModel.getProperty('/hasTR')).toBe(false);
            expect(detailModel.getProperty('/tr')).toBeNull();
            expect(detailModel.getProperty('/hasMessage')).toBe(true);
            expect(detailModel.getProperty('/messageType')).toBe('Error');
            expect(detailModel.getProperty('/messageText')).toContain('scanToErrNotANumber');
            expect(detailModel.getProperty('/canSubmit')).toBe(false);
        });

        it('invalid docType: sets clear error state, no blank page [mock only, not browser verification]', async () => {
            const mockEvent = {
                getParameter: jest.fn((param) => {
                    if (param === 'arguments') return { docType: 'PO', number: '1000027' };
                    return null;
                })
            };

            await detailCtrl._onRouteMatched(mockEvent);

            expect(mockWarehouseScanToService.lookupTR).not.toHaveBeenCalled();
            expect(detailModel.getProperty('/hasTR')).toBe(false);
            expect(detailModel.getProperty('/hasMessage')).toBe(true);
            expect(detailModel.getProperty('/messageType')).toBe('Error');
            expect(detailModel.getProperty('/messageText')).toContain('scanToErrSelectDocType');
        });

        it('direct URL lookup failure (404): sets clear error state, no blank page [mock only, not browser verification]', async () => {
            mockWarehouseScanToService.lookupTR.mockRejectedValueOnce(new Error('TR 999999 not found'));

            const mockEvent = {
                getParameter: jest.fn((param) => {
                    if (param === 'arguments') return { docType: 'TR', number: '999999' };
                    return null;
                })
            };

            await detailCtrl._onRouteMatched(mockEvent);

            expect(detailModel.getProperty('/hasTR')).toBe(false);
            expect(detailModel.getProperty('/hasMessage')).toBe(true);
            expect(detailModel.getProperty('/messageType')).toBe('Error');
            expect(detailModel.getProperty('/messageText')).toContain('TR 999999 not found');
            expect(detailModel.getProperty('/canSubmit')).toBe(false);
        });

        it('back button: uses browser history fallback when previous hash exists [mock only, not browser verification]', () => {
            sMockPreviousHash = 'wm/scan-to';
            detailCtrl.onNavBack();
            expect(global.window.history.go).toHaveBeenCalledWith(-1);
            expect(mockRouter.navTo).not.toHaveBeenCalled();
        });

        it('back button: navigates to wmWarehouseScanTo when direct URL / no previous history [mock only, not browser verification]', () => {
            sMockPreviousHash = undefined;
            detailCtrl.onNavBack();
            expect(mockRouter.navTo).toHaveBeenCalledWith('wmWarehouseScanTo', {}, true);
        });

        it('fixed button: btnScanNextTR navigates to wmWarehouseScanTo [mock only, not browser verification]', () => {
            detailCtrl.onScanNextTR();
            expect(mockRouter.navTo).toHaveBeenCalledWith('wmWarehouseScanTo', {}, true);
        });

        it('fixed button: btnSetMaxQty sets pick quantity to full open TR amount [mock only, not browser verification]', () => {
            detailModel.setProperty('/hasTR', true);
            detailModel.setProperty('/tr', { TRItem: '0001', OpenQty: 50, IsBatchManaged: false, IsSerialManaged: false });
            detailModel.setProperty('/pickQty', 5);

            detailCtrl.onSetMaxQty();

            expect(detailModel.getProperty('/pickQty')).toBe(50);
            expect(detailModel.getProperty('/qtyValueState')).toBe('None');
            expect(detailModel.getProperty('/canSubmit')).toBe(true);
        });

        it('fixed button: btnApplyFifoBatch applies recommended FIFO batch [mock only, not browser verification]', () => {
            detailModel.setProperty('/hasTR', true);
            detailModel.setProperty('/tr', { TRItem: '0001', OpenQty: 10, IsBatchManaged: true });
            detailModel.setProperty('/pickQty', 10);
            detailModel.setProperty('/fifoBatch', 'FIFO-B1');
            detailModel.setProperty('/suggestedBatches', [
                { Batch: 'FIFO-B1', StorageType: 'RM1', StorageBin: '0-L0001-01' }
            ]);

            detailCtrl.onApplyFifoBatch();

            expect(detailModel.getProperty('/batch')).toBe('FIFO-B1');
            expect(detailModel.getProperty('/sourceStorageType')).toBe('RM1');
            expect(detailModel.getProperty('/sourceStorageBin')).toBe('0-L0001-01');
            expect(detailModel.getProperty('/isFifoApplied')).toBe(true);
            expect(detailModel.getProperty('/canSubmit')).toBe(true);
        });

        it('fixed button: onSelectBatchSuggestion selects batch from FIFO table [mock only, not browser verification]', () => {
            detailModel.setProperty('/hasTR', true);
            detailModel.setProperty('/tr', { TRItem: '0001', OpenQty: 10, IsBatchManaged: true });
            detailModel.setProperty('/pickQty', 10);
            detailModel.setProperty('/fifoBatch', 'FIFO-B1');

            const mockEvent = {
                getSource: () => ({
                    getBindingContext: () => ({
                        getProperty: (prop) => (prop === 'Batch' ? 'FIFO-B2' : (prop === 'StorageType' ? 'RM2' : '0-L0002-01'))
                    })
                })
            };

            detailCtrl.onSelectBatchSuggestion(mockEvent);

            expect(detailModel.getProperty('/batch')).toBe('FIFO-B2');
            expect(detailModel.getProperty('/sourceStorageType')).toBe('RM2');
            expect(detailModel.getProperty('/sourceStorageBin')).toBe('0-L0002-01');
            expect(detailModel.getProperty('/canSubmit')).toBe(true);
        });

        it('fixed button: onSuggestionBatchSelected applies batch from input suggestions [mock only, not browser verification]', () => {
            detailModel.setProperty('/hasTR', true);
            detailModel.setProperty('/tr', { TRItem: '0001', OpenQty: 10, IsBatchManaged: true });
            detailModel.setProperty('/pickQty', 10);
            detailModel.setProperty('/suggestedBatches', [
                { Batch: 'SUGG-99', StorageType: 'EN1', StorageBin: '0-L0001-02' }
            ]);

            detailCtrl.onSuggestionBatchSelected({
                getParameter: () => ({ getKey: () => 'SUGG-99', getText: () => 'SUGG-99' })
            });

            expect(detailModel.getProperty('/batch')).toBe('SUGG-99');
            expect(detailModel.getProperty('/sourceStorageType')).toBe('EN1');
            expect(detailModel.getProperty('/sourceStorageBin')).toBe('0-L0001-02');
            expect(detailModel.getProperty('/canSubmit')).toBe(true);
        });

        it('fixed button: btnAutoFillSerials auto-fills serial series up to pickQty [mock only, not browser verification]', () => {
            detailModel.setProperty('/hasTR', true);
            detailModel.setProperty('/tr', { TRItem: '0001', OpenQty: 2, IsSerialManaged: true });
            detailModel.setProperty('/pickQty', 2);
            detailModel.setProperty('/suggestedSerials', ['SER-001', 'SER-002', 'SER-003']);
            detailModel.setProperty('/serials', []);

            detailCtrl.onAutoFillSerials();

            const serials = detailModel.getProperty('/serials');
            expect(serials).toHaveLength(2);
            expect(serials.map(s => s.serial)).toEqual(['SER-001', 'SER-002']);
            expect(detailModel.getProperty('/serialsStatusState')).toBe('Success');
            expect(detailModel.getProperty('/canSubmit')).toBe(true);
        });

        it('fixed button: onAddSuggestedSerial adds clicked stock serial chip [mock only, not browser verification]', () => {
            detailModel.setProperty('/hasTR', true);
            detailModel.setProperty('/tr', { TRItem: '0001', OpenQty: 1, IsSerialManaged: true });
            detailModel.setProperty('/pickQty', 1);
            detailModel.setProperty('/serials', []);

            detailCtrl.onAddSuggestedSerial({
                getSource: () => ({ getText: () => 'SER-CHIP-1' })
            });

            const serials = detailModel.getProperty('/serials');
            expect(serials).toHaveLength(1);
            expect(serials[0].serial).toBe('SER-CHIP-1');
            expect(detailModel.getProperty('/canSubmit')).toBe(true);
        });

        it('fixed button: btnAddSerial adds entered serial and prevents duplicate [mock only, not browser verification]', () => {
            detailModel.setProperty('/hasTR', true);
            detailModel.setProperty('/tr', { TRItem: '0001', OpenQty: 2, IsSerialManaged: true });
            detailModel.setProperty('/pickQty', 2);
            detailModel.setProperty('/serials', []);

            detailModel.setProperty('/serialInput', 'SN-100');
            detailCtrl.onAddSerial();
            expect(detailModel.getProperty('/serials')).toHaveLength(1);

            detailModel.setProperty('/serialInput', 'SN-100');
            detailCtrl.onAddSerial();
            expect(detailModel.getProperty('/serials')).toHaveLength(1);
            expect(mockMessageToast.show).toHaveBeenCalledWith(expect.stringContaining('scanToErrSerialDuplicate'));
        });

        it('fixed button: onRemoveSerial removes serial and updates status [mock only, not browser verification]', () => {
            detailModel.setProperty('/hasTR', true);
            detailModel.setProperty('/tr', { TRItem: '0001', OpenQty: 2, IsSerialManaged: true });
            detailModel.setProperty('/pickQty', 2);
            detailModel.setProperty('/serials', [{ index: 1, serial: 'SN-1' }, { index: 2, serial: 'SN-2' }]);

            detailCtrl.onRemoveSerial({
                getSource: () => ({
                    getParent: () => ({
                        getBindingContext: () => ({ getPath: () => '/serials/0' })
                    })
                })
            });

            expect(detailModel.getProperty('/serials')).toHaveLength(1);
            expect(detailModel.getProperty('/serials')[0].serial).toBe('SN-2');
            expect(detailModel.getProperty('/canSubmit')).toBe(false);
        });

        it('fixed button: btnProcessTO creates TO, presents result panel and auto-confirms [mock only, not browser verification]', async () => {
            detailModel.setProperty('/hasTR', true);
            detailModel.setProperty('/tr', {
                TRNumber: '1000800',
                TRItem: '0001',
                Material: '1000000204',
                MaterialDescription: 'Chemical Solvent',
                OpenQty: 10,
                Unit: 'KG',
                IsBatchManaged: false,
                IsSerialManaged: false
            });
            detailModel.setProperty('/pickQty', 10);
            detailModel.setProperty('/sourceStorageType', 'RM1');
            detailModel.setProperty('/sourceStorageBin', '0-L0001-00');
            detailCtrl._validateForm();

            mockWarehouseScanToService.createTOFromTR.mockResolvedValueOnce({
                TransferOrder: '1037293',
                ConfirmationNumber: '1037293',
                Status: '05',
                IsConfirmed: true,
                ConfirmedBy: 'SAP_OPERATOR',
                MaterialDocument: '4900050130',
                MaterialDocYear: '2026',
                StockEffect: 'Stock posted'
            });

            await detailCtrl.onProcessTO();

            expect(mockWarehouseScanToService.createTOFromTR).toHaveBeenCalledWith({
                lgnum: '',
                tbnum: '1000800',
                tbpos: '0001',
                qty: 10,
                unit: 'KG',
                batch: '',
                serials: [],
                autoConfirm: true,
                autoPostMigo: true,
                CompleteReservation: false,
                sourceStorageType: 'RM1',
                sourceStorageBin: '0-L0001-00',
                storageUnit: ''
            });

            expect(detailModel.getProperty('/hasResult')).toBe(true);
            expect(detailModel.getProperty('/result/TransferOrder')).toBe('1037293');
            expect(detailModel.getProperty('/result/MaterialDocument')).toBe('4900050130');
            expect(detailModel.getProperty('/hasTR')).toBe(false);
        });

        it('fixed button: btnRetryMigo recovers failed goods movement to status 05 [mock only, not browser verification]', async () => {
            detailModel.setProperty('/result', {
                TransferOrder: '1037290',
                ReservationNo: '525866',
                ReservationItem: '0001',
                MovementType: '311',
                Material: '8000009753',
                Quantity: 1,
                Unit: 'EA',
                Status: '90'
            });
            detailModel.setProperty('/canRetryMigo', true);

            mockWarehouseScanToService.postMigoGoodsMovement.mockResolvedValueOnce({
                MaterialDocument: '4900050135',
                MaterialDocYear: '2026',
                Status: '05'
            });

            await detailCtrl.onRetryMigo();

            expect(mockWarehouseScanToService.postMigoGoodsMovement).toHaveBeenCalled();
            expect(detailModel.getProperty('/canRetryMigo')).toBe(false);
            expect(detailModel.getProperty('/result/MaterialDocument')).toBe('4900050135');
            expect(detailModel.getProperty('/result/Status')).toBe('05');
        });
    });
});
