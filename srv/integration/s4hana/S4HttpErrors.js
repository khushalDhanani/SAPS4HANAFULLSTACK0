'use strict';

/** Error code used when no destination could be resolved at all. */
const DESTINATION_NOT_CONFIGURED = 'S4_DESTINATION_NOT_CONFIGURED';

/**
 * Failure of a call to S/4HANA. Carries the HTTP status (also as statusCode for handlers that use that
 * name), the SAP OData error code when present, and the response for S4ErrorMapper.
 */
class S4HttpError extends Error {
  constructor(message, { status = 502, code = '', method = '', path = '', response = null, cause } = {}) {
    super(message);
    this.name = 'S4HttpError';
    this.status = status;
    this.statusCode = status;
    this.code = code || '';
    this.method = method;
    this.path = path;
    this.response = response;
    if (cause) this.cause = cause;
  }
}

/** Reads the HTTP response from a Cloud SDK error, whichever way the SDK version wraps it. */
function responseOf(err) {
  return err?.response || err?.cause?.response || err?.rootCause?.response || null;
}

/** Reads the low-level error code (e.g. ECONNREFUSED) from a Cloud SDK error. */
function codeOf(err) {
  return err?.code || err?.cause?.code || err?.rootCause?.code || '';
}

/** No connection was made, so the request never reached SAP. */
const NEVER_SENT_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH']);

/**
 * The error for a write that got no answer from SAP (timeout, dropped connection, gateway 502/504), or null if
 * this failure proves nothing about that. SAP may have saved such a write, so a retry could duplicate it.
 * $sanitize keeps the text in production: see srv/common/visibleError.js.
 *
 * @param {Error} err
 * @returns {S4HttpError|null}
 */
function unansweredWrite(err) {
  const status = responseOf(err)?.status;
  const unanswered = status ? [502, 504].includes(status) : !NEVER_SENT_CODES.has(codeOf(err));
  if (!unanswered) return null;
  const unknown = new S4HttpError(
    'SAP did not answer this request, so the result is NOT confirmed: it may have been saved. Check it in SAP before trying again.',
    { status: 504, code: 'SAP_WRITE_NOT_CONFIRMED', cause: err }
  );
  unknown.$sanitize = false;
  return unknown;
}

/** SAP OData error message and code from a response body (V2 `message.value` or V4 `message`). */
function sapMessageOf(body) {
  if (!body || typeof body !== 'object') return { message: '', code: '' };
  const error = body.error || {};
  let message = '';
  if (error.message && typeof error.message === 'object') message = error.message.value || '';
  else if (typeof error.message === 'string') message = error.message;
  return { message, code: error.code || '' };
}

/**
 * Normalises any Cloud SDK / axios / network failure into an S4HttpError.
 *
 * @param {Error} err
 * @param {string} method
 * @param {string} path
 * @returns {S4HttpError}
 */
function toS4HttpError(err, method, path) {
  if (err instanceof S4HttpError) return err;
  const response = responseOf(err);
  const status = response?.status;
  const body = response?.data;
  const { message: sapMessage, code: sapCode } = sapMessageOf(body);
  const bodyText = typeof body === 'string'
    ? body
    : (body && typeof body === 'object' ? JSON.stringify(body) : '');
  const detail = status
    ? `HTTP ${status} - ${sapMessage || bodyText.slice(0, 1000) || err?.message || ''}`
    : (err?.message || String(err));
  return new S4HttpError(`S/4HANA ${method} ${path} failed: ${detail}`, {
    status: status || 502,
    code: sapCode || codeOf(err),
    method,
    path,
    response: response ? { status, data: body, headers: response.headers } : null,
    cause: err,
  });
}

module.exports = {
  DESTINATION_NOT_CONFIGURED,
  S4HttpError,
  responseOf,
  codeOf,
  NEVER_SENT_CODES,
  unansweredWrite,
  sapMessageOf,
  toS4HttpError,
};
