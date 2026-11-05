/**
 * Unit Tests for Create Sales Inquiry Controller
 * (CreateSalesInquiry.controller.js)
 */

let ControllerClass;
let SalesInquiryModel;

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

const mockSalesInquiryService = {
    loadConfiguration: jest.fn().mockResolvedValue({}),
    getCustomerDefaults: jest.fn().mockResolvedValue(null),
    getSalesInquiryDefaults: jest.fn().mockResolvedValue(null),
    getInquiryCreationCapabilities: jest.fn().mockResolvedValue({ CustomerGroup2: false, PortOfLoading: false, PortOfDischarge: false, ContactPerson: false, Plant: true }),
    getMaterialDetails: jest.fn().mockResolvedValue(null),
    getMaterialUnit: jest.fn().mockResolvedValue(null),
    createSalesInquiry: jest.fn().mockResolvedValue(null)
};

const MockBaseController = {
    prototype: {
        onNavBack: jest.fn()
    },
    extend: (name, proto) => {
        function Controller() {
            this.onNavBack = jest.fn();
            this.getText = (_key, _args, fallback) => fallback;
            this.blockSubmitIfNotConfirmed = require('../helpers/realBlockSubmit').realBlockSubmit();
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

// Setup global.sap.ui.define before requiring UI5 modules
global.sap = {
    ui: {
        define: jest.fn((deps, factory) => {
            if (deps.length === 1 && deps[0] === "sap/ui/model/json/JSONModel") {
                SalesInquiryModel = factory(MockJSONModel);
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
                    SalesInquiryModel,
                    mockValueHelpService,
                    mockSalesInquiryService
                );
            }
        })
    }
};

// Load Model first, then Controller
require("../../../app/fiori-app/webapp/modules/sd/sales-inquiry/model/SalesInquiryModel.js");
require("../../../app/fiori-app/webapp/modules/sd/sales-inquiry/controller/CreateSalesInquiry.controller.js");

describe("Create Sales Inquiry Controller Unit Tests", () => {
    let controller;
    let mockModel;
    let mockView;
    let mockControls;

    beforeEach(() => {
        jest.clearAllMocks();
        mockModel = SalesInquiryModel.createInitialModel("testuser");

        mockControls = {
            btnInquiryMessages: {
                getDomRef: jest.fn().mockReturnValue(true)
            },
            btnSaveInquiry: {
                getDomRef: jest.fn().mockReturnValue(true)
            },
            btnCheckIncompletion: {
                getDomRef: jest.fn().mockReturnValue(true)
            },
            inDistChannel: {
                getBinding: jest.fn().mockReturnValue({ filter: jest.fn() })
            },
            inDivision: {
                getBinding: jest.fn().mockReturnValue({ filter: jest.fn() })
            }
        };

        mockView = {
            setModel: jest.fn((m, name) => {
                if (name === "newInquiry") mockModel = m;
            }),
            getModel: jest.fn((name) => {
                if (name === "newInquiry") return mockModel;
                return null;
            }),
            byId: jest.fn((id) => mockControls[id] || null),
            addDependent: jest.fn()
        };

        controller = new ControllerClass();
        controller.getView = () => mockView;
        controller.byId = (id) => mockControls[id] || null;
        controller.getOwnerComponent = () => ({
            getRouter: () => mockRouter,
            getModel: () => null
        });
    });

    describe("Initialization & Model Reset", () => {
        it("onInit attaches _onRouteMatched to the createSalesInquiry route", () => {
            controller.onInit();
            expect(mockRouter.getRoute).toHaveBeenCalledWith("createSalesInquiry");
            const oRoute = mockRouter.getRoute.mock.results[0].value;
            expect(oRoute.attachPatternMatched).toHaveBeenCalledWith(controller._onRouteMatched, controller);
        });

        it("onInit binds a new Draft newInquiry model to the view", () => {
            controller.onInit();
            expect(mockView.setModel).toHaveBeenCalledWith(mockModel, "newInquiry");
            expect(mockModel.getProperty("/header/StatusText")).toBe("Draft");
        });

        it("_loadConfigurationAndDefaults applies cached defaults and scopes the org filters before the refetch resolves", async () => {
            controller._oConfigData = {
                inquiryTypes: [{ SalesDocumentType: "ZIN" }],
                salesOrgs: [{ SalesOrganization: "1000" }],
                distChannels: [{ SalesOrganization: "1000", DistributionChannel: "10" }],
                divisions: [{ SalesOrganization: "1000", DistributionChannel: "10", Division: "52" }]
            };

            const pLoad = controller._loadConfigurationAndDefaults();

            expect(mockModel.getProperty("/header/SalesInquiryType")).toBe("ZIN");
            expect(mockModel.getProperty("/header/SalesOrganization")).toBe("1000");
            expect(mockModel.getProperty("/header/DistributionChannel")).toBe("10");
            expect(mockModel.getProperty("/header/OrganizationDivision")).toBe("52");
            expect(mockControls.inDistChannel.getBinding().filter).toHaveBeenCalledWith([
                { path: "SalesOrganization", op: "EQ", val: "1000" }
            ]);
            expect(mockControls.inDivision.getBinding().filter).toHaveBeenCalledWith([
                { path: "SalesOrganization", op: "EQ", val: "1000" },
                { path: "DistributionChannel", op: "EQ", val: "10" }
            ]);
            await pLoad;
        });
    });

    describe("Organizational Data & Suggestions Selection", () => {
        it("onInquiryTypeSelect stores the type and marks it user-modified", () => {
            const oEvent = {
                getParameter: (param) => param === "selectedItem" ? { getKey: () => "IN", getText: () => "IN" } : null
            };
            controller.onInquiryTypeSelect(oEvent);
            expect(mockModel.getProperty("/header/SalesInquiryType")).toBe("IN");
            expect(mockModel.getProperty("/userModified/SalesInquiryType")).toBe(true);
        });

        it("onInquiryTypeSelect validates the field: a blank selection is flagged as mandatory", () => {
            const oEvent = {
                getParameter: (param) => param === "selectedItem" ? { getKey: () => "", getText: () => "" } : null
            };
            controller.onInquiryTypeSelect(oEvent);
            expect(mockModel.getProperty("/errors/SalesInquiryType")).toEqual({ state: "Error", text: "SalesInquiryType is mandatory" });
        });

        it("onSalesOrgSelect stores the org and scopes the distribution channel suggestions to it", () => {
            const oEvent = {
                getParameter: (param) => param === "selectedItem" ? { getKey: () => "1000", getText: () => "1000" } : null
            };
            controller.onSalesOrgSelect(oEvent);
            expect(mockModel.getProperty("/header/SalesOrganization")).toBe("1000");
            expect(mockControls.inDistChannel.getBinding().filter).toHaveBeenCalledWith([
                { path: "SalesOrganization", op: "EQ", val: "1000" }
            ]);
        });

        it("onDistChannelSelect stores the channel and scopes the division suggestions to org and channel", () => {
            mockModel.setProperty("/header/SalesOrganization", "1000");
            const oEvent = {
                getParameter: (param) => param === "selectedItem" ? { getKey: () => "10", getText: () => "10" } : null
            };
            controller.onDistChannelSelect(oEvent);
            expect(mockModel.getProperty("/header/DistributionChannel")).toBe("10");
            expect(mockControls.inDivision.getBinding().filter).toHaveBeenCalledWith([
                { path: "SalesOrganization", op: "EQ", val: "1000" },
                { path: "DistributionChannel", op: "EQ", val: "10" }
            ]);
        });

        it("onDivisionSelect updates OrganizationDivision", () => {
            const oEvent = {
                getParameter: (param) => param === "selectedItem" ? { getKey: () => "52", getText: () => "52" } : null
            };
            controller.onDivisionSelect(oEvent);
            expect(mockModel.getProperty("/header/OrganizationDivision")).toBe("52");
        });
    });

    describe("Customer Derivations & Commercial Terms", () => {
        it("onSoldToPartySelect updates SoldToParty, derives customer data, and populates name", async () => {
            mockSalesInquiryService.getCustomerDefaults.mockResolvedValue({
                derived: true,
                CustomerName: "Tata Chemicals Limited",
                City: "Mumbai",
                Country: "IN",
                ShipToParty: "10135",
                Currency: "INR"
            });

            const oEvent = {
                getParameter: (param) => param === "selectedItem" ? {
                    getKey: () => "10135",
                    getText: () => "10135",
                    getAdditionalText: () => "Tata Chemicals Limited"
                } : null
            };

            controller.onSoldToPartySelect(oEvent);
            expect(mockModel.getProperty("/header/SoldToParty")).toBe("10135");

            // Allow promise resolution
            await Promise.resolve();
            await Promise.resolve();

            expect(mockModel.getProperty("/header/CustomerName")).toBe("Tata Chemicals Limited");
            expect(mockModel.getProperty("/header/CustomerCity")).toBe("Mumbai");
        });

        it("onValidityDateChange sets error when End Date is before Start Date", () => {
            mockModel.setProperty("/header/BindingPeriodValidityStartDate", "2026-10-01");
            mockModel.setProperty("/header/BindingPeriodValidityEndDate", "2026-09-01");
            controller.onValidityDateChange();
            expect(mockModel.getProperty("/errors/BindingPeriodValidityEndDate/state")).toBe("Error");

            mockModel.setProperty("/header/BindingPeriodValidityEndDate", "2026-10-15");
            controller.onValidityDateChange();
            expect(mockModel.getProperty("/errors/BindingPeriodValidityEndDate/state")).toBe("None");
        });
    });

    describe("Line Items Management & Live Calculations", () => {
        it("onAddItem adds a new line item with 10-increment numbering", () => {
            controller.onAddItem();
            const aItems = mockModel.getProperty("/items");
            expect(aItems.length).toBe(2);
            expect(aItems[1].SalesInquiryItem).toBe("000020");
        });

        it("onDeleteItem removes the line, renumbers the rest and recalculates the total", () => {
            mockModel.setProperty("/items/0/OrderQuantity", 2);
            mockModel.setProperty("/items/0/NetPriceAmount", 100);
            controller.onAddItem();
            mockModel.setProperty("/items/1/OrderQuantity", 3);
            mockModel.setProperty("/items/1/NetPriceAmount", 10);

            const oEvent = {
                getParameter: () => ({
                    getBindingContext: () => ({ getPath: () => "/items/0" })
                })
            };
            controller.onDeleteItem(oEvent);
            expect(mockModel.getProperty("/items").length).toBe(1);
            expect(mockModel.getProperty("/items/0/SalesInquiryItem")).toBe("000010");
            // Only the 3 x 10 line is left
            expect(mockModel.getProperty("/header/TotalNetAmount")).toBe("30.00");
        });

        it("onItemMaterialLiveChange updates model property and clears error state without HTTP call", () => {
            const oEvent = {
                getSource: () => ({
                    getBindingContext: () => ({ getPath: () => "/items/0" })
                }),
                getParameter: () => "1000000003"
            };

            mockModel.setProperty("/items/0/errors/Material", { state: "Error", text: "Material is required" });
            controller.onItemMaterialLiveChange(oEvent);

            expect(mockModel.getProperty("/items/0/Material")).toBe("1000000003");
            expect(mockModel.getProperty("/items/0/errors/Material/state")).toBe("None");
            expect(mockSalesInquiryService.getMaterialDetails).not.toHaveBeenCalled();
        });

        it("onItemCalculationChange syncs input value and calculates totals in real time", () => {
            mockModel.setProperty("/items/0/OrderQuantity", 5);
            mockModel.setProperty("/items/0/NetPriceAmount", 100);

            const oEvent = {
                getSource: () => ({
                    getBindingContext: () => ({ getPath: () => "/items/0" }),
                    getBindingPath: () => "NetPriceAmount",
                    getValue: () => "200"
                })
            };

            controller.onItemCalculationChange(oEvent);
            expect(mockModel.getProperty("/items/0/NetPriceAmount")).toBe("200");
            expect(mockModel.getProperty("/items/0/NetAmount")).toBe("1000.00");
            expect(mockModel.getProperty("/header/TotalNetAmount")).toBe("1000.00");
        });

        it("onItemMaterialSelect applies Material details and unit from master data", async () => {
            mockSalesInquiryService.getMaterialUnit.mockResolvedValue("KG");

            const oEvent = {
                getSource: () => ({
                    getBindingContext: () => ({ getPath: () => "/items/0" })
                }),
                getParameter: () => ({
                    getKey: () => "1000000003",
                    getText: () => "1000000003",
                    getAdditionalText: () => "Polypropylene Resin (KG)",
                    getBindingContext: () => ({
                        getObject: () => ({
                            Material: "1000000003",
                            Material_Text: "Polypropylene Resin",
                            MaterialBaseUnit: "KG"
                        })
                    })
                })
            };

            controller.onItemMaterialSelect(oEvent);
            expect(mockModel.getProperty("/items/0/Material")).toBe("1000000003");
            expect(mockModel.getProperty("/items/0/SalesInquiryItemText")).toBe("Polypropylene Resin");
            expect(mockModel.getProperty("/items/0/OrderQuantityUnit")).toBe("KG");

            // Selecting a different material afterward must update description and not show stale data
            const oEvent2 = {
                getSource: () => ({
                    getBindingContext: () => ({ getPath: () => "/items/0" })
                }),
                getParameter: () => ({
                    getKey: () => "4000000002",
                    getText: () => "4000000002",
                    getBindingContext: () => ({
                        getObject: () => ({
                            Material: "4000000002",
                            MaterialName: "High Density Polyethylene",
                            MaterialBaseUnit: "TO"
                        })
                    })
                })
            };

            controller.onItemMaterialSelect(oEvent2);
            expect(mockModel.getProperty("/items/0/Material")).toBe("4000000002");
            expect(mockModel.getProperty("/items/0/SalesInquiryItemText")).toBe("High Density Polyethylene");
            expect(mockModel.getProperty("/items/0/OrderQuantityUnit")).toBe("TO");
        });

        it("onItemMaterialSelect fallback handles missing binding context without ReferenceError", () => {
            const oEvent = {
                getSource: () => ({
                    getBindingContext: () => ({ getPath: () => "/items/0" })
                }),
                getParameter: () => ({
                    getBindingContext: () => null,
                    getCells: () => [
                        { getText: () => "4000000003" },
                        { getText: () => "Fallback Polymer Description" }
                    ]
                })
            };

            controller.onItemMaterialSelect(oEvent);
            expect(mockModel.getProperty("/items/0/Material")).toBe("4000000003");
            expect(mockModel.getProperty("/items/0/SalesInquiryItemText")).toBe("Fallback Polymer Description");
        });

        it("onItemMaterialChange fetches material details and updates description", async () => {
            mockSalesInquiryService.getMaterialDetails.mockResolvedValue({
                Material: "4000000005",
                MaterialName: "Custom Spec Chemical",
                MaterialBaseUnit: "L"
            });

            const oEvent = {
                getSource: () => ({
                    getBindingContext: () => ({ getPath: () => "/items/0" }),
                    getValue: () => "4000000005"
                })
            };

            controller.onItemMaterialChange(oEvent);
            expect(mockModel.getProperty("/items/0/Material")).toBe("4000000005");

            await Promise.resolve();
            await Promise.resolve();

            expect(mockModel.getProperty("/items/0/SalesInquiryItemText")).toBe("Custom Spec Chemical");
            expect(mockModel.getProperty("/items/0/OrderQuantityUnit")).toBe("L");
        });
    });

    describe("Incompletion Log & Message Popover (No ReferenceError)", () => {
        function setupCompleteDocument(m) {
            m.setProperty("/header/SalesInquiryType", "ZIN");
            m.setProperty("/header/SalesOrganization", "1000");
            m.setProperty("/header/DistributionChannel", "10");
            m.setProperty("/header/OrganizationDivision", "52");
            m.setProperty("/header/TransactionCurrency", "INR");
            m.setProperty("/header/SoldToParty", "10135");
            m.setProperty("/items/0/Material", "1000000003");
            m.setProperty("/items/0/OrderQuantity", 10);
            m.setProperty("/items/0/OrderQuantityUnit", "KG");
            m.setProperty("/items/0/Plant", "1120");
        }

        it("onCheckIncompletion lists a missing mandatory header field in the message popover", () => {
            controller.onCheckIncompletion();
            expect(controller._oMessagePopover.getModel().getData()).toContainEqual({
                type: "Error",
                title: "Sold-to Party is mandatory",
                subtitle: "Header: SoldToParty"
            });
            expect(mockMessageToast.show).not.toHaveBeenCalled();
        });

        it("onCheckIncompletion lists a value SAP requires but the form cannot enforce as a warning", () => {
            setupCompleteDocument(mockModel);
            mockModel.setProperty("/header/PortOfLoading", "INMAA");
            mockModel.setProperty("/header/PortOfDischarge", "ESBCN");
            mockModel.setProperty("/header/ContactPerson", "25116");

            controller.onCheckIncompletion();

            expect(controller._oMessagePopover.getModel().getData()).toEqual([{
                type: "Warning",
                title: "Customer Group 2 is missing",
                subtitle: "Required by SAP; not yet supported by the SAP inquiry service, maintain directly in SAP after creation"
            }]);
        });

        it("onCheckIncompletion shows the complete toast and no popover when nothing is missing", () => {
            setupCompleteDocument(mockModel);
            mockModel.setProperty("/header/CustomerGroup2", "SEA");
            mockModel.setProperty("/header/PortOfLoading", "INMAA");
            mockModel.setProperty("/header/PortOfDischarge", "ESBCN");
            mockModel.setProperty("/header/ContactPerson", "25116");

            controller.onCheckIncompletion();

            expect(mockMessageToast.show).toHaveBeenCalledWith("Document is complete. No incompletions detected.");
            expect(controller._oMessagePopover).toBeUndefined();
        });

        it("onMessageButtonPress lists header and item errors with where they apply", () => {
            SalesInquiryModel.validateForm(mockModel);

            controller.onMessageButtonPress();

            const aMessages = controller._oMessagePopover.getModel().getData();
            expect(aMessages).toContainEqual({ type: "Error", title: "Sold-to Party is mandatory", subtitle: "Header: SoldToParty" });
            expect(aMessages).toContainEqual({ type: "Error", title: "Material is required", subtitle: "Item 1: Material" });
        });

        it("onMessageButtonPress opens the popover on the messages button after its 50 ms delay", (done) => {
            SalesInquiryModel.validateForm(mockModel);

            controller.onMessageButtonPress();
            expect(controller._oMessagePopover.isOpen()).toBe(false);

            setTimeout(() => {
                expect(controller._oMessagePopover.isOpen()).toBe(true);
                expect(controller._oMessagePopover._anchor).toBe(mockControls.btnInquiryMessages);
                done();
            }, 60);
        });
    });

    describe("Submission & Save Flow", () => {
        function setupValidHeader(m) {
            m.setProperty("/header/SalesInquiryType", "ZIN");
            m.setProperty("/header/SalesOrganization", "1000");
            m.setProperty("/header/DistributionChannel", "10");
            m.setProperty("/header/OrganizationDivision", "52");
            m.setProperty("/header/TransactionCurrency", "INR");
        }

        it("onSave blocks when incomplete and opens message popover", () => {
            mockModel.setProperty("/header/SoldToParty", "");
            const popoverSpy = jest.spyOn(controller, "onMessageButtonPress");
            controller.onSave();
            expect(popoverSpy).toHaveBeenCalled();
            expect(mockSalesInquiryService.createSalesInquiry).not.toHaveBeenCalled();
        });

        it("onSave blocks when item Plant is empty and highlights Plant with error state", () => {
            setupValidHeader(mockModel);
            mockModel.setProperty("/header/SoldToParty", "10135");
            mockModel.setProperty("/items/0/Material", "1000000003");
            mockModel.setProperty("/items/0/OrderQuantity", 10);
            mockModel.setProperty("/items/0/OrderQuantityUnit", "KG");
            mockModel.setProperty("/items/0/Plant", "");
            const popoverSpy = jest.spyOn(controller, "onMessageButtonPress");

            controller.onSave();

            expect(popoverSpy).toHaveBeenCalled();
            expect(mockSalesInquiryService.createSalesInquiry).not.toHaveBeenCalled();
            const aItems = mockModel.getProperty("/items");
            expect(aItems[0].errors.Plant.state).toBe("Error");
            expect(aItems[0].errors.Plant.text).toContain("Plant is required for each line item");
        });

        function setupSavableInquiry(m) {
            setupValidHeader(m);
            m.setProperty("/header/SoldToParty", "10135");
            m.setProperty("/items/0/Material", "1000000003");
            m.setProperty("/items/0/OrderQuantity", 10);
            m.setProperty("/items/0/OrderQuantityUnit", "KG");
            m.setProperty("/items/0/Plant", "1120");
            m.setProperty("/items/0/NetPriceAmount", "50.00");
        }

        async function saveSuccessfully(sInquiry) {
            mockSalesInquiryService.createSalesInquiry.mockResolvedValue(sInquiry);
            controller.onSave();
            await Promise.resolve();
            await Promise.resolve();
            return mockMessageBox.success.mock.calls[0][1];
        }

        it("onSave sends the form values to the service once", async () => {
            setupSavableInquiry(mockModel);

            await saveSuccessfully("10000005");

            expect(mockSalesInquiryService.createSalesInquiry).toHaveBeenCalledTimes(1);
            const oPayload = mockSalesInquiryService.createSalesInquiry.mock.calls[0][0];
            expect(oPayload.header).toMatchObject({
                SalesInquiryType: "ZIN",
                SalesOrganization: "1000",
                DistributionChannel: "10",
                OrganizationDivision: "52",
                SoldToParty: "10135",
                TransactionCurrency: "INR"
            });
            expect(oPayload.items).toHaveLength(1);
            expect(oPayload.items[0]).toMatchObject({
                SalesInquiryItem: "000010",
                Material: "1000000003",
                OrderQuantity: 10,
                OrderQuantityUnit: "KG",
                Plant: "1120",
                NetPriceAmount: 50
            });
        });

        it("onSave shows the SAP number in a success dialog and hides the busy indicator", async () => {
            setupSavableInquiry(mockModel);

            await saveSuccessfully("10000005");

            expect(mockBusyIndicator.show).toHaveBeenCalledWith(0);
            expect(mockBusyIndicator.hide).toHaveBeenCalledTimes(1);
            expect(mockMessageBox.success).toHaveBeenCalledWith(
                "Sales Inquiry 10000005 has been successfully created.",
                expect.objectContaining({
                    title: "Sales Inquiry Created",
                    actions: ["Display Inquiry", "Create Another", "Close"]
                })
            );
        });

        it("onSave success dialog: Create Another blanks the form", async () => {
            setupSavableInquiry(mockModel);
            const oDialog = await saveSuccessfully("10000005");

            oDialog.onClose("Create Another");

            expect(mockModel.getProperty("/header/SoldToParty")).toBe("");
            expect(mockModel.getProperty("/items/0/Material")).toBe("");
        });

        it("onSave success dialog: Display Inquiry opens the created inquiry", async () => {
            setupSavableInquiry(mockModel);
            const oDialog = await saveSuccessfully("10000005");

            oDialog.onClose("Display Inquiry");

            expect(mockRouter.navTo).toHaveBeenCalledWith("salesInquiryDetail", { SalesInquiry: "10000005" });
        });

        it("onSave success dialog: Close returns to the inquiry list", async () => {
            setupSavableInquiry(mockModel);
            const oDialog = await saveSuccessfully("10000005");

            oDialog.onClose("Close");

            expect(mockRouter.navTo).toHaveBeenCalledWith("salesInquiries");
        });

        it("onSave handles backend rejection gracefully", async () => {
            setupValidHeader(mockModel);
            mockModel.setProperty("/header/SoldToParty", "10135");
            mockModel.setProperty("/items/0/Material", "1000000003");
            mockModel.setProperty("/items/0/OrderQuantity", 10);
            mockModel.setProperty("/items/0/OrderQuantityUnit", "KG");
            mockModel.setProperty("/items/0/Plant", "1120");

            mockSalesInquiryService.createSalesInquiry.mockRejectedValue(new Error("Customer credit limit exceeded"));

            controller.onSave();
            await Promise.resolve();
            await Promise.resolve();

            expect(mockBusyIndicator.hide).toHaveBeenCalled();
            expect(mockModel.getProperty("/hasError")).toBe(true);
            expect(mockModel.getProperty("/errorMessage")).toContain("Customer credit limit exceeded");
            expect(mockMessageBox.error).toHaveBeenCalledWith(expect.stringContaining("Customer credit limit exceeded"));
        });

        it("onSave turns submit off after a not-confirmed answer, so a second press sends nothing", async () => {
            setupValidHeader(mockModel);
            mockModel.setProperty("/header/SoldToParty", "10135");
            mockModel.setProperty("/items/0/Material", "1000000003");
            mockModel.setProperty("/items/0/OrderQuantity", 10);
            mockModel.setProperty("/items/0/OrderQuantityUnit", "KG");
            mockModel.setProperty("/items/0/Plant", "1120");
            mockSalesInquiryService.createSalesInquiry.mockClear();
            mockSalesInquiryService.createSalesInquiry.mockRejectedValue(new Error("SAP did not answer this request, so the result is NOT confirmed: it may have been saved. Check it in SAP before trying again."));

            controller.onSave();
            await Promise.resolve();
            await Promise.resolve();

            expect(mockModel.getProperty("/submitBlocked")).toBe(true);
            expect(mockMessageBox.error).toHaveBeenCalledWith(expect.stringContaining("Create is turned off"));
            expect(mockMessageBox.error).toHaveBeenCalledWith(expect.not.stringContaining("Failed to create"));

            controller.onSave();

            expect(mockSalesInquiryService.createSalesInquiry).toHaveBeenCalledTimes(1);
        });

        it("onSave handles partial backend creation with warning and navigation to detail", async () => {
            setupValidHeader(mockModel);
            mockModel.setProperty("/header/SoldToParty", "10135");
            mockModel.setProperty("/items/0/Material", "1000000003");
            mockModel.setProperty("/items/0/OrderQuantity", 10);
            mockModel.setProperty("/items/0/OrderQuantityUnit", "KG");
            mockModel.setProperty("/items/0/Plant", "1120");

            const partialErrMsg = "Sales Inquiry 1000529 was created in SAP S/4HANA, but adding item 000010 failed: Material blocked. Do not retry: check or complete inquiry 1000529 in SAP.";
            const partialError = new Error(partialErrMsg);
            partialError.SalesInquiry = "1000529";

            mockSalesInquiryService.createSalesInquiry.mockRejectedValue(partialError);

            controller.onSave();
            await Promise.resolve();
            await Promise.resolve();

            expect(mockBusyIndicator.hide).toHaveBeenCalled();
            expect(mockModel.getProperty("/hasError")).toBe(true);
            expect(mockModel.getProperty("/errorMessage")).toContain("1000529");
            expect(mockMessageBox.warning).toHaveBeenCalledWith(
                expect.stringContaining("1000529"),
                expect.objectContaining({
                    title: "Partial Creation in SAP",
                    actions: expect.arrayContaining(["Display Inquiry 1000529", "Close"])
                })
            );

            // Test navigation on "Display Inquiry 1000529"
            const warningConfig = mockMessageBox.warning.mock.calls[0][1];
            warningConfig.onClose("Display Inquiry 1000529");
            expect(mockRouter.navTo).toHaveBeenCalledWith("salesInquiryDetail", {
                SalesInquiry: "1000529"
            });
        });

        it("onSave partial creation: closing the warning blanks the form so the same inquiry cannot be resubmitted", async () => {
            setupSavableInquiry(mockModel);
            const partialError = new Error("Sales Inquiry 1000529 was created in SAP S/4HANA, but adding item 000010 failed");
            partialError.SalesInquiry = "1000529";
            mockSalesInquiryService.createSalesInquiry.mockRejectedValue(partialError);

            controller.onSave();
            await Promise.resolve();
            await Promise.resolve();
            mockMessageBox.warning.mock.calls[0][1].onClose("Close");

            expect(mockModel.getProperty("/header/SoldToParty")).toBe("");
            expect(mockModel.getProperty("/items/0/Material")).toBe("");
            expect(mockRouter.navTo).not.toHaveBeenCalled();
        });
    });

    describe("Cancel Flow", () => {
        it("onCancel prompts confirmation and navigates back on OK", () => {
            const navBackSpy = jest.spyOn(controller, "onNavBack");
            controller.onCancel();

            expect(mockMessageBox.confirm).toHaveBeenCalled();
            const confirmConfig = mockMessageBox.confirm.mock.calls[0][1];
            confirmConfig.onClose("OK");

            expect(navBackSpy).toHaveBeenCalledWith("salesInquiries");
        });
    });
});
