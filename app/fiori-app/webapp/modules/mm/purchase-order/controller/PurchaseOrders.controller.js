sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/Sorter",
    "sap/ui/core/library",
    "sap/m/MessageBox",
    "saps4hana/fiori/service/ValueHelpService"
], function (
    BaseController,
    JSONModel,
    Filter,
    FilterOperator,
    Sorter,
    coreLibrary,
    MessageBox,
    ValueHelpService
) {
    "use strict";

    var SortOrder = coreLibrary.SortOrder;

    return BaseController.extend("saps4hana.fiori.modules.mm.purchase-order.controller.PurchaseOrders", {
        onInit: function () {
            this._sCurrentSortProperty = "CreationDate";
            this._bCurrentSortDescending = true;

            var oViewModel = new JSONModel({
                totalCount: 0,
                supplierCount: 0,
                completeRate: 100,
                sortProperty: this._sCurrentSortProperty,
                sortDescending: this._bCurrentSortDescending
            });
            this.getView().setModel(oViewModel, "viewModel");

            var oTable = this.byId("purchaseOrdersTable");
            oTable.attachEventOnce("updateFinished", this._updateKpiMetrics, this);
            oTable.attachUpdateFinished(this._updateKpiMetrics, this);

            var oOwnerComp = typeof this.getOwnerComponent === "function" ? this.getOwnerComponent() : null;
            var oRouter = oOwnerComp ? oOwnerComp.getRouter() : null;
            if (oRouter) {
                var oRoute = oRouter.getRoute("purchaseOrders");
                if (oRoute) {
                    oRoute.attachPatternMatched(this._onRouteMatched, this);
                }
            }
        },

        _onRouteMatched: function () {
            var oTable = this.byId("purchaseOrdersTable");
            var oBinding = oTable ? oTable.getBinding("items") : null;
            if (oBinding) {
                oBinding.refresh();
            }
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
                        var iStatus = oError.statusCode || oError.status || (oError.response && oError.response.statusCode) || 500;
                        var sMessage = oError.message || "Failed to load Purchase Orders from SAP S/4HANA.";
                        if (oStatus) {
                            oStatus.setState("Error");
                            oStatus.setText(iStatus === 401 ? "S/4HANA Auth Error (401)" : "Connection Error (" + iStatus + ")");
                            oStatus.setIcon("sap-icon://alert");
                        }
                        if (iStatus === 401) {
                            MessageBox.error(
                                "Failed to load Purchase Orders from SAP S/4HANA.\n\n" +
                                "The SAP S/4HANA Gateway rejected the configured credentials with HTTP 401 Unauthorized.\n\n" +
                                "Action Required:\n" +
                                "1. Verify that the password in .env.local is current.\n" +
                                "2. Check transaction SU01 in SAP to ensure user account is not locked due to failed logon attempts.",
                                { title: "S/4HANA Authentication Error" }
                            );
                        } else {
                            MessageBox.error(sMessage, { title: "Error Loading Purchase Orders" });
                        }
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

        onValueHelpRequest: function (oEvent) {
            ValueHelpService.openValueHelp(this.getView(), oEvent.getSource());
        },

        onSuggest: function (oEvent) {
            var sValue = oEvent.getParameter("suggestValue");
            ValueHelpService.applySuggestionFilter(oEvent.getSource(), sValue);
        },

        onSearch: function () {
            this._applyFilters();
        },

        onFilterBarSearch: function () {
            this._applyFilters();
        },

        onFilterBarClear: function () {
            var oFbPO = this.byId("fbPO");
            var oFbSupplier = this.byId("fbSupplier");
            var oFbCompanyCode = this.byId("fbCompanyCode");
            var oFbPurchasingOrg = this.byId("fbPurchasingOrg");
            var oFbPurchasingGroup = this.byId("fbPurchasingGroup");
            var oFbDocType = this.byId("fbDocType");
            var oFbDateRange = this.byId("fbDateRange");
            var oFbCreatedBy = this.byId("fbCreatedBy");
            var oFbStatus = this.byId("fbStatus");

            if (oFbPO) oFbPO.setValue("");
            if (oFbSupplier) oFbSupplier.setValue("");
            if (oFbCompanyCode) oFbCompanyCode.setValue("");
            if (oFbPurchasingOrg) oFbPurchasingOrg.setValue("");
            if (oFbPurchasingGroup) oFbPurchasingGroup.setValue("");
            if (oFbDocType) oFbDocType.setValue("");
            if (oFbCreatedBy) oFbCreatedBy.setValue("");

            if (oFbDateRange) {
                oFbDateRange.setValue("");
                if (typeof oFbDateRange.setDateValue === "function") {
                    oFbDateRange.setDateValue(null);
                    oFbDateRange.setSecondDateValue(null);
                }
            }

            if (oFbStatus) {
                oFbStatus.setSelectedKey("");
            }

            this._applyFilters();
        },

        _formatDateToISO: function (oDate) {
            if (!oDate || !(oDate instanceof Date) || isNaN(oDate.getTime())) {
                return null;
            }
            var iYear = oDate.getFullYear();
            var sMonth = String(oDate.getMonth() + 1).padStart(2, "0");
            var sDay = String(oDate.getDate()).padStart(2, "0");
            return iYear + "-" + sMonth + "-" + sDay;
        },

        _buildFilterCriteria: function () {
            var aFilters = [];

            // 1. Global Toolbar Search Query
            var oSearchField = this.byId("searchField");
            var sQuery = oSearchField ? oSearchField.getValue() : "";
            if (sQuery && sQuery.trim().length > 0) {
                var sTrimmed = sQuery.trim();
                aFilters.push(new Filter({
                    filters: [
                        new Filter("PurchaseOrder", FilterOperator.Contains, sTrimmed),
                        new Filter("Supplier", FilterOperator.Contains, sTrimmed),
                        new Filter("SupplierName", FilterOperator.Contains, sTrimmed),
                        new Filter("CompanyCode", FilterOperator.Contains, sTrimmed),
                        new Filter("CreatedByUser", FilterOperator.Contains, sTrimmed),
                        new Filter("UserFullName", FilterOperator.Contains, sTrimmed)
                    ],
                    and: false
                }));
            }

            // 2. FilterBar: Purchase Order Number
            var oFbPO = this.byId("fbPO");
            if (oFbPO && oFbPO.getValue().trim() !== "") {
                aFilters.push(new Filter("PurchaseOrder", FilterOperator.Contains, oFbPO.getValue().trim()));
            }

            // 3. FilterBar: Supplier (Matches ID or Name)
            var oFbSupplier = this.byId("fbSupplier");
            if (oFbSupplier && oFbSupplier.getValue().trim() !== "") {
                var sSupplier = oFbSupplier.getValue().trim();
                aFilters.push(new Filter({
                    filters: [
                        new Filter("Supplier", FilterOperator.Contains, sSupplier),
                        new Filter("SupplierName", FilterOperator.Contains, sSupplier)
                    ],
                    and: false
                }));
            }

            // 4. FilterBar: Company Code
            var oFbCompanyCode = this.byId("fbCompanyCode");
            if (oFbCompanyCode && oFbCompanyCode.getValue().trim() !== "") {
                aFilters.push(new Filter("CompanyCode", FilterOperator.EQ, oFbCompanyCode.getValue().trim()));
            }

            // 5. FilterBar: Purchasing Organization
            var oFbPurchasingOrg = this.byId("fbPurchasingOrg");
            if (oFbPurchasingOrg && oFbPurchasingOrg.getValue().trim() !== "") {
                aFilters.push(new Filter("PurchasingOrganization", FilterOperator.EQ, oFbPurchasingOrg.getValue().trim()));
            }

            // 6. FilterBar: Purchasing Group
            var oFbPurchasingGroup = this.byId("fbPurchasingGroup");
            if (oFbPurchasingGroup && oFbPurchasingGroup.getValue().trim() !== "") {
                aFilters.push(new Filter("PurchasingGroup", FilterOperator.EQ, oFbPurchasingGroup.getValue().trim()));
            }

            // 7. FilterBar: Purchase Order Type
            var oFbDocType = this.byId("fbDocType");
            if (oFbDocType && oFbDocType.getValue().trim() !== "") {
                aFilters.push(new Filter("PurchaseOrderType", FilterOperator.EQ, oFbDocType.getValue().trim()));
            }

            // 8. FilterBar: Creation Date Range
            var oFbDateRange = this.byId("fbDateRange");
            if (oFbDateRange) {
                var dStart = typeof oFbDateRange.getDateValue === "function" ? oFbDateRange.getDateValue() : null;
                var dEnd = typeof oFbDateRange.getSecondDateValue === "function" ? oFbDateRange.getSecondDateValue() : null;
                var sStart = this._formatDateToISO(dStart);
                var sEnd = this._formatDateToISO(dEnd);

                if (sStart && sEnd) {
                    if (sStart === sEnd) {
                        aFilters.push(new Filter("CreationDate", FilterOperator.EQ, sStart));
                    } else {
                        aFilters.push(new Filter("CreationDate", FilterOperator.BT, sStart, sEnd));
                    }
                } else if (sStart) {
                    aFilters.push(new Filter("CreationDate", FilterOperator.GE, sStart));
                }
            }

            // 9. FilterBar: Created By (Matches Username or Full Name)
            var oFbCreatedBy = this.byId("fbCreatedBy");
            if (oFbCreatedBy && oFbCreatedBy.getValue().trim() !== "") {
                var sCreatedBy = oFbCreatedBy.getValue().trim();
                aFilters.push(new Filter({
                    filters: [
                        new Filter("CreatedByUser", FilterOperator.Contains, sCreatedBy),
                        new Filter("UserFullName", FilterOperator.Contains, sCreatedBy)
                    ],
                    and: false
                }));
            }

            // 10. FilterBar: Display Status (Approved, Draft, In Approval, Rejected)
            var oFbStatus = this.byId("fbStatus");
            if (oFbStatus) {
                var sStatusKey = oFbStatus.getSelectedKey();
                if (sStatusKey === "Approved" || sStatusKey === "true") {
                    aFilters.push(new Filter({
                        filters: [
                            new Filter("PurchasingDocumentStatus", FilterOperator.EQ, "04"),
                            new Filter("PurchasingDocumentStatus", FilterOperator.EQ, "05"),
                            new Filter("PurchasingCompletenessStatus", FilterOperator.EQ, true)
                        ],
                        and: false
                    }));
                } else if (sStatusKey === "Draft" || sStatusKey === "false") {
                    aFilters.push(new Filter({
                        filters: [
                            new Filter("PurchasingDocumentStatus", FilterOperator.EQ, "01"),
                            new Filter("PurchasingCompletenessStatus", FilterOperator.EQ, false)
                        ],
                        and: false
                    }));
                } else if (sStatusKey === "In Approval") {
                    aFilters.push(new Filter({
                        filters: [
                            new Filter("PurchasingDocumentStatus", FilterOperator.EQ, "02"),
                            new Filter("ReleaseIsNotCompleted", FilterOperator.EQ, true)
                        ],
                        and: false
                    }));
                } else if (sStatusKey === "Rejected") {
                    aFilters.push(new Filter({
                        filters: [
                            new Filter("PurchasingDocumentStatus", FilterOperator.EQ, "38"),
                            new Filter("PurchasingDocumentDeletionCode", FilterOperator.EQ, "L")
                        ],
                        and: false
                    }));
                }
            }

            return aFilters;
        },

        _applyFilters: function () {
            var aFilters = this._buildFilterCriteria();
            var oFinalFilter = aFilters.length > 0 ? new Filter({ filters: aFilters, and: true }) : [];

            var oTable = this.byId("purchaseOrdersTable");
            var oBinding = oTable ? oTable.getBinding("items") : null;
            if (oBinding) {
                oBinding.filter(oFinalFilter);
            }
        },

        onSortColumn: function (oEvent) {
            var oLink = oEvent.getSource();
            var sSortProperty = oLink.data ? oLink.data("sortProperty") : null;
            if (!sSortProperty) {
                return;
            }

            if (this._sCurrentSortProperty === sSortProperty) {
                this._bCurrentSortDescending = !this._bCurrentSortDescending;
            } else {
                this._sCurrentSortProperty = sSortProperty;
                this._bCurrentSortDescending = true;
            }

            var oTable = this.byId("purchaseOrdersTable");
            var aColumns = oTable ? oTable.getColumns() : [];
            var sActiveIndicator = this._bCurrentSortDescending ? SortOrder.Descending : SortOrder.Ascending;

            aColumns.forEach(function (oCol) {
                var oHeader = oCol.getHeader();
                var sColProp = oHeader && oHeader.data ? oHeader.data("sortProperty") : null;
                if (sColProp === sSortProperty) {
                    oCol.setSortIndicator(sActiveIndicator);
                } else {
                    oCol.setSortIndicator(SortOrder.None);
                }
            });

            var oViewModel = this.getView().getModel("viewModel");
            if (oViewModel) {
                oViewModel.setProperty("/sortProperty", this._sCurrentSortProperty);
                oViewModel.setProperty("/sortDescending", this._bCurrentSortDescending);
            }

            var oBinding = oTable ? oTable.getBinding("items") : null;
            if (oBinding) {
                var aSorters = [new Sorter(this._sCurrentSortProperty, this._bCurrentSortDescending)];
                if (this._sCurrentSortProperty === "CreationDate") {
                    aSorters.push(new Sorter("PurchaseOrder", this._bCurrentSortDescending));
                }
                oBinding.sort(aSorters);
            }
        },

        onRefresh: function () {
            var oTable = this.byId("purchaseOrdersTable");
            var oBinding = oTable ? oTable.getBinding("items") : null;
            if (oBinding) {
                // oBinding.refresh() reloads data while retaining active filters ($filter) and sorters ($orderby)
                oBinding.refresh();
            }
        },

        onNavBack: function () {
            BaseController.prototype.onNavBack.call(this, "dashboard");
        },

        onCreatePO: function () {
            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.navTo("createPurchaseOrder");
        },

        onItemPress: function (oEvent) {
            var oItem = oEvent.getParameter("listItem");
            var oContext = oItem ? oItem.getBindingContext() : null;
            if (oContext) {
                var sPoId = oContext.getProperty("PurchaseOrder");
                if (sPoId) {
                    var oRouter = this.getOwnerComponent().getRouter();
                    oRouter.navTo("purchaseOrderDetail", {
                        PurchaseOrder: sPoId
                    });
                }
            }
        }
    });
});
