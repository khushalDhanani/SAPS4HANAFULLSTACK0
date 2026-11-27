sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "saps4hana/fiori/service/ODataClient",
    "sap/m/MessageToast"
], function (BaseController, JSONModel, ODataClient, MessageToast) {
    "use strict";

    var BASE_PATH = "/odata/v4/maintenance-order";
    var PAGE_SIZE = 25;

    function encodeODataString(sVal) {
        return "'" + encodeURIComponent(String(sVal || "").trim().replace(/'/g, "''")) + "'";
    }

    return BaseController.extend(
        "saps4hana.fiori.modules.pm.maintenance-order.controller.MaintenanceOrders",
        {
            onInit: function () {
                this._requestSeq = 0;
                var oModel = new JSONModel({
                    items: [],
                    totalCount: null,
                    filteredCount: null,
                    filteredCountDisplay: "",
                    canLoadMore: false,
                    errorMessage: "",
                    busy: false,
                    kpiBusy: false
                });
                this.getView().setModel(oModel, "pmMaintOrdersView");
                var oRouter = this.getOwnerComponent().getRouter();
                oRouter.getRoute("maintenanceOrders").attachPatternMatched(this._onRouteMatched, this);
            },

            _onRouteMatched: function () {
                this._loadData({ skip: 0, append: false });
                this._loadMetrics();
            },

            _loadData: function (params) {
                var oModel = this.getView().getModel("pmMaintOrdersView");
                var bAppend = Boolean(params && params.append);
                oModel.setProperty("/busy", true);
                oModel.setProperty("/errorMessage", "");

                var oSearch = this.byId("pmMaintOrdersSearch");
                var sSearchQuery = oSearch ? oSearch.getValue().trim() : "";

                var oParams = Object.assign({
                    top: PAGE_SIZE,
                    skip: 0,
                    searchQuery: sSearchQuery
                }, params);

                var aParts = ["top=" + oParams.top, "skip=" + oParams.skip];
                if (oParams.searchQuery) {
                    aParts.push("searchQuery=" + encodeODataString(oParams.searchQuery));
                }
                if (oParams.plant) {
                    aParts.push("plant=" + encodeODataString(oParams.plant));
                }
                if (oParams.planningPlant) {
                    aParts.push("planningPlant=" + encodeODataString(oParams.planningPlant));
                }
                if (oParams.mainWorkCenter) {
                    aParts.push("mainWorkCenter=" + encodeODataString(oParams.mainWorkCenter));
                }
                if (oParams.orderType) {
                    aParts.push("orderType=" + encodeODataString(oParams.orderType));
                }
                if (oParams.priority) {
                    aParts.push("priority=" + encodeODataString(oParams.priority));
                }

                var sUrl = BASE_PATH + "/list(" + aParts.join(",") + ")";
                var nReqId = ++this._requestSeq;
                var that = this;

                return ODataClient.get(sUrl).then(function (oResult) {
                    if (nReqId !== that._requestSeq) {
                        return;
                    }
                    var oData = oResult && oResult.value ? oResult.value : (oResult || {});
                    var aNewItems = oData.items || oData.Items || [];
                    var aExisting = bAppend ? (oModel.getProperty("/items") || []) : [];
                    var aCombined = aExisting.concat(aNewItems);
                    var nTotal = oData.totalCount !== undefined ? Number(oData.totalCount) : aCombined.length;

                    oModel.setProperty("/items", aCombined);
                    oModel.setProperty("/filteredCount", nTotal);
                    oModel.setProperty("/filteredCountDisplay", Number(nTotal).toLocaleString());
                    oModel.setProperty("/canLoadMore", aCombined.length < nTotal && aNewItems.length > 0);
                    oModel.setProperty("/busy", false);
                }).catch(function (oErr) {
                    if (nReqId !== that._requestSeq) {
                        return;
                    }
                    var sFallback = that.getText("maintOrdersLoadError", null, "Unable to load maintenance orders from SAP S/4HANA.");
                    var sMsg = (oErr && oErr.message) ? oErr.message : sFallback;
                    if (!bAppend) {
                        oModel.setProperty("/items", []);
                        oModel.setProperty("/filteredCount", null);
                        oModel.setProperty("/filteredCountDisplay", "");
                        oModel.setProperty("/canLoadMore", false);
                    }
                    oModel.setProperty("/errorMessage", sMsg);
                    oModel.setProperty("/busy", false);
                    MessageToast.show(sMsg);
                });
            },

            _loadMetrics: function () {
                var oModel = this.getView().getModel("pmMaintOrdersView");
                oModel.setProperty("/kpiBusy", true);
                return ODataClient.get(BASE_PATH + "/getMetrics()").then(function (oResult) {
                    var oData = oResult && oResult.value ? oResult.value : (oResult || {});
                    var nTotal = oData.totalCount !== undefined ? Number(oData.totalCount) : null;
                    oModel.setProperty("/totalCount", nTotal);
                    oModel.setProperty("/kpiBusy", false);
                }).catch(function () {
                    oModel.setProperty("/kpiBusy", false);
                });
            },

            onSearch: function () {
                this._loadData({ skip: 0, append: false });
            },

            onLoadMore: function () {
                var oModel = this.getView().getModel("pmMaintOrdersView");
                var aItems = oModel.getProperty("/items") || [];
                this._loadData({ skip: aItems.length, append: true });
            },

            onRefresh: function () {
                this._loadData({ skip: 0, append: false });
                this._loadMetrics();
            },

            formatCount: function (nVal) {
                if (nVal === null || nVal === undefined || nVal === "" || isNaN(nVal)) {
                    return "";
                }
                return Number(nVal).toLocaleString();
            }
        }
    );
});
