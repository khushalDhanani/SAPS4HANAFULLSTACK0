/**
 * Unit Tests for GoodsIssue Dashboard Controller & Dashboard Model
 * Covers the 4-independent-sections split: Recent Postings tables (201/261/301/311),
 * Movement Type Distribution mini-donuts, and Movement Trend mini-sparklines - each with its
 * own independent loading/empty/error state, and Recent Postings backed by its own
 * server-side MovementType-filtered getDashboardData call.
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
            this.byIdRegistry = {};
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
            this.byId = (sId) => this.byIdRegistry[sId] || null;
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

    const allDocuments = [
        {
            MaterialDocument: '4900000000', MaterialDocYear: '2026', Item: '0001',
            MovementType: '201', Material: '421', MaterialDesc: 'Macbook Air M3',
            Plant: '1110', StorageLocation: 'RD01', Quantity: 2, Unit: 'EA',
            PostingDate: '2026-09-27', User: 'NARESH', CostCenter: '1011103001'
        },
        {
            MaterialDocument: '4900000001', MaterialDocYear: '2026', Item: '0001',
            MovementType: '261', Material: '514', MaterialDesc: 'Flange Steel 514',
            Plant: '1120', StorageLocation: '1121', Quantity: 10, Unit: 'EA',
            PostingDate: '2026-09-27', User: 'ALICE', OrderNo: '1000856'
        },
        {
            MaterialDocument: '4900000002', MaterialDocYear: '2026', Item: '0001',
            MovementType: '301', Material: '515', MaterialDesc: 'Copper Pipe 515',
            Plant: '1120', StorageLocation: '1121', Quantity: 25, Unit: 'M',
            PostingDate: '2026-09-26', User: 'BOB', ReceivingPlant: '1130', ReceivingStorageLocation: 'MT01'
        },
        {
            MaterialDocument: '4900000003', MaterialDocYear: '2026', Item: '0001',
            MovementType: '311', Material: '516', MaterialDesc: 'Steel Bolt 516',
            Plant: '1120', StorageLocation: '1121', Quantity: 100, Unit: 'PC',
            PostingDate: '2026-09-25', User: 'CHARLIE', ReceivingPlant: '1120', ReceivingStorageLocation: 'HS02'
        }
    ];

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
        RecentDocuments: allDocuments,
        LastUpdated: '2026-09-28T10:00:00.000Z',
        PlantFilter: '',
        Days: 30
    };

    // Emulates the real backend: per-type calls return RecentDocuments already server-filtered
    // to that one movement type.
    function dashboardDataForType(sType) {
        return Object.assign({}, sampleDashboardData, {
            RecentDocuments: allDocuments.filter((d) => d.MovementType === sType)
        });
    }

    function mockRoutedService() {
        mockGoodsIssueService.getDashboardData.mockImplementation((days, plant, forceRefresh, movementType) => {
            if (movementType) {
                return Promise.resolve(dashboardDataForType(movementType));
            }
            return Promise.resolve(sampleDashboardData);
        });
    }

    beforeEach(() => {
        jest.clearAllMocks();
        controller = new GoodsIssueDashboardController();
    });

    describe('GoodsIssueDashboardModel Behavior', () => {
        it('initializes default model with correct initial properties, including 4 independent recent-postings buckets', () => {
            const model = GoodsIssueDashboardModel.createModel();
            expect(model.getProperty('/loading')).toBe(true);
            expect(model.getProperty('/typeFilter')).toBe('ALL');
            expect(model.getProperty('/trendPeriod')).toBe('30');
            expect(model.getProperty('/kpis/mvt201/totalCount')).toBe('-');
            expect(model.getProperty('/kpis/mvt261/totalCount')).toBe('-');

            ['201', '261', '301', '311'].forEach((sType) => {
                expect(model.getProperty(`/recent/${sType}/items`)).toEqual([]);
                expect(model.getProperty(`/recent/${sType}/loading`)).toBe(true);
                expect(model.getProperty(`/recent/${sType}/error`)).toBe('');
                expect(model.getProperty(`/recent/${sType}/total`)).toBe(0);
            });
        });

        it('populates KPIs and per-type mini Distribution/Trend SVGs from the combined call, without touching Recent Postings', () => {
            const model = GoodsIssueDashboardModel.createModel();
            GoodsIssueDashboardModel.setServerData(model, sampleDashboardData);

            expect(model.getProperty('/loading')).toBe(false);
            expect(model.getProperty('/error')).toBe('');
            expect(model.getProperty('/kpis/mvt201/totalCount')).toBe(40);
            expect(model.getProperty('/kpis/overall/totalCount')).toBe(265);

            // 4 independent mini-donuts, one per type
            ['201', '261', '301', '311'].forEach((sType) => {
                const svg = model.getProperty(`/miniDistribution/${sType}/svg`);
                expect(svg).toContain('<svg');
            });
            expect(model.getProperty('/miniDistribution/261/count')).toBe(100);
            expect(model.getProperty('/miniDistribution/261/percentage')).toBe(37.74);

            // 4 independent mini-trend sparklines, one per type
            ['201', '261', '301', '311'].forEach((sType) => {
                const svg = model.getProperty(`/miniTrend/${sType}/svg`);
                expect(svg).toContain('<svg');
                expect(svg).toContain('<polyline');
            });

            // setServerData never touches Recent Postings state
            expect(model.getProperty('/recent/201/items')).toEqual([]);
            expect(model.getProperty('/recent/201/loading')).toBe(true);
        });

        it('setRecentPostings populates only the targeted type, independent of the other 3', () => {
            const model = GoodsIssueDashboardModel.createModel();

            GoodsIssueDashboardModel.setRecentPostings(model, '301', dashboardDataForType('301'));

            expect(model.getProperty('/recent/301/items').length).toBe(1);
            expect(model.getProperty('/recent/301/items')[0].MovementType).toBe('301');
            expect(model.getProperty('/recent/301/total')).toBe(1);
            expect(model.getProperty('/recent/301/loading')).toBe(false);
            expect(model.getProperty('/recent/301/error')).toBe('');

            // Other 3 types remain untouched at their initial state
            expect(model.getProperty('/recent/201/items')).toEqual([]);
            expect(model.getProperty('/recent/201/loading')).toBe(true);
        });

        it('setRecentPostingsError records an independent failure for one type only', () => {
            const model = GoodsIssueDashboardModel.createModel();
            GoodsIssueDashboardModel.setRecentPostings(model, '201', dashboardDataForType('201'));

            GoodsIssueDashboardModel.setRecentPostingsError(model, '261', 'Gateway timeout for 261');

            expect(model.getProperty('/recent/261/loading')).toBe(false);
            expect(model.getProperty('/recent/261/error')).toBe('Gateway timeout for 261');
            expect(model.getProperty('/recent/261/items')).toEqual([]);

            // 201 is unaffected by 261's failure
            expect(model.getProperty('/recent/201/error')).toBe('');
            expect(model.getProperty('/recent/201/items').length).toBe(1);
        });

        it('setTypeFilter only drives the KPI tile highlight - it no longer filters any table', () => {
            const model = GoodsIssueDashboardModel.createModel();
            GoodsIssueDashboardModel.setTypeFilter(model, '261');
            expect(model.getProperty('/typeFilter')).toBe('261');
            expect(model.getProperty('/activeKpiCard')).toBe('261');
        });
    });

    describe('GoodsIssueDashboardController Lifecycle & User Actions', () => {
        it('initializes controller, sets model and attaches route', () => {
            controller.onInit();
            const model = controller.getView().getModel('dashboardView');
            expect(model).toBeDefined();
            expect(mockRouter.getRoute).toHaveBeenCalledWith('wmGoodsIssue');
        });

        it('loads the combined call and all 4 independent Recent Postings calls on refresh, each with its own movementType filter', async () => {
            mockRoutedService();
            controller.onInit();

            await controller.onRefresh();

            // Combined call for KPIs/Distribution/Trend - no movementType
            expect(mockGoodsIssueService.getDashboardData).toHaveBeenCalledWith(30, '', true);
            // 4 independent per-type calls
            expect(mockGoodsIssueService.getDashboardData).toHaveBeenCalledWith(30, '', true, '201');
            expect(mockGoodsIssueService.getDashboardData).toHaveBeenCalledWith(30, '', true, '261');
            expect(mockGoodsIssueService.getDashboardData).toHaveBeenCalledWith(30, '', true, '301');
            expect(mockGoodsIssueService.getDashboardData).toHaveBeenCalledWith(30, '', true, '311');
            expect(mockGoodsIssueService.getDashboardData).toHaveBeenCalledTimes(5);

            const model = controller.getView().getModel('dashboardView');
            expect(model.getProperty('/kpis/mvt201/totalCount')).toBe(40);

            // Each table only received its own type's rows
            expect(model.getProperty('/recent/201/items').length).toBe(1);
            expect(model.getProperty('/recent/201/items')[0].MovementType).toBe('201');
            expect(model.getProperty('/recent/261/items').length).toBe(1);
            expect(model.getProperty('/recent/261/items')[0].MovementType).toBe('261');
            expect(model.getProperty('/recent/301/items').length).toBe(1);
            expect(model.getProperty('/recent/311/items').length).toBe(1);
        });

        it('handles combined-call failure independently of the 4 Recent Postings loads', async () => {
            mockGoodsIssueService.getDashboardData.mockImplementation((days, plant, forceRefresh, movementType) => {
                if (movementType) {
                    return Promise.resolve(dashboardDataForType(movementType));
                }
                return Promise.reject(new Error('S/4HANA Gateway unavailable'));
            });
            controller.onInit();

            await controller._loadAll(false);
            const model = controller.getView().getModel('dashboardView');

            // Combined call failed -> KPI/chart error state set
            expect(model.getProperty('/loading')).toBe(false);
            expect(model.getProperty('/error')).toContain('S/4HANA Gateway unavailable');

            // Recent Postings tables succeeded independently, unaffected by the combined call's failure
            expect(model.getProperty('/recent/201/error')).toBe('');
            expect(model.getProperty('/recent/201/items').length).toBe(1);
        });

        it('records an independent error for just one Recent Postings table when only that type fails', async () => {
            mockGoodsIssueService.getDashboardData.mockImplementation((days, plant, forceRefresh, movementType) => {
                if (movementType === '301') {
                    return Promise.reject(new Error('301 lookup failed'));
                }
                if (movementType) {
                    return Promise.resolve(dashboardDataForType(movementType));
                }
                return Promise.resolve(sampleDashboardData);
            });
            controller.onInit();

            await controller._loadAll(false);
            const model = controller.getView().getModel('dashboardView');

            expect(model.getProperty('/recent/301/error')).toContain('301 lookup failed');
            expect(model.getProperty('/recent/301/loading')).toBe(false);

            // The other 3 tables are unaffected
            expect(model.getProperty('/recent/201/error')).toBe('');
            expect(model.getProperty('/recent/261/error')).toBe('');
            expect(model.getProperty('/recent/311/error')).toBe('');
        });

        it('highlights the clicked KPI tile and scrolls to that type\'s own section (no more table filtering)', async () => {
            mockRoutedService();
            controller.onInit();
            await controller.onRefresh();

            controller.byIdRegistry.panelRecent201 = { getDomRef: () => null };

            controller.onSelectKpi201();
            expect(controller._getModel().getProperty('/typeFilter')).toBe('201');

            // Click again toggles back to ALL
            controller.onSelectKpi201();
            expect(controller._getModel().getProperty('/typeFilter')).toBe('ALL');

            controller.onSelectKpiOverall();
            expect(controller._getModel().getProperty('/typeFilter')).toBe('ALL');
        });

        it('scrolls to the matching section\'s DOM element when a KPI tile is clicked', () => {
            controller.onInit();
            const scrollSpy = jest.fn();
            controller.byIdRegistry.panelRecent261 = { getDomRef: () => ({ scrollIntoView: scrollSpy }) };

            controller.onSelectKpi261();
            expect(scrollSpy).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }));
        });

        it('formats tile state accurately across loading, error, empty and loaded states', () => {
            controller.onInit();

            expect(controller.formatTileState(10, true, '')).toBe('Loading');
            expect(controller.formatTileState('-', false, '')).toBe('Loading');
            expect(controller.formatTileState(undefined, false, '')).toBe('Loading');
            expect(controller.formatTileState(10, false, 'Connection lost')).toBe('Failed');
            expect(controller.formatTileState(null, false, '')).toBe('Failed');
            expect(controller.formatTileState(0, false, '')).toBe('Loaded');
            expect(controller.formatTileState(42, false, '')).toBe('Loaded');
        });

        it('exposes authentic total and today counts across all 5 movement categories', async () => {
            mockRoutedService();
            controller.onInit();
            await controller.onRefresh();

            const model = controller._getModel();
            expect(model.getProperty('/kpis/mvt201/totalCount')).toBe(40);
            expect(model.getProperty('/kpis/mvt201/todayPostingsCount')).toBe(1);
            expect(model.getProperty('/kpis/mvt261/totalCount')).toBe(100);
            expect(model.getProperty('/kpis/mvt301/totalCount')).toBe(50);
            expect(model.getProperty('/kpis/mvt311/totalCount')).toBe(75);
            expect(model.getProperty('/kpis/overall/totalCount')).toBe(265);
        });

        it('reloads the combined call and all 4 Recent Postings tables when the trend period changes', async () => {
            mockRoutedService();
            controller.onInit();
            await controller.onRefresh();
            mockGoodsIssueService.getDashboardData.mockClear();

            const mockEvent = { getParameter: () => ({ getKey: () => '7' }) };
            await controller.onTrendPeriodChange(mockEvent);

            expect(controller._getModel().getProperty('/trendPeriod')).toBe('7');
            expect(mockGoodsIssueService.getDashboardData).toHaveBeenCalledWith(7, '', true);
            expect(mockGoodsIssueService.getDashboardData).toHaveBeenCalledWith(7, '', true, '201');
            expect(mockGoodsIssueService.getDashboardData).toHaveBeenCalledTimes(5);
        });

        it('navigates each "New X" action to its dedicated per-type create page (not the generic one)', () => {
            controller.onInit();

            controller.onNavigateToCreate201();
            expect(mockRouter.navTo).toHaveBeenCalledWith('wmGoodsIssue201');

            controller.onNavigateToCreate261();
            expect(mockRouter.navTo).toHaveBeenCalledWith('wmGoodsIssue261');

            controller.onNavigateToCreate301();
            expect(mockRouter.navTo).toHaveBeenCalledWith('wmGoodsIssue301');

            controller.onNavigateToCreate311();
            expect(mockRouter.navTo).toHaveBeenCalledWith('wmGoodsIssue311');
        });

        it('opens document detail dialog when clicking a row in any of the 4 tables', async () => {
            controller.onInit();
            const oDoc = allDocuments[2];
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
            expect(mockRouter.navTo).toHaveBeenCalledWith('wmGoodsIssue301');
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
