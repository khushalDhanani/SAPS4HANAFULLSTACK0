using { C_PURCHASEORDER_FS_SRV as external } from '../../external/C_PURCHASEORDER_FS_SRV';
using { MM_PUR_PO_MAINT_V2_SRV as maint } from '../../external/MM_PUR_PO_MAINT_V2_SRV';

@(requires: 'authenticated-user')
service PurchaseOrderService {
    @readonly
    @(requires: ['Viewer', 'PurchasingManager', 'Admin'])
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
        PurchaseOrderDate,
        CreatedByUser,
        UserFullName,
        PurchaseOrderNetAmount,
        DocumentCurrency,
        PaymentTerms,
        PaymentTerms_Text,
        PaymentTermsDescription,
        IncotermsClassification,
        IncotermsClassification_Text,
        IncotermsTransferLocation,
        PurchasingCompletenessStatus,
        ReleaseIsNotCompleted,
        PurchasingDocumentDeletionCode,
        PurchasingDocumentStatus,
        PurchasingDocumentStatusName,
        PurgHasFlxblWorkflowApproval,
        to_PurchaseOrderItem : Composition of many PurchaseOrderItems on to_PurchaseOrderItem.PurchaseOrder = PurchaseOrder
    };

    @readonly
    @(requires: ['Viewer', 'PurchasingManager', 'Admin'])
    entity PurchaseOrderItems as projection on external.C_PurOrdItemEnh {
        key PurchaseOrder,
        key PurchaseOrderItem,
        Material,
        PurchaseOrderItemText,
        Plant,
        PlantName,
        StorageLocation,
        MaterialGroup,
        OrderQuantity,
        PurchaseOrderQuantityUnit,
        NetPriceAmount,
        NetAmount,
        DocumentCurrency,
        TaxCode,
        RequisitionerName,
        PurchaseOrderItemStatus,
        FirstDeliveryDate
    };

    // Value Help Entities (Accessible to Viewers and Purchasing Managers)
    @readonly @(requires: ['Viewer', 'PurchasingManager', 'Admin']) entity DocumentTypeVH as projection on external.I_PurchasingDocumentType where PurchasingDocumentCategory = 'F';
    @readonly @(requires: ['Viewer', 'PurchasingManager', 'Admin']) entity SupplierVH as projection on maint.C_MM_SupplierValueHelp;
    @readonly @(requires: ['Viewer', 'PurchasingManager', 'Admin']) entity CompanyCodeVH as projection on maint.C_MM_CompanyCodeValueHelp;
    @readonly @(requires: ['Viewer', 'PurchasingManager', 'Admin']) entity PurchasingOrgVH as projection on maint.C_PurchasingOrgValueHelp;
    @readonly @(requires: ['Viewer', 'PurchasingManager', 'Admin']) entity PurchasingGroupVH as projection on maint.C_PurchasingGroupValueHelp;
    @readonly @(requires: ['Viewer', 'PurchasingManager', 'Admin']) entity MaterialVH as projection on maint.C_MM_MaterialValueHelp {
        key Material,
        key Plant,
        ProductExternalID,
        MaterialName,
        MaterialName as Material_Text : String(40),
        PlantName,
        MaterialGroup,
        MaterialGroupName,
        MaterialType,
        MaterialTypeName,
        MaterialBaseUnit,
        ProductTypeCode,
        ProductTypeName
    };
    @readonly @(requires: ['Viewer', 'PurchasingManager', 'Admin']) entity PlantVH as projection on maint.C_MM_PlantValueHelp;
    @readonly @(requires: ['Viewer', 'PurchasingManager', 'Admin']) entity StorageLocationVH as projection on maint.C_MM_StorLocValueHelp;
    @readonly @(requires: ['Viewer', 'PurchasingManager', 'Admin']) entity MaterialGroupVH as projection on maint.C_MM_MaterialGroupValueHelp;
    @readonly @(requires: ['Viewer', 'PurchasingManager', 'Admin']) entity IncotermsClassificationVH as projection on maint.C_MM_IncotermValueHelp;
    @readonly @(requires: ['Viewer', 'PurchasingManager', 'Admin']) entity PaymentTermsVH as projection on maint.C_MM_PaymentTermValueHelp;
    
    // Generic VH Entities from FS service
    @readonly @(requires: ['Viewer', 'PurchasingManager', 'Admin']) entity CurrencyVH as projection on external.I_CurrencyStdVH;
    @readonly @(requires: ['Viewer', 'PurchasingManager', 'Admin']) entity UnitOfMeasureVH as projection on external.I_UnitOfMeasure;
    @readonly @(requires: ['Viewer', 'PurchasingManager', 'Admin']) entity TaxCodeVH as projection on external.I_TaxCode;
    @readonly @(requires: ['Viewer', 'PurchasingManager', 'Admin']) entity GLAccountVH as projection on external.I_GLAccountStdVH;
    @readonly @(requires: ['Viewer', 'PurchasingManager', 'Admin']) entity CostCenterVH as projection on external.I_CostCenterVH;
    @readonly @(requires: ['Viewer', 'PurchasingManager', 'Admin']) entity ProfitCenterVH as projection on external.I_ProfitCenterStdVH;
    @readonly @(requires: ['Viewer', 'PurchasingManager', 'Admin']) entity FixedAssetVH as projection on external.I_MasterFixedAssetStdVH;
    @readonly @(requires: ['Viewer', 'PurchasingManager', 'Admin']) entity WBSElementVH as projection on external.I_WBSElementBasicDataStdVH;
    @readonly @(requires: ['Viewer', 'PurchasingManager', 'Admin']) entity InternalOrderVH as projection on external.I_InternalOrderStdVH;
    @readonly @(requires: ['Viewer', 'PurchasingManager', 'Admin']) entity PurchaseContractVH as projection on external.C_PurchaseContractValHelp;

    type POItem {
        PurchaseOrderItem: String;
        Material: String;
        PurchaseOrderItemText: String;
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
        NetAmountIsEstimate: Boolean;
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

    @(requires: ['Viewer', 'PurchasingManager', 'Admin'])
    function getSupplierDefaults(Supplier: String, CompanyCode: String, PurchasingOrganization: String) returns {
        Supplier: String;
        Currency: String;
        PaymentTerms: String;
        IncotermsClassification: String;
        IncotermsLocation1: String;
        derived: Boolean;
        source: String;
        lastPurchaseOrder: String;
    };

    @(requires: ['Viewer', 'PurchasingManager', 'Admin'])
    function getDashboardMetrics() returns String;
}
