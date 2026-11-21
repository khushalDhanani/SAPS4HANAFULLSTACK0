'use strict';

const { parseSapNumber } = require('../sapFacts');

/**
 * QuarantineLabelUtils.js
 *
 * Constants, normalization, and formatting helpers for Quarantine Labels.
 */

const FUNCTION_NAME = 'Z_MM_QUAR_LABEL_PDF';
const QUARANTINE_STORAGE_TYPES = ['920', '902'];
const ATINN = { names: ['0000000818', '0000000828'], retest: '0000000820', expiry: '9999999400' };
const MAKT_LANGUAGE = 'E';

const RESULT_STATUS = {
  INVALID_INPUT: 400,
  NOT_FOUND: 404,
  NOT_AUTHORIZED: 403,
  NO_LABEL_ROWS: 404,
  FORM_ERROR: 502,
  EMPTY_PDF: 502,
};

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function normalizeInput({ MaterialDocument, MaterialDocumentYear, Text }) {
  const doc = String(MaterialDocument ?? '').trim();
  const year = String(MaterialDocumentYear ?? '').trim();
  const text = String(Text ?? '').trim();
  if (!/^\d{1,10}$/.test(doc)) throw httpError(400, 'Material document must be up to 10 digits.');
  if (!/^\d{4}$/.test(year)) throw httpError(400, 'Material document year must be 4 digits.');
  if (text.length > 50) throw httpError(400, 'Text must be at most 50 characters.');
  if (/[\u0000-\u001f\u007f]/.test(text)) throw httpError(400, 'Text contains an unsupported character.');
  return { mblnr: doc.padStart(10, '0'), mjahr: year, text };
}

const sapDate = (v) => {
  const s = String(v ?? '').trim();
  return /^\d{8}$/.test(s) && s !== '00000000' ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : '';
};

const quantity = (v) => {
  const n = parseSapNumber(v);
  return Number.isFinite(n) ? String(n) : '';
};

const quantity2 = (v) => {
  const n = parseSapNumber(v);
  if (!Number.isFinite(n)) return '';
  const r = Math.round(Math.abs(n) * 100 + 1e-9) / 100;
  return `${n < 0 && r ? '-' : ''}${r.toFixed(2)}`;
};

const quote = (v) => `'${String(v).replace(/'/g, "''")}'`;
const key = (...parts) => parts.join('|');

const GR_MOVEMENT_TYPE = '101';
const LIST_MAX_DAYS = 31;
const LIST_MAX_ITEMS = 5000;
const LOOKUP_CHUNK = 50;

const isoDate = (v) => {
  const s = String(v ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null;
};

function normalizeListInput({ Plant, DateFrom, DateTo, MaterialDocument, MaterialDocumentYear }) {
  const plant = String(Plant ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(plant)) throw httpError(400, 'Plant must be 4 letters or digits.');
  if (String(MaterialDocument ?? '').trim()) {
    const { mblnr, mjahr } = normalizeInput({ MaterialDocument, MaterialDocumentYear });
    return { plant, mblnr, mjahr };
  }
  const from = isoDate(DateFrom);
  const to = isoDate(DateTo);
  if (!from || !to) throw httpError(400, 'Posting dates must be valid dates (yyyy-mm-dd).');
  if (from > to) throw httpError(400, 'The posting date "from" must not be after "to".');
  if ((Date.parse(to) - Date.parse(from)) / 86400000 + 1 > LIST_MAX_DAYS) {
    throw httpError(400, `The posting-date range must be at most ${LIST_MAX_DAYS} days.`);
  }
  return { plant, from, to };
}

const orLines = (prefix, field, values) => values.map((v, i) => `${i ? 'OR' : `${prefix} (`} ${field} = ${quote(v)}`)
  .concat(')');

function assertResultOk(res, mblnr, mjahr) {
  const result = String(res.EV_RESULT || '').trim();
  const message = String(res.EV_MESSAGE || '').trim();
  if (result !== 'OK') {
    throw httpError(RESULT_STATUS[result] || 502, message || `SAP returned ${result || 'no result'} for ${mblnr}/${mjahr}.`);
  }
}

module.exports = {
  FUNCTION_NAME,
  QUARANTINE_STORAGE_TYPES,
  ATINN,
  MAKT_LANGUAGE,
  RESULT_STATUS,
  httpError,
  normalizeInput,
  sapDate,
  quantity,
  quantity2,
  quote,
  key,
  GR_MOVEMENT_TYPE,
  LIST_MAX_DAYS,
  LIST_MAX_ITEMS,
  LOOKUP_CHUNK,
  isoDate,
  normalizeListInput,
  orLines,
  assertResultOk,
};
