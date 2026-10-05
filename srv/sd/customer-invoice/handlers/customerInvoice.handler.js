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
      const where = req.query?.SELECT?.where;
      const rawFilter = req._queryOptions?.$filter || (req.req && req.req.url ? decodeURIComponent(req.req.url) : '');

      // Fetch from S/4HANA via adapter
      const { results } = await customerInvoiceAdapter.getBillingDocuments({});

      let filtered = results;

      // Extract filter params
      const acctStatusParam = extractFilterParam(req, 'AccountingTransferStatus');
      const isCancelledParam = extractFilterParam(req, 'BillingDocumentIsCancelled');
      const billingDocParam = extractFilterParam(req, 'BillingDocument');

      if (billingDocParam) {
        filtered = filtered.filter(i => String(i.BillingDocument).includes(String(billingDocParam)));
      }

      // AccountingTransferStatus: check for NE 'C' (Pending) or explicit EQ
      const hasAcctStatusNE = rawFilter.includes("AccountingTransferStatus ne 'C'") || rawFilter.includes('AccountingTransferStatus ne "C"') ||
        (Array.isArray(where) && where.some((t, idx) => (t === 'AccountingTransferStatus' || (t?.ref && t.ref[0] === 'AccountingTransferStatus')) && (where[idx + 1] === '!=' || where[idx + 1] === '<>') && (where[idx + 2]?.val === 'C' || where[idx + 2] === 'C')));

      if (hasAcctStatusNE) {
        filtered = filtered.filter(i => {
          const s = String(i.AccountingTransferStatus || '').toUpperCase();
          const cat = String(i.SDDocumentCategory || '').toUpperCase();
          const isCanc = Boolean(i.BillingDocumentIsCancelled) || s === 'E' || cat === 'N';
          return !isCanc && s !== 'C' && s !== 'H' && s !== 'D';
        });
      } else if (acctStatusParam !== null && acctStatusParam !== undefined) {
        filtered = filtered.filter(i => String(i.AccountingTransferStatus || '').toUpperCase() === String(acctStatusParam).toUpperCase());
      }

      // BillingDocumentIsCancelled
      if (isCancelledParam !== null && isCancelledParam !== undefined) {
        const targetBool = String(isCancelledParam).toLowerCase() === 'true';
        filtered = filtered.filter(i => {
          const isCanc = Boolean(i.BillingDocumentIsCancelled) || String(i.AccountingTransferStatus).toUpperCase() === 'E' || String(i.SDDocumentCategory).toUpperCase() === 'N';
          return isCanc === targetBool;
        });
      } else if (rawFilter.includes('BillingDocumentIsCancelled eq true')) {
        filtered = filtered.filter(i => Boolean(i.BillingDocumentIsCancelled) || String(i.AccountingTransferStatus).toUpperCase() === 'E' || String(i.SDDocumentCategory).toUpperCase() === 'N');
      } else if (rawFilter.includes('BillingDocumentIsCancelled eq false')) {
        filtered = filtered.filter(i => !i.BillingDocumentIsCancelled && String(i.AccountingTransferStatus).toUpperCase() !== 'E' && String(i.SDDocumentCategory).toUpperCase() !== 'N');
      }

      // Check search parameter: contains(...) in $filter or $search
      const containsMatches = [...rawFilter.matchAll(/contains\((?:tolower\()?([^,)]+)\)?,\s*['"]([^'"]+)['"]\)/gi)];
      if (containsMatches.length > 0) {
        const terms = [...new Set(containsMatches.map(m => m[2].trim().toLowerCase()).filter(Boolean))];
        if (terms.length > 0) {
          filtered = filtered.filter(i => {
            const text = `${i.BillingDocument} ${i.SoldToParty} ${i.SoldToPartyFullName} ${i.BillingDocumentType}`.toLowerCase();
            return terms.some(t => text.includes(t));
          });
        }
      }

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
      const cancelledCount = results.filter(i =>
        Boolean(i.BillingDocumentIsCancelled) ||
        String(i.AccountingTransferStatus).toUpperCase() === 'E' ||
        String(i.SDDocumentCategory).toUpperCase() === 'N'
      ).length;
      const transferredCount = results.filter(i =>
        !i.BillingDocumentIsCancelled &&
        String(i.AccountingTransferStatus).toUpperCase() !== 'E' &&
        String(i.SDDocumentCategory).toUpperCase() !== 'N' &&
        (String(i.AccountingTransferStatus).toUpperCase() === 'C' || String(i.AccountingTransferStatus).toUpperCase() === 'H')
      ).length;
      const pendingAccountingCount = results.filter(i =>
        !i.BillingDocumentIsCancelled &&
        String(i.AccountingTransferStatus).toUpperCase() !== 'E' &&
        String(i.SDDocumentCategory).toUpperCase() !== 'N' &&
        String(i.AccountingTransferStatus).toUpperCase() !== 'C' &&
        String(i.AccountingTransferStatus).toUpperCase() !== 'H' &&
        String(i.AccountingTransferStatus).toUpperCase() !== 'D'
      ).length;

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
      if (current?.BillingDocumentIsCancelled || current?.AccountingTransferStatus === 'E' || current?.SDDocumentCategory === 'N') {
        return req.error(400, `Cannot release cancelled billing document ${doc} to accounting.`);
      }
      if (current?.AccountingTransferStatus === 'D') {
        return req.error(400, `Billing document ${doc} is a Pro Forma Invoice (Status D) and is not relevant for financial accounting.`);
      }
      if (current?.AccountingTransferStatus === 'A') {
        return req.error(400, `Billing document ${doc} has an active Posting Block in SAP S/4HANA (Status A). The posting block must be removed in SAP (transaction VF02) before it can be released to accounting.`);
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
      if (current?.BillingDocumentIsCancelled || current?.AccountingTransferStatus === 'E' || current?.SDDocumentCategory === 'N') {
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
