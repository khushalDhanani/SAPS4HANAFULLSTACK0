sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "saps4hana/fiori/service/ODataClient",
    "sap/m/MessageToast"
], function (
    BaseController,
    JSONModel,
    ODataClient,
    MessageToast
) {
    "use strict";

    return BaseController.extend("saps4hana.fiori.controller.Dashboard", {
        onInit: function () {
            var oViewModel = new JSONModel({
                totalCount: 0,
                supplierCount: 0,
                totalSpend: "3.42",
                completeRate: 100,
                fiDocCount: 0
            });
            this.getView().setModel(oViewModel, "dashboardView");

            this._loadMetrics();
        },

        _loadMetrics: function () {
            var that = this;
            var oViewModel = this.getView().getModel("dashboardView");

            return ODataClient.get("/odata/v4/purchase-order/PurchaseOrders?$top=100&$select=PurchaseOrder,Supplier,PurchasingCompletenessStatus&$count=true")
                .then(function (oData) {
                    if (!oData) {
                        return;
                    }
                    var aOrders = oData.value || [];
                    var iTotal = typeof oData["@odata.count"] === "number" ? oData["@odata.count"] : aOrders.length;
                    var oSuppliers = {};
                    var iCompleted = 0;

                    aOrders.forEach(function (oOrder) {
                        if (oOrder.Supplier) {
                            oSuppliers[oOrder.Supplier] = true;
                        }
                        if (oOrder.PurchasingCompletenessStatus) {
                            iCompleted++;
                        }
                    });

                    var iSupplierCount = Object.keys(oSuppliers).length;
                    var iRate = aOrders.length > 0 ? Math.round((iCompleted / aOrders.length) * 100) : 100;

                    if (oViewModel) {
                        oViewModel.setProperty("/totalCount", iTotal);
                        oViewModel.setProperty("/supplierCount", iSupplierCount > 0 ? iSupplierCount : iTotal);
                        oViewModel.setProperty("/completeRate", iRate);
                    }
                })
                .catch(function () {
                    // Graceful fallback for offline / mock dev mode
                })
                .then(function () {
                    // Fetch FI metrics
                    return ODataClient.get("/odata/v4/journal-entry/JournalEntryItems?$top=1&$count=true");
                })
                .then(function (oData) {
                    if (oData && typeof oData["@odata.count"] === "number") {
                        oViewModel.setProperty("/fiDocCount", oData["@odata.count"]);
                    }
                })
                .catch(function () {
                    // Graceful fallback for offline / mock dev mode
                });
        },

        onRefresh: function () {
            var that = this;
            var oBundle = this.getOwnerComponent().getModel("i18n").getResourceBundle();
            this._loadMetrics().then(function () {
                MessageToast.show(oBundle.getText("dashboardActionRefreshDesc"));
            });
        },

        onNavigateToPurchaseOrders: function () {
            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.navTo("purchaseOrders");
        },

        onNavigateToCreatePO: function () {
            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.navTo("createPurchaseOrder");
        },

        onNavigateToJournalEntries: function () {
            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.navTo("journalEntries");
        }
    });
});
