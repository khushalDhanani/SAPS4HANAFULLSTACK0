using { SD_F2370_INQY_WL_SRV as externalWL } from '../../external/SD_F2370_INQY_WL_SRV';
using { SD_F2369_INQY_FS_SRV as externalFS } from '../../external/SD_F2369_INQY_FS_SRV';
using { C_PURCHASEORDER_FS_SRV as externalPO } from '../../external/C_PURCHASEORDER_FS_SRV';
using { MM_PUR_PO_MAINT_V2_SRV as maint } from '../../external/MM_PUR_PO_MAINT_V2_SRV';

@(requires: 'authenticated-user')
service SalesInquiryService @(path: '/odata/v4/sales-inquiry') {
    @readonly
    @(requires: ['Viewer', 'SalesRepresentative', 'SalesManager', 'Admin'])
    entity SalesInquiries as projection on externalWL.C_InquiryWL_F2370 {
        key SalesInquiry,
        SalesInquiryType,
        SoldToParty,
        PurchaseOrderByCustomer,
        null as CustomerName : String(80),
        null as CustomerPurchaseOrderDate : Date,
        null as BindingPeriodValidityStartDate : Date,
        null as BindingPeriodValidityEndDate : Date,
        null as ShipToParty : String(10),
        null as ShipToPartyName : String(80),
        null as SalesAreaDesc : String(64),
        null as ContactPersonName : String(80),
        null as SalesEmployeeName : String(80),
        OverallSDProcessStatus,
        OverallSDDocumentRejectionSts,
        SalesDocumentRjcnReason,
        CreationDate,
        SalesInquiryDate,
        TransactionCurrency,
        TotalNetAmount,
        SalesOrganization,
        DistributionChannel,
        OrganizationDivision,
        SalesGroup,
        null as SalesGroupName : String(20),
        SalesOffice,
        null as SalesOfficeName : String(20),
        CreatedByUser,
        LastChangedByUser,
        OrganizationBPName1,
        OrganizationBPName2,
        to_Items : Composition of many SalesInquiryItems on to_Items.SalesInquiry = SalesInquiry
    };

    @readonly
    @(requires: ['Viewer', 'SalesRepresentative', 'SalesManager', 'Admin'])
    entity SalesInquiryItems as projection on externalFS.C_Inquiryitemfs {
        key SalesInquiry,
        key SalesInquiryItem,
        SalesInquiryItemText,
        MaterialName,
        SoldToParty,
        SDProcessStatus,
        SalesDocumentRjcnReasonName,
        OrderQuantity,
        OrderQuantityUnit,
        null as NetPriceAmount : Decimal(16, 3),
        NetAmount,
        TransactionCurrency,
        Material,
        MaterialGroup,
        RequestedDeliveryDate,
        MaterialByCustomer
    };

    // Value Help Entities (Accessible to Viewers and Sales Roles)
    @readonly @(requires: ['Viewer', 'SalesRepresentative', 'SalesManager', 'Admin']) entity SalesInquiryTypeVH as projection on externalFS.I_SalesDocumentType {
        key SalesDocumentType,
        SalesDocumentType_Text,
        SalesDocumentType_Text as SalesDocumentTypeName : String(40),
        SDDocumentCategory,
        null as SDDocumentCategoryName : String(40),
        IsLocked,
        null as IsActive : Boolean,
        null as StatusText : String(20),
        null as StatusState : String(20),
        ScreenSequenceGroup,
        NumberRangeForIntIDAssignment,
        NumberRangeForExtIDAssignment,
        TextDeterminationProcedure,
        PartnerDeterminationProcedure
    };
    @readonly @(requires: ['Viewer', 'SalesRepresentative', 'SalesManager', 'Admin']) entity SalesOrganizationVH as projection on externalWL.I_SalesOrganization;
    @readonly @(requires: ['Viewer', 'SalesRepresentative', 'SalesManager', 'Admin']) entity DistributionChannelVH as projection on externalWL.C_Dischannelvaluehelp;
    @readonly @(requires: ['Viewer', 'SalesRepresentative', 'SalesManager', 'Admin']) entity DivisionVH as projection on externalWL.C_OrgDivisionValueHelp;
    @readonly @(requires: ['Viewer', 'SalesRepresentative', 'SalesManager', 'Admin']) entity SalesOfficeVH as projection on externalWL.C_SalesOfficeValueHelp;
    @readonly @(requires: ['Viewer', 'SalesRepresentative', 'SalesManager', 'Admin']) entity SalesGroupVH as projection on externalWL.C_SalesGroupValueHelp;
    @readonly @(requires: ['Viewer', 'SalesRepresentative', 'SalesManager', 'Admin']) entity SoldToPartyVH as projection on externalWL.C_SoldToValueHelp;
    @readonly @(requires: ['Viewer', 'SalesRepresentative', 'SalesManager', 'Admin']) entity CustomerVH as projection on externalWL.I_Customer_VH;
    @readonly @(requires: ['Viewer', 'SalesRepresentative', 'SalesManager', 'Admin']) entity MaterialVH as projection on externalFS.I_Material {
        key Material,
        Material_Text,
        Material_Text as MaterialName : String(40),
        MaterialType,
        MaterialGroup,
        MaterialBaseUnit
    };
    @readonly @(requires: ['Viewer', 'SalesRepresentative', 'SalesManager', 'Admin']) entity CurrencyVH as projection on externalWL.I_CurrencyStdVH;
    @readonly @(requires: ['Viewer', 'SalesRepresentative', 'SalesManager', 'Admin']) entity UnitOfMeasureVH as projection on externalPO.I_UnitOfMeasure;
    @readonly @(requires: ['Viewer', 'SalesRepresentative', 'SalesManager', 'Admin']) entity PlantVH as projection on maint.C_MM_PlantValueHelp;

    type InquiryItem {
        SalesInquiryItem: String;
        Material: String;
        SalesInquiryItemText: String;
        OrderQuantity: Decimal;
        OrderQuantityUnit: String;
        NetPriceAmount: Decimal;
        NetAmount: Decimal;
        TransactionCurrency: String;
        // Required by SAP (incompletion procedure Z1) for the sales inquiry
        Plant: String;
    }

    type InquiryHeader {
        SalesInquiryType: String;
        SalesOrganization: String;
        DistributionChannel: String;
        OrganizationDivision: String;
        SalesOffice: String;
        SalesGroup: String;
        SoldToParty: String;
        CustomerName: String;
        ShipToParty: String;
        PurchaseOrderByCustomer: String;
        CustomerPurchaseOrderDate: Date;
        SalesInquiryDate: Date;
        BindingPeriodValidityStartDate: Date;
        BindingPeriodValidityEndDate: Date;
        TransactionCurrency: String;
        TotalNetAmount: Decimal;
        // Commercial & logistics extension fields required by SAP (procedure Z1 / partner ZP).
        // Transmitted only when the SAP inquiry service exposes the field; see getInquiryCreationCapabilities.
        CustomerGroup2: String;
        PortOfLoading: String;
        PortOfDischarge: String;
        ContactPerson: String;
    }

    @(requires: ['SalesRepresentative', 'SalesManager', 'Admin'])
    action createSalesInquiry(header: InquiryHeader, items: array of InquiryItem) returns String;

    @(requires: ['Viewer', 'SalesRepresentative', 'SalesManager', 'Admin'])
    function getCustomerDefaults(Customer: String, SalesOrganization: String, DistributionChannel: String, Division: String) returns {
        Customer: String;
        CustomerName: String;
        City: String;
        Country: String;
        Currency: String;
        ShipToParty: String;
        ShipToPartyName: String;
        SalesOffice: String;
        SalesOfficeName: String;
        SalesGroup: String;
        SalesGroupName: String;
        derived: Boolean;
    };

    // Which incompletion procedure Z1 fields the SAP inquiry creation service can currently accept.
    // False means the value cannot be sent from this application and must be maintained directly in SAP.
    @(requires: ['Viewer', 'SalesRepresentative', 'SalesManager', 'Admin'])
    function getInquiryCreationCapabilities() returns {
        CustomerGroup2: Boolean;
        PortOfLoading: Boolean;
        PortOfDischarge: Boolean;
        ContactPerson: Boolean;
        Plant: Boolean;
        service: String;
    };

    @(requires: ['Viewer', 'SalesRepresentative', 'SalesManager', 'Admin'])
    function getSalesInquiryDefaults() returns {
        SalesInquiryType: String;
        SalesOrganization: String;
        DistributionChannel: String;
        OrganizationDivision: String;
        SalesInquiryDate: Date;
        BindingPeriodValidityStartDate: Date;
        BindingPeriodValidityEndDate: Date;
        TransactionCurrency: String;
        derived: Boolean;
    };

    @(requires: ['Viewer', 'SalesRepresentative', 'SalesManager', 'Admin'])
    function getSalesOrderMetrics() returns {
        openOrdersCount: Integer;
        totalOrdersCount: Integer;
    };
}
