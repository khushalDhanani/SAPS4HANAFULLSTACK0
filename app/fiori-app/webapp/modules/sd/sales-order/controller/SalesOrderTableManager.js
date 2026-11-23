sap.ui.define([], function () {
    "use strict";

    function createSalesOrderTableManager(options) {
        options = options || {};
        var Filter = options.Filter;
        var FilterOperator = options.FilterOperator;
        var FilterType = options.FilterType;
        var ODataClient = options.ODataClient;

        return {
            onUpdateFinished: function (oEvent) {
                var oTable = oEvent.getSource();
                var oKpis = this.calculateKpiMetrics(oTable, oEvent);
                var oViewModel = this.getView().getModel("salesOrdersView");
                if (oViewModel) {
                    oViewModel.setProperty("/totalCount", oKpis.totalCount);
                }
            },

            _loadServerMetrics: function () {
                var oViewModel = this.getView().getModel("salesOrdersView");
                if (!oViewModel) {
                    return Promise.resolve();
                }

                var pOrderMetrics = ODataClient.get("/odata/v4/sales-order/getSalesOrderMetrics()")
                    .then(function (res) {
                        var data = res && res.value ? res.value : res;
                        if (data && data.openOrdersCount != null) {
                            oViewModel.setProperty("/openCount", data.openOrdersCount);
                        } else {
                            oViewModel.setProperty("/openCount", "-");
                        }
                        if (data && data.totalOrdersCount != null) {
                            oViewModel.setProperty("/totalCount", data.totalOrdersCount);
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

                return Promise.all([pOrderMetrics, pCustomerMetrics]);
            },

            onSearch: function (oEvent) {
                var sQuery = oEvent.getParameter("query") || oEvent.getParameter("newValue");
                var oTable = this.byId("salesOrdersTable");
                var oBinding = oTable ? oTable.getBinding("items") : null;
                if (!oBinding) return;

                var aFilters = [];
                if (sQuery && sQuery.trim() !== "") {
                    var sTrimmed = sQuery.trim();
                    // SAP rejects any filter on SoldToPartyName (HTTP 501) and contains() longer than the 4-character
                    // SalesOrderType (HTTP 400); either would fail the whole OR, so neither is sent.
                    var aSearch = [
                        new Filter("SalesOrder", FilterOperator.Contains, sTrimmed),
                        new Filter("SoldToParty", FilterOperator.Contains, sTrimmed),
                        new Filter("PurchaseOrderByCustomer", FilterOperator.Contains, sTrimmed)
                    ];
                    if (sTrimmed.length <= 4) {
                        aSearch.push(new Filter("SalesOrderType", FilterOperator.Contains, sTrimmed));
                    }
                    aFilters.push(new Filter({ filters: aSearch, and: false }));
                }

                oBinding.filter(aFilters, FilterType.Application);
            }
        };
    }

    var isNode = typeof module !== "undefined" && module.exports;
    var oExports = {
        createSalesOrderTableManager: createSalesOrderTableManager
    };

    if (isNode) {
        module.exports = oExports;
    }
    return oExports;
});
