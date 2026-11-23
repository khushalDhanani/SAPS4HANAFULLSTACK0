function toCount(vValue) {
    if (vValue === null || vValue === undefined || String(vValue).trim() === "") {
        return null;
    }
    var n = Number(vValue);
    return (isFinite(n) && Math.floor(n) === n && n >= 0) ? n : null;
}

function createDashboardMetricsSection(deps) {
    deps = deps || {};
    var ODataClient = deps.ODataClient;
    var METRIC_KEYS = deps.METRIC_KEYS || [];

    return {
        _loadDashboard: function () {
            this._bLoadPending = false;
            this._bFiguresLoaded = true;
            this._loadMetrics();
        },

        _loadMetrics: function () {
            var oViewModel = this.getView().getModel("dashboardView");
            if (!oViewModel) {
                return Promise.resolve();
            }
            var that = this;
            METRIC_KEYS.forEach(function (sKey) { oViewModel.setProperty("/" + sKey, undefined); });
            oViewModel.setProperty("/metricsError", "");

            return ODataClient.get("/odata/v4/purchase-order/getDashboardMetrics()")
                .then(function (res) {
                    var oMetrics = res;
                    if (typeof oMetrics === "string") { oMetrics = JSON.parse(oMetrics); }
                    if (oMetrics && typeof oMetrics.value === "string") { oMetrics = JSON.parse(oMetrics.value); }
                    if (!oMetrics || typeof oMetrics !== "object") {
                        throw new Error(that._text("dashboardMetricsInvalid", "The metrics service returned no data."));
                    }
                    var iAvailable = 0;
                    METRIC_KEYS.forEach(function (sKey) {
                        var iCount = toCount(oMetrics[sKey]);
                        oViewModel.setProperty("/" + sKey, iCount);
                        if (iCount !== null) { iAvailable++; }
                    });
                    if (iAvailable === 0 && oMetrics.error) {
                        oViewModel.setProperty("/metricsError", oMetrics.error);
                    }
                })
                .catch(function (err) {
                    METRIC_KEYS.forEach(function (sKey) { oViewModel.setProperty("/" + sKey, null); });
                    oViewModel.setProperty("/metricsError", that._text("dashboardMetricsUnavailable", "Live figures could not be loaded from SAP S/4HANA: {0}", [(err && err.message) || String(err || "")]));
                });
        },

        formatMetricValue: function (vCount) {
            return (typeof vCount === "number") ? String(vCount) : "";
        },

        formatTileState: function (vCount) {
            if (vCount === undefined) { return "Loading"; }
            return vCount === null ? "Failed" : "Loaded";
        }
    };
}

var oExports = {
    createDashboardMetricsSection: createDashboardMetricsSection
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
