sap.ui.define([
    "saps4hana/fiori/service/ODataClient"
], function (ODataClient) {
    "use strict";

    var SERVICE_BASE = "/odata/v4/quarantine-label";

    return {
        /**
         * Renders the quarantine labels of a material document in SAP (form ZMM_AF_017).
         * Never retried automatically: rendering side effects in SAP are not yet proven.
         *
         * @param {{materialDocument: string, year: string, text: string}} oInput
         * @returns {Promise<{MaterialDocument: string, MaterialDocumentYear: string, LabelCount: number, FileName: string,
         *     LabelSize: ?string, PageWidthPt: ?number, PageHeightPt: ?number, PageSizeOk: ?boolean, PdfBase64: string}>}
         */
        generateLabels: function (oInput) {
            return ODataClient.post(SERVICE_BASE + "/generateLabels", {
                MaterialDocument: oInput.materialDocument,
                MaterialDocumentYear: oInput.year,
                Text: oInput.text || ""
            }, null, { maxRetries: 0 });
        },

        /**
         * Label rows for the app's own 4 x 6 label (read only in SAP).
         *
         * @param {{materialDocument: string, year: string, text: string}} oInput
         * @returns {Promise<{MaterialDocument: string, MaterialDocumentYear: string, LabelSize: ?string, Rows: object[]}>}
         */
        labelRows: function (oInput) {
            return ODataClient.post(SERVICE_BASE + "/labelRows", {
                MaterialDocument: oInput.materialDocument,
                MaterialDocumentYear: oInput.year,
                Text: oInput.text || ""
            }, null, { maxRetries: 0 });
        },

        /**
         * Goods-receipt documents (movement type 101) of a plant: a posting-date range or one document (read only in SAP).
         *
         * @param {{plant: string, dateFrom: string, dateTo: string, materialDocument: string, year: string}} oInput
         * @returns {Promise<{Plant: string, DateFrom: ?string, DateTo: ?string, More: boolean, Documents: object[]}>}
         */
        listDocuments: function (oInput) {
            return ODataClient.post(SERVICE_BASE + "/listDocuments", {
                Plant: oInput.plant,
                DateFrom: oInput.dateFrom || null,
                DateTo: oInput.dateTo || null,
                MaterialDocument: oInput.materialDocument || null,
                MaterialDocumentYear: oInput.year || null
            }, null, { maxRetries: 0 });
        },

        /** The user's plants for the plant field (server-side scope). */
        getPlantContext: function () {
            return ODataClient.get(SERVICE_BASE + "/getPlantContext()").then(function (result) {
                var oData = (result && result.value) || result || {};
                return { plants: Array.isArray(oData.plants) ? oData.plants : [], unrestricted: oData.unrestricted === true };
            });
        }
    };
});
