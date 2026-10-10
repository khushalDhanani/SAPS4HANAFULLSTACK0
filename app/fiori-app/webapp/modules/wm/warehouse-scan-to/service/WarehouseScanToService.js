sap.ui.define([
    "saps4hana/fiori/service/ODataClient"
], function (ODataClient) {
    "use strict";

    var BASE_PATH = "/odata/v4/tr-to";
    var _oModel = null;

    /**
     * WarehouseScanToService
     * Dedicated client service for Chunk 4 (Step 2: Warehouse Scan -> TO -> Auto Confirm).
     * Communicates directly with /odata/v4/tr-to service endpoints.
     */
    var WarehouseScanToService = {
        /**
         * Set the OData V4 model
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
         * Retrieve open Transfer Requirements for the warehouse
         * @param {string} [sLgnum='W01'] - Warehouse Number
         * @param {string} [sMvt] - Optional movement type filter
         * @returns {Promise<Array>}
         */
        getOpenTRs: function (sLgnum, sMvt) {
            var sWh = sLgnum || "W01";
            var sMvtParam = sMvt ? sMvt.trim() : "";
            var sUrl = BASE_PATH + "/getOpenTRs(lgnum='" + encodeURIComponent(sWh.trim()) + "',mvt='" + encodeURIComponent(sMvtParam) + "')";
            return ODataClient.get(sUrl).then(function (oData) {
                var aItems = (oData && oData.value) ? oData.value : (Array.isArray(oData) ? oData : []);
                return aItems;
            });
        },

        /**
         * Look up Transfer Requirement with open quantity and material requirement profiles
         * (MARA batch/serial management detection)
         * @param {string} sTbnum - TR Number
         * @param {string} [sLgnum='W01'] - Warehouse Number
         * @returns {Promise<Object>}
         */
        lookupTR: function (sTbnum, sLgnum) {
            if (!sTbnum || !sTbnum.trim()) {
                return Promise.reject(new Error("Transfer Requirement number is required"));
            }
            var sWh = sLgnum || "W01";
            var sUrl = BASE_PATH + "/lookupTR(tbnum='" + encodeURIComponent(sTbnum.trim()) + "',lgnum='" + encodeURIComponent(sWh.trim()) + "')";
            return ODataClient.get(sUrl).then(function (oData) {
                return (oData && oData.value) ? oData.value : oData;
            });
        },

        /**
         * Create Transfer Order from TR with batch/serials and auto-confirm (Step 2)
         * @param {Object} oPayload
         * @param {string} oPayload.lgnum
         * @param {string} oPayload.tbnum
         * @param {string} [oPayload.tbpos='0001']
         * @param {number} oPayload.qty
         * @param {string} [oPayload.unit='KG']
         * @param {string} [oPayload.batch]
         * @param {Array<string>} [oPayload.serials]
         * @param {boolean} [oPayload.autoConfirm=true]
         * @param {string} [oPayload.storageUnit]
         * @returns {Promise<Object>}
         */
        createTOFromTR: function (oPayload) {
            if (!oPayload || !oPayload.tbnum) {
                return Promise.reject(new Error("Transfer Requirement number is required"));
            }
            if (!oPayload.qty || parseFloat(oPayload.qty) <= 0) {
                return Promise.reject(new Error("Quantity must be greater than zero"));
            }
            var sUrl = BASE_PATH + "/createTOFromTR";
            return ODataClient.post(sUrl, oPayload).then(function (oData) {
                return (oData && oData.value) ? oData.value : oData;
            });
        }
    };

    return WarehouseScanToService;
});
