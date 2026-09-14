/**
 * Unit Tests for Dashboard Real-Time Metrics & SalesInquiryAdapter
 * (Dashboard.controller.js & SalesInquiryAdapter.js)
 */

const salesInquiryAdapter = require('../../../srv/integration/s4hana/sd/sales-inquiry/SalesInquiryAdapter');

describe('Unit: SalesInquiryAdapter getSalesMetrics', () => {
    test('should query SD_F1873_SO_WL_SRV for open and total sales order counts', async () => {
        const mockExecute = jest.fn()
            .mockResolvedValueOnce({
                data: {
                    d: {
                        __count: '498',
                        results: [{ SalesOrder: '2500000' }]
                    }
                }
            })
            .mockResolvedValueOnce({
                data: {
                    d: {
                        __count: '880',
                        results: [{ SalesOrder: '2500000' }]
                    }
                }
            });

        const metrics = await salesInquiryAdapter.getSalesMetrics({
            destination: { url: 'https://mock.s4hana' },
            executeHttpRequest: mockExecute
        });

        expect(metrics).toEqual({
            openOrdersCount: 498,
            totalOrdersCount: 880
        });
        expect(mockExecute).toHaveBeenCalledTimes(2);
        expect(mockExecute.mock.calls[0][1].url).toContain("$filter=OverallSDProcessStatus ne 'C'");
    });

    test('should return 0 counts when remote SAP service call fails', async () => {
        const mockExecute = jest.fn().mockRejectedValue(new Error('Gateway timeout'));

        const metrics = await salesInquiryAdapter.getSalesMetrics({
            destination: { url: 'https://mock.s4hana' },
            executeHttpRequest: mockExecute
        });

        expect(metrics).toEqual({
            openOrdersCount: 0,
            totalOrdersCount: 0
        });
    });
});

describe('Unit: Dashboard Controller Metrics Loading', () => {
    let DashboardControllerClass;
    let mockODataClient;

    class MockJSONModel {
        constructor(data) {
            this.data = data || {};
        }
        setProperty(path, value) {
            const prop = path.replace(/^\//, '');
            this.data[prop] = value;
        }
        getProperty(path) {
            const prop = path.replace(/^\//, '');
            return this.data[prop];
        }
        getData() {
            return this.data;
        }
    }

    const MockBaseController = {
        extend: (name, proto) => {
            function Controller() {
                if (proto) {
                    Object.assign(this, proto);
                }
            }
            return Controller;
        }
    };

    const mockRouter = {
        getRoute: jest.fn().mockReturnValue({
            attachPatternMatched: jest.fn()
        }),
        navTo: jest.fn()
    };

    beforeAll(() => {
        mockODataClient = {
            get: jest.fn()
        };

        global.sap = {
            ui: {
                define: jest.fn((deps, factory) => {
                    DashboardControllerClass = factory(
                        MockBaseController,
                        MockJSONModel,
                        mockODataClient,
                        { show: jest.fn() },
                        { information: jest.fn(), success: jest.fn() }
                    );
                })
            }
        };

        require('../../../app/fiori-app/webapp/controller/Dashboard.controller.js');
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('onInit should initialize dashboardView model with all metric properties', () => {
        const controller = new DashboardControllerClass();
        let setModelData = null;
        controller.getView = () => ({
            setModel: (m) => { setModelData = m.getData(); }
        });
        controller.getOwnerComponent = () => ({
            getRouter: () => mockRouter
        });

        controller.onInit();

        expect(setModelData).toBeDefined();
        expect(setModelData).toHaveProperty('openSalesOrderCount', 0);
        expect(setModelData).toHaveProperty('totalSalesOrderCount', 0);
        expect(setModelData).toHaveProperty('salesInquiryCount', 0);
        expect(setModelData).toHaveProperty('customerCount', 0);
        expect(setModelData).toHaveProperty('totalCount', 0);
        expect(setModelData).toHaveProperty('supplierCount', 0);
        expect(setModelData).toHaveProperty('fiDocCount', 0);
    });

    test('_loadMetrics should load real-time SAP counts across all modules and update model', async () => {
        const controller = new DashboardControllerClass();
        const oViewModel = new MockJSONModel({
            totalCount: 0,
            completeRate: 0,
            supplierCount: 0,
            fiDocCount: 0,
            salesInquiryCount: 0,
            customerCount: 0,
            openSalesOrderCount: 0,
            totalSalesOrderCount: 0
        });

        controller.getView = () => ({
            getModel: (name) => name === 'dashboardView' ? oViewModel : null
        });

        mockODataClient.get.mockImplementation((url) => {
            if (url.includes('/PurchaseOrders')) {
                return Promise.resolve({
                    '@odata.count': '2729',
                    value: [
                        { PurchaseOrder: '300000001', PurchasingCompletenessStatus: true },
                        { PurchaseOrder: '300000002', PurchasingCompletenessStatus: false }
                    ]
                });
            }
            if (url.includes('/SupplierVH')) {
                return Promise.resolve({
                    '@odata.count': '4376',
                    value: [{ Supplier: '1110' }]
                });
            }
            if (url.includes('/JournalEntryItems')) {
                return Promise.resolve({
                    '@odata.count': '173386',
                    value: [{ AccountingDocument: '1900000025' }]
                });
            }
            if (url.includes('/SalesInquiries')) {
                return Promise.resolve({
                    '@odata.count': '618',
                    value: [{ SalesInquiry: '100000' }]
                });
            }
            if (url.includes('/CustomerVH')) {
                return Promise.resolve({
                    '@odata.count': '891',
                    value: [{ Customer: '1110' }]
                });
            }
            if (url.includes('getSalesOrderMetrics')) {
                return Promise.resolve({
                    openOrdersCount: 498,
                    totalOrdersCount: 880
                });
            }
            return Promise.reject(new Error('Unknown URL: ' + url));
        });

        await controller._loadMetrics();

        const data = oViewModel.getData();
        expect(data.totalCount).toBe(2729);
        expect(data.completeRate).toBe(50);
        expect(data.supplierCount).toBe(4376);
        expect(data.fiDocCount).toBe(173386);
        expect(data.salesInquiryCount).toBe(618);
        expect(data.customerCount).toBe(891);
        expect(data.openSalesOrderCount).toBe(498);
        expect(data.totalSalesOrderCount).toBe(880);
    });

    test('_loadMetrics should fast-path parse and populate unified getDashboardMetrics payload directly', async () => {
        const controller = new DashboardControllerClass();
        const oViewModel = new MockJSONModel({});

        controller.getView = () => ({
            getModel: (name) => name === 'dashboardView' ? oViewModel : null
        });

        const mockUnifiedMetrics = {
            totalCount: 2729,
            supplierCount: 4376,
            productCount: 151976,
            bpCount: 6677,
            fiDocCount: 173386,
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
            totalSpend: '3.42',
            completeRate: 98,
            openSalesOrderCount: 498,
            totalSalesOrderCount: 880,
            salesInquiryCount: 618,
            customerCount: 891
        };

        mockODataClient.get.mockImplementation((url) => {
            if (url.includes('getDashboardMetrics()')) {
                return Promise.resolve(JSON.stringify(mockUnifiedMetrics));
            }
            return Promise.reject(new Error('Should not call individual fallback'));
        });

        await controller._loadMetrics();

        const data = oViewModel.getData();
        expect(data.totalCount).toBe(2729);
        expect(data.supplierCount).toBe(4376);
        expect(data.productCount).toBe(151976);
        expect(data.bpCount).toBe(6677);
        expect(data.costCenterCount).toBe(952);
        expect(data.profitCenterCount).toBe(103);
        expect(data.fixedAssetCount).toBe(304);
        expect(data.wbsElementCount).toBe(489);
        expect(data.internalOrderCount).toBe(141);
        expect(data.purchaseContractCount).toBe(24);
        expect(data.companyCodeCount).toBe(69);
        expect(data.plantCount).toBe(76);
        expect(data.storageLocationCount).toBe(689);
        expect(data.materialGroupCount).toBe(258);
        expect(data.purchasingOrgCount).toBe(9);
        expect(data.purchasingGroupCount).toBe(44);
        expect(data.warehouseCount).toBe(1);
        expect(data.openReservationCount).toBe(54);
        expect(data.inboundDeliveryCount).toBe(12);
        expect(data.gatewayCatalogCount).toBe(1345);
        expect(data.totalSpend).toBe('3.42');
        expect(data.completeRate).toBe(98);
        expect(data.openSalesOrderCount).toBe(498);
        expect(data.totalSalesOrderCount).toBe(880);
        expect(data.salesInquiryCount).toBe(618);
        expect(data.customerCount).toBe(891);
    });
});

describe('Unit: PurchaseOrderAdapter getDashboardMetrics & getBusinessPartnerCount', () => {
    const poAdapter = require('../../../srv/integration/s4hana/mm/purchase-order/PurchaseOrderAdapter');

    test('getBusinessPartnerCount should query ZAPI_GETBUPA_SRV/$count', async () => {
        const mockExecute = jest.fn().mockResolvedValue({
            data: '6677'
        });

        const count = await poAdapter.getBusinessPartnerCount({
            destination: { url: 'https://mock.s4hana' },
            executeHttpRequest: mockExecute
        });

        expect(count).toBe(6677);
        expect(mockExecute).toHaveBeenCalledTimes(1);
        expect(mockExecute.mock.calls[0][1].url).toContain('ZAPI_GETBUPA_SRV/BusinessPartnerSet/$count');
    });

    test('getDashboardMetrics should fetch and combine all 25 live SAP metrics concurrently', async () => {
        const mockExecute = jest.fn().mockImplementation((dest, config) => {
            const u = config.url;
            if (u.includes('C_PURCHASEORDER_FS_SRV/C_PurchaseOrderFs')) {
                return Promise.resolve({
                    data: {
                        d: {
                            __count: '2729',
                            results: [
                                { PurchaseOrder: '1', PurchaseOrderNetAmount: '1000.00', PurchasingCompletenessStatus: true }
                            ]
                        }
                    }
                });
            }
            if (u.includes('ZAPI_GETBUPA_SRV/BusinessPartnerSet/$count')) {
                return Promise.resolve({ data: '6677' });
            }
            if (u.includes('C_MM_SupplierValueHelp')) {
                return Promise.resolve({ data: { d: { __count: '4376' } } });
            }
            if (u.includes('C_MM_MaterialValueHelp')) {
                return Promise.resolve({ data: { d: { __count: '151976' } } });
            }
            if (u.includes('FAC_GL_JOURNALENTRY_VER_SRV/C_GLJrnlEntryItemToBeVerified')) {
                return Promise.resolve({ data: { d: { __count: '173386' } } });
            }
            if (u.includes('SD_F2370_INQY_WL_SRV/C_InquiryWL_F2370')) {
                return Promise.resolve({ data: { d: { __count: '618' } } });
            }
            if (u.includes('SD_F2370_INQY_WL_SRV/I_Customer_VH')) {
                return Promise.resolve({ data: { d: { __count: '891' } } });
            }
            if (u.includes("OverallSDProcessStatus ne 'C'")) {
                return Promise.resolve({ data: { d: { __count: '498' } } });
            }
            if (u.includes('SD_F1873_SO_WL_SRV/C_SalesOrderWl_F1873')) {
                return Promise.resolve({ data: { d: { __count: '880' } } });
            }
            if (u.includes('I_GLAccountStdVH')) {
                return Promise.resolve({ data: { d: { __count: '33784' } } });
            }
            if (u.includes('I_CostCenterVH')) {
                return Promise.resolve({ data: { d: { __count: '952' } } });
            }
            if (u.includes('I_ProfitCenterStdVH')) {
                return Promise.resolve({ data: { d: { __count: '103' } } });
            }
            if (u.includes('I_MasterFixedAssetStdVH')) {
                return Promise.resolve({ data: { d: { __count: '304' } } });
            }
            if (u.includes('I_WBSElementBasicDataStdVH')) {
                return Promise.resolve({ data: { d: { __count: '489' } } });
            }
            if (u.includes('I_InternalOrderStdVH')) {
                return Promise.resolve({ data: { d: { __count: '141' } } });
            }
            if (u.includes('C_PurchaseContractValHelp')) {
                return Promise.resolve({ data: { d: { __count: '24' } } });
            }
            if (u.includes('C_MM_CompanyCodeValueHelp')) {
                return Promise.resolve({ data: { d: { __count: '69' } } });
            }
            if (u.includes('C_MM_PlantValueHelp')) {
                return Promise.resolve({ data: { d: { __count: '76' } } });
            }
            if (u.includes('C_MM_StorLocValueHelp')) {
                return Promise.resolve({ data: { d: { __count: '689' } } });
            }
            if (u.includes('C_MM_MaterialGroupValueHelp')) {
                return Promise.resolve({ data: { d: { __count: '258' } } });
            }
            if (u.includes('C_PurchasingOrgValueHelp')) {
                return Promise.resolve({ data: { d: { __count: '9' } } });
            }
            if (u.includes('C_PurchasingGroupValueHelp')) {
                return Promise.resolve({ data: { d: { __count: '44' } } });
            }
            if (u.includes('API_WAREHOUSE/Warehouse')) {
                return Promise.resolve({ data: { d: { __count: '1' } } });
            }
            if (u.includes('UI_RESERVATION_ITM_MNG_V2')) {
                return Promise.resolve({ data: { d: { __count: '54' } } });
            }
            if (u.includes('MMIM_GR4PO_DL_SRV')) {
                return Promise.resolve({ data: { d: { __count: '12' } } });
            }
            if (u.includes('CATALOGSERVICE;v=2/ServiceCollection/$count')) {
                return Promise.resolve({ data: '1345' });
            }
            return Promise.resolve({ data: { d: { __count: '1' } } });
        });

        const metrics = await poAdapter.getDashboardMetrics({
            destination: { url: 'https://mock.s4hana' },
            executeHttpRequest: mockExecute
        });

        expect(metrics).toBeDefined();
        expect(metrics.totalCount).toBe(2729);
        expect(metrics.supplierCount).toBe(4376);
        expect(metrics.productCount).toBe(151976);
        expect(metrics.bpCount).toBe(6677);
        expect(metrics.fiDocCount).toBe(173386);
        expect(metrics.salesInquiryCount).toBe(618);
        expect(metrics.customerCount).toBe(891);
        expect(metrics.openSalesOrderCount).toBe(498);
        expect(metrics.totalSalesOrderCount).toBe(880);
        expect(metrics.glAccountCount).toBe(33784);
        expect(metrics.costCenterCount).toBe(952);
        expect(metrics.profitCenterCount).toBe(103);
        expect(metrics.fixedAssetCount).toBe(304);
        expect(metrics.wbsElementCount).toBe(489);
        expect(metrics.internalOrderCount).toBe(141);
        expect(metrics.purchaseContractCount).toBe(24);
        expect(metrics.companyCodeCount).toBe(69);
        expect(metrics.plantCount).toBe(76);
        expect(metrics.storageLocationCount).toBe(689);
        expect(metrics.materialGroupCount).toBe(258);
        expect(metrics.purchasingOrgCount).toBe(9);
        expect(metrics.purchasingGroupCount).toBe(44);
        expect(metrics.warehouseCount).toBe(1);
        expect(metrics.openReservationCount).toBe(54);
        expect(metrics.inboundDeliveryCount).toBe(12);
        expect(metrics.gatewayCatalogCount).toBe(1345);
    });
});
