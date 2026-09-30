sap.ui.define([
    "saps4hana/fiori/service/ODataClient"
], function (ODataClient) {
    "use strict";

    var BASE_PATH = "/odata/v4/tr-to";
    var _oModel = null;

    /**
     * TrToService
     * Client service for Warehouse Management Transfer Requirement (TR)
     * to Transfer Order (TO) mobile RF workflow. Live SAP only — no mock/simulation
     * path (a fabricated TO number is never an acceptable substitute for a real SAP posting).
     */
    var TrToService = {
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
         * @param {string} [sMvt] - Optional movement type filter (e.g. '319')
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
         * Retrieve Transfer Requirement header and line items
         * @param {string} sTbnum - TR Number or Production Order Number
         * @param {string} [sLgnum='W01'] - Warehouse Number
         * @returns {Promise<Object>}
         */
        getTR: function (sTbnum, sLgnum) {
            if (!sTbnum) {
                return Promise.reject(new Error("Transfer Requirement number is required"));
            }
            var sWh = sLgnum || "W01";
            var sUrl = BASE_PATH + "/getTR(tbnum='" + encodeURIComponent(sTbnum.trim()) + "',lgnum='" + encodeURIComponent(sWh.trim()) + "')";

            return ODataClient.get(sUrl).then(function (oData) {
                return (oData && oData.value) ? oData.value : oData;
            });
        },

        /**
         * Validate scanned Storage Unit against Transfer Requirement
         * @param {string} sLenum - Storage Unit Number
         * @param {string} sTbnum - Transfer Requirement Number
         * @param {string} [sLgnum='W01'] - Warehouse Number
         * @returns {Promise<Object>}
         */
        checkSU: function (sLenum, sTbnum, sLgnum) {
            if (!sLenum) {
                return Promise.reject(new Error("Storage Unit number is required"));
            }
            var sWh = sLgnum || "W01";
            var sUrl = BASE_PATH + "/checkSU(lenum='" + encodeURIComponent(sLenum.trim()) + "',tbnum='" + encodeURIComponent(sTbnum ? sTbnum.trim() : "") + "',lgnum='" + encodeURIComponent(sWh.trim()) + "')";

            return ODataClient.get(sUrl).then(function (oData) {
                return (oData && oData.value) ? oData.value : oData;
            });
        },

        /**
         * Synchronously create Transfer Order (and optional 1-step confirm)
         * @param {Object} oPayload
         * @param {string} oPayload.lgnum
         * @param {string} oPayload.tbnum
         * @param {string} oPayload.tbpos
         * @param {string} oPayload.lenum
         * @param {number} oPayload.qty
         * @param {number} [oPayload.openQty]
         * @param {string} [oPayload.unit='KG']
         * @param {boolean} [oPayload.confirmImmediate=true]
         * @returns {Promise<Object>}
         */
        createTO: function (oPayload) {
            if (!oPayload || !oPayload.tbnum) {
                return Promise.reject(new Error("Transfer Requirement number is required"));
            }
            if (!oPayload.lenum) {
                return Promise.reject(new Error("Storage Unit number is required"));
            }
            if (!oPayload.qty || parseFloat(oPayload.qty) <= 0) {
                return Promise.reject(new Error("Quantity must be greater than zero"));
            }
            if (oPayload.openQty !== undefined && parseFloat(oPayload.qty) > parseFloat(oPayload.openQty)) {
                return Promise.reject(new Error("Requested quantity (" + oPayload.qty + ") exceeds open TR quantity (" + oPayload.openQty + ")"));
            }

            var sUrl = BASE_PATH + "/createTO";
            return ODataClient.post(sUrl, oPayload).then(function (oData) {
                return (oData && oData.value) ? oData.value : oData;
            });
        }
    };

    return TrToService;
});
