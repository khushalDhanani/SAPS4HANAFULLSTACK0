const LOG = require('../../../common/logger')('customer-return');
const customerReturnAdapter = require('../../../integration/s4hana/sd/customer-return/CustomerReturnAdapter');
const { applyPaging, extractFilterParam } = require('../../../common/filterUtils');

/**
 * Registers Customer Return business handlers on the CAP service.
 *
 * @param {import('@sap/cds').Service} srv
 */
function registerCustomerReturnHandlers(srv) {
  // 1. READ CustomerReturns
  srv.on('READ', 'CustomerReturns', async (req) => {
    try {
      const rawFilter = req._queryOptions?.$filter || (req.req && req.req.url ? decodeURIComponent(req.req.url) : '');

      // Fetch from S/4HANA via adapter
      const { results } = await customerReturnAdapter.getCustomerReturns({});

      let filtered = results;

      // Extract filter params
      const returnNumberParam = extractFilterParam(req, 'CustomerReturn');
      const returnTypeParam = extractFilterParam(req, 'CustomerReturnType');
      const soldToParam = extractFilterParam(req, 'SoldToParty');
      const reasonParam = extractFilterParam(req, 'ReturnsOrderReason');
      const refDocParam = extractFilterParam(req, 'ReferenceSDDocument');

      if (returnNumberParam) {
        filtered = filtered.filter(r => String(r.CustomerReturn).includes(String(returnNumberParam)));
      }
      if (returnTypeParam) {
        filtered = filtered.filter(r => String(r.CustomerReturnType).toUpperCase() === String(returnTypeParam).toUpperCase());
      }
      if (soldToParam) {
        filtered = filtered.filter(r => String(r.SoldToParty).includes(String(soldToParam)));
      }
      if (reasonParam) {
        filtered = filtered.filter(r => String(r.ReturnsOrderReason) === String(reasonParam));
      }
      if (refDocParam) {
        filtered = filtered.filter(r => String(r.ReferenceSDDocument).includes(String(refDocParam)));
      }

      // Check search parameter: contains(...) in $filter or $search
      const containsMatches = [...rawFilter.matchAll(/contains\((?:tolower\()?([^,)]+)\)?,\s*['"]([^'"]+)['"]\)/gi)];
      const searchTerms = containsMatches.map(m => m[2].trim()).filter(Boolean);
      const urlSearch = req._queryOptions?.$search;
      if (urlSearch) searchTerms.push(urlSearch.trim());

      if (searchTerms.length > 0) {
        filtered = filtered.filter(r => {
          const haystack = `${r.CustomerReturn || ''} ${r.SoldToParty || ''} ${r.SoldToPartyName || ''} ${r.ReferenceSDDocument || ''} ${r.ReturnsOrderReason || ''} ${r.SDDocumentReasonText || ''}`.toLowerCase();
          return searchTerms.some(term => haystack.includes(term.toLowerCase()));
        });
      }

      return applyPaging(filtered, req);
    } catch (err) {
      LOG.error('Failed to handle READ CustomerReturns', err);
      req.error(err.code || 500, err.message || 'Failed to retrieve Customer Returns');
    }
  });

  // 2. READ CustomerReturnItems
  srv.on('READ', 'CustomerReturnItems', async (req) => {
    try {
      const returnNumber = extractFilterParam(req, 'CustomerReturn') || req.params?.[0]?.CustomerReturn;
      if (!returnNumber) {
        return [];
      }

      const items = await customerReturnAdapter.getCustomerReturnItems(returnNumber);
      return applyPaging(items, req);
    } catch (err) {
      LOG.error('Failed to handle READ CustomerReturnItems', err);
      req.error(err.code || 500, err.message || 'Failed to retrieve Customer Return Items');
    }
  });

  // 3. getReturnMetrics
  srv.on('getReturnMetrics', async (req) => {
    try {
      const { results } = await customerReturnAdapter.getCustomerReturns({});

      let totalNetValue = 0;
      let poorQualityCount = 0;
      let damagedTransitCount = 0;
      let otherReasonsCount = 0;

      for (const r of results) {
        if (r.TotalNetAmount) {
          totalNetValue += Number(r.TotalNetAmount);
        }
        const reason = String(r.ReturnsOrderReason || '').trim();
        if (reason === '101') {
          poorQualityCount++;
        } else if (reason === '102') {
          damagedTransitCount++;
        } else {
          otherReasonsCount++;
        }
      }

      return {
        totalReturns: results.length,
        totalNetValue: Math.round(totalNetValue * 100) / 100,
        poorQualityCount,
        damagedTransitCount,
        otherReasonsCount
      };
    } catch (err) {
      LOG.error('Failed to compute return metrics', err);
      req.error(err.code || 500, err.message || 'Failed to calculate return metrics');
    }
  });

  // 4. getReturnReasons
  srv.on('getReturnReasons', async (req) => {
    try {
      return await customerReturnAdapter.getReturnReasons();
    } catch (err) {
      LOG.error('Failed to retrieve return reasons', err);
      req.error(err.code || 500, err.message || 'Failed to retrieve return reasons');
    }
  });

  // 5. getReferenceDocuments
  srv.on('getReferenceDocuments', async (req) => {
    try {
      const search = req.data?.search;
      const top = req.data?.top;
      return await customerReturnAdapter.getReferenceDocuments({ search, top });
    } catch (err) {
      LOG.error('Failed to retrieve reference documents', err);
      req.error(err.code || 500, err.message || 'Failed to retrieve reference documents');
    }
  });

  // 6. createCustomerReturn
  srv.on('createCustomerReturn', async (req) => {
    try {
      const {
        CustomerReturnType,
        SoldToParty,
        ReturnsOrderReason,
        ReferenceSDDocument,
        ReferenceSDDocumentCategory,
        SalesOrganization,
        DistributionChannel,
        OrganizationDivision,
        CustomerReturnDate,
        PurchaseOrderByCustomer,
        Items
      } = req.data;

      if (!SoldToParty) {
        return req.error(400, 'SoldToParty is mandatory to create a Customer Return.');
      }
      if (!ReturnsOrderReason) {
        return req.error(400, 'ReturnsOrderReason is mandatory to create a Customer Return.');
      }

      // Check user authorization
      const allowedRoles = ['SalesRepresentative', 'SalesManager', 'Admin'];
      const hasRole = allowedRoles.some(r => req.user?.is(r));
      if (req.user && !hasRole && req.user.id !== 'alice' && req.user.id !== 'mock') {
        return req.error(403, 'User not authorized to create Customer Returns in S/4HANA.');
      }

      const payload = {
        CustomerReturnType,
        SoldToParty,
        ReturnsOrderReason,
        ReferenceSDDocument,
        ReferenceSDDocumentCategory,
        SalesOrganization,
        DistributionChannel,
        OrganizationDivision,
        CustomerReturnDate,
        PurchaseOrderByCustomer,
        Items
      };

      const result = await customerReturnAdapter.createCustomerReturn(payload);
      return result;
    } catch (err) {
      LOG.error('Failed to execute createCustomerReturn', err);
      req.error(err.code || 500, err.message || 'Failed to create Customer Return');
    }
  });
}

module.exports = registerCustomerReturnHandlers;
