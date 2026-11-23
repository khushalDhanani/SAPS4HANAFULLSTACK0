'use strict';

/**
 * MibLabelUtils.js
 *
 * Constants, normalization, and formatting helpers for MIB Sticker Adapter.
 */

const FUNCTION_NAME = 'Z_MM_MIB_LABEL_PDF';
const MAKT_LANGUAGE = 'E';
const LIST_MAX_DAYS = 31;
const LIST_MAX_ITEMS = 5000;
const LOOKUP_CHUNK = 50;

const RESULT_STATUS = {
  INVALID_INPUT: 400,
  NOT_FOUND: 404,
  NOT_AUTHORIZED: 403,
  FORM_ERROR: 502,
  EMPTY_PDF: 502,
};

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const isoDate = (v) => {
  const s = String(v ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null;
};

const sapDate = (v) => {
  const s = String(v ?? '').trim();
  return /^\d{8}$/.test(s) && s !== '00000000' ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : '';
};

function normalizeInput(input = {}) {
  const lgnum = String(input.WarehouseNumber ?? input.warehouseNumber ?? '').trim().toUpperCase();
  const tanumRaw = String(input.TransferOrderNumber ?? input.transferOrderNumber ?? '').trim();
  const bname = String(input.WeightedBy ?? input.weightedBy ?? '').trim().toUpperCase();
  const bname1 = String(input.CheckedBy ?? input.checkedBy ?? '').trim().toUpperCase();

  if (!lgnum || !/^[A-Z0-9]{1,3}$/.test(lgnum)) {
    throw httpError(400, 'Warehouse number must be 1 to 3 letters or digits.');
  }
  if (!tanumRaw || !/^\d{1,10}$/.test(tanumRaw)) {
    throw httpError(400, 'Transfer order number must be up to 10 digits.');
  }
  if (bname.length > 12) {
    throw httpError(400, 'Weighted by username must be at most 12 characters.');
  }
  if (bname1.length > 12) {
    throw httpError(400, 'Checked by username must be at most 12 characters.');
  }

  const tanum = tanumRaw.padStart(10, '0');
  return { lgnum, tanum, bname, bname1 };
}

/** Warehouse number and either one TO (number) or a transfer-date range of at most LIST_MAX_DAYS days. */
function normalizeListInput(input = {}) {
  const lgnum = String(input.WarehouseNumber ?? input.warehouseNumber ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9]{1,3}$/.test(lgnum)) {
    throw httpError(400, 'Warehouse number must be 1 to 3 letters or digits.');
  }
  const toRaw = String(input.TransferOrderNumber ?? input.transferOrderNumber ?? '').trim();
  if (toRaw) {
    if (!/^\d{1,10}$/.test(toRaw)) {
      throw httpError(400, 'Transfer order number must be up to 10 digits.');
    }
    return { lgnum, tanum: toRaw.padStart(10, '0') };
  }

  const from = isoDate(input.DateFrom ?? input.dateFrom);
  const to = isoDate(input.DateTo ?? input.dateTo);
  if (!from || !to) {
    throw httpError(400, 'Transfer order dates must be valid dates (yyyy-mm-dd).');
  }
  if (from > to) {
    throw httpError(400, 'The transfer order date "from" must not be after "to".');
  }
  if ((Date.parse(to) - Date.parse(from)) / 86400000 + 1 > LIST_MAX_DAYS) {
    throw httpError(400, `The transfer order date range must be at most ${LIST_MAX_DAYS} days.`);
  }
  return { lgnum, from, to };
}

const quote = (v) => `'${String(v).replace(/'/g, "''")}'`;

const orLines = (prefix, field, values) => values.map((v, i) => `${i ? 'OR' : `${prefix} (`} ${field} = ${quote(v)}`)
  .concat(')');

module.exports = {
  FUNCTION_NAME,
  MAKT_LANGUAGE,
  LIST_MAX_DAYS,
  LIST_MAX_ITEMS,
  LOOKUP_CHUNK,
  RESULT_STATUS,
  httpError,
  isoDate,
  sapDate,
  normalizeInput,
  normalizeListInput,
  quote,
  orLines,
};
