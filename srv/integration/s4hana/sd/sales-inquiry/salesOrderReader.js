'use strict';

const cds = require('@sap/cds');
const LOG = require('../../../../common/logger')('sales-order-reader');
const businessConfigResolver = require('../../../../common/BusinessConfigResolver');
const {
  _cqnOrderByToOData,
  _cqnWhereToODataFilter
} = require('./salesInquiryODataHelper');

/**
 * Retrieves Sales Orders list from S/4HANA worklist service (SD_F1873_SO_WL_SRV).
 *
 * @param {Object} adapter - SalesInquiryAdapter instance
 * @param {Object} query - CAP query
 * @param {Object} [options]
 * @returns {Promise<Array<Object>>}
 */
async function getSalesOrders(adapter, query, options = {}) {
  await adapter.init();
  if (adapter.s4hanaSO) {
    try {
      const execQuery = cds.ql.SELECT.from('SD_F1873_SO_WL_SRV.C_SalesOrderWl_F1873');
      if (query?.SELECT?.columns) execQuery.columns(query.SELECT.columns);
      if (query?.SELECT?.where) execQuery.where(query.SELECT.where);
      if (query?.SELECT?.orderBy && query.SELECT.orderBy.length > 0) {
        execQuery.orderBy(query.SELECT.orderBy);
      } else {
        execQuery.orderBy('CreationDate desc', 'SalesOrder desc');
      }
      if (query?.SELECT?.limit) {
        const rows = query.SELECT.limit.rows?.val ?? query.SELECT.limit.rows ?? 50;
        const offset = query.SELECT.limit.offset?.val ?? query.SELECT.limit.offset ?? 0;
        execQuery.limit(rows, offset);
      } else {
        execQuery.limit(50);
      }
      if (query?.SELECT?.count) {
        execQuery.SELECT.count = true;
      }
      const res = await adapter.s4hanaSO.run(execQuery);
      const list = Array.isArray(res) ? res : (res?.value || res?.d?.results || []);
      if (res?.$count !== undefined) {
        list.$count = res.$count;
      }
      return list;
    } catch (err) {
      LOG.warn('Fetching sales orders from SD_F1873_SO_WL_SRV via CDS failed, falling back to HTTP client:', err.message);
    }
  }

  try {
    const dest = options.destination || await adapter._getDestination(options);
    const executeFn = options.executeHttpRequest || adapter.client._execute;
    const bCount = !!(query?.SELECT?.count || query?._queryOptions?.$count === 'true');

    // 1. Pagination: honour limit.rows and limit.offset if specified
    const limitObj = query?.SELECT?.limit;
    let top = options.top;
    let skip = options.skip;

    if (limitObj) {
      if (limitObj.rows !== undefined) top = limitObj.rows?.val !== undefined ? Number(limitObj.rows.val) : Number(limitObj.rows);
      if (limitObj.offset !== undefined) skip = limitObj.offset?.val !== undefined ? Number(limitObj.offset.val) : Number(limitObj.offset);
    }
    if (top === undefined || top === null || isNaN(top)) {
      top = query?._queryOptions?.$top ? parseInt(query._queryOptions.$top, 10) : 50;
    }
    if (skip === undefined || skip === null || isNaN(skip)) {
      skip = query?._queryOptions?.$skip ? parseInt(query._queryOptions.$skip, 10) : 0;
    }

    // 2. Ordering: honour query.SELECT.orderBy if specified
    const orderByStr = options.orderBy || _cqnOrderByToOData(query?.SELECT?.orderBy) || 'CreationDate desc,SalesOrder desc';

    // 3. Filtering: honour user's filter and refuse to drop it
    const rawWhere = query?.SELECT?.where || query?.where;
    const hasFilterRequirement = !!(options.filter || rawWhere || query?._queryOptions?.$filter);
    let filterStr = options.filter || (query?._queryOptions?.$filter ? query._queryOptions.$filter.trim() : '');
    if (!filterStr && rawWhere) {
      filterStr = _cqnWhereToODataFilter(rawWhere);
    }

    if (hasFilterRequirement && !filterStr) {
      const err = new Error('Cannot safely translate sales order query filter to OData HTTP fallback; refusing to return unfiltered results.');
      err.status = 500;
      throw err;
    }

    const queryParts = [];
    queryParts.push(`$top=${(top !== undefined && top !== null && !isNaN(top) && top > 0) ? top : 50}`);
    if (skip !== undefined && skip !== null && !isNaN(skip) && skip > 0) queryParts.push(`$skip=${skip}`);
    if (orderByStr) queryParts.push(`$orderby=${orderByStr}`);
    if (bCount) queryParts.push('$inlinecount=allpages');
    if (filterStr) queryParts.push(`$filter=${filterStr}`);

    const queryString = queryParts.join('&');
    const res = await executeFn(dest, {
      method: 'get',
      url: `/sap/opu/odata/sap/SD_F1873_SO_WL_SRV/C_SalesOrderWl_F1873${queryString ? `?${queryString}` : ''}`,
      headers: { 'Accept': 'application/json', ...(options.headers || {}) }
    });
    const rawResults = res.data?.d?.results || res.data?.value || [];
    const normalized = rawResults.map(item => {
      const copy = { ...item };
      ['CreationDate', 'SalesOrderDate', 'RequestedDeliveryDate', 'LastChangeDate'].forEach(dateField => {
        if (copy[dateField] && typeof copy[dateField] === 'string') {
          const match = copy[dateField].match(/\/Date\((\d+)\)\//);
          if (match) {
            copy[dateField] = new Date(Number(match[1])).toISOString().split('T')[0];
          }
        }
      });
      if (copy.LastChangeDateTime && typeof copy.LastChangeDateTime === 'string') {
        const match = copy.LastChangeDateTime.match(/\/Date\((\d+)([+-]\d+)?\)\//);
        if (match) {
          copy.LastChangeDateTime = new Date(Number(match[1])).toISOString();
        }
      }
      return copy;
    });
    const rawCount = res.data?.d?.__count ?? res.data?.['@odata.count'];
    if (rawCount !== undefined) {
      normalized.$count = Number(rawCount);
    }
    return normalized;
  } catch (httpErr) {
    LOG.error('Error reading sales orders from SD_F1873_SO_WL_SRV:', httpErr.message);
    const err = new Error(`Sales orders cannot be read: ${httpErr.message}`);
    err.status = httpErr.status || 502;
    throw err;
  }
}

/**
 * Retrieves single Sales Order details by ID directly from S/4HANA worklist service.
 *
 * @param {Object} adapter - SalesInquiryAdapter instance
 * @param {string|number} sId - Sales Order ID
 * @param {Object} [options]
 * @returns {Promise<Object|null>}
 */
async function getSalesOrder(adapter, sId, options = {}) {
  const sKey = String(sId).trim();
  await adapter.init();
  if (adapter.s4hanaSO) {
    try {
      const order = await adapter.s4hanaSO.run(
        cds.ql.SELECT.one.from('SD_F1873_SO_WL_SRV.C_SalesOrderWl_F1873', so => {
          so('*');
          so.to_SalesDocumentItemWl('*');
        }).where({ SalesOrder: sKey })
      );
      if (order) return order;
    } catch (_err) {
      try {
        const order = await adapter.s4hanaSO.run(
          cds.ql.SELECT.one.from('SD_F1873_SO_WL_SRV.C_SalesOrderWl_F1873').where({ SalesOrder: sKey })
        );
        if (order) return order;
      } catch (_innerErr) {
        LOG.warn('Fetching sales order via CDS failed, falling back to HTTP client:', _innerErr.message);
      }
    }
  }

  try {
    const dest = options.destination || await adapter._getDestination(options);
    const executeFn = options.executeHttpRequest || adapter.client._execute;
    const res = await executeFn(dest, {
      method: 'get',
      url: `/sap/opu/odata/sap/SD_F1873_SO_WL_SRV/C_SalesOrderWl_F1873(%27${sKey}%27)?$expand=to_SalesDocumentItemWl`,
      headers: { 'Accept': 'application/json', ...(options.headers || {}) }
    });
    return res.data?.d || res.data || null;
  } catch (httpErr) {
    if (httpErr.status === 404 || httpErr.statusCode === 404) return null;
    LOG.error(`Error reading sales order ${sKey} from SD_F1873_SO_WL_SRV:`, httpErr.message);
    const err = new Error(`Sales order ${sKey} cannot be read: ${httpErr.message}`);
    err.status = httpErr.status || 502;
    throw err;
  }
}

/**
 * Provides standard Sales Order creation defaults.
 *
 * @param {Object} adapter - SalesInquiryAdapter instance
 * @param {Object} [context]
 * @returns {Promise<Object>}
 */
async function getSalesOrderDefaults(adapter, context = {}) {
  const today = new Date().toISOString().split('T')[0];
  const plant = (context && context.plant) || '1120';
  let cfg = {};
  try {
    cfg = await (adapter.resolver || businessConfigResolver).resolve({
      plant,
      flow: 'sd',
      fields: ['salesOrganization', 'distributionChannel', 'division', 'currency', 'orderType'],
      isTrusted: true
    });
  } catch (_) {
    cfg = {
      orderType: 'ZDOM',
      salesOrganization: '1000',
      distributionChannel: '10',
      division: '52',
      currency: 'INR'
    };
  }
  return {
    SalesOrderType: cfg.orderType || 'ZDOM',
    SalesOrganization: cfg.salesOrganization || '1000',
    DistributionChannel: cfg.distributionChannel || '10',
    OrganizationDivision: cfg.division || '52',
    Plant: plant,
    RequestedDeliveryDate: '',
    SalesOrderDate: today,
    CreationDate: today,
    TransactionCurrency: cfg.currency || 'INR',
    derived: true
  };
}

/**
 * Executes CheckATP FunctionImport in LORD_ODATA_ORDER_SRV for a given document and item.
 *
 * @param {Object} adapter - SalesInquiryAdapter instance
 * @param {string} salesOrderID - Sales document number (10 chars, e.g. "0005000461")
 * @param {string} itemID - Item number (6 chars, e.g. "000010")
 * @param {Object} [options] - Destination / execution overrides
 * @returns {Promise<{ RequestedQty: number, ConfirmedQty: number, ReqDlvDate: string|null, CnfDlvDate: string|null, SalesUnit: string }>}
 */
async function checkATP(adapter, salesOrderID, itemID, options = {}) {
  let dest;
  try {
    dest = options.destination || await adapter._getDestination(options);
  } catch (e) {
    const err = new Error(`ATP check is not available: ${e.message}`);
    err.status = 503;
    throw err;
  }

  const servicePath = '/sap/opu/odata/sap/LORD_ODATA_ORDER_SRV';
  const executeFn = options.executeHttpRequest || adapter.client._execute;

  const sDocId = String(salesOrderID || '').padStart(10, '0');
  const sItemId = String(itemID || '10').padStart(6, '0');
  const url = `${servicePath}/CheckATP?SalesOrderID='${encodeURIComponent(sDocId)}'&ItemID='${encodeURIComponent(sItemId)}'`;

  let res;
  try {
    res = await executeFn(dest, {
      method: 'post',
      url,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    }, { fetchCsrfToken: options.fetchCsrfToken !== undefined ? options.fetchCsrfToken : true });
  } catch (err) {
    const sapMsg = err.response?.data?.error?.message?.value ||
      err.response?.data?.error?.innererror?.errordetails?.[0]?.message ||
      err.message;
    const e = new Error(`ATP check failed for document ${sDocId} item ${sItemId}: ${sapMsg}`);
    e.status = err.response?.status || 502;
    throw e;
  }

  const data = (res?.data?.d?.CheckATP || res?.data?.d || res?.data) || {};
  return {
    RequestedQty: parseFloat(data.RequestedQty) || 0,
    ConfirmedQty: parseFloat(data.ConfirmedQty) || 0,
    ReqDlvDate: data.ReqDlvDate || null,
    CnfDlvDate: data.CnfDlvDate || null,
    SalesUnit: data.SalesUnit || ''
  };
}

module.exports = {
  getSalesOrders,
  getSalesOrder,
  getSalesOrderDefaults,
  checkATP
};
