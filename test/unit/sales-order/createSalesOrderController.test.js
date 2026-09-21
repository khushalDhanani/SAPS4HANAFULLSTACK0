/**
 * Unit Tests for Create Sales Order Controller
 * (CreateSalesOrder.controller.js)
 */

let ControllerClass;
let SalesOrderModel;

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

const mockMessageBox = {
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
    confirm: jest.fn(),
    information: jest.fn(),
    Action: { OK: "OK" }
};

const mockMessageToast = {
    show: jest.fn()
};

class MockMessagePopover {
    constructor(config) {
        this.config = config || {};
        this._model = null;
        this._open = false;
    }
    setModel(model) {
        this._model = model;
    }
    getModel() {
        return this._model;
    }
    openBy(btn) {
        this._open = true;
        this._anchor = btn;
    }
    close() {
        this._open = false;
    }
    isOpen() {
        return this._open;
    }
    destroy() {
        this._open = false;
    }
}

class MockMessageItem {
    constructor(config) {
        this.config = config;
    }
}

const mockBusyIndicator = {
    show: jest.fn(),
    hide: jest.fn()
};

class MockFilter {
    constructor(path, op, val) {
        this.path = path;
        this.op = op;
        this.val = val;
    }
}

const MockFilterOperator = {
    EQ: "EQ",
    Contains: "Contains"
};

const mockValueHelpService = {
    applySuggestionFilter: jest.fn(),
    openValueHelp: jest.fn()
};

const mockSalesOrderService = {
    loadConfiguration: jest.fn().mockResolvedValue({}),
    getCustomerDefaults: jest.fn().mockResolvedValue(null),
    getSalesOrderDefaults: jest.fn().mockResolvedValue(null),
    getMaterialDetails: jest.fn().mockResolvedValue(null),
    getMaterialUnit: jest.fn().mockResolvedValue(null),
    createSalesOrder: jest.fn().mockResolvedValue("5000465"),
    checkATP: jest.fn().mockResolvedValue({
        RequestedQty: 10,
        ConfirmedQty: 10,
        ReqDlvDate: "2026-10-01",
        CnfDlvDate: "2026-10-01",
        SalesUnit: "KG"
    })
};

const MockBaseController = {
    prototype: {
        onNavBack: jest.fn()
    },
    extend: (name, proto) => {
        function Controller() {
            this.onNavBack = jest.fn();
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
    global.sap = {
        ui: {
            define: jest.fn((deps, factory) => {
                if (deps.length === 1 && deps[0] === "sap/ui/model/json/JSONModel") {
                    SalesOrderModel = factory(MockJSONModel);
                } else {
                    ControllerClass = factory(
                        MockBaseController,
                        MockJSONModel,
                        mockMessageBox,
                        mockMessageToast,
                        MockMessagePopover,
                        MockMessageItem,
                        mockBusyIndicator,
                        MockFilter,
                        MockFilterOperator,
                        SalesOrderModel,
                        mockValueHelpService,
                        mockSalesOrderService
                    );
                }
            })
        }
    };

    require("../../../app/fiori-app/webapp/modules/sd/sales-order/model/SalesOrderModel");
    require("../../../app/fiori-app/webapp/modules/sd/sales-order/controller/CreateSalesOrder.controller");
});

describe("CreateSalesOrder Controller", () => {
    let controller;
    let mockView;

    beforeEach(() => {
        jest.clearAllMocks();
        controller = new ControllerClass();

        const models = {};
        mockView = {
            setModel: jest.fn((m, name) => {
                models[name] = m;
            }),
            getModel: jest.fn((name) => models[name]),
            addDependent: jest.fn()
        };

        controller.getView = jest.fn().mockReturnValue(mockView);
        controller.getOwnerComponent = jest.fn().mockReturnValue({
            getRouter: () => mockRouter,
            getModel: (name) => {
                if (name === "auth") {
                    return new MockJSONModel({ user: { username: "sales_rep" } });
                }
                return null;
            }
        });
        controller.byId = jest.fn().mockReturnValue(null);
    });

    test("onInit sets up initial newOrder model and attaches route matched", () => {
        controller.onInit();
        expect(mockView.setModel).toHaveBeenCalledWith(expect.any(MockJSONModel), "newOrder");
        expect(mockRouter.getRoute).toHaveBeenCalledWith("createSalesOrder");
    });

    test("onAddItem appends a new item to the order items array", () => {
        controller.onInit();
        const oModel = mockView.getModel("newOrder");
        const initialCount = oModel.getProperty("/items").length;

        controller.onAddItem();
        const newCount = oModel.getProperty("/items").length;
        expect(newCount).toBe(initialCount + 1);

        const items = oModel.getProperty("/items");
        expect(items[items.length - 1].SalesOrderItem).toBe("20");
    });

    test("onDeleteItem removes an item but preserves minimum one item", () => {
        controller.onInit();
        const oModel = mockView.getModel("newOrder");

        // Attempt deleting when only 1 item exists
        const mockDeleteEvent = {
            getParameter: () => ({
                getBindingContext: () => ({ getPath: () => "/items/0" })
            })
        };
        controller.onDeleteItem(mockDeleteEvent);
        expect(mockMessageToast.show).toHaveBeenCalledWith("An order requires at least one line item.");
        expect(oModel.getProperty("/items")).toHaveLength(1);

        // Add an item then delete
        controller.onAddItem();
        expect(oModel.getProperty("/items")).toHaveLength(2);

        controller.onDeleteItem(mockDeleteEvent);
        expect(oModel.getProperty("/items")).toHaveLength(1);
    });

    test("onCheckAvailability with draft notice when no document number exists", () => {
        controller.onInit();
        const oModel = mockView.getModel("newOrder");
        oModel.setProperty("/items/0/Material", "4000000001");

        controller.onCheckAvailability();
        expect(mockMessageBox.information).toHaveBeenCalledWith(
            expect.stringContaining("ATP Availability Check"),
            expect.objectContaining({ title: "Check Availability" })
        );
    });

    test("onCheckAvailability calls SalesOrderService.checkATP when numeric document ID is provided", async () => {
        controller.onInit();
        const oModel = mockView.getModel("newOrder");
        oModel.setProperty("/items/0/Material", "4000000001");
        oModel.setProperty("/header/PurchaseOrderNumber", "1000529");

        controller.onCheckAvailability();
        expect(mockSalesOrderService.checkATP).toHaveBeenCalledWith("1000529", "10");
    });

    test("onSave submits valid order and displays success dialog", async () => {
        controller.onInit();
        const oModel = mockView.getModel("newOrder");
        oModel.setProperty("/header/SoldToParty", "10135");
        oModel.setProperty("/header/PurchaseOrderNumber", "PO-AUTO-01");
        oModel.setProperty("/items/0/Material", "4000000001");
        oModel.setProperty("/items/0/Plant", "1120");
        oModel.setProperty("/items/0/OrderQuantity", "5.000");
        oModel.setProperty("/items/0/OrderQuantityUnit", "KG");

        controller.onSave();

        // Allow promise microtask to resolve
        await Promise.resolve();
        await Promise.resolve();

        expect(mockSalesOrderService.createSalesOrder).toHaveBeenCalled();
        expect(mockMessageBox.success).toHaveBeenCalledWith(
            expect.stringContaining("5000465"),
            expect.objectContaining({ title: "Sales Order Created" })
        );
    });
});
