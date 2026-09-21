/**
 * Unit Tests for Sales Orders Controller
 * (SalesOrders.controller.js)
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
    extend: function (name, proto) {
        function Controller() {
            Object.assign(this, MockBaseController.prototype, proto);
        }
        return Controller;
    }
};

const MockMessageBox = {
    error: jest.fn(),
    success: jest.fn(),
    warning: jest.fn()
};

const MockAuthService = {
    syncModelHeaders: jest.fn(),
    canCreateDelivery: jest.fn().mockReturnValue(true)
};

const MockODataClient = {
    get: jest.fn().mockImplementation((url) => {
        if (url.indexOf("getSalesOrderMetrics") !== -1) {
            return Promise.resolve({ openOrdersCount: 42, totalOrdersCount: 150 });
        }
        if (url.indexOf("getDashboardMetrics") !== -1) {
            return Promise.resolve({ customerCount: 88 });
        }
        return Promise.resolve({});
    })
};

const MockOutboundDeliveryService = {
    getShippingPoints: jest.fn().mockResolvedValue([
        { ShippingPoint: "1120", ShippingPointName: "1130-FG Loading Area" },
        { ShippingPoint: "1112", ShippingPointName: "Packaging Area 1112" }
    ]),
    getDefaultShippingPoint: jest.fn().mockResolvedValue({
        ShippingPoint: "1120",
        ShippingPoints: ["1120", "1112", "1108", "1109"]
    }),
    createOutboundDelivery: jest.fn().mockResolvedValue("13000526")
};

beforeAll(() => {
    global.sap = {
        ui: {
            define: function (deps, factory) {
                ControllerClass = factory(
                    MockBaseController,
                    MockJSONModel,
                    MockFilter,
                    MockFilterOperator,
                    MockFilterType,
                    {}, // Fragment
                    MockMessageBox,
                    MockAuthService,
                    MockODataClient,
                    MockOutboundDeliveryService
                );
            }
        }
    };
    require("../../../app/fiori-app/webapp/modules/sd/sales-order/controller/SalesOrders.controller");
});

describe("SalesOrders Controller", () => {
    let controller;
    let mockView;
    let mockRouter;
    let mockRoute;
    let mockTable;
    let mockBinding;

    beforeEach(() => {
        controller = new ControllerClass();

        mockRoute = {
            attachPatternMatched: jest.fn()
        };

        mockRouter = {
            getRoute: jest.fn().mockReturnValue(mockRoute),
            navTo: jest.fn()
        };

        mockBinding = {
            refresh: jest.fn(),
            filter: jest.fn()
        };

        mockTable = {
            getBinding: jest.fn().mockReturnValue(mockBinding)
        };

        const models = {};
        mockView = {
            setModel: jest.fn((m, name) => {
                models[name] = m;
            }),
            getModel: jest.fn((name) => models[name])
        };

        controller.getView = jest.fn().mockReturnValue(mockView);
        controller.getOwnerComponent = jest.fn().mockReturnValue({
            getRouter: () => mockRouter
        });
        controller.byId = jest.fn((id) => {
            if (id === "salesOrdersTable") return mockTable;
            return null;
        });
    });

    test("onInit sets up salesOrdersView model with '-' initial KPIs and attaches pattern matched", async () => {
        controller.onInit();
        const viewModel = mockView.getModel("salesOrdersView");
        expect(viewModel.getProperty("/totalCount")).toBe("-");
        expect(viewModel.getProperty("/openCount")).toBe("-");
        expect(viewModel.getProperty("/customerCount")).toBe("-");
        expect(mockRouter.getRoute).toHaveBeenCalledWith("salesOrders");
        expect(mockRoute.attachPatternMatched).toHaveBeenCalledWith(controller._onRouteMatched, controller);

        // Wait for async metrics load
        await new Promise(process.nextTick);
        expect(viewModel.getProperty("/openCount")).toBe(42);
        expect(viewModel.getProperty("/customerCount")).toBe(88);
    });

    test("formatter translates OverallSDProcessStatus to human labels and semantic states", () => {
        expect(controller.formatter.statusText("A")).toBe("Open");
        expect(controller.formatter.statusText("B")).toBe("In Process");
        expect(controller.formatter.statusText("C")).toBe("Completed");

        expect(controller.formatter.statusState("A")).toBe("Information");
        expect(controller.formatter.statusState("B")).toBe("Warning");
        expect(controller.formatter.statusState("C")).toBe("Success");
    });

    test("onUpdateFinished updates totalCount from binding $count parameter without scraping loaded rows", () => {
        controller.onInit();

        const mockEvent = {
            getSource: () => ({}),
            getParameter: (param) => {
                if (param === "total") return 3;
                return null;
            }
        };

        controller.onUpdateFinished(mockEvent);

        const viewModel = mockView.getModel("salesOrdersView");
        expect(viewModel.getProperty("/totalCount")).toBe(3);
    });

    test("onUpdateFinished sets totalCount to '-' when $count parameter is absent", () => {
        controller.onInit();

        const mockEvent = {
            getSource: () => ({}),
            getParameter: () => null
        };

        controller.onUpdateFinished(mockEvent);

        const viewModel = mockView.getModel("salesOrdersView");
        expect(viewModel.getProperty("/totalCount")).toBe("-");
    });

    test("_loadServerMetrics handles server errors by setting '-'", async () => {
        controller.onInit();
        MockODataClient.get.mockRejectedValueOnce(new Error("502 Gateway Error"));
        MockODataClient.get.mockRejectedValueOnce(new Error("502 Gateway Error"));

        await controller._loadServerMetrics();

        const viewModel = mockView.getModel("salesOrdersView");
        expect(viewModel.getProperty("/openCount")).toBe("-");
        expect(viewModel.getProperty("/customerCount")).toBe("-");
    });

    test("onNavigateToCreateSalesOrder navigates to createSalesOrder route", () => {
        controller.onNavigateToCreateSalesOrder();
        expect(mockRouter.navTo).toHaveBeenCalledWith("createSalesOrder");
    });

    test("onSearch applies filter on table items", () => {
        controller.byId = jest.fn((id) => {
            if (id === "salesOrdersTable") return mockTable;
            return null;
        });

        const mockEvent = {
            getParameter: (param) => (param === "query" ? "10135" : "")
        };

        controller.onSearch(mockEvent);
        expect(mockBinding.filter).toHaveBeenCalledWith(expect.any(Array), MockFilterType.Application);
    });

    test("onRefresh refreshes table items binding", () => {
        controller.onRefresh();
        expect(mockBinding.refresh).toHaveBeenCalled();
    });

    test("onCreateDeliveryPress populates deliveryDialog model with selected order", () => {
        controller.onInit();
        controller._openCreateDeliveryDialog = jest.fn();

        const mockEvent = {
            getSource: () => ({
                getBindingContext: (modelName) => {
                    if (modelName === "salesOrder") {
                        return {
                            getProperty: (prop) => {
                                if (prop === "SalesOrder") return "5000104";
                                if (prop === "ShippingPoint") return "1120";
                                return null;
                            }
                        };
                    }
                    return null;
                }
            })
        };

        controller.onCreateDeliveryPress(mockEvent);

        const dialogModel = mockView.getModel("deliveryDialog");
        expect(dialogModel.getProperty("/salesOrder")).toBe("5000104");
        expect(dialogModel.getProperty("/shippingPoint")).toBe("1120");
        expect(dialogModel.getProperty("/deliveryDate")).toBeDefined();
        expect(controller._openCreateDeliveryDialog).toHaveBeenCalled();
    });

    test("onCreateDeliveryPress warns and blocks when order is in approval (A)", () => {
        controller.onInit();
        controller._openCreateDeliveryDialog = jest.fn();

        const mockEvent = {
            getSource: () => ({
                getBindingContext: (modelName) => {
                    if (modelName === "salesOrder") {
                        return {
                            getProperty: (prop) => {
                                if (prop === "SalesOrder") return "5000461";
                                if (prop === "SalesDocApprovalStatus") return "A";
                                return null;
                            }
                        };
                    }
                    return null;
                }
            })
        };

        controller.onCreateDeliveryPress(mockEvent);
        expect(MockMessageBox.warning).toHaveBeenCalledWith(expect.stringContaining("in approval"));
        expect(controller._openCreateDeliveryDialog).not.toHaveBeenCalled();
    });

    test("onCreateDeliveryPress warns and blocks when order is rejected (C)", () => {
        controller.onInit();
        controller._openCreateDeliveryDialog = jest.fn();

        const mockEvent = {
            getSource: () => ({
                getBindingContext: (modelName) => {
                    if (modelName === "salesOrder") {
                        return {
                            getProperty: (prop) => {
                                if (prop === "SalesOrder") return "5000013";
                                if (prop === "SalesDocApprovalStatus") return "C";
                                return null;
                            }
                        };
                    }
                    return null;
                }
            })
        };

        controller.onCreateDeliveryPress(mockEvent);
        expect(MockMessageBox.warning).toHaveBeenCalledWith(expect.stringContaining("rejected"));
        expect(controller._openCreateDeliveryDialog).not.toHaveBeenCalled();
    });

    test("onCreateDeliveryPress warns and blocks when order is being reworked (D)", () => {
        controller.onInit();
        controller._openCreateDeliveryDialog = jest.fn();

        const mockEvent = {
            getSource: () => ({
                getBindingContext: (modelName) => {
                    if (modelName === "salesOrder") {
                        return {
                            getProperty: (prop) => {
                                if (prop === "SalesOrder") return "5000400";
                                if (prop === "SalesDocApprovalStatus") return "D";
                                return null;
                            }
                        };
                    }
                    return null;
                }
            })
        };

        controller.onCreateDeliveryPress(mockEvent);
        expect(MockMessageBox.warning).toHaveBeenCalledWith(expect.stringContaining("reworked"));
        expect(controller._openCreateDeliveryDialog).not.toHaveBeenCalled();
    });

    test("onCreateDeliveryPress warns and blocks when order has delivery block", () => {
        controller.onInit();
        controller._openCreateDeliveryDialog = jest.fn();

        const mockEvent = {
            getSource: () => ({
                getBindingContext: (modelName) => {
                    if (modelName === "salesOrder") {
                        return {
                            getProperty: (prop) => {
                                if (prop === "SalesOrder") return "5000104";
                                if (prop === "DeliveryBlockReason") return "01";
                                return null;
                            }
                        };
                    }
                    return null;
                }
            })
        };

        controller.onCreateDeliveryPress(mockEvent);
        expect(MockMessageBox.warning).toHaveBeenCalledWith(expect.stringContaining("delivery block"));
        expect(controller._openCreateDeliveryDialog).not.toHaveBeenCalled();
    });

    test("onCancelCreateDelivery closes the dialog if loaded", () => {
        const mockDialog = { close: jest.fn() };
        controller._pCreateDeliveryDialog = Promise.resolve(mockDialog);
        controller.onCancelCreateDelivery();
        return controller._pCreateDeliveryDialog.then(() => {
            expect(mockDialog.close).toHaveBeenCalled();
        });
    });

    test("onConfirmCreateDelivery validates and creates outbound delivery", async () => {
        controller.onInit();
        const dialogModel = mockView.getModel("deliveryDialog");
        dialogModel.setProperty("/salesOrder", "5000104");
        dialogModel.setProperty("/shippingPoint", "1120");
        dialogModel.setProperty("/deliveryDate", "2026-09-20");

        controller.onCancelCreateDelivery = jest.fn();
        controller.onRefresh = jest.fn();
        controller._setDialogBusy = jest.fn();

        await controller.onConfirmCreateDelivery();

        expect(MockOutboundDeliveryService.createOutboundDelivery).toHaveBeenCalledWith({
            salesOrder: "5000104",
            shippingPoint: "1120",
            deliveryDate: "2026-09-20"
        });
        expect(controller.onCancelCreateDelivery).toHaveBeenCalled();
        expect(MockMessageBox.success).toHaveBeenCalledWith(
            expect.stringContaining("13000526"),
            expect.any(Object)
        );
    });

    test("onConfirmCreateDelivery shows warning to check VL03N when no delivery number returned", async () => {
        controller.onInit();
        const dialogModel = mockView.getModel("deliveryDialog");
        dialogModel.setProperty("/salesOrder", "5000104");
        dialogModel.setProperty("/shippingPoint", "1120");
        dialogModel.setProperty("/deliveryDate", "2026-09-20");

        MockOutboundDeliveryService.createOutboundDelivery.mockResolvedValueOnce("");
        controller.onCancelCreateDelivery = jest.fn();
        controller.onRefresh = jest.fn();
        controller._setDialogBusy = jest.fn();

        await controller.onConfirmCreateDelivery();

        expect(controller.onCancelCreateDelivery).toHaveBeenCalled();
        expect(MockMessageBox.warning).toHaveBeenCalledWith(
            expect.stringContaining("VL03N"),
            expect.any(Object)
        );
    });
});
