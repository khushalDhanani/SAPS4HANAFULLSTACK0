namespace saps4hana.wm;

// Quarantine labels (transaction ZQUARAN, report ZMM_R_062, Adobe form ZMM_AF_017) as a PDF for the Fiori app.
// Rendered in SAP by the RFC Z_MM_QUAR_LABEL_PDF (docs/zquaran-pdf-wrapper.md); until that function is active the
// action answers 503 and calls nothing.
@(requires: 'authenticated-user')
service QuarantineLabelService @(path: '/odata/v4/quarantine-label') {

    type LabelPdf {
        MaterialDocument     : String(10);
        MaterialDocumentYear : String(4);
        LabelCount           : Integer;
        FileName             : String(80);
        // The SAP-rendered PDF, base64-encoded
        PdfBase64            : LargeString;
    }

    // Action (POST) rather than function: the request is not cached and its inputs stay out of URLs and logs.
    // Reads and renders only; nothing is posted or sent to a printer.
    @(requires: ['WarehouseClerk', 'WarehouseManager', 'Admin'])
    action generateLabels(MaterialDocument : String(10), MaterialDocumentYear : String(4), Text : String(50)) returns LabelPdf;
}
