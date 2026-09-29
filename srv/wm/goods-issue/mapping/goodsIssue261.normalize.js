/**
 * goodsIssue261.normalize.js
 * ISOLATED CAP-domain normalization for Movement Type 261 ONLY (Goods Issue for Order/Reservation).
 * Reads only 261-relevant fields: fills OrderNo + optional GLAccount; never reads CostCenter / receiving.
 */

const { baseNormalized } = require('./goodsIssue.mapper');

/**
 * @param {Object} data
 * @param {Object} [context]
 * @returns {Object}
 */
function normalizeGoodsIssue261Payload(data, context = {}) {
  if (!data || typeof data !== 'object') return data;
  const n = baseNormalized(data, context, '261');
  n.OrderNo = data.OrderNo ? String(data.OrderNo).trim() : '';
  n.GLAccount = data.GLAccount ? String(data.GLAccount).trim() : '';
  return n;
}

module.exports = { normalizeGoodsIssue261Payload };
