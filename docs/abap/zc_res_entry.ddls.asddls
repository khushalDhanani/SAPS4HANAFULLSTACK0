@EndUserText.label: 'Reservation Entry Projection View'
@AccessControl.authorizationCheck: #NOT_REQUIRED
@Metadata.allowExtensions: true

@UI: {
  headerInfo: {
    typeName: 'Reservation Entry',
    typeNamePlural: 'Reservation Entries',
    title: { type: #STANDARD, value: 'ReservationNo' },
    description: { value: 'MovementType' }
  }
}
define root view entity ZC_RES_ENTRY
  provider contract transactional_query
  as projection on ZR_RES_ENTRY
{
  @UI.facet: [
    {
      id: 'GeneralInfo',
      type: #IDENTIFICATION_REFERENCE,
      label: 'General Information',
      position: 10
    },
    {
      id: 'WMTracking',
      type: #FIELDGROUP_REFERENCE,
      targetQualifier: 'WMGroup',
      label: 'Warehouse Management Tracking',
      position: 20
    },
    {
      id: 'AuditInfo',
      type: #FIELDGROUP_REFERENCE,
      targetQualifier: 'AuditGroup',
      label: 'Audit & Process References',
      position: 25
    },
    {
      id: 'LogsFacet',
      type: #LINEITEM_REFERENCE,
      targetElement: '_Logs',
      label: 'Step-Wise Processing Logs',
      position: 30
    }
  ]

  @UI.fieldGroup: [{ qualifier: 'AuditGroup', position: 10, label: 'Process UUID' }]
  key ProcessId,

  @UI.lineItem: [{ position: 10, importance: #HIGH, label: 'Reservation No' }]
  @UI.identification: [{ position: 10, label: 'Reservation No' }]
  @UI.selectionField: [{ position: 10 }]
  ReservationNo,

  @UI.lineItem: [{ position: 20, label: 'Item' }]
  @UI.identification: [{ position: 20, label: 'Item' }]
  ReservationItem,

  @UI.fieldGroup: [{ qualifier: 'AuditGroup', position: 20, label: 'Reference Text' }]
  RefText,

  @UI.lineItem: [{ position: 30, importance: #HIGH, label: 'Movement Type' }]
  @UI.identification: [{ position: 30, label: 'Movement Type' }]
  @UI.selectionField: [{ position: 20 }]
  MovementType,

  @UI.lineItem: [{ position: 35, label: 'Material' }]
  @UI.identification: [{ position: 35, label: 'Material' }]
  @UI.selectionField: [{ position: 25 }]
  Material,

  @UI.lineItem: [{ position: 36, label: 'Plant' }]
  @UI.identification: [{ position: 36, label: 'Plant' }]
  Plant,

  @UI.lineItem: [{ position: 37, label: 'Storage Loc' }]
  @UI.identification: [{ position: 37, label: 'Storage Location' }]
  StorageLocation,

  @UI.identification: [{ position: 38, label: 'Receiving SLoc' }]
  ReceivingStorageLocation,

  @UI.identification: [{ position: 39, label: 'Receiving Plant' }]
  ReceivingPlant,

  @UI.identification: [{ position: 41, label: 'Cost Center' }]
  CostCenter,

  @UI.identification: [{ position: 42, label: 'Asset Number' }]
  AssetNumber,

  @UI.identification: [{ position: 43, label: 'Asset Sub-number' }]
  AssetSubNumber,

  @UI.identification: [{ position: 44, label: 'G/L Account' }]
  GLAccount,

  @UI.lineItem: [{ position: 45, label: 'Quantity' }]
  @UI.identification: [{ position: 45, label: 'Target Quantity' }]
  Quantity,

  @UI.lineItem: [{ position: 46, label: 'Confirmed Qty' }]
  @UI.identification: [{ position: 46, label: 'Confirmed TO Qty' }]
  ConfirmedQuantity,

  @UI.identification: [{ position: 47, label: 'Unit' }]
  UnitOfMeasure,

  @UI.identification: [{ position: 48, label: 'Batch' }]
  Batch,

  @UI.identification: [{ position: 49, label: 'Serial Number' }]
  SerialNumber,

  @UI.identification: [{ position: 50, label: 'Complete Reservation' }]
  CompleteReservation,

  @UI.lineItem: [{ position: 55, label: 'Warehouse' }]
  @UI.fieldGroup: [{ qualifier: 'WMGroup', position: 10, label: 'Warehouse Number' }]
  WarehouseNumber,

  @UI.lineItem: [{ position: 60, importance: #HIGH, label: 'TR Number' }]
  @UI.fieldGroup: [{ qualifier: 'WMGroup', position: 20, label: 'Transfer Requirement' }]
  TransferRequirement,

  @UI.lineItem: [{ position: 65, label: 'TO Number' }]
  @UI.fieldGroup: [{ qualifier: 'WMGroup', position: 30, label: 'Transfer Order' }]
  TransferOrder,

  @UI.lineItem: [{ position: 70, label: 'Material Document' }]
  @UI.fieldGroup: [{ qualifier: 'WMGroup', position: 40, label: 'Material Document' }]
  MaterialDocument,

  @UI.fieldGroup: [{ qualifier: 'WMGroup', position: 50, label: 'Doc Year' }]
  MaterialDocYear,

  @UI.lineItem: [
    { position: 80, importance: #HIGH, label: 'Status' },
    { type: #FOR_ACTION, dataAction: 'refreshStatus', label: 'Refresh Status', position: 10 }
  ]
  @UI.identification: [
    { position: 40, label: 'Status' },
    { type: #FOR_ACTION, dataAction: 'refreshStatus', label: 'Refresh Status', position: 10 },
    { type: #FOR_ACTION, dataAction: 'retryStep', label: 'Retry Failed Step', position: 20 }
  ]
  @UI.selectionField: [{ position: 30 }]
  Status,

  @UI.lineItem: [{ position: 85, label: 'Retry Count' }]
  @UI.identification: [{ position: 42, label: 'Retry Count' }]
  RetryCount,

  @UI.lineItem: [{ position: 86, label: 'Failed Step' }]
  @UI.identification: [{ position: 43, label: 'Failed Step' }]
  ErrorStep,

  @UI.lineItem: [{ position: 90, label: 'Error Message' }]
  @UI.identification: [{ position: 50, label: 'Error Message' }]
  ErrorMessage,

  @UI.fieldGroup: [{ qualifier: 'AuditGroup', position: 30, label: 'Log Handle' }]
  LogHandle,

  @UI.fieldGroup: [{ qualifier: 'AuditGroup', position: 40, label: 'External ID' }]
  ExternalId,

  @UI.identification: [{ position: 60, label: 'Created By' }]
  CreatedBy,

  @UI.lineItem: [{ position: 100, label: 'Created On' }]
  @UI.identification: [{ position: 70, label: 'Created On' }]
  CreatedOn,

  ChangedAt,

  _Logs
}
