sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/core/Fragment",
    "sap/m/MessageToast",
    "saps4hana/fiori/service/AuthService",
    "saps4hana/fiori/modules/sd/customer-return/service/CustomerReturnService",
    "saps4hana/fiori/modules/sd/customer-return/controller/CustomerReturnFormatters",
    "saps4hana/fiori/modules/sd/customer-return/controller/CustomerReturnTableManager",
    "saps4hana/fiori/modules/sd/customer-return/controller/CustomerReturnItemsDialog"
], function (
    BaseController,
    JSONModel,
    Filter,
    FilterOperator,
    Fragment,
    MessageToast,
    AuthService,
    CustomerReturnService,
    CustomerReturnFormatters,
    CustomerReturnTableManager,
    CustomerReturnItemsDialog
) {
    "use strict";

    var DEFAULT_RETURN_REASONS = [
        { ReasonCode: "101", ReasonText: "Poor quality" },
        { ReasonCode: "102", ReasonText: "Damaged in transit" },
        { ReasonCode: "004", ReasonText: "Customer recommendation" },
        { ReasonCode: "005", ReasonText: "Customer request" },
        { ReasonCode: "007", ReasonText: "Wrong delivery" }
    ];

    var isNode = typeof module !== "undefined" && module.exports;
    function req(mod, path) {
        if (mod && Object.keys(mod).length > 0) { return mod; }
        if (isNode) {
            try { return require(path); } catch (e) { return {}; }
        }
        return mod || {};
    }

    var modFormatters = req(CustomerReturnFormatters, "./CustomerReturnFormatters");
    var modTable = req(CustomerReturnTableManager, "./CustomerReturnTableManager");
    var modDialog = req(CustomerReturnItemsDialog, "./CustomerReturnItemsDialog");

    var fnFormatters = typeof createCustomerReturnFormatters === "function" ? createCustomerReturnFormatters : (modFormatters && modFormatters.createCustomerReturnFormatters);
    var fnTable = typeof createCustomerReturnTableManager === "function" ? createCustomerReturnTableManager : (modTable && modTable.createCustomerReturnTableManager);
    var fnDialog = typeof createCustomerReturnItemsDialog === "function" ? createCustomerReturnItemsDialog : (modDialog && modDialog.createCustomerReturnItemsDialog);

    var mFormatters = typeof fnFormatters === "function" ? fnFormatters() : {};
    var mTable = typeof fnTable === "function" ? fnTable({
        Filter: Filter,
        FilterOperator: FilterOperator,
        CustomerReturnService: CustomerReturnService
    }) : {};
    var mDialog = typeof fnDialog === "function" ? fnDialog({
        Fragment: Fragment,
        CustomerReturnService: CustomerReturnService
    }) : {};

    var oMembers = {
        onInit: function () {
            if (AuthService && typeof AuthService.syncModelHeaders === "function") {
                AuthService.syncModelHeaders(this.getOwnerComponent(), true);
            }

            var oViewModel = new JSONModel({
                totalReturns: "-",
                totalNetValueFormatted: "-",
                poorQualityCount: "-",
                damagedTransitCount: "-",
                otherReasonsCount: "-",
                selectedTab: "ALL",
                searchQuery: "",
                selectedReturnNumber: "",
                returnItems: [],
                busy: false
            });
            this.getView().setModel(oViewModel, "customerReturnsView");

            this._oReturnReasonsModel = new JSONModel(DEFAULT_RETURN_REASONS);
            this.getView().setModel(this._oReturnReasonsModel, "returnReasons");

            var oRouter = this.getOwnerComponent() ? this.getOwnerComponent().getRouter() : null;
            if (oRouter && oRouter.getRoute("customerReturns")) {
                oRouter.getRoute("customerReturns").attachPatternMatched(this._onRouteMatched, this);
            }

            this._loadMetrics();
            this._loadReasons();
        },

        _onRouteMatched: function () {
            if (AuthService && typeof AuthService.syncModelHeaders === "function") {
                AuthService.syncModelHeaders(this.getOwnerComponent(), true);
            }
            // The first match is the initial visit: onInit already requested the list and metrics
            if (!this._bRouteMatchedBefore) {
                this._bRouteMatchedBefore = true;
                return;
            }
            var oTable = this.byId("tblCustomerReturns");
            var oBinding = oTable ? oTable.getBinding("items") : null;
            if (oBinding) {
                try {
                    oBinding.refresh();
                } catch (e) {
                    // Safe guard against refreshing in-flight initial request
                }
            }
            this._loadMetrics();
        },

        onRefresh: function () {
            var oTable = this.byId("tblCustomerReturns");
            var oBinding = oTable ? oTable.getBinding("items") : null;
            if (oBinding) {
                try {
                    oBinding.refresh();
                } catch (e) {
                    // Safe guard
                }
            }
            this._loadMetrics();
            this._loadReasons();
            MessageToast.show(this.getText("msgReturnsRefreshed"));
        },

        onCreateReturnPress: function () {
            var oRouter = this.getOwnerComponent() ? this.getOwnerComponent().getRouter() : null;
            if (oRouter) {
                oRouter.navTo("createCustomerReturn");
            }
        }
    };

    Object.assign(oMembers, mFormatters, mTable, mDialog);

    var ControllerClass = BaseController.extend("saps4hana.fiori.modules.sd.customer-return.controller.CustomerReturns", oMembers);
    Object.assign(ControllerClass.prototype || ControllerClass, mFormatters, mTable, mDialog);

    return ControllerClass;
});
