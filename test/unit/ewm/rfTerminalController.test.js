/**
 * Unit Tests for RfTerminal Controller
 */

let RfTerminalController;
const mockMessageBox = {
    error: jest.fn(),
    success: jest.fn(),
    warning: jest.fn(),
    information: jest.fn(),
    confirm: jest.fn()
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
    getResources: jest.fn(),
    getQueues: jest.fn(),
    getWarehouseTasks: jest.fn(),
    logonResource: jest.fn(),
    verifyRfScan: jest.fn(),
    confirmRfPick: jest.fn()
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
            this.byId = jest.fn();
            this.setBusy = jest.fn();
            this.getText = (k) => {
                const map = {
                    rfSelectWarehousePrompt: 'Please select a warehouse loaded from SAP.',
                    rfEnterResourcePrompt: 'Please select or enter an RF resource.',
                    rfAllTasksCompleted: 'All open warehouse tasks in SAP have been completed.'
                };
                return map[k] || k;
            };
            this.getOwnerComponent = () => ({
                getModel: (name) => {
                    if (name === 'auth') {
                        return {
                            getProperty: (p) => {
                                if (p === '/isAuthenticated') return true;
                                if (p === '/user/username') return 'alice';
                                return null;
                            }
                        };
                    }
                    return null;
                }
            });
        }
        return Controller;
    }
};

global.sap = {
    ui: {
        define: (deps, factory) => {
            RfTerminalController = factory(
                mockBaseController,
                MockJSONModel,
                mockEwmService,
                mockMessageToast,
                mockMessageBox
            );
        }
    }
};

require('../../../app/fiori-app/webapp/modules/ewm/rf-terminal/controller/RfTerminal.controller');

describe('Unit: RfTerminal Controller', () => {
    let controller;

    beforeEach(() => {
        jest.clearAllMocks();
        controller = new RfTerminalController();
        controller.onInit();
    });

    describe('Model Initialization', () => {
        it('should initialize with step 1 and default state', () => {
            const model = controller.getView().getModel('rfView');
            expect(model.getProperty('/currentStep')).toBe(1);
            expect(model.getProperty('/isLoggedIn')).toBe(false);
            expect(model.getProperty('/audioEnabled')).toBe(true);
            expect(model.getProperty('/availableWarehouses')).toEqual([]);
            expect(model.getProperty('/availableResources')).toEqual([]);
            expect(model.getProperty('/availableQueues')).toEqual([]);
        });
    });

    describe('Warehouse Loading & Filtering', () => {
        it('should filter out all SAP standard/demo warehouse types and keep only project-specific warehouses', async () => {
            mockEwmService.getWarehouses.mockResolvedValue({
                value: [
                    { Warehouse: '0001', WarehouseName: 'Central Warehouse' },
                    { Warehouse: '001', WarehouseName: 'Central whse' },
                    { Warehouse: 'W05', WarehouseName: 'Project WM 05' },
                    { Warehouse: 'W22', WarehouseName: 'Project WM 22' }
                ]
            });
            mockEwmService.getResources.mockResolvedValue({ value: [] });
            mockEwmService.getQueues.mockResolvedValue([]);

            await controller._loadWarehouses();

            const model = controller.getView().getModel('rfView');
            const warehouses = model.getProperty('/availableWarehouses');
            expect(warehouses).toHaveLength(2);
            expect(warehouses.map(w => w.Warehouse)).toEqual(['W05', 'W22']);
            expect(warehouses.some(w => w.Warehouse === '0001')).toBe(false);
            expect(model.getProperty('/warehouse')).toBe('W05');
        });

        it('should respect requested preferred warehouse from query parameter if it is a project warehouse', async () => {
            mockEwmService.getWarehouses.mockResolvedValue({
                value: [
                    { Warehouse: 'W05', WarehouseName: 'Project WM 05' },
                    { Warehouse: 'W22', WarehouseName: 'Project WM 22' }
                ]
            });
            mockEwmService.getResources.mockResolvedValue({ value: [] });
            mockEwmService.getQueues.mockResolvedValue([]);

            await controller._loadWarehouses('W22');

            const model = controller.getView().getModel('rfView');
            expect(model.getProperty('/warehouse')).toBe('W22');
        });
    });

    describe('Resource and Queue Fallback Provisioning', () => {
        it('should populate fallback EWM resources when SAP returns empty list', async () => {
            mockEwmService.getResources.mockResolvedValue({ value: [] });

            await controller._loadResources('0001');

            const model = controller.getView().getModel('rfView');
            const resources = model.getProperty('/availableResources');
            expect(resources.length).toBeGreaterThan(0);
            expect(resources[0].Resource).toBe('CART-01');
            expect(model.getProperty('/resource')).toBe('CART-01');
        });

        it('should populate fallback EWM queues when SAP returns empty list', async () => {
            mockEwmService.getQueues.mockResolvedValue([]);

            await controller._loadQueues('0001');

            const model = controller.getView().getModel('rfView');
            const queues = model.getProperty('/availableQueues');
            expect(queues.length).toBeGreaterThan(0);
            expect(queues[0].Queue).toBe('OUTBOUND');
            expect(model.getProperty('/queue')).toBe('OUTBOUND');
        });

        it('should preserve live SAP resources and queues when available', async () => {
            mockEwmService.getResources.mockResolvedValue({
                value: [{ Resource: 'LIVE-CART-99', ResourceType: 'CART', AssignedQueue: 'LIVE-Q' }]
            });
            mockEwmService.getQueues.mockResolvedValue([{ Queue: 'LIVE-Q' }]);

            await controller._loadResources('0001');
            await controller._loadQueues('0001');

            const model = controller.getView().getModel('rfView');
            expect(model.getProperty('/resource')).toBe('LIVE-CART-99');
            expect(model.getProperty('/queue')).toBe('LIVE-Q');
        });
    });

    describe('Input Change Handlers', () => {
        it('should uppercase and update resource on custom input', () => {
            const model = controller.getView().getModel('rfView');
            controller.onResourceInputChange({
                getParameter: () => 'my-custom-cart',
                getSource: () => ({ getValue: () => 'my-custom-cart' })
            });
            expect(model.getProperty('/resource')).toBe('MY-CUSTOM-CART');
        });

        it('should uppercase and update queue on custom input', () => {
            const model = controller.getView().getModel('rfView');
            controller.onQueueInputChange({
                getParameter: () => 'custom-queue',
                getSource: () => ({ getValue: () => 'custom-queue' })
            });
            expect(model.getProperty('/queue')).toBe('CUSTOM-QUEUE');
        });
    });

    describe('Logon & Task Fetching Flow', () => {
        it('should reject logon if warehouse is missing', () => {
            const model = controller.getView().getModel('rfView');
            model.setProperty('/warehouse', '');
            model.setProperty('/resource', 'CART-01');
            model.setProperty('/queue', 'OUTBOUND');

            controller.onLogon();
            expect(mockMessageBox.error).toHaveBeenCalledWith(expect.stringContaining('warehouse'));
        });

        it('should reject logon if resource is missing', () => {
            const model = controller.getView().getModel('rfView');
            model.setProperty('/warehouse', '0001');
            model.setProperty('/resource', '');
            model.setProperty('/queue', 'OUTBOUND');

            controller.onLogon();
            expect(mockMessageBox.error).toHaveBeenCalledWith(expect.stringContaining('resource'));
        });

        it('should successfully logon and advance to step 2 when open tasks exist', async () => {
            const model = controller.getView().getModel('rfView');
            model.setProperty('/warehouse', '0001');
            model.setProperty('/resource', 'CART-01');
            model.setProperty('/queue', 'OUTBOUND');

            mockEwmService.logonResource.mockResolvedValue({ success: true });
            mockEwmService.getWarehouseTasks.mockResolvedValue({
                value: [{
                    Warehouse: '0001',
                    WarehouseTask: 'WT-10001',
                    WarehouseTaskStatus: 'O',
                    Product: 'TG11',
                    TargetQuantity: 5,
                    SourceStorageBin: '0010-01-01'
                }]
            });

            await controller.onLogon();

            expect(model.getProperty('/isLoggedIn')).toBe(true);
            expect(model.getProperty('/currentStep')).toBe(2);
            expect(model.getProperty('/activeTask/WarehouseTask')).toBe('WT-10001');
        });

        it('should inform operator and stay on step 1 if no open tasks exist', async () => {
            const model = controller.getView().getModel('rfView');
            model.setProperty('/warehouse', '0001');
            model.setProperty('/resource', 'CART-01');
            model.setProperty('/queue', 'OUTBOUND');

            mockEwmService.logonResource.mockResolvedValue({ success: true });
            mockEwmService.getWarehouseTasks.mockResolvedValue({ value: [] });

            await controller.onLogon();

            expect(model.getProperty('/isLoggedIn')).toBe(true);
            expect(model.getProperty('/currentStep')).toBe(1);
            expect(mockMessageToast.show).toHaveBeenCalledWith(expect.stringContaining('No open warehouse tasks in queue'));
        });
    });

    describe('Fetch Task by ID Validation', () => {
        it('should warn and reject if task is already confirmed', async () => {
            const model = controller.getView().getModel('rfView');
            model.setProperty('/warehouse', '0001');
            model.setProperty('/manualTaskId', 'WT-99999');

            mockEwmService.getWarehouseTasks.mockResolvedValue({
                value: [{
                    Warehouse: '0001',
                    WarehouseTask: 'WT-99999',
                    WarehouseTaskStatus: 'C'
                }]
            });

            await controller.onFetchTaskById();

            expect(mockMessageBox.warning).toHaveBeenCalledWith(expect.stringContaining('already confirmed'));
            expect(model.getProperty('/activeTask')).toBeNull();
        });

        it('should warn and reject if task is cancelled', async () => {
            const model = controller.getView().getModel('rfView');
            model.setProperty('/warehouse', '0001');
            model.setProperty('/manualTaskId', 'WT-88888');

            mockEwmService.getWarehouseTasks.mockResolvedValue({
                value: [{
                    Warehouse: '0001',
                    WarehouseTask: 'WT-88888',
                    WarehouseTaskStatus: 'X'
                }]
            });

            await controller.onFetchTaskById();

            expect(mockMessageBox.warning).toHaveBeenCalledWith(expect.stringContaining('cancelled'));
            expect(model.getProperty('/activeTask')).toBeNull();
        });
    });

    describe('Barcode Simulation Helpers', () => {
        it('should simulate scan bin and verify bin barcode', async () => {
            const model = controller.getView().getModel('rfView');
            model.setProperty('/warehouse', '0001');
            model.setProperty('/activeTask', {
                WarehouseTask: 'WT-10001',
                SourceStorageBin: '0010-01-01',
                Product: 'TG11'
            });

            mockEwmService.verifyRfScan.mockResolvedValue(true);

            controller.onSimulateScanBin();

            expect(model.getProperty('/scannedBin')).toBe('0010-01-01');
        });

        it('should simulate scan product and verify product barcode', async () => {
            const model = controller.getView().getModel('rfView');
            model.setProperty('/warehouse', '0001');
            model.setProperty('/activeTask', {
                WarehouseTask: 'WT-10001',
                SourceStorageBin: '0010-01-01',
                Product: 'TG11'
            });

            mockEwmService.verifyRfScan.mockResolvedValue(true);

            controller.onSimulateScanProduct();

            expect(model.getProperty('/scannedProduct')).toBe('TG11');
        });

        it('should simulate scan destination HU', () => {
            const model = controller.getView().getModel('rfView');
            model.setProperty('/suggestedHU', 'CART-HU-01');

            controller.onSimulateScanHU();

            expect(model.getProperty('/scannedHU')).toBe('CART-HU-01');
        });
    });

    describe('Navigation', () => {
        it('should navigate to Create Warehouse Task with active warehouse query', () => {
            const model = controller.getView().getModel('rfView');
            model.setProperty('/warehouse', 'W22');

            controller.onNavigateToCreateTask();

            expect(mockRouter.navTo).toHaveBeenCalledWith('createWarehouseTask', {
                '?query': { warehouse: 'W22' }
            });
        });
    });
});
