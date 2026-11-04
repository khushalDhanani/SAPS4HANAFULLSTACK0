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
    warning: jest.fn(),
    confirm: jest.fn((msg, opts) => {
        if (opts && opts.onClose) opts.onClose("OK");
    }),
    Action: { OK: "OK", CANCEL: "CANCEL" }
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
    postGoodsIssue: jest.fn().mockResolvedValue({ DeliveryDocument: "13000526" }),
    createBillingDocument: jest.fn().mockResolvedValue({ BillingDocument: "90000001", Messages: [] }),
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
            getBinding: jest.fn().mockReturnValue(mockBinding),
            setGrowingScrollToLoad: jest.fn()
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

    test("onInit attaches _onRouteMatched to the ordersDueForDelivery route", () => {
        controller.onInit();

        expect(mockRouter.getRoute).toHaveBeenCalledWith("ordersDueForDelivery");
        expect(mockRoute.attachPatternMatched).toHaveBeenCalledWith(controller._onRouteMatched, controller);
    });

    test("onInit starts on the ready tab with every KPI at '-' and no plant", () => {
        controller.onInit();

        expect(mockView.getModel("ordersDueView").getData()).toMatchObject({
            totalCount: "-",
            readyCount: "-",
            inApprovalCount: "-",
            shippingPointCount: "-",
            distinctOrdersCount: "-",
            readyOrdersCount: "-",
            inApprovalOrdersCount: "-",
            displayCount: "-",
            selectedTab: "ready",
            plant: ""
        });
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

    test("a failed metrics reload replaces the loaded figures with '-' (never stale, never 0)", async () => {
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
        await flush();
        const viewModel = mockView.getModel("ordersDueView");
        expect(viewModel.getProperty("/totalCount")).toBe(57);

        MockOutboundDeliveryService.getOrdersDueMetrics.mockRejectedValueOnce(new Error("502"));
        controller.onRefresh();
        await flush();

        expect(viewModel.getProperty("/totalCount")).toBe("-");
        expect(viewModel.getProperty("/readyCount")).toBe("-");
        expect(viewModel.getProperty("/inApprovalCount")).toBe("-");
        expect(viewModel.getProperty("/shippingPointCount")).toBe("-");
        expect(viewModel.getProperty("/distinctOrdersCount")).toBe("-");
        expect(viewModel.getProperty("/readyOrdersCount")).toBe("-");
        expect(viewModel.getProperty("/inApprovalOrdersCount")).toBe("-");
        expect(viewModel.getProperty("/displayCount")).toBe("-");
    });

    const selectTab = (key) => controller.onTabSelect({ getParameter: (p) => (p === "key" ? key : null) });
    const PLANT_1120 = { config: "Plant", operator: "EQ", value: "1120" };

    test("onTabSelect filters the ready tab on the plant and IsDeliverable", async () => {
        controller.onInit();
        await flush();
        mockBinding.filter.mockClear();

        selectTab("ready");

        expect(mockBinding.filter).toHaveBeenCalledTimes(1);
        expect(mockBinding.filter).toHaveBeenCalledWith(
            [PLANT_1120, { config: "IsDeliverable", operator: "EQ", value: true }],
            MockFilterType.Application
        );
    });

    test("onTabSelect filters the inApproval tab on the plant and SalesDocApprovalStatus A", async () => {
        controller.onInit();
        await flush();
        mockBinding.filter.mockClear();

        selectTab("inApproval");

        expect(mockBinding.filter).toHaveBeenCalledWith(
            [PLANT_1120, { config: "SalesDocApprovalStatus", operator: "EQ", value: "A" }],
            MockFilterType.Application
        );
    });

    test("onTabSelect keeps only the plant filter for the all tab", async () => {
        controller.onInit();
        await flush();
        mockBinding.filter.mockClear();

        selectTab("all");

        expect(mockBinding.filter).toHaveBeenCalledWith([PLANT_1120], MockFilterType.Application);
    });

    test.each([["ready", 42], ["inApproval", 12], ["all", 57]])("onTabSelect shows the %s figure (%s) as displayCount", async (key, expected) => {
        MockOutboundDeliveryService.getOrdersDueMetrics.mockResolvedValueOnce({
            scheduleLineCount: 57,
            readyToDeliverCount: 42,
            inApprovalCount: 12,
            shippingPointCount: 3
        });
        controller.onInit();
        await flush();
        const viewModel = mockView.getModel("ordersDueView");
        viewModel.setProperty("/displayCount", "stale");

        selectTab(key);

        expect(viewModel.getProperty("/selectedTab")).toBe(key);
        expect(viewModel.getProperty("/displayCount")).toBe(expected);
    });

    test("onSearch adds an OR group over SalesOrder, ShipToParty and ShippingPoint to the tab filter", async () => {
        controller.onInit();
        await flush();
        mockBinding.filter.mockClear();
        const mockSearchField = { getValue: () => " 5000 " };
        controller.byId = jest.fn((id) => {
            if (id === "ordersDueTable") return mockTable;
            if (id === "searchOrdersDue") return mockSearchField;
            return null;
        });

        controller.onSearch();

        expect(mockBinding.filter).toHaveBeenCalledWith(
            [
                PLANT_1120,
                { config: "IsDeliverable", operator: "EQ", value: true },
                {
                    config: {
                        filters: [
                            { config: "SalesOrder", operator: "Contains", value: "5000" },
                            { config: "ShipToParty", operator: "Contains", value: "5000" },
                            { config: "ShippingPoint", operator: "Contains", value: "5000" }
                        ],
                        and: false
                    }
                }
            ],
            MockFilterType.Application
        );
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

    test("onConfirmCreateDelivery sends the dialog values, closes the dialog and shows the delivery number returned", async () => {
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

    test.each([[""], ["   "]])("onConfirmCreateDelivery rejects a blank shipping point (%j) without calling the service", (shippingPoint) => {
        controller.onInit();
        const dialogModel = mockView.getModel("deliveryDialog");
        dialogModel.setProperty("/salesOrder", "5000104");
        dialogModel.setProperty("/shippingPoint", shippingPoint);

        controller.onConfirmCreateDelivery();

        expect(dialogModel.getProperty("/shippingPointValueState")).toBe("Error");
        expect(MockMessageBox.error).toHaveBeenCalledWith(expect.stringContaining("Shipping Point is required"));
        expect(MockOutboundDeliveryService.createOutboundDelivery).not.toHaveBeenCalled();
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
        test("onOpenCreateDeliveryNoRefDialog clears values left over from the last use", () => {
            controller.onInit();
            const dialogModel = mockView.getModel("deliveryNoRefDialog");
            dialogModel.setProperty("/salesOrg", "1000");
            dialogModel.setProperty("/distChannel", "14");
            dialogModel.setProperty("/division", "00");
            dialogModel.setProperty("/busy", true);
            dialogModel.setProperty("/items", [{ itemNo: "000010" }, { itemNo: "000020" }, { itemNo: "000030" }]);
            controller._pCreateDeliveryNoRefDialog = Promise.resolve({ open: jest.fn() });

            controller.onOpenCreateDeliveryNoRefDialog();

            // No guessed sales area: the server posts these values as typed.
            expect(dialogModel.getProperty("/salesOrg")).toBe("");
            expect(dialogModel.getProperty("/distChannel")).toBe("");
            expect(dialogModel.getProperty("/division")).toBe("");
            expect(dialogModel.getProperty("/busy")).toBe(false);
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
        });

        test("onDeleteDeliveryNoRefItem deletes the line item of the pressed row", () => {
            controller.onInit();
            controller.onAddDeliveryNoRefItem();
            const dialogModel = mockView.getModel("deliveryNoRefDialog");
            expect(dialogModel.getProperty("/items")).toHaveLength(2);

            const mockEvent = {
                getSource: () => ({
                    getBindingContext: () => ({
                        getPath: () => "/items/0"
                    })
                })
            };

            controller.onDeleteDeliveryNoRefItem(mockEvent);
            expect(dialogModel.getProperty("/items").map((item) => item.itemNo)).toEqual(["000020"]);
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
            expect(mockTable.setGrowingScrollToLoad).toHaveBeenCalledWith(true);
            expect(mockBinding.resume.mock.invocationCallOrder[0]).toBeLessThan(mockTable.setGrowingScrollToLoad.mock.invocationCallOrder[0]);
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
            expect(mockTable.setGrowingScrollToLoad).not.toHaveBeenCalled();
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

    describe("_text fills message arguments", () => {
        test("uses the default text with {0} replaced when no i18n bundle is available", () => {
            expect(controller._text("missingKey", "Sales Order {0} has a delivery block ({1}).", ["5000287", "Z1"]))
                .toBe("Sales Order 5000287 has a delivery block (Z1).");
        });

        test("passes the arguments to the i18n bundle", () => {
            const getText = jest.fn().mockReturnValue("from bundle");
            controller.getOwnerComponent = () => ({ getModel: () => ({ getResourceBundle: () => ({ hasText: () => true, getText }) }) });
            expect(controller._text("msgOrderRejected", "x", ["5000287"])).toBe("from bundle");
            expect(getText).toHaveBeenCalledWith("msgOrderRejected", ["5000287"]);
        });
    });

    describe("billing is offered only for billing status A or B", () => {
        test.each([["A", true], ["B", true], ["C", false], ["", false]])("billing status '%s' -> canBill %s", async (status, expected) => {
            controller.onInit();
            await flush();
            MockOutboundDeliveryService.getDeliveryStatus.mockResolvedValueOnce({
                DeliveryDocument: "80000085", DeliveryDocumentType: "ZLF", SoldToParty: "10135",
                OverallPickingStatus: "C", OverallGoodsMovementStatus: "C", OverallDelivReltdBillgStatus: status
            });
            const fu = mockView.getModel("deliveryFollowUp");
            fu.setProperty("/delivery", "80000085");
            controller.byId = jest.fn((id) => (id === "ordersDueTable" ? mockTable : null));
            await controller.onLoadDeliveryStatus();
            await flush();
            expect(fu.getProperty("/canBill")).toBe(expected);
        });
    });

    describe("Optimistic concurrency and ETag handling (Phase 4)", () => {
        // Controller behaviour only: the real status response has no ETag today (OutboundDeliveryAdapter.js:564-575,
        // service.cds getDeliveryStatus), so this path is not reachable from a real read. See the audit ask file.
        test("onLoadDeliveryStatus keeps an @odata.etag if the status response carries one", async () => {
            controller.onInit();
            await flush();
            MockOutboundDeliveryService.getDeliveryStatus.mockResolvedValueOnce({
                DeliveryDocument: "80000085",
                DeliveryDocumentType: "ZLF",
                SoldToParty: "10135",
                OverallPickingStatus: "C",
                OverallGoodsMovementStatus: "A",
                OverallDelivReltdBillgStatus: "A",
                "@odata.etag": 'W/"20261028120000"'
            });
            const fu = mockView.getModel("deliveryFollowUp");
            fu.setProperty("/delivery", "80000085");
            controller.byId = jest.fn((id) => (id === "ordersDueTable" ? mockTable : null));
            await controller.onLoadDeliveryStatus();
            await flush();

            expect(fu.getProperty("/etag")).toBe('W/"20261028120000"');
        });

        test.each([
            ["C", "A", true],
            ["C", "C", false],
            ["A", "A", false]
        ])("picking %s and goods movement %s -> canPgi %s", async (picking, movement, expected) => {
            controller.onInit();
            await flush();
            MockOutboundDeliveryService.getDeliveryStatus.mockResolvedValueOnce({
                DeliveryDocument: "80000085",
                DeliveryDocumentType: "ZLF",
                SoldToParty: "10135",
                OverallPickingStatus: picking,
                OverallGoodsMovementStatus: movement,
                OverallDelivReltdBillgStatus: "A"
            });
            const fu = mockView.getModel("deliveryFollowUp");
            fu.setProperty("/delivery", "80000085");
            await controller.onLoadDeliveryStatus();
            await flush();

            expect(fu.getProperty("/canPgi")).toBe(expected);
        });

        test("onPostGoodsIssue passes ETag to service and catches 409 STALE_DATA with reload guidance", async () => {
            controller.onInit();
            await flush();
            const fu = mockView.getModel("deliveryFollowUp");
            fu.setProperty("/delivery", "80000085");
            fu.setProperty("/etag", 'W/"20261028120000"');

            const staleErr = new Error("Document changed by another user");
            staleErr.status = 409;
            staleErr.code = "STALE_DATA";
            MockOutboundDeliveryService.postGoodsIssue.mockRejectedValueOnce(staleErr);

            let onCloseAction;
            MockMessageBox.confirm.mockImplementationOnce((msg, opts) => {
                opts.onClose(MockMessageBox.Action.OK);
            });
            MockMessageBox.error.mockImplementationOnce((msg, opts) => {
                if (opts && opts.onClose) onCloseAction = opts.onClose;
            });

            controller.onPostGoodsIssue();
            await flush();

            expect(MockOutboundDeliveryService.postGoodsIssue).toHaveBeenCalledWith("80000085", { etag: 'W/"20261028120000"' });
            expect(MockMessageBox.error).toHaveBeenCalledWith(
                expect.stringContaining("reload the latest delivery data from SAP"),
                expect.objectContaining({ title: expect.any(String) })
            );

            // Closing the error dialog reloads delivery status
            jest.spyOn(controller, "onLoadDeliveryStatus");
            if (onCloseAction) onCloseAction();
            expect(controller.onLoadDeliveryStatus).toHaveBeenCalled();
        });

        test("onCreateBillingDocument passes ETag to service and catches 409 STALE_DATA with reload guidance", async () => {
            controller.onInit();
            await flush();
            const fu = mockView.getModel("deliveryFollowUp");
            fu.setProperty("/delivery", "80000085");
            fu.setProperty("/billingType", "F2");
            fu.setProperty("/etag", 'W/"20261028120000"');

            const staleErr = new Error("Precondition failed in S/4HANA");
            staleErr.status = 409;
            staleErr.code = "STALE_DATA";
            MockOutboundDeliveryService.createBillingDocument.mockRejectedValueOnce(staleErr);

            let onCloseAction;
            MockMessageBox.confirm.mockImplementationOnce((msg, opts) => {
                opts.onClose(MockMessageBox.Action.OK);
            });
            MockMessageBox.error.mockImplementationOnce((msg, opts) => {
                if (opts && opts.onClose) onCloseAction = opts.onClose;
            });

            controller.onCreateBillingDocument();
            await flush();

            expect(MockOutboundDeliveryService.createBillingDocument).toHaveBeenCalledWith(
                expect.objectContaining({ delivery: "80000085", billingType: "F2" }),
                { etag: 'W/"20261028120000"' }
            );
            expect(MockMessageBox.error).toHaveBeenCalledWith(
                expect.stringContaining("reload the latest delivery data from SAP"),
                expect.objectContaining({ title: expect.any(String) })
            );

            jest.spyOn(controller, "onLoadDeliveryStatus");
            if (onCloseAction) onCloseAction();
            expect(controller.onLoadDeliveryStatus).toHaveBeenCalled();
        });
    });
});
