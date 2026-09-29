/**
 * goodsIssue.validation.js
 * Pure, isolated server-side business rules for Goods Issue transactions (Movement 201, 261, 301, 311)
 * and Material Document Reversal.
 *
 * Strict AGENTS.md compliance:
 * - Pure validation functions without direct I/O or S/4 network dependencies.
 * - 100% testable in isolation with deterministic unit tests.
 */

const POSTABLE_MOVEMENT_TYPES = ['201', '261', '301', '311'];
const COST_CENTER_REGEX = /^[A-Za-z0-9_-]{1,10}$/;
const PLANT_REGEX = /^[A-Za-z0-9]{4}$/;
const SLOC_REGEX = /^[A-Za-z0-9]{4}$/;
const GL_ACCOUNT_REGEX = /^[A-Za-z0-9]{1,10}$/;
const QTY_DECIMAL_REGEX = /^\d+(\.\d{1,3})?$/;

/**
 * Validates a calendar date string (YYYY-MM-DD or ISO).
 * Confirms calendar validity (e.g. rejects 2026-02-31).
 *
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
 * Validates Goods Issue request payload against SAP business rules.
 *
 * @param {Object} data
 * @returns {{ isValid: boolean, errors: Array<{ field: string, message: string }>, message: string }}
 */
function validateGoodsIssuePayload(data) {
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

  const sMvt = String(data.MovementType || '261').trim();
  if (!POSTABLE_MOVEMENT_TYPES.includes(sMvt)) {
    addError('MovementType', `Movement type '${sMvt}' is not supported (allowed: ${POSTABLE_MOVEMENT_TYPES.join(', ')})`);
  }

  // Cost Center validation (Mandatory for Movement Type 201)
  if (sMvt === '201') {
    const sCostCenter = String(data.CostCenter || '').trim();
    if (!sCostCenter) {
      addError('CostCenter', 'Cost Center is mandatory for Movement Type 201 (Goods Issue to Cost Center)');
    } else if (!COST_CENTER_REGEX.test(sCostCenter)) {
      addError('CostCenter', `Cost Center '${sCostCenter}' must be 1 to 10 alphanumeric characters`);
    }
  }

  // Reservation requirements: mandatory for 261, 301, 311; optional for unplanned 201
  const sResv = String(data.ReservationNo || '').trim();
  const sItem = data.ReservationItem != null ? String(data.ReservationItem).trim() : '';
  const hasReservation = Boolean(sResv && sItem);

  if (sMvt !== '201') {
    if (!sResv && !sItem) {
      addError('ReservationNo', 'ReservationNo and ReservationItem are required');
      addError('ReservationItem', 'ReservationNo and ReservationItem are required');
    } else {
      if (!sResv) {
        addError('ReservationNo', 'ReservationNo and ReservationItem are required');
      } else if (sResv.length > 10) {
        addError('ReservationNo', 'ReservationNo exceeds maximum length of 10 characters');
      }
      if (!sItem) {
        addError('ReservationItem', 'ReservationNo and ReservationItem are required');
      } else if (sItem.length > 4) {
        addError('ReservationItem', 'ReservationItem exceeds maximum length of 4 characters');
      }
    }
  } else {
    // For 201, if reservation is partially supplied, ensure both are valid
    if (sResv && sResv.length > 10) {
      addError('ReservationNo', 'ReservationNo exceeds maximum length of 10 characters');
    }
    if (sItem && sItem.length > 4) {
      addError('ReservationItem', 'ReservationItem exceeds maximum length of 4 characters');
    }
  }

  // Quantity validation
  if (data.IssueQty === undefined || data.IssueQty === null || String(data.IssueQty).trim() === '') {
    addError('IssueQty', 'IssueQty must be a positive decimal number');
  } else {
    const nQty = Number(data.IssueQty);
    if (isNaN(nQty) || nQty <= 0 || !isFinite(nQty)) {
      addError('IssueQty', 'IssueQty must be a positive decimal number');
    } else {
      const sQty = String(data.IssueQty).trim();
      if (!QTY_DECIMAL_REGEX.test(sQty)) {
        addError('IssueQty', 'Issue quantity exceeds maximum precision of 3 decimal places');
      }
    }
  }

  // Material validation
  const sMaterial = String(data.Material || '').trim();
  if (!sMaterial && !hasReservation) {
    addError('Material', 'Material number is required');
  } else if (sMaterial.length > 40) {
    addError('Material', 'Material number exceeds maximum length of 40 characters');
  }

  // Plant validation (required when no reservation)
  const sPlant = String(data.Plant || '').trim();
  if (!sPlant && !hasReservation) {
    addError('Plant', 'Plant is required');
  } else if (sPlant && !PLANT_REGEX.test(sPlant)) {
    addError('Plant', `Plant '${sPlant}' must be exactly 4 alphanumeric characters`);
  }

  // Storage Location validation (required when no reservation)
  const sSLoc = String(data.StorageLocation || '').trim();
  if (!sSLoc && !hasReservation) {
    addError('StorageLocation', 'Storage Location is required');
  } else if (sSLoc && !SLOC_REGEX.test(sSLoc)) {
    addError('StorageLocation', `Storage Location '${sSLoc}' must be exactly 4 alphanumeric characters`);
  }

  // Unit of Measure validation
  const sUnit = String(data.Unit || '').trim();
  if (!sUnit) {
    addError('Unit', 'Unit of measure (EntryUnit) is required');
  } else if (sUnit.length > 3) {
    addError('Unit', `Unit of measure '${sUnit}' exceeds maximum length of 3 characters`);
  }

  // Optional G/L Account validation
  if (data.GLAccount !== undefined && data.GLAccount !== null && String(data.GLAccount).trim() !== '') {
    const sGL = String(data.GLAccount).trim();
    if (!GL_ACCOUNT_REGEX.test(sGL)) {
      addError('GLAccount', `GLAccount '${sGL}' must be 1 to 10 alphanumeric characters`);
    }
  }

  // Posting Date & Document Date validation
  const now = new Date();
  const maxFutureDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));

  if (data.PostingDate) {
    if (!isValidCalendarDate(data.PostingDate)) {
      addError('PostingDate', `PostingDate '${data.PostingDate}' is not a valid calendar date`);
    } else {
      const pDate = new Date(data.PostingDate);
      if (pDate.getTime() > maxFutureDate.getTime()) {
        addError('PostingDate', `PostingDate '${data.PostingDate}' cannot be in the future beyond tomorrow`);
      }
    }
  }

  if (data.DocumentDate) {
    if (!isValidCalendarDate(data.DocumentDate)) {
      addError('DocumentDate', `DocumentDate '${data.DocumentDate}' is not a valid calendar date`);
    }
  }

  // Serial Numbers validation
  const rawSerials = Array.isArray(data.SerialNumbers)
    ? data.SerialNumbers
    : data.SerialNumber
      ? [data.SerialNumber]
      : [];

  if (rawSerials.length > 0) {
    const cleanedSerials = rawSerials.map(s => String(s || '').trim()).filter(Boolean);
    const seen = new Set();
    const duplicates = [];

    for (const sn of cleanedSerials) {
      if (sn.length > 18) {
        addError('SerialNumbers', `Serial number '${sn}' exceeds maximum length of 18 characters`);
      }
      const upper = sn.toUpperCase();
      if (seen.has(upper)) {
        duplicates.push(sn);
      }
      seen.add(upper);
    }

    if (duplicates.length > 0) {
      addError('SerialNumbers', `Duplicate serial numbers detected: ${[...new Set(duplicates)].join(', ')}`);
    }

    // If quantity is valid and material is serialized, check exact count match
    const nQty = Number(data.IssueQty);
    if (!isNaN(nQty) && nQty > 0 && Number.isInteger(nQty)) {
      if (data.IsSerialManaged && cleanedSerials.length !== nQty) {
        addError('SerialNumbers', `Serial number count (${cleanedSerials.length}) does not match issue quantity (${nQty})`);
      }
    }
  }

  // Batch validation
  if (data.Batch !== undefined && data.Batch !== null && String(data.Batch).trim() !== '') {
    const sBatch = String(data.Batch).trim();
    if (sBatch.length > 10) {
      addError('Batch', `Batch '${sBatch}' exceeds maximum length of 10 characters`);
    }
  }

  const isValid = errors.length === 0;
  const message = isValid ? 'Validation succeeded' : errors.map(e => `${e.field}: ${e.message}`).join('; ');

  return { isValid, errors, message };
}

/**
 * Validates Material Document Reversal request payload.
 *
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

  if (data.PostingDate) {
    if (!isValidCalendarDate(data.PostingDate)) {
      addError('PostingDate', `PostingDate '${data.PostingDate}' is not a valid calendar date`);
    }
  }

  if (data.DocumentDate) {
    if (!isValidCalendarDate(data.DocumentDate)) {
      addError('DocumentDate', `DocumentDate '${data.DocumentDate}' is not a valid calendar date`);
    }
  }

  if (data.ReversalReason && String(data.ReversalReason).trim().length > 4) {
    addError('ReversalReason', 'ReversalReason exceeds maximum length of 4 characters');
  }

  const isValid = errors.length === 0;
  const message = isValid ? 'Validation succeeded' : errors.map(e => `${e.field}: ${e.message}`).join('; ');

  return { isValid, errors, message };
}

module.exports = {
  validateGoodsIssuePayload,
  validateReversalPayload,
  isValidCalendarDate,
  POSTABLE_MOVEMENT_TYPES
};
