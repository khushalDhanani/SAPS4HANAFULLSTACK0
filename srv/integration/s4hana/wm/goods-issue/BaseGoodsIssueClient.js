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
  async _get(servicePath, queryParams = '') {
    if (this.adapter && typeof this.adapter._get === 'function') {
      return this.adapter._get(servicePath, queryParams);
    }
    try {
      const { data } = await this.client.get(servicePath, { query: queryParams });
      return data?.d?.results || data?.d || data?.value || [];
    } catch (err) {
      if (err.code === DESTINATION_NOT_CONFIGURED) throw err;
      throw S4ErrorMapper.mapS4Error(err);
    }
  }

  /**
   * HTTP POST against an S/4HANA OData service.
   * Delegates to adapter if present so that Jest spies on adapter._post intercept.
   */
  async _post(servicePath, payload = {}, customHeaders = {}) {
    if (this.adapter && typeof this.adapter._post === 'function') {
      return this.adapter._post(servicePath, payload, customHeaders);
    }
    const csrfPath = '/sap/opu/odata/sap/MMIM_GR4PO_DL_SRV/HMmimGr4inbdelSet?$top=1';
    const { data } = await this.client.post(servicePath, {
      data: payload,
      headers: customHeaders,
      csrfPath
    });
    if (data && typeof data === 'object') {
      return data.d || data;
    }
    return true;
  }
}

module.exports = BaseGoodsIssueClient;
