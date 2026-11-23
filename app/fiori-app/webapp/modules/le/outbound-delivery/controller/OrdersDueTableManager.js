(function () {
    "use strict";

    function createOrdersDueTableManager(deps) {
        deps = deps || {};
        var Filter = deps.Filter;
        var FilterOperator = deps.FilterOperator;
        var FilterType = deps.FilterType;
        var AuthService = deps.AuthService;
        var OutboundDeliveryService = deps.OutboundDeliveryService;

        return {
            _getPlant: function () {
                var oVm = this.getView().getModel("ordersDueView");
                return String((oVm && oVm.getProperty("/plant")) || "").trim().toUpperCase();
            },

            _initPlant: function () {
                var that = this;
                return OutboundDeliveryService.getPlantContext().then(function (oCtx) {
                    that._oPlantScope = oCtx;
                    var sOwn = oCtx.plants[0] || "";
                    if (!that._getPlant() && sOwn) {
                        that.getView().getModel("ordersDueView").setProperty("/plant", sOwn);
                    }
                    that._loadForPlant();
                }).catch(function (oError) {
                    that._setPlantState("Error", that._text("ordersDuePlantLoadFailed", "Your plants could not be determined: {0}")
                        .replace("{0}", (oError && oError.message) || ""));
                });
            },

            _setPlantState: function (sState, sText) {
                var oVm = this.getView().getModel("ordersDueView");
                oVm.setProperty("/plantValueState", sState);
                oVm.setProperty("/plantValueStateText", sText || "");
            },

            onPlantChange: function () {
                var oVm = this.getView().getModel("ordersDueView");
                var sPlant = this._getPlant();
                var oScope = this._oPlantScope;
                if (sPlant && oScope && !oScope.unrestricted && oScope.plants.indexOf(sPlant) === -1) {
                    oVm.setProperty("/plant", this._sLoadedPlant || "");
                    this._setPlantState("Error", this._text("ordersDuePlantOutOfScope", "Plant {0} is not one of your plants ({1}).")
                        .replace("{0}", sPlant).replace("{1}", oScope.plants.join(", ")));
                    return;
                }
                oVm.setProperty("/plant", sPlant);
                this._loadForPlant();
            },

            _loadForPlant: function () {
                if (!this._getPlant()) {
                    this._setPlantState("Error", this._text("ordersDuePlantRequired", "Enter a plant to load the orders due for delivery."));
                    return;
                }
                this._setPlantState("None", "");
                this._sLoadedPlant = this._getPlant();
                this._applyCombinedFilters();
                var oTable = this.byId("ordersDueTable");
                var oBinding = oTable ? oTable.getBinding("items") : null;
                if (oBinding && typeof oBinding.isSuspended === "function" && oBinding.isSuspended()) {
                    oBinding.resume();
                    oTable.setGrowingScrollToLoad(true);
                }
                this._loadServerMetrics();
            },

            _onRouteMatched: function () {
                if (AuthService && typeof AuthService.syncModelHeaders === "function") {
                    AuthService.syncModelHeaders(this.getOwnerComponent(), true);
                }
                if (AuthService && typeof AuthService.canCreateDelivery === "function") {
                    var oVm = this.getView().getModel("ordersDueView");
                    if (oVm) {
                        oVm.setProperty("/canCreateDelivery", AuthService.canCreateDelivery());
                    }
                }
                if (!this._getPlant()) {
                    return;
                }
                this._applyCombinedFilters();
                var oTable = this.byId("ordersDueTable");
                var oBinding = oTable ? oTable.getBinding("items") : null;
                if (oBinding) {
                    try {
                        oBinding.refresh();
                    } catch (e) {
                        // Ignore refresh error if request is in flight
                    }
                }
                this._loadServerMetrics();
            },

            _getTodayDateString: function () {
                var d = new Date();
                var sMonth = String(d.getMonth() + 1).padStart(2, "0");
                var sDay = String(d.getDate()).padStart(2, "0");
                return d.getFullYear() + "-" + sMonth + "-" + sDay;
            },

            _loadServerMetrics: function () {
                var oViewModel = this.getView().getModel("ordersDueView");
                if (!oViewModel || !this._getPlant()) {
                    return Promise.resolve();
                }
                return OutboundDeliveryService.getOrdersDueMetrics(this._getPlant())
                    .then(function (oMetrics) {
                        var bOk = oMetrics && typeof oMetrics.scheduleLineCount === "number" && typeof oMetrics.shippingPointCount === "number";
                        var nTotal = bOk ? oMetrics.scheduleLineCount : "-";
                        var nReady = bOk && typeof oMetrics.readyToDeliverCount === "number" ? oMetrics.readyToDeliverCount : "-";
                        var nApproval = bOk && typeof oMetrics.inApprovalCount === "number" ? oMetrics.inApprovalCount : "-";
                        var nSP = bOk ? oMetrics.shippingPointCount : "-";
                        var nOrdersTotal = bOk && typeof oMetrics.distinctOrdersCount === "number" ? oMetrics.distinctOrdersCount : "-";
                        var nOrdersReady = bOk && typeof oMetrics.readyOrdersCount === "number" ? oMetrics.readyOrdersCount : "-";
                        var nOrdersApproval = bOk && typeof oMetrics.inApprovalOrdersCount === "number" ? oMetrics.inApprovalOrdersCount : "-";

                        oViewModel.setProperty("/totalCount", nTotal);
                        oViewModel.setProperty("/readyCount", nReady);
                        oViewModel.setProperty("/inApprovalCount", nApproval);
                        oViewModel.setProperty("/shippingPointCount", nSP);
                        oViewModel.setProperty("/distinctOrdersCount", nOrdersTotal);
                        oViewModel.setProperty("/readyOrdersCount", nOrdersReady);
                        oViewModel.setProperty("/inApprovalOrdersCount", nOrdersApproval);

                        var sTab = oViewModel.getProperty("/selectedTab") || "ready";
                        var sDisplay = sTab === "ready" ? nReady : (sTab === "inApproval" ? nApproval : nTotal);
                        oViewModel.setProperty("/displayCount", sDisplay);
                    })
                    .catch(function () {
                        oViewModel.setProperty("/totalCount", "-");
                        oViewModel.setProperty("/readyCount", "-");
                        oViewModel.setProperty("/inApprovalCount", "-");
                        oViewModel.setProperty("/shippingPointCount", "-");
                        oViewModel.setProperty("/distinctOrdersCount", "-");
                        oViewModel.setProperty("/readyOrdersCount", "-");
                        oViewModel.setProperty("/inApprovalOrdersCount", "-");
                        oViewModel.setProperty("/displayCount", "-");
                    });
            },

            onTabSelect: function (oEvent) {
                var sKey = oEvent && typeof oEvent.getParameter === "function"
                    ? (oEvent.getParameter("key") || (oEvent.getParameter("item") && oEvent.getParameter("item").getKey()))
                    : null;
                if (!sKey) {
                    var oSeg = (typeof this.byId === "function")
                        ? this.byId("segApprovalStatus")
                        : (this.getView && typeof this.getView().byId === "function" ? this.getView().byId("segApprovalStatus") : null);
                    sKey = oSeg && typeof oSeg.getSelectedKey === "function" ? oSeg.getSelectedKey() : "ready";
                }
                var oViewModel = this.getView && typeof this.getView().getModel === "function" ? this.getView().getModel("ordersDueView") : null;
                if (oViewModel) {
                    oViewModel.setProperty("/selectedTab", sKey);
                    var sDisplay = sKey === "ready"
                        ? oViewModel.getProperty("/readyCount")
                        : (sKey === "inApproval" ? oViewModel.getProperty("/inApprovalCount") : oViewModel.getProperty("/totalCount"));
                    oViewModel.setProperty("/displayCount", sDisplay);
                }
                this._applyCombinedFilters();
            },

            onSearch: function () {
                this._applyCombinedFilters();
            },

            onFilterShippingPointChange: function () {
                this._applyCombinedFilters();
            },

            _applyCombinedFilters: function () {
                var oTable = (typeof this.byId === "function")
                    ? this.byId("ordersDueTable")
                    : (this.getView && typeof this.getView().byId === "function" ? this.getView().byId("ordersDueTable") : null);
                var oBinding = oTable && typeof oTable.getBinding === "function" ? oTable.getBinding("items") : null;
                if (!oBinding) return;

                var aFilters = [];
                var oViewModel = this.getView && typeof this.getView().getModel === "function" ? this.getView().getModel("ordersDueView") : null;
                var sTab = (oViewModel && typeof oViewModel.getProperty === "function" && oViewModel.getProperty("/selectedTab")) || "ready";

                var sPlant = String((oViewModel && typeof oViewModel.getProperty === "function" && oViewModel.getProperty("/plant")) || "").trim();
                if (sPlant) {
                    aFilters.push(new Filter("Plant", FilterOperator.EQ, sPlant.toUpperCase()));
                }

                if (sTab === "ready") {
                    aFilters.push(new Filter("IsDeliverable", FilterOperator.EQ, true));
                } else if (sTab === "inApproval") {
                    aFilters.push(new Filter("SalesDocApprovalStatus", FilterOperator.EQ, "A"));
                }

                var sFilterSP = oViewModel && oViewModel.getProperty("/filterShippingPoint");
                if (sFilterSP && String(sFilterSP).trim()) {
                    aFilters.push(new Filter("ShippingPoint", FilterOperator.EQ, String(sFilterSP).trim()));
                }

                var oSearchField = (typeof this.byId === "function")
                    ? this.byId("searchOrdersDue")
                    : (this.getView && typeof this.getView().byId === "function" ? this.getView().byId("searchOrdersDue") : null);
                var sQuery = oSearchField && typeof oSearchField.getValue === "function" ? oSearchField.getValue() : "";
                if (sQuery && sQuery.trim()) {
                    var q = sQuery.trim();
                    aFilters.push(new Filter({
                        filters: [
                            new Filter("SalesOrder", FilterOperator.Contains, q),
                            new Filter("ShipToParty", FilterOperator.Contains, q),
                            new Filter("ShippingPoint", FilterOperator.Contains, q)
                        ],
                        and: false
                    }));
                }

                oBinding.filter(aFilters, FilterType.Application);
            },

            onRefresh: function () {
                this._oUnconfirmedOrders = {};
                if (!this._getPlant()) {
                    this._loadForPlant();
                    return;
                }
                var oTable = this.byId("ordersDueTable");
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
        };
    }

    var oExports = {
        createOrdersDueTableManager: createOrdersDueTableManager
    };

    var isNode = typeof module !== "undefined" && module.exports;
    if (isNode) {
        module.exports = oExports;
    }
    if (!isNode && typeof sap !== "undefined" && sap.ui && typeof sap.ui.define === "function") {
        sap.ui.define([], function () {
            return oExports;
        });
    }
})();
