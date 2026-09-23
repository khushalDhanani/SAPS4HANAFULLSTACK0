const LOG = require('../../../common/logger')('customer-invoice');
const customerInvoiceAdapter = require('../../../integration/s4hana/sd/customer-invoice/CustomerInvoiceAdapter');
const { applyPaging, extractFilterParam } = require('../../../common/filterUtils');

/**
 * Registers Customer Invoice business handlers on the CAP service.
 *
 * @param {import('@sap/cds').Service} srv
 */
function registerCustomerInvoiceHandlers(srv) {
  // 1. READ CustomerInvoices
  srv.on('READ', 'CustomerInvoices', async (req) => {
    try {
      // Extract filter params
      const acctStatusParam = extractFilterParam(req, 'AccountingTransferStatus');
      const isCancelledParam = extractFilterParam(req, 'BillingDocumentIsCancelled');
      const billingDocParam = extractFilterParam(req, 'BillingDocument');

      // Fetch from S/4HANA via adapter
      const { results } = await customerInvoiceAdapter.getBillingDocuments({});

      let filtered = results;

      if (billingDocParam) {
        filtered = filtered.filter(i => String(i.BillingDocument).includes(String(billingDocParam)));
      }
      if (acctStatusParam !== null && acctStatusParam !== undefined) {
        filtered = filtered.filter(i => String(i.AccountingTransferStatus || '') === String(acctStatusParam));
      }
      if (isCancelledParam !== null && isCancelledParam !== undefined) {
        const targetBool = String(isCancelledParam).toLowerCase() === 'true';
        filtered = filtered.filter(i => Boolean(i.BillingDocumentIsCancelled) === targetBool);
      }

      // Check search parameter if provided
      if (req.query?.SELECT?.search) {
        const terms = req.query.SELECT.search.map(s => String(s.val || '').toLowerCase()).filter(Boolean);
        if (terms.length > 0) {
          filtered = filtered.filter(i => {
            const text = `${i.BillingDocument} ${i.SoldToParty} ${i.SoldToPartyFullName} ${i.BillingDocumentType}`.toLowerCase();
            return terms.every(t => text.includes(t));
          });
        }
      }

      return applyPaging(filtered, req);
    } catch (err) {
      LOG.error(`Failed to read customer invoices: ${err.message}`);
      return req.error(err.status || 500, err.message);
    }
  });

  // 2. Function getInvoiceMetrics
  srv.on('getInvoiceMetrics', async (req) => {
    try {
      const { results } = await customerInvoiceAdapter.getBillingDocuments({});
      const totalInvoices = results.length;
      const cancelledCount = results.filter(i => Boolean(i.BillingDocumentIsCancelled)).length;
      const transferredCount = results.filter(i => !i.BillingDocumentIsCancelled && String(i.AccountingTransferStatus).toUpperCase() === 'C').length;
      const pendingAccountingCount = results.filter(i => !i.BillingDocumentIsCancelled && String(i.AccountingTransferStatus).toUpperCase() !== 'C').length;

      return {
        totalInvoices,
        pendingAccountingCount,
        transferredCount,
        cancelledCount
      };
    } catch (err) {
      LOG.error(`Failed to get invoice metrics: ${err.message}`);
      return req.error(err.status || 500, err.message);
    }
  });

  // 3. Action releaseInvoiceToAccounting
  srv.on('releaseInvoiceToAccounting', async (req) => {
    const { BillingDocument } = req.data || {};
    const doc = String(BillingDocument || '').trim();

    if (!doc) {
      return req.error(400, 'BillingDocument is required to release invoice to accounting.');
    }

    try {
      // Check current invoice status to guard against redundant release
      const current = await customerInvoiceAdapter.getBillingDocument(doc);
      if (current?.BillingDocumentIsCancelled) {
        return req.error(400, `Cannot release cancelled billing document ${doc} to accounting.`);
      }
      if (current?.AccountingTransferStatus === 'C' && current?.AccountingDocument) {
        return {
          BillingDocument: doc,
          AccountingDocument: current.AccountingDocument,
          FiscalYear: current.FiscalYear || '',
          AccountingTransferStatus: 'C',
          Success: true,
          Message: `Billing document ${doc} is already released to accounting (Document ${current.AccountingDocument}).`
        };
      }

      return await customerInvoiceAdapter.postBillingDocumentToAccounting({ billingDocument: doc }, req);
    } catch (err) {
      LOG.error(`releaseInvoiceToAccounting failed for ${doc}: ${err.message}`);
      return req.error(err.status || 500, err.message);
    }
  });

  // 4. Action cancelBillingDocument
  srv.on('cancelBillingDocument', async (req) => {
    const { BillingDocument } = req.data || {};
    const doc = String(BillingDocument || '').trim();

    if (!doc) {
      return req.error(400, 'BillingDocument is required to cancel billing document.');
    }

    try {
      const current = await customerInvoiceAdapter.getBillingDocument(doc);
      if (current?.BillingDocumentIsCancelled) {
        return req.error(400, `Billing document ${doc} is already cancelled.`);
      }

      return await customerInvoiceAdapter.cancelBillingDocument({ billingDocument: doc }, req);
    } catch (err) {
      LOG.error(`cancelBillingDocument failed for ${doc}: ${err.message}`);
      return req.error(err.status || 500, err.message);
    }
  });
}

module.exports = registerCustomerInvoiceHandlers;
