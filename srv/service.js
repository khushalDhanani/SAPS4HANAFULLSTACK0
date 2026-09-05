const cds = require('@sap/cds');
const purchaseOrderAdapter = require('./integration/s4hana/PurchaseOrderAdapter');
const { validateCreatePurchaseOrderPayload } = require('./service/PurchaseOrderValidator');
const { mapToS4Payload } = require('./integration/s4hana/PurchaseOrderMapper');
const { extractS4ErrorMessage } = require('./integration/s4hana/PurchaseOrderErrorMapper');

module.exports = cds.service.impl(async function() {
    // Delegate READ operations to the dedicated S/4HANA integration adapters
    const fsEntities = ['PurchaseOrders', 'CurrencyVH', 'UnitOfMeasureVH', 'DocumentTypeVH', 'TaxCodeVH'];
    this.on('READ', fsEntities, async (req) => {
        const results = await purchaseOrderAdapter.readFsData(req.query);
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

    const maintEntities = [
        'SupplierVH', 'CompanyCodeVH', 'PurchasingOrgVH', 
        'PurchasingGroupVH', 'MaterialVH', 'PlantVH', 'StorageLocationVH', 'MaterialGroupVH', 'IncotermsClassificationVH', 'PaymentTermsVH'
    ];
    this.on('READ', maintEntities, async (req) => {
        return await purchaseOrderAdapter.readMaintData(req.query);
    });

    this.on('createPurchaseOrder', async (req) => {
        // 1. Validate payload
        const validation = validateCreatePurchaseOrderPayload(req.data);
        if (!validation.isValid) {
            req.error(400, validation.errors.join('; '));
            return;
        }

        // 2. Map payload to S/4HANA OData structure
        let payload;
        try {
            payload = mapToS4Payload(req.data.header, req.data.items);
        } catch (mapErr) {
            req.error(400, `Payload mapping error: ${mapErr.message}`);
            return;
        }

        // 3. Create PO via adapter
        try {
            const result = await purchaseOrderAdapter.createPurchaseOrder(payload);
            return result.PurchaseOrder || "PO Created but no ID returned";
        } catch (error) {
            const sapError = extractS4ErrorMessage(error);
            console.error('[PurchaseOrderService] Error creating PO:', sapError);
            req.error(500, `Failed to create Purchase Order: ${sapError}`);
        }
    });
});
