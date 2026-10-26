/**
 * Unit Tests for OrdersDueForDelivery Controller
 * (OrdersDueForDelivery.controller.js)
 */

let ControllerClass;
const flush = () => new Promise((resolve) => setImmediate(resolve));

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
    constructor(config, operator, value) {
        this.config = config;
        this.operator = operator;
        this.value = value;
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
        getContentDensityClass: () => "sapUiSizeCompact",
        byId: function (id) {
            return this.getView ? this.getView().byId(id) : null;
        }
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
    createOutboundDelivery: jest.fn().mockResolvedValue("13000526"),
    createDeliveryWithoutRef: jest.fn().mockResolvedValue({ OutboundDelivery: "80000059" }),
    getDeliveryStatus: jest.fn().mockResolvedValue({ DeliveryDocument: "13000526", DeliveryDocumentType: "ZLF", SoldToParty: "10082", OverallPickingStatus: "A", OverallGoodsMovementStatus: "A", OverallDelivReltdBillgStatus: "A" }),
    getPlantContext: jest.fn().mockResolvedValue({ plants: ["1120"], unrestricted: false }),
    getOrdersDueMetrics: jest.fn().mockResolvedValue({
        scheduleLineCount: 0,
        readyToDeliverCount: 0,
        inApprovalCount: 0,
        shippingPointCount: 0,
        distinctOrdersCount: 0,
        readyOrdersCount: 0,
        inApprovalOrdersCount: 0
    })
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
            filter: jest.fn(),
            isSuspended: jest.fn().mockReturnValue(true),
            resume: jest.fn(() => { mockBinding.isSuspended.mockReturnValue(false); })
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
            addDependent: jest.fn(),
            byId: jest.fn((id) => (id === "ordersDueTable" ? mockTable : null))
        };

        controller.getView = jest.fn().mockReturnValue(mockView);
        controller.byId = jest.fn((id) => mockView.byId(id));
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

    test("_loadServerMetrics takes KPI counts from getOrdersDueMetrics (full set, not the loaded page)", async () => {
        MockOutboundDeliveryService.getOrdersDueMetrics.mockResolvedValueOnce({
            scheduleLineCount: 57,
            readyToDeliverCount: 42,
            inApprovalCount: 12,
            shippingPointCount: 3,
            distinctOrdersCount: 38,
            readyOrdersCount: 29,
            inApprovalOrdersCount: 8
        });
        controller.onInit();
        await Promise.resolve();
        await Promise.resolve();

        const viewModel = mockView.getModel("ordersDueView");
        expect(MockOutboundDeliveryService.getOrdersDueMetrics).toHaveBeenCalled();
        expect(viewModel.getProperty("/totalCount")).toBe(57);
        expect(viewModel.getProperty("/readyCount")).toBe(42);
        expect(viewModel.getProperty("/inApprovalCount")).toBe(12);
        expect(viewModel.getProperty("/shippingPointCount")).toBe(3);
        expect(viewModel.getProperty("/distinctOrdersCount")).toBe(38);
        expect(viewModel.getProperty("/readyOrdersCount")).toBe(29);
        expect(viewModel.getProperty("/inApprovalOrdersCount")).toBe(8);
        expect(viewModel.getProperty("/displayCount")).toBe(42);
    });

    test("_loadServerMetrics shows '-' (never 0) when the server metrics call fails", async () => {
        MockOutboundDeliveryService.getOrdersDueMetrics.mockRejectedValueOnce(new Error("502"));
        controller.onInit();
        await Promise.resolve();
        await Promise.resolve();

        const viewModel = mockView.getModel("ordersDueView");
        expect(viewModel.getProperty("/totalCount")).toBe("-");
        expect(viewModel.getProperty("/readyCount")).toBe("-");
        expect(viewModel.getProperty("/inApprovalCount")).toBe("-");
        expect(viewModel.getProperty("/shippingPointCount")).toBe("-");
        expect(viewModel.getProperty("/distinctOrdersCount")).toBe("-");
        expect(viewModel.getProperty("/readyOrdersCount")).toBe("-");
        expect(viewModel.getProperty("/inApprovalOrdersCount")).toBe("-");
        expect(viewModel.getProperty("/displayCount")).toBe("-");
    });

    test("onTabSelect applies IsDeliverable filter for ready tab and updates displayCount", () => {
        controller.onInit();
        controller.byId = jest.fn((id) => (id === "ordersDueTable" ? mockTable : null));

        controller.onTabSelect({ getParameter: (p) => (p === "key" ? "ready" : null) });
        expect(mockBinding.filter).toHaveBeenCalledWith(expect.any(Array), MockFilterType.Application);
        const viewModel = mockView.getModel("ordersDueView");
        expect(viewModel.getProperty("/selectedTab")).toBe("ready");
    });

    test("onTabSelect applies SalesDocApprovalStatus filter for inApproval tab", () => {
        controller.onInit();
        controller.byId = jest.fn((id) => (id === "ordersDueTable" ? mockTable : null));

        controller.onTabSelect({ getParameter: (p) => (p === "key" ? "inApproval" : null) });
        expect(mockBinding.filter).toHaveBeenCalledWith(expect.any(Array), MockFilterType.Application);
        const viewModel = mockView.getModel("ordersDueView");
        expect(viewModel.getProperty("/selectedTab")).toBe("inApproval");
    });

    test("onTabSelect removes approval filter for all tab", () => {
        controller.onInit();
        controller.byId = jest.fn((id) => (id === "ordersDueTable" ? mockTable : null));

        controller.onTabSelect({ getParameter: (p) => (p === "key" ? "all" : null) });
        expect(mockBinding.filter).toHaveBeenCalledWith([], MockFilterType.Application);
        const viewModel = mockView.getModel("ordersDueView");
        expect(viewModel.getProperty("/selectedTab")).toBe("all");
    });

    test("onSearch applies filter on table items combining tab filter and search query", () => {
        controller.onInit();
        const mockSearchField = { getValue: () => "1120" };
        controller.byId = jest.fn((id) => {
            if (id === "ordersDueTable") return mockTable;
            if (id === "searchOrdersDue") return mockSearchField;
            return null;
        });

        controller.onSearch();
        expect(mockBinding.filter).toHaveBeenCalledWith(expect.any(Array), MockFilterType.Application);
    });

    test("onRefresh refreshes table items binding and reloads server metrics", async () => {
        controller.onInit();
        await flush();
        MockOutboundDeliveryService.getOrdersDueMetrics.mockClear();
        controller.byId = jest.fn((id) => (id === "ordersDueTable" ? mockTable : null));
        controller.onRefresh();
        expect(mockBinding.refresh).toHaveBeenCalled();
        expect(MockOutboundDeliveryService.getOrdersDueMetrics).toHaveBeenCalled();
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

    describe("Delivery Without Reference Dialog & Actions", () => {
        test("onOpenCreateDeliveryNoRefDialog resets model to defaults", () => {
            controller.onInit();
            const dialogModel = mockView.getModel("deliveryNoRefDialog");
            dialogModel.setProperty("/shippingPoint", "9999");
            controller._pCreateDeliveryNoRefDialog = Promise.resolve({ open: jest.fn() });

            controller.onOpenCreateDeliveryNoRefDialog();

            expect(dialogModel.getProperty("/shippingPoint")).toBe("1104");
            expect(dialogModel.getProperty("/deliveryType")).toBe("LO2");
            expect(dialogModel.getProperty("/plant")).toBe("1110");
            expect(dialogModel.getProperty("/storageLocation")).toBe("FG01");
            expect(dialogModel.getProperty("/shipToParty")).toBe("10135");
            expect(dialogModel.getProperty("/items")).toHaveLength(1);
        });

        test("onAddDeliveryNoRefItem adds a new line item with incremented item number", () => {
            controller.onInit();
            const dialogModel = mockView.getModel("deliveryNoRefDialog");
            expect(dialogModel.getProperty("/items")).toHaveLength(1);

            controller.onAddDeliveryNoRefItem();

            const items = dialogModel.getProperty("/items");
            expect(items).toHaveLength(2);
            expect(items[1].itemNo).toBe("000020");
            expect(items[1].material).toBe("4000000187");
        });

        test("onDeleteDeliveryNoRefItem deletes line item when more than one exists", () => {
            controller.onInit();
            controller.onAddDeliveryNoRefItem();
            const dialogModel = mockView.getModel("deliveryNoRefDialog");
            expect(dialogModel.getProperty("/items")).toHaveLength(2);

            const mockEvent = {
                getSource: () => ({
                    getBindingContext: () => ({
                        getPath: () => "/items/1"
                    })
                })
            };

            controller.onDeleteDeliveryNoRefItem(mockEvent);
            expect(dialogModel.getProperty("/items")).toHaveLength(1);
        });

        test("onDeleteDeliveryNoRefItem warns and prevents deletion if only one item remains", () => {
            controller.onInit();
            const mockEvent = {
                getSource: () => ({
                    getBindingContext: () => ({
                        getPath: () => "/items/0"
                    })
                })
            };

            controller.onDeleteDeliveryNoRefItem(mockEvent);
            expect(MockMessageBox.warning).toHaveBeenCalledWith(expect.stringContaining("At least one line item is required"));
            expect(mockView.getModel("deliveryNoRefDialog").getProperty("/items")).toHaveLength(1);
        });

        test("onConfirmCreateDeliveryNoRef validates required fields", () => {
            controller.onInit();
            const dialogModel = mockView.getModel("deliveryNoRefDialog");
            dialogModel.setProperty("/shippingPoint", "");

            controller.onConfirmCreateDeliveryNoRef();
            expect(MockMessageBox.error).toHaveBeenCalled();
            expect(MockOutboundDeliveryService.createDeliveryWithoutRef).not.toHaveBeenCalled();
        });

        test("onConfirmCreateDeliveryNoRef creates delivery and updates follow-up panel", async () => {
            controller.onInit();
            controller.onCancelCreateDeliveryNoRef = jest.fn();
            controller.onRefresh = jest.fn();
            controller.onLoadDeliveryStatus = jest.fn();

            MockOutboundDeliveryService.createDeliveryWithoutRef.mockResolvedValueOnce({ OutboundDelivery: "80000059" });

            await controller.onConfirmCreateDeliveryNoRef();

            expect(MockOutboundDeliveryService.createDeliveryWithoutRef).toHaveBeenCalledWith(expect.objectContaining({
                shippingPoint: "1104",
                deliveryType: "LO2",
                plant: "1110",
                storageLocation: "FG01",
                shipToParty: "10135"
            }));
            expect(controller.onCancelCreateDeliveryNoRef).toHaveBeenCalled();
            expect(mockView.getModel("deliveryFollowUp").getProperty("/delivery")).toBe("80000059");
            expect(controller.onLoadDeliveryStatus).toHaveBeenCalled();
            expect(MockMessageBox.success).toHaveBeenCalledWith(
                expect.stringContaining("80000059"),
                expect.any(Object)
            );
        });
    });

    describe("plant selector (the server fails closed without a plant)", () => {
        const plantFilter = () => {
            const aFilters = mockBinding.filter.mock.calls.length ? mockBinding.filter.mock.calls.slice(-1)[0][0] : [];
            return aFilters.find((f) => f.config === "Plant");
        };

        test("pre-selects the user's plant, filters by it, then resumes the table and loads metrics for it", async () => {
            MockOutboundDeliveryService.getPlantContext.mockResolvedValueOnce({ plants: ["1120"], unrestricted: false });
            controller.onInit();
            await flush();
            const vm = mockView.getModel("ordersDueView");
            expect(vm.getProperty("/plant")).toBe("1120");
            expect(plantFilter()).toMatchObject({ operator: "EQ", value: "1120" });
            expect(mockBinding.resume).toHaveBeenCalledTimes(1);
            expect(mockBinding.filter.mock.invocationCallOrder[0]).toBeLessThan(mockBinding.resume.mock.invocationCallOrder[0]);
            expect(MockOutboundDeliveryService.getOrdersDueMetrics).toHaveBeenCalledWith("1120");
            expect(vm.getProperty("/plantValueState")).toBe("None");
        });

        test("without a Plant attribute the plant is required and nothing is requested", async () => {
            MockOutboundDeliveryService.getPlantContext.mockResolvedValueOnce({ plants: [], unrestricted: true });
            controller.onInit();
            await flush();
            const vm = mockView.getModel("ordersDueView");
            expect(vm.getProperty("/plantValueState")).toBe("Error");
            expect(vm.getProperty("/plantValueStateText")).toMatch(/plant/i);
            expect(mockBinding.resume).not.toHaveBeenCalled();
            expect(MockOutboundDeliveryService.getOrdersDueMetrics).not.toHaveBeenCalled();
        });

        test("an entered plant is normalized, filtered on, and loads the worklist", async () => {
            MockOutboundDeliveryService.getPlantContext.mockResolvedValueOnce({ plants: [], unrestricted: true });
            controller.onInit();
            await flush();
            const vm = mockView.getModel("ordersDueView");
            vm.setProperty("/plant", " 1110 ");
            controller.onPlantChange();
            expect(vm.getProperty("/plant")).toBe("1110");
            expect(plantFilter()).toMatchObject({ value: "1110" });
            expect(mockBinding.resume).toHaveBeenCalledTimes(1);
            expect(MockOutboundDeliveryService.getOrdersDueMetrics).toHaveBeenCalledWith("1110");
            expect(vm.getProperty("/plantValueState")).toBe("None");
        });

        test("clearing the plant again shows the required state and requests nothing new", async () => {
            controller.onInit();
            await flush();
            MockOutboundDeliveryService.getOrdersDueMetrics.mockClear();
            const vm = mockView.getModel("ordersDueView");
            vm.setProperty("/plant", "");
            controller.onPlantChange();
            expect(vm.getProperty("/plantValueState")).toBe("Error");
            expect(MockOutboundDeliveryService.getOrdersDueMetrics).not.toHaveBeenCalled();
        });

        test("a failed plant lookup leaves the table suspended and shows why", async () => {
            MockOutboundDeliveryService.getPlantContext.mockRejectedValueOnce(new Error("HTTP 403"));
            controller.onInit();
            await flush();
            const vm = mockView.getModel("ordersDueView");
            expect(vm.getProperty("/plantValueState")).toBe("Error");
            expect(vm.getProperty("/plantValueStateText")).toContain("HTTP 403");
            expect(mockBinding.resume).not.toHaveBeenCalled();
        });

        test("a plant outside a restricted user's scope is refused without a request and the loaded plant is kept", async () => {
            MockOutboundDeliveryService.getPlantContext.mockResolvedValueOnce({ plants: ["1120"], unrestricted: false });
            controller.onInit();
            await flush();
            mockBinding.filter.mockClear();
            MockOutboundDeliveryService.getOrdersDueMetrics.mockClear();
            const vm = mockView.getModel("ordersDueView");
            vm.setProperty("/plant", "1110");
            controller.onPlantChange();
            expect(vm.getProperty("/plant")).toBe("1120");
            expect(vm.getProperty("/plantValueState")).toBe("Error");
            expect(vm.getProperty("/plantValueStateText")).toContain("1110");
            expect(mockBinding.filter).not.toHaveBeenCalled();
            expect(MockOutboundDeliveryService.getOrdersDueMetrics).not.toHaveBeenCalled();
        });

        test("an unrestricted user may choose any plant (the server decides)", async () => {
            MockOutboundDeliveryService.getPlantContext.mockResolvedValueOnce({ plants: [], unrestricted: true });
            controller.onInit();
            await flush();
            const vm = mockView.getModel("ordersDueView");
            vm.setProperty("/plant", "1110");
            controller.onPlantChange();
            expect(vm.getProperty("/plant")).toBe("1110");
            expect(MockOutboundDeliveryService.getOrdersDueMetrics).toHaveBeenCalledWith("1110");
        });

        test("onRefresh without a plant asks for one instead of refreshing", async () => {
            MockOutboundDeliveryService.getPlantContext.mockResolvedValueOnce({ plants: [], unrestricted: true });
            controller.onInit();
            await flush();
            controller.onRefresh();
            expect(mockBinding.refresh).not.toHaveBeenCalled();
            expect(MockOutboundDeliveryService.getOrdersDueMetrics).not.toHaveBeenCalled();
        });
    });
});
