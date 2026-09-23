/**
 * Unit Tests for CustomerReturns Controller
 * (CustomerReturns.controller.js)
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
    setData(data) {
        this.data = JSON.parse(JSON.stringify(data || {}));
    }
}

class MockFilter {
    constructor(configOrPath, op, val) {
        if (typeof configOrPath === "object") {
            this.config = configOrPath;
        } else {
            this.sPath = configOrPath;
            this.sOperator = op;
            this.oValue1 = val;
        }
    }
}

const MockFilterOperator = {
    Contains: "Contains",
    EQ: "EQ",
    NE: "NE"
};

const MockMessageBox = {
    success: jest.fn((msg, opts) => {
        if (opts && opts.onClose) opts.onClose();
    }),
    error: jest.fn()
};

const MockMessageToast = {
    show: jest.fn()
};

const MockSelectDialog = function (opts) {
    this.opts = opts;
    this.open = jest.fn();
    this.close = jest.fn();
    this.setBusy = jest.fn();
    this.setModel = jest.fn();
    this.getModel = jest.fn();
    this.bindAggregation = jest.fn();
};

const MockStandardListItem = function (id, opts) {
    this.id = id;
    this.opts = opts;
    this.addCustomData = jest.fn();
};

const MockCustomData = function (opts) {
    this.opts = opts;
};

const MockAuthService = {
    syncModelHeaders: jest.fn()
};

const MockCustomerReturnService = {
    setModel: jest.fn(),
    getModel: jest.fn(),
    getCustomerReturns: jest.fn().mockResolvedValue([]),
    getCustomerReturnItems: jest.fn().mockResolvedValue([
        {
            CustomerReturn: "60000000",
            CustomerReturnItem: "000010",
            Material: "4000000001",
            Material_Text: "Finished Good A",
            OrderQuantity: 5,
            OrderQuantityUnit: "KG",
            NetAmount: 1500,
            Currency: "EUR"
        }
    ]),
    getMetrics: jest.fn().mockResolvedValue({
        totalReturns: 179,
        totalNetValue: 54200.50,
        poorQualityCount: 68,
        damagedTransitCount: 31,
        otherReasonsCount: 80
    }),
    getReturnReasons: jest.fn().mockResolvedValue([
        { ReasonCode: "101", ReasonText: "Poor quality" },
        { ReasonCode: "102", ReasonText: "Damaged in transit" }
    ]),
    getReferenceDocuments: jest.fn().mockResolvedValue([
        {
            ReferenceSDDocument: "90000000",
            SDDocumentCategory: "M",
            SoldToParty: "100000"
        }
    ]),
    createCustomerReturn: jest.fn().mockResolvedValue({
        CustomerReturn: "60000001",
        CustomerReturnType: "ZRET",
        SoldToParty: "100000",
        TotalNetAmount: 1500,
        TransactionCurrency: "EUR",
        Success: true,
        Message: "Created successfully in SAP S/4HANA"
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
            getModel: jest.fn(),
            open: jest.fn(),
            close: jest.fn(),
            setBusy: jest.fn()
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
                    MockSelectDialog,
                    MockStandardListItem,
                    MockCustomData,
                    MockAuthService,
                    MockCustomerReturnService
                );
            }
        }
    };
    require("../../../app/fiori-app/webapp/modules/sd/customer-return/controller/CustomerReturns.controller");
});

describe("CustomerReturns Controller", () => {
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
            getLength: jest.fn().mockReturnValue(179)
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
                if (id === "tblCustomerReturns") return mockTable;
                return null;
            }),
            getId: jest.fn(() => "mockCustomerReturnsView"),
            addDependent: jest.fn()
        };

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
        controller.getText = (key, args) => mockResourceBundle.getText(key, args);
        controller.getOwnerComponent = () => ({
            getRouter: () => mockRouter
        });
    });

    // -------------------------------------------------------------------------
    // Formatters
    // -------------------------------------------------------------------------
    describe("Formatters", () => {
        test("formatReasonState returns correct state for reasons", () => {
            expect(controller.formatReasonState("101")).toBe("Warning");
            expect(controller.formatReasonState("102")).toBe("Error");
            expect(controller.formatReasonState("004")).toBe("Information");
            expect(controller.formatReasonState("005")).toBe("Information");
            expect(controller.formatReasonState("999")).toBe("None");
        });

        test("formatReasonIcon returns correct icon for reasons", () => {
            expect(controller.formatReasonIcon("101")).toBe("sap-icon://quality-issue");
            expect(controller.formatReasonIcon("102")).toBe("sap-icon://shipping-status");
            expect(controller.formatReasonIcon("004")).toBe("sap-icon://customer");
            expect(controller.formatReasonIcon("005")).toBe("sap-icon://customer");
            expect(controller.formatReasonIcon("999")).toBe("sap-icon://notes");
        });

        test("formatAmount formats numbers with 2 decimals", () => {
            expect(controller.formatAmount(null)).toBe("0.00");
            expect(controller.formatAmount("")).toBe("0.00");
            expect(controller.formatAmount("1234.5")).toBe("1,234.50");
            expect(controller.formatAmount(500)).toBe("500.00");
        });

        test("formatQuantity formats numbers with 3 decimals", () => {
            expect(controller.formatQuantity(null)).toBe("0.000");
            expect(controller.formatQuantity("")).toBe("0.000");
            expect(controller.formatQuantity("5.5")).toBe("5.500");
            expect(controller.formatQuantity(10)).toBe("10.000");
        });
    });

    // -------------------------------------------------------------------------
    // Initialization & Lifecycle
    // -------------------------------------------------------------------------
    describe("Initialization & Lifecycle", () => {
        test("onInit sets up models, router listener, and loads metrics", () => {
            controller.onInit();
            expect(MockAuthService.syncModelHeaders).toHaveBeenCalled();
            expect(mockView.setModel).toHaveBeenCalled();

            const viewModel = models["customerReturnsView"];
            expect(viewModel).toBeDefined();
            expect(viewModel.getProperty("/selectedTab")).toBe("ALL");
            expect(mockRoute.attachPatternMatched).toHaveBeenCalled();
            expect(MockCustomerReturnService.getMetrics).toHaveBeenCalled();
            expect(MockCustomerReturnService.getReturnReasons).toHaveBeenCalled();
        });

        test("_onRouteMatched refreshes binding and metrics", async () => {
            controller.onInit();
            await controller._onRouteMatched();

            expect(mockBinding.refresh).toHaveBeenCalled();
            expect(MockCustomerReturnService.getMetrics).toHaveBeenCalled();
        });

        test("onRefresh refreshes table, metrics, reasons, and shows MessageToast", async () => {
            controller.onInit();
            controller.onRefresh();

            expect(mockBinding.refresh).toHaveBeenCalled();
            expect(MockCustomerReturnService.getMetrics).toHaveBeenCalled();
            expect(MockMessageToast.show).toHaveBeenCalled();
        });

        test("onUpdateFinished updates totalReturns if not set", () => {
            controller.onInit();
            const oEvent = {
                getSource: () => mockTable
            };
            controller.onUpdateFinished(oEvent);
            const viewModel = models["customerReturnsView"];
            expect(viewModel.getProperty("/totalReturns")).toBe(179);
        });
    });

    // -------------------------------------------------------------------------
    // Filtering & Search
    // -------------------------------------------------------------------------
    describe("Filtering & Search", () => {
        test("onTabSelect updates tab and filters table", () => {
            controller.onInit();
            const oEvent = {
                getParameter: jest.fn().mockReturnValue("101")
            };
            controller.onTabSelect(oEvent);

            const viewModel = models["customerReturnsView"];
            expect(viewModel.getProperty("/selectedTab")).toBe("101");
            expect(mockBinding.filter).toHaveBeenCalled();
        });

        test("onTabSelect with OTHER filters out 101 and 102", () => {
            controller.onInit();
            const oEvent = {
                getParameter: jest.fn().mockReturnValue("OTHER")
            };
            controller.onTabSelect(oEvent);

            const viewModel = models["customerReturnsView"];
            expect(viewModel.getProperty("/selectedTab")).toBe("OTHER");
            expect(mockBinding.filter).toHaveBeenCalled();
        });

        test("onSearch updates search query and filters table", () => {
            controller.onInit();
            const oEvent = {
                getParameter: jest.fn().mockReturnValue("100000")
            };
            controller.onSearch(oEvent);

            const viewModel = models["customerReturnsView"];
            expect(viewModel.getProperty("/searchQuery")).toBe("100000");
            expect(mockBinding.filter).toHaveBeenCalled();
        });
    });

    // -------------------------------------------------------------------------
    // Items Drilldown Dialog
    // -------------------------------------------------------------------------
    describe("Items Drilldown Dialog", () => {
        test("onViewItemsPress loads items for return and opens dialog", async () => {
            controller.onInit();
            const oEvent = {
                getSource: () => ({
                    getBindingContext: () => ({
                        getProperty: (prop) => (prop === "CustomerReturn" ? "60000000" : "")
                    })
                })
            };

            controller.onViewItemsPress(oEvent);
            await controller._pItemsDialog;
            await new Promise((resolve) => setImmediate(resolve));

            expect(MockCustomerReturnService.getCustomerReturnItems).toHaveBeenCalledWith("60000000", undefined);
            const viewModel = models["customerReturnsView"];
            expect(viewModel.getProperty("/selectedReturnNumber")).toBe("60000000");
            expect(viewModel.getProperty("/returnItems").length).toBe(1);
        });

        test("onCloseReturnItemsDialog closes items dialog", async () => {
            controller.onInit();
            const oEvent = {
                getSource: () => ({
                    getBindingContext: () => ({
                        getProperty: () => "60000000"
                    })
                })
            };
            controller.onViewItemsPress(oEvent);
            await controller._pItemsDialog;
            await new Promise((resolve) => setImmediate(resolve));

            controller.onCloseReturnItemsDialog();
            expect(controller._oItemsDialog.close).toHaveBeenCalled();
        });
    });

    // -------------------------------------------------------------------------
    // Create Return Dialog & Actions
    // -------------------------------------------------------------------------
    describe("Create Return Dialog & Actions", () => {
        test("onCreateReturnPress opens create dialog with default data", async () => {
            controller.onInit();
            controller.onCreateReturnPress();
            await controller._pCreateDialog;

            expect(controller._oCreateDialog.open).toHaveBeenCalled();
            const createModel = models["createReturnModel"];
            expect(createModel.getProperty("/CustomerReturnType")).toBe("ZRET");
            expect(createModel.getProperty("/ReturnsOrderReason")).toBe("101");
            expect(createModel.getProperty("/Items").length).toBe(1);
        });

        test("onCancelCreateReturnDialog closes dialog", async () => {
            controller.onInit();
            controller.onCreateReturnPress();
            await controller._pCreateDialog;

            controller.onCancelCreateReturnDialog();
            expect(controller._oCreateDialog.close).toHaveBeenCalled();
        });

        test("onAddReturnItem and onDeleteReturnItem manipulate items list", () => {
            controller.onInit();
            controller.onCreateReturnPress();

            const createModel = models["createReturnModel"];
            expect(createModel.getProperty("/Items").length).toBe(1);

            controller.onAddReturnItem();
            expect(createModel.getProperty("/Items").length).toBe(2);
            expect(createModel.getProperty("/Items")[1].ItemIndex).toBe(2);

            controller.onDeleteReturnItem();
            expect(createModel.getProperty("/Items").length).toBe(1);

            // Should not delete below 1
            controller.onDeleteReturnItem();
            expect(createModel.getProperty("/Items").length).toBe(1);
        });

        test("onReferenceDocChange updates ReferenceSDDocument on all items", () => {
            controller.onInit();
            controller.onCreateReturnPress();

            const oEvent = {
                getParameter: jest.fn().mockReturnValue("90000050")
            };
            controller.onReferenceDocChange(oEvent);

            const createModel = models["createReturnModel"];
            expect(createModel.getProperty("/Items")[0].ReferenceSDDocument).toBe("90000050");
        });

        test("onConfirmCreateReturn rejects when SoldToParty is missing", () => {
            controller.onInit();
            controller.onCreateReturnPress();

            const createModel = models["createReturnModel"];
            createModel.setProperty("/SoldToParty", "");

            controller.onConfirmCreateReturn();
            expect(MockMessageBox.error).toHaveBeenCalled();
            expect(MockCustomerReturnService.createCustomerReturn).not.toHaveBeenCalled();
        });

        test("onConfirmCreateReturn rejects when Material is missing", () => {
            controller.onInit();
            controller.onCreateReturnPress();

            const createModel = models["createReturnModel"];
            createModel.setProperty("/SoldToParty", "100000");
            createModel.setProperty("/Items", [{ Material: "" }]);

            controller.onConfirmCreateReturn();
            expect(MockMessageBox.error).toHaveBeenCalled();
            expect(MockCustomerReturnService.createCustomerReturn).not.toHaveBeenCalled();
        });

        test("onConfirmCreateReturn calls service, closes dialog, and shows success", async () => {
            controller.onInit();
            controller.onCreateReturnPress();
            await controller._pCreateDialog;

            const createModel = models["createReturnModel"];
            createModel.setProperty("/SoldToParty", "100000");
            createModel.setProperty("/ReturnsOrderReason", "101");
            createModel.setProperty("/ReferenceSDDocument", "90000000");
            createModel.setProperty("/Items", [
                {
                    Material: "4000000001",
                    OrderQuantity: "2.000",
                    OrderQuantityUnit: "KG",
                    ProductionPlant: "1110",
                    StorageLocation: "FG01"
                }
            ]);

            controller.onConfirmCreateReturn();
            await Promise.resolve();
            await Promise.resolve();

            expect(MockCustomerReturnService.createCustomerReturn).toHaveBeenCalled();
            expect(controller._oCreateDialog.close).toHaveBeenCalled();
            expect(MockMessageBox.success).toHaveBeenCalled();
        });

        test("onConfirmCreateReturn handles service failure with MessageBox.error", async () => {
            controller.onInit();
            controller.onCreateReturnPress();
            await controller._pCreateDialog;

            MockCustomerReturnService.createCustomerReturn.mockRejectedValueOnce(new Error("SAP Backend Error 500"));

            const createModel = models["createReturnModel"];
            createModel.setProperty("/SoldToParty", "100000");
            createModel.setProperty("/ReturnsOrderReason", "101");
            createModel.setProperty("/Items", [{ Material: "4000000001", OrderQuantity: "1" }]);

            controller.onConfirmCreateReturn();
            await Promise.resolve();
            await Promise.resolve();

            expect(MockMessageBox.error).toHaveBeenCalled();
        });
    });
});
