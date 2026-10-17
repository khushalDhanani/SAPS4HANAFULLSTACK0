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
    createSalesOrder: jest.fn().mockResolvedValue("5000465")
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

    test("onSave submits valid order and displays success dialog", async () => {
        controller.onInit();
        const oModel = mockView.getModel("newOrder");
        oModel.setProperty("/header/SalesOrderType", "ZDOM");
        oModel.setProperty("/header/SalesOrganization", "1000");
        oModel.setProperty("/header/DistributionChannel", "10");
        oModel.setProperty("/header/OrganizationDivision", "52");
        oModel.setProperty("/header/TransactionCurrency", "INR");
        oModel.setProperty("/header/SoldToParty", "10135");
        oModel.setProperty("/header/PurchaseOrderNumber", "PO-AUTO-01");
        oModel.setProperty("/header/PaymentTerms", "0001");
        oModel.setProperty("/header/ContactPerson", "25116");
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

    test("onSave treats a read-back mismatch as created: warns with the order number and resets the form", async () => {
        controller.onInit();
        const oModel = mockView.getModel("newOrder");
        oModel.setProperty("/header/SalesOrderType", "ZDOM");
        oModel.setProperty("/header/SalesOrganization", "1000");
        oModel.setProperty("/header/DistributionChannel", "10");
        oModel.setProperty("/header/OrganizationDivision", "52");
        oModel.setProperty("/header/TransactionCurrency", "INR");
        oModel.setProperty("/header/SoldToParty", "10135");
        oModel.setProperty("/header/PaymentTerms", "PT11");
        oModel.setProperty("/header/ContactPerson", "25116");
        oModel.setProperty("/items/0/Material", "4000000001");
        oModel.setProperty("/items/0/Plant", "1120");
        oModel.setProperty("/items/0/OrderQuantity", "5.000");
        oModel.setProperty("/items/0/OrderQuantityUnit", "KG");

        const oErr = new Error("Sales Order 5000999 created, but read-back verification failed: Payment Terms expected 'PT11' but found 'PT01'");
        oErr.code = "SALES_ORDER_CREATED_VERIFICATION_FAILED";
        oErr.status = 502;
        mockSalesOrderService.createSalesOrder.mockRejectedValueOnce(oErr);

        controller.onSave();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(mockMessageBox.error).not.toHaveBeenCalled();
        expect(mockMessageBox.warning).toHaveBeenCalledWith(
            expect.stringContaining("5000999"),
            expect.objectContaining({ title: "Sales Order Created with Warnings" })
        );

        // Closing the dialog resets the form, so the same order cannot be submitted again.
        const oOptions = mockMessageBox.warning.mock.calls[0][1];
        oOptions.onClose("Close");
        expect(mockView.getModel("newOrder").getProperty("/header/SoldToParty")).toBe("");
        expect(mockRouter.navTo).not.toHaveBeenCalled();
    });

    test("_loadConfigurationAndDefaults loads server defaults and applies to empty fields", async () => {
        controller.onInit();
        mockSalesOrderService.getSalesOrderDefaults.mockResolvedValueOnce({
            SalesOrderType: "ZDOM",
            SalesOrganization: "1000",
            DistributionChannel: "10",
            OrganizationDivision: "52",
            TransactionCurrency: "INR",
            Plant: "1120",
            OrderQuantityUnit: "KG"
        });
        mockSalesOrderService.loadConfiguration.mockResolvedValueOnce({
            defaults: { Plant: "1120" }
        });

        await controller._loadConfigurationAndDefaults();

        const oModel = mockView.getModel("newOrder");
        expect(mockSalesOrderService.getSalesOrderDefaults).toHaveBeenCalled();
        expect(oModel.getProperty("/header/SalesOrderType")).toBe("ZDOM");
        expect(oModel.getProperty("/header/SalesOrganization")).toBe("1000");
        expect(oModel.getProperty("/items/0/Plant")).toBe("1120");
    });

    test("onSoldToPartyChange sets error state and displays warning dialog when customer is not maintained for sales area", async () => {
        controller.onInit();
        const oModel = mockView.getModel("newOrder");
        oModel.setProperty("/header/SalesOrganization", "1000");
        oModel.setProperty("/header/DistributionChannel", "10");
        oModel.setProperty("/header/OrganizationDivision", "52");
        oModel.setProperty("/header/SoldToParty", "10629");

        mockSalesOrderService.getCustomerDefaults.mockResolvedValueOnce({
            Customer: "10629",
            CustomerName: "SUN PHARMACEUTICAL INDUSTRIES LTD.",
            validForSalesArea: false,
            maintainedSalesAreasSummary: "1000 10 00",
            salesAreaError: "Sold-to party 10629 not maintained for sales area 1000 10 52"
        });

        controller.onSoldToPartyChange();
        await Promise.resolve();
        await Promise.resolve();

        expect(mockSalesOrderService.getCustomerDefaults).toHaveBeenCalledWith("10629", "1000", "10", "52");
        expect(oModel.getProperty("/errors/SoldToParty/state")).toBe("Error");
        expect(oModel.getProperty("/errors/SoldToParty/text")).toContain("10629");
        expect(mockMessageBox.warning).toHaveBeenCalledWith(
            expect.stringContaining("Sold-to party 10629"),
            expect.objectContaining({ title: "Customer Sales Area Mismatch" })
        );
    });

    test("onSoldToPartyChange clears error state and applies payment terms when customer is valid for sales area", async () => {
        controller.onInit();
        const oModel = mockView.getModel("newOrder");
        oModel.setProperty("/header/SalesOrganization", "1000");
        oModel.setProperty("/header/DistributionChannel", "10");
        oModel.setProperty("/header/OrganizationDivision", "52");
        oModel.setProperty("/header/SoldToParty", "10135");

        mockSalesOrderService.getCustomerDefaults.mockResolvedValueOnce({
            Customer: "10135",
            CustomerName: "Divis Laboratories Limited",
            validForSalesArea: true,
            PaymentTerms: "PT01"
        });

        controller.onSoldToPartyChange();
        await Promise.resolve();
        await Promise.resolve();

        expect(mockSalesOrderService.getCustomerDefaults).toHaveBeenCalledWith("10135", "1000", "10", "52");
        expect(oModel.getProperty("/errors/SoldToParty/state")).toBe("None");
        expect(oModel.getProperty("/header/PaymentTerms")).toBe("PT01");
    });
});
