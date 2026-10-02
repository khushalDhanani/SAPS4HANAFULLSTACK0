sap.ui.define([
    "saps4hana/fiori/service/ODataClient"
], function (ODataClient) {
    "use strict";

    var BASE_PATH = "/odata/v4/goods-issue";
    var _oModel = null;

    /**
     * GoodsIssueService (shared)
     * Now only the Goods Issue Dashboard KPIs and the dispatch-queue summary use this shared service;
     * each movement type (201/261/301/311) has its own dedicated service. The former
     * reservation / stock / queue-mutation / stock-unit helper methods (and the OData V4 list-binding
     * shims) were removed as dead code after the per-type split.
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
         * Dispatch-queue summary for the dashboard.
         * @returns {Promise<Object>}
         */
        getQueueSummary: function () {
            return ODataClient.get(BASE_PATH + "/getQueueSummary()")
                .then(function (oData) {
                    return oData || { QueuedCount: 0, Items: [] };
                });
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
        },

        /**
         * Retry a queued goods issue transaction against live SAP by internal queue ID.
         * @param {string} sId - CAP UUID of the queue item
         * @returns {Promise<Object>}
         */
        retryQueuedGoodsIssue: function (sId) {
            return ODataClient.post(BASE_PATH + "/retryQueuedGoodsIssue", { ID: sId });
        },

        /**
         * Remove an item from the dispatch queue by internal queue ID.
         * @param {string} sId - CAP UUID of the queue item
         * @returns {Promise<boolean>}
         */
        clearQueuedGoodsIssue: function (sId) {
            return ODataClient.post(BASE_PATH + "/clearQueuedGoodsIssue", { ID: sId });
        },

        /**
         * Replay all pending queued goods issue transactions against live SAP.
         * @returns {Promise<Object>}
         */
        drainQueue: function () {
            return ODataClient.post(BASE_PATH + "/drainQueue", {});
        }
    };

    return GoodsIssueService;
});
