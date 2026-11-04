'use strict';

const UNCONFIRMED_CODES = ['GI_POSTING_OUTCOME_UNKNOWN', 'GI_POSTING_UNCONFIRMED'];

/**
 * Classifies an error from posting directly to SAP S/4HANA into one of 4 non-queue categories:
 * 1. never_reached: 404, 503, 403 with /IWFND/MED/170, connection refused, DNS resolution failure, TLS certificate rejected.
 *    -> HTTP 503, "The posting was not made and can be tried again." Definitive failure (claims deleted).
 * 2. auth_error: Plain HTTP 403 (no /IWFND/MED/170).
 *    -> HTTP 403, pointing to SU53. Definitive failure (claims deleted).
 * 3. unknown_outcome: Timeout, connection reset, socket hang up, 502/504, or UNCONFIRMED_CODES.
 *    -> HTTP 504/500, unconfirmed outcome; do NOT tell the user to post again. Claims kept for recheck.
 * 4. rejected_by_sap: 400, 409, 422, sap-message business error.
 *    -> Original HTTP status (default 400), showing the real SAP message. Definitive failure (claims deleted).
 */
function classifyPostingError(err) {
  const status = Number(err?.status || err?.statusCode || err?.response?.status || 0);
  const code = String(err?.code || err?.cause?.code || '').toUpperCase();
  const msg = String(err?.message || '');
  const details = Array.isArray(err?.details) ? err.details : [];
  const hasMed170 = msg.includes('/IWFND/MED/170') ||
    details.some((d) => String(d?.code || d?.message || '').includes('/IWFND/MED/170'));

  // 1. Never reached SAP (404, 503, 501, 403 with /IWFND/MED/170, connection refused, DNS, capability unavailable)
  const isConnRefused = code === 'ECONNREFUSED' || /ECONNREFUSED|connection refused/i.test(msg);
  const isDns = ['ENOTFOUND', 'EAI_AGAIN'].includes(code) || /ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(msg);
  const isCapabilityUnavailable = status === 501 || /capability unavailable|service unavailable/i.test(msg);
  // A failed certificate check stops the TLS handshake, so no request was sent. Adapters keep only the message text.
  const isTlsTrust = /self[- ]signed certificate|unable to (verify|get) .*certificate|certificate has expired|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|ERR_TLS_CERT_ALTNAME_INVALID/i.test(`${code} ${msg}`);
  if (status === 404 || status === 503 || isCapabilityUnavailable || (status === 403 && hasMed170) || isConnRefused || isDns || isTlsTrust) {
    const detailMsg = msg ? ` (${msg})` : '';
    return {
      category: 'never_reached',
      status: 503,
      message: `SAP S/4HANA service unreachable or posting capability unavailable${detailMsg}. The posting was not made and can be tried again.`,
      definitive: true,
      details
    };
  }

  // 2. Plain 403 (authorization error pointing to SU53)
  if (status === 403) {
    const detailMsg = msg ? ` (${msg})` : '';
    return {
      category: 'auth_error',
      status: 403,
      message: `Authorization failed for SAP Goods Issue posting${detailMsg}. Please check your SAP authorizations in transaction SU53.`,
      definitive: true,
      details
    };
  }

  // 3. Unknown outcome (timeout, reset, socket hang up, 502/504, 2xx without document)
  const isTimeout = ['ETIMEDOUT', 'ESOCKETTIMEDOUT'].includes(code) || /timeout|timed? ?out/i.test(msg);
  const isReset = code === 'ECONNRESET' || /connection reset|socket hang up/i.test(msg);
  const isUnknownCode = UNCONFIRMED_CODES.includes(err?.code);
  if (status === 502 || status === 504 || isTimeout || isReset || isUnknownCode) {
    let unconfirmedMsg;
    if (msg && (/may or may not have been posted|may still appear|may have been posted/i.test(msg)) && /do not post again/i.test(msg)) {
      unconfirmedMsg = msg;
    } else {
      const detailMsg = msg ? ` (${msg})` : '';
      unconfirmedMsg = `Posting outcome unconfirmed in SAP S/4HANA${detailMsg}. The goods issue may have been posted in SAP. Please do not post again.`;
    }
    return {
      category: 'unknown_outcome',
      status: status || 504,
      message: unconfirmedMsg,
      definitive: false,
      details
    };
  }

  // 4. Only an explicit SAP 4xx answer is a definitive rejection. A 500 or a status-less error
  //    does not prove that nothing was committed in SAP, so it stays an unknown outcome.
  if (!(status >= 400 && status < 500)) {
    const detailMsg = msg ? ` (${msg})` : '';
    return {
      category: 'unknown_outcome',
      status: status || 500,
      message: `Posting outcome unconfirmed in SAP S/4HANA${detailMsg}. The goods issue may have been posted in SAP. Please do not post again.`,
      definitive: false,
      details
    };
  }

  // 5. Rejected by SAP (400, 409, 422, sap-message error)
  return {
    category: 'rejected_by_sap',
    status,
    message: msg || 'Validation failed for Goods Issue in SAP S/4HANA',
    definitive: true,
    details
  };
}

module.exports = { classifyPostingError };
