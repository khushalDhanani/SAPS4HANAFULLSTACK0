const LOG = require('../../../common/logger')('sales-order');
const salesInquiryAdapter = require('../../../integration/s4hana/sd/sales-inquiry/SalesInquiryAdapter');
const { validateCreateSalesOrderPayload } = require('../../sales-inquiry/validation/salesInquiry.validation');
const { normalizeSalesDocumentData } = require('../../sales-inquiry/mapping/salesInquiry.mapper');
const { mapToS4OrderPayload } = require('../../../integration/s4hana/sd/sales-inquiry/SalesInquiryMapper');
const { resolveUserIdentity } = require('../../../auth/userIdentity');
const { extractFilterParam } = require('../../../common/filterUtils');

/**
 * Registers Sales Order business handlers on the CAP service.
 *
 * @param {import('@sap/cds').Service} srv
 */
function registerSalesOrderHandlers(srv) {
    // 1. READ SalesOrders
    srv.on('READ', 'SalesOrders', async (req) => {
        const sKey = extractFilterParam(req, 'SalesOrder');
        if (sKey) {
            try {
                const doc = await salesInquiryAdapter.getSalesOrder(sKey);
                if (doc) {
                    return doc;
                }
                return req.error(404, `Sales Order ${sKey} not found`);
            } catch (err) {
                return req.error(err.status || 500, err.message);
            }
        }
        try {
            return await salesInquiryAdapter.getSalesOrders(req.query);
        } catch (err) {
            return req.error(err.status || 500, err.message);
        }
    });

    // 2. READ SalesOrderItems
    srv.on('READ', 'SalesOrderItems', async (req) => {
        try {
            return await salesInquiryAdapter.readSoData(req.query);
        } catch (err) {
            return req.error(err.status || 500, err.message);
        }
    });

    // 3. Action createSalesOrder
    srv.on('createSalesOrder', async (req) => {
        const validation = validateCreateSalesOrderPayload(req.data);
        if (!validation.isValid) {
            req.error(400, validation.message);
            return;
        }

        const authenticatedUser = resolveUserIdentity(req);
        const normalized = normalizeSalesDocumentData(req.data, { user: authenticatedUser, isOrder: true });

        let s4Payload;
        try {
            s4Payload = mapToS4OrderPayload(normalized.header, normalized.items, { user: authenticatedUser });
        } catch (mapErr) {
            req.error(400, `Payload mapping error: ${mapErr.message}`);
            return;
        }

        try {
            const result = await salesInquiryAdapter.createSalesOrder(s4Payload.header, s4Payload.items, { user: authenticatedUser });
            return result.SalesOrder || result.SalesDocument || 'Order Created';
        } catch (error) {
            LOG.error('Error creating Sales Order:', error.message);
            if (error.SalesOrder || error.SalesDocument || error.documentNumber) {
                req.error(error.status || 502, error.message);
                return;
            }
            req.error(error.status || 500, `Failed to create Sales Order: ${error.message}`);
        }
    });

    // 4. Function getCustomerDefaults
    srv.on('getCustomerDefaults', async (req) => {
        const { Customer, SalesOrganization, DistributionChannel, Division } = req.data || {};
        return await salesInquiryAdapter.getCustomerDefaults(Customer, SalesOrganization, DistributionChannel, Division);
    });

    // 5. Function getSalesOrderDefaults
    srv.on('getSalesOrderDefaults', async () => {
        return await salesInquiryAdapter.getSalesOrderDefaults();
    });

    // 6. Function getSalesOrderMetrics
    srv.on('getSalesOrderMetrics', async (req) => {
        try {
            return await salesInquiryAdapter.getSalesMetrics();
        } catch (error) {
            LOG.error('Error fetching sales order metrics:', error.message);
            if (req && typeof req.error === 'function') {
                return req.error(error.status || 502, error.message);
            }
            throw error;
        }
    });

    // 7. Action checkATP
    srv.on('checkATP', async (req) => {
        const { SalesOrderID, ItemID } = req.data || {};
        if (!SalesOrderID || String(SalesOrderID).trim() === '') {
            req.error(400, 'Sales document number (SalesOrderID) is required to check ATP availability');
            return;
        }
        try {
            return await salesInquiryAdapter.checkATP(SalesOrderID, ItemID);
        } catch (error) {
            LOG.error('ATP check error:', error.message);
            req.error(error.status || 500, error.message);
        }
    });
}

module.exports = registerSalesOrderHandlers;
