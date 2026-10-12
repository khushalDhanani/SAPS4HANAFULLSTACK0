/**
 * Unit Tests for WarehouseScanTo Freestyle UI5 App & Controller (Chunk 4: App 2)
 *
 * Verifies:
 * 1. View model initialization, defaults (autoConfirm=true, lgnum='' -> server-side configured warehouse, docType='TR')
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
    createTOFromTR: jest.fn(),
    postMigoGoodsMovement: jest.fn()
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
            expect(viewModel.getProperty('/lgnum')).toBe('');
            expect(viewModel.getProperty('/docType')).toBe('TR');
            expect(viewModel.getProperty('/completeReservation')).toBe(false);
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

        it('successfully loads TR returned with backend OData V4 field names (TransferRequirement, OpenQuantity)', async () => {
            mockWarehouseScanToService.lookupTR.mockResolvedValueOnce({
                WarehouseNumber: 'W01',
                TransferRequirement: '1000750',
                TRItem: '0001',
                Material: '8900000007',
                MaterialName: 'Distilled THF',
                OpenQuantity: 3000,
                RequiredQuantity: 3000,
                Unit: 'KG',
                IsBatchManaged: true,
                IsSerialManaged: false,
                Batch: 'IN26001220'
            });

            viewModel.setProperty('/scannedTR', '1000750');
            await controller.onLookupTR();

            expect(viewModel.getProperty('/hasTR')).toBe(true);
            expect(viewModel.getProperty('/tr/TRNumber')).toBe('1000750');
            expect(viewModel.getProperty('/tr/OpenQty')).toBe(3000);
            expect(viewModel.getProperty('/tr/MaterialDescription')).toBe('Distilled THF');
            expect(viewModel.getProperty('/pickQty')).toBe(3000);
            expect(viewModel.getProperty('/batch')).toBe('IN26001220');
            expect(viewModel.getProperty('/canSubmit')).toBe(true);
        });

        it('strips TR prefix and extracts numeric TR number when scanned with prefix', async () => {
            mockWarehouseScanToService.lookupTR.mockResolvedValueOnce({
                WarehouseNumber: 'W01',
                TransferRequirement: '1000750',
                TRItem: '0001',
                Material: '8900000007',
                MaterialName: 'Distilled THF',
                OpenQuantity: 3000,
                Unit: 'KG'
            });

            viewModel.setProperty('/scannedTR', 'TR 1000750');
            await controller.onLookupTR();

            expect(mockWarehouseScanToService.lookupTR).toHaveBeenCalledWith('1000750', '', 'TR', '');
            expect(viewModel.getProperty('/scannedTR')).toBe('1000750');
            expect(viewModel.getProperty('/hasTR')).toBe(true);
        });

        it('classifies a RES/RS prefix as a reservation lookup and a TR prefix as a TR lookup, never guessing [mock only, not SAP verification]', async () => {
            mockWarehouseScanToService.lookupTR.mockResolvedValue({ TransferRequirement: '1000790', TRNumber: '1000790', TRItem: '0001', OpenQuantity: 1, Unit: 'KG' });
            viewModel.setProperty('/scannedTR', 'RES 525866');
            await controller.onLookupTR();
            expect(mockWarehouseScanToService.lookupTR).toHaveBeenLastCalledWith('525866', '', 'RES', '');
            expect(viewModel.getProperty('/docType')).toBe('TR'); // the loaded document is now a TR

            viewModel.setProperty('/docType', 'RES');
            viewModel.setProperty('/scannedTR', '525866');
            await controller.onLookupTR();
            expect(mockWarehouseScanToService.lookupTR).toHaveBeenLastCalledWith('525866', '', 'RES', '');
        });

        it('an explicit barcode prefix overrides the selector; a non-numeric scan or a missing selector fails', async () => {
            mockWarehouseScanToService.lookupTR.mockResolvedValue({ TransferRequirement: '1000790', TRNumber: '1000790', TRItem: '0001', OpenQuantity: 1, Unit: 'KG' });
            viewModel.setProperty('/docType', 'RES');
            viewModel.setProperty('/scannedTR', 'TR 1000790');
            await controller.onLookupTR();
            expect(mockWarehouseScanToService.lookupTR).toHaveBeenLastCalledWith('1000790', '', 'TR', '');

            mockWarehouseScanToService.lookupTR.mockClear();
            viewModel.setProperty('/docType', '');
            viewModel.setProperty('/scannedTR', '1000790');
            await controller.onLookupTR();
            expect(mockWarehouseScanToService.lookupTR).not.toHaveBeenCalled();
            expect(viewModel.getProperty('/messageText')).toContain('scanToErrSelectDocType');

            viewModel.setProperty('/docType', 'TR');
            viewModel.setProperty('/scannedTR', 'ABC-1');
            await controller.onLookupTR();
            expect(mockWarehouseScanToService.lookupTR).not.toHaveBeenCalled();
            expect(viewModel.getProperty('/messageText')).toContain('scanToErrNotANumber');
        });

        it('shows the item choice for a multi-item TR and loads the chosen item', async () => {
            mockWarehouseScanToService.lookupTR.mockResolvedValueOnce({ TransferRequirement: '1000790', TRNumber: '1000790', TRItem: '', Items: [{ Tbpos: '0001' }, { Tbpos: '0002' }], OpenQuantity: 0 });
            viewModel.setProperty('/scannedTR', '1000790');
            await controller.onLookupTR();
            expect(viewModel.getProperty('/trItems').length).toBe(2);
            expect(viewModel.getProperty('/canSubmit')).toBe(false);

            mockWarehouseScanToService.lookupTR.mockResolvedValueOnce({ TransferRequirement: '1000790', TRNumber: '1000790', TRItem: '0002', Items: [{ Tbpos: '0001' }, { Tbpos: '0002' }], OpenQuantity: 3, Unit: 'KG' });
            await controller.onTRItemChange({ getParameter: () => ({ getKey: () => '0002' }), getSource: () => ({ getSelectedKey: () => '0002' }) });
            expect(mockWarehouseScanToService.lookupTR).toHaveBeenLastCalledWith('1000790', '', 'TR', '0002');
            expect(viewModel.getProperty('/tr/TRItem')).toBe('0002');
            expect(viewModel.getProperty('/canSubmit')).toBe(true);
        });

        it('extracts numeric Tbnum from value help item title when context is unavailable', () => {
            const lookupSpy = jest.spyOn(controller, 'onLookupTR').mockImplementation(() => {});
            controller.onConfirmTRValueHelp({
                getParameter: () => ({
                    getBindingContext: () => null,
                    getTitle: () => 'TR 1000750 (Mvt 101)'
                })
            });

            expect(viewModel.getProperty('/scannedTR')).toBe('1000750');
            expect(lookupSpy).toHaveBeenCalled();
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

    describe('3b. Inline Open TR List (direct selection)', () => {
        it('loads open TRs into the view model (shown directly on the page)', async () => {
            await controller._loadOpenTRs();

            expect(mockWarehouseScanToService.getOpenTRs).toHaveBeenCalledWith('');
            expect(viewModel.getProperty('/openTRs').length).toBe(1);
            expect(viewModel.getProperty('/openTRs')[0].Tbnum).toBe('0001001839');
            expect(viewModel.getProperty('/isLoadingTRs')).toBe(false);
        });

        it('row press loads the selected TR and triggers the next process (onLookupTR)', () => {
            const lookupSpy = jest.spyOn(controller, 'onLookupTR').mockImplementation(() => {});
            controller.onOpenTRPress({
                getParameter: () => null,
                getSource: () => ({ getBindingContext: () => ({ getProperty: () => '0001001839' }) })
            });

            expect(viewModel.getProperty('/scannedTR')).toBe('0001001839');
            expect(lookupSpy).toHaveBeenCalled();
        });
    });

    describe('4. Pick Quantity Validation & Max Qty Setting', () => {
        beforeEach(() => {
            viewModel.setProperty('/hasTR', true);
            viewModel.setProperty('/tr', {
                TRItem: '0001',
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
                TRItem: '0001',
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

        it('pre-fills FIFO batch on TR lookup when TR specifies no batch', async () => {
            mockWarehouseScanToService.lookupTR.mockResolvedValueOnce({
                TransferRequirement: '1000663',
                TRNumber: '1000663',
                TRItem: '0001',
                OpenQuantity: 10,
                IsBatchManaged: true,
                IsSerialManaged: false,
                Batch: '',
                FifoBatch: 'IN26001216',
                SuggestedBatches: [
                    { Batch: 'IN26001216', FifoRank: 1, IsRecommended: true, AvailableStock: 3000, Recommendation: 'FIFO Recommended' },
                    { Batch: 'IN26001220', FifoRank: 2, IsRecommended: false, AvailableStock: 1000, Recommendation: 'FIFO Rank #2' }
                ]
            });
            viewModel.setProperty('/scannedTR', '1000663');
            await controller.onLookupTR();

            expect(viewModel.getProperty('/batch')).toBe('IN26001216');
            expect(viewModel.getProperty('/fifoBatch')).toBe('IN26001216');
            expect(viewModel.getProperty('/isFifoApplied')).toBe(true);
            expect(viewModel.getProperty('/suggestedBatches')).toHaveLength(2);
            expect(viewModel.getProperty('/canSubmit')).toBe(true);
        });

        it('onApplyFifoBatch applies the recommended FIFO batch and marks it valid', () => {
            viewModel.setProperty('/fifoBatch', 'FIFO-REC-01');
            viewModel.setProperty('/batch', '');
            controller.onApplyFifoBatch();

            expect(viewModel.getProperty('/batch')).toBe('FIFO-REC-01');
            expect(viewModel.getProperty('/isFifoApplied')).toBe(true);
            expect(viewModel.getProperty('/batchValueState')).toBe('None');
            expect(viewModel.getProperty('/canSubmit')).toBe(true);
        });

        it('onSelectBatchSuggestion selects a batch from the FIFO table context', () => {
            viewModel.setProperty('/fifoBatch', 'FIFO-REC-01');
            const mockEvent = {
                getSource: () => ({
                    getBindingContext: () => ({
                        getProperty: (prop) => (prop === 'Batch' ? 'FIFO-REC-02' : null)
                    })
                })
            };
            controller.onSelectBatchSuggestion(mockEvent);

            expect(viewModel.getProperty('/batch')).toBe('FIFO-REC-02');
            expect(viewModel.getProperty('/isFifoApplied')).toBe(false);
            expect(viewModel.getProperty('/canSubmit')).toBe(true);
        });

        it('onSuggestionBatchSelected applies batch from Input suggestions', () => {
            controller.onSuggestionBatchSelected({
                getParameter: () => ({
                    getKey: () => 'BATCH-SUGG-99',
                    getText: () => 'BATCH-SUGG-99'
                })
            });

            expect(viewModel.getProperty('/batch')).toBe('BATCH-SUGG-99');
            expect(viewModel.getProperty('/canSubmit')).toBe(true);
        });

        it('onApplyFifoBatch records sourceStorageType and sourceStorageBin from suggestedBatches', () => {
            viewModel.setProperty('/fifoBatch', 'BATCH-FIFO-01');
            viewModel.setProperty('/suggestedBatches', [
                { Batch: 'BATCH-FIFO-01', StorageType: 'RM1', StorageBin: '0-L0001-03' }
            ]);
            controller.onApplyFifoBatch();

            expect(viewModel.getProperty('/batch')).toBe('BATCH-FIFO-01');
            expect(viewModel.getProperty('/sourceStorageType')).toBe('RM1');
            expect(viewModel.getProperty('/sourceStorageBin')).toBe('0-L0001-03');
        });
    });

    describe('6. Serial Number Capture & Validation', () => {
        beforeEach(() => {
            viewModel.setProperty('/hasTR', true);
            viewModel.setProperty('/tr', {
                TRItem: '0001',
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

        it('auto-fills required serial series from suggestedSerials up to pickQty', () => {
            viewModel.setProperty('/pickQty', 3);
            viewModel.setProperty('/suggestedSerials', ['CON-40-001', 'CON-40-002', 'CON-40-003', 'CON-40-004']);
            viewModel.setProperty('/serials', []);

            controller.onAutoFillSerials();

            const serials = viewModel.getProperty('/serials');
            expect(serials).toHaveLength(3);
            expect(serials.map((s) => s.serial)).toEqual(['CON-40-001', 'CON-40-002', 'CON-40-003']);
            expect(viewModel.getProperty('/serialsStatusState')).toBe('Success');
            expect(viewModel.getProperty('/canSubmit')).toBe(true);
        });

        it('onAddSuggestedSerial adds a clicked serial from suggestion strip', () => {
            viewModel.setProperty('/pickQty', 2);
            viewModel.setProperty('/serials', []);
            const mockBtn = {
                getSource: () => ({
                    getText: () => 'CON-40-001'
                })
            };
            controller.onAddSuggestedSerial(mockBtn);

            const serials = viewModel.getProperty('/serials');
            expect(serials).toHaveLength(1);
            expect(serials[0].serial).toBe('CON-40-001');
        });
    });

    describe('7. Transfer Order Processing (onProcessTO) & Auto-Confirm', () => {
        beforeEach(() => {
            viewModel.setProperty('/hasTR', true);
            viewModel.setProperty('/tr', {
                TRNumber: '0001001839',
                TRItem: '0001',
                Material: '8000000023',
                MaterialDescription: 'Drive Belt B20',
                OpenQty: 5,
                Unit: 'KG',
                IsBatchManaged: false,
                IsSerialManaged: false
            });
            viewModel.setProperty('/pickQty', 5);
            viewModel.setProperty('/autoConfirm', true);
            controller._validateForm();
        });

        it('calls createTOFromTR with autoConfirm=true and autoPostMigo=true and presents confirmed result with material document', async () => {
            mockWarehouseScanToService.createTOFromTR.mockResolvedValueOnce({
                TransferOrder: '1012970',
                ConfirmationNumber: '0001',
                WarehouseNumber: 'W01',
                Status: '05',
                IsConfirmed: true,
                ConfirmedBy: 'SAP_OPERATOR',
                MaterialDocument: '4900050128',
                MaterialDocYear: '2026',
                StockEffect: 'Stock transferred to Storage Location CS01'
            });

            await controller.onProcessTO();

            expect(mockWarehouseScanToService.createTOFromTR).toHaveBeenCalledWith({
                lgnum: '',
                tbnum: '0001001839',
                tbpos: '0001',
                qty: 5,
                unit: 'KG',
                batch: '',
                serials: [],
                autoConfirm: true,
                autoPostMigo: true,
                CompleteReservation: false,
                sourceStorageType: '',
                sourceStorageBin: '',
                storageUnit: ''
            });

            expect(viewModel.getProperty('/hasResult')).toBe(true);
            expect(viewModel.getProperty('/result/TransferOrder')).toBe('1012970');
            expect(viewModel.getProperty('/result/IsConfirmed')).toBe(true);
            expect(viewModel.getProperty('/result/StatusText')).toBe('Goods Issue Posted');
            expect(viewModel.getProperty('/result/Material')).toBe('8000000023');
            expect(viewModel.getProperty('/result/Quantity')).toBe(5);
            expect(viewModel.getProperty('/result/MaterialDocument')).toBe('4900050128');
            expect(viewModel.getProperty('/result/StockEffect')).toBe('Stock transferred to Storage Location CS01');
            expect(viewModel.getProperty('/canRetryMigo')).toBe(false);
            expect(viewModel.getProperty('/hasTR')).toBe(false);
            expect(mockMessageToast.show).toHaveBeenCalledWith(expect.stringContaining('4900050128'));
        });

        it('handles goods movement failure (status 90) by displaying warning message and enabling Retry button', async () => {
            mockWarehouseScanToService.createTOFromTR.mockResolvedValueOnce({
                TransferOrder: '1012971',
                ConfirmationNumber: '0002',
                WarehouseNumber: 'W01',
                Status: '90',
                IsConfirmed: true,
                ConfirmedBy: 'SAP_OPERATOR',
                ReservationNo: '0000524979',
                ReservationItem: '0001',
                Material: '8000000023',
                Quantity: 5,
                Unit: 'KG',
                MovementType: '311',
                ErrorMessage: 'Posting date 20261010 period closed'
            });

            await controller.onProcessTO();

            expect(viewModel.getProperty('/hasResult')).toBe(true);
            expect(viewModel.getProperty('/canRetryMigo')).toBe(true);
            expect(viewModel.getProperty('/resultMessage')).toContain('Posting date 20261010 period closed');
        });

        it('onRetryMigo triggers postMigoGoodsMovement and recovers to status 05 on success', async () => {
            viewModel.setProperty('/result', {
                TransferOrder: '1012971',
                ReservationNo: '0000524979',
                ReservationItem: '0001',
                Material: '8000000023',
                Quantity: 5,
                Unit: 'KG',
                MovementType: '311',
                Status: '90',
                ProcessId: 'A1B2C3D4-0000-4000-8000-000000000001'
            });
            viewModel.setProperty('/canRetryMigo', true);

            mockWarehouseScanToService.postMigoGoodsMovement.mockResolvedValueOnce({
                MaterialDocument: '4900050129',
                MaterialDocYear: '2026',
                Status: '05',
                StockEffect: 'Stock transferred to Storage Location CS01'
            });

            await controller.onRetryMigo();

            expect(mockWarehouseScanToService.postMigoGoodsMovement).toHaveBeenCalledWith({
                ReservationNo: '0000524979',
                ReservationItem: '0001',
                TransferOrder: '1012971',
                MovementType: '311',
                Material: '8000000023',
                Quantity: 5,
                Unit: 'KG',
                CompleteReservation: false,
                ProcessId: 'A1B2C3D4-0000-4000-8000-000000000001'
            });

            expect(viewModel.getProperty('/canRetryMigo')).toBe(false);
            expect(viewModel.getProperty('/result/MaterialDocument')).toBe('4900050129');
            expect(viewModel.getProperty('/result/Status')).toBe('05');
            expect(mockMessageToast.show).toHaveBeenCalledWith(expect.stringContaining('4900050129'));
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
