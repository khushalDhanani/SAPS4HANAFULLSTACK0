/* checksum : 1381ef8f9d3ee640294c746c449c73ae */
@cds.external : true
@m.IsDefaultEntityContainer : 'true'
@sap.message.scope.supported : 'true'
@sap.supported.formats : 'atom json xlsx pdf'
service C_PURCHASEORDER_FS_SRV {
  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.content.version : '1'
  @sap.label : 'Brazil CFOP Category'
  entity C_BR_CFOPCategoryValHelp {
    @sap.display.format : 'UpperCase'
    @sap.label : 'Material CFOP Category'
    key BR_CFOPCategory : String(2) not null;
    @sap.label : 'Description'
    @sap.quickinfo : 'CFOP Category'
    BR_CFOPCategoryDesc : String(60);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.content.version : '1'
  @sap.label : 'Brazil Material Origin'
  entity C_BR_MaterialOriginValHelp {
    @sap.display.format : 'UpperCase'
    @sap.label : 'Material Origin'
    key BR_MaterialOrigin : String(1) not null;
    @sap.label : 'Description'
    @sap.quickinfo : 'Material Origin Description'
    BR_MaterialOriginDesc : String(60);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.content.version : '1'
  @sap.label : 'Brazil Material Usage'
  entity C_BR_MaterialUsageValHelp {
    @sap.display.format : 'UpperCase'
    @sap.label : 'Material Usage'
    key BR_MaterialUsage : String(1) not null;
    @sap.label : 'Description'
    @sap.quickinfo : 'Material Usage Description'
    BR_MaterialUsageDesc : String(60);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.content.version : '1'
  @sap.label : 'Brazil NCM'
  entity C_BR_NCMValHelp {
    @sap.display.format : 'UpperCase'
    @sap.label : 'NCM Code'
    key BR_NCM : String(16) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Country/Region Key'
    CountryCode : String(3);
    @sap.label : 'Description'
    @sap.quickinfo : 'Description of Rule'
    BR_NCMDesc1 : String(60);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.content.version : '1'
  @sap.label : 'Value help for Control Code for Consumption taxes'
  entity C_IN_GSTControlCodeValueHelp {
    @sap.display.format : 'UpperCase'
    @sap.text : 'ConsumptionTaxCntrlCodeDesc'
    @sap.label : 'Control Code'
    @sap.quickinfo : 'Control code for consumption taxes in foreign trade'
    key ConsumptionTaxCtrlCode : String(16) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Country/Region Key'
    CountryCode : String(3);
    @sap.label : 'Description'
    @sap.quickinfo : 'Description of Rule'
    ConsumptionTaxCntrlCodeDesc : String(60);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Company Code Value Help'
  @sap.value.list : 'true'
  entity C_MM_CompanyCodeValueHelp {
    @sap.display.format : 'UpperCase'
    @sap.text : 'CompanyCodeName'
    @sap.label : 'Company Code'
    key CompanyCode : String(4) not null;
    @sap.label : 'Company Name'
    @sap.quickinfo : 'Name of Company Code or Company'
    CompanyCodeName : String(25);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Country/Region Value Help'
  entity C_MM_CountryValueHelp {
    @sap.display.format : 'UpperCase'
    @sap.text : 'CountryName'
    @sap.label : 'Country/Region Key'
    key Country : String(3) not null;
    @sap.label : 'Country/Region Name'
    CountryName : String(50);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Reporting Currency'
    @sap.semantics : 'currency-code'
    CountryCurrency : String(5);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Procedure'
    @sap.quickinfo : 'Procedure (Pricing, Output Control, Acct. Det., Costing,...)'
    TaxCalculationProcedure : String(6);
    @sap.display.format : 'UpperCase'
    @sap.label : 'ISO Code'
    @sap.quickinfo : 'ISO Country/Region Code 3 Characters'
    CountryThreeLetterISOCode : String(3);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Incoterm Value Help'
  @sap.value.list : 'true'
  entity C_MM_IncotermValueHelp {
    @sap.display.format : 'UpperCase'
    @sap.text : 'IncotermsClassificationName'
    @sap.label : 'Incoterms'
    @sap.quickinfo : 'Incoterms (Part 1)'
    key IncotermsClassification : String(3) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Incoterms Version'
    key IncotermsVersion : String(4) not null;
    @sap.label : 'Incoterms Classification Description'
    IncotermsClassificationName : String(30);
    @sap.label : 'Location Mandatory'
    @sap.quickinfo : 'Location is mandatory'
    LocationIsMandatory : Boolean;
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Material Group Value Help'
  @sap.value.list : 'true'
  entity C_MM_MaterialGroupValueHelp {
    @sap.display.format : 'UpperCase'
    @sap.text : 'MaterialGroupName'
    @sap.label : 'Material Group'
    @sap.quickinfo : 'Product Group'
    key MaterialGroup : String(9) not null;
    @sap.label : 'Material Group Text'
    @sap.quickinfo : 'Description of the Material Group'
    MaterialGroupText : String(60);
    @sap.label : 'Material Group Description'
    @sap.quickinfo : 'Product Group Description'
    MaterialGroupName : String(20);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Material Value Help'
  @sap.value.list : 'true'
  entity C_MM_MaterialValueHelp {
    @sap.display.format : 'UpperCase'
    @sap.text : 'MaterialName'
    @sap.label : 'Material'
    @sap.quickinfo : 'Material Number'
    @sap.value.list : 'standard'
    key Material : String(40) not null;
    @sap.display.format : 'UpperCase'
    @sap.text : 'to_Plant/PlantName'
    @sap.label : 'Plant'
    @sap.value.list : 'standard'
    key Plant : String(4) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'MaterialExternal'
    @sap.quickinfo : 'External Representation of Material Number'
    ProductExternalID : String(40);
    @sap.label : 'Material Description'
    MaterialName : String(40);
    @sap.label : 'Plant Name'
    PlantName : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Product Group'
    MaterialGroup : String(9);
    @sap.label : 'Product Group Desc.'
    @sap.quickinfo : 'Product Group Description'
    MaterialGroupName : String(20);
    @sap.display.format : 'UpperCase'
    @sap.text : 'to_ProductType/ProductType_Text'
    @sap.label : 'Product Type'
    @sap.value.list : 'standard'
    MaterialType : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Authorization Group'
    AuthorizationGroup : String(4);
    @sap.label : 'Material Type Desc.'
    @sap.quickinfo : 'Description of Material Type'
    MaterialTypeName : String(25);
    @sap.label : 'Base Unit of Measure'
    @sap.semantics : 'unit-of-measure'
    MaterialBaseUnit : String(3);
    @sap.display.format : 'UpperCase'
    @sap.text : 'ProductTypeName'
    @sap.label : 'Product Type Group'
    ProductTypeCode : String(2);
    @sap.label : 'Product Type Desc.'
    @sap.quickinfo : 'Product Type Group Description'
    ProductTypeName : String(40);
    to_BaseUnit : Association to I_UnitOfMeasure {  };
    to_Material : Association to I_Material {  };
    to_MaterialGroup : Association to I_MaterialGroup {  };
    to_MaterialType : Association to I_MaterialType {  };
    to_Plant : Association to I_Plant {  };
    to_ProductType : Association to I_Producttype {  };
    to_UnitOfMeasure : Association to I_UnitOfMeasure {  };
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Plant Value Help'
  entity C_MM_PlantValueHelp {
    @sap.display.format : 'UpperCase'
    @sap.text : 'PlantName'
    @sap.label : 'Plant'
    key Plant : String(4) not null;
    @sap.display.format : 'UpperCase'
    @sap.text : 'PurchasingOrganizationName'
    @sap.label : 'Purchasing Organization'
    key PurchasingOrganization : String(4) not null;
    @sap.label : 'Plant Name'
    PlantName : String(30);
    @sap.label : 'Purchasing Organization Name'
    PurchasingOrganizationName : String(20);
    @sap.label : 'City'
    CityName : String(40);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Postal Code'
    @sap.quickinfo : 'City postal code'
    PostalCode : String(10);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Product Type Value Help'
  entity C_MM_ProductTypeValueHelp {
    @sap.display.format : 'UpperCase'
    @sap.text : 'ProductTypeName'
    @sap.label : 'Product Type Group'
    key ProductType : String(2) not null;
    @sap.label : 'Description'
    @sap.quickinfo : 'Product Type Group Description'
    ProductTypeName : String(40);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Region Value Help'
  entity C_MM_RegionValueHelp {
    @sap.display.format : 'UpperCase'
    @sap.text : 'Country_Text'
    @sap.label : 'Country/Region Key'
    key Country : String(3) not null;
    @sap.display.format : 'UpperCase'
    @sap.text : 'RegionName'
    @sap.label : 'Region'
    @sap.quickinfo : 'Region (State, Province, County)'
    key Region : String(3) not null;
    @sap.label : 'Country/Region Name'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    Country_Text : String(50);
    @sap.label : 'Description'
    RegionName : String(20);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Service Performer Value Help'
  entity C_MM_ServicePerformerValueHelp {
    @sap.display.format : 'UpperCase'
    @sap.text : 'ServicePerformerName'
    @sap.label : 'Service Performer ID'
    @sap.quickinfo : 'Business Partner Number'
    key ServicePerformer : String(10) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Supplier ID'
    @sap.quickinfo : 'Account Number of Supplier'
    key Supplier : String(10) not null;
    @sap.label : 'Supplier Name'
    @sap.quickinfo : 'Name'
    SupplierName : String(35);
    @sap.label : 'Performer Full Name'
    @sap.quickinfo : 'Name of Business Partner'
    ServicePerformerName : String(81);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Authorization Group'
    AuthorizationGroup : String(4);
    @sap.label : 'Performer First Name'
    @sap.quickinfo : 'First Name of Business Partner (Person)'
    FirstName : String(40);
    @sap.label : 'Performer Last Name'
    @sap.quickinfo : 'Last Name of Business Partner (Person)'
    LastName : String(40);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Storage Location Value Help'
  @sap.value.list : 'true'
  entity C_MM_StorLocValueHelp {
    @sap.display.format : 'UpperCase'
    @sap.text : 'StorageLocationName'
    @sap.label : 'Storage Location'
    key StorageLocation : String(4) not null;
    @sap.display.format : 'UpperCase'
    @sap.text : 'PlantName'
    @sap.label : 'Plant'
    key Plant : String(4) not null;
    @sap.label : 'Storage Loc. Name'
    @sap.quickinfo : 'Storage Location Name'
    StorageLocationName : String(16);
    @sap.label : 'Plant Name'
    PlantName : String(30);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Supplier'
  @sap.value.list : 'true'
  entity C_MM_SupplierValueHelp {
    @sap.display.format : 'UpperCase'
    @sap.text : 'SupplierName'
    @sap.label : 'Supplier'
    @sap.quickinfo : 'Account Number of Supplier'
    key Supplier : String(10) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Company Code'
    @sap.value.list : 'standard'
    key CompanyCode : String(4) not null;
    @sap.label : 'Name of Supplier'
    SupplierName : String(80);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Country/Region Key'
    Country : String(3);
    @sap.label : 'City'
    CityName : String(40);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Postal Code'
    @sap.quickinfo : 'City postal code'
    PostalCode : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Region'
    @sap.quickinfo : 'Region (State, Province, County)'
    Region : String(3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Search Term'
    @sap.quickinfo : 'Sort field'
    SortField : String(10);
    @sap.label : 'First Name'
    @sap.quickinfo : 'First Name of Business Partner (Person)'
    FirstName : String(40);
    @sap.label : 'Last Name'
    @sap.quickinfo : 'Last Name of Business Partner (Person)'
    LastName : String(40);
    @sap.label : 'Organization Name 1'
    @sap.quickinfo : 'Name 1 of organization'
    OrganizationBPName1 : String(40);
    @sap.label : 'Organization Name 2'
    @sap.quickinfo : 'Name 2 of organization'
    OrganizationBPName2 : String(40);
    @sap.label : 'Organization Name 3'
    @sap.quickinfo : 'Name 3 of organization'
    OrganizationBPName3 : String(40);
    @sap.label : 'Organization Name 4'
    @sap.quickinfo : 'Name 4 of organization'
    OrganizationBPName4 : String(40);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Authorization'
    @sap.quickinfo : 'Authorization Group'
    AuthorizationGroup : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Account Group'
    @sap.quickinfo : 'Vendor account group'
    SupplierAccountGroup : String(4);
    to_BusinessPartnerSuplrCo : Association to many I_BusinessPartnerSuplrCo {  };
    to_CountryText : Association to many I_CountryText {  };
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Tax Code Value Help'
  @sap.value.list : 'true'
  entity C_MM_TaxCodeValueHelp {
    @sap.display.format : 'UpperCase'
    @sap.text : 'TaxCodeName'
    @sap.label : 'Tax Code'
    @sap.quickinfo : 'Tax on Sales/Purchases Code'
    key TaxCode : String(2) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Procedure'
    @sap.quickinfo : 'Procedure (Pricing, Output Control, Acct. Det., Costing,...)'
    key TaxCalculationProcedure : String(6) not null;
    @sap.label : 'Tax Code Name'
    TaxCodeName : String(50);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.content.version : '1'
  @sap.label : 'Purchase Order Account Assignment'
  entity C_POAccountAssignmentFactSheet {
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purchasing Document'
    @sap.quickinfo : 'Purchasing Document Number'
    @sap.value.list : 'standard'
    key PurchaseOrder : String(10) not null;
    @sap.display.format : 'NonNegative'
    @sap.label : 'Item'
    @sap.quickinfo : 'Item Number of Purchasing Document'
    @sap.value.list : 'standard'
    key PurchaseOrderItem : String(5) not null;
    @sap.display.format : 'NonNegative'
    @sap.label : 'Account Assgmt No.'
    @sap.quickinfo : 'Sequential Number of Account Assignment'
    key AccountAssignmentNumber : String(2) not null;
    @sap.display.format : 'UpperCase'
    @sap.text : 'CostCenter_Text'
    @sap.label : 'Cost Center'
    CostCenter : String(10);
    @sap.label : 'Cost Center Name'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    CostCenter_Text : String(20);
    @sap.display.format : 'UpperCase'
    @sap.text : 'MasterFixedAsset_Text'
    @sap.label : 'Asset'
    @sap.quickinfo : 'Main Asset Number'
    MasterFixedAsset : String(12);
    @sap.label : 'Asset Main No. Text'
    @sap.quickinfo : 'Asset Main Number Text'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    MasterFixedAsset_Text : String(50);
    @sap.display.format : 'UpperCase'
    @sap.text : 'FixedAsset_Text'
    @sap.label : 'Subnumber'
    @sap.quickinfo : 'Asset Subnumber'
    FixedAsset : String(4);
    @sap.label : 'Description'
    @sap.quickinfo : 'Asset Description'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    FixedAsset_Text : String(50);
    @sap.display.format : 'UpperCase'
    @sap.text : 'ProjectNetwork_Text'
    @sap.label : 'Network'
    @sap.quickinfo : 'Network Number for Account Assignment'
    ProjectNetwork : String(12);
    @sap.label : 'Network Name'
    @sap.quickinfo : 'Description'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    ProjectNetwork_Text : String(40);
    @sap.label : 'Network Activity'
    @sap.quickinfo : 'Activity number in network and standard network'
    NetworkActivity : String(4);
    @sap.label : 'Distribution (%)'
    @sap.quickinfo : 'Distribution percentage in the case of multiple acct assgt'
    MultipleAcctAssgmtDistrPercent : Decimal(3, 1);
    @sap.display.format : 'UpperCase'
    @sap.text : 'GLAccount_Text'
    @sap.label : 'G/L Account'
    @sap.quickinfo : 'G/L Account Number'
    GLAccount : String(10);
    @sap.label : 'G/L Account Name'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    GLAccount_Text : String(20);
    @sap.display.format : 'UpperCase'
    @sap.label : 'SD Document'
    @sap.quickinfo : 'Sales and Distribution Document Number'
    SalesOrder : String(10);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Item'
    @sap.quickinfo : 'Sales Document Item'
    SalesOrderItem : String(6);
    @sap.display.format : 'UpperCase'
    @sap.text : 'OrderDescription'
    @sap.label : 'Order'
    @sap.quickinfo : 'Order Number'
    OrderID : String(12);
    @sap.label : 'Unloading Point'
    UnloadingPointName : String(25);
    @sap.display.format : 'UpperCase'
    @sap.text : 'ControllingArea_Text'
    @sap.label : 'Controlling Area'
    ControllingArea : String(4);
    @sap.label : 'Controlling Area Name'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    ControllingArea_Text : String(25);
    @sap.display.format : 'UpperCase'
    @sap.text : 'ProfitCenter_Text'
    @sap.label : 'Profit Center'
    ProfitCenter : String(10);
    @sap.label : 'Profit Center Name'
    @sap.quickinfo : 'Description of Profit Center'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    ProfitCenter_Text : String(20);
    @sap.display.format : 'UpperCase'
    @sap.label : 'WBS Element'
    @sap.quickinfo : 'Work Breakdown Structure Element (WBS Element) Edited'
    WBSElementExternalID : String(24);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Commitment Item'
    CommitmentItem : String(24);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Funds Center'
    FundsCenter : String(16);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Fund'
    Fund : String(10);
    @sap.display.format : 'UpperCase'
    @sap.text : 'FunctionalArea_Text'
    @sap.label : 'Functional Area'
    FunctionalArea : String(16);
    @sap.label : 'Functional Area Name'
    @sap.quickinfo : 'Name of the Functional Area'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    FunctionalArea_Text : String(25);
    @sap.label : 'Goods Recipient'
    GoodsRecipientName : String(12);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Business Process'
    BusinessProcess : String(12);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Grant'
    GrantID : String(20);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Budget Period'
    BudgetPeriod : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Earmarked Funds'
    @sap.quickinfo : 'Document Number for Earmarked Funds'
    EarmarkedFundsDocument : String(10);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Document Item'
    @sap.quickinfo : 'Earmarked Funds: Document Item'
    EarmarkedFundsDocumentItem : String(3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Service Doc. Type'
    @sap.quickinfo : 'Service Document Type'
    ServiceDocumentType : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Service Document'
    @sap.quickinfo : 'Service Document ID'
    ServiceDocument : String(10);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Service Doc. Item'
    @sap.quickinfo : 'Service Document Item ID'
    ServiceDocumentItem : String(6);
    @sap.label : 'Project Name'
    ProjectName : String(40);
    @sap.label : 'Work Package Name'
    @sap.quickinfo : 'Work Breakdown Structure Element Name'
    WorkPackageName : String(40);
    @sap.label : 'Order Description'
    OrderDescription : String(40);
    to_ControllingArea : Association to I_ControllingArea {  };
    to_CostCenterDesc : Association to I_CostCenterText {  };
    to_FixedAsset : Association to I_FixedAsset {  };
    to_FunctionalAreaDesc : Association to I_FunctionalAreaText {  };
    to_GLAccountDesc : Association to I_GLAccountText {  };
    to_MasterFixedAsset : Association to I_MasterFixedAsset {  };
    to_ProfitCenterDesc : Association to I_ProfitCenterText {  };
    to_ProjectNetwork : Association to I_ProjectNetwork {  };
    to_PurchaseOrder : Association to I_PurchaseOrder {  };
    to_PurchaseOrderItem : Association to I_PurchaseOrderItem {  };
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.content.version : '1'
  @sap.label : 'Purchase Order Fact Sheet Delivery Address'
  entity C_PODeliveryAddressFactSheet {
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purchasing Document'
    @sap.quickinfo : 'Purchasing Document Number'
    key PurchaseOrder : String(10) not null;
    @sap.display.format : 'NonNegative'
    @sap.label : 'Purchase Order Item'
    @sap.quickinfo : 'Item Number of Purchase Order'
    key PurchaseOrderItem : String(5) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Plant'
    Plant : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Address'
    @sap.quickinfo : 'Manual address number in purchasing document item'
    ItemDeliveryAddressID : String(10);
    @sap.label : 'Full Name'
    @sap.quickinfo : 'Full Name of Person'
    AddresseeFullName : String(80);
    @sap.label : 'Street'
    StreetName : String(60);
    @sap.label : 'House Number'
    HouseNumber : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Postal Code'
    @sap.quickinfo : 'City postal code'
    PostalCode : String(10);
    @sap.label : 'City'
    CityName : String(40);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Telephone number'
    @sap.quickinfo : 'Complete Number: Dialing Code+Number+Extension'
    PhoneNumber : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Fax Number'
    @sap.quickinfo : 'Complete Number: Dialing Code+Number+Extension'
    InternationalFaxNumber : String(30);
    @sap.display.format : 'UpperCase'
    @sap.text : 'RegionName'
    @sap.label : 'Region'
    @sap.quickinfo : 'Region (State, Province, County)'
    Region : String(3);
    @sap.display.format : 'UpperCase'
    @sap.text : 'CountryName'
    @sap.label : 'Country/Region Key'
    Country : String(3);
    @sap.label : 'Country/Region Name'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    CountryName : String(50);
    @sap.label : 'Description'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    RegionName : String(20);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Value Help f. Tax Country/Region in &quot;Manage Purchase Orders&quot;'
  entity C_POMntnTaxCountryValueHelp {
    @sap.display.format : 'UpperCase'
    @sap.label : 'Company Code'
    key CompanyCode : String(4) not null;
    @sap.display.format : 'UpperCase'
    @sap.text : 'TaxCountry_Text'
    @sap.label : 'Tax Ctry/Reg.'
    @sap.quickinfo : 'Tax Reporting Country/Region'
    key TaxCountry : String(3) not null;
    @sap.label : 'Country/Region Name'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    TaxCountry_Text : String(50);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.content.version : '1'
  @sap.label : 'Purchase Order Schedule Line'
  entity C_POScheduleLineFactSheet {
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purchasing Document'
    @sap.quickinfo : 'Purchasing Document Number'
    key PurchaseOrder : String(10) not null;
    @sap.display.format : 'NonNegative'
    @sap.label : 'Item'
    @sap.quickinfo : 'Item Number of Purchasing Document'
    key PurchaseOrderItem : String(5) not null;
    @sap.display.format : 'NonNegative'
    @sap.label : 'Schedule Line'
    @sap.quickinfo : 'Delivery Schedule Line Counter'
    key ScheduleLine : String(4) not null;
    @sap.display.format : 'Date'
    @sap.label : 'Delivery Date'
    @sap.quickinfo : 'Item Delivery Date'
    ScheduleLineDeliveryDate : Date;
    @sap.display.format : 'Date'
    @sap.label : 'Start Date'
    @sap.quickinfo : 'Start Date for Period of Performance'
    PerformancePeriodStartDate : Date;
    @sap.display.format : 'Date'
    @sap.label : 'End Date'
    @sap.quickinfo : 'End Date for Period of Performance'
    PerformancePeriodEndDate : Date;
    @sap.unit : 'PurchaseOrderQuantityUnit'
    @sap.label : 'Scheduled Quantity'
    ScheduleLineOrderQuantity : Decimal(13, 3);
    @sap.label : 'Order Unit'
    @sap.quickinfo : 'Purchase Order Unit of Measure'
    @sap.semantics : 'unit-of-measure'
    PurchaseOrderQuantityUnit : String(3);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.content.version : '1'
  @sap.label : 'Purchase Order Supplier Address Fact Sheet'
  entity C_POSupplierAddressFactSheet {
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purchase Order'
    @sap.quickinfo : 'Purchase Order Number'
    key PurchaseOrder : String(10) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Address Number'
    SupplierAddressID : String(10);
    @sap.label : 'Full Name'
    @sap.quickinfo : 'Full Name of Person'
    AddresseeFullName : String(80);
    @sap.label : 'Street'
    StreetName : String(60);
    @sap.label : 'House Number'
    HouseNumber : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Postal Code'
    @sap.quickinfo : 'City postal code'
    PostalCode : String(10);
    @sap.label : 'City'
    CityName : String(40);
    @sap.display.format : 'UpperCase'
    @sap.text : 'CountryName'
    @sap.label : 'Country/Region Key'
    Country : String(3);
    @sap.display.format : 'UpperCase'
    @sap.text : 'RegionName'
    @sap.label : 'Region'
    @sap.quickinfo : 'Region (State, Province, County)'
    Region : String(3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Telephone'
    @sap.quickinfo : 'Telephone No.: Dialing Code and Number'
    PhoneAreaCodeSubscriberNumber : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Fax'
    @sap.quickinfo : 'Fax Number: Dialing Code and Number'
    FaxAreaCodeSubscriberNumber : String(30);
    @sap.label : 'E-Mail Address'
    EmailAddress : String(241);
    @sap.label : 'Country/Region Name'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    CountryName : String(50);
    @sap.label : 'Description'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    RegionName : String(20);
    @sap.label : 'Salesperson'
    @sap.quickinfo : 'Responsible Salesperson at Supplier''s Office'
    SupplierRespSalesPersonName : String(30);
    @sap.label : 'Supplier Phone'
    @sap.quickinfo : 'Supplier''s Phone Number'
    SupplierPhoneNumber : String(16);
    @sap.label : 'Your Reference'
    CorrespncExternalReference : String(12);
    @sap.label : 'Our Reference'
    CorrespncInternalReference : String(12);
    @sap.label : 'Language Key'
    CorrespondenceLanguage : String(2);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purchasing Group'
    PurchasingGroup : String(3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purchase Order Type'
    PurchaseOrderType : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purch. Organization'
    @sap.quickinfo : 'Purchasing Organization'
    PurchasingOrganization : String(4);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Value help for Purchase Contract'
  @sap.value.list : 'true'
  entity C_PurchaseContractValHelp {
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purchase Contract'
    key PurchaseContract : String(10) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Supplier'
    Supplier : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Currency'
    @sap.quickinfo : 'Currency Key'
    @sap.semantics : 'currency-code'
    DocumentCurrency : String(5);
    @sap.display.format : 'Date'
    @sap.label : 'Validity Per. Start'
    @sap.quickinfo : 'Start of Validity Period'
    ValidityStartDate : Date;
    @sap.display.format : 'Date'
    @sap.label : 'Validity Period End'
    @sap.quickinfo : 'End of Validity Period'
    ValidityEndDate : Date;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purch. Organization'
    @sap.quickinfo : 'Purchasing Organization'
    PurchasingOrganization : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purchasing Group'
    PurchasingGroup : String(3);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.content.version : '1'
  @sap.label : 'Notes for Purchase Order'
  entity C_PurchaseOrderFactSheetNote {
    @sap.label : 'Language Key'
    key Language : String(2) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Text ID'
    key DocumentText : String(4) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Text object'
    @sap.quickinfo : 'Texts: Application Object'
    key TechnicalObjectType : String(10) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Text Name'
    @sap.quickinfo : 'Name'
    key ArchObjectNumber : String(70) not null;
    @sap.label : 'UUID'
    @sap.quickinfo : 'UUID in X form (binary)'
    key DraftUUID : UUID not null;
    @sap.label : 'Boolean Variable (X = True, - = False, Space = Unknown)'
    @sap.heading : ''
    key IsActiveEntity : Boolean not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purchasing Document'
    @sap.quickinfo : 'Purchasing Document Number'
    PurchaseOrder : String(10);
    @sap.label : 'Long Text'
    NoteDescription : String;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Fixing'
    @sap.quickinfo : '&quot;Fixed&quot; Indicator for Texts'
    FixedIndicator : String(1);
    to_PurchaseOrder : Association to C_PurchaseOrderFs {  };
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Purchase Order'
  entity C_PurchaseOrderFs {
    @sap.display.format : 'UpperCase'
    @sap.text : 'PurchaseOrder_Text'
    @sap.label : 'Purchase Order'
    @sap.quickinfo : 'Purchase Order Number'
    key PurchaseOrder : String(10) not null;
    @sap.label : 'Doc. Type Descript.'
    @sap.quickinfo : 'Short Description of Purchasing Document Type'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    PurchaseOrder_Text : String(20);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purchase Order'
    @sap.quickinfo : 'Purchase Order Number'
    PurchasingDocument : String(10);
    @sap.display.format : 'UpperCase'
    @sap.text : 'PurchaseOrderType_Text'
    @sap.label : 'Purchasing Doc. Type'
    @sap.quickinfo : 'Purchasing Document Type'
    @sap.value.list : 'standard'
    PurchaseOrderType : String(4);
    @sap.label : 'Doc. Type Descript.'
    @sap.quickinfo : 'Short Description of Purchasing Document Type'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    PurchaseOrderType_Text : String(20);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Control indicator'
    @sap.quickinfo : 'Control indicator for purchasing document type'
    PurchaseOrderSubtype : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Status'
    @sap.quickinfo : 'Status of Purchasing Document'
    PurchasingDocumentOrigin : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purch. Doc. Category'
    @sap.quickinfo : 'Purchasing Document Category'
    PurchasingDocumentCategory : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purchasing Doc. Type'
    @sap.quickinfo : 'Purchasing Document Type'
    PurchasingDocumentType : String(4);
    @sap.display.format : 'UpperCase'
    @sap.text : 'UserFullName'
    @sap.label : 'Created By'
    @sap.quickinfo : 'User of person who created a purchasing document'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    CreatedByUser : String(12);
    @sap.display.format : 'Date'
    @sap.label : 'Created On'
    @sap.quickinfo : 'Creation Date of Purchasing Document'
    CreationDate : Date;
    @sap.display.format : 'Date'
    @sap.label : 'Purchase Order Date'
    PurchaseOrderDate : Date;
    @sap.label : 'Language Key'
    Language : String(2);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Deletion Code'
    @sap.quickinfo : 'Purchase Order Deletion Code'
    PurchasingDocumentDeletionCode : String(1);
    @sap.label : 'Subject to Release'
    @sap.quickinfo : 'Release Not Yet Completely Effected'
    ReleaseIsNotCompleted : Boolean;
    @sap.label : 'Incomplete'
    @sap.quickinfo : 'Purchase order not yet complete'
    PurchasingCompletenessStatus : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.text : 'CompanyCodeName'
    @sap.label : 'Company Code'
    @sap.value.list : 'standard'
    CompanyCode : String(4);
    @sap.label : 'Company Name'
    @sap.quickinfo : 'Name of Company Code or Company'
    CompanyCodeName : String(25);
    @sap.display.format : 'UpperCase'
    @sap.text : 'PurchasingOrganizationName'
    @sap.label : 'Purch. Organization'
    @sap.quickinfo : 'Purchasing Organization'
    @sap.value.list : 'standard'
    PurchasingOrganization : String(4);
    @sap.label : 'Purch. Org. Name'
    @sap.quickinfo : 'Purchasing Organization Name'
    PurchasingOrganizationName : String(20);
    @sap.display.format : 'UpperCase'
    @sap.text : 'PurchasingGroupName'
    @sap.label : 'Purchasing Group'
    @sap.value.list : 'standard'
    PurchasingGroup : String(3);
    @sap.label : 'Purchasing Grp. Name'
    @sap.quickinfo : 'Purchasing Group Name'
    PurchasingGroupName : String(18);
    @sap.display.format : 'UpperCase'
    @sap.text : 'SupplierName'
    @sap.label : 'Supplier'
    @sap.value.list : 'standard'
    Supplier : String(10);
    @sap.label : 'Name'
    SupplierName : String(35);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Address Number'
    ManualSupplierAddressID : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Address Number'
    SupplierAddressID : String(10);
    @sap.display.format : 'UpperCase'
    @sap.text : 'to_SupplyingSupplier/SupplierName'
    @sap.label : 'Goods Supplier'
    @sap.value.list : 'standard'
    SupplyingSupplier : String(10);
    @sap.display.format : 'UpperCase'
    @sap.text : 'to_SupplyingPlant/PlantName'
    @sap.label : 'Supplying Plant'
    @sap.quickinfo : 'Supplying (issuing) plant in case of stock transport order'
    @sap.value.list : 'standard'
    SupplyingPlant : String(4);
    @sap.display.format : 'UpperCase'
    @sap.text : 'to_InvoicingParty/SupplierName'
    @sap.label : 'Invoicing Party'
    @sap.quickinfo : 'Different Invoicing Party'
    @sap.value.list : 'standard'
    InvoicingParty : String(10);
    @sap.display.format : 'UpperCase'
    @sap.text : 'PaymentTerms_Text'
    @sap.label : 'Payment Terms'
    @sap.quickinfo : 'Terms of Payment Key'
    @sap.value.list : 'standard'
    PaymentTerms : String(4);
    @sap.label : 'Description'
    @sap.quickinfo : 'Description of terms of payment'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    PaymentTerms_Text : String(30);
    @sap.label : 'Days 1'
    @sap.quickinfo : 'Cash Discount Days 1'
    CashDiscount1Days : Decimal(3, 0);
    @sap.label : 'Days 2'
    @sap.quickinfo : 'Cash Discount Days 2'
    CashDiscount2Days : Decimal(3, 0);
    @sap.label : 'Days Net'
    @sap.quickinfo : 'Net Payment Terms Period'
    NetPaymentDays : Decimal(3, 0);
    @sap.label : 'CD Percentage 1'
    @sap.quickinfo : 'Cash Discount Percentage 1'
    CashDiscount1Percent : Decimal(5, 3);
    @sap.label : 'CD Percentage 2'
    @sap.quickinfo : 'Cash Discount Percentage 2'
    CashDiscount2Percent : Decimal(5, 3);
    @sap.label : 'Payment Terms'
    @sap.quickinfo : 'Payment Terms Description'
    PaymentTermsDescription : String(100);
    @sap.display.format : 'UpperCase'
    @sap.text : 'IncotermsClassification_Text'
    @sap.label : 'Incoterms'
    @sap.quickinfo : 'Incoterms (Part 1)'
    @sap.value.list : 'standard'
    IncotermsClassification : String(3);
    @sap.label : 'Incoterms Classification Description'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    IncotermsClassification_Text : String(30);
    @sap.label : 'Incoterms (Part 2)'
    IncotermsTransferLocation : String(28);
    @sap.display.format : 'UpperCase'
    @sap.text : 'to_DocumentCurrency/Currency_Text'
    @sap.label : 'Currency'
    @sap.quickinfo : 'Currency Key'
    @sap.value.list : 'standard'
    @sap.semantics : 'currency-code'
    DocumentCurrency : String(5);
    @sap.label : 'Checkbox'
    @sap.heading : ''
    PurchasingHasItemHierarchy : Boolean;
    @sap.unit : 'DocumentCurrency'
    PurchaseOrderNetAmount : Decimal(24, 3);
    PurchasingDocumentStatus : String(2);
    @sap.label : 'Description'
    @sap.quickinfo : 'User Description'
    UserFullName : String(80);
    @sap.label : 'Status'
    PurchasingDocumentStatusName : String(60);
    @sap.label : 'Flexible Workflow'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    PurgHasFlxblWorkflowApproval : Boolean;
    to_CompanyCode : Association to I_CompanyCode {  };
    to_CreatedByUser : Association to I_User {  };
    to_DocumentCurrency : Association to I_Currency {  };
    to_IncotermsClassification : Association to I_IncotermsClassification {  };
    to_IncotermsClassificationText : Association to many I_IncotermsClassificationText {  };
    to_InvoicingParty : Association to I_Supplier {  };
    to_PaymentTerms : Association to I_PaymentTerms {  };
    to_PaymentTermsText : Association to many I_PaymentTermsText {  };
    to_POSupplierAddressFactSheet : Association to C_POSupplierAddressFactSheet {  };
    to_PurchaseOrderGoodsReceipt : Association to many C_PurchaseOrderGoodsReceipt {  };
    to_PurchaseOrderItem : Composition of many C_PurOrdItemEnh {  };
    to_PurchaseOrderItemHierarchy : Composition of many C_PurOrderItemHierFactSheet {  };
    to_PurchaseOrderLimitItem : Composition of many C_PurchaseOrderLimitItem {  };
    to_PurchaseOrderPartner : Association to many C_PurOrderPartnerFactSheet {  };
    to_PurchaseOrderType : Association to I_PurchasingDocumentType {  };
    to_PurchaseOrderTypeText : Association to many I_PurchasingDocumentTypeText {  };
    to_PurchasingDocumentStatusText : Association to I_PurchasingDocumentStatusText {  };
    to_PurchasingGroup : Association to I_PurchasingGroup {  };
    to_PurchasingOrganization : Association to I_PurchasingOrganization {  };
    to_PurOrdRefPurConItm : Association to many C_PurOrdRefPurConItm {  };
    to_PurOrdSuplrConfDisplay : Association to many C_PurOrdSuplrConfDisplay {  };
    to_PurReqItemByPurOrder : Association to many C_PurReqItemByPurOrder {  };
    to_Status : Association to I_PurchasingDocumentStatus {  };
    to_SuplInvPurOrdRef : Association to many C_SuplInvPurOrdRef {  };
    to_Supplier : Association to I_Supplier {  };
    to_SupplierAddress : Association to I_Address {  };
    to_SupplyingPlant : Association to I_Plant {  };
    to_SupplyingSupplier : Association to I_Supplier {  };
    to_User : Association to I_User {  };
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.content.version : '1'
  @sap.label : 'Purchase Order Goods Receipt'
  entity C_PurchaseOrderGoodsReceipt {
    @sap.display.format : 'UpperCase'
    @sap.label : 'Material Document'
    @sap.quickinfo : 'Number of Material Document'
    key MaterialDocument : String(10) not null;
    @sap.display.format : 'NonNegative'
    @sap.label : 'Item'
    @sap.quickinfo : 'Material Document Item'
    key MaterialDocumentItem : String(4) not null;
    @sap.display.format : 'NonNegative'
    @sap.label : 'Year'
    @sap.quickinfo : 'Material Document Year'
    key MaterialDocumentYear : String(4) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purchase Order'
    @sap.quickinfo : 'Purchase Order Number'
    @sap.value.list : 'standard'
    key PurchaseOrder : String(10) not null;
    @sap.display.format : 'NonNegative'
    @sap.label : 'Item'
    @sap.quickinfo : 'Item Number of Purchasing Document'
    @sap.value.list : 'standard'
    key PurchaseOrderItem : String(5) not null;
    @sap.display.format : 'UpperCase'
    @sap.text : 'to_Material/Material_Text'
    @sap.label : 'Material'
    @sap.quickinfo : 'Material Number'
    @sap.value.list : 'standard'
    Material : String(40);
    @sap.unit : 'MaterialBaseUnit'
    @sap.label : 'Quantity'
    QuantityInBaseUnit : Decimal(13, 3);
    @sap.unit : 'EntryUnit'
    @sap.label : 'Quantity in Entry Unit'
    @sap.quickinfo : 'Quantity in Unit of Entry'
    QuantityInEntryUnit : Decimal(13, 3);
    @sap.unit : 'PF47C78CDA66C9A738E535B8ADD0B3CA9'
    @sap.label : 'Quantity in Order Unit'
    @sap.quickinfo : 'Goods Reciepts Quantity in Order Unit'
    GoodsReceiptQtyInOrderUnit : Decimal(13, 3);
    @sap.unit : 'PC9DA0B1B0F2D38580ABDE527B901611A'
    @sap.label : 'Quantity in Order Price Unit'
    @sap.quickinfo : 'Quantity in Purchase Order Price Unit'
    QtyInPurchaseOrderPriceUnit : Decimal(13, 3);
    @sap.display.format : 'UpperCase'
    @sap.text : 'to_Plant/PlantName'
    @sap.label : 'Plant'
    @sap.value.list : 'standard'
    Plant : String(4);
    @sap.display.format : 'UpperCase'
    @sap.text : 'to_StorageLocation/StorageLocationName'
    @sap.label : 'Storage Location'
    @sap.value.list : 'standard'
    StorageLocation : String(4);
    @sap.label : 'Reversed'
    GoodsMovementIsCancelled : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.label : 'User Name'
    CreatedByUser : String(12);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Relevance for Analytics'
    GoodsMovementCancellationType : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Reference Document Type'
    @sap.quickinfo : 'Goods Movement Reference Document Type'
    GoodsMovementRefDocType : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Movement Type'
    @sap.quickinfo : 'Movement Type (Inventory Management)'
    GoodsMovementType : String(3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Material for Stock Mamangement'
    StockIdentifyingMaterial : String(40);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Storage Location SID'
    @sap.quickinfo : 'Storage Location (Stock Identifier)'
    StockIdfgStorageLocation : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Batch SID'
    @sap.quickinfo : 'Batch Number (Stock Identifier)'
    StockIdentifyingBatch : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Supplier SID'
    @sap.quickinfo : 'Supplier for Special Stock'
    SpecialStockIdfgSupplier : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Customer SID'
    @sap.quickinfo : 'Customer for Special Stock'
    SpecialStockIdfgCustomer : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Special Stock Type'
    InventorySpecialStockType : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Stock Type'
    @sap.quickinfo : 'Stock Type of Goods Movement (Stock Identifier)'
    InventoryStockType : String(2);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Batch'
    @sap.quickinfo : 'Batch Number'
    Batch : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Supplier'
    @sap.quickinfo : 'Supplier''s Account Number'
    Supplier : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Sales Order'
    @sap.quickinfo : 'Sales Order Number'
    SalesOrder : String(10);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Sales Order Item'
    SalesOrderItem : String(6);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Sales Order Schedule'
    SalesOrderScheduleLine : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Customer'
    @sap.quickinfo : 'Account Number of Customer'
    Customer : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Additional Supplier for Special Stock'
    StockOwner : String(10);
    @sap.display.format : 'NonNegative'
    @sap.label : 'WBS Element Internal ID'
    WBSElementInternalID : String(24);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Transfer Material'
    IssgOrRcvgMaterial : String(40);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Receiving plant'
    @sap.quickinfo : 'Receiving plant/issuing plant'
    IssuingOrReceivingPlant : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Storage Location'
    @sap.quickinfo : 'Receiving/Issuing Storage Location'
    IssuingOrReceivingStorageLoc : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Transfer Batch'
    IssgOrRcvgBatch : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Special Stock'
    @sap.quickinfo : 'Special Stock Indicator'
    IssgOrRcvgSpclStockInd : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Transfer Batch (Valuation Type)'
    IssuingOrReceivingValType : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Consumption'
    @sap.quickinfo : 'Consumption Posting'
    ConsumptionPosting : String(1);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Reason for Movement'
    GoodsMovementReasonCode : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Debit/Credit Indicator'
    DebitCreditCode : String(1);
    @sap.label : 'Base Unit of Measure'
    @sap.semantics : 'unit-of-measure'
    MaterialBaseUnit : String(3);
    @sap.display.format : 'Date'
    @sap.label : 'Document Date'
    @sap.quickinfo : 'Document Date in Document'
    DocumentDate : Date;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Document Type'
    AccountingDocumentType : String(2);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Transaction/Event Type'
    InventoryTransactionType : String(2);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Special Stock Valuation Indicator'
    @sap.quickinfo : 'Separate Valuation Type'
    InventorySpecialStockValnType : String(1);
    @sap.display.format : 'Date'
    @sap.label : 'Entry Date'
    @sap.quickinfo : 'Day On Which Accounting Document Was Entered'
    CreationDate : Date;
    @sap.label : 'Time of Entry'
    CreationTime : Time;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Bill of Lading'
    @sap.quickinfo : 'Number of Bill of Lading at Time of Goods Receipt'
    BillOfLading : String(16);
    @sap.display.format : 'Date'
    @sap.label : 'SLED/BBD'
    @sap.quickinfo : 'Shelf Life Expiration or Best-Before Date'
    ShelfLifeExpirationDate : Date;
    @sap.display.format : 'Date'
    @sap.label : 'Date of Manufacture'
    ManufactureDate : Date;
    @sap.label : 'Unit of Entry'
    @sap.semantics : 'unit-of-measure'
    EntryUnit : String(3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Valuation Type'
    InventoryValuationType : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Network'
    @sap.quickinfo : 'Network Number for Account Assignment'
    ProjectNetwork : String(12);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Manufacturing Order'
    ManufacturingOrder : String(12);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Manufacturing Order Item'
    ManufacturingOrderItem : String(4);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Reservation'
    @sap.quickinfo : 'Number of Reservation/Dependent Requirements'
    Reservation : String(10);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Reservation Item'
    @sap.quickinfo : 'Item Number of Reservation / Dependent Requirements'
    ReservationItem : String(4);
    @sap.label : 'Final-Issue Reservation'
    @sap.quickinfo : 'Final Issue for Reservation'
    ReservationIsFinallyIssued : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Delivery'
    DeliveryDocument : String(10);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Delivery Item'
    @sap.quickinfo : 'Delivery Document Item'
    DeliveryDocumentItem : String(6);
    @sap.label : 'Delivery Completed'
    @sap.quickinfo : '&quot;Delivery Completed&quot; Indicator'
    IsCompletelyDelivered : Boolean;
    @sap.display.format : 'NonNegative'
    @sap.label : 'Reversed Document Year'
    @sap.quickinfo : 'Reversed Material Document Year'
    ReversedMaterialDocumentYear : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Reversed Material Document'
    ReversedMaterialDocument : String(10);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Reversed Document Item'
    @sap.quickinfo : 'Reversed Material Document Item'
    ReversedMaterialDocumentItem : String(4);
    @sap.label : 'RevGR despite IR'
    @sap.quickinfo : 'Reversal of GR allowed for GR-based IV despite invoice'
    RvslOfGoodsReceiptIsAllowed : Boolean;
    @sap.label : 'Has Reversal Movement Type'
    IsReversalMovementType : Boolean;
    @sap.label : 'Goods Recipient'
    GoodsRecipientName : String(12);
    @sap.label : 'Unloading Point'
    UnloadingPointName : String(25);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Cost Center'
    CostCenter : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'G/L Account'
    @sap.quickinfo : 'G/L Account Number'
    GLAccount : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Cost Object'
    CostObject : String(12);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Profit Center'
    ProfitCenter : String(10);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Cost Estimate'
    CostEstimate : String(12);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Reference'
    @sap.quickinfo : 'Reference Document Number'
    ReferenceDocument : String(16);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Service Performer'
    ServicePerformer : String(10);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Employment ID (Deprecated)'
    EmploymentInternalID : String(8);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Personnel Number'
    PersonWorkAgreement : String(8);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Account Assignment Category'
    AccountAssignmentCategory : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Work Item ID'
    WorkItem : String(10);
    @sap.display.format : 'Date'
    @sap.label : 'Services Rendered Date'
    @sap.quickinfo : 'Date on which Services were Provided'
    ServicesRenderedDate : Date;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Company Code'
    CompanyCode : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Business Area'
    BusinessArea : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Controlling Area'
    ControllingArea : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Functional Area'
    FunctionalArea : String(16);
    @sap.display.format : 'Date'
    @sap.label : 'Posting Date'
    @sap.quickinfo : 'Posting Date in the Document'
    PostingDate : Date;
    @sap.display.format : 'NonNegative'
    @sap.label : 'Fiscal Year & Period from Posting date'
    @sap.quickinfo : 'Period Year'
    FiscalYearPeriod : String(7);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Fiscal Year Variant'
    FiscalYearVariant : String(2);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Year & Day'
    @sap.quickinfo : 'Year-Day-Combination'
    YearDay : String(7);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Year & Week'
    @sap.quickinfo : 'Year-Week-Combination'
    YearWeek : String(6);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Year & Month'
    @sap.quickinfo : 'Year-Month-Combination'
    YearMonth : String(6);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Year & Quarter'
    @sap.quickinfo : 'Year-Quarter-Combination'
    YearQuarter : String(5);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Quarter (1 - 4)'
    CalendarQuarter : String(1);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Month (1 - 12)'
    CalendarMonth : String(2);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Calendar Week'
    @sap.quickinfo : 'Calendar Week (1 - 53)'
    CalendarWeek : String(2);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Day of Year (1 - 366)'
    CalendarDay : String(3);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Day of Week (1 - 7)'
    @sap.quickinfo : 'Day of Week'
    WeekDay : String(1);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Fiscal Year'
    FiscalYear : String(4);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Fiscal Year Period'
    @sap.quickinfo : 'Fiscal Year + Fiscal Period'
    YearPeriod : String(7);
    @sap.unit : 'CompanyCodeCurrency'
    @sap.label : 'Local Currency Amount'
    @sap.quickinfo : 'Amount in Local Currency'
    TotalGoodsMvtAmtInCCCrcy : Decimal(14, 3);
    @sap.unit : 'CompanyCodeCurrency'
    @sap.label : 'Amount in LC with Quantity Sign'
    @sap.quickinfo : 'Amount in Local Currency with Sign of Stock Quantity'
    GoodsMovementStkAmtInCCCrcy : Decimal(14, 3);
    @sap.unit : 'CompanyCodeCurrency'
    @sap.label : 'Amount in LC with Consumption Sign'
    @sap.quickinfo : 'Amount in Local Currency with Sign of Consumption Quantity'
    GoodsMvtCnsmpnAmtInCCCrcy : Decimal(14, 3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Company Code Currency'
    @sap.semantics : 'currency-code'
    CompanyCodeCurrency : String(5);
    @sap.unit : 'CompanyCodeCurrency'
    @sap.label : 'External Amount in LC'
    @sap.quickinfo : 'Externally Entered Posting Amount in Local Currency'
    GdsMvtExtAmtInCoCodeCrcy : Decimal(14, 3);
    @sap.unit : 'CompanyCodeCurrency'
    @sap.label : 'Sales Value Including VAT'
    @sap.quickinfo : 'Sales Value Including Value-Added Tax'
    SlsPrcAmtInclVATInCoCodeCrcy : Decimal(14, 3);
    @sap.unit : 'CompanyCodeCurrency'
    @sap.label : 'Sales Value'
    @sap.quickinfo : 'Externally Entered Sales Value in Local Currency'
    EnteredSlsAmtInCoCodeCrcy : Decimal(14, 3);
    to_GoodsMovementType : Association to I_GoodsMovementType {  };
    to_Material : Association to I_Material {  };
    to_Plant : Association to I_Plant {  };
    to_PurchaseOrder : Association to I_PurchaseOrder {  };
    to_PurchaseOrderItem : Association to I_PurchaseOrderItem {  };
    to_StorageLocation : Association to I_StorageLocation {  };
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.content.version : '1'
  @sap.label : 'Note Types for Purchase Order Item'
  entity C_PurchaseOrderItemNoteType {
    @sap.display.format : 'UpperCase'
    @sap.label : 'Text object'
    @sap.quickinfo : 'Texts: Application Object'
    key TechnicalObjectType : String(10) not null;
    @sap.label : 'Language Key'
    key Language : String(2) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Text ID'
    key DocumentText : String(4) not null;
    @sap.label : 'Description'
    @sap.quickinfo : 'Short Text'
    Note : String(30);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Purchase Order Limit Item'
  entity C_PurchaseOrderLimitItem {
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purchase Order'
    @sap.quickinfo : 'Purchase Order Number'
    @sap.value.list : 'standard'
    key PurchaseOrder : String(10) not null;
    @sap.display.format : 'NonNegative'
    @sap.label : 'Item'
    @sap.quickinfo : 'Item Number of Purchasing Document'
    key PurchaseOrderItem : String(5) not null;
    @odata.Type : 'Edm.Byte'
    @sap.label : 'Dyn. Field Control'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    @sap.sortable : 'false'
    @sap.filterable : 'false'
    PurContractItemForOverallLimit_fc : Integer;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Item Category'
    @sap.quickinfo : 'Item category in purchasing document'
    PurchaseOrderItemCategory : String(1);
    @sap.label : 'Text for Item Cat.'
    @sap.quickinfo : 'Text for Item Category'
    PurOrdItemCategoryName : String(20);
    @sap.label : 'Short Text'
    PurchaseOrderItemText : String(40);
    @sap.unit : 'DocumentCurrency'
    @sap.label : 'Expected Value'
    @sap.quickinfo : 'Expected Value of Overall Limit'
    ExpectedOverallLimitAmount : Decimal(14, 3);
    @sap.unit : 'DocumentCurrency'
    @sap.label : 'Overall Limit'
    OverallLimitAmount : Decimal(14, 3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Deletion Indicator'
    @sap.quickinfo : 'Deletion Indicator in Purchasing Document'
    PurchasingDocumentDeletionCode : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Currency'
    @sap.quickinfo : 'Currency Key'
    @sap.semantics : 'currency-code'
    DocumentCurrency : String(5);
    @sap.display.format : 'UpperCase'
    @sap.text : 'to_MaterialGroup/MaterialGroup_Text'
    @sap.label : 'Material Group'
    @sap.value.list : 'standard'
    MaterialGroup : String(9);
    @sap.display.format : 'UpperCase'
    @sap.text : 'to_Plant/PlantName'
    @sap.label : 'Plant'
    @sap.value.list : 'standard'
    Plant : String(4);
    @sap.display.format : 'UpperCase'
    @sap.text : 'AccountAssignmentCategory_Text'
    @sap.label : 'Acct Assignment Cat.'
    @sap.quickinfo : 'Account Assignment Category'
    AccountAssignmentCategory : String(1);
    @sap.label : 'Acct Assgnt. Cat. Desc.'
    @sap.quickinfo : 'Account Assignment Category Description'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    AccountAssignmentCategory_Text : String(20);
    @sap.label : 'Status'
    @sap.quickinfo : 'Purchase Order Item Status'
    PurchaseOrderItemStatus : String(60);
    @sap.label : 'Goods Receipt'
    @sap.quickinfo : 'Goods Receipt Indicator'
    GoodsReceiptIsExpected : Boolean;
    @sap.label : 'GR Non-Valuated'
    @sap.quickinfo : 'Goods Receipt, Non-Valuated'
    GoodsReceiptIsNonValuated : Boolean;
    @sap.label : 'Invoice Receipt'
    @sap.quickinfo : 'Invoice Receipt Indicator'
    InvoiceIsExpected : Boolean;
    @sap.label : 'GR-Based Inv. Verif.'
    @sap.quickinfo : 'Indicator: GR-Based Invoice Verification'
    InvoiceIsGoodsReceiptBased : Boolean;
    @sap.label : 'Delivery Completed'
    @sap.quickinfo : '&quot;Delivery Completed&quot; Indicator'
    IsCompletelyDelivered : Boolean;
    @sap.label : 'Final Invoice'
    @sap.quickinfo : 'Final Invoice Indicator'
    IsFinallyInvoiced : Boolean;
    @sap.label : 'Requisitioner'
    @sap.quickinfo : 'Name of requisitioner/requester'
    RequisitionerName : String(12);
    @sap.display.format : 'UpperCase'
    @sap.text : 'to_TaxCode/TaxCode_Text'
    @sap.label : 'Tax Code'
    @sap.quickinfo : 'Tax on sales/purchases code'
    @sap.value.list : 'standard'
    TaxCode : String(2);
    @sap.display.format : 'UpperCase'
    @sap.text : 'to_TaxJurisdiction/TaxJurisdiction_Text'
    @sap.label : 'Tax Jurisdiction'
    @sap.value.list : 'standard'
    TaxJurisdiction : String(15);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Procedure'
    @sap.quickinfo : 'Procedure (Pricing, Output Control, Acct. Det., Costing,...)'
    @sap.value.list : 'standard'
    TaxCalculationProcedure : String(6);
    @sap.label : 'Overdelivery Tolerance Limit'
    OverdelivTolrtdLmtRatioInPct : Decimal(3, 1);
    @sap.label : 'Underdelivery Tolerance Limit'
    UnderdelivTolrtdLmtRatioInPct : Decimal(3, 1);
    @sap.label : 'Unlimited Overdelivery Allowed'
    UnlimitedOverdeliveryIsAllowed : Boolean;
    @sap.label : 'Acceptance at Origin'
    @sap.quickinfo : 'Acceptance At Origin'
    IsToBeAcceptedAtOrigin : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Storage Location'
    @sap.value.list : 'standard'
    StorageLocation : String(4);
    @sap.label : 'Intrastat Service Code'
    @sap.value.list : 'standard'
    IntrastatServiceCode : String(30);
    @sap.label : 'Commodity Code'
    @sap.value.list : 'standard'
    CommodityCode : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Shipping Instr.'
    @sap.quickinfo : 'Shipping Instructions'
    @sap.value.list : 'fixed-values'
    ShippingInstruction : String(2);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Incoterms Version'
    IncotermsVersion : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Incoterms'
    @sap.quickinfo : 'Incoterms (Part 1)'
    @sap.value.list : 'standard'
    IncotermsClassification : String(3);
    @sap.label : 'Incoterms Location 1'
    IncotermsLocation1 : String(70);
    @sap.label : 'Incoterms Location 2'
    IncotermsLocation2 : String(70);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purchasing Info Rec.'
    @sap.quickinfo : 'Purchasing Info Records'
    @sap.value.list : 'standard'
    PurchasingInfoRecord : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purchase Contract'
    @sap.value.list : 'standard'
    PurchaseContract : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Contract For Limit'
    @sap.quickinfo : 'Purchase Contract for Enhanced Limit'
    @sap.value.list : 'standard'
    PurContractForOverallLimit : String(10);
    @sap.display.format : 'NonNegative'
    @sap.field.control : 'PurContractItemForOverallLimit_fc'
    @sap.label : 'Contract Item for Limit'
    @sap.quickinfo : 'Purchase Contract Reference Item for Enhanced Limit Item'
    @sap.value.list : 'standard'
    PurContractItemForOverallLimit : String(5);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Purchase Contract Item'
    @sap.value.list : 'standard'
    PurchaseContractItem : String(5);
    @sap.label : 'Info Record Update'
    @sap.heading : ''
    InfoRecordIsToBeUpdated : Boolean;
    to_MaterialGroup : Association to I_MaterialGroup {  };
    to_Plant : Association to I_Plant {  };
    to_PlantValHelp : Association to many C_MM_PlantValueHelp {  };
    to_POAccountAssignmentFactSheet : Association to many C_POAccountAssignmentFactSheet {  };
    to_PODeliveryAddressFactSheet : Association to C_PODeliveryAddressFactSheet {  };
    to_POScheduleLineFactSheet : Association to many C_POScheduleLineFactSheet {  };
    to_PurchaseOrderEnhanced : Association to I_PurchaseOrderEnhanced {  };
    to_PurchaseOrderItemCategoryText : Association to I_PurgDocumentItemCategoryText {  };
    to_PurOrdActACatValHelp : Association to C_PurOrdActACatValHelp {  };
    to_TaxCalculationProcedure : Association to I_TaxCalculationProcedure {  };
    to_TaxCode : Association to I_TaxCode {  };
    to_TaxJurisdiction : Association to I_TaxJurisdiction {  };
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.content.version : '1'
  @sap.label : 'Note Types for Purchase Order'
  entity C_PurchaseOrderNoteType {
    @sap.display.format : 'UpperCase'
    @sap.label : 'Text object'
    @sap.quickinfo : 'Texts: Application Object'
    key TechnicalObjectType : String(10) not null;
    @sap.label : 'Language Key'
    key Language : String(2) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Text ID'
    key DocumentText : String(4) not null;
    @sap.label : 'Description'
    @sap.quickinfo : 'Short Text'
    Note : String(30);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Master Delivery Addresses'
  entity C_PurchasingDeliveryAddressVH {
    @sap.display.format : 'UpperCase'
    @sap.label : 'Address Number'
    key AddressID : String(10) not null;
    @sap.display.format : 'UpperCase'
    @sap.text : 'AddressGroupName'
    @sap.label : 'Address group'
    @sap.quickinfo : 'Address Group (Key) (Business Address Services)'
    AddressGroup : String(4);
    @sap.label : 'Address grp. descr.'
    @sap.quickinfo : 'Address group description'
    AddressGroupName : String(40);
    @sap.label : 'Full Name'
    @sap.quickinfo : 'Full Name of Person'
    AddresseeFullName : String(80);
    @sap.label : 'Name'
    @sap.quickinfo : 'Name 1'
    AddresseeName1 : String(40);
    @sap.label : 'Name 2'
    AddresseeName2 : String(40);
    @sap.label : 'City'
    CityName : String(40);
    @sap.label : 'Street'
    StreetName : String(60);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Region'
    @sap.quickinfo : 'Region (State, Province, County)'
    Region : String(3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Country/Region Key'
    Country : String(3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Postal Code'
    @sap.quickinfo : 'City postal code'
    PostalCode : String(10);
    @sap.label : 'House Number'
    HouseNumber : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Search Term 1'
    AddressSearchTerm1 : String(20);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Search Term 2'
    AddressSearchTerm2 : String(20);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Purchasing Group Value Help'
  entity C_PurchasingGroupValueHelp {
    @sap.display.format : 'UpperCase'
    @sap.text : 'PurchasingGroupName'
    @sap.label : 'Purchasing Group'
    key PurchasingGroup : String(3) not null;
    @sap.label : 'Purchasing Grp. Name'
    @sap.quickinfo : 'Purchasing Group Name'
    PurchasingGroupName : String(18);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Tel. No. of Purchasing Grp.'
    @sap.quickinfo : 'Telephone number of purchasing group (buyer group)'
    PurchasingGroupPhoneNumber : String(12);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Tel. No. with Dialing Code'
    @sap.quickinfo : 'Telephone No.: Dialing Code and Number'
    PhoneNumber : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Extension'
    @sap.quickinfo : 'Telephone no.: Extension'
    PhoneNumberExtension : String(10);
    @sap.label : 'Fax'
    @sap.quickinfo : 'Fax number of purchasing (buyer) group'
    FaxNumber : String(31);
    @sap.label : 'Email Address'
    @sap.quickinfo : 'E-Mail Address'
    @sap.semantics : 'email'
    EmailAddress : String(241);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Purchasing Organization'
  @sap.value.list : 'true'
  entity C_PurchasingOrgValueHelp {
    @sap.display.format : 'UpperCase'
    @sap.text : 'PurchasingOrganizationName'
    @sap.label : 'Purchasing Organization'
    key PurchasingOrganization : String(4) not null;
    @sap.label : 'Purchasing Organization Name'
    PurchasingOrganizationName : String(20);
    @sap.display.format : 'UpperCase'
    @sap.text : 'CompanyCodeName'
    @sap.label : 'Company Code'
    CompanyCode : String(4);
    @sap.label : 'Company Name'
    @sap.quickinfo : 'Name of Company Code or Company'
    CompanyCodeName : String(25);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Validity'
    @sap.quickinfo : 'Deprecated Entries'
    ConfigDeprecationCode : String(1);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Customer Ship to Addresses'
  entity C_PurgCustomerBPShipToAddrVH {
    @sap.display.format : 'UpperCase'
    @sap.label : 'Address Number'
    key AddressID : String(10) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Business Partner'
    @sap.quickinfo : 'Business Partner Number'
    key BusinessPartner : String(10) not null;
    @sap.display.format : 'UpperCase'
    @sap.text : 'CustomerName'
    @sap.label : 'Customer'
    @sap.quickinfo : 'Customer Number'
    key Customer : String(10) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Country/Region Key'
    Country : String(3);
    @sap.label : 'City'
    CityName : String(40);
    @sap.label : 'Street'
    StreetName : String(60);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Postal Code'
    @sap.quickinfo : 'City postal code'
    PostalCode : String(10);
    @sap.label : 'Name of Customer'
    CustomerName : String(80);
    @sap.label : 'Name'
    OrganizationBPName1 : String(35);
    @sap.label : 'Name 2'
    OrganizationBPName2 : String(35);
    @sap.label : 'Standard Usage'
    @sap.quickinfo : 'Indicator: Standard Address Usage'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    StandardUsage : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Account group'
    @sap.quickinfo : 'Customer Account Group'
    CustomerAccountGroup : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Authorization'
    @sap.quickinfo : 'Authorization Group'
    AuthorizationGroup : String(4);
    @sap.label : 'Purpose Completed'
    @sap.quickinfo : 'Business Purpose Completed Flag'
    IsBusinessPurposeCompleted : Boolean;
    @sap.display.format : 'Date'
    @sap.label : 'Address Validity Start Date'
    AddressValidityStartDate : Date;
    @sap.display.format : 'Date'
    @sap.label : 'Address Validity End Date'
    AddressValidityEndDate : Date;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Address Type'
    AddressUsage : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Transaction'
    @sap.quickinfo : 'Transaction for BP Address Determination'
    BPAddrDeterminationTransaction : String(6);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Account Assignment Categories Value Help'
  entity C_PurOrdActACatValHelp {
    @sap.display.format : 'UpperCase'
    @sap.text : 'AcctAssignmentCategoryName'
    @sap.label : 'Acct Assignment Cat.'
    @sap.quickinfo : 'Account Assignment Category'
    key AccountAssignmentCategory : String(1) not null;
    @sap.label : 'Acct Assgnt. Cat. Desc.'
    @sap.quickinfo : 'Account Assignment Category Description'
    AcctAssignmentCategoryName : String(20);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.content.version : '1'
  @sap.label : 'Item Notes for Purchase Order'
  entity C_PurOrderItemFactSheetNote {
    @sap.label : 'Language Key'
    key Language : String(2) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Text ID'
    key DocumentText : String(4) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Text object'
    @sap.quickinfo : 'Texts: Application Object'
    key TechnicalObjectType : String(10) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Text Name'
    @sap.quickinfo : 'Name'
    key ArchObjectNumber : String(70) not null;
    @sap.label : 'UUID'
    @sap.quickinfo : 'UUID in X form (binary)'
    key DraftUUID : UUID not null;
    @sap.label : 'Boolean Variable (X = True, - = False, Space = Unknown)'
    @sap.heading : ''
    key IsActiveEntity : Boolean not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purchasing Document'
    @sap.quickinfo : 'Purchasing Document Number'
    PurchaseOrder : String(10);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Item'
    @sap.quickinfo : 'Item Number of Purchasing Document'
    PurchaseOrderItem : String(5);
    @sap.label : 'Long Text'
    NoteDescription : String;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Fixing'
    @sap.quickinfo : '&quot;Fixed&quot; Indicator for Texts'
    FixedIndicator : String(1);
    to_PurchaseOrder : Association to I_PurchaseOrder {  };
    to_PurchaseOrderItem : Association to C_PurOrdItemEnh {  };
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.content.version : '1'
  @sap.label : 'Purchase Order Item Hierarchy information'
  entity C_PurOrderItemHierFactSheet {
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purchase Order'
    @sap.quickinfo : 'Purchase Order Number'
    key PurchaseOrder : String(10) not null;
    @sap.display.format : 'NonNegative'
    @sap.hierarchy.node.external.key.for : 'PurchasingHierarchyNode'
    @sap.label : 'Item'
    @sap.quickinfo : 'Item Number of Purchasing Document'
    key PurchaseOrderItem : String(5) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Hierarchy Number'
    PurgConfigurableItemNumber : String(40);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Item Category'
    @sap.quickinfo : 'Item category in purchasing document'
    PurchaseOrderItemCategory : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Material'
    @sap.quickinfo : 'Material Number'
    Material : String(40);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Material'
    @sap.quickinfo : 'Material number'
    ManufacturerMaterial : String(40);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Material Group'
    MaterialGroup : String(9);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Plant'
    Plant : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Account Assignment Category'
    AccountAssignmentCategory : String(1);
    @sap.label : 'Short Text'
    PurchaseOrderItemText : String(40);
    @sap.hierarchy.node.for : 'PurchaseOrderItem'
    @sap.label : 'Hierarchy node'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    @sap.sortable : 'false'
    PurchasingHierarchyNode : String(1333);
    @sap.hierarchy.parent.node.for : 'PurchasingHierarchyNode'
    @sap.label : 'Hierarchy node'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    @sap.sortable : 'false'
    HierarchyParentNode : String(1333);
    @sap.hierarchy.level.for : 'PurchasingHierarchyNode'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    @sap.sortable : 'false'
    HierarchyLevel : Integer;
    @sap.hierarchy.node.descendant.count.for : 'PurchasingHierarchyNode'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    @sap.sortable : 'false'
    HierarchyNodeSubTreeSize : Integer;
    @sap.hierarchy.drill.state.for : 'PurchasingHierarchyNode'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    @sap.sortable : 'false'
    HierarchyDrillState : String(22);
    @sap.label : 'Item Set'
    @sap.quickinfo : 'ItemSet indicator of a Model Product Specification Item'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    @sap.sortable : 'false'
    PurchasingIsItemSet : Boolean;
    @sap.hierarchy.preorder.rank.for : 'PurchasingHierarchyNode'
    HierarchyNodeOrdinalNumber : Integer64;
    @sap.unit : 'PurchaseOrderQuantityUnit'
    @sap.label : 'Order Quantity'
    @sap.quickinfo : 'Purchase Order Quantity'
    OrderQuantity : Decimal(13, 3);
    @sap.label : 'Order Unit'
    @sap.quickinfo : 'Purchase Order Unit of Measure'
    @sap.semantics : 'unit-of-measure'
    PurchaseOrderQuantityUnit : String(3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Currency'
    @sap.quickinfo : 'Currency Key'
    @sap.semantics : 'currency-code'
    DocumentCurrency : String(5);
    @sap.unit : 'DocumentCurrency'
    @sap.label : 'Net Order Price'
    @sap.quickinfo : 'Net Price in Purchasing Document (in Document Currency)'
    NetPriceAmount : Decimal(12, 3);
    @sap.unit : 'DocumentCurrency'
    @sap.label : 'Net Order Value'
    @sap.quickinfo : 'Net Order Value in PO Currency'
    NetAmount : Decimal(14, 3);
    @sap.label : 'Requisitioner'
    @sap.quickinfo : 'Name of requisitioner/requester'
    RequisitionerName : String(12);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Deletion Indicator'
    @sap.quickinfo : 'Deletion Indicator in Purchasing Document'
    PurchasingDocumentDeletionCode : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Service Performer'
    @sap.value.list : 'standard'
    ServicePerformer : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Confirmation Control'
    @sap.quickinfo : 'Confirmation Control Key'
    SupplierConfirmationControlKey : String(4);
    @sap.label : 'Order Acknowledgment'
    @sap.quickinfo : 'Order Acknowledgment Number'
    PurgDocOrderAcknNumber : String(20);
    @sap.label : 'Acknowledgment Reqd.'
    @sap.quickinfo : 'Order Acknowledgment Requirement'
    IsOrderAcknRqd : Boolean;
    @sap.label : 'Rejection Indicator'
    ItemIsRejectedBySupplier : Boolean;
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.content.version : '1'
  @sap.label : 'Purchase Order Partner Fact Sheet'
  entity C_PurOrderPartnerFactSheet {
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purchasing Document'
    @sap.quickinfo : 'Purchasing Document Number'
    key PurchaseOrder : String(10) not null;
    @sap.display.format : 'UpperCase'
    @sap.text : 'PartnerFunction_Text'
    @sap.label : 'Partner Function'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    @sap.value.list : 'standard'
    key PartnerFunction : String(2) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purch. Organization'
    @sap.quickinfo : 'Purchasing Organization'
    key PurchasingOrganization : String(4) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Supplier Subrange'
    key SupplierSubrange : String(6) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Plant'
    key Plant : String(4) not null;
    @sap.display.format : 'NonNegative'
    @sap.label : 'Partner counter'
    key PartnerCounter : String(3) not null;
    @odata.Type : 'Edm.Byte'
    @sap.label : 'Dyn. Field Control'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    @sap.sortable : 'false'
    @sap.filterable : 'false'
    PersonWorkAgreement_fc : Integer;
    @odata.Type : 'Edm.Byte'
    @sap.label : 'Dyn. Field Control'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    @sap.sortable : 'false'
    @sap.filterable : 'false'
    Supplier_fc : Integer;
    @odata.Type : 'Edm.Byte'
    @sap.label : 'Dyn. Field Control'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    @sap.sortable : 'false'
    @sap.filterable : 'false'
    SupplierContact_fc : Integer;
    @sap.label : 'Name'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    PartnerFunction_Text : String(20);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Created By'
    @sap.quickinfo : 'Name of Person Responsible for Creating the Object'
    CreatedByUser : String(12);
    @sap.display.format : 'Date'
    @sap.label : 'Created On'
    @sap.quickinfo : 'Record Created On'
    CreationDate : Date;
    @sap.label : 'Name'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    PartnerFunctionName : String(20);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Partner Type'
    @sap.quickinfo : 'Type of partner number'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    PurchasingDocumentPartnerType : String(2);
    @sap.display.format : 'UpperCase'
    @sap.field.control : 'Supplier_fc'
    @sap.label : 'Supplier'
    @sap.quickinfo : 'Account Number of Supplier'
    Supplier : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Hierarchy Cat.'
    @sap.quickinfo : 'Hierarchy Category: Supplier Hierarchy'
    SupplierHierarchyCategory : String(1);
    @sap.display.format : 'NonNegative'
    @sap.field.control : 'SupplierContact_fc'
    @sap.label : 'Contact Person'
    @sap.quickinfo : 'Number of Contact Person'
    SupplierContact : String(10);
    @sap.display.format : 'NonNegative'
    @sap.field.control : 'PersonWorkAgreement_fc'
    @sap.label : 'Personnel Number'
    PersonWorkAgreement : String(8);
    @sap.label : 'Default Partner'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    DefaultPartner : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.text : 'PurchasingDocumentPartnerName'
    @sap.label : 'Partner'
    PurchasingDocumentPartner : String(10);
    @sap.label : 'Partner Name'
    PurchasingDocumentPartnerName : String(35);
    to_PartnerFunction : Association to I_PartnerFunction {  };
    to_PartnerFunctionText : Association to many I_PartnerFunctionText {  };
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Purchase Order Item Category'
  entity C_PurOrdHierItmCatValueHelp {
    @sap.display.format : 'UpperCase'
    @sap.text : 'PurgDocItemCategoryName'
    @sap.label : 'Item Category'
    @sap.quickinfo : 'Item Category in Purchasing Document'
    key PurOrdExtHierItemCategory : String(1) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Item Category'
    @sap.quickinfo : 'Item category in purchasing document'
    PurchasingDocumentItemCategory : String(1);
    @sap.label : 'Text for Item Cat.'
    @sap.quickinfo : 'Text for Item Category'
    PurgDocItemCategoryName : String(20);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Intrastat Commodity Code Value Help'
  @sap.value.list : 'true'
  entity C_PurOrdIntrastatCmmdtyCodeVH {
    @sap.display.format : 'UpperCase'
    @sap.label : 'No. Scheme Content'
    @sap.quickinfo : 'Trade Classification Numbering Scheme Content'
    key TrdClassfctnNmbrSchmCntnt : String(10) not null;
    @sap.text : 'CommodityCode_Text'
    @sap.label : 'Commodity Code'
    key CommodityCode : String(30) not null;
    @sap.display.format : 'Date'
    @sap.label : 'Valid From'
    key ValidityStartDate : Date not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Country/Region'
    key Country : String(3) not null;
    @sap.label : 'Description'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    CommodityCode_Text : String;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Numbering Scheme'
    @sap.quickinfo : 'Trade Classification Numbering Scheme'
    TrdClassfctnNmbrSchm : String(10);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Intrastat Service Code Value Help'
  @sap.value.list : 'true'
  entity C_PurOrdIntrastatSrvcCodeVH {
    @sap.display.format : 'UpperCase'
    @sap.label : 'No. Scheme Content'
    @sap.quickinfo : 'Trade Classification Numbering Scheme Content'
    key TrdClassfctnNmbrSchmCntnt : String(10) not null;
    @sap.text : 'IntrastatServiceCode_Text'
    @sap.label : 'Number'
    key IntrastatServiceCode : String(30) not null;
    @sap.display.format : 'Date'
    @sap.label : 'Valid From'
    key ValidityStartDate : Date not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Country/Region'
    key Country : String(3) not null;
    @sap.label : 'Description'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    IntrastatServiceCode_Text : String;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Numbering Scheme'
    @sap.quickinfo : 'Trade Classification Numbering Scheme'
    TrdClassfctnNmbrSchm : String(10);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.addressable : 'false'
  @sap.content.version : '1'
  @sap.label : 'Purchase Order Item CO2e Footprint'
  entity C_PurOrdItemCO2eqFootprint {
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purchase Order'
    @sap.quickinfo : 'Purchase Order Number'
    key PurchaseOrder : String(10) not null;
    @sap.display.format : 'NonNegative'
    @sap.label : 'Purchase Order Item'
    @sap.quickinfo : 'Item Number of Purchase Order'
    key PurchaseOrderItem : String(5) not null;
    @sap.label : 'Transaction Data Footprint'
    PFMTransDataFootprintUUID : UUID;
    @sap.unit : 'PFMFootprintUnit'
    @sap.label : 'CO2e Footprint'
    @sap.quickinfo : 'Footprint Quantity'
    PFMFootprintQuantity : Decimal(31, 14);
    @sap.label : 'CO2e Footprint Unit'
    @sap.quickinfo : 'Footprint Unit'
    @sap.semantics : 'unit-of-measure'
    PFMFootprintUnit : String(3);
    @sap.label : 'Business Object Type'
    @sap.quickinfo : 'Transaction Data Footprint Business Object Type'
    PFMTransDataFprntBusObjType : String(30);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.content.version : '1'
  @sap.label : 'Purchase Order Item'
  entity C_PurOrdItemEnh {
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purchase Order'
    @sap.quickinfo : 'Purchase Order Number'
    @sap.value.list : 'standard'
    key PurchaseOrder : String(10) not null;
    @sap.display.format : 'NonNegative'
    @sap.label : 'Item'
    @sap.quickinfo : 'Item Number of Purchasing Document'
    key PurchaseOrderItem : String(5) not null;
    @sap.display.format : 'UpperCase'
    @sap.text : 'PurchaseOrderItemCategory_Text'
    @sap.label : 'Item Category'
    @sap.quickinfo : 'Item category in purchasing document'
    PurchaseOrderItemCategory : String(1);
    @sap.label : 'Text for Item Cat.'
    @sap.quickinfo : 'Text for Item Category'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    PurchaseOrderItemCategory_Text : String(20);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Material'
    @sap.quickinfo : 'Material Number'
    Material : String(40);
    @sap.display.format : 'UpperCase'
    @sap.text : 'ManufacturerMaterial_Text'
    @sap.label : 'Material'
    @sap.quickinfo : 'Material number'
    ManufacturerMaterial : String(40);
    @sap.label : 'Material Description'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    ManufacturerMaterial_Text : String(40);
    @sap.display.format : 'UpperCase'
    @sap.text : 'MaterialGroup_Text'
    @sap.label : 'Material Group'
    MaterialGroup : String(9);
    @sap.label : 'Product Group Desc.'
    @sap.quickinfo : 'Product Group Description'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    MaterialGroup_Text : String(20);
    @sap.display.format : 'UpperCase'
    @sap.text : 'PlantName'
    @sap.label : 'Plant'
    Plant : String(4);
    @sap.label : 'Plant Name'
    PlantName : String(30);
    @sap.display.format : 'UpperCase'
    @sap.text : 'AccountAssignmentCategory_Text'
    @sap.label : 'Account Assignment Category'
    AccountAssignmentCategory : String(1);
    @sap.label : 'Acct Assgnt. Cat. Desc.'
    @sap.quickinfo : 'Account Assignment Category Description'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    AccountAssignmentCategory_Text : String(20);
    @sap.label : 'Short Text'
    PurchaseOrderItemText : String(40);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purchase Requisition'
    @sap.quickinfo : 'Purchase Requisition Number'
    PurchaseRequisition : String(10);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Item of requisition'
    @sap.quickinfo : 'Item number of purchase requisition'
    PurchaseRequisitionItem : String(5);
    @sap.display.format : 'UpperCase'
    @sap.text : 'ProductType_Text'
    @sap.label : 'Product Type Group'
    ProductType : String(2);
    @sap.label : 'Description'
    @sap.quickinfo : 'Product Type Group Description'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    ProductType_Text : String(40);
    @sap.display.format : 'Date'
    @sap.label : 'Delivery Date'
    @sap.quickinfo : 'Item Delivery Date'
    FirstDeliveryDate : Date;
    @sap.unit : 'PurchaseOrderQuantityUnit'
    @sap.label : 'Order Quantity'
    @sap.quickinfo : 'Purchase Order Quantity'
    OrderQuantity : Decimal(13, 3);
    @sap.label : 'Order Unit'
    @sap.quickinfo : 'Purchase Order Unit of Measure'
    @sap.semantics : 'unit-of-measure'
    PurchaseOrderQuantityUnit : String(3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Currency'
    @sap.quickinfo : 'Currency Key'
    @sap.semantics : 'currency-code'
    DocumentCurrency : String(5);
    @sap.label : 'Order Price Unit'
    @sap.quickinfo : 'Order Price Unit (Purchasing)'
    @sap.semantics : 'unit-of-measure'
    PurchaseOrderPriceUnit : String(3);
    @sap.unit : 'DocumentCurrency'
    @sap.label : 'Net Order Price'
    @sap.quickinfo : 'Net Price in Purchasing Document (in Document Currency)'
    NetPriceAmount : Decimal(12, 3);
    @sap.unit : 'PurchaseOrderPriceUnit'
    @sap.label : 'Price Unit'
    PurchaseOrderNetPriceQuantity : Decimal(5, 0);
    @sap.unit : 'DocumentCurrency'
    @sap.label : 'Net Order Value'
    @sap.quickinfo : 'Net Order Value in PO Currency'
    NetAmount : Decimal(14, 3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Deletion Indicator'
    @sap.quickinfo : 'Deletion Indicator in Purchasing Document'
    PurchasingDocumentDeletionCode : String(1);
    @sap.display.format : 'UpperCase'
    @sap.text : 'to_ServicePerformer/BusinessPartnerName'
    @sap.label : 'Service Performer'
    @sap.value.list : 'standard'
    ServicePerformer : String(10);
    @sap.display.format : 'Date'
    @sap.label : 'Start of Performance Period'
    @sap.quickinfo : 'Start Date for Period of Performance'
    PerformancePeriodStartDate : Date;
    @sap.display.format : 'Date'
    @sap.label : 'End of Performance Period'
    @sap.quickinfo : 'End Date for Period of Performance'
    PerformancePeriodEndDate : Date;
    @sap.label : 'Status'
    @sap.quickinfo : 'Purchasing Document Status Name'
    PurchaseOrderItemStatus : String(60);
    @sap.label : 'Overdelivery Tolerance Limit'
    OverdelivTolrtdLmtRatioInPct : Decimal(3, 1);
    @sap.label : 'Underdelivery Tolerance Limit'
    UnderdelivTolrtdLmtRatioInPct : Decimal(3, 1);
    @sap.label : 'Unlimited Overdelivery Allowed'
    UnlimitedOverdeliveryIsAllowed : Boolean;
    @sap.label : 'Acceptance at Origin'
    @sap.quickinfo : 'Acceptance At Origin'
    IsToBeAcceptedAtOrigin : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Storage Location'
    @sap.value.list : 'standard'
    StorageLocation : String(4);
    @sap.label : 'Intrastat Service Code'
    @sap.value.list : 'standard'
    IntrastatServiceCode : String(30);
    @sap.label : 'Commodity Code'
    @sap.value.list : 'standard'
    CommodityCode : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Shipping Instr.'
    @sap.quickinfo : 'Shipping Instructions'
    @sap.value.list : 'fixed-values'
    ShippingInstruction : String(2);
    @sap.display.format : 'NonNegative'
    @sap.text : 'FinancialChain_Text'
    @sap.label : 'Financial Chain ID'
    FinancialChain : String(10);
    @sap.label : 'Financial Chain Name'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    FinancialChain_Text : String(60);
    PurOrderIsFinChainIDHidden : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Incoterms Version'
    IncotermsVersion : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Incoterms'
    @sap.quickinfo : 'Incoterms (Part 1)'
    @sap.value.list : 'standard'
    IncotermsClassification : String(3);
    @sap.label : 'Incoterms Location 1'
    IncotermsLocation1 : String(70);
    @sap.label : 'Incoterms Location 2'
    IncotermsLocation2 : String(70);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purchasing Info Rec.'
    @sap.quickinfo : 'Purchasing Info Records'
    @sap.value.list : 'standard'
    PurchasingInfoRecord : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purchase Contract'
    @sap.value.list : 'standard'
    PurchaseContract : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Contract For Limit'
    @sap.quickinfo : 'Purchase Contract for Enhanced Limit'
    @sap.value.list : 'standard'
    PurContractForOverallLimit : String(10);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Purchase Contract Item'
    @sap.value.list : 'standard'
    PurchaseContractItem : String(5);
    @sap.label : 'Info Record Update'
    @sap.heading : ''
    InfoRecordIsToBeUpdated : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.text : 'TaxCode_Text'
    @sap.label : 'Tax Code'
    @sap.quickinfo : 'Tax on sales/purchases code'
    @sap.value.list : 'standard'
    TaxCode : String(2);
    @sap.label : 'Tax Code Name'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    TaxCode_Text : String(50);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Tax Jurisdiction'
    TaxJurisdiction : String(15);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Procedure'
    @sap.quickinfo : 'Procedure (Pricing, Output Control, Acct. Det., Costing,...)'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    TaxCalculationProcedure : String(6);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Confirmation Control'
    @sap.quickinfo : 'Confirmation Control Key'
    SupplierConfirmationControlKey : String(4);
    @sap.label : 'Order Acknowledgment'
    @sap.quickinfo : 'Order Acknowledgment Number'
    PurgDocOrderAcknNumber : String(20);
    @sap.label : 'Acknowledgment Reqd.'
    @sap.quickinfo : 'Order Acknowledgment Requirement'
    IsOrderAcknRqd : Boolean;
    @sap.label : 'Rejection Indicator'
    ItemIsRejectedBySupplier : Boolean;
    @sap.label : 'Requisitioner'
    @sap.quickinfo : 'Name of requisitioner/requester'
    RequisitionerName : String(12);
    to_PlantValHelp : Association to C_MM_PlantValueHelp {  };
    to_POAccountAssignmentFactSheet : Composition of many C_POAccountAssignmentFactSheet {  };
    to_PODeliveryAddressFactSheet : Association to C_PODeliveryAddressFactSheet {  };
    to_POScheduleLineFactSheet : Composition of many C_POScheduleLineFactSheet {  };
    to_PurchaseOrderEnhanced : Association to I_PurchaseOrderEnhanced {  };
    to_PurOrdScheduleLine : Association to many I_PurchaseOrderScheduleLine {  };
    to_ServicePerformer : Association to I_BusinessPartner {  };
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Purchase Order Item Category Value Help'
  entity C_PurOrdItmCatValHelp {
    @sap.display.format : 'UpperCase'
    @sap.text : 'PurgDocItemCategoryName'
    @sap.label : 'Item Category'
    @sap.quickinfo : 'Item Category in Purchasing Document'
    key PurgDocExternalItemCategory : String(1) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Item Category'
    @sap.quickinfo : 'Item category in purchasing document'
    PurchasingDocumentItemCategory : String(1);
    @sap.label : 'Text for Item Cat.'
    @sap.quickinfo : 'Text for Item Category'
    PurgDocItemCategoryName : String(20);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.content.version : '1'
  @sap.label : 'Purchase Contract Item'
  entity C_PurOrdRefPurConItm {
    @sap.display.format : 'UpperCase'
    @sap.label : 'Outline agreement'
    @sap.quickinfo : 'Number of principal purchase agreement'
    key PurchaseContract : String(10) not null;
    @sap.display.format : 'NonNegative'
    @sap.label : 'Agreement Item'
    @sap.quickinfo : 'Item Number of Principal Purchase Agreement'
    key PurchaseContractItem : String(5) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purchasing Document'
    @sap.quickinfo : 'Purchasing Document Number'
    key PurchaseOrder : String(10) not null;
    @sap.label : 'Order Unit'
    @sap.quickinfo : 'Purchase Order Unit of Measure'
    @sap.semantics : 'unit-of-measure'
    OrderQuantityUnit : String(3);
    @sap.unit : 'OrderQuantityUnit'
    @sap.label : 'Released Quantity'
    ReleasedQuantity : Decimal(13, 3);
    @sap.unit : 'OrderQuantityUnit'
    @sap.label : 'Target Quantity'
    TargetQuantity : Decimal(13, 3);
    @sap.display.format : 'UpperCase'
    @sap.text : 'PurchaseContractType_Text'
    @sap.label : 'Purchasing Doc. Type'
    @sap.quickinfo : 'Purchasing Document Type'
    PurchaseContractType : String(4);
    @sap.label : 'Doc. Type Descript.'
    @sap.quickinfo : 'Short Description of Purchasing Document Type'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    PurchaseContractType_Text : String(20);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purch. Doc. Category'
    @sap.quickinfo : 'Purchasing Document Category'
    PurchasingDocumentCategory : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Plant'
    Plant : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Storage Location'
    StorageLocation : String(4);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.content.version : '1'
  @sap.label : 'Purchase Order Supplier Confirmation'
  entity C_PurOrdSuplrConfDisplay {
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purchase Order'
    @sap.quickinfo : 'Purchase Order Number'
    key PurchaseOrder : String(10) not null;
    @sap.display.format : 'NonNegative'
    @sap.label : 'Purchase Order Item'
    @sap.quickinfo : 'Item Number of Purchase Order'
    key PurchaseOrderItem : String(5) not null;
    @sap.display.format : 'NonNegative'
    @sap.label : 'Sequential Number'
    @sap.quickinfo : 'Sequential Number of Supplier Confirmation'
    key SequentialNmbrOfSuplrConf : String(4) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Confirm. Category'
    @sap.quickinfo : 'Confirmation Category'
    SupplierConfirmationCategory : String(2);
    @sap.display.format : 'Date'
    @sap.label : 'Delivery Date'
    @sap.quickinfo : 'Delivery Date of Supplier Confirmation'
    DeliveryDate : Date;
    @sap.label : 'Time'
    @sap.quickinfo : 'Delivery Date Time-Spot in Supplier Confirmation'
    DeliveryTime : Time;
    @sap.unit : 'PurchaseOrderQuantityUnit'
    @sap.label : 'Quantity'
    @sap.quickinfo : 'Quantity as Per Supplier Confirmation'
    ConfirmedQuantity : Decimal(13, 3);
    @sap.display.format : 'Date'
    @sap.label : 'Start Date'
    @sap.quickinfo : 'Start Date for Period of Performance'
    PerformancePeriodStartDate : Date;
    @sap.display.format : 'Date'
    @sap.label : 'End Date'
    @sap.quickinfo : 'End Date for Period of Performance'
    PerformancePeriodEndDate : Date;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Service Performer'
    ServicePerformer : String(10);
    @sap.label : 'Order Unit'
    @sap.quickinfo : 'Purchase Order Unit of Measure'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    @sap.semantics : 'unit-of-measure'
    PurchaseOrderQuantityUnit : String(3);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'PurOrd Tax Jurisdiction Value Help'
  entity C_PurOrdTaxJurisdictionValHelp {
    @sap.display.format : 'UpperCase'
    @sap.filter.restriction : 'single-value'
    @sap.label : 'Tax Jurisdiction'
    key TaxJurisdiction : String(15) not null;
    @sap.display.format : 'UpperCase'
    @sap.filter.restriction : 'single-value'
    @sap.label : 'Country/Region Key'
    key Country : String(3) not null;
    @sap.display.format : 'UpperCase'
    @sap.filter.restriction : 'single-value'
    @sap.label : 'Company Code'
    key CompanyCode : String(4) not null;
    @sap.display.format : 'UpperCase'
    @sap.filter.restriction : 'single-value'
    @sap.label : 'Procedure'
    @sap.quickinfo : 'Procedure (Pricing, Output Control, Acct. Det., Costing,...)'
    key TaxCalculationProcedure : String(6) not null;
    @sap.display.format : 'UpperCase'
    @sap.filter.restriction : 'single-value'
    @sap.label : 'Region'
    @sap.quickinfo : 'Region (State, Province, County)'
    Region : String(3);
    @sap.display.format : 'UpperCase'
    @sap.filter.restriction : 'single-value'
    @sap.label : 'Postal Code'
    @sap.quickinfo : 'City postal code'
    PostalCode : String(10);
    @sap.filter.restriction : 'single-value'
    @sap.label : 'City'
    CityName : String(40);
    @sap.filter.restriction : 'single-value'
    @sap.label : 'District'
    District : String(40);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'WBS Element Value Help'
  entity C_PurOrdWBSValHelp {
    @sap.display.format : 'UpperCase'
    @sap.text : 'WBSDescription'
    @sap.label : 'WBS Element'
    @sap.quickinfo : 'Work Breakdown Structure Element (WBS Element) Edited'
    key WBSElementExternalID : String(24) not null;
    @sap.display.format : 'NonNegative'
    @sap.label : 'WBS Internal ID'
    @sap.quickinfo : 'WBS Element'
    WBSElementInternalID : String(8);
    @sap.label : 'WBS Element Name'
    @sap.quickinfo : 'Work Breakdown Structure Element Name'
    WBSDescription : String(40);
    @sap.label : 'Project Name'
    @sap.quickinfo : 'Customer Project Name'
    ProjectName : String(40);
    @sap.label : 'Work Package Name'
    @sap.quickinfo : 'Plan Item Description'
    WorkPackageName : String(60);
    @sap.label : 'Name of Customer'
    CustomerName : String(80);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Company Code'
    @sap.value.list : 'standard'
    CompanyCode : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Engmnt Project ID'
    @sap.quickinfo : 'Engagement Project ID'
    EngagementProject : String(40);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Engmnt Project Type'
    @sap.quickinfo : 'Engagement Project Type'
    EngagementProjectType : String(19);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Service Organization'
    @sap.value.list : 'standard'
    EngagementProjectServiceOrg : String(5);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Project Type'
    EngagementProjectCategory : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Authorization Group'
    AuthorizationGroup : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purpose Completed'
    @sap.quickinfo : 'Business Purpose Completed Flag'
    IsBusinessPurposeCompleted : String(1);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.content.version : '1'
  @sap.label : 'Purchase Requisition Item'
  entity C_PurReqItemByPurOrder {
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purchase Requisition'
    @sap.quickinfo : 'Purchase Requisition Number'
    key PurchaseRequisition : String(10) not null;
    @sap.display.format : 'NonNegative'
    @sap.label : 'Requisn. item'
    @sap.quickinfo : 'Item number of purchase requisition'
    key PurchaseRequisitionItem : String(5) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purchasing Document'
    @sap.quickinfo : 'Purchasing Document Number'
    key PurchaseOrder : String(10) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Document Type'
    @sap.quickinfo : 'Purchase Requisition Document Type'
    PurchaseRequisitionType : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Plant'
    Plant : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purch. Organization'
    @sap.quickinfo : 'Purchasing Organization'
    PurchasingOrganization : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purchasing Group'
    PurchasingGroup : String(3);
    @sap.label : 'Short Text'
    PurchaseRequisitionItemText : String(40);
    @sap.display.format : 'UpperCase'
    @sap.text : 'MaterialGroup_Text'
    @sap.label : 'Material Group'
    MaterialGroup : String(9);
    @sap.label : 'Product Group Desc.'
    @sap.quickinfo : 'Product Group Description'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    MaterialGroup_Text : String(20);
    @sap.display.format : 'Date'
    @sap.label : 'Delivery Date'
    @sap.quickinfo : 'Item Delivery Date'
    DeliveryDate : Date;
    @sap.unit : 'BaseUnit'
    @sap.label : 'Quantity requested'
    @sap.quickinfo : 'Purchase requisition quantity'
    RequestedQuantity : Decimal(13, 3);
    @sap.label : 'Unit of Measure'
    @sap.quickinfo : 'Purchase requisition unit of measure'
    @sap.semantics : 'unit-of-measure'
    BaseUnit : String(3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Currency'
    @sap.quickinfo : 'Currency Key'
    @sap.semantics : 'currency-code'
    PurReqnItemCurrency : String(5);
    @sap.unit : 'PurReqnItemCurrency'
    @sap.label : 'Valuation Price'
    @sap.quickinfo : 'Price in Purchase Requisition'
    PurchaseRequisitionPrice : Decimal(12, 3);
    @sap.unit : 'PurReqnItemCurrency'
    @sap.label : 'Net Value'
    @sap.quickinfo : 'Purchase Requisition Item Total Amount'
    PurReqnItemTotalAmount : Decimal(16, 3);
    @sap.unit : 'BaseUnit'
    @sap.label : 'Price unit'
    PurReqnPriceQuantity : Decimal(5, 0);
    @sap.display.format : 'UpperCase'
    @sap.text : 'Material_Text'
    @sap.label : 'Material'
    @sap.quickinfo : 'Material Number'
    Material : String(40);
    @sap.label : 'Material Description'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    Material_Text : String(40);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.content.version : '1'
  @sap.label : 'Supplier Invoice'
  entity C_SuplInvPurOrdRef {
    @sap.display.format : 'UpperCase'
    @sap.label : 'Document Number'
    @sap.quickinfo : 'Document Number of an Accounting Document'
    key SupplierInvoice : String(10) not null;
    @sap.display.format : 'NonNegative'
    @sap.label : 'Fiscal Year'
    key FiscalYear : String(4) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purchasing Document'
    @sap.quickinfo : 'Purchasing Document Number'
    PurchaseOrder : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Invoice Number'
    @sap.quickinfo : 'Supplier Invoice ID within Fiscal Year'
    SupplierInvoiceWthnFiscalYear : String(17);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Company Code'
    CompanyCode : String(4);
    @sap.label : 'Document Header Text'
    DocumentHeaderText : String(25);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Currency'
    @sap.quickinfo : 'Currency Key'
    @sap.semantics : 'currency-code'
    DocumentCurrency : String(5);
    @sap.unit : 'DocumentCurrency'
    @sap.label : 'Gross Invoice Amount'
    @sap.quickinfo : 'Gross Invoice Amount in Document Currency'
    InvoiceGrossAmount : Decimal(14, 3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Reference'
    @sap.quickinfo : 'Reference Document Number'
    SupplierInvoiceIDByInvcgParty : String(16);
    @sap.display.format : 'Date'
    @sap.label : 'Invoice Date'
    @sap.quickinfo : 'Invoice Date in Document'
    DocumentDate : Date;
    @sap.display.format : 'Date'
    @sap.label : 'Posting Date'
    @sap.quickinfo : 'Posting Date in the Document'
    PostingDate : Date;
    @sap.display.format : 'Date'
    @sap.label : 'Baseline Date'
    @sap.quickinfo : 'Baseline Date for Due Date Calculation'
    DueCalculationBaseDate : Date;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Invoicing Party'
    @sap.quickinfo : 'Different Invoicing Party'
    InvoicingParty : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Invoice doc. status'
    @sap.quickinfo : 'Invoice document status'
    SupplierInvoiceStatus : String(1);
    @sap.label : 'Short Description'
    SupplierInvoiceStatusDesc : String(60);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Supplier Value Help with Org Data'
  entity C_SupplierPurchOrgVH {
    @sap.display.format : 'UpperCase'
    @sap.text : 'SupplierName'
    @sap.label : 'Supplier'
    @sap.quickinfo : 'Supplier''s Account Number'
    @sap.value.list : 'standard'
    key Supplier : String(10) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purch. Organization'
    @sap.quickinfo : 'Purchasing Organization'
    @sap.value.list : 'standard'
    key PurchasingOrganization : String(4) not null;
    @sap.label : 'Name of Supplier'
    SupplierName : String(80);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Country/Region Key'
    Country : String(3);
    @sap.label : 'City'
    CityName : String(40);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Postal Code'
    @sap.quickinfo : 'City postal code'
    PostalCode : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Region'
    @sap.quickinfo : 'Region (State, Province, County)'
    Region : String(3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Search Term'
    @sap.quickinfo : 'Sort field'
    SearchTerm : String(10);
    @sap.label : 'First Name'
    @sap.quickinfo : 'First Name of Business Partner (Person)'
    FirstName : String(40);
    @sap.label : 'Last Name'
    @sap.quickinfo : 'Last Name of Business Partner (Person)'
    LastName : String(40);
    @sap.label : 'Organization Name 1'
    @sap.quickinfo : 'Name 1 of organization'
    OrganizationBPName1 : String(40);
    @sap.label : 'Organization Name 2'
    @sap.quickinfo : 'Name 2 of organization'
    OrganizationBPName2 : String(40);
    @sap.label : 'Organization Name 3'
    @sap.quickinfo : 'Name 3 of organization'
    OrganizationBPName3 : String(40);
    @sap.label : 'Organization Name 4'
    @sap.quickinfo : 'Name 4 of organization'
    OrganizationBPName4 : String(40);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Account Assignment Category - Text'
  entity I_AcctAssignmentCategoryText {
    @sap.display.format : 'UpperCase'
    @sap.label : 'Acct Assignment Cat.'
    @sap.quickinfo : 'Account Assignment Category'
    key AccountAssignmentCategory : String(1) not null;
    @sap.label : 'Language Key'
    key Language : String(2) not null;
    @sap.label : 'Acct Assgnt. Cat. Desc.'
    @sap.quickinfo : 'Account Assignment Category Description'
    AcctAssignmentCategoryName : String(20);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.addressable : 'false'
  @sap.content.version : '1'
  @sap.label : 'Address'
  entity I_Address {
    @sap.display.format : 'UpperCase'
    @sap.label : 'Address Number'
    key AddressID : String(10) not null;
    @sap.label : 'Address UUID'
    @sap.quickinfo : 'UUID Used in the Address'
    AddressUUID : UUID;
    @sap.label : 'c/o'
    @sap.quickinfo : 'c/o name'
    CareOfName : String(40);
    @sap.label : 'Street 5'
    AdditionalStreetSuffixName : String(40);
    @sap.label : 'Language Key'
    CorrespondenceLanguage : String(2);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Comm. Method'
    @sap.quickinfo : 'Communication Method (Key) (Business Address Services)'
    PrfrdCommMediumType : String(3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'PO Box'
    POBox : String(10);
    @sap.label : 'PO Box w/o No.'
    @sap.quickinfo : 'Flag: PO Box Without Number'
    POBoxIsWithoutNumber : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.label : 'PO Box Postal Code'
    POBoxPostalCode : String(10);
    @sap.label : 'PO Box Lobby'
    POBoxLobbyName : String(40);
    @sap.label : 'PO Box City'
    @sap.quickinfo : 'PO Box city'
    POBoxDeviatingCityName : String(40);
    @sap.display.format : 'UpperCase'
    @sap.label : 'PO Box Region'
    @sap.quickinfo : 'Region for PO Box (Country/Region, State, Province, ...)'
    POBoxDeviatingRegion : String(3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'PO Box Ctry/Region'
    @sap.quickinfo : 'PO Box of Country/Region'
    POBoxDeviatingCountry : String(3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Delvry Serv Type'
    @sap.quickinfo : 'Type of Delivery Service'
    DeliveryServiceTypeCode : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Delivery Service No.'
    @sap.quickinfo : 'Number of Delivery Service'
    DeliveryServiceNumber : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Time Zone'
    @sap.quickinfo : 'Address Time Zone'
    AddressTimeZone : String(6);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Test stat./City file'
    @sap.quickinfo : 'City file test status'
    CityFileTestStatus : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Undeliverable'
    @sap.quickinfo : 'Street Address Undeliverable Flag'
    AddressStreetUnusable : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Undeliverable'
    @sap.quickinfo : 'PO Box Address Undeliverable Flag'
    AddressPostBoxUnusable : String(4);
    @sap.label : 'Full Name'
    @sap.quickinfo : 'Full name of a party (Bus. Partner, Org. Unit, Doc. address)'
    FullName : String(80);
    @sap.label : 'City'
    CityName : String(40);
    @sap.label : 'District'
    District : String(40);
    @sap.display.format : 'UpperCase'
    @sap.label : 'City Code'
    @sap.quickinfo : 'City code for city/street file'
    CityCode : String(12);
    @sap.label : 'Different City'
    @sap.quickinfo : 'City (different from postal city)'
    HomeCityName : String(40);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Postal Code'
    @sap.quickinfo : 'City postal code'
    PostalCode : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Company Postal Code'
    @sap.quickinfo : 'Company Postal Code (for Large Customers)'
    CompanyPostalCode : String(10);
    @sap.label : 'Street'
    StreetName : String(60);
    @sap.label : 'Street 2'
    StreetPrefixName : String(40);
    @sap.label : 'Street 3'
    AdditionalStreetPrefixName : String(40);
    @sap.label : 'Street 4'
    StreetSuffixName : String(40);
    @sap.label : 'House Number'
    HouseNumber : String(10);
    @sap.label : 'Supplement'
    @sap.quickinfo : 'House number supplement'
    HouseNumberSupplementText : String(10);
    @sap.label : 'Building Code'
    @sap.quickinfo : 'Building (Number or Code)'
    Building : String(20);
    @sap.label : 'Floor'
    @sap.quickinfo : 'Floor in Building'
    Floor : String(10);
    @sap.label : 'Room Number'
    @sap.quickinfo : 'Room or Apartment Number'
    RoomNumber : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Country/Region Key'
    Country : String(3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Region'
    @sap.quickinfo : 'Region (State, Province, County)'
    Region : String(3);
    @sap.label : 'County'
    County : String(40);
    @sap.display.format : 'UpperCase'
    @sap.label : 'County code'
    @sap.quickinfo : 'County code for county'
    CountyCode : String(8);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Township code'
    @sap.quickinfo : 'Township code for Township'
    TownshipCode : String(8);
    @sap.label : 'Township'
    TownshipName : String(40);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Title Key'
    @sap.quickinfo : 'Form-of-Address Key'
    FormOfAddress : String(4);
    @sap.label : 'Name'
    @sap.quickinfo : 'Name 1'
    BusinessPartnerName1 : String(40);
    @sap.label : 'Name 2'
    BusinessPartnerName2 : String(40);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Address Version'
    @sap.quickinfo : 'Version ID for International Addresses'
    Nation : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Telephone'
    @sap.quickinfo : 'First Telephone No.: Dialing Code + Number'
    PhoneNumber : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Fax'
    @sap.quickinfo : 'First Fax No.: Area Code + Number'
    FaxNumber : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Search Term 1'
    SearchTerm1 : String(20);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Search Term 2'
    SearchTerm2 : String(20);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Street'
    @sap.quickinfo : 'Street Name in Uppercase for Search Help'
    StreetSearch : String(25);
    @sap.display.format : 'UpperCase'
    @sap.label : 'City'
    @sap.quickinfo : 'City name in Uppercase for Search Help'
    CitySearch : String(25);
    @sap.label : 'Name 3'
    BusinessPartnerName3 : String(40);
    @sap.label : 'Name 4'
    BusinessPartnerName4 : String(40);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Tax Jurisdiction'
    TaxJurisdiction : String(15);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Transportation Zone'
    @sap.quickinfo : 'Transportation zone to or from which the goods are delivered'
    TransportZone : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'City Code'
    @sap.quickinfo : 'City PO box code (City file)'
    AddressCityPostBoxCode : String(12);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Person Number'
    Person : String(10);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Asset Class'
  entity I_AssetClassStdVH {
    @sap.display.format : 'UpperCase'
    @sap.text : 'AssetClass_Text'
    @sap.label : 'Asset Class'
    key AssetClass : String(8) not null;
    @sap.label : 'Short Text'
    @sap.quickinfo : 'Short Text for Asset Class Name'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    AssetClass_Text : String(20);
    to_Text : Association to many I_AssetClassText {  };
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Asset Class - Text'
  entity I_AssetClassText {
    @sap.display.format : 'UpperCase'
    @sap.label : 'Asset Class'
    key AssetClass : String(8) not null;
    @sap.label : 'Language Key'
    key Language : String(2) not null;
    @sap.label : 'Short Text'
    @sap.quickinfo : 'Short Text for Asset Class Name'
    AssetClassName : String(20);
    @sap.label : 'Description'
    @sap.quickinfo : 'Asset class description'
    AssetClassDescription : String(50);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Batch'
  entity I_BatchVH {
    @sap.display.format : 'UpperCase'
    @sap.label : 'Plant'
    key Plant : String(4) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Material'
    @sap.quickinfo : 'Material Number'
    @sap.value.list : 'standard'
    key Material : String(40) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Batch'
    @sap.quickinfo : 'Batch Number'
    key Batch : String(10) not null;
    @sap.label : 'Batch Deletion Flag'
    @sap.quickinfo : 'Deletion Flag for All Data in a Batch'
    BatchIsMarkedForDeletion : Boolean;
    @sap.label : 'Batch Restricted'
    @sap.quickinfo : 'Batch in Restricted-Use Stock'
    MatlBatchIsInRstrcdUseStock : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Supplier'
    @sap.quickinfo : 'Supplier''s Account Number'
    @sap.value.list : 'standard'
    Supplier : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Supplier Batch'
    @sap.quickinfo : 'Supplier Batch Number'
    BatchBySupplier : String(15);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Cntry/Reg of Origin'
    @sap.quickinfo : 'Country/Region of Origin of Material (Non-Preferential Ori.)'
    CountryOfOrigin : String(3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Region of Origin'
    @sap.quickinfo : 'Region of Origin of Material (Non-Preferential Origin)'
    RegionOfOrigin : String(3);
    @sap.display.format : 'Date'
    @sap.label : 'Available from'
    @sap.quickinfo : 'Availability date'
    MatlBatchAvailabilityDate : Date;
    @sap.display.format : 'Date'
    @sap.label : 'SLED/BBD'
    @sap.quickinfo : 'Shelf Life Expiration or Best-Before Date'
    ShelfLifeExpirationDate : Date;
    @sap.display.format : 'Date'
    @sap.label : 'Date of Manufacture'
    ManufactureDate : Date;
    @sap.display.format : 'Date'
    @sap.label : 'Date for Free Use 1'
    FreeDefinedDate1 : Date;
    @sap.display.format : 'Date'
    @sap.label : 'Date for Free Use 2'
    FreeDefinedDate2 : Date;
    @sap.display.format : 'Date'
    @sap.label : 'Date for Free Use 3'
    FreeDefinedDate3 : Date;
    @sap.display.format : 'Date'
    @sap.label : 'Date for Free Use 4'
    FreeDefinedDate4 : Date;
    @sap.display.format : 'Date'
    @sap.label : 'Date for Free Use 5'
    FreeDefinedDate5 : Date;
    @sap.display.format : 'Date'
    @sap.label : 'Date for Free Use 6'
    FreeDefinedDate6 : Date;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Batch Definition'
    @sap.quickinfo : 'Indicator: definition of batch management level'
    DefinitionOfBatchLevel : String(1);
    @odata.Type : 'Edm.DateTimeOffset'
    @odata.Precision : 7
    @sap.label : 'Created On'
    @sap.quickinfo : 'Created On Timestamp'
    CreationDateTime : Timestamp;
    @odata.Type : 'Edm.DateTimeOffset'
    @odata.Precision : 7
    @sap.label : 'Last Change'
    @sap.quickinfo : 'Last Change Timestamp'
    LastChangeDateTime : Timestamp;
    @sap.display.format : 'NonNegative'
    @sap.label : 'Internal Object No.'
    @sap.quickinfo : 'Internal object no.: Batch classification'
    ClfnObjectInternalID : String(18);
    @sap.label : 'Batch ID'
    BatchExtWhseMgmtInternalId : UUID;
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Customers by Multiple Addresses'
  @sap.value.list : 'true'
  entity I_BPCustomerMultiAddrVH {
    @sap.display.format : 'UpperCase'
    @sap.label : 'Address Number'
    key AddressID : String(10) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Business Partner'
    @sap.quickinfo : 'Business Partner Number'
    key BusinessPartner : String(10) not null;
    @sap.display.format : 'UpperCase'
    @sap.text : 'CustomerName'
    @sap.label : 'Customer'
    @sap.quickinfo : 'Customer Number'
    key Customer : String(10) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Country/Region Key'
    Country : String(3);
    @sap.label : 'City'
    CityName : String(40);
    @sap.label : 'Street'
    StreetName : String(60);
    @sap.label : 'House Number'
    HouseNumber : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Postal Code'
    @sap.quickinfo : 'City postal code'
    PostalCode : String(10);
    @sap.label : 'TRUE'
    @sap.quickinfo : 'Standard Address Indicator'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    StandardUsage : Boolean;
    @sap.label : 'Customer Name'
    @sap.quickinfo : 'Name of Customer'
    CustomerName : String(80);
    @sap.label : 'Customer Name'
    BPCustomerName : String(81);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Account group'
    @sap.quickinfo : 'Customer Account Group'
    CustomerAccountGroup : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Authorization'
    @sap.quickinfo : 'Authorization Group'
    AuthorizationGroup : String(4);
    @sap.label : 'Purpose Completed'
    @sap.quickinfo : 'Business Purpose Completed Flag'
    IsBusinessPurposeCompleted : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.label : 'BP Type'
    @sap.quickinfo : 'Business Partner Type'
    BusinessPartnerType : String(4);
    @sap.display.format : 'Date'
    AddressValidityStartDate : Date;
    @sap.display.format : 'Date'
    AddressValidityEndDate : Date;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Address Type'
    AddressUsage : String(10);
    @sap.label : 'Name 1'
    @sap.quickinfo : 'Name'
    OrganizationBPName1 : String(35);
    @sap.label : 'Name 1'
    BusinessPartnerName1 : String(40);
    @sap.label : 'Name 2'
    OrganizationBPName2 : String(35);
    @sap.label : 'Name 2'
    BusinessPartnerName2 : String(40);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Search Term 1'
    AddressSearchTerm1 : String(20);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Search Term 2'
    AddressSearchTerm2 : String(20);
    @sap.label : 'Truth Value'
    @sap.quickinfo : 'Truth Value: True/False'
    BusPartAddrLayoutStdIsHidden : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Data Ctrlr. Set'
    @sap.quickinfo : 'BP: Data Controller Set Flag'
    DataControllerSet : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Data Controller'
    @sap.quickinfo : 'BP: Data Controller (Internal Use Only)'
    DataController1 : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Data Controller'
    @sap.quickinfo : 'BP: Data Controller (Internal Use Only)'
    DataController2 : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Data Controller'
    @sap.quickinfo : 'BP: Data Controller (Internal Use Only)'
    DataController3 : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Data Controller'
    @sap.quickinfo : 'BP: Data Controller (Internal Use Only)'
    DataController4 : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Data Controller'
    @sap.quickinfo : 'BP: Data Controller (Internal Use Only)'
    DataController5 : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Data Controller'
    @sap.quickinfo : 'BP: Data Controller (Internal Use Only)'
    DataController6 : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Data Controller'
    @sap.quickinfo : 'BP: Data Controller (Internal Use Only)'
    DataController7 : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Data Controller'
    @sap.quickinfo : 'BP: Data Controller (Internal Use Only)'
    DataController8 : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Data Controller'
    @sap.quickinfo : 'BP: Data Controller (Internal Use Only)'
    DataController9 : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Data Controller'
    @sap.quickinfo : 'BP: Data Controller (Internal Use Only)'
    DataController10 : String(30);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Budget Period'
  @sap.value.list : 'true'
  entity I_BudgetPeriodStdVH {
    @sap.display.format : 'UpperCase'
    @sap.text : 'BudgetPeriodName'
    @sap.label : 'Budget Period'
    key BudgetPeriod : String(10) not null;
    @sap.label : 'Budget Period Name'
    BudgetPeriodName : String(35);
    @sap.display.format : 'Date'
    @sap.filter.restriction : 'single-value'
    @sap.label : 'Valid From'
    @sap.quickinfo : 'Budget Period Valid From'
    ValidityStartDate : Date;
    @sap.display.format : 'Date'
    @sap.filter.restriction : 'single-value'
    @sap.label : 'Valid To'
    @sap.quickinfo : 'Budget Period Valid To'
    ValidityEndDate : Date;
    @sap.display.format : 'Date'
    @sap.filter.restriction : 'single-value'
    @sap.label : 'Expiration Date'
    @sap.quickinfo : 'Budget Period Expiration Date'
    BudgetPeriodExpirationDate : Date;
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Business Area'
  @sap.value.list : 'true'
  entity I_BusinessAreaStdVH {
    @sap.display.format : 'UpperCase'
    @sap.text : 'BusinessArea_Text'
    @sap.label : 'Business Area'
    key BusinessArea : String(4) not null;
    @sap.label : 'Business Area Name'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    BusinessArea_Text : String(30);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.content.version : '1'
  @sap.label : 'Business Partner'
  entity I_BusinessPartner {
    @sap.display.format : 'UpperCase'
    @sap.text : 'BusinessPartnerName'
    @sap.label : 'Business Partner'
    @sap.quickinfo : 'Business Partner Number'
    key BusinessPartner : String(10) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'BP Category'
    @sap.quickinfo : 'Business Partner Category'
    BusinessPartnerCategory : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Authorization Group'
    AuthorizationGroup : String(4);
    @sap.label : 'BP GUID'
    @sap.quickinfo : 'Business Partner GUID'
    BusinessPartnerUUID : UUID;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Person Number'
    PersonNumber : String(10);
    ETag : String(26);
    @sap.label : 'Business Partner Name'
    @sap.quickinfo : 'Name of Business Partner'
    BusinessPartnerName : String(81);
    @sap.label : 'Business Partner Full Name'
    BusinessPartnerFullName : String(81);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Created by'
    @sap.quickinfo : 'User who created the object'
    CreatedByUser : String(12);
    @sap.display.format : 'Date'
    @sap.label : 'Created On'
    @sap.quickinfo : 'Date on which the object was created'
    CreationDate : Date;
    @sap.label : 'Created at'
    @sap.quickinfo : 'Time at which the object was created'
    CreationTime : Time;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Changed by'
    @sap.quickinfo : 'Last user to change object'
    LastChangedByUser : String(12);
    @sap.display.format : 'Date'
    @sap.label : 'Changed on'
    @sap.quickinfo : 'Date when object was last changed'
    LastChangeDate : Date;
    @sap.label : 'Changed at'
    @sap.quickinfo : 'Time at which object was last changed'
    LastChangeTime : Time;
    @sap.label : 'Central Block'
    @sap.quickinfo : 'Central Block for Business Partner'
    BusinessPartnerIsBlocked : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purpose Completed'
    @sap.quickinfo : 'Business Purpose Completed Flag'
    IsBusinessPurposeCompleted : String(1);
    @sap.label : 'First Name'
    @sap.quickinfo : 'First Name of Business Partner (Person)'
    FirstName : String(40);
    @sap.label : 'Last Name'
    @sap.quickinfo : 'Last Name of Business Partner (Person)'
    LastName : String(40);
    @sap.label : 'Full Name'
    PersonFullName : String(80);
    @sap.label : 'Organization Name 1'
    @sap.quickinfo : 'Name 1 of organization'
    OrganizationBPName1 : String(40);
    @sap.label : 'Organization Name 2'
    @sap.quickinfo : 'Name 2 of organization'
    OrganizationBPName2 : String(40);
    @sap.label : 'Organization Name 3'
    @sap.quickinfo : 'Name 3 of organization'
    OrganizationBPName3 : String(40);
    @sap.label : 'Organization Name 4'
    @sap.quickinfo : 'Name 4 of organization'
    OrganizationBPName4 : String(40);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Int. location no. 1'
    @sap.quickinfo : 'International location number (part 1)'
    InternationalLocationNumber1 : String(7);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Int. location no. 2'
    @sap.quickinfo : 'International location number (Part 2)'
    InternationalLocationNumber2 : String(5);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Check digit'
    @sap.quickinfo : 'Check digit for the international location number'
    InternationalLocationNumber3 : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Legal form'
    @sap.quickinfo : 'BP: Legal form of organization'
    LegalForm : String(2);
    @sap.display.format : 'Date'
    @sap.label : 'Date founded'
    @sap.quickinfo : 'Date organization founded'
    OrganizationFoundationDate : Date;
    @sap.display.format : 'Date'
    @sap.label : 'Liquidation date'
    @sap.quickinfo : 'Liquidation date of organization'
    OrganizationLiquidationDate : Date;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Industry sector'
    Industry : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Natural Person'
    @sap.quickinfo : 'Business Partner Is a Natural Person Under the Tax Laws'
    IsNaturalPerson : String(1);
    @sap.label : 'Female'
    @sap.quickinfo : 'Selection: Business partner is female'
    IsFemale : Boolean;
    @sap.label : 'Male'
    @sap.quickinfo : 'Selection: Business partner is male'
    IsMale : Boolean;
    @sap.label : 'Unknown'
    @sap.quickinfo : 'Selection: Sex of business partner is not known'
    IsSexUnknown : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Title Key'
    @sap.quickinfo : 'Form-of-Address Key'
    FormOfAddress : String(4);
    @sap.display.format : 'UpperCase'
    @sap.text : 'AcademicTitle_Text'
    @sap.label : 'Academic Title 1'
    @sap.quickinfo : 'Academic Title: Key'
    AcademicTitle : String(4);
    @sap.label : 'Academic Title Description'
    @sap.quickinfo : 'Title Description'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    AcademicTitle_Text : String(40);
    @sap.display.format : 'UpperCase'
    @sap.label : '2nd academic title'
    @sap.quickinfo : 'Second academic title (key)'
    AcademicTitle2 : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Name Format'
    @sap.quickinfo : 'Name format'
    NameFormat : String(2);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Ctry/Reg. for Format'
    @sap.quickinfo : 'Country/Region for Name Format Rule'
    NameCountry : String(3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Grouping'
    @sap.quickinfo : 'Business Partner Grouping'
    BusinessPartnerGrouping : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'BP Type'
    @sap.quickinfo : 'Business Partner Type'
    BusinessPartnerType : String(4);
    @sap.label : 'Middle Name'
    @sap.quickinfo : 'Middle name or second forename of a person'
    MiddleName : String(40);
    @sap.label : 'Other Last Name'
    @sap.quickinfo : 'Other Last Name of a Person'
    AdditionalLastName : String(40);
    @sap.label : 'Group Name 1'
    @sap.quickinfo : 'Name 1 (group)'
    GroupBusinessPartnerName1 : String(40);
    @sap.label : 'Group Name 2'
    @sap.quickinfo : 'Name 2 (group)'
    GroupBusinessPartnerName2 : String(40);
    @sap.label : 'Correspondence lang.'
    @sap.quickinfo : 'Business Partner: Correspondence Language'
    CorrespondenceLanguage : String(2);
    @sap.label : 'Language'
    @sap.quickinfo : 'Business partner: Language'
    Language : String(2);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Search Term 1'
    @sap.quickinfo : 'Search Term 1 for Business Partner'
    SearchTerm1 : String(20);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Search Term 2'
    @sap.quickinfo : 'Search Term 2 for Business Partner'
    SearchTerm2 : String(20);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Name 1/Last Name'
    @sap.quickinfo : 'Search Help Field 1 (Name 1/Last Name)'
    BPLastNameSearchHelp : String(35);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Name 2/First Name'
    @sap.quickinfo : 'Search Help Field 2 (Name 2/First Name)'
    BPFirstNameSearchHelp : String(35);
    @sap.label : 'Known As'
    @sap.quickinfo : 'Nickname of Business Partner (Person)'
    BusinessPartnerNicknameLabel : String(40);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Address Number'
    IndependentAddressID : String(10);
    @sap.label : 'Is active'
    @sap.quickinfo : 'Draft - Indicator - Is active document'
    IsActiveEntity : Boolean;
    @sap.display.format : 'Date'
    @sap.label : 'Date of Birth'
    @sap.quickinfo : 'Date of Birth of Business Partner'
    BirthDate : Date;
    @sap.label : 'Archiving Flag'
    @sap.quickinfo : 'Central Archiving Flag'
    IsMarkedForArchiving : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Contact'
    @sap.quickinfo : 'Business Partner: Contact Permission'
    ContactPermission : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Ext. Partner Number'
    @sap.quickinfo : 'Business Partner Number in External System'
    BusinessPartnerIDByExtSystem : String(20);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Legal entity'
    @sap.quickinfo : 'Legal Entity of Organization'
    LegalEntityOfOrganization : String(2);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Print Format'
    @sap.quickinfo : 'Business Partner Print Format'
    BusinessPartnerPrintFormat : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Data Origin'
    @sap.quickinfo : 'Data Origin Types'
    BusinessPartnerDataOriginType : String(4);
    @sap.label : 'Not Released'
    @sap.quickinfo : 'Indicator: Not Released'
    BusinessPartnerIsNotReleased : Boolean;
    @sap.label : 'Not Legally Competnt'
    @sap.quickinfo : 'Indicator: Not Legally Competent'
    IsNotContractuallyCapable : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Occupation'
    @sap.quickinfo : 'Occupation/group'
    BusinessPartnerOccupation : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Marital Status'
    @sap.quickinfo : 'Marital Status of Business Partner'
    BusPartMaritalStatus : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Nationality'
    BusPartNationality : String(3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Ctry/Reg. of Origin'
    @sap.quickinfo : 'Country/Region of Origin: Non-Resident Companies'
    NonResidentCompanyOriginCntry : String(3);
    @sap.label : 'Salutation'
    BusinessPartnerSalutation : String(50);
    @sap.label : 'Name at Birth'
    @sap.quickinfo : 'Name at birth of business partner'
    BusinessPartnerBirthName : String(40);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Name Supplement'
    @sap.quickinfo : 'Name supplement, e.g. noble title (key)'
    BusinessPartnerSupplementName : String(4);
    @sap.label : 'Birthplace'
    @sap.quickinfo : 'Birthplace of business partner'
    BusinessPartnerBirthplaceName : String(40);
    @sap.label : 'Employer'
    @sap.quickinfo : 'Name of Employer of a Natural Person'
    NaturalPersonEmployerName : String(35);
    @sap.display.format : 'Date'
    @sap.label : 'Death date'
    @sap.quickinfo : 'Date of death of business partner'
    BusinessPartnerDeathDate : Date;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Birth Date Status'
    @sap.quickinfo : 'Date of Birth: Status'
    BusinessPartnerBirthDateStatus : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Partner group type'
    @sap.quickinfo : 'Group type'
    BusinessPartnerGroupType : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Prefix Key'
    @sap.quickinfo : 'Name Prefix (Key)'
    LastNamePrefix : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : '2nd prefix'
    @sap.quickinfo : '2nd name prefix (key)'
    LastNameSecondPrefix : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Initials'
    @sap.quickinfo : '&quot;Middle Initial&quot; or personal initials'
    Initials : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Sex'
    @sap.quickinfo : 'Gender of Business Partner (Person)'
    GenderCodeName : String(1);
    @sap.label : 'DC Not Required'
    @sap.quickinfo : 'BP: Data Controller Not Required'
    BPDataControllerIsNotRequired : Boolean;
    @sap.label : 'Military use'
    @sap.quickinfo : 'ID for mainly military use'
    TrdCmplncLicenseIsMilitarySctr : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Nuclear Sector'
    @sap.quickinfo : 'Nuclear Sector (Indicator)'
    TrdCmplncLicenseIsNuclearSctr : String(1);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.content.version : '1'
  @sap.label : 'Core CDS view of Supplier Company Code'
  entity I_BusinessPartnerSuplrCo {
    @sap.display.format : 'UpperCase'
    @sap.label : 'Business Partner'
    @sap.quickinfo : 'Business Partner Number'
    key BusinessPartner : String(10) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Company Code'
    @sap.value.list : 'standard'
    key CompanyCode : String(4) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Supplier'
    @sap.quickinfo : 'Account Number of Supplier'
    @sap.value.list : 'standard'
    Supplier : String(10);
    @sap.label : 'BP GUID'
    @sap.quickinfo : 'Business Partner GUID'
    BusinessPartnerUUID : UUID;
    @sap.label : 'Co.code post.block'
    @sap.quickinfo : 'Posting block for company code'
    SupplierIsBlockedForPosting : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Authorization'
    @sap.quickinfo : 'Authorization Group'
    AuthorizationGroup : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Clerk Abbrev.'
    @sap.quickinfo : 'Accounting Clerk Abbreviation'
    AccountingClerk : String(2);
    @sap.label : 'Clerk at vendor'
    SupplierClerk : String(15);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Acct.clerks tel.no.'
    @sap.quickinfo : 'Accounting clerk''s telephone number at business partner'
    AccountingClerkPhoneNumber : String(30);
    @sap.label : 'Acctg clerk''s fax'
    @sap.quickinfo : 'Accounting clerk''s fax number at the customer/vendor'
    AccountingClerkFaxNumber : String(31);
    @sap.label : 'Clrk''s internet add.'
    @sap.quickinfo : 'Internet address of partner company clerk'
    AccountingClerkInternetAddress : String(130);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Account with vendor'
    @sap.quickinfo : 'Our account number with the vendor'
    SupplierClerkIDBySupplier : String(12);
    @sap.label : 'Local Processing'
    @sap.quickinfo : 'Indicator: Local Processing?'
    IsToBeLocallyProcessed : Boolean;
    @sap.label : 'Account Memo'
    @sap.quickinfo : 'Memo'
    SupplierAccountNote : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Terms of Payment'
    @sap.quickinfo : 'Terms of Payment Key'
    PaymentTerms : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Tolerance Group'
    @sap.quickinfo : 'Tolerance Group for Business Partner/G/L Account'
    APARToleranceGroup : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Tolerance Group'
    @sap.quickinfo : 'Tolerance Group in Invoice Verification'
    SuplrInvcVerificatTolGroup : String(4);
    @sap.label : 'Check Cashing Time'
    @sap.quickinfo : 'Probable Time Until Check Is Paid'
    CheckPaidDurationInDays : Decimal(3, 0);
    @sap.label : 'Check Double Invoice'
    @sap.quickinfo : 'Check Flag for Double Invoices or Credit Memos'
    IsDoubleInvoice : Boolean;
    @sap.label : 'Clearing with cust.'
    @sap.quickinfo : 'Indicator: Clearing between customer and vendor?'
    CustomerSupplierClearingIsUsed : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Reconciliation acct'
    @sap.quickinfo : 'Reconciliation Account in General Ledger'
    ReconciliationAccount : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Head Office'
    @sap.quickinfo : 'Head Office Account Number'
    SupplierHeadOffice : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Sort key'
    @sap.quickinfo : 'Key for sorting according to assignment numbers'
    LayoutSortingRule : String(3);
    @sap.display.format : 'Date'
    @sap.label : 'Certification Date'
    SupplierCertificationDate : Date;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Payment Methods'
    @sap.quickinfo : 'List of Respected Payment Methods'
    PaymentMethodsList : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Planning Group'
    CashPlanningGroup : String(10);
    @sap.display.format : 'UpperCase'
    @sap.text : 'PaymentBlockingReason_Text'
    @sap.label : 'Payment Block'
    @sap.quickinfo : 'Block Key for Payment'
    PaymentBlockingReason : String(1);
    @sap.label : 'Payment Block Reason'
    @sap.quickinfo : 'Reason for Payment Block'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    PaymentBlockingReason_Text : String(20);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Alternative payee'
    @sap.quickinfo : 'Account number of the alternative payee'
    AlternativePayee : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'House Bank'
    @sap.quickinfo : 'Short Key for a House Bank'
    HouseBank : String(5);
    @sap.unit : 'Currency'
    @sap.label : 'Bill/Ex. Limit'
    @sap.quickinfo : 'Bill of Exchange Limit (in Local Currency)'
    BillOfExchLmtAmtInCoCodeCrcy : Decimal(14, 3);
    @sap.label : 'Individual Payment'
    @sap.quickinfo : 'Indicator: Pay All Items Separately?'
    ItemIsToBePaidSeparately : Boolean;
    @sap.label : 'Pmnt advice by EDI'
    @sap.quickinfo : 'Indicator: Send Payment Advices by EDI'
    PaymentIsToBeSentByEDI : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.label : 'WTax C/R Key'
    @sap.quickinfo : 'Withholding Tax Country/Region Key'
    WithholdingTaxCountry : String(3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Interest Indicator'
    InterestCalculationCode : String(2);
    @sap.display.format : 'Date'
    @sap.label : 'Last Key Date'
    @sap.quickinfo : 'Key Date of Last Interest Calculation'
    InterestCalculationDate : Date;
    @sap.display.format : 'NonNegative'
    @sap.label : 'Int.Calc.Freq.'
    @sap.quickinfo : 'Interest Calculation Frequency in Months'
    IntrstCalcFrequencyInMonths : String(2);
    @sap.display.format : 'Date'
    @sap.label : 'Last Int. Calc.'
    @sap.quickinfo : 'Date of Last Interest Calculation Run'
    LastInterestCalcRunDate : Date;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Release Group'
    @sap.quickinfo : 'Release Approval Group'
    SupplierReleaseGroup : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Credit Memo Pyt Term'
    @sap.quickinfo : 'Payment Terms Key for Credit Memos'
    CreditMemoPaymentTerms : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Pmt Meth. Supplement'
    @sap.quickinfo : 'Payment method supplement'
    PaymentMethodSupplement : String(2);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Payment Clrg Grp ID'
    @sap.quickinfo : 'Payment Clearing Group ID'
    PaymentClearingGroup : String(8);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Previous Account No.'
    @sap.quickinfo : 'Previous Master Record Number'
    PreviousAccountNumber : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Payment Reason'
    PaymentReason : String(4);
    @sap.label : 'CoCd deletion block'
    @sap.quickinfo : 'Deletion Block for Master Record (Company Code Level)'
    DeletionIsBlocked : Boolean;
    @sap.display.format : 'NonNegative'
    @sap.label : 'Personnel Number'
    PersonnelNumber : String(8);
    @sap.label : 'Co.Cde Deletion Flag'
    @sap.quickinfo : 'Deletion Flag for Master Record (Company Code Level)'
    DeletionIndicator : Boolean;
    @sap.label : 'Ext. Withholding Tax'
    @sap.quickinfo : 'Indicator: Extended Withholding Tax Active'
    ExtendedWhldgTaxIsActive : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Country/Region Key'
    Country : String(3);
    @sap.label : 'Company Name'
    @sap.quickinfo : 'Name of Company Code or Company'
    CompanyCodeName : String(25);
    @sap.label : 'Is active'
    @sap.quickinfo : 'Draft - Indicator - Is active document'
    IsActiveEntity : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purpose Completed'
    @sap.quickinfo : 'Business Purpose Completed Flag'
    IsBusinessPurposeCompleted : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Currency'
    @sap.quickinfo : 'Currency Key'
    @sap.semantics : 'currency-code'
    Currency : String(5);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Minority Indicator'
    MinorityGroup : String(3);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Business Partner'
  @sap.value.list : 'true'
  entity I_BusinessPartnerVH {
    @sap.display.format : 'UpperCase'
    @sap.text : 'BusinessPartnerName'
    @sap.label : 'Business Partner'
    @sap.quickinfo : 'Business Partner Number'
    key BusinessPartner : String(10) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Title Key'
    @sap.quickinfo : 'Form-of-Address Key'
    FormOfAddress : String(4);
    @sap.label : 'Title'
    FormOfAddressName : String(30);
    @sap.label : 'Business Partner Name'
    BusinessPartnerName : String(81);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Business Partner Category'
    BusinessPartnerCategory : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Ext. Partner Number'
    @sap.quickinfo : 'Business Partner Number in External System'
    BusinessPartnerIDByExtSystem : String(20);
    @sap.label : 'First Name'
    @sap.quickinfo : 'First Name of Business Partner (Person)'
    FirstName : String(40);
    @sap.label : 'Last Name'
    @sap.quickinfo : 'Last Name of Business Partner (Person)'
    LastName : String(40);
    @sap.label : 'Organization Name 1'
    @sap.quickinfo : 'Name 1 of organization'
    OrganizationBPName1 : String(40);
    @sap.label : 'Group Name 1'
    @sap.quickinfo : 'Name 1 (group)'
    GroupBusinessPartnerName1 : String(40);
    @sap.display.format : 'Date'
    @sap.label : 'Date of Birth'
    @sap.quickinfo : 'Date of Birth of Business Partner'
    BirthDate : Date;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Authorization Group'
    AuthorizationGroup : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purpose Completed'
    @sap.quickinfo : 'Business Purpose Completed Flag'
    IsBusinessPurposeCompleted : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Data Ctrlr. Set'
    @sap.quickinfo : 'BP: Data Controller Set Flag'
    DataControllerSet : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Data Controller'
    @sap.quickinfo : 'BP: Data Controller (Internal Use Only)'
    DataController1 : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Data Controller'
    @sap.quickinfo : 'BP: Data Controller (Internal Use Only)'
    DataController2 : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Data Controller'
    @sap.quickinfo : 'BP: Data Controller (Internal Use Only)'
    DataController3 : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Data Controller'
    @sap.quickinfo : 'BP: Data Controller (Internal Use Only)'
    DataController4 : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Data Controller'
    @sap.quickinfo : 'BP: Data Controller (Internal Use Only)'
    DataController5 : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Data Controller'
    @sap.quickinfo : 'BP: Data Controller (Internal Use Only)'
    DataController6 : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Data Controller'
    @sap.quickinfo : 'BP: Data Controller (Internal Use Only)'
    DataController7 : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Data Controller'
    @sap.quickinfo : 'BP: Data Controller (Internal Use Only)'
    DataController8 : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Data Controller'
    @sap.quickinfo : 'BP: Data Controller (Internal Use Only)'
    DataController9 : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Data Controller'
    @sap.quickinfo : 'BP: Data Controller (Internal Use Only)'
    DataController10 : String(30);
    to_FormOfAddressText : Association to I_FormOfAddressText {  };
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Business User - Value Help'
  @sap.value.list : 'true'
  entity I_BusinessUserVH {
    @sap.display.format : 'UpperCase'
    @sap.text : 'PersonFullName'
    @sap.label : 'Person ID'
    @sap.quickinfo : 'Business Partner Number'
    key BusinessPartner : String(10) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Person External ID'
    @sap.quickinfo : 'Identification Number'
    BPIdentificationNumber : String(60);
    @sap.display.format : 'UpperCase'
    @sap.text : 'PersonFullName'
    @sap.label : 'User ID'
    UserID : String(12);
    @sap.label : 'First Name'
    @sap.quickinfo : 'First Name of Business Partner (Person)'
    FirstName : String(40);
    @sap.label : 'Last Name'
    @sap.quickinfo : 'Last Name of Business Partner (Person)'
    LastName : String(40);
    @sap.label : 'Email Address'
    @sap.quickinfo : 'E-Mail Address'
    DefaultEmailAddress : String(241);
    @sap.label : 'Full Name'
    @sap.quickinfo : 'User Description'
    PersonFullName : String(80);
    @sap.label : 'Building'
    @sap.quickinfo : 'Building (number or code)'
    Building : String(10);
    @sap.label : 'Room Number'
    @sap.quickinfo : 'Room or Apartment Number'
    RoomNumber : String(10);
    @sap.label : 'Department'
    Department : String(40);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purpose Completed'
    @sap.quickinfo : 'Business Purpose Completed Flag'
    IsBusinessPurposeCompleted : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Authorization Group'
    AuthorizationGroup : String(4);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Chart Of Accounts'
  @sap.value.list : 'true'
  entity I_ChartOfAccountsStdVH {
    @sap.display.format : 'UpperCase'
    @sap.text : 'ChartOfAccounts_Text'
    @sap.label : 'Chart of Accounts'
    key ChartOfAccounts : String(4) not null;
    @sap.label : 'Chart of Accounts Description'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    ChartOfAccounts_Text : String(50);
    to_Text : Association to many I_ChartOfAccountsText {  };
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Chart Of Accounts - Text'
  entity I_ChartOfAccountsText {
    @sap.display.format : 'UpperCase'
    @sap.text : 'ChartOfAccounts_Text'
    @sap.label : 'Chart of Accounts'
    @sap.value.list : 'standard'
    key ChartOfAccounts : String(4) not null;
    @sap.label : 'Language Key'
    key Language : String(2) not null;
    @sap.label : 'Chart of Accounts Description'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    ChartOfAccounts_Text : String(50);
    @sap.label : 'Chart of Accounts Description'
    ChartOfAccountsName : String(50);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Commitment Item'
  @sap.value.list : 'true'
  entity I_CommitmentItemStdVH {
    @sap.display.format : 'UpperCase'
    @sap.label : 'FM Area'
    @sap.quickinfo : 'Financial Management Area'
    key FinancialManagementArea : String(4) not null;
    @sap.display.format : 'NonNegative'
    @sap.label : 'FMA Fiscal Year'
    @sap.quickinfo : 'Fiscal Year for Financial Management Area'
    key FinMgmtAreaFiscalYear : String(4) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Commitment Item'
    key CommitmentItem : String(24) not null;
    @sap.label : 'Commitment Item Name'
    CommitmentItemName : String(20);
    @sap.label : 'Commitment Item Description'
    CommitmentItemDescription : String(50);
    @sap.display.format : 'Date'
    @sap.filter.restriction : 'single-value'
    @sap.label : 'Validity End Date'
    @sap.quickinfo : 'Commitment Item Validity End Date'
    ValidityEndDate : Date;
    @sap.display.format : 'Date'
    @sap.filter.restriction : 'single-value'
    @sap.label : 'Validity Start Date'
    @sap.quickinfo : 'Commitment Item Validity Start Date'
    ValidityStartDate : Date;
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Company Code'
  entity I_CompanyCode {
    @sap.display.format : 'UpperCase'
    @sap.text : 'CompanyCodeName'
    @sap.label : 'Company Code'
    key CompanyCode : String(4) not null;
    @sap.label : 'Company Name'
    @sap.quickinfo : 'Name of Company Code or Company'
    CompanyCodeName : String(25);
    @sap.label : 'City'
    CityName : String(25);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Country/Region Key'
    Country : String(3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Currency'
    @sap.quickinfo : 'Currency Key'
    @sap.semantics : 'currency-code'
    Currency : String(5);
    @sap.label : 'Language Key'
    Language : String(2);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Chart of Accounts'
    ChartOfAccounts : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Fiscal Year Variant'
    FiscalYearVariant : String(2);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Company'
    Company : String(6);
    @sap.display.format : 'UpperCase'
    @sap.text : 'CreditControlArea_Text'
    @sap.label : 'Credit Control Area'
    @sap.value.list : 'standard'
    CreditControlArea : String(4);
    @sap.label : 'Description'
    @sap.quickinfo : 'Description of the credit control area'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    CreditControlArea_Text : String(35);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Alternative COA'
    @sap.quickinfo : 'Alternative Chart of Accounts'
    CountryChartOfAccounts : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'FM Area'
    @sap.quickinfo : 'Financial Management Area'
    FinancialManagementArea : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Address'
    AddressID : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Taxes on Sls/Purc.'
    @sap.quickinfo : 'Taxes on Sales/Purchases Group'
    TaxableEntity : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'VAT Registration No.'
    @sap.quickinfo : 'VAT Registration Number'
    VATRegistration : String(20);
    @sap.label : 'Ext. Withholding Tax'
    @sap.quickinfo : 'Indicator: Extended Withholding Tax Active'
    ExtendedWhldgTaxIsActive : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.text : 'ControllingArea_Text'
    @sap.label : 'Controlling Area'
    @sap.value.list : 'standard'
    ControllingArea : String(4);
    @sap.label : 'Controlling Area Name'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    ControllingArea_Text : String(25);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Field status variant'
    @sap.quickinfo : 'Field Status Variant'
    FieldStatusVariant : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Output Tax Code'
    @sap.quickinfo : 'Output Tax Code for Non-Taxable Transactions'
    NonTaxableTransactionTaxCode : String(2);
    @sap.label : 'Tax Determ.with Doc.Date'
    @sap.quickinfo : 'Indicator: Document Date As the Basis for Tax Determination'
    DocDateIsUsedForTaxDetn : Boolean;
    @sap.label : 'Tax Date'
    @sap.quickinfo : 'Tax Reporting Date Active in Documents'
    TaxRptgDateIsActive : Boolean;
    @sap.label : 'Net Discount Base'
    @sap.quickinfo : 'Indicator: Discount base amount is the net value'
    CashDiscountBaseAmtIsNetAmt : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Transit Plant'
    TransitPlant : String(4);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Company Code'
  @sap.value.list : 'true'
  entity I_CompanyCodeStdVH {
    @sap.display.format : 'UpperCase'
    @sap.text : 'CompanyCodeName'
    @sap.label : 'Company Code'
    key CompanyCode : String(4) not null;
    @sap.label : 'Company Name'
    @sap.quickinfo : 'Name of Company Code or Company'
    CompanyCodeName : String(25);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Controlling Area'
  entity I_ControllingArea {
    @sap.display.format : 'UpperCase'
    @sap.text : 'ControllingAreaName'
    @sap.label : 'Controlling Area'
    key ControllingArea : String(4) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Fiscal Year Variant'
    FiscalYearVariant : String(2);
    @sap.label : 'Controlling Area Name'
    ControllingAreaName : String(25);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Controlling Area Currency'
    @sap.semantics : 'currency-code'
    ControllingAreaCurrency : String(5);
    @sap.display.format : 'UpperCase'
    @sap.text : 'ChartOfAccounts_Text'
    @sap.label : 'Chart of Accounts'
    @sap.value.list : 'standard'
    ChartOfAccounts : String(4);
    @sap.label : 'Chart of Accounts Description'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    ChartOfAccounts_Text : String(50);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Cost Center Standard Hierarchy'
    CostCenterStandardHierarchy : String(12);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Operating concern'
    OperatingConcern : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Profit Center Standard Hierarchy'
    ProfitCenterStandardHierarchy : String(12);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Business Process Standard Hierarchy Area'
    BusinessProcessStandardHier : String(12);
    @sap.display.format : 'UpperCase'
    @sap.label : 'G/L Account for Supplier Down Payments'
    @sap.quickinfo : 'Default General Ledger Account for Supplier Down Payments'
    CreditDownPaymentDefaultGLAcct : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'G/L Account for Customer Down Payments'
    @sap.quickinfo : 'Default General Ledger Account for Customer Down Payments'
    DebitDownPaymentDefaultGLAcct : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Currency Type for Controlling Area'
    ControllingAreaCurrencyRole : String(2);
    @sap.display.format : 'UpperCase'
    @sap.label : 'FM Area'
    @sap.quickinfo : 'Financial Management Area'
    FinancialManagementArea : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Responsible User of Controlling Area'
    ControllingAreaResponsibleUser : String(12);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Default Profit Center'
    @sap.quickinfo : 'Default Profit Center for Nonassigned Processes'
    DefaultProfitCenter : String(10);
    @sap.display.format : 'UpperCase'
    @sap.text : 'CtrlgStdFinStatementVersion_Text'
    @sap.label : 'Leading Ctrlg Financial Stmnt Version'
    @sap.quickinfo : 'Leading Controlling Financial Statement Version'
    CtrlgStdFinStatementVersion : String(42);
    @sap.label : 'Financial Statement Description'
    @sap.quickinfo : 'Hierarchy description'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    CtrlgStdFinStatementVersion_Text : String(50);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Profit Center Local Currency'
    @sap.quickinfo : 'Local Currency for Profit Center Accounting'
    @sap.semantics : 'currency-code'
    ProfitCenterAccountingCurrency : String(5);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Controlling Area'
  @sap.value.list : 'true'
  entity I_ControllingAreaStdVH {
    @sap.display.format : 'UpperCase'
    @sap.text : 'ControllingAreaName'
    @sap.label : 'Controlling Area'
    key ControllingArea : String(4) not null;
    @sap.label : 'Controlling Area Name'
    ControllingAreaName : String(25);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Cost Center - Text'
  entity I_CostCenterText {
    @sap.display.format : 'UpperCase'
    @sap.text : 'CostCenterDescription'
    @sap.label : 'Cost Center'
    key CostCenter : String(10) not null;
    @sap.display.format : 'UpperCase'
    @sap.text : 'ControllingArea_Text'
    @sap.label : 'Controlling Area'
    @sap.value.list : 'standard'
    key ControllingArea : String(4) not null;
    @sap.text : 'to_Language/Language_Text'
    @sap.label : 'Language Key'
    @sap.value.list : 'standard'
    key Language : String(2) not null;
    @sap.label : 'Controlling Area Name'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    ControllingArea_Text : String(25);
    @sap.display.format : 'Date'
    @sap.label : 'Valid To'
    @sap.quickinfo : 'Valid To Date'
    ValidityEndDate : Date;
    @sap.display.format : 'Date'
    @sap.label : 'Valid From'
    @sap.quickinfo : 'Valid-From Date'
    ValidityStartDate : Date;
    @sap.label : 'Cost Center Name'
    CostCenterName : String(20);
    @sap.label : 'Cost Center Desc.'
    @sap.quickinfo : 'Description of Cost Center'
    CostCenterDescription : String(40);
    to_ControllingArea : Association to I_ControllingArea {  };
    to_Language : Association to I_Language {  };
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Cost Center'
  @sap.value.list : 'true'
  entity I_CostCenterVH {
    @sap.display.format : 'UpperCase'
    @sap.text : 'CostCenterName'
    @sap.label : 'Cost Center'
    key CostCenter : String(10) not null;
    @sap.display.format : 'UpperCase'
    @sap.text : 'ControllingArea_Text'
    @sap.label : 'Controlling Area'
    @sap.value.list : 'standard'
    key ControllingArea : String(4) not null;
    @sap.display.format : 'Date'
    @sap.filter.restriction : 'single-value'
    @sap.label : 'Valid To'
    @sap.quickinfo : 'Valid To Date'
    key ValidityEndDate : Date not null;
    @sap.label : 'Controlling Area Name'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    ControllingArea_Text : String(25);
    @sap.label : 'Cost Center Name'
    CostCenterName : String(20);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Company Code'
    @sap.value.list : 'standard'
    CompanyCode : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Cost Center Category'
    CostCenterCategory : String(1);
    @sap.label : 'Person Responsible'
    CostCtrResponsiblePersonName : String(20);
    @sap.display.format : 'UpperCase'
    @sap.label : 'User Responsible'
    CostCtrResponsibleUser : String(12);
    @sap.display.format : 'Date'
    @sap.filter.restriction : 'single-value'
    @sap.label : 'Valid From'
    @sap.quickinfo : 'Valid-From Date'
    ValidityStartDate : Date;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Profit Center'
    ProfitCenter : String(10);
    CostCenterResponsibilityArea : String(16);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Country/Region - Text'
  entity I_CountryText {
    @sap.display.format : 'UpperCase'
    @sap.label : 'Country/Region Key'
    key Country : String(3) not null;
    @sap.label : 'Language Key'
    key Language : String(2) not null;
    @sap.label : 'Country/Region Name'
    CountryName : String(50);
    @sap.label : 'Nationality'
    NationalityName : String(15);
    @sap.label : 'Nationality (Long)'
    @sap.quickinfo : 'Nationality (Max. 50 Characters)'
    NationalityLongName : String(50);
    @sap.label : 'Country/Region Name'
    @sap.quickinfo : 'Name of Country/Region (Short)'
    CountryShortName : String(15);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Country/Region'
  @sap.value.list : 'true'
  entity I_CountryVH {
    @sap.display.format : 'UpperCase'
    @sap.text : 'Country_Text'
    @sap.label : 'Country/Region Key'
    key Country : String(3) not null;
    @sap.label : 'Country/Region Name'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    Country_Text : String(50);
    @sap.label : 'Country/Region Name'
    Description : String(50);
    @sap.display.format : 'UpperCase'
    @sap.label : 'ISO Code 3 Char'
    @sap.quickinfo : 'ISO Country/Region Code 3 Characters'
    CountryThreeLetterISOCode : String(3);
    @sap.display.format : 'NonNegative'
    @sap.label : 'ISO Code Num. 3'
    @sap.quickinfo : 'ISO Country/Region Code Numeric 3-Characters'
    CountryThreeDigitISOCode : String(3);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Credit Control Area'
  @sap.value.list : 'true'
  entity I_CreditControlAreaStdVH {
    @sap.display.format : 'UpperCase'
    @sap.text : 'CreditControlArea_Text'
    @sap.label : 'Credit Control Area'
    key CreditControlArea : String(4) not null;
    @sap.label : 'Description'
    @sap.quickinfo : 'Description of the credit control area'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    CreditControlArea_Text : String(35);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Currency'
  entity I_Currency {
    @sap.display.format : 'UpperCase'
    @sap.text : 'Currency_Text'
    @sap.label : 'Currency'
    @sap.quickinfo : 'Currency Key'
    @sap.semantics : 'currency-code'
    key Currency : String(5) not null;
    @sap.label : 'Description'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    Currency_Text : String(40);
    @odata.Type : 'Edm.Byte'
    @sap.label : 'Decimal Places'
    @sap.quickinfo : 'Number of decimal places'
    Decimals : Integer;
    @sap.display.format : 'UpperCase'
    @sap.label : 'ISO Code'
    @sap.quickinfo : 'ISO Currency Code'
    CurrencyISOCode : String(3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Alternative Key'
    AlternativeCurrencyKey : String(3);
    @sap.label : 'Primary'
    @sap.quickinfo : 'Primary SAP Currency Code for ISO Code'
    IsPrimaryCurrencyForISOCrcy : Boolean;
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Currency'
  @sap.value.list : 'true'
  entity I_CurrencyStdVH {
    @sap.display.format : 'UpperCase'
    @sap.text : 'Currency_Text'
    @sap.label : 'Currency'
    @sap.quickinfo : 'Currency Key'
    @sap.semantics : 'currency-code'
    key Currency : String(5) not null;
    @sap.label : 'Description'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    Currency_Text : String(40);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Customer'
  @sap.value.list : 'true'
  entity I_Customer_VH {
    @sap.display.format : 'UpperCase'
    @sap.text : 'BPCustomerName'
    @sap.label : 'Customer'
    @sap.quickinfo : 'Customer Number'
    key Customer : String(10) not null;
    @sap.label : 'Customer Name 1'
    @sap.quickinfo : 'Name'
    OrganizationBPName1 : String(35);
    @sap.label : 'Business Partner Name 1'
    @sap.quickinfo : 'Name 1'
    BusinessPartnerName1 : String(40);
    @sap.label : 'Customer Name 2'
    @sap.quickinfo : 'Name 2'
    OrganizationBPName2 : String(35);
    @sap.label : 'Business Partner Name 2'
    @sap.quickinfo : 'Name 2'
    BusinessPartnerName2 : String(40);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Country/Region'
    @sap.quickinfo : 'Country/Region Key'
    Country : String(3);
    @sap.label : 'City'
    CityName : String(35);
    @sap.label : 'Business Partner Address City'
    @sap.quickinfo : 'City'
    BPAddrCityName : String(40);
    @sap.label : 'Street'
    @sap.quickinfo : 'Street and House Number'
    StreetName : String(35);
    @sap.label : 'Business Partner Address Street'
    @sap.quickinfo : 'Street'
    BPAddrStreetName : String(60);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Postal Code'
    PostalCode : String(10);
    @sap.label : 'Customer Name'
    @sap.quickinfo : 'Name of Customer'
    CustomerName : String(80);
    @sap.label : 'Business Partner Customer Name'
    @sap.quickinfo : 'Customer Name'
    BPCustomerName : String(81);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Account group'
    @sap.quickinfo : 'Customer Account Group'
    CustomerAccountGroup : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Authorization'
    @sap.quickinfo : 'Authorization Group'
    AuthorizationGroup : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purpose Complete Flag'
    @sap.quickinfo : 'Business Purpose Completed Flag'
    IsBusinessPurposeCompleted : String(1);
    @sap.label : 'Competitors'
    @sap.quickinfo : 'Indicator: Competitor'
    IsCompetitor : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Business Partner'
    @sap.quickinfo : 'Business Partner Number'
    BusinessPartner : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Business Partner Type'
    BusinessPartnerType : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Data Ctrlr. Set'
    @sap.quickinfo : 'BP: Data Controller Set Flag'
    DataControllerSet : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Data Controller'
    @sap.quickinfo : 'BP: Data Controller (Internal Use Only)'
    DataController1 : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Data Controller'
    @sap.quickinfo : 'BP: Data Controller (Internal Use Only)'
    DataController2 : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Data Controller'
    @sap.quickinfo : 'BP: Data Controller (Internal Use Only)'
    DataController3 : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Data Controller'
    @sap.quickinfo : 'BP: Data Controller (Internal Use Only)'
    DataController4 : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Data Controller'
    @sap.quickinfo : 'BP: Data Controller (Internal Use Only)'
    DataController5 : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Data Controller'
    @sap.quickinfo : 'BP: Data Controller (Internal Use Only)'
    DataController6 : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Data Controller'
    @sap.quickinfo : 'BP: Data Controller (Internal Use Only)'
    DataController7 : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Data Controller'
    @sap.quickinfo : 'BP: Data Controller (Internal Use Only)'
    DataController8 : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Data Controller'
    @sap.quickinfo : 'BP: Data Controller (Internal Use Only)'
    DataController9 : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Data Controller'
    @sap.quickinfo : 'BP: Data Controller (Internal Use Only)'
    DataController10 : String(30);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Earmarked Funds Document Entry Status'
  @sap.value.list : 'true'
  entity I_EarmarkedFundsDocEntryStatus {
    @sap.display.format : 'UpperCase'
    @sap.text : 'EarmarkedFundsDocEntryStatus_Text'
    @sap.label : 'Entry Status'
    @sap.quickinfo : 'Document Entry Status (Posted, Parked)'
    key EarmarkedFundsDocEntryStatus : String(1) not null;
    @sap.label : 'Document Entry Status Text'
    @sap.quickinfo : 'Text of the Entry Status of an Earmarked Funds Document'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    EarmarkedFundsDocEntryStatus_Text : String(60);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Earmarked Funds Document Type Std'
  @sap.value.list : 'true'
  entity I_EarmarkedFundsDocTypeStdVH {
    @sap.display.format : 'UpperCase'
    @sap.text : 'EarmarkedFundsDocumentType_Text'
    @sap.label : 'Document Type'
    @sap.quickinfo : 'Earmarked Fund Document Type'
    key EarmarkedFundsDocumentType : String(2) not null;
    @sap.display.format : 'NonNegative'
    @sap.label : 'Doc.Cat.'
    @sap.quickinfo : 'Earmarked Funds Document Category'
    @sap.value.list : 'fixed-values'
    key EarmarkedFundsDocumentCategory : String(3) not null;
    @sap.label : 'Document Type Text'
    @sap.quickinfo : 'Text of the Document Type of an Earmarked Funds Document'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    EarmarkedFundsDocumentType_Text : String(30);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Earmarked Funds Document Std'
  @sap.value.list : 'true'
  entity I_EarmarkedFundsDocumentStdVH {
    @sap.display.format : 'UpperCase'
    @sap.label : 'Earmarked Funds Document'
    @sap.quickinfo : 'Document Number for Earmarked Funds'
    key EarmarkedFundsDocument : String(10) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Company Code'
    @sap.value.list : 'standard'
    CompanyCode : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'FM Area'
    @sap.quickinfo : 'Financial Management Area'
    FinancialManagementArea : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Controlling Area'
    ControllingArea : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Transaction Currency'
    @sap.value.list : 'standard'
    @sap.semantics : 'currency-code'
    TransactionCurrency : String(5);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Document Category'
    @sap.quickinfo : 'Document Category of an Earmarked Funds Document'
    @sap.value.list : 'fixed-values'
    EarmarkedFundsDocumentCategory : String(3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Document Type'
    @sap.quickinfo : 'Earmarked Fund Document Type'
    @sap.value.list : 'standard'
    EarmarkedFundsDocumentType : String(2);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Entry Status'
    @sap.quickinfo : 'Document Entry Status (Posted, Parked)'
    @sap.value.list : 'fixed-values'
    EarmarkedFundsDocEntryStatus : String(1);
    @sap.display.format : 'Date'
    @sap.label : 'Document Date'
    @sap.quickinfo : 'Document Date in Document'
    DocumentDate : Date;
    @sap.display.format : 'Date'
    @sap.label : 'Posting Date'
    @sap.quickinfo : 'Posting Date in the Document'
    PostingDate : Date;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Entered By'
    @sap.value.list : 'standard'
    EmrkdFndsDocCreatedByUser : String(12);
    @sap.display.format : 'Date'
    @sap.label : 'Entered On'
    EmrkdFndsDocCreationDate : Date;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Last Changed By'
    @sap.value.list : 'standard'
    EmrkdFndsDocLastChangedByUser : String(12);
    @sap.display.format : 'Date'
    @sap.label : 'Changed On'
    @sap.quickinfo : 'Date of Last Change'
    EmrkdFndsDocLastChangeDate : Date;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Reference'
    @sap.quickinfo : 'Reference Document Number'
    EarmarkedFundsDocReference : String(16);
    @sap.label : 'Reference 2'
    EarmarkedFundsDocReference2 : String(70);
    @sap.label : 'Reference 3'
    EarmarkedFundsDocReference3 : String(70);
    @sap.label : 'Document Header Text'
    EarmarkedFundsHeaderText : String(50);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Earmarked Funds Document Category'
  @sap.value.list : 'true'
  entity I_EarmarkedFunds_DocCategory {
    @sap.display.format : 'NonNegative'
    @sap.text : 'EarmarkedFundsDocumentCategory_Text'
    @sap.label : 'Document Category'
    @sap.quickinfo : 'Document Category of an Earmarked Funds Document'
    key EarmarkedFundsDocumentCategory : String(3) not null;
    @sap.label : 'Document Category Text'
    @sap.quickinfo : 'Text of the Category of an Earmarked Funds Document'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    EarmarkedFundsDocumentCategory_Text : String(60);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.semantics : 'aggregate'
  @sap.label : 'Earmarked Funds Doc. Item Std Value Help'
  entity I_EmrkdFndsDocumentItemStdVH {
    @sap.sortable : 'false'
    @sap.filterable : 'false'
    key ID : String not null;
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'UpperCase'
    @sap.label : 'Earmarked Funds Document'
    @sap.quickinfo : 'Document Number for Earmarked Funds'
    @sap.value.list : 'standard'
    EarmarkedFundsDocument : String(10);
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'NonNegative'
    @sap.label : 'Earmarked Funds Document Item'
    @sap.quickinfo : 'Document Item for Earmarked Funds'
    EarmarkedFundsDocumentItem : String(3);
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'NonNegative'
    @sap.label : 'Document Category'
    @sap.quickinfo : 'Document Category of an Earmarked Funds Document'
    @sap.value.list : 'fixed-values'
    EarmarkedFundsDocumentCategory : String(3);
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'UpperCase'
    @sap.label : 'Document Type'
    @sap.quickinfo : 'Earmarked Fund Document Type'
    @sap.value.list : 'standard'
    EarmarkedFundsDocumentType : String(2);
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'UpperCase'
    @sap.label : 'Company Code'
    @sap.value.list : 'standard'
    CompanyCode : String(4);
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'UpperCase'
    @sap.label : 'Transaction Currency'
    @sap.value.list : 'standard'
    @sap.semantics : 'currency-code'
    TransactionCurrency : String(5);
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'UpperCase'
    @sap.label : 'Entry Status'
    @sap.quickinfo : 'Document Entry Status (Posted, Parked)'
    @sap.value.list : 'fixed-values'
    EarmarkedFundsDocEntryStatus : String(1);
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'Date'
    @sap.label : 'Posting Date'
    @sap.quickinfo : 'Posting Date in the Document'
    PostingDate : Date;
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'UpperCase'
    @sap.label : 'Entered By'
    @sap.value.list : 'standard'
    EmrkdFndsDocItmCreatedByUser : String(12);
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'Date'
    @sap.label : 'Entered On'
    EmrkdFndsDocItmCreationDate : Date;
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'UpperCase'
    @sap.label : 'Last Changed By'
    @sap.value.list : 'standard'
    EmrkdFndsDocItmLastChgdByUsr : String(12);
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'Date'
    @sap.label : 'Changed On'
    @sap.quickinfo : 'Date of Last Change'
    EmrkdFndsDocItmLastChangeDate : Date;
    @sap.aggregation.role : 'dimension'
    @sap.label : 'Text'
    @sap.quickinfo : 'Item Text'
    DocumentItemText : String(50);
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'Date'
    @sap.label : 'Due On'
    @sap.quickinfo : 'Costs Due On'
    DueDate : Date;
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'UpperCase'
    @sap.label : 'Controlling Area'
    @sap.value.list : 'standard'
    ControllingArea : String(4);
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'UpperCase'
    @sap.label : 'G/L Account'
    @sap.quickinfo : 'G/L Account Number'
    @sap.value.list : 'standard'
    GLAccount : String(10);
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'UpperCase'
    @sap.label : 'Cost Center'
    @sap.value.list : 'standard'
    CostCenter : String(10);
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'UpperCase'
    @sap.label : 'WBS Element'
    @sap.quickinfo : 'Work Breakdown Structure Element (WBS Element) Edited'
    @sap.value.list : 'standard'
    WBSElementExternalID : String(24);
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'UpperCase'
    @sap.label : 'Network'
    @sap.quickinfo : 'Network Number for Account Assignment'
    @sap.value.list : 'standard'
    ProjectNetwork : String(12);
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'UpperCase'
    @sap.label : 'FM Area'
    @sap.quickinfo : 'Financial Management Area'
    FinancialManagementArea : String(4);
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'UpperCase'
    @sap.label : 'Fund'
    @sap.value.list : 'standard'
    Fund : String(10);
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'UpperCase'
    @sap.label : 'Budget Period'
    @sap.value.list : 'standard'
    BudgetPeriod : String(10);
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'UpperCase'
    @sap.label : 'Functional Area'
    @sap.value.list : 'standard'
    FunctionalArea : String(16);
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'UpperCase'
    @sap.label : 'Grant'
    @sap.value.list : 'standard'
    GrantID : String(20);
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'UpperCase'
    @sap.label : 'Business Area'
    @sap.value.list : 'standard'
    BusinessArea : String(4);
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'UpperCase'
    @sap.label : 'Supplier'
    @sap.quickinfo : 'Account Number of Supplier'
    @sap.value.list : 'standard'
    Supplier : String(10);
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'UpperCase'
    @sap.label : 'Customer'
    @sap.quickinfo : 'Customer Number'
    @sap.value.list : 'standard'
    Customer : String(10);
    @sap.aggregation.role : 'dimension'
    @sap.label : 'Item Completed'
    @sap.quickinfo : 'Completion Indicator for Earmarked Funds Document Item'
    EmrkdFndsItmIsCompleted : Boolean;
    @sap.aggregation.role : 'dimension'
    @sap.label : 'Item Blocked'
    @sap.quickinfo : 'Blocking Indicator (Item)'
    EmrkdFndsItmIsBlkdAgainstUsage : Boolean;
    @sap.aggregation.role : 'measure'
    @sap.unit : 'TransactionCurrency'
    @sap.label : 'Open Amount'
    @sap.quickinfo : 'Open Amount in Transaction Currency'
    @sap.filterable : 'false'
    EmrkdFndsOpenAmtInTransCrcy : Decimal(16, 3);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Engagement Project Service Organization'
  @sap.value.list : 'true'
  entity I_EngmntProjSrvcOrgStdVH {
    @sap.display.format : 'UpperCase'
    @sap.text : 'EngagementProjectServiceOrg_Text'
    @sap.label : 'Service Organization'
    key EngagementProjectServiceOrg : String(5) not null;
    @sap.label : 'Organization Desc.'
    @sap.quickinfo : 'Description of Organization Unit ID'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    EngagementProjectServiceOrg_Text : String(40);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.content.version : '1'
  @sap.label : 'Financial Chain - Text'
  entity I_FinancialChainText {
    @sap.display.format : 'NonNegative'
    @sap.label : 'Financial Chain ID'
    key FinancialChain : String(10) not null;
    @sap.label : 'Language Key'
    key Language : String(2) not null;
    @sap.label : 'Financial Chain Name'
    FinancialChainName : String(60);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.content.version : '1'
  @sap.label : 'Fixed Asset'
  entity I_FixedAsset {
    @sap.display.format : 'UpperCase'
    @sap.label : 'Company Code'
    key CompanyCode : String(4) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Asset'
    @sap.quickinfo : 'Main Asset Number'
    key MasterFixedAsset : String(12) not null;
    @sap.display.format : 'UpperCase'
    @sap.text : 'FixedAssetDescription'
    @sap.label : 'Subnumber'
    @sap.quickinfo : 'Asset Subnumber'
    key FixedAsset : String(4) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Asset Number'
    FixedAssetExternalID : String(17);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Asset Class'
    AssetClass : String(8);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Serial number'
    AssetSerialNumber : String(18);
    @sap.unit : 'BaseUnit'
    @sap.label : 'Quantity'
    Quantity : Decimal(13, 3);
    @sap.label : 'Base Unit of Measure'
    @sap.semantics : 'unit-of-measure'
    BaseUnit : String(3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Inventory Number'
    Inventory : String(25);
    @sap.label : 'Description'
    @sap.quickinfo : 'Asset Description'
    FixedAssetDescription : String(50);
    @sap.label : 'Description (2)'
    @sap.quickinfo : 'Additional Asset Description'
    AssetAdditionalDescription : String(50);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Currency'
    @sap.quickinfo : 'Currency Key'
    @sap.semantics : 'currency-code'
    Currency : String(5);
    @sap.unit : 'Currency'
    @sap.label : 'Original Value'
    @sap.quickinfo : 'Original Acquisition Value'
    OriglAcqnAmtInCoCodeCrcy : Decimal(24, 3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Trading Partner No.'
    @sap.quickinfo : 'Company ID of Trading Partner'
    PartnerCompany : String(6);
    @sap.label : 'Manufacturer'
    @sap.quickinfo : 'Manufacturer of Asset'
    AssetManufacturerName : String(30);
    @sap.label : 'In-House Prod. Perc.'
    @sap.quickinfo : 'In-house production percentage'
    InHouseProdnPercent : Decimal(5, 2);
    @sap.label : 'Supplier Name'
    @sap.quickinfo : 'Name of asset supplier'
    AssetSupplierName : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Inventory Note'
    @sap.quickinfo : 'Supplementary Inventory Specifications'
    InventoryNote : String(15);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Evaluation group 1'
    Group1AssetEvaluationKey : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Evaluation Group 2'
    Group2AssetEvaluationKey : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Evaluation Group 3'
    Group3AssetEvaluationKey : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Evaluation group 4'
    Group4AssetEvaluationKey : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Evaluation Group 5'
    Group5AssetEvaluationKey : String(8);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Account Determ.'
    @sap.quickinfo : 'Account Determination'
    AssetAccountDetermination : String(8);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Manage Historically'
    @sap.quickinfo : 'Indicator: Historical management'
    HasHistory : String(1);
    @sap.display.format : 'Date'
    @sap.label : 'Capitalized On'
    @sap.quickinfo : 'Asset Capitalization Date'
    AssetCapitalizationDate : Date;
    @sap.display.format : 'NonNegative'
    @sap.label : 'Acquisition Year'
    @sap.quickinfo : 'Fiscal Year in Which First Acquisition Was Posted'
    FirstAcquisitionFiscalYear : String(4);
    @sap.display.format : 'NonNegative'
    @sap.label : 'First Acquis. Period'
    @sap.quickinfo : 'Period in Which First Acquisition Was Posted'
    FirstAcquisitionFiscalPeriod : String(3);
    @sap.display.format : 'Date'
    @sap.label : 'Deactivation on'
    @sap.quickinfo : 'Deactivation Date'
    AssetDeactivationDate : Date;
    @sap.display.format : 'Date'
    @sap.label : 'Plnd Retirement On'
    @sap.quickinfo : 'Planned Retirement Date'
    PlannedRetirementDate : Date;
    @sap.display.format : 'Date'
    @sap.label : 'Ordered On'
    @sap.quickinfo : 'Asset Purchase Order Date'
    FixedAssetOrderDate : Date;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Original Asset'
    @sap.quickinfo : 'Original Asset That Was Transferred'
    OriginalMasterFixedAsset : String(12);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Asset Super Number'
    FixedAssetGroup : String(12);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Investment Reason'
    @sap.quickinfo : 'Reason for Investment'
    InvestmentReason : String(2);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Real Est.'
    @sap.quickinfo : 'Indicator: Real Estate'
    AssetIsRealEstate : String(1);
    @sap.label : 'Area Unit'
    @sap.semantics : 'unit-of-measure'
    AreaSizeUnit : String(3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Investment Order'
    InvestmentOrder : String(12);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Inv. WBS (Int. ID)'
    @sap.quickinfo : 'Asset WBS Element (Internal ID)'
    InvestmentProjectWBSElement_2 : String(8);
    @sap.display.format : 'NonNegative'
    @sap.label : 'WBS Element'
    @sap.quickinfo : 'WBS element investment project'
    InvestmentProjectWBSElement : String(24);
    @sap.label : 'Include Asset'
    @sap.quickinfo : 'Inventory Indicator'
    InventoryIsCounted : Boolean;
    @sap.display.format : 'Date'
    @sap.label : 'Last Inventory On'
    @sap.quickinfo : 'Last Inventory Date'
    LastInventoryDate : Date;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Change asset'
    @sap.quickinfo : 'Change Asset Master Record from Equipment Master'
    AssetSynchronizationRule : String(1);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Org.Acquisition Year'
    @sap.quickinfo : 'Fiscal Year of Original Acquisition'
    OriginalAcquisitionFiscalYear : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Type Name'
    @sap.quickinfo : 'Asset Type Name'
    AssetTypeName : String(15);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Vendor'
    @sap.quickinfo : 'Account number of vendor (other key word)'
    Supplier : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Ctry/Reg. of Origin'
    @sap.quickinfo : 'Asset''s Country/Region of Origin'
    AssetCountryOfOrigin : String(3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Assmt Notice Tax No.'
    @sap.quickinfo : 'Tax Number of the Notice of Assessment'
    NoticeOfAssessmentTaxID : String(16);
    @sap.display.format : 'Date'
    @sap.label : 'Notice on'
    @sap.quickinfo : 'Date of last notice of assessment'
    LastAssessmentNoticeDate : Date;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Envir. Investment'
    @sap.quickinfo : 'Reason for Environmental Investment'
    EnvrnmtlInvestmentReason : String(5);
    @sap.display.format : 'Date'
    @sap.label : 'Changed On'
    LastChangeDate : Date;
    @sap.display.format : 'NonNegative'
    @sap.label : 'Complete.'
    @sap.quickinfo : 'Completeness indicator for the asset'
    FixedAssetFinDataCmpltns : String(1);
    @sap.label : 'Deletion Flag'
    @sap.quickinfo : 'Indicator: Account Marked for Deletion?'
    AccountIsMarkedForDeletion : Boolean;
    @sap.label : 'Locked to acquis.'
    @sap.quickinfo : 'Indicator: Asset Locked to Acquisition Postings'
    AccountIsBlockedForPosting : Boolean;
    @sap.display.format : 'Date'
    @sap.label : 'First Acquisition on'
    @sap.quickinfo : 'Asset Value Date of the First Posting'
    AcquisitionValueDate : Date;
    @sap.display.format : 'Date'
    @sap.label : 'Acq. Orig. Asset On'
    @sap.quickinfo : 'Original Acquisition Date of AuC/ Transferred Asset'
    OriginalFixedAssetValueDate : Date;
    @sap.label : 'Inv. Measure'
    @sap.quickinfo : 'Asset under Construction for Investment Measures'
    AssetUnderConstIsInvmtMsr : Boolean;
    @sap.display.format : 'Date'
    @sap.label : 'Last Retmt. On'
    @sap.quickinfo : 'Asset Value Date for the Last Retirement'
    LastRetirementValueDate : Date;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Changed By'
    @sap.quickinfo : 'Name of Person Who Changed Object'
    LastChangedByUser : String(12);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Property Indicator'
    FixedAssetPropertyType : String(1);
    @sap.display.format : 'Date'
    @sap.label : 'Created On'
    @sap.quickinfo : 'Record Created On'
    CreationDate : Date;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Created By'
    @sap.quickinfo : 'Name of Person Responsible for Creating the Object'
    CreatedByUser : String(12);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Reason for Man. Val.'
    @sap.quickinfo : 'Reason for Manual Valuation of Net Assets'
    ManualDepreciationReason : String(3);
    @sap.display.format : 'Date'
    @sap.label : 'Reorganization Date'
    @sap.quickinfo : 'Date of Last Reorganization'
    LastReorganizationDate : Date;
    @sap.display.format : 'Date'
    @sap.label : 'Transfer Date'
    @sap.quickinfo : 'Legacy Data Transfer Date'
    LegacyDataTransferDate : Date;
    @sap.label : 'Group Asset'
    @sap.quickinfo : 'Indicator: Asset is a group asset'
    IsGroupAsset : Boolean;
    @sap.label : 'LineItem settl.'
    @sap.quickinfo : 'Asset under construct. with line item settlement'
    IsLineItemSettled : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Asset Sub-No. AuC'
    @sap.quickinfo : 'Original Asset That Was Transferred'
    OriginalFixedAsset : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Description'
    @sap.quickinfo : 'Search Term for Matchcode Search'
    MasterFixedAssetSearchTerm : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Status at Purchase'
    @sap.quickinfo : 'Asset Status at Purchase: New, Used or Unknown'
    AssetStatusAtPurchase : String(1);
    @sap.label : 'Purchased used'
    @sap.quickinfo : 'Asset acquired used'
    AssetIsAcquiredUsed : Boolean;
    @sap.label : 'Main Asset'
    @sap.quickinfo : 'Indicator for Main Asset'
    IsMainAsset : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Lifecycle Status'
    AssetLifecycleStatus : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Completeness Status'
    AssetCompletenessStatus : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'AuC Status'
    @sap.quickinfo : 'Asset Under Construction Status'
    AssetUnderConstructionStatus : String(1);
    @sap.display.format : 'Date'
    @sap.label : 'Validity Date'
    @sap.quickinfo : 'Validity Date from Asset Class'
    AssetCreationValidityDate : Date;
    @odata.Type : 'Edm.DateTimeOffset'
    @sap.label : 'Time Stamp'
    @sap.quickinfo : 'UTC Time Stamp in Short Form (YYYYMMDDhhmmss)'
    CreationDateTime : DateTime;
    @odata.Type : 'Edm.DateTimeOffset'
    @sap.label : 'Time Stamp'
    @sap.quickinfo : 'UTC Time Stamp in Short Form (YYYYMMDDhhmmss)'
    LastChangeDateTime : DateTime;
    @sap.label : 'Master Data Layout'
    @sap.quickinfo : 'Layout for Asset Master Data'
    AssetScreenLayout : String(20);
    @sap.unit : 'OriginalAcquisitionCurrency'
    @sap.label : 'Original Value'
    @sap.quickinfo : 'Original Acquisition Value'
    OriginalAcquisitionAmount : Decimal(24, 3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Orig Acq Crcy'
    @sap.quickinfo : 'Original Acquisition Value Currency'
    @sap.semantics : 'currency-code'
    OriginalAcquisitionCurrency : String(5);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Classification key'
    @sap.quickinfo : 'Property classification key'
    PropertyClass : String(4);
    @sap.label : 'Tax Office'
    @sap.quickinfo : 'Local Tax Office'
    LocalTaxOffice : String(25);
    @sap.label : 'Municipality'
    Municipality : String(25);
    @sap.display.format : 'Date'
    @sap.label : 'Land Register of'
    LandRegisterDate : Date;
    @sap.display.format : 'UpperCase'
    @sap.label : 'LandRegEntry SeqNo.'
    @sap.quickinfo : 'Land Register Entry: Sequence Number'
    LandRegisterEntrySequence : String(4);
    @sap.display.format : 'Date'
    @sap.label : 'Entry by'
    @sap.quickinfo : 'Land Register Entry on'
    LandRegisterEntryDate : Date;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Vol./Page/Ser.No'
    @sap.quickinfo : 'Land Register Volume'
    LandRegisterVolume : String(5);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Land Register Page'
    LandRegisterPage : String(5);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Ld.Reg.Map/Plot'
    @sap.quickinfo : 'Land Register Map Number'
    LandRegisterMap : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Plot Number'
    LandPlot : String(10);
    @sap.display.format : 'Date'
    @sap.label : 'Conveyance From'
    @sap.quickinfo : 'Date of conveyance'
    ConveyanceDate : Date;
    @sap.unit : 'AreaSizeUnit'
    @sap.label : 'Area'
    @sap.quickinfo : 'Surface Area'
    AreaSize : Decimal(13, 3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Leasing company'
    LeaseSupplier : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Agreement Number'
    @sap.quickinfo : 'Leasing agreement number'
    LeaseAgreement : String(15);
    @sap.display.format : 'Date'
    @sap.label : 'Agreement Date'
    @sap.quickinfo : 'Leasing agreement date'
    LeaseAgreementDate : Date;
    @sap.display.format : 'Date'
    @sap.label : 'Notice Date'
    @sap.quickinfo : 'Leasing agreement notice date'
    LeaseTermEndDate : Date;
    @sap.display.format : 'Date'
    @sap.label : 'Lease start date'
    LeaseTermStartDate : Date;
    @sap.display.format : 'NonNegative'
    @sap.label : 'Lease Length'
    @sap.quickinfo : 'Length of Lease in Years'
    LeaseDurationInFiscalYears : String(3);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Lease in periods'
    @sap.quickinfo : 'Length of lease in periods'
    LeaseDurationInFiscalPeriods : String(3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Type'
    @sap.quickinfo : 'Leasing type'
    LeaseType : String(2);
    @sap.label : 'Supplementary text'
    @sap.quickinfo : 'Leasing data text'
    LeasedAssetNote : String(50);
    @sap.label : 'LDT Asset No.'
    @sap.quickinfo : 'Legacy Asset Number'
    LegacyAsset : String(16);
    @sap.label : 'Legacy Comp. Code'
    @sap.quickinfo : 'Legacy Fixed Asset Company Code'
    LegacyFixedAssetCompanyCode : String(80);
    @sap.label : 'Legacy Main No.'
    @sap.quickinfo : 'Legacy Main Asset Number'
    LegacyMasterFixedAsset : String(80);
    @sap.label : 'Legacy Subnumber'
    @sap.quickinfo : 'Legacy Asset Subnumber'
    LegacyFixedAsset : String(5);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Sequence Number'
    @sap.quickinfo : 'Legacy Data Transfer - sequence number'
    LegacyDataTransferSequence : String(5);
    @sap.label : 'Post-capitalization'
    @sap.quickinfo : 'Indicator for Asset for Post-Cap.'
    AssetIsForPostCapitalization : Boolean;
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Funds Management Functional Area'
  @sap.value.list : 'true'
  entity I_FndsMgmtFuncnlAreaStdVH {
    @sap.display.format : 'UpperCase'
    @sap.text : 'FunctionalArea_Text'
    @sap.label : 'Functional Area'
    key FunctionalArea : String(16) not null;
    @sap.label : 'Functional Area Name'
    @sap.quickinfo : 'Name of the Functional Area'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    FunctionalArea_Text : String(25);
    @sap.label : 'Functional Area Name'
    @sap.quickinfo : 'Name of the Functional Area'
    FunctionalAreaName : String(25);
    @sap.display.format : 'Date'
    @sap.filter.restriction : 'single-value'
    @sap.label : 'Validity End Date'
    @sap.quickinfo : 'Functional Area Validity End Date'
    ValidityEndDate : Date;
    @sap.display.format : 'Date'
    @sap.filter.restriction : 'single-value'
    @sap.label : 'Validity Start Date'
    @sap.quickinfo : 'Functional Area Validity Start Date'
    ValidityStartDate : Date;
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.content.version : '1'
  @sap.label : 'Form Of Address - Text'
  entity I_FormOfAddressText {
    @sap.label : 'Language Key'
    key Language : String(2) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Title Key'
    @sap.quickinfo : 'Form-of-Address Key'
    key FormOfAddress : String(4) not null;
    @sap.label : 'Title Text'
    @sap.quickinfo : 'Title text'
    FormOfAddressName : String(30);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.content.version : '1'
  @sap.label : 'Functional Area - Text'
  entity I_FunctionalAreaText {
    @sap.label : 'Language Key'
    key Language : String(2) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Functional Area'
    key FunctionalArea : String(16) not null;
    @sap.label : 'Functional Area Name'
    @sap.quickinfo : 'Name of the Functional Area'
    FunctionalAreaName : String(25);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Funded Program'
  @sap.value.list : 'true'
  entity I_FundedProgramStdVH {
    @sap.display.format : 'UpperCase'
    @sap.label : 'FM Area'
    @sap.quickinfo : 'Financial Management Area'
    key FinancialManagementArea : String(4) not null;
    @sap.display.format : 'UpperCase'
    @sap.text : 'FundedProgram_Text'
    @sap.label : 'Funded Program'
    key FundedProgram : String(24) not null;
    @sap.label : 'Funded Program Name'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    FundedProgram_Text : String(20);
    @sap.display.format : 'Date'
    @sap.filter.restriction : 'single-value'
    @sap.label : 'Validity End Date'
    @sap.quickinfo : 'Funded Program Validity End Date'
    ValidityEndDate : Date;
    @sap.display.format : 'Date'
    @sap.filter.restriction : 'single-value'
    @sap.label : 'Validity Start Date'
    @sap.quickinfo : 'Funded Program Validity Start Date'
    ValidityStartDate : Date;
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Funds Center'
  @sap.value.list : 'true'
  entity I_FundsCenterStdVH {
    @sap.display.format : 'UpperCase'
    @sap.label : 'FM Area'
    @sap.quickinfo : 'Financial Management Area'
    key FinancialManagementArea : String(4) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Funds Center'
    key FundsCenter : String(16) not null;
    @sap.display.format : 'Date'
    @sap.filter.restriction : 'single-value'
    @sap.label : 'Validity End Date'
    @sap.quickinfo : 'Funds Center Validity End Date'
    key ValidityEndDate : Date not null;
    @sap.label : 'Funds Center Name'
    FundsCenterName : String(20);
    @sap.label : 'Funds Center Description'
    FundsCenterDescription : String(40);
    @sap.display.format : 'Date'
    @sap.filter.restriction : 'single-value'
    @sap.label : 'Validity Start Date'
    @sap.quickinfo : 'Funds Center Validity Start Date'
    ValidityStartDate : Date;
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Fund'
  @sap.value.list : 'true'
  entity I_FundStdVH {
    @sap.display.format : 'UpperCase'
    @sap.text : 'FundName'
    @sap.label : 'Fund'
    key Fund : String(10) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'FM Area'
    @sap.quickinfo : 'Financial Management Area'
    key FinancialManagementArea : String(4) not null;
    @sap.label : 'Fund Name'
    FundName : String(20);
    @sap.label : 'Fund Description'
    FundDescription : String(40);
    @sap.display.format : 'Date'
    @sap.filter.restriction : 'single-value'
    @sap.label : 'Valid From'
    @sap.quickinfo : 'Fund Valid From'
    ValidityStartDate : Date;
    @sap.display.format : 'Date'
    @sap.filter.restriction : 'single-value'
    @sap.label : 'Valid To'
    @sap.quickinfo : 'Fund Valid To'
    ValidityEndDate : Date;
    @sap.label : 'Grantee Management Fund Type Name'
    @sap.quickinfo : 'Fund Type Name in Grantee Management'
    GranteeMgmtFundTypeName : String(40);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'General Ledger Account'
  @sap.value.list : 'true'
  entity I_GLAccountStdVH {
    @sap.display.format : 'UpperCase'
    @sap.text : 'GLAccount_Text'
    @sap.label : 'G/L Account'
    @sap.quickinfo : 'G/L Account Number'
    key GLAccount : String(10) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Company Code'
    key CompanyCode : String(4) not null;
    @sap.label : 'G/L Account Name'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    GLAccount_Text : String(20);
    @sap.display.format : 'UpperCase'
    @sap.label : 'G/L Acct External ID'
    @sap.quickinfo : 'G/L Account Number'
    GLAccountExternal : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Alternative G/L Account'
    @sap.quickinfo : 'Alternative G/L Account Number In Company Code'
    AlternativeGLAccount : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Chart of Accounts'
    ChartOfAccounts : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Account Group'
    @sap.quickinfo : 'G/L Account Group'
    GLAccountGroup : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'G/L Account Type'
    @sap.quickinfo : 'Type of a General Ledger Account'
    GLAccountType : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Reconcil. ID'
    @sap.quickinfo : 'Account Is Reconciliation Account'
    ReconciliationAccountType : String(1);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'General Ledger Account - Text'
  entity I_GLAccountText {
    @sap.display.format : 'UpperCase'
    @sap.text : 'ChartOfAccounts_Text'
    @sap.label : 'Chart of Accounts'
    @sap.value.list : 'standard'
    key ChartOfAccounts : String(4) not null;
    @sap.display.format : 'UpperCase'
    @sap.text : 'GLAccountLongName'
    @sap.label : 'G/L Account'
    @sap.quickinfo : 'G/L Account Number'
    key GLAccount : String(10) not null;
    @sap.label : 'Language Key'
    key Language : String(2) not null;
    @sap.label : 'Chart of Accounts Description'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    ChartOfAccounts_Text : String(50);
    @sap.label : 'G/L Account Name'
    GLAccountName : String(20);
    @sap.label : 'G/L Account Long Name'
    GLAccountLongName : String(50);
    @odata.Type : 'Edm.DateTimeOffset'
    @sap.label : 'Time Stamp'
    @sap.quickinfo : 'UTC Time Stamp in Short Form (YYYYMMDDhhmmss)'
    LastChangeDateTime : DateTime;
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.content.version : '1'
  @sap.label : 'Goods Movement Type'
  entity I_GoodsMovementType {
    @sap.display.format : 'UpperCase'
    @sap.text : 'GoodsMovementType_Text'
    @sap.label : 'Movement Type'
    @sap.quickinfo : 'Movement Type (Inventory Management)'
    key GoodsMovementType : String(3) not null;
    @sap.label : 'Movement Type Text'
    @sap.quickinfo : 'Movement Type Text (Inventory Management)'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    GoodsMovementType_Text : String(20);
    @sap.label : 'Rev. mvmnt type ind.'
    @sap.quickinfo : 'Reversal movement type'
    IsReversalMovementType : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Debit/Credit Ind.'
    @sap.quickinfo : 'Debit/Credit Indicator'
    DebitCreditCode : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Reserv. cat.'
    @sap.quickinfo : 'Account assignment of reservation'
    ResvnAcctAssgmtCategory : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Posting string ref.'
    @sap.quickinfo : 'Posting string reference (Inventory Management)'
    BasicMovementTypeReference : String(3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Goods Movement Type'
    @sap.quickinfo : 'Goods Movement Type (Inventory Management) copied'
    SourceGoodsMovementType : String(3);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Grant'
  @sap.value.list : 'true'
  entity I_GrantStdVH {
    @sap.display.format : 'UpperCase'
    @sap.text : 'GrantName'
    @sap.label : 'Grant'
    key GrantID : String(20) not null;
    @sap.label : 'Name'
    @sap.quickinfo : 'Short Description of the Grant'
    GrantName : String(20);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Sponsor'
    @sap.quickinfo : 'Grant Sponsor'
    GranteeMgmtSponsor : String(10);
    @sap.label : 'Sponsor Name'
    BusinessPartnerName : String(81);
    @sap.display.format : 'Date'
    @sap.filter.restriction : 'single-value'
    @sap.label : 'Validity Start Date'
    @sap.quickinfo : 'Valid-from Date'
    ValidityStartDate : Date;
    @sap.display.format : 'Date'
    @sap.filter.restriction : 'single-value'
    @sap.label : 'Validity End Date'
    @sap.quickinfo : 'Valid-to Date'
    ValidityEndDate : Date;
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Incoterms Classification'
  entity I_IncotermsClassification {
    @sap.display.format : 'UpperCase'
    @sap.text : 'IncotermsClassification_Text'
    @sap.label : 'Incoterms'
    @sap.quickinfo : 'Incoterms (Part 1)'
    key IncotermsClassification : String(3) not null;
    @sap.label : 'Incoterms Classification Description'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    IncotermsClassification_Text : String(30);
    @sap.label : 'Location Mandatory'
    @sap.quickinfo : 'Location is mandatory'
    LocationIsMandatory : Boolean;
    @sap.label : 'Language Key'
    language : String(2);
    @sap.label : 'Incoterms Classification Description'
    incotermsname : String(30);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Incoterms Classification - Text'
  entity I_IncotermsClassificationText {
    @sap.display.format : 'UpperCase'
    @sap.label : 'Incoterms'
    @sap.quickinfo : 'Incoterms (Part 1)'
    key IncotermsClassification : String(3) not null;
    @sap.label : 'Language Key'
    key Language : String(2) not null;
    @sap.label : 'Incoterms Classification Description'
    IncotermsClassificationName : String(30);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Internal Order'
  @sap.value.list : 'true'
  entity I_InternalOrderStdVH {
    @sap.display.format : 'UpperCase'
    @sap.text : 'InternalOrderDescription'
    @sap.label : 'Internal Order'
    key InternalOrder : String(12) not null;
    @sap.label : 'Internal Order Desc.'
    @sap.quickinfo : 'Internal Order Description'
    InternalOrderDescription : String(40);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Language'
  entity I_Language {
    @sap.text : 'Language_Text'
    @sap.label : 'Language Key'
    key Language : String(2) not null;
    @sap.label : 'Name'
    @sap.quickinfo : 'Name of Language'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    Language_Text : String(16);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Language Code'
    @sap.quickinfo : '2-Character SAP Language Code'
    LanguageISOCode : String(2);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.content.version : '1'
  @sap.label : 'Master Fixed Asset'
  entity I_MasterFixedAsset {
    @sap.display.format : 'UpperCase'
    @sap.label : 'Company Code'
    @sap.value.list : 'standard'
    key CompanyCode : String(4) not null;
    @sap.display.format : 'UpperCase'
    @sap.text : 'MasterFixedAssetDescription'
    @sap.label : 'Asset'
    @sap.quickinfo : 'Main Asset Number'
    key MasterFixedAsset : String(12) not null;
    @sap.label : 'Asset Main No. Text'
    @sap.quickinfo : 'Asset Main Number Text'
    MasterFixedAssetDescription : String(50);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Master Fixed Asset'
  entity I_MasterFixedAssetStdVH {
    @sap.display.format : 'UpperCase'
    @sap.label : 'Company Code'
    @sap.value.list : 'standard'
    key CompanyCode : String(4) not null;
    @sap.display.format : 'UpperCase'
    @sap.text : 'MasterFixedAssetDescription'
    @sap.label : 'Asset'
    @sap.quickinfo : 'Main Asset Number'
    key MasterFixedAsset : String(12) not null;
    @sap.label : 'Asset Main No. Text'
    @sap.quickinfo : 'Asset Main Number Text'
    MasterFixedAssetDescription : String(50);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Material'
  entity I_Material {
    @sap.display.format : 'UpperCase'
    @sap.text : 'Material_Text'
    @sap.label : 'Material'
    @sap.quickinfo : 'Material Number'
    key Material : String(40) not null;
    @sap.label : 'Material Description'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    Material_Text : String(40);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Material Type'
    MaterialType : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Material Group'
    MaterialGroup : String(9);
    @sap.label : 'Base Unit of Measure'
    @sap.semantics : 'unit-of-measure'
    MaterialBaseUnit : String(3);
    @sap.unit : 'MaterialWeightUnit'
    @sap.label : 'Gross Weight'
    MaterialGrossWeight : Decimal(13, 3);
    @sap.unit : 'MaterialWeightUnit'
    @sap.label : 'Net Weight'
    MaterialNetWeight : Decimal(13, 3);
    @sap.label : 'Unit of Weight'
    @sap.semantics : 'unit-of-measure'
    MaterialWeightUnit : String(3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Manufacturer'
    @sap.quickinfo : 'Number of a Manufacturer'
    MaterialManufacturerNumber : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Mfr Part Number'
    @sap.quickinfo : 'Manufacturer Part Number'
    MaterialManufacturerPartNumber : String(40);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Authorization Group'
    AuthorizationGroup : String(4);
    @sap.label : 'Batch Management'
    @sap.quickinfo : 'Batch Management Requirement Indicator'
    IsBatchManagementRequired : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Cross-plant CM'
    @sap.quickinfo : 'Cross-Plant Configurable Material'
    CrossPlantConfigurableProduct : String(40);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Material Category'
    ProductCategory : String(2);
    @sap.label : 'Color'
    @sap.quickinfo : 'Characteristic Value for Colors of Variants'
    ProductCharacteristic1 : String(18);
    @sap.label : 'Main Size'
    @sap.quickinfo : 'Characteristic Value for Main Sizes of Variants'
    ProductCharacteristic2 : String(18);
    @sap.label : 'Second Size'
    @sap.quickinfo : 'Characteristic Value for Second Size for Variants'
    ProductCharacteristic3 : String(18);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Int. Char. Number'
    @sap.quickinfo : 'Internal Charactieristic Number for Color Characteristics'
    ProdCharc1InternalNumber : String(30);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Int. Char. Number'
    @sap.quickinfo : 'Internal Char. Number for Characteristics for Main Sizes'
    ProdCharc2InternalNumber : String(30);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Int. Char. Number'
    @sap.quickinfo : 'Internal Char. Number for Characteristics for Second Sizes'
    ProdCharc3InternalNumber : String(30);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Material Group'
  entity I_MaterialGroup {
    @sap.display.format : 'UpperCase'
    @sap.text : 'MaterialGroup_Text'
    @sap.label : 'Product Group'
    key MaterialGroup : String(9) not null;
    @sap.label : 'Product Group Desc.'
    @sap.quickinfo : 'Product Group Description'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    MaterialGroup_Text : String(20);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Material Group Text'
  entity I_MaterialGroupText {
    @sap.display.format : 'UpperCase'
    @sap.label : 'Product Group'
    key MaterialGroup : String(9) not null;
    @sap.label : 'Language Key'
    key Language : String(2) not null;
    @sap.label : 'Product Group Desc.'
    @sap.quickinfo : 'Product Group Description'
    MaterialGroupName : String(20);
    @sap.label : 'Mat.Grp Desc. 2'
    @sap.quickinfo : 'Description of the Material Group'
    MaterialGroupText : String(60);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Material'
  @sap.value.list : 'true'
  entity I_MaterialStdVH {
    @sap.display.format : 'UpperCase'
    @sap.text : 'Material_Text'
    @sap.label : 'Material'
    @sap.quickinfo : 'Material Number'
    key Material : String(40) not null;
    @sap.label : 'Material Description'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    Material_Text : String(40);
    to_Text : Association to many I_MaterialText {  };
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Material Text'
  entity I_MaterialText {
    @sap.display.format : 'UpperCase'
    @sap.label : 'Material'
    @sap.quickinfo : 'Material Number'
    key Material : String(40) not null;
    @sap.label : 'Language Key'
    key Language : String(2) not null;
    @sap.label : 'Material Description'
    MaterialName : String(40);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Material Type'
  entity I_MaterialType {
    @sap.display.format : 'UpperCase'
    @sap.text : 'MaterialType_Text'
    @sap.label : 'Material Type'
    key MaterialType : String(4) not null;
    @sap.label : 'Material Type Desc.'
    @sap.quickinfo : 'Description of Material Type'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    MaterialType_Text : String(25);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Authorization group'
    @sap.quickinfo : 'Authorization group in the material master'
    AuthorizationGroup : String(4);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Purchasing Cost Center Value Help'
  entity I_MM_CostCenterValueHelp {
    @sap.display.format : 'UpperCase'
    @sap.text : 'CostCenter_Text'
    @sap.label : 'Cost Center'
    key CostCenter : String(10) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Controlling Area'
    key ControllingArea : String(4) not null;
    @sap.display.format : 'Date'
    @sap.filter.restriction : 'interval'
    @sap.label : 'Valid To'
    @sap.quickinfo : 'Valid To Date'
    key ValidityEndDate : Date not null;
    @sap.label : 'Cost Center Name'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    CostCenter_Text : String(20);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Company Code'
    @sap.value.list : 'standard'
    CompanyCode : String(4);
    @sap.label : 'Person Responsible'
    CostCtrResponsiblePersonName : String(20);
    @sap.display.format : 'Date'
    @sap.filter.restriction : 'interval'
    @sap.label : 'Valid From'
    @sap.quickinfo : 'Valid-From Date'
    ValidityStartDate : Date;
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Purchasing GL Account Value Help'
  entity I_MM_GLAccountVH {
    @sap.display.format : 'UpperCase'
    @sap.text : 'GLAccount_Text'
    @sap.label : 'G/L Account'
    @sap.quickinfo : 'G/L Account Number'
    key GLAccount : String(10) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Company Code'
    key CompanyCode : String(4) not null;
    @sap.label : 'G/L Account Name'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    GLAccount_Text : String(20);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Chart of Accounts'
    ChartOfAccounts : String(4);
    @sap.label : 'G/L Account Long Name'
    GLAccountLongName : String(50);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.content.version : '1'
  @sap.label : 'Partner Function'
  entity I_PartnerFunction {
    @sap.display.format : 'UpperCase'
    @sap.text : 'PartnerFunction_Text'
    @sap.label : 'Partner Function'
    key PartnerFunction : String(2) not null;
    @sap.label : 'Name'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    PartnerFunction_Text : String(20);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Partner Type'
    @sap.quickinfo : 'Type of partner number'
    SDDocumentPartnerType : String(2);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.content.version : '1'
  @sap.label : 'Partner Function - Text'
  entity I_PartnerFunctionText {
    @sap.display.format : 'UpperCase'
    @sap.label : 'Partner Function'
    key PartnerFunction : String(2) not null;
    @sap.label : 'Language Key'
    key Language : String(2) not null;
    @sap.label : 'Name'
    PartnerFunctionName : String(20);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Payment Terms'
  entity I_PaymentTerms {
    @sap.display.format : 'UpperCase'
    @sap.text : 'PaymentTerms_Text'
    @sap.label : 'Payment Terms'
    @sap.quickinfo : 'Terms of Payment Key'
    key PaymentTerms : String(4) not null;
    @sap.label : 'Description'
    @sap.quickinfo : 'Description of terms of payment'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    PaymentTerms_Text : String(30);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.content.version : '1'
  @sap.label : 'Payment Term - Text'
  entity I_PaymentTermsText {
    @sap.label : 'Language Key'
    key Language : String(2) not null;
    @sap.display.format : 'UpperCase'
    @sap.text : 'PaymentTermsName'
    @sap.label : 'Payment Terms'
    @sap.quickinfo : 'Terms of Payment Key'
    key PaymentTerms : String(4) not null;
    @sap.label : 'Description'
    @sap.quickinfo : 'Description of terms of payment'
    PaymentTermsName : String(30);
    @sap.attribute.for : 'PaymentTerms'
    @sap.display.format : 'UpperCase'
    @sap.label : 'Payment Terms'
    @sap.quickinfo : 'Payment Terms Description'
    PaymentTermsDescription : String(1024);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Plant'
  entity I_Plant {
    @sap.display.format : 'UpperCase'
    @sap.text : 'PlantName'
    @sap.label : 'Plant'
    key Plant : String(4) not null;
    @sap.label : 'Plant Name'
    PlantName : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Valuation Area'
    ValuationArea : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Customer No Plant'
    @sap.quickinfo : 'Customer Number of Plant'
    @sap.value.list : 'standard'
    PlantCustomer : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Sppl. No. Plnt'
    @sap.quickinfo : 'Supplier Number of Plant'
    @sap.value.list : 'standard'
    PlantSupplier : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Factory Calendar'
    @sap.quickinfo : 'Factory calendar key'
    FactoryCalendar : String(2);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purch. Organization'
    @sap.quickinfo : 'Purchasing Organization'
    DefaultPurchasingOrganization : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Sls Organization ICB'
    @sap.quickinfo : 'Sales Organization for Intercompany Billing'
    SalesOrganization : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Address'
    AddressID : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Plant Cat.'
    @sap.quickinfo : 'Plant category'
    PlantCategory : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Distrib.Channel'
    @sap.quickinfo : 'Distribution Channel for Intercompany billing'
    DistributionChannel : String(2);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Interco. Billing Div'
    @sap.quickinfo : 'Division for Intercompany Billing'
    Division : String(2);
    @sap.label : 'Language Key'
    Language : String(2);
    @sap.label : 'Archiving Flag'
    @sap.quickinfo : 'Central archiving marker for master record'
    IsMarkedForArchiving : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Country/Region Key'
    Country : String(3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Business Place'
    BusinessPlace : String(4);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Product Type'
  entity I_Producttype {
    @sap.display.format : 'UpperCase'
    @sap.text : 'ProductType_Text'
    @sap.label : 'Product Type'
    key ProductType : String(4) not null;
    @sap.label : 'Product Type Description'
    @sap.quickinfo : 'Description of product type'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    ProductType_Text : String(25);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Product Type Group'
    ProductTypeCode : String(2);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Authorization Group'
    @sap.quickinfo : 'Authorization group in the material master'
    AuthorizationGroup : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Maintenance Status'
    MaintenanceStatus : String(15);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Ref. Material Type'
    @sap.quickinfo : 'Reference material type'
    ReferenceProductType : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Acct Cat. Reference'
    @sap.quickinfo : 'Account category reference'
    AcctCategoryRef : String(4);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Product Type Code - Text'
  entity I_ProductTypeCodeText {
    @sap.display.format : 'UpperCase'
    @sap.label : 'Product Type Group'
    key ProductTypeCode : String(2) not null;
    @sap.label : 'Language Key'
    key Language : String(2) not null;
    @sap.label : 'Description'
    @sap.quickinfo : 'Product Type Group Description'
    Name : String(40);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Profit Center'
  @sap.value.list : 'true'
  entity I_ProfitCenterStdVH {
    @sap.display.format : 'UpperCase'
    @sap.label : 'Controlling Area'
    key ControllingArea : String(4) not null;
    @sap.display.format : 'UpperCase'
    @sap.text : 'ProfitCenter_Text'
    @sap.label : 'Profit Center'
    key ProfitCenter : String(10) not null;
    @sap.display.format : 'Date'
    @sap.label : 'Valid To'
    @sap.quickinfo : 'Valid To Date'
    key ValidityEndDate : Date not null;
    @sap.label : 'Profit Center Name'
    @sap.quickinfo : 'Description of Profit Center'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    ProfitCenter_Text : String(20);
    @sap.display.format : 'Date'
    @sap.label : 'Valid From'
    @sap.quickinfo : 'Valid-From Date'
    ValidityStartDate : Date;
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Profit Center - Text'
  entity I_ProfitCenterText {
    @sap.label : 'Language Key'
    key Language : String(2) not null;
    @sap.display.format : 'UpperCase'
    @sap.text : 'ControllingArea_Text'
    @sap.label : 'Controlling Area'
    @sap.value.list : 'standard'
    key ControllingArea : String(4) not null;
    @sap.display.format : 'UpperCase'
    @sap.text : 'ProfitCenterLongName'
    @sap.label : 'Profit Center'
    key ProfitCenter : String(10) not null;
    @sap.label : 'Controlling Area Name'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    ControllingArea_Text : String(25);
    @sap.display.format : 'Date'
    @sap.label : 'Valid To'
    @sap.quickinfo : 'Valid To Date'
    ValidityEndDate : Date;
    @sap.display.format : 'Date'
    @sap.label : 'Valid From'
    @sap.quickinfo : 'Valid-From Date'
    ValidityStartDate : Date;
    @sap.attribute.for : 'ProfitCenter'
    @sap.label : 'Profit Center Name'
    @sap.quickinfo : 'Description of Profit Center'
    ProfitCenterName : String(20);
    @sap.label : 'Profit Center Description'
    @sap.quickinfo : 'Description of Profit Center'
    ProfitCenterLongName : String(40);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.content.version : '1'
  @sap.label : 'Project Network Details'
  entity I_ProjectNetwork {
    @sap.display.format : 'UpperCase'
    @sap.text : 'ProjectNetworkDescription'
    @sap.label : 'Network'
    @sap.quickinfo : 'Order Number'
    key ProjectNetwork : String(12) not null;
    @sap.label : 'Network Name'
    @sap.quickinfo : 'Description'
    ProjectNetworkDescription : String(40);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Project def.'
    @sap.quickinfo : 'Project definition'
    ProjectInternalID : String(24);
    @sap.display.format : 'NonNegative'
    @sap.label : 'WBS Element'
    @sap.quickinfo : 'Work Breakdown Structure Element (WBS Element)'
    WBSElementInternalID : String(24);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Order Internal ID'
    ProjectNetworkInternalID : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Business Area'
    BusinessArea : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Company Code'
    CompanyCode : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Controlling Area'
    ControllingArea : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Profit Center'
    ProfitCenter : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Responsible Cost Center'
    CostCenter : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Plant'
    Plant : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Sales Order'
    @sap.quickinfo : 'Sales Order Number'
    SalesOrder : String(10);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Sales Order Item'
    @sap.quickinfo : 'Item Number in Sales Order'
    SalesOrderItem : String(6);
    @sap.display.format : 'UpperCase'
    @sap.label : 'MRP Controller'
    MRPController : String(3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Planner Group'
    @sap.quickinfo : 'Responsible Planner Group/Department'
    ResponsiblePlannerGroup : String(3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Change Number'
    ChangeNumber : String(12);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Priority'
    @sap.quickinfo : 'Order priority'
    PriorityCode : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Subnetwork of'
    @sap.quickinfo : 'Number of superior network'
    SuperiorProjectNetwork : String(12);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Internal Object No.'
    @sap.quickinfo : 'Internal Object Number'
    ProductConfiguration : String(18);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Network Profile'
    NetworkProfile : String(7);
    @sap.display.format : 'Date'
    @sap.label : 'Scheduled on'
    @sap.quickinfo : 'Date of the Last Scheduling'
    LastScheduledDate : Date;
    @sap.display.format : 'Date'
    @sap.label : 'Actual Finish Date'
    @sap.quickinfo : 'Confirmed Order Finish Date'
    ConfirmedEndDate : Date;
    @sap.display.format : 'Date'
    @sap.label : 'Sched. Release Date'
    @sap.quickinfo : 'Scheduled Release Date'
    ScheduledReleaseDate : Date;
    @sap.display.format : 'Date'
    @sap.label : 'Actual Release Date'
    ActualReleasedDate : Date;
    @sap.display.format : 'Date'
    @sap.label : 'Actual Start Date'
    ActualStartDate : Date;
    @sap.display.format : 'Date'
    @sap.label : 'Actual Finish Date'
    ActualEndDate : Date;
    @sap.display.format : 'Date'
    @sap.label : 'Basic Start Date'
    PlannedStartDate : Date;
    @sap.display.format : 'Date'
    @sap.label : 'Basic finish date'
    PlannedEndDate : Date;
    @sap.display.format : 'Date'
    @sap.label : 'Start date'
    @sap.quickinfo : 'Forecast start date'
    ForecastedStartDate : Date;
    @sap.display.format : 'Date'
    @sap.label : 'Finish date'
    @sap.quickinfo : 'Finish date (forecast)'
    ForecastedEndDate : Date;
    @sap.display.format : 'Date'
    @sap.label : 'Scheduled start'
    @sap.quickinfo : 'Scheduled forecast start'
    ScheduledForecastedStartDate : Date;
    @sap.display.format : 'Date'
    @sap.label : 'Scheduled finish'
    @sap.quickinfo : 'Scheduled forecast finish'
    ScheduledForecastedEndDate : Date;
    @sap.display.format : 'Date'
    @sap.label : 'Sched. release date'
    @sap.quickinfo : 'Scheduled release date (forecast)'
    ScheduledFcstdReleaseDate : Date;
    @sap.display.format : 'Date'
    @sap.label : 'Scheduled start'
    ScheduledBasicStartDate : Date;
    @sap.display.format : 'Date'
    @sap.label : 'Sched. Finish Date'
    @sap.quickinfo : 'Scheduled Finish Date'
    ScheduledBasicEndDate : Date;
    @sap.display.format : 'NonNegative'
    @sap.label : 'Reservation'
    @sap.quickinfo : 'Number of reservation/dependent requirements'
    Reservation : String(10);
    @sap.display.format : 'Date'
    @sap.label : 'Order Creation Date'
    CreationDate : Date;
    @sap.label : 'Order Creation Time'
    CreationTime : Time;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Created By'
    @sap.quickinfo : 'Payment Cards: Created By'
    CreatedByUser : String(12);
    @sap.display.format : 'Date'
    @sap.label : 'Changed On'
    @sap.quickinfo : 'Date of the Last Change to the Info Object'
    LastChangeDate : Date;
    @sap.label : 'Changed At'
    LastChangeTime : Time;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Last Changed By'
    LastChangedByUser : String(12);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Network Type'
    @sap.quickinfo : 'Order Type'
    ProjectNetworkType : String(4);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Order Category'
    OrderCategory : String(2);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Orig. Cost Object'
    @sap.quickinfo : 'JV original cost object'
    JointVentureOriginalCostObject : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'JV Object Type'
    @sap.quickinfo : 'Joint Venture Object Type'
    JointVentureObjectType : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Joint venture'
    JointVenture : String(6);
    @sap.display.format : 'UpperCase'
    @sap.label : 'JIB/JIBE Class'
    JointVentureClass : String(3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'JIB/JIBE Subclass A'
    JointVentureSubClass : String(5);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Tax Jur. Code'
    @sap.quickinfo : 'Tax Jurisdiction Code in BV Document'
    TaxJurisdiction : String(15);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Costing Sheet'
    CostingSheet : String(6);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Cost Element'
    @sap.quickinfo : 'Settlement Cost Element'
    CostElement : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Object Number'
    @sap.quickinfo : 'Object Internal ID'
    ProjectNetworkObject : String(22);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Currency'
    @sap.quickinfo : 'Order Currency'
    @sap.semantics : 'currency-code'
    Currency : String(5);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Overhead Key'
    OverheadCode : String(6);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Interest Profile'
    @sap.quickinfo : 'Interest Profile for Project/Order Interest Calculation'
    ProjNtwkInterestCalcProfile : String(7);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Confirmation'
    @sap.quickinfo : 'Completion confirmation number for the operation'
    NetworkActivityConfirmation : String(10);
    @sap.label : 'Deletion Flag'
    IsMarkedForDeletion : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Act. Costing Variant'
    @sap.quickinfo : 'Costing Variant For Actual Costs'
    ActualCostsCostingVariant : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Plnd Costing Variant'
    @sap.quickinfo : 'Costing Variant for Planned Costs'
    PlannedCostsCostingVariant : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Sched. type forecast'
    @sap.quickinfo : 'Scheduling type (forecast)'
    ForecastSchedulingType : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Scheduling Type'
    BasicSchedulingType : String(1);
    @sap.label : 'Base Unit of Measure'
    @sap.semantics : 'unit-of-measure'
    BaseUnit : String(3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Functional Area'
    FunctionalArea : String(16);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Calculate Capacity Requirements'
    @sap.quickinfo : 'ID of the Capacity Requirements Record'
    CapacityRequirement : String(12);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Order'
    @sap.quickinfo : 'Order Number'
    OrderID : String(12);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Controlling Object Class'
    ControllingObjectClass : String(2);
    @sap.display.format : 'UpperCase'
    @sap.label : 'No Automatic Costing'
    @sap.quickinfo : 'Indicator: Do Not Cost Automatically'
    OrderIsNotCostedAutomatically : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'No Automatic Scheduling'
    @sap.quickinfo : 'Indicator: Do Not Schedule Automatically'
    OrdIsNotSchedldAutomatically : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Account assignment'
    @sap.quickinfo : 'Indicator for the account assignment of a network(hdr/act.)'
    NetworkIsAccountAssigned : String(1);
    @sap.label : 'Object-based Auth.'
    @sap.quickinfo : 'Indicator Object-based authorizations are active'
    ObjBasedAuthorizationIsActive : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Respons. Cost Center'
    @sap.quickinfo : 'Responsible Cost Center'
    ResponsibleCostCenter : String(10);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Project Network Value Help'
  @sap.value.list : 'true'
  entity I_ProjectNtwkValueHelp {
    @sap.display.format : 'UpperCase'
    @sap.text : 'ProjectNetworkDescription'
    @sap.label : 'Network'
    @sap.quickinfo : 'Order Number'
    key ProjectNetwork : String(12) not null;
    @sap.label : 'Network Name'
    @sap.quickinfo : 'Description'
    ProjectNetworkDescription : String(40);
    @sap.label : 'Network Language-Dependent Short Text'
    @sap.quickinfo : 'Language-Dependent Short Text'
    LanguageBasedShortText : String(40);
    @sap.display.format : 'UpperCase'
    @sap.text : 'ProjectDescription'
    @sap.label : 'Project definition'
    Project : String(24);
    @sap.label : 'Project Def. Name'
    @sap.quickinfo : 'Project Definition Name'
    ProjectDescription : String(40);
    @sap.display.format : 'UpperCase'
    @sap.text : 'WBSDescription'
    @sap.label : 'WBS Element'
    @sap.quickinfo : 'Work Breakdown Structure Element (WBS Element)'
    WBSElement : String(24);
    @sap.label : 'WBS Element Name'
    @sap.quickinfo : 'Work Breakdown Structure Element Name'
    WBSDescription : String(40);
    @sap.display.format : 'UpperCase'
    @sap.label : 'MRP Controller'
    MRPController : String(3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Network Type'
    @sap.quickinfo : 'Order Type'
    ProjectNetworkType : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Plant'
    Plant : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Object Number'
    @sap.quickinfo : 'Object Internal ID'
    ProjectNetworkObject : String(22);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Purchase Contract Item'
  @sap.value.list : 'true'
  entity I_PurchaseContractItemStdVH {
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purchase Contract'
    @sap.quickinfo : 'Purchasing Contract Header'
    key PurchaseContract : String(10) not null;
    @sap.display.format : 'NonNegative'
    @sap.label : 'Item'
    @sap.quickinfo : 'Item Number of Purchasing Contract'
    key PurchaseContractItem : String(5) not null;
    @sap.display.format : 'UpperCase'
    @sap.text : 'PurgDocItemCategoryName'
    @sap.label : 'Item Category'
    @sap.quickinfo : 'Item category in purchasing document'
    PurchasingDocumentItemCategory : String(1);
    @sap.label : 'Text for Item Cat.'
    @sap.quickinfo : 'Text for Item Category'
    PurgDocItemCategoryName : String(20);
    @sap.label : 'Short Text'
    PurchaseContractItemText : String(40);
    @sap.label : 'Item Set'
    @sap.quickinfo : 'Item is statistical'
    IsStatisticalItem : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Hierarchy Number'
    PurgConfigurableItemNumber : String(40);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Material'
    @sap.quickinfo : 'Material Number'
    Material : String(40);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Material Group'
    MaterialGroup : String(9);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Product Type Group'
    ProductTypeCode : String(2);
    @sap.unit : 'DocumentCurrency'
    @sap.label : 'Net Order Price'
    @sap.quickinfo : 'Net Price in Purchasing Document (in Document Currency)'
    ContractNetPriceAmount : Decimal(12, 3);
    @sap.unit : 'OrderQuantityUnit'
    @sap.label : 'Target Quantity'
    TargetQuantity : Decimal(13, 3);
    @sap.label : 'Order Unit'
    @sap.quickinfo : 'Purchase Order Unit of Measure'
    @sap.semantics : 'unit-of-measure'
    OrderQuantityUnit : String(3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Currency'
    @sap.quickinfo : 'Currency Key'
    @sap.semantics : 'currency-code'
    DocumentCurrency : String(5);
    @sap.label : 'Order Price Unit'
    @sap.quickinfo : 'Order Price Unit (Purchasing)'
    @sap.semantics : 'unit-of-measure'
    OrderPriceUnit : String(3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Company Code'
    CompanyCode : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Plant'
    Plant : String(4);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.content.version : '1'
  @sap.label : 'Purchase Order'
  entity I_PurchaseOrder {
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purchase Order'
    @sap.quickinfo : 'Purchase Order Number'
    key PurchaseOrder : String(10) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purchase Order Type'
    PurchaseOrderType : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Control indicator'
    @sap.quickinfo : 'Control indicator for purchasing document type'
    PurchaseOrderSubtype : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Status'
    @sap.quickinfo : 'Status of Purchasing Document'
    PurchasingDocumentOrigin : String(1);
    @sap.label : 'Document aged'
    @sap.quickinfo : 'Document is aged'
    PurchasingDocumentIsAged : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Created By'
    @sap.quickinfo : 'User of person who created a purchasing document'
    CreatedByUser : String(12);
    @sap.display.format : 'Date'
    @sap.label : 'Created On'
    @sap.quickinfo : 'Creation Date of Purchasing Document'
    CreationDate : Date;
    @sap.display.format : 'Date'
    @sap.label : 'Purchase Order Date'
    PurchaseOrderDate : Date;
    @sap.label : 'Language Key'
    Language : String(2);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Deletion Indicator'
    @sap.quickinfo : 'Deletion Indicator in Purchasing Document'
    PurchasingDocumentDeletionCode : String(1);
    @sap.label : 'Subject to Release'
    @sap.quickinfo : 'Release Not Yet Completely Effected'
    ReleaseIsNotCompleted : Boolean;
    @sap.label : 'Incomplete'
    @sap.quickinfo : 'Purchase order not yet complete'
    PurchasingCompletenessStatus : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Proc. State'
    @sap.quickinfo : 'Purchasing Document Processing State'
    PurchasingProcessingStatus : String(2);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Release State'
    PurgReleaseSequenceStatus : String(8);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Release indicator'
    @sap.quickinfo : 'Release Indicator: Purchasing Document'
    ReleaseCode : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Release Strategy'
    PurchasingReleaseStrategy : String(2);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Company Code'
    CompanyCode : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purch. Organization'
    @sap.quickinfo : 'Purchasing Organization'
    PurchasingOrganization : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purchasing Group'
    PurchasingGroup : String(3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Supplier'
    Supplier : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Address Number'
    ManualSupplierAddressID : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Address Number'
    SupplierAddressID : String(10);
    @sap.label : 'Salesperson'
    @sap.quickinfo : 'Responsible Salesperson at Supplier''s Office'
    SupplierRespSalesPersonName : String(30);
    @sap.label : 'Supplier Phone'
    @sap.quickinfo : 'Supplier''s Phone Number'
    SupplierPhoneNumber : String(16);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Goods Supplier'
    SupplyingSupplier : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Supplying Plant'
    @sap.quickinfo : 'Supplying (issuing) plant in case of stock transport order'
    SupplyingPlant : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Invoicing Party'
    @sap.quickinfo : 'Different Invoicing Party'
    InvoicingParty : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Customer'
    @sap.quickinfo : 'Customer Number'
    Customer : String(10);
    @sap.label : 'Your Reference'
    CorrespncExternalReference : String(12);
    @sap.label : 'Our Reference'
    CorrespncInternalReference : String(12);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Outline agreement'
    @sap.quickinfo : 'Number of principal purchase agreement'
    PurchaseContract : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Bid invitation'
    @sap.quickinfo : 'Bid invitation number'
    RequestForQuotation : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Quotation'
    @sap.quickinfo : 'Quotation Number'
    SupplierQuotationExternalID : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Payment Terms'
    @sap.quickinfo : 'Terms of Payment Key'
    PaymentTerms : String(4);
    @sap.label : 'Days 1'
    @sap.quickinfo : 'Cash Discount Days 1'
    CashDiscount1Days : Decimal(3, 0);
    @sap.label : 'Days 2'
    @sap.quickinfo : 'Cash Discount Days 2'
    CashDiscount2Days : Decimal(3, 0);
    @sap.label : 'Days Net'
    @sap.quickinfo : 'Net Payment Terms Period'
    NetPaymentDays : Decimal(3, 0);
    @sap.label : 'CD Percentage 1'
    @sap.quickinfo : 'Cash Discount Percentage 1'
    CashDiscount1Percent : Decimal(5, 3);
    @sap.label : 'CD Percentage 2'
    @sap.quickinfo : 'Cash Discount Percentage 2'
    CashDiscount2Percent : Decimal(5, 3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Down Payment'
    @sap.quickinfo : 'Down Payment Indicator'
    DownPaymentType : String(4);
    @sap.label : 'Down Payment %'
    @sap.quickinfo : 'Down Payment Percentage'
    DownPaymentPercentageOfTotAmt : Decimal(5, 2);
    @sap.unit : 'DocumentCurrency'
    @sap.label : 'Down Payment Amount'
    @sap.quickinfo : 'Down Payment Amount in Document Currency'
    DownPaymentAmount : Decimal(12, 3);
    @sap.display.format : 'Date'
    @sap.label : 'Due Date for DP'
    @sap.quickinfo : 'Due Date for Down Payment'
    DownPaymentDueDate : Date;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Incoterms'
    @sap.quickinfo : 'Incoterms (Part 1)'
    IncotermsClassification : String(3);
    @sap.label : 'Incoterms (Part 2)'
    IncotermsTransferLocation : String(28);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Incoterms Version'
    IncotermsVersion : String(4);
    @sap.label : 'Incoterms Location 1'
    IncotermsLocation1 : String(70);
    @sap.label : 'Incoterms Location 2'
    IncotermsLocation2 : String(70);
    @sap.label : 'Intrastat Relevance'
    @sap.quickinfo : 'Relevant for Intrastat Reporting'
    IsIntrastatReportingRelevant : Boolean;
    @sap.label : 'Intrastat Exclusion'
    @sap.quickinfo : 'Exclude from Intrastat Reporting'
    IsIntrastatReportingExcluded : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Doc. Condition No.'
    @sap.quickinfo : 'Number of the Document Condition'
    PurchasingDocumentCondition : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Procedure'
    @sap.quickinfo : 'Procedure (Pricing, Output Control, Acct. Det., Costing,...)'
    PricingProcedure : String(6);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Currency'
    @sap.quickinfo : 'Currency Key'
    @sap.semantics : 'currency-code'
    DocumentCurrency : String(5);
    @sap.display.format : 'Date'
    @sap.label : 'Validity Per. Start'
    @sap.quickinfo : 'Start of Validity Period'
    ValidityStartDate : Date;
    @sap.display.format : 'Date'
    @sap.label : 'Validity Period End'
    @sap.quickinfo : 'End of Validity Period'
    ValidityEndDate : Date;
    @sap.label : 'Fixed Exchange Rate'
    @sap.quickinfo : 'Indicator for Fixed Exchange Rate'
    ExchangeRateIsFixed : Boolean;
    @odata.Type : 'Edm.DateTimeOffset'
    @odata.Precision : 7
    @sap.label : 'Last Changed'
    @sap.quickinfo : 'Change Time Stamp'
    LastChangeDateTime : Timestamp;
    @sap.label : 'Busin. Purp. Cmpltd.'
    @sap.quickinfo : 'Business Purpose Completed'
    IsEndOfPurposeBlocked : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Reporting C/R'
    @sap.quickinfo : 'Country/Region for Tax Report'
    TaxReturnCountry : String(3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Ctry/Rgn Sls Tax No.'
    @sap.quickinfo : 'Country/Region of Sales Tax ID Number'
    VATRegistrationCountry : String(3);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Reason for Canc.'
    @sap.quickinfo : 'Reason for Cancellation'
    PurgReasonForDocCancellation : String(2);
    @sap.unit : 'DocumentCurrency'
    @sap.label : 'Tot. val. rel.'
    @sap.quickinfo : 'Total value at time of release'
    PurgReleaseTimeTotalAmount : Decimal(16, 3);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.content.version : '1'
  @sap.semantics : 'aggregate'
  @sap.label : 'Purchase Order enhanced'
  entity I_PurchaseOrderEnhanced {
    @sap.sortable : 'false'
    @sap.filterable : 'false'
    key ID : String not null;
    @odata.Type : 'Edm.Byte'
    @sap.label : 'Dyn. Field Control'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    @sap.sortable : 'false'
    @sap.filterable : 'false'
    PurchasingHasItemHierarchy_fc : Integer;
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purchase Order'
    @sap.quickinfo : 'Purchase Order Number'
    PurchaseOrder : String(10);
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purchasing Doc. Type'
    @sap.quickinfo : 'Purchasing Document Type'
    PurchaseOrderType : String(4);
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'UpperCase'
    @sap.label : 'Control indicator'
    @sap.quickinfo : 'Control indicator for purchasing document type'
    PurchaseOrderSubtype : String(1);
    @sap.aggregation.role : 'dimension'
    @sap.label : 'Document aged'
    @sap.quickinfo : 'Document is aged'
    PurchasingDocumentIsAged : Boolean;
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'UpperCase'
    @sap.label : 'Status'
    @sap.quickinfo : 'Status of Purchasing Document'
    PurchasingDocumentOrigin : String(1);
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'UpperCase'
    @sap.label : 'Process Indicator'
    @sap.quickinfo : 'Process Indicator for Purchase Order'
    PurchasingDocumentProcessCode : String(3);
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'UpperCase'
    @sap.label : 'Created By'
    @sap.quickinfo : 'User of person who created a purchasing document'
    CreatedByUser : String(12);
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'Date'
    @sap.label : 'Created On'
    @sap.quickinfo : 'Creation Date of Purchasing Document'
    CreationDate : Date;
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'Date'
    @sap.label : 'Purchase Order Date'
    PurchaseOrderDate : Date;
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'Date'
    @sap.label : 'Validity Per. Start'
    @sap.quickinfo : 'Start of Validity Period'
    ValidityStartDate : Date;
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'Date'
    @sap.label : 'Validity Period End'
    @sap.quickinfo : 'End of Validity Period'
    ValidityEndDate : Date;
    @sap.aggregation.role : 'dimension'
    @sap.label : 'Language Key'
    Language : String(2);
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'UpperCase'
    @sap.label : 'Deletion Code'
    @sap.quickinfo : 'Purchase Order Deletion Code'
    PurchasingDocumentDeletionCode : String(1);
    @sap.aggregation.role : 'dimension'
    @sap.label : 'Subject to Release'
    @sap.quickinfo : 'Release Not Yet Completely Effected'
    ReleaseIsNotCompleted : Boolean;
    @sap.aggregation.role : 'dimension'
    @sap.label : 'Incomplete'
    @sap.quickinfo : 'Purchase order not yet complete'
    PurchasingCompletenessStatus : Boolean;
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'UpperCase'
    @sap.label : 'Company Code'
    CompanyCode : String(4);
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purch. Organization'
    @sap.quickinfo : 'Purchasing Organization'
    PurchasingOrganization : String(4);
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purchasing Group'
    PurchasingGroup : String(3);
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'UpperCase'
    @sap.label : 'Supplier'
    Supplier : String(10);
    @sap.aggregation.role : 'dimension'
    @sap.label : 'Salesperson'
    @sap.quickinfo : 'Responsible Salesperson at Supplier''s Office'
    SupplierRespSalesPersonName : String(30);
    @sap.aggregation.role : 'dimension'
    @sap.label : 'Supplier Phone'
    @sap.quickinfo : 'Supplier''s Phone Number'
    SupplierPhoneNumber : String(16);
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'UpperCase'
    @sap.label : 'Address Number'
    ManualSupplierAddressID : String(10);
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'UpperCase'
    @sap.label : 'Address Number'
    SupplierAddressID : String(10);
    @sap.aggregation.role : 'dimension'
    @sap.label : 'Name'
    SupplierName : String(35);
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'UpperCase'
    @sap.label : 'Goods Supplier'
    SupplyingSupplier : String(10);
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'UpperCase'
    @sap.label : 'Supplying Plant'
    @sap.quickinfo : 'Supplying (issuing) plant in case of stock transport order'
    SupplyingPlant : String(4);
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'UpperCase'
    @sap.label : 'Invoicing Party'
    @sap.quickinfo : 'Different Invoicing Party'
    InvoicingParty : String(10);
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'UpperCase'
    @sap.label : 'Payment Terms'
    @sap.quickinfo : 'Terms of Payment Key'
    PaymentTerms : String(4);
    @sap.aggregation.role : 'dimension'
    @sap.label : 'Days 1'
    @sap.quickinfo : 'Cash Discount Days 1'
    CashDiscount1Days : Decimal(3, 0);
    @sap.aggregation.role : 'dimension'
    @sap.label : 'Days 2'
    @sap.quickinfo : 'Cash Discount Days 2'
    CashDiscount2Days : Decimal(3, 0);
    @sap.aggregation.role : 'dimension'
    @sap.label : 'Days Net'
    @sap.quickinfo : 'Net Payment Terms Period'
    NetPaymentDays : Decimal(3, 0);
    @sap.aggregation.role : 'dimension'
    @sap.label : 'CD Percentage 1'
    @sap.quickinfo : 'Cash Discount Percentage 1'
    CashDiscount1Percent : Decimal(5, 3);
    @sap.aggregation.role : 'dimension'
    @sap.label : 'CD Percentage 2'
    @sap.quickinfo : 'Cash Discount Percentage 2'
    CashDiscount2Percent : Decimal(5, 3);
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'UpperCase'
    @sap.label : 'Incoterms'
    @sap.quickinfo : 'Incoterms (Part 1)'
    IncotermsClassification : String(3);
    @sap.aggregation.role : 'dimension'
    @sap.label : 'Incoterms (Part 2)'
    IncotermsTransferLocation : String(28);
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'UpperCase'
    @sap.label : 'Incoterms Version'
    IncotermsVersion : String(4);
    @sap.aggregation.role : 'dimension'
    @sap.label : 'Incoterms Location 1'
    IncotermsLocation1 : String(70);
    @sap.aggregation.role : 'dimension'
    @sap.label : 'Incoterms Location 2'
    IncotermsLocation2 : String(70);
    @sap.aggregation.role : 'dimension'
    @sap.label : 'Your Reference'
    CorrespncExternalReference : String(12);
    @sap.aggregation.role : 'dimension'
    @sap.label : 'Our Reference'
    CorrespncInternalReference : String(12);
    @sap.aggregation.role : 'dimension'
    @sap.label : 'Intrastat Relevance'
    @sap.quickinfo : 'Relevant for Intrastat Reporting'
    IsIntrastatReportingRelevant : Boolean;
    @sap.aggregation.role : 'dimension'
    @sap.label : 'Intrastat Exclusion'
    @sap.quickinfo : 'Exclude from Intrastat Reporting'
    IsIntrastatReportingExcluded : Boolean;
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'UpperCase'
    @sap.label : 'Doc. Condition No.'
    @sap.quickinfo : 'Number of the Document Condition'
    PurchasingDocumentCondition : String(10);
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'UpperCase'
    @sap.label : 'Procedure'
    @sap.quickinfo : 'Procedure (Pricing, Output Control, Acct. Det., Costing,...)'
    PricingProcedure : String(6);
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'UpperCase'
    @sap.label : 'Currency'
    @sap.quickinfo : 'Currency Key'
    @sap.semantics : 'currency-code'
    DocumentCurrency : String(5);
    @sap.aggregation.role : 'dimension'
    @sap.label : 'Busin. Purp. Cmpltd.'
    @sap.quickinfo : 'Business Purpose Completed'
    IsEndOfPurposeBlocked : Boolean;
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'UpperCase'
    @sap.label : 'Shipping Type'
    PurgDocDefaultShippingType : String(2);
    @sap.aggregation.role : 'measure'
    @sap.unit : 'DocumentCurrency'
    @sap.filterable : 'false'
    PurchaseOrderNetAmount : Decimal(24, 3);
    @sap.aggregation.role : 'dimension'
    PurchasingDocumentStatus : String(2);
    @sap.aggregation.role : 'dimension'
    NumberOfOverduePurOrdItm : Integer;
    @sap.aggregation.role : 'dimension'
    @sap.field.control : 'PurchasingHasItemHierarchy_fc'
    @sap.label : 'Checkbox'
    @sap.heading : ''
    PurchasingHasItemHierarchy : Boolean;
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.content.version : '1'
  @sap.label : 'Purchase Order Item'
  entity I_PurchaseOrderItem {
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purchasing Document'
    @sap.quickinfo : 'Purchasing Document Number'
    key PurchaseOrder : String(10) not null;
    @sap.display.format : 'NonNegative'
    @sap.label : 'Purchase Order Item'
    @sap.quickinfo : 'Item Number of Purchase Order'
    key PurchaseOrderItem : String(5) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Document Item'
    @sap.quickinfo : 'Concatenation of EBELN and EBELP'
    PurchaseOrderItemUniqueID : String(15);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purch. Doc. Category'
    @sap.quickinfo : 'Purchasing Document Category'
    PurchaseOrderCategory : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Currency'
    @sap.quickinfo : 'Currency Key'
    @sap.semantics : 'currency-code'
    DocumentCurrency : String(5);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Deletion Indicator'
    @sap.quickinfo : 'Deletion Indicator in Purchasing Document'
    PurchasingDocumentDeletionCode : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Material Group'
    MaterialGroup : String(9);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Material'
    @sap.quickinfo : 'Material Number'
    Material : String(40);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Material Type'
    MaterialType : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Supplier Mat. No.'
    @sap.quickinfo : 'Material Number Used by Supplier'
    SupplierMaterialNumber : String(35);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Supplier Subrange'
    SupplierSubrange : String(6);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Mfr Part Number'
    @sap.quickinfo : 'Manufacturer Part Number'
    ManufacturerPartNmbr : String(40);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Manufacturer'
    @sap.quickinfo : 'Number of a Manufacturer'
    Manufacturer : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Material'
    @sap.quickinfo : 'Material number'
    ManufacturerMaterial : String(40);
    @sap.label : 'Short Text'
    PurchaseOrderItemText : String(40);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Product Type Group'
    ProductType : String(2);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Company Code'
    CompanyCode : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Plant'
    Plant : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Address'
    @sap.quickinfo : 'Manual address number in purchasing document item'
    ManualDeliveryAddressID : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Address'
    @sap.quickinfo : 'Number of delivery address'
    ReferenceDeliveryAddressID : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Customer'
    Customer : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Supplier'
    @sap.quickinfo : 'Supplier to be Supplied/Who is to Receive Delivery'
    Subcontractor : String(10);
    @sap.label : 'SC Supplier'
    @sap.quickinfo : 'Subcontracting Supplier'
    SupplierIsSubcontractor : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Cross-plant CM'
    @sap.quickinfo : 'Cross-Plant Configurable Material'
    CrossPlantConfigurableProduct : String(40);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Material Category'
    ArticleCategory : String(2);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Kanban Indicator'
    PlndOrderReplnmtElmntType : String(1);
    @sap.label : 'Points Unit'
    @sap.semantics : 'unit-of-measure'
    ProductPurchasePointsQtyUnit : String(3);
    @sap.unit : 'ProductPurchasePointsQtyUnit'
    @sap.label : 'Points'
    @sap.quickinfo : 'Number of Points'
    ProductPurchasePointsQty : Decimal(13, 3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Storage Location'
    StorageLocation : String(4);
    @sap.label : 'Order Unit'
    @sap.quickinfo : 'Purchase Order Unit of Measure'
    @sap.semantics : 'unit-of-measure'
    PurchaseOrderQuantityUnit : String(3);
    @sap.label : 'Equal To'
    @sap.quickinfo : 'Numerator for Conversion of Order Unit to Base Unit'
    OrderItemQtyToBaseQtyNmrtr : Decimal(5, 0);
    @sap.label : 'Denominator'
    @sap.quickinfo : 'Denominator for Conversion of Order Unit to Base Unit'
    OrderItemQtyToBaseQtyDnmntr : Decimal(5, 0);
    @sap.unit : 'OrderPriceUnit'
    @sap.label : 'Price Unit'
    NetPriceQuantity : Decimal(5, 0);
    @sap.label : 'Delivery Completed'
    @sap.quickinfo : '&quot;Delivery Completed&quot; Indicator'
    IsCompletelyDelivered : Boolean;
    @sap.label : 'Final Invoice'
    @sap.quickinfo : 'Final Invoice Indicator'
    IsFinallyInvoiced : Boolean;
    @sap.label : 'Goods Receipt'
    @sap.quickinfo : 'Goods Receipt Indicator'
    GoodsReceiptIsExpected : Boolean;
    @sap.label : 'Final Delivery'
    @sap.quickinfo : '&quot;Outward Delivery Completed&quot; Indicator'
    OutwardDeliveryIsComplete : Boolean;
    @sap.label : 'Invoice Receipt'
    @sap.quickinfo : 'Invoice Receipt Indicator'
    InvoiceIsExpected : Boolean;
    @sap.label : 'GR-Based Inv. Verif.'
    @sap.quickinfo : 'Indicator: GR-Based Invoice Verification'
    InvoiceIsGoodsReceiptBased : Boolean;
    @sap.display.format : 'NonNegative'
    @sap.label : 'Agreement Item'
    @sap.quickinfo : 'Item Number of Principal Purchase Agreement'
    PurchaseContractItem : String(5);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Outline agreement'
    @sap.quickinfo : 'Number of principal purchase agreement'
    PurchaseContract : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purchase Requisition'
    @sap.quickinfo : 'Purchase Requisition Number'
    PurchaseRequisition : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Req. Tracking Number'
    @sap.quickinfo : 'Requirement Tracking Number'
    RequirementTracking : String(10);
    @sap.label : 'Acknowledgment Reqd.'
    @sap.quickinfo : 'Order Acknowledgment Requirement'
    IsOrderAcknRqd : Boolean;
    @sap.display.format : 'NonNegative'
    @sap.label : 'Item of requisition'
    @sap.quickinfo : 'Item number of purchase requisition'
    PurchaseRequisitionItem : String(5);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Req. for Quotation'
    @sap.quickinfo : 'Identifier for Request for Quotation'
    RequestForQuotation : String(10);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Item Number for RFQ'
    @sap.quickinfo : 'Item Number for Request for Quotation'
    RequestForQuotationItem : String(5);
    @sap.display.format : 'UpperCase'
    @sap.label : 'RFQ'
    @sap.quickinfo : 'RFQ Number'
    SupplierQuotation : String(10);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Item'
    @sap.quickinfo : 'Item Number of RFQ'
    SupplierQuotationItem : String(5);
    @sap.label : 'Eval. Receipt Sett.'
    @sap.quickinfo : 'Evaluated Receipt Settlement (ERS)'
    EvaldRcptSettlmtIsAllowed : Boolean;
    @sap.label : 'Unltd Overdelivery'
    @sap.quickinfo : 'Unlimited Overdelivery Allowed'
    UnlimitedOverdeliveryIsAllowed : Boolean;
    @sap.label : 'Overdeliv. Tolerance'
    @sap.quickinfo : 'Overdelivery Tolerance'
    OverdelivTolrtdLmtRatioInPct : Decimal(3, 1);
    @sap.label : 'Underdel. Tolerance'
    @sap.quickinfo : 'Underdelivery Tolerance'
    UnderdelivTolrtdLmtRatioInPct : Decimal(3, 1);
    @sap.label : 'Requisitioner'
    @sap.quickinfo : 'Name of requisitioner/requester'
    RequisitionerName : String(12);
    @sap.display.format : 'UpperCase'
    @sap.label : 'MRP Area'
    MRPArea : String(10);
    @sap.label : 'Creation Time'
    @sap.quickinfo : 'Purchasing Document Creation Time'
    CreationTime : Time;
    @sap.display.format : 'Date'
    @sap.label : 'Creation Date'
    @sap.quickinfo : 'Purchasing Document Creation Date'
    CreationDate : Date;
    @sap.label : 'Planned Deliv. Time'
    @sap.quickinfo : 'Planned Delivery Time in Days'
    PlannedDeliveryDurationInDays : Decimal(3, 0);
    @sap.label : 'GR processing time'
    @sap.quickinfo : 'Goods receipt processing time in days'
    GoodsReceiptDurationInDays : Decimal(3, 0);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Partial Deliv./Item'
    @sap.quickinfo : 'Partial Delivery at Item Level (Stock Transfer)'
    PartialDeliveryIsAllowed : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Consumption'
    @sap.quickinfo : 'Consumption posting'
    ConsumptionPosting : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Service Performer'
    ServicePerformer : String(10);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Package number'
    ServicePackage : String(10);
    @sap.label : 'Base Unit of Measure'
    @sap.semantics : 'unit-of-measure'
    BaseUnit : String(3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Item Category'
    @sap.quickinfo : 'Item category in purchasing document'
    PurchaseOrderItemCategory : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Profit Center'
    ProfitCenter : String(10);
    @sap.label : 'Order Price Unit'
    @sap.quickinfo : 'Order Price Unit (Purchasing)'
    @sap.semantics : 'unit-of-measure'
    OrderPriceUnit : String(3);
    @sap.label : 'Volume Unit'
    @sap.semantics : 'unit-of-measure'
    ItemVolumeUnit : String(3);
    @sap.label : 'Unit of Weight'
    @sap.semantics : 'unit-of-measure'
    ItemWeightUnit : String(3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Distrib. Indicator'
    @sap.quickinfo : 'Distribution Indicator for Multiple Account Assignment'
    MultipleAcctAssgmtDistribution : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Partial invoice'
    @sap.quickinfo : 'Partial invoice indicator'
    PartialInvoiceDistribution : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Pricing Date Control'
    @sap.quickinfo : 'Price Determination (Pricing) Date Control'
    PricingDateControl : String(1);
    @sap.label : 'Statistical'
    @sap.quickinfo : 'Item is statistical'
    IsStatisticalItem : Boolean;
    @sap.display.format : 'NonNegative'
    @sap.label : 'Higher-Level Item'
    @sap.quickinfo : 'Higher-Level Item in Purchasing Documents'
    PurchasingParentItem : String(5);
    @sap.display.format : 'Date'
    @sap.label : 'Latest GR Date'
    @sap.quickinfo : 'Latest Possible Goods Receipt'
    GoodsReceiptLatestCreationDate : Date;
    @sap.label : 'Returns Item'
    IsReturnsItem : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Reason for Ordering'
    PurchasingOrderReason : String(3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Incoterms'
    @sap.quickinfo : 'Incoterms (Part 1)'
    IncotermsClassification : String(3);
    @sap.label : 'Incoterms (Part 2)'
    IncotermsTransferLocation : String(28);
    @sap.label : 'Incoterms Location 1'
    IncotermsLocation1 : String(70);
    @sap.label : 'Incoterms Location 2'
    IncotermsLocation2 : String(70);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Prior Supplier'
    PriorSupplier : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'EAN/UPC'
    @sap.quickinfo : 'International Article Number (EAN/UPC)'
    InternationalArticleNumber : String(18);
    @sap.label : 'Intrastat Srvc. Code'
    @sap.quickinfo : 'Intrastat Service Code'
    IntrastatServiceCode : String(30);
    @sap.label : 'Commodity Code'
    CommodityCode : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Material Freight Grp'
    @sap.quickinfo : 'Material Freight Group'
    MaterialFreightGroup : String(8);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Qual.f.FreeGoodsDis.'
    @sap.quickinfo : 'Material qualifies for discount in kind'
    DiscountInKindEligibility : String(1);
    @sap.label : 'Shipping block'
    @sap.quickinfo : 'Item blocked for SD delivery'
    PurgItemIsBlockedForDelivery : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Confirmation Control'
    @sap.quickinfo : 'Confirmation Control Key'
    SupplierConfirmationControlKey : String(4);
    @sap.label : 'Print Price'
    @sap.quickinfo : 'Price Printout'
    PriceIsToBePrinted : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Acct Assignment Cat.'
    @sap.quickinfo : 'Account Assignment Category'
    AccountAssignmentCategory : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purchasing info rec.'
    @sap.quickinfo : 'Number of purchasing info record'
    PurchasingInfoRecord : String(10);
    @sap.unit : 'DocumentCurrency'
    @sap.label : 'Net Order Value'
    @sap.quickinfo : 'Net Order Value in PO Currency'
    NetAmount : Decimal(14, 3);
    @sap.unit : 'DocumentCurrency'
    @sap.label : 'Gross order value'
    @sap.quickinfo : 'Gross order value in PO currency'
    GrossAmount : Decimal(14, 3);
    @sap.unit : 'DocumentCurrency'
    @sap.label : 'Effective value'
    @sap.quickinfo : 'Effective value of item'
    EffectiveAmount : Decimal(14, 3);
    @sap.unit : 'DocumentCurrency'
    @sap.label : 'Subtotal 1'
    @sap.quickinfo : 'Subtotal 1 from Pricing Procedure for Price Element'
    Subtotal1Amount : Decimal(14, 3);
    @sap.unit : 'DocumentCurrency'
    @sap.label : 'Subtotal 2'
    @sap.quickinfo : 'Subtotal 2 from Pricing Procedure for Price Element'
    Subtotal2Amount : Decimal(14, 3);
    @sap.unit : 'DocumentCurrency'
    @sap.label : 'Subtotal 3'
    @sap.quickinfo : 'Subtotal 3 from Pricing Procedure for Price Element'
    Subtotal3Amount : Decimal(14, 3);
    @sap.unit : 'DocumentCurrency'
    @sap.label : 'Subtotal 4'
    @sap.quickinfo : 'Subtotal 4 from Pricing Procedure for Price Element'
    Subtotal4Amount : Decimal(14, 3);
    @sap.unit : 'DocumentCurrency'
    @sap.label : 'Subtotal 5'
    @sap.quickinfo : 'Subtotal 5 from Pricing Procedure for Price Element'
    Subtotal5Amount : Decimal(14, 3);
    @sap.unit : 'DocumentCurrency'
    @sap.label : 'Subtotal 6'
    @sap.quickinfo : 'Subtotal 6 from Pricing Procedure for Price Element'
    Subtotal6Amount : Decimal(14, 3);
    @sap.unit : 'PurchaseOrderQuantityUnit'
    @sap.label : 'Order Quantity'
    @sap.quickinfo : 'Purchase Order Quantity'
    OrderQuantity : Decimal(13, 3);
    @sap.unit : 'DocumentCurrency'
    @sap.label : 'Net Order Price'
    @sap.quickinfo : 'Net Price in Purchasing Document (in Document Currency)'
    NetPriceAmount : Decimal(12, 3);
    @sap.unit : 'ItemVolumeUnit'
    @sap.label : 'Volume'
    ItemVolume : Decimal(13, 3);
    @sap.unit : 'ItemWeightUnit'
    @sap.label : 'Gross Weight'
    ItemGrossWeight : Decimal(13, 3);
    @sap.unit : 'ItemWeightUnit'
    @sap.label : 'Net Weight'
    ItemNetWeight : Decimal(13, 3);
    @sap.label : 'Quantity Conversion'
    @sap.quickinfo : 'Numerator for Conversion of Order Price Unit into Order Unit'
    OrderPriceUnitToOrderUnitNmrtr : Decimal(5, 0);
    @sap.label : 'Quantity Conversion'
    @sap.quickinfo : 'Denominator for Conv. of Order Price Unit into Order Unit'
    OrdPriceUnitToOrderUnitDnmntr : Decimal(5, 0);
    @sap.label : 'GR Non-Valuated'
    @sap.quickinfo : 'Goods Receipt, Non-Valuated'
    GoodsReceiptIsNonValuated : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Tax Code'
    @sap.quickinfo : 'Tax on sales/purchases code'
    TaxCode : String(2);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Tax Jurisdiction'
    TaxJurisdiction : String(15);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Shipping Instr.'
    @sap.quickinfo : 'Shipping Instructions'
    ShippingInstruction : String(2);
    @sap.unit : 'DocumentCurrency'
    @sap.label : 'Non-deductible'
    @sap.quickinfo : 'Non-deductible input tax'
    NonDeductibleInputTaxAmount : Decimal(14, 3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Stock Type'
    StockType : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Valuation Type'
    ValuationType : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Valuation Category'
    ValuationCategory : String(1);
    @sap.label : 'Rejection Indicator'
    ItemIsRejectedBySupplier : Boolean;
    @sap.display.format : 'Date'
    @sap.label : 'Price Date'
    @sap.quickinfo : 'Date of Price Determination'
    PurgDocPriceDate : Date;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Info Record Update'
    @sap.quickinfo : 'Indicator: Update Info Record'
    IsInfoRecordUpdated : String(1);
    @sap.unit : 'PurchaseOrderQuantityUnit'
    @sap.label : 'Stand.Rel.Order.Qty.'
    @sap.quickinfo : 'Standard release order quantity'
    PurgDocReleaseOrderQuantity : Decimal(13, 3);
    @sap.label : 'Order Acknowledgment'
    @sap.quickinfo : 'Order Acknowledgment Number'
    PurgDocOrderAcknNumber : String(20);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Cost Center'
    CostCenter : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'G/L Account'
    @sap.quickinfo : 'G/L Account Number'
    GLAccount : String(10);
    @sap.display.format : 'NonNegative'
    @sap.label : 'WBS Internal ID'
    @sap.quickinfo : 'WBS Element'
    WBSElementInternalID : String(8);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Fund'
    Fund : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Budget Period'
    BudgetPeriod : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Funds Center'
    FundsCenter : String(16);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Commitment item'
    @sap.quickinfo : 'Commitment Item'
    CommitmentItem : String(24);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Commitment Item Short ID'
    CommitmentItemShortID : String(14);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Functional Area'
    FunctionalArea : String(16);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Grant'
    GrantID : String(20);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Earmarked Funds'
    @sap.quickinfo : 'Document Number for Earmarked Funds'
    EarmarkedFunds : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Earmarked Funds'
    @sap.quickinfo : 'Document Number for Earmarked Funds'
    EarmarkedFundsDocument : String(10);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Document Item'
    @sap.quickinfo : 'Earmarked Funds: Document Item'
    EarmarkedFundsItem : String(3);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Document Item'
    @sap.quickinfo : 'Earmarked Funds: Document Item'
    EarmarkedFundsDocumentItem : String(3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Special Stock'
    @sap.quickinfo : 'Special Stock Indicator'
    InventorySpecialStockType : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Del. Type f. Returns'
    @sap.quickinfo : 'Delivery Type for Returns to Supplier'
    DeliveryDocumentType : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Issuing Storage Loc.'
    @sap.quickinfo : 'Issuing Storage Location for Stock Transport Order'
    IssuingStorageLocation : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Allocation Table'
    AllocationTable : String(10);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Item'
    @sap.quickinfo : 'Allocation Table Item'
    AllocationTableItem : String(5);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Hierarchy Number'
    PurgConfigurableItemNumber : String(40);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Retail Promotion'
    RetailPromotion : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Down Payment'
    @sap.quickinfo : 'Down Payment Indicator'
    DownPaymentType : String(4);
    @sap.label : 'Down Payment %'
    @sap.quickinfo : 'Down Payment Percentage'
    DownPaymentPercentageOfTotAmt : Decimal(5, 2);
    @sap.unit : 'DocumentCurrency'
    @sap.label : 'Down Payment Amount'
    @sap.quickinfo : 'Down Payment Amount in Document Currency'
    DownPaymentAmount : Decimal(12, 3);
    @sap.display.format : 'Date'
    @sap.label : 'Due Date for DP'
    @sap.quickinfo : 'Due Date for Down Payment'
    DownPaymentDueDate : Date;
    @sap.unit : 'DocumentCurrency'
    @sap.label : 'Expected Value'
    @sap.quickinfo : 'Expected Value of Overall Limit'
    ExpectedOverallLimitAmount : Decimal(14, 3);
    @sap.unit : 'DocumentCurrency'
    @sap.label : 'Overall Limit'
    OverallLimitAmount : Decimal(14, 3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Contract For Limit'
    @sap.quickinfo : 'Purchase Contract for Enhanced Limit'
    PurContractForOverallLimit : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Requirement Segment'
    RequirementSegment : String(40);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Material Origin'
    @sap.quickinfo : 'Origin of the material'
    BR_MaterialOrigin : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Material Usage'
    @sap.quickinfo : 'Usage of the material'
    BR_MaterialUsage : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Matl. CFOP Category'
    @sap.quickinfo : 'Material CFOP Category'
    BR_CFOPCategory : String(2);
    @sap.display.format : 'UpperCase'
    @sap.label : 'NCM Code'
    @sap.quickinfo : 'Brazilian NCM Code'
    BR_NCM : String(16);
    @sap.display.format : 'UpperCase'
    @sap.label : 'HSN/SAC Code'
    @sap.quickinfo : 'HSN or SAC Code'
    ConsumptionTaxCtrlCode : String(16);
    @sap.label : 'In-House Production'
    BR_IsProducedInHouse : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.label : 'CRM Ref Order'
    @sap.quickinfo : 'CRM Reference Order Number for TPOP Process'
    ThirdPtyOrdProcgExtReference : String(35);
    @sap.display.format : 'UpperCase'
    @sap.label : 'CRM Rf Item No'
    @sap.quickinfo : 'CRM Reference Sales Order Item Number in TPOP Process'
    ThirdPtyOrdProcgExtRefItem : String(6);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Sub-items'
    @sap.quickinfo : 'Subitems Exist'
    PurgDocAggrgdSubitemCategory : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Stock Segment'
    StockSegment : String(40);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.content.version : '1'
  @sap.label : 'Purchase Order Item'
  @sap.value.list : 'true'
  entity I_PurchaseOrderItemStdVH {
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purchasing Document'
    @sap.quickinfo : 'Purchasing Document Number'
    @sap.value.list : 'standard'
    key PurchaseOrder : String(10) not null;
    @sap.display.format : 'NonNegative'
    @sap.label : 'Purchase Order Item'
    @sap.quickinfo : 'Item Number of Purchase Order'
    key PurchaseOrderItem : String(5) not null;
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.content.version : '1'
  @sap.semantics : 'aggregate'
  @sap.label : 'Purchase Order Schedule Line'
  entity I_PurchaseOrderScheduleLine {
    @sap.sortable : 'false'
    @sap.filterable : 'false'
    key ID : String not null;
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purchasing Document'
    @sap.quickinfo : 'Purchasing Document Number'
    PurchaseOrder : String(10);
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'NonNegative'
    @sap.label : 'Item'
    @sap.quickinfo : 'Item Number of Purchasing Document'
    PurchaseOrderItem : String(5);
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'NonNegative'
    @sap.label : 'Schedule Line'
    @sap.quickinfo : 'Delivery Schedule Line Counter'
    ScheduleLine : String(4);
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'Date'
    @sap.label : 'Delivery Date'
    @sap.quickinfo : 'Item Delivery Date'
    ScheduleLineDeliveryDate : Date;
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'Date'
    @sap.label : 'Stat.-Rel. Del. Date'
    @sap.quickinfo : 'Statistics-Relevant Delivery Date'
    SchedLineStscDeliveryDate : Date;
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'Date'
    @sap.label : 'Start Date'
    @sap.quickinfo : 'Start Date for Period of Performance'
    PerformancePeriodStartDate : Date;
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'Date'
    @sap.label : 'End Date'
    @sap.quickinfo : 'End Date for Period of Performance'
    PerformancePeriodEndDate : Date;
    @sap.aggregation.role : 'dimension'
    @sap.label : 'Time'
    @sap.quickinfo : 'Delivery Date Time-Spot'
    ScheduleLineDeliveryTime : Time;
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'UpperCase'
    @sap.label : 'Batch'
    @sap.quickinfo : 'Batch Number'
    Batch : String(10);
    @sap.aggregation.role : 'measure'
    @sap.unit : 'PurchaseOrderQuantityUnit'
    @sap.label : 'Scheduled Quantity'
    @sap.filterable : 'false'
    ScheduleLineOrderQuantity : Decimal(13, 3);
    @sap.aggregation.role : 'measure'
    @sap.unit : 'PurchaseOrderQuantityUnit'
    @sap.label : 'Quantity Delivered'
    @sap.quickinfo : 'Quantity of Goods Received'
    @sap.filterable : 'false'
    RoughGoodsReceiptQty : Decimal(13, 3);
    @sap.aggregation.role : 'measure'
    @sap.unit : 'PurchaseOrderQuantityUnit'
    @sap.filterable : 'false'
    OpenPurchaseOrderQuantity : Decimal(14, 3);
    @sap.aggregation.role : 'dimension'
    @sap.label : 'Order Unit'
    @sap.quickinfo : 'Purchase Order Unit of Measure'
    @sap.semantics : 'unit-of-measure'
    PurchaseOrderQuantityUnit : String(3);
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'UpperCase'
    @sap.label : 'Currency'
    @sap.quickinfo : 'Currency Key'
    @sap.semantics : 'currency-code'
    Currency : String(5);
    @sap.aggregation.role : 'measure'
    @sap.unit : 'Currency'
    @sap.filterable : 'false'
    OpenPurchaseOrderNetAmount : Decimal(21, 3);
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purchase Requisition'
    @sap.quickinfo : 'Purchase Requisition Number'
    PurchaseRequisition : String(10);
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'NonNegative'
    @sap.label : 'Item of requisition'
    @sap.quickinfo : 'Item number of purchase requisition'
    PurchaseRequisitionItem : String(5);
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'UpperCase'
    @sap.label : 'Deliv. date category'
    @sap.quickinfo : 'Category of delivery date'
    DelivDateCategory : String(1);
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'Date'
    @sap.label : 'Purchase Order Date'
    @sap.quickinfo : 'Order date of schedule line'
    ScheduleLineOrderDate : Date;
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'Date'
    @sap.label : 'Material Avail. Date'
    @sap.quickinfo : 'Material Staging/Availability Date'
    ProductAvailabilityDate : Date;
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'Date'
    @sap.label : 'Loading Date'
    LoadingDate : Date;
    @sap.aggregation.role : 'dimension'
    @sap.label : 'Loading Time'
    @sap.quickinfo : 'Loading Time (Local Time Relating to a Shipping Point)'
    LoadingTime : Time;
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'Date'
    @sap.label : 'Transptn Plang Date'
    @sap.quickinfo : 'Transportation Planning Date'
    TransportationPlanningDate : Date;
    @sap.aggregation.role : 'dimension'
    @sap.label : 'Transp. Plan. Time'
    @sap.quickinfo : 'Transp. Planning Time (Local, Relating to a Shipping Point)'
    TransportationPlanningTime : Time;
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'Date'
    @sap.label : 'Goods Issue Date'
    GoodsIssueDate : Date;
    @sap.aggregation.role : 'dimension'
    @sap.label : 'Goods Issue Time'
    @sap.quickinfo : 'Time of Goods Issue (Local, Relating to a Plant)'
    GoodsIssueTime : Time;
    @sap.aggregation.role : 'dimension'
    @sap.display.format : 'UpperCase'
    @sap.label : 'Route Schedule'
    RouteSchedule : String(10);
    @sap.aggregation.role : 'dimension'
    @sap.label : 'Matl Staging Time'
    @sap.quickinfo : 'Material Staging Time (Local, Relating to a Plant)'
    ProductAvailabilityTime : Time;
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Purchase Order Status Value Help'
  entity I_PurchaseOrderStatusValueHelp {
    @sap.display.format : 'UpperCase'
    @sap.text : 'PurchasingDocumentStatusName'
    @sap.label : 'Order Status'
    @sap.quickinfo : 'Purchasing Document Status'
    key PurchasingDocumentStatus : String(2) not null;
    @sap.label : 'Purchasing Document Status'
    @sap.quickinfo : 'Purchasing Document Status Name'
    PurchasingDocumentStatusName : String(60);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Purchase Order'
  @sap.value.list : 'true'
  entity I_PurchaseOrderStdVH {
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purchase Order'
    @sap.quickinfo : 'Purchase Order Number'
    key PurchaseOrder : String(10) not null;
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Status of Purchasing Document'
  entity I_PurchasingDocumentStatus {
    @sap.display.format : 'UpperCase'
    @sap.text : 'PurchasingDocumentStatus_Text'
    @sap.label : 'Doc. Status'
    @sap.quickinfo : 'Purchasing Document Status'
    key PurchasingDocumentStatus : String(2) not null;
    @sap.label : 'Pur. Doc. Stat. Name'
    @sap.quickinfo : 'Purchasing Document Status Name'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    PurchasingDocumentStatus_Text : String(60);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Purchasing Document Status - Text'
  entity I_PurchasingDocumentStatusText {
    @sap.display.format : 'UpperCase'
    @sap.text : 'PurchasingDocumentStatusName'
    @sap.label : 'Doc. Status'
    @sap.quickinfo : 'Purchasing Document Status'
    key PurchasingDocumentStatus : String(2) not null;
    @sap.label : 'Language Key'
    key Language : String(2) not null;
    @sap.label : 'Pur. Doc. Stat. Name'
    @sap.quickinfo : 'Purchasing Document Status Name'
    PurchasingDocumentStatusName : String(60);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Purchasing Document Type'
  entity I_PurchasingDocumentType {
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purch. Doc. Category'
    @sap.quickinfo : 'Purchasing Document Category'
    key PurchasingDocumentCategory : String(1) not null;
    @sap.display.format : 'UpperCase'
    @sap.text : 'PurchasingDocumentType_Text'
    @sap.label : 'Purchasing Doc. Type'
    @sap.quickinfo : 'Purchasing Document Type'
    key PurchasingDocumentType : String(4) not null;
    @sap.label : 'Doc. Type Descript.'
    @sap.quickinfo : 'Short Description of Purchasing Document Type'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    PurchasingDocumentType_Text : String(20);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Control indicator'
    @sap.quickinfo : 'Control indicator for purchasing document type'
    PurchasingDocumentSubtype : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Field Selection Key'
    PurgDocFieldSelControlKey : String(20);
    @sap.label : 'Flexible Workflow'
    PurgHasFlxblWorkflowApproval : Boolean;
    @sap.label : 'Overall req. rel.'
    @sap.quickinfo : 'Overall release of purchase requisitions'
    IsPurReqnOvrlRel : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.label : 'PartnerDetermProced.'
    @sap.quickinfo : 'Partner Determination Procedure'
    PartnerDeterminationProcedure : String(4);
    @sap.label : 'PPS Relevant'
    @sap.quickinfo : 'Relevant for Procurement for Public Sector'
    PurgDocumentTypeIsPPSRelevant : Boolean;
    @sap.label : 'Mixed Contract'
    @sap.quickinfo : 'Flag to represent mixed contract is switched on/off'
    PPSPurgDocTypeIsDrctOrdEnabled : Boolean;
    @sap.label : 'Multiple Supplier'
    @sap.quickinfo : 'Flag to Represent Multiple Supplier is Switched On/Off'
    PPSIsMultipleSuppliersEnabled : Boolean;
    @sap.label : 'Default Document Type'
    PPSPurgDocumentTypeIsDefault : Boolean;
    @sap.label : 'Smart Number'
    @sap.quickinfo : 'Smart Number Enabled'
    PPSPurgDocTypeIsSmrtNmbrEnbld : Boolean;
    @sap.label : 'Options'
    @sap.quickinfo : 'Options Enabled'
    PPSPurgDocTypeIsOptionsEnabled : Boolean;
    @sap.label : 'Third Party'
    @sap.quickinfo : 'Third-Party Enabled'
    PPSPurgDocTypeIsThirdPtyEnbld : Boolean;
    @sap.label : 'Attachments'
    @sap.quickinfo : 'Attachment'
    PPSPurgDocTypeIsAttchEnabled : Boolean;
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Purchasing Document Type - Text'
  entity I_PurchasingDocumentTypeText {
    @sap.display.format : 'UpperCase'
    @sap.text : 'PurchasingDocumentTypeName'
    @sap.label : 'Purchasing Doc. Type'
    @sap.quickinfo : 'Purchasing Document Type'
    key PurchasingDocumentType : String(4) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purch. Doc. Category'
    @sap.quickinfo : 'Purchasing Document Category'
    key PurchasingDocumentCategory : String(1) not null;
    @sap.label : 'Language Key'
    key Language : String(2) not null;
    @sap.label : 'Doc. Type Descript.'
    @sap.quickinfo : 'Short Description of Purchasing Document Type'
    PurchasingDocumentTypeName : String(20);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Purchasing Group'
  entity I_PurchasingGroup {
    @sap.display.format : 'UpperCase'
    @sap.text : 'PurchasingGroupName'
    @sap.label : 'Purchasing Group'
    key PurchasingGroup : String(3) not null;
    @sap.label : 'Purchasing Grp. Name'
    @sap.quickinfo : 'Purchasing Group Name'
    PurchasingGroupName : String(18);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Tel.No. Purch. Group'
    @sap.quickinfo : 'Telephone number of purchasing group (buyer group)'
    PurchasingGroupPhoneNumber : String(12);
    @sap.label : 'Fax Number'
    @sap.quickinfo : 'Fax number of purchasing (buyer) group'
    FaxNumber : String(31);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Telephone'
    @sap.quickinfo : 'Telephone No.: Dialing Code and Number'
    PhoneNumber : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Extension'
    @sap.quickinfo : 'Telephone no.: Extension'
    PhoneNumberExtension : String(10);
    @sap.label : 'E-Mail Address'
    EmailAddress : String(241);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Purchasing Info Record'
  @sap.value.list : 'true'
  entity I_PurchasingInfoRecordStdVH {
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purchasing info rec.'
    @sap.quickinfo : 'Number of purchasing info record'
    key PurchasingInfoRecord : String(10) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purch. Organization'
    @sap.quickinfo : 'Purchasing Organization'
    key PurchasingOrganization : String(4) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Plant'
    key Plant : String(4) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Info Record Category'
    @sap.quickinfo : 'Purchasing info record category'
    key PurchasingInfoRecordCategory : String(1) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purchasing Group'
    PurchasingGroup : String(3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Supplier'
    @sap.quickinfo : 'Supplier''s Account Number'
    Supplier : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Material'
    @sap.quickinfo : 'Material Number'
    Material : String(40);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Material Group'
    MaterialGroup : String(9);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Purchasing Organization'
  entity I_PurchasingOrganization {
    @sap.display.format : 'UpperCase'
    @sap.text : 'PurchasingOrganizationName'
    @sap.label : 'Purchasing Organization'
    key PurchasingOrganization : String(4) not null;
    @sap.label : 'Purch. Org. Name'
    @sap.quickinfo : 'Purchasing Organization Name'
    PurchasingOrganizationName : String(20);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Company Code'
    CompanyCode : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Validity'
    @sap.quickinfo : 'Deprecated Entries'
    ConfigDeprecationCode : String(1);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Purchase Contract Service Item'
  @sap.value.list : 'true'
  entity I_PurContractServiceItemVH {
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purchase Contract'
    @sap.quickinfo : 'Purchasing Contract Header'
    key PurchaseContract : String(10) not null;
    @sap.display.format : 'NonNegative'
    @sap.label : 'Item'
    @sap.quickinfo : 'Item Number of Purchasing Contract'
    key PurchaseContractItem : String(5) not null;
    @sap.display.format : 'UpperCase'
    @sap.text : 'PurgDocItemCategoryName'
    @sap.label : 'Item Category'
    @sap.quickinfo : 'Item category in purchasing document'
    PurchasingDocumentItemCategory : String(1);
    @sap.label : 'Text for Item Cat.'
    @sap.quickinfo : 'Text for Item Category'
    PurgDocItemCategoryName : String(20);
    @sap.label : 'Short Text'
    PurchaseContractItemText : String(40);
    @sap.label : 'Item Set'
    @sap.quickinfo : 'Item is statistical'
    IsStatisticalItem : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Hierarchy Number'
    PurgConfigurableItemNumber : String(40);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Material'
    @sap.quickinfo : 'Material Number'
    Material : String(40);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Material Group'
    MaterialGroup : String(9);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Product Type Group'
    ProductTypeCode : String(2);
    @sap.unit : 'DocumentCurrency'
    @sap.label : 'Net Order Price'
    @sap.quickinfo : 'Net Price in Purchasing Document (in Document Currency)'
    ContractNetPriceAmount : Decimal(12, 3);
    @sap.unit : 'OrderQuantityUnit'
    @sap.label : 'Target Quantity'
    TargetQuantity : Decimal(13, 3);
    @sap.label : 'Order Unit'
    @sap.quickinfo : 'Purchase Order Unit of Measure'
    @sap.semantics : 'unit-of-measure'
    OrderQuantityUnit : String(3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Currency'
    @sap.quickinfo : 'Currency Key'
    @sap.semantics : 'currency-code'
    DocumentCurrency : String(5);
    @sap.label : 'Order Price Unit'
    @sap.quickinfo : 'Order Price Unit (Purchasing)'
    @sap.semantics : 'unit-of-measure'
    OrderPriceUnit : String(3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Company Code'
    CompanyCode : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Plant'
    Plant : String(4);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Purchasing Document Item Category - Text'
  entity I_PurgDocumentItemCategoryText {
    @sap.display.format : 'UpperCase'
    @sap.text : 'PurgDocItemCategoryName'
    @sap.label : 'Item Category'
    @sap.quickinfo : 'Item category in purchasing document'
    key PurchasingDocumentItemCategory : String(1) not null;
    @sap.label : 'Language Key'
    key Language : String(2) not null;
    @sap.label : 'Text for Item Cat.'
    @sap.quickinfo : 'Text for Item Category'
    PurgDocItemCategoryName : String(20);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Item Category'
    @sap.quickinfo : 'Item Category in Purchasing Document'
    PurgDocExternalItemCategory : String(1);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Purchase Order Partner Function'
  @sap.value.list : 'true'
  entity I_PurOrderPartnerFunctionVH {
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purchasing Doc. Type'
    @sap.quickinfo : 'Purchasing Document Type'
    key PurchaseOrderType : String(4) not null;
    @sap.display.format : 'UpperCase'
    @sap.text : 'PartnerFunctionName'
    @sap.label : 'Partner Function'
    key PartnerFunction : String(2) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'PartnerDetermProced.'
    @sap.quickinfo : 'Partner Determination Procedure'
    PartnerDeterminationProcedure : String(4);
    @sap.label : 'Name'
    PartnerFunctionName : String(20);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Shipping Instruction - Text'
  @sap.value.list : 'true'
  entity I_Shippinginstructiontext {
    @sap.display.format : 'UpperCase'
    @sap.text : 'ShippingInstructionName'
    @sap.label : 'Shipping Instr.'
    @sap.quickinfo : 'Shipping Instructions'
    key ShippingInstruction : String(2) not null;
    @sap.label : 'Language Key'
    key Language : String(2) not null;
    @sap.label : 'Shipping Instr.'
    @sap.quickinfo : 'Shipping Instructions: Description'
    ShippingInstructionName : String(30);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Storage Location'
  entity I_StorageLocation {
    @sap.display.format : 'UpperCase'
    @sap.label : 'Plant'
    key Plant : String(4) not null;
    @sap.display.format : 'UpperCase'
    @sap.text : 'StorageLocationName'
    @sap.label : 'Storage Location'
    key StorageLocation : String(4) not null;
    @sap.label : 'Storage Loc. Name'
    @sap.quickinfo : 'Storage Location Name'
    StorageLocationName : String(16);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Sales Organization'
    SalesOrganization : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Distribution Channel'
    DistributionChannel : String(2);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Division'
    Division : String(2);
    @sap.label : 'Authorization Check'
    @sap.quickinfo : 'Storage location authorization for goods movements active'
    IsStorLocAuthznCheckActive : Boolean;
    @sap.label : 'HU Requirement'
    @sap.quickinfo : 'Handling unit requirement'
    HandlingUnitIsRequired : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Validity'
    @sap.quickinfo : 'Deprecated Entries'
    ConfigDeprecationCode : String(1);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.content.version : '1'
  @sap.label : 'Supplier'
  entity I_Supplier {
    @sap.display.format : 'UpperCase'
    @sap.text : 'SupplierName'
    @sap.label : 'Supplier'
    @sap.quickinfo : 'Account Number of Supplier'
    key Supplier : String(10) not null;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Account Group'
    @sap.quickinfo : 'Vendor account group'
    SupplierAccountGroup : String(4);
    @sap.label : 'Name of Supplier'
    SupplierName : String(80);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Supplier Name'
    @sap.quickinfo : 'Supplier Full Name'
    SupplierFullName : String(220);
    @sap.label : 'Business Partner - Supplier Name'
    @sap.quickinfo : 'Supplier Name'
    BPSupplierName : String(81);
    @sap.label : 'Business Partner - Supplier Full Name'
    @sap.quickinfo : 'Supplier Full Name'
    BPSupplierFullName : String(163);
    @sap.label : 'Business Partner Organization - Name 1'
    @sap.quickinfo : 'Name 1'
    BusinessPartnerName1 : String(40);
    @sap.label : 'Business Partner Organization - Name 2'
    @sap.quickinfo : 'Name 2'
    BusinessPartnerName2 : String(40);
    @sap.label : 'Business Partner Organization - Name 3'
    @sap.quickinfo : 'Name 3'
    BusinessPartnerName3 : String(40);
    @sap.label : 'Business Partner Organization - Name 4'
    @sap.quickinfo : 'Name 4'
    BusinessPartnerName4 : String(40);
    @sap.label : 'Business Partner Address – City'
    @sap.quickinfo : 'City'
    BPAddrCityName : String(40);
    @sap.label : 'Business Partner Address – Street'
    @sap.quickinfo : 'Street'
    BPAddrStreetName : String(60);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Business Partner Address - Search Term 1'
    @sap.quickinfo : 'Search Term 1'
    AddressSearchTerm1 : String(20);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Business Partner Address - Search Term 2'
    @sap.quickinfo : 'Search Term 2'
    AddressSearchTerm2 : String(20);
    @sap.label : 'Business Partner Address – District'
    @sap.quickinfo : 'District'
    DistrictName : String(40);
    @sap.label : 'Business Partner Address - PO Box Deviating City'
    @sap.quickinfo : 'PO Box city'
    POBoxDeviatingCityName : String(40);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Business Partner - Form of Address'
    @sap.quickinfo : 'Form-of-Address Key'
    BusinessPartnerFormOfAddress : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purpose Completed'
    @sap.quickinfo : 'Business Purpose Completed Flag'
    IsBusinessPurposeCompleted : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Created By'
    @sap.quickinfo : 'Name of Accounting Clerk Responsible for Adding the Object'
    CreatedByUser : String(12);
    @sap.display.format : 'Date'
    @sap.label : 'Created On'
    @sap.quickinfo : 'Record Created On'
    CreationDate : Date;
    @sap.label : 'One-time account'
    @sap.quickinfo : 'Indicator: Is the account a one-time account?'
    IsOneTimeAccount : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Authorization'
    @sap.quickinfo : 'Authorization Group'
    AuthorizationGroup : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'VAT Registration No.'
    @sap.quickinfo : 'VAT Registration Number'
    VATRegistration : String(20);
    @sap.label : 'Posting Block(Deprecated)'
    @sap.quickinfo : 'Central posting block'
    AccountIsBlockedForPosting : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Tax Jurisdiction'
    TaxJurisdiction : String(15);
    @sap.display.format : 'UpperCase'
    @sap.label : 'SCAC'
    @sap.quickinfo : 'Standard carrier access code'
    SupplierStandardCarrierAccess : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Carrier freight grp'
    @sap.quickinfo : 'Forwarding agent freight group'
    SupplierFwdAgentFreightGroup : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'ServAgntProcGrp'
    @sap.quickinfo : 'Service agent procedure group'
    SupplierAgentProcedureGroup : String(4);
    @sap.label : 'Social Insurance'
    @sap.quickinfo : 'Registered for Social Insurance'
    SupplIsSocialInsuranceRegtrd : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Social Ins. Code'
    @sap.quickinfo : 'Activity Code for Social Insurance'
    SocialInsuranceActivityCode : String(3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Group Key'
    @sap.quickinfo : 'Group key'
    SupplierCorporateGroup : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Customer'
    @sap.quickinfo : 'Customer Number'
    Customer : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Industry'
    @sap.quickinfo : 'Industry Key'
    Industry : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Tax Number 1'
    TaxNumber1 : String(16);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Tax Number 2'
    TaxNumber2 : String(11);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Tax Number 3'
    TaxNumber3 : String(18);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Tax Number 4'
    TaxNumber4 : String(18);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Tax Number 5'
    TaxNumber5 : String(60);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Tax Number 6'
    TaxNumber6 : String(20);
    @sap.label : 'Posting Block'
    @sap.quickinfo : 'Central posting block'
    PostingIsBlocked : Boolean;
    @sap.label : 'Purch. Block'
    @sap.quickinfo : 'Centrally imposed purchasing block'
    PurchasingIsBlocked : Boolean;
    @sap.display.format : 'NonNegative'
    @sap.label : 'Int. location no. 1'
    @sap.quickinfo : 'International Location Number (Part 1)'
    InternationalLocationNumber1 : String(7);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Int. location no. 2'
    @sap.quickinfo : 'International Location Number (Part 2)'
    InternationalLocationNumber2 : String(5);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Check Digit'
    @sap.quickinfo : 'Check digit for the international location number'
    InternationalLocationNumber3 : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Address'
    AddressID : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Region'
    @sap.quickinfo : 'Region (State, Province, County)'
    Region : String(3);
    @sap.label : 'Name'
    OrganizationBPName1 : String(35);
    @sap.label : 'Name 2'
    OrganizationBPName2 : String(35);
    @sap.label : 'City'
    CityName : String(35);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Postal Code'
    PostalCode : String(10);
    @sap.label : 'Street'
    @sap.quickinfo : 'Street and House Number'
    StreetName : String(35);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Country/Region Key'
    Country : String(3);
    @sap.label : 'Int. Location No.'
    @sap.quickinfo : 'Cocatenated International Location Number'
    ConcatenatedInternationalLocNo : String(20);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Block Function'
    @sap.quickinfo : 'Function That Will Be Blocked'
    SupplierProcurementBlock : String(2);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Actual QM System'
    @sap.quickinfo : 'Supplier''s QM System'
    SuplrQualityManagementSystem : String(4);
    @sap.display.format : 'Date'
    @sap.label : 'QM System Valid To'
    @sap.quickinfo : 'Validity Date of Certification'
    SuplrQltyInProcmtCertfnValidTo : Date;
    @sap.label : 'Language Key'
    SupplierLanguage : String(2);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Alternative Payee'
    @sap.quickinfo : 'Account Number of the Alternative Payee'
    AlternativePayeeAccountNumber : String(10);
    @sap.label : 'Telephone 1'
    @sap.quickinfo : 'First telephone number'
    PhoneNumber1 : String(16);
    @sap.label : 'Fax Number'
    FaxNumber : String(31);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Natural Person'
    IsNaturalPerson : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Tax Number'
    @sap.quickinfo : 'Tax Number at Responsible Tax Authority'
    TaxNumberResponsible : String(18);
    @sap.label : 'Business Type'
    @sap.quickinfo : 'Subcontractor''s Business Type'
    UK_ContractorBusinessType : String(12);
    @sap.label : 'Prtnr''s Trading Name'
    @sap.quickinfo : 'Partner''s Trading Name'
    UK_PartnerTradingName : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Partner''s UTR'
    @sap.quickinfo : 'Partner''s Unique Tax Reference (UTR)'
    UK_PartnerTaxReference : String(20);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Verification Status'
    UK_VerificationStatus : String(3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Verification Number'
    UK_VerificationNumber : String(20);
    @sap.label : 'Comp. House Reg. No.'
    @sap.quickinfo : 'Companies House Registration Number'
    UK_CompanyRegistrationNumber : String(8);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Tax Status'
    @sap.quickinfo : 'Tax Status of the Verified Subcontractor'
    UK_VerifiedTaxStatus : String(1);
    @sap.label : 'Title'
    FormOfAddress : String(15);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Reference Acct Group'
    @sap.quickinfo : 'Reference Account Group for One-Time Account (Vendor)'
    ReferenceAccountGroup : String(4);
    @sap.label : 'Liable for VAT'
    VATLiability : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Tax Type'
    ResponsibleType : String(2);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Tax Number Type'
    TaxNumberType : String(2);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Fiscal Address'
    @sap.quickinfo : 'Account number of the master record with fiscal address'
    FiscalAddress : String(10);
    @sap.label : 'Type of Business'
    BusinessType : String(30);
    @sap.display.format : 'Date'
    @sap.label : 'Date of Birth'
    @sap.quickinfo : 'Date of Birth of the Person Subject to Withholding Tax'
    BirthDate : Date;
    @sap.label : 'Payment Block'
    PaymentIsBlockedForSupplier : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Search Term'
    @sap.quickinfo : 'Sort field'
    SortField : String(10);
    @sap.label : 'Telephone 2'
    @sap.quickinfo : 'Second telephone number'
    PhoneNumber2 : String(16);
    @sap.label : 'Deletion Flag'
    @sap.quickinfo : 'Central Deletion Flag for Master Record'
    DeletionIndicator : Boolean;
    @sap.label : 'Rep''s Name'
    @sap.quickinfo : 'Name of Representative'
    TaxInvoiceRepresentativeName : String(10);
    @sap.label : 'Type of Industry'
    IndustryType : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'GST Ven Class.'
    @sap.quickinfo : 'Vendor Classification for GST'
    IN_GSTSupplierClassification : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Relevant for POD'
    @sap.quickinfo : 'Supplier indicator relevant for proof of delivery'
    SuplrProofOfDelivRlvtCode : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Trading Partner No.'
    @sap.quickinfo : 'Company ID of Trading Partner'
    TradingPartner : String(6);
    @sap.label : 'Tax Split'
    BR_TaxIsSplit : Boolean;
    @sap.label : 'Enterprise in AU'
    @sap.quickinfo : 'Is payer making payment in course of carrying on enterprise'
    AU_PayerIsPayingToCarryOnEnt : Boolean;
    @sap.label : 'Individual'
    @sap.quickinfo : 'Is an individual under 18 and payment does not exceed $350'
    AU_IndividualIsUnder18 : Boolean;
    @sap.label : 'Payment Does not Exc'
    @sap.quickinfo : 'The payment does not exceed $75, excl. GST'
    AU_PaymentIsExceeding75 : Boolean;
    @sap.label : 'Wholly Input Taxed'
    @sap.quickinfo : 'The supply that the payment relates to is wholly input taxed'
    AU_PaymentIsWhollyInputTaxed : Boolean;
    @sap.label : 'Individual w/o Gain'
    @sap.quickinfo : 'The supply is made by an individual without gain'
    AU_PartnerIsSupplyWithoutGain : Boolean;
    @sap.label : 'ABN Eligible'
    @sap.quickinfo : 'The supplier is not entitled to an ABN'
    AU_SupplierIsEntitledToABN : Boolean;
    @sap.label : 'Payment Exempt'
    @sap.quickinfo : 'The whole of the payment is exempt income.'
    AU_PaymentIsIncomeExempted : Boolean;
    @sap.label : 'Hobby'
    @sap.quickinfo : 'An activity done as a private recreational pursuit'
    AU_SupplyIsMadeAsPrivateHobby : Boolean;
    @sap.label : 'Domestic'
    @sap.quickinfo : 'wholly of a private or domestic nature'
    AU_SupplyMadeIsOfDmstcNature : Boolean;
    @sap.label : 'Origin Acceptance'
    @sap.quickinfo : 'Acceptance At Origin'
    IsToBeAcceptedAtOrigin : Boolean;
    @sap.label : 'Checkbox'
    @sap.heading : ''
    BPIsEqualizationTaxSubject : Boolean;
    @sap.display.format : 'NonNegative'
    @sap.label : 'Tax Base'
    @sap.quickinfo : 'Tax Base in Percentage'
    BRSpcfcTaxBasePercentageCode : String(1);
    @sap.label : 'Profession'
    SupplierProfession : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Ext. manufacturer'
    @sap.quickinfo : 'External manufacturer code name or number'
    SuplrManufacturerExternalName : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'DME Recipient Code'
    @sap.quickinfo : 'Recipient Code for Data Medium Exchange'
    DataMediumExchangeIndicator : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Instruction Key'
    @sap.quickinfo : 'Instruction Key for Data Medium Exchange'
    DataExchangeInstructionKey : String(2);
    @sap.label : 'VSR Relevant'
    @sap.quickinfo : 'Indicator: vendor sub-range relevant'
    SupplierIsSubRangeRelevant : Boolean;
    @sap.label : 'Train Station'
    @sap.quickinfo : 'Train station'
    TrainStationName : String(25);
    @sap.label : 'Payee in Document'
    @sap.quickinfo : 'Indicator: Alternative Payee in Document Allowed?'
    AlternativePayeeIsAllowed : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.label : 'PBC/ISR Number'
    @sap.quickinfo : 'ISR Subscriber Number'
    PaytSlipWthRefSubscriber : String(11);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Stat. Grp, Agent'
    @sap.quickinfo : 'Shipment: statistics group, transportation service agent'
    TranspServiceAgentStstcGrp : String(2);
    @sap.label : 'Plant Level Relevant'
    @sap.quickinfo : 'Indicator: plant level relevant'
    SupplierIsPlantRelevant : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Tax Office'
    @sap.quickinfo : 'Account Number of Master Record of Tax Office Responsible'
    SuplrTaxAuthorityAccountNumber : String(10);
    @sap.label : 'Carrier confirmation'
    @sap.quickinfo : 'Carrier confirmation is expected'
    SuplrCarrierConfirmIsExpected : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Plant'
    @sap.quickinfo : 'Plant (Own or External)'
    SupplierPlant : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Factory Calendar'
    @sap.quickinfo : 'Factory calendar key'
    FactoryCalendar : String(2);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Payment Reason'
    PaymentReason : String(4);
    @sap.label : 'Central Del. Block'
    @sap.quickinfo : 'Central deletion block for master record'
    SupplierCentralDeletionIsBlock : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Data Ctrlr. Set'
    @sap.quickinfo : 'BP: Data Controller Set Flag'
    DataControllerSet : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Data Controller'
    @sap.quickinfo : 'BP: Data Controller (Internal Use Only)'
    DataController1 : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Data Controller'
    @sap.quickinfo : 'BP: Data Controller (Internal Use Only)'
    DataController2 : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Data Controller'
    @sap.quickinfo : 'BP: Data Controller (Internal Use Only)'
    DataController3 : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Data Controller'
    @sap.quickinfo : 'BP: Data Controller (Internal Use Only)'
    DataController4 : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Data Controller'
    @sap.quickinfo : 'BP: Data Controller (Internal Use Only)'
    DataController5 : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Data Controller'
    @sap.quickinfo : 'BP: Data Controller (Internal Use Only)'
    DataController6 : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Data Controller'
    @sap.quickinfo : 'BP: Data Controller (Internal Use Only)'
    DataController7 : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Data Controller'
    @sap.quickinfo : 'BP: Data Controller (Internal Use Only)'
    DataController8 : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Data Controller'
    @sap.quickinfo : 'BP: Data Controller (Internal Use Only)'
    DataController9 : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Data Controller'
    @sap.quickinfo : 'BP: Data Controller (Internal Use Only)'
    DataController10 : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Transportation Chain'
    SupplierTransportationChain : String(10);
    @sap.label : 'Staging Time'
    @sap.quickinfo : 'Staging Time in Days'
    SupplierStagingTimeInDays : Decimal(3, 0);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Scheduling Procedure'
    SupplierSchedulingProcedure : String(1);
    @sap.label : 'Rel. for Coll. No.'
    @sap.quickinfo : 'Cross Docking: Relevant for Collective Numbering'
    CollectiveNumberingIsRelevant : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.label : 'PAN'
    @sap.quickinfo : 'Permanent Account Number'
    BusinessPartnerPanNumber : String(40);
    @sap.display.format : 'UpperCase'
    @sap.label : 'PAN Reference Number'
    BPPanReferenceNumber : String(40);
    @sap.display.format : 'Date'
    @sap.label : 'PAN Valid From Date'
    BPPanValidFromDate : Date;
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Control Key for Supplier Confirmation'
  entity I_SupplierConfControlKey {
    @sap.display.format : 'UpperCase'
    @sap.text : 'SupplierConfirmationControlKey_Text'
    @sap.label : 'Confirmation Control'
    @sap.quickinfo : 'Confirmation Control Key'
    key SupplierConfirmationControlKey : String(4) not null;
    @sap.label : 'Description'
    @sap.quickinfo : 'Confirmation Category: Description'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    SupplierConfirmationControlKey_Text : String(20);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Supplier'
  @sap.value.list : 'true'
  entity I_Supplier_VH {
    @sap.display.format : 'UpperCase'
    @sap.text : 'BPSupplierName'
    @sap.label : 'Supplier'
    @sap.quickinfo : 'Account Number of Supplier'
    key Supplier : String(10) not null;
    @sap.label : 'Supplier Name1'
    @sap.quickinfo : 'Supplier Name'
    SupplierName : String(35);
    @sap.label : 'Business Partner Name1'
    BusinessPartnerName1 : String(40);
    @sap.label : 'Business Partner Supplier Name'
    @sap.quickinfo : 'Supplier Name'
    BPSupplierName : String(81);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Authorization'
    @sap.quickinfo : 'Authorization Group'
    AuthorizationGroup : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Account group'
    @sap.quickinfo : 'Vendor account group'
    SupplierAccountGroup : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Purpose Completed'
    @sap.quickinfo : 'Business Purpose Completed Flag'
    IsBusinessPurposeCompleted : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Business Partner'
    @sap.quickinfo : 'Business Partner Number'
    BusinessPartner : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Business Partner Type'
    BusinessPartnerType : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Data Ctrlr. Set'
    @sap.quickinfo : 'BP: Data Controller Set Flag'
    DataControllerSet : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Data Controller'
    @sap.quickinfo : 'BP: Data Controller (Internal Use Only)'
    DataController1 : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Data Controller'
    @sap.quickinfo : 'BP: Data Controller (Internal Use Only)'
    DataController2 : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Data Controller'
    @sap.quickinfo : 'BP: Data Controller (Internal Use Only)'
    DataController3 : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Data Controller'
    @sap.quickinfo : 'BP: Data Controller (Internal Use Only)'
    DataController4 : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Data Controller'
    @sap.quickinfo : 'BP: Data Controller (Internal Use Only)'
    DataController5 : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Data Controller'
    @sap.quickinfo : 'BP: Data Controller (Internal Use Only)'
    DataController6 : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Data Controller'
    @sap.quickinfo : 'BP: Data Controller (Internal Use Only)'
    DataController7 : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Data Controller'
    @sap.quickinfo : 'BP: Data Controller (Internal Use Only)'
    DataController8 : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Data Controller'
    @sap.quickinfo : 'BP: Data Controller (Internal Use Only)'
    DataController9 : String(30);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Data Controller'
    @sap.quickinfo : 'BP: Data Controller (Internal Use Only)'
    DataController10 : String(30);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.content.version : '1'
  @sap.label : 'Tax Calculation Procedure'
  entity I_TaxCalculationProcedure {
    @sap.display.format : 'UpperCase'
    @sap.label : 'Procedure'
    @sap.quickinfo : 'Procedure (Pricing, Output Control, Acct. Det., Costing,...)'
    key TaxCalculationProcedure : String(6) not null;
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Tax Code'
  entity I_TaxCode {
    @sap.display.format : 'UpperCase'
    @sap.label : 'Procedure'
    @sap.quickinfo : 'Procedure (Pricing, Output Control, Acct. Det., Costing,...)'
    key TaxCalculationProcedure : String(6) not null;
    @sap.display.format : 'UpperCase'
    @sap.text : 'TaxCode_Text'
    @sap.label : 'Tax Code'
    @sap.quickinfo : 'Tax on Sales/Purchases Code'
    key TaxCode : String(2) not null;
    @sap.label : 'Tax Code Name'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    TaxCode_Text : String(50);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Tax Type'
    TaxType : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Target Tax Code'
    @sap.quickinfo : 'Target Tax Code (for Deferred Tax)'
    TargetTaxCode : String(2);
    @sap.display.format : 'UpperCase'
    @sap.label : 'EU Code/Code'
    EUTaxClassification : String(1);
    @sap.label : 'Indicator: Tax Code for Sales Taxes'
    @sap.heading : ''
    IsSalesTaxes : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Tax Category'
    @sap.quickinfo : 'Tax Category in Account Master Record'
    TaxCategory : String(2);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Tax Category'
    @sap.quickinfo : 'Tax Category for US Taxes'
    UnitedStatesTaxCategory : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Reporting C/R'
    @sap.quickinfo : 'Country/Region for Tax Report'
    TaxReturnCountry : String(3);
    @sap.label : 'Tol.Per.Rate'
    @sap.quickinfo : 'Tolerance Percentage Rate for Tax Calculation'
    TaxTolerancePercent : Decimal(3, 1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Tgt Tax Code: EUAcq.'
    @sap.quickinfo : 'Target Tax Code for Deferred EU Acquisition Tax, Input Tax'
    EUAcqnInputTaxCode : String(2);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Tgt Tax Code: EUAcq.'
    @sap.quickinfo : 'Target Tax Code for Deferred EU Acquisition Tax, Output Tax'
    EUAcqnOutputTaxCode : String(2);
    @sap.label : 'Inactive'
    @sap.quickinfo : 'Set Tax Code to &quot;Inactive&quot; - No Further Use'
    TaxCodeIsInactive : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.label : 'OSS Tax Rept. C/R'
    @sap.quickinfo : 'OSS Tax Reporting Country/Region'
    MiniOneStopShopTxRptgCntry : String(3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'OSS Tax Rept. C/R'
    @sap.quickinfo : 'OSS Tax Reporting Country/Region'
    OneStopShopTaxReportingCountry : String(3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'OSS Classification'
    OneStopShopScheme : String(1);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.content.version : '1'
  @sap.label : 'Tax Jurisdiction'
  entity I_TaxJurisdiction {
    @sap.display.format : 'UpperCase'
    @sap.label : 'Costing Sheet'
    key TaxJurisdictionCalcProcedure : String(6) not null;
    @sap.display.format : 'UpperCase'
    @sap.text : 'TaxJurisdiction_Text'
    @sap.label : 'Tax Jurisdiction'
    key TaxJurisdiction : String(15) not null;
    @sap.label : 'Description'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    TaxJurisdiction_Text : String(50);
    @sap.label : 'Net Discount Base'
    @sap.quickinfo : 'Indicator: Discount base amount is the net value'
    CashDiscountBaseAmtIsNetAmt : Boolean;
    @sap.label : 'Net Tax Base'
    @sap.quickinfo : 'Indicator: Base amount for tax is net of discount ?'
    TaxBaseAmountIsNetAmount : Boolean;
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Transportation Location Type'
  @sap.value.list : 'true'
  entity I_TransportationLocationType {
    @sap.display.format : 'UpperCase'
    @sap.text : 'LocationType_Text'
    @sap.label : 'Location Type'
    key LocationType : String(4) not null;
    @sap.label : 'Location Type Desc.'
    @sap.quickinfo : 'Location Type Description'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    LocationType_Text : String(40);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Transportation Location Value Help'
  entity I_TransportationLocationVH {
    @sap.label : 'Location ID'
    @sap.quickinfo : 'Internal Location Number (Customer, Supplier, or Plant)'
    key LocationUUID : UUID not null;
    @sap.label : 'Location UUID'
    LocationAdditionalUUID : UUID;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Location'
    Location : String(20);
    @sap.label : 'Loc. Description'
    @sap.quickinfo : 'Location Description'
    LocationDescription : String(40);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Location Type'
    @sap.value.list : 'fixed-values'
    LocationType : String(4);
    @sap.label : 'Location Type Description'
    LocationTypeDesc : String(40);
    @sap.label : 'BP GUID'
    @sap.quickinfo : 'Business Partner GUID'
    BusinessPartnerUUID : UUID;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Business Partner'
    @sap.quickinfo : 'Business Partner Number'
    @sap.value.list : 'standard'
    BusinessPartner : String(10);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Authorization Group'
    AuthorizationGroup : String(4);
    @sap.display.format : 'UpperCase'
    @sap.label : 'PurposeComplete Flag'
    @sap.quickinfo : 'Business Purpose Completed Flag'
    IsBusinessPurposeCompleted : String(1);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Country/Region Key'
    @sap.value.list : 'standard'
    Country : String(3);
    @sap.label : 'City'
    CityName : String(40);
    @sap.display.format : 'UpperCase'
    @sap.label : 'Postal Code'
    @sap.quickinfo : 'City postal code'
    PostalCode : String(10);
    @sap.label : 'Street'
    StreetName : String(60);
    @sap.label : 'House Number'
    HouseNumber : String(10);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Unit of Measure'
  entity I_UnitOfMeasure {
    @sap.text : 'UnitOfMeasure_Text'
    @sap.label : 'Unit of Measure'
    @sap.semantics : 'unit-of-measure'
    key UnitOfMeasure : String(3) not null;
    @sap.label : 'Meas. Unit Text'
    @sap.quickinfo : 'Unit of Measurement Text (Maximum 30 Characters)'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    UnitOfMeasure_Text : String(30);
    @sap.label : 'Internal SAP Code'
    @sap.quickinfo : 'Unit of Measurement, Internal SAP Code (No Conversion)'
    UnitOfMeasureSAPCode : String(3);
    @sap.display.format : 'UpperCase'
    @sap.label : 'ISO Code'
    @sap.quickinfo : 'ISO Code for Unit of Measurement'
    UnitOfMeasureISOCode : String(3);
    @sap.label : 'Primary Code'
    @sap.quickinfo : 'Selection Field for Conversion from ISO Code to Int. Code'
    IsPrimaryUnitForISOCode : Boolean;
    @sap.label : 'Decimal Rounding'
    @sap.quickinfo : 'No. of Decimal Places for Rounding'
    UnitOfMeasureNumberOfDecimals : Integer;
    @sap.label : 'Commercial Unit Flag'
    @sap.quickinfo : 'Commercial Measurement Unit Flag'
    UnitOfMeasureIsCommercial : Boolean;
    @sap.display.format : 'UpperCase'
    @sap.label : 'Dimension'
    UnitOfMeasureDimension : String(6);
    @sap.label : 'Numerator'
    @sap.quickinfo : 'Numerator for Conversion to SI Unit'
    SIUnitCnvrsnRateNumerator : Integer;
    @sap.label : 'Denominator'
    @sap.quickinfo : 'Denominator for Conversion into SI Unit'
    SIUnitCnvrsnRateDenominator : Integer;
    @sap.label : 'Exponent'
    @sap.quickinfo : 'Base Ten Exponent for Conversion to SI Unit'
    SIUnitCnvrsnRateExponent : Integer;
    @sap.label : 'Additive Constant'
    @sap.quickinfo : 'Additive Constant for Conversion to SI Unit'
    SIUnitCnvrsnAdditiveValue : Decimal(9, 6);
    @sap.label : 'Exp. 10 Floating Pt'
    @sap.quickinfo : 'Exponent of 10 for Floating Point Format'
    UnitOfMeasureDspExponent : Integer;
    @sap.label : 'Decimal Places'
    @sap.quickinfo : 'Number of Decimal Places for Number Display'
    UnitOfMeasureDspNmbrOfDcmls : Integer;
    @sap.unit : 'UnitOfMeasureTemperatureUnit'
    @sap.label : 'Temperature'
    UnitOfMeasureTemperature : Double;
    @sap.label : 'Temperature Unit'
    @sap.semantics : 'unit-of-measure'
    UnitOfMeasureTemperatureUnit : String(3);
    @sap.unit : 'UnitOfMeasurePressureUnit'
    @sap.label : 'Pressure Value'
    UnitOfMeasurePressure : Double;
    @sap.label : 'Unit of Pressure'
    @sap.semantics : 'unit-of-measure'
    UnitOfMeasurePressureUnit : String(3);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.addressable : 'false'
  @sap.content.version : '1'
  @sap.label : 'User'
  entity I_User {
    @sap.display.format : 'UpperCase'
    @sap.text : 'UserDescription'
    @sap.label : 'User ID'
    key UserID : String(12) not null;
    @sap.label : 'Description'
    @sap.quickinfo : 'User Description'
    UserDescription : String(80);
    IsTechnicalUser : String(1);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.searchable : 'true'
  @sap.content.version : '1'
  @sap.label : 'Basic data for WBS Element'
  @sap.value.list : 'true'
  entity I_WBSElementBasicDataStdVH {
    @sap.display.format : 'NonNegative'
    @sap.label : 'WBS Internal ID'
    @sap.quickinfo : 'WBS Element'
    key WBSElementInternalID : String(8) not null;
    @sap.display.format : 'UpperCase'
    @sap.text : 'WBSDescription'
    @sap.label : 'WBS Element'
    @sap.quickinfo : 'Work Breakdown Structure Element (WBS Element) Edited'
    WBSElementExternalID : String(24);
    @sap.label : 'WBS Element Name'
    @sap.quickinfo : 'Work Breakdown Structure Element Name'
    WBSDescription : String(40);
    @sap.display.format : 'NonNegative'
    @sap.label : 'Project Def.'
    @sap.quickinfo : 'Project (internal)'
    ProjectInternalID : String(8);
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.content.version : '1'
  entity SAP__Currencies {
    @sap.label : 'Currency'
    @sap.semantics : 'currency-code'
    key CurrencyCode : String(5) not null;
    @sap.label : 'ISO code'
    ISOCode : String(3) not null;
    @sap.label : 'Short Text'
    Text : String(15) not null;
    @odata.Type : 'Edm.Byte'
    @sap.label : 'Decimals'
    DecimalPlaces : Integer not null;
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.content.version : '1'
  entity SAP__UnitsOfMeasure {
    @sap.label : 'Internal UoM'
    @sap.semantics : 'unit-of-measure'
    key UnitCode : String(3) not null;
    @sap.label : 'ISO Code'
    ISOCode : String(3) not null;
    @sap.label : 'Commercial'
    ExternalCode : String(3) not null;
    @sap.label : 'Meas. Unit Text'
    Text : String(30) not null;
    @sap.label : 'Decimal Places'
    DecimalPlaces : Integer;
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.content.version : '1'
  entity SAP__MyDocumentDescriptions {
    @sap.label : 'UUID'
    key Id : UUID not null;
    CreatedBy : String(12) not null;
    @odata.Type : 'Edm.DateTime'
    @sap.label : 'Time Stamp'
    CreatedAt : DateTime not null;
    FileName : String(256) not null;
    Title : String(256) not null;
    Format : Association to SAP__FormatSet {  };
    FileShare : Association to SAP__FileShareSet {  };
    TableColumns : Association to many SAP__TableColumnsSet {  };
    CoverPage : Association to many SAP__CoverPageSet {  };
    Signature : Association to SAP__SignatureSet {  };
    PDFStandard : Association to SAP__PDFStandardSet {  };
    Hierarchy : Association to SAP__HierarchySet {  };
    Header : Association to SAP__PDFHeaderSet {  };
    Footer : Association to SAP__PDFFooterSet {  };
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.pageable : 'false'
  @sap.addressable : 'false'
  @sap.content.version : '1'
  entity SAP__FileShareSet {
    @sap.label : 'UUID'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    @sap.sortable : 'false'
    @sap.filterable : 'false'
    key Id : UUID not null;
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    @sap.sortable : 'false'
    @sap.filterable : 'false'
    Repository : String(100) not null;
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    @sap.sortable : 'false'
    @sap.filterable : 'false'
    Folder : String not null;
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.pageable : 'false'
  @sap.addressable : 'false'
  @sap.content.version : '1'
  entity SAP__FormatSet {
    @sap.label : 'UUID'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    @sap.sortable : 'false'
    @sap.filterable : 'false'
    key Id : UUID not null;
    FitToPage : SAP__FitToPage not null;
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    @sap.sortable : 'false'
    @sap.filterable : 'false'
    FontSize : Integer not null;
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    @sap.sortable : 'false'
    @sap.filterable : 'false'
    Orientation : String(10) not null;
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    @sap.sortable : 'false'
    @sap.filterable : 'false'
    PaperSize : String(10) not null;
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    @sap.sortable : 'false'
    @sap.filterable : 'false'
    BorderSize : Integer not null;
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    @sap.sortable : 'false'
    @sap.filterable : 'false'
    MarginSize : Integer not null;
    @sap.label : 'Font Name'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    @sap.sortable : 'false'
    @sap.filterable : 'false'
    FontName : String(255) not null;
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    @sap.sortable : 'false'
    @sap.filterable : 'false'
    Padding : Integer not null;
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    @sap.sortable : 'false'
    @sap.filterable : 'false'
    TextDirectionLayout : String(40) not null;
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.pageable : 'false'
  @sap.addressable : 'false'
  @sap.content.version : '1'
  entity SAP__PDFStandardSet {
    @sap.label : 'UUID'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    @sap.sortable : 'false'
    @sap.filterable : 'false'
    key Id : UUID not null;
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    @sap.sortable : 'false'
    @sap.filterable : 'false'
    UsePDFAConformance : Boolean not null;
    @sap.label : 'Indicator'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    @sap.sortable : 'false'
    @sap.filterable : 'false'
    DoEnableAccessibility : Boolean not null;
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.pageable : 'false'
  @sap.addressable : 'false'
  @sap.content.version : '1'
  entity SAP__TableColumnsSet {
    @sap.label : 'UUID'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    @sap.sortable : 'false'
    @sap.filterable : 'false'
    key Id : UUID not null;
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    @sap.sortable : 'false'
    @sap.filterable : 'false'
    key Name : String(256) not null;
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    @sap.sortable : 'false'
    @sap.filterable : 'false'
    key Header : String(256) not null;
    Format : SAP__TableColumnFormat not null;
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    @sap.sortable : 'false'
    @sap.filterable : 'false'
    HorizontalAlignment : String(10) not null;
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.pageable : 'false'
  @sap.addressable : 'false'
  @sap.content.version : '1'
  entity SAP__CoverPageSet {
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    @sap.sortable : 'false'
    @sap.filterable : 'false'
    key Title : String(256) not null;
    @sap.label : 'UUID'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    @sap.sortable : 'false'
    @sap.filterable : 'false'
    key Id : UUID not null;
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    @sap.sortable : 'false'
    @sap.filterable : 'false'
    key Name : String not null;
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    @sap.sortable : 'false'
    @sap.filterable : 'false'
    Value : String not null;
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.pageable : 'false'
  @sap.addressable : 'false'
  @sap.content.version : '1'
  entity SAP__SignatureSet {
    @sap.label : 'UUID'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    @sap.sortable : 'false'
    @sap.filterable : 'false'
    key Id : UUID not null;
    @sap.label : 'Indicator'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    @sap.sortable : 'false'
    @sap.filterable : 'false'
    DoSign : Boolean not null;
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    @sap.sortable : 'false'
    @sap.filterable : 'false'
    Reason : String(256) not null;
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.pageable : 'false'
  @sap.addressable : 'false'
  @sap.content.version : '1'
  entity SAP__HierarchySet {
    @sap.label : 'UUID'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    @sap.sortable : 'false'
    @sap.filterable : 'false'
    key Id : UUID not null;
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    @sap.sortable : 'false'
    @sap.filterable : 'false'
    DistanceFromRootElement : String(256) not null;
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    @sap.sortable : 'false'
    @sap.filterable : 'false'
    DrillStateElement : String(256) not null;
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.pageable : 'false'
  @sap.addressable : 'false'
  @sap.content.version : '1'
  entity SAP__PDFHeaderSet {
    @sap.label : 'UUID'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    @sap.sortable : 'false'
    @sap.filterable : 'false'
    key Id : UUID not null;
    Right : SAP__HeaderFooterField not null;
    Left : SAP__HeaderFooterField not null;
    Center : SAP__HeaderFooterField not null;
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.creatable : 'false'
  @sap.updatable : 'false'
  @sap.deletable : 'false'
  @sap.pageable : 'false'
  @sap.addressable : 'false'
  @sap.content.version : '1'
  entity SAP__PDFFooterSet {
    @sap.label : 'UUID'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    @sap.sortable : 'false'
    @sap.filterable : 'false'
    key Id : UUID not null;
    Right : SAP__HeaderFooterField not null;
    Left : SAP__HeaderFooterField not null;
    Center : SAP__HeaderFooterField not null;
  };

  @cds.external : true
  @cds.persistence.skip : true
  @sap.content.version : '1'
  entity SAP__ValueHelpSet {
    key VALUEHELP : String not null;
    FIELD_VALUE : String(10) not null;
    DESCRIPTION : String;
  };

  @cds.external : true
  type SAP__FitToPage {
    @sap.label : 'Error behavior'
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    @sap.sortable : 'false'
    @sap.filterable : 'false'
    ErrorRecoveryBehavior : String(8) not null;
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    @sap.sortable : 'false'
    @sap.filterable : 'false'
    IsEnabled : Boolean not null;
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    @sap.sortable : 'false'
    @sap.filterable : 'false'
    MinimumFontSize : Integer not null;
  };

  @cds.external : true
  type SAP__TableColumnFormat {
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    @sap.sortable : 'false'
    @sap.filterable : 'false'
    DisplayFormat : String(40) not null;
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    @sap.sortable : 'false'
    @sap.filterable : 'false'
    IANATimezone : String not null;
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    @sap.sortable : 'false'
    @sap.filterable : 'false'
    IANATimezoneProperty : String not null;
  };

  @cds.external : true
  type SAP__HeaderFooterField {
    @sap.creatable : 'false'
    @sap.updatable : 'false'
    @sap.sortable : 'false'
    @sap.filterable : 'false'
    Type : String(256) not null;
  };
};

