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
        "gatewayCatalogCount",
        "ordersDueCount",
        "customerInvoiceCount",
        "customerReturnCount"
    ];

    // Movement-type KPI model property keys (loaded from GoodsIssueService.getDashboardData)
    var GI_KPI_KEYS = [
        "mvt201Total", "mvt201Today",
        "mvt261Total", "mvt261Today",
        "mvt301Total", "mvt301Today",
        "mvt311Total", "mvt311Today"
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
            this._loadGiKpis();
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
                    that._setConnectionStatus(iAvailable, METRIC_KEYS.length, oMetrics.asOf);
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
        _setConnectionStatus: function (iAvailable, iTotal, sAsOf) {
            var oViewModel = this.getView().getModel("dashboardView");
            // Figures may come from the server cache (30 s transactional / 5 min master data): show when SAP was actually read.
            var dAsOf = sAsOf ? new Date(sAsOf) : null;
            var sAsOfText = (dAsOf && !isNaN(dAsOf.getTime())) ? dAsOf.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
            if (iAvailable === iTotal) {
                oViewModel.setProperty("/connectionState", "Success");
                oViewModel.setProperty("/connectionText", sAsOfText
                    ? this._text("dashboardConnectionOkAsOf", "S/4HANA connected \u00b7 figures as of {0}", [sAsOfText])
                    : this._text("dashboardConnectionOk", "S/4HANA connected"));
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
            this._loadGiKpis(true);
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

        onNavigateToSalesOrders: function () {
            this.getOwnerComponent().getRouter().navTo("salesOrders");
        },

        onNavigateToCreateSalesOrder: function () {
            this.getOwnerComponent().getRouter().navTo("createSalesOrder");
        },

        onNavigateToGoodsIssue: function () {
            this.getOwnerComponent().getRouter().navTo("wmGoodsIssue");
        },

        onNavigateToGoodsReceipt: function () {
            this.getOwnerComponent().getRouter().navTo("wmGoodsReceipt");
        },

        onNavigateToTrTo: function () {
            this.getOwnerComponent().getRouter().navTo("wmTrTo");
        },

        onNavigateToOrdersDueForDelivery: function () {
            this.getOwnerComponent().getRouter().navTo("ordersDueForDelivery");
        },

        onNavigateToCustomerInvoices: function () {
            this.getOwnerComponent().getRouter().navTo("customerInvoices");
        },

        onNavigateToCustomerReturns: function () {
            this.getOwnerComponent().getRouter().navTo("customerReturns");
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
        onSelectTabMasterData: function () { this.switchToTab("masterData"); },

        // ─── Movement-Type KPI Cards (EWM Tab) ───────────────────────────

        /**
         * Loads Goods Issue KPI data (movement types 201/261/301/311) from
         * GoodsIssueService.getDashboardData. The server uses a 60 s cache.
         *
         * Model properties set:
         *   /mvt{201|261|301|311}Total  — all-time posting count (number|null|undefined)
         *   /mvt{201|261|301|311}Today  — today's posting count (number|null|undefined)
         *   /giKpiError                 — error string (empty when OK)
         *
         * @param {boolean} [bForceRefresh] - bypass server cache
         * @returns {Promise<void>}
         */
        _loadGiKpis: function (bForceRefresh) {
            var oViewModel = this.getView().getModel("dashboardView");
            if (!oViewModel) {
                return Promise.resolve();
            }

            var that = this;

            // Set loading (undefined = Loading tile state)
            GI_KPI_KEYS.forEach(function (sKey) {
                oViewModel.setProperty("/" + sKey, undefined);
            });
            oViewModel.setProperty("/giKpiError", "");

            var sUrl = "/odata/v4/goods-issue/getDashboardData(" +
                "days=30,plant='',forceRefresh=" + Boolean(bForceRefresh) + ")";

            return ODataClient.get(sUrl)
                .then(function (oData) {
                    if (!oData || !oData.Kpis) {
                        throw new Error(that._text("dashboardMvtNoData", "No movement data"));
                    }
                    var oKpis = oData.Kpis;

                    var mMapping = {
                        "Mvt201": { total: "mvt201Total", today: "mvt201Today" },
                        "Mvt261": { total: "mvt261Total", today: "mvt261Today" },
                        "Mvt301": { total: "mvt301Total", today: "mvt301Today" },
                        "Mvt311": { total: "mvt311Total", today: "mvt311Today" }
                    };

                    Object.keys(mMapping).forEach(function (sKpiKey) {
                        var oItem = oKpis[sKpiKey];
                        var mTarget = mMapping[sKpiKey];
                        if (oItem && typeof oItem.TotalCount === "number") {
                            oViewModel.setProperty("/" + mTarget.total, oItem.TotalCount);
                        } else {
                            oViewModel.setProperty("/" + mTarget.total, null);
                        }
                        if (oItem && typeof oItem.TodayPostingsCount === "number") {
                            oViewModel.setProperty("/" + mTarget.today, oItem.TodayPostingsCount);
                        } else {
                            oViewModel.setProperty("/" + mTarget.today, null);
                        }
                    });
                })
                .catch(function (err) {
                    GI_KPI_KEYS.forEach(function (sKey) {
                        oViewModel.setProperty("/" + sKey, null);
                    });
                    oViewModel.setProperty("/giKpiError", that._text(
                        "dashboardMvtLoadError",
                        "Movement type KPIs could not be loaded from SAP S/4HANA: {0}",
                        [(err && err.message) || String(err || "")]
                    ));
                });
        },

        /**
         * Formats today's count into the tile unit text, e.g. "Today: 5".
         * @param {*} vToday
         * @returns {string}
         */
        formatMvtTodayUnit: function (vToday) {
            if (typeof vToday === "number") {
                return this._text("dashboardMvtTodayUnit", "Today: {0}", [String(vToday)]);
            }
            return this._text("dashboardMvtTotalUnit", "Total Postings");
        },

        /**
         * Navigates to the Goods Issue dashboard and applies a movement-type filter.
         * @param {string} sMvtType - "201", "261", "301", or "311"
         * @private
         */
        _navigateToGiFiltered: function (sMvtType) {
            this.getOwnerComponent().getRouter().navTo("wmGoodsIssue", {}, undefined);
            MessageToast.show(this._text(
                "dashboardMvtFilterActive",
                "Filtered: Movement {0}",
                [sMvtType]
            ));
        },

        onMvt201TilePress: function () {
            this._navigateToGiFiltered("201");
        },

        onMvt261TilePress: function () {
            this._navigateToGiFiltered("261");
        },

        onMvt301TilePress: function () {
            this._navigateToGiFiltered("301");
        },

        onMvt311TilePress: function () {
            this._navigateToGiFiltered("311");
        }
    });
});
