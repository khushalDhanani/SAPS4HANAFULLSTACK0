'use strict';

const cds = require('@sap/cds');
const LOG = require('../../../../common/logger')('sales-inquiry-worklist-reader');

/**
 * Retrieves Sales Inquiries list from S/4HANA worklist service.
 *
 * @param {Object} adapter - SalesInquiryAdapter instance
 * @param {Object} query - CAP query
 * @returns {Promise<Array<Object>>}
 */
async function getInquiries(adapter, query) {
  await adapter.init();
  if (!adapter.s4hanaWL) {
    const err = new Error('Sales inquiries cannot be read: the SAP SD service SD_F2370_INQY_WL_SRV is not connected.');
    err.status = 503;
    throw err;
  }
  try {
    const execQuery = cds.ql.SELECT.from('SD_F2370_INQY_WL_SRV.C_InquiryWL_F2370');
    if (query?.SELECT?.columns) execQuery.columns(query.SELECT.columns);
    if (query?.SELECT?.where) execQuery.where(query.SELECT.where);
    if (query?.SELECT?.orderBy && query.SELECT.orderBy.length > 0) {
      execQuery.orderBy(query.SELECT.orderBy);
    } else {
      execQuery.orderBy('CreationDate desc', 'SalesInquiry desc');
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
    const res = await adapter.s4hanaWL.run(execQuery);
    const list = Array.isArray(res) ? res : (res?.value || res?.d?.results || []);
    if (res?.$count !== undefined) {
      list.$count = res.$count;
    }
    return list;
  } catch (err) {
    LOG.error('Error fetching inquiries from SD_F2370_INQY_WL_SRV:', err.message);
    if (!err.status) err.status = 502;
    throw err;
  }
}

/**
 * Sales order / inquiry counts read live from SAP S/4HANA:
 * open orders/inquiries (OverallSDProcessStatus ne 'C') and all orders/inquiries.
 *
 * @param {Object} adapter - SalesInquiryAdapter instance
 * @param {Object} [options] - destination / executeHttpRequest / headers overrides
 * @returns {Promise<Object>}
 */
async function getSalesMetrics(adapter, options = {}) {
  const isOrder = options.entity !== 'inquiry';
  const docLabel = isOrder ? 'Sales order' : 'Sales inquiry';
  const serviceName = isOrder ? 'SD_F1873_SO_WL_SRV' : 'SD_F2370_INQY_WL_SRV';
  const servicePath = isOrder ? '/sap/opu/odata/sap/SD_F1873_SO_WL_SRV' : '/sap/opu/odata/sap/SD_F2370_INQY_WL_SRV';
  const entitySet = isOrder ? 'C_SalesOrderWl_F1873' : 'C_InquiryWL_F2370';

  let dest;
  try {
    dest = options.destination || await adapter._getDestination(options);
  } catch (e) {
    const err = new Error(`${docLabel} metrics are not available: ${e.message}`);
    err.status = 503;
    throw err;
  }

  const executeFn = options.executeHttpRequest || adapter.client._execute;
  const request = (query) => executeFn(dest, {
    method: 'get',
    url: `${servicePath}/${entitySet}?${query}`,
    headers: { 'Accept': 'application/json', ...(options.headers || {}) }
  });
  const countOf = (res) => {
    const raw = res?.data?.d?.__count ?? res?.data?.['@odata.count'];
    const n = Number(raw);
    return raw !== undefined && raw !== null && String(raw).trim() !== '' && Number.isInteger(n) && n >= 0 ? n : null;
  };

  let resOpen;
  let resTotal;
  try {
    [resOpen, resTotal] = await Promise.all([
      request("$inlinecount=allpages&$top=1&$filter=OverallSDProcessStatus ne 'C'"),
      request('$inlinecount=allpages&$top=1')
    ]);
  } catch (e) {
    const err = new Error(`${docLabel} metrics could not be read from ${serviceName}: ${e.message}`);
    err.status = 502;
    throw err;
  }

  const openOrdersCount = countOf(resOpen);
  const totalOrdersCount = countOf(resTotal);
  if (openOrdersCount === null || totalOrdersCount === null) {
    const err = new Error(`${docLabel} metrics are not available: ${serviceName} returned no count.`);
    err.status = 502;
    throw err;
  }
  if (isOrder) {
    return { openOrdersCount, totalOrdersCount };
  }
  return {
    openInquiriesCount: openOrdersCount,
    totalInquiriesCount: totalOrdersCount,
    openOrdersCount,
    totalOrdersCount
  };
}

/**
 * Retrieves Sales Inquiry metrics from SD_F2370_INQY_WL_SRV / C_InquiryWL_F2370.
 *
 * @param {Object} adapter - SalesInquiryAdapter instance
 * @param {Object} [options]
 * @returns {Promise<Object>}
 */
async function getInquiryMetrics(adapter, options = {}) {
  return getSalesMetrics(adapter, { ...options, entity: 'inquiry' });
}

module.exports = {
  getInquiries,
  getSalesMetrics,
  getInquiryMetrics
};
