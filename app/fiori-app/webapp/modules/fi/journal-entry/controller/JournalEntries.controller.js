sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "saps4hana/fiori/modules/fi/journal-entry/model/formatter",
    "sap/m/MessageToast"
], function (BaseController, JSONModel, Filter, FilterOperator, formatter, MessageToast) {
    "use strict";

    return BaseController.extend("saps4hana.fiori.modules.fi.journal-entry.controller.JournalEntries", {
        formatter: formatter,

        onInit: function () {
            var oViewModel = new JSONModel({
                totalCount: 0,
                glAccountCount: 0
            });
            this.getView().setModel(oViewModel, "fiView");
        },

        onUpdateFinished: function (oEvent) {
            var oTable = oEvent.getSource();
            var iTotalItems = oEvent.getParameter("total");
            var sTitle, oViewModel = this.getView().getModel("fiView");
            var aItems = oTable.getItems();
            var oGLAccounts = {};

            if (iTotalItems && oTable.getBinding("items").isLengthFinal()) {
                // Calculate unique GL Accounts from currently loaded items
                aItems.forEach(function (oItem) {
                    var oContext = oItem.getBindingContext("fiService");
                    if (oContext) {
                        var sGL = oContext.getProperty("GLAccount");
                        if (sGL) {
                            oGLAccounts[sGL] = true;
                        }
                    }
                });

                oViewModel.setProperty("/totalCount", iTotalItems);
                oViewModel.setProperty("/glAccountCount", Object.keys(oGLAccounts).length);
            } else {
                oViewModel.setProperty("/totalCount", 0);
                oViewModel.setProperty("/glAccountCount", 0);
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
            var oBinding = oTable.getBinding("items");
            oBinding.filter(aFilters, "Application");
        },

        onRefresh: function () {
            var oTable = this.byId("tableJournalEntries");
            oTable.getBinding("items").refresh();
            MessageToast.show(this.getOwnerComponent().getModel("i18n").getResourceBundle().getText("dashboardActionRefreshDesc"));
        },

        onItemPress: function (oEvent) {
            // Future enhancement: Open detail dialog or navigate to detail page
            var oItem = oEvent.getParameter("listItem") || oEvent.getSource();
            var oContext = oItem.getBindingContext("fiService");
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
