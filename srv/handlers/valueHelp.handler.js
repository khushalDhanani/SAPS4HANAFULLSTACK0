const purchaseOrderAdapter = require('../integration/s4hana/PurchaseOrderAdapter');

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
 * Registers value help READ handlers on the CAP service.
 *
 * @param {import('@sap/cds').Service} srv
 */
function registerValueHelpHandlers(srv) {
    // 1. Value helps from C_PURCHASEORDER_FS_SRV
    srv.on('READ', FS_VALUE_HELP_ENTITIES, async (req) => {
        const results = await purchaseOrderAdapter.readFsData(req.query);

        // Apply CurrencyVH deduplication if needed
        if (req.target.name.endsWith('CurrencyVH') && Array.isArray(results)) {
            const seen = new Set();
            const filtered = results.filter(item => {
                if (!item || !item.Currency) return true;
                if (seen.has(item.Currency)) return false;
                seen.add(item.Currency);
                return true;
            });
            if (results.$count !== undefined) {
                filtered.$count = results.$count;
            }
            return filtered;
        }

        return results;
    });

    // 2. Value helps from MM_PUR_PO_MAINT_V2_SRV
    srv.on('READ', MAINT_VALUE_HELP_ENTITIES, async (req) => {
        return await purchaseOrderAdapter.readMaintData(req.query);
    });
}

module.exports = registerValueHelpHandlers;
