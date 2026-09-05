const purchaseOrderAdapter = require('../integration/s4hana/PurchaseOrderAdapter');
const { validateCreatePurchaseOrderPayload } = require('../validation/purchaseOrder.validation');
const { normalizePurchaseOrderData } = require('../mapping/purchaseOrder.mapper');
const { mapToS4Payload } = require('../integration/s4hana/PurchaseOrderMapper');
const { extractS4ErrorMessage } = require('../integration/s4hana/S4ErrorMapper');

/**
 * Registers Purchase Order business handlers on the CAP service.
 *
 * @param {import('@sap/cds').Service} srv
 */
function registerPurchaseOrderHandlers(srv) {
    // 1. READ PurchaseOrders
    srv.on('READ', 'PurchaseOrders', async (req) => {
        return await purchaseOrderAdapter.readFsData(req.query);
    });

    // 2. Action createPurchaseOrder
    srv.on('createPurchaseOrder', async (req) => {
        // Step A: Business validation
        const validation = validateCreatePurchaseOrderPayload(req.data);
        if (!validation.isValid) {
            req.error(400, validation.errors.join('; '));
            return;
        }

        // Step B: Domain normalization
        const normalized = normalizePurchaseOrderData(req.data);

        // Step C: Technical mapping to S/4 OData structure
        let s4Payload;
        try {
            s4Payload = mapToS4Payload(normalized.header, normalized.items);
        } catch (mapErr) {
            req.error(400, `Payload mapping error: ${mapErr.message}`);
            return;
        }

        // Step D: Orchestrate draft & activation via integration adapter
        try {
            const result = await purchaseOrderAdapter.createPurchaseOrder(s4Payload);
            return result.PurchaseOrder || 'PO Created but no ID returned';
        } catch (error) {
            const sapError = extractS4ErrorMessage(error);
            console.error('[PurchaseOrderService] Error creating PO:', sapError);
            req.error(500, `Failed to create Purchase Order: ${sapError}`);
        }
    });
}

module.exports = registerPurchaseOrderHandlers;
