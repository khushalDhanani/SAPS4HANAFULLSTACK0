sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/core/Fragment",
    "sap/m/MessageToast",
    "saps4hana/fiori/service/AuthService",
    "saps4hana/fiori/modules/sd/customer-return/service/CustomerReturnService"
], function (
    BaseController,
    JSONModel,
    Filter,
    FilterOperator,
    Fragment,
    MessageToast,
    AuthService,
    CustomerReturnService
) {
    "use strict";

    var DEFAULT_RETURN_REASONS = [
        { ReasonCode: "101", ReasonText: "Poor quality" },
        { ReasonCode: "102", ReasonText: "Damaged in transit" },
        { ReasonCode: "004", ReasonText: "Customer recommendation" },
        { ReasonCode: "005", ReasonText: "Customer request" },
        { ReasonCode: "007", ReasonText: "Wrong delivery" }
    ];

    return BaseController.extend("saps4hana.fiori.modules.sd.customer-return.controller.CustomerReturns", {

        // =========================================================================
        // Formatters
        // =========================================================================

        formatReasonState: function (sReason) {
            if (sReason === "101") {
                return "Warning";
            }
            if (sReason === "102") {
                return "Error";
            }
            if (sReason === "004" || sReason === "005") {
                return "Information";
            }
            return "None";
        },

        formatReasonIcon: function (sReason) {
            if (sReason === "101") {
                return "sap-icon://quality-issue";
            }
            if (sReason === "102") {
                return "sap-icon://shipping-status";
            }
            if (sReason === "004" || sReason === "005") {
                return "sap-icon://customer";
            }
            return "sap-icon://notes";
        },

        formatDate: function (sDate) {
            if (!sDate) return "-";
            // Accept ISO string from CAP ("YYYY-MM-DD") or raw /Date(ms)/ from SAP
            var d;
            if (typeof sDate === "string" && sDate.indexOf("/Date(") === 0) {
                var ms = parseInt(sDate.replace(/\/Date\((\d+).*/, "$1"), 10);
                d = isNaN(ms) ? null : new Date(ms);
            } else {
                d = new Date(sDate);
            }
            if (!d || isNaN(d.getTime())) return sDate;
            // Format as DD MMM YYYY (e.g. 07 Jul 2025)
            var months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
            var day = String(d.getUTCDate()).padStart(2, "0");
            return day + " " + months[d.getUTCMonth()] + " " + d.getUTCFullYear();
        },

        formatAmount: function (vAmount) {
            if (vAmount == null || vAmount === "") {
                return "-";
            }
            var f = parseFloat(vAmount);
            if (isNaN(f) || f === 0) return "-";
            return f.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        },

        formatAmountState: function (vAmount) {
            var f = parseFloat(vAmount);
            if (isNaN(f) || f === 0 || vAmount == null || vAmount === "") return "None";
            return "Success";
        },

        formatReason: function (sReason, sReasonText) {
            if (!sReason && !sReasonText) return "-";
            if (!sReasonText) return sReason;
            return sReason ? sReason + " - " + sReasonText : sReasonText;
        },

        formatQuantity: function (vQty) {
            if (vQty == null || vQty === "") {
                return "-";
            }
            var f = parseFloat(vQty);
            return isNaN(f) ? "-" : f.toFixed(3);
        },

        // =========================================================================
        // Lifecycle Methods
        // =========================================================================

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

        onUpdateFinished: function (oEvent) {
            var oTable = oEvent.getSource();
            var oBinding = oTable ? oTable.getBinding("items") : null;
            if (oBinding && typeof oBinding.getLength === "function") {
                var iCount = oBinding.getLength();
                var oViewModel = this.getView().getModel("customerReturnsView");
                var sTab = oViewModel ? oViewModel.getProperty("/selectedTab") : "ALL";
                if (sTab === "ALL" && oViewModel && (oViewModel.getProperty("/totalReturns") === "-" || !oViewModel.getProperty("/totalReturns"))) {
                    oViewModel.setProperty("/totalReturns", iCount);
                }
            }
        },

        // =========================================================================
        // Filtering & Search
        // =========================================================================

        onTabSelect: function (oEvent) {
            var sKey = oEvent.getParameter("key");
            var oViewModel = this.getView().getModel("customerReturnsView");
            if (oViewModel) {
                oViewModel.setProperty("/selectedTab", sKey);
            }
            this._applyFilters();
        },

        onSearch: function (oEvent) {
            var sQuery = oEvent.getParameter("query") || oEvent.getParameter("newValue") || "";
            var oViewModel = this.getView().getModel("customerReturnsView");
            if (oViewModel) {
                oViewModel.setProperty("/searchQuery", sQuery.trim());
            }
            this._applyFilters();
        },

        _applyFilters: function () {
            var oViewModel = this.getView().getModel("customerReturnsView");
            var sTab = oViewModel ? oViewModel.getProperty("/selectedTab") : "ALL";
            var sQuery = oViewModel ? oViewModel.getProperty("/searchQuery") : "";

            var aFilters = [];

            // Tab filter
            if (sTab === "101") {
                aFilters.push(new Filter("ReturnsOrderReason", FilterOperator.EQ, "101"));
            } else if (sTab === "102") {
                aFilters.push(new Filter("ReturnsOrderReason", FilterOperator.EQ, "102"));
            } else if (sTab === "OTHER") {
                aFilters.push(new Filter({
                    filters: [
                        new Filter("ReturnsOrderReason", FilterOperator.NE, "101"),
                        new Filter("ReturnsOrderReason", FilterOperator.NE, "102")
                    ],
                    and: true
                }));
            }

            // Search filter
            if (sQuery) {
                var aSearchFilters = [
                    new Filter("CustomerReturn", FilterOperator.Contains, sQuery),
                    new Filter("SoldToParty", FilterOperator.Contains, sQuery),
                    new Filter("SoldToPartyName", FilterOperator.Contains, sQuery),
                    new Filter("ReferenceSDDocument", FilterOperator.Contains, sQuery),
                    new Filter("SDDocumentReasonText", FilterOperator.Contains, sQuery)
                ];
                aFilters.push(new Filter({
                    filters: aSearchFilters,
                    and: false
                }));
            }

            var oTable = this.byId("tblCustomerReturns");
            var oBinding = oTable ? oTable.getBinding("items") : null;
            if (oBinding) {
                oBinding.filter(aFilters);
            }
        },

        // =========================================================================
        // Server Metrics & Reasons
        // =========================================================================

        _loadMetrics: function () {
            var oViewModel = this.getView().getModel("customerReturnsView");
            if (!oViewModel) {
                return Promise.resolve();
            }

            return CustomerReturnService.getMetrics(this.getView().getModel("customerReturn"))
                .then(function (oMetrics) {
                    if (!oMetrics) return;
                    var iTotal = oMetrics.totalReturns != null ? oMetrics.totalReturns : 0;
                    var fVal = parseFloat(oMetrics.totalNetValue || 0);
                    var sValFormatted = isNaN(fVal) ? "0.00" : fVal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                    oViewModel.setProperty("/totalReturns", iTotal);
                    oViewModel.setProperty("/totalNetValueFormatted", sValFormatted);
                    oViewModel.setProperty("/poorQualityCount", oMetrics.poorQualityCount != null ? oMetrics.poorQualityCount : 0);
                    oViewModel.setProperty("/damagedTransitCount", oMetrics.damagedTransitCount != null ? oMetrics.damagedTransitCount : 0);
                    oViewModel.setProperty("/otherReasonsCount", oMetrics.otherReasonsCount != null ? oMetrics.otherReasonsCount : 0);
                })
                .catch(function () {
                    // Retain defaults gracefully
                });
        },

        _loadReasons: function () {
            var oModel = this._oReturnReasonsModel;
            if (!oModel) {
                return Promise.resolve();
            }

            return CustomerReturnService.getReturnReasons(this.getView().getModel("customerReturn"))
                .then(function (aReasons) {
                    if (Array.isArray(aReasons) && aReasons.length > 0) {
                        oModel.setData(aReasons);
                    }
                })
                .catch(function () {
                    // Retain default reasons
                });
        },

        // =========================================================================
        // Items Drilldown Dialog
        // =========================================================================

        onViewItemsPress: function (oEvent) {
            var that = this;
            var oButton = oEvent.getSource();
            var oContext = oButton.getBindingContext("customerReturn");
            if (!oContext) {
                return;
            }

            var sReturnNumber = oContext.getProperty("CustomerReturn");
            var oViewModel = this.getView().getModel("customerReturnsView");
            oViewModel.setProperty("/selectedReturnNumber", sReturnNumber);
            oViewModel.setProperty("/returnItems", []);

            this._openReturnItemsDialog().then(function (oDialog) {
                if (oDialog.setBusy) {
                    oDialog.setBusy(true);
                }
                CustomerReturnService.getCustomerReturnItems(sReturnNumber, that.getView().getModel("customerReturn"))
                    .then(function (aItems) {
                        if (oDialog.setBusy) {
                            oDialog.setBusy(false);
                        }
                        oViewModel.setProperty("/returnItems", Array.isArray(aItems) ? aItems : []);
                    })
                    .catch(function () {
                        if (oDialog.setBusy) {
                            oDialog.setBusy(false);
                        }
                        oViewModel.setProperty("/returnItems", []);
                    });
            });
        },

        _openReturnItemsDialog: function () {
            var that = this;
            if (!this._pItemsDialog) {
                var sViewId = (this.getView && typeof this.getView().getId === "function") ? this.getView().getId() : undefined;
                this._pItemsDialog = Fragment.load({
                    id: sViewId,
                    name: "saps4hana.fiori.modules.sd.customer-return.view.ReturnItemsDialog",
                    controller: this
                }).then(function (oDialog) {
                    that.getView().addDependent(oDialog);
                    return oDialog;
                });
            }

            return this._pItemsDialog.then(function (oDialog) {
                that._oItemsDialog = oDialog;
                oDialog.open();
                return oDialog;
            });
        },

        onCloseReturnItemsDialog: function () {
            if (this._oItemsDialog) {
                this._oItemsDialog.close();
            }
        },

        // =========================================================================
        // Create Customer Return
        // =========================================================================

        onCreateReturnPress: function () {
            var oRouter = this.getOwnerComponent() ? this.getOwnerComponent().getRouter() : null;
            if (oRouter) {
                oRouter.navTo("createCustomerReturn");
            }
        },

    });
});
