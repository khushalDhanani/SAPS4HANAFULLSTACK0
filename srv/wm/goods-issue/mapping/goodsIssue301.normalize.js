/**
 * goodsIssue301.normalize.js
 * ISOLATED CAP-domain normalization for Movement Type 301 ONLY (Plant-to-Plant Transfer).
 * Reads only 301-relevant fields: fills receiving Plant / Storage Location; never reads
 * CostCenter / GLAccount / OrderNo.
 */

const { baseNormalized } = require('./goodsIssue.mapper');

/**
 * @param {Object} data
 * @param {Object} [context]
 * @returns {Object}
 */
function normalizeGoodsIssue301Payload(data, context = {}) {
  if (!data || typeof data !== 'object') return data;
  const n = baseNormalized(data, context, '301');
  n.ReceivingPlant = data.ReceivingPlant ? String(data.ReceivingPlant).trim().toUpperCase() : '';
  n.ReceivingStorageLocation = data.ReceivingStorageLocation ? String(data.ReceivingStorageLocation).trim().toUpperCase() : '';
  return n;
}

module.exports = { normalizeGoodsIssue301Payload };
