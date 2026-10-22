namespace saps4hana.wm;

@(requires: 'authenticated-user')
service Mvt261Service @(path: '/odata/v4/mvt261') {

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
        Warehouse         : String(3);
        RequirementDate   : Date;
        RequiredQuantity  : Decimal(13, 3);
        WithdrawnQuantity : Decimal(13, 3);
        OpenQuantity      : Decimal(13, 3);
        Unit              : String(3);
        MovementAllowed   : Boolean;
        OrderStatus       : String(40);
        Backflush         : Boolean;
        ScanPossible      : Boolean;
        Blocked           : Boolean;
        BlockReason       : String(100);
        PartialCoverage   : Boolean;
        ReadyStorageUnits : Integer;
        ReadyQuantity     : Decimal(15, 3);
        StockEligibility  : StockEligibility;
    };

    type StockEligibility {
        Eligible            : Boolean;
        IssuableQuantity    : Decimal(13, 3);
        Reason              : String(255);
        Source              : String(10);
        OpenQuantity        : Decimal(13, 3);
        SupplyAreaStock     : Decimal(13, 3);
        StagedQuantity      : Decimal(13, 3);
        StorageUnitQuantity : Decimal(13, 3);
        NoUnitQuantity      : Decimal(15, 3);
        PartialCoverage     : Boolean;
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
        SupplyArea                 : String(10);
        SupplyAreaStorageLocation  : String(4);
        RequirementDate      : Date;
        RequiredQuantity     : Decimal(13, 3);
        WithdrawnQuantity    : Decimal(13, 3);
        OpenQuantity         : Decimal(13, 3);
        Unit                 : String(3);
        IsDeleted            : Boolean;
        IsFinalIssue         : Boolean;
        MovementAllowed      : Boolean;
        Backflush            : Boolean;
        Warehouse            : String(3);
        ReservationWarehouse : String(3);
        IssuableQuantity     : Decimal(13, 3);
        SupplyAreaStock      : Decimal(13, 3);
        PartialCoverage      : Boolean;
        StagingRequired      : Boolean;
        StagingStorageType   : String(3);
        StagingBin           : String(10);
        StagedQuantity       : Decimal(13, 3);
        StagingShortfall     : Decimal(13, 3);
        StorageUnitQuantity  : Decimal(13, 3);
        NoUnitQuantity       : Decimal(15, 3);
        StockEligibility     : StockEligibility;
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
        Warehouse : String(3); Batch : String(10); SupplyArea : String(10); SupplyAreaStorageLocation : String(4); SupplyAreaStock : Decimal(13, 3); OrderReleased : Boolean;
        IssuableQuantity : Decimal(13, 3); PartialCoverage : Boolean; Backflush : Boolean;
        RequiredQuantity : Decimal(13, 3); WithdrawnQuantity : Decimal(13, 3); OpenQuantity : Decimal(13, 3); Unit : String(3);
        Blocked : Boolean; BlockReason : String(255); QuantCount : Integer; StorageUnitQuantCount : Integer;
        NoUnitQuantCount : Integer; NoUnitQuantity : Decimal(15, 3); StorageUnitQuantity : Decimal(13, 3);
        StagedQuantity : Decimal(13, 3); StockEligibility : StockEligibility; Units : array of ScanUnit;
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

    type MaterialDocumentResult {
        MaterialDocument            : String(10);
        MaterialDocumentYear        : String(4);
        DeliveryNumber              : String(10);
        Pending                     : Boolean;
        Message                     : String;
        SapMessage                  : String;
        StorageUnitPostingSemantics : String(30);
    };

    // Revalidate 261 stock immediately before SAP POST (fresh SAP stock/reservation validation).
    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'Admin'])
    function revalidateStock(
        reservation  : String(10),
        item         : String(4),
        quantity     : Decimal(13, 3),
        batch        : String(10),
        storageUnits : array of String(20)
    ) returns StockEligibility;

    // Stage 2: post goods issue 261 against reservation item with idempotency guard.
    // Write action: the read-only Viewer role must not post goods issues (F4).
    // Storage Unit Posting Semantics: Option A (SU is physical & inventory validation).
    // Scanned SUs validate drum existence, batch, and quant availability; the SAP
    // material document envelope issues the validated reservation quantity and batch.
    @(requires: ['WarehouseClerk', 'WarehouseManager', 'Admin'])
    action postGoodsIssue(
        reservation  : String(10),
        item         : String(4),
        quantity     : Decimal(13, 3),
        batch        : String(10),
        storageUnits : array of String(20)
    ) returns MaterialDocumentResult;

    type ReversalResult {
        MaterialDocument     : String(10);
        MaterialDocumentYear : String(4);
        SapMessage           : String;
    };

    // F6: reverse (262) one 261 material document item via the API CancelItem function import.
    // Write action, managers/admin only (clerks excluded); rejects an already-reversed document.
    @(requires: ['WarehouseManager', 'Admin'])
    action reverse(
        reservation          : String(10),
        item                 : String(4),
        materialDocument     : String(10),
        materialDocumentYear : String(4),
        materialDocumentItem : String(4)
    ) returns ReversalResult;
}