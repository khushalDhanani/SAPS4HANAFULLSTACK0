/**
 * Unit Tests for Sales Inquiries Controller
 * (SalesInquiries.controller.js)
 */

let ControllerClass;

global.window = global.window || {
    open: jest.fn()
};

class MockJSONModel {
    constructor(data) {
        this.data = JSON.parse(JSON.stringify(data || {}));
    }
    setProperty(path, value) {
        const parts = path.replace(/^\//, "").split("/");
        let curr = this.data;
        for (let i = 0; i < parts.length - 1; i++) {
            if (!curr[parts[i]]) {
                curr[parts[i]] = {};
            }
            curr = curr[parts[i]];
        }
        curr[parts[parts.length - 1]] = value;
    }
    getProperty(path) {
        const parts = path.replace(/^\//, "").split("/");
        let curr = this.data;
        for (let i = 0; i < parts.length; i++) {
            if (curr === undefined || curr === null) return undefined;
            curr = curr[parts[i]];
        }
        return curr;
    }
    getData() {
        return this.data;
    }
}


class MockFilter {
    constructor(config) {
        this.config = config;
    }
}

const MockFilterOperator = {
    Contains: "Contains",
    EQ: "EQ"
};

const MockFilterType = {
    Application: "Application"
};

const MockBaseController = {
    prototype: {
        onNavBack: jest.fn(),
        calculateKpiMetrics: function (oTable, oEvent) {
            var iTotal = null;
            if (oEvent && typeof oEvent.getParameter === "function") {
                var vTotal = oEvent.getParameter("total");
                if (typeof vTotal === "number" && !isNaN(vTotal)) {
                    iTotal = vTotal;
                }
            }
            return {
                totalCount: iTotal !== null ? iTotal : "-"
            };
        }
    },
    extend: (name, proto) => {
        function Controller() {
            this._models = {};
            this._byIds = {};
        }
        Object.assign(Controller.prototype, MockBaseController.prototype, proto);
        Controller.prototype.getView = function () {
            const self = this;
            return {
                getId: () => "mockViewId",
                setModel: (m, n) => { self._models[n || ""] = m; },
                getModel: (n) => self._models[n || ""],
                addDependent: jest.fn()
            };
        };
        Controller.prototype.byId = function (id) {
            return this._byIds[id] || null;
        };
        Controller.prototype.getOwnerComponent = function () {
            const self = this;
            return {
                getRouter: () => self._router
            };
        };
        return Controller;
    }
};

const MockODataClient = {
    get: jest.fn().mockImplementation((url) => {
        if (url.indexOf("getSalesInquiryMetrics") !== -1) {
            return Promise.resolve({ openInquiriesCount: 15, totalInquiriesCount: 50, openOrdersCount: 15, totalOrdersCount: 50 });
        }
        if (url.indexOf("getSalesOrderMetrics") !== -1) {
            return Promise.resolve({ openOrdersCount: 15, totalOrdersCount: 50 });
        }
        if (url.indexOf("getDashboardMetrics") !== -1) {
            return Promise.resolve({ customerCount: 88 });
        }
        return Promise.resolve({});
    })
};

global.sap = {
    ui: {
        define: (deps, factory) => {
            ControllerClass = factory(
                MockBaseController,
                MockJSONModel,
                MockFilter,
                MockFilterOperator,
                MockFilterType,
                MockODataClient
            );
        },
        model: {
            json: { JSONModel: MockJSONModel },
            Filter: MockFilter,
            FilterOperator: MockFilterOperator,
            FilterType: MockFilterType
        }
    }
};

require("../../../app/fiori-app/webapp/modules/sd/sales-inquiry/controller/SalesInquiries.controller.js");

describe("SalesInquiries.controller", () => {
    let controller;
    let mockRouter;
    let mockTable;
    let mockBinding;

    beforeEach(() => {
        jest.clearAllMocks();
        controller = new ControllerClass();
        mockRouter = {
            getRoute: jest.fn().mockReturnValue({
                attachPatternMatched: jest.fn()
            }),
            navTo: jest.fn()
        };
        controller._router = mockRouter;

        mockBinding = {
            refresh: jest.fn(),
            filter: jest.fn()
        };

        mockTable = {
            getBinding: jest.fn().mockReturnValue(mockBinding),
            getItems: jest.fn().mockReturnValue([]),
            getSelectedItem: jest.fn().mockReturnValue(null)
        };

        controller._byIds["salesInquiriesTable"] = mockTable;
    });

    describe("Initialization & Lifecycle", () => {
        it("onInit sets up salesInquiriesView model with '-' initial KPIs and attaches route listener", async () => {
            controller.onInit();
            const viewModel = controller.getView().getModel("salesInquiriesView");
            expect(viewModel).toBeDefined();
            expect(viewModel.getProperty("/totalCount")).toBe("-");
            expect(viewModel.getProperty("/openCount")).toBe("-");
            expect(viewModel.getProperty("/customerCount")).toBe("-");
            expect(mockRouter.getRoute).toHaveBeenCalledWith("salesInquiries");

            await new Promise(process.nextTick);
            expect(viewModel.getProperty("/openCount")).toBe(15);
            expect(viewModel.getProperty("/customerCount")).toBe(88);
        });

        it("_onRouteMatched refreshes table binding safely", () => {
            controller._onRouteMatched();
            expect(mockBinding.refresh).toHaveBeenCalled();
        });
    });

    describe("Formatters", () => {
        it("statusText formats Open, In Process, and Completed", () => {
            expect(controller.formatter.statusText("A")).toBe("Open");
            expect(controller.formatter.statusText("Open")).toBe("Open");
            expect(controller.formatter.statusText("B")).toBe("In Process");
            expect(controller.formatter.statusText("C")).toBe("Completed");
            expect(controller.formatter.statusText("Completed")).toBe("Completed");
            expect(controller.formatter.statusText(null)).toBe("Open");
            expect(controller.formatter.statusText("Custom")).toBe("Custom");
        });

        it("statusState returns appropriate sap.ui.core.ValueState", () => {
            expect(controller.formatter.statusState("A")).toBe("Information");
            expect(controller.formatter.statusState("Open")).toBe("Information");
            expect(controller.formatter.statusState("B")).toBe("Warning");
            expect(controller.formatter.statusState("C")).toBe("Success");
            expect(controller.formatter.statusState("Completed")).toBe("Success");
            expect(controller.formatter.statusState("Unknown")).toBe("None");
        });
    });

    describe("Table Updates & Metrics", () => {
        it("onUpdateFinished updates totalCount from binding $count parameter without scraping loaded rows", () => {
            controller.onInit();

            const oEvent = {
                getSource: () => ({}),
                getParameter: (param) => param === "total" ? 3 : null
            };

            controller.onUpdateFinished(oEvent);
            const viewModel = controller.getView().getModel("salesInquiriesView");
            expect(viewModel.getProperty("/totalCount")).toBe(3);
        });

        it("onUpdateFinished sets totalCount to '-' when $count parameter is absent", () => {
            controller.onInit();

            const oEvent = {
                getSource: () => ({}),
                getParameter: () => null
            };

            controller.onUpdateFinished(oEvent);
            const viewModel = controller.getView().getModel("salesInquiriesView");
            expect(viewModel.getProperty("/totalCount")).toBe("-");
        });

        it("_loadServerMetrics handles server errors by setting '-'", async () => {
            controller.onInit();
            MockODataClient.get.mockRejectedValueOnce(new Error("502 Gateway Error"));
            MockODataClient.get.mockRejectedValueOnce(new Error("502 Gateway Error"));

            await controller._loadServerMetrics();

            const viewModel = controller.getView().getModel("salesInquiriesView");
            expect(viewModel.getProperty("/openCount")).toBe("-");
            expect(viewModel.getProperty("/customerCount")).toBe("-");
        });

        it("_loadServerMetrics strictly binds openInquiriesCount and never falls back to openOrdersCount", async () => {
            controller.onInit();
            // Mock returning only openOrdersCount without openInquiriesCount
            MockODataClient.get.mockResolvedValueOnce({ openOrdersCount: 99, totalOrdersCount: 150 });
            MockODataClient.get.mockResolvedValueOnce({ customerCount: 42 });

            await controller._loadServerMetrics();

            const viewModel = controller.getView().getModel("salesInquiriesView");
            // Must NOT show 99 (the open orders count)
            expect(viewModel.getProperty("/openCount")).toBe("-");
            expect(viewModel.getProperty("/customerCount")).toBe(42);
        });
    });

    describe("Navigation", () => {
        it("onNavigateToCreateInquiry routes to createSalesInquiry", () => {
            controller.onNavigateToCreateInquiry();
            expect(mockRouter.navTo).toHaveBeenCalledWith("createSalesInquiry");
        });

        it("onInquiryPress routes to salesInquiryDetail with key", () => {
            const oEvent = {
                getParameter: () => ({
                    getBindingContext: () => ({
                        getProperty: (prop) => prop === "SalesInquiry" ? "10000001" : ""
                    })
                })
            };

            controller.onInquiryPress(oEvent);
            expect(mockRouter.navTo).toHaveBeenCalledWith("salesInquiryDetail", {
                SalesInquiry: "10000001"
            });
        });
    });

    describe("Search and Refresh", () => {
        it("onSearch applies multi-attribute filter", () => {
            const oEvent = {
                getParameter: () => "Bajaj"
            };
            controller.onSearch(oEvent);
            expect(mockBinding.filter).toHaveBeenCalledWith(
                expect.any(Array),
                MockFilterType.Application
            );
        });

        it("onSearch with empty query clears filters", () => {
            const oEvent = {
                getParameter: () => ""
            };
            controller.onSearch(oEvent);
            expect(mockBinding.filter).toHaveBeenCalledWith([], MockFilterType.Application);
        });

        it("onRefresh triggers binding refresh", () => {
            controller.onRefresh();
            expect(mockBinding.refresh).toHaveBeenCalled();
        });
    });
});
