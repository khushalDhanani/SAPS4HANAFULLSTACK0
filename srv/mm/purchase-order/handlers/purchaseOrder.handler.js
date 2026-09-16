const cds = require('@sap/cds');
const LOG = require('../../../common/logger')('purchase-order');
const purchaseOrderAdapter = require('../../../integration/s4hana/mm/purchase-order/PurchaseOrderAdapter');
const { validateCreatePurchaseOrderPayload } = require('../validation/purchaseOrder.validation');
const { normalizePurchaseOrderData } = require('../mapping/purchaseOrder.mapper');
const { mapToS4Payload } = require('../../../integration/s4hana/mm/purchase-order/PurchaseOrderMapper');
const { mapS4Error } = require('../../../integration/s4hana/S4ErrorMapper');
const { resolveUserIdentity } = require('../../../auth/userIdentity');

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

    // 2. READ PurchaseOrderItems
    srv.on('READ', 'PurchaseOrderItems', async (req) => {
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
        let authenticatedUser;
        try {
            authenticatedUser = resolveUserIdentity(req);
        } catch (authErr) {
            req.error(401, authErr.message);
            return;
        }

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
            LOG.error(`Error creating PO (${sapError.status}):`, sapError.message);
            req.error(sapError.status, `Failed to create Purchase Order: ${sapError.message}`);
        }
    });

    // 3. Function getSupplierDefaults
    srv.on('getSupplierDefaults', async (req) => {
        const { Supplier, CompanyCode, PurchasingOrganization } = req.data || {};
        if (!Supplier || String(Supplier).trim() === '') {
            return {
                Supplier: '',
                Currency: '',
                PaymentTerms: '',
                IncotermsClassification: '',
                IncotermsLocation1: '',
                derived: false
            };
        }

        const sSupplier = String(Supplier).trim();

        try {
            // Check PurchaseOrders in S/4HANA FS service for confirmed commercial defaults
            const s4Query = SELECT.from('C_PURCHASEORDER_FS_SRV.C_PurchaseOrderFs')
                .columns(
                    'DocumentCurrency',
                    'PaymentTerms',
                    'IncotermsClassification',
                    'IncotermsTransferLocation'
                )
                .where({ Supplier: sSupplier });

            if (PurchasingOrganization && String(PurchasingOrganization).trim() !== '') {
                s4Query.where({ PurchasingOrganization: String(PurchasingOrganization).trim() });
            }
            if (CompanyCode && String(CompanyCode).trim() !== '') {
                s4Query.where({ CompanyCode: String(CompanyCode).trim() });
            }
            s4Query.limit(1);

            const result = await purchaseOrderAdapter.readFsData(s4Query);
            const aOrders = Array.isArray(result) ? result : (result?.value || []);
            const po = aOrders.length > 0 ? aOrders[0] : null;

            if (po && (po.DocumentCurrency || po.PaymentTerms || po.IncotermsClassification)) {
                return {
                    Supplier: sSupplier,
                    Currency: po.DocumentCurrency || '',
                    PaymentTerms: po.PaymentTerms || '',
                    IncotermsClassification: po.IncotermsClassification || '',
                    IncotermsLocation1: po.IncotermsTransferLocation || '',
                    derived: true
                };
            }
        } catch (error) {
            LOG.warn('getSupplierDefaults readFsData failed, falling back:', error.message);
        }

        return {
            Supplier: sSupplier,
            Currency: '',
            PaymentTerms: '',
            IncotermsClassification: '',
            IncotermsLocation1: '',
            derived: false
        };
    });

    // 4. Function getDashboardMetrics: live SAP S/4HANA counts; a count SAP did not return is null
    srv.on('getDashboardMetrics', async (req) => {
        try {
            const metrics = await purchaseOrderAdapter.getDashboardMetrics();
            return JSON.stringify(metrics);
        } catch (error) {
            const sapError = mapS4Error(error);
            const status = sapError.status >= 500 ? 503 : sapError.status;
            return req.error(status, `Dashboard metrics are not available: ${sapError.message}`);
        }
    });
}

registerPurchaseOrderHandlers.registerPurchaseOrderHandlers = registerPurchaseOrderHandlers;
registerPurchaseOrderHandlers.resolveUserIdentity = resolveUserIdentity;

module.exports = registerPurchaseOrderHandlers;
