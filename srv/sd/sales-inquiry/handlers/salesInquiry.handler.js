const salesInquiryAdapter = require('../../../integration/s4hana/sd/sales-inquiry/SalesInquiryAdapter');
const { validateCreateSalesInquiryPayload } = require('../validation/salesInquiry.validation');
const { normalizeSalesInquiryData } = require('../mapping/salesInquiry.mapper');
const { mapToS4InquiryPayload } = require('../../../integration/s4hana/sd/sales-inquiry/SalesInquiryMapper');

/**
 * Derives authenticated user identity from request context.
 *
 * @param {import('@sap/cds').Request} req
 * @returns {string}
 */
function resolveUserIdentity(req) {
    if (!req) return process.env.S4_USER || 'SYSTEM';

    if (req.user?.attr?.logon_name) {
        return String(req.user.attr.logon_name).trim();
    }
    if (req.user?.id && req.user.id !== 'anonymous') {
        return String(req.user.id).trim();
    }
    if (req.user?.name && req.user.name !== 'anonymous') {
        return String(req.user.name).trim();
    }
    const headerUser = req.headers?.['x-user-id'] || req._?.req?.headers?.['x-user-id'];
    if (headerUser && String(headerUser).trim() !== '') {
        return String(headerUser).trim();
    }

    return process.env.S4_USER || 'SYSTEM';
}

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
            req.error(500, `Failed to create Sales Inquiry: ${error.message}`);
        }
    });

    // 3b. Action createSalesQuote
    srv.on('createSalesQuote', async (req) => {
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
            req.error(500, `Failed to create Sales Quote: ${error.message}`);
        }
    });

    // 4. Function getCustomerDefaults
    srv.on('getCustomerDefaults', async (req) => {
        const { Customer, SalesOrganization, DistributionChannel, Division } = req.data || {};
        return await salesInquiryAdapter.getCustomerDefaults(Customer, SalesOrganization, DistributionChannel, Division);
    });

    // 5. Function getSalesInquiryDefaults
    srv.on('getSalesInquiryDefaults', async () => {
        return await salesInquiryAdapter.getSalesInquiryDefaults();
    });

    // 6. Function getSalesOrderMetrics
    srv.on('getSalesOrderMetrics', async () => {
        return await salesInquiryAdapter.getSalesMetrics();
    });
}

registerSalesInquiryHandlers.registerSalesInquiryHandlers = registerSalesInquiryHandlers;
registerSalesInquiryHandlers.resolveUserIdentity = resolveUserIdentity;

module.exports = registerSalesInquiryHandlers;
