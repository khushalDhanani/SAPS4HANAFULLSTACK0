sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/core/Fragment",
    "sap/ui/core/Messaging",
    "sap/ui/core/BusyIndicator",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "saps4hana/fiori/modules/sd/customer-invoice/service/CustomerInvoiceService",
    "saps4hana/fiori/modules/sd/customer-invoice/controller/CustomerInvoiceFilterManager",
    "saps4hana/fiori/modules/sd/customer-invoice/controller/CustomerInvoiceActionCoordinator",
    "saps4hana/fiori/modules/sd/customer-invoice/controller/CustomerInvoiceFormatters"
], function (
    Controller,
    JSONModel,
    Filter,
    FilterOperator,
    Fragment,
    Messaging,
    BusyIndicator,
    MessageBox,
    MessageToast,
    CustomerInvoiceService,
    CustomerInvoiceFilterManager,
    CustomerInvoiceActionCoordinator,
    CustomerInvoiceFormatters
) {
    "use strict";

    var isNode = typeof module !== "undefined" && module.exports;
    function req(mod, path) {
        if (mod && Object.keys(mod).length > 0) { return mod; }
        if (isNode) {
            try { return require(path); } catch (e) { return {}; }
        }
        return mod || {};
    }

    var modFilters = req(CustomerInvoiceFilterManager, "./CustomerInvoiceFilterManager");
    var modActions = req(CustomerInvoiceActionCoordinator, "./CustomerInvoiceActionCoordinator");
    var modFormatters = req(CustomerInvoiceFormatters, "./CustomerInvoiceFormatters");

    var fnFilters = typeof createCustomerInvoiceFilterManager === "function" ? createCustomerInvoiceFilterManager : (modFilters && modFilters.createCustomerInvoiceFilterManager);
    var fnActions = typeof createCustomerInvoiceActionCoordinator === "function" ? createCustomerInvoiceActionCoordinator : (modActions && modActions.createCustomerInvoiceActionCoordinator);
    var fnFormatters = typeof createCustomerInvoiceFormatters === "function" ? createCustomerInvoiceFormatters : (modFormatters && modFormatters.createCustomerInvoiceFormatters);

    var mFilters = typeof fnFilters === "function" ? fnFilters({
        Filter: Filter,
        FilterOperator: FilterOperator,
        CustomerInvoiceService: CustomerInvoiceService
    }) : {};

    var mActions = typeof fnActions === "function" ? fnActions({
        Fragment: Fragment,
        Messaging: Messaging,
        BusyIndicator: BusyIndicator,
        MessageBox: MessageBox,
        CustomerInvoiceService: CustomerInvoiceService,
        JSONModel: JSONModel
    }) : {};

    var mFormatters = typeof fnFormatters === "function" ? fnFormatters() : {};

    var oMembers = {
        onInit: function () {
            var oViewModel = new JSONModel({
                totalInvoices: 0,
                pendingAccountingCount: 0,
                transferredCount: 0,
                cancelledCount: 0,
                displayCount: 0,
                selectedTab: "all",
                searchQuery: "",
                hasSelectedInvoice: false,
                canReleaseSelected: false,
                canCancelSelected: false,
                selectedInvoice: null
            });
            this.getView().setModel(oViewModel, "customerInvoicesView");

            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("customerInvoices").attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function () {
            var oModel = this.getView().getModel("customerInvoice");
            if (oModel) {
                CustomerInvoiceService.setModel(oModel);
            }
            this._loadMetrics();
            this._applyFilters();
        },

        onRefresh: function () {
            this._resetSelection();
            this._loadMetrics();
            var oTable = this.byId("tblCustomerInvoices");
            if (oTable) {
                var oBinding = oTable.getBinding("items");
                if (oBinding) {
                    oBinding.refresh();
                }
            }
            MessageToast.show(this._getText("msgInvoicesRefreshed"));
        },

        _getText: function (sKey, aArgs, sFallback) {
            var oI18n = this.getView() && typeof this.getView().getModel === "function" ? this.getView().getModel("i18n") : null;
            var oResourceBundle = oI18n && typeof oI18n.getResourceBundle === "function" ? oI18n.getResourceBundle() : null;
            var aParams = Array.isArray(aArgs) ? aArgs : undefined;
            var sDefault = (typeof aArgs === "string") ? aArgs : sFallback;
            if (!oResourceBundle || typeof oResourceBundle.getText !== "function") {
                return sDefault || sKey;
            }
            if (typeof oResourceBundle.hasText === "function" && !oResourceBundle.hasText(sKey) && sDefault) {
                return sDefault;
            }
            var sResult = oResourceBundle.getText(sKey, aParams);
            return (sResult === sKey && sDefault) ? sDefault : sResult;
        }
    };

    Object.assign(oMembers, mFilters, mActions, mFormatters);

    var ControllerClass = Controller.extend("saps4hana.fiori.modules.sd.customer-invoice.controller.CustomerInvoices", oMembers);
    Object.assign(ControllerClass.prototype || ControllerClass, mFilters, mActions, mFormatters);

    return ControllerClass;
});
