sap.ui.define([
    "saps4hana/fiori/service/ODataClient"
], function (ODataClient) {
    "use strict";

    var SERVICE_BASE = "/odata/v4/purchase-order";

    /**
     * PurchaseOrderService
     * Encapsulates Purchase Order business API communication with the CAP backend.
     */
    return {
        /**
         * Dispatches createPurchaseOrder action to the CAP OData service.
         *
         * @param {Object} oPayload
         * @param {Object} oPayload.header
         * @param {Array<Object>} oPayload.items
         * @returns {Promise<string>} Resolves to created Purchase Order ID
         */
        createPurchaseOrder: function (oPayload) {
            var sUrl = SERVICE_BASE + "/createPurchaseOrder";
            return ODataClient.post(sUrl, oPayload).then(function (result) {
                if (!result) return "";
                return result.value || result.PurchaseOrder || result;
            });
        },

        /**
         * Queries Purchase Orders list from CAP OData service.
         *
         * @param {string} [sQuery] Optional OData query string (e.g. "?$top=10")
         * @returns {Promise<Array<Object>>}
         */
        getPurchaseOrders: function (sQuery) {
            var sUrl = SERVICE_BASE + "/PurchaseOrders" + (sQuery || "");
            return ODataClient.get(sUrl).then(function (result) {
                if (!result) return [];
                return result.value || (result.d && result.d.results) || [];
            });
        },

        /**
         * Queries a single Purchase Order by key.
         *
         * @param {string} sPoNumber
         * @returns {Promise<Object>}
         */
        getPurchaseOrder: function (sPoNumber) {
            var sUrl = SERVICE_BASE + "/PurchaseOrders('" + encodeURIComponent(sPoNumber) + "')";
            return ODataClient.get(sUrl);
        }
    };
});
