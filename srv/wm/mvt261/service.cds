namespace saps4hana.wm;

@(requires: 'authenticated-user')
service Mvt261Service @(path: '/odata/v4/mvt261') {

    type Mvt261Row {
        Rank                   : Integer;
        MaterialDocument       : String(10);
        MaterialDocumentYear   : String(4);
        MaterialDocumentItem   : String(4);
        PostingDate            : Date;
        EntryTimestamp         : Timestamp;
        Material               : String(40);
        MaterialName           : String(40);
        Plant                  : String(4);
        StorageLocation        : String(4);
        ProductionOrder        : String(12);
        Quantity               : Decimal(13, 3);
        Unit                   : String(3);
        IsAutomaticallyCreated : Boolean;
        IsReversed             : Boolean;
        ReversedBy             : String(20);
        CreatedByUser          : String(12);
    };

    // Top[0] is the first document; Top holds its neighbours in sort order as proof.
    type Mvt261Result {
        Definition : String(1);
        SortKey    : String(60);
        TotalCount : Integer;
        Top        : array of Mvt261Row;
    };

    type Open261Item {
        Reservation       : String(10);
        ReservationItem   : String(4);
        RecordType        : String(1);
        ProductionOrder   : String(12);
        OrderDescription  : String(40);
        Material          : String(40);
        MaterialName      : String(40);
        Plant             : String(4);
        StorageLocation   : String(4);
        RequirementDate   : Date;
        RequiredQuantity  : Decimal(13, 3);
        WithdrawnQuantity : Decimal(13, 3);
        OpenQuantity      : Decimal(13, 3);
        Unit              : String(3);
        MovementAllowed   : Boolean;
        OrderStatus       : String(40);
        ScanPossible      : Boolean;
        Blocked           : Boolean;
        BlockReason       : String(100);
        ReadyStorageUnits : Integer;
        ReadyQuantity     : Decimal(15, 3);
    };

    // SapOpenCount = items SAP holds as open (not deleted, not final-issued); TotalCount = items returned.
    type Open261Result {
        TotalCount   : Integer;
        SapOpenCount : Integer;
        Truncated    : Boolean;
        Items        : array of Open261Item;
    };

    // Read-only: open movement type 261 reservation items. Dates YYYY-MM-DD (requirement date).
    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'Admin'])
    function openItems(
        plant                 : String(4),
        material              : String(40),
        productionOrder       : String(12),
        reservation           : String(10),
        dateFrom              : String(10),
        dateTo                : String(10),
        includeFullyWithdrawn : Boolean,
        scanPossibleOnly      : Boolean
    ) returns Open261Result;

    type CycleStep { Step : String(20); Status : String(8); Reason : String(255); };
    type CycleStock { StorageLocation : String(4); Batch : String(10); Quantity : Decimal(13, 3); };
    type CycleQuant {
        Warehouse : String(3); StorageType : String(3); StorageBin : String(10); StorageLocation : String(4);
        Batch : String(10); AvailableQuantity : Decimal(13, 3); StorageUnit : String(20);
    };
    type CycleTransferRequirement {
        Warehouse : String(3); TransferRequirement : String(10); Item : String(4); MovementType : String(3);
        Quantity : Decimal(13, 3); TransferOrderQuantity : Decimal(13, 3); Completed : Boolean;
    };
    type CycleTransferOrder {
        Warehouse : String(3); TransferOrder : String(10); TransferRequirement : String(10); MovementType : String(3); Confirmed : Boolean;
    };
    type CycleDocument {
        MaterialDocument : String(10); MaterialDocumentYear : String(4); MaterialDocumentItem : String(4); MovementType : String(3);
        PostingDate : Date; Quantity : Decimal(13, 3); Unit : String(3); Batch : String(10); StorageLocation : String(4);
        Reverses : String(20); IsReversed : Boolean; CreatedByUser : String(12);
    };

    // Step.Status: done | open | blocked. Steps in order: Reservation, ProductionOrder, Availability,
    // WmStaging, GoodsIssue, DocumentHistory, Reversal, Closure.
    type Cycle261 {
        Reservation          : String(10);
        ReservationItem      : String(4);
        ProductionOrder      : String(12);
        OrderType            : String(4);
        OrderStatus          : String(40);
        Material             : String(40);
        Plant                : String(4);
        StorageLocation      : String(4);
        Batch                : String(10);
        RequirementDate      : Date;
        RequiredQuantity     : Decimal(13, 3);
        WithdrawnQuantity    : Decimal(13, 3);
        OpenQuantity         : Decimal(13, 3);
        Unit                 : String(3);
        IsDeleted            : Boolean;
        IsFinalIssue         : Boolean;
        MovementAllowed      : Boolean;
        Warehouse            : String(3);
        ReservationWarehouse : String(3);
        StagingRequired      : Boolean;
        StagingStorageType   : String(3);
        StagingBin           : String(10);
        StagedQuantity       : Decimal(13, 3);
        StagingShortfall     : Decimal(13, 3);
        Steps                : array of CycleStep;
        Stock                : array of CycleStock;
        Quants               : array of CycleQuant;
        TransferRequirements : array of CycleTransferRequirement;
        TransferOrders       : array of CycleTransferOrder;
        History              : array of CycleDocument;
    };

    // Read-only: the 261 cycle of one reservation item. Nothing is posted.
    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'Admin'])
    function cycle(reservation : String(10), item : String(4)) returns Cycle261;

    // FIFO list row. Status: Available | Blocked | OnHold. Reason / Value1 / Value2 as in ScanResult.
    type ScanUnit {
        Rank : Integer; StorageUnit : String(20); Batch : String(10); Quantity : Decimal(13, 3); Unit : String(3);
        Warehouse : String(3); StorageType : String(3); StorageBin : String(10); StorageLocation : String(4);
        GoodsReceiptDate : Date; AgeDays : Integer; Status : String(10); Reason : String(30); Value1 : String(255); Value2 : String(60);
        Suggested : Boolean;
    };
    type ScanContext {
        Reservation : String(10); ReservationItem : String(4); ProductionOrder : String(12); OrderStatus : String(40);
        Material : String(40); MaterialName : String(40); BatchManaged : Boolean; Plant : String(4); StorageLocation : String(4);
        Warehouse : String(3);
        RequiredQuantity : Decimal(13, 3); WithdrawnQuantity : Decimal(13, 3); OpenQuantity : Decimal(13, 3); Unit : String(3);
        Blocked : Boolean; BlockReason : String(255); QuantCount : Integer; StorageUnitQuantCount : Integer;
        NoUnitQuantCount : Integer; NoUnitQuantity : Decimal(15, 3); Units : array of ScanUnit;
    };
    // Warnings: storageLocationDiffers | notInOrderBin
    type ScanRow {
        Warehouse : String(3); StorageType : String(3); StorageBin : String(10); StorageLocation : String(4); Batch : String(10);
        Quantity : Decimal(13, 3); Unit : String(3); Warnings : array of String(30);
    };
    // Reason: itemBlocked | notFound | wrongMaterialOrPlant | wrongWarehouse | noStock | blocked | stockCategory | inTransferOrder | <configured not-ready reason>
    type ScanResult {
        StorageUnit : String(20); Accepted : Boolean; Reason : String(30); Value1 : String(255); Value2 : String(60);
        Rows : array of ScanRow;
    };

    // Read-only: scan screen. Nothing is posted; scanned rows are kept by the UI session only.
    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'Admin'])
    function scanContext(reservation : String(10), item : String(4)) returns ScanContext;

    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'Admin'])
    function checkStorageUnit(reservation : String(10), item : String(4), storageUnit : String(20)) returns ScanResult;

    // Read-only: first goods movement of movement type 261. definition A | B | C, dates YYYY-MM-DD.
    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'Admin'])
    function findFirst(
        plant           : String(4),
        material        : String(40),
        productionOrder : String(12),
        dateFrom        : String(10),
        dateTo          : String(10),
        definition      : String(1),
        excludeReversed : Boolean,
        manualOnly      : Boolean
    ) returns Mvt261Result;

    type MaterialDocumentResult {
        MaterialDocument     : String(10);
        MaterialDocumentYear : String(4);
        SapMessage           : String;
    };

    // Stage 2: post goods issue 261 against reservation item with idempotency guard.
    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'Admin'])
    action postGoodsIssue(
        reservation : String(10),
        item        : String(4),
        quantity    : Decimal(13, 3),
        batch       : String(10)
    ) returns MaterialDocumentResult;
}