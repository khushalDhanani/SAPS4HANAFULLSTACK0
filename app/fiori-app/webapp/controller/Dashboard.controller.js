sap.ui.define([
    "saps4hana/fiori/controller/BaseController",
    "sap/ui/model/json/JSONModel",
    "saps4hana/fiori/service/ODataClient",
    "sap/m/MessageToast"
], function (
    BaseController,
    JSONModel,
    ODataClient,
    MessageToast
) {
    "use strict";

    /**
     * Counts returned by PurchaseOrderService.getDashboardMetrics(). Each is read live from SAP S/4HANA.
     * In the view model a metric is:
     *   undefined  while it is loading,
     *   null       when SAP did not return it (the tile shows "Failed"),
     *   a number   when SAP returned it.
     * Nothing is ever defaulted to 0, sampled, extrapolated or simulated.
     */
    var METRIC_KEYS = [
        "totalCount",
        "supplierCount",
        "productCount",
        "fiDocCount",
        "salesInquiryCount",
        "customerCount",
        "openSalesOrderCount",
        "totalSalesOrderCount",
        "bpCount",
        "glAccountCount",
        "costCenterCount",
        "profitCenterCount",
        "fixedAssetCount",
        "wbsElementCount",
        "internalOrderCount",
        "purchaseContractCount",
        "companyCodeCount",
        "plantCount",
        "storageLocationCount",
        "materialGroupCount",
        "purchasingOrgCount",
        "purchasingGroupCount",
        "warehouseCount",
        "openReservationCount",
        "inboundDeliveryCount",
        "gatewayCatalogCount"
    ];

    function toCount(vValue) {
        if (vValue === null || vValue === undefined || String(vValue).trim() === "") {
            return null;
        }
        var n = Number(vValue);
        return (isFinite(n) && Math.floor(n) === n && n >= 0) ? n : null;
    }

    return BaseController.extend("saps4hana.fiori.controller.Dashboard", {
        METRIC_KEYS: METRIC_KEYS,

        onInit: function () {
            var oViewModel = new JSONModel({
                selectedTab: "overview",
                connectionState: "None",
                connectionText: this._text("dashboardConnectionChecking", "Checking S/4HANA connection…"),
                metricsError: ""
            });
            this.getView().setModel(oViewModel, "dashboardView");

            var oOwnerComp = typeof this.getOwnerComponent === "function" ? this.getOwnerComponent() : null;
            var oRouter = oOwnerComp ? oOwnerComp.getRouter() : null;
            if (oRouter) {
                var oRoute = oRouter.getRoute("dashboard");
                if (oRoute) {
                    oRoute.attachPatternMatched(this._onDashboardMatched, this);
                }
            }
        },

        /**
         * Resolves an i18n text, falling back to the given default when no resource bundle is available.
         *
         * @private
         */
        _text: function (sKey, sDefault, aArgs) {
            try {
                var oComp = typeof this.getOwnerComponent === "function" ? this.getOwnerComponent() : null;
                var oI18n = oComp && oComp.getModel ? oComp.getModel("i18n") : null;
                var oBundle = oI18n && oI18n.getResourceBundle ? oI18n.getResourceBundle() : null;
                if (oBundle && oBundle.hasText && oBundle.hasText(sKey)) {
                    return oBundle.getText(sKey, aArgs);
                }
            } catch (e) {
                // fall through to the default text
            }
            var sText = sDefault;
            (aArgs || []).forEach(function (vArg, i) {
                sText = sText.replace("{" + i + "}", vArg);
            });
            return sText;
        },

        _onDashboardMatched: function () {
            var oAuthModel = this.getOwnerComponent() ? this.getOwnerComponent().getModel("auth") : null;
            if (oAuthModel && oAuthModel.getProperty("/isAuthenticated") === false) {
                return;
            }
            this._loadMetrics();
        },

        /**
         * Loads all dashboard counts from SAP in one call. A count SAP did not return stays null, and the
         * header status reports whether S/4HANA answered fully, partially or not at all.
         *
         * @returns {Promise<void>}
         */
        _loadMetrics: function () {
            var oViewModel = this.getView().getModel("dashboardView");
            if (!oViewModel) {
                return Promise.resolve();
            }

            var that = this;
            METRIC_KEYS.forEach(function (sKey) {
                oViewModel.setProperty("/" + sKey, undefined);
            });
            oViewModel.setProperty("/metricsError", "");
            oViewModel.setProperty("/connectionState", "None");
            oViewModel.setProperty("/connectionText", this._text("dashboardConnectionChecking", "Checking S/4HANA connection…"));

            return ODataClient.get("/odata/v4/purchase-order/getDashboardMetrics()")
                .then(function (res) {
                    var oMetrics = res;
                    if (typeof oMetrics === "string") {
                        oMetrics = JSON.parse(oMetrics);
                    }
                    if (oMetrics && typeof oMetrics.value === "string") {
                        oMetrics = JSON.parse(oMetrics.value);
                    }
                    if (!oMetrics || typeof oMetrics !== "object") {
                        throw new Error(that._text("dashboardMetricsInvalid", "The metrics service returned no data."));
                    }

                    var iAvailable = 0;
                    METRIC_KEYS.forEach(function (sKey) {
                        var iCount = toCount(oMetrics[sKey]);
                        oViewModel.setProperty("/" + sKey, iCount);
                        if (iCount !== null) {
                            iAvailable++;
                        }
                    });
                    if (iAvailable === 0 && oMetrics.error) {
                        oViewModel.setProperty("/metricsError", oMetrics.error);
                    }
                    that._setConnectionStatus(iAvailable, METRIC_KEYS.length);
                })
                .catch(function (err) {
                    METRIC_KEYS.forEach(function (sKey) {
                        oViewModel.setProperty("/" + sKey, null);
                    });
                    oViewModel.setProperty("/metricsError", that._text(
                        "dashboardMetricsUnavailable",
                        "Live figures could not be loaded from SAP S/4HANA: {0}",
                        [(err && err.message) || String(err || "")]
                    ));
                    that._setConnectionStatus(0, METRIC_KEYS.length);
                });
        },

        /**
         * @private
         */
        _setConnectionStatus: function (iAvailable, iTotal) {
            var oViewModel = this.getView().getModel("dashboardView");
            if (iAvailable === iTotal) {
                oViewModel.setProperty("/connectionState", "Success");
                oViewModel.setProperty("/connectionText", this._text("dashboardConnectionOk", "S/4HANA connected"));
            } else if (iAvailable === 0) {
                oViewModel.setProperty("/connectionState", "Error");
                oViewModel.setProperty("/connectionText", this._text("dashboardConnectionDown", "S/4HANA not reachable"));
            } else {
                oViewModel.setProperty("/connectionState", "Warning");
                oViewModel.setProperty("/connectionText", this._text(
                    "dashboardConnectionPartial",
                    "S/4HANA partially available ({0} of {1} figures)",
                    [String(iAvailable), String(iTotal)]
                ));
            }
        },

        /**
         * Tile value: the SAP count as text, or nothing while loading / unavailable.
         */
        formatMetricValue: function (vCount) {
            return (typeof vCount === "number") ? String(vCount) : "";
        },

        /**
         * Tile state: Loading until the count arrives, Failed when SAP did not return it.
         */
        formatTileState: function (vCount) {
            if (vCount === undefined) {
                return "Loading";
            }
            return vCount === null ? "Failed" : "Loaded";
        },

        onTabSelect: function (oEvent) {
            var sKey = oEvent.getParameter("key");
            if (!sKey && oEvent.getParameter("item")) {
                sKey = oEvent.getParameter("item").getKey();
            }
            if (sKey) {
                var oViewModel = this.getView().getModel("dashboardView");
                if (oViewModel) {
                    oViewModel.setProperty("/selectedTab", sKey);
                }
            }
        },

        onRefresh: function () {
            var that = this;
            this._loadMetrics().then(function () {
                MessageToast.show(that._text("dashboardActionRefreshDesc", "Fetch latest changes from SAP Gateway"));
            });
        },

        onNavigateToPurchaseOrders: function () {
            this.getOwnerComponent().getRouter().navTo("purchaseOrders");
        },

        onNavigateToCreatePO: function () {
            this.getOwnerComponent().getRouter().navTo("createPurchaseOrder");
        },

        onNavigateToJournalEntries: function () {
            this.getOwnerComponent().getRouter().navTo("journalEntries");
        },

        onNavigateToSalesInquiries: function () {
            this.getOwnerComponent().getRouter().navTo("salesInquiries");
        },

        onNavigateToCreateSalesInquiry: function () {
            this.getOwnerComponent().getRouter().navTo("createSalesInquiry");
        },

        onNavigateToGoodsIssue: function () {
            this.getOwnerComponent().getRouter().navTo("wmGoodsIssue");
        },

        onNavigateToGoodsReceipt: function () {
            this.getOwnerComponent().getRouter().navTo("wmGoodsReceipt");
        },

        switchToTab: function (sKey) {
            if (sKey) {
                var oTabBar = this.byId("dashboardTabBar");
                var oViewModel = this.getView().getModel("dashboardView");
                if (oTabBar) {
                    oTabBar.setSelectedKey(sKey);
                }
                if (oViewModel) {
                    oViewModel.setProperty("/selectedTab", sKey);
                }
            }
        },

        onSelectTabFI: function () { this.switchToTab("fi"); },
        onSelectTabMM: function () { this.switchToTab("mm"); },
        onSelectTabSD: function () { this.switchToTab("sd"); },
        onSelectTabEWM: function () { this.switchToTab("ewm"); },
        onSelectTabMasterData: function () { this.switchToTab("masterData"); }
    });
});
