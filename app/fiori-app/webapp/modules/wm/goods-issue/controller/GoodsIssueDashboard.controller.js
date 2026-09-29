sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "sap/ui/core/Fragment",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "../model/GoodsIssueDashboardModel",
    "../service/GoodsIssueService"
], function (BaseController, JSONModel, Fragment, MessageBox, MessageToast, GoodsIssueDashboardModel, GoodsIssueService) {
    "use strict";

    return BaseController.extend("saps4hana.fiori.modules.wm.goods-issue.controller.GoodsIssueDashboard", {
        onInit: function () {
            var oModel = GoodsIssueDashboardModel.createModel();
            this.getView().setModel(oModel, "dashboardView");

            var oOwnerComp = typeof this.getOwnerComponent === "function" ? this.getOwnerComponent() : null;
            var oRouter = oOwnerComp ? oOwnerComp.getRouter() : null;
            if (oRouter) {
                var oRoute = oRouter.getRoute("wmGoodsIssue");
                if (oRoute) {
                    oRoute.attachPatternMatched(this._onRouteMatched, this);
                }
            } else {
                this._loadDashboardData(false);
            }
        },

        _getModel: function () {
            return this.getView().getModel("dashboardView");
        },

        _onRouteMatched: function () {
            this._loadDashboardData(false);
        },

        _loadDashboardData: function (bForceRefresh) {
            var oModel = this._getModel();
            if (!oModel) return;

            oModel.setProperty("/loading", true);
            oModel.setProperty("/error", "");

            var iDays = parseInt(oModel.getProperty("/trendPeriod") || "30", 10);
            var sPlant = oModel.getProperty("/plantFilter") || "";

            var that = this;
            return GoodsIssueService.getDashboardData(iDays, sPlant, bForceRefresh)
                .then(function (oData) {
                    if (oData) {
                        GoodsIssueDashboardModel.setServerData(oModel, oData);
                    } else {
                        oModel.setProperty("/loading", false);
                    }
                    return oData;
                })
                .catch(function (err) {
                    var sMsg = (err && err.message) || String(err || "");
                    oModel.setProperty("/loading", false);
                    oModel.setProperty("/error", sMsg || that.getText("giLoadErrorMsg", null, "Failed to load Goods Issue dashboard data from SAP S/4HANA."));
                });
        },

        onRefresh: function () {
            return this._loadDashboardData(true);
        },

        /**
         * Tile state formatter: Loading until count arrives, Failed on error or null, Loaded otherwise.
         * @param {*} vCount
         * @param {boolean} [bLoading]
         * @param {string} [sError]
         * @returns {string} "Loading" | "Failed" | "Loaded"
         */
        formatTileState: function (vCount, bLoading, sError) {
            if (bLoading) {
                return "Loading";
            }
            if (sError) {
                return "Failed";
            }
            if (vCount === undefined || vCount === "-") {
                return "Loading";
            }
            return vCount === null ? "Failed" : "Loaded";
        },

        // =============================================================
        // KPI CARD SELECTION (Filters Recent Documents Table)
        // =============================================================

        onSelectKpi201: function () {
            var oModel = this._getModel();
            var sCurrent = oModel.getProperty("/typeFilter");
            var sNew = sCurrent === "201" ? "ALL" : "201";
            GoodsIssueDashboardModel.setTypeFilter(oModel, sNew);
        },

        onSelectKpi261: function () {
            var oModel = this._getModel();
            var sCurrent = oModel.getProperty("/typeFilter");
            var sNew = sCurrent === "261" ? "ALL" : "261";
            GoodsIssueDashboardModel.setTypeFilter(oModel, sNew);
        },

        onSelectKpi301: function () {
            var oModel = this._getModel();
            var sCurrent = oModel.getProperty("/typeFilter");
            var sNew = sCurrent === "301" ? "ALL" : "301";
            GoodsIssueDashboardModel.setTypeFilter(oModel, sNew);
        },

        onSelectKpi311: function () {
            var oModel = this._getModel();
            var sCurrent = oModel.getProperty("/typeFilter");
            var sNew = sCurrent === "311" ? "ALL" : "311";
            GoodsIssueDashboardModel.setTypeFilter(oModel, sNew);
        },

        onSelectKpiOverall: function () {
            GoodsIssueDashboardModel.setTypeFilter(this._getModel(), "ALL");
        },

        // =============================================================
        // TABLE FILTERING, SEARCHING & SORTING
        // =============================================================

        onTypeFilterChange: function (oEvent) {
            var oItem = oEvent.getParameter("item");
            var sKey = oItem ? oItem.getKey() : "ALL";
            GoodsIssueDashboardModel.setTypeFilter(this._getModel(), sKey);
        },

        onSearchDocuments: function (oEvent) {
            var sQuery = oEvent.getParameter("newValue");
            GoodsIssueDashboardModel.setSearchQuery(this._getModel(), sQuery);
        },

        onToggleSort: function () {
            GoodsIssueDashboardModel.setSorting(this._getModel(), "PostingDate");
        },

        // =============================================================
        // TREND PERIOD (7 / 30 Days)
        // =============================================================

        onTrendPeriodChange: function (oEvent) {
            var oItem = oEvent.getParameter("item");
            var sKey = oItem ? oItem.getKey() : "30";
            GoodsIssueDashboardModel.setTrendPeriod(this._getModel(), sKey);
        },

        // =============================================================
        // DOCUMENT DETAIL DIALOG
        // =============================================================

        onDocumentPress: function (oEvent) {
            var oContext = oEvent.getSource().getBindingContext("dashboardView");
            if (!oContext) return;

            var oDoc = oContext.getObject();
            this._getModel().setProperty("/selectedDocument", oDoc);
            this._openDocumentDetailDialog();
        },

        _openDocumentDetailDialog: function () {
            var oView = this.getView();
            var that = this;

            if (!this._pDetailDialog) {
                this._pDetailDialog = Fragment.load({
                    id: oView.getId(),
                    name: "saps4hana.fiori.modules.wm.goods-issue.view.MaterialDocumentDetailDialog",
                    controller: this
                }).then(function (oDialog) {
                    oView.addDependent(oDialog);
                    return oDialog;
                });
            }

            this._pDetailDialog.then(function (oDialog) {
                oDialog.open();
            });
        },

        onCloseDocumentDetailDialog: function () {
            if (this._pDetailDialog) {
                this._pDetailDialog.then(function (oDialog) {
                    oDialog.close();
                });
            }
        },

        onNavigateToCreateFromDetail: function () {
            this.onCloseDocumentDetailDialog();
            var oDoc = this._getModel().getProperty("/selectedDocument");
            var sMvt = (oDoc && oDoc.MovementType) || "261";
            this._navigateToCreate(sMvt);
        },

        // =============================================================
        // CREATE GOODS ISSUE NAVIGATION (Keep existing flow reachable)
        // =============================================================

        onNavigateToCreate201: function () {
            this._navigateToCreate("201");
        },

        onNavigateToCreate261: function () {
            this._navigateToCreate("261");
        },

        onNavigateToCreate301: function () {
            this._navigateToCreate("301");
        },

        onNavigateToCreate311: function () {
            this._navigateToCreate("311");
        },

        _navigateToCreate: function (sMode) {
            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.navTo("wmGoodsIssueCreateMode", { mode: sMode || "261" });
        },

        onNavBackToOverview: function () {
            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.navTo("dashboard");
        },

        // =============================================================
        // DISPATCH QUEUE TRAY
        // =============================================================

        onOpenQueueTray: function () {
            var oView = this.getView();
            var that = this;

            if (!this._pQueueDialog) {
                this._pQueueDialog = Fragment.load({
                    id: oView.getId(),
                    name: "saps4hana.fiori.modules.wm.goods-issue.view.QueueTrayDialog",
                    controller: this
                }).then(function (oDialog) {
                    oView.addDependent(oDialog);
                    return oDialog;
                });
            }

            GoodsIssueService.getQueueSummary()
                .then(function (oSummary) {
                    var oQueueModel = that.getView().getModel("giQueue");
                    if (!oQueueModel) {
                        oQueueModel = new JSONModel();
                        that.getView().setModel(oQueueModel, "giQueue");
                    }
                    oQueueModel.setData({
                        queuedCount: oSummary.QueuedCount || 0,
                        items: oSummary.Items || []
                    });
                    that._pQueueDialog.then(function (oDialog) {
                        oDialog.open();
                    });
                })
                .catch(function () {
                    that._pQueueDialog.then(function (oDialog) {
                        oDialog.open();
                    });
                });
        },

        onCloseQueueTray: function () {
            if (this._pQueueDialog) {
                this._pQueueDialog.then(function (oDialog) {
                    oDialog.close();
                });
            }
        },

        onRefreshQueueTray: function () {
            var that = this;
            GoodsIssueService.getQueueSummary()
                .then(function (oSummary) {
                    var oQueueModel = that.getView().getModel("giQueue");
                    if (oQueueModel) {
                        oQueueModel.setData({
                            queuedCount: oSummary.QueuedCount || 0,
                            items: oSummary.Items || []
                        });
                    }
                });
        },

        onExit: function () {
            if (this._pDetailDialog) {
                this._pDetailDialog.then(function (oDialog) {
                    oDialog.destroy();
                });
                this._pDetailDialog = null;
            }
            if (this._pQueueDialog) {
                this._pQueueDialog.then(function (oDialog) {
                    oDialog.destroy();
                });
                this._pQueueDialog = null;
            }
        }
    });
});
