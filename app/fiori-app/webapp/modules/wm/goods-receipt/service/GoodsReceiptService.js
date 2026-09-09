sap.ui.define([
    "saps4hana/fiori/service/ODataClient"
], function (ODataClient) {
    "use strict";

    var BASE_PATH = "/odata/v4/goods-receipt";

    var GoodsReceiptService = {
        /**
         * Fetch open Inbound Deliveries from SAP S/4HANA for storage unit selection
         * @param {string} [sPlant]
         * @returns {Promise<Array>}
         */
        fetchOpenInboundDeliveries: function (sPlant) {
            var sQuery = "";
            if (sPlant && sPlant.trim()) {
                sQuery = "?$filter=Plant eq '" + encodeURIComponent(sPlant.trim()) + "'";
            }

            return ODataClient.get(BASE_PATH + "/OpenInboundDeliveries" + sQuery)
                .then(function (oData) {
                    return (oData && oData.value) ? oData.value : [];
                });
        },

        /**
         * Resolve scanned Storage Unit Number into authentic SAP Material, Batch, SLED, Plant, SLoc
         * @param {string} sStorageUnit
         * @returns {Promise<Object>}
         */
        resolveStorageUnit: function (sStorageUnit) {
            if (!sStorageUnit || !sStorageUnit.trim()) {
                return Promise.reject(new Error("Storage Unit Number is required."));
            }

            var sPath = BASE_PATH + "/getStorageUnitDetails(StorageUnit='" + encodeURIComponent(sStorageUnit.trim()) + "')";
            return ODataClient.get(sPath)
                .then(function (oData) {
                    return oData || {};
                });
        },

        /**
         * Fetch storage locations and bins for a material and plant
         * @param {string} sMaterial
         * @param {string} [sPlant]
         * @returns {Promise<Array>}
         */
        fetchMaterialStorageLocations: function (sMaterial, sPlant) {
            if (!sMaterial || !sMaterial.trim()) {
                return Promise.resolve([]);
            }

            var aFilters = ["Material eq '" + encodeURIComponent(sMaterial.trim()) + "'"];
            if (sPlant && sPlant.trim()) {
                aFilters.push("Plant eq '" + encodeURIComponent(sPlant.trim()) + "'");
            }

            var sQuery = "?$filter=" + aFilters.join(" and ");
            return ODataClient.get(BASE_PATH + "/MaterialStorageLocations" + sQuery)
                .then(function (oData) {
                    return (oData && oData.value) ? oData.value : [];
                });
        },

        /**
         * Fetch usable batches with SLED information for a material
         * @param {string} sMaterial
         * @param {string} [sPlant]
         * @param {string} [sStorageLocation]
         * @returns {Promise<Array>}
         */
        fetchMaterialBatches: function (sMaterial, sPlant, sStorageLocation) {
            if (!sMaterial || !sMaterial.trim()) {
                return Promise.resolve([]);
            }

            var aFilters = ["Material eq '" + encodeURIComponent(sMaterial.trim()) + "'"];
            if (sPlant && sPlant.trim()) {
                aFilters.push("Plant eq '" + encodeURIComponent(sPlant.trim()) + "'");
            }
            if (sStorageLocation && sStorageLocation.trim()) {
                aFilters.push("StorageLocation eq '" + encodeURIComponent(sStorageLocation.trim()) + "'");
            }

            var sQuery = "?$filter=" + aFilters.join(" and ");
            return ODataClient.get(BASE_PATH + "/MaterialBatches" + sQuery)
                .then(function (oData) {
                    return (oData && oData.value) ? oData.value : [];
                });
        },

        /**
         * Posts Goods Receipt (101) directly to SAP S/4HANA
         * @param {Object} oPayload
         * @returns {Promise<Object>}
         */
        postGoodsReceipt: function (oPayload) {
            return ODataClient.post(BASE_PATH + "/postGoodsReceipt", oPayload);
        }
    };

    return GoodsReceiptService;
});
