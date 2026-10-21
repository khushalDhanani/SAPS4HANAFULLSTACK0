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
const fs = require('fs');
const path = require('path');

let WarehouseScanToController;
let WarehouseScanToDetailController;

let mockCurrentUserName = 'KHUSHAL';
const mockAuthService = {
    getCurrentUserName: jest.fn(() => mockCurrentUserName)
};

const origSapDefine = global.sap && global.sap.ui && global.sap.ui.define;
let recentScanStoreFactory;
global.sap = global.sap || { ui: {} };
global.sap.ui = global.sap.ui || {};
global.sap.ui.define = (deps, factory) => { recentScanStoreFactory = factory; };
require('../../../app/fiori-app/webapp/modules/wm/warehouse-scan-to/model/RecentScanStore.js');
const RecentScanStore = recentScanStoreFactory(mockAuthService);
if (origSapDefine) {
    global.sap.ui.define = origSapDefine;
}

const mockMessageBox = {
    error: jest.fn(),
    success: jest.fn(),
    warning: jest.fn()
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

        const mockSelectDialog = jest.fn(function (opts) {
            Object.assign(this, opts);
            this.addItem = jest.fn();
            this.open = jest.fn();
            this.destroy = jest.fn();
            this.attachAfterClose = jest.fn((cb) => { this._afterCloseCb = cb; });
        });
        const mockStandardListItem = jest.fn(function (opts) {
            Object.assign(this, opts);
            this.data = jest.fn((key, val) => {
                if (val !== undefined) {
                    this._data = this._data || {};
                    this._data[key] = val;
                }
                return this._data ? this._data[key] : undefined;
            });
        });

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
                            mockWarehouseScanToService,
                            mockSelectDialog,
                            mockStandardListItem,
                            RecentScanStore
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
                            mockWarehouseScanToService,
                            RecentScanStore
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

        const rowCtx = (fields) => ({ getProperty: (name) => fields[name] });

        it('row press in open TR list opens the TR in the warehouse of that row (no warehouse question) [mock only, not browser verification]', () => {
            mainCtrl.onOpenTRPress({
                getParameter: () => null,
                getSource: () => ({ getBindingContext: () => rowCtx({ Tbnum: '1000800', Lgnum: 'W13' }) })
            });

            expect(mockRouter.navTo).toHaveBeenCalledWith('wmWarehouseScanToDetailWithWh', {
                lgnum: 'W13',
                docType: 'TR',
                number: '1000800'
            });
        });

        it('row press without a warehouse on the row still navigates to the warehouse-less detail route [mock only, not browser verification]', () => {
            mainCtrl.onOpenTRPress({
                getParameter: () => null,
                getSource: () => ({ getBindingContext: () => rowCtx({ Tbnum: '1000800' }) })
            });

            expect(mockRouter.navTo).toHaveBeenCalledWith('wmWarehouseScanToDetail', {
                docType: 'TR',
                number: '1000800'
            });
        });

        it('value help selection opens the TR in the warehouse of the selected row [mock only, not browser verification]', () => {
            mainCtrl.onConfirmTRValueHelp({
                getParameter: () => ({
                    getBindingContext: () => rowCtx({ Tbnum: '1000027', Lgnum: 'W01' }),
                    getTitle: () => 'TR 1000027'
                })
            });

            expect(mockRouter.navTo).toHaveBeenCalledWith('wmWarehouseScanToDetailWithWh', {
                lgnum: 'W01',
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

        it('initializes detail model state and binds routes wmWarehouseScanToDetail and wmWarehouseScanToDetailWithWh', () => {
            expect(mockRouter.getRoute).toHaveBeenCalledWith('wmWarehouseScanToDetail');
            expect(mockRouter.getRoute).toHaveBeenCalledWith('wmWarehouseScanToDetailWithWh');
            expect(mockRoute.attachPatternMatched).toHaveBeenCalledWith(expect.any(Function), detailCtrl);
            expect(detailModel.getProperty('/hasTR')).toBe(false);
            expect(detailModel.getProperty('/autoConfirm')).toBe(true);
            expect(detailModel.getProperty('/autoPostMigo')).toBe(true);
            expect(detailModel.getProperty('/canSubmit')).toBe(false);
        });

        it('route parse: extracts lgnum from route and loads TR with warehouse', async () => {
            mockWarehouseScanToService.lookupTR.mockResolvedValueOnce({
                WarehouseNumber: 'W12',
                TRNumber: '0001001911',
                TRItem: '0001',
                Material: '8500000076',
                MaterialDescription: 'Raw Material 76',
                OpenQty: 300.0,
                TargetQty: 300.0,
                Unit: 'KG',
                IsBatchManaged: false,
                IsSerialManaged: false,
                Batch: ''
            });

            const mockEvent = {
                getParameter: jest.fn((param) => {
                    if (param === 'arguments') return { lgnum: 'W12', docType: 'TR', number: '0001001911' };
                    return null;
                })
            };

            await detailCtrl._onRouteMatched(mockEvent);

            expect(mockWarehouseScanToService.lookupTR).toHaveBeenCalledWith('0001001911', 'W12', 'TR', '');
            expect(detailModel.getProperty('/lgnum')).toBe('W12');
            expect(detailModel.getProperty('/hasTR')).toBe(true);
        });

        it('ambiguous warehouse response (409): opens warehouse picker SelectDialog', async () => {
            const err409 = Object.assign(new Error('TR exists in multiple warehouses'), {
                status: 409,
                code: '409',
                details: [
                    { lgnum: 'W12', plant: '1130', movementType: '311', statusCode: '', status: 'Open', createdDate: '2026-10-16' },
                    { lgnum: 'W13', plant: '1120', movementType: '319', statusCode: 'E', status: 'Completed', createdDate: '2026-01-16' }
                ]
            });
            mockWarehouseScanToService.lookupTR.mockRejectedValueOnce(err409);

            const mockEvent = {
                getParameter: jest.fn((param) => {
                    if (param === 'arguments') return { docType: 'TR', number: '0001001911' };
                    return null;
                })
            };

            await detailCtrl._onRouteMatched(mockEvent);

            expect(detailCtrl._oWarehouseDialog).toBeDefined();
            expect(detailCtrl._oWarehouseDialog.open).toHaveBeenCalled();
            expect(detailCtrl._oWarehouseDialog.addItem).toHaveBeenCalledTimes(2);

            // Confirming completed item is blocked and shows warning toast
            const mockCompletedItem = {
                data: jest.fn((k) => (k === 'statusCode' ? 'E' : 'W13')),
                getTitle: () => 'W13'
            };
            detailCtrl._oWarehouseDialog.confirm({ getParameter: () => mockCompletedItem });
            expect(mockMessageToast.show).toHaveBeenCalledWith(expect.stringContaining('scanToErrTrCompletedNonSelectable'));

            // User chooses open W12 from dialog
            mockWarehouseScanToService.lookupTR.mockResolvedValueOnce({
                WarehouseNumber: 'W12',
                TRNumber: '0001001911',
                TRItem: '0001',
                Material: '8500000076',
                OpenQty: 300.0,
                Unit: 'KG'
            });

            await detailCtrl._onWarehouseChosen('W12', 'TR', '0001001911');

            expect(detailModel.getProperty('/lgnum')).toBe('W12');
            expect(mockRouter.navTo).toHaveBeenCalledWith('wmWarehouseScanToDetailWithWh', {
                lgnum: 'W12',
                docType: 'TR',
                number: '0001001911'
            }, true);
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

        it('fixed button: btnReset cancels and navigates back to main list [mock only, not browser verification]', () => {
            sMockPreviousHash = undefined;
            detailCtrl.onReset();
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
                receivingPlant: '',
                receivingStorageLocation: '',
                costCenter: '',
                assetNo: '',
                subNumber: '',
                orderId: '',
                autoConfirm: true,
                autoPostMigo: true,
                CompleteReservation: false,
                sourceStorageType: 'RM1',
                sourceStorageBin: '0-L0001-00',
                storageUnit: '',
                ReservationMovementType: '',
                ReservationNo: '',
                ReservationItem: ''
            });

            expect(detailModel.getProperty('/hasResult')).toBe(true);
            expect(detailModel.getProperty('/result/TransferOrder')).toBe('1037293');
            expect(detailModel.getProperty('/result/MaterialDocument')).toBe('4900050130');
            expect(detailModel.getProperty('/hasTR')).toBe(false);
        });

        it('forwards scanned storage unit / HU in createTOFromTR payload and preserves empty string when empty [mock only, not browser verification]', async () => {
            detailModel.setProperty('/hasTR', true);
            detailModel.setProperty('/tr', {
                TRNumber: '1000801',
                TRItem: '0001',
                Material: '1000000204',
                MaterialDescription: 'Chemical Solvent',
                OpenQty: 5,
                Unit: 'KG',
                IsBatchManaged: false,
                IsSerialManaged: false
            });
            detailModel.setProperty('/pickQty', 5);
            detailModel.setProperty('/sourceStorageType', 'RM1');
            detailModel.setProperty('/sourceStorageBin', '0-L0001-00');
            detailModel.setProperty('/storageUnit', '100000987654');
            detailCtrl._validateForm();

            mockWarehouseScanToService.createTOFromTR.mockResolvedValueOnce({
                TransferOrder: '1037294',
                ConfirmationNumber: '1037294',
                Status: '04',
                IsConfirmed: true,
                StorageUnit: '100000987654'
            });

            await detailCtrl.onProcessTO();

            expect(mockWarehouseScanToService.createTOFromTR).toHaveBeenCalledWith(
                expect.objectContaining({
                    tbnum: '1000801',
                    storageUnit: '100000987654'
                })
            );

            // Verify empty scan keeps empty string behavior
            detailModel.setProperty('/hasTR', true);
            detailModel.setProperty('/tr', {
                TRNumber: '1000802',
                TRItem: '0001',
                Material: '1000000204',
                OpenQty: 5,
                Unit: 'KG'
            });
            detailModel.setProperty('/pickQty', 5);
            detailModel.setProperty('/storageUnit', '');
            detailCtrl._validateForm();

            mockWarehouseScanToService.createTOFromTR.mockResolvedValueOnce({
                TransferOrder: '1037295',
                ConfirmationNumber: '1037295',
                Status: '04',
                IsConfirmed: true
            });

            await detailCtrl.onProcessTO();

            expect(mockWarehouseScanToService.createTOFromTR).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    tbnum: '1000802',
                    storageUnit: ''
                })
            );
        });

        it('keeps Submit disabled after an unknown TO/MIGO outcome and directs the operator to check SAP documents', async () => {
            detailModel.setProperty('/hasTR', true);
            detailModel.setProperty('/tr', { TRNumber: '1000803', TRItem: '0001', Material: '1000000204', OpenQty: 5, Unit: 'KG' });
            detailModel.setProperty('/pickQty', 5);
            detailCtrl._validateForm();
            const err = new Error('Posting outcome unconfirmed. Do not post again.');
            err.status = 504;
            mockWarehouseScanToService.createTOFromTR.mockRejectedValueOnce(err);

            await detailCtrl.onProcessTO();
            expect(mockMessageBox.warning).toHaveBeenCalledWith('scanToPostUnknown');
            expect(detailModel.getProperty('/postingUnknown')).toBe(true);
            expect(detailModel.getProperty('/canSubmit')).toBe(false);
            expect(detailCtrl._validateForm()).toBe(false);
            await detailCtrl.onProcessTO();
            expect(mockWarehouseScanToService.createTOFromTR).toHaveBeenCalledTimes(1);
        });

        it('fixed button: btnRetryMigo recovers failed goods movement to status 05 [mock only, not browser verification]', async () => {
            detailModel.setProperty('/result', {
                TransferOrder: '1037290',
                ReservationNo: '525866',
                ReservationItem: '0001',
                MovementType: '311',
                ReceivingStorageLocation: 'CS01',
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

        it('direct URL load: auto-fills ReceivingStorageLocation and sets read-only with source [mock only, not browser verification]', async () => {
            mockWarehouseScanToService.lookupTR.mockResolvedValueOnce({
                TransferRequirement: '0001000782',
                TRItem: '0001',
                MovementType: '311',
                Plant: '1120',
                StorageLocation: 'CS01',
                OpenQuantity: 1,
                ReceivingStorageLocation: 'CS02',
                ReceivingStorageLocationSource: 'Reservation',
                ReceivingPlant: '1120',
                ReceivingPlantSource: 'Reservation'
            });

            await detailCtrl._onRouteMatched({
                getParameter: jest.fn((p) => (p === 'arguments' ? { docType: 'TR', number: '1000782' } : null))
            });

            expect(mockWarehouseScanToService.lookupTR).toHaveBeenCalledWith('1000782', '', 'TR', '');
            expect(detailModel.getProperty('/receivingStorageLocation')).toBe('CS02');
            expect(detailModel.getProperty('/receivingStorageLocationSource')).toBe('Reservation');
            expect(detailModel.getProperty('/receivingPlant')).toBe('1120');
            expect(detailModel.getProperty('/receivingPlantSource')).toBe('Reservation');
            expect(detailModel.getProperty('/canSubmit')).toBe(true);
        });

        it('no source: editable and blocked (canSubmit false) until entered for 311 [mock only, not browser verification]', async () => {
            mockWarehouseScanToService.lookupTR.mockResolvedValueOnce({
                TransferRequirement: '0001000799',
                TRItem: '0001',
                MovementType: '311',
                Plant: '1120',
                StorageLocation: 'HS01',
                OpenQuantity: 1,
                ReceivingStorageLocation: '',
                ReceivingStorageLocationSource: '',
                ReceivingPlant: '',
                ReceivingPlantSource: ''
            });

            await detailCtrl._onRouteMatched({
                getParameter: jest.fn((p) => (p === 'arguments' ? { docType: 'TR', number: '1000799' } : null))
            });

            expect(detailModel.getProperty('/receivingStorageLocation')).toBe('');
            expect(detailModel.getProperty('/receivingStorageLocationSource')).toBe('');
            // blocked until entered
            expect(detailModel.getProperty('/canSubmit')).toBe(false);
            expect(detailModel.getProperty('/recSLocValueState')).toBe('Error');

            // User types valid receiving SLoc different from HS01
            detailCtrl.onReceivingSLocLiveChange({
                getParameter: jest.fn((p) => (p === 'value' ? 'CS01' : null))
            });

            expect(detailModel.getProperty('/receivingStorageLocation')).toBe('CS01');
            expect(detailModel.getProperty('/recSLocValueState')).toBe('None');
            expect(detailModel.getProperty('/canSubmit')).toBe(true);
        });

        it('same SLoc rejected: blocks canSubmit and sets error valueState for 311 [mock only, not browser verification]', async () => {
            mockWarehouseScanToService.lookupTR.mockResolvedValueOnce({
                TransferRequirement: '0001000799',
                TRItem: '0001',
                MovementType: '311',
                Plant: '1120',
                StorageLocation: 'HS01',
                OpenQuantity: 1,
                ReceivingStorageLocation: '',
                ReceivingStorageLocationSource: ''
            });

            await detailCtrl._onRouteMatched({
                getParameter: jest.fn((p) => (p === 'arguments' ? { docType: 'TR', number: '1000799' } : null))
            });

            // User types the same SLoc as issuing (HS01)
            detailCtrl.onReceivingSLocLiveChange({
                getParameter: jest.fn((p) => (p === 'value' ? 'HS01' : null))
            });

            expect(detailModel.getProperty('/receivingStorageLocation')).toBe('HS01');
            expect(detailModel.getProperty('/recSLocValueState')).toBe('Error');
            expect(detailModel.getProperty('/recSLocValueStateText')).toBe('Receiving Storage Location must be different from Issuing Storage Location');
            expect(detailModel.getProperty('/canSubmit')).toBe(false);
        });

        it('201/241: Cost Center and Asset are shown and required, receiving SLoc/Plant hidden/not applicable [mock only, not browser verification]', async () => {
            // Test 201 (Cost Center)
            mockWarehouseScanToService.lookupTR.mockResolvedValueOnce({
                TransferRequirement: '0001000006',
                TRItem: '0001',
                MovementType: '201',
                Plant: '1600',
                StorageLocation: 'CS01',
                OpenQuantity: 1,
                CostCenter: '1011302401',
                ReceivingStorageLocation: '',
                ReceivingStorageLocationSource: ''
            });

            await detailCtrl._onRouteMatched({
                getParameter: jest.fn((p) => (p === 'arguments' ? { docType: 'TR', number: '1000006' } : null))
            });

            expect(detailModel.getProperty('/tr/MovementType')).toBe('201');
            expect(detailModel.getProperty('/costCenter')).toBe('1011302401');
            expect(detailModel.getProperty('/receivingStorageLocation')).toBe('');
            expect(detailModel.getProperty('/canSubmit')).toBe(true);

            // Test 241 (Asset)
            mockWarehouseScanToService.lookupTR.mockResolvedValueOnce({
                TransferRequirement: '0001000761',
                TRItem: '0001',
                MovementType: '241',
                Plant: '1120',
                StorageLocation: 'CS01',
                OpenQuantity: 1,
                AssetNo: '0000400001',
                SubNumber: '0000',
                ReceivingStorageLocation: '',
                ReceivingStorageLocationSource: ''
            });

            await detailCtrl._onRouteMatched({
                getParameter: jest.fn((p) => (p === 'arguments' ? { docType: 'TR', number: '1000761' } : null))
            });

            expect(detailModel.getProperty('/tr/MovementType')).toBe('241');
            expect(detailModel.getProperty('/assetNo')).toBe('0000400001');
            expect(detailModel.getProperty('/receivingStorageLocation')).toBe('');
            expect(detailModel.getProperty('/canSubmit')).toBe(true);
        });

        it('TR 0001000823 real shape: value absent at source -> editable and blocked until entered [mock only, not browser verification]', async () => {
            mockWarehouseScanToService.lookupTR.mockResolvedValueOnce({
                TransferRequirement: '0001000823',
                TRItem: '0001',
                WarehouseNumber: 'W01',
                MovementType: '311',
                ReservationNo: '527870',
                Material: '8000005294',
                MaterialDescription: 'Mobile Charger',
                Plant: '1120',
                StorageLocation: 'HS01',
                DestinationStorageType: '921',
                DestinationStorageBin: 'TRANSFER',
                OpenQuantity: 1,
                ReceivingPlant: '',
                ReceivingPlantSource: '',
                ReceivingStorageLocation: '',
                ReceivingStorageLocationSource: ''
            });

            await detailCtrl._onRouteMatched({
                getParameter: jest.fn((p) => (p === 'arguments' ? { docType: 'TR', number: '0001000823' } : null))
            });

            // SLoc is absent -> empty and editable, blocked from submit
            expect(detailModel.getProperty('/receivingStorageLocation')).toBe('');
            expect(detailModel.getProperty('/receivingStorageLocationSource')).toBe('');
            expect(detailModel.getProperty('/recSLocValueState')).toBe('Error');
            expect(detailModel.getProperty('/canSubmit')).toBe(false);

            // User enters valid receiving SLoc
            detailCtrl.onReceivingSLocLiveChange({
                getParameter: jest.fn((p) => (p === 'value' ? 'CIS1' : null))
            });

            expect(detailModel.getProperty('/receivingStorageLocation')).toBe('CIS1');
            expect(detailModel.getProperty('/recSLocValueState')).toBe('None');
            expect(detailModel.getProperty('/canSubmit')).toBe(true);
        });

        it('TR 0001000823 shape: value present at source -> filled and read-only [mock only, not browser verification]', async () => {
            mockWarehouseScanToService.lookupTR.mockResolvedValueOnce({
                TransferRequirement: '0001000823',
                TRItem: '0001',
                WarehouseNumber: 'W01',
                MovementType: '311',
                ReservationNo: '527870',
                Material: '8000005294',
                MaterialDescription: 'Mobile Charger',
                Plant: '1120',
                StorageLocation: 'HS01',
                DestinationStorageType: '921',
                DestinationStorageBin: 'TRANSFER',
                OpenQuantity: 1,
                ReceivingPlant: '1120',
                ReceivingPlantSource: 'Reservation',
                ReceivingStorageLocation: 'CIS1',
                ReceivingStorageLocationSource: 'Reservation'
            });

            await detailCtrl._onRouteMatched({
                getParameter: jest.fn((p) => (p === 'arguments' ? { docType: 'TR', number: '0001000823' } : null))
            });

            // SLoc is present at source -> filled and read-only, submit permitted
            expect(detailModel.getProperty('/receivingStorageLocation')).toBe('CIS1');
            expect(detailModel.getProperty('/receivingStorageLocationSource')).toBe('Reservation');
            expect(detailModel.getProperty('/recSLocValueState')).toBe('None');
            expect(detailModel.getProperty('/canSubmit')).toBe(true);
        });

        it('mismatched TR blocked: TR 311 vs reservation 201 shows warning and blocks Create & Confirm TO [mock only, not browser verification]', async () => {
            mockWarehouseScanToService.lookupTR.mockResolvedValueOnce({
                TransferRequirement: '0001000823',
                TRItem: '0001',
                WarehouseNumber: 'W01',
                MovementType: '311',
                ReservationNo: '527870',
                ReservationMovementType: '201',
                AllowMismatchedTR: false,
                Warning: 'TR movement 311 does not match reservation movement 201',
                Material: '8000005294',
                MaterialDescription: 'Mobile Charger',
                Plant: '1120',
                StorageLocation: 'HS01',
                DestinationStorageType: '921',
                DestinationStorageBin: 'TRANSFER',
                OpenQuantity: 1,
                CostCenter: 'CC1120'
            });

            await detailCtrl._onRouteMatched({
                getParameter: jest.fn((p) => (p === 'arguments' ? { docType: 'TR', number: '0001000823' } : null))
            });

            // Warning banner is displayed
            expect(detailModel.getProperty('/hasMessage')).toBe(true);
            expect(detailModel.getProperty('/messageType')).toBe('Warning');
            expect(detailModel.getProperty('/messageText')).toBe('TR movement 311 does not match reservation movement 201');
            expect(detailModel.getProperty('/isMovementMismatched')).toBe(true);

            // Submit is strictly blocked
            expect(detailModel.getProperty('/canSubmit')).toBe(false);
        });

        it('flag allows it: AllowMismatchedTR allows mismatched TR submit when valid fields are present [mock only, not browser verification]', async () => {
            mockWarehouseScanToService.lookupTR.mockResolvedValueOnce({
                TransferRequirement: '0001000823',
                TRItem: '0001',
                WarehouseNumber: 'W01',
                MovementType: '311',
                ReservationNo: '527870',
                ReservationMovementType: '201',
                AllowMismatchedTR: true,
                Warning: 'TR movement 311 does not match reservation movement 201',
                Material: '8000005294',
                MaterialDescription: 'Mobile Charger',
                Plant: '1120',
                StorageLocation: 'HS01',
                DestinationStorageType: '921',
                DestinationStorageBin: 'TRANSFER',
                OpenQuantity: 1,
                CostCenter: 'CC1120'
            });

            await detailCtrl._onRouteMatched({
                getParameter: jest.fn((p) => (p === 'arguments' ? { docType: 'TR', number: '0001000823' } : null))
            });

            // Warning is shown
            expect(detailModel.getProperty('/hasMessage')).toBe(true);
            expect(detailModel.getProperty('/messageType')).toBe('Warning');
            expect(detailModel.getProperty('/messageText')).toBe('TR movement 311 does not match reservation movement 201');

            // But flag allows submit when cost center is populated
            expect(detailModel.getProperty('/effectiveMovementType')).toBe('201');
            expect(detailModel.getProperty('/costCenter')).toBe('CC1120');
            expect(detailModel.getProperty('/canSubmit')).toBe(true);
        });

        it('shows the persistent destination warning for mismatched reservation/TR movements [mock only, not browser verification]', () => {
            const viewXml = fs.readFileSync(path.join(__dirname, '../../../app/fiori-app/webapp/modules/wm/warehouse-scan-to/view/WarehouseScanToDetail.view.xml'), 'utf8');
            detailModel.setProperty('/isMovementMismatched', true);
            expect(viewXml).toMatch(/id="mismatchedTrSandboxWarning"[\s\S]*?visible="\{scanView>\/isMovementMismatched\}"[\s\S]*?text="(?:\{i18n>scanToMismatchedTrWarning\}|Linked reservation flow:[\s\S]*?Verify the destination before processing\.)"[\s\S]*?showCloseButton="false"/);
            expect(detailModel.getProperty('/isMovementMismatched')).toBe(true);
        });

        it('genuine 311 still shows the field and requires receiving SLoc [mock only, not browser verification]', async () => {
            mockWarehouseScanToService.lookupTR.mockResolvedValueOnce({
                TransferRequirement: '0001000782',
                TRItem: '0001',
                WarehouseNumber: 'W01',
                MovementType: '311',
                ReservationNo: '525295',
                ReservationMovementType: '311',
                AllowMismatchedTR: false,
                Material: '8000000023',
                MaterialDescription: 'Cable Assy',
                Plant: '1120',
                StorageLocation: 'HS01',
                DestinationStorageType: '921',
                DestinationStorageBin: 'TRANSFER',
                OpenQuantity: 1,
                ReceivingPlant: '',
                ReceivingStorageLocation: ''
            });

            await detailCtrl._onRouteMatched({
                getParameter: jest.fn((p) => (p === 'arguments' ? { docType: 'TR', number: '0001000782' } : null))
            });

            // Effective movement type is 311
            expect(detailModel.getProperty('/effectiveMovementType')).toBe('311');
            expect(detailModel.getProperty('/isMovementMismatched')).toBe(false);
            expect(detailModel.getProperty('/hasMessage')).toBe(false);

            // Receiving SLoc is empty, required, blocked until user fills it
            expect(detailModel.getProperty('/receivingStorageLocation')).toBe('');
            expect(detailModel.getProperty('/recSLocValueState')).toBe('Error');
            expect(detailModel.getProperty('/canSubmit')).toBe(false);
        });

        it('201/241 hide receiving SLoc and show their respective account assignments [mock only, not browser verification]', async () => {
            // Case 1: 201 reservation
            mockWarehouseScanToService.lookupTR.mockResolvedValueOnce({
                TransferRequirement: '0001000823',
                TRItem: '0001',
                WarehouseNumber: 'W01',
                MovementType: '311',
                ReservationNo: '527870',
                ReservationMovementType: '201',
                AllowMismatchedTR: true,
                Material: '8000005294',
                Plant: '1120',
                StorageLocation: 'HS01',
                OpenQuantity: 1,
                CostCenter: ''
            });

            await detailCtrl._onRouteMatched({
                getParameter: jest.fn((p) => (p === 'arguments' ? { docType: 'TR', number: '0001000823' } : null))
            });

            // Effective movement is 201 -> receiving SLoc is not required, Cost Center is required
            expect(detailModel.getProperty('/effectiveMovementType')).toBe('201');
            expect(detailModel.getProperty('/receivingStorageLocation')).toBe('');
            expect(detailModel.getProperty('/recSLocValueState')).toBe('None'); // NOT marked error
            expect(detailModel.getProperty('/costCenterValueState')).toBe('Error'); // Cost Center required
            expect(detailModel.getProperty('/canSubmit')).toBe(false);

            // Case 2: 241 reservation
            mockWarehouseScanToService.lookupTR.mockResolvedValueOnce({
                TransferRequirement: '0001000760',
                TRItem: '0001',
                WarehouseNumber: 'W01',
                MovementType: '311',
                ReservationNo: '525279',
                ReservationMovementType: '241',
                AllowMismatchedTR: true,
                Material: '8000005294',
                Plant: '1120',
                StorageLocation: 'HS01',
                OpenQuantity: 1,
                AssetNo: ''
            });

            await detailCtrl._onRouteMatched({
                getParameter: jest.fn((p) => (p === 'arguments' ? { docType: 'TR', number: '0001000760' } : null))
            });

            // Effective movement is 241 -> receiving SLoc is not required, Asset is required
            expect(detailModel.getProperty('/effectiveMovementType')).toBe('241');
            expect(detailModel.getProperty('/receivingStorageLocation')).toBe('');
            expect(detailModel.getProperty('/recSLocValueState')).toBe('None'); // NOT marked error
            expect(detailModel.getProperty('/assetValueState')).toBe('Error'); // Asset required
            expect(detailModel.getProperty('/canSubmit')).toBe(false);
        });

        it('261 staging TR sets effectiveMovementType to 261 and validates OrderId [mock only, not browser verification]', async () => {
            // Case 1: 261 reservation staging TR with OrderId prefilled
            mockWarehouseScanToService.lookupTR.mockResolvedValueOnce({
                TransferRequirement: '0001000848',
                TRItem: '0001',
                WarehouseNumber: 'W01',
                MovementType: '311',
                ReservationNo: '0000528769',
                ReservationMovementType: '261',
                AllowMismatchedTR: true,
                Material: '8000009754',
                Plant: '1120',
                StorageLocation: 'CS01',
                OpenQuantity: 1,
                OrderID: '000000001011'
            });

            await detailCtrl._onRouteMatched({
                getParameter: jest.fn((p) => (p === 'arguments' ? { docType: 'TR', number: '0001000848' } : null))
            });

            expect(detailModel.getProperty('/effectiveMovementType')).toBe('261');
            expect(detailModel.getProperty('/orderId')).toBe('000000001011');
            expect(detailModel.getProperty('/orderIdValueState')).toBe('None');
            expect(detailModel.getProperty('/receivingStorageLocation')).toBe('');
            expect(detailModel.getProperty('/recSLocValueState')).toBe('None'); // receiving SLoc not required for 261
            expect(detailModel.getProperty('/canSubmit')).toBe(true);

            // Case 2: 261 with missing OrderId blocks submit
            detailCtrl.onOrderIdLiveChange({ getParameter: jest.fn(() => '') });
            expect(detailModel.getProperty('/orderId')).toBe('');
            expect(detailModel.getProperty('/orderIdValueState')).toBe('Error');
            expect(detailModel.getProperty('/canSubmit')).toBe(false);

            // Case 3: Re-entering OrderId restores canSubmit
            detailCtrl.onOrderIdLiveChange({ getParameter: jest.fn(() => '1011') });
            expect(detailModel.getProperty('/orderId')).toBe('1011');
            expect(detailModel.getProperty('/orderIdValueState')).toBe('None');
            expect(detailModel.getProperty('/canSubmit')).toBe(true);
        });

        it('formatMovementDisplay formats movement codes with human-readable descriptions', () => {
            expect(detailCtrl.formatMovementDisplay('261', '311')).toBe('261 - Goods Issue to Order');
            expect(detailCtrl.formatMovementDisplay('', '311')).toBe('311 - Storage Location Transfer');
            expect(detailCtrl.formatMovementDisplay('201')).toBe('201 - Goods Issue to Cost Center');
            expect(detailCtrl.formatMovementDisplay('241')).toBe('241 - Goods Issue to Asset');
            expect(detailCtrl.formatMovementDisplay('301')).toBe('301 - Plant to Plant Transfer');
            expect(detailCtrl.formatMovementDisplay('999')).toBe('999');
            expect(detailCtrl.formatMovementDisplay('', '')).toBe('');
        });

        it('destination panel XML contains 261 headerText and visible condition', () => {
            const viewXml = fs.readFileSync(path.join(__dirname, '../../../app/fiori-app/webapp/modules/wm/warehouse-scan-to/view/WarehouseScanToDetail.view.xml'), 'utf8');
            expect(viewXml).toContain('scanToPanelAccount261');
            expect(viewXml).toMatch(/panelDestination[\s\S]*?headerText=[\s\S]*?=== '261' \? \$\{i18n>scanToPanelAccount261\}/);
            expect(viewXml).toMatch(/panelDestination[\s\S]*?visible=[\s\S]*?=== '261'/);
            expect(viewXml).toContain('id="inputOrderIdScan"');
        });

        it('Step 6: scan verification card displays TR, Material, Required, Scanned, and READY FOR TO status', async () => {
            mockWarehouseScanToService.lookupTR.mockResolvedValueOnce({
                WarehouseNumber: 'W01',
                TRNumber: '123456',
                TRItem: '0001',
                Material: 'ABC123',
                MaterialDescription: 'Industrial Chemical',
                OpenQty: 10,
                TargetQty: 10,
                Unit: 'EA',
                IsBatchManaged: false,
                IsSerialManaged: false
            });

            await detailCtrl._onRouteMatched({
                getParameter: jest.fn((p) => (p === 'arguments' ? { docType: 'TR', number: '123456' } : null))
            });

            expect(detailModel.getProperty('/tr/TRNumber')).toBe('123456');
            expect(detailModel.getProperty('/tr/Material')).toBe('ABC123');
            expect(detailModel.getProperty('/tr/TargetQty')).toBe(10);
            expect(detailModel.getProperty('/pickQty')).toBe(10);
            expect(detailModel.getProperty('/scanVerificationStatusText')).toBe('READY FOR TO');
            expect(detailModel.getProperty('/scanVerificationStatusState')).toBe('Success');
            expect(detailModel.getProperty('/canSubmit')).toBe(true);
        });

        it('Step 6: scanned quantity exceeding open TR quantity sets QUANTITY EXCEEDS OPEN TR with Error', async () => {
            mockWarehouseScanToService.lookupTR.mockResolvedValueOnce({
                WarehouseNumber: 'W01',
                TRNumber: '123456',
                TRItem: '0001',
                Material: 'ABC123',
                OpenQty: 10,
                TargetQty: 10,
                Unit: 'EA'
            });

            await detailCtrl._onRouteMatched({
                getParameter: jest.fn((p) => (p === 'arguments' ? { docType: 'TR', number: '123456' } : null))
            });

            detailCtrl.onPickQtyChange({ getParameter: jest.fn(() => '15') });

            expect(detailModel.getProperty('/pickQty')).toBe(15);
            expect(detailModel.getProperty('/scanVerificationStatusText')).toBe('QUANTITY EXCEEDS OPEN TR');
            expect(detailModel.getProperty('/scanVerificationStatusState')).toBe('Error');
            expect(detailModel.getProperty('/canSubmit')).toBe(false);
        });

        it('Step 6: scanned quantity of 0 or negative sets INVALID QUANTITY with Error', async () => {
            mockWarehouseScanToService.lookupTR.mockResolvedValueOnce({
                WarehouseNumber: 'W01',
                TRNumber: '123456',
                TRItem: '0001',
                Material: 'ABC123',
                OpenQty: 10,
                TargetQty: 10,
                Unit: 'EA'
            });

            await detailCtrl._onRouteMatched({
                getParameter: jest.fn((p) => (p === 'arguments' ? { docType: 'TR', number: '123456' } : null))
            });

            detailCtrl.onPickQtyChange({ getParameter: jest.fn(() => '0') });

            expect(detailModel.getProperty('/pickQty')).toBe(0);
            expect(detailModel.getProperty('/scanVerificationStatusText')).toBe('INVALID QUANTITY');
            expect(detailModel.getProperty('/scanVerificationStatusState')).toBe('Error');
            expect(detailModel.getProperty('/canSubmit')).toBe(false);
        });

        it('Step 6: onSetMaxQty resets pick quantity and status to READY FOR TO', async () => {
            mockWarehouseScanToService.lookupTR.mockResolvedValueOnce({
                WarehouseNumber: 'W01',
                TRNumber: '123456',
                TRItem: '0001',
                Material: 'ABC123',
                OpenQty: 10,
                TargetQty: 10,
                Unit: 'EA'
            });

            await detailCtrl._onRouteMatched({
                getParameter: jest.fn((p) => (p === 'arguments' ? { docType: 'TR', number: '123456' } : null))
            });

            detailCtrl.onPickQtyChange({ getParameter: jest.fn(() => '20') });
            expect(detailModel.getProperty('/scanVerificationStatusText')).toBe('QUANTITY EXCEEDS OPEN TR');

            detailCtrl.onSetMaxQty();
            expect(detailModel.getProperty('/pickQty')).toBe(10);
            expect(detailModel.getProperty('/scanVerificationStatusText')).toBe('READY FOR TO');
            expect(detailModel.getProperty('/scanVerificationStatusState')).toBe('Success');
            expect(detailModel.getProperty('/canSubmit')).toBe(true);
        });

        it('Step 6: rejects TR that is already completed (STATU = E) with clear error', async () => {
            mockWarehouseScanToService.lookupTR.mockResolvedValueOnce({
                WarehouseNumber: 'W01',
                TRNumber: '123456',
                TRItem: '0001',
                Material: 'ABC123',
                Status: 'E',
                OpenQty: 0
            });

            await detailCtrl._onRouteMatched({
                getParameter: jest.fn((p) => (p === 'arguments' ? { docType: 'TR', number: '123456' } : null))
            });

            expect(detailModel.getProperty('/hasTR')).toBe(false);
            expect(detailModel.getProperty('/hasMessage')).toBe(true);
            expect(detailModel.getProperty('/messageType')).toBe('Error');
            expect(detailModel.getProperty('/messageText')).toContain('scanToErrTrCompleted');
            expect(detailModel.getProperty('/scanVerificationStatusText')).toBe('REJECTED');
            expect(detailModel.getProperty('/scanVerificationStatusState')).toBe('Error');
        });

        it('Step 6: rejects TR belonging to wrong warehouse with clear error', async () => {
            detailModel.setProperty('/lgnum', 'W01');
            mockWarehouseScanToService.lookupTR.mockResolvedValueOnce({
                WarehouseNumber: 'W02',
                TRNumber: '123456',
                TRItem: '0001',
                Material: 'ABC123',
                OpenQty: 10
            });

            await detailCtrl._onRouteMatched({
                getParameter: jest.fn((p) => (p === 'arguments' ? { lgnum: 'W01', docType: 'TR', number: '123456' } : null))
            });

            expect(detailModel.getProperty('/hasTR')).toBe(false);
            expect(detailModel.getProperty('/hasMessage')).toBe(true);
            expect(detailModel.getProperty('/messageType')).toBe('Error');
            expect(detailModel.getProperty('/messageText')).toContain('scanToErrWrongWarehouse');
            expect(detailModel.getProperty('/scanVerificationStatusText')).toBe('REJECTED');
        });

        it('Step 6: stock deficit with unresolved source bin blocks submission with STOCK DEFICIT status', async () => {
            mockWarehouseScanToService.lookupTR.mockResolvedValueOnce({
                WarehouseNumber: 'W01',
                TRNumber: '1000860',
                TRItem: '0001',
                Material: '8000009753',
                Plant: '1120',
                StorageLocation: 'HS01',
                MovementType: '311',
                OpenQty: 1,
                TargetQty: 1,
                Unit: 'NOS',
                Warning: 'Stock deficit: Storage location HS01 has no WM stock for material 8000009753 in warehouse W01. Available in storage location(s): MT01.',
                StockWarning: 'Storage location HS01 has no WM stock for material 8000009753 in warehouse W01. Available in storage location(s): MT01.',
                SourceStorageType: '',
                SourceStorageBin: '',
                ReceivingStorageLocation: 'CIS1'
            });

            await detailCtrl._onRouteMatched({
                getParameter: jest.fn((p) => (p === 'arguments' ? { docType: 'TR', number: '1000860' } : null))
            });

            expect(detailModel.getProperty('/hasTR')).toBe(true);
            expect(detailModel.getProperty('/hasMessage')).toBe(true);
            expect(detailModel.getProperty('/messageType')).toBe('Warning');
            expect(detailModel.getProperty('/canSubmit')).toBe(false);
            expect(detailModel.getProperty('/scanVerificationStatusText')).toBe('STOCK DEFICIT');
            expect(detailModel.getProperty('/scanVerificationStatusState')).toBe('Error');
        });
    });

    afterAll(() => {
        if (origSapDefine) {
            global.sap.ui.define = origSapDefine;
        }
    });

    describe('C. RecentScanStore & Landing Page Enhancements [mock only]', () => {
        let localStorageMock = {};

        beforeEach(() => {
            localStorageMock = {};
            global.localStorage = {
                getItem: jest.fn((k) => localStorageMock[k] || null),
                setItem: jest.fn((k, v) => { localStorageMock[k] = String(v); }),
                removeItem: jest.fn((k) => { delete localStorageMock[k]; })
            };
            mockCurrentUserName = 'KHUSHAL';
            mockAuthService.getCurrentUserName.mockReturnValue('KHUSHAL');
        });

        test('1. No save for an unknown user', () => {
            mockAuthService.getCurrentUserName.mockReturnValue('');
            RecentScanStore.addRecentScan(null, { number: '1001839', docType: 'TR' });
            expect(global.localStorage.setItem).not.toHaveBeenCalled();
            expect(RecentScanStore.getRecentScans(null)).toEqual([]);
        });

        test('2. Save for authenticated user formats timestamp with date and saves without status chip', () => {
            RecentScanStore.addRecentScan(null, { number: '1001839', docType: 'TR', lgnum: 'W01' });
            const aList = RecentScanStore.getRecentScans(null);
            expect(aList.length).toBe(1);
            expect(aList[0].number).toBe('1001839');
            expect(aList[0].docType).toBe('TR');
            expect(aList[0].lgnum).toBe('W01');
            expect(aList[0].status).toBeUndefined(); // Status chip dropped
            expect(aList[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/); // Includes date
        });

        test('3. Deduplication: same document and docType moves to top without duplicate entry', () => {
            RecentScanStore.addRecentScan(null, { number: '1001839', docType: 'TR', lgnum: 'W01' });
            RecentScanStore.addRecentScan(null, { number: '2000001', docType: 'RES', lgnum: 'W12' });
            RecentScanStore.addRecentScan(null, { number: '1001839', docType: 'TR', lgnum: 'W12' });
            const aList = RecentScanStore.getRecentScans(null);
            expect(aList.length).toBe(2);
            expect(aList[0].number).toBe('1001839');
            expect(aList[0].lgnum).toBe('W12');
            expect(aList[1].number).toBe('2000001');
        });

        test('4. 5-item cap: only 5 most recent scans retained', () => {
            for (let i = 1; i <= 7; i++) {
                RecentScanStore.addRecentScan(null, { number: '100000' + i, docType: 'TR' });
            }
            const aList = RecentScanStore.getRecentScans(null);
            expect(aList.length).toBe(5);
            expect(aList[0].number).toBe('1000007');
            expect(aList[4].number).toBe('1000003');
        });

        test('5. Detail Controller saves recent scan on success only using same store instance', async () => {
            const detailCtrl = new WarehouseScanToDetailController();
            const oModel = new MockJSONModel(detailCtrl._getInitialState());
            detailCtrl.getModel = jest.fn(() => oModel);
            detailCtrl.getOwnerComponent = jest.fn(() => null);
            detailCtrl.getText = jest.fn((k) => k);

            // Failure case: 404
            mockWarehouseScanToService.lookupTR.mockRejectedValueOnce(new Error('TR not found in any warehouse'));
            await detailCtrl.loadDetail('TR', '9999999');
            expect(RecentScanStore.getRecentScans(null)).toEqual([]);

            // Success case: 200
            mockWarehouseScanToService.lookupTR.mockResolvedValueOnce({
                TransferRequirement: '1001911',
                TRItem: '0001',
                WarehouseNumber: 'W12',
                Material: '40',
                OpenQuantity: 10
            });
            await detailCtrl.loadDetail('TR', '1001911');
            const aRecent = RecentScanStore.getRecentScans(null);
            expect(aRecent.length).toBe(1);
            expect(aRecent[0].number).toBe('1001911');
            expect(aRecent[0].lgnum).toBe('W12');
        });

        test('6. Warehouse list builds from unfiltered load, merges new keys, never shrinks after selection', () => {
            const mainCtrl = new WarehouseScanToController();
            const mainModel = new MockJSONModel({
                warehouses: [{ key: '', text: 'Auto-detect' }],
                recentScans: [{ number: '1001911', docType: 'TR', lgnum: 'W13' }]
            });
            mainCtrl.getModel = jest.fn(() => mainModel);
            mainCtrl.getText = jest.fn(() => 'Auto-detect');

            // Merges recent-scan warehouse W13
            mainCtrl._mergeWarehouses(['W13']);
            // Merges unfiltered load keys W12, W01
            mainCtrl._mergeWarehouses(['W12', 'W01']);

            let aWhs = mainModel.getProperty('/warehouses');
            expect(aWhs).toEqual([
                { key: '', text: 'Auto-detect' },
                { key: 'W01', text: 'W01' },
                { key: 'W12', text: 'W12' },
                { key: 'W13', text: 'W13' }
            ]);

            // Selection of W12 does not shrink or discard other warehouses
            mainCtrl._mergeWarehouses(['W12']);
            aWhs = mainModel.getProperty('/warehouses');
            expect(aWhs.length).toBe(4);
        });

        test('7. Doc-type selectionChange updates docType model property', () => {
            const mainCtrl = new WarehouseScanToController();
            const mainModel = new MockJSONModel({ docType: 'TR' });
            mainCtrl.getModel = jest.fn(() => mainModel);

            const mockListItem = {
                data: jest.fn((k) => (k === 'key' ? 'RES' : null))
            };
            mainCtrl.onDocTypeSelectionChange({
                getParameter: jest.fn((p) => (p === 'listItem' ? mockListItem : null))
            });
            expect(mainModel.getProperty('/docType')).toBe('RES');
        });
    });
});
