namespace saps4hana.wm;

// Material Issued To Batch Sticker (transaction ZMIB, report ZMM_R_067, Adobe form ZMM_AF_021)
@(requires: 'authenticated-user')
service MibLabelService @(path: '/odata/v4/mib-label') {

    type MibStickerPdf {
        WarehouseNumber     : String(3);
        TransferOrderNumber : String(10);
        LabelCount          : Integer;
        FileName            : String(80);
        PdfBase64           : LargeString;
    }

    type MibStickerRow {
        Material            : String(40);
        MaterialDescription : String(40);
        Batch               : String(20);
        TransferOrder       : String(10);
        TransferRequirement : String(10);
        RequirementNumber   : String(10);
        TransferDate        : String(10);
        QuantityWithUom     : String(50);
        StorageUnit         : String(20);
        WeightedBy          : String(80);
        CheckedBy           : String(80);
    }

    action generateMibSticker(
        WarehouseNumber     : String(3),
        TransferOrderNumber : String(10),
        WeightedBy          : String(12),
        CheckedBy           : String(12)
    ) returns MibStickerPdf;

    action readMibStickerData(
        WarehouseNumber     : String(3),
        TransferOrderNumber : String(10),
        WeightedBy          : String(12),
        CheckedBy           : String(12)
    ) returns array of MibStickerRow;

    function getWarehouseContext() returns {
        warehouses: array of String;
        unrestricted: Boolean;
    };
}
