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
        WarehouseNumber         : String(3),
        Batch                   : String(10)
    ) returns ReservationCreatedResponse;

    @(requires: ['WarehouseClerk', 'WarehouseManager', 'Admin'])
    action createTransferRequirement(
        ReservationNo   : String(10),
        ReservationItem : String(4),
        WarehouseNumber : String(3)
    ) returns TrCreatedResponse;

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
        WarehouseNumber         : String(3),
        Batch                   : String(10),
        SerialNo                : String(18),
        Serials                 : array of String(18)
    ) returns ReservationEntries;

    @(requires: ['WarehouseClerk', 'WarehouseManager', 'Admin'])
    action postMigoGoodsMovement(
        ReservationNo            : String(10),
        ReservationItem          : String(4),
        MovementType             : String(3),
        Material                 : String(40),
        Plant                    : String(4),
        StorageLocation          : String(4),
        Quantity                 : Decimal(13,3),
        Unit                     : String(3),
        ReceivingPlant           : String(4),
        ReceivingStorageLocation : String(4),
        CostCenter               : String(10),
        AssetNo                  : String(12),
        SubNumber                : String(4),
        Batch                    : String(10),
        SerialNo                 : String(18),
        Serials                  : array of String(18),
        CompleteReservation      : Boolean
    ) returns ReservationEntries;

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
    }

    // Live detail for a reservation not tracked locally (created outside this app): read from SAP RKPF/RESB.
    @readonly
    function getReservationDetail(
        ReservationNo   : String(10),
        ReservationItem : String(4)
    ) returns ReservationDetailRow;
}
