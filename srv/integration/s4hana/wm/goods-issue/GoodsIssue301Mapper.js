/**
 * GoodsIssue301Mapper.js
 * ISOLATED S/4HANA payload mapper for Movement Type 301 ONLY (Plant-to-Plant Transfer).
 * API_MATERIAL_DOCUMENT_SRV / A_MaterialDocumentHeader deep insert. No MovementType branching.
 *
 * 301 specifics: GoodsMovementCode '04', receiving plant / storage location, reservation linkage,
 * no Cost Center, no G/L account.
 */

const { buildBaseItem, buildHeaderEnvelope } = require('./s4common');

/**
 * @param {Object} data - normalized CAP domain data for a 301 posting
 * @returns {Object} A_MaterialDocumentHeader payload
 */
function mapToMaterialDocumentPayload(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('Data is required for 301 Material Document mapping');
  }

  const item = buildBaseItem(data, '301');
  if (data.ReceivingPlant) {
    item.IssuingOrReceivingPlant = String(data.ReceivingPlant).trim().toUpperCase();
  }
  if (data.ReceivingStorageLocation) {
    item.IssuingOrReceivingStorageLoc = String(data.ReceivingStorageLocation).trim().toUpperCase();
  }

  const headerText = `TP 301 Resv ${data.ReservationNo || ''}`;

  return buildHeaderEnvelope({
    gmCode: '04',
    headerText,
    postingDate: data.PostingDate,
    documentDate: data.DocumentDate,
    item
  });
}

module.exports = { mapToMaterialDocumentPayload };
