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
            const poNumber = result && (result.PurchaseOrder || result.PurchaseOrderNumber);
            if (!poNumber || String(poNumber).trim() === '') {
                LOG.error('S/4HANA PO activation succeeded but no PurchaseOrder document number was returned by SAP.');
                req.error(502, 'S/4HANA Purchase Order creation succeeded but no Purchase Order document number was returned by SAP.');
                return;
            }
            return String(poNumber).trim();
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
                derived: false,
                source: '',
                lastPurchaseOrder: ''
            };
        }

        const sSupplier = String(Supplier).trim();
        const sPurchOrg = PurchasingOrganization ? String(PurchasingOrganization).trim() : '';
        const sCompCode = CompanyCode ? String(CompanyCode).trim() : '';

        try {
            const findPoWithDefaults = async (filterObj) => {
                const s4Query = SELECT.from('C_PURCHASEORDER_FS_SRV.C_PurchaseOrderFs')
                    .columns(
                        'PurchaseOrder',
                        'DocumentCurrency',
                        'PaymentTerms',
                        'IncotermsClassification',
                        'IncotermsTransferLocation',
                        'PurchasingOrganization',
                        'CompanyCode'
                    )
                    .where(filterObj)
                    .orderBy({ ref: ['PurchaseOrder'], sort: 'desc' })
                    .limit(1);
                const result = await purchaseOrderAdapter.readFsData(s4Query);
                const aOrders = Array.isArray(result) ? result : (result?.value || []);
                return aOrders.length > 0 ? aOrders[0] : null;
            };

            let po = null;
            // Attempt 1: Supplier + PurchOrg + CompCode (if both supplied)
            if (sPurchOrg && sCompCode) {
                po = await findPoWithDefaults({ Supplier: sSupplier, PurchasingOrganization: sPurchOrg, CompanyCode: sCompCode });
            }
            // Attempt 2: Supplier + CompCode (if CompCode supplied)
            if (!po && sCompCode) {
                po = await findPoWithDefaults({ Supplier: sSupplier, CompanyCode: sCompCode });
            }
            // Attempt 3: Supplier + PurchOrg (if PurchOrg supplied)
            if (!po && sPurchOrg) {
                po = await findPoWithDefaults({ Supplier: sSupplier, PurchasingOrganization: sPurchOrg });
            }
            // Attempt 4: Supplier alone (broadest commercial history for this vendor)
            if (!po) {
                po = await findPoWithDefaults({ Supplier: sSupplier });
            }

            let sValidPaymentTerms = '';
            if (po && po.PaymentTerms) {
                const termUpper = String(po.PaymentTerms).trim().toUpperCase();
                let validTermsSet = null;
                if (typeof purchaseOrderAdapter.getValidPaymentTerms === 'function') {
                    try {
                        validTermsSet = await purchaseOrderAdapter.getValidPaymentTerms();
                    } catch (_e) {
                        validTermsSet = null;
                    }
                }
                if (validTermsSet && validTermsSet.size > 0) {
                    if (validTermsSet.has(termUpper)) {
                        sValidPaymentTerms = termUpper;
                    } else {
                        LOG.warn(`Historical PO ${po.PurchaseOrder} has invalid/obsolete PaymentTerms '${po.PaymentTerms}' not present in S/4HANA customizing; omitted.`);
                    }
                } else if (termUpper !== 'AT01' && termUpper !== 'AT05' && termUpper !== 'AT06') {
                    // Fallback when S/4 payment terms value help is unreachable or in mock mode
                    sValidPaymentTerms = termUpper;
                }
            }

            if (po && (po.DocumentCurrency || sValidPaymentTerms || po.IncotermsClassification)) {
                return {
                    Supplier: sSupplier,
                    Currency: po.DocumentCurrency || '',
                    PaymentTerms: sValidPaymentTerms,
                    IncotermsClassification: po.IncotermsClassification || '',
                    IncotermsLocation1: po.IncotermsTransferLocation || '',
                    derived: true,
                    source: 'from last PO',
                    lastPurchaseOrder: po.PurchaseOrder || ''
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
            derived: false,
            source: '',
            lastPurchaseOrder: ''
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
