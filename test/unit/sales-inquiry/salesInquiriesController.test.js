/**
 * Unit Tests for Sales Inquiries Controller
 * (SalesInquiries.controller.js)
 */

let ControllerClass;

global.window = global.window || {
    open: jest.fn()
};

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
    confirm: jest.fn(),
    success: jest.fn(),
    error: jest.fn(),
    warning: jest.fn(),
    Action: {
        OK: "OK",
        CANCEL: "CANCEL"
    }
};

const mockMessageToast = {
    show: jest.fn()
};

const mockBusyIndicator = {
    show: jest.fn(),
    hide: jest.fn()
};

const mockSalesInquiryService = {
    createSalesQuote: jest.fn(),
    getSalesInquiry: jest.fn().mockResolvedValue({ header: {}, items: [] }),
    getInquiryCreationCapabilities: jest.fn().mockResolvedValue({ CustomerGroup2: false, PortOfLoading: false, PortOfDischarge: false, ContactPerson: false }),
    getInquiryCompleteness: jest.fn()
};

const mockDialog = {
    open: jest.fn(),
    close: jest.fn(),
    attachAfterClose: jest.fn(),
    destroy: jest.fn()
};

const mockFragment = {
    load: jest.fn().mockResolvedValue(mockDialog)
};

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
        onNavBack: jest.fn()
    },
    extend: (name, proto) => {
        function Controller() {
            this._models = {};
            this._byIds = {};
        }
        Object.assign(Controller.prototype, MockBaseController.prototype, proto);
        Controller.prototype.getView = function () {
            const self = this;
            return {
                getId: () => "mockViewId",
                setModel: (m, n) => { self._models[n || ""] = m; },
                getModel: (n) => self._models[n || ""],
                addDependent: jest.fn()
            };
        };
        Controller.prototype.byId = function (id) {
            return this._byIds[id] || null;
        };
        Controller.prototype.getOwnerComponent = function () {
            const self = this;
            return {
                getRouter: () => self._router
            };
        };
        return Controller;
    }
};

global.sap = {
    ui: {
        define: (deps, factory) => {
            ControllerClass = factory(
                MockBaseController,
                MockJSONModel,
                MockFilter,
                MockFilterOperator,
                MockFilterType,
                mockMessageBox,
                mockMessageToast,
                mockBusyIndicator,
                mockFragment,
                mockSalesInquiryService
            );
        },
        model: {
            json: { JSONModel: MockJSONModel },
            Filter: MockFilter,
            FilterOperator: MockFilterOperator,
            FilterType: MockFilterType
        },
        core: {
            BusyIndicator: mockBusyIndicator,
            Fragment: mockFragment
        }
    },
    m: {
        MessageBox: mockMessageBox,
        MessageToast: mockMessageToast
    }
};

require("../../../app/fiori-app/webapp/modules/sd/sales-inquiry/controller/SalesInquiries.controller.js");

describe("SalesInquiries.controller", () => {
    let controller;
    let mockRouter;
    let mockTable;
    let mockBinding;

    beforeEach(() => {
        jest.clearAllMocks();
        controller = new ControllerClass();
        mockRouter = {
            getRoute: jest.fn().mockReturnValue({
                attachPatternMatched: jest.fn()
            }),
            navTo: jest.fn()
        };
        controller._router = mockRouter;

        mockBinding = {
            refresh: jest.fn(),
            filter: jest.fn()
        };

        mockTable = {
            getBinding: jest.fn().mockReturnValue(mockBinding),
            getItems: jest.fn().mockReturnValue([]),
            getSelectedItem: jest.fn().mockReturnValue(null)
        };

        controller._byIds["salesInquiriesTable"] = mockTable;
    });

    describe("Initialization & Lifecycle", () => {
        it("onInit sets up salesInquiriesView model and route listener", () => {
            controller.onInit();
            const viewModel = controller.getView().getModel("salesInquiriesView");
            expect(viewModel).toBeDefined();
            expect(viewModel.getProperty("/totalCount")).toBe(0);
            expect(viewModel.getProperty("/openCount")).toBe(0);
            expect(viewModel.getProperty("/customerCount")).toBe(0);
            expect(mockRouter.getRoute).toHaveBeenCalledWith("salesInquiries");
        });

        it("_onRouteMatched refreshes table binding safely", () => {
            controller._onRouteMatched();
            expect(mockBinding.refresh).toHaveBeenCalled();
        });
    });

    describe("Formatters", () => {
        it("statusText formats Open, In Process, and Completed", () => {
            expect(controller.formatter.statusText("A")).toBe("Open");
            expect(controller.formatter.statusText("Open")).toBe("Open");
            expect(controller.formatter.statusText("B")).toBe("In Process");
            expect(controller.formatter.statusText("C")).toBe("Completed");
            expect(controller.formatter.statusText("Completed")).toBe("Completed");
            expect(controller.formatter.statusText(null)).toBe("Open");
            expect(controller.formatter.statusText("Custom")).toBe("Custom");
        });

        it("statusState returns appropriate sap.ui.core.ValueState", () => {
            expect(controller.formatter.statusState("A")).toBe("Information");
            expect(controller.formatter.statusState("Open")).toBe("Information");
            expect(controller.formatter.statusState("B")).toBe("Warning");
            expect(controller.formatter.statusState("C")).toBe("Success");
            expect(controller.formatter.statusState("Completed")).toBe("Success");
            expect(controller.formatter.statusState("Unknown")).toBe("None");
        });
    });

    describe("Table Updates & Metrics", () => {
        it("onUpdateFinished computes totalCount, openCount, and unique customers", () => {
            controller.onInit();
            const mockItems = [
                {
                    getBindingContext: () => ({
                        getProperty: (prop) => prop === "SoldToParty" ? "10083" : "A"
                    })
                },
                {
                    getBindingContext: () => ({
                        getProperty: (prop) => prop === "SoldToParty" ? "10135" : "B"
                    })
                },
                {
                    getBindingContext: () => ({
                        getProperty: (prop) => prop === "SoldToParty" ? "10083" : "A"
                    })
                }
            ];

            const oEvent = {
                getSource: () => ({
                    getItems: () => mockItems
                }),
                getParameter: (param) => param === "total" ? 3 : null
            };

            controller.onUpdateFinished(oEvent);
            const viewModel = controller.getView().getModel("salesInquiriesView");
            expect(viewModel.getProperty("/totalCount")).toBe(3);
            expect(viewModel.getProperty("/openCount")).toBe(2);
            expect(viewModel.getProperty("/customerCount")).toBe(2);
        });
    });

    describe("Navigation", () => {
        it("onNavigateToCreateInquiry routes to createSalesInquiry", () => {
            controller.onNavigateToCreateInquiry();
            expect(mockRouter.navTo).toHaveBeenCalledWith("createSalesInquiry");
        });

        it("onInquiryPress routes to salesInquiryDetail with key", () => {
            const oEvent = {
                getParameter: () => ({
                    getBindingContext: () => ({
                        getProperty: (prop) => prop === "SalesInquiry" ? "10000001" : ""
                    })
                })
            };

            controller.onInquiryPress(oEvent);
            expect(mockRouter.navTo).toHaveBeenCalledWith("salesInquiryDetail", {
                SalesInquiry: "10000001"
            });
        });
    });

    describe("Search and Refresh", () => {
        it("onSearch applies multi-attribute filter", () => {
            const oEvent = {
                getParameter: () => "Bajaj"
            };
            controller.onSearch(oEvent);
            expect(mockBinding.filter).toHaveBeenCalledWith(
                expect.any(Array),
                MockFilterType.Application
            );
        });

        it("onSearch with empty query clears filters", () => {
            const oEvent = {
                getParameter: () => ""
            };
            controller.onSearch(oEvent);
            expect(mockBinding.filter).toHaveBeenCalledWith([], MockFilterType.Application);
        });

        it("onRefresh triggers binding refresh", () => {
            controller.onRefresh();
            expect(mockBinding.refresh).toHaveBeenCalled();
        });
    });

    describe("Create Sales Quote Action (Table Row Level)", () => {
        beforeEach(() => {
            mockMessageBox.confirm.mockReset();
            mockMessageBox.success.mockReset();
            mockMessageBox.error.mockReset();
            mockMessageToast.show.mockReset();
            mockBusyIndicator.show.mockReset();
            mockBusyIndicator.hide.mockReset();
            mockMessageBox.warning.mockReset();
            mockSalesInquiryService.createSalesQuote.mockReset();
            mockSalesInquiryService.getSalesInquiry.mockReset().mockResolvedValue({
                header: { ShipToParty: "10003", ShipToPartyName: "Aarti Drugs Ltd" },
                items: [{ SalesInquiryItem: "000010", Material: "4000000085", RequestedQuantity: "50" }]
            });
            mockFragment.load.mockReset().mockResolvedValue(mockDialog);
            mockDialog.open.mockReset();
            mockDialog.close.mockReset();
            controller._oCreateQuoteDialog = null;
        });

        it("shows guidance toast when invoked without any row context or table selection", () => {
            mockTable.getSelectedItem = jest.fn().mockReturnValue(null);
            controller.onCreateSalesQuote();
            expect(mockMessageToast.show).toHaveBeenCalledWith(
                "Please select or click 'Create Sales Quote' on an inquiry row."
            );
            expect(mockFragment.load).not.toHaveBeenCalled();
        });

        it("opens dialog fragment and sets up quoteDialog model with prefilled inquiry data", async () => {
            const mockContext = {
                getObject: () => ({
                    SalesInquiry: "1000539",
                    SoldToParty: "10003",
                    OrganizationBPName1: "Aarti Drugs Ltd",
                    ShipToParty: "10003",
                    ShipToPartyName: "Aarti Drugs Ltd",
                    SalesOrganization: "1000",
                    DistributionChannel: "10",
                    OrganizationDivision: "52",
                    TotalNetAmount: "123000.00",
                    TransactionCurrency: "INR",
                    PurchaseOrderByCustomer: "PO-INQ-99",
                    CustomerPurchaseOrderDate: "2026-03-01",
                    to_Items: [{ SalesInquiryItem: "000010", Material: "4000000085" }]
                }),
                getProperty: (prop) => prop === "SalesInquiry" ? "1000539" : null
            };

            const oEvent = {
                getSource: () => ({
                    getBindingContext: (modelName) => modelName === "salesInquiry" ? mockContext : null
                })
            };

            controller.onCreateSalesQuote(oEvent);

            const oDialogModel = controller.getView().getModel("quoteDialog");
            expect(oDialogModel).toBeDefined();
            const data = oDialogModel.getData();
            expect(data.SalesInquiry).toBe("1000539");
            expect(data.SoldToParty).toBe("10003");
            expect(data.OrganizationBPName1).toBe("Aarti Drugs Ltd");
            expect(data.SalesOrganization).toBe("1000");
            expect(data.DistributionChannel).toBe("10");
            expect(data.OrganizationDivision).toBe("52");
            expect(data.SalesQuotationType).toBe("ZQT");
            expect(data.SalesQuotationDate).toBeDefined();
            expect(data.BindingPeriodValidityEndDate).toBeDefined();
            expect(data.PurchaseOrderByCustomer).toBe("PO-INQ-99");
            expect(data.CustomerPurchaseOrderDate).toBe("2026-03-01");
            expect(data.items).toHaveLength(1);

            expect(mockFragment.load).toHaveBeenCalledWith({
                id: "mockViewId",
                name: "saps4hana.fiori.modules.sd.sales-inquiry.view.CreateQuoteFromInquiryDialog",
                controller: controller
            });

            await Promise.resolve(); // Wait for Fragment.load promise resolution
            expect(mockDialog.open).toHaveBeenCalled();
        });

        it("enriches quoteDialog model with items and ship-to when getSalesInquiry resolves if row has no items", async () => {
            const mockContext = {
                getObject: () => ({
                    SalesInquiry: "1000538",
                    SoldToParty: "10002",
                    CustomerName: "Aarti Drugs Limited (N-198)",
                    TotalNetAmount: "194300.00",
                    TransactionCurrency: "INR"
                }),
                getProperty: () => "1000538"
            };

            mockTable.getSelectedItem = jest.fn().mockReturnValue({
                getBindingContext: () => mockContext
            });

            controller.onCreateSalesQuote();

            const oDialogModel = controller.getView().getModel("quoteDialog");
            expect(oDialogModel).toBeDefined();
            expect(mockSalesInquiryService.getSalesInquiry).toHaveBeenCalledWith("1000538");

            await Promise.resolve();
            await Promise.resolve();

            expect(oDialogModel.getProperty("/items")).toHaveLength(1);
            expect(oDialogModel.getProperty("/ShipToParty")).toBe("10003");
        });

        it("reuses already loaded dialog instance if opened a second time", () => {
            controller._oCreateQuoteDialog = mockDialog;
            const mockContext = {
                getObject: () => ({ SalesInquiry: "1000539", SoldToParty: "10003", to_Items: [] })
            };
            const oEvent = {
                getSource: () => ({ getBindingContext: () => mockContext })
            };

            controller.onCreateSalesQuote(oEvent);

            expect(mockFragment.load).not.toHaveBeenCalled();
            expect(mockDialog.open).toHaveBeenCalled();
        });

        it("_checkInquiryQuotationReadiness flags missing Contact Person in business language", () => {
            const oModel = new MockJSONModel({ SalesInquiry: "1000537" });
            const oHeader = { SalesInquiry: "1000537" }; // lacks ContactPerson
            controller._checkInquiryQuotationReadiness(oModel, oHeader);

            expect(oModel.getProperty("/isIncomplete")).toBe(true);
            expect(oModel.getProperty("/missingFields")).toEqual([
                "Contact Person"
            ]);
            expect(oModel.getProperty("/incompletionMessage")).toContain("Inquiry 1000537 is incomplete in SAP (missing: Contact Person).");
        });

        it("onConfirmCreateSalesQuote blocks creation and shows error when inquiry is incomplete", () => {
            const oModel = new MockJSONModel({
                SalesInquiry: "1000537",
                isIncomplete: true,
                incompletionMessage: "Inquiry 1000537 is incomplete in SAP (missing: Customer Group 2, Port of Loading, Port of Discharge, Contact Person). Maintain these fields in SAP (transaction VA22) before creating a Sales Quotation.",
                SalesQuotationType: "ZQT",
                SalesQuotationDate: "2026-03-14",
                BindingPeriodValidityEndDate: "2026-04-14"
            });
            controller.getView().setModel(oModel, "quoteDialog");

            controller.onConfirmCreateSalesQuote();
            expect(mockMessageBox.error).toHaveBeenCalledWith(
                expect.stringContaining("Inquiry 1000537 is incomplete in SAP (missing: Customer Group 2, Port of Loading, Port of Discharge, Contact Person)."),
                expect.objectContaining({ title: "Incomplete Inquiry" })
            );
            expect(mockSalesInquiryService.createSalesQuote).not.toHaveBeenCalled();
        });

        it("onConfirmCreateSalesQuote validates mandatory fields", () => {
            const oModel = new MockJSONModel({
                SalesInquiry: "1000539",
                SalesQuotationType: "",
                SalesQuotationDate: "",
                BindingPeriodValidityEndDate: ""
            });
            controller.getView().setModel(oModel, "quoteDialog");

            controller.onConfirmCreateSalesQuote();
            expect(mockMessageBox.error).toHaveBeenCalledWith("Please select a Quotation Type.");

            oModel.setProperty("/SalesQuotationType", "ZQT");
            controller.onConfirmCreateSalesQuote();
            expect(mockMessageBox.error).toHaveBeenCalledWith("Please specify a Quotation Date.");

            oModel.setProperty("/SalesQuotationDate", "2026-03-14");
            controller.onConfirmCreateSalesQuote();
            expect(mockMessageBox.error).toHaveBeenCalledWith("Please specify a Valid-To Date.");
        });

        it("onConfirmCreateSalesQuote validates that Valid-To Date is not earlier than Quotation Date", () => {
            const oModel = new MockJSONModel({
                SalesInquiry: "1000539",
                SalesQuotationType: "ZQT",
                SalesQuotationDate: "2026-03-14",
                BindingPeriodValidityEndDate: "2026-03-01"
            });
            controller.getView().setModel(oModel, "quoteDialog");

            controller.onConfirmCreateSalesQuote();
            expect(mockMessageBox.error).toHaveBeenCalledWith("Valid-To Date cannot be earlier than Quotation Date.");
            expect(mockSalesInquiryService.createSalesQuote).not.toHaveBeenCalled();
        });

        it("onConfirmCreateSalesQuote closes dialog, shows BusyIndicator, calls service, and shows success MessageBox on completion", async () => {
            controller._oCreateQuoteDialog = mockDialog;
            const oModel = new MockJSONModel({
                SalesInquiry: "1000539",
                SalesQuotationType: "ZQT",
                SalesQuotationDate: "2026-03-14",
                BindingPeriodValidityEndDate: "2026-04-14",
                PurchaseOrderByCustomer: "PO-REF-100",
                CustomerPurchaseOrderDate: "2026-03-14"
            });
            controller.getView().setModel(oModel, "quoteDialog");

            mockSalesInquiryService.createSalesQuote.mockResolvedValue("2000045");

            controller.onConfirmCreateSalesQuote();
            // Nothing is sent to SAP before the user confirms.
            expect(mockSalesInquiryService.createSalesQuote).not.toHaveBeenCalled();
            expect(mockMessageBox.confirm).toHaveBeenCalledWith(
                expect.stringContaining("This action creates a real Sales Quotation in SAP and cannot be treated as a preview."),
                expect.objectContaining({ title: "Create Sales Quotation in SAP?" })
            );
            expect(mockMessageBox.confirm.mock.calls[0][0]).toContain("Inquiry: 1000539");
            expect(mockMessageBox.confirm.mock.calls[0][0]).toContain("Quotation Type: ZQT");

            const confirmOptions = mockMessageBox.confirm.mock.calls[0][1];
            mockSalesInquiryService.createSalesQuote.mockClear();
            let promise;
            const originalCreate = controller._createSalesQuoteInSap.bind(controller);
            controller._createSalesQuoteInSap = (oData) => { promise = originalCreate(oData); return promise; };
            confirmOptions.onClose("OK");

            expect(mockDialog.close).toHaveBeenCalled();
            expect(mockBusyIndicator.show).toHaveBeenCalledWith(0);
            expect(mockSalesInquiryService.createSalesQuote).toHaveBeenCalledWith({
                SalesInquiry: "1000539",
                SalesQuotationType: "ZQT",
                SalesQuotationDate: "2026-03-14",
                BindingPeriodValidityEndDate: "2026-04-14",
                PurchaseOrderByCustomer: "PO-REF-100",
                CustomerPurchaseOrderDate: "2026-03-14",
                CustomerGroup2: "",
                PortOfLoading: "",
                PortOfDischarge: "",
                ContactPerson: ""
            });

            await promise;

            expect(mockBusyIndicator.hide).toHaveBeenCalled();
            expect(mockMessageBox.success).toHaveBeenCalledWith(
                expect.stringContaining("Sales Quotation 2000045 created successfully with reference to Sales Inquiry 1000539."),
                expect.objectContaining({ title: "Sales Quotation Created" })
            );
        });

        it("onConfirmCreateSalesQuote displays error message when service call fails", async () => {
            controller._oCreateQuoteDialog = mockDialog;
            const oModel = new MockJSONModel({
                SalesInquiry: "1000539",
                SalesQuotationType: "ZQT",
                SalesQuotationDate: "2026-03-14",
                BindingPeriodValidityEndDate: "2026-04-14",
                PurchaseOrderByCustomer: "PO-REF-100",
                CustomerPurchaseOrderDate: "2026-03-14"
            });
            controller.getView().setModel(oModel, "quoteDialog");

            mockSalesInquiryService.createSalesQuote.mockRejectedValue(new Error("Inquiry 1000539 is incomplete in SAP and cannot be converted to a Sales Quotation. Complete the inquiry in VA22 before creating the quotation."));

            controller.onConfirmCreateSalesQuote();
            const confirmOptions = mockMessageBox.confirm.mock.calls[mockMessageBox.confirm.mock.calls.length - 1][1];
            let promise;
            const originalCreate = controller._createSalesQuoteInSap.bind(controller);
            controller._createSalesQuoteInSap = (oData) => { promise = originalCreate(oData); return promise; };
            confirmOptions.onClose("OK");
            await promise;

            expect(mockBusyIndicator.hide).toHaveBeenCalled();
            expect(mockMessageBox.error).toHaveBeenCalledWith(
                expect.stringContaining("Inquiry 1000539 is incomplete in SAP and cannot be converted to a Sales Quotation. Complete the inquiry in VA22 before creating the quotation."),
                expect.objectContaining({ title: "SAP S/4HANA Error" })
            );
        });

        it("onConfirmCreateSalesQuote sends nothing to SAP when the user cancels the confirmation", () => {
            controller._oCreateQuoteDialog = mockDialog;
            controller.getView().setModel(new MockJSONModel({
                SalesInquiry: "1000540", SalesQuotationType: "ZQT",
                SalesQuotationDate: "2026-09-14", BindingPeriodValidityEndDate: "2026-10-14"
            }), "quoteDialog");
            mockSalesInquiryService.createSalesQuote.mockClear();
            mockMessageBox.confirm.mockClear();

            controller.onConfirmCreateSalesQuote();
            mockMessageBox.confirm.mock.calls[0][1].onClose("CANCEL");

            expect(mockSalesInquiryService.createSalesQuote).not.toHaveBeenCalled();
            expect(mockBusyIndicator.show).not.toHaveBeenCalled();
        });

        it("onCancelCreateSalesQuote closes the dialog", () => {
            controller._oCreateQuoteDialog = mockDialog;
            controller.onCancelCreateSalesQuote();
            expect(mockDialog.close).toHaveBeenCalled();
        });

        it("onOpenInquiryInVa22 opens SAP WebGUI with encoded inquiry ID when inquiry ID is present", () => {
            const openSpy = jest.spyOn(global.window, "open").mockImplementation(() => {});
            controller.getView().setModel(new MockJSONModel({
                SalesInquiry: "1000540"
            }), "quoteDialog");
            controller.onOpenInquiryInVa22();
            expect(openSpy).toHaveBeenCalledWith(
                "/sap/bc/gui/sap/its/webgui?~transaction=*VA22%20VBAK-VBELN=1000540",
                "_blank"
            );
            openSpy.mockRestore();
        });

        it("onOpenInquiryInVa22 warns when no inquiry ID is present in dialog model", () => {
            const openSpy = jest.spyOn(global.window, "open").mockImplementation(() => {});
            controller.getView().setModel(new MockJSONModel({
                SalesInquiry: ""
            }), "quoteDialog");
            controller.onOpenInquiryInVa22();
            expect(mockMessageBox.warning).toHaveBeenCalledWith(
                "No Sales Inquiry selected to open in VA22."
            );
            expect(openSpy).not.toHaveBeenCalled();
            openSpy.mockRestore();
        });

        it("onRecheckInquiryStatus re-runs pre-flight check server-side and clears incompletion without re-binding", async () => {
            const oDialogModel = new MockJSONModel({
                SalesInquiry: "1000540",
                isIncomplete: true,
                isRechecking: false,
                incompletionMessage: "Inquiry 1000540 is incomplete in SAP",
                missingFields: ["Customer Group 2", "Port of Loading", "Port of Discharge"]
            });
            controller.getView().setModel(oDialogModel, "quoteDialog");

            mockSalesInquiryService.getInquiryCompleteness.mockResolvedValue({
                complete: true,
                missingFields: []
            });

            await controller.onRecheckInquiryStatus();

            expect(mockBusyIndicator.show).toHaveBeenCalled();
            expect(mockBusyIndicator.hide).toHaveBeenCalled();
            expect(mockSalesInquiryService.getInquiryCompleteness).toHaveBeenCalledWith("1000540");
            expect(mockSalesInquiryService.getSalesInquiry).not.toHaveBeenCalled();
            expect(oDialogModel.getProperty("/isRechecking")).toBe(false);
            expect(oDialogModel.getProperty("/isIncomplete")).toBe(false);
            expect(oDialogModel.getProperty("/missingFields")).toEqual([]);
            expect(oDialogModel.getProperty("/incompletionMessage")).toBe("");
            expect(mockMessageToast.show).toHaveBeenCalledWith(
                expect.stringContaining("complete in SAP. You can now create the Sales Quotation.")
            );
        });

        it("onRecheckInquiryStatus re-runs pre-flight check and keeps isIncomplete=true when SAP still misses fields", async () => {
            const oDialogModel = new MockJSONModel({
                SalesInquiry: "1000540",
                isIncomplete: true,
                isRechecking: false,
                incompletionMessage: "Old message",
                missingFields: []
            });
            controller.getView().setModel(oDialogModel, "quoteDialog");

            mockSalesInquiryService.getInquiryCompleteness.mockResolvedValue({
                complete: false,
                missingFields: ["Customer Group 2", "Port of Loading", "Port of Discharge"]
            });

            await controller.onRecheckInquiryStatus();

            expect(oDialogModel.getProperty("/isRechecking")).toBe(false);
            expect(oDialogModel.getProperty("/isIncomplete")).toBe(true);
            expect(oDialogModel.getProperty("/missingFields")).toEqual([
                "Customer Group 2", "Port of Loading", "Port of Discharge"
            ]);
            expect(mockMessageToast.show).toHaveBeenCalledWith(
                expect.stringContaining("still incomplete in SAP")
            );
        });

        it("onRecheckInquiryStatus prevents overlapping requests when re-check is already in flight", async () => {
            const oDialogModel = new MockJSONModel({
                SalesInquiry: "1000540",
                isRechecking: true
            });
            controller.getView().setModel(oDialogModel, "quoteDialog");

            await controller.onRecheckInquiryStatus();

            expect(mockSalesInquiryService.getInquiryCompleteness).not.toHaveBeenCalled();
            expect(mockBusyIndicator.show).not.toHaveBeenCalled();
        });

        it("onRecheckInquiryStatus warns when no inquiry is set in dialog model", async () => {
            controller.getView().setModel(new MockJSONModel({
                SalesInquiry: ""
            }), "quoteDialog");

            await controller.onRecheckInquiryStatus();

            expect(mockMessageBox.warning).toHaveBeenCalledWith("No Sales Inquiry selected to re-check.");
            expect(mockSalesInquiryService.getInquiryCompleteness).not.toHaveBeenCalled();
        });

        it("onRecheckInquiryStatus handles service failure with MessageBox.error and resets isRechecking", async () => {
            const oDialogModel = new MockJSONModel({
                SalesInquiry: "1000540",
                isRechecking: false
            });
            controller.getView().setModel(oDialogModel, "quoteDialog");

            mockSalesInquiryService.getInquiryCompleteness.mockRejectedValue(new Error("SAP connection timeout"));

            await controller.onRecheckInquiryStatus();

            expect(mockBusyIndicator.hide).toHaveBeenCalled();
            expect(oDialogModel.getProperty("/isRechecking")).toBe(false);
            expect(mockMessageBox.error).toHaveBeenCalledWith(
                "SAP connection timeout",
                expect.objectContaining({ title: "Re-check Failed" })
            );
        });

        it("_checkInquiryQuotationReadiness rejects name-only or non-numeric Contact Person", () => {
            const oModel = new MockJSONModel({ SalesInquiry: "1000540" });
            const oHeader = {
                SalesInquiry: "1000540",
                CustomerGroup2: "SEA",
                PortOfLoading: "INNSA",
                PortOfDischarge: "SGSIN",
                ContactPerson: "", // empty partner
                ContactPersonName: "John Doe" // display name only
            };
            controller._checkInquiryQuotationReadiness(oModel, oHeader);

            expect(oModel.getProperty("/isIncomplete")).toBe(true);
            expect(oModel.getProperty("/missingFields")).toEqual(["Contact Person"]);
            expect(oModel.getProperty("/incompletionMessage")).toContain("missing: Contact Person");
        });

        it("onCopyInquiryNumber writes inquiry ID to clipboard and shows toast", async () => {
            const writeTextMock = jest.fn().mockResolvedValue();
            const originalNavigator = global.navigator;
            global.navigator = { clipboard: { writeText: writeTextMock } };

            controller.getView().setModel(new MockJSONModel({
                SalesInquiry: "1000540"
            }), "quoteDialog");

            controller.onCopyInquiryNumber();
            expect(writeTextMock).toHaveBeenCalledWith("1000540");

            await Promise.resolve(); // wait for promise resolution
            expect(mockMessageToast.show).toHaveBeenCalledWith("Inquiry number 1000540 copied to clipboard.");

            global.navigator = originalNavigator;
        });

        it("onCopyInquiryNumber warns when no inquiry ID is present", () => {
            controller.getView().setModel(new MockJSONModel({
                SalesInquiry: ""
            }), "quoteDialog");

            controller.onCopyInquiryNumber();
            expect(mockMessageToast.show).toHaveBeenCalledWith("No Sales Inquiry number to copy.");
        });

        describe("Incomplete Inquiry Handling", () => {
            it("blocks creation if inquiry is incomplete in SAP", () => {
                const oDialogModel = new MockJSONModel({
                    SalesInquiry: "1000540",
                    isIncomplete: true,
                    incompletionMessage: "Inquiry 1000540 is incomplete in SAP (missing: Customer Group 2)."
                });
                controller.getView().setModel(oDialogModel, "quoteDialog");

                controller.onConfirmCreateSalesQuote();
                expect(mockMessageBox.error).toHaveBeenCalledWith(
                    expect.stringContaining("Inquiry 1000540 is incomplete in SAP"),
                    expect.objectContaining({ title: "Incomplete Inquiry" })
                );
                expect(mockSalesInquiryService.createSalesQuote).not.toHaveBeenCalled();
            });

            it("onQuoteFieldChange re-evaluates readiness and clears incompletion when contact person is supplied", () => {
                const oDialogModel = new MockJSONModel({
                    SalesInquiry: "1000540",
                    isIncomplete: true,
                    missingFields: ["Contact Person"],
                    ContactPerson: ""
                });
                controller.getView().setModel(oDialogModel, "quoteDialog");

                // User types numeric contact person
                oDialogModel.setProperty("/ContactPerson", "24789");
                controller.onQuoteFieldChange();

                expect(oDialogModel.getProperty("/isIncomplete")).toBe(false);
                expect(oDialogModel.getProperty("/missingFields")).toEqual([]);
                expect(oDialogModel.getProperty("/incompletionMessage")).toBe("");
            });
        });
    });
});
