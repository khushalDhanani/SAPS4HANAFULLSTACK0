namespace saps4hana.wm;

using { saps4hana.wm.GoodsIssueQueue as DBGoodsIssueQueue } from '../../../db/wm/goods-issue-queue';

@(requires: 'authenticated-user')
service GoodsIssueService @(path: '/odata/v4/goods-issue') {

    type PackagingUnit {
        Unit         : String(3);
        Description  : String(40);
        Numerator    : Integer;
        Denominator  : Integer;
        FactorToBase : Decimal(13, 3);
        IsBaseUnit   : Boolean;
        Barcode      : String(40);
    };

    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'User', 'Admin'])
    entity GoodsIssueQueue as projection on DBGoodsIssueQueue;

    @readonly
    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'User', 'Admin'])
    entity GIItems {
        key ReservationNo   : String(10);
        key ReservationItem : String(4);
            OrderNo         : String(12);
            Material        : String(40);
            MaterialDesc    : String(80);
            Plant           : String(4);
            StorageLocation : String(4);
            StorageBin      : String(18);
            Batch           : String(10);
            ExpiryDate      : Date;
            BatchStatusState: String(10);
            BatchStatusText : String(20);
            Unit            : String(3);
            RequiredQty     : Decimal(13, 3);
            WithdrawnQty    : Decimal(13, 3);
            OpenQty         : Decimal(13, 3);
            MovementType    : String(3);
            MovementTypeName: String(20);
            PackagingUnits  : array of PackagingUnit;
    };

    @readonly
    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'User', 'Admin'])
    entity MaterialBatches {
        key Material            : String(40);
        key Plant               : String(4);
        key Batch               : String(10);
            ExpiryDate          : Date;
            ManufactDate        : Date;
            AvailableStock      : Decimal(13, 3);
            Unit                : String(3);
            StorageBin          : String(18);
            StorageLocation     : String(4);
            StorageLocationName : String(40);
            StatusState         : String(10);
            StatusText          : String(20);
            DaysToExpiry        : Integer;
    };

    @readonly
    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'User', 'Admin'])
    entity OpenReservations {
        key ReservationNo      : String(10);
            OrderNo            : String(12);
            Plant              : String(4);
            MovementType       : String(4);
            MovementTypeName   : String(40);
            ItemCount          : Integer;
            SampleMaterial     : String(40);
            SampleMaterialDesc : String(80);
            DisplayText        : String(120);
    };

    type GISubmitItem {
        ReservationItem       : String(4);
        Material              : String(40);
        IssueQty              : Decimal(13, 3);
        Batch                 : String(10);
        DifferenceQty         : Decimal(13, 3);
        DifferenceReason      : String(4);
        DifferenceStorageType : String(3);
        FinalIssue            : Boolean;
    };

    type GISubmitLineResult {
        ReservationItem   : String(4);
        MaterialDocument  : String(10);
        MaterialDocYear   : String(4);
        TransferOrder     : String(10);
        DifferenceCleared : Boolean;
        DifferenceQty     : Decimal(13, 3);
        Message           : String(255);
        Success           : Boolean;
    };

    type GISubmitBatchResult {
        AllPosted : Boolean;
        Results   : array of GISubmitLineResult;
        Messages  : array of String;
    };

    type GIPostResult {
        ReservationNo     : String(10);
        ReservationItem   : String(4);
        MaterialDocument  : String(10);
        MaterialDocYear   : String(4);
        TransferOrder     : String(10);
        DifferenceCleared : Boolean;
        DifferenceQty     : Decimal(13, 3);
        Success           : Boolean;
        Message           : String(500);
        Queued            : Boolean;
        QueueReference    : String(40);
        SyncStatus        : String(30);
    };

    type GIComponentItem {
        ReservationNo   : String(10);
        ReservationItem : String(4);
        OrderNo         : String(12);
        Material        : String(40);
        MaterialDesc    : String(80);
        Plant           : String(4);
        StorageLocation : String(4);
        StorageBin      : String(18);
        Batch           : String(10);
        ExpiryDate      : Date;
        BatchStatusState: String(10);
        BatchStatusText : String(20);
        Unit            : String(3);
        RequiredQty     : Decimal(13, 3);
        WithdrawnQty    : Decimal(13, 3);
        OpenQty         : Decimal(13, 3);
        MovementType    : String(3);
        MovementTypeName: String(20);
        PackagingUnits  : array of PackagingUnit;
    };

    type GIBatchItem {
        Material            : String(40);
        Plant               : String(4);
        Batch               : String(10);
        ExpiryDate          : Date;
        ManufactDate        : Date;
        AvailableStock      : Decimal(13, 3);
        Unit                : String(3);
        StorageBin          : String(18);
        StorageLocation     : String(4);
        StorageLocationName : String(40);
        StatusState         : String(10);
        StatusText          : String(20);
        DaysToExpiry        : Integer;
    };

    type GoodsIssueResolution {
        ScannedBarcode             : String(40);
        ScannedType                : String(30);
        ScannedTypeLabel           : String(50);
        ReservationNo              : String(10);
        OrderNo                    : String(12);
        Plant                      : String(4);
        PlantName                  : String(60);
        MovementType               : String(4);
        MovementTypeName           : String(40);
        ActiveItem                 : GIComponentItem;
        Items                      : array of GIComponentItem;
        AvailableBatches           : array of GIBatchItem;
        AvailableStock             : Decimal(13, 3);
        DefaultStorageLocation     : String(4);
        DefaultStorageLocationName : String(60);
        DefaultStorageBin          : String(18);
    };

    type QueueItem {
        ID                    : UUID;
        QueueReference        : String(40);
        ReservationNo         : String(10);
        ReservationItem       : String(4);
        OrderNo               : String(12);
        Material              : String(40);
        MaterialDesc          : String(80);
        Plant                 : String(4);
        StorageLocation       : String(4);
        StorageBin            : String(18);
        Batch                 : String(10);
        ExpiryDate            : Date;
        IssueQty              : Decimal(13, 3);
        Unit                  : String(10);
        DifferenceQty         : Decimal(13, 3);
        DifferenceReason      : String(4);
        DifferenceStorageType : String(3);
        FinalIssue            : Boolean;
        SyncStatus            : String(30);
        SyncAttempts          : Integer;
        LastSyncError         : String(500);
        SapMaterialDocument   : String(10);
        SapMaterialDocYear    : String(4);
        QueuedAt              : Timestamp;
        SyncedAt              : Timestamp;
    };

    type QueueSummary {
        QueuedCount : Integer;
        Items       : array of QueueItem;
    };

    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'User', 'Admin'])
    function resolveIdentifier(barcode: String(40)) returns GoodsIssueResolution;

    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'User', 'Admin'])
    function getQueueSummary() returns QueueSummary;

    @(requires: ['WarehouseClerk', 'WarehouseManager', 'Admin'])
    action postGoodsIssue(
        ReservationNo         : String(10),
        ReservationItem       : String(4),
        Material              : String(40),
        IssueQty              : Decimal(13, 3),
        Unit                  : String(10),
        Batch                 : String(20),
        DifferenceQty         : Decimal(13, 3),
        DifferenceReason      : String(4),
        DifferenceStorageType : String(3),
        FinalIssue            : Boolean
    ) returns GIPostResult;

    @(requires: ['WarehouseClerk', 'WarehouseManager', 'Admin'])
    action submitGoodsIssueRequest(
        ReservationNo : String(10),
        OrderNo       : String(12),
        Items         : array of GISubmitItem
    ) returns GISubmitBatchResult;

    @(requires: ['WarehouseClerk', 'WarehouseManager', 'Admin'])
    action retryQueuedGoodsIssue(
        QueueReference : String(40)
    ) returns GIPostResult;

    @(requires: ['WarehouseClerk', 'WarehouseManager', 'Admin'])
    action clearQueuedGoodsIssue(
        QueueReference : String(40)
    ) returns Boolean;

    // ──────────────────────────────────────────────────────────
    // Stock Unit (SU) Barcode → Batch Determination
    // ──────────────────────────────────────────────────────────

    type StockUnitBatchItem {
        Material            : String(40);
        Plant               : String(4);
        Batch               : String(10);
        ExpiryDate          : Date;
        ManufactDate        : Date;
        AvailableStock      : Decimal(13, 3);
        Unit                : String(3);
        StorageBin          : String(18);
        StorageLocation     : String(4);
        StorageLocationName : String(40);
        StatusState         : String(10);
        StatusText          : String(20);
        DaysToExpiry        : Integer;
    };

    type StockUnitResolution {
        SuBarcode                   : String(40);
        SuExists                    : Boolean;
        SuNotFoundReason            : String(255);
        ResolvedType                : String(30);
        HuService                   : String(120);
        HuInternalNumber            : String(40);
        HuExternalId                : String(40);
        DeliveryDocument            : String(10);
        DeliveryDocumentItem        : String(6);
        Material                    : String(40);
        MaterialDesc                : String(80);
        Plant                       : String(4);
        StorageLocation             : String(4);
        StorageBin                  : String(18);
        CurrentStock                : Decimal(13, 3);
        SuStockQty                  : Decimal(13, 3);
        BaseUnit                    : String(3);
        Batches                     : array of StockUnitBatchItem;
        DeterminedBatch             : String(10);
        DeterminedBatchExpiry       : Date;
        DeterminedBatchStatusState  : String(10);
        DeterminedBatchStatusText   : String(20);
        DeterminedBatchDaysToExpiry : Integer;
        MultipleBatches             : Boolean;
        NoBatchAvailable            : Boolean;
        ReservationNo               : String(10);
        ReservationItem             : String(4);
        OrderNo                     : String(12);
        MaterialMatch               : Boolean;
        PlantMatch                  : Boolean;
        SLocMatch                   : Boolean;
        ReservationRemainingQty     : Decimal(13, 3);
        ReservationRequiredQty      : Decimal(13, 3);
        ReservationWithdrawnQty     : Decimal(13, 3);
        MaxIssueQty                 : Decimal(13, 3);
        Unit                        : String(3);
    };

    type StockRevalidationResult {
        Material         : String(40);
        Plant            : String(4);
        StorageLocation  : String(4);
        Batch            : String(10);
        CurrentStock     : Decimal(13, 3);
        BaseUnit         : String(3);
        StockReadSuccess : Boolean;
        StockSufficient  : Boolean;
        RequestedQty     : Decimal(13, 3);
        BatchValid       : Boolean;
        BatchStatusState : String(10);
        BatchStatusText  : String(255);
        BatchExpiry      : Date;
        Valid            : Boolean;
        Message          : String(500);
    };

    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'User', 'Admin'])
    function resolveStockUnit(
        suBarcode       : String(40),
        reservationNo   : String(10),
        reservationItem : String(4)
    ) returns StockUnitResolution;

    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'User', 'Admin'])
    function revalidateStock(
        material        : String(40),
        plant           : String(4),
        storageLocation : String(4),
        batch           : String(10),
        requiredQty     : Decimal(13, 3)
    ) returns StockRevalidationResult;
}

