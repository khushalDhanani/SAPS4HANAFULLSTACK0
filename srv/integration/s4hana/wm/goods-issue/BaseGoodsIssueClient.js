const LOG = require('../../logger')('goods-issue-client');
const S4ErrorMapper = require('../../S4ErrorMapper');
const { S4HttpClient, DESTINATION_NOT_CONFIGURED } = require('../../S4HttpClient');
const { enrichBatchStatus } = require('../../../../common/batchUtils');
const { formatDateToYMD } = require('../../../../common/dateUtils');

/**
 * Base client for modular Goods Issue domain clients.
 * Provides unified HTTP delegation, outage detection, and utility methods.
 */
class BaseGoodsIssueClient {
  constructor(options = {}) {
    this.adapter = options.adapter || null;
    this.client = options.client || (options.adapter && options.adapter.client) || new S4HttpClient();
    this.destinationName = this.client.destinationName;
  }

  /**
   * Determine if an error represents an S/4HANA backend outage, network timeout,
   * unconfigured destination, or authentication failure.
   */
  _isOutage(err) {
    if (this.adapter && typeof this.adapter._isOutage === 'function') {
      return this.adapter._isOutage(err);
    }
    if (!err) return false;
    if (err.code === DESTINATION_NOT_CONFIGURED || err.code === 'DESTINATION_NOT_CONFIGURED' || err.code === 'S4_DESTINATION_NOT_CONFIGURED') return true;
    const status = err.status || err.statusCode || err.response?.status;
    if (status && (status === 502 || status === 503 || status === 504 || status === 500 || status === 401 || status === 403)) {
      return true;
    }
    const code = String(err.code || err.cause?.code || '').toUpperCase();
    if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ENOTFOUND' || code === 'ECONNRESET') {
      return true;
    }
    const msg = String(err.message || '').toLowerCase();
    if (
      msg.includes('destination') ||
      msg.includes('network error') ||
      msg.includes('connection refused') ||
      msg.includes('etimedout') ||
      msg.includes('econnrefused') ||
      msg.includes('enotfound')
    ) {
      return true;
    }
    return false;
  }

  /**
   * Enrich batch object with SLED classification against current date (delegates to shared batchUtils)
   */
  _enrichBatchStatus(expiryDate) {
    return enrichBatchStatus(expiryDate);
  }

  /**
   * Format OData date string to ISO YYYY-MM-DD (delegates to shared dateUtils)
   */
  _formatDate(dateVal) {
    return formatDateToYMD(dateVal);
  }

  /**
   * Resolve the S/4HANA destination through the shared client.
   */
  async _getDestination() {
    if (this.adapter && typeof this.adapter._getDestination === 'function') {
      return this.adapter._getDestination();
    }
    return this.client.resolveDestination();
  }

  /**
   * HTTP GET against an S/4HANA OData service.
   * Delegates to adapter if present so that Jest spies on adapter._get intercept.
   */
  async _get(servicePath, queryParams = '', options = null) {
    if (this.adapter && typeof this.adapter._get === 'function') {
      return (options && Object.keys(options).length > 0)
        ? this.adapter._get(servicePath, queryParams, options)
        : this.adapter._get(servicePath, queryParams);
    }
    try {
      const getOpts = { query: queryParams, ...(options || {}) };
      const { data } = await this.client.get(servicePath, getOpts);
      return data?.d?.results || data?.d || data?.value || [];
    } catch (err) {
      if (err.name === 'AbortError' || err.code === 'ERR_CANCELED') throw err;
      if (err.code === DESTINATION_NOT_CONFIGURED) throw err;
      throw S4ErrorMapper.mapS4Error(err);
    }
  }

  /**
   * Derives a CSRF probe path scoped to the SAME service the caller is about to POST to (the service
   * root document), instead of a hardcoded, unrelated service. Fetching the CSRF token from a
   * different service than the transactional POST target has caused cross-service CSRF token
   * rejection on this SAP system before (see GoodsReceiptAdapter's own CSRF fetch path being
   * "harmonized" with its POST target for the same reason).
   *
   * The service root ("/<service>/") is a safe, side-effect-free GET that returns a CSRF token for
   * any POST target on the service (entity-set deep insert OR function import such as Cancel), and is
   * ~360x smaller than the service `$metadata` document it previously fetched on every POST
   * (verified live: service root ~107 bytes vs `$metadata` ~38 KB, both returning a token).
   *
   * @private
   */
  static _deriveCsrfPath(servicePath, fallback) {
    try {
      const withoutQuery = String(servicePath || '').split('?')[0];
      const parenIdx = withoutQuery.indexOf('(');
      const basePart = parenIdx === -1 ? withoutQuery : withoutQuery.slice(0, parenIdx);
      const segments = basePart.split('/').filter(Boolean);
      if (segments.length < 2) return fallback;
      segments.pop(); // drop the entity set / function import / action segment, keep the service root
      return '/' + segments.join('/') + '/';
    } catch (_e) {
      return fallback;
    }
  }

  /**
   * HTTP POST against an S/4HANA OData service.
   * Delegates to adapter if present so that Jest spies on adapter._post intercept.
   * Attaches the raw HTTP response headers to the returned result as `_headers` (mirroring
   * GoodsReceiptAdapter._post) so callers can inspect the SAP Gateway `sap-message` header:
   * SAP Gateway can answer a POST with HTTP 2xx even when the backend BAPI rejected the posting
   * for a business reason, communicating the real outcome only via that header.
   */
  async _post(servicePath, payload = {}, customHeaders = {}) {
    if (this.adapter && typeof this.adapter._post === 'function') {
      return this.adapter._post(servicePath, payload, customHeaders);
    }
    const fallbackCsrfPath = '/sap/opu/odata/sap/MMIM_GR4PO_DL_SRV/HMmimGr4inbdelSet?$top=1';
    const csrfPath = BaseGoodsIssueClient._deriveCsrfPath(servicePath, fallbackCsrfPath);
    const { data, headers } = await this.client.post(servicePath, {
      data: payload,
      headers: customHeaders,
      csrfPath
    });
    if (data && typeof data === 'object') {
      const res = data.d || data;
      if (res && typeof res === 'object' && headers) {
        res._headers = headers;
      }
      return res;
    }
    return true;
  }
}

module.exports = BaseGoodsIssueClient;
