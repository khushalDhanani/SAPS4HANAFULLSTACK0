'use strict';

const LOG = require('./logger')('sap-error');

/**
 * Infrastructure / configuration failures of the SAP connection layer. Their original text names env
 * variables, files or native modules and must never reach an end user; the text goes to the log instead.
 */
const INFRA_PATTERNS = [
  /RFC connection not configured/i,
  /node-rfc is not available/i,
  /RFC_COMMUNICATION_FAILURE|RFC_LOGON_FAILURE|RFC_INVALID_PARAMETER|RFC_ILLEGAL_STATE/,
  /\.env(\.local)?\b/,
  /No credentials configured/i,
  /destination .* (not found|is not configured)/i,
  /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|socket hang up/i
];

const USER_TEXT = 'The SAP system connection is currently unavailable; nothing was sent to SAP. Please try again later or contact IT support';

/** True when the error is an SAP connection / configuration failure rather than a business rejection. */
function isSapInfrastructureError(err) {
  if (!err) return false;
  const status = Number(err.status || err.statusCode);
  const text = String(err.message || err.error || '');
  return status === 503 || INFRA_PATTERNS.some((re) => re.test(text));
}

/**
 * Text that may be shown to the end user for an error raised while talking to SAP.
 * Infrastructure errors are replaced by a generic message carrying only the request correlation id;
 * the technical reason is logged at error level. Business rejections (SAP RETURN messages, 4xx
 * validation) are returned unchanged.
 * @param {Error|object} err
 * @param {object} [req] CAP request (its id is the support reference)
 * @param {string} [context] what was being done, for the log line
 */
function userFacingSapError(err, req, context = '') {
  const original = String((err && (err.error || err.message)) || 'unknown error');
  if (!isSapInfrastructureError(err)) return original;
  const ref = (req && (req.id || req.headers?.['x-correlation-id'])) || '';
  LOG.error(`${context ? `[${context}] ` : ''}SAP connection failure${ref ? ` (ref ${ref})` : ''}: ${original}`);
  return `${USER_TEXT}${ref ? ` (reference ${ref})` : ''}.`;
}

module.exports = { userFacingSapError, isSapInfrastructureError, USER_TEXT };
