namespace saps4hana.wm;

@(requires: 'authenticated-user')
service HandlingUnitService @(path: '/odata/v4/handling-unit') {

    type HandlingUnitListItem {
        HandlingUnitExternalID : String(20);
        HandlingUnitIDChar32   : String(32);
        HandlingUnitOrigin     : String(10);
        Warehouse              : String(4);
        WarehouseName          : String(40);
        PackagingMaterial      : String(40);
        PackagingMaterialName  : String(40);
        Plant                  : String(4);
        PlantName              : String(40);
        StorageLocation        : String(4);
        StorageLocationName    : String(40);
        StorageType            : String(4);
        StorageBin             : String(18);
        ParentHandlingUnit     : String(20);
        GrossWeight            : Decimal(15, 3);
        NetWeight              : Decimal(15, 3);
        WeightUnit             : String(3);
        GrossVolume            : Decimal(15, 3);
        VolumeUnit             : String(3);
        Status                 : String(4);
        StatusText             : String(60);
        ReferenceDocument      : String(20);
        CreatedByUser          : String(12);
        CreationDateTime       : Date;
    };

    // SapCount = handling units SAP holds for the filter; TotalCount = rows returned (capped by the adapter).
    type HandlingUnitListResult {
        TotalCount : Integer;
        SapCount   : Integer;
        Truncated  : Boolean;
        Items      : array of HandlingUnitListItem;
    };

    type HandlingUnitItem {
        HandlingUnitItem        : String(6);
        Material                : String(40);
        MaterialName            : String(40);
        Plant                   : String(4);
        StorageLocation         : String(4);
        Batch                   : String(10);
        Quantity                : Decimal(15, 3);
        Unit                    : String(3);
        ReferenceDocument       : String(20);
        ReferenceDocumentItem   : String(6);
        ShelfLifeExpirationDate : Date;
        GoodsReceiptDate        : Date;
    };

    type HandlingUnitDetail {
        HandlingUnitExternalID    : String(20);
        HandlingUnitIDChar32      : String(32);
        HandlingUnitOrigin        : String(10);
        Warehouse                 : String(4);
        WarehouseName             : String(40);
        PackagingMaterial         : String(40);
        PackagingMaterialName     : String(40);
        PackagingMaterialType     : String(4);
        PackagingMaterialTypeName : String(40);
        Plant                     : String(4);
        PlantName                 : String(40);
        StorageLocation           : String(4);
        StorageLocationName       : String(40);
        StorageType               : String(4);
        StorageBin                : String(18);
        ShippingPoint             : String(4);
        ShippingPointName         : String(40);
        ParentHandlingUnit        : String(20);
        GrossWeight               : Decimal(15, 3);
        NetWeight                 : Decimal(15, 3);
        TareWeight                : Decimal(15, 3);
        MaxWeight                 : Decimal(15, 3);
        WeightUnit                : String(3);
        GrossVolume               : Decimal(15, 3);
        NetVolume                 : Decimal(15, 3);
        TareVolume                : Decimal(15, 3);
        MaxVolume                 : Decimal(15, 3);
        VolumeUnit                : String(3);
        Length                    : Decimal(13, 3);
        Width                     : Decimal(13, 3);
        Height                    : Decimal(13, 3);
        DimensionUnit             : String(3);
        PackingObjectKey          : String(20);
        ReferenceDocument         : String(20);
        ReferenceDocumentType     : String(40);
        DeliveryDocument          : String(20);
        Status                    : String(4);
        StatusText                : String(60);
        CreatedByUser             : String(12);
        CreationDateTime          : Date;
        LastChangedByUser         : String(12);
        Items                     : array of HandlingUnitItem;
    };

    type HandlingUnitHierNode {
        Node                  : String(32);
        ParentNode            : String(32);
        HierarchyLevel        : Integer;
        DrillState            : String(10);
        Name                  : String(40);
        Product               : String(40);
        ProductName           : String(40);
        PackagingMaterial     : String(40);
        PackagingMaterialName : String(40);
        Quantity              : Decimal(15, 3);
        Unit                  : String(3);
        Batch                 : String(10);
        ReferenceDocument     : String(20);
    };

    type HandlingUnitHierarchyResult {
        TotalCount : Integer;
        Nodes      : array of HandlingUnitHierNode;
    };

    // Read-only: list handling units for the filter. All filters optional.
    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'Admin'])
    function list(
        plant                  : String(4),
        storageLocation        : String(4),
        warehouse              : String(4),
        packagingMaterial      : String(40),
        handlingUnitExternalID : String(20),
        status                 : String(1),
        shippingPoint          : String(4)
    ) returns HandlingUnitListResult;

    // Read-only: header, weights, dimensions and packed items of one handling unit.
    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'Admin'])
    function detail(handlingUnitExternalID : String(20), warehouse : String(4)) returns HandlingUnitDetail;

    // Read-only: recursive packing tree of one handling unit. origin defaults to ERP.
    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'Admin'])
    function hierarchy(handlingUnitIDChar32 : String(32), handlingUnitOrigin : String(10)) returns HandlingUnitHierarchyResult;

    type ValueHelpItem { ![key] : String(40); text : String(60); };
    type ValueHelpResult { Items : array of ValueHelpItem; };

    // Read-only: filter-bar value help. kind = plant | packaging | status | shippingPoint | storagelocation.
    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'Admin'])
    function valueHelp(kind : String(20)) returns ValueHelpResult;

    type StatusKpi { code : String(4); name : String(60); count : Integer; };
    type StatusKpiResult { Total : Integer; Items : array of StatusKpi; };

    // Read-only: handling-unit count per process status (for the KPI cards above the filter bar).
    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'Admin'])
    function statusKpis() returns StatusKpiResult;
}
