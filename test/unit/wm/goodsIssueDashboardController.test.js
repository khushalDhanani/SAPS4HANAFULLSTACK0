/**
 * Unit Tests for GoodsIssue Dashboard Controller & Dashboard Model
 */

let GoodsIssueDashboardModel;
let GoodsIssueDashboardController;

const mockMessageBox = {
    error: jest.fn(),
    success: jest.fn(),
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

const mockFragmentDialog = {
    open: jest.fn(),
    close: jest.fn(),
    destroy: jest.fn()
};

const mockFragment = {
    load: jest.fn().mockResolvedValue(mockFragmentDialog)
};

const mockGoodsIssueService = {
    getDashboardData: jest.fn(),
    getQueueSummary: jest.fn().mockResolvedValue({ QueuedCount: 0, Items: [] })
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
            this.view = {
                getId: () => 'mockDashboardViewId',
                getModel: (name) => this.models[name],
                setModel: (m, name) => { this.models[name] = m; },
                addDependent: jest.fn()
            };
            this.getView = () => this.view;
            this.getModel = (name) => this.models[name];
            this.getRouter = () => mockRouter;
            this.getText = (k, a, fallback) => fallback || k;
            this.getOwnerComponent = () => ({
                getRouter: () => mockRouter,
                getModel: (name) => this.models[name]
            });
        }
        return Controller;
    }
};

// Setup global sap.ui.define mock to load Model and Controller
global.sap = {
    ui: {
        define: (deps, factory) => {
            if (deps.length === 1 && deps[0] === 'sap/ui/model/json/JSONModel') {
                GoodsIssueDashboardModel = factory(MockJSONModel);
            } else if (deps.length > 5) {
                GoodsIssueDashboardController = factory(
                    mockBaseController,
                    MockJSONModel,
                    mockFragment,
                    mockMessageBox,
                    mockMessageToast,
                    GoodsIssueDashboardModel,
                    mockGoodsIssueService
                );
            }
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

// Load Model then Controller
require('../../../app/fiori-app/webapp/modules/wm/goods-issue/model/GoodsIssueDashboardModel');
require('../../../app/fiori-app/webapp/modules/wm/goods-issue/controller/GoodsIssueDashboard.controller');

describe('GoodsIssue Dashboard Controller & Model Unit Tests', () => {
    let controller;
    const sampleDashboardData = {
        Kpis: {
            Mvt201: { TotalCount: 40, OpenPendingCount: 6, TodayPostingsCount: 1 },
            Mvt261: { TotalCount: 100, OpenPendingCount: 15, TodayPostingsCount: 3 },
            Mvt301: { TotalCount: 50, OpenPendingCount: 5, TodayPostingsCount: 1 },
            Mvt311: { TotalCount: 75, OpenPendingCount: 8, TodayPostingsCount: 2 },
            Overall: { TotalCount: 265, OpenPendingCount: 34, TodayPostingsCount: 7 }
        },
        Distribution: [
            { MovementType: '201', MovementTypeName: 'Goods Issue for Cost Center', Count: 40, Percentage: 15.09 },
            { MovementType: '261', MovementTypeName: 'Goods Issue to Order', Count: 100, Percentage: 37.74 },
            { MovementType: '301', MovementTypeName: 'Plant-to-Plant Transfer', Count: 50, Percentage: 18.87 },
            { MovementType: '311', MovementTypeName: 'Storage Location Transfer', Count: 75, Percentage: 28.30 }
        ],
        Trend: [
            { PostingDate: '2026-09-25', DateLabel: '09/25', Count201: 1, Count261: 5, Count301: 2, Count311: 3, Total: 11 },
            { PostingDate: '2026-09-26', DateLabel: '09/26', Count201: 2, Count261: 8, Count301: 1, Count311: 4, Total: 15 },
            { PostingDate: '2026-09-27', DateLabel: '09/27', Count201: 1, Count261: 3, Count301: 1, Count311: 2, Total: 7 }
        ],
        RecentDocuments: [
            {
                MaterialDocument: '4900000000',
                MaterialDocYear: '2026',
                Item: '0001',
                MovementType: '201',
                MovementTypeName: 'Goods Issue for Cost Center',
                Material: '421',
                MaterialDesc: 'Macbook Air M3',
                Plant: '1110',
                StorageLocation: 'RD01',
                Batch: 'CH01',
                Quantity: 2,
                Unit: 'EA',
                PostingDate: '2026-09-27',
                User: 'NARESH',
                CostCenter: '1011103001',
                OrderNo: '',
                ReservationNo: '519658'
            },
            {
                MaterialDocument: '4900000001',
                MaterialDocYear: '2026',
                Item: '0001',
                MovementType: '261',
                MovementTypeName: 'Goods Issue to Order',
                Material: '514',
                MaterialDesc: 'Flange Steel 514',
                Plant: '1120',
                StorageLocation: '1121',
                Batch: 'BATCH01',
                Quantity: 10,
                Unit: 'EA',
                PostingDate: '2026-09-27',
                User: 'ALICE',
                CostCenter: '',
                OrderNo: '1000856',
                ReservationNo: '168779'
            },
            {
                MaterialDocument: '4900000002',
                MaterialDocYear: '2026',
                Item: '0001',
                MovementType: '301',
                MovementTypeName: 'Plant-to-Plant Transfer',
                Material: '515',
                MaterialDesc: 'Copper Pipe 515',
                Plant: '1120',
                StorageLocation: '1121',
                Batch: '',
                Quantity: 25,
                Unit: 'M',
                PostingDate: '2026-09-26',
                User: 'BOB',
                CostCenter: '',
                OrderNo: '',
                ReservationNo: ''
            },
            {
                MaterialDocument: '4900000003',
                MaterialDocYear: '2026',
                Item: '0001',
                MovementType: '311',
                MovementTypeName: 'Storage Location Transfer',
                Material: '516',
                MaterialDesc: 'Steel Bolt 516',
                Plant: '1120',
                StorageLocation: '1121',
                Batch: 'BATCH02',
                Quantity: 100,
                Unit: 'PC',
                PostingDate: '2026-09-25',
                User: 'CHARLIE',
                CostCenter: '',
                OrderNo: '',
                ReservationNo: ''
            }
        ],
        LastUpdated: '2026-09-28T10:00:00.000Z',
        PlantFilter: '',
        Days: 30
    };

    beforeEach(() => {
        jest.clearAllMocks();
        controller = new GoodsIssueDashboardController();
    });

    describe('GoodsIssueDashboardModel Behavior', () => {
        it('initializes default model with correct initial properties', () => {
            const model = GoodsIssueDashboardModel.createModel();
            expect(model.getProperty('/loading')).toBe(true);
            expect(model.getProperty('/typeFilter')).toBe('ALL');
            expect(model.getProperty('/trendPeriod')).toBe('30');
            expect(model.getProperty('/kpis/mvt201/totalCount')).toBe('-');
            expect(model.getProperty('/kpis/mvt261/totalCount')).toBe('-');
            expect(model.getProperty('/documents')).toEqual([]);
        });

        it('populates server data, generates SVGs and formats numbers properly', () => {
            const model = GoodsIssueDashboardModel.createModel();
            GoodsIssueDashboardModel.setServerData(model, sampleDashboardData);

            expect(model.getProperty('/loading')).toBe(false);
            expect(model.getProperty('/error')).toBe('');
            expect(model.getProperty('/kpis/mvt201/totalCount')).toBe(40);
            expect(model.getProperty('/kpis/mvt261/totalCount')).toBe(100);
            expect(model.getProperty('/kpis/overall/totalCount')).toBe(265);
            expect(model.getProperty('/allDocuments').length).toBe(4);
            expect(model.getProperty('/documents').length).toBe(4);

            // Verifies SVG generation
            const distSvg = model.getProperty('/distributionSvg');
            expect(distSvg).toContain('<svg');
            expect(distSvg).toContain('Total Postings');

            const trendSvg = model.getProperty('/trendSvg');
            expect(trendSvg).toContain('<svg');
            expect(trendSvg).toContain('<polyline');
        });

        it('filters documents by movement type (201, 261, 301, 311, ALL)', () => {
            const model = GoodsIssueDashboardModel.createModel();
            GoodsIssueDashboardModel.setServerData(model, sampleDashboardData);

            // Filter to 201
            GoodsIssueDashboardModel.setTypeFilter(model, '201');
            expect(model.getProperty('/typeFilter')).toBe('201');
            expect(model.getProperty('/documents').length).toBe(1);
            expect(model.getProperty('/documents')[0].MovementType).toBe('201');

            // Filter to 261
            GoodsIssueDashboardModel.setTypeFilter(model, '261');
            expect(model.getProperty('/typeFilter')).toBe('261');
            expect(model.getProperty('/documents').length).toBe(1);
            expect(model.getProperty('/documents')[0].MovementType).toBe('261');

            // Filter to 301
            GoodsIssueDashboardModel.setTypeFilter(model, '301');
            expect(model.getProperty('/documents').length).toBe(1);
            expect(model.getProperty('/documents')[0].MovementType).toBe('301');

            // Reset to ALL
            GoodsIssueDashboardModel.setTypeFilter(model, 'ALL');
            expect(model.getProperty('/documents').length).toBe(4);
        });

        it('filters documents by search query across multiple fields', () => {
            const model = GoodsIssueDashboardModel.createModel();
            GoodsIssueDashboardModel.setServerData(model, sampleDashboardData);

            // Search by Material Description
            GoodsIssueDashboardModel.setSearchQuery(model, 'Copper');
            expect(model.getProperty('/documents').length).toBe(1);
            expect(model.getProperty('/documents')[0].MaterialDesc).toBe('Copper Pipe 515');

            // Search by Cost Center
            GoodsIssueDashboardModel.setSearchQuery(model, '1011103001');
            expect(model.getProperty('/documents').length).toBe(1);
            expect(model.getProperty('/documents')[0].CostCenter).toBe('1011103001');

            // Search by Material Document number
            GoodsIssueDashboardModel.setSearchQuery(model, '4900000001');
            expect(model.getProperty('/documents').length).toBe(1);
            expect(model.getProperty('/documents')[0].MaterialDocument).toBe('4900000001');

            // Search by User
            GoodsIssueDashboardModel.setSearchQuery(model, 'CHARLIE');
            expect(model.getProperty('/documents').length).toBe(1);

            // Clear search
            GoodsIssueDashboardModel.setSearchQuery(model, '');
            expect(model.getProperty('/documents').length).toBe(4);
        });

        it('toggles sort direction and sorts properly', () => {
            const model = GoodsIssueDashboardModel.createModel();
            GoodsIssueDashboardModel.setServerData(model, sampleDashboardData);

            // Default is PostingDate DESC -> first is 2026-09-27
            expect(model.getProperty('/documents')[0].PostingDate).toBe('2026-09-27');

            // Toggle sort on same field -> ASC
            GoodsIssueDashboardModel.setSorting(model, 'PostingDate');
            expect(model.getProperty('/sortDescending')).toBe(false);
            expect(model.getProperty('/documents')[0].PostingDate).toBe('2026-09-25');

            // Toggle again -> DESC
            GoodsIssueDashboardModel.setSorting(model, 'PostingDate');
            expect(model.getProperty('/sortDescending')).toBe(true);
            expect(model.getProperty('/documents')[0].PostingDate).toBe('2026-09-27');
        });
    });

    describe('GoodsIssueDashboardController Lifecycle & User Actions', () => {
        it('initializes controller, sets model and attaches route', () => {
            controller.onInit();
            const model = controller.getView().getModel('dashboardView');
            expect(model).toBeDefined();
            expect(mockRouter.getRoute).toHaveBeenCalledWith('wmGoodsIssue');
        });

        it('loads dashboard data and updates model on route match / refresh', async () => {
            mockGoodsIssueService.getDashboardData.mockResolvedValueOnce(sampleDashboardData);
            controller.onInit();

            await controller.onRefresh();
            expect(mockGoodsIssueService.getDashboardData).toHaveBeenCalledWith(30, '', true);

            const model = controller.getView().getModel('dashboardView');
            expect(model.getProperty('/kpis/mvt201/totalCount')).toBe(40);
            expect(model.getProperty('/kpis/mvt261/totalCount')).toBe(100);
            expect(model.getProperty('/documents').length).toBe(4);
        });

        it('handles backend service failure gracefully by showing error state', async () => {
            mockGoodsIssueService.getDashboardData.mockRejectedValueOnce(new Error('S/4HANA Gateway unavailable'));
            controller.onInit();

            await controller._loadDashboardData(false);
            const model = controller.getView().getModel('dashboardView');
            expect(model.getProperty('/loading')).toBe(false);
            expect(model.getProperty('/error')).toContain('S/4HANA Gateway unavailable');
        });

        it('filters table when clicking KPI cards (201, 261, 301, 311, Overall)', async () => {
            mockGoodsIssueService.getDashboardData.mockResolvedValueOnce(sampleDashboardData);
            controller.onInit();
            await controller.onRefresh();

            // Click 201 card
            controller.onSelectKpi201();
            expect(controller._getModel().getProperty('/typeFilter')).toBe('201');
            expect(controller._getModel().getProperty('/documents').length).toBe(1);

            // Click 201 card again to toggle back to ALL
            controller.onSelectKpi201();
            expect(controller._getModel().getProperty('/typeFilter')).toBe('ALL');

            // Click 261 card
            controller.onSelectKpi261();
            expect(controller._getModel().getProperty('/typeFilter')).toBe('261');
            expect(controller._getModel().getProperty('/documents').length).toBe(1);

            // Click 261 card again to toggle back to ALL
            controller.onSelectKpi261();
            expect(controller._getModel().getProperty('/typeFilter')).toBe('ALL');

            // Click 301 card
            controller.onSelectKpi301();
            expect(controller._getModel().getProperty('/typeFilter')).toBe('301');

            // Click Overall card to reset
            controller.onSelectKpiOverall();
            expect(controller._getModel().getProperty('/typeFilter')).toBe('ALL');
        });

        it('navigates to create flow with selected movement type for 201, 261, 301, 311', () => {
            controller.onInit();

            controller.onNavigateToCreate201();
            expect(mockRouter.navTo).toHaveBeenCalledWith('wmGoodsIssueCreateMode', { mode: '201' });

            controller.onNavigateToCreate261();
            expect(mockRouter.navTo).toHaveBeenCalledWith('wmGoodsIssueCreateMode', { mode: '261' });

            controller.onNavigateToCreate301();
            expect(mockRouter.navTo).toHaveBeenCalledWith('wmGoodsIssueCreateMode', { mode: '301' });

            controller.onNavigateToCreate311();
            expect(mockRouter.navTo).toHaveBeenCalledWith('wmGoodsIssueCreateMode', { mode: '311' });
        });

        it('opens document detail dialog when clicking a table row', async () => {
            controller.onInit();
            const oDoc = sampleDashboardData.RecentDocuments[0];
            const mockEvent = {
                getSource: () => ({
                    getBindingContext: () => ({
                        getObject: () => oDoc
                    })
                })
            };

            controller.onDocumentPress(mockEvent);
            expect(controller._getModel().getProperty('/selectedDocument')).toEqual(oDoc);
            await controller._pDetailDialog;
            expect(mockFragmentDialog.open).toHaveBeenCalled();
        });

        it('navigates to create goods issue from detail dialog with document movement type', async () => {
            controller.onInit();
            controller._getModel().setProperty('/selectedDocument', { MovementType: '301' });

            controller.onNavigateToCreateFromDetail();
            expect(mockRouter.navTo).toHaveBeenCalledWith('wmGoodsIssueCreateMode', { mode: '301' });
        });

        it('navigates back to main overview', () => {
            controller.onInit();
            controller.onNavBackToOverview();
            expect(mockRouter.navTo).toHaveBeenCalledWith('dashboard');
        });

        it('destroys dialogs onExit', async () => {
            controller.onInit();
            await controller._openDocumentDetailDialog();
            controller.onExit();
            await Promise.resolve(); // flush microtask queue for .then() in onExit
            expect(mockFragmentDialog.destroy).toHaveBeenCalled();
        });
    });
});
