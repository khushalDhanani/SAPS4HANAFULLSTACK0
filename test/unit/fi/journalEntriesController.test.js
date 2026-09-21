/**
 * Unit Tests for Journal Entries Controller
 * (JournalEntries.controller.js)
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
                getRouter: () => self._router,
                getModel: (n) => {
                    if (n === "i18n") {
                        return {
                            getResourceBundle: () => ({
                                getText: (k) => k
                            })
                        };
                    }
                    return null;
                }
            };
        };
        return Controller;
    }
};

const MockMessageToast = {
    show: jest.fn()
};

const MockODataClient = {
    get: jest.fn().mockImplementation((url) => {
        if (url.indexOf("getDashboardMetrics") !== -1) {
            return Promise.resolve({ glAccountCount: 39 });
        }
        return Promise.resolve({});
    })
};

const MockFormatter = {
    formatDebitCredit: jest.fn(),
    debitCreditState: jest.fn(),
    formatAmount: jest.fn()
};

beforeAll(() => {
    global.sap = {
        ui: {
            define: (deps, factory) => {
                ControllerClass = factory(
                    MockBaseController,
                    MockJSONModel,
                    MockFilter,
                    MockFilterOperator,
                    MockFormatter,
                    MockMessageToast,
                    MockODataClient
                );
            }
        }
    };
    require("../../../app/fiori-app/webapp/modules/fi/journal-entry/controller/JournalEntries.controller.js");
});

describe("JournalEntries.controller", () => {
    let controller;
    let mockRouter;
    let mockRoute;
    let mockTable;
    let mockBinding;

    beforeEach(() => {
        jest.clearAllMocks();
        controller = new ControllerClass();

        mockRoute = {
            attachPatternMatched: jest.fn()
        };

        mockRouter = {
            getRoute: jest.fn().mockReturnValue(mockRoute),
            navTo: jest.fn()
        };
        controller._router = mockRouter;

        mockBinding = {
            refresh: jest.fn(),
            filter: jest.fn()
        };

        mockTable = {
            getBinding: jest.fn().mockReturnValue(mockBinding)
        };

        controller._byIds["tableJournalEntries"] = mockTable;
    });

    describe("Initialization & Lifecycle", () => {
        it("onInit sets up fiView model with '-' initial KPIs and attaches route listener", async () => {
            controller.onInit();
            const viewModel = controller.getView().getModel("fiView");
            expect(viewModel).toBeDefined();
            expect(viewModel.getProperty("/totalCount")).toBe("-");
            expect(viewModel.getProperty("/glAccountCount")).toBe("-");
            expect(mockRouter.getRoute).toHaveBeenCalledWith("journalEntries");
            expect(mockRoute.attachPatternMatched).toHaveBeenCalledWith(controller._onRouteMatched, controller);

            await new Promise(process.nextTick);
            expect(viewModel.getProperty("/glAccountCount")).toBe(39);
        });

        it("_onRouteMatched refreshes table binding safely and reloads server metrics", () => {
            controller.onInit();
            controller._onRouteMatched();
            expect(mockBinding.refresh).toHaveBeenCalled();
            expect(MockODataClient.get).toHaveBeenCalled();
        });
    });

    describe("Table Updates & Metrics", () => {
        it("onUpdateFinished updates totalCount from binding $count parameter without scraping loaded rows", () => {
            controller.onInit();

            const oEvent = {
                getSource: () => ({}),
                getParameter: (param) => param === "total" ? 174153 : null
            };

            controller.onUpdateFinished(oEvent);
            const viewModel = controller.getView().getModel("fiView");
            expect(viewModel.getProperty("/totalCount")).toBe(174153);
        });

        it("onUpdateFinished sets totalCount to '-' when $count parameter is absent or not a number", () => {
            controller.onInit();

            const oEvent = {
                getSource: () => ({}),
                getParameter: () => null
            };

            controller.onUpdateFinished(oEvent);
            const viewModel = controller.getView().getModel("fiView");
            expect(viewModel.getProperty("/totalCount")).toBe("-");
        });

        it("_loadServerMetrics handles server errors by setting '-'", async () => {
            controller.onInit();
            MockODataClient.get.mockRejectedValueOnce(new Error("502 Gateway Timeout"));

            await controller._loadServerMetrics();

            const viewModel = controller.getView().getModel("fiView");
            expect(viewModel.getProperty("/glAccountCount")).toBe("-");
        });

        it("_loadServerMetrics parses stringified JSON responses correctly", async () => {
            controller.onInit();
            MockODataClient.get.mockResolvedValueOnce(JSON.stringify({ glAccountCount: 55 }));

            await controller._loadServerMetrics();

            const viewModel = controller.getView().getModel("fiView");
            expect(viewModel.getProperty("/glAccountCount")).toBe(55);
        });
    });

    describe("Search, Refresh & Navigation", () => {
        it("onSearch applies filter across AccountingDocument, GLAccount, and CostCenter", () => {
            controller.onInit();
            const oEvent = {
                getSource: () => ({
                    getValue: () => "100000"
                })
            };

            controller.onSearch(oEvent);
            expect(mockBinding.filter).toHaveBeenCalledWith(expect.any(Array), "Application");
        });

        it("onSearch with empty query clears filters", () => {
            controller.onInit();
            const oEvent = {
                getSource: () => ({
                    getValue: () => ""
                })
            };

            controller.onSearch(oEvent);
            expect(mockBinding.filter).toHaveBeenCalledWith([], "Application");
        });

        it("onRefresh triggers binding refresh, server metrics reload, and shows toast", () => {
            controller.onInit();
            controller.onRefresh();

            expect(mockBinding.refresh).toHaveBeenCalled();
            expect(MockODataClient.get).toHaveBeenCalled();
            expect(MockMessageToast.show).toHaveBeenCalledWith("dashboardActionRefreshDesc");
        });

        it("onItemPress shows toast with document number and company code", () => {
            controller.onInit();
            const mockContext = {
                getProperty: (prop) => {
                    if (prop === "AccountingDocument") return "100000001";
                    if (prop === "CompanyCode") return "1000";
                    return null;
                }
            };
            const oEvent = {
                getParameter: () => ({
                    getBindingContext: () => mockContext
                })
            };

            controller.onItemPress(oEvent);
            expect(MockMessageToast.show).toHaveBeenCalledWith("Selected Document: 100000001 (1000)");
        });

        it("onNavBack navigates back to dashboard", () => {
            controller.onNavBack();
            expect(mockRouter.navTo).toHaveBeenCalledWith("dashboard", {}, true);
        });
    });
});
