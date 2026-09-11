/**
 * Test fixtures for Stock Unit (SU) resolution in Goods Issue.
 * Provides realistic SAP response shapes for unit and integration tests.
 */
module.exports = {
  /**
   * Valid single-batch SU resolution — auto-determination succeeds
   */
  validSingleBatch: {
    SuBarcode: '180000001',
    SuExists: true,
    SuNotFoundReason: '',
    ResolvedType: 'HANDLING_UNIT',
    HuService: '/sap/opu/odata/scwm/SIMPLE_INB_DLV_SRV',
    HuInternalNumber: '005056a5-09b1-1ee0-8f5c-1a2b3c4d5e6f',
    HuExternalId: '180000001',
    DeliveryDocument: '',
    DeliveryDocumentItem: '',
    Material: '1000000355',
    MaterialDesc: 'Sodium Chloride Pure',
    Plant: '1120',
    StorageLocation: 'CS01',
    StorageBin: '',
    CurrentStock: 1200,
    SuStockQty: 1200,
    BaseUnit: 'KG',
    Batches: [{
      Material: '1000000355',
      Plant: '1120',
      Batch: 'BATCH001',
      ExpiryDate: '2027-12-31',
      ManufactDate: '2026-01-15',
      AvailableStock: 16362.153,
      Unit: 'KG',
      StorageBin: '',
      StorageLocation: 'CS01',
      StorageLocationName: 'Raw Material',
      StatusState: 'Success',
      StatusText: 'VALID',
      DaysToExpiry: 478
    }],
    DeterminedBatch: 'BATCH001',
    DeterminedBatchExpiry: '2027-12-31',
    DeterminedBatchStatusState: 'Success',
    DeterminedBatchStatusText: 'VALID',
    DeterminedBatchDaysToExpiry: 478,
    MultipleBatches: false,
    NoBatchAvailable: false,
    ReservationNo: '100001',
    ReservationItem: '0001',
    OrderNo: '1000100',
    MaterialMatch: true,
    PlantMatch: true,
    SLocMatch: true,
    ReservationRemainingQty: 500,
    ReservationRequiredQty: 1000,
    ReservationWithdrawnQty: 500,
    MaxIssueQty: 500,
    Unit: 'KG'
  },

  /**
   * Valid SU but multiple batches found — manual selection required
   */
  validMultipleBatches: {
    SuBarcode: '180000002',
    SuExists: true,
    SuNotFoundReason: '',
    DeliveryDocument: '180000002',
    DeliveryDocumentItem: '000010',
    Material: '1000000400',
    MaterialDesc: 'Citric Acid Monohydrate',
    Plant: '1120',
    StorageLocation: 'CS01',
    StorageBin: '',
    CurrentStock: 8500,
    BaseUnit: 'KG',
    Batches: [
      {
        Batch: 'BATCHX01',
        ExpiryDate: '2027-06-30',
        StatusState: 'Success',
        StatusText: 'VALID',
        DaysToExpiry: 293
      },
      {
        Batch: 'BATCHX02',
        ExpiryDate: '2028-03-15',
        StatusState: 'Success',
        StatusText: 'VALID',
        DaysToExpiry: 551
      }
    ],
    DeterminedBatch: '',
    DeterminedBatchExpiry: null,
    DeterminedBatchStatusState: 'None',
    DeterminedBatchStatusText: 'NO BATCH',
    DeterminedBatchDaysToExpiry: 9999,
    MultipleBatches: true,
    NoBatchAvailable: false,
    ReservationNo: '100002',
    ReservationItem: '0001',
    OrderNo: '1000200',
    MaterialMatch: true,
    PlantMatch: true,
    SLocMatch: true,
    ReservationRemainingQty: 2000,
    ReservationRequiredQty: 2000,
    ReservationWithdrawnQty: 0,
    MaxIssueQty: 2000,
    Unit: 'KG'
  },

  /**
   * Valid SU but no batch available (material not batch-managed)
   */
  validNoBatch: {
    SuBarcode: '180000003',
    SuExists: true,
    SuNotFoundReason: '',
    DeliveryDocument: '180000003',
    DeliveryDocumentItem: '000010',
    Material: '1000000500',
    MaterialDesc: 'Purified Water',
    Plant: '1120',
    StorageLocation: 'CS01',
    StorageBin: '',
    CurrentStock: 50000,
    BaseUnit: 'L',
    Batches: [],
    DeterminedBatch: '',
    DeterminedBatchExpiry: null,
    DeterminedBatchStatusState: 'None',
    DeterminedBatchStatusText: 'NO BATCH',
    DeterminedBatchDaysToExpiry: 9999,
    MultipleBatches: false,
    NoBatchAvailable: true,
    ReservationNo: '100003',
    ReservationItem: '0001',
    OrderNo: '1000300',
    MaterialMatch: true,
    PlantMatch: true,
    SLocMatch: true,
    ReservationRemainingQty: 1000,
    ReservationRequiredQty: 1000,
    ReservationWithdrawnQty: 0,
    MaxIssueQty: 1000,
    Unit: 'L'
  },

  /**
   * Revalidation result: stock and batch OK
   */
  revalidationPassed: {
    Material: '1000000355',
    Plant: '1120',
    StorageLocation: 'CS01',
    Batch: 'BATCH001',
    CurrentStock: 16000,
    BaseUnit: 'KG',
    StockReadSuccess: true,
    StockSufficient: true,
    RequestedQty: 500,
    BatchValid: true,
    BatchStatusState: 'Success',
    BatchStatusText: 'VALID',
    BatchExpiry: '2027-12-31',
    Valid: true,
    Message: 'Stock and batch revalidation passed.'
  },

  /**
   * /SCWM/SIMPLE_INB_DLV_SRV $metadata excerpt mirroring the LIVE service on
   * client 220 (probed 2026-09-11): HUHead is keyed by GUIDs, identified by
   * HandlingUnitID (HUIDENT) and scoped by WarehouseNumber; HUItem exposes
   * Product / Batch / ItemQuantity / ItemQuantityUnit and NO plant, storage
   * location or storage bin. VL_SH_xSCWMxSH_LGNUM is the warehouse value help.
   */
  scwmHuMetadataXml: `<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx" Version="1.0">
  <edmx:DataServices m:DataServiceVersion="2.0" xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata">
    <Schema Namespace="SIMPLE_INB_DLV_SRV" xmlns="http://schemas.microsoft.com/ado/2008/09/edm" xmlns:sap="http://www.sap.com/Protocols/SAPData">
      <EntityType Name="HUHead">
        <Key><PropertyRef Name="HandlingUnitUUID"/><PropertyRef Name="InboundDeliveryUUID"/><PropertyRef Name="InboundDeliveryItemUUID"/></Key>
        <Property Name="HandlingUnitUUID" Type="Edm.Guid" Nullable="false" sap:label="HU GUID" sap:filterable="false"/>
        <Property Name="InboundDeliveryUUID" Type="Edm.Guid" Nullable="false" sap:label="Document ID" sap:filterable="false"/>
        <Property Name="InboundDeliveryItemUUID" Type="Edm.Guid" Nullable="false" sap:label="Item ID" sap:filterable="false"/>
        <Property Name="HandlingUnitID" Type="Edm.String" MaxLength="20" sap:display-format="UpperCase" sap:label="Handling Unit" sap:filterable="false"/>
        <Property Name="PackageMaterial" Type="Edm.String" MaxLength="40" sap:label="Packaging Material" sap:filterable="false"/>
        <Property Name="HandlingUnitType" Type="Edm.String" MaxLength="4" sap:label="Handling Unit Type" sap:filterable="false"/>
        <Property Name="HandlingUnitTopID" Type="Edm.String" MaxLength="20" sap:label="Top Handling Unit" sap:filterable="false"/>
        <Property Name="ItemQuantity" Type="Edm.Decimal" Precision="31" Scale="14" sap:label="Packed Quantity" sap:filterable="false"/>
        <Property Name="ItemQuantityUnit" Type="Edm.String" MaxLength="3" sap:label="Unit of Measure" sap:filterable="false"/>
        <Property Name="NumberOfHUItems" Type="Edm.Int32" sap:label="No.of HUs" sap:filterable="false"/>
        <Property Name="WarehouseNumber" Type="Edm.String" MaxLength="4" sap:label="Warehouse Number" sap:filterable="false"/>
        <Property Name="EWMHandlingUnitExternalUUID" Type="Edm.Guid" sap:label="External HU GUID" sap:filterable="false"/>
        <NavigationProperty Name="Items" Relationship="SIMPLE_INB_DLV_SRV.HUHeadToHUItems" FromRole="FromRole_HUHeadToHUItems" ToRole="ToRole_HUHeadToHUItems"/>
      </EntityType>
      <EntityType Name="HUItem">
        <Key><PropertyRef Name="HandlingUnitUUID"/><PropertyRef Name="HandlingUnitParentUUID"/><PropertyRef Name="InboundDeliveryUUID"/><PropertyRef Name="InboundDeliveryItemUUID"/></Key>
        <Property Name="HandlingUnitUUID" Type="Edm.Guid" Nullable="false" sap:label="HU GUID" sap:filterable="false"/>
        <Property Name="HandlingUnitParentUUID" Type="Edm.Guid" Nullable="false" sap:label="HU GUID" sap:filterable="false"/>
        <Property Name="InboundDeliveryUUID" Type="Edm.Guid" Nullable="false" sap:label="Document ID" sap:filterable="false"/>
        <Property Name="InboundDeliveryItemUUID" Type="Edm.Guid" Nullable="false" sap:label="Item ID" sap:filterable="false"/>
        <Property Name="HandlingUnitID" Type="Edm.String" MaxLength="20" sap:display-format="UpperCase" sap:label="Handling Unit" sap:filterable="false"/>
        <Property Name="Product" Type="Edm.String" MaxLength="40" sap:label="Product" sap:filterable="false"/>
        <Property Name="ProductName" Type="Edm.String" MaxLength="40" sap:label="Description" sap:filterable="false"/>
        <Property Name="Batch" Type="Edm.String" MaxLength="10" sap:label="Batch" sap:filterable="false"/>
        <Property Name="ItemQuantity" Type="Edm.Decimal" Precision="31" Scale="14" sap:label="Packed Quantity" sap:filterable="false"/>
        <Property Name="ItemQuantityUnit" Type="Edm.String" MaxLength="3" sap:label="Unit of Measure" sap:filterable="false"/>
        <Property Name="DocNoPO" Type="Edm.String" MaxLength="10" sap:label="Purchase Order" sap:filterable="false"/>
      </EntityType>
      <EntityType Name="VL_SH_xSCWMxSH_LGNUM">
        <Key><PropertyRef Name="LGNUM"/></Key>
        <Property Name="LGNUM" Type="Edm.String" Nullable="false" MaxLength="4" sap:label="Warehouse Number"/>
        <Property Name="LNUMT" Type="Edm.String" MaxLength="40" sap:label="Description"/>
      </EntityType>
      <EntityType Name="DLVHead">
        <Key><PropertyRef Name="InboundDeliveryUUID"/></Key>
        <Property Name="InboundDeliveryUUID" Type="Edm.Guid" Nullable="false"/>
        <Property Name="InboundDelivery" Type="Edm.String" MaxLength="35"/>
        <Property Name="WarehouseNumber" Type="Edm.String" MaxLength="4"/>
        <Property Name="NumberOfHU" Type="Edm.Int32"/>
      </EntityType>
      <Association Name="HUHeadToHUItems">
        <End Type="SIMPLE_INB_DLV_SRV.HUHead" Multiplicity="1" Role="FromRole_HUHeadToHUItems"/>
        <End Type="SIMPLE_INB_DLV_SRV.HUItem" Multiplicity="*" Role="ToRole_HUHeadToHUItems"/>
      </Association>
      <EntityContainer Name="SIMPLE_INB_DLV_SRV_Entities" m:IsDefaultEntityContainer="true">
        <EntitySet Name="VL_SH_xSCWMxSH_LGNUM" EntityType="SIMPLE_INB_DLV_SRV.VL_SH_xSCWMxSH_LGNUM" sap:creatable="false" sap:updatable="false" sap:deletable="false" sap:content-version="1" sap:countable="false"/>
        <EntitySet Name="DLVHeadSet" EntityType="SIMPLE_INB_DLV_SRV.DLVHead" sap:requires-filter="true" sap:content-version="1"/>
        <EntitySet Name="HUHeadSet" EntityType="SIMPLE_INB_DLV_SRV.HUHead" sap:requires-filter="true" sap:content-version="1"/>
        <EntitySet Name="HUItemSet" EntityType="SIMPLE_INB_DLV_SRV.HUItem" sap:requires-filter="true" sap:content-version="1"/>
        <AssociationSet Name="HUHeadToHUItemsSet" Association="SIMPLE_INB_DLV_SRV.HUHeadToHUItems">
          <End EntitySet="HUHeadSet" Role="FromRole_HUHeadToHUItems"/>
          <End EntitySet="HUItemSet" Role="ToRole_HUHeadToHUItems"/>
        </AssociationSet>
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>`,

  /**
   * /SCWM/PACK_OUTBDLV_SRV $metadata excerpt (live shape): HUSet is keyed by the
   * EWM work center (packing station). Live probe without a work center returns
   * /SCWM/UI_PACKING/039 "Work center does not exist in warehouse number 1",
   * so discovery must NOT pick it as the HU lookup entity set.
   */
  scwmPackMetadataXml: `<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx" Version="1.0">
  <edmx:DataServices m:DataServiceVersion="2.0" xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata">
    <Schema Namespace="pack_outbdlv_srv" xmlns="http://schemas.microsoft.com/ado/2008/09/edm" xmlns:sap="http://www.sap.com/Protocols/SAPData">
      <EntityType Name="HU">
        <Key><PropertyRef Name="HuId"/><PropertyRef Name="EWMStorageBin"/><PropertyRef Name="EWMWarehouse"/><PropertyRef Name="EWMWorkCenter"/><PropertyRef Name="Type"/></Key>
        <Property Name="HuId" Type="Edm.String" Nullable="false" MaxLength="40" sap:label="Handling Unit" sap:filterable="false"/>
        <Property Name="EWMStorageBin" Type="Edm.String" Nullable="false" MaxLength="18" sap:label="Bin" sap:filterable="false"/>
        <Property Name="EWMWarehouse" Type="Edm.String" Nullable="false" MaxLength="4" sap:label="Warehouse No." sap:filterable="false"/>
        <Property Name="EWMWorkCenter" Type="Edm.String" Nullable="false" MaxLength="4" sap:label="Work Center" sap:filterable="false"/>
        <Property Name="Type" Type="Edm.String" Nullable="false" MaxLength="1" sap:label="Indicate Bin or HU" sap:filterable="false"/>
        <Property Name="PackagingMaterial" Type="Edm.String" MaxLength="40" sap:label="Product" sap:filterable="false"/>
        <Property Name="MsgVar" Type="Edm.String" MaxLength="220" sap:label="Message Text" sap:filterable="false"/>
      </EntityType>
      <EntityType Name="EWMWarehouse_Type">
        <Key><PropertyRef Name="EWMWarehouse"/></Key>
        <Property Name="EWMWarehouse" Type="Edm.String" Nullable="false" MaxLength="4" sap:label="Warehouse Number"/>
        <Property Name="MsgSuccess" Type="Edm.Boolean" sap:filterable="false"/>
        <Property Name="EWMWarehouse_Text" Type="Edm.String" MaxLength="40" sap:label="Description"/>
      </EntityType>
      <EntityContainer Name="pack_outbdlv_srv_Entities" m:IsDefaultEntityContainer="true">
        <EntitySet Name="HUSet" EntityType="pack_outbdlv_srv.HU" sap:updatable="false" sap:pageable="false" sap:content-version="1"/>
        <EntitySet Name="EWMWarehouse_Set" EntityType="pack_outbdlv_srv.EWMWarehouse_Type" sap:content-version="1"/>
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>`,

  /**
   * /SCWM/PICKLIST_PAPER_SRV $metadata excerpt (live shape): the EWM HU search
   * help VL_SH_xSCWMxSH_HU (LGNUM + HUIDENT), the HU contents value help
   * VL_SH_xSCWMxSH_TO_CONF_HU_COMP (VLENR, VLPLA bin, MATID product GUID, QUAN,
   * MEINS - no batch), the product-base value help (MATID → MATNR) and the
   * EWMWarehouseVH_Set warehouse value help.
   */
  scwmPicklistMetadataXml: `<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx" Version="1.0">
  <edmx:DataServices m:DataServiceVersion="2.0" xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata">
    <Schema Namespace="picklist_paper_srv" xmlns="http://schemas.microsoft.com/ado/2008/09/edm" xmlns:sap="http://www.sap.com/Protocols/SAPData">
      <EntityType Name="VL_SH_xSCWMxSH_HU">
        <Key><PropertyRef Name="LGNUM"/><PropertyRef Name="HUIDENT"/><PropertyRef Name="PMAT_GUID"/><PropertyRef Name="PMTYP"/><PropertyRef Name="LETYP"/></Key>
        <Property Name="LGNUM" Type="Edm.String" Nullable="false" MaxLength="4" sap:label="Warehouse No."/>
        <Property Name="HUIDENT" Type="Edm.String" Nullable="false" MaxLength="20" sap:label="Handling Unit"/>
        <Property Name="PMAT_GUID" Type="Edm.Guid" Nullable="false" sap:label="Product"/>
        <Property Name="PMTYP" Type="Edm.String" Nullable="false" MaxLength="4" sap:label="Pkging Matl Ty."/>
        <Property Name="LETYP" Type="Edm.String" Nullable="false" MaxLength="4" sap:label="HU Type"/>
      </EntityType>
      <EntityType Name="VL_SH_xSCWMxSH_TO_CONF_HU_COMP">
        <Key><PropertyRef Name="LGNUM"/><PropertyRef Name="VLPLA"/><PropertyRef Name="MATID"/><PropertyRef Name="VLENR"/></Key>
        <Property Name="LGNUM" Type="Edm.String" Nullable="false" MaxLength="4" sap:label="Warehouse No."/>
        <Property Name="VLPLA" Type="Edm.String" Nullable="false" MaxLength="18" sap:label="Source Bin"/>
        <Property Name="MATID" Type="Edm.Guid" Nullable="false" sap:label="Product"/>
        <Property Name="VLENR" Type="Edm.String" Nullable="false" MaxLength="20" sap:label="Source HU"/>
        <Property Name="QUAN" Type="Edm.Decimal" Precision="31" Scale="14" sap:label="Packed Quantity" sap:filterable="false"/>
        <Property Name="MEINS" Type="Edm.String" MaxLength="3" sap:label="Base Unit" sap:filterable="false"/>
      </EntityType>
      <EntityType Name="VL_SH_xSCMBxMDL_PROD_BASE">
        <Key><PropertyRef Name="MATID"/></Key>
        <Property Name="MATID" Type="Edm.Guid" Nullable="false" sap:label="Product"/>
        <Property Name="MATNR" Type="Edm.String" MaxLength="40" sap:label="Product"/>
        <Property Name="MAKTX" Type="Edm.String" MaxLength="40" sap:label="Description"/>
      </EntityType>
      <EntityType Name="SourceHUVH">
        <Key><PropertyRef Name="EWMWarehouse"/><PropertyRef Name="SourceStorageBin"/><PropertyRef Name="SourceHandlingUnit"/><PropertyRef Name="Product"/></Key>
        <Property Name="EWMWarehouse" Type="Edm.String" Nullable="false" MaxLength="4" sap:label="Warehouse No."/>
        <Property Name="SourceStorageBin" Type="Edm.String" Nullable="false" MaxLength="18" sap:label="Bin"/>
        <Property Name="SourceHandlingUnit" Type="Edm.String" Nullable="false" MaxLength="255" sap:label="HU"/>
        <Property Name="Product" Type="Edm.String" Nullable="false" MaxLength="40" sap:label="Product"/>
        <Property Name="NISTM" Type="Edm.Decimal" Precision="31" Scale="14" sap:label="Packed Quantity" sap:filterable="false"/>
        <Property Name="BaseUnit" Type="Edm.String" MaxLength="3" sap:label="Base Unit" sap:filterable="false"/>
      </EntityType>
      <EntityType Name="EWMWarehouseVH_Type">
        <Key><PropertyRef Name="EWMWarehouse"/></Key>
        <Property Name="EWMWarehouse" Type="Edm.String" Nullable="false" MaxLength="4" sap:label="Warehouse Number"/>
        <Property Name="EWMWarehouse_Text" Type="Edm.String" MaxLength="40" sap:label="Description"/>
      </EntityType>
      <EntityType Name="HUIDENT">
        <Key><PropertyRef Name="Lgnum"/><PropertyRef Name="Huident"/></Key>
        <Property Name="Lgnum" Type="Edm.String" Nullable="false" MaxLength="4" sap:label="Warehouse No." sap:filterable="false"/>
        <Property Name="Huident" Type="Edm.String" Nullable="false" MaxLength="20" sap:label="Handling Unit" sap:filterable="false"/>
      </EntityType>
      <EntityContainer Name="picklist_paper_srv_Entities" m:IsDefaultEntityContainer="true">
        <EntitySet Name="VL_SH_xSCWMxSH_HU" EntityType="picklist_paper_srv.VL_SH_xSCWMxSH_HU" sap:creatable="false" sap:updatable="false" sap:deletable="false" sap:content-version="1" sap:countable="false"/>
        <EntitySet Name="VL_SH_xSCWMxSH_TO_CONF_HU_COMP" EntityType="picklist_paper_srv.VL_SH_xSCWMxSH_TO_CONF_HU_COMP" sap:creatable="false" sap:updatable="false" sap:deletable="false" sap:content-version="1" sap:countable="false"/>
        <EntitySet Name="VL_SH_xSCMBxMDL_PROD_BASE" EntityType="picklist_paper_srv.VL_SH_xSCMBxMDL_PROD_BASE" sap:creatable="false" sap:updatable="false" sap:deletable="false" sap:content-version="1" sap:countable="false"/>
        <EntitySet Name="SourceHUVH" EntityType="picklist_paper_srv.SourceHUVH" sap:creatable="false" sap:updatable="false" sap:deletable="false" sap:pageable="false" sap:content-version="1"/>
        <EntitySet Name="EWMWarehouseVH_Set" EntityType="picklist_paper_srv.EWMWarehouseVH_Type" sap:content-version="1"/>
        <EntitySet Name="HUIDENTCollection" EntityType="picklist_paper_srv.HUIDENT" sap:content-version="1"/>
      </EntityContainer>
    </Schema>
  </edmx:DataServices>
</edmx:Edmx>`,

  /**
   * EWM warehouse value-help rows (VL_SH_xSCWMxSH_LGNUM / EWMWarehouseVH_Set).
   * Client 220 live: exactly one EWM warehouse, 0001 "Central Warehouse".
   */
  warehouseRows: [{ LGNUM: '0001', LNUMT: 'Central Warehouse' }],
  warehouseRowsMultiple: [
    { LGNUM: '0001', LNUMT: 'Central Warehouse' },
    { LGNUM: '0002', LNUMT: 'Second Warehouse' }
  ],
  ewmWarehouseVhRows: [{ EWMWarehouse: '0001', EWMWarehouse_Text: 'Central Warehouse' }],
  ewmWarehouseVhRowsMultiple: [
    { EWMWarehouse: '0001', EWMWarehouse_Text: 'Central Warehouse' },
    { EWMWarehouse: '0002', EWMWarehouse_Text: 'Second Warehouse' }
  ],

  /**
   * Error shape produced by GoodsIssueAdapter._get() when SAP EWM rejects the
   * warehouse context for the user (live: /SCWM/ODATA_COMMON/008
   * 'Warehouse number "0001" is incorrect.' on SIMPLE_INB_DLV_SRV).
   */
  scwmWarehouseContextError: () => Object.assign(
    new Error('Warehouse number "0001" is incorrect.'),
    { status: 400, code: '/SCWM/ODATA_COMMON/008' }
  ),

  /**
   * SCWM HUHeadSet rows returned for a warehouse-scoped lookup.
   */
  huHeaderRows: [
    {
      HandlingUnitUUID: '005056a5-09b1-1ee0-8f5c-1a2b3c4d5e6f',
      InboundDeliveryUUID: '005056a5-09b1-1ee0-8f5c-1a2b3c4d0001',
      InboundDeliveryItemUUID: '005056a5-09b1-1ee0-8f5c-1a2b3c4d0002',
      HandlingUnitID: '180000001',
      PackageMaterial: 'PALLET-EU',
      HandlingUnitType: 'E1',
      HandlingUnitTopID: '180000001',
      ItemQuantity: '1200.000',
      ItemQuantityUnit: 'KG',
      NumberOfHUItems: 1,
      WarehouseNumber: '0001'
    }
  ],

  /**
   * SCWM HUItemSet rows for a warehouse-scoped lookup — single batch.
   */
  huItemRows: [
    {
      HandlingUnitUUID: '005056a5-09b1-1ee0-8f5c-1a2b3c4d5e70',
      HandlingUnitParentUUID: '005056a5-09b1-1ee0-8f5c-1a2b3c4d5e6f',
      InboundDeliveryUUID: '005056a5-09b1-1ee0-8f5c-1a2b3c4d0001',
      InboundDeliveryItemUUID: '005056a5-09b1-1ee0-8f5c-1a2b3c4d0002',
      HandlingUnitID: '180000001',
      Product: '1000000355',
      ProductName: 'Sodium Chloride Pure',
      Batch: 'BATCH001',
      ItemQuantity: '1200.000',
      ItemQuantityUnit: 'KG',
      DocNoPO: '4500000123'
    }
  ],

  /**
   * HU content rows with multiple batches inside one SU — manual selection needed.
   */
  huItemRowsMultipleBatches: [
    {
      HandlingUnitUUID: '005056a5-09b1-1ee0-8f5c-1a2b3c4d5e70', HandlingUnitParentUUID: '005056a5-09b1-1ee0-8f5c-1a2b3c4d5e6f', HandlingUnitID: '180000001', Product: '1000000355', ProductName: 'Sodium Chloride Pure', Batch: 'BATCH001', ItemQuantity: '600.000', ItemQuantityUnit: 'KG'
    },
    {
      HandlingUnitUUID: '005056a5-09b1-1ee0-8f5c-1a2b3c4d5e71', HandlingUnitParentUUID: '005056a5-09b1-1ee0-8f5c-1a2b3c4d5e6f', HandlingUnitID: '180000001', Product: '1000000355', ProductName: 'Sodium Chloride Pure', Batch: 'BATCH002', ItemQuantity: '600.000', ItemQuantityUnit: 'KG'
    }
  ],

  /**
   * HU content rows whose batch is NOT a usable batch for the reservation.
   */
  huItemRowsBadBatch: [
    {
      HandlingUnitUUID: '005056a5-09b1-1ee0-8f5c-1a2b3c4d5e70', HandlingUnitParentUUID: '005056a5-09b1-1ee0-8f5c-1a2b3c4d5e6f', HandlingUnitID: '180000001', Product: '1000000355', ProductName: 'Sodium Chloride Pure', Batch: 'BADBATCH99', ItemQuantity: '1200.000', ItemQuantityUnit: 'KG'
    }
  ],

  /**
   * HU content rows whose product differs from the reservation material.
   */
  huItemRowsWrongMaterial: [
    {
      HandlingUnitUUID: '005056a5-09b1-1ee0-8f5c-1a2b3c4d5e70', HandlingUnitParentUUID: '005056a5-09b1-1ee0-8f5c-1a2b3c4d5e6f', HandlingUnitID: '180000001', Product: '1000000999', ProductName: 'Other Product', Batch: 'BATCH001', ItemQuantity: '1200.000', ItemQuantityUnit: 'KG'
    }
  ],

  /**
   * PICKLIST_PAPER_SRV rows: EWM HU search help hit, HU contents (product as
   * GUID, bin, quantity - no batch) and the product-base value help row that
   * resolves the GUID to the product number.
   */
  pickHuRows: [
    { LGNUM: '0001', HUIDENT: '180000001', PMAT_GUID: '005056a5-09b1-1ee0-8f5c-1a2b3c4dpm01', PMTYP: 'PALL', LETYP: 'E1' }
  ],
  pickHuContentRows: [
    { LGNUM: '0001', VLPLA: 'A1-01-02', MATID: '005056a5-09b1-1ee0-8f5c-1a2b3c4dmt01', VLENR: '180000001', QUAN: '1200.000', MEINS: 'KG' }
  ],
  productBaseRows: [
    { MATID: '005056a5-09b1-1ee0-8f5c-1a2b3c4dmt01', MATNR: '1000000355', MAKTX: 'Sodium Chloride Pure' }
  ],

  /**
   * Reservation item (UI_RESERVATION_ITM_MNG_V2) matching the HU content material.
   */
  reservationItemRow: {
    Reservation: '100001',
    ReservationItem: '00001',
    Product: '1000000355',
    Plant: '1120',
    StorageLocation: 'CS01',
    ProductName: 'Sodium Chloride Pure',
    BaseUnit: 'KG',
    ResvnItmRequiredQtyInBaseUnit: '1000',
    ResvnItmWithdrawnQtyInBaseUnit: '500',
    ReservationItemIsFinallyIssued: false,
    ReservationItmIsMarkedForDeltn: false
  },

  /**
   * MaterialStorLocHelps row for the reservation material / plant / SLoc.
   */
  stockRow: [
    {
      Material: '1000000355',
      Plant: '1120',
      StorageLocation: 'CS01',
      CurrentStock: '16362.153',
      BaseUnit: 'KG'
    }
  ],

  /**
   * Revalidation result: stock decreased below requested qty
   */
  revalidationStockChanged: {
    Material: '1000000355',
    Plant: '1120',
    StorageLocation: 'CS01',
    Batch: 'BATCH001',
    CurrentStock: 100,
    BaseUnit: 'KG',
    StockReadSuccess: true,
    StockSufficient: false,
    RequestedQty: 500,
    BatchValid: true,
    BatchStatusState: 'Success',
    BatchStatusText: 'VALID',
    BatchExpiry: '2027-12-31',
    Valid: false,
    Message: 'Stock changed: current SAP stock (100 KG) is less than requested quantity (500 KG). Posting blocked.'
  },

  /**
   * Revalidation result: batch expired since scan
   */
  revalidationBatchExpired: {
    Material: '1000000355',
    Plant: '1120',
    StorageLocation: 'CS01',
    Batch: 'BATCH001',
    CurrentStock: 16000,
    BaseUnit: 'KG',
    StockReadSuccess: true,
    StockSufficient: true,
    RequestedQty: 500,
    BatchValid: false,
    BatchStatusState: 'Error',
    BatchStatusText: 'Batch is invalid or expired',
    BatchExpiry: '2026-09-01',
    Valid: false,
    Message: 'Batch BATCH001 is no longer valid: Batch is invalid or expired. Posting blocked.'
  }
};
