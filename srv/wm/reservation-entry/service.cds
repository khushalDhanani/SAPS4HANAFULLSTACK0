namespace saps4hana.wm;

using { saps4hana.wm as wm } from '../../../db/wm/reservation-track';

@path: '/odata/v4/reservation-entry'
@(requires: 'authenticated-user')
service ReservationEntryService {

    @readonly
    entity ReservationStatuses as projection on wm.ReservationStatus;

    entity ReservationEntries as projection on wm.ReservationTrack {
        *,
        Status.name as StatusText,
        Status.criticality as StatusCriticality
    };

    @readonly
    entity ReservationLogs as projection on wm.ReservationLog;

    type ReservationCreatedDoc {
        number : String(10);
        item   : String(4);
    };

    type ReservationCreatedResponse {
        success      : Boolean;
        stage        : String(20);
        error        : String(255);
        reservation  : ReservationCreatedDoc;
        movementType : String(3);
    };

    type TrCreatedResponse {
        success           : Boolean;
        stage             : String(20);
        error             : String(255);
        reservationNumber : String(10);
        trNumber          : String(10);
        trItem            : String(4);
        material          : String(40);
        quantity          : Decimal(13,3);
        plant             : String(4);
        storageLocation   : String(4);
        warehouse         : String(3);
        movement          : String(3);
    };

    type TOCreatedResponse {
        success           : Boolean;
        stage             : String(20);
        error             : String(255);
        reservationNumber : String(10);
        trNumber          : String(10);
        toNumber          : String(10);
        toItem            : String(4);
        confirmed         : Boolean;
        warehouse         : String(3);
        itemsCreated      : Integer;
    };

    @(requires: ['WarehouseClerk', 'WarehouseManager', 'Admin'])
    action createReservation(
        MovementType            : String(3),
        Plant                   : String(4),
        StorageLocation         : String(4),
        Material                : String(40),
        MaterialName            : String(40),
        Quantity                : Decimal(13,3),
        Unit                    : String(3),
        ReservationDate         : Date,
        reservationDate         : Date,
        ReceivingPlant          : String(4),
        ReceivingStorageLocation: String(4),
        CostCenter              : String(10),
        AssetNo                 : String(12),
        SubNumber               : String(4),
        OrderID                 : String(12),
        WarehouseNumber         : String(3),
        Batch                   : String(10)
    ) returns ReservationCreatedResponse;

    @(requires: ['WarehouseClerk', 'WarehouseManager', 'Admin'])
    action createTransferRequirement(
        ReservationNo   : String(10),
        ReservationItem : String(4),
        WarehouseNumber : String(3)
    ) returns TrCreatedResponse;

    type TOConfirmedResponse {
        success         : Boolean;
        stage           : String(20);
        error           : String(255);
        warehouseNumber : String(3);
        toNumber        : String(10);
        confirmed       : Boolean;
        status          : String(2);
    };

    @(requires: ['WarehouseClerk', 'WarehouseManager', 'Admin'])
    action createTOFromTR(
        ReservationNo   : String(10),
        ReservationItem : String(4),
        WarehouseNumber : String(3),
        TRNumber        : String(10),
        autoConfirm     : Boolean
    ) returns TOCreatedResponse;

    @(requires: ['WarehouseClerk', 'WarehouseManager', 'Admin'])
    action confirmTransferOrder(
        ReservationNo   : String(10),
        ReservationItem : String(4),
        WarehouseNumber : String(3),
        TransferOrder   : String(10)
    ) returns TOConfirmedResponse;

    @(requires: ['WarehouseClerk', 'WarehouseManager', 'Admin'])
    action createReservationEntry(
        MovementType            : String(3),
        Plant                   : String(4),
        StorageLocation         : String(4),
        Material                : String(40),
        MaterialName            : String(40),
        Quantity                : Decimal(13,3),
        Unit                    : String(3),
        ReservationDate         : Date,
        reservationDate         : Date,
        ReceivingPlant          : String(4),
        ReceivingStorageLocation: String(4),
        CostCenter              : String(10),
        AssetNo                 : String(12),
        SubNumber               : String(4),
        OrderID                 : String(12),
        WarehouseNumber         : String(3),
        Batch                   : String(10),
        SerialNo                : String(18),
        Serials                 : array of String(18)
    ) returns ReservationEntries;

    @(requires: ['WarehouseClerk', 'WarehouseManager', 'Admin'])
    action postMigoGoodsMovement(
        ReservationNo              : String(10),
        reservationNumber          : String(10),
        ReservationItem            : String(4),
        reservationItem            : String(4),
        MovementType               : String(3),
        movementType               : String(3),
        Material                   : String(40),
        material                   : String(40),
        Plant                      : String(4),
        plant                      : String(4),
        sourcePlant                : String(4),
        StorageLocation            : String(4),
        storageLocation            : String(4),
        sourceStorageLocation      : String(4),
        Quantity                   : Decimal(13,3),
        quantity                   : Decimal(13,3),
        Unit                       : String(3),
        unit                       : String(3),
        ReceivingPlant             : String(4),
        receivingPlant             : String(4),
        destinationPlant           : String(4),
        ReceivingStorageLocation   : String(4),
        receivingStorageLocation   : String(4),
        destinationStorageLocation : String(4),
        CostCenter                 : String(10),
        costCenter                 : String(10),
        AssetNo                    : String(12),
        assetNo                    : String(12),
        SubNumber                  : String(4),
        subNumber                  : String(4),
        OrderID                    : String(12),
        orderId                    : String(12),
        OrderNo                    : String(12),
        orderNo                    : String(12),
        Batch                      : String(10),
        batch                      : String(10),
        SerialNo                   : String(18),
        Serials                    : array of String(18),
        serials                    : array of String(18),
        CompleteReservation        : Boolean,
        completeReservation        : Boolean
    ) returns ReservationEntries;

    type MaterialDocumentVerification {
        success              : Boolean;
        stage                : String(20);
        materialDocument     : String(10);
        materialDocumentYear : String(4);
        movementType         : String(3);
        error                : String(255);
    };

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

    @(requires: ['WarehouseClerk', 'WarehouseManager', 'Admin'])
    action retryStep(
        ReservationNo   : String(10),
        ReservationItem : String(4),
        Step            : String(10),
        Batch           : String(10),
        SerialNo        : String(18),
        Serials         : array of String(18),
        CompleteReservation : Boolean
    ) returns ReservationEntries;

    @(requires: ['WarehouseClerk', 'WarehouseManager', 'Admin'])
    function getApplicationLogs(
        ReservationNo   : String(10),
        ReservationItem : String(4)
    ) returns array of ReservationLogs;

    type OpenReservationRow {
        ReservationNo            : String(10);
        ReservationItem          : String(4);
        MovementType             : String(3);
        MovementTypeName         : String(60);
        Material                 : String(40);
        MaterialName             : String(80);
        Plant                    : String(4);
        StorageLocation          : String(4);
        ReceivingPlant           : String(4);
        ReceivingStorageLocation : String(4);
        OrderNo                  : String(12);
        CreatedByUser            : String(12);
        ItemCount                : Integer;
        DisplayText              : String(150);
    }

    // All open reservations read live from SAP S/4HANA (every open item, all movement types).
    @readonly
    function getOpenReservations(
        plant        : String(4),
        movementType : String(3)
    ) returns array of OpenReservationRow;

    type ReservationDetailRow {
        ReservationNo            : String(10);
        ReservationItem          : String(4);
        MovementType             : String(3);
        Material                 : String(40);
        MaterialName             : String(80);
        Plant                    : String(4);
        StorageLocation          : String(4);
        ReceivingPlant           : String(4);
        ReceivingStorageLocation : String(4);
        Quantity                 : Decimal(13,3);
        Unit                     : String(3);
        WithdrawnQuantity        : Decimal(13,3);
        RemainingQuantity        : Decimal(13,3);
        CompletelyProcessed      : Boolean;
        Batch                    : String(10);
        CostCenter               : String(10);
        AssetNo                  : String(12);
        SubNumber                : String(4);
        WarehouseNumber          : String(3);
        Status_code              : String(2);
        StatusText               : String(40);
        TransferRequirement      : String(10);
        TransferOrder            : String(10);
        MaterialDocument         : String(10);
        MaterialDocYear          : String(4);
        ErrorMessage             : String(255);
        ExternalId               : String(25);
        LogHandle                : String(40);
        ProcessStatus            : String(35);
        MigoBusinessKey          : String(120);
    }

    // Live detail for a reservation not tracked locally (created outside this app): read from SAP RKPF/RESB.
    @readonly
    function getReservationDetail(
        ReservationNo   : String(10),
        ReservationItem : String(4)
    ) returns ReservationDetailRow;

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
