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

    var TYPES = ["201", "261", "301", "311"];
    var SECTION_ID_BY_TYPE = {
        "201": "panelRecent201",
        "261": "panelRecent261",
        "301": "panelRecent301",
        "311": "panelRecent311",
        "ALL": "panelDistribution"
    };
    // Each movement type has its own dedicated create page/route; the "New X" actions open the
    // per-type route below (there is no shared/generic goods-issue create route).
    var CREATE_ROUTE_BY_TYPE = {
        "201": "wmGoodsIssue201",
        "261": "wmGoodsIssue261",
        "301": "wmGoodsIssue301",
        "311": "wmGoodsIssue311"
    };
    // Movement type pending / open reservations list routes.
    // 201, 261, and 311 open their Open Reservations/Transfers list; 301 opens its dedicated create page.
    var mRoutes = {
        "201": "wmGoodsIssue201Pending",
        "261": "wmGoodsIssue261Pending",
        "301": "wmGoodsIssue301",
        "311": "wmGoodsIssue311Pending"
    };

    return BaseController.extend("saps4hana.fiori.modules.wm.goods-issue.controller.GoodsIssueDashboard", {
        mRoutes: mRoutes,

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
                this._loadAll(false);
            }
        },

        _getModel: function () {
            return this.getView().getModel("dashboardView");
        },

        _onRouteMatched: function () {
            this._loadAll(false);
        },

        _loadAll: function (bForceRefresh) {
            return this._loadDashboardData(bForceRefresh);
        },

        /**
         * Loads the whole dashboard from a SINGLE combined getDashboardData call: KPI tiles, the
         * Distribution / Trend widgets, AND all four per-type Recent Postings tables (from the
         * response's RecentByType). This replaces the former 5-call fan-out (1 combined + 4 per-type).
         */
        _loadDashboardData: function (bForceRefresh) {
            var oModel = this._getModel();
            if (!oModel) return;

            oModel.setProperty("/loading", true);
            oModel.setProperty("/error", "");
            TYPES.forEach(function (sType) {
                GoodsIssueDashboardModel.setRecentPostingsLoading(oModel, sType);
            }, this);

            var iDays = parseInt(oModel.getProperty("/trendPeriod") || "30", 10);
            var sPlant = oModel.getProperty("/plantFilter") || "";

            var that = this;
            return GoodsIssueService.getDashboardData(iDays, sPlant, bForceRefresh)
                .then(function (oData) {
                    if (oData) {
                        GoodsIssueDashboardModel.setServerData(oModel, oData);
                        GoodsIssueDashboardModel.setAllRecentPostings(oModel, oData);
                    } else {
                        oModel.setProperty("/loading", false);
                    }
                    return oData;
                })
                .catch(function (err) {
                    var sMsg = (err && err.message) || String(err || "");
                    oModel.setProperty("/loading", false);
                    oModel.setProperty("/error", sMsg || that.getText("giLoadErrorMsg", null, "Failed to load Goods Issue dashboard data from SAP S/4HANA."));
                    TYPES.forEach(function (sType) {
                        GoodsIssueDashboardModel.setRecentPostingsError(oModel, sType,
                            sMsg || that.getText("giRecentPostingsLoadError", null, "Failed to load recent postings."));
                    }, this);
                });
        },

        onRefresh: function () {
            return this._loadAll(true);
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
        // KPI CARD SELECTION (Phase 3: direct navigation, no filter toggle).
        // Pressing a movement-type KPI tile jumps straight to that type's own
        // recent-postings section; the Overall tile jumps to the all-types
        // distribution overview. Nothing is filtered/toggled.
        // =============================================================

        _selectKpi: function (sType) {
            this._scrollToSection(sType);
        },

        _scrollToSection: function (sType) {
            var sId = SECTION_ID_BY_TYPE[sType];
            if (!sId) return;
            var oControl = this.byId(sId);
            var oDomRef = oControl && oControl.getDomRef();
            if (oDomRef && typeof oDomRef.scrollIntoView === "function") {
                oDomRef.scrollIntoView({ behavior: "smooth", block: "start" });
            }
        },

        onSelectKpi201: function () {
            this._selectKpi("201");
        },

        onSelectKpi261: function () {
            this._selectKpi("261");
        },

        onSelectKpi301: function () {
            this._selectKpi("301");
        },

        onSelectKpi311: function () {
            this._selectKpi("311");
        },

        onSelectKpiOverall: function () {
            this._scrollToSection("ALL");
        },

        // =============================================================
        // TREND PERIOD (7 / 30 Days) - reloads the combined call and all 4
        // independent Recent Postings tables for the new window
        // =============================================================

        onTrendPeriodChange: function (oEvent) {
            var oItem = oEvent.getParameter("item");
            var sKey = oItem ? oItem.getKey() : "30";
            GoodsIssueDashboardModel.setTrendPeriod(this._getModel(), sKey);
            this._loadAll(true);
        },

        // =============================================================
        // DOCUMENT DETAIL DIALOG (shared by all 4 Recent Postings tables)
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
            var sRoute = CREATE_ROUTE_BY_TYPE[sMode] || CREATE_ROUTE_BY_TYPE["261"];
            oRouter.navTo(sRoute);
        },

        onNavBackToOverview: function () {
            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.navTo("dashboard");
        },

        // =============================================================
        // OPEN RESERVATIONS / TRANSFERS NAVIGATION
        // =============================================================

        onNavigateToPending201: function () {
            this._navigateToPending("201");
        },

        onNavigateToPending261: function () {
            this._navigateToPending("261");
        },

        onNavigateToPending311: function () {
            this._navigateToPending("311");
        },

        _navigateToPending: function (sMode) {
            var oRouter = this.getOwnerComponent().getRouter();
            var sRoute = (this.mRoutes && this.mRoutes[sMode]) || mRoutes[sMode] || mRoutes["311"];
            oRouter.navTo(sRoute);
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
