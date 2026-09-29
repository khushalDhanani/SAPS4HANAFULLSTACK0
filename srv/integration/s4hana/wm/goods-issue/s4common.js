/**
 * s4common.js
 * Pure, type-agnostic S/4HANA API_MATERIAL_DOCUMENT_SRV OData V2 formatting helpers shared by the
 * per-movement-type mappers (GoodsIssue201/261/301/311Mapper.js). Pure OData mechanics
 * (date literals, deep-insert envelope, common item fields) - contains NO movement-type branching.
 */

/**
 * Converts a date to the SAP OData V2 JSON timestamp '/Date(epoch_ms)/' at UTC midnight.
 * @param {string|Date} dateInput
 * @returns {string}
 */
function formatDateToODataV2(dateInput) {
  if (!dateInput) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    return `/Date(${today.getTime()})/`;
  }
  if (dateInput instanceof Date) {
    const d = new Date(dateInput.getTime());
    d.setUTCHours(0, 0, 0, 0);
    return `/Date(${d.getTime()})/`;
  }
  const s = String(dateInput).trim();
  const match = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const utcDate = new Date(Date.UTC(parseInt(match[1], 10), parseInt(match[2], 10) - 1, parseInt(match[3], 10)));
    return `/Date(${utcDate.getTime()})/`;
  }
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    parsed.setUTCHours(0, 0, 0, 0);
    return `/Date(${parsed.getTime()})/`;
  }
  const fallback = new Date();
  fallback.setUTCHours(0, 0, 0, 0);
  return `/Date(${fallback.getTime()})/`;
}

/**
 * Builds the common A_MaterialDocumentItem fields shared by every movement type
 * (material, unit, quantity, plant, storage location, batch, reservation link, serials).
 * Type-specific fields (CostCenter, receiving plant/sloc, GLAccount) are added by the caller.
 * @param {Object} data - normalized CAP domain data
 * @param {string} goodsMovementType - '201'|'261'|'301'|'311'
 * @returns {Object}
 */
function buildBaseItem(data, goodsMovementType) {
  const item = {
    Material: String(data.Material || '').trim(),
    GoodsMovementType: goodsMovementType,
    EntryUnit: String(data.Unit || '').trim().toUpperCase(),
    QuantityInEntryUnit: String(data.IssueQty),
    Plant: String(data.Plant || '').trim().toUpperCase(),
    StorageLocation: String(data.StorageLocation || '').trim().toUpperCase()
  };

  if (data.ReservationNo && String(data.ReservationNo).trim() !== '') {
    item.Reservation = String(data.ReservationNo).trim();
  }
  if (data.ReservationItem && String(data.ReservationItem).trim() !== '') {
    item.ReservationItem = String(data.ReservationItem).trim().padStart(4, '0');
  }
  if (data.Batch && String(data.Batch).trim() !== '') {
    item.Batch = String(data.Batch).trim().toUpperCase();
  }

  const serials = Array.isArray(data.SerialNumbers) && data.SerialNumbers.length > 0
    ? data.SerialNumbers
    : data.SerialNumber
      ? [data.SerialNumber]
      : [];
  if (serials.length > 0) {
    item.to_SerialNumbers = { results: serials.map(sn => ({ SerialNumber: String(sn).trim() })) };
  }

  return item;
}

/**
 * Wraps a single item into the A_MaterialDocumentHeader deep-insert envelope.
 * @param {Object} params
 * @param {string} params.gmCode - Goods Movement Code ('03' issue, '04' transfer)
 * @param {string} params.headerText - <=25 char header text
 * @param {string|Date} params.postingDate
 * @param {string|Date} params.documentDate
 * @param {Object} params.item
 * @returns {Object}
 */
function buildHeaderEnvelope({ gmCode, headerText, postingDate, documentDate, item }) {
  return {
    GoodsMovementCode: gmCode,
    PostingDate: formatDateToODataV2(postingDate),
    DocumentDate: formatDateToODataV2(documentDate || postingDate),
    MaterialDocumentHeaderText: String(headerText || '').trim().slice(0, 25),
    to_MaterialDocumentItem: { results: [item] }
  };
}

module.exports = { formatDateToODataV2, buildBaseItem, buildHeaderEnvelope };
