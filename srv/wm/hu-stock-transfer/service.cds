namespace saps4hana.wm;

@(requires: 'authenticated-user')
service HuStockTransferService @(path: '/odata/v4/hu-stock-transfer') {

    type OpenReservationItem {
        ReservationNo            : String(10);
        ReservationItem          : String(4);
        MovementType             : String(4);
        RequirementDate          : Date;
        Requester                : String(12);
        RequesterName            : String(100);
        RequesterPhone           : String(30);
        RequesterEmail           : String(60);
        Material                 : String(40);
        MaterialDesc             : String(80);
        Batch                    : String(10);
        RequiredQty              : Decimal(13, 3);
        WithdrawnQty             : Decimal(13, 3);
        OpenQty                  : Decimal(13, 3);
        BaseUnit                 : String(3);
        Plant                    : String(4);
        StorageLocation          : String(4);
        ReceivingStorageLocation : String(4);
        Warehouse                : String(3);
        AvailableUnitCount       : Integer;
        TotalAvailableStock      : Decimal(13, 3);
        PreferredStorageType     : String(3);
        SutIndicator             : String(20);
        StorageUnitType          : String(3);
        StorageUnitTypeDesc      : String(40);
        Status                   : String(20);
        StatusText               : String(30);
        StatusState              : String(10);
        IsDeleted                : Boolean;
        IsFinalIssue             : Boolean;
    };

    type OpenReservationsResult {
        TotalCount : Integer;
        Items      : array of OpenReservationItem;
    };

    type TransferCockpitDetail {
        ReservationNo            : String(10);
        ReservationItem          : String(4);
        MovementType             : String(4);
        Requester                : String(12);
        RequesterName            : String(100);
        RequesterPhone           : String(30);
        RequesterEmail           : String(60);
        Material                 : String(40);
        MaterialDesc             : String(80);
        Batch                    : String(10);
        OpenQty                  : Decimal(13, 3);
        BaseUnit                 : String(3);
        Plant                    : String(4);
        StorageLocation          : String(4);
        ReceivingStorageLocation : String(4);
        Warehouse                : String(3);
        PreferredStorageType     : String(3);
        TotalAvailableStock      : Decimal(13, 3);
        AvailableUnitCount       : Integer;
        SutMode                  : String(30);
    };

    type UnitValidationResult {
        Valid               : Boolean;
        UnitNumber          : String(40);
        UnitType            : String(20); // 'Handling Unit (HU)' or 'Storage Unit (SU)'
        SutCode             : String(3);
        SutDescription      : String(40);
        SerialNumber        : String(30);
        Batch               : String(10);
        AvailableQuantity   : Decimal(15, 3);
        BaseUnit            : String(3);
        Plant               : String(4);
        StorageLocation     : String(4);
        Warehouse           : String(3);
        StorageType         : String(3);
        StorageBin          : String(18);
        IsOnHold            : Boolean;
        IsInProcess         : Boolean;
        IsPreferredStorage  : Boolean;
        StatusState         : String(10); // 'Success' | 'Warning' | 'Information' | 'Error'
        StatusMessage       : String(255);
        DefaultTransferQty  : Decimal(13, 3);
    };

    type StorageBinItem {
        StorageStatus   : String(25);
        UnitCategory    : String(12);
        UnitNumber      : String(40);
        SutCode         : String(3);
        SutDescription  : String(40);
        StorageType     : String(3);
        StorageTypeDesc : String(40);
        StorageSection  : String(4);
        StorageSectionDesc: String(40);
        StorageBin      : String(18);
        BinPosition     : String(10);
        SerialNumber    : String(30);
        AvailableStock  : Decimal(15, 3);
        BaseUnit        : String(3);
        Batch           : String(10);
        Warehouse       : String(3);
        StorageLocation : String(4);
        SortPriority    : Integer;
    };

    type VisualRackBin {
        ActualStorageBin : String(18);
        RackReference    : String(25);
        FloorId          : String(15);
        RackNumber       : String(15);
        BinPosition      : String(35);
        ShelfLevelDesc   : String(40);
        LevelCode        : String(10); // B0 to B6
        LevelNumber      : Integer;
        StorageSectionDesc: String(40);
        UnitNumber       : String(40);
        UnitType         : String(12);
        SutCode          : String(3);
        SutDescription   : String(40);
        SerialNumber     : String(30);
        AvailableQuantity: Decimal(15, 3);
        BaseUnit         : String(3);
        Batch            : String(10);
        StorageStatus    : String(30);
        StorageType      : String(3);
        StorageTypeDesc  : String(40);
        StorageSection   : String(4);
        Warehouse        : String(3);
        StorageLocation  : String(4);
        SortPriority     : Integer;
    };

    type HuStockTransferResult {
        Success           : Boolean;
        ReservationNo     : String(10);
        ReservationItem   : String(4);
        MaterialDocument  : String(10);
        MaterialDocYear   : String(4);
        PostingPath       : String(30);
        TransferredQty    : Decimal(13, 3);
        BaseUnit          : String(3);
        UnitNumber        : String(40);
        UpdatedOpenQty    : Decimal(13, 3);
        UpdatedStatus     : String(20);
        IsFinalIssue      : Boolean;
        RequesterAlertSent: Boolean;
        Message           : String(500);
    };

    // ── Queries & Value Helps ───────────────────────────────────────────

    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'Admin'])
    function getOpenReservations(
        plant           : String(4),
        storageLocation : String(4),
        movementType    : String(4),
        requester       : String(12),
        reservation     : String(10),
        material        : String(40),
        status          : String(20),
        includeDeleted  : Boolean
    ) returns OpenReservationsResult;

    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'Admin'])
    function getCockpitDetail(
        reservation : String(10),
        item        : String(4)
    ) returns TransferCockpitDetail;

    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'Admin'])
    function validateUnit(
        reservation : String(10),
        item        : String(4),
        unitNumber  : String(40)
    ) returns UnitValidationResult;

    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'Admin'])
    function getStorageBins(
        reservation : String(10),
        item        : String(4)
    ) returns array of StorageBinItem;

    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'Admin'])
    function getVisualRack(
        reservation : String(10),
        item        : String(4)
    ) returns array of VisualRackBin;

    // ── Goods Transfer Action ───────────────────────────────────────────

    @(requires: ['WarehouseClerk', 'WarehouseManager', 'Admin'])
    action executeHuStockTransfer(
        ReservationNo   : String(10),
        ReservationItem : String(4),
        UnitNumber      : String(40),
        TransferQty     : Decimal(13, 3),
        IsFullUnit      : Boolean,
        ClientAttemptId : String(36)
    ) returns HuStockTransferResult;
}
