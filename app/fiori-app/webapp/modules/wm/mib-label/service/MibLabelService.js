sap.ui.define([
    "saps4hana/fiori/service/ODataClient"
], function (ODataClient) {
    "use strict";

    var SERVICE_BASE = "/odata/v4/mib-label";

    return {
        /**
         * Renders the Material Issued To Batch Sticker (form ZMM_AF_021 / RFC Z_MM_MIB_LABEL_PDF).
         *
         * @param {{warehouseNumber: string, transferOrderNumber: string, weightedBy: string, checkedBy: string}} oInput
         * @returns {Promise<{WarehouseNumber: string, TransferOrderNumber: string, LabelCount: number, FileName: string, PdfBase64: string}>}
         */
        generateMibSticker: function (oInput) {
            return ODataClient.post(SERVICE_BASE + "/generateMibSticker", {
                WarehouseNumber: oInput.warehouseNumber,
                TransferOrderNumber: oInput.transferOrderNumber,
                WeightedBy: oInput.weightedBy || "",
                CheckedBy: oInput.checkedBy || ""
            }, null, { maxRetries: 0 });
        },

        /**
         * Reads sticker line data directly from SAP tables (LTAK, LTAP, MAKT, AFPO).
         *
         * @param {{warehouseNumber: string, transferOrderNumber: string, weightedBy: string, checkedBy: string}} oInput
         * @returns {Promise<object[]>}
         */
        readMibStickerData: function (oInput) {
            return ODataClient.post(SERVICE_BASE + "/readMibStickerData", {
                WarehouseNumber: oInput.warehouseNumber,
                TransferOrderNumber: oInput.transferOrderNumber,
                WeightedBy: oInput.weightedBy || "",
                CheckedBy: oInput.checkedBy || ""
            }, null, { maxRetries: 0 });
        },

        /**
         * Retrieves warehouse context for the current user.
         *
         * @returns {Promise<{warehouses: string[], unrestricted: boolean}>}
         */
        getWarehouseContext: function () {
            return ODataClient.get(SERVICE_BASE + "/getWarehouseContext()");
        }
    };
});
