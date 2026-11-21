'use strict';

const RE = {
  plant: /^[A-Z0-9]{1,4}$/,
  warehouse: /^[A-Z0-9]{1,4}$/,
  material: /^[A-Z0-9][A-Z0-9_./-]{0,39}$/,
  hu: /^[A-Z0-9]{1,20}$/,
  char32: /^[0-9A-F]{32}$/,
  origin: /^[A-Z]{1,10}$/,
  status: /^[A-Z0-9]$/,
  vhKind: /^[A-Z]+$/i,
  venum: /^\d{1,10}$/,
  sloc: /^[A-Z0-9]{1,4}$/,
  unit: /^[A-Z0-9]{1,3}$/,
  batch: /^[A-Z0-9_./-]{1,10}$/,
  item: /^\d{1,6}$/
};

const strip = (v) => String(v ?? '').replace(/^0+(?=.)/, '');
const num = (v) => (v === null || v === undefined || v === '' ? 0 : Number(v));
const httpError = (status, message) => Object.assign(new Error(message), { status });

/**
 * Plant authorization (server-side; never trust a plant from the browser).
 * allowed === null  -> Admin / unrestricted (all plants)
 * allowed === []    -> no plants (sees nothing)
 * allowed === [..]  -> only those plant codes (upper-cased).
 */
const inPlantScope = (allowed, plant) => !Array.isArray(allowed) || allowed.includes(String(plant ?? '').trim().toUpperCase());

/** OData $filter sub-clause for a plant list, or '' when unrestricted. An empty list yields a never-match clause. */
const plantClause = (allowed, field = 'Plant') => {
  if (!Array.isArray(allowed)) return '';
  if (!allowed.length) return `${field} eq '~none~'`;
  return '(' + allowed.map((p) => `${field} eq '${p}'`).join(' or ') + ')';
};

/** Trust-boundary check: values go into an OData $filter or key, so only the listed characters pass. */
function clean(value, label, re, mandatory) {
  const s = String(value ?? '').trim().toUpperCase();
  if (!s && !mandatory) return '';
  if (!re.test(s)) throw httpError(400, `${label} is missing or invalid`);
  return s;
}

/** Free text for SAP (kept as typed, no upper-casing); length-capped and without quoting characters. */
function text(value, label, max) {
  const s = String(value ?? '').trim();
  if (s.length > max || /['"<>&]/.test(s)) throw httpError(400, `${label} is invalid`);
  return s;
}

// RFC key formats proven live 2026-10-06: numeric material -> 18 chars, numeric HU external id -> 20 chars.
const pad18 = (m) => (/^\d+$/.test(m) ? m.padStart(18, '0') : m);
const huKey = (h) => (/^\d+$/.test(h) ? h.padStart(20, '0') : h);
// BAPIRET2: the BAPIs return a table, BAPI_TRANSACTION_COMMIT a structure; S/I/W are not failures.
const bapiError = (ret) => [].concat(ret || []).find((r) => r && (r.TYPE === 'E' || r.TYPE === 'A'));

module.exports = {
  RE,
  strip,
  num,
  httpError,
  inPlantScope,
  plantClause,
  clean,
  text,
  pad18,
  huKey,
  bapiError
};
