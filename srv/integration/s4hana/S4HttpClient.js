'use strict';

const LOG = require('../../common/logger')('s4-client');
const connectivity = require('@sap-cloud-sdk/connectivity');
const httpClient = require('@sap-cloud-sdk/http-client');
const SessionContext = require('./SessionContext');

const {
  DESTINATION_NOT_CONFIGURED,
  DESTINATION_LOOKUP_FAILED,
  CSRF_TOKEN_UNAVAILABLE,
  S4HttpError,
  responseOf,
  codeOf,
  unansweredWrite,
  toS4HttpError,
} = require('./S4HttpErrors');

const {
  serviceRootOf,
  joinQuery,
  withoutHeaders,
  sapClientHeader,
  extractUserJwt,
  requestTimeoutMs,
} = require('./S4HttpUtils');

const {
  resolveDestination,
  requireDestination,
} = require('./S4DestinationResolver');

/**
 * S4HttpClient
 *
 * The one HTTP client for direct calls from this application to SAP S/4HANA Gateway. Every request goes
 * through the SAP Cloud SDK (`executeHttpRequest`), which is what makes BTP destinations work end to end:
 * destination lookup, Basic / principal-propagation / OAuth credentials, and the Connectivity proxy plus
 * the headers an on-premise (Cloud Connector) destination requires. Raw `fetch` bypasses all of that.
 *
 * Session handling is per call: a transactional POST fetches its CSRF token and SAP session cookies
 * immediately before it is sent and passes them along in the same request. No token or cookie is ever
 * stored on a shared instance, so concurrent requests cannot leak SAP sessions into each other.
 */
class S4HttpClient {
  /**
   * @param {Object} [deps]
   * @param {string} [deps.destinationName] - Destination name (default: S4_DESTINATION_NAME; none -> local S4_DESTINATION_URL configuration)
   * @param {Function} [deps.getDestination] - SDK destination lookup (tests)
   * @param {Function} [deps.executeHttpRequest] - SDK request executor (tests)
   * @param {Object} [deps.env] - Environment object (default: process.env; tests)
   * @param {Function} [deps.cdsRequires] - Returns cds.env.requires (tests)
   */
  constructor({ destinationName, getDestination, executeHttpRequest, env, cdsRequires } = {}) {
    this._env = env || process.env;
    this.destinationName = destinationName || this._env.S4_DESTINATION_NAME || '';
    this._customGetDestination = getDestination;
    this._customExecute = executeHttpRequest;
    this._cdsRequires = cdsRequires || (() => require('@sap/cds').env.requires);
  }

  get _getDestination() {
    return this._customGetDestination || connectivity.getDestination;
  }

  get _execute() {
    return this._customExecute || httpClient.executeHttpRequest;
  }

  static requestTimeoutMs() {
    return requestTimeoutMs();
  }

  static extractUserJwt(options = {}) {
    return extractUserJwt(options);
  }

  static sapClientHeader(destination) {
    return sapClientHeader(destination);
  }

  static toS4HttpError(err, method, path) {
    return toS4HttpError(err, method, path);
  }

  async resolveDestination(options = {}) {
    return resolveDestination(this, options);
  }

  async _requireDestination(options = {}) {
    return requireDestination(this, options);
  }

  /**
   * HTTP GET.
   *
   * @param {string} path - Absolute Gateway path, e.g. /sap/opu/odata/sap/SERVICE/EntitySet
   * @param {Object} [options]
   * @returns {Promise<{ status: number, data: any, headers: Object }>}
   */
  async get(path, options = {}) {
    const { query = '', headers = {}, accept = 'application/json', responseType } = options;
    const destination = await this._requireDestination(options);
    const requestConfig = {
      method: 'get',
      url: joinQuery(path, query),
      timeout: S4HttpClient.requestTimeoutMs(),
      headers: { Accept: accept, ...S4HttpClient.sapClientHeader(destination), ...withoutHeaders(headers, ['authorization']) },
      ...(responseType ? { responseType } : {}),
    };
    return this._send(destination, requestConfig, 'GET', path, options);
  }

  /**
   * HTTP GET returning the raw body as text (e.g. an OData $metadata document).
   *
   * @param {string} path
   * @param {Object} [options]
   * @returns {Promise<string>}
   */
  async getText(path, options = {}) {
    const { accept = 'application/xml, text/xml;q=0.9, */*;q=0.1', headers = {} } = options;
    const res = await this.get(path, { ...options, accept, headers, responseType: 'text' });
    if (typeof res.data === 'string') return res.data;
    return res.data == null ? '' : JSON.stringify(res.data);
  }

  /**
   * Fetches a CSRF token and the SAP session cookies with one GET on `csrfPath`.
   * Fails closed: when the fetch fails and yields no token, it throws CSRF_TOKEN_UNAVAILABLE and the caller
   * sends nothing to SAP. A successful answer that carries no token is passed on (the service issued none).
   *
   * @param {string} csrfPath
   * @param {Object} [destination] - Already resolved destination
   * @param {Object} [options] - Options including userJwt, executeHttpRequest
   * @returns {Promise<SessionContext>}
   */
  async fetchCsrfSession(csrfPath, destination, options = {}) {
    const dest = destination || await this._requireDestination(options);
    const userJwt = S4HttpClient.extractUserJwt(options);
    const executeFn = options.executeHttpRequest || this._execute;
    const requestConfig = {
      method: 'get',
      url: csrfPath,
      timeout: S4HttpClient.requestTimeoutMs(),
      headers: {
        'x-csrf-token': 'Fetch',
        Accept: (csrfPath && csrfPath.includes('$metadata')) ? 'application/xml, text/xml, */*' : 'application/json, */*',
        ...S4HttpClient.sapClientHeader(dest),
      },
    };
    try {
      const res = await executeFn(dest, requestConfig, {
        fetchCsrfToken: false,
        ...(userJwt ? { userJwt } : {}),
      });
      return SessionContext.fromResponse(res);
    } catch (err) {
      const response = responseOf(err);
      const session = response ? SessionContext.fromResponse(response) : new SessionContext();
      if (!session.token) {
        const status = response?.status;
        LOG.warn(`CSRF token fetch on ${csrfPath} failed (${status || codeOf(err) || err.message}); the request is not sent.`);
        // 4xx is SAP's own answer; anything else means SAP was not reached for this write (503 = never sent).
        throw new S4HttpError(`No CSRF token could be obtained from SAP S/4HANA (${status ? `HTTP ${status}` : (codeOf(err) || 'no response')}); the request was NOT sent.`, {
          status: status >= 400 && status < 500 ? status : 503,
          code: CSRF_TOKEN_UNAVAILABLE,
          method: 'GET',
          path: csrfPath,
          cause: err,
        });
      }
      return session;
    }
  }

  /**
   * HTTP POST with per-call CSRF token and session cookies.
   *
   * @param {string} path - Absolute Gateway path
   * @param {Object} [options]
   * @returns {Promise<{ status: number, data: any, headers: Object }>}
   */
  async post(path, options = {}) {
    const { data = {}, headers = {}, csrfPath } = options;
    const destination = await this._requireDestination(options);
    const session = await this.fetchCsrfSession(csrfPath || serviceRootOf(path), destination, options);
    const cleanHeaders = withoutHeaders(headers, ['x-csrf-token', 'cookie', 'authorization']);

    const resolvedIfMatch = options.ifMatch || options.etag || cleanHeaders['if-match'] || cleanHeaders['If-Match'];
    if (resolvedIfMatch) {
      delete cleanHeaders['if-match'];
      cleanHeaders['If-Match'] = resolvedIfMatch;
    }

    const requestConfig = {
      method: 'post',
      url: path,
      data,
      timeout: S4HttpClient.requestTimeoutMs(),
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...S4HttpClient.sapClientHeader(destination),
        ...(session.token ? { 'x-csrf-token': session.token } : {}),
        ...(session.cookie ? { Cookie: session.cookie } : {}),
        ...cleanHeaders,
      },
    };
    try {
      return await this._send(destination, requestConfig, 'POST', path, options);
    } catch (err) {
      throw unansweredWrite(err) || err;
    }
  }

  async _send(destination, requestConfig, method, path, options = {}) {
    const userJwt = S4HttpClient.extractUserJwt(options);
    const executeFn = options.executeHttpRequest || this._execute;
    try {
      return await executeFn(destination, requestConfig, {
        fetchCsrfToken: false,
        ...(userJwt ? { userJwt } : {}),
      });
    } catch (err) {
      throw S4HttpClient.toS4HttpError(err, method, path);
    }
  }
}

module.exports = {
  S4HttpClient,
  S4HttpError,
  unansweredWrite,
  serviceRootOf,
  joinQuery,
  DESTINATION_NOT_CONFIGURED,
  DESTINATION_LOOKUP_FAILED,
  CSRF_TOKEN_UNAVAILABLE,
};
