sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/FilterType",
    "saps4hana/fiori/service/ODataClient"
], function (BaseController, JSONModel, Filter, FilterOperator, FilterType, ODataClient) {
    "use strict";

    return BaseController.extend("saps4hana.fiori.modules.sd.sales-inquiry.controller.SalesInquiries", {
        formatter: {
            statusText: function (sStatus) {
                if (!sStatus || sStatus === "A" || sStatus === "Open") {
                    return "Open";
                }
                if (sStatus === "B") {
                    return "In Process";
                }
                if (sStatus === "C" || sStatus === "Completed") {
                    return "Completed";
                }
                return sStatus;
            },

            statusState: function (sStatus) {
                if (!sStatus || sStatus === "A" || sStatus === "Open") {
                    return "Information";
                }
                if (sStatus === "B") {
                    return "Warning";
                }
                if (sStatus === "C" || sStatus === "Completed") {
                    return "Success";
                }
                return "None";
            }
        },

        onInit: function () {
            var oViewModel = new JSONModel({
                totalCount: "-",
                openCount: "-",
                customerCount: "-"
            });
            this.getView().setModel(oViewModel, "salesInquiriesView");
            this._loadServerMetrics();

            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("salesInquiries").attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function () {
            var oTable = this.byId("salesInquiriesTable");
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

        onUpdateFinished: function (oEvent) {
            var oTable = oEvent.getSource();
            var oKpis = this.calculateKpiMetrics(oTable, oEvent);
            var oViewModel = this.getView().getModel("salesInquiriesView");
            if (oViewModel) {
                oViewModel.setProperty("/totalCount", oKpis.totalCount);
            }
        },

        _loadServerMetrics: function () {
            var oViewModel = this.getView().getModel("salesInquiriesView");
            if (!oViewModel) {
                return Promise.resolve();
            }

            var pInquiryMetrics = ODataClient.get("/odata/v4/sales-inquiry/getSalesInquiryMetrics()")
                .then(function (res) {
                    var data = res && res.value ? res.value : res;
                    if (data && data.openInquiriesCount != null) {
                        oViewModel.setProperty("/openCount", data.openInquiriesCount);
                    } else if (data && data.openOrdersCount != null) {
                        oViewModel.setProperty("/openCount", data.openOrdersCount);
                    } else {
                        oViewModel.setProperty("/openCount", "-");
                    }
                })
                .catch(function () {
                    oViewModel.setProperty("/openCount", "-");
                });

            var pCustomerMetrics = ODataClient.get("/odata/v4/purchase-order/getDashboardMetrics()")
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
                    if (oMetrics && oMetrics.customerCount != null) {
                        oViewModel.setProperty("/customerCount", oMetrics.customerCount);
                    } else {
                        oViewModel.setProperty("/customerCount", "-");
                    }
                })
                .catch(function () {
                    oViewModel.setProperty("/customerCount", "-");
                });

            return Promise.all([pInquiryMetrics, pCustomerMetrics]);
        },

        onNavigateToCreateInquiry: function () {
            this.getOwnerComponent().getRouter().navTo("createSalesInquiry");
        },

        onInquiryPress: function (oEvent) {
            var oItem = oEvent.getParameter("listItem") || oEvent.getSource();
            if (oItem) {
                var oCtx = oItem.getBindingContext("salesInquiry");
                if (oCtx) {
                    var sInquiryId = oCtx.getProperty("SalesInquiry");
                    this.getOwnerComponent().getRouter().navTo("salesInquiryDetail", {
                        SalesInquiry: sInquiryId
                    });
                }
            }
        },

        onSearch: function (oEvent) {
            var sQuery = oEvent.getParameter("query") || oEvent.getParameter("newValue");
            var oTable = this.byId("salesInquiriesTable");
            var oBinding = oTable ? oTable.getBinding("items") : null;
            if (!oBinding) return;

            var aFilters = [];
            if (sQuery && sQuery.trim() !== "") {
                var sTrimmed = sQuery.trim();
                aFilters.push(new Filter({
                    filters: [
                        new Filter("SalesInquiry", FilterOperator.Contains, sTrimmed),
                        new Filter("SoldToParty", FilterOperator.Contains, sTrimmed),
                        new Filter("OrganizationBPName1", FilterOperator.Contains, sTrimmed),
                        new Filter("PurchaseOrderByCustomer", FilterOperator.Contains, sTrimmed),
                        new Filter("SalesInquiryType", FilterOperator.Contains, sTrimmed)
                    ],
                    and: false
                }));
            }

            oBinding.filter(aFilters, FilterType.Application);
        },

        onRefresh: function () {
            var oTable = this.byId("salesInquiriesTable");
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
        }
    });
});
