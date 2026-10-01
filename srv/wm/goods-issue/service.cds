namespace saps4hana.wm;

using { saps4hana.wm.GoodsIssueQueue as DBGoodsIssueQueue } from '../../../db/wm/goods-issue-queue';
// Posting-attempt log (written before S/4HANA is called); internal, not exposed as an entity.
using from '../../../db/wm/goods-issue-attempt';

@(requires: 'authenticated-user')
service GoodsIssueService @(path: '/odata/v4/goods-issue') {

    type PackagingUnit {
        Unit         : String(3);
        Description  : String(40);
        Numerator    : Integer;
        Denominator  : Integer;
        FactorToBase : Decimal(13, 3);
        IsBaseUnit   : Boolean;
    };

    // Dispatch queue records persisted in the CAP database. Read-only over OData: every change goes
    // through postGoodsIssue / retryQueuedGoodsIssue / clearQueuedGoodsIssue.
    @readonly
    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'Admin'])
    entity GoodsIssueQueue as projection on DBGoodsIssueQueue;

    @readonly
    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'Admin'])
    entity GIItems {
        key ReservationNo   : String(10);
        key ReservationItem : String(4);
            OrderNo         : String(12);
            Material        : String(40);
            MaterialDesc    : String(80);
            Plant           : String(4);
            StorageLocation : String(4);
            Batch           : String(10);
            ExpiryDate      : Date;
            BatchStatusState: String(10);
            BatchStatusText : String(20);
            Unit            : String(3);
            RequiredQty     : Decimal(13, 3);
            WithdrawnQty    : Decimal(13, 3);
            QueuedQty       : Decimal(13, 3);
            OpenQty         : Decimal(13, 3);
            MovementType    : String(3);
            MovementTypeName: String(20);
            CostCenter      : String(10);
            IsSerialManaged : Boolean;
            SerialNumber    : String(18);
            SerialNumbers   : array of String(18);
            ReceivingPlant  : String(4);
            ReceivingStorageLocation : String(4);
            PackagingUnits  : array of PackagingUnit;
    };

    @readonly
    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'Admin'])
    entity MaterialBatches {
        key Material            : String(40);
        key Plant               : String(4);
        key Batch               : String(10);
            ExpiryDate          : Date;
            ManufactDate        : Date;
            AvailableStock      : Decimal(13, 3);
            Unit                : String(3);
            StorageLocation     : String(4);
            StorageLocationName : String(40);
            StatusState         : String(10);
            StatusText          : String(20);
            DaysToExpiry        : Integer;
    };

    @readonly
    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'Admin'])
    entity OpenReservations {
        key ReservationNo      : String(10);
            OrderNo            : String(12);
            Plant              : String(4);
            StorageLocation    : String(4);
            ReceivingPlant     : String(4);
            ReceivingStorageLocation : String(4);
            MovementType       : String(4);
            MovementTypeName   : String(40);
            CreatedByUser      : String(12);
            ItemCount          : Integer;
            SampleMaterial     : String(40);
            SampleMaterialDesc : String(80);
            DisplayText        : String(120);
            IsTruncated        : Boolean;
            ItemCountPartial   : Boolean;
            TruncationNote     : String(120);
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
        SerialNumber          : String(18);
        SerialNumbers         : array of String(18);
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
        Queued            : Boolean;
        QueueReference    : String(40);
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
        SerialNumber      : String(18);
        SerialNumbers     : array of String(18);
        Success           : Boolean;
        Message           : String(500);
        Queued            : Boolean;
        QueueReference    : String(40);
        SyncStatus        : String(30);
    };

    type GIReversalResult {
        OriginalMaterialDocument : String(10);
        OriginalMaterialDocYear  : String(4);
        ReversalMaterialDocument : String(10);
        ReversalMaterialDocYear  : String(4);
        PostingDate              : Date;
        Success                  : Boolean;
        Message                  : String(500);
    };

    type GIComponentItem {
        ReservationNo   : String(10);
        ReservationItem : String(4);
        OrderNo         : String(12);
        Material        : String(40);
        MaterialDesc    : String(80);
        Plant           : String(4);
        StorageLocation : String(4);
        Batch           : String(10);
        ExpiryDate      : Date;
        BatchStatusState: String(10);
        BatchStatusText : String(20);
        Unit            : String(3);
        RequiredQty     : Decimal(13, 3);
        WithdrawnQty    : Decimal(13, 3);
        QueuedQty       : Decimal(13, 3);
        OpenQty         : Decimal(13, 3);
        MovementType    : String(3);
        MovementTypeName: String(20);
        CostCenter      : String(10);
        IsSerialManaged : Boolean;
        SerialNumber    : String(18);
        SerialNumbers   : array of String(18);
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
        StorageLocation     : String(4);
        StorageLocationName : String(40);
        StatusState         : String(10);
        StatusText          : String(20);
        DaysToExpiry        : Integer;
        IsSelectable        : Boolean;
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
        Batch                 : String(10);
        ExpiryDate            : Date;
        IssueQty              : Decimal(13, 3);
        Unit                  : String(10);
        DifferenceQty         : Decimal(13, 3);
        DifferenceReason      : String(4);
        DifferenceStorageType : String(3);
        FinalIssue            : Boolean;
        CostCenter            : String(10);
        GLAccount             : String(10);
        SerialNumber          : String(18);
        PostingDate           : Date;
        DocumentDate          : Date;
        SyncStatus            : String(30);
        SyncAttempts          : Integer;
        LastSyncError         : String(500);
        SapMaterialDocument   : String(10);
        SapMaterialDocYear    : String(4);
        QueuedAt              : Timestamp;
        SyncedAt              : Timestamp;
    };

    type QueueSummary {
        QueuedCount    : Integer;
        TotalCount     : Integer;
        // False when no database is bound to this deployment: nothing can be queued or listed.
        StoreAvailable : Boolean;
        Items          : array of QueueItem;
    };

    type QueueDrainResult {
        TotalQueued     : Integer;
        Attempted       : Integer;
        SyncedToSap     : Integer;
        Failed          : Integer;
        RemainingQueued : Integer;
        Message         : String(500);
        Items           : array of QueueItem;
    };

    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'Admin'])
    function resolveIdentifier(barcode: String(40)) returns GoodsIssueResolution;

    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'Admin'])
    function getQueueSummary() returns QueueSummary;

    // ── Isolated per-movement-type posting actions (Phase 1). Each accepts only its type's fields. ──

    @(requires: ['WarehouseClerk', 'WarehouseManager', 'Admin'])
    action postGoodsIssue201(
        CostCenter      : String(10),
        Material        : String(40),
        IssueQty        : Decimal(13, 3),
        Unit            : String(10),
        Batch           : String(20),
        Plant           : String(4),
        StorageLocation : String(4),
        ReservationNo   : String(10),
        ReservationItem : String(4),
        PostingDate     : Date,
        DocumentDate    : Date,
        SerialNumbers   : array of String(18),
        SerialNumber    : String(18)
    ) returns GIPostResult;

    @(requires: ['WarehouseClerk', 'WarehouseManager', 'Admin'])
    action postGoodsIssue261(
        ReservationNo   : String(10),
        ReservationItem : String(4),
        Material        : String(40),
        MaterialDesc    : String(80),
        OrderNo         : String(12),
        IssueQty        : Decimal(13, 3),
        Unit            : String(10),
        Batch           : String(20),
        Plant           : String(4),
        StorageLocation : String(4),
        GLAccount       : String(10),
        PostingDate     : Date,
        DocumentDate    : Date,
        SerialNumbers   : array of String(18),
        SerialNumber    : String(18)
    ) returns GIPostResult;

    @(requires: ['WarehouseClerk', 'WarehouseManager', 'Admin'])
    action postGoodsIssue301(
        ReservationNo            : String(10),
        ReservationItem          : String(4),
        Material                 : String(40),
        IssueQty                 : Decimal(13, 3),
        Unit                     : String(10),
        Batch                    : String(20),
        Plant                    : String(4),
        StorageLocation          : String(4),
        ReceivingPlant           : String(4),
        ReceivingStorageLocation : String(4),
        PostingDate              : Date,
        DocumentDate             : Date,
        SerialNumbers            : array of String(18),
        SerialNumber             : String(18)
    ) returns GIPostResult;

    @(requires: ['WarehouseClerk', 'WarehouseManager', 'Admin'])
    action postGoodsIssue311(
        ReservationNo            : String(10),
        ReservationItem          : String(4),
        Material                 : String(40),
        IssueQty                 : Decimal(13, 3),
        Unit                     : String(10),
        Batch                    : String(20),
        Plant                    : String(4),
        StorageLocation          : String(4),
        ReceivingPlant           : String(4),
        ReceivingStorageLocation : String(4),
        PostingDate              : Date,
        DocumentDate             : Date,
        SerialNumbers            : array of String(18),
        SerialNumber             : String(18)
    ) returns GIPostResult;

    @(requires: ['WarehouseClerk', 'WarehouseManager', 'Admin'])
    action reverseGoodsIssue(
        MaterialDocument : String(10),
        MaterialDocYear  : String(4),
        PostingDate      : Date,
        DocumentDate     : Date,
        ReversalReason   : String(4)
    ) returns GIReversalResult;

    // Order/reservation-based batch scan-then-submit. This is movement type 261 ONLY (GI for order):
    // there is deliberately no movementType parameter, and the adapter posts as 261. Do NOT route
    // 201/301/311 through this action — use the dedicated postGoodsIssue201/301/311 actions, which
    // carry the correct movement type and mappings.
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

    @(requires: ['WarehouseClerk', 'WarehouseManager', 'Admin'])
    action drainQueue() returns QueueDrainResult;

    type PostingAttemptRecheckResult {
        Checked   : Integer;
        Posted    : Integer;
        NotPosted : Integer;
        Requeued  : Integer;
        StillOpen : Integer;
        Errors    : Integer;
    }

    // Looks up posting attempts left in `sending` / `unconfirmed` in S/4HANA by their reference.
    // Also runs on a timer (GI_ATTEMPT_RECHECK_INTERVAL_MS) and before every drainQueue.
    @(requires: ['WarehouseManager', 'Admin'])
    action recheckPostingAttempts() returns PostingAttemptRecheckResult;

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
        SerialNumber                : String(18);
        DeterminedSerial            : String(18);
        IsSerialManaged             : Boolean;
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

    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'Admin'])
    function resolveStockUnit(
        suBarcode       : String(40),
        reservationNo   : String(10),
        reservationItem : String(4)
    ) returns StockUnitResolution;

    type StockUnitListItem {
        StorageUnit     : String(20);
        Warehouse       : String(3);
        Material        : String(40);
        Plant           : String(4);
        StorageLocation : String(4);
        StorageType     : String(3);
        StorageBin      : String(10);
        Batch           : String(10);
        MultipleBatches : Boolean;
        ExpiryDate      : Date;
        StatusState     : String(10);
        StatusText      : String(20);
        DaysToExpiry    : Integer;
        GrDate          : Date;
        AvailableStock  : Decimal(13, 3);
        Unit            : String(3);
        QuantCount      : Integer;
    };

    type StockUnitList {
        ReservationNo   : String(10);
        ReservationItem : String(4);
        Material        : String(40);
        Plant           : String(4);
        StorageLocation : String(4);
        Batch           : String(10);
        Warehouse       : String(20);
        StockUnits      : array of StockUnitListItem;
        ExcludedCount   : Integer;
        Message         : String(500);
    };

    // Storage Units valid for exactly one reservation line (material/plant/sloc/batch, issuable stock only).
    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'Admin'])
    function getStockUnitsForItem(
        reservationNo   : String(10),
        reservationItem : String(4)
    ) returns StockUnitList;

    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'Admin'])
    function revalidateStock(
        material        : String(40),
        plant           : String(4),
        storageLocation : String(4),
        batch           : String(10),
        requiredQty     : Decimal(13, 3)
    ) returns StockRevalidationResult;

    type GIDashboardKpiItem {
        TotalCount         : Integer;
        OpenPendingCount   : Integer;
        TodayPostingsCount : Integer;
    };

    type GIDashboardKpis {
        Mvt201  : GIDashboardKpiItem;
        Mvt261  : GIDashboardKpiItem;
        Mvt301  : GIDashboardKpiItem;
        Mvt311  : GIDashboardKpiItem;
        Overall : GIDashboardKpiItem;
    };

    type GIDistributionItem {
        MovementType     : String(4);
        MovementTypeName : String(40);
        Count            : Integer;
        Percentage       : Decimal(5, 2);
    };

    type GITrendItem {
        PostingDate : Date;
        DateLabel   : String(10);
        Count201    : Integer;
        Count261    : Integer;
        Count301    : Integer;
        Count311    : Integer;
        Total       : Integer;
    };

    type GIMaterialDocumentItem {
        MaterialDocument : String(10);
        MaterialDocYear  : String(4);
        Item             : String(4);
        MovementType     : String(4);
        MovementTypeName : String(40);
        Material         : String(40);
        MaterialDesc     : String(80);
        Plant            : String(4);
        StorageLocation  : String(4);
        Batch            : String(10);
        Quantity         : Decimal(13, 3);
        Unit             : String(3);
        PostingDate      : Date;
        User             : String(20);
        CostCenter       : String(10);
        OrderNo          : String(12);
        ReservationNo    : String(10);
        ReservationItem  : String(4);
        DebitCredit      : String(1);
        ReceivingPlant           : String(4);
        ReceivingStorageLocation : String(4);
    };

    // Per-movement-type recent postings, returned only on the combined (unfiltered) call so the Fiori
    // dashboard can fill all four Recent Postings tables from one request instead of four extra calls.
    type GIRecentByType {
        Mvt201 : array of GIMaterialDocumentItem;
        Mvt261 : array of GIMaterialDocumentItem;
        Mvt301 : array of GIMaterialDocumentItem;
        Mvt311 : array of GIMaterialDocumentItem;
    };

    type GIDashboardData {
        Kpis            : GIDashboardKpis;
        Distribution    : array of GIDistributionItem;
        Trend           : array of GITrendItem;
        RecentDocuments : array of GIMaterialDocumentItem;
        RecentByType    : GIRecentByType;
        LastUpdated     : Timestamp;
        PlantFilter     : String(4);
        Days            : Integer;
    };

    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'Admin'])
    function getDashboardData(
        days         : Integer,
        plant        : String(4),
        forceRefresh : Boolean,
        movementType : String(4)
    ) returns GIDashboardData;
}

// These entities are read live from SAP S/4HANA by the custom READ handlers and hold no local data:
// no database table is generated for them (only saps4hana.wm.GoodsIssueQueue is persisted).
annotate GoodsIssueService.GIItems with @cds.persistence.skip;
annotate GoodsIssueService.MaterialBatches with @cds.persistence.skip;
annotate GoodsIssueService.OpenReservations with @cds.persistence.skip;
