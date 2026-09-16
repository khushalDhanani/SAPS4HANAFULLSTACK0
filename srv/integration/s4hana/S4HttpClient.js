const cds = require('@sap/cds');
const LOG = require('../../common/logger')('s4-client');
const connectivity = require('@sap-cloud-sdk/connectivity');
const httpClient = require('@sap-cloud-sdk/http-client');
const SessionContext = require('./SessionContext');

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
 *
 * Destination resolution order:
 *   1. SAP Cloud SDK `getDestination` (BTP Destination service, or a destination registered locally in
 *      server.js for development)
 *   2. S4_DESTINATION_URL / S4_USERNAME / S4_PASSWORD / S4_CLIENT from the local environment
 *   3. Credentials configured on a remote service in cds.env (origin only)
 */

const DEFAULT_DESTINATION_NAME = 'S4HANA_PO_API';

/** Remote services whose locally configured credentials may serve as the last-resort fallback. */
const LOCAL_CREDENTIAL_SOURCES = ['MM_PUR_PO_MAINT_V2_SRV', 'C_PURCHASEORDER_FS_SRV'];

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

/** SAP OData error message and code from a response body (V2 `message.value` or V4 `message`). */
function sapMessageOf(body) {
    if (!body || typeof body !== 'object') return { message: '', code: '' };
    const error = body.error || {};
    let message = '';
    if (error.message && typeof error.message === 'object') message = error.message.value || '';
    else if (typeof error.message === 'string') message = error.message;
    return { message, code: error.code || '' };
}

class S4HttpClient {
    /**
     * @param {Object} [deps]
     * @param {string} [deps.destinationName] - Destination name (default: S4_DESTINATION_NAME or S4HANA_PO_API)
     * @param {Function} [deps.getDestination] - SDK destination lookup (tests)
     * @param {Function} [deps.executeHttpRequest] - SDK request executor (tests)
     * @param {Object} [deps.env] - Environment object (default: process.env; tests)
     * @param {Function} [deps.cdsRequires] - Returns cds.env.requires (tests)
     */
    constructor({ destinationName, getDestination, executeHttpRequest, env, cdsRequires } = {}) {
        this._env = env || process.env;
        this.destinationName = destinationName || this._env.S4_DESTINATION_NAME || DEFAULT_DESTINATION_NAME;
        this._customGetDestination = getDestination;
        this._customExecute = executeHttpRequest;
        this._cdsRequires = cdsRequires || (() => cds.env.requires);
    }

    get _getDestination() {
        return this._customGetDestination || connectivity.getDestination;
    }

    get _execute() {
        return this._customExecute || httpClient.executeHttpRequest;
    }

    /**
     * Extracts caller's JWT from options or current CAP request context.
     * Enables Principal Propagation to S/4HANA via SAP Cloud Connector.
     *
     * @param {Object} [options]
     * @returns {string|undefined}
     */
    static extractUserJwt(options = {}) {
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
     * Resolves the S/4HANA destination (see resolution order above).
     * Passes userJwt to support Principal Propagation destinations.
     *
     * @param {Object} [options]
     * @returns {Promise<Object|null>} Cloud SDK destination, or null when nothing is configured
     */
    async resolveDestination(options = {}) {
        if (options.destination) return options.destination;

        const userJwt = S4HttpClient.extractUserJwt(options);

        try {
            const dest = await this._getDestination({
                destinationName: this.destinationName,
                ...(userJwt ? { userJwt } : {})
            });
            if (dest && dest.url) return dest;
        } catch (_) {
            // No Destination service binding and no registered destination: use local configuration.
        }

        const env = this._env;
        if (env.S4_DESTINATION_URL) {
            return {
                url: stripTrailingSlashes(env.S4_DESTINATION_URL),
                username: env.S4_USERNAME,
                password: env.S4_PASSWORD,
                authentication: 'BasicAuthentication',
                ...(env.S4_CLIENT ? { sapClient: String(env.S4_CLIENT) } : {})
            };
        }

        const requires = this._cdsRequires() || {};
        for (const name of LOCAL_CREDENTIAL_SOURCES) {
            const creds = requires[name]?.credentials;
            if (creds && creds.url) {
                const sapClient = creds.headers?.['sap-client'] || creds.client;
                return {
                    url: originOf(creds.url),
                    username: creds.username,
                    password: creds.password,
                    authentication: 'BasicAuthentication',
                    ...(sapClient ? { sapClient: String(sapClient) } : {})
                };
            }
        }

        return null;
    }

    async _requireDestination(options = {}) {
        const dest = await this.resolveDestination(options);
        if (!dest) {
            throw new S4HttpError('S/4HANA Destination could not be resolved or is not configured', {
                status: 502,
                code: DESTINATION_NOT_CONFIGURED
            });
        }
        return dest;
    }

    /** `sap-client` request header for a destination, when the destination names a client. */
    static sapClientHeader(destination) {
        const client = destination?.sapClient || destination?.headers?.['sap-client'];
        return client ? { 'sap-client': String(client) } : {};
    }

    /**
     * HTTP GET.
     *
     * @param {string} path - Absolute Gateway path, e.g. /sap/opu/odata/sap/SERVICE/EntitySet
     * @param {Object} [options]
     * @param {string} [options.query] - Query string without leading '?'
     * @param {Object} [options.headers]
     * @param {string} [options.accept]
     * @param {string} [options.responseType] - axios responseType, e.g. 'text'
     * @param {string} [options.userJwt] - Explicit user JWT override for principal propagation
     * @param {Object} [options.destination] - Destination override
     * @param {Function} [options.executeHttpRequest] - SDK executor override
     * @returns {Promise<{ status: number, data: any, headers: Object }>}
     */
    async get(path, options = {}) {
        const { query = '', headers = {}, accept = 'application/json', responseType, userJwt } = options;
        const destination = await this._requireDestination(options);
        const requestConfig = {
            method: 'get',
            url: joinQuery(path, query),
            headers: { Accept: accept, ...S4HttpClient.sapClientHeader(destination), ...headers },
            ...(responseType ? { responseType } : {})
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
     * Fetches a CSRF token and the SAP session cookies with one GET on `csrfPath`. A failed probe is
     * reported and the call continues without a token: SAP then answers the real request with its own
     * verdict instead of the probe hiding it.
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
            headers: { 'x-csrf-token': 'Fetch', Accept: 'application/json', ...S4HttpClient.sapClientHeader(dest) }
        };
        try {
            const res = await executeFn(dest, requestConfig, {
                fetchCsrfToken: false,
                ...(userJwt ? { userJwt } : {})
            });
            return SessionContext.fromResponse(res);
        } catch (err) {
            const response = responseOf(err);
            const session = response ? SessionContext.fromResponse(response) : new SessionContext();
            if (!session.token) {
                LOG.warn(`CSRF token fetch on ${csrfPath} failed (${response?.status || codeOf(err) || err.message}); continuing without a token.`);
            }
            return session;
        }
    }

    /**
     * HTTP POST with per-call CSRF token and session cookies.
     *
     * @param {string} path - Absolute Gateway path (may carry function-import parameters after '?')
     * @param {Object} [options]
     * @param {any} [options.data] - JSON body
     * @param {Object} [options.headers] - Additional headers (e.g. If-Match); override the defaults
     * @param {string} [options.csrfPath] - Where to fetch the CSRF token (default: service root of path)
     * @param {string} [options.userJwt] - Explicit user JWT override for principal propagation
     * @param {Object} [options.destination] - Destination override
     * @param {Function} [options.executeHttpRequest] - SDK executor override
     * @returns {Promise<{ status: number, data: any, headers: Object }>}
     */
    async post(path, options = {}) {
        const { data = {}, headers = {}, csrfPath, userJwt } = options;
        const destination = await this._requireDestination(options);
        const session = await this.fetchCsrfSession(csrfPath || serviceRootOf(path), destination, options);
        const requestConfig = {
            method: 'post',
            url: path,
            data,
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                ...S4HttpClient.sapClientHeader(destination),
                ...(session.token ? { 'x-csrf-token': session.token } : {}),
                ...(session.cookie ? { Cookie: session.cookie } : {}),
                ...headers
            }
        };
        return this._send(destination, requestConfig, 'POST', path, options);
    }

    async _send(destination, requestConfig, method, path, options = {}) {
        const userJwt = S4HttpClient.extractUserJwt(options);
        const executeFn = options.executeHttpRequest || this._execute;
        try {
            return await executeFn(destination, requestConfig, {
                fetchCsrfToken: false,
                ...(userJwt ? { userJwt } : {})
            });
        } catch (err) {
            throw S4HttpClient.toS4HttpError(err, method, path);
        }
    }

    /**
     * Normalises any Cloud SDK / axios / network failure into an S4HttpError.
     *
     * @param {Error} err
     * @param {string} method
     * @param {string} path
     * @returns {S4HttpError}
     */
    static toS4HttpError(err, method, path) {
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
            cause: err
        });
    }
}

module.exports = {
    S4HttpClient,
    S4HttpError,
    serviceRootOf,
    joinQuery,
    DESTINATION_NOT_CONFIGURED,
    DEFAULT_DESTINATION_NAME,
    LOCAL_CREDENTIAL_SOURCES
};
