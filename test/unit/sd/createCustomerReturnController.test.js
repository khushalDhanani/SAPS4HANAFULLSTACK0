let ControllerClass;

class MockJSONModel {
    constructor(data) {
        this._data = JSON.parse(JSON.stringify(data || {}));
    }
    getData() {
        return this._data;
    }
    setData(data) {
        this._data = JSON.parse(JSON.stringify(data || {}));
    }
    getProperty(path) {
        if (!path || path === "/") return this._data;
        const parts = path.replace(/^\//, "").split("/");
        let curr = this._data;
        for (const p of parts) {
            if (curr == null) return undefined;
            curr = curr[p];
        }
        return curr;
    }
    setProperty(path, val) {
        const parts = path.replace(/^\//, "").split("/");
        let curr = this._data;
        for (let i = 0; i < parts.length - 1; i++) {
            const p = parts[i];
            if (curr[p] == null) curr[p] = {};
            curr = curr[p];
        }
        curr[parts[parts.length - 1]] = val;
    }
    refresh() {}
}

const MockMessageBox = {
    success: jest.fn((msg, opts) => {
        if (opts && opts.onClose) opts.onClose();
    }),
    error: jest.fn()
};

const MockMessageToast = {
    show: jest.fn()
};

const MockBusyIndicator = {
    show: jest.fn(),
    hide: jest.fn()
};

const MockSelectDialog = function (opts) {
    this.opts = opts;
    this.open = jest.fn();
    this.close = jest.fn();
    this.setBusy = jest.fn();
    this.setModel = jest.fn((m, name) => {
        this._models = this._models || {};
        this._models[name] = m;
    });
    this.getModel = jest.fn((name) => (this._models && this._models[name]));
    this.bindAggregation = jest.fn();
};

const MockStandardListItem = function (id, opts) {
    this.id = id;
    this.opts = opts;
    this.addCustomData = jest.fn();
};

const MockCustomData = function (opts) {
    this.opts = opts;
    this.getValue = () => (opts && opts.value);
};

const MockMessaging = {
    getMessageModel: jest.fn(() => ({
        getData: jest.fn(() => [])
    }))
};

const MockAuthService = {
    syncModelHeaders: jest.fn()
};

const MockCustomerReturnService = {
    getReturnReasons: jest.fn().mockResolvedValue([
        { ReasonCode: "101", ReasonText: "Poor quality" },
        { ReasonCode: "102", ReasonText: "Damaged in transit" }
    ]),
    getDocumentTypes: jest.fn().mockResolvedValue([
        { CustomerReturnType: "ZRET", CustomerReturnType_Text: "Sales Return Order" }
    ]),
    getPlants: jest.fn().mockResolvedValue([
        { Plant: "1110", PlantName: "Ascend Plant" }
    ]),
    getCustomers: jest.fn().mockResolvedValue([
        { Customer: "10082", OrganizationBPName1: "Bajaj Healthcare Limited", CityName: "Mumbai" }
    ]),
    getMaterials: jest.fn().mockResolvedValue([
        { Material: "4000000001", Material_Text: "X-265 Active Substance" }
    ]),
    getReferenceDocuments: jest.fn().mockResolvedValue([
        {
            ReferenceSDDocument: "31000007",
            SDDocumentCategory: "M",
            SDDocumentCategoryName: "Invoice",
            SoldToParty: "10082",
            SalesOrganization: "1000",
            DistributionChannel: "10",
            Division: "52"
        }
    ]),
    createCustomerReturn: jest.fn().mockResolvedValue({
        CustomerReturn: "4500099",
        CustomerReturnType: "ZRET",
        SoldToParty: "10082",
        TotalNetAmount: 15000,
        TransactionCurrency: "INR",
        Success: true,
        Message: "Customer Return 4500099 successfully created and verified"
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

beforeAll(() => {
    global.sap = {
        ui: {
            define: function (deps, factory) {
                ControllerClass = factory(
                    MockBaseController,
                    MockJSONModel,
                    MockMessageBox,
                    MockMessageToast,
                    MockSelectDialog,
                    MockStandardListItem,
                    MockCustomData,
                    MockBusyIndicator,
                    MockMessaging,
                    MockCustomerReturnService,
                    MockAuthService
                );
            }
        }
    };

    require("../../../app/fiori-app/webapp/modules/sd/customer-return/controller/CreateCustomerReturn.controller");
});

describe("CreateCustomerReturn Controller", () => {
    let controller;
    let mockView;
    let mockRouter;
    let mockRoute;
    let models;

    beforeEach(() => {
        jest.clearAllMocks();
        models = {};

        mockRoute = {
            attachPatternMatched: jest.fn()
        };

        mockRouter = {
            getRoute: jest.fn().mockReturnValue(mockRoute),
            navTo: jest.fn()
        };

        mockView = {
            setModel: jest.fn((model, name) => {
                models[name || ""] = model;
            }),
            getModel: jest.fn((name) => models[name || ""]),
            byId: jest.fn(),
            getId: jest.fn(() => "mockCreateCustomerReturnView"),
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
        controller.getRouter = () => mockRouter;
        controller.getOwnerComponent = () => ({
            getRouter: () => mockRouter
        });
    });

    describe("Initialization & Lifecycle", () => {
        test("onInit sets up initial models and registers route pattern matched", () => {
            controller.onInit();

            expect(mockView.setModel).toHaveBeenCalledWith(expect.any(MockJSONModel), "createReturnModel");
            expect(mockView.setModel).toHaveBeenCalledWith(expect.any(MockJSONModel), "returnReasons");
            expect(mockView.setModel).toHaveBeenCalledWith(expect.any(MockJSONModel), "documentTypes");
            expect(mockView.setModel).toHaveBeenCalledWith(expect.any(MockJSONModel), "plants");

            expect(mockRouter.getRoute).toHaveBeenCalledWith("createCustomerReturn");
            expect(mockRoute.attachPatternMatched).toHaveBeenCalled();

            const createModel = models["createReturnModel"];
            expect(createModel.getProperty("/CustomerReturnType")).toBe("ZRET");
            expect(createModel.getProperty("/ReturnsOrderReason")).toBe("101");
            expect(createModel.getProperty("/Items").length).toBe(1);
        });

        test("_onRouteMatched resets model and calls _loadConfigData", async () => {
            controller.onInit();
            const createModel = models["createReturnModel"];
            createModel.setProperty("/SoldToParty", "99999");

            controller._onRouteMatched();

            expect(createModel.getProperty("/SoldToParty")).toBe("");
            expect(MockCustomerReturnService.getReturnReasons).toHaveBeenCalled();
            expect(MockCustomerReturnService.getDocumentTypes).toHaveBeenCalled();
            expect(MockCustomerReturnService.getPlants).toHaveBeenCalled();

            await Promise.resolve();
            await Promise.resolve();
        });
    });

    describe("Navigation", () => {
        test("onNavBack navigates to customerReturns route", () => {
            controller.onInit();
            controller.onNavBack();
            expect(mockRouter.navTo).toHaveBeenCalledWith("customerReturns", {}, true);
        });
    });

    describe("Form Field Changes", () => {
        test("onCategoryChange clears ReferenceSDDocument when category is empty", () => {
            controller.onInit();
            const createModel = models["createReturnModel"];
            createModel.setProperty("/ReferenceSDDocument", "31000007");
            createModel.setProperty("/Items", [{ ReferenceSDDocument: "31000007" }]);

            const oEvent = {
                getParameter: jest.fn().mockReturnValue({ getKey: () => "" })
            };
            controller.onCategoryChange(oEvent);

            expect(createModel.getProperty("/ReferenceSDDocument")).toBe("");
            expect(createModel.getProperty("/Items")[0].ReferenceSDDocument).toBe("");
        });

        test("onReferenceDocChange updates ReferenceSDDocument on all items", () => {
            controller.onInit();
            const createModel = models["createReturnModel"];
            createModel.setProperty("/Items", [{ ReferenceSDDocument: "" }]);

            const oEvent = {
                getParameter: jest.fn().mockReturnValue("31000007")
            };
            controller.onReferenceDocChange(oEvent);

            expect(createModel.getProperty("/Items")[0].ReferenceSDDocument).toBe("31000007");
        });

        test("onHeaderReasonChange updates ReturnReason on items", () => {
            controller.onInit();
            const createModel = models["createReturnModel"];

            const oEvent = {
                getParameter: jest.fn().mockReturnValue({ getKey: () => "102" })
            };
            controller.onHeaderReasonChange(oEvent);

            expect(createModel.getProperty("/Items")[0].ReturnReason).toBe("102");
        });

        test("onCustomerChange fetches customer name and updates SoldToPartyName", async () => {
            controller.onInit();
            const createModel = models["createReturnModel"];

            const oEvent = {
                getParameter: jest.fn().mockReturnValue("10082")
            };
            controller.onCustomerChange(oEvent);

            await Promise.resolve();
            await Promise.resolve();

            expect(MockCustomerReturnService.getCustomers).toHaveBeenCalledWith("10082", 1);
            expect(createModel.getProperty("/SoldToPartyName")).toBe("Bajaj Healthcare Limited");
        });

        test("onCustomerChange clears SoldToPartyName when empty", () => {
            controller.onInit();
            const createModel = models["createReturnModel"];
            createModel.setProperty("/SoldToPartyName", "Bajaj");

            const oEvent = {
                getParameter: jest.fn().mockReturnValue("")
            };
            controller.onCustomerChange(oEvent);

            expect(createModel.getProperty("/SoldToPartyName")).toBe("");
        });
    });

    describe("Value Help Dialogs", () => {
        test("onCustomerValueHelp opens dialog, searches, and sets customer on confirm", async () => {
            controller.onInit();
            controller.onCustomerValueHelp();

            expect(controller._oCustomerSelectDialog).toBeDefined();
            expect(controller._oCustomerSelectDialog.open).toHaveBeenCalled();
            expect(MockCustomerReturnService.getCustomers).toHaveBeenCalled();

            const createModel = models["createReturnModel"];
            const oSelected = {
                getTitle: () => "10082",
                getDescription: () => "Bajaj Healthcare Limited"
            };
            controller._oCustomerSelectDialog.opts.confirm({
                getParameter: () => oSelected
            });

            expect(createModel.getProperty("/SoldToParty")).toBe("10082");
            expect(createModel.getProperty("/SoldToPartyName")).toBe("Bajaj Healthcare Limited");
        });

        test("onMaterialValueHelp opens dialog, searches, and sets material on active item context", async () => {
            controller.onInit();
            const oSource = {
                getBindingContext: () => ({
                    getPath: () => "/Items/0"
                })
            };
            const oEvent = { getSource: () => oSource };
            controller.onMaterialValueHelp(oEvent);

            expect(controller._oMaterialSelectDialog).toBeDefined();
            expect(controller._oMaterialSelectDialog.open).toHaveBeenCalled();
            expect(MockCustomerReturnService.getMaterials).toHaveBeenCalled();

            const createModel = models["createReturnModel"];
            const oSelected = {
                getTitle: () => "4000000001"
            };
            controller._oMaterialSelectDialog.opts.confirm({
                getParameter: () => oSelected
            });

            expect(createModel.getProperty("/Items/0/Material")).toBe("4000000001");
        });

        test("onReferenceDocValueHelp opens dialog, searches, and populates header and items", async () => {
            controller.onInit();
            controller.onReferenceDocValueHelp();

            expect(controller._oRefDocSelectDialog).toBeDefined();
            expect(controller._oRefDocSelectDialog.open).toHaveBeenCalled();
            expect(MockCustomerReturnService.getReferenceDocuments).toHaveBeenCalled();

            const createModel = models["createReturnModel"];
            const mockCustomData = new MockCustomData({
                value: {
                    SoldToParty: "10082",
                    SDDocumentCategory: "M",
                    SalesOrganization: "1000",
                    DistributionChannel: "10",
                    Division: "52"
                }
            });
            const oSelected = {
                getTitle: () => "31000007",
                getCustomData: () => [mockCustomData]
            };
            controller._oRefDocSelectDialog.opts.confirm({
                getParameter: () => oSelected
            });

            expect(createModel.getProperty("/ReferenceSDDocument")).toBe("31000007");
            expect(createModel.getProperty("/SoldToParty")).toBe("10082");
            expect(createModel.getProperty("/ReferenceSDDocumentCategory")).toBe("M");
            expect(createModel.getProperty("/SalesOrganization")).toBe("1000");
            expect(createModel.getProperty("/DistributionChannel")).toBe("10");
            expect(createModel.getProperty("/OrganizationDivision")).toBe("52");
            expect(createModel.getProperty("/Items/0/ReferenceSDDocument")).toBe("31000007");
        });
    });

    describe("Item Management", () => {
        test("onAddReturnItem and onDeleteReturnItem manipulate items list", () => {
            controller.onInit();
            const createModel = models["createReturnModel"];
            expect(createModel.getProperty("/Items").length).toBe(1);

            controller.onAddReturnItem();
            expect(createModel.getProperty("/Items").length).toBe(2);
            expect(createModel.getProperty("/Items")[1].ItemIndex).toBe(2);

            controller.onDeleteReturnItem();
            expect(createModel.getProperty("/Items").length).toBe(1);

            // Cannot delete last remaining item
            controller.onDeleteReturnItem();
            expect(createModel.getProperty("/Items").length).toBe(1);
            expect(MockMessageToast.show).toHaveBeenCalled();
        });
    });

    describe("Create Return Submission", () => {
        test("onConfirmCreateReturn rejects when SoldToParty is missing", () => {
            controller.onInit();
            const createModel = models["createReturnModel"];
            createModel.setProperty("/SoldToParty", "");

            controller.onConfirmCreateReturn();

            expect(MockMessageBox.error).toHaveBeenCalled();
            expect(MockCustomerReturnService.createCustomerReturn).not.toHaveBeenCalled();
        });

        test("onConfirmCreateReturn rejects when Material is missing", () => {
            controller.onInit();
            const createModel = models["createReturnModel"];
            createModel.setProperty("/SoldToParty", "10082");
            createModel.setProperty("/Items", [{ Material: "" }]);

            controller.onConfirmCreateReturn();

            expect(MockMessageBox.error).toHaveBeenCalled();
            expect(MockCustomerReturnService.createCustomerReturn).not.toHaveBeenCalled();
        });

        test("onConfirmCreateReturn creates document via service, shows success, and navigates back", async () => {
            controller.onInit();
            const createModel = models["createReturnModel"];
            createModel.setProperty("/SoldToParty", "10082");
            createModel.setProperty("/ReturnsOrderReason", "101");
            createModel.setProperty("/ReferenceSDDocument", "31000007");
            createModel.setProperty("/Items", [
                {
                    Material: "4000000001",
                    OrderQuantity: "10.000",
                    OrderQuantityUnit: "KG",
                    ProductionPlant: "1110",
                    StorageLocation: "FG01"
                }
            ]);

            controller.onConfirmCreateReturn();

            expect(MockBusyIndicator.show).toHaveBeenCalled();
            expect(MockCustomerReturnService.createCustomerReturn).toHaveBeenCalled();

            await Promise.resolve();
            await Promise.resolve();

            expect(MockBusyIndicator.hide).toHaveBeenCalled();
            expect(MockMessageBox.success).toHaveBeenCalled();
            expect(mockRouter.navTo).toHaveBeenCalledWith("customerReturns", {}, true);
        });

        test("onConfirmCreateReturn handles service failure with MessageBox.error", async () => {
            controller.onInit();
            const createModel = models["createReturnModel"];
            createModel.setProperty("/SoldToParty", "10082");
            createModel.setProperty("/ReturnsOrderReason", "101");
            createModel.setProperty("/Items", [{ Material: "4000000001", OrderQuantity: "10" }]);

            MockCustomerReturnService.createCustomerReturn.mockRejectedValueOnce(new Error("SAP Backend 500 error"));

            controller.onConfirmCreateReturn();

            expect(MockBusyIndicator.show).toHaveBeenCalled();

            await Promise.resolve();
            await Promise.resolve();

            expect(MockBusyIndicator.hide).toHaveBeenCalled();
            expect(MockMessageBox.error).toHaveBeenCalled();
        });
    });
});
