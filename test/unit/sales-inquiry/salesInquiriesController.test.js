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
        onNavBack: jest.fn()
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

global.sap = {
    ui: {
        define: (deps, factory) => {
            ControllerClass = factory(
                MockBaseController,
                MockJSONModel,
                MockFilter,
                MockFilterOperator,
                MockFilterType
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
        it("onInit sets up salesInquiriesView model and route listener", () => {
            controller.onInit();
            const viewModel = controller.getView().getModel("salesInquiriesView");
            expect(viewModel).toBeDefined();
            expect(viewModel.getProperty("/totalCount")).toBe(0);
            expect(viewModel.getProperty("/openCount")).toBe(0);
            expect(viewModel.getProperty("/customerCount")).toBe(0);
            expect(mockRouter.getRoute).toHaveBeenCalledWith("salesInquiries");
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
        it("onUpdateFinished computes totalCount, openCount, and unique customers", () => {
            controller.onInit();
            const mockItems = [
                {
                    getBindingContext: () => ({
                        getProperty: (prop) => prop === "SoldToParty" ? "10083" : "A"
                    })
                },
                {
                    getBindingContext: () => ({
                        getProperty: (prop) => prop === "SoldToParty" ? "10135" : "B"
                    })
                },
                {
                    getBindingContext: () => ({
                        getProperty: (prop) => prop === "SoldToParty" ? "10083" : "A"
                    })
                }
            ];

            const oEvent = {
                getSource: () => ({
                    getItems: () => mockItems
                }),
                getParameter: (param) => param === "total" ? 3 : null
            };

            controller.onUpdateFinished(oEvent);
            const viewModel = controller.getView().getModel("salesInquiriesView");
            expect(viewModel.getProperty("/totalCount")).toBe(3);
            expect(viewModel.getProperty("/openCount")).toBe(2);
            expect(viewModel.getProperty("/customerCount")).toBe(2);
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
