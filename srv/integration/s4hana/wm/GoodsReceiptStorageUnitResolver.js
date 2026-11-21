'use strict';

/**
 * GoodsReceiptStorageUnitResolver
 *
 * Resolves scanned barcodes across active S/4HANA records (Storage Units, Handling Units,
 * Inbound Deliveries, Purchase Orders, Materials, Batches, and Production Orders),
 * and enriches the resolved record with authentic SAP master data and quantities.
 */

const s4Config = require('../s4Config');
const { matchBarcode } = require('./GoodsReceiptBarcodeMatcher');
const { enrichStorageUnitItem } = require('./GoodsReceiptItemEnricher');

/**
 * Resolves a scanned barcode or storage unit number against SAP S/4HANA.
 * @param {object} adapter
 * @param {string} suNumber
 * @returns {Promise<object>}
 */
async function resolveStorageUnit(adapter, suNumber) {
  if (!suNumber || typeof suNumber !== 'string') {
    throw new Error('Storage Unit Number is required.');
  }

  const sCleanScan = suNumber.trim();
  if (!sCleanScan) {
    throw new Error('Storage Unit Number is required.');
  }

  const scanData = await matchBarcode(adapter, sCleanScan);

  // --- TIER 7: Genuine Non-Existent Object / Validation Error ---
  if (!scanData || !scanData.scannedType) {
    const err = new Error(
      `Validation Error: Scanned barcode '${sCleanScan}' was evaluated across active Inbound Deliveries, Purchase Orders, Materials, Batches, and Storage Units in SAP S/4HANA (Client ${s4Config.getClient()}) and does not exist in any active record. Please scan a valid SAP barcode or use Value Help to select an open inbound record.`
    );
    err.statusCode = 404;
    throw err;
  }

  return enrichStorageUnitItem(adapter, sCleanScan, scanData);
}

module.exports = {
  resolveStorageUnit,
};
