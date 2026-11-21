'use strict';

/**
 * GoodsReceiptBarcodeMatcher
 *
 * Sequentially evaluates scanned barcodes across priority tiers:
 *   - Tier 0: Handling Unit (RFC)
 *   - Tier 1: Inbound Delivery (OData)
 *   - Tier 2: Purchase Order (OData)
 *   - Tier 3: Batch (OData)
 *   - Tier 4: Material (OData)
 *   - Tier 5: Production Order (OData)
 *   - Tier 6: Active Deliveries Fallback (OData)
 */

const {
  matchHandlingUnit,
  matchInboundDelivery,
  matchPurchaseOrder,
} = require('./GoodsReceiptDocumentMatcher');

const {
  matchBatch,
  matchMaterial,
  matchProductionOrder,
  matchDeliveryFallback,
} = require('./GoodsReceiptObjectMatcher');

/**
 * Matches a scanned barcode string against active SAP records.
 * @param {object} adapter
 * @param {string} sCleanScan
 * @returns {Promise<object|null>}
 */
async function matchBarcode(adapter, sCleanScan) {
  const huMatch = await matchHandlingUnit(adapter, sCleanScan);
  if (huMatch) return huMatch;

  const inbMatch = await matchInboundDelivery(adapter, sCleanScan);
  if (inbMatch) return inbMatch;

  const poMatch = await matchPurchaseOrder(adapter, sCleanScan);
  if (poMatch) return poMatch;

  const batchMatch = await matchBatch(adapter, sCleanScan);
  if (batchMatch) return batchMatch;

  const matMatch = await matchMaterial(adapter, sCleanScan);
  if (matMatch) return matMatch;

  const prodMatch = await matchProductionOrder(adapter, sCleanScan);
  if (prodMatch) return prodMatch;

  const fallbackMatch = await matchDeliveryFallback(adapter, sCleanScan);
  if (fallbackMatch) return fallbackMatch;

  return null;
}

module.exports = {
  matchBarcode,
};
