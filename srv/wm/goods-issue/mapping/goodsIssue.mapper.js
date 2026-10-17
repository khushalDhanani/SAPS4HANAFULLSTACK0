/**
 * goodsIssue.mapper.js
 * Pure CAP-domain normalization PRIMITIVES + reversal normalization.
 *
 * NOTE: Per-movement-type posting normalization now lives in the isolated
 * goodsIssue201/301/311.normalize.js modules (Phase 2). This file holds only the
 * type-agnostic helpers they share and the (type-agnostic) reversal normalizer.
 */

/**
 * Formats a Date object or date string into YYYY-MM-DD. Defaults to current UTC date if omitted.
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
 * @param {string} input
 * @returns {string}
 */
function sanitizeScannerString(input) {
  if (input === undefined || input === null) return '';
  return String(input).replace(/[\r\n\t]/g, '').trim();
}

/**
 * Normalizes serial numbers from a payload: accepts an array or single string, cleans scanner
 * noise, and deduplicates (case-insensitive). Type-agnostic.
 * @param {Object} data
 * @returns {string[]}
 */
function cleanSerials(data) {
  const rawSerials = Array.isArray(data.SerialNumbers) && data.SerialNumbers.length > 0
    ? data.SerialNumbers
    : data.SerialNumber
      ? [data.SerialNumber]
      : [];
  const cleaned = [];
  const seen = new Set();
  for (const sn of rawSerials) {
    const clean = sanitizeScannerString(sn);
    if (clean && !seen.has(clean.toUpperCase())) {
      seen.add(clean.toUpperCase());
      cleaned.push(clean);
    }
  }
  return cleaned;
}

/**
 * Builds the type-agnostic common normalized fields shared by every movement type
 * (master data, quantity, unit, batch, dates, serials, reservation link). Type-EXCLUSIVE fields
 * (CostCenter / GLAccount / OrderNo / ReceivingPlant / ReceivingStorageLocation) default empty and
 * are filled only by the per-type normalizers, so no type reads another type's exclusive field.
 * @param {Object} data
 * @param {Object} context
 * @param {string} movementType
 * @returns {Object}
 */
function baseNormalized(data, context, movementType) {
  const serials = cleanSerials(data);
  const rawItem = data.ReservationItem != null ? String(data.ReservationItem).trim() : '';
  return {
    MovementType: movementType,
    ReservationNo: String(data.ReservationNo || '').trim(),
    ReservationItem: rawItem ? rawItem.padStart(4, '0') : '',
    Material: String(data.Material || '').trim(),
    MaterialDesc: data.MaterialDesc ? String(data.MaterialDesc).trim() : '',
    Plant: String(data.Plant || '').trim().toUpperCase(),
    StorageLocation: String(data.StorageLocation || '').trim().toUpperCase(),
    IssueQty: Number(data.IssueQty),
    Unit: String(data.Unit || '').trim().toUpperCase(),
    Batch: data.Batch ? String(data.Batch).trim().toUpperCase() : '',
    PostingDate: toIsoDateString(data.PostingDate),
    DocumentDate: toIsoDateString(data.DocumentDate || data.PostingDate),
    SerialNumbers: serials,
    SerialNumber: serials[0] || '',
    IsSerialManaged: Boolean(data.IsSerialManaged || serials.length > 0),
    // Type-exclusive fields default empty; per-type normalizers fill only what applies to them.
    OrderNo: '',
    CostCenter: '',
    GLAccount: '',
    ReceivingPlant: '',
    ReceivingStorageLocation: '',
    DifferenceQty: 0,
    DifferenceReason: '',
    DifferenceStorageType: '',
    FinalIssue: false,
    User: context.user || 'SYSTEM',
    ClientAttemptId: data.ClientAttemptId ? String(data.ClientAttemptId).trim() : ''
  };
}

/**
 * Normalizes and sanitizes incoming Material Document Reversal request payload (type-agnostic:
 * a reversal targets a material document + year, independent of the movement type that created it).
 * @param {Object} data
 * @param {Object} [context]
 * @returns {Object}
 */
function normalizeReversalPayload(data, context = {}) {
  if (!data || typeof data !== 'object') return data;

  const rawDoc = String(data.MaterialDocument || '').trim();
  const materialDocument = /^\d+$/.test(rawDoc) ? rawDoc.padStart(10, '0') : rawDoc;
  const materialDocYear = String(data.MaterialDocYear || '').trim();
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
  cleanSerials,
  baseNormalized,
  normalizeReversalPayload
};
