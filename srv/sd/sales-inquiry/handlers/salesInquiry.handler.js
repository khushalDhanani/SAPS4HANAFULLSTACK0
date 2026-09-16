const salesInquiryAdapter = require('../../../integration/s4hana/sd/sales-inquiry/SalesInquiryAdapter');
const { validateCreateSalesInquiryPayload } = require('../validation/salesInquiry.validation');
const { normalizeSalesInquiryData } = require('../mapping/salesInquiry.mapper');
const { mapToS4InquiryPayload } = require('../../../integration/s4hana/sd/sales-inquiry/SalesInquiryMapper');
const { resolveUserIdentity } = require('../../../auth/userIdentity');

/**
 * Safety switch for Sales Quotation creation. Re-enabled on explicit instruction; the UI requires the
 * user to confirm that a real SAP quotation will be created. Set to true to block creation again.
 */
const QUOTATION_CREATION_BLOCKED = false;
const QUOTATION_CREATION_BLOCKED_MESSAGE = 'Sales Quotation creation is temporarily disabled while an SAP session issue is'
    + ' being investigated. No quotation was created. Create the quotation in SAP (VA21) if it is needed now.';

/**
 * Registers Sales Inquiry business handlers on the CAP service.
 *
 * @param {import('@sap/cds').Service} srv
 */
function registerSalesInquiryHandlers(srv) {
    // 1. READ SalesInquiries
    srv.on('READ', 'SalesInquiries', async (req) => {
        let sKey = req.params?.[0]?.SalesInquiry || req.data?.SalesInquiry;
        if (!sKey && typeof req.params?.[0] === 'string') {
            sKey = req.params[0];
        }
        if (!sKey && typeof req.params?.[0] === 'number') {
            sKey = String(req.params[0]);
        }
        if (!sKey && req.query?.SELECT?.where) {
            const where = req.query.SELECT.where;
            for (let i = 0; i < where.length; i++) {
                if (where[i]?.ref?.[0] === 'SalesInquiry' && where[i + 2]?.val) {
                    sKey = String(where[i + 2].val);
                    break;
                }
            }
        }
        if (sKey) {
            const doc = await salesInquiryAdapter.getInquiry(sKey);
            if (doc) {
                const header = { ...(doc.header || doc) };
                header.to_Items = doc.items || [];
                return header;
            }
        }
        return await salesInquiryAdapter.getInquiries(req.query);
    });

    // 2. READ SalesInquiryItems
    srv.on('READ', 'SalesInquiryItems', async (req) => {
        return await salesInquiryAdapter.readFsData(req.query);
    });

    // 3. Action createSalesInquiry
    srv.on('createSalesInquiry', async (req) => {
        const validation = validateCreateSalesInquiryPayload(req.data);
        if (!validation.isValid) {
            req.error(400, validation.message);
            return;
        }

        const authenticatedUser = resolveUserIdentity(req);
        const normalized = normalizeSalesInquiryData(req.data, { user: authenticatedUser });

        let s4Payload;
        try {
            s4Payload = mapToS4InquiryPayload(normalized.header, normalized.items, { user: authenticatedUser });
        } catch (mapErr) {
            req.error(400, `Payload mapping error: ${mapErr.message}`);
            return;
        }

        try {
            const result = await salesInquiryAdapter.createSalesInquiry(s4Payload.header, s4Payload.items, { user: authenticatedUser });
            return result.SalesInquiry || 'Inquiry Created';
        } catch (error) {
            console.error('[SalesInquiryService] Error creating Sales Inquiry:', error.message);
            if (error.SalesInquiry || error.documentNumber || error.name === 'PartialSalesInquiryError') {
                req.error(error.status || 502, error.message);
                return;
            }
            req.error(500, `Failed to create Sales Inquiry: ${error.message}`);
        }
    });

    // 3b. Action createSalesQuote
    srv.on('createSalesQuote', async (req) => {
        // Optional safety block: SAP has lost the stateful quotation session intermittently ("Session not
        // found"), and the create action has persisted a quotation without SaveChanges (2000434).
        if (QUOTATION_CREATION_BLOCKED) {
            req.error(503, QUOTATION_CREATION_BLOCKED_MESSAGE);
            return;
        }

        const sInquiryId = req.data?.SalesInquiry;
        if (!sInquiryId || String(sInquiryId).trim() === '') {
            req.error(400, 'Sales Inquiry number is required to create a Sales Quote');
            return;
        }

        const authenticatedUser = resolveUserIdentity(req);
        try {
            const result = await salesInquiryAdapter.createSalesQuoteFromInquiry(String(sInquiryId).trim(), {
                user: authenticatedUser,
                SalesQuotationType: req.data?.SalesQuotationType,
                SalesQuotationDate: req.data?.SalesQuotationDate,
                BindingPeriodValidityEndDate: req.data?.BindingPeriodValidityEndDate,
                PurchaseOrderByCustomer: req.data?.PurchaseOrderByCustomer,
                CustomerPurchaseOrderDate: req.data?.CustomerPurchaseOrderDate
            });
            return result.SalesQuote || result.SalesQuotation || result;
        } catch (error) {
            console.error('[SalesInquiryService] Error creating Sales Quote from Inquiry:', error.message);
            // SAP business rejections (e.g. SLS_LORD/166) and unconfirmed outcomes ("verify in SAP, do not
            // retry") already carry a message for the user; show it unchanged.
            if (error.name === 'SapQuotationError' || error.status === 400) {
                req.error(error.status || 500, error.message);
                return;
            }
            req.error(error.status || 500, `Failed to create Sales Quote: ${error.message}`);
        }
    });

    // 4. Function getCustomerDefaults
    srv.on('getCustomerDefaults', async (req) => {
        const { Customer, SalesOrganization, DistributionChannel, Division } = req.data || {};
        return await salesInquiryAdapter.getCustomerDefaults(Customer, SalesOrganization, DistributionChannel, Division);
    });

    // 4b. Function getInquiryCreationCapabilities: which quotation-required fields SAP can accept at creation
    srv.on('getInquiryCreationCapabilities', async () => {
        return await salesInquiryAdapter.getInquiryCreationCapabilities();
    });

    // 5. Function getSalesInquiryDefaults
    srv.on('getSalesInquiryDefaults', async () => {
        return await salesInquiryAdapter.getSalesInquiryDefaults();
    });

    // 6. Function getSalesOrderMetrics
    srv.on('getSalesOrderMetrics', async (req) => {
        try {
            return await salesInquiryAdapter.getSalesMetrics();
        } catch (error) {
            return req.error(error.status || 502, error.message);
        }
    });
}

registerSalesInquiryHandlers.registerSalesInquiryHandlers = registerSalesInquiryHandlers;
registerSalesInquiryHandlers.resolveUserIdentity = resolveUserIdentity;

module.exports = registerSalesInquiryHandlers;
