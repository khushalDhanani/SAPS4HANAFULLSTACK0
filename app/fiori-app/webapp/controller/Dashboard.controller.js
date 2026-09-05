sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageToast"
], function (
    BaseController,
    JSONModel,
    Filter,
    FilterOperator,
    MessageToast
) {
    "use strict";

    return BaseController.extend("saps4hana.fiori.controller.Dashboard", {
        onInit: function () {
            var oViewModel = new JSONModel({
                totalCount: 0,
                supplierCount: 0,
                totalSpend: "3.42",
                completeRate: 100
            });
            this.getView().setModel(oViewModel, "dashboardView");

            var oTable = this.byId("recentOrdersTable");
            oTable.attachEventOnce("updateFinished", this._updateKpiMetrics, this);
            oTable.attachUpdateFinished(this._updateKpiMetrics, this);
        },

        _updateKpiMetrics: function (oEvent) {
            var oTable = oEvent.getSource();
            var oKpis = this.calculateKpiMetrics(oTable, oEvent);
            var oViewModel = this.getView().getModel("dashboardView");
            if (oViewModel) {
                oViewModel.setProperty("/totalCount", oKpis.totalCount);
                oViewModel.setProperty("/supplierCount", oKpis.supplierCount);
                oViewModel.setProperty("/completeRate", oKpis.completeRate);
            }
        },

        onSearch: function (oEvent) {
            var sQuery = oEvent.getParameter("query") || oEvent.getParameter("newValue") || "";
            var aFilters = [];

            if (sQuery && sQuery.trim().length > 0) {
                var sTrimmed = sQuery.trim();
                aFilters.push(new Filter({
                    filters: [
                        new Filter("PurchaseOrder", FilterOperator.Contains, sTrimmed),
                        new Filter("Supplier", FilterOperator.Contains, sTrimmed),
                        new Filter("SupplierName", FilterOperator.Contains, sTrimmed),
                        new Filter("CompanyCode", FilterOperator.Contains, sTrimmed)
                    ],
                    and: false
                }));
            }

            var oTable = this.byId("recentOrdersTable");
            var oBinding = oTable ? oTable.getBinding("items") : null;
            if (oBinding) {
                oBinding.filter(aFilters);
            }
        },

        onRefresh: function () {
            var oTable = this.byId("recentOrdersTable");
            var oBinding = oTable ? oTable.getBinding("items") : null;
            if (oBinding) {
                oBinding.refresh();
            }
            MessageToast.show(this.getOwnerComponent().getModel("i18n").getResourceBundle().getText("dashboardActionRefreshDesc"));
        },

        onNavigateToPurchaseOrders: function () {
            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.navTo("purchaseOrders");
        }
    });
});
