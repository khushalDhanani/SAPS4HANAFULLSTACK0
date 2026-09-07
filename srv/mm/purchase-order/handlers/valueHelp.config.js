const purchaseOrderAdapter = require('../../../integration/s4hana/mm/purchase-order/PurchaseOrderAdapter');

/**
 * Purchase Order specific Value Help entity definitions.
 * Categorized by source S/4HANA OData service:
 * 1. C_PURCHASEORDER_FS_SRV (readFsData)
 * 2. MM_PUR_PO_MAINT_V2_SRV (readMaintData)
 */
const FS_VALUE_HELP_ENTITIES = [
    'CurrencyVH',
    'UnitOfMeasureVH',
    'DocumentTypeVH',
    'TaxCodeVH'
];

const MAINT_VALUE_HELP_ENTITIES = [
    'SupplierVH',
    'CompanyCodeVH',
    'PurchasingOrgVH',
    'PurchasingGroupVH',
    'MaterialVH',
    'PlantVH',
    'StorageLocationVH',
    'MaterialGroupVH',
    'IncotermsClassificationVH',
    'PaymentTermsVH'
];

/**
 * Purchase Order Value Help configuration groups for the shared value help mechanism.
 */
const poValueHelpConfig = [
    {
        entities: FS_VALUE_HELP_ENTITIES,
        read: (query) => purchaseOrderAdapter.readFsData(query),
        entityDeduplicateBy: {
            DocumentTypeVH: 'PurchasingDocumentType',
            CurrencyVH: 'Currency',
            TaxCodeVH: 'TaxCode'
        }
    },
    {
        entities: MAINT_VALUE_HELP_ENTITIES,
        read: (query) => purchaseOrderAdapter.readMaintData(query),
        entityDeduplicateBy: {
            PaymentTermsVH: 'PaymentTerms'
        }
    }
];

module.exports = {
    poValueHelpConfig,
    FS_VALUE_HELP_ENTITIES,
    MAINT_VALUE_HELP_ENTITIES
};
