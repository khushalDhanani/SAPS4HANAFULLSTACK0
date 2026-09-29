sap.ui.define([
    "sap/ui/model/json/JSONModel"
], function (JSONModel) {
    "use strict";

    var COLORS = {
        '201': '#8E44AD', // SAP Purple / Cost Center
        '261': '#0070F2', // SAP Horizon / Fiori Blue
        '301': '#E76500', // SAP Orange
        '311': '#107E3E'  // SAP Forest Green
    };

    var TYPES = ['201', '261', '301', '311'];

    /**
     * Small single-type donut: percentage-of-whole ring in the type's own color, count in the middle.
     * Independent of the other 3 types visually (each is its own <svg>), even though the underlying
     * Count/Percentage numbers all come from one server-computed Distribution array (see model note
     * in setServerData - the split here is purely visual, the data itself was never client-filtered).
     */
    function _generateMiniDonutSvg(nCount, nPercentage, sColor) {
        if (nCount === undefined || nCount === null) {
            return '<div style="display:flex;align-items:center;justify-content:center;height:110px;color:#6a6d70;font-size:0.75rem;">No data</div>';
        }

        var size = 96;
        var strokeWidth = 12;
        var radius = (size - strokeWidth) / 2;
        var center = size / 2;
        var circumference = 2 * Math.PI * radius;
        var pct = Number(nPercentage) || 0;
        var dash = (pct / 100 * circumference) + ' ' + circumference;

        var sFormattedCount = String(nCount).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

        return '<div style="display:flex;justify-content:center;align-items:center;">' +
            '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
            '<circle cx="' + center + '" cy="' + center + '" r="' + radius + '" fill="transparent" stroke="#e5e5e5" stroke-width="' + strokeWidth + '" />' +
            '<circle cx="' + center + '" cy="' + center + '" r="' + radius + '" fill="transparent" ' +
            'stroke="' + sColor + '" stroke-width="' + strokeWidth + '" ' +
            'stroke-dasharray="' + dash + '" stroke-linecap="round" ' +
            'transform="rotate(-90 ' + center + ' ' + center + ')" />' +
            '<text x="' + center + '" y="' + (center - 2) + '" text-anchor="middle" font-size="16" font-weight="700" fill="#32363a" font-family="Arial, sans-serif">' +
            sFormattedCount +
            '</text>' +
            '<text x="' + center + '" y="' + (center + 14) + '" text-anchor="middle" font-size="10" fill="#6a6d70" font-family="Arial, sans-serif">' +
            pct + '%' +
            '</text>' +
            '</svg>' +
            '</div>';
    }

    /**
     * Small single-series sparkline for one movement type, built from the same per-day Trend array
     * the combined chart used (Count201/Count261/Count301/Count311 columns are already aggregated
     * server-side per type in one RFC read - see GoodsIssueDashboardClient#getDashboardData step 7).
     */
    function _generateMiniTrendSvg(aTrend, sField, sColor) {
        if (!Array.isArray(aTrend) || aTrend.length === 0) {
            return '<div style="display:flex;align-items:center;justify-content:center;height:110px;color:#6a6d70;font-size:0.75rem;">No data</div>';
        }

        var width = 280;
        var height = 100;
        var padLeft = 8;
        var padRight = 8;
        var padTop = 12;
        var padBottom = 8;
        var chartW = width - padLeft - padRight;
        var chartH = height - padTop - padBottom;

        var maxY = 0;
        aTrend.forEach(function (d) {
            var v = d[sField] || 0;
            if (v > maxY) maxY = v;
        });
        if (maxY < 1) maxY = 1;

        var nPoints = aTrend.length;
        var xStep = nPoints > 1 ? chartW / (nPoints - 1) : chartW;

        var aPts = [];
        var nTotal = 0;
        for (var i = 0; i < nPoints; i++) {
            var val = aTrend[i][sField] || 0;
            nTotal += val;
            var x = padLeft + i * xStep;
            var y = padTop + chartH - (val / maxY) * chartH;
            aPts.push(x.toFixed(1) + ',' + y.toFixed(1));
        }

        return '<div style="width:100%;">' +
            '<svg viewBox="0 0 ' + width + ' ' + height + '" width="100%" height="' + height + '" style="display:block;">' +
            '<polyline fill="none" stroke="' + sColor + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" points="' + aPts.join(' ') + '" />' +
            '</svg>' +
            '</div>';
    }

    function _emptyRecentState() {
        return { items: [], loading: true, error: "", total: 0 };
    }

    var GoodsIssueDashboardModel = {
        /**
         * Create and return the initial JSONModel for the dashboard view
         * @returns {sap.ui.model.json.JSONModel}
         */
        createModel: function () {
            return new JSONModel({
                loading: true,
                error: "",
                lastUpdated: null,
                kpis: {
                    mvt201: { totalCount: "-", openPendingCount: "-", todayPostingsCount: "-" },
                    mvt261: { totalCount: "-", openPendingCount: "-", todayPostingsCount: "-" },
                    mvt301: { totalCount: "-", openPendingCount: "-", todayPostingsCount: "-" },
                    mvt311: { totalCount: "-", openPendingCount: "-", todayPostingsCount: "-" },
                    overall: { totalCount: "-", openPendingCount: "-", todayPostingsCount: "-" }
                },

                // Movement Type Distribution - one independent mini-donut per type, all derived from
                // the same server-computed Distribution array (see setServerData)
                distribution: [],
                miniDistribution: {
                    '201': { count: null, percentage: 0, svg: "" },
                    '261': { count: null, percentage: 0, svg: "" },
                    '301': { count: null, percentage: 0, svg: "" },
                    '311': { count: null, percentage: 0, svg: "" }
                },

                // Movement Trend Analysis - one independent mini-sparkline per type, derived from the
                // same server-computed per-day Trend array (see setServerData)
                trend: [],
                trendPeriod: "30", // "7" or "30"
                miniTrend: {
                    '201': { svg: "", periodTotal: null },
                    '261': { svg: "", periodTotal: null },
                    '301': { svg: "", periodTotal: null },
                    '311': { svg: "", periodTotal: null }
                },

                // Recent Postings - 4 fully independent tables, each with its own loading/error/items,
                // each backed by its own server-side MovementType-filtered getDashboardData call
                recent: {
                    '201': _emptyRecentState(),
                    '261': _emptyRecentState(),
                    '301': _emptyRecentState(),
                    '311': _emptyRecentState()
                },

                selectedDocument: null,
                plantFilter: ""
            });
        },

        /**
         * Update model with data returned by the combined (unfiltered) server getDashboardData call.
         * Feeds the KPI tiles (unchanged) plus the Distribution/Trend mini-widgets. Does NOT touch
         * Recent Postings - those are loaded independently per type via setRecentPostings.
         * @param {sap.ui.model.json.JSONModel} oModel
         * @param {Object} oData - GIDashboardData
         */
        setServerData: function (oModel, oData) {
            if (!oModel || !oData) return;

            var oKpis = oData.Kpis || {};
            var aDist = oData.Distribution || [];
            var aTrend = oData.Trend || [];
            var nOverallTotal = oKpis.Overall ? oKpis.Overall.TotalCount : 0;

            oModel.setProperty("/kpis", {
                mvt201: {
                    totalCount: oKpis.Mvt201 ? oKpis.Mvt201.TotalCount : 0,
                    openPendingCount: oKpis.Mvt201 ? oKpis.Mvt201.OpenPendingCount : 0,
                    todayPostingsCount: oKpis.Mvt201 ? oKpis.Mvt201.TodayPostingsCount : 0
                },
                mvt261: {
                    totalCount: oKpis.Mvt261 ? oKpis.Mvt261.TotalCount : 0,
                    openPendingCount: oKpis.Mvt261 ? oKpis.Mvt261.OpenPendingCount : 0,
                    todayPostingsCount: oKpis.Mvt261 ? oKpis.Mvt261.TodayPostingsCount : 0
                },
                mvt301: {
                    totalCount: oKpis.Mvt301 ? oKpis.Mvt301.TotalCount : 0,
                    openPendingCount: oKpis.Mvt301 ? oKpis.Mvt301.OpenPendingCount : 0,
                    todayPostingsCount: oKpis.Mvt301 ? oKpis.Mvt301.TodayPostingsCount : 0
                },
                mvt311: {
                    totalCount: oKpis.Mvt311 ? oKpis.Mvt311.TotalCount : 0,
                    openPendingCount: oKpis.Mvt311 ? oKpis.Mvt311.OpenPendingCount : 0,
                    todayPostingsCount: oKpis.Mvt311 ? oKpis.Mvt311.TodayPostingsCount : 0
                },
                overall: {
                    totalCount: nOverallTotal,
                    openPendingCount: oKpis.Overall ? oKpis.Overall.OpenPendingCount : 0,
                    todayPostingsCount: oKpis.Overall ? oKpis.Overall.TodayPostingsCount : 0
                }
            });

            oModel.setProperty("/distribution", aDist);
            var oMiniDist = {};
            TYPES.forEach(function (sType) {
                var oItem = aDist.filter(function (d) { return d.MovementType === sType; })[0];
                var nCount = oItem ? oItem.Count : null;
                var nPct = oItem ? oItem.Percentage : 0;
                oMiniDist[sType] = {
                    count: nCount,
                    percentage: nPct,
                    svg: _generateMiniDonutSvg(nCount, nPct, COLORS[sType])
                };
            });
            oModel.setProperty("/miniDistribution", oMiniDist);

            oModel.setProperty("/trend", aTrend);
            this._refreshMiniTrend(oModel);

            oModel.setProperty("/lastUpdated", oData.LastUpdated || new Date().toISOString());
            oModel.setProperty("/loading", false);
            oModel.setProperty("/error", "");
        },

        /**
         * Recompute the 4 mini trend sparklines from the currently held /trend array.
         * @param {sap.ui.model.json.JSONModel} oModel
         */
        _refreshMiniTrend: function (oModel) {
            var aTrend = oModel.getProperty("/trend") || [];
            var oMiniTrend = {};
            TYPES.forEach(function (sType) {
                var sField = "Count" + sType;
                var nTotal = aTrend.reduce(function (sum, d) { return sum + (d[sField] || 0); }, 0);
                oMiniTrend[sType] = {
                    svg: _generateMiniTrendSvg(aTrend, sField, COLORS[sType]),
                    periodTotal: aTrend.length ? nTotal : null
                };
            });
            oModel.setProperty("/miniTrend", oMiniTrend);
        },

        /**
         * Update trend period (7 or 30 days) - the combined call is re-issued by the controller for
         * the new window, so this only updates the property; controller triggers the actual reload.
         * @param {sap.ui.model.json.JSONModel} oModel
         * @param {string} sPeriod - "7" or "30"
         */
        setTrendPeriod: function (oModel, sPeriod) {
            var iDays = parseInt(sPeriod || "30", 10);
            oModel.setProperty("/trendPeriod", String(iDays));
        },

        /**
         * Mark one type's Recent Postings table as loading (independent per-type state).
         * @param {sap.ui.model.json.JSONModel} oModel
         * @param {string} sType
         */
        setRecentPostingsLoading: function (oModel, sType) {
            oModel.setProperty("/recent/" + sType + "/loading", true);
            oModel.setProperty("/recent/" + sType + "/error", "");
        },

        /**
         * Populate one type's independent Recent Postings table from its own
         * MovementType-filtered getDashboardData response.
         * @param {sap.ui.model.json.JSONModel} oModel
         * @param {string} sType
         * @param {Object} oData - GIDashboardData (RecentDocuments already server-filtered to sType)
         */
        setRecentPostings: function (oModel, sType, oData) {
            var aDocs = (oData && oData.RecentDocuments) || [];
            oModel.setProperty("/recent/" + sType + "/items", aDocs);
            oModel.setProperty("/recent/" + sType + "/total", aDocs.length);
            oModel.setProperty("/recent/" + sType + "/loading", false);
            oModel.setProperty("/recent/" + sType + "/error", "");
        },

        /**
         * Record an independent load failure for one type's Recent Postings table.
         * @param {sap.ui.model.json.JSONModel} oModel
         * @param {string} sType
         * @param {string} sMessage
         */
        setRecentPostingsError: function (oModel, sType, sMessage) {
            oModel.setProperty("/recent/" + sType + "/loading", false);
            oModel.setProperty("/recent/" + sType + "/error", sMessage || "");
        }
    };

    return GoodsIssueDashboardModel;
});
