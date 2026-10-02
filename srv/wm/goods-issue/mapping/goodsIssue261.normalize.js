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
  n.OrderNo = String(data.OrderNo || data.OrderID || '').trim();
  n.GLAccount = data.GLAccount ? String(data.GLAccount).trim() : '';

  const rawSu = Array.isArray(data.StorageUnits) && data.StorageUnits.length > 0
    ? data.StorageUnits
    : data.StorageUnit
      ? [data.StorageUnit]
      : [];
  n.StorageUnits = rawSu.map((s) => String(s || '').trim()).filter(Boolean);

  return n;
}

module.exports = { normalizeGoodsIssue261Payload };
