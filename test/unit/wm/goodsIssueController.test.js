/**
 * Unit Tests for GoodsIssue Controller (LE-WM Movement 261)
 * Tests the 3-step error-proof workflow: Select Reservation & Component → Validate & Configure → Review → Post Outcome
 */

let GoodsIssueController;
const mockMessageBox = {
    error: jest.fn(),
    success: jest.fn(),
    warning: jest.fn(),
    information: jest.fn(),
    confirm: jest.fn((msg, opts) => {
        if (opts && typeof opts.onClose === 'function') {
            opts.onClose('OK');
        }
    }),
    Action: { CLOSE: 'CLOSE', OK: 'OK', CANCEL: 'CANCEL' }
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

const mockFragmentDialog = {
    open: jest.fn(),
    close: jest.fn(),
    destroy: jest.fn()
};

const mockFragment = {
    load: jest.fn().mockResolvedValue(mockFragmentDialog)
};

const mockGoodsIssueService = {
    fetchOpenReservations: jest.fn().mockResolvedValue([]),
    fetchOpenItems: jest.fn().mockResolvedValue([]),
    fetchMaterialBatches: jest.fn(),
    postGoodsIssue: jest.fn(),
    submitGoodsIssueRequest: jest.fn(),
    resolveIdentifier: jest.fn(),
    getQueueSummary: jest.fn().mockResolvedValue({ QueuedCount: 0, Items: [] }),
    retryQueuedGoodsIssue: jest.fn().mockResolvedValue({ Success: true, MaterialDocument: '4900000001', MaterialDocYear: '2026' }),
    clearQueuedGoodsIssue: jest.fn().mockResolvedValue(true)
};

const mockRouter = {
    getRoute: jest.fn().mockReturnValue({ attachPatternMatched: jest.fn() }),
    navTo: jest.fn()
};

const mockWizard = {
    goToStep: jest.fn(),
    validateStep: jest.fn(),
    invalidateStep: jest.fn(),
    discardProgress: jest.fn(),
    nextStep: jest.fn(),
    previousStep: jest.fn(),
    getProgress: jest.fn().mockReturnValue(1)
};
const mockStep = { getId: () => 'mockStep' };

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
            this.byId = jest.fn((id) => {
                if (id === 'giWizard') return mockWizard;
                return mockStep;
            });
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
            GoodsIssueController = factory(
                mockBaseController,
                MockJSONModel,
                mockFragment,
                mockGoodsIssueService,
                mockMessageToast,
                mockMessageBox
            );
        },
        model: {
            json: {
                JSONModel: MockJSONModel
            }
        },
        core: {
            Fragment: mockFragment
        },
        require: jest.fn()
    }
};

// Require controller after defining mock sap.ui.define
require('../../../app/fiori-app/webapp/modules/wm/goods-issue/controller/GoodsIssue.controller');

// ===== Mock Resolution Response =====
const mockResolution = {
    ScannedBarcode: '168779',
    ScannedType: 'RESERVATION',
    ScannedTypeLabel: 'Reservation',
    ReservationNo: '168779',
    OrderNo: '1000856',
    Plant: '1120',
    PlantName: 'Plant 1120',
    MovementType: '261',
    MovementTypeName: 'GI for order',
    ActiveItem: {
        ReservationNo: '168779',
        ReservationItem: '0001',
        OrderNo: '1000856',
        Material: '3000000200',
        MaterialDesc: 'Test Chemical',
        Plant: '1120',
        StorageLocation: 'CS01',
        StorageBin: 'BIN-01',
        Batch: 'IN25000963',
        ExpiryDate: '2027-06-24',
        BatchStatusState: 'Success',
        BatchStatusText: 'VALID',
        Unit: 'KG',
        RequiredQty: 653.847,
        WithdrawnQty: 0,
        OpenQty: 653.847,
        MovementType: '261',
        MovementTypeName: 'GI for order',
        PackagingUnits: []
    },
    Items: [
        {
            ReservationNo: '168779',
            ReservationItem: '0001',
            OrderNo: '1000856',
            Material: '3000000200',
            MaterialDesc: 'Test Chemical',
            Plant: '1120',
            StorageLocation: 'CS01',
            StorageBin: 'BIN-01',
            Batch: 'IN25000963',
            ExpiryDate: '2027-06-24',
            BatchStatusState: 'Success',
            BatchStatusText: 'VALID',
            Unit: 'KG',
            RequiredQty: 653.847,
            WithdrawnQty: 0,
            OpenQty: 653.847,
            MovementType: '261',
            MovementTypeName: 'GI for order',
            PackagingUnits: []
        }
    ],
    AvailableBatches: [
        {
            Material: '3000000200',
            Plant: '1120',
            Batch: 'IN25000963',
            ExpiryDate: '2027-06-24',
            StatusState: 'Success',
            StatusText: 'VALID',
            AvailableStock: 800,
            Unit: 'KG'
        }
    ],
    AvailableStock: 800,
    DefaultStorageLocation: 'CS01',
    DefaultStorageLocationName: 'Raw Material',
    DefaultStorageBin: 'BIN-01'
};

describe('GoodsIssue Controller Unit Tests (3-Step Fiori Workflow)', () => {
    let controller;

    beforeEach(() => {
        jest.clearAllMocks();
        controller = new GoodsIssueController();
        controller.onInit();
    });

    // =================================================================
    // INITIALIZATION & STATE
    // =================================================================
    describe('Initialization & State', () => {
        it('should initialize giView model with default values', () => {
            const oModel = controller.getView().getModel('giView');
            expect(oModel).toBeDefined();
            expect(oModel.getProperty('/currentStep')).toBe(1);
            expect(oModel.getProperty('/canProceedNext')).toBe(false);
            expect(oModel.getProperty('/audioEnabled')).toBe(true);
            expect(oModel.getProperty('/openReservations')).toEqual([]);
            expect(oModel.getProperty('/selectedReservation')).toBe('');
            expect(oModel.getProperty('/resolved')).toBeNull();
            expect(oModel.getProperty('/activeItem')).toBeNull();
            expect(oModel.getProperty('/isValid')).toBe(false);
            expect(oModel.getProperty('/issueQty')).toBe(0);
            expect(oModel.getProperty('/postResult')).toBeNull();
        });

        it('should load open reservations on init', () => {
            expect(mockGoodsIssueService.fetchOpenReservations).toHaveBeenCalled();
        });

        it('should toggle audio cues', () => {
            const oModel = controller.getView().getModel('giView');
            expect(oModel.getProperty('/audioEnabled')).toBe(true);
            controller.onToggleAudio();
            expect(oModel.getProperty('/audioEnabled')).toBe(false);
            controller.onToggleAudio();
            expect(oModel.getProperty('/audioEnabled')).toBe(true);
        });

        it('should reset workflow to step 1 on reset', () => {
            const oModel = controller.getView().getModel('giView');
            oModel.setProperty('/currentStep', 3);
            oModel.setProperty('/selectedReservation', '168779');
            oModel.setProperty('/resolved', mockResolution);
            oModel.setProperty('/activeItem', mockResolution.ActiveItem);
            oModel.setProperty('/issueQty', 100);
            oModel.setProperty('/isValid', true);

            controller.onResetWorkflow();
            expect(oModel.getProperty('/currentStep')).toBe(1);
            expect(oModel.getProperty('/selectedReservation')).toBe('');
            expect(oModel.getProperty('/resolved')).toBeNull();
            expect(oModel.getProperty('/activeItem')).toBeNull();
            expect(oModel.getProperty('/issueQty')).toBe(0);
            expect(oModel.getProperty('/isValid')).toBe(false);
            expect(oModel.getProperty('/canProceedNext')).toBe(false);
            expect(oModel.getProperty('/postResult')).toBeNull();
            expect(mockWizard.discardProgress).toHaveBeenCalled();
            expect(mockWizard.goToStep).toHaveBeenCalled();
        });

        it('should navigate back to dashboard', () => {
            controller.onNavBack();
            expect(mockRouter.navTo).toHaveBeenCalledWith('dashboard', {}, true);
        });
    });

    // =================================================================
    // STEP 1: SELECT RESERVATION & COMPONENT
    // =================================================================
    describe('Step 1: Select Reservation & Component', () => {
        const mockReservations = [
            { ReservationNo: '168779', OrderNo: '1000856', Plant: '1120', ItemCount: 7, DisplayText: 'Reservation 168779 (Order 1000856)' }
        ];

        it('should load open reservations from SAP', async () => {
            mockGoodsIssueService.fetchOpenReservations.mockResolvedValueOnce(mockReservations);

            await controller.loadOpenReservations();
            const oModel = controller.getView().getModel('giView');
            expect(oModel.getProperty('/openReservations').length).toBe(1);
            expect(oModel.getProperty('/openReservations')[0].ReservationNo).toBe('168779');
        });

        it('should refresh reservations with toast feedback', async () => {
            mockGoodsIssueService.fetchOpenReservations.mockResolvedValueOnce([
                { ReservationNo: '1', DisplayText: 'Test' },
                { ReservationNo: '2', DisplayText: 'Test2' }
            ]);

            await controller.onRefreshReservations();
            expect(mockMessageToast.show).toHaveBeenCalledWith(expect.stringContaining('2 open reservations'));
        });

        it('should load reservation details and components when reservation selected from dropdown', async () => {
            mockGoodsIssueService.fetchOpenItems.mockResolvedValueOnce(mockResolution.Items);
            const oModel = controller.getView().getModel('giView');
            oModel.setProperty('/openReservations', mockReservations);

            const mockEvent = {
                getParameter: (p) => {
                    if (p === 'selectedItem') return { getKey: () => '168779' };
                    return null;
                },
                getSource: () => ({ getSelectedKey: () => '168779' })
            };

            await controller.onReservationSelected(mockEvent);

            expect(oModel.getProperty('/selectedReservation')).toBe('168779');
            expect(mockGoodsIssueService.fetchOpenItems).toHaveBeenCalledWith('1000856', '168779');
            expect(oModel.getProperty('/resolved')).toBeDefined();
            expect(oModel.getProperty('/resolved/ReservationNo')).toBe('168779');
            expect(oModel.getProperty('/resolved/Items').length).toBe(1);
        });

        it('should show error when loading reservation components fails', async () => {
            mockGoodsIssueService.fetchOpenItems.mockRejectedValueOnce(new Error('SAP Gateway error: timeout'));
            const oModel = controller.getView().getModel('giView');
            oModel.setProperty('/openReservations', mockReservations);

            await controller._loadReservationDetails('168779');

            expect(mockMessageBox.error).toHaveBeenCalledWith(expect.stringContaining('SAP Gateway error: timeout'));
        });

        it('should open declarative reservation value help dialog', async () => {
            await controller.onOpenReservationValueHelp();
            expect(mockFragment.load).toHaveBeenCalledWith(expect.objectContaining({
                name: 'saps4hana.fiori.modules.wm.goods-issue.view.ReservationValueHelpDialog'
            }));
            expect(mockFragmentDialog.open).toHaveBeenCalled();
        });

        it('should confirm selection in reservation value help dialog and load items', async () => {
            mockGoodsIssueService.fetchOpenItems.mockResolvedValueOnce(mockResolution.Items);
            const oModel = controller.getView().getModel('giView');
            oModel.setProperty('/openReservations', mockReservations);

            const mockEvent = {
                getParameter: (p) => p === 'selectedItem' ? {
                    getBindingContext: () => ({
                        getProperty: (prop) => prop === 'ReservationNo' ? '168779' : ''
                    })
                } : undefined
            };

            await controller.onConfirmReservationValueHelp(mockEvent);

            expect(oModel.getProperty('/selectedReservation')).toBe('168779');
            expect(mockGoodsIssueService.fetchOpenItems).toHaveBeenCalledWith('1000856', '168779');
        });

        it('should filter components table on search', () => {
            const mockBinding = { filter: jest.fn() };
            controller.byId = jest.fn((id) => {
                if (id === 'tblComponentItems') {
                    return { getBinding: () => mockBinding };
                }
                if (id === 'giWizard') return mockWizard;
                return mockStep;
            });

            controller.onSearchComponents({ getParameter: (p) => p === 'newValue' ? '' : undefined });
            expect(mockBinding.filter).toHaveBeenCalledWith([]);
        });

        it('should select component for validation, validate step 1, and advance to step 2', () => {
            const oModel = controller.getView().getModel('giView');
            oModel.setProperty('/resolved', mockResolution);

            const mockEvent = {
                getSource: () => ({
                    getBindingContext: () => ({
                        getObject: () => mockResolution.Items[0]
                    })
                })
            };

            controller.onSelectComponentForValidation(mockEvent);

            expect(oModel.getProperty('/currentStep')).toBe(2);
            expect(oModel.getProperty('/activeItem/Material')).toBe('3000000200');
            expect(oModel.getProperty('/issueQty')).toBe(653.847);
            expect(oModel.getProperty('/canProceedNext')).toBe(true);
            expect(mockWizard.validateStep).toHaveBeenCalled();
            expect(mockWizard.nextStep).toHaveBeenCalled();
        });

        it('should prevent selecting completed (zero open qty) component', () => {
            const completedItem = { ...mockResolution.Items[0], OpenQty: 0 };
            const mockEvent = {
                getSource: () => ({
                    getBindingContext: () => ({
                        getObject: () => completedItem
                    })
                })
            };

            controller.onSelectComponentForValidation(mockEvent);
            expect(mockMessageToast.show).toHaveBeenCalledWith(expect.stringContaining('already completed'));
        });
    });

    // =================================================================
    // STEP 2: CONFIGURE & VALIDATE
    // =================================================================
    describe('Step 2: Configure & Validate', () => {
        beforeEach(async () => {
            mockGoodsIssueService.fetchOpenItems.mockResolvedValueOnce(mockResolution.Items);
            const oModel = controller.getView().getModel('giView');
            oModel.setProperty('/openReservations', [
                { ReservationNo: '168779', OrderNo: '1000856', Plant: '1120' }
            ]);

            await controller._loadReservationDetails('168779');

            // Select component line -> moves to Step 2
            const mockEvent = {
                getSource: () => ({
                    getBindingContext: () => ({
                        getObject: () => mockResolution.Items[0]
                    })
                })
            };
            controller.onSelectComponentForValidation(mockEvent);
        });

        it('should be on step 2 with validation checks populated', () => {
            const oModel = controller.getView().getModel('giView');
            expect(oModel.getProperty('/currentStep')).toBe(2);
            const aChecks = oModel.getProperty('/validationChecks');
            expect(aChecks.length).toBeGreaterThan(0);
        });

        it('should validate that issue qty > 0', () => {
            const oModel = controller.getView().getModel('giView');
            oModel.setProperty('/issueQty', 0);
            controller._validateInputs();

            expect(oModel.getProperty('/isValid')).toBe(false);
            expect(oModel.getProperty('/issueQtyState')).toBe('Error');
        });

        it('should validate issue qty <= open qty', () => {
            const oModel = controller.getView().getModel('giView');
            oModel.setProperty('/issueQty', 700); // exceeds 653.847
            controller._validateInputs();

            expect(oModel.getProperty('/isValid')).toBe(false);
            const aChecks = oModel.getProperty('/validationChecks');
            const qtyCheck = aChecks.find(c => c.label.includes('open requirement'));
            expect(qtyCheck.passed).toBe(false);
        });

        it('should validate issue qty <= available stock', () => {
            const oModel = controller.getView().getModel('giView');
            oModel.setProperty('/issueQty', 850); // exceeds stock of 800
            controller._validateInputs();

            expect(oModel.getProperty('/isValid')).toBe(false);
        });

        it('should pass validation with valid quantity', () => {
            const oModel = controller.getView().getModel('giView');
            oModel.setProperty('/issueQty', 500);
            controller._validateInputs();

            expect(oModel.getProperty('/isValid')).toBe(true);
            expect(oModel.getProperty('/issueQtyState')).toBe('Success');
        });

        it('should detect expired batch as invalid', () => {
            const oModel = controller.getView().getModel('giView');
            const oActive = oModel.getProperty('/activeItem');
            oActive.BatchStatusState = 'Error';
            oActive.BatchStatusText = 'EXPIRED';
            oModel.setProperty('/activeItem', oActive);
            oModel.setProperty('/issueQty', 500);
            controller._validateInputs();

            expect(oModel.getProperty('/isValid')).toBe(false);
        });

        it('should set isValid=true only when all checks pass', () => {
            const oModel = controller.getView().getModel('giView');
            oModel.setProperty('/issueQty', 653.847);
            controller._validateInputs();

            expect(oModel.getProperty('/isValid')).toBe(true);
            const aChecks = oModel.getProperty('/validationChecks');
            const allPassed = aChecks.every(c => c.passed);
            expect(allPassed).toBe(true);
        });

        it('should fill open qty on button press', () => {
            const oModel = controller.getView().getModel('giView');
            oModel.setProperty('/issueQty', 10);
            controller.onFillOpenQty();

            expect(oModel.getProperty('/issueQty')).toBe(653.847);
            expect(mockMessageToast.show).toHaveBeenCalledWith(expect.stringContaining('653.847'));
        });

        it('should validate difference qty constraints', () => {
            const oModel = controller.getView().getModel('giView');
            oModel.setProperty('/issueQty', 400);
            oModel.setProperty('/differenceQty', 300); // 400+300=700 > 653.847
            controller._validateInputs();

            expect(oModel.getProperty('/isValid')).toBe(false);
        });

        it('should navigate back to step 1', () => {
            controller.onBackToStep1();
            const oModel = controller.getView().getModel('giView');
            expect(oModel.getProperty('/currentStep')).toBe(1);
        });

        it('should block proceed to review when validation fails', () => {
            const oModel = controller.getView().getModel('giView');
            oModel.setProperty('/issueQty', 0);
            oModel.setProperty('/isValid', false);

            controller.onProceedToReview();
            expect(mockMessageBox.error).toHaveBeenCalledWith(expect.stringContaining('fix all validation errors'));
            expect(oModel.getProperty('/currentStep')).toBe(2);
        });

        it('should proceed to review when validation passes', () => {
            const oModel = controller.getView().getModel('giView');
            oModel.setProperty('/issueQty', 500);
            controller._validateInputs();

            controller.onProceedToReview();
            expect(oModel.getProperty('/currentStep')).toBe(3);
        });
    });

    // =================================================================
    // STEP 3: REVIEW CONFIRMATION SUMMARY
    // =================================================================
    describe('Step 3: Review Confirmation Summary', () => {
        beforeEach(async () => {
            mockGoodsIssueService.fetchOpenItems.mockResolvedValueOnce(mockResolution.Items);
            const oModel = controller.getView().getModel('giView');
            oModel.setProperty('/openReservations', [
                { ReservationNo: '168779', OrderNo: '1000856', Plant: '1120' }
            ]);
            await controller._loadReservationDetails('168779');

            const mockEvent = {
                getSource: () => ({
                    getBindingContext: () => ({
                        getObject: () => mockResolution.Items[0]
                    })
                })
            };
            controller.onSelectComponentForValidation(mockEvent);
            oModel.setProperty('/issueQty', 500);
            controller._validateInputs();
            controller.onProceedToReview();
        });

        it('should be on step 3 with valid data', () => {
            const oModel = controller.getView().getModel('giView');
            expect(oModel.getProperty('/currentStep')).toBe(3);
            expect(oModel.getProperty('/resolved/ReservationNo')).toBe('168779');
            expect(oModel.getProperty('/activeItem/Material')).toBe('3000000200');
            expect(oModel.getProperty('/issueQty')).toBe(500);
        });

        it('should navigate back to step 2 on back button', () => {
            controller.onBackToStep2();
            const oModel = controller.getView().getModel('giView');
            expect(oModel.getProperty('/currentStep')).toBe(2);
        });
    });

    // =================================================================
    // STEP 4: POST GOODS ISSUE & OUTCOME
    // =================================================================
    describe('Step 4: Post Goods Issue & Outcome', () => {
        beforeEach(async () => {
            mockGoodsIssueService.fetchOpenItems.mockResolvedValueOnce(mockResolution.Items);
            const oModel = controller.getView().getModel('giView');
            oModel.setProperty('/openReservations', [
                { ReservationNo: '168779', OrderNo: '1000856', Plant: '1120' }
            ]);
            await controller._loadReservationDetails('168779');

            const mockEvent = {
                getSource: () => ({
                    getBindingContext: () => ({
                        getObject: () => mockResolution.Items[0]
                    })
                })
            };
            controller.onSelectComponentForValidation(mockEvent);
            oModel.setProperty('/issueQty', 500);
            controller._validateInputs();
        });

        it('should post successfully and show material document', async () => {
            mockGoodsIssueService.postGoodsIssue.mockResolvedValueOnce({
                MaterialDocument: '5000012345',
                MaterialDocYear: '2026',
                TransferOrder: 'T0001',
                Success: true,
                Message: 'Goods Issue 261 posted'
            });

            await controller.onPostGoodsIssue();
            const oModel = controller.getView().getModel('giView');
            expect(oModel.getProperty('/currentStep')).toBe(4);
            expect(oModel.getProperty('/postResult/Success')).toBe(true);
            expect(oModel.getProperty('/postResult/MaterialDocument')).toBe('5000012345');
            expect(oModel.getProperty('/postResult/MaterialDocYear')).toBe('2026');
        });

        it('should show error when posting fails', async () => {
            mockGoodsIssueService.postGoodsIssue.mockRejectedValueOnce(
                new Error('SAP Gateway rejected: API not released')
            );

            await controller.onPostGoodsIssue();
            const oModel = controller.getView().getModel('giView');
            expect(oModel.getProperty('/currentStep')).toBe(4);
            expect(oModel.getProperty('/postResult/Success')).toBe(false);
            expect(oModel.getProperty('/postResult/Message')).toContain('API not released');
        });

        it('should block posting expired batch', () => {
            const oModel = controller.getView().getModel('giView');
            const oActive = oModel.getProperty('/activeItem');
            oActive.BatchStatusState = 'Error';
            oActive.BatchStatusText = 'EXPIRED';
            oActive.Batch = 'EXPIRED_BATCH';
            oModel.setProperty('/activeItem', oActive);

            controller.onPostGoodsIssue();
            expect(mockMessageBox.error).toHaveBeenCalledWith(expect.stringContaining('expired'));
        });

        it('should block posting zero quantity', () => {
            const oModel = controller.getView().getModel('giView');
            oModel.setProperty('/issueQty', 0);

            controller.onPostGoodsIssue();
            expect(mockMessageBox.error).toHaveBeenCalledWith(expect.stringContaining('greater than zero'));
        });

        it('should include difference data in payload when applicable', async () => {
            const oModel = controller.getView().getModel('giView');
            oModel.setProperty('/differenceQty', 50);
            oModel.setProperty('/differenceReason', '02');
            oModel.setProperty('/finalIssue', true);

            mockGoodsIssueService.postGoodsIssue.mockResolvedValueOnce({
                MaterialDocument: '5000012346',
                MaterialDocYear: '2026',
                DifferenceCleared: true,
                Success: true
            });

            await controller.onPostGoodsIssue();
            expect(mockGoodsIssueService.postGoodsIssue).toHaveBeenCalledWith(
                expect.objectContaining({
                    DifferenceQty: 50,
                    DifferenceReason: '02',
                    DifferenceStorageType: '999',
                    FinalIssue: true
                })
            );
        });
    });

    // =================================================================
    // BATCH SELECTION
    // =================================================================
    describe('Batch Selection', () => {
        beforeEach(async () => {
            mockGoodsIssueService.fetchOpenItems.mockResolvedValueOnce(mockResolution.Items);
            const oModel = controller.getView().getModel('giView');
            oModel.setProperty('/openReservations', [
                { ReservationNo: '168779', OrderNo: '1000856', Plant: '1120' }
            ]);
            await controller._loadReservationDetails('168779');

            const mockEvent = {
                getSource: () => ({
                    getBindingContext: () => ({
                        getObject: () => mockResolution.Items[0]
                    })
                })
            };
            controller.onSelectComponentForValidation(mockEvent);
        });

        it('should open batch selection dialog', async () => {
            mockGoodsIssueService.fetchMaterialBatches.mockResolvedValueOnce([
                { Batch: 'IN25000963', ExpiryDate: '2027-06-24', StatusState: 'Success', StatusText: 'VALID', AvailableStock: 800 }
            ]);

            await controller.onOpenBatchSelectionDialog();
            expect(mockGoodsIssueService.fetchMaterialBatches).toHaveBeenCalledWith('3000000200', '1120', 'CS01');
        });

        it('should assign selected valid batch and re-validate', () => {
            const oModel = controller.getView().getModel('giView');
            const mockEvent = {
                getSource: () => ({
                    getBindingContext: (m) => ({
                        getObject: () => ({
                            Batch: 'IN25000970',
                            ExpiryDate: '2027-12-31',
                            StatusState: 'Success',
                            StatusText: 'VALID',
                            StorageBin: 'BIN-02',
                            AvailableStock: 500
                        })
                    })
                })
            };

            controller.onSelectBatch(mockEvent);
            expect(oModel.getProperty('/activeItem/Batch')).toBe('IN25000970');
            expect(oModel.getProperty('/availableStock')).toBe(500);
            expect(mockMessageToast.show).toHaveBeenCalledWith(expect.stringContaining('IN25000970'));
        });

        it('should block selection of expired batch', () => {
            const mockEvent = {
                getSource: () => ({
                    getBindingContext: (m) => ({
                        getObject: () => ({
                            Batch: 'EXPIRED123',
                            ExpiryDate: '2024-01-01',
                            StatusState: 'Error',
                            StatusText: 'EXPIRED'
                        })
                    })
                })
            };

            controller.onSelectBatch(mockEvent);
            expect(mockMessageBox.error).toHaveBeenCalledWith(
                expect.stringContaining('expired'),
                expect.objectContaining({ title: 'Expired Batch Selection Blocked' })
            );
        });

        it('should filter batches on search', () => {
            const oBatchModel = controller.getView().getModel('giBatchSelection');
            oBatchModel.setProperty('/rawBatches', [
                { Batch: 'IN25000963', ExpiryDate: '2027-06-24', StatusText: 'VALID', StorageBin: 'BIN-01', StorageLocation: 'CS01', Plant: '1120' },
                { Batch: 'IN25000970', ExpiryDate: '2027-12-31', StatusText: 'VALID', StorageBin: 'BIN-02', StorageLocation: 'CS01', Plant: '1120' }
            ]);

            controller.onSearchBatches({ getParameter: (p) => p === 'newValue' ? '970' : undefined });
            const aFiltered = oBatchModel.getProperty('/batches');
            expect(aFiltered.length).toBe(1);
            expect(aFiltered[0].Batch).toBe('IN25000970');
        });
    });

    describe('Offline Outbox Dispatch Queue & Step 4 Queued State', () => {
        let controller;

        beforeEach(() => {
            jest.clearAllMocks();
            controller = new GoodsIssueController();
            controller.onInit();
        });

        afterEach(() => {
            controller.onExit();
        });

        it('should handle queued response in onPostGoodsIssue and update queuedCount', async () => {
            const oModel = controller.getView().getModel('giView');
            oModel.setProperty('/resolved', mockResolution);
            oModel.setProperty('/activeItem', mockResolution.ActiveItem);
            oModel.setProperty('/issueQty', 50);

            mockGoodsIssueService.postGoodsIssue.mockResolvedValueOnce({
                Success: true,
                Queued: true,
                QueueReference: 'GI-QUEUE-168779-0001-ABCD',
                SyncStatus: 'QUEUED',
                Message: 'Transaction safely recorded in CAP Dispatch Queue'
            });

            mockGoodsIssueService.getQueueSummary.mockResolvedValueOnce({
                QueuedCount: 1,
                Items: [{ QueueReference: 'GI-QUEUE-168779-0001-ABCD', SyncStatus: 'QUEUED' }]
            });

            await controller.onPostGoodsIssue();

            expect(oModel.getProperty('/currentStep')).toBe(4);
            const postResult = oModel.getProperty('/postResult');
            expect(postResult.Success).toBe(true);
            expect(postResult.Queued).toBe(true);
            expect(postResult.QueueReference).toBe('GI-QUEUE-168779-0001-ABCD');
            expect(postResult.SyncStatus).toBe('QUEUED');
            expect(postResult.MaterialDocument).toBe('');
            expect(mockMessageToast.show).toHaveBeenCalledWith(expect.stringContaining('GI-QUEUE-168779-0001-ABCD'));
            expect(oModel.getProperty('/queuedCount')).toBe(1);
        });

        it('should retry current queued transaction on onRetrySync', async () => {
            const oModel = controller.getView().getModel('giView');
            oModel.setProperty('/postResult', {
                Success: true,
                Queued: true,
                QueueReference: 'GI-QUEUE-168779-0001-ABCD',
                SyncStatus: 'QUEUED'
            });

            mockGoodsIssueService.retryQueuedGoodsIssue.mockResolvedValueOnce({
                Success: true,
                MaterialDocument: '4900000001',
                MaterialDocYear: '2026',
                Message: 'Goods Issue successfully synchronized to SAP S/4HANA!'
            });

            mockGoodsIssueService.getQueueSummary.mockResolvedValueOnce({
                QueuedCount: 0,
                Items: []
            });

            await controller.onRetrySync();

            expect(mockGoodsIssueService.retryQueuedGoodsIssue).toHaveBeenCalledWith('GI-QUEUE-168779-0001-ABCD');
            const postResult = oModel.getProperty('/postResult');
            expect(postResult.Queued).toBe(false);
            expect(postResult.MaterialDocument).toBe('4900000001');
            expect(postResult.SyncStatus).toBe('POSTED_IN_SAP');
            expect(mockMessageBox.success).toHaveBeenCalledWith(expect.stringContaining('4900000001'));
        });

        it('should open queue tray dialog and load items on onOpenQueueTray', async () => {
            mockGoodsIssueService.getQueueSummary.mockResolvedValueOnce({
                QueuedCount: 2,
                Items: [
                    { QueueReference: 'GI-QUEUE-1', SyncStatus: 'QUEUED' },
                    { QueueReference: 'GI-QUEUE-2', SyncStatus: 'QUEUED' }
                ]
            });

            await controller.onOpenQueueTray();

            const oQueueModel = controller.getView().getModel('giQueue');
            expect(oQueueModel).toBeDefined();
            expect(mockFragmentDialog.open).toHaveBeenCalled();
        });

        it('should retry specific queue item on onRetryQueueItem', async () => {
            mockGoodsIssueService.retryQueuedGoodsIssue.mockResolvedValueOnce({
                Success: true,
                MaterialDocument: '4900000099',
                MaterialDocYear: '2026'
            });

            const mockEvent = {
                getSource: () => ({
                    getBindingContext: () => ({
                        getObject: () => ({
                            QueueReference: 'GI-QUEUE-12345'
                        })
                    })
                })
            };

            await controller.onRetryQueueItem(mockEvent);

            expect(mockGoodsIssueService.retryQueuedGoodsIssue).toHaveBeenCalledWith('GI-QUEUE-12345');
            expect(mockMessageBox.success).toHaveBeenCalledWith(expect.stringContaining('4900000099'));
        });

        it('should dismiss queue item on onClearQueueItem after confirmation', async () => {
            mockGoodsIssueService.clearQueuedGoodsIssue.mockResolvedValueOnce(true);

            const mockEvent = {
                getSource: () => ({
                    getBindingContext: () => ({
                        getObject: () => ({
                            QueueReference: 'GI-QUEUE-999'
                        })
                    })
                })
            };

            controller.onClearQueueItem(mockEvent);

            expect(mockMessageBox.confirm).toHaveBeenCalledWith(
                expect.stringContaining('GI-QUEUE-999'),
                expect.any(Object)
            );
        });

        it('should synchronize all pending items in onSyncAllQueued', async () => {
            const oQueueModel = new MockJSONModel({
                items: [
                    { QueueReference: 'GI-QUEUE-A', SyncStatus: 'QUEUED' },
                    { QueueReference: 'GI-QUEUE-B', SyncStatus: 'FAILED' },
                    { QueueReference: 'GI-QUEUE-C', SyncStatus: 'POSTED_IN_SAP' }
                ],
                queuedCount: 2
            });
            controller.getView().setModel(oQueueModel, 'giQueue');

            mockGoodsIssueService.retryQueuedGoodsIssue
                .mockResolvedValueOnce({ Success: true, MaterialDocument: '4900000001' })
                .mockResolvedValueOnce({ Success: true, MaterialDocument: '4900000002' });

            mockGoodsIssueService.getQueueSummary.mockResolvedValueOnce({
                QueuedCount: 0,
                Items: []
            });

            await controller.onSyncAllQueued();

            expect(mockGoodsIssueService.retryQueuedGoodsIssue).toHaveBeenCalledWith('GI-QUEUE-A');
            expect(mockGoodsIssueService.retryQueuedGoodsIssue).toHaveBeenCalledWith('GI-QUEUE-B');
            expect(mockGoodsIssueService.retryQueuedGoodsIssue).not.toHaveBeenCalledWith('GI-QUEUE-C');
            expect(mockMessageBox.information).toHaveBeenCalledWith(expect.stringContaining('Sync complete'));
        });
    });

    describe('Fiori Wizard Navigation', () => {
        let controller;

        beforeEach(() => {
            jest.clearAllMocks();
            controller = new GoodsIssueController();
            controller.onInit();
        });

        afterEach(() => {
            controller.onExit();
        });

        it('should navigate forward and backward using wizard methods', () => {
            const oModel = controller.getView().getModel('giView');
            oModel.setProperty('/resolved', mockResolution);
            oModel.setProperty('/activeItem', mockResolution.ActiveItem);
            oModel.setProperty('/issueQty', 50);
            oModel.setProperty('/availableStock', 500);
            oModel.setProperty('/isValid', true);

            // Step 1 -> Step 2
            controller.onWizardNextStep();
            expect(oModel.getProperty('/currentStep')).toBe(2);

            // Step 2 -> Step 3
            controller.onWizardNextStep();
            expect(oModel.getProperty('/currentStep')).toBe(3);

            // Step 3 -> Step 2
            controller.onWizardPreviousStep();
            expect(oModel.getProperty('/currentStep')).toBe(2);

            // Step 2 -> Step 1
            controller.onWizardPreviousStep();
            expect(oModel.getProperty('/currentStep')).toBe(1);
        });

        it('should handle wizard completion', () => {
            const oModel = controller.getView().getModel('giView');
            oModel.setProperty('/resolved', mockResolution);
            oModel.setProperty('/activeItem', mockResolution.ActiveItem);
            oModel.setProperty('/issueQty', 50);
            oModel.setProperty('/availableStock', 500);
            oModel.setProperty('/isValid', true);

            controller.onWizardCompleted();
            expect(oModel.getProperty('/currentStep')).toBe(3);
        });
    });
});

