/**
 * GoodsIssue311Mapper.js
 * ISOLATED S/4HANA payload mapper for Movement Type 311 ONLY (Storage Location Transfer).
 * API_MATERIAL_DOCUMENT_SRV / A_MaterialDocumentHeader deep insert. No MovementType branching.
 *
 * 311 specifics: GoodsMovementCode '04', receiving plant / storage location, reservation linkage,
 * no Cost Center, no G/L account.
 */

const { buildBaseItem, buildHeaderEnvelope } = require('./s4common');

/**
 * @param {Object} data - normalized CAP domain data for a 311 posting
 * @returns {Object} A_MaterialDocumentHeader payload
 */
function mapToMaterialDocumentPayload(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('Data is required for 311 Material Document mapping');
  }

  const item = buildBaseItem(data, '311');
  if (data.ReceivingPlant) {
    item.IssuingOrReceivingPlant = String(data.ReceivingPlant).trim().toUpperCase();
  }
  if (data.ReceivingStorageLocation) {
    item.IssuingOrReceivingStorageLoc = String(data.ReceivingStorageLocation).trim().toUpperCase();
  }

  const headerText = `TP 311 Resv ${data.ReservationNo || ''}`;

  return buildHeaderEnvelope({
    gmCode: '04',
    headerText,
    postingDate: data.PostingDate,
    documentDate: data.DocumentDate,
    item
  });
}

module.exports = { mapToMaterialDocumentPayload };
