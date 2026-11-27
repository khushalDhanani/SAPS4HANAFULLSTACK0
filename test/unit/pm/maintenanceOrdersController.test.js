'use strict';

describe('MaintenanceOrders controller unit tests', () => {
    let ControllerClass;
    let mockODataClient;
    let mockMessageToast;
    let mockRouter;

    class MockJSONModel {
        constructor(data) {
            this.data = Object.assign({}, data);
        }
        setProperty(p, v) {
            this.data[p.replace(/^\//, '')] = v;
        }
        getProperty(p) {
            return this.data[p.replace(/^\//, '')];
        }
    }

    beforeAll(() => {
        mockODataClient = { get: jest.fn() };
        mockMessageToast = { show: jest.fn() };
        const MockBaseController = {
            extend: (_name, proto) => {
                function Controller() { Object.assign(this, proto); }
                return Controller;
            }
        };
        global.sap = {
            ui: {
                define: (_deps, factory) => {
                    ControllerClass = factory(MockBaseController, MockJSONModel, mockODataClient, mockMessageToast);
                }
            }
        };
        require('../../../app/fiori-app/webapp/modules/pm/maintenance-order/controller/MaintenanceOrders.controller.js');
    });

    function createController(searchValue = '') {
        const models = {};
        const attached = {};
        mockRouter = {
            getRoute: (name) => ({ attachPatternMatched: (fn, ctx) => { attached[name] = fn.bind(ctx); } })
        };
        const controller = new ControllerClass();
        controller.getOwnerComponent = () => ({ getRouter: () => mockRouter });
        controller.getView = () => ({
            setModel: (m, name) => { models[name] = m; },
            getModel: (name) => models[name]
        });
        controller.byId = (id) => (id === 'pmMaintOrdersSearch' ? { getValue: () => searchValue } : null);
        controller.getText = (_k, _a, fallback) => fallback || _k;
        controller.onInit();
        return { controller, model: models.pmMaintOrdersView, attached };
    }

    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('onInit initializes view model and attaches maintenanceOrders route', () => {
        const { model, attached } = createController();
        expect(model.getProperty('/items')).toEqual([]);
        expect(model.getProperty('/totalCount')).toBeNull();
        expect(model.getProperty('/canLoadMore')).toBe(false);
        expect(typeof attached.maintenanceOrders).toBe('function');
    });

    test('_onRouteMatched loads initial page and KPI metrics cleanly without overwriting totalCount', async () => {
        const { controller, model } = createController('pump');
        mockODataClient.get
            .mockResolvedValueOnce({ totalCount: 12, items: [{ maintenanceOrder: '4000001' }] })
            .mockResolvedValueOnce({ totalCount: 54391 });

        await Promise.all([controller._loadData({ skip: 0 }), controller._loadMetrics()]);

        expect(mockODataClient.get).toHaveBeenNthCalledWith(1, "/odata/v4/maintenance-order/list(top=25,skip=0,searchQuery='pump')");
        expect(mockODataClient.get).toHaveBeenNthCalledWith(2, '/odata/v4/maintenance-order/getMetrics()');
        expect(model.getProperty('/items')).toEqual([{ maintenanceOrder: '4000001' }]);
        expect(model.getProperty('/filteredCount')).toBe(12);
        expect(model.getProperty('/totalCount')).toBe(54391);
        expect(model.getProperty('/canLoadMore')).toBe(true);
    });

    test('escapes single quotes in searchQuery before OData URL encoding', async () => {
        const { controller } = createController("O'Brien");
        mockODataClient.get.mockResolvedValue({ totalCount: 0, items: [] });

        await controller._loadData({});

        expect(mockODataClient.get).toHaveBeenCalledWith("/odata/v4/maintenance-order/list(top=25,skip=0,searchQuery='O''Brien')");
    });

    test('onLoadMore appends next page using current items.length as skip', async () => {
        const { controller, model } = createController();
        model.setProperty('/items', [{ maintenanceOrder: '1' }, { maintenanceOrder: '2' }]);
        mockODataClient.get.mockResolvedValue({ totalCount: 3, items: [{ maintenanceOrder: '3' }] });

        await controller._loadData({ skip: 2, append: true });

        expect(mockODataClient.get).toHaveBeenCalledWith('/odata/v4/maintenance-order/list(top=25,skip=2)');
        expect(model.getProperty('/items')).toHaveLength(3);
        expect(model.getProperty('/canLoadMore')).toBe(false);
    });

    test('discards stale responses when a newer request is dispatched', async () => {
        const { controller, model } = createController();
        let resolveFirst;
        mockODataClient.get
            .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }))
            .mockResolvedValueOnce({ totalCount: 1, items: [{ maintenanceOrder: 'NEW' }] });

        const p1 = controller._loadData({});
        const p2 = controller._loadData({});
        await p2;
        resolveFirst({ totalCount: 99, items: [{ maintenanceOrder: 'STALE' }] });
        await p1;

        expect(model.getProperty('/items')).toEqual([{ maintenanceOrder: 'NEW' }]);
        expect(model.getProperty('/filteredCount')).toBe(1);
    });

    test('handles error cleanly by setting errorMessage and clearing items', async () => {
        const { controller, model } = createController();
        model.setProperty('/items', [{ maintenanceOrder: '1' }]);
        mockODataClient.get.mockRejectedValue(new Error('Gateway unavailable'));

        await controller._loadData({});

        expect(model.getProperty('/items')).toEqual([]);
        expect(model.getProperty('/errorMessage')).toBe('Gateway unavailable');
        expect(model.getProperty('/busy')).toBe(false);
        expect(mockMessageToast.show).toHaveBeenCalledWith('Gateway unavailable');
    });

    test('formatCount formats numbers cleanly and handles empty inputs', () => {
        const { controller } = createController();
        expect(controller.formatCount(null)).toBe('');
        expect(controller.formatCount(undefined)).toBe('');
        expect(controller.formatCount(54391)).toBe(Number(54391).toLocaleString());
    });
});
