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
         * @returns {Promise<{MaterialDocument: string, MaterialDocumentYear: string, LabelCount: number, FileName: string, PdfBase64: string}>}
         */
        generateLabels: function (oInput) {
            return ODataClient.post(SERVICE_BASE + "/generateLabels", {
                MaterialDocument: oInput.materialDocument,
                MaterialDocumentYear: oInput.year,
                Text: oInput.text || ""
            }, null, { maxRetries: 0 });
        }
    };
});
