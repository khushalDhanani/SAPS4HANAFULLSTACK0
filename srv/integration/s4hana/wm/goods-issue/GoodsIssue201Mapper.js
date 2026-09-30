/**
 * GoodsIssue201Mapper.js
 * ISOLATED S/4HANA payload mapper for Movement Type 201 ONLY (Goods Issue to Cost Center).
 * API_MATERIAL_DOCUMENT_SRV / A_MaterialDocumentHeader deep insert. No MovementType branching.
 *
 * 201 specifics: GoodsMovementCode '03', CostCenter set on the item, G/L account NEVER forwarded
 * (system-determined via OBYC/GBB-VBR), no receiving plant/storage location.
 */

const { buildBaseItem, buildHeaderEnvelope } = require('./s4common');

/**
 * @param {Object} data - normalized CAP domain data for a 201 posting
 * @returns {Object} A_MaterialDocumentHeader payload
 */
function mapToMaterialDocumentPayload(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('Data is required for 201 Material Document mapping');
  }

  const item = buildBaseItem(data, '201');
  if (data.CostCenter) {
    const sCc = String(data.CostCenter).trim().toUpperCase();
    item.CostCenter = /^\d+$/.test(sCc) ? sCc.padStart(10, '0') : sCc;
  }
  // G/L account is intentionally never forwarded for 201.

  const headerText = data.ReservationNo
    ? `GI CC Resv ${data.ReservationNo}`
    : `GI CC ${data.CostCenter || ''}`;

  return buildHeaderEnvelope({
    gmCode: '03',
    headerText,
    postingDate: data.PostingDate,
    documentDate: data.DocumentDate,
    item
  });
}

module.exports = { mapToMaterialDocumentPayload };
