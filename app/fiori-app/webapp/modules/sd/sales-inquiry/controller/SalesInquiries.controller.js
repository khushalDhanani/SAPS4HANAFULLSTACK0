sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/FilterType"
], function (BaseController, JSONModel, Filter, FilterOperator, FilterType) {
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
                totalCount: 0,
                openCount: 0,
                customerCount: 0
            });
            this.getView().setModel(oViewModel, "salesInquiriesView");

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
        },

        onUpdateFinished: function (oEvent) {
            var oTable = oEvent.getSource();
            var iTotal = oEvent.getParameter("total") || 0;
            var aItems = oTable.getItems() || [];
            var oViewModel = this.getView().getModel("salesInquiriesView");

            var mCustomers = {};
            var iOpen = 0;

            aItems.forEach(function (oItem) {
                var oCtx = oItem.getBindingContext("salesInquiry");
                if (oCtx) {
                    var sCust = oCtx.getProperty("SoldToParty");
                    if (sCust) {
                        mCustomers[sCust] = true;
                    }
                    var sStatus = oCtx.getProperty("OverallSDProcessStatus");
                    if (!sStatus || sStatus === "A" || sStatus === "Open") {
                        iOpen++;
                    }
                }
            });

            var iDistinctCustomers = Object.keys(mCustomers).length;
            oViewModel.setProperty("/totalCount", iTotal || aItems.length);
            oViewModel.setProperty("/openCount", iOpen);
            oViewModel.setProperty("/customerCount", iDistinctCustomers);
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
        }
    });
});
