/**
 * validation/common.js
 * Pure, type-agnostic validation PRIMITIVES shared by the per-movement-type validators
 * (goodsIssue201/261/301/311.validation.js).
 *
 * These are field-level rules that every Goods Issue movement type shares by definition
 * (a material number is a material number; a quantity is a quantity). They contain NO
 * movement-type branching - the per-type files decide WHICH of these to apply and add
 * their own type-specific rules on top. This is infrastructure, not movement-type logic.
 */

const PLANT_REGEX = /^[A-Za-z0-9]{4}$/;
const SLOC_REGEX = /^[A-Za-z0-9]{4}$/;
const COST_CENTER_REGEX = /^[A-Za-z0-9_-]{1,10}$/;
const GL_ACCOUNT_REGEX = /^[A-Za-z0-9]{1,10}$/;
const QTY_DECIMAL_REGEX = /^\d+(\.\d{1,3})?$/;

/**
 * Validates a calendar date string (YYYY-MM-DD / ISO) or Date, rejecting impossible dates
 * (e.g. 2026-02-31).
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
 * @param {*} value
 * @returns {{field:string,message:string}|null}
 */
function checkQuantity(value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return { field: 'IssueQty', message: 'IssueQty must be a positive decimal number' };
  }
  const n = Number(value);
  if (isNaN(n) || n <= 0 || !isFinite(n)) {
    return { field: 'IssueQty', message: 'IssueQty must be a positive decimal number' };
  }
  if (!QTY_DECIMAL_REGEX.test(String(value).trim())) {
    return { field: 'IssueQty', message: 'Issue quantity exceeds maximum precision of 3 decimal places' };
  }
  return null;
}

/**
 * @param {*} value
 * @param {boolean} required
 * @returns {{field:string,message:string}|null}
 */
function checkMaterial(value, required) {
  const s = String(value || '').trim();
  if (!s) {
    return required ? { field: 'Material', message: 'Material number is required' } : null;
  }
  if (s.length > 40) {
    return { field: 'Material', message: 'Material number exceeds maximum length of 40 characters' };
  }
  return null;
}

/**
 * @param {*} value
 * @param {boolean} required
 * @returns {{field:string,message:string}|null}
 */
function checkPlant(value, required) {
  const s = String(value || '').trim();
  if (!s) {
    return required ? { field: 'Plant', message: 'Plant is required' } : null;
  }
  if (!PLANT_REGEX.test(s)) {
    return { field: 'Plant', message: `Plant '${s}' must be exactly 4 alphanumeric characters` };
  }
  return null;
}

/**
 * @param {*} value
 * @param {boolean} required
 * @returns {{field:string,message:string}|null}
 */
function checkStorageLocation(value, required) {
  const s = String(value || '').trim();
  if (!s) {
    return required ? { field: 'StorageLocation', message: 'Storage Location is required' } : null;
  }
  if (!SLOC_REGEX.test(s)) {
    return { field: 'StorageLocation', message: `Storage Location '${s}' must be exactly 4 alphanumeric characters` };
  }
  return null;
}

/**
 * @param {*} value
 * @returns {{field:string,message:string}|null}
 */
function checkUnit(value) {
  const s = String(value || '').trim();
  if (!s) {
    return { field: 'Unit', message: 'Unit of measure (EntryUnit) is required' };
  }
  if (s.length > 3) {
    return { field: 'Unit', message: `Unit of measure '${s}' exceeds maximum length of 3 characters` };
  }
  return null;
}

/**
 * @param {*} value  A receiving plant/sloc (optional field on transfers)
 * @param {'ReceivingPlant'|'ReceivingStorageLocation'} field
 * @returns {{field:string,message:string}|null}
 */
function checkOptionalFourChar(value, field) {
  const s = String(value || '').trim();
  if (!s) return null;
  if (!PLANT_REGEX.test(s)) {
    return { field, message: `${field} '${s}' must be exactly 4 alphanumeric characters` };
  }
  return null;
}

/**
 * Validates Posting/Document dates. Posting date may not be in the future beyond tomorrow.
 * @param {Object} data
 * @returns {Array<{field:string,message:string}>}
 */
function checkDates(data) {
  const errors = [];
  const now = new Date();
  const maxFutureDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));

  if (data.PostingDate) {
    if (!isValidCalendarDate(data.PostingDate)) {
      errors.push({ field: 'PostingDate', message: `PostingDate '${data.PostingDate}' is not a valid calendar date` });
    } else if (new Date(data.PostingDate).getTime() > maxFutureDate.getTime()) {
      errors.push({ field: 'PostingDate', message: `PostingDate '${data.PostingDate}' cannot be in the future beyond tomorrow` });
    }
  }
  if (data.DocumentDate && !isValidCalendarDate(data.DocumentDate)) {
    errors.push({ field: 'DocumentDate', message: `DocumentDate '${data.DocumentDate}' is not a valid calendar date` });
  }
  return errors;
}

/**
 * Validates serial numbers (length, duplicates, count vs quantity for serial-managed materials).
 * @param {Object} data
 * @returns {Array<{field:string,message:string}>}
 */
function checkSerialNumbers(data) {
  const errors = [];
  const rawSerials = Array.isArray(data.SerialNumbers)
    ? data.SerialNumbers
    : data.SerialNumber
      ? [data.SerialNumber]
      : [];
  if (rawSerials.length === 0) return errors;

  const cleaned = rawSerials.map(s => String(s || '').trim()).filter(Boolean);
  const seen = new Set();
  const duplicates = [];
  for (const sn of cleaned) {
    if (sn.length > 18) {
      errors.push({ field: 'SerialNumbers', message: `Serial number '${sn}' exceeds maximum length of 18 characters` });
    }
    const upper = sn.toUpperCase();
    if (seen.has(upper)) duplicates.push(sn);
    seen.add(upper);
  }
  if (duplicates.length > 0) {
    errors.push({ field: 'SerialNumbers', message: `Duplicate serial numbers detected: ${[...new Set(duplicates)].join(', ')}` });
  }
  const nQty = Number(data.IssueQty);
  if (!isNaN(nQty) && nQty > 0 && Number.isInteger(nQty) && data.IsSerialManaged && cleaned.length !== nQty) {
    errors.push({ field: 'SerialNumbers', message: `Serial number count (${cleaned.length}) does not match issue quantity (${nQty})` });
  }
  return errors;
}

/**
 * @param {*} value
 * @returns {{field:string,message:string}|null}
 */
function checkBatch(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const s = String(value).trim();
  if (s.length > 10) {
    return { field: 'Batch', message: `Batch '${s}' exceeds maximum length of 10 characters` };
  }
  return null;
}

/**
 * Reservation-mandatory rule shared by the reservation-based movement types (261/301/311).
 * Pushes errors into the supplied array and returns whether a complete reservation is present.
 * This is a field-level rule, not movement-type logic - the per-type files choose to call it.
 * @param {Object} data
 * @param {Array<{field:string,message:string}>} errors
 * @returns {boolean} hasReservation
 */
function checkReservationRequired(data, errors) {
  const sResv = String(data.ReservationNo || '').trim();
  const sItem = data.ReservationItem != null ? String(data.ReservationItem).trim() : '';
  if (!sResv && !sItem) {
    errors.push({ field: 'ReservationNo', message: 'ReservationNo and ReservationItem are required' });
    errors.push({ field: 'ReservationItem', message: 'ReservationNo and ReservationItem are required' });
    return false;
  }
  if (!sResv) {
    errors.push({ field: 'ReservationNo', message: 'ReservationNo and ReservationItem are required' });
  } else if (sResv.length > 10) {
    errors.push({ field: 'ReservationNo', message: 'ReservationNo exceeds maximum length of 10 characters' });
  }
  if (!sItem) {
    errors.push({ field: 'ReservationItem', message: 'ReservationNo and ReservationItem are required' });
  } else if (sItem.length > 4) {
    errors.push({ field: 'ReservationItem', message: 'ReservationItem exceeds maximum length of 4 characters' });
  }
  return Boolean(sResv && sItem);
}

/**
 * Assembles the standard validation result envelope from a collected errors array.
 * @param {Array<{field:string,message:string}>} errors
 * @returns {{isValid:boolean,errors:Array,message:string}}
 */
function buildResult(errors) {
  const isValid = errors.length === 0;
  const message = isValid ? 'Validation succeeded' : errors.map(e => `${e.field}: ${e.message}`).join('; ');
  return { isValid, errors, message };
}

module.exports = {
  PLANT_REGEX,
  SLOC_REGEX,
  COST_CENTER_REGEX,
  GL_ACCOUNT_REGEX,
  QTY_DECIMAL_REGEX,
  isValidCalendarDate,
  checkQuantity,
  checkMaterial,
  checkPlant,
  checkStorageLocation,
  checkUnit,
  checkOptionalFourChar,
  checkDates,
  checkSerialNumbers,
  checkBatch,
  checkReservationRequired,
  buildResult
};
