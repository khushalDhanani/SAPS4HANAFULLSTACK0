const cds = require('@sap/cds');
const connectivity = require('@sap-cloud-sdk/connectivity');
const httpClient = require('@sap-cloud-sdk/http-client');

/**
 * Adapter class to encapsulate authentication and credential validation
 * against SAP S/4HANA Gateway catalog service using SAP Cloud SDK.
 *
 * Keeps technical S/4 communication strictly within srv/integration/s4hana/
 * per architectural boundaries.
 */
class AuthAdapter {
  constructor() {
    this.destinationName = process.env.S4_DESTINATION_NAME || 'S4HANA_PO_API';
  }

  /**
   * Resolves destination for S/4HANA communication using SAP Cloud SDK.
   * Prioritizes BTP Destination Service, with local fallback for offline development.
   *
   * @param {Object} [options]
   * @returns {Promise<Object|null>}
   */
  async _getDestination(options = {}) {
    if (options.destination) return options.destination;

    // 1. BTP Destination resolution via Cloud SDK (primary in deployed environments)
    try {
      const dest = await connectivity.getDestination({ destinationName: this.destinationName });
      if (dest && dest.url) {
        return dest;
      }
    } catch (err) {
      // In local development without BTP Destination service, continue to fallback
    }

    // 2. Direct environment variable (standard in local dev .env)
    if (process.env.S4_DESTINATION_URL) {
      return {
        url: process.env.S4_DESTINATION_URL.replace(/\/+$/, ''),
        username: process.env.S4_USERNAME,
        password: process.env.S4_PASSWORD,
        headers: { 'sap-client': process.env.S4_CLIENT || '220' }
      };
    }

    // 3. Fallback to cds.env credentials
    const creds = cds.env.requires?.MM_PUR_PO_MAINT_V2_SRV?.credentials ||
                  cds.env.requires?.C_PURCHASEORDER_FS_SRV?.credentials;
    if (creds && creds.url) {
      return {
        url: creds.url.replace(/\/+$/, ''),
        username: creds.username,
        password: creds.password,
        headers: creds.headers || {}
      };
    }

    return null;
  }

  /**
   * Resolves the S/4HANA base URL.
   *
   * @param {Object} [options]
   * @returns {Promise<string|null>} Base URL (e.g., "https://s4hana.example.corp:44300")
   */
  async resolveBaseUrl(options = {}) {
    if (options.baseUrl) return options.baseUrl.replace(/\/+$/, '');
    const dest = await this._getDestination(options);
    return dest && dest.url ? dest.url.replace(/\/+$/, '') : null;
  }

  /**
   * Adapter helper to support legacy fetch mock functions in tests.
   *
   * @private
   */
  _adaptFetch(fetchFn) {
    return async (destination, requestConfig) => {
      const fullUrl = destination.url + requestConfig.url;
      const sAuthHeader = 'Basic ' + Buffer.from(`${destination.username}:${destination.password}`).toString('base64');
      const resp = await fetchFn(fullUrl, {
        method: (requestConfig.method || 'GET').toUpperCase(),
        headers: {
          Authorization: sAuthHeader,
          Accept: 'application/json',
          ...(requestConfig.headers || {})
        }
      });
      if (!resp.ok) {
        const error = new Error(`Request failed with status code ${resp.status}`);
        error.response = { status: resp.status, data: resp.data };
        throw error;
      }
      return { status: resp.status, data: resp.data };
    };
  }

  /**
   * Validates user credentials against S/4HANA Gateway Catalog Service.
   * Performs a safe read-only catalog query via SAP Cloud SDK HTTP client.
   *
   * @param {string} username - S/4 user ID / logon name
   * @param {string} password - S/4 user password
   * @param {Object} [options] - Optional overrides for testing/configuration
   * @param {string} [options.baseUrl] - Direct S/4 base URL override
   * @param {string} [options.client] - SAP client override
   * @param {Object} [options.destination] - Destination object override
   * @param {Function} [options.executeHttpRequest] - Custom HTTP execution function
   * @param {Function} [options.fetchFn] - Legacy fetch function mock for backward test compatibility
   * @returns {Promise<{ authenticated: boolean, statusCode: number, message: string, system?: string, client?: string }>}
   */
  async validateCredentials(username, password, options = {}) {
    if (!username || !username.trim()) {
      return {
        authenticated: false,
        statusCode: 400,
        message: 'Username is required.'
      };
    }
    if (!password || !password.trim()) {
      return {
        authenticated: false,
        statusCode: 400,
        message: 'Password is required.'
      };
    }

    const sUser = username.trim();
    const sPass = password.trim();
    const sClient = options.client || process.env.S4_CLIENT || '220';

    const baseDest = options.destination || (await this._getDestination(options));
    const baseUrl = options.baseUrl || (baseDest && baseDest.url);

    if (!baseUrl) {
      console.error('[AuthAdapter] S/4HANA destination URL is not configured.');
      return {
        authenticated: false,
        statusCode: 500,
        message: 'S/4HANA system is not configured. Contact your administrator.'
      };
    }

    // Build target destination with caller credentials managed by SAP Cloud SDK
    const targetDestination = {
      ...(baseDest || {}),
      url: baseUrl.replace(/\/+$/, ''),
      username: sUser,
      password: sPass,
      authentication: 'BasicAuthentication'
    };

    const executeFn = options.executeHttpRequest || (options.fetchFn ? this._adaptFetch(options.fetchFn) : httpClient.executeHttpRequest);

    try {
      const response = await executeFn(targetDestination, {
        method: 'get',
        url: `/sap/opu/odata/IWFND/CATALOGSERVICE;v=2/ServiceCollection?$top=1&sap-client=${sClient}`,
        headers: {
          'Accept': 'application/json'
        }
      }, { fetchCsrfToken: false });

      const status = response.status || 200;
      if (status >= 200 && status < 300) {
        return {
          authenticated: true,
          statusCode: status,
          message: 'Authentication successful.',
          system: `PRD - Client ${sClient}`,
          client: sClient
        };
      }
    } catch (err) {
      const status = err.response?.status;
      if (status === 401 || status === 403) {
        return {
          authenticated: false,
          statusCode: status,
          message: 'Invalid username or password. S/4HANA logon failed (check credentials or SU01 lock status).'
        };
      }

      if (!err.response) {
        console.error('[AuthAdapter] S/4HANA connection error:', err.message);
        return {
          authenticated: false,
          statusCode: 503,
          message: 'Cannot connect to S/4HANA system. Please check network connectivity and try again.'
        };
      }

      console.error(`[AuthAdapter] Unexpected S/4 response: ${status}`);
      return {
        authenticated: false,
        statusCode: status,
        message: `S/4HANA system returned an unexpected response (HTTP ${status}). Please try again.`
      };
    }
  }
}

const defaultAuthAdapter = new AuthAdapter();
defaultAuthAdapter.AuthAdapter = AuthAdapter;

module.exports = defaultAuthAdapter;
