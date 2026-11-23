sap.ui.define([], function () {
    "use strict";

    function createCustomerReturnTableManager(options) {
        options = options || {};
        var Filter = options.Filter;
        var FilterOperator = options.FilterOperator;
        var CustomerReturnService = options.CustomerReturnService;

        return {
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
            }
        };
    }

    var isNode = typeof module !== "undefined" && module.exports;
    var oExports = {
        createCustomerReturnTableManager: createCustomerReturnTableManager
    };

    if (isNode) {
        module.exports = oExports;
    }
    return oExports;
});
