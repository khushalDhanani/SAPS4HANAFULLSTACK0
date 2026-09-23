/**
 * Unit Tests for CustomerInvoices Controller
 * (CustomerInvoices.controller.js)
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
    EQ: "EQ",
    NE: "NE"
};

const MockMessageBox = {
    confirm: jest.fn((msg, opts) => {
        if (opts && opts.onClose) opts.onClose("OK");
    }),
    success: jest.fn((msg, opts) => {
        if (opts && opts.onClose) opts.onClose();
    }),
    error: jest.fn()
};

const MockMessageToast = {
    show: jest.fn()
};

const MockCustomerInvoiceService = {
    setModel: jest.fn(),
    getModel: jest.fn(),
    getInvoices: jest.fn().mockResolvedValue([]),
    getMetrics: jest.fn().mockResolvedValue({
        totalInvoices: 10,
        pendingAccountingCount: 3,
        transferredCount: 6,
        cancelledCount: 1
    }),
    releaseInvoiceToAccounting: jest.fn().mockResolvedValue({
        BillingDocument: "31000111",
        AccountingDocument: "9000000100",
        FiscalYear: "2026",
        Success: true
    }),
    cancelBillingDocument: jest.fn().mockResolvedValue({
        BillingDocument: "31000112",
        CancellationDocument: "90000053",
        Success: true
    })
};

const MockBaseController = {
    extend: function (name, proto) {
        function Controller() {
            Object.assign(this, proto);
        }
        Controller.prototype = proto;
        return Controller;
    }
};

const MockFragment = {
    load: jest.fn().mockImplementation(() => {
        return Promise.resolve({
            setModel: jest.fn(),
            getModel: jest.fn().mockReturnValue(new MockJSONModel({ BillingDocument: "31000112" })),
            open: jest.fn(),
            close: jest.fn()
        });
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
                    MockFragment,
                    MockMessageBox,
                    MockMessageToast,
                    MockCustomerInvoiceService
                );
            }
        }
    };
    require("../../../app/fiori-app/webapp/modules/sd/customer-invoice/controller/CustomerInvoices.controller");
});

describe("CustomerInvoices Controller", () => {
    let controller;
    let mockView;
    let mockRouter;
    let mockRoute;
    let mockTable;
    let mockBinding;
    let models;

    beforeEach(() => {
        jest.clearAllMocks();
        models = {};

        mockBinding = {
            filter: jest.fn(),
            refresh: jest.fn(),
            getLength: jest.fn().mockReturnValue(5),
            attachEventOnce: jest.fn((event, fn) => {
                if (event === "dataReceived") fn();
            })
        };

        mockTable = {
            getBinding: jest.fn().mockReturnValue(mockBinding)
        };

        mockRoute = {
            attachPatternMatched: jest.fn()
        };

        mockRouter = {
            getRoute: jest.fn().mockReturnValue(mockRoute)
        };

        mockView = {
            setModel: jest.fn((model, name) => {
                models[name || ""] = model;
            }),
            getModel: jest.fn((name) => models[name || ""]),
            byId: jest.fn((id) => {
                if (id === "tblCustomerInvoices") return mockTable;
                return null;
            }),
            getId: jest.fn(() => "mockCustomerInvoicesView"),
            addDependent: jest.fn()
        };

        // ResourceBundle
        const mockResourceBundle = {
            getText: jest.fn((key, args) => {
                if (args && args.length) return key + " " + args.join(" ");
                return key;
            })
        };
        models["i18n"] = {
            getResourceBundle: () => mockResourceBundle
        };

        controller = new ControllerClass();
        controller.getView = () => mockView;
        controller.byId = (id) => mockView.byId(id);
        controller.getOwnerComponent = () => ({
            getRouter: () => mockRouter
        });
    });

    test("onInit sets up customerInvoicesView model and attaches route matched", () => {
        controller.onInit();
        expect(mockView.setModel).toHaveBeenCalled();
        const viewModel = models["customerInvoicesView"];
        expect(viewModel).toBeDefined();
        expect(viewModel.getProperty("/selectedTab")).toBe("all");
        expect(viewModel.getProperty("/totalInvoices")).toBe(0);
        expect(mockRoute.attachPatternMatched).toHaveBeenCalled();
    });

    test("_onRouteMatched loads metrics and applies filters", async () => {
        controller.onInit();
        await controller._onRouteMatched();

        expect(MockCustomerInvoiceService.getMetrics).toHaveBeenCalled();
        const viewModel = models["customerInvoicesView"];
        expect(viewModel.getProperty("/totalInvoices")).toBe(10);
        expect(viewModel.getProperty("/pendingAccountingCount")).toBe(3);
        expect(viewModel.getProperty("/transferredCount")).toBe(6);
        expect(mockBinding.filter).toHaveBeenCalled();
    });

    test("onTabSelect updates selectedTab and refilters", () => {
        controller.onInit();
        const oEvent = {
            getParameter: jest.fn().mockReturnValue("pending"),
            getSource: jest.fn()
        };
        controller.onTabSelect(oEvent);

        const viewModel = models["customerInvoicesView"];
        expect(viewModel.getProperty("/selectedTab")).toBe("pending");
        expect(mockBinding.filter).toHaveBeenCalled();
    });

    test("onSearch updates searchQuery and refilters", () => {
        controller.onInit();
        const oEvent = {
            getParameter: jest.fn().mockReturnValue("31000111"),
            getSource: jest.fn()
        };
        controller.onSearch(oEvent);

        const viewModel = models["customerInvoicesView"];
        expect(viewModel.getProperty("/searchQuery")).toBe("31000111");
        expect(mockBinding.filter).toHaveBeenCalled();
    });

    test("onReleaseToAccountingPress prompts confirmation and calls service", async () => {
        controller.onInit();
        const oEvent = {
            getSource: () => ({
                getBindingContext: () => ({
                    getObject: () => ({ BillingDocument: "31000111" })
                })
            })
        };

        controller.onReleaseToAccountingPress(oEvent);

        expect(MockMessageBox.confirm).toHaveBeenCalled();
        expect(MockCustomerInvoiceService.releaseInvoiceToAccounting).toHaveBeenCalledWith(
            "31000111",
            undefined
        );
    });

    test("onCancelInvoicePress opens dialog and onConfirmCancelInvoice calls service", async () => {
        controller.onInit();
        const oEvent = {
            getSource: () => ({
                getBindingContext: () => ({
                    getObject: () => ({ BillingDocument: "31000112", SoldToPartyFullName: "Test" })
                })
            })
        };

        controller.onCancelInvoicePress(oEvent);
        await controller._pCancelDialog;
        expect(controller._oCancelDialog.open).toHaveBeenCalled();

        await controller.onConfirmCancelInvoice();
        expect(MockCustomerInvoiceService.cancelBillingDocument).toHaveBeenCalledWith(
            "31000112",
            undefined
        );
        expect(MockMessageBox.success).toHaveBeenCalled();
    });
});
