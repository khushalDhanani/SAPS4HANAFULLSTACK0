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
      id: 'LogsFacet',
      type: #LINEITEM_REFERENCE,
      targetElement: '_Logs',
      label: 'Step-Wise Processing Logs',
      position: 30
    }
  ]

  @UI.lineItem: [{ position: 10, importance: #HIGH, label: 'Reservation No' }]
  @UI.identification: [{ position: 10, label: 'Reservation No' }]
  @UI.selectionField: [{ position: 10 }]
  key ReservationNo,

  @UI.lineItem: [{ position: 20, label: 'Item' }]
  @UI.identification: [{ position: 20, label: 'Item' }]
  key ReservationItem,

  @UI.lineItem: [{ position: 30, importance: #HIGH, label: 'Movement Type' }]
  @UI.identification: [{ position: 30, label: 'Movement Type' }]
  @UI.selectionField: [{ position: 20 }]
  MovementType,

  @UI.lineItem: [{ position: 40, label: 'Warehouse' }]
  @UI.fieldGroup: [{ qualifier: 'WMGroup', position: 10, label: 'Warehouse Number' }]
  WarehouseNumber,

  @UI.lineItem: [{ position: 50, importance: #HIGH, label: 'TR Number' }]
  @UI.fieldGroup: [{ qualifier: 'WMGroup', position: 20, label: 'Transfer Requirement' }]
  TransferRequirement,

  @UI.lineItem: [{ position: 60, label: 'TO Number' }]
  @UI.fieldGroup: [{ qualifier: 'WMGroup', position: 30, label: 'Transfer Order' }]
  TransferOrder,

  @UI.lineItem: [{ position: 70, label: 'Material Document' }]
  @UI.fieldGroup: [{ qualifier: 'WMGroup', position: 40, label: 'Material Document' }]
  MaterialDocument,

  @UI.fieldGroup: [{ qualifier: 'WMGroup', position: 50, label: 'Doc Year' }]
  MaterialDocYear,

  @UI.lineItem: [{ position: 80, importance: #HIGH, label: 'Status' }]
  @UI.identification: [{ position: 40, label: 'Status' }]
  @UI.selectionField: [{ position: 30 }]
  Status,

  @UI.lineItem: [{ position: 90, label: 'Error Message' }]
  @UI.identification: [{ position: 50, label: 'Error Message' }]
  ErrorMessage,

  @UI.identification: [{ position: 60, label: 'Created By' }]
  CreatedBy,

  @UI.lineItem: [{ position: 100, label: 'Created On' }]
  @UI.identification: [{ position: 70, label: 'Created On' }]
  CreatedOn,

  _Logs
}
