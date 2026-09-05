const cds = require('@sap/cds');
const connectivity = require('@sap-cloud-sdk/connectivity');

/**
 * Adapter class to encapsulate authentication and credential validation
 * against SAP S/4HANA Gateway catalog service.
 *
 * Keeps technical S/4 communication strictly within srv/integration/s4hana/
 * per architectural boundaries.
 */
class AuthAdapter {
  constructor() {
    this.destinationName = process.env.S4_DESTINATION_NAME || 'S4HANA_PO_API';
  }

  /**
   * Resolves the S/4HANA base URL from BTP Destination Service,
   * environment variables, or cds.env credentials.
   *
   * @returns {Promise<string|null>} Base URL (e.g., "http://172.27.100.32:8000")
   */
  async resolveBaseUrl() {
    // 1. Direct environment variable (standard in local dev .env.local)
    if (process.env.S4_DESTINATION_URL) {
      return process.env.S4_DESTINATION_URL.replace(/\/+$/, '');
    }

    // 2. BTP Destination resolution via Cloud SDK
    try {
      const dest = await connectivity.getDestination({ destinationName: this.destinationName });
      if (dest && dest.url) {
        return dest.url.replace(/\/+$/, '');
      }
    } catch (err) {
      // In local dev without BTP Destination service, continue to fallback
    }

    // 3. Fallback to cds.env credentials
    const creds = cds.env.requires?.MM_PUR_PO_MAINT_V2_SRV?.credentials ||
                  cds.env.requires?.C_PURCHASEORDER_FS_SRV?.credentials;
    if (creds && creds.url) {
      return creds.url.replace(/\/+$/, '');
    }

    return null;
  }

  /**
   * Validates user credentials against S/4HANA Gateway Catalog Service.
   * Performs a safe read-only catalog query with HTTP Basic authentication.
   *
   * @param {string} username - S/4 user ID / logon name
   * @param {string} password - S/4 user password
   * @param {Object} [options] - Optional overrides for testing/configuration
   * @param {string} [options.baseUrl] - Direct S/4 base URL override
   * @param {string} [options.client] - SAP client override
   * @param {Function} [options.fetchFn] - Custom fetch implementation
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

    const baseUrl = options.baseUrl || (await this.resolveBaseUrl());
    if (!baseUrl) {
      console.error('[AuthAdapter] S/4HANA destination URL is not configured.');
      return {
        authenticated: false,
        statusCode: 500,
        message: 'S/4HANA system is not configured. Contact your administrator.'
      };
    }

    const sValidationUrl = `${baseUrl}/sap/opu/odata/IWFND/CATALOGSERVICE;v=2/ServiceCollection?$top=1&sap-client=${sClient}`;
    const fetchImpl = options.fetchFn || globalThis.fetch;

    let response;
    try {
      const sAuthHeader = 'Basic ' + Buffer.from(`${sUser}:${sPass}`).toString('base64');
      response = await fetchImpl(sValidationUrl, {
        method: 'GET',
        headers: {
          Authorization: sAuthHeader,
          Accept: 'application/json'
        }
      });
    } catch (err) {
      console.error('[AuthAdapter] S/4HANA connection error:', err.message);
      return {
        authenticated: false,
        statusCode: 503,
        message: 'Cannot connect to S/4HANA system. Please check network connectivity and try again.'
      };
    }

    if (response.ok) {
      return {
        authenticated: true,
        statusCode: response.status,
        message: 'Authentication successful.',
        system: `PRD - Client ${sClient}`,
        client: sClient
      };
    }

    if (response.status === 401 || response.status === 403) {
      return {
        authenticated: false,
        statusCode: response.status,
        message: 'Invalid username or password. S/4HANA logon failed (check credentials or SU01 lock status).'
      };
    }

    console.error(`[AuthAdapter] Unexpected S/4 response: ${response.status}`);
    return {
      authenticated: false,
      statusCode: response.status,
      message: `S/4HANA system returned an unexpected response (HTTP ${response.status}). Please try again.`
    };
  }
}

const defaultAuthAdapter = new AuthAdapter();
defaultAuthAdapter.AuthAdapter = AuthAdapter;

module.exports = defaultAuthAdapter;
