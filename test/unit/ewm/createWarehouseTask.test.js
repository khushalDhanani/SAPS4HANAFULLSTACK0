/**
 * Unit Tests for CreateWarehouseTask Controller
 */

let CreateWarehouseTaskController;
const mockMessageBox = {
    error: jest.fn(),
    success: jest.fn((msg, opts) => { if (opts && opts.onClose) opts.onClose(); }),
    confirm: jest.fn((msg, opts) => { if (opts && opts.onClose) opts.onClose('OK'); }),
    Action: { OK: 'OK', CANCEL: 'CANCEL' }
};
const mockMessageToast = { show: jest.fn() };
const mockMessagePopover = jest.fn().mockImplementation(() => ({
    toggle: jest.fn(),
    close: jest.fn()
}));
const mockMessageItem = jest.fn();

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

const mockValueHelpService = {
    openValueHelp: jest.fn(),
    applySuggestionFilter: jest.fn()
};

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
    getWarehouses: jest.fn().mockResolvedValue({
        value: [
            { Warehouse: '0001', WarehouseName: 'Central Warehouse' },
            { Warehouse: '001', WarehouseName: 'Full WM' },
            { Warehouse: 'W05', WarehouseName: 'Project Warehouse W05' },
            { Warehouse: 'W10', WarehouseName: 'Project Warehouse W10' }
        ]
    }),
    getStorageTypes: jest.fn().mockResolvedValue({ value: [{ StorageType: '0010', StorageTypeName: 'High Rack' }] }),
    getStorageBins: jest.fn().mockResolvedValue({ value: [{ StorageBin: '0001-01-01', StorageType: '0010' }] }),
    getWarehouseProcessTypes: jest.fn().mockResolvedValue({ value: [{ Warehouse: 'W05', WarehouseProcessType: '1010', WarehouseProcessTypeName: 'Putaway' }] }),
    createWarehouseTask: jest.fn().mockResolvedValue({ WarehouseTask: '10001', Warehouse: 'W05' })
};

const mockRouter = {
    getRoute: jest.fn().mockReturnValue({ attachPatternMatched: jest.fn() }),
    navTo: jest.fn()
};

const mockWarehouseMgmtModel = {
    bindList: jest.fn()
};

const mockBaseController = {
    extend: (name, proto) => {
        function Controller() {
            Object.assign(this, proto);
            this.models = {
                warehouseMgmt: mockWarehouseMgmtModel
            };
            this.getView = () => ({
                getModel: (name) => this.models[name],
                setModel: (m, name) => { this.models[name] = m; },
                addDependent: jest.fn()
            });
            this.getModel = (name) => this.models[name] || null;
            this.getRouter = () => mockRouter;
            this.byId = jest.fn();
            this.setBusy = jest.fn();
            this.getOwnerComponent = () => ({
                getRouter: () => mockRouter,
                getModel: (name) => this.models[name]
            });
        }
        return Controller;
    }
};

global.sap = {
    ui: {
        define: (deps, factory) => {
            CreateWarehouseTaskController = factory(
                mockBaseController,
                mockMessageBox,
                mockMessageToast,
                mockMessagePopover,
                mockMessageItem,
                MockJSONModel,
                jest.fn(),
                jest.fn(),
                mockValueHelpService,
                mockEwmService
            );
        }
    }
};

require('../../../app/fiori-app/webapp/modules/ewm/warehouse-cockpit/controller/CreateWarehouseTask.controller');

describe('Unit: CreateWarehouseTask Controller', () => {
    let controller;

    beforeEach(() => {
        jest.clearAllMocks();
        controller = new CreateWarehouseTaskController();
        controller._resetModel();
    });

    describe('Model Initialization', () => {
        it('should initialize taskModel with default fields and empty errors', () => {
            const oModel = controller.getView().getModel('taskModel');
            expect(oModel.getProperty('/task/WarehouseProcessType')).toBe('');
            expect(oModel.getProperty('/task/Product')).toBe('');
            expect(oModel.getProperty('/task/Quantity')).toBe('');
            expect(oModel.getProperty('/hasError')).toBe(false);
            expect(oModel.getProperty('/errorCount')).toBe(0);
            expect(oModel.getProperty('/processTypes')).toEqual([]);
        });

        it('should load process types from SAP when warehouse locations are loaded', async () => {
            await controller._loadWarehouseLocations('W05');
            const oModel = controller.getView().getModel('taskModel');
            expect(mockEwmService.getWarehouseProcessTypes).toHaveBeenCalledWith(mockWarehouseMgmtModel, 'W05');
            expect(oModel.getProperty('/processTypes')).toEqual([
                { Warehouse: 'W05', WarehouseProcessType: '1010', WarehouseProcessTypeName: 'Putaway' }
            ]);
        });
    });

    describe('Warehouse Loading & Filtering (_loadWarehousesAndMasterData)', () => {
        it('should filter out all SAP standard/demo warehouse types and keep only project-specific warehouses', async () => {
            await controller._loadWarehousesAndMasterData();
            const oModel = controller.getView().getModel('taskModel');
            const aWarehouses = oModel.getProperty('/warehouses');
            expect(aWarehouses).toEqual([
                { Warehouse: 'W05', WarehouseName: 'Project Warehouse W05' },
                { Warehouse: 'W10', WarehouseName: 'Project Warehouse W10' }
            ]);
            expect(aWarehouses.some(w => w.Warehouse === '0001')).toBe(false);
            expect(aWarehouses.some(w => w.Warehouse === '001')).toBe(false);
            expect(oModel.getProperty('/task/Warehouse')).toBe('W05');
        });

        it('should respect requested preferred warehouse from query parameter if it is a project warehouse', async () => {
            await controller._loadWarehousesAndMasterData('W10');
            const oModel = controller.getView().getModel('taskModel');
            expect(oModel.getProperty('/task/Warehouse')).toBe('W10');
        });

        it('should fallback to first project warehouse if requested preferred warehouse is an excluded standard warehouse', async () => {
            await controller._loadWarehousesAndMasterData('0001');
            const oModel = controller.getView().getModel('taskModel');
            expect(oModel.getProperty('/task/Warehouse')).toBe('W05');
        });
    });

    describe('Form Validation (_validateForm)', () => {
        it('should fail validation when mandatory fields are empty, including Warehouse Process Type (never defaulted)', () => {
            const isValid = controller._validateForm(false);
            expect(isValid).toBe(false);
            const oModel = controller.getView().getModel('taskModel');
            expect(oModel.getProperty('/hasError')).toBe(true);
            expect(oModel.getProperty('/errorCount')).toBe(5); // Warehouse, WarehouseProcessType, Product, Quantity, UnitOfMeasure
            expect(oModel.getProperty('/errors/Warehouse/state')).toBe('Error');
            expect(oModel.getProperty('/task/WarehouseProcessType')).toBe('');
            expect(oModel.getProperty('/errors/WarehouseProcessType/state')).toBe('Error');
            expect(oModel.getProperty('/errors/WarehouseProcessType/text')).toBe('Warehouse Process Type is required');
            expect(oModel.getProperty('/errors/Product/state')).toBe('Error');
            expect(oModel.getProperty('/errors/Quantity/state')).toBe('Error');
            expect(oModel.getProperty('/errors/UnitOfMeasure/state')).toBe('Error');
        });

        it('should reject process type exceeding 4 characters', () => {
            const oModel = controller.getView().getModel('taskModel');
            oModel.setProperty('/task/Warehouse', '0001');
            oModel.setProperty('/task/WarehouseProcessType', '10100'); // 5 chars
            oModel.setProperty('/task/Product', 'TG11');
            oModel.setProperty('/task/Quantity', '5');
            oModel.setProperty('/task/UnitOfMeasure', 'EA');

            expect(controller._validateForm(false)).toBe(false);
            expect(oModel.getProperty('/errors/WarehouseProcessType/state')).toBe('Error');
            expect(oModel.getProperty('/errors/WarehouseProcessType/text')).toBe('Process Type cannot exceed 4 characters');
        });

        it('should reject invalid non-positive or non-numeric quantities', () => {
            const oModel = controller.getView().getModel('taskModel');
            oModel.setProperty('/task/Warehouse', '0001');
            oModel.setProperty('/task/WarehouseProcessType', '1010');
            oModel.setProperty('/task/Product', 'TG11');
            oModel.setProperty('/task/UnitOfMeasure', 'EA');

            // 0 quantity
            oModel.setProperty('/task/Quantity', '0');
            expect(controller._validateForm(false)).toBe(false);
            expect(oModel.getProperty('/errors/Quantity/state')).toBe('Error');

            // Negative quantity
            oModel.setProperty('/task/Quantity', '-5');
            expect(controller._validateForm(false)).toBe(false);
            expect(oModel.getProperty('/errors/Quantity/state')).toBe('Error');

            // String quantity
            oModel.setProperty('/task/Quantity', 'abc');
            expect(controller._validateForm(false)).toBe(false);
            expect(oModel.getProperty('/errors/Quantity/state')).toBe('Error');

            // Valid positive quantity
            oModel.setProperty('/task/Quantity', '10.5');
            expect(controller._validateForm(false)).toBe(true);
            expect(oModel.getProperty('/errors/Quantity/state')).toBe('None');
            expect(oModel.getProperty('/hasError')).toBe(false);
        });

        it('should pass validation when all required fields are valid', () => {
            const oModel = controller.getView().getModel('taskModel');
            oModel.setProperty('/task/Warehouse', '0001');
            oModel.setProperty('/task/WarehouseProcessType', '1010');
            oModel.setProperty('/task/Product', 'TG11');
            oModel.setProperty('/task/Quantity', '5');
            oModel.setProperty('/task/UnitOfMeasure', 'EA');

            const isValid = controller._validateForm(false);
            expect(isValid).toBe(true);
            expect(oModel.getProperty('/hasError')).toBe(false);
            expect(oModel.getProperty('/errorCount')).toBe(0);
        });
    });

    describe('Dirty State & Cancel Handling', () => {
        it('should detect dirty state when user enters data', () => {
            expect(controller._isDirty()).toBe(false);

            controller.getView().getModel('taskModel').setProperty('/task/Product', 'TG11');
            expect(controller._isDirty()).toBe(true);

            controller._resetModel();
            expect(controller._isDirty()).toBe(false);

            controller.getView().getModel('taskModel').setProperty('/task/WarehouseProcessType', '1010');
            expect(controller._isDirty()).toBe(true);
        });

        it('should navigate directly on cancel if form is clean', () => {
            controller.onCancelPress();
            expect(mockMessageBox.confirm).not.toHaveBeenCalled();
            expect(mockRouter.navTo).toHaveBeenCalledWith('ewmWarehouseCockpit', {}, true);
        });

        it('should prompt confirmation on cancel if form is dirty', () => {
            controller.getView().getModel('taskModel').setProperty('/task/Quantity', '5');
            controller.onCancelPress();
            expect(mockMessageBox.confirm).toHaveBeenCalled();
            expect(mockRouter.navTo).toHaveBeenCalledWith('ewmWarehouseCockpit', {}, true);
        });
    });

    describe('Task Creation (onCreatePress)', () => {
        it('should show error and abort if form is invalid', () => {
            controller.onCreatePress();
            expect(mockMessageBox.error).toHaveBeenCalledWith('Please correct the highlighted fields before submitting.');
            expect(mockEwmService.createWarehouseTask).not.toHaveBeenCalled();
        });

        it('should invoke EwmService.createWarehouseTask and navigate on success', async () => {
            const oModel = controller.getView().getModel('taskModel');
            oModel.setProperty('/task/Warehouse', 'W05');
            oModel.setProperty('/task/WarehouseProcessType', '1010');
            oModel.setProperty('/task/Product', 'TG11');
            oModel.setProperty('/task/Quantity', '5');
            oModel.setProperty('/task/UnitOfMeasure', 'EA');
            oModel.setProperty('/task/SourceStorageType', '0010');
            oModel.setProperty('/task/SourceStorageBin', '0010-01-01');
            oModel.setProperty('/task/DestinationStorageType', '0020');
            oModel.setProperty('/task/DestinationStorageBin', '0020-01-01');

            controller.onCreatePress();

            expect(mockEwmService.createWarehouseTask).toHaveBeenCalledWith({
                Warehouse: 'W05',
                WarehouseProcessType: '1010',
                Product: 'TG11',
                Quantity: 5,
                UnitOfMeasure: 'EA',
                SourceStorageType: '0010',
                SourceStorageBin: '0010-01-01',
                DestinationStorageType: '0020',
                TargetStorageType: '0020',
                DestinationStorageBin: '0020-01-01',
                TargetStorageBin: '0020-01-01'
            });

            // Wait for promise resolution
            await Promise.resolve();
            expect(mockMessageBox.success).toHaveBeenCalledWith(
                expect.stringContaining('Warehouse Task 10001 created successfully in SAP S/4HANA.'),
                expect.any(Object)
            );
            expect(mockRouter.navTo).toHaveBeenCalledWith('ewmWarehouseCockpit', {}, true);
        });

        it('should never present a task as locally staged: the success wording always refers to SAP S/4HANA', async () => {
            const oModel = controller.getView().getModel('taskModel');
            oModel.setProperty('/task/Warehouse', 'W05');
            oModel.setProperty('/task/WarehouseProcessType', '1010');
            oModel.setProperty('/task/Product', 'TG11');
            oModel.setProperty('/task/Quantity', '5');
            oModel.setProperty('/task/UnitOfMeasure', 'EA');

            mockEwmService.createWarehouseTask.mockResolvedValueOnce({
                WarehouseTask: '10001',
                Warehouse: 'W05'
            });

            controller.onCreatePress();
            await Promise.resolve();

            const sMessage = mockMessageBox.success.mock.calls[0][0];
            expect(sMessage).toContain('Warehouse Task 10001 created successfully in SAP S/4HANA.');
            expect(sMessage).not.toMatch(/local staging/i);
            expect(mockRouter.navTo).toHaveBeenCalledWith('ewmWarehouseCockpit', {}, true);
        });

        it('should show only SAP master data and warn, without inventing process types, types or bins, for warehouse W22', async () => {
            mockEwmService.getWarehouseProcessTypes.mockResolvedValueOnce({ value: [] });
            mockEwmService.getStorageTypes.mockResolvedValueOnce({ value: [] });
            mockEwmService.getStorageBins.mockResolvedValueOnce({ value: [] });
            await controller._loadWarehouseLocations('W22');
            const oModel = controller.getView().getModel('taskModel');
            expect(oModel.getProperty('/isNonEwmWarehouse')).toBe(true);
            expect(oModel.getProperty('/nonEwmWarningText')).toContain('Warehouse W22 has no warehouse process types configured in SAP EWM');
            expect(oModel.getProperty('/nonEwmWarningText')).not.toMatch(/local staging/i);
            expect(oModel.getProperty('/task/WarehouseProcessType')).toBe('');
            expect(oModel.getProperty('/processTypes')).toEqual([]);
            expect(oModel.getProperty('/storageTypes')).toEqual([]);
            expect(oModel.getProperty('/storageBins')).toEqual([]);
        });

        it('should block submission when no Warehouse Process Type is entered instead of defaulting one', async () => {
            const oModel = controller.getView().getModel('taskModel');
            oModel.setProperty('/task/Warehouse', 'W22');
            oModel.setProperty('/task/WarehouseProcessType', '');
            oModel.setProperty('/task/Product', 'TG11');
            oModel.setProperty('/task/Quantity', '10');
            oModel.setProperty('/task/UnitOfMeasure', 'EA');

            controller.onCreatePress();
            await Promise.resolve();

            expect(mockEwmService.createWarehouseTask).not.toHaveBeenCalled();
            expect(oModel.getProperty('/task/WarehouseProcessType')).toBe('');
            expect(oModel.getProperty('/errors/WarehouseProcessType/state')).toBe('Error');
            expect(oModel.getProperty('/errorList')).toEqual(expect.arrayContaining([
                expect.objectContaining({ title: 'Warehouse Process Type is required' })
            ]));
            expect(mockMessageBox.error).toHaveBeenCalledWith('Please correct the highlighted fields before submitting.');
        });

        it('should send the entered process type for warehouse W22 and report SAP success', async () => {
            const oModel = controller.getView().getModel('taskModel');
            oModel.setProperty('/task/Warehouse', 'W22');
            oModel.setProperty('/task/WarehouseProcessType', '1010');
            oModel.setProperty('/task/Product', 'TG11');
            oModel.setProperty('/task/Quantity', '10');
            oModel.setProperty('/task/UnitOfMeasure', 'EA');

            mockEwmService.createWarehouseTask.mockResolvedValueOnce({
                WarehouseTask: '10005',
                Warehouse: 'W22',
                WarehouseProcessType: '1010'
            });

            controller.onCreatePress();
            await Promise.resolve();

            expect(mockEwmService.createWarehouseTask).toHaveBeenCalledWith(
                expect.objectContaining({
                    Warehouse: 'W22',
                    WarehouseProcessType: '1010',
                    Product: 'TG11',
                    Quantity: 10,
                    UnitOfMeasure: 'EA'
                })
            );
            expect(mockMessageBox.success).toHaveBeenCalledWith(
                expect.stringContaining('Warehouse Task 10005 created successfully in SAP S/4HANA.'),
                expect.any(Object)
            );
            expect(mockRouter.navTo).toHaveBeenCalledWith('ewmWarehouseCockpit', {}, true);
        });

        it('should handle SAP creation rejection gracefully with error dialog', async () => {
            const oModel = controller.getView().getModel('taskModel');
            oModel.setProperty('/task/Warehouse', 'W05');
            oModel.setProperty('/task/WarehouseProcessType', '1010');
            oModel.setProperty('/task/Product', 'TG11');
            oModel.setProperty('/task/Quantity', '5');
            oModel.setProperty('/task/UnitOfMeasure', 'EA');

            mockEwmService.createWarehouseTask.mockRejectedValueOnce(
                new Error("SAP S/4HANA Backend Runtime Error: 'OBJECTS_OBJREF_NOT_ASSIGNED_NO' (CX_SY_REF_IS_INITIAL).")
            );

            controller.onCreatePress();
            await Promise.resolve();
            await Promise.resolve();

            expect(mockMessageBox.error).toHaveBeenCalledWith(
                expect.stringContaining('OBJECTS_OBJREF_NOT_ASSIGNED_NO'),
                expect.objectContaining({ title: 'SAP S/4HANA Rejection' })
            );
            expect(oModel.getProperty('/hasError')).toBe(true);
        });
    });
});
