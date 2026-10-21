namespace saps4hana.wm;

@(requires: 'authenticated-user')
service TrToService @(path: '/odata/v4/tr-to') {

    type TRItem {
        Lgnum             : String(3);
        Tbnum             : String(10);
        Tbpos             : String(4);
        Material          : String(40);
        MaterialDesc      : String(80);
        Plant             : String(4);
        StorageLocation   : String(4);
        Batch             : String(10);
        RequiredQty       : Decimal(13, 3);
        ProcessedQty      : Decimal(13, 3);
        OpenQty           : Decimal(13, 3);
        Unit              : String(3);
        DeliveryCompleted : Boolean;
        DestStorageType   : String(3);
        DestStorageBin    : String(10);
    };

    type TRHeader {
        Lgnum   : String(3);
        Tbnum   : String(10);
        Bwlvs   : String(3);
        Betyp   : String(1);
        Benum   : String(10);
        Rsnum   : String(10);
        Bdatu   : Date;
        Statu   : String(1);
        Vltyp   : String(3);
        Vlpla   : String(10);
        Nltyp   : String(3);
        Nlpla   : String(10);
        Items   : array of TRItem;
    };

    type SUQuant {
        Lgnum          : String(3);
        QuantNumber    : String(10);
        StorageUnit    : String(20);
        Tbpos          : String(4);
        Material       : String(40);
        MaterialDesc   : String(80);
        Plant          : String(4);
        StorageLocation: String(4);
        Batch          : String(10);
        AvailableStock : Decimal(13, 3);
        Unit           : String(3);
        StorageType    : String(3);
        StorageBin     : String(10);
        DisplayText    : String(120);
        Description    : String(120);
    };

    type StorageUnit {
        Lgnum        : String(3);
        StorageUnit  : String(20);
        Tbnum        : String(10);
        StorageType  : String(3);
        StorageBin   : String(10);
        SUType       : String(3);
        IsValid      : Boolean;
        ErrorCode    : String(20);
        ErrorMessage : String(220);
        Quants       : array of SUQuant;
    };

    type TOConfirmation {
        TransferOrder : String(10);
        Success       : Boolean;
        Message       : String(220);
        Confirmed     : Boolean;
    };

    type TOProcessResult {
        ProcessId           : UUID;       // PROCESS_ID of this TO/GI step
        ErrorStep           : String(10);
        TransferOrder       : String(10);
        TransferRequirement : String(10);
        TRItem              : String(4);
        ReservationNo       : String(10);
        ReservationItem     : String(4);
        MovementType        : String(3);
        Status              : String(2);
        StatusText          : String(40);
        Confirmed           : Boolean;
        IsConfirmed         : Boolean;
        ConfirmationNumber  : String(10);
        ConfirmedBy         : String(12);
        Material            : String(40);
        MaterialName        : String(80);
        Plant               : String(4);
        StorageLocation     : String(4);
        Quantity            : Decimal(13, 3);
        Unit                : String(3);
        Batch               : String(10);
        Serials             : array of String(18);
        Success             : Boolean;
        Message             : String(255);
        MaterialDocument    : String(10);
        MaterialDocYear     : String(4);
        DeliveryNumber      : String(10);
        StockEffect         : String(80);
        ErrorMessage        : String(255);
        ReceivingPlant      : String(4);
        ReceivingStorageLocation : String(4);
        CostCenter          : String(10);
        AssetNo             : String(12);
        SubNumber           : String(4);
        Warning                 : String(255);
        ReceivingTr             : String(10);
        ReservationMovementType : String(3);
        success             : Boolean;
        stage               : String(20);
        error               : String(255);
        trNumber            : String(10);
        toNumber            : String(10);
        toItem              : String(4);
        confirmed           : Boolean;
    };

    type MigoProcessResult {
        ProcessId            : UUID;       // PROCESS_ID of this TO/GI step
        ErrorStep            : String(10);
        Success              : Boolean;
        success              : Boolean;
        stage                : String(20);
        error                : String(255);
        materialDocument     : String(10);
        materialDocumentYear : String(4);
        movementType         : String(3);
        MaterialDocument     : String(10);
        MaterialDocYear      : String(4);
        DeliveryNumber       : String(10);
        deliveryNumber       : String(10);
        Status               : String(2);
        StatusText           : String(40);
        ReservationNo        : String(10);
        ReservationItem      : String(4);
        TransferOrder        : String(10);
        MovementType         : String(3);
        Quantity             : Decimal(13, 3);
        Unit                 : String(3);
        Batch                : String(10);
        Serials              : array of String(18);
        StockEffect          : String(80);
        Message              : String(255);
        ErrorMessage         : String(255);
        alreadyPosted        : Boolean;
        idempotentRetry      : Boolean;
        businessKey          : String(120);
        stockVerification    : StockVerificationResult;
        reservationVerification : ReservationVerificationResult;
    };

    type MaterialDocumentVerification {
        success              : Boolean;
        stage                : String(20);
        materialDocument     : String(10);
        materialDocumentYear : String(4);
        movementType         : String(3);
        error                : String(255);
    };

    type StockVerificationResult {
        success                    : Boolean;
        stage                      : String(20);
        movementType               : String(3);
        materialDocument           : String(10);
        materialDocumentYear       : String(4);
        material                   : String(40);
        quantity                   : Decimal(13, 3);
        consumedQuantity           : Decimal(13, 3);
        costCenter                 : String(10);
        assetNo                    : String(12);
        subNumber                  : String(4);
        assetConsumptionPosted     : Boolean;
        sourceStockDecreased       : Boolean;
        destinationStockIncreased : Boolean;
        verified                   : Boolean;
        message                    : String(255);
        error                      : String(255);
    };

    type TRDetail {
        TransferRequirement     : String(10);
        TRItem                  : String(4);
        WarehouseNumber         : String(3);
        MovementType            : String(3);
        RequirementType         : String(1);
        RequirementNumber       : String(10);
        ReservationNo           : String(10);
        ReservationItem         : String(4);
        ReservationMovementType : String(3);
        AllowMismatchedTR       : Boolean;
        Warning                 : String(255);
        Material                : String(40);
        MaterialName            : String(80);
        Plant                   : String(4);
        StorageLocation         : String(4);
        DestinationStorageType  : String(3);
        DestinationStorageBin   : String(10);
        SourceStorageType       : String(3);
        SourceStorageBin        : String(10);
        ReceivingPlant          : String(4);
        ReceivingPlantSource    : String(40);
        ReceivingStorageLocation : String(4);
        ReceivingStorageLocationSource : String(40);
        CostCenter              : String(10);
        AssetNo                 : String(12);
        SubNumber               : String(4);
        OrderID                 : String(12);
        OrderType               : String(4);
        Backflush               : Boolean;
        RequiredQuantity        : Decimal(13, 3);
        ProcessedQuantity       : Decimal(13, 3);
        OpenQuantity            : Decimal(13, 3);
        Unit                    : String(3);
        Batch                   : String(10);
        FifoBatch               : String(10);
        SuggestedBatches        : array of BatchSuggestion;
        SuggestedSerials        : array of String(18);
        IsBatchManaged          : Boolean;
        IsSerialManaged         : Boolean;
        DeliveryCompleted       : Boolean;
        Status                  : String(2);
        StatusText              : String(40);
        StockWarning            : String(255);
        Items                   : array of TRItem; // all open items; TRItem is '' until one of several is chosen
    };

    type BatchSuggestion {
        Batch            : String(10);
        Material         : String(40);
        Plant            : String(4);
        StorageLocation  : String(4);
        StorageType      : String(3);
        StorageBin       : String(10);
        AvailableStock   : Decimal(13, 3);
        Unit             : String(3);
        GoodsReceiptDate : String(10);
        PutawayDate      : String(10);
        ExpiryDate       : String(10);
        FifoRank         : Integer;
        IsRecommended    : Boolean;
        Recommendation   : String(80);
    };

    type TRListItem {
        Lgnum        : String(3);
        Tbnum        : String(10);
        Bwlvs        : String(3);
        Betyp        : String(1);
        Benum        : String(10);
        Rsnum        : String(10);
        Bdatu        : Date;
        Statu        : String(1);
        DisplayText  : String(120);
        Description  : String(120);
    };

    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'Admin'])
    function getOpenTRs(lgnum: String(3), mvt: String(3)) returns array of TRListItem;

    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'Admin'])
    function getTR(tbnum: String(10), lgnum: String(3)) returns TRHeader;

    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'Admin'])
    // docType: 'TR' (number is a Transfer Requirement) or 'RES' (number is a Reservation); mandatory, never guessed.
    function lookupTR(tbnum: String(10), lgnum: String(3), docType: String(3), tbpos: String(4)) returns TRDetail;

    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'Admin'])
    function getFifoBatches(material: String(40), plant: String(4), storageLocation: String(4), warehouseNumber: String(3)) returns array of BatchSuggestion;

    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'Admin'])
    function getAvailableSerials(material: String(40), plant: String(4), storageLocation: String(4), batch: String(10)) returns array of String(18);

    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'Admin'])
    function getAvailableSUs(tbnum: String(10), lgnum: String(3), tbpos: String(4)) returns array of SUQuant;

    @(requires: ['Viewer', 'WarehouseClerk', 'WarehouseManager', 'Admin'])
    function checkSU(lenum: String(20), tbnum: String(10), lgnum: String(3)) returns StorageUnit;

    @(requires: ['WarehouseClerk', 'WarehouseManager', 'Admin'])
    // Create only (as RF transaction ZTO); item, unit and limits are derived from SAP server-side.
    action createTO(
        lgnum : String(3),
        tbnum : String(10),
        lenum : String(20),
        qty   : Decimal(13, 3)
    ) returns TOConfirmation;

    @(requires: ['WarehouseClerk', 'WarehouseManager', 'Admin'])
    action createTOFromTR(
        lgnum                    : String(3),
        tbnum                    : String(10),
        tbpos                    : String(4),
        qty                      : Decimal(13, 3),
        unit                     : String(3),
        batch                    : String(10),
        serials                  : array of String(18),
        storageUnit              : String(20),
        sourceStorageType        : String(3),
        sourceStorageBin         : String(10),
        receivingPlant           : String(4),
        ReceivingPlant           : String(4),
        receivingStorageLocation : String(4),
        ReceivingStorageLocation : String(4),
        costCenter               : String(10),
        CostCenter               : String(10),
        assetNo                  : String(12),
        AssetNo                  : String(12),
        subNumber                : String(4),
        SubNumber                : String(4),
        orderId                  : String(12),
        OrderId                  : String(12),
        OrderID                  : String(12),
        OrderType                : String(4),
        orderType                : String(4),
        autoConfirm              : Boolean,
        autoPostMigo             : Boolean,
        CompleteReservation      : Boolean, // sets NO_MORE_GR on the goods movement; never defaulted to true
        ReservationMovementType  : String(3),
        reservationMovementType  : String(3),
        ReservationNo            : String(10),
        reservationNo            : String(10),
        ReservationItem          : String(4),
        reservationItem          : String(4)
    ) returns TOProcessResult;

    @(requires: ['WarehouseClerk', 'WarehouseManager', 'Admin'])
    action CreateTOFromTR(
        lgnum                    : String(3),
        tbnum                    : String(10),
        tbpos                    : String(4),
        qty                      : Decimal(13, 3),
        unit                     : String(3),
        batch                    : String(10),
        serials                  : array of String(18),
        storageUnit              : String(20),
        sourceStorageType        : String(3),
        sourceStorageBin         : String(10),
        receivingPlant           : String(4),
        ReceivingPlant           : String(4),
        receivingStorageLocation : String(4),
        ReceivingStorageLocation : String(4),
        costCenter               : String(10),
        CostCenter               : String(10),
        assetNo                  : String(12),
        AssetNo                  : String(12),
        subNumber                : String(4),
        SubNumber                : String(4),
        orderId                  : String(12),
        OrderId                  : String(12),
        OrderID                  : String(12),
        OrderType                : String(4),
        orderType                : String(4),
        autoConfirm              : Boolean,
        autoPostMigo             : Boolean,
        CompleteReservation      : Boolean, // sets NO_MORE_GR on the goods movement; never defaulted to true
        ReservationMovementType  : String(3),
        reservationMovementType  : String(3),
        ReservationNo            : String(10),
        reservationNo            : String(10),
        ReservationItem          : String(4),
        reservationItem          : String(4)
    ) returns TOProcessResult;

    @(requires: ['WarehouseClerk', 'WarehouseManager', 'Admin'])
    action postMigoGoodsMovement(
        ReservationNo              : String(10),
        reservationNo              : String(10),
        reservationNumber          : String(10),
        ReservationItem            : String(4),
        reservationItem            : String(4),
        MovementType               : String(3),
        movementType               : String(3),
        ReservationMovementType    : String(3),
        reservationMovementType    : String(3),
        Material                   : String(40),
        material                   : String(40),
        Plant                      : String(4),
        plant                      : String(4),
        sourcePlant                : String(4),
        SourcePlant                : String(4),
        StorageLocation            : String(4),
        storageLocation            : String(4),
        sourceStorageLocation      : String(4),
        SourceStorageLocation      : String(4),
        Quantity                   : Decimal(13, 3),
        quantity                   : Decimal(13, 3),
        Unit                       : String(3),
        unit                       : String(3),
        ReceivingPlant             : String(4),
        receivingPlant             : String(4),
        destinationPlant           : String(4),
        DestinationPlant           : String(4),
        ReceivingStorageLocation   : String(4),
        receivingStorageLocation   : String(4),
        destinationStorageLocation : String(4),
        DestinationStorageLocation : String(4),
        CostCenter                 : String(10),
        costCenter                 : String(10),
        AssetNo                    : String(12),
        assetNo                    : String(12),
        SubNumber                  : String(4),
        subNumber                  : String(4),
        OrderID                    : String(12),
        OrderId                    : String(12),
        orderId                    : String(12),
        OrderNo                    : String(12),
        orderNo                    : String(12),
        OrderType                  : String(4),
        orderType                  : String(4),
        TransferOrder              : String(10),
        transferOrder              : String(10),
        Batch                      : String(10),
        batch                      : String(10),
        Serials                    : array of String(18),
        serials                    : array of String(18),
        CompleteReservation        : Boolean,
        completeReservation        : Boolean,
        ProcessId                  : UUID // PROCESS_ID of the GI step; reused on retry so an existing material document is found
    ) returns MigoProcessResult;

    @(requires: ['WarehouseClerk', 'WarehouseManager', 'Admin'])
    action PostMigoGoodsMovement(
        ReservationNo              : String(10),
        reservationNo              : String(10),
        reservationNumber          : String(10),
        ReservationItem            : String(4),
        reservationItem            : String(4),
        MovementType               : String(3),
        movementType               : String(3),
        ReservationMovementType    : String(3),
        reservationMovementType    : String(3),
        Material                   : String(40),
        material                   : String(40),
        Plant                      : String(4),
        plant                      : String(4),
        sourcePlant                : String(4),
        SourcePlant                : String(4),
        StorageLocation            : String(4),
        storageLocation            : String(4),
        sourceStorageLocation      : String(4),
        SourceStorageLocation      : String(4),
        Quantity                   : Decimal(13, 3),
        quantity                   : Decimal(13, 3),
        Unit                       : String(3),
        unit                       : String(3),
        ReceivingPlant             : String(4),
        receivingPlant             : String(4),
        destinationPlant           : String(4),
        DestinationPlant           : String(4),
        ReceivingStorageLocation   : String(4),
        receivingStorageLocation   : String(4),
        destinationStorageLocation : String(4),
        DestinationStorageLocation : String(4),
        CostCenter                 : String(10),
        costCenter                 : String(10),
        AssetNo                    : String(12),
        assetNo                    : String(12),
        SubNumber                  : String(4),
        subNumber                  : String(4),
        OrderID                    : String(12),
        OrderId                    : String(12),
        orderId                    : String(12),
        OrderNo                    : String(12),
        orderNo                    : String(12),
        OrderType                  : String(4),
        orderType                  : String(4),
        TransferOrder              : String(10),
        transferOrder              : String(10),
        Batch                      : String(10),
        batch                      : String(10),
        Serials                    : array of String(18),
        serials                    : array of String(18),
        CompleteReservation        : Boolean,
        completeReservation        : Boolean,
        ProcessId                  : UUID // PROCESS_ID of the GI step; reused on retry so an existing material document is found
    ) returns MigoProcessResult;

    @(requires: ['WarehouseClerk', 'WarehouseManager', 'Admin'])
    action verifyMaterialDocument(
        materialDocument     : String(10),
        materialDocumentYear : String(4),
        materialDocYear      : String(4),
        movementType         : String(3),
        material             : String(40),
        quantity             : Decimal(13, 3),
        plant                : String(4),
        storageLocation      : String(4),
        reservationNumber    : String(10),
        reservationNo        : String(10),
        reservationItem      : String(4)
    ) returns MaterialDocumentVerification;

    @(requires: ['WarehouseClerk', 'WarehouseManager', 'Admin'])
    action verifyStock(
        materialDocument           : String(10),
        materialDocumentYear       : String(4),
        materialDocYear            : String(4),
        movementType               : String(3),
        material                   : String(40),
        quantity                   : Decimal(13, 3),
        plant                      : String(4),
        sourcePlant                : String(4),
        storageLocation            : String(4),
        sourceStorageLocation      : String(4),
        receivingPlant             : String(4),
        destinationPlant           : String(4),
        receivingStorageLocation   : String(4),
        destinationStorageLocation : String(4),
        costCenter                 : String(10),
        assetNo                    : String(12),
        subNumber                  : String(4),
        initialSourceStock         : Decimal(13, 3),
        initialDestStock           : Decimal(13, 3)
    ) returns StockVerificationResult;

    type ReservationVerificationResult {
        success             : Boolean;
        stage               : String(30);
        reservationNumber   : String(10);
        reservationItem     : String(4);
        material            : String(40);
        plant               : String(4);
        storageLocation     : String(4);
        requestedQuantity   : Decimal(13, 3);
        issuedQuantity      : Decimal(13, 3);
        remainingQuantity   : Decimal(13, 3);
        unit                : String(3);
        isFinalIssue        : Boolean;
        isDeleted           : Boolean;
        completelyProcessed : Boolean;
        isComplete          : Boolean;
        completionStatus    : String(30);
        verified            : Boolean;
        error               : String(255);
    };

    @(requires: ['WarehouseClerk', 'WarehouseManager', 'Admin'])
    action verifyReservation(
        reservationNumber   : String(10),
        reservationNo       : String(10),
        reservationItem     : String(4)
    ) returns ReservationVerificationResult;

    type OrchestratorProcessResult {
        success              : Boolean;
        stage                : String(30);
        state                : String(30);
        currentState         : String(30);
        processStatus        : String(35);
        completed            : Boolean;
        alreadyPosted        : Boolean;
        idempotentRetry      : Boolean;
        businessKey          : String(120);
        stages               : array of String(30);
        reservationNumber    : String(10);
        reservationItem      : String(4);
        trNumber             : String(10);
        trItem               : String(4);
        toNumber             : String(10);
        toItem               : String(4);
        toConfirmed          : Boolean;
        materialDocument     : String(10);
        materialDocumentYear : String(4);
        stockVerified        : Boolean;
        reservationVerified  : Boolean;
        completelyProcessed  : Boolean;
        error                : String(255);
    };

    @(requires: ['WarehouseClerk', 'WarehouseManager', 'Admin'])
    action executeReservationWarehouseFlow(
        MovementType               : String(3),
        movementType               : String(3),
        Material                   : String(40),
        material                   : String(40),
        Plant                      : String(4),
        plant                      : String(4),
        sourcePlant                : String(4),
        SourcePlant                : String(4),
        StorageLocation            : String(4),
        storageLocation            : String(4),
        sourceStorageLocation      : String(4),
        SourceStorageLocation      : String(4),
        Quantity                   : Decimal(13, 3),
        quantity                   : Decimal(13, 3),
        Unit                       : String(3),
        unit                       : String(3),
        WarehouseNumber            : String(3),
        warehouseNumber            : String(3),
        ReceivingPlant             : String(4),
        receivingPlant             : String(4),
        destinationPlant           : String(4),
        DestinationPlant           : String(4),
        ReceivingStorageLocation   : String(4),
        receivingStorageLocation   : String(4),
        destinationStorageLocation : String(4),
        DestinationStorageLocation : String(4),
        CostCenter                 : String(10),
        costCenter                 : String(10),
        AssetNo                    : String(12),
        assetNo                    : String(12),
        SubNumber                  : String(4),
        subNumber                  : String(4),
        OrderID                    : String(12),
        OrderId                    : String(12),
        orderId                    : String(12),
        OrderNo                    : String(12),
        orderNo                    : String(12),
        OrderType                  : String(4),
        orderType                  : String(4),
        Batch                      : String(10),
        batch                      : String(10),
        Serials                    : array of String(18),
        serials                    : array of String(18),
        CompleteReservation        : Boolean,
        completeReservation        : Boolean,
        ReservationDate            : Date,
        reservationDate            : Date
    ) returns OrchestratorProcessResult;
}
