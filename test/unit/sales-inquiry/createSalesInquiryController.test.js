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
        it("onInit attaches route matched handler and initializes model", () => {
            controller.onInit();
            expect(mockRouter.getRoute).toHaveBeenCalledWith("createSalesInquiry");
            expect(controller.getView().setModel).toHaveBeenCalled();
            expect(mockModel.getProperty("/header/StatusText")).toBe("Draft");
        });

        it("_loadConfigurationAndDefaults updates organizational filters on cached data", async () => {
            controller._oConfigData = {
                inquiryTypes: [{ SalesDocumentType: "ZIN" }],
                salesOrgs: [{ SalesOrganization: "1000" }],
                distChannels: [{ SalesOrganization: "1000", DistributionChannel: "10" }],
                divisions: [{ SalesOrganization: "1000", DistributionChannel: "10", Division: "52" }]
            };
            const updateSpy = jest.spyOn(controller, "_updateOrganizationalFilters");
            await controller._loadConfigurationAndDefaults();
            expect(updateSpy).toHaveBeenCalled();
        });
    });

    describe("Organizational Data & Suggestions Selection", () => {
        it("onInquiryTypeSelect updates Inquiry Type in model and triggers validation", () => {
            const oEvent = {
                getParameter: (param) => param === "selectedItem" ? { getKey: () => "IN", getText: () => "IN" } : null
            };
            controller.onInquiryTypeSelect(oEvent);
            expect(mockModel.getProperty("/header/SalesInquiryType")).toBe("IN");
            expect(mockModel.getProperty("/userModified/SalesInquiryType")).toBe(true);
        });

        it("onSalesOrgSelect updates SalesOrg and triggers organizational filters", () => {
            const oEvent = {
                getParameter: (param) => param === "selectedItem" ? { getKey: () => "1000", getText: () => "1000" } : null
            };
            const filterSpy = jest.spyOn(controller, "_updateOrganizationalFilters");
            controller.onSalesOrgSelect(oEvent);
            expect(mockModel.getProperty("/header/SalesOrganization")).toBe("1000");
            expect(filterSpy).toHaveBeenCalled();
        });

        it("onDistChannelSelect updates DistChannel and triggers filters", () => {
            const oEvent = {
                getParameter: (param) => param === "selectedItem" ? { getKey: () => "10", getText: () => "10" } : null
            };
            controller.onDistChannelSelect(oEvent);
            expect(mockModel.getProperty("/header/DistributionChannel")).toBe("10");
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

        it("onDeleteItem removes line item and recalculates totals", () => {
            controller.onAddItem();
            expect(mockModel.getProperty("/items").length).toBe(2);

            const oEvent = {
                getParameter: () => ({
                    getBindingContext: () => ({ getPath: () => "/items/0" })
                })
            };
            controller.onDeleteItem(oEvent);
            expect(mockModel.getProperty("/items").length).toBe(1);
            expect(mockModel.getProperty("/items/0/SalesInquiryItem")).toBe("000010");
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
        it("onCheckIncompletion shows toast when complete or triggers MessagePopover", () => {
            mockModel.setProperty("/header/SoldToParty", ""); // Invalid
            const popoverSpy = jest.spyOn(controller, "onMessageButtonPress");
            controller.onCheckIncompletion();
            expect(popoverSpy).toHaveBeenCalled();
        });

        it("onMessageButtonPress instantiates MessagePopover with JSONModel without ReferenceError", (done) => {
            mockModel.setProperty("/header/SoldToParty", ""); // Error
            SalesInquiryModel.validateForm(mockModel);

            controller.onMessageButtonPress();
            expect(controller._oMessagePopover).toBeDefined();
            expect(controller._oMessagePopover.getModel()).toBeInstanceOf(MockJSONModel);

            setTimeout(() => {
                expect(controller._oMessagePopover.isOpen()).toBe(true);
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

        it("onSave dispatches payload and presents success dialog with Create Another option", async () => {
            setupValidHeader(mockModel);
            mockModel.setProperty("/header/SoldToParty", "10135");
            mockModel.setProperty("/items/0/Material", "1000000003");
            mockModel.setProperty("/items/0/OrderQuantity", 10);
            mockModel.setProperty("/items/0/OrderQuantityUnit", "KG");
            mockModel.setProperty("/items/0/Plant", "1120");
            mockModel.setProperty("/items/0/NetPriceAmount", "50.00");

            mockSalesInquiryService.createSalesInquiry.mockResolvedValue("10000005");

            controller.onSave();
            expect(mockBusyIndicator.show).toHaveBeenCalled();

            await Promise.resolve();
            await Promise.resolve();

            expect(mockBusyIndicator.hide).toHaveBeenCalled();
            expect(mockMessageBox.success).toHaveBeenCalledWith(
                expect.stringContaining("10000005"),
                expect.objectContaining({
                    actions: ["Display Inquiry", "Create Another", "Close"]
                })
            );

            // Test Create Another action
            const successCallConfig = mockMessageBox.success.mock.calls[0][1];
            const resetSpy = jest.spyOn(controller, "_resetModel");
            successCallConfig.onClose("Create Another");
            expect(resetSpy).toHaveBeenCalledWith(true);
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
