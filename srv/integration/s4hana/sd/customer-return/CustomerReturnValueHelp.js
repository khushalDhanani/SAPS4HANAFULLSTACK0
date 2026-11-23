const LOG = require('../../../../common/logger')('customer-return-adapter');
const { odataString } = require('../../../../common/filterUtils');
const { mapS4Error } = require('../../S4ErrorMapper');
const {
  SERVICE_PATH,
  REASON_VH_SET,
  REF_DOC_VH_SET,
  SOLD_TO_VH_SET,
  MATERIAL_VH_SET,
  PLANT_VH_SET,
  DOC_TYPE_VH_SET,
  _cleanOptions,
  _parseODataV2Date
} = require('./customerReturnUtils');

class CustomerReturnValueHelp {
  constructor(adapter) {
    this.adapter = adapter;
  }

  get client() {
    return this.adapter?.client;
  }

  /**
   * Fetches valid Return Order Reasons from S/4HANA value help.
   *
   * @param {Object} [options={}]
   * @returns {Promise<Array>}
   */
  async getReturnReasons(options = {}) {
    const cleanOpts = _cleanOptions(options);
    const endpoint = `${SERVICE_PATH}/${REASON_VH_SET}?$orderby=ReturnsOrderReason asc`;

    try {
      LOG.info(`Fetching return reasons: GET ${endpoint}`);
      const response = await this.client.get(endpoint, cleanOpts);
      const rawResults = response?.data?.d?.results || [];
      return rawResults.map(r => ({
        ReasonCode: String(r.ReturnsOrderReason || '').trim(),
        ReasonText: r.ReturnsOrderReason_Text || r.SDDocumentReasonText || r.ReturnsOrderReasonDesc || ''
      }));
    } catch (err) {
      LOG.error(`Failed to fetch return reasons`, err);
      throw mapS4Error(err, 'Failed to retrieve Return Reasons from S/4HANA');
    }
  }

  /**
   * Fetches Customer records from S/4HANA value help for returns.
   *
   * @param {Object} [options={}]
   * @returns {Promise<Array>}
   */
  async getCustomers(options = {}) {
    const cleanOpts = _cleanOptions(options);
    const queryParams = new URLSearchParams();
    const top = cleanOpts.top || 50;
    queryParams.set('$top', String(top));
    queryParams.set('$orderby', 'Customer asc');

    if (cleanOpts.search) {
      const safe = odataString(String(cleanOpts.search).trim());
      queryParams.set('$filter', `substringof(${safe}, Customer) or substringof(${safe}, OrganizationBPName1)`);
    }

    const endpoint = `${SERVICE_PATH}/${SOLD_TO_VH_SET}?${queryParams.toString()}`;

    try {
      LOG.info(`Fetching customers: GET ${endpoint}`);
      const response = await this.client.get(endpoint, cleanOpts);
      const rawResults = response?.data?.d?.results || [];
      return rawResults.map(r => ({
        Customer: String(r.Customer || '').trim(),
        CustomerName: r.OrganizationBPName1 || r.CustomerName || '',
        OrganizationBPName1: r.OrganizationBPName1 || r.CustomerName || '',
        CityName: r.CityName || ''
      }));
    } catch (err) {
      LOG.error('Failed to fetch customers', err);
      throw mapS4Error(err, 'Failed to retrieve Customers from S/4HANA');
    }
  }

  /**
   * Fetches Material records from S/4HANA value help for return line items.
   *
   * @param {Object} [options={}]
   * @returns {Promise<Array>}
   */
  async getMaterials(options = {}) {
    const cleanOpts = _cleanOptions(options);
    const queryParams = new URLSearchParams();
    const top = cleanOpts.top || 50;
    queryParams.set('$top', String(top));
    queryParams.set('$orderby', 'Material asc');

    if (cleanOpts.search) {
      const safe = odataString(String(cleanOpts.search).trim());
      queryParams.set('$filter', `substringof(${safe}, Material) or substringof(${safe}, Material_Text)`);
    }

    const endpoint = `${SERVICE_PATH}/${MATERIAL_VH_SET}?${queryParams.toString()}`;

    try {
      LOG.info(`Fetching materials: GET ${endpoint}`);
      const response = await this.client.get(endpoint, cleanOpts);
      const rawResults = response?.data?.d?.results || [];
      return rawResults.map(r => ({
        Material: String(r.Material || '').trim(),
        Material_Text: r.Material_Text || ''
      }));
    } catch (err) {
      LOG.error('Failed to fetch materials', err);
      throw mapS4Error(err, 'Failed to retrieve Materials from S/4HANA');
    }
  }

  /**
   * Fetches Delivering Plants from S/4HANA value help.
   *
   * @param {Object} [options={}]
   * @returns {Promise<Array>}
   */
  async getPlants(options = {}) {
    const cleanOpts = _cleanOptions(options);
    const endpoint = `${SERVICE_PATH}/${PLANT_VH_SET}?$top=50&$orderby=Plant asc`;

    try {
      LOG.info(`Fetching plants: GET ${endpoint}`);
      const response = await this.client.get(endpoint, cleanOpts);
      const rawResults = response?.data?.d?.results || [];
      const seen = new Set();
      const plants = [];
      for (const r of rawResults) {
        const pCode = String(r.Plant || '').trim();
        if (pCode && !seen.has(pCode)) {
          seen.add(pCode);
          plants.push({
            Plant: pCode,
            PlantName: r.PlantName || ''
          });
        }
      }
      return plants;
    } catch (err) {
      LOG.error('Failed to fetch plants', err);
      throw mapS4Error(err, 'Failed to retrieve Plants from S/4HANA');
    }
  }

  /**
   * Fetches Customer Return Document Types from S/4HANA.
   *
   * @param {Object} [options={}]
   * @returns {Promise<Array>}
   */
  async getDocumentTypes(options = {}) {
    const cleanOpts = _cleanOptions(options);
    const endpoint = `${SERVICE_PATH}/${DOC_TYPE_VH_SET}?$orderby=CustomerReturnType asc`;

    try {
      LOG.info(`Fetching document types: GET ${endpoint}`);
      const response = await this.client.get(endpoint, cleanOpts);
      const rawResults = response?.data?.d?.results || [];
      return rawResults.map(r => ({
        CustomerReturnType: String(r.CustomerReturnType || '').trim(),
        CustomerReturnType_Text: r.CustomerReturnType_Text || ''
      }));
    } catch (err) {
      LOG.error('Failed to fetch document types', err);
      throw mapS4Error(err, 'Failed to retrieve Document Types from S/4HANA');
    }
  }

  /**
   * Fetches eligible Reference Documents (Invoices/Orders) for Customer Returns.
   *
   * @param {Object} [options={}]
   * @returns {Promise<Array>}
   */
  async getReferenceDocuments(options = {}) {
    const cleanOpts = _cleanOptions(options);
    const queryParams = new URLSearchParams();

    const top = cleanOpts.top || 50;
    queryParams.set('$top', String(top));
    queryParams.set('$orderby', 'DocumentDate desc');

    if (cleanOpts.search) {
      const safeSearch = odataString(String(cleanOpts.search).trim());
      queryParams.set('$filter', `substringof(${safeSearch}, ReferenceSDDocument) or substringof(${safeSearch}, SoldToParty)`);
    }

    const endpoint = `${SERVICE_PATH}/${REF_DOC_VH_SET}?${queryParams.toString()}`;

    try {
      LOG.info(`Fetching reference documents: GET ${endpoint}`);
      const response = await this.client.get(endpoint, cleanOpts);
      const rawResults = response?.data?.d?.results || [];
      return rawResults.map(r => ({
        ReferenceSDDocument: String(r.ReferenceSDDocument || '').trim(),
        SDDocumentCategory: r.SDDocumentCategory || '',
        SDDocumentCategoryName: r.SDDocumentCategoryName || '',
        SoldToParty: r.SoldToParty || '',
        SalesOrganization: r.SalesOrganization || '',
        DistributionChannel: r.DistributionChannel || '',
        Division: r.Division || '',
        DocumentDate: _parseODataV2Date(r.DocumentDate)
      }));
    } catch (err) {
      LOG.error(`Failed to fetch reference documents`, err);
      throw mapS4Error(err, 'Failed to retrieve Reference Documents from S/4HANA');
    }
  }
}

module.exports = CustomerReturnValueHelp;
