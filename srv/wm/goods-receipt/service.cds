namespace saps4hana.wm;

@(requires: 'authenticated-user')
@(impl: './service.js')
service GoodsReceiptService @(path: '/odata/v4/goods-receipt') {

    @readonly
    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'User', 'Admin'])
    entity OpenInboundDeliveries {
        key StorageUnit          : String(20);
        key DeliveryDocument     : String(12);
            DeliveryDocumentItem : String(6);
            PurchaseOrder        : String(10);
            PurchaseOrderItem    : String(5);
            Material             : String(40);
            MaterialName         : String(80);
            Plant                : String(4);
            PlantName            : String(40);
            Supplier             : String(10);
            SupplierName         : String(40);
            SupplierCityName     : String(40);
    };

    @readonly
    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'User', 'Admin'])
    entity MaterialStorageLocations {
        key Material            : String(40);
        key Plant               : String(4);
        key StorageLocation     : String(4);
            StorageLocationName : String(40);
            WarehouseStorageBin : String(18);
            CurrentStock        : Decimal(13, 3);
            BaseUnit            : String(3);
    };

    @readonly
    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'User', 'Admin'])
    entity MaterialBatches {
        key Material        : String(40);
        key Plant           : String(4);
        key Batch           : String(10);
            ExpiryDate      : Date;
            ManufactureDate : Date;
            AvailableStock  : Decimal(13, 3);
            Unit            : String(3);
            StorageBin      : String(18);
            StorageLocation : String(4);
            StatusState     : String(10);
            StatusText      : String(20);
            DaysToExpiry    : Integer;
    };

    type StorageUnitDetails {
        StorageUnit          : String(20);
        ScannedBarcode       : String(50);
        ScannedType          : String(30);
        ScannedTypeLabel     : String(50);
        DeliveryDocument     : String(12);
        DeliveryDocumentItem : String(6);
        PurchaseOrder        : String(10);
        PurchaseOrderItem    : String(5);
        Material             : String(40);
        MaterialName         : String(80);
        Plant                : String(4);
        PlantName            : String(40);
        StorageLocation      : String(4);
        StorageLocationName  : String(40);
        WarehouseStorageBin  : String(18);
        Batch                : String(10);
        ExpiryDate           : Date;
        BatchStatusState     : String(10);
        BatchStatusText      : String(20);
        Quantity             : Decimal(13, 3);
        Unit                 : String(3);
        Supplier             : String(10);
        SupplierName         : String(40);
        SupplierCityName     : String(40);
    };

    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'User', 'Admin'])
    function getStorageUnitDetails(StorageUnit : String) returns StorageUnitDetails;

    type GRPostResult {
        Success          : Boolean;
        Message          : String(255);
        DeliveryDocument : String(12);
        MaterialDocument : String(10);
    };

    @(requires: ['WarehouseClerk', 'WarehouseManager', 'Admin'])
    action postGoodsReceipt(
        StorageUnit     : String(20),
        DeliveryDocument: String(12),
        Material        : String(40),
        Plant           : String(4),
        StorageLocation : String(4),
        Batch           : String(10),
        Quantity        : Decimal(13, 3),
        ExpiryDate      : String(10)
    ) returns GRPostResult;
}
