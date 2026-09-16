/**
 * Dashboard live figures (Dashboard.controller.js, PurchaseOrderAdapter.getDashboardMetrics,
 * SalesInquiryAdapter.getSalesMetrics).
 *
 * Every figure must come from SAP S/4HANA. When SAP does not return a figure it is reported as
 * unavailable (null / "Failed" tile); it is never defaulted, sampled, extrapolated or simulated.
 */

const fs = require('fs');
const path = require('path');
const salesInquiryAdapter = require('../../../srv/integration/s4hana/sd/sales-inquiry/SalesInquiryAdapter');

describe('Unit: SalesInquiryAdapter getSalesMetrics', () => {
    test('queries SD_F1873_SO_WL_SRV for open and total sales order counts', async () => {
        const mockExecute = jest.fn()
            .mockResolvedValueOnce({ data: { d: { __count: '498', results: [{ SalesOrder: '2500000' }] } } })
            .mockResolvedValueOnce({ data: { d: { __count: '880', results: [{ SalesOrder: '2500000' }] } } });

        const metrics = await salesInquiryAdapter.getSalesMetrics({
            destination: { url: 'https://mock.s4hana' },
            executeHttpRequest: mockExecute
        });

        expect(metrics).toEqual({ openOrdersCount: 498, totalOrdersCount: 880 });
        expect(mockExecute).toHaveBeenCalledTimes(2);
        expect(mockExecute.mock.calls[0][1].url).toContain("$filter=OverallSDProcessStatus ne 'C'");
    });

    test('fails with 502 instead of returning zero counts when the SAP call fails', async () => {
        const mockExecute = jest.fn().mockRejectedValue(new Error('Gateway timeout'));

        await expect(salesInquiryAdapter.getSalesMetrics({
            destination: { url: 'https://mock.s4hana' },
            executeHttpRequest: mockExecute
        })).rejects.toMatchObject({ status: 502, message: expect.stringContaining('Gateway timeout') });
    });

    test('fails with 503 instead of returning fixed counts when the destination cannot be resolved', async () => {
        const spy = jest.spyOn(salesInquiryAdapter, '_getDestination').mockRejectedValue(new Error("Destination 'S4HANA_PO_API' not found"));
        try {
            await expect(salesInquiryAdapter.getSalesMetrics({ executeHttpRequest: jest.fn() }))
                .rejects.toMatchObject({ status: 503, message: expect.stringContaining('not found') });
        } finally {
            spy.mockRestore();
        }
    });

    test('fails when SAP answers without a count instead of inventing one', async () => {
        const mockExecute = jest.fn().mockResolvedValue({ data: { d: { results: [] } } });

        await expect(salesInquiryAdapter.getSalesMetrics({
            destination: { url: 'https://mock.s4hana' },
            executeHttpRequest: mockExecute
        })).rejects.toMatchObject({ status: 502, message: expect.stringContaining('returned no count') });
    });
});

describe('Unit: Dashboard Controller live figures', () => {
    let DashboardControllerClass;
    let mockODataClient;
    const mockMessageToast = { show: jest.fn() };

    class MockJSONModel {
        constructor(data) {
            this.data = Object.assign({}, data);
        }
        setProperty(p, value) {
            this.data[p.replace(/^\//, '')] = value;
        }
        getProperty(p) {
            return this.data[p.replace(/^\//, '')];
        }
        getData() {
            return this.data;
        }
    }

    const MockBaseController = {
        extend: (name, proto) => {
            function Controller() {
                Object.assign(this, proto);
            }
            return Controller;
        }
    };

    const mockRouter = {
        getRoute: jest.fn().mockReturnValue({ attachPatternMatched: jest.fn() }),
        navTo: jest.fn()
    };

    const makeController = (oViewModel) => {
        const controller = new DashboardControllerClass();
        controller.getView = () => ({
            getModel: (name) => (name === 'dashboardView' ? oViewModel : null),
            setModel: jest.fn()
        });
        controller.getOwnerComponent = () => ({ getRouter: () => mockRouter, getModel: () => null });
        return controller;
    };

    const fullPayload = (overrides = {}) => {
        const payload = {};
        new DashboardControllerClass().METRIC_KEYS.forEach((key, i) => { payload[key] = 100 + i; });
        return Object.assign(payload, overrides);
    };

    beforeAll(() => {
        mockODataClient = { get: jest.fn() };
        global.sap = {
            ui: {
                define: jest.fn((deps, factory) => {
                    DashboardControllerClass = factory(MockBaseController, MockJSONModel, mockODataClient, mockMessageToast);
                })
            }
        };
        require('../../../app/fiori-app/webapp/controller/Dashboard.controller.js');
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('onInit starts with no figures at all (no zeros) and a neutral "checking" status', () => {
        const controller = new DashboardControllerClass();
        let data = null;
        controller.getView = () => ({ setModel: (m) => { data = m.getData(); } });
        controller.getOwnerComponent = () => ({ getRouter: () => mockRouter, getModel: () => null });

        controller.onInit();

        expect(data.selectedTab).toBe('overview');
        expect(data.connectionState).toBe('None');
        expect(data.connectionText).toMatch(/Checking/);
        controller.METRIC_KEYS.forEach((key) => expect(data).not.toHaveProperty(key));
        ['systemHealth', 'totalSpend', 'completeRate', 'carLoanActiveCount', 'hcmHeadcount', 'tmRouteCount', 'ppCapacityUtilization']
            .forEach((key) => expect(data).not.toHaveProperty(key));
    });

    test('populates every figure SAP returned and reports S/4HANA connected', async () => {
        const oViewModel = new MockJSONModel({});
        const controller = makeController(oViewModel);
        const payload = fullPayload({ totalCount: 2729, openSalesOrderCount: 498, gatewayCatalogCount: 1345 });
        mockODataClient.get.mockResolvedValue(JSON.stringify({ ...payload, unavailable: [] }));

        await controller._loadMetrics();

        expect(mockODataClient.get).toHaveBeenCalledTimes(1);
        expect(mockODataClient.get).toHaveBeenCalledWith('/odata/v4/purchase-order/getDashboardMetrics()');
        controller.METRIC_KEYS.forEach((key) => expect(oViewModel.getProperty('/' + key)).toBe(payload[key]));
        expect(oViewModel.getProperty('/connectionState')).toBe('Success');
        expect(oViewModel.getProperty('/connectionText')).toBe('S/4HANA connected');
        expect(oViewModel.getProperty('/metricsError')).toBe('');
    });

    test('accepts the OData { value: "<json>" } envelope', async () => {
        const oViewModel = new MockJSONModel({});
        const controller = makeController(oViewModel);
        mockODataClient.get.mockResolvedValue({ value: JSON.stringify(fullPayload({ fiDocCount: 173386 })) });

        await controller._loadMetrics();

        expect(oViewModel.getProperty('/fiDocCount')).toBe(173386);
        expect(oViewModel.getProperty('/connectionState')).toBe('Success');
    });

    test('keeps a figure SAP did not return as null (never 0) and reports partial availability', async () => {
        const oViewModel = new MockJSONModel({});
        const controller = makeController(oViewModel);
        const payload = fullPayload({ bpCount: null, warehouseCount: null });
        delete payload.gatewayCatalogCount; // missing entirely
        mockODataClient.get.mockResolvedValue(JSON.stringify({ ...payload, unavailable: ['bpCount', 'warehouseCount'] }));

        await controller._loadMetrics();

        expect(oViewModel.getProperty('/bpCount')).toBeNull();
        expect(oViewModel.getProperty('/warehouseCount')).toBeNull();
        expect(oViewModel.getProperty('/gatewayCatalogCount')).toBeNull();
        expect(oViewModel.getProperty('/totalCount')).toBe(payload.totalCount);
        expect(oViewModel.getProperty('/connectionState')).toBe('Warning');
        expect(oViewModel.getProperty('/connectionText')).toBe(`S/4HANA partially available (${controller.METRIC_KEYS.length - 3} of ${controller.METRIC_KEYS.length} figures)`);
    });

    test('rejects non-count values from the payload instead of displaying them', async () => {
        const oViewModel = new MockJSONModel({});
        const controller = makeController(oViewModel);
        mockODataClient.get.mockResolvedValue(fullPayload({ totalCount: 'abc', supplierCount: -1, productCount: 3.5, fiDocCount: '42' }));

        await controller._loadMetrics();

        expect(oViewModel.getProperty('/totalCount')).toBeNull();
        expect(oViewModel.getProperty('/supplierCount')).toBeNull();
        expect(oViewModel.getProperty('/productCount')).toBeNull();
        expect(oViewModel.getProperty('/fiDocCount')).toBe(42);
    });

    test('when the metrics call fails, marks every figure unavailable, shows the error and makes no fallback calls', async () => {
        const oViewModel = new MockJSONModel({});
        const controller = makeController(oViewModel);
        mockODataClient.get.mockRejectedValue(new Error('Dashboard metrics are not available: destination not found'));

        await controller._loadMetrics();

        expect(mockODataClient.get).toHaveBeenCalledTimes(1);
        controller.METRIC_KEYS.forEach((key) => expect(oViewModel.getProperty('/' + key)).toBeNull());
        expect(oViewModel.getProperty('/connectionState')).toBe('Error');
        expect(oViewModel.getProperty('/connectionText')).toBe('S/4HANA not reachable');
        expect(oViewModel.getProperty('/metricsError')).toContain('destination not found');
    });

    test('displays backend error message in metricsError when all figures are unavailable in resolved payload', async () => {
        const oViewModel = new MockJSONModel({});
        const controller = makeController(oViewModel);
        const payload = {
            totalCount: null,
            supplierCount: null,
            error: 'SAP S/4HANA backend logon rejected (HTTP 401 Unauthorized): Check credentials or SU01 lock status for configured user on system DS4 client 220.'
        };
        mockODataClient.get.mockResolvedValue(JSON.stringify(payload));

        await controller._loadMetrics();

        expect(oViewModel.getProperty('/connectionState')).toBe('Error');
        expect(oViewModel.getProperty('/connectionText')).toBe('S/4HANA not reachable');
        expect(oViewModel.getProperty('/metricsError')).toContain('HTTP 401 Unauthorized');
    });

    test('a refresh clears previous figures back to "loading" before the new call resolves', async () => {
        const oViewModel = new MockJSONModel({ totalCount: 5 });
        const controller = makeController(oViewModel);
        let seenDuringCall;
        mockODataClient.get.mockImplementation(() => {
            seenDuringCall = oViewModel.getProperty('/totalCount');
            return Promise.resolve(fullPayload());
        });

        await controller._loadMetrics();

        expect(seenDuringCall).toBeUndefined();
    });

    test('formatters: Loading while undefined, Failed when unavailable, the count otherwise', () => {
        const controller = new DashboardControllerClass();
        expect(controller.formatTileState(undefined)).toBe('Loading');
        expect(controller.formatTileState(null)).toBe('Failed');
        expect(controller.formatTileState(0)).toBe('Loaded');
        expect(controller.formatMetricValue(undefined)).toBe('');
        expect(controller.formatMetricValue(null)).toBe('');
        expect(controller.formatMetricValue(0)).toBe('0');
        expect(controller.formatMetricValue(2729)).toBe('2729');
    });

    test('exposes no simulator, info-dialog or placeholder-tab handlers', () => {
        const controller = new DashboardControllerClass();
        ['onSimulateCarLoan', 'onNewCarLoanApp', 'onShowMasterDataInfo', '_loadIndividualMetrics',
            'onSelectTabCO', 'onSelectTabPP', 'onSelectTabQM', 'onSelectTabEAM', 'onSelectTabPS',
            'onSelectTabTM', 'onSelectTabService', 'onSelectTabHCM', 'onSelectTabAnalytics', 'onSelectTabAdmin']
            .forEach((fn) => expect(controller[fn]).toBeUndefined());
    });
});

describe('Unit: Dashboard view binds only live figures', () => {
    const viewXml = fs.readFileSync(path.join(__dirname, '../../../app/fiori-app/webapp/view/Dashboard.view.xml'), 'utf8');
    const controllerSource = fs.readFileSync(path.join(__dirname, '../../../app/fiori-app/webapp/controller/Dashboard.controller.js'), 'utf8');
    const metricKeys = [...controllerSource.match(/var METRIC_KEYS = \[([\s\S]*?)\];/)[1].matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1]);
    const nonMetricModelKeys = ['selectedTab', 'connectionText', 'connectionState', 'metricsError'];

    test('every dashboardView binding is a live SAP metric or a status field', () => {
        const bound = [...new Set([...viewXml.matchAll(/dashboardView>\/([A-Za-z]+)/g)].map((m) => m[1]))];
        const unknown = bound.filter((key) => !metricKeys.includes(key) && !nonMetricModelKeys.includes(key));
        expect(unknown).toEqual([]);
    });

    test('every metric tile shows Loading / Failed states through the formatter', () => {
        const numericValues = [...viewXml.matchAll(/<NumericContent[^>]*value="([^"]*)"/g)].map((m) => m[1]);
        expect(numericValues.length).toBeGreaterThan(0);
        numericValues.forEach((binding) => expect(binding).toMatch(/formatter: '\.formatMetricValue'/));
        const tilesWithValue = [...viewXml.matchAll(/<GenericTile[^>]*>\s*<TileContent[^>]*>\s*<NumericContent[^>]*value=/g)].map((m) => m[0]);
        tilesWithValue.forEach((tile) => expect(tile).toMatch(/state="\{path: 'dashboardView>\/[A-Za-z]+', formatter: '\.formatTileState'\}"/));
    });

    test('contains no simulators, info dialogs, hard-coded status or placeholder tabs', () => {
        expect(viewXml).not.toMatch(/onSimulateCarLoan|onNewCarLoanApp|onShowMasterDataInfo/);
        expect(viewXml).not.toMatch(/Client 220/);
        expect(viewXml).not.toMatch(/systemHealth|totalSpend|completeRate/);
        const tabKeys = [...viewXml.matchAll(/<IconTabFilter[\s\S]*?key="([a-zA-Z]+)"/g)].map((m) => m[1]);
        expect(tabKeys).toEqual(['overview', 'masterData', 'fi', 'mm', 'sd', 'ewm']);
    });

    test('every press handler used by the view exists on the controller', () => {
        const handlers = [...new Set([...viewXml.matchAll(/(?:press|select)="\.([A-Za-z]+)"/g)].map((m) => m[1]))];
        handlers.forEach((handler) => expect(controllerSource).toMatch(new RegExp(`\\b${handler}: function`)));
    });
});

describe('Unit: PurchaseOrderAdapter getDashboardMetrics & getBusinessPartnerCount', () => {
    const poAdapter = require('../../../srv/integration/s4hana/mm/purchase-order/PurchaseOrderAdapter');

    const COUNTS = {
        'C_PURCHASEORDER_FS_SRV/C_PurchaseOrderFs': '2729',
        'C_MM_SupplierValueHelp': '4376',
        'C_MM_MaterialValueHelp': '151976',
        'FAC_GL_JOURNALENTRY_VER_SRV/C_GLJrnlEntryItemToBeVerified': '173386',
        'SD_F2370_INQY_WL_SRV/C_InquiryWL_F2370': '618',
        'SD_F2370_INQY_WL_SRV/I_Customer_VH': '891',
        'I_GLAccountStdVH': '33784',
        'I_CostCenterVH': '952',
        'I_ProfitCenterStdVH': '103',
        'I_MasterFixedAssetStdVH': '304',
        'I_WBSElementBasicDataStdVH': '489',
        'I_InternalOrderStdVH': '141',
        'C_PurchaseContractValHelp': '24',
        'C_MM_CompanyCodeValueHelp': '69',
        'C_MM_PlantValueHelp': '76',
        'C_MM_StorLocValueHelp': '689',
        'C_MM_MaterialGroupValueHelp': '258',
        'C_PurchasingOrgValueHelp': '9',
        'C_PurchasingGroupValueHelp': '44',
        'API_WAREHOUSE/Warehouse': '1',
        'UI_RESERVATION_ITM_MNG_V2': '54',
        'MMIM_GR4PO_DL_SRV': '12'
    };

    const liveSap = (overrides = {}) => jest.fn().mockImplementation((dest, config) => {
        const u = config.url;
        for (const [fragment, behaviour] of Object.entries(overrides)) {
            if (u.includes(fragment)) return typeof behaviour === 'function' ? behaviour() : Promise.resolve(behaviour);
        }
        if (u.includes('ZAPI_GETBUPA_SRV/BusinessPartnerSet/$count')) return Promise.resolve({ data: '6677' });
        if (u.includes('CATALOGSERVICE;v=2/ServiceCollection/$count')) return Promise.resolve({ data: '1345' });
        if (u.includes("OverallSDProcessStatus ne 'C'")) return Promise.resolve({ data: { d: { __count: '498' } } });
        if (u.includes('SD_F1873_SO_WL_SRV/C_SalesOrderWl_F1873')) return Promise.resolve({ data: { d: { __count: '880' } } });
        const hit = Object.keys(COUNTS).find((fragment) => u.includes(fragment));
        if (hit) return Promise.resolve({ data: { d: { __count: COUNTS[hit] } } });
        return Promise.reject(new Error('Unexpected URL ' + u));
    });

    beforeEach(() => {
        jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('getBusinessPartnerCount queries ZAPI_GETBUPA_SRV/$count', async () => {
        const mockExecute = jest.fn().mockResolvedValue({ data: '6677' });
        const count = await poAdapter.getBusinessPartnerCount({ destination: { url: 'https://mock.s4hana' }, executeHttpRequest: mockExecute });
        expect(count).toBe(6677);
        expect(mockExecute.mock.calls[0][1].url).toContain('ZAPI_GETBUPA_SRV/BusinessPartnerSet/$count');
    });

    test('getBusinessPartnerCount returns null, not 0, when SAP cannot be read', async () => {
        const count = await poAdapter.getBusinessPartnerCount({
            destination: { url: 'https://mock.s4hana' },
            executeHttpRequest: jest.fn().mockRejectedValue(new Error('403'))
        });
        expect(count).toBeNull();
    });

    test('getDashboardMetrics reads all 26 counts live from SAP and reports none unavailable', async () => {
        const mockExecute = liveSap();
        const metrics = await poAdapter.getDashboardMetrics({ destination: { url: 'https://mock.s4hana' }, executeHttpRequest: mockExecute });

        expect(mockExecute).toHaveBeenCalledTimes(26);
        expect(metrics).toEqual({
            totalCount: 2729,
            supplierCount: 4376,
            productCount: 151976,
            fiDocCount: 173386,
            salesInquiryCount: 618,
            customerCount: 891,
            openSalesOrderCount: 498,
            totalSalesOrderCount: 880,
            bpCount: 6677,
            glAccountCount: 33784,
            costCenterCount: 952,
            profitCenterCount: 103,
            fixedAssetCount: 304,
            wbsElementCount: 489,
            internalOrderCount: 141,
            purchaseContractCount: 24,
            companyCodeCount: 69,
            plantCount: 76,
            storageLocationCount: 689,
            materialGroupCount: 258,
            purchasingOrgCount: 9,
            purchasingGroupCount: 44,
            warehouseCount: 1,
            openReservationCount: 54,
            inboundDeliveryCount: 12,
            gatewayCatalogCount: 1345,
            unavailable: []
        });
    });

    test('reads the purchase order total with $top=1 and returns no spend estimate or sampled rate', async () => {
        const mockExecute = liveSap();
        const metrics = await poAdapter.getDashboardMetrics({ destination: { url: 'https://mock.s4hana' }, executeHttpRequest: mockExecute });

        const poCall = mockExecute.mock.calls.map((c) => c[1].url).find((u) => u.includes('C_PurchaseOrderFs'));
        expect(poCall).toContain('$inlinecount=allpages&$top=1');
        expect(poCall).not.toContain('$top=100');
        expect(metrics).not.toHaveProperty('totalSpend');
        expect(metrics).not.toHaveProperty('completeRate');
    });

    test('a failed service call yields null for that count only, never 0, and lists it as unavailable', async () => {
        const mockExecute = liveSap({
            'API_WAREHOUSE/Warehouse': () => Promise.reject(new Error('404 service not activated')),
            'ZAPI_GETBUPA_SRV': () => Promise.reject(new Error('403 not authorized'))
        });
        const metrics = await poAdapter.getDashboardMetrics({ destination: { url: 'https://mock.s4hana' }, executeHttpRequest: mockExecute });

        expect(metrics.warehouseCount).toBeNull();
        expect(metrics.bpCount).toBeNull();
        expect(metrics.totalCount).toBe(2729);
        expect(metrics.unavailable.sort()).toEqual(['bpCount', 'warehouseCount']);
    });

    test('a response without a count yields null instead of the number of rows returned', async () => {
        const mockExecute = liveSap({
            'C_PURCHASEORDER_FS_SRV/C_PurchaseOrderFs': { data: { d: { results: [{ PurchaseOrder: '4500000001' }] } } },
            'CATALOGSERVICE': { data: '<html>not a count</html>' }
        });
        const metrics = await poAdapter.getDashboardMetrics({ destination: { url: 'https://mock.s4hana' }, executeHttpRequest: mockExecute });

        expect(metrics.totalCount).toBeNull();
        expect(metrics.gatewayCatalogCount).toBeNull();
        expect(metrics.unavailable).toEqual(expect.arrayContaining(['totalCount', 'gatewayCatalogCount']));
    });

    test('a genuine zero from SAP is kept as 0', async () => {
        const mockExecute = liveSap({ 'MMIM_GR4PO_DL_SRV': { data: { d: { __count: '0' } } } });
        const metrics = await poAdapter.getDashboardMetrics({ destination: { url: 'https://mock.s4hana' }, executeHttpRequest: mockExecute });
        expect(metrics.inboundDeliveryCount).toBe(0);
        expect(metrics.unavailable).not.toContain('inboundDeliveryCount');
    });

    test('propagates an unresolvable destination instead of returning empty figures', async () => {
        jest.spyOn(poAdapter, '_getDestination').mockRejectedValue(new Error("Destination 'S4HANA_PO_API' not found"));
        await expect(poAdapter.getDashboardMetrics({ executeHttpRequest: jest.fn() })).rejects.toThrow('not found');
    });

    test('caches dashboard metrics on subsequent calls when useCache is enabled', async () => {
        poAdapter.clearMetricsCache();
        const mockExecute = liveSap();
        const opts = { destination: { url: 'https://mock.s4hana' }, executeHttpRequest: mockExecute, useCache: true };

        const metrics1 = await poAdapter.getDashboardMetrics(opts);
        expect(mockExecute).toHaveBeenCalledTimes(26);

        // Second call should return cached object without invoking executeHttpRequest
        const metrics2 = await poAdapter.getDashboardMetrics(opts);
        expect(mockExecute).toHaveBeenCalledTimes(26); // No new calls
        expect(metrics2).toEqual(metrics1);
    });

    test('bypasses cache and refetches live figures when forceRefresh is true', async () => {
        poAdapter.clearMetricsCache();
        const mockExecute = liveSap();
        const opts = { destination: { url: 'https://mock.s4hana' }, executeHttpRequest: mockExecute, useCache: true };

        await poAdapter.getDashboardMetrics(opts);
        expect(mockExecute).toHaveBeenCalledTimes(26);

        // With forceRefresh: true, executes calls again
        await poAdapter.getDashboardMetrics({ ...opts, forceRefresh: true });
        // The 7 transactional counts are executed again; master data counts may hit masterDataCountCache
        expect(mockExecute.mock.calls.length).toBeGreaterThan(26);
    });

    test('clearMetricsCache invalidates cached metrics', async () => {
        poAdapter.clearMetricsCache();
        const mockExecute = liveSap();
        const opts = { destination: { url: 'https://mock.s4hana' }, executeHttpRequest: mockExecute, useCache: true };

        await poAdapter.getDashboardMetrics(opts);
        expect(mockExecute).toHaveBeenCalledTimes(26);

        poAdapter.clearMetricsCache();
        await poAdapter.getDashboardMetrics(opts);
        expect(mockExecute).toHaveBeenCalledTimes(52);
    });
});
