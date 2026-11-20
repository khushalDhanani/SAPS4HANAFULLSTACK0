sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/FilterType",
    "sap/ui/core/Fragment",
    "sap/m/MessageBox",
    "saps4hana/fiori/service/AuthService",
    "saps4hana/fiori/service/ODataClient",
    "saps4hana/fiori/modules/le/outbound-delivery/service/OutboundDeliveryService",
    "saps4hana/fiori/modules/sd/sales-order/controller/SalesOrderFormatters",
    "saps4hana/fiori/modules/sd/sales-order/controller/SalesOrderTableManager",
    "saps4hana/fiori/modules/sd/sales-order/controller/SalesOrderDeliveryActions"
], function (
    BaseController,
    JSONModel,
    Filter,
    FilterOperator,
    FilterType,
    Fragment,
    MessageBox,
    AuthService,
    ODataClient,
    OutboundDeliveryService,
    SalesOrderFormatters,
    SalesOrderTableManager,
    SalesOrderDeliveryActions
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

    var modFormatters = req(SalesOrderFormatters, "./SalesOrderFormatters");
    var modTable = req(SalesOrderTableManager, "./SalesOrderTableManager");
    var modDelivery = req(SalesOrderDeliveryActions, "./SalesOrderDeliveryActions");

    var fnFormatters = typeof createSalesOrderFormatters === "function" ? createSalesOrderFormatters : (modFormatters && modFormatters.createSalesOrderFormatters);
    var fnTable = typeof createSalesOrderTableManager === "function" ? createSalesOrderTableManager : (modTable && modTable.createSalesOrderTableManager);
    var fnDelivery = typeof createSalesOrderDeliveryActions === "function" ? createSalesOrderDeliveryActions : (modDelivery && modDelivery.createSalesOrderDeliveryActions);

    var mFormatters = typeof fnFormatters === "function" ? fnFormatters() : {};
    var mTable = typeof fnTable === "function" ? fnTable({
        Filter: Filter,
        FilterOperator: FilterOperator,
        FilterType: FilterType,
        ODataClient: ODataClient
    }) : {};
    var mDelivery = typeof fnDelivery === "function" ? fnDelivery({
        Fragment: Fragment,
        MessageBox: MessageBox,
        OutboundDeliveryService: OutboundDeliveryService
    }) : {};

    var oMembers = {
        onInit: function () {
            if (AuthService && typeof AuthService.syncModelHeaders === "function") {
                AuthService.syncModelHeaders(this.getOwnerComponent(), true);
            }
            var bCanCreateDelivery = (AuthService && typeof AuthService.canCreateDelivery === "function") ? AuthService.canCreateDelivery() : true;
            var oViewModel = new JSONModel({
                totalCount: "-",
                openCount: "-",
                customerCount: "-",
                canCreateDelivery: bCanCreateDelivery
            });
            this.getView().setModel(oViewModel, "salesOrdersView");

            var oDialogModel = new JSONModel({
                salesOrder: "",
                shippingPoint: "",
                deliveryDate: this._getTodayDateString()
            });
            this.getView().setModel(oDialogModel, "deliveryDialog");
            this._loadServerMetrics();

            var oRouter = this.getOwnerComponent().getRouter();
            if (oRouter && oRouter.getRoute("salesOrders")) {
                oRouter.getRoute("salesOrders").attachPatternMatched(this._onRouteMatched, this);
            }
        },

        _onRouteMatched: function () {
            if (AuthService && typeof AuthService.syncModelHeaders === "function") {
                AuthService.syncModelHeaders(this.getOwnerComponent(), true);
            }
            if (AuthService && typeof AuthService.canCreateDelivery === "function") {
                var oVm = this.getView().getModel("salesOrdersView");
                if (oVm) {
                    oVm.setProperty("/canCreateDelivery", AuthService.canCreateDelivery());
                }
            }
            // The first match is the initial visit: onInit already requested the list and metrics
            if (!this._bRouteMatchedBefore) {
                this._bRouteMatchedBefore = true;
                return;
            }
            var oTable = this.byId("salesOrdersTable");
            var oBinding = oTable ? oTable.getBinding("items") : null;
            if (oBinding) {
                try {
                    oBinding.refresh();
                } catch (e) {
                    // Safe guard against refreshing in-flight initial request
                }
            }
            this._loadServerMetrics();
        },

        onNavigateToCreateSalesOrder: function () {
            this.getOwnerComponent().getRouter().navTo("createSalesOrder");
        },

        onRefresh: function () {
            var oTable = this.byId("salesOrdersTable");
            if (oTable) {
                var oBinding = oTable.getBinding("items");
                if (oBinding) {
                    try {
                        oBinding.refresh();
                    } catch (e) {
                        // Ignore refresh if already pending
                    }
                }
            }
            this._loadServerMetrics();
        },

        _text: function (sKey, sDefault) {
            try {
                var oComp = this.getOwnerComponent();
                var oI18n = oComp && oComp.getModel ? oComp.getModel("i18n") : null;
                var oBundle = oI18n && oI18n.getResourceBundle ? oI18n.getResourceBundle() : null;
                if (oBundle && oBundle.hasText && oBundle.hasText(sKey)) {
                    return oBundle.getText(sKey);
                }
            } catch (e) {
                // i18n bundle not available (e.g. unit tests): fall through to the English default.
            }
            return sDefault;
        }
    };

    Object.assign(oMembers, mFormatters, mTable, mDelivery);

    var ControllerClass = BaseController.extend("saps4hana.fiori.modules.sd.sales-order.controller.SalesOrders", oMembers);
    Object.assign(ControllerClass.prototype || ControllerClass, mFormatters, mTable, mDelivery);

    return ControllerClass;
});
