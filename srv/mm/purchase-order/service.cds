using { C_PURCHASEORDER_FS_SRV as external } from '../../external/C_PURCHASEORDER_FS_SRV';
using { MM_PUR_PO_MAINT_V2_SRV as maint } from '../../external/MM_PUR_PO_MAINT_V2_SRV';

service PurchaseOrderService {
    @readonly
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
        PurchasingCompletenessStatus
    };

    // Value Help Entities
    @readonly entity DocumentTypeVH as projection on external.I_PurchasingDocumentType;
    @readonly entity SupplierVH as projection on maint.C_MM_SupplierValueHelp;
    @readonly entity CompanyCodeVH as projection on maint.C_MM_CompanyCodeValueHelp;
    @readonly entity PurchasingOrgVH as projection on maint.C_PurchasingOrgValueHelp;
    @readonly entity PurchasingGroupVH as projection on maint.C_PurchasingGroupValueHelp;
    @readonly entity MaterialVH as projection on maint.C_MM_MaterialValueHelp;
    @readonly entity PlantVH as projection on maint.C_MM_PlantValueHelp;
    @readonly entity StorageLocationVH as projection on maint.C_MM_StorLocValueHelp;
    @readonly entity MaterialGroupVH as projection on maint.C_MM_MaterialGroupValueHelp;
    @readonly entity IncotermsClassificationVH as projection on maint.C_MM_IncotermValueHelp;
    @readonly entity PaymentTermsVH as projection on maint.C_MM_PaymentTermValueHelp;
    
    // Generic VH Entities from FS service
    @readonly entity CurrencyVH as projection on external.I_CurrencyStdVH;
    @readonly entity UnitOfMeasureVH as projection on external.I_UnitOfMeasure;
    @readonly entity TaxCodeVH as projection on external.I_TaxCode;

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

    action createPurchaseOrder(header: POHeader, items: array of POItem) returns String;
}
