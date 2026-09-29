/**
 * goodsIssue.mapper.js
 * Handles CAP domain-level normalization and business mapping for Goods Issue and Reversals.
 */

/**
 * Formats a Date object or date string into YYYY-MM-DD.
 * Defaults to current UTC date if omitted.
 *
 * @param {string|Date} [dateInput]
 * @returns {string}
 */
function toIsoDateString(dateInput) {
  if (!dateInput) {
    return new Date().toISOString().split('T')[0];
  }
  if (dateInput instanceof Date) {
    return dateInput.toISOString().split('T')[0];
  }
  const s = String(dateInput).trim();
  const match = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) {
    return match[1];
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return d.toISOString().split('T')[0];
  }
  return new Date().toISOString().split('T')[0];
}

/**
 * Cleans dirty barcode scanner input (removes CR, LF, tabs, and trims).
 *
 * @param {string} input
 * @returns {string}
 */
function sanitizeScannerString(input) {
  if (input === undefined || input === null) return '';
  return String(input).replace(/[\r\n\t]/g, '').trim();
}

/**
 * Normalizes and sanitizes incoming Goods Issue request payload at the CAP domain level.
 *
 * @param {Object} data
 * @param {Object} [context]
 * @returns {Object}
 */
function normalizeGoodsIssuePayload(data, context = {}) {
  if (!data || typeof data !== 'object') return data;

  const movementType = String(data.MovementType || '261').trim();
  const rawResv = String(data.ReservationNo || '').trim();
  const rawItem = data.ReservationItem != null ? String(data.ReservationItem).trim() : '';
  const reservationItem = rawItem ? rawItem.padStart(4, '0') : '';

  const costCenter = data.CostCenter ? String(data.CostCenter).trim().toUpperCase() : '';
  const glAccount = data.GLAccount ? String(data.GLAccount).trim() : '';

  const issueQty = Number(data.IssueQty);
  const diffQty = Number(data.DifferenceQty) || 0;

  // Normalize serial numbers: handle array or single string, clean scanner noise, deduplicate
  const rawSerials = Array.isArray(data.SerialNumbers) && data.SerialNumbers.length > 0
    ? data.SerialNumbers
    : data.SerialNumber
      ? [data.SerialNumber]
      : [];

  const cleanedSerials = [];
  const seenSerials = new Set();
  for (const sn of rawSerials) {
    const clean = sanitizeScannerString(sn);
    if (clean && !seenSerials.has(clean.toUpperCase())) {
      seenSerials.add(clean.toUpperCase());
      cleanedSerials.push(clean);
    }
  }

  const postingDate = toIsoDateString(data.PostingDate);
  const documentDate = toIsoDateString(data.DocumentDate || data.PostingDate);

  return {
    MovementType: movementType,
    ReservationNo: rawResv,
    ReservationItem: reservationItem,
    OrderNo: data.OrderNo ? String(data.OrderNo).trim() : '',
    Material: String(data.Material || '').trim(),
    MaterialDesc: data.MaterialDesc ? String(data.MaterialDesc).trim() : '',
    Plant: String(data.Plant || '').trim().toUpperCase(),
    StorageLocation: String(data.StorageLocation || '').trim().toUpperCase(),
    IssueQty: issueQty,
    Unit: String(data.Unit || '').trim().toUpperCase(),
    Batch: data.Batch ? String(data.Batch).trim().toUpperCase() : '',
    DifferenceQty: diffQty,
    DifferenceReason: data.DifferenceReason ? String(data.DifferenceReason).trim() : '',
    DifferenceStorageType: data.DifferenceStorageType ? String(data.DifferenceStorageType).trim() : '',
    FinalIssue: Boolean(data.FinalIssue),
    CostCenter: costCenter,
    GLAccount: glAccount,
    PostingDate: postingDate,
    DocumentDate: documentDate,
    SerialNumbers: cleanedSerials,
    SerialNumber: cleanedSerials[0] || '',
    IsSerialManaged: Boolean(data.IsSerialManaged || cleanedSerials.length > 0),
    ReceivingPlant: data.ReceivingPlant ? String(data.ReceivingPlant).trim().toUpperCase() : '',
    ReceivingStorageLocation: data.ReceivingStorageLocation ? String(data.ReceivingStorageLocation).trim().toUpperCase() : '',
    User: context.user || 'SYSTEM'
  };
}

/**
 * Normalizes and sanitizes incoming Material Document Reversal request payload.
 *
 * @param {Object} data
 * @param {Object} [context]
 * @returns {Object}
 */
function normalizeReversalPayload(data, context = {}) {
  if (!data || typeof data !== 'object') return data;

  const rawDoc = String(data.MaterialDocument || '').trim();
  const materialDocument = /^\d+$/.test(rawDoc) ? rawDoc.padStart(10, '0') : rawDoc;
  const materialDocYear = String(data.MaterialDocYear || new Date().getFullYear()).trim();
  const postingDate = toIsoDateString(data.PostingDate);
  const documentDate = toIsoDateString(data.DocumentDate || data.PostingDate);
  const reversalReason = data.ReversalReason ? String(data.ReversalReason).trim() : '';

  return {
    MaterialDocument: materialDocument,
    MaterialDocYear: materialDocYear,
    PostingDate: postingDate,
    DocumentDate: documentDate,
    ReversalReason: reversalReason,
    User: context.user || 'SYSTEM'
  };
}

module.exports = {
  toIsoDateString,
  sanitizeScannerString,
  normalizeGoodsIssuePayload,
  normalizeReversalPayload
};
