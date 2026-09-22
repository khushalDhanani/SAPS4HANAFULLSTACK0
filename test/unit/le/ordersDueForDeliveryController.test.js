/**
 * Unit Tests for OrdersDueForDelivery Controller
 * (OrdersDueForDelivery.controller.js)
 */

let ControllerClass;

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
        getContentDensityClass: () => "sapUiSizeCompact"
    },
    extend: function (name, proto) {
        function Controller() {
            Object.assign(this, proto);
        }
        Controller.prototype = proto;
        return Controller;
    }
};

const MockMessageBox = {
    error: jest.fn(),
    success: jest.fn(),
    warning: jest.fn()
};

const MockAuthService = {
    syncModelHeaders: jest.fn()
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
                    MockOutboundDeliveryService
                );
            }
        }
    };
    require("../../../app/fiori-app/webapp/modules/le/outbound-delivery/controller/OrdersDueForDelivery.controller");
});

describe("OrdersDueForDelivery Controller", () => {
    let controller;
    let mockView;
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
            getModel: jest.fn((name) => models[name]),
            getId: jest.fn().mockReturnValue("testOrdersDueView"),
            addDependent: jest.fn()
        };

        controller.getView = jest.fn().mockReturnValue(mockView);
        controller.getOwnerComponent = jest.fn().mockReturnValue({
            getRouter: () => mockRouter,
            getModel: () => null
        });
    });

    test("onInit sets up view models and attaches route pattern matched", () => {
        controller.onInit();

        expect(mockView.setModel).toHaveBeenCalledWith(expect.any(MockJSONModel), "ordersDueView");
        expect(mockView.setModel).toHaveBeenCalledWith(expect.any(MockJSONModel), "deliveryDialog");
        expect(mockRouter.getRoute).toHaveBeenCalledWith("ordersDueForDelivery");
        expect(mockRoute.attachPatternMatched).toHaveBeenCalled();
    });

    test("onUpdateFinished updates KPI counts for total and unique shipping points", () => {
        controller.onInit();

        const mockItems = [
            {
                getBindingContext: () => ({
                    getProperty: (p) => (p === "ShippingPoint" ? "1120" : null)
                })
            },
            {
                getBindingContext: () => ({
                    getProperty: (p) => (p === "ShippingPoint" ? "1112" : null)
                })
            },
            {
                getBindingContext: () => ({
                    getProperty: (p) => (p === "ShippingPoint" ? "1120" : null)
                })
            }
        ];

        const mockEvent = {
            getSource: () => ({
                getItems: () => mockItems
            }),
            getParameter: (p) => (p === "total" ? 3 : null)
        };

        controller.onUpdateFinished(mockEvent);

        const viewModel = mockView.getModel("ordersDueView");
        expect(viewModel.getProperty("/totalCount")).toBe(3);
        expect(viewModel.getProperty("/shippingPointCount")).toBe(2);
    });

    test("onSearch applies filter on table items", () => {
        controller.byId = jest.fn((id) => (id === "ordersDueTable" ? mockTable : null));

        const mockEvent = {
            getParameter: (p) => (p === "query" ? "1120" : "")
        };

        controller.onSearch(mockEvent);
        expect(mockBinding.filter).toHaveBeenCalledWith(expect.any(Array), MockFilterType.Application);
    });

    test("onRefresh refreshes table items binding", () => {
        controller.byId = jest.fn((id) => (id === "ordersDueTable" ? mockTable : null));
        controller.onRefresh();
        expect(mockBinding.refresh).toHaveBeenCalled();
    });

    test("onCreateDeliveryPress extracts row properties and opens dialog", () => {
        controller.onInit();
        controller._openCreateDeliveryDialog = jest.fn();

        const mockEvent = {
            getSource: () => ({
                getBindingContext: () => ({
                    getProperty: (p) => {
                        if (p === "SalesOrder") return "5000104";
                        if (p === "ShippingPoint") return "1120";
                        if (p === "GoodsIssueDate") return "2026-09-20";
                        return null;
                    }
                })
            })
        };

        controller.onCreateDeliveryPress(mockEvent);

        const dialogModel = mockView.getModel("deliveryDialog");
        expect(dialogModel.getProperty("/salesOrder")).toBe("5000104");
        expect(dialogModel.getProperty("/shippingPoint")).toBe("1120");
        expect(dialogModel.getProperty("/deliveryDate")).toBe("2026-09-20");
        expect(controller._openCreateDeliveryDialog).toHaveBeenCalled();
    });

    test("_loadShippingPoints loads authentic shipping points from getShippingPoints without hardcoded table", async () => {
        MockOutboundDeliveryService.getShippingPoints.mockResolvedValueOnce([
            { ShippingPoint: "1120", ShippingPointName: "1130-FG Loading Area" },
            { ShippingPoint: "1112", ShippingPointName: "Packaging Area 1112" }
        ]);

        controller.onInit();
        await Promise.resolve(); // wait for getShippingPoints promise

        const dialogModel = mockView.getModel("deliveryDialog");
        const aPoints = dialogModel.getProperty("/shippingPoints");
        expect(MockOutboundDeliveryService.getShippingPoints).toHaveBeenCalled();
        expect(aPoints).toEqual([
            { key: "1120", text: "1120 - 1130-FG Loading Area", name: "1130-FG Loading Area" },
            { key: "1112", text: "1112 - Packaging Area 1112", name: "Packaging Area 1112" }
        ]);
    });

    test("onCreateDeliveryPress leaves shippingPoint empty when row has no ShippingPoint", () => {
        controller.onInit();
        controller._openCreateDeliveryDialog = jest.fn();

        const mockEvent = {
            getSource: () => ({
                getBindingContext: () => ({
                    getProperty: (p) => {
                        if (p === "SalesOrder") return "5000105";
                        if (p === "ShippingPoint") return "";
                        return null;
                    }
                })
            })
        };

        controller.onCreateDeliveryPress(mockEvent);

        const dialogModel = mockView.getModel("deliveryDialog");
        expect(dialogModel.getProperty("/shippingPoint")).toBe("");
        expect(controller._openCreateDeliveryDialog).toHaveBeenCalled();
    });

    test("onCreateDeliveryPress warns and blocks when order approval status is unknown", () => {
        controller.onInit();
        controller._openCreateDeliveryDialog = jest.fn();

        const mockEvent = {
            getSource: () => ({
                getBindingContext: () => ({
                    getProperty: (p) => {
                        if (p === "SalesOrder") return "5000104";
                        if (p === "SalesDocApprovalStatus") return "unknown";
                        return null;
                    }
                })
            })
        };

        controller.onCreateDeliveryPress(mockEvent);
        expect(MockMessageBox.warning).toHaveBeenCalledWith(expect.stringContaining("could not be verified"));
        expect(controller._openCreateDeliveryDialog).not.toHaveBeenCalled();
    });

    test("onCreateDeliveryPress warns and blocks when order is in approval (A)", () => {
        controller.onInit();
        controller._openCreateDeliveryDialog = jest.fn();

        const mockEvent = {
            getSource: () => ({
                getBindingContext: () => ({
                    getProperty: (p) => {
                        if (p === "SalesOrder") return "5000461";
                        if (p === "SalesDocApprovalStatus") return "A";
                        return null;
                    }
                })
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
                getBindingContext: () => ({
                    getProperty: (p) => {
                        if (p === "SalesOrder") return "5000013";
                        if (p === "SalesDocApprovalStatus") return "C";
                        return null;
                    }
                })
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
                getBindingContext: () => ({
                    getProperty: (p) => {
                        if (p === "SalesOrder") return "5000400";
                        if (p === "SalesDocApprovalStatus") return "D";
                        return null;
                    }
                })
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
                getBindingContext: () => ({
                    getProperty: (p) => {
                        if (p === "SalesOrder") return "5000104";
                        if (p === "DelivBlockReasonForSchedLine") return "01";
                        return null;
                    }
                })
            })
        };

        controller.onCreateDeliveryPress(mockEvent);
        expect(MockMessageBox.warning).toHaveBeenCalledWith(expect.stringContaining("delivery block"));
        expect(controller._openCreateDeliveryDialog).not.toHaveBeenCalled();
    });

    test("onCancelCreateDelivery closes dialog", () => {
        const mockDialog = { close: jest.fn() };
        controller._pCreateDeliveryDialog = Promise.resolve(mockDialog);
        controller.onCancelCreateDelivery();
        return controller._pCreateDeliveryDialog.then(() => {
            expect(mockDialog.close).toHaveBeenCalled();
        });
    });

    test("onConfirmCreateDelivery validates required fields and creates delivery", async () => {
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

    test("onConfirmCreateDelivery rejects when sales order is missing", () => {
        controller.onInit();
        const dialogModel = mockView.getModel("deliveryDialog");
        dialogModel.setProperty("/salesOrder", "");

        controller.onConfirmCreateDelivery();
        expect(MockMessageBox.error).toHaveBeenCalledWith(expect.stringContaining("Sales Order is required"));
        expect(MockOutboundDeliveryService.createOutboundDelivery).not.toHaveBeenCalled();
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
