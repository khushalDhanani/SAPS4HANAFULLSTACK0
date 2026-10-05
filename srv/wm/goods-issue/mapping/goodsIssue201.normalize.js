/**
 * goodsIssue201.normalize.js
 * ISOLATED CAP-domain normalization for Movement Type 201 ONLY (Goods Issue to Cost Center).
 * Reads only 201-relevant fields: fills Cost Center; never reads GLAccount / OrderNo / receiving.
 */

const { baseNormalized } = require('./goodsIssue.mapper');

/**
 * @param {Object} data
 * @param {Object} [context]
 * @returns {Object}
 */
function normalizeGoodsIssue201Payload(data, context = {}) {
  if (!data || typeof data !== 'object') return data;
  const n = baseNormalized(data, context, '201');
  n.CostCenter = data.CostCenter ? String(data.CostCenter).trim().toUpperCase() : '';
  return n;
}

module.exports = { normalizeGoodsIssue201Payload };
