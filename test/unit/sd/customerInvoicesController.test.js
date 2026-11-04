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
    constructor(config, operator, value) {
        this.config = config;
        this.operator = operator;
        this.value = value;
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
        const dialogModels = {};
        return Promise.resolve({
            setModel: jest.fn((model, name) => { dialogModels[name] = model; }),
            getModel: jest.fn((name) => dialogModels[name]),
            open: jest.fn(),
            close: jest.fn()
        });
    })
};

const MockMessaging = {
    getMessageModel: jest.fn().mockReturnValue(new MockJSONModel([]))
};

const MockBusyIndicator = {
    show: jest.fn(),
    hide: jest.fn()
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
                    MockMessaging,
                    MockBusyIndicator,
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

    const leaf = (config, operator, value) => ({ config, operator, value });
    const selectTab = (sKey) => controller.onTabSelect({ getParameter: () => sKey, getSource: jest.fn() });

    test("onTabSelect stores the selected tab", () => {
        controller.onInit();
        selectTab("pending");
        expect(models["customerInvoicesView"].getProperty("/selectedTab")).toBe("pending");
    });

    test.each([
        ["pending", { config: { filters: [leaf("AccountingTransferStatus", "NE", "C"), leaf("BillingDocumentIsCancelled", "EQ", false)], and: true } }],
        ["transferred", { config: { filters: [leaf("AccountingTransferStatus", "EQ", "C"), leaf("BillingDocumentIsCancelled", "EQ", false)], and: true } }],
        ["cancelled", leaf("BillingDocumentIsCancelled", "EQ", true)]
    ])("onTabSelect '%s' filters the table on that tab's status", (sTab, oExpected) => {
        controller.onInit();
        selectTab(sTab);
        expect(mockBinding.filter).toHaveBeenCalledTimes(1);
        expect(mockBinding.filter.mock.calls[0][0].config).toEqual({ filters: [oExpected], and: true });
    });

    test("onTabSelect 'all' clears the table filter", () => {
        controller.onInit();
        selectTab("all");
        expect(mockBinding.filter).toHaveBeenCalledWith(null);
    });

    test("onSearch stores the query and ORs a Contains filter on the four searchable fields", () => {
        controller.onInit();
        const oEvent = {
            getParameter: jest.fn().mockReturnValue("31000111"),
            getSource: jest.fn()
        };
        controller.onSearch(oEvent);

        expect(models["customerInvoicesView"].getProperty("/searchQuery")).toBe("31000111");
        expect(mockBinding.filter.mock.calls[0][0].config).toEqual({
            filters: [{
                config: {
                    filters: [
                        leaf("BillingDocument", "Contains", "31000111"),
                        leaf("SoldToPartyFullName", "Contains", "31000111"),
                        leaf("SoldToParty", "Contains", "31000111"),
                        leaf("BillingDocumentType", "Contains", "31000111")
                    ],
                    and: false
                }
            }],
            and: true
        });
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
        await Promise.resolve();
        await Promise.resolve();

        expect(MockMessageBox.confirm).toHaveBeenCalled();
        expect(MockCustomerInvoiceService.releaseInvoiceToAccounting).toHaveBeenCalledWith(
            "31000111",
            undefined
        );
        expect(MockBusyIndicator.show).toHaveBeenCalled();
        expect(MockBusyIndicator.hide).toHaveBeenCalled();
    });

    const pressCancelOn = (oRow) => controller.onCancelInvoicePress({
        getSource: () => ({
            getBindingContext: () => ({ getObject: () => oRow })
        })
    });

    test("onCancelInvoicePress opens the dialog for the pressed row", async () => {
        controller.onInit();

        pressCancelOn({ BillingDocument: "31000198", SoldToPartyFullName: "Test" });
        await controller._pCancelDialog;

        expect(controller._oCancelDialog.open).toHaveBeenCalledTimes(1);
        expect(controller._oCancelDialog.getModel("cancelInvoiceModel").getProperty("/BillingDocument")).toBe("31000198");
    });

    test("onConfirmCancelInvoice cancels the document of the pressed row and reports the reversal document", async () => {
        controller.onInit();
        pressCancelOn({ BillingDocument: "31000198", SoldToPartyFullName: "Test" });
        await controller._pCancelDialog;

        controller.onConfirmCancelInvoice();
        await Promise.resolve();
        await Promise.resolve();

        expect(MockCustomerInvoiceService.cancelBillingDocument).toHaveBeenCalledWith("31000198", undefined);
        expect(MockBusyIndicator.show).toHaveBeenCalledWith(0);
        expect(MockBusyIndicator.hide).toHaveBeenCalledTimes(1);
        expect(MockMessageBox.success).toHaveBeenCalledWith("msgCancelInvoiceSuccessWithDoc 31000198 90000053", expect.any(Object));
    });

    test("onInvoiceSelectionChange updates selection state and flags", () => {
        controller.onInit();
        const mockInvoiceB = {
            BillingDocument: "31000111",
            AccountingTransferStatus: "B",
            BillingDocumentIsCancelled: false
        };
        let currentSelected = mockInvoiceB;
        const oEvent = {
            getSource: () => ({
                getSelectedItem: () => ({
                    getBindingContext: () => ({
                        getObject: () => currentSelected
                    })
                })
            })
        };

        controller.onInvoiceSelectionChange(oEvent);

        const viewModel = models["customerInvoicesView"];
        expect(viewModel.getProperty("/hasSelectedInvoice")).toBe(true);
        expect(viewModel.getProperty("/canReleaseSelected")).toBe(true);
        expect(viewModel.getProperty("/canCancelSelected")).toBe(true);
        expect(viewModel.getProperty("/selectedInvoice")).toEqual(mockInvoiceB);

        // Status A (Posting Blocked) should NOT allow direct release
        currentSelected = {
            BillingDocument: "31000055",
            AccountingTransferStatus: "A",
            BillingDocumentIsCancelled: false
        };
        controller.onInvoiceSelectionChange(oEvent);
        expect(viewModel.getProperty("/canReleaseSelected")).toBe(false);
    });

    test("onInvoiceSelectionChange handles deselection", () => {
        controller.onInit();
        const oEvent = {
            getSource: () => ({
                getSelectedItem: () => null
            })
        };

        controller.onInvoiceSelectionChange(oEvent);

        const viewModel = models["customerInvoicesView"];
        expect(viewModel.getProperty("/hasSelectedInvoice")).toBe(false);
        expect(viewModel.getProperty("/canReleaseSelected")).toBe(false);
        expect(viewModel.getProperty("/canCancelSelected")).toBe(false);
        expect(viewModel.getProperty("/selectedInvoice")).toBeNull();
    });

    test("onToolbarReleasePress prompts confirmation and releases selected invoice", () => {
        controller.onInit();
        const viewModel = models["customerInvoicesView"];
        viewModel.setProperty("/selectedInvoice", { BillingDocument: "31000111" });

        controller.onToolbarReleasePress();

        expect(MockMessageBox.confirm).toHaveBeenCalled();
        expect(MockCustomerInvoiceService.releaseInvoiceToAccounting).toHaveBeenCalledWith(
            "31000111",
            undefined
        );
    });

    test("onToolbarCancelPress opens cancel dialog for selected invoice", async () => {
        controller.onInit();
        const viewModel = models["customerInvoicesView"];
        viewModel.setProperty("/selectedInvoice", { BillingDocument: "31000112" });

        controller.onToolbarCancelPress();
        await controller._pCancelDialog;

        expect(controller._oCancelDialog.open).toHaveBeenCalledTimes(1);
        expect(controller._oCancelDialog.getModel("cancelInvoiceModel").getProperty("/BillingDocument")).toBe("31000112");
    });

    test("formatters correctly handle status E, B, A, blank and category N", () => {
        expect(controller.formatInvoiceStatusText(false, "E")).toBe("statusCancelled");
        expect(controller.formatInvoiceStatusText(false, "A", "N")).toBe("statusCancelled");
        expect(controller.formatInvoiceStatusText(false, "B")).toBe("statusAccountDeterminationError");
        expect(controller.formatInvoiceStatusText(false, "A")).toBe("statusPostingBlocked");
        expect(controller.formatInvoiceStatusText(false, "")).toBe("statusAccountingInterfaceError");
        expect(controller.formatInvoiceStatusState(false, "E")).toBe("Error");
        expect(controller.formatInvoiceStatusState(false, "B")).toBe("Error");
        expect(controller.formatInvoiceStatusState(false, "A")).toBe("Warning");
        expect(controller.formatInvoiceStatusIcon(false, "E")).toBe("sap-icon://sys-cancel");
        expect(controller.formatInvoiceStatusIcon(false, "A")).toBe("sap-icon://locked");
        expect(controller.formatInvoiceStatusIcon(false, "B")).toBe("sap-icon://alert");

        expect(controller.formatReleaseEnabled(false, "E", "M")).toBe(false);
        expect(controller.formatReleaseEnabled(false, "A", "N")).toBe(false);
        expect(controller.formatReleaseEnabled(false, "C", "M")).toBe(false);
        expect(controller.formatReleaseEnabled(false, "D", "M")).toBe(false);
        expect(controller.formatReleaseEnabled(false, "A", "M")).toBe(false);
        expect(controller.formatReleaseEnabled(false, "B", "M")).toBe(true);

        expect(controller.formatCancelEnabled(false, "E", "M")).toBe(false);
        expect(controller.formatCancelEnabled(false, "A", "N")).toBe(false);
        expect(controller.formatCancelEnabled(false, "A", "M")).toBe(true);
    });

    describe("Optimistic concurrency and ETag handling (Phase 4)", () => {
        test("onToolbarReleasePress forwards ETag to service when available", () => {
            controller.onInit();
            const viewModel = models["customerInvoicesView"];
            viewModel.setProperty("/selectedInvoice", {
                BillingDocument: "31000111",
                "@odata.etag": 'W/"20261028130000"'
            });

            controller.onToolbarReleasePress();

            expect(MockMessageBox.confirm).toHaveBeenCalled();
            expect(MockCustomerInvoiceService.releaseInvoiceToAccounting).toHaveBeenCalledWith(
                "31000111",
                undefined,
                { etag: 'W/"20261028130000"' }
            );
        });

        test("onConfirmCancelInvoice forwards the ETag of the pressed row to the service", async () => {
            controller.onInit();
            controller.onCancelInvoicePress({
                getSource: () => ({
                    getBindingContext: () => ({
                        getObject: () => ({
                            BillingDocument: "31000112",
                            "@odata.etag": 'W/"20261028140000"'
                        })
                    })
                })
            });
            await controller._pCancelDialog;

            await controller.onConfirmCancelInvoice();

            expect(MockCustomerInvoiceService.cancelBillingDocument).toHaveBeenCalledWith(
                "31000112",
                undefined,
                { etag: 'W/"20261028140000"' }
            );
        });

        test("_extractErrorMessage keeps SAP's own text for a 409 that has one", () => {
            const err409 = { status: 409, message: "Resource changed by another user" };
            expect(controller._extractErrorMessage(err409, "fallback")).toBe("Resource changed by another user");
        });

        test.each([
            ["status 409", { status: 409 }],
            ["statusCode 409", { statusCode: 409 }],
            ["code STALE_DATA", { code: "STALE_DATA" }]
        ])("_extractErrorMessage gives the stale-data guidance for %s without a message", (_label, oErr) => {
            expect(controller._extractErrorMessage(oErr, "fallback")).toContain("modified by another user or session in SAP S/4HANA (stale data)");
        });

        test("_extractErrorMessage uses the fallback text for an unrelated error without a message", () => {
            expect(controller._extractErrorMessage({ status: 500 }, "fallback")).toBe("fallback");
        });
    });
});
