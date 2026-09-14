/**
 * Unit Tests for WarehouseCockpit Controller
 * Verifies authentic EWM warehouse filtering, KPI loading, navigation, and entity orchestration.
 */

const mockMessageBox = {
    error: jest.fn(),
    confirm: jest.fn(),
    Action: {
        YES: 'YES',
        NO: 'NO',
        OK: 'OK',
        CANCEL: 'CANCEL'
    }
};
const mockMessageToast = { show: jest.fn() };

class MockJSONModel {
    constructor(data) {
        this.data = JSON.parse(JSON.stringify(data || {}));
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

const mockEwmService = {
    isProjectSpecificWarehouse: (w) => {
        if (!w || typeof w.Warehouse !== 'string') return false;
        const key = w.Warehouse.trim().toUpperCase();
        if (!key) return false;
        const stdCodes = ['0001', '001', '002', '100', 'EWM', 'MLO'];
        if (stdCodes.includes(key)) return false;
        const name = (w.WarehouseName || '').trim().toLowerCase();
        const stdPatterns = ['central warehouse', 'central whse', 'full wm', 'lean wm', 'scm-ewm', 'loading object', 'demo', 'sample', 'standard'];
        return !stdPatterns.some(p => name.includes(p));
    },
    filterProjectWarehouses: function(arr) {
        if (!Array.isArray(arr)) return [];
        return arr.filter(w => this.isProjectSpecificWarehouse(w));
    },
    getWarehouses: jest.fn(),
    getWarehouseKPIs: jest.fn(),
    getWarehouseTasks: jest.fn(),
    getInboundDeliveries: jest.fn(),
    getOutboundDeliveries: jest.fn(),
    getStorageTypes: jest.fn(),
    getStorageBins: jest.fn(),
    confirmWarehouseTask: jest.fn(),
    cancelWarehouseTask: jest.fn(),
    postGoodsReceipt: jest.fn(),
    postGoodsIssue: jest.fn()
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
                getModel: (name) => this.models[name],
                setModel: (m, name) => { this.models[name] = m; }
            });
            this.getRouter = () => mockRouter;
            this.byId = jest.fn().mockReturnValue({
                getBinding: jest.fn().mockReturnValue({ filter: jest.fn() })
            });
            this.setBusy = jest.fn();
            this.getText = jest.fn((k) => k);
            this.getOwnerComponent = jest.fn().mockReturnValue({
                getModel: jest.fn().mockReturnValue({
                    getProperty: jest.fn().mockReturnValue(true)
                })
            });
        }
        return Controller;
    }
};

global.sap = {
    ui: {
        define: (deps, factory) => {
            WarehouseCockpitController = factory(
                mockBaseController,
                MockJSONModel,
                jest.fn(), // Filter
                jest.fn(), // FilterOperator
                mockEwmService,
                mockMessageToast,
                mockMessageBox,
                jest.fn(), // Input
                jest.fn(), // Dialog
                jest.fn(), // VBox
                jest.fn(), // Label
                jest.fn()  // Button
            );
        }
    }
};

require('../../../app/fiori-app/webapp/modules/ewm/warehouse-cockpit/controller/WarehouseCockpit.controller');

describe('Unit: WarehouseCockpit Controller', () => {
    let controller;

    beforeEach(() => {
        jest.clearAllMocks();
        controller = new WarehouseCockpitController();
        controller.onInit();
    });

    describe('Model Initialization', () => {
        it('should initialize ewmView model with default properties', () => {
            const oModel = controller.getView().getModel('ewmView');
            expect(oModel.getProperty('/selectedWarehouse')).toBe('');
            expect(oModel.getProperty('/selectedTab')).toBe('tasks');
            expect(oModel.getProperty('/warehouses')).toEqual([]);
            expect(oModel.getProperty('/tasks')).toEqual([]);
            expect(oModel.getProperty('/kpis/OpenTasksCount')).toBe(0);
        });
    });

    describe('Warehouse Filtering - Exclude Standard/Demo SAP Warehouses', () => {
        it('should strictly exclude standard SAP/demo warehouses (0001, 001, 100, EWM, MLO) and retain only project-specific warehouses (W05, W10)', async () => {
            mockEwmService.getWarehouses.mockResolvedValue({
                value: [
                    { Warehouse: '0001', WarehouseName: 'Central Warehouse', IsEwm: true },
                    { Warehouse: '001', WarehouseName: 'Central whse (full WM)', IsEwm: false },
                    { Warehouse: '100', WarehouseName: 'Lean WM (without stocks)', IsEwm: false },
                    { Warehouse: 'EWM', WarehouseName: 'SCM-EWM', IsEwm: false },
                    { Warehouse: 'MLO', WarehouseName: 'Loading Object', IsEwm: false },
                    { Warehouse: 'W05', WarehouseName: 'Panoli WH', IsEwm: false },
                    { Warehouse: 'W10', WarehouseName: 'Plant 1000 WH', IsEwm: false }
                ]
            });
            mockEwmService.getWarehouseKPIs.mockResolvedValue({ value: [{ OpenTasksCount: 5 }] });
            mockEwmService.getWarehouseTasks.mockResolvedValue({ value: [{ WarehouseTask: '10001' }] });
            mockEwmService.getInboundDeliveries.mockResolvedValue({ value: [] });
            mockEwmService.getOutboundDeliveries.mockResolvedValue({ value: [] });
            mockEwmService.getStorageTypes.mockResolvedValue({ value: { value: [{ StorageType: 'T001' }] } });
            mockEwmService.getStorageBins.mockResolvedValue({ value: { value: [{ StorageBin: 'BIN-01' }] } });

            await controller._loadAllData();

            const oModel = controller.getView().getModel('ewmView');
            const aWarehouses = oModel.getProperty('/warehouses');

            // Must only contain project-specific warehouses
            expect(aWarehouses).toHaveLength(2);
            expect(aWarehouses[0].Warehouse).toBe('W05');
            expect(aWarehouses[0].WarehouseName).toBe('Panoli WH');
            expect(aWarehouses[1].Warehouse).toBe('W10');
            expect(aWarehouses[1].WarehouseName).toBe('Plant 1000 WH');

            // Standard / demo types must NOT exist in the warehouses model
            const standardTypes = ['0001', '001', '100', 'EWM', 'MLO'];
            standardTypes.forEach(type => {
                expect(aWarehouses.some(w => w.Warehouse === type)).toBe(false);
            });

            // Selected warehouse should resolve to W05 (first project-specific warehouse)
            expect(oModel.getProperty('/selectedWarehouse')).toBe('W05');
            expect(mockEwmService.getWarehouseTasks).toHaveBeenCalledWith('W05');
        });

        it('should handle empty warehouses list gracefully', async () => {
            mockEwmService.getWarehouses.mockResolvedValue({ value: [] });

            await controller._loadAllData();

            const oModel = controller.getView().getModel('ewmView');
            expect(oModel.getProperty('/warehouses')).toEqual([]);
            expect(oModel.getProperty('/selectedWarehouse')).toBe('');
            expect(oModel.getProperty('/tasks')).toEqual([]);
        });
    });

    describe('Navigation & Event Handling', () => {
        it('should navigate to RF Terminal with the selectedWarehouse in query', () => {
            const oModel = controller.getView().getModel('ewmView');
            oModel.setProperty('/selectedWarehouse', 'W05');

            controller.onNavigateToRfTerminal();

            expect(mockRouter.navTo).toHaveBeenCalledWith('ewmRfTerminal', {
                '?query': {
                    warehouse: 'W05'
                }
            });
        });

        it('should navigate to Create Warehouse Task with selectedWarehouse in query', () => {
            const oModel = controller.getView().getModel('ewmView');
            oModel.setProperty('/selectedWarehouse', 'W05');

            controller.onOpenCreateTaskDialog();

            expect(mockRouter.navTo).toHaveBeenCalledWith('createWarehouseTask', {
                '?query': {
                    warehouse: 'W05'
                }
            });
        });

        it('should update selectedWarehouse and reload entities on warehouse change', async () => {
            mockEwmService.getWarehouseKPIs.mockResolvedValue({ value: [{ OpenTasksCount: 2 }] });
            mockEwmService.getWarehouseTasks.mockResolvedValue({ value: [] });
            mockEwmService.getInboundDeliveries.mockResolvedValue({ value: [] });
            mockEwmService.getOutboundDeliveries.mockResolvedValue({ value: [] });
            mockEwmService.getStorageTypes.mockResolvedValue({ value: { value: [] } });
            mockEwmService.getStorageBins.mockResolvedValue({ value: { value: [] } });

            const mockEvent = {
                getSource: () => ({
                    getSelectedKey: () => 'W05'
                })
            };

            controller.onWarehouseChange(mockEvent);

            const oModel = controller.getView().getModel('ewmView');
            expect(oModel.getProperty('/selectedWarehouse')).toBe('W05');
        });

        it('should support route query parameter synchronization in _onPatternMatched', async () => {
            mockEwmService.getWarehouses.mockResolvedValue({
                value: [{ Warehouse: 'W05', WarehouseName: 'Panoli WH' }]
            });
            mockEwmService.getWarehouseKPIs.mockResolvedValue({ value: [] });
            mockEwmService.getWarehouseTasks.mockResolvedValue({ value: [] });
            mockEwmService.getInboundDeliveries.mockResolvedValue({ value: [] });
            mockEwmService.getOutboundDeliveries.mockResolvedValue({ value: [] });
            mockEwmService.getStorageTypes.mockResolvedValue({ value: { value: [] } });
            mockEwmService.getStorageBins.mockResolvedValue({ value: { value: [] } });

            const mockPatternEvent = {
                getParameter: (name) => {
                    if (name === 'arguments') {
                        return { '?query': { warehouse: 'W05' } };
                    }
                    return null;
                }
            };

            controller._onPatternMatched(mockPatternEvent);

            const oModel = controller.getView().getModel('ewmView');
            expect(oModel.getProperty('/selectedWarehouse')).toBe('W05');
        });
    });

    describe('Tab Selection', () => {
        it('should switch selectedTab in model', () => {
            const oModel = controller.getView().getModel('ewmView');
            controller.onSelectInboundTab();
            expect(oModel.getProperty('/selectedTab')).toBe('inbound');

            controller.onSelectOutboundTab();
            expect(oModel.getProperty('/selectedTab')).toBe('outbound');

            controller.onSelectStorageTab();
            expect(oModel.getProperty('/selectedTab')).toBe('storage');

            controller.onSelectTasksTab();
            expect(oModel.getProperty('/selectedTab')).toBe('tasks');
        });
    });

    describe('Post Goods Receipt & Post Goods Issue Actions', () => {
        it('should resolve warehouse from current warehouse context when delivery warehouse is vendor ID', () => {
            controller._sCurrentWarehouse = 'W22';
            mockEwmService.postGoodsReceipt.mockResolvedValue({});

            let confirmCallback;
            mockMessageBox.confirm.mockImplementation((msg, opts) => {
                confirmCallback = opts.onClose;
            });

            const mockEvent = {
                getSource: () => ({
                    getBindingContext: () => ({
                        getObject: () => ({
                            Warehouse: '100003', // 6-digit vendor ID
                            DeliveryDocument: '180000125'
                        })
                    })
                })
            };

            controller.onPostGoodsReceiptPress(mockEvent);
            expect(mockMessageBox.confirm).toHaveBeenCalledWith(
                expect.stringContaining('180000125'),
                expect.any(Object)
            );

            confirmCallback(mockMessageBox.Action.YES);
            expect(mockEwmService.postGoodsReceipt).toHaveBeenCalledWith('W22', '180000125');
        });

        it('should resolve warehouse from current warehouse context for Post Goods Issue', () => {
            controller._sCurrentWarehouse = 'W22';
            mockEwmService.postGoodsIssue.mockResolvedValue({});

            let confirmCallback;
            mockMessageBox.confirm.mockImplementation((msg, opts) => {
                confirmCallback = opts.onClose;
            });

            const mockEvent = {
                getSource: () => ({
                    getBindingContext: () => ({
                        getObject: () => ({
                            Warehouse: '',
                            OutboundDeliveryOrder: '80000456'
                        })
                    })
                })
            };

            controller.onPostGoodsIssuePress(mockEvent);
            expect(mockMessageBox.confirm).toHaveBeenCalledWith(
                expect.stringContaining('80000456'),
                expect.any(Object)
            );

            confirmCallback(mockMessageBox.Action.YES);
            expect(mockEwmService.postGoodsIssue).toHaveBeenCalledWith('W22', '80000456');
        });
    });
});
