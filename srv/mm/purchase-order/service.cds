using { C_PURCHASEORDER_FS_SRV as external } from '../../external/C_PURCHASEORDER_FS_SRV';
using { MM_PUR_PO_MAINT_V2_SRV as maint } from '../../external/MM_PUR_PO_MAINT_V2_SRV';

@(requires: 'authenticated-user')
service PurchaseOrderService {
    @readonly
    @(requires: ['Viewer', 'PurchasingManager', 'User', 'Admin'])
    entity PurchaseOrders as projection on external.C_PurchaseOrderFs {
        key PurchaseOrder,
        PurchaseOrderType,
        CompanyCode,
        CompanyCodeName,
        PurchasingOrganization,
        PurchasingOrganizationName,
        PurchasingGroup,
        PurchasingGroupName,
        Supplier,
        SupplierName,
        CreationDate,
        CreatedByUser,
        UserFullName,
        PurchasingCompletenessStatus
    };

    // Value Help Entities (Accessible to Viewers and Purchasing Managers)
    @readonly @(requires: ['Viewer', 'PurchasingManager', 'User', 'Admin']) entity DocumentTypeVH as projection on external.I_PurchasingDocumentType;
    @readonly @(requires: ['Viewer', 'PurchasingManager', 'User', 'Admin']) entity SupplierVH as projection on maint.C_MM_SupplierValueHelp;
    @readonly @(requires: ['Viewer', 'PurchasingManager', 'User', 'Admin']) entity CompanyCodeVH as projection on maint.C_MM_CompanyCodeValueHelp;
    @readonly @(requires: ['Viewer', 'PurchasingManager', 'User', 'Admin']) entity PurchasingOrgVH as projection on maint.C_PurchasingOrgValueHelp;
    @readonly @(requires: ['Viewer', 'PurchasingManager', 'User', 'Admin']) entity PurchasingGroupVH as projection on maint.C_PurchasingGroupValueHelp;
    @readonly @(requires: ['Viewer', 'PurchasingManager', 'User', 'Admin']) entity MaterialVH as projection on maint.C_MM_MaterialValueHelp;
    @readonly @(requires: ['Viewer', 'PurchasingManager', 'User', 'Admin']) entity PlantVH as projection on maint.C_MM_PlantValueHelp;
    @readonly @(requires: ['Viewer', 'PurchasingManager', 'User', 'Admin']) entity StorageLocationVH as projection on maint.C_MM_StorLocValueHelp;
    @readonly @(requires: ['Viewer', 'PurchasingManager', 'User', 'Admin']) entity MaterialGroupVH as projection on maint.C_MM_MaterialGroupValueHelp;
    @readonly @(requires: ['Viewer', 'PurchasingManager', 'User', 'Admin']) entity IncotermsClassificationVH as projection on maint.C_MM_IncotermValueHelp;
    @readonly @(requires: ['Viewer', 'PurchasingManager', 'User', 'Admin']) entity PaymentTermsVH as projection on maint.C_MM_PaymentTermValueHelp;
    
    // Generic VH Entities from FS service
    @readonly @(requires: ['Viewer', 'PurchasingManager', 'User', 'Admin']) entity CurrencyVH as projection on external.I_CurrencyStdVH;
    @readonly @(requires: ['Viewer', 'PurchasingManager', 'User', 'Admin']) entity UnitOfMeasureVH as projection on external.I_UnitOfMeasure;
    @readonly @(requires: ['Viewer', 'PurchasingManager', 'User', 'Admin']) entity TaxCodeVH as projection on external.I_TaxCode;

    type POItem {
        PurchaseOrderItem: String;
        Material: String;
        Plant: String;
        StorageLocation: String;
        MaterialGroup: String;
        PurchaseOrderItemCategory: String;
        AccountAssignmentCategory: String;
        OrderQuantity: Decimal;
        UnitOfMeasure: String;
        NetPriceAmount: Decimal;
        TaxCode: String;
        NetAmount: Decimal;
        RequisitionerName: String;
    }

    type POHeader {
        PurchaseOrderType: String;
        CompanyCode: String;
        PurchasingOrganization: String;
        PurchasingGroup: String;
        Supplier: String;
        DocumentDate: Date;
        Currency: String;
        IncotermsClassification: String;
        IncotermsLocation1: String;
        PaymentTerms: String;
    }

    @(requires: ['PurchasingManager', 'Admin'])
    action createPurchaseOrder(header: POHeader, items: array of POItem) returns String;
}
