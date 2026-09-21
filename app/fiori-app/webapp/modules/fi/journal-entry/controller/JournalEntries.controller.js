sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "saps4hana/fiori/modules/fi/journal-entry/model/formatter",
    "sap/m/MessageToast",
    "saps4hana/fiori/service/ODataClient"
], function (BaseController, JSONModel, Filter, FilterOperator, formatter, MessageToast, ODataClient) {
    "use strict";

    return BaseController.extend("saps4hana.fiori.modules.fi.journal-entry.controller.JournalEntries", {
        formatter: formatter,

        onInit: function () {
            var oViewModel = new JSONModel({
                totalCount: "-",
                glAccountCount: "-"
            });
            this.getView().setModel(oViewModel, "fiView");
            this._loadServerMetrics();

            var oRouter = this.getOwnerComponent() && this.getOwnerComponent().getRouter();
            if (oRouter && oRouter.getRoute("journalEntries")) {
                oRouter.getRoute("journalEntries").attachPatternMatched(this._onRouteMatched, this);
            }
        },

        _onRouteMatched: function () {
            var oTable = this.byId("tableJournalEntries");
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

        _loadServerMetrics: function () {
            var oViewModel = this.getView().getModel("fiView");
            if (!oViewModel) {
                return Promise.resolve();
            }

            return ODataClient.get("/odata/v4/purchase-order/getDashboardMetrics()")
                .then(function (res) {
                    var oMetrics = res;
                    if (typeof oMetrics === "string") {
                        try {
                            oMetrics = JSON.parse(oMetrics);
                        } catch (e) {
                            oMetrics = null;
                        }
                    }
                    if (oMetrics && typeof oMetrics.value === "string") {
                        try {
                            oMetrics = JSON.parse(oMetrics.value);
                        } catch (e) {
                            oMetrics = null;
                        }
                    }
                    if (oMetrics && oMetrics.glAccountCount != null) {
                        oViewModel.setProperty("/glAccountCount", oMetrics.glAccountCount);
                    } else {
                        oViewModel.setProperty("/glAccountCount", "-");
                    }
                })
                .catch(function () {
                    oViewModel.setProperty("/glAccountCount", "-");
                });
        },

        onUpdateFinished: function (oEvent) {
            var oTable = oEvent.getSource();
            var oKpis = this.calculateKpiMetrics(oTable, oEvent);
            var oViewModel = this.getView().getModel("fiView");
            if (oViewModel) {
                oViewModel.setProperty("/totalCount", oKpis.totalCount);
            }
        },

        onSearch: function (oEvent) {
            var aFilters = [];
            var sQuery = oEvent.getSource().getValue();
            
            if (sQuery && sQuery.length > 0) {
                var oFilter = new Filter({
                    filters: [
                        new Filter("AccountingDocument", FilterOperator.Contains, sQuery),
                        new Filter("GLAccount", FilterOperator.Contains, sQuery),
                        new Filter("CostCenter", FilterOperator.Contains, sQuery)
                    ],
                    and: false
                });
                aFilters.push(oFilter);
            }

            var oTable = this.byId("tableJournalEntries");
            var oBinding = oTable ? oTable.getBinding("items") : null;
            if (oBinding) {
                oBinding.filter(aFilters, "Application");
            }
        },

        onRefresh: function () {
            var oTable = this.byId("tableJournalEntries");
            if (oTable && oTable.getBinding("items")) {
                try {
                    oTable.getBinding("items").refresh();
                } catch (e) {
                    // Ignore refresh if already pending
                }
            }
            this._loadServerMetrics();
            var oBundle = this.getOwnerComponent() && this.getOwnerComponent().getModel("i18n")
                ? this.getOwnerComponent().getModel("i18n").getResourceBundle()
                : null;
            if (oBundle) {
                MessageToast.show(oBundle.getText("dashboardActionRefreshDesc"));
            }
        },

        onItemPress: function (oEvent) {
            // Future enhancement: Open detail dialog or navigate to detail page
            var oItem = oEvent.getParameter("listItem") || oEvent.getSource();
            var oContext = oItem ? oItem.getBindingContext("fiService") : null;
            if (!oContext) return;
            var sDoc = oContext.getProperty("AccountingDocument");
            var sCompany = oContext.getProperty("CompanyCode");
            
            MessageToast.show("Selected Document: " + sDoc + " (" + sCompany + ")");
        },

        onNavBack: function () {
            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.navTo("dashboard", {}, true); // true = replace history
        }
    });
});
