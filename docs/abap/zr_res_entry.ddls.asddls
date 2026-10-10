@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Reservation Entry Root View Entity'
define root view entity ZR_RES_ENTRY
  as select from zres_track
  composition [0..*] of zres_log as _Logs
{
  key rsnum             as ReservationNo,
  key rspos             as ReservationItem,
      process_id        as ProcessId,
      ref_text          as RefText,
      move_type         as MovementType,
      werks             as Plant,
      lgort             as StorageLocation,
      lgnum             as WarehouseNumber,
      umlgo             as ReceivingStorageLocation,
      umwrk             as ReceivingPlant,
      kostl             as CostCenter,
      anln1             as AssetNumber,
      anln2             as AssetSubNumber,
      saknr             as GLAccount,
      matnr             as Material,
      charg             as Batch,
      sernr             as SerialNumber,
      menge             as Quantity,
      conf_menge        as ConfirmedQuantity,
      meins             as UnitOfMeasure,
      complete_res      as CompleteReservation,
      tbnum             as TransferRequirement,
      tanum             as TransferOrder,
      mblnr             as MaterialDocument,
      mjahr             as MaterialDocYear,
      status            as Status,
      retry_count       as RetryCount,
      error_step        as ErrorStep,
      err_msg           as ErrorMessage,
      created_by        as CreatedBy,
      created_on        as CreatedOn,
      created_at        as CreatedAt,
      changed_by        as ChangedBy,
      changed_on        as ChangedOn,
      changed_at        as ChangedAt,

      _Logs
}
