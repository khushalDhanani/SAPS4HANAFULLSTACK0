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

    @(requires: ['WarehouseClerk', 'WarehouseManager', 'Admin'])
    action createReservationEntry(
        MovementType            : String(3),
        Plant                   : String(4),
        StorageLocation         : String(4),
        Material                : String(40),
        MaterialName            : String(40),
        Quantity                : Decimal(13,3),
        Unit                    : String(3),
        ReceivingPlant          : String(4),
        ReceivingStorageLocation: String(4),
        CostCenter              : String(10),
        AssetNo                 : String(12),
        SubNumber               : String(4),
        WarehouseNumber         : String(3)
    ) returns ReservationEntries;
}
