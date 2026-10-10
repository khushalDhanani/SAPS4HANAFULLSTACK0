@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Reservation Entry Root View Entity'
define root view entity ZR_RES_ENTRY
  as select from zres_track
  composition [0..*] of zres_log as _Logs
{
  key rsnum             as ReservationNo,
  key rspos             as ReservationItem,
      move_type         as MovementType,
      lgnum             as WarehouseNumber,
      tbnum             as TransferRequirement,
      tanum             as TransferOrder,
      mblnr             as MaterialDocument,
      mjahr             as MaterialDocYear,
      status            as Status,
      err_msg           as ErrorMessage,
      created_by        as CreatedBy,
      created_on        as CreatedOn,
      created_at        as CreatedAt,
      changed_by        as ChangedBy,
      changed_on        as ChangedOn,
      changed_at        as ChangedAt,

      _Logs
}
