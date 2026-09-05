const purchaseOrderAdapter = require('../integration/s4hana/PurchaseOrderAdapter');
const { validateCreatePurchaseOrderPayload } = require('../validation/purchaseOrder.validation');
const { normalizePurchaseOrderData } = require('../mapping/purchaseOrder.mapper');
const { mapToS4Payload } = require('../integration/s4hana/PurchaseOrderMapper');
const { mapS4Error } = require('../integration/s4hana/S4ErrorMapper');

/**
 * Derives the authenticated business user identity from CAP request and security context.
 * Flow: XSUAA user attributes (logon_name/email) -> req.user.id -> req.user.name -> env S4_USER -> 'SYSTEM'.
 *
 * @param {import('@sap/cds').Request} req
 * @returns {string}
 */
function resolveUserIdentity(req) {
    if (!req) return process.env.S4_USER || 'SYSTEM';

    // 1. XSUAA user attributes (e.g. logon_name, email)
    if (req.user?.attr?.logon_name) {
        return String(req.user.attr.logon_name).trim();
    }
    if (req.user?.attr?.email) {
        return String(req.user.attr.email).split('@')[0].trim();
    }

    // 2. CAP user ID (ignore default 'anonymous' in unauthenticated requests)
    if (req.user?.id && req.user.id !== 'anonymous') {
        return String(req.user.id).trim();
    }

    // 3. CAP user name property if present
    if (req.user?.name && req.user.name !== 'anonymous') {
        return String(req.user.name).trim();
    }

    // 4. Custom forwarded user header if any
    const headerUser = req.headers?.['x-user-id'] || req._?.req?.headers?.['x-user-id'];
    if (headerUser && String(headerUser).trim() !== '') {
        return String(headerUser).trim();
    }

    // 5. Configured system / service user fallback
    return process.env.S4_USER || 'SYSTEM';
}

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
            req.error(400, validation.message);
            return;
        }

        // Derive authenticated requester identity
        const authenticatedUser = resolveUserIdentity(req);

        // Step B: Domain normalization
        const normalized = normalizePurchaseOrderData(req.data, { user: authenticatedUser });

        // Step C: Technical mapping to S/4 OData structure
        let s4Payload;
        try {
            s4Payload = mapToS4Payload(normalized.header, normalized.items, { user: authenticatedUser });
        } catch (mapErr) {
            req.error(400, `Payload mapping error: ${mapErr.message}`);
            return;
        }

        // Step D: Orchestrate draft & activation via integration adapter
        try {
            const result = await purchaseOrderAdapter.createPurchaseOrder(s4Payload);
            return result.PurchaseOrder || 'PO Created but no ID returned';
        } catch (error) {
            const sapError = mapS4Error(error);
            console.error(`[PurchaseOrderService] Error creating PO (${sapError.status}):`, sapError.message);
            req.error(sapError.status, `Failed to create Purchase Order: ${sapError.message}`);
        }
    });
}

registerPurchaseOrderHandlers.registerPurchaseOrderHandlers = registerPurchaseOrderHandlers;
registerPurchaseOrderHandlers.resolveUserIdentity = resolveUserIdentity;

module.exports = registerPurchaseOrderHandlers;
