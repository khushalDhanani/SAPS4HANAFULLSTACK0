/**
 * GoodsIssue261Mapper.js
 * ISOLATED S/4HANA payload mapper for Movement Type 261 ONLY (Goods Issue for Order / Reservation).
 * API_MATERIAL_DOCUMENT_SRV / A_MaterialDocumentHeader deep insert. No MovementType branching.
 *
 * 261 specifics: GoodsMovementCode '03', reservation linkage, optional G/L account,
 * no Cost Center, no receiving plant/storage location.
 */

const { buildBaseItem, buildHeaderEnvelope } = require('./s4common');

/**
 * @param {Object} data - normalized CAP domain data for a 261 posting
 * @returns {Object} A_MaterialDocumentHeader payload
 */
function mapToMaterialDocumentPayload(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('Data is required for 261 Material Document mapping');
  }

  const item = buildBaseItem(data, '261');
  if (data.GLAccount && String(data.GLAccount).trim() !== '') {
    item.GLAccount = String(data.GLAccount).trim();
  }

  const headerText = data.ReservationNo
    ? `GI Resv ${data.ReservationNo}`
    : `GI Order ${data.OrderNo || data.OrderID || ''}`;

  return buildHeaderEnvelope({
    gmCode: '03',
    headerText,
    postingDate: data.PostingDate,
    documentDate: data.DocumentDate,
    item
  });
}

module.exports = { mapToMaterialDocumentPayload };
