namespace saps4hana.wm;

using { saps4hana.wm as wm } from '../../../db/wm/reservation-track';

@path: '/odata/v4/reservation-track'
@(requires: 'authenticated-user')
service ReservationTrackService {

    @readonly
    entity ReservationStatuses as projection on wm.ReservationStatus;

    entity ReservationTracks as projection on wm.ReservationTrack;

    entity ReservationLogs as projection on wm.ReservationLog;

    @(requires: ['WarehouseClerk', 'WarehouseManager', 'Admin'])
    action updateTrack(
        ReservationNo       : String(10),
        ReservationItem     : String(4),
        MovementType        : String(3),
        WarehouseNumber     : String(3),
        TransferRequirement : String(10),
        TransferOrder       : String(10),
        MaterialDocument    : String(10),
        MaterialDocYear     : String(4),
        Status              : String(10),
        ErrorMessage        : String(255)
    ) returns ReservationTracks;

    @(requires: ['WarehouseClerk', 'WarehouseManager', 'Admin'])
    action addLog(
        ReservationNo   : String(10),
        ReservationItem : String(4),
        Step            : String(10),
        Status          : String(10),
        MessageType     : String(1),
        MessageId       : String(20),
        MessageNo       : String(3),
        MessageText     : String(255)
    ) returns ReservationLogs;

    @(requires: ['WarehouseClerk', 'WarehouseManager', 'Admin'])
    action advanceStatus(
        ReservationNo   : String(10),
        ReservationItem : String(4),
        NextStatus      : String(10),
        DocumentNo      : String(10),
        Step            : String(10),
        Message         : String(255)
    ) returns ReservationTracks;
}
