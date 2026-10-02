sap.ui.define([
    "saps4hana/fiori/service/ODataClient"
], function (ODataClient) {
    "use strict";

    var BASE_PATH = "/odata/v4/goods-issue";
    var _oModel = null;

    /**
     * GoodsIssueService (shared)
     * Provides Goods Issue Dashboard KPIs; each movement type (201/261/301/311)
     * has its own dedicated service. All goods issue transactions post directly to S/4HANA.
     */
    var GoodsIssueService = {
        /**
         * Set the OData V4 model (called once from Component.js during model init).
         * @param {sap.ui.model.odata.v4.ODataModel} oModel
         */
        setModel: function (oModel) {
            _oModel = oModel;
        },

        /**
         * Get the current OData V4 model
         * @returns {sap.ui.model.odata.v4.ODataModel|null}
         */
        getModel: function () {
            return _oModel;
        },

        /**
         * Fetch Goods Issue Dashboard data (server-side aggregation of KPIs, charts, and recent documents)
         * @param {number} [nDays=30] - Lookback window in days (7 or 30)
         * @param {string} [sPlant=""] - Optional plant filter
         * @param {boolean} [bForceRefresh=false] - Force cache bypass
         * @param {string} [sMovementType=""] - Optional movement type (201/261/301/311) to filter
         *   RecentDocuments server-side to a single type.
         * @returns {Promise<Object>} GIDashboardData
         */
        getDashboardData: function (nDays, sPlant, bForceRefresh, sMovementType) {
            var iDays = typeof nDays === "number" && nDays > 0 ? nDays : 30;
            var sPlantVal = sPlant ? String(sPlant).trim().toUpperCase() : "";
            var bForce = Boolean(bForceRefresh);
            var sMvt = sMovementType ? String(sMovementType).trim().toUpperCase() : "";

            var sQuery = BASE_PATH + "/getDashboardData(" +
                "days=" + iDays + "," +
                "plant='" + encodeURIComponent(sPlantVal) + "'," +
                "forceRefresh=" + bForce + "," +
                "movementType='" + encodeURIComponent(sMvt) + "'" +
                ")";

            return ODataClient.get(sQuery).then(function (oData) {
                return oData || null;
            });
        }
    };

    return GoodsIssueService;
});
