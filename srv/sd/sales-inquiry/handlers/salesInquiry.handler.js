const cds = require('@sap/cds');
const LOG = require('../../../common/logger')('sales-inquiry');
const salesInquiryAdapter = require('../../../integration/s4hana/sd/sales-inquiry/SalesInquiryAdapter');
const { validateCreateSalesInquiryPayload } = require('../validation/salesInquiry.validation');
const { normalizeSalesInquiryData } = require('../mapping/salesInquiry.mapper');
const { mapToS4InquiryPayload } = require('../../../integration/s4hana/sd/sales-inquiry/SalesInquiryMapper');
const { resolveUserIdentity } = require('../../../auth/userIdentity');
const { extractFilterParam } = require('../../../common/filterUtils');

/**
 * Registers Sales Inquiry business handlers on the CAP service.
 *
 * @param {import('@sap/cds').Service} srv
 */
function registerSalesInquiryHandlers(srv) {
    // 1. READ SalesInquiries
    srv.on('READ', 'SalesInquiries', async (req) => {
        const sKey = extractFilterParam(req, 'SalesInquiry');
        if (sKey) {
            try {
                const doc = await salesInquiryAdapter.getInquiry(sKey);
                if (doc) {
                    const header = { ...(doc.header || doc) };
                    header.to_Items = doc.items || [];
                    return header;
                }
                return req.error(404, `Sales Inquiry ${sKey} not found`);
            } catch (err) {
                return req.error(err.status || 500, err.message);
            }
        }
        try {
            return await salesInquiryAdapter.getInquiries(req.query);
        } catch (err) {
            return req.error(err.status || 500, err.message);
        }
    });

    // 2. READ SalesInquiryItems
    srv.on('READ', 'SalesInquiryItems', async (req) => {
        try {
            return await salesInquiryAdapter.readFsData(req.query);
        } catch (err) {
            return req.error(err.status || 500, err.message);
        }
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
            LOG.error('Error creating Sales Inquiry:', error.message);
            if (error.SalesInquiry || error.documentNumber || error.name === 'PartialSalesInquiryError') {
                req.error(error.status || 502, error.message);
                return;
            }
            req.error(500, `Failed to create Sales Inquiry: ${error.message}`);
        }
    });

    // 4. Function getCustomerDefaults
    srv.on('getCustomerDefaults', async (req) => {
        const { Customer, SalesOrganization, DistributionChannel, Division } = req.data || {};
        return await salesInquiryAdapter.getCustomerDefaults(Customer, SalesOrganization, DistributionChannel, Division);
    });

    // 4b. Function getInquiryCreationCapabilities: which incompletion procedure Z1 fields SAP can accept at creation
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
            return await salesInquiryAdapter.getSalesMetrics({ entity: 'inquiry' });
        } catch (error) {
            LOG.error('Error fetching sales inquiry metrics:', error.message);
            if (req && typeof req.error === 'function') {
                return req.error(error.status || 502, error.message);
            }
            throw error;
        }
    });
}

registerSalesInquiryHandlers.registerSalesInquiryHandlers = registerSalesInquiryHandlers;
registerSalesInquiryHandlers.resolveUserIdentity = resolveUserIdentity;

module.exports = registerSalesInquiryHandlers;
