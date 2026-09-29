/**
 * goodsIssue.validation.js
 * Reversal validation + shared calendar-date primitive for Goods Issue.
 *
 * NOTE: Per-movement-type posting validation now lives in the isolated
 * goodsIssue201/261/301/311.validation.js modules (Phase 1). This file no longer
 * contains any MovementType-branching posting validation.
 */

const POSTABLE_MOVEMENT_TYPES = ['201', '261', '301', '311'];

/**
 * Validates a calendar date string (YYYY-MM-DD or ISO) or Date, rejecting impossible dates.
 * @param {string|Date} dateInput
 * @returns {boolean}
 */
function isValidCalendarDate(dateInput) {
  if (!dateInput) return false;
  if (dateInput instanceof Date) {
    return !isNaN(dateInput.getTime());
  }
  const s = String(dateInput).trim();
  const match = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return false;

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);

  if (month < 1 || month > 12) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) return false;

  const d = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
  return !isNaN(d.getTime());
}

/**
 * Validates Material Document Reversal request payload (type-agnostic: document + year).
 * @param {Object} data
 * @returns {{ isValid: boolean, errors: Array<{ field: string, message: string }>, message: string }}
 */
function validateReversalPayload(data) {
  const errors = [];
  function addError(field, message) {
    errors.push({ field, message });
  }

  if (!data || typeof data !== 'object') {
    return {
      isValid: false,
      errors: [{ field: 'body', message: 'Request body must be a valid JSON object' }],
      message: 'Request body must be a valid JSON object'
    };
  }

  const sMatDoc = String(data.MaterialDocument || '').trim();
  if (!sMatDoc) {
    addError('MaterialDocument', 'MaterialDocument number is required for reversal');
  } else if (sMatDoc.length > 10) {
    addError('MaterialDocument', 'MaterialDocument number exceeds maximum length of 10 characters');
  }

  const sYear = String(data.MaterialDocYear || '').trim();
  if (!sYear) {
    addError('MaterialDocYear', 'MaterialDocYear is required for reversal');
  } else if (!/^\d{4}$/.test(sYear)) {
    addError('MaterialDocYear', `MaterialDocYear '${sYear}' must be exactly 4 digits (e.g. 2026)`);
  }

  if (data.PostingDate && !isValidCalendarDate(data.PostingDate)) {
    addError('PostingDate', `PostingDate '${data.PostingDate}' is not a valid calendar date`);
  }
  if (data.DocumentDate && !isValidCalendarDate(data.DocumentDate)) {
    addError('DocumentDate', `DocumentDate '${data.DocumentDate}' is not a valid calendar date`);
  }
  if (data.ReversalReason && String(data.ReversalReason).trim().length > 4) {
    addError('ReversalReason', 'ReversalReason exceeds maximum length of 4 characters');
  }

  const isValid = errors.length === 0;
  const message = isValid ? 'Validation succeeded' : errors.map(e => `${e.field}: ${e.message}`).join('; ');
  return { isValid, errors, message };
}

module.exports = {
  validateReversalPayload,
  isValidCalendarDate,
  POSTABLE_MOVEMENT_TYPES
};
