/**
 * Shared Date Utilities for SAP S/4HANA Full-Stack
 *
 * Provides robust formatting for SAP date formats (/Date(ms)/, ISO 8601, Date objects, epoch numbers)
 * into ISO YYYY-MM-DD representation.
 */

/**
 * Formats an S/4HANA date representation into an ISO YYYY-MM-DD string.
 *
 * @param {string|number|Date|null|undefined} dateVal - Input date value
 * @param {object} [options]
 * @param {string|null} [options.emptyFallback=null] - Fallback value when input is null, undefined, or empty
 * @returns {string|null} Formatted YYYY-MM-DD or fallback
 */
function formatDateToYMD(dateVal, options = {}) {
  const emptyFallback = options.emptyFallback !== undefined ? options.emptyFallback : null;

  if (dateVal === null || dateVal === undefined || dateVal === '') {
    return emptyFallback;
  }

  let d = null;
  if (typeof dateVal === 'string') {
    const trimmed = dateVal.trim();
    if (!trimmed) {
      return emptyFallback;
    }
    // Match /Date(1234567890)/ or /Date(1234567890+0000)/
    const match = /\/Date\((\d+)(?:[+-]\d+)?\)\//.exec(trimmed);
    if (match) {
      d = new Date(parseInt(match[1], 10));
    } else if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
      return trimmed.split('T')[0];
    } else {
      d = new Date(trimmed);
    }
  } else if (dateVal instanceof Date) {
    d = dateVal;
  } else if (typeof dateVal === 'number') {
    d = new Date(dateVal);
  }

  if (!d || isNaN(d.getTime())) {
    return emptyFallback;
  }

  return d.toISOString().split('T')[0];
}

module.exports = {
  formatDateToYMD
};
