using { SD_F2370_INQY_WL_SRV as externalWL } from '../../external/SD_F2370_INQY_WL_SRV';
using { SD_F2369_INQY_FS_SRV as externalFS } from '../../external/SD_F2369_INQY_FS_SRV';

@(requires: 'authenticated-user')
service SalesInquiryService @(path: '/odata/v4/sales-inquiry') {
    @readonly
    @(requires: ['Viewer', 'SalesRepresentative', 'SalesManager', 'User', 'Admin'])
    entity SalesInquiries as projection on externalWL.C_InquiryWL_F2370 {
        key SalesInquiry,
        SalesInquiryType,
        SoldToParty,
        PurchaseOrderByCustomer,
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
        SalesOffice,
        CreatedByUser,
        LastChangedByUser,
        OrganizationBPName1,
        OrganizationBPName2,
        to_Items : Composition of many SalesInquiryItems on to_Items.SalesInquiry = SalesInquiry
    };

    @readonly
    @(requires: ['Viewer', 'SalesRepresentative', 'SalesManager', 'User', 'Admin'])
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
        NetAmount,
        TransactionCurrency,
        Material,
        MaterialGroup,
        RequestedDeliveryDate,
        MaterialByCustomer
    };

    // Value Help Entities (Accessible to Viewers and Sales Roles)
    @readonly @(requires: ['Viewer', 'SalesRepresentative', 'SalesManager', 'User', 'Admin']) entity SalesInquiryTypeVH as projection on externalWL.C_SalesInquiryTypeValueHelp;
    @readonly @(requires: ['Viewer', 'SalesRepresentative', 'SalesManager', 'User', 'Admin']) entity SalesOrganizationVH as projection on externalWL.I_SalesOrganization;
    @readonly @(requires: ['Viewer', 'SalesRepresentative', 'SalesManager', 'User', 'Admin']) entity DistributionChannelVH as projection on externalWL.C_Dischannelvaluehelp;
    @readonly @(requires: ['Viewer', 'SalesRepresentative', 'SalesManager', 'User', 'Admin']) entity DivisionVH as projection on externalWL.C_OrgDivisionValueHelp;
    @readonly @(requires: ['Viewer', 'SalesRepresentative', 'SalesManager', 'User', 'Admin']) entity SoldToPartyVH as projection on externalWL.C_SoldToValueHelp;
    @readonly @(requires: ['Viewer', 'SalesRepresentative', 'SalesManager', 'User', 'Admin']) entity CustomerVH as projection on externalWL.I_Customer_VH;
    @readonly @(requires: ['Viewer', 'SalesRepresentative', 'SalesManager', 'User', 'Admin']) entity MaterialVH as projection on externalWL.I_MaterialStdVH;
    @readonly @(requires: ['Viewer', 'SalesRepresentative', 'SalesManager', 'User', 'Admin']) entity CurrencyVH as projection on externalWL.I_CurrencyStdVH;

    type InquiryItem {
        SalesInquiryItem: String;
        Material: String;
        SalesInquiryItemText: String;
        OrderQuantity: Decimal;
        OrderQuantityUnit: String;
        NetPriceAmount: Decimal;
        NetAmount: Decimal;
        TransactionCurrency: String;
    }

    type InquiryHeader {
        SalesInquiryType: String;
        SalesOrganization: String;
        DistributionChannel: String;
        OrganizationDivision: String;
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
    }

    @(requires: ['SalesRepresentative', 'SalesManager', 'User', 'Admin'])
    action createSalesInquiry(header: InquiryHeader, items: array of InquiryItem) returns String;

    @(requires: ['Viewer', 'SalesRepresentative', 'SalesManager', 'User', 'Admin'])
    function getCustomerDefaults(Customer: String, SalesOrganization: String, DistributionChannel: String, Division: String) returns {
        Customer: String;
        CustomerName: String;
        City: String;
        Country: String;
        Currency: String;
        ShipToParty: String;
        ShipToPartyName: String;
        derived: Boolean;
    };

    @(requires: ['Viewer', 'SalesRepresentative', 'SalesManager', 'User', 'Admin'])
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
}
