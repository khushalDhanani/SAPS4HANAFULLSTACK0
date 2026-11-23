'use strict';

/**
 * SAP data conversion utilities.
 */

/**
 * SAP RFC number string -> Number. RFC_READ_TABLE returns '100.000' and a trailing minus for
 * negatives ('5.000-'). NaN for anything else, never 0.
 *
 * @param {string|number|null|undefined} value
 * @returns {number}
 */
function parseSapNumber(value) {
  const s = String(value == null ? '' : value).trim();
  if (!s || s === '-') return NaN;
  const neg = s.endsWith('-');
  const numStr = (neg ? s.slice(0, -1) : s).trim();
  if (!numStr) return NaN;
  const n = Number(numStr); // any other format (e.g. a comma) -> NaN, not a guess
  return neg ? -n : n;
}

module.exports = {
  parseSapNumber
};
