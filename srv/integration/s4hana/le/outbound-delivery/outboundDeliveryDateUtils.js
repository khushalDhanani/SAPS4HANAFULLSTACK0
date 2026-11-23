'use strict';

/**
 * Formats a Date instance or ISO string to OData v2 Edm.DateTime JSON representation (/Date(ms)/).
 *
 * @param {string|Date} dateVal
 * @returns {string|undefined}
 */
function _formatODataV2Date(dateVal) {
  if (!dateVal) return undefined;
  if (typeof dateVal === 'string' && dateVal.startsWith('/Date(')) return dateVal;
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return undefined;
  return `/Date(${d.getTime()})/`;
}

/**
 * Parses an OData v2 /Date(ms)/ timestamp to ISO Date format (YYYY-MM-DD).
 *
 * @param {string|Date} dateVal
 * @returns {string|null}
 */
function _parseODataV2Date(dateVal) {
  if (!dateVal) return null;
  if (typeof dateVal === 'string') {
    const match = dateVal.match(/\/Date\((\d+)(?:[+-]\d+)?\)\//);
    if (match) {
      const d = new Date(parseInt(match[1], 10));
      return d.toISOString().slice(0, 10);
    }
  }
  if (dateVal instanceof Date) {
    return dateVal.toISOString().slice(0, 10);
  }
  return String(dateVal);
}

module.exports = {
  _formatODataV2Date,
  _parseODataV2Date
};
