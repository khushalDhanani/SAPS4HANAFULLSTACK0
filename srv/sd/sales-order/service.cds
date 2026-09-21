using { SD_F1873_SO_WL_SRV as externalSO } from '../../external/SD_F1873_SO_WL_SRV';
using { SD_F2370_INQY_WL_SRV as externalWL } from '../../external/SD_F2370_INQY_WL_SRV';
using { SD_F2369_INQY_FS_SRV as externalFS } from '../../external/SD_F2369_INQY_FS_SRV';
using { C_PURCHASEORDER_FS_SRV as externalPO } from '../../external/C_PURCHASEORDER_FS_SRV';
using { MM_PUR_PO_MAINT_V2_SRV as maint } from '../../external/MM_PUR_PO_MAINT_V2_SRV';

@(requires: 'authenticated-user')
service SalesOrderService @(path: '/odata/v4/sales-order') {
    @readonly
    @(requires: ['Viewer', 'SalesRepresentative', 'SalesManager', 'Admin'])
    entity SalesOrders as projection on externalSO.C_SalesOrderWl_F1873 {
        key SalesOrder,
        SalesOrderType,
        SalesOrderDate,
        SoldToParty,
        SoldToPartyName,
        ShipToParty,
        ShipToPartyName,
        PayerParty,
        PayerPartyName,
        BillToParty,
        BillToPartyName,
        SalesEmployee,
        SalesEmployeeName,
        PurchaseOrderByCustomer,
        RequestedDeliveryDate,
        OverallSDProcessStatus,
        OverallSDDocumentRejectionSts,
        OverallBillingBlockStatus,
        SalesDocApprovalStatus,
        DeliveryBlockReason,
        TotalNetAmount,
        TransactionCurrency,
        SalesOrganization,
        DistributionChannel,
        OrganizationDivision,
        SalesOffice,
        SalesGroup,
        CreationDate,
        CreatedByUser,
        LastChangeDateTime,
        LastChangedByUser,
        to_SalesDocumentItemWl
    };

    @readonly
    @(requires: ['Viewer', 'SalesRepresentative', 'SalesManager', 'Admin'])
    entity SalesOrderItems as projection on externalSO.C_SalesDocumentItemWl;

    // Value Help Entities (Accessible to Viewers and Sales Roles)
    @readonly @(requires: ['Viewer', 'SalesRepresentative', 'SalesManager', 'Admin']) entity SalesOrderTypeVH as projection on externalSO.C_SalesOrderTypeVH_F1873;
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

    type OrderItem {
        SalesOrderItem: String;
        Material: String;
        SalesOrderItemText: String;
        OrderQuantity: Decimal;
        OrderQuantityUnit: String;
        NetPriceAmount: Decimal;
        NetAmount: Decimal;
        TransactionCurrency: String;
        Plant: String;
        RequestedDeliveryDate: Date;
    }

    type OrderHeader {
        SalesOrderType: String;
        SalesOrganization: String;
        DistributionChannel: String;
        OrganizationDivision: String;
        SalesOffice: String;
        SalesGroup: String;
        SoldToParty: String;
        CustomerName: String;
        ShipToParty: String;
        PurchaseOrderNumber: String;
        PurchaseOrderByCustomer: String;
        CustomerPurchaseOrderDate: Date;
        SalesOrderDate: Date;
        RequestedDeliveryDate: Date;
        TransactionCurrency: String;
        TotalNetAmount: Decimal;
        CustomerGroup2: String;
        PortOfLoading: String;
        PortOfDischarge: String;
        ContactPerson: String;
    }

    @(requires: ['SalesRepresentative', 'SalesManager', 'Admin'])
    action createSalesOrder(header: OrderHeader, items: array of OrderItem) returns String;

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

    @(requires: ['Viewer', 'SalesRepresentative', 'SalesManager', 'Admin'])
    function getSalesOrderDefaults() returns {
        SalesOrderType: String;
        SalesOrganization: String;
        DistributionChannel: String;
        OrganizationDivision: String;
        Plant: String;
        SalesOrderDate: Date;
        CreationDate: Date;
        RequestedDeliveryDate: Date;
        TransactionCurrency: String;
        derived: Boolean;
    };

    @(requires: ['Viewer', 'SalesRepresentative', 'SalesManager', 'Admin'])
    function getSalesOrderMetrics() returns {
        openOrdersCount: Integer;
        totalOrdersCount: Integer;
    };

    @(requires: ['Viewer', 'SalesRepresentative', 'SalesManager', 'Admin'])
    action checkATP(SalesOrderID: String, ItemID: String) returns {
        RequestedQty: Decimal;
        ConfirmedQty: Decimal;
        ReqDlvDate: Date;
        CnfDlvDate: Date;
        SalesUnit: String;
    };
}
