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
        // Configured label size of the document's plant ('4x6'), null when none is configured
        LabelSize            : String(10);
        // First page size of the PDF in points (1/72 in), null when unreadable
        PageWidthPt          : Double;
        PageHeightPt         : Double;
        // null: no size configured; false: the PDF does not have the configured size
        PageSizeOk           : Boolean;
        // The SAP-rendered PDF, base64-encoded
        PdfBase64            : LargeString;
    }

    // One label row, rebuilt by CAP from read-only SAP table reads like report ZMM_R_062; dates ISO yyyy-mm-dd or ''
    type LabelRow {
        MaterialDescription  : String(40);
        MaterialDocument     : String(10);
        PostingDate          : String(10);
        Batch                : String(20);
        SupplierBatch        : String(15);
        SupplierName         : String(40);
        BatchCharacteristics : String(70);
        ManufacturingDate    : String(10);
        // RETEST or EXPIRY: which date DateValue is (the label takes the caption from i18n)
        DateKind             : String(6);
        DateValue            : String(10);
        PostedQuantity       : String(100);
        ContainerQuantity    : String(20);
        Unit                 : String(3);
        Container            : String(20);
        StorageUnit          : String(20);
        Text                 : String(50);
    }

    type LabelRows {
        MaterialDocument     : String(10);
        MaterialDocumentYear : String(4);
        // Configured label size of the document's plant; null = the app's default size
        LabelSize            : String(10);
        Rows                 : many LabelRow;
    }

    // Action (POST) rather than function: the request is not cached and its inputs stay out of URLs and logs.
    // Reads and renders only; nothing is posted or sent to a printer.
    @(requires: ['WarehouseClerk', 'WarehouseManager', 'Admin'])
    action generateLabels(MaterialDocument : String(10), MaterialDocumentYear : String(4), Text : String(50)) returns LabelPdf;

    // Label data for the app's own 4 x 6 label (drawn in the browser), from read-only SAP table reads.
    @(requires: ['WarehouseClerk', 'WarehouseManager', 'Admin'])
    action labelRows(MaterialDocument : String(10), MaterialDocumentYear : String(4), Text : String(50)) returns LabelRows;
}
