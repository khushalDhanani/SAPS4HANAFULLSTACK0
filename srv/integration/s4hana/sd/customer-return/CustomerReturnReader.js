const LOG = require('../../../../common/logger')('customer-return-adapter');
const { odataString } = require('../../../../common/filterUtils');
const { mapS4Error } = require('../../S4ErrorMapper');
const {
  SERVICE_PATH,
  HEADER_ENTITY_SET,
  ITEM_ENTITY_SET,
  _cleanOptions,
  _formatReturnHeaderRow,
  _formatReturnItemRow
} = require('./customerReturnUtils');

class CustomerReturnReader {
  constructor(adapter) {
    this.adapter = adapter;
  }

  get client() {
    return this.adapter?.client;
  }

  /**
   * Fetches Customer Returns headers from S/4HANA.
   *
   * @param {Object} [options={}]
   * @returns {Promise<{results: Array, count: number}>}
   */
  async getCustomerReturns(options = {}) {
    const cleanOpts = _cleanOptions(options);
    const queryParams = new URLSearchParams();

    if (cleanOpts.top !== undefined && cleanOpts.top !== null) queryParams.set('$top', String(cleanOpts.top));
    if (cleanOpts.skip !== undefined && cleanOpts.skip !== null) queryParams.set('$skip', String(cleanOpts.skip));
    if (cleanOpts.orderBy) queryParams.set('$orderby', cleanOpts.orderBy);
    else queryParams.set('$orderby', 'CustomerReturn desc');

    if (cleanOpts.filter) queryParams.set('$filter', cleanOpts.filter);
    queryParams.set('$inlinecount', 'allpages');

    const qs = queryParams.toString();
    const endpoint = `${SERVICE_PATH}/${HEADER_ENTITY_SET}${qs ? `?${qs}` : ''}`;

    try {
      LOG.info(`Fetching customer returns: GET ${endpoint}`);
      const response = await this.client.get(endpoint, cleanOpts);
      const rawResults = response?.data?.d?.results || (response?.data?.d ? [response.data.d] : []);
      const count = response?.data?.d?.__count ? parseInt(response.data.d.__count, 10) : rawResults.length;

      const results = rawResults.map(_formatReturnHeaderRow).filter(Boolean);
      return { results, count };
    } catch (err) {
      LOG.error(`Failed to fetch customer returns from ${endpoint}`, err);
      throw mapS4Error(err, 'Failed to retrieve Customer Returns from S/4HANA');
    }
  }

  /**
   * Fetches a single Customer Return by document number.
   *
   * @param {string} customerReturn
   * @param {Object} [options={}]
   * @returns {Promise<Object|null>}
   */
  async getCustomerReturn(customerReturn, options = {}) {
    if (!customerReturn) {
      const err = new Error('Customer Return document number is required');
      err.code = 400;
      throw err;
    }

    const cleanOpts = _cleanOptions(options);
    const safeId = odataString(String(customerReturn).trim());
    const endpoint = `${SERVICE_PATH}/${HEADER_ENTITY_SET}(${safeId})`;

    try {
      LOG.info(`Fetching customer return header: GET ${endpoint}`);
      const response = await this.client.get(endpoint, cleanOpts);
      const data = response?.data?.d;
      return _formatReturnHeaderRow(data);
    } catch (err) {
      if (err.response?.status === 404) {
        LOG.warn(`Customer Return ${customerReturn} not found on SAP Gateway`);
        return null;
      }
      LOG.error(`Failed to fetch customer return ${customerReturn}`, err);
      throw mapS4Error(err, `Failed to retrieve Customer Return ${customerReturn}`);
    }
  }

  /**
   * Fetches items for a Customer Return document.
   *
   * @param {string} customerReturn
   * @param {Object} [options={}]
   * @returns {Promise<Array>}
   */
  async getCustomerReturnItems(customerReturn, options = {}) {
    if (!customerReturn) return [];

    const cleanOpts = _cleanOptions(options);
    const safeId = odataString(String(customerReturn).trim());
    const endpoint = `${SERVICE_PATH}/${ITEM_ENTITY_SET}?$filter=CustomerReturn eq ${safeId}&$orderby=CustomerReturnItem asc`;

    try {
      LOG.info(`Fetching customer return items: GET ${endpoint}`);
      const response = await this.client.get(endpoint, cleanOpts);
      const rawResults = response?.data?.d?.results || (response?.data?.d ? [response.data.d] : []);
      return rawResults.map(_formatReturnItemRow).filter(Boolean);
    } catch (err) {
      LOG.error(`Failed to fetch customer return items for ${customerReturn}`, err);
      throw mapS4Error(err, `Failed to retrieve items for Customer Return ${customerReturn}`);
    }
  }
}

module.exports = CustomerReturnReader;
