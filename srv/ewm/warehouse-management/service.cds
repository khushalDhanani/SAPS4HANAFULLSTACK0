namespace saps4hana.ewm;

@(requires: 'authenticated-user')
service WarehouseManagementService @(path: '/odata/v4/warehouse-management') {

    @readonly
    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'User', 'Admin'])
    entity Warehouses {
        key Warehouse     : String(4);
            WarehouseName : String(80);
            IsEwm         : Boolean;
    };

    @readonly
    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'User', 'Admin'])
    entity WarehouseProcessTypes {
        key Warehouse                : String(4);
        key WarehouseProcessType      : String(4);
            WarehouseProcessTypeName  : String(80);
    };

    @readonly
    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'User', 'Admin'])
    entity StorageTypes {
        key Warehouse       : String(4);
        key StorageType     : String(4);
            StorageTypeName : String(80);
    };

    @readonly
    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'User', 'Admin'])
    entity StorageBins {
        key Warehouse           : String(4);
        key StorageBin          : String(18);
            StorageType         : String(4);
            StorageSection      : String(4);
            StorageBinType      : String(4);
            MaxWeight           : Decimal(15, 3);
            WeightUnit          : String(3);
            IsBlockedForPutaway : Boolean;
            IsBlockedForRemoval : Boolean;
    };

    @readonly
    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'User', 'Admin'])
    entity WarehouseOrders {
        key Warehouse           : String(4);
        key WarehouseOrder       : String(10);
            WarehouseOrderStatus : String(1); // O = Open, C = Confirmed, I = In Process
            WarehouseOrderQueue  : String(10);
            ActivityArea         : String(4);
            AssignedUser         : String(12);
            CreationDate         : Date;
    };

    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'User', 'Admin'])
    entity WarehouseTasks {
        key Warehouse                : String(4);
        key WarehouseTask             : String(12);
            WarehouseOrder            : String(10);
            WarehouseProcessType      : String(4);
            WarehouseProcessCategory  : String(1);
            WarehouseTaskStatus       : String(1); // O = Open, C = Confirmed, X = Cancelled
            Product                   : String(40);
            ProductName               : String(80);
            TargetQuantity            : Decimal(13, 3);
            ConfirmedQuantity         : Decimal(13, 3);
            BaseUnit                  : String(3);
            SourceStorageType         : String(4);
            SourceStorageBin          : String(18);
            TargetStorageType         : String(4);
            TargetStorageBin          : String(18);
            DestinationStorageBin     : String(18);
            CreationDate              : Date;
            ConfirmedByUser           : String(12);
            _isLocalStaging           : Boolean;
    };

    @readonly
    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'User', 'Admin'])
    entity InboundDeliveries {
        key Warehouse                 : String(10);
        key DeliveryDocument          : String(35);
            Supplier                  : String(10);
            SupplierName              : String(80);
            DeliveryDocumentType      : String(4);
            OverallGoodsReceiptStatus : String(1); // A = Not Started, B = Partial, C = Completed
            DeliveryDate              : Date;
            Items                     : Composition of many InboundDeliveryItems on Items.DeliveryDocument = DeliveryDocument;
    };

    @readonly
    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'User', 'Admin'])
    entity InboundDeliveryItems {
        key Warehouse                 : String(10);
        key DeliveryDocument          : String(35);
        key DeliveryDocumentItem      : String(10);
            Product                   : String(40);
            ProductDescription        : String(80);
            DeliveryQuantity          : Decimal(13, 3);
            DeliveryQuantityUnit      : String(3);
            GoodsReceiptStatus        : String(1);
    };

    @readonly
    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'User', 'Admin'])
    entity OutboundDeliveries {
        key Warehouse                 : String(10);
        key OutboundDeliveryOrder     : String(35);
            ShipToParty               : String(10);
            ShipToPartyName           : String(80);
            OutboundDeliveryOrderType : String(4);
            OverallGoodsIssueStatus   : String(1); // A = Not Started, B = Partial, C = Completed
            OverallPickingStatus      : String(1);
            PlannedGoodsIssueDate     : Date;
            Items                     : Composition of many OutboundDeliveryItems on Items.OutboundDeliveryOrder = OutboundDeliveryOrder;
    };

    @readonly
    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'User', 'Admin'])
    entity OutboundDeliveryItems {
        key Warehouse                 : String(10);
        key OutboundDeliveryOrder     : String(35);
        key OutboundDeliveryOrderItem : String(10);
            Product                   : String(40);
            ProductDescription        : String(80);
            DeliveryQuantity          : Decimal(13, 3);
            DeliveryQuantityUnit      : String(3);
            PickingStatus             : String(1);
    };

    @readonly
    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'User', 'Admin'])
    entity WarehouseKPIs {
        key Warehouse        : String(10);
            OpenTasksCount   : Integer;
            PendingInbound   : Integer;
            PendingOutbound  : Integer;
            TotalStorageBins : Integer;
    };

    @readonly
    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'User', 'Admin'])
    entity WarehouseResources {
        key Warehouse       : String(10);
        key Resource        : String(12);
            ResourceType    : String(4);
            AssignedQueue   : String(10);
            LogonStatus     : String(10);
    };

    // Actions
    @(requires: ['WarehouseClerk', 'WarehouseManager', 'Admin'])
    action confirmWarehouseTask(
        Warehouse: String(10),
        WarehouseTask: String(35),
        ConfirmedQuantity: Decimal(13, 3)
    ) returns Boolean;

    @(requires: ['WarehouseClerk', 'WarehouseManager', 'Admin'])
    action createWarehouseTask(
        Warehouse: String(10),
        Product: String(40),
        Quantity: Decimal(13, 3),
        UnitOfMeasure: String(10),
        WarehouseProcessType: String(80),
        SourceStorageType: String(80),
        SourceStorageBin: String(40),
        TargetStorageType: String(80),
        TargetStorageBin: String(40),
        DestinationStorageType: String(80),
        DestinationStorageBin: String(40),
        Batch: String(20),
        SourceHandlingUnit: String(40),
        DestinationHandlingUnit: String(40)
    ) returns WarehouseTasks;

    @(requires: ['WarehouseClerk', 'WarehouseManager', 'Admin'])
    action cancelWarehouseTask(
        Warehouse: String(10),
        WarehouseTask: String(35)
    ) returns Boolean;

    @(requires: ['WarehouseClerk', 'WarehouseManager', 'Admin'])
    action postGoodsReceipt(
        Warehouse: String(10),
        DeliveryDocument: String(35)
    ) returns Boolean;

    @(requires: ['WarehouseClerk', 'WarehouseManager', 'Admin'])
    action postGoodsIssue(
        Warehouse: String(10),
        OutboundDeliveryOrder: String(35)
    ) returns Boolean;

    @(requires: ['WarehouseClerk', 'WarehouseManager', 'Admin'])
    action logonResource(
        Warehouse: String(10),
        Resource: String(12),
        Queue: String(10)
    ) returns Boolean;

    @(requires: ['WarehouseClerk', 'WarehouseManager', 'Admin'])
    action verifyRfScan(
        Warehouse: String(10),
        ScanType: String(20),
        BarcodeValue: String(40),
        ExpectedValue: String(40)
    ) returns Boolean;

    @(requires: ['WarehouseClerk', 'WarehouseManager', 'Admin'])
    action confirmRfPick(
        Warehouse: String(10),
        WarehouseTask: String(35),
        ConfirmedQuantity: Decimal(13, 3),
        DestinationHU: String(20),
        ScannedBin: String(18)
    ) returns Boolean;
}

