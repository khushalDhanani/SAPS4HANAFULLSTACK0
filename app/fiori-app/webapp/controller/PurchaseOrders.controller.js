sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageBox"
], function (
    BaseController,
    JSONModel,
    Filter,
    FilterOperator,
    MessageBox
) {
    "use strict";

    return BaseController.extend("saps4hana.fiori.controller.PurchaseOrders", {
        onInit: function () {
            var oViewModel = new JSONModel({
                totalCount: 0,
                supplierCount: 0,
                completeRate: 100
            });
            this.getView().setModel(oViewModel, "viewModel");

            var oTable = this.byId("purchaseOrdersTable");
            oTable.attachEventOnce("updateFinished", this._updateKpiMetrics, this);
            oTable.attachUpdateFinished(this._updateKpiMetrics, this);
        },

        onAfterRendering: function () {
            var oTable = this.byId("purchaseOrdersTable");
            var oBinding = oTable ? oTable.getBinding("items") : null;
            if (oBinding && !this._bDataReceivedAttached) {
                this._bDataReceivedAttached = true;
                var that = this;
                oBinding.attachDataReceived(function (oEvent) {
                    var oError = oEvent.getParameter("error");
                    var oStatus = that.byId("connectionStatus");
                    if (oError) {
                        if (oStatus) {
                            oStatus.setState("Error");
                            oStatus.setText("S/4HANA Auth Error (401)");
                            oStatus.setIcon("sap-icon://alert");
                        }
                        MessageBox.error(
                            "Failed to load Purchase Orders from SAP S/4HANA.\n\n" +
                            "The SAP S/4HANA Gateway (System DS4, Client 220) rejected the configured credentials with HTTP 401 Unauthorized.\n\n" +
                            "Action Required:\n" +
                            "1. Verify that the password in .env.local is current.\n" +
                            "2. Check transaction SU01 in SAP to ensure user account 'KHUSHAL' is not locked due to failed logon attempts.",
                            { title: "S/4HANA Authentication Error" }
                        );
                    } else if (oStatus) {
                        oStatus.setState("Success");
                        oStatus.setText("Live S/4HANA");
                        oStatus.setIcon("sap-icon://connected");
                    }
                });
            }
        },

        _updateKpiMetrics: function (oEvent) {
            var oTable = oEvent.getSource();
            var oKpis = this.calculateKpiMetrics(oTable, oEvent);
            var oViewModel = this.getView().getModel("viewModel");
            if (oViewModel) {
                oViewModel.setProperty("/totalCount", oKpis.totalCount);
                oViewModel.setProperty("/supplierCount", oKpis.supplierCount);
                oViewModel.setProperty("/completeRate", oKpis.completeRate);
            }
        },

        onSearch: function () {
            this._applyFilters();
        },

        onFilterBarSearch: function () {
            this._applyFilters();
        },

        onFilterBarClear: function () {
            this.byId("fbPO").setValue("");
            this.byId("fbSupplier").setValue("");
            this.byId("fbCompanyCode").setValue("");
            this._applyFilters();
        },

        _applyFilters: function () {
            var aFilters = [];

            // 1. Search Query Filter (Global Search)
            var oSearchField = this.byId("searchField");
            var sQuery = oSearchField ? oSearchField.getValue() : "";
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

            // 2. Advanced Filter Bar
            var oFbPO = this.byId("fbPO");
            var oFbSupplier = this.byId("fbSupplier");
            var oFbCompanyCode = this.byId("fbCompanyCode");

            if (oFbPO && oFbPO.getValue().trim() !== "") {
                aFilters.push(new Filter("PurchaseOrder", FilterOperator.Contains, oFbPO.getValue().trim()));
            }
            if (oFbSupplier && oFbSupplier.getValue().trim() !== "") {
                aFilters.push(new Filter("SupplierName", FilterOperator.Contains, oFbSupplier.getValue().trim()));
            }
            if (oFbCompanyCode && oFbCompanyCode.getValue().trim() !== "") {
                aFilters.push(new Filter("CompanyCode", FilterOperator.Contains, oFbCompanyCode.getValue().trim()));
            }

            var oFinalFilter = aFilters.length > 0 ? new Filter({ filters: aFilters, and: true }) : [];

            var oTable = this.byId("purchaseOrdersTable");
            var oBinding = oTable ? oTable.getBinding("items") : null;
            if (oBinding) {
                oBinding.filter(oFinalFilter);
            }
        },

        onRefresh: function () {
            var oTable = this.byId("purchaseOrdersTable");
            var oBinding = oTable ? oTable.getBinding("items") : null;
            if (oBinding) {
                oBinding.refresh();
            }
        },

        onNavBack: function () {
            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.navTo("dashboard");
        },

        onCreatePO: function () {
            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.navTo("createPurchaseOrder");
        }
    });
});
