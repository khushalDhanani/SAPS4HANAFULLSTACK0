'use strict';

/**
 * Trust-boundary check for every value that is embedded in an RFC_READ_TABLE WHERE text or sent to an
 * RFC function module. The patterns allow no quote, space or wildcard, so the free-text OPTIONS lines
 * cannot be broken out of (effectively parameterized). Invalid input fails with HTTP 400.
 */
const PATTERNS = Object.freeze({
  lgnum: [/^[A-Z0-9]{1,3}$/, 'Warehouse'],
  tbnum: [/^\d{1,10}$/, 'Transfer Requirement number'],
  tbpos: [/^\d{1,4}$/, 'Transfer Requirement item'],
  rsnum: [/^\d{1,10}$/, 'Reservation number'],
  rspos: [/^\d{1,4}$/, 'Reservation item'],
  tanum: [/^\d{1,10}$/, 'Transfer Order number'],
  tapos: [/^\d{1,4}$/, 'Transfer Order item'],
  mvt: [/^\d{3}$/, 'Movement type'],
  matnr: [/^[A-Z0-9_\-./]{1,40}$/, 'Material'],
  batch: [/^[A-Z0-9_\-./]{1,10}$/, 'Batch'],
  plant: [/^[A-Z0-9]{4}$/, 'Plant'],
  lgort: [/^[A-Z0-9]{4}$/, 'Storage location'],
  lenum: [/^[A-Z0-9]{1,20}$/, 'Storage Unit number'],
  lgtyp: [/^[A-Z0-9*]{1,3}$/, 'Storage type'],
  lgpla: [/^[A-Z0-9_\-./]{1,10}$/, 'Storage bin'],
  serial: [/^[A-Z0-9_\-./]{1,18}$/, 'Serial number'],
  uuid: [/^[0-9A-F-]{36}$/i, 'Process ID'],
  mblnr: [/^\d{1,10}$/, 'Material Document number'],
  mjahr: [/^\d{4}$/, 'Material Document year'],
  vbeln: [/^\d{1,10}$/, 'Delivery number']
});

const httpError = (status, message) => Object.assign(new Error(message), { status });

/** Returns the trimmed, upper-cased value or throws 400 `<label> is missing or invalid`. */
function sapKey(value, field, label) {
  const [re, defaultLabel] = PATTERNS[field] || [];
  if (!re) throw new Error(`sapKey: unknown field '${field}'`);
  const s = String(value ?? '').trim().toUpperCase();
  if (!re.test(s)) throw httpError(400, `${label || defaultLabel} is missing or invalid`);
  return s;
}

/** Like sapKey but returns '' for an empty value (field is optional). */
function sapKeyOpt(value, field, label) {
  return String(value ?? '').trim() === '' ? '' : sapKey(value, field, label);
}

module.exports = { sapKey, sapKeyOpt, PATTERNS, httpError };
