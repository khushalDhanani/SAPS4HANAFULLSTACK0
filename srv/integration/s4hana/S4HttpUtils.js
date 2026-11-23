'use strict';

const cds = require('@sap/cds');
const connectivity = require('@sap-cloud-sdk/connectivity');

/** Remote services whose locally configured credentials may serve as the last-resort fallback. */
const LOCAL_CREDENTIAL_SOURCES = ['MM_PUR_PO_MAINT_V2_SRV', 'C_PURCHASEORDER_FS_SRV'];

function stripTrailingSlashes(url) {
  return String(url || '').replace(/\/+$/, '');
}

/** Origin of a URL that may carry a service path (e.g. cds.env remote service credentials). */
function originOf(url) {
  try {
    return new URL(url).origin;
  } catch (_) {
    return stripTrailingSlashes(url);
  }
}

/**
 * Service root of an SAP Gateway path, used as the default CSRF token fetch target:
 *   /sap/opu/odata/sap/SERVICE/EntitySet(...)            -> /sap/opu/odata/sap/SERVICE/
 *   /sap/opu/odata/scwm/SERVICE/EntitySet                 -> /sap/opu/odata/scwm/SERVICE/
 *   /sap/opu/odata4/sap/name/srvd/sap/name/0001/Entity   -> /sap/opu/odata4/sap/name/srvd/sap/name/0001/
 * Any other path is returned unchanged.
 *
 * @param {string} path
 * @returns {string}
 */
function serviceRootOf(path) {
  const v4 = /^(\/sap\/opu\/odata4\/[^/]+\/[^/]+\/srvd(?:_a2x)?\/[^/]+\/[^/]+\/[^/?]+)/i.exec(path || '');
  if (v4) return `${v4[1]}/`;
  const v2 = /^(\/sap\/opu\/odata\/[^/]+\/[^/?]+)/i.exec(path || '');
  if (v2) return `${v2[1]}/`;
  return path;
}

/**
 * Appends a query string to a path, tolerating a leading '?' or '&' on the query and a path that
 * already carries a query.
 */
function joinQuery(path, query) {
  const q = String(query || '').replace(/^[?&]+/, '');
  if (!q) return path;
  return `${path}${path.includes('?') ? '&' : '?'}${q}`;
}

/** Removes caller headers this client or the destination must own. HTTP header names ignore case. */
const withoutHeaders = (headers, names) => Object.fromEntries(
  Object.entries(headers).filter(([name]) => !names.includes(name.toLowerCase()))
);

/** `sap-client` request header for a destination, when the destination names a client. */
function sapClientHeader(destination) {
  const client = destination?.sapClient || destination?.headers?.['sap-client'];
  return client ? { 'sap-client': String(client) } : {};
}

/**
 * Extracts caller's JWT from options or current CAP request context.
 * Enables Principal Propagation to S/4HANA via SAP Cloud Connector.
 *
 * @param {Object} [options]
 * @returns {string|undefined}
 */
function extractUserJwt(options = {}) {
  if (options.userJwt) return options.userJwt;
  if (options.jwt) return options.jwt;
  const req = cds.context?.http?.req || cds.context?.req;
  if (req) {
    const jwt = connectivity.retrieveJwt(req);
    if (jwt) return jwt;
  }
  if (cds.context?.user?.token) {
    return cds.context.user.token;
  }
  return undefined;
}

/**
 * Per-request timeout in ms (S4_HTTP_TIMEOUT_MS, default 30000) so a hung S/4 call fails instead of
 * blocking the CAP request forever. No automatic retry: POSTs are not idempotent (double postings).
 */
function requestTimeoutMs() {
  const n = Number(process.env.S4_HTTP_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 30000;
}

module.exports = {
  LOCAL_CREDENTIAL_SOURCES,
  stripTrailingSlashes,
  originOf,
  serviceRootOf,
  joinQuery,
  withoutHeaders,
  sapClientHeader,
  extractUserJwt,
  requestTimeoutMs,
};
