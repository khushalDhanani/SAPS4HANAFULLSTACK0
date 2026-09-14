/**
 * SessionContext
 *
 * Encapsulates per-request, transient session state (CSRF tokens, cookies, draft identifiers)
 * for S/4HANA OData V2 draft transactions.
 *
 * Designed to prevent state leakage and race conditions in concurrent multi-tenant execution
 * by eliminating shared adapter-level instance properties (such as this._csrfToken / this._csrfCookie).
 */
class SessionContext {
  /**
   * @param {Object} [init]
   * @param {string|null} [init.cookie]
   * @param {string|null} [init.token]
   * @param {string|null} [init.draftUUID]
   * @param {Object|null} [init.draftData]
   */
  constructor({ cookie = null, token = null, draftUUID = null, draftData = null } = {}) {
    this.cookie = cookie;
    this.token = token;
    this.csrfToken = token; // Alias for semantic clarity
    this.draftUUID = draftUUID;
    this.draftData = draftData;
  }

  /**
   * Extracts cookie string and CSRF token from an HTTP response object.
   * Handles Set-Cookie arrays, comma-delimited strings, and request/response header headers.
   *
   * @param {Object} response - HTTP response object from Cloud SDK or Axios
   * @param {Object} [extraData] - Additional payload metadata (e.g. draftUUID, draftData)
   * @returns {SessionContext}
   */
  static fromResponse(response, extraData = {}) {
    if (!response) {
      return new SessionContext(extraData);
    }

    // 1. Extract cookies from response (Set-Cookie headers issued by S/4 Gateway)
    let responseCookies = [];
    const rawSetCookie = response.headers?.['set-cookie'] ||
                         (typeof response.headers?.getSetCookie === 'function' ? response.headers.getSetCookie() : null);

    if (Array.isArray(rawSetCookie)) {
      responseCookies = rawSetCookie;
    } else if (typeof rawSetCookie === 'string') {
      responseCookies = rawSetCookie.split(/,(?=\s*[A-Za-z0-9_-]+=)/);
    }

    const formattedResponseCookie = responseCookies
      .map(c => c.split(';')[0].trim())
      .filter(Boolean)
      .join('; ');

    // 2. Extract request cookies if present on the outgoing request
    const req = response.request;
    const reqCookie = req?.getHeader ? req.getHeader('cookie') : req?._headers?.cookie;

    // Merge cookies: request cookies + newly issued server cookies
    const cookieParts = [reqCookie, formattedResponseCookie].filter(Boolean);
    const finalCookie = cookieParts.length > 0 ? cookieParts.join('; ') : null;

    // 3. Extract CSRF token from response or request
    const token = (response.headers && response.headers['x-csrf-token']) ||
                  (typeof response.headers?.get === 'function' ? response.headers.get('x-csrf-token') : null) ||
                  (req?.getHeader ? req.getHeader('x-csrf-token') : req?._headers?.['x-csrf-token']) ||
                  null;

    return new SessionContext({
      cookie: finalCookie,
      token,
      draftUUID: extraData.draftUUID,
      draftData: extraData.draftData
    });
  }
}

module.exports = SessionContext;
