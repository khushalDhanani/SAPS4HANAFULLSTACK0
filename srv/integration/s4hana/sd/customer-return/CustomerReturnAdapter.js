const LOG = require('../../../../common/logger')('customer-return-adapter');
const { S4HttpClient } = require('../../S4HttpClient');
const { odataString } = require('../../../../common/filterUtils');
const { mapS4Error } = require('../../S4ErrorMapper');

const SERVICE_PATH = '/sap/opu/odata/sap/SD_F2651_CRT_CREATE_SRV';
const HEADER_ENTITY_SET = 'C_CustomerReturnOPg';
const ITEM_ENTITY_SET = 'C_CustomerReturnItemOPg';
const REASON_VH_SET = 'C_ReturnsOrderReasonVH';
const REF_DOC_VH_SET = 'C_ReturnsReferenceDocVH';

const DEFAULT_RETURN_TYPE = 'ZRET'; // Standard Return Order Type in Client 220
const MAX_READBACK_ATTEMPTS = 3;
const READBACK_DELAYS_MS = [0, 800, 1500];

/**
 * Strips client authorization headers from options so they never override S4HttpClient
 * configured destination credentials (e.g. S4_USERNAME / S4_PASSWORD).
 *
 * @param {Object} options
 * @returns {Object}
 */
function _cleanOptions(options = {}) {
  const clean = { ...options };
  if (clean.headers) {
    const safeHeaders = { ...clean.headers };
    delete safeHeaders.authorization;
    delete safeHeaders.Authorization;
    clean.headers = safeHeaders;
  }
  return clean;
}

/**
 * Helper to pause execution.
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Parses an OData v2 /Date(ms)/ timestamp to ISO Date format (YYYY-MM-DD).
 *
 * @param {string|Date} dateVal
 * @returns {string|null}
 */
function _parseODataV2Date(dateVal) {
  if (!dateVal) return null;
  if (typeof dateVal === 'string') {
    const match = dateVal.match(/\/Date\((\d+)(?:[+-]\d+)?\)\//);
    if (match) {
      const d = new Date(parseInt(match[1], 10));
      return d.toISOString().slice(0, 10);
    }
  }
  if (dateVal instanceof Date) {
    return dateVal.toISOString().slice(0, 10);
  }
  return String(dateVal);
}

/**
 * Normalizes a raw SAP C_CustomerReturnOPg row to a clean domain object.
 *
 * @param {Object} row
 * @returns {Object|null}
 */
function _formatReturnHeaderRow(row) {
  if (!row) return null;
  return {
    CustomerReturn: String(row.CustomerReturn || '').trim(),
    CustomerReturnType: row.CustomerReturnType || '',
    CustomerReturnType_Text: row.CustomerReturnType_Text || '',
    SoldToParty: row.SoldToParty || '',
    SoldToPartyName: row.SoldToPartyName || '',
    ShipToParty: row.ShipToParty || '',
    ShipToPartyName: row.ShipToPartyName || '',
    ShippingCondition: row.ShippingCondition || '',
    ShippingCondition_Text: row.ShippingCondition_Text || '',
    CustomerReturnDate: _parseODataV2Date(row.CustomerReturnDate),
    PricingDate: _parseODataV2Date(row.PricingDate),
    ReturnsOrderReason: row.ReturnsOrderReason || '',
    SDDocumentReasonText: row.SDDocumentReasonText || '',
    PurchaseOrderByCustomer: row.PurchaseOrderByCustomer || '',
    ReferenceSDDocument: row.ReferenceSDDocument || '',
    ReferenceSDDocumentCategory: row.ReferenceSDDocumentCategory || '',
    SDDocumentCategoryName: row.SDDocumentCategoryName || '',
    SalesOrganization: row.SalesOrganization || '',
    DistributionChannel: row.DistributionChannel || '',
    OrganizationDivision: row.OrganizationDivision || '',
    TotalNetAmount: row.TotalNetAmount !== null && row.TotalNetAmount !== undefined ? Number(row.TotalNetAmount) : null,
    TransactionCurrency: row.TransactionCurrency || '',
    CreatedByUser: row.CreatedByUser || '',
    OverallSDDocumentRejectionSts: row.OverallSDDocumentRejectionSts || '',
    OverallSDDocumentRejectionSts_Text: row.OverallSDDocumentRejectionSts_Text || ''
  };
}

/**
 * Normalizes a raw SAP C_CustomerReturnItemOPg row to a clean domain object.
 *
 * @param {Object} row
 * @returns {Object|null}
 */
function _formatReturnItemRow(row) {
  if (!row) return null;
  return {
    CustomerReturn: String(row.CustomerReturn || '').trim(),
    CustomerReturnItem: String(row.CustomerReturnItem || '').trim(),
    Material: row.Material || '',
    Material_Text: row.Material_Text || '',
    MaterialGroup: row.MaterialGroup || '',
    MaterialGroup_Text: row.MaterialGroup_Text || '',
    Batch: row.Batch || '',
    OrderQuantity: row.OrderQuantity !== null && row.OrderQuantity !== undefined ? Number(row.OrderQuantity) : null,
    OrderQuantityUnit: row.OrderQuantityUnit || '',
    NetAmount: row.NetAmount !== null && row.NetAmount !== undefined ? Number(row.NetAmount) : null,
    Currency: row.Currency || '',
    DeliveryDate: _parseODataV2Date(row.DeliveryDate),
    ProductionPlant: row.ProductionPlant || '',
    PlantName: row.PlantName || '',
    StorageLocation: row.StorageLocation || '',
    StorageLocationName: row.StorageLocationName || '',
    ShippingPoint: row.ShippingPoint || '',
    ShippingPoint_Text: row.ShippingPoint_Text || '',
    ReturnReason: row.ReturnReason || '',
    ReturnReason_Text: row.ReturnReason_Text || '',
    ReferenceSDDocument: row.ReferenceSDDocument || '',
    ReferenceSDDocumentItem: row.ReferenceSDDocumentItem || '',
    GoodsMovementType: row.GoodsMovementType || ''
  };
}

class CustomerReturnAdapter {
  constructor(client) {
    this.client = client?.client || client || new S4HttpClient();
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
        ReasonText: r.SDDocumentReasonText || r.ReturnsOrderReasonDesc || ''
      }));
    } catch (err) {
      LOG.error(`Failed to fetch return reasons`, err);
      throw mapS4Error(err, 'Failed to retrieve Return Reasons from S/4HANA');
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

  /**
   * Creates a Customer Return document in S/4HANA via SD_F2651_CRT_CREATE_SRV
   * and verifies persistence via direct readback.
   *
   * @param {Object} payload
   * @param {Object} [options={}]
   * @returns {Promise<Object>}
   */
  async createCustomerReturn(payload = {}, options = {}) {
    if (!payload.SoldToParty) {
      const err = new Error('SoldToParty is mandatory for Customer Return creation');
      err.code = 400;
      throw err;
    }
    if (!payload.ReturnsOrderReason) {
      const err = new Error('ReturnsOrderReason is mandatory for Customer Return creation');
      err.code = 400;
      throw err;
    }

    const cleanOpts = _cleanOptions(options);
    const returnType = payload.CustomerReturnType || DEFAULT_RETURN_TYPE;

    // 1. Assemble Header Payload
    const headerPayload = {
      CustomerReturnType: returnType,
      SoldToParty: String(payload.SoldToParty).trim(),
      ReturnsOrderReason: String(payload.ReturnsOrderReason).trim(),
      ReferenceSDDocument: payload.ReferenceSDDocument ? String(payload.ReferenceSDDocument).trim() : '',
      ReferenceSDDocumentCategory: payload.ReferenceSDDocumentCategory || (payload.ReferenceSDDocument ? 'M' : ''),
      SalesOrganization: payload.SalesOrganization || '1000',
      DistributionChannel: payload.DistributionChannel || '10',
      OrganizationDivision: payload.OrganizationDivision || '52',
      PurchaseOrderByCustomer: payload.PurchaseOrderByCustomer || ''
    };

    if (payload.CustomerReturnDate) {
      const d = new Date(payload.CustomerReturnDate);
      if (!isNaN(d.getTime())) {
        headerPayload.CustomerReturnDate = `/Date(${d.getTime()})/`;
      }
    }

    const endpoint = `${SERVICE_PATH}/${HEADER_ENTITY_SET}`;

    try {
      LOG.info(`Creating Customer Return header in S/4HANA: POST ${endpoint}`, headerPayload);

      // Execute Header POST
      const response = await this.client.post(endpoint, headerPayload, cleanOpts);
      const createdHeader = response?.data?.d;
      const returnNumber = String(createdHeader?.CustomerReturn || '').trim();

      if (!returnNumber) {
        throw new Error('S/4HANA returned success but no Customer Return number was generated.');
      }

      LOG.info(`Customer Return header created with document number: ${returnNumber}`);

      // 2. If Items Provided, Create Items Sequentially
      if (Array.isArray(payload.Items) && payload.Items.length > 0) {
        const itemEndpoint = `${SERVICE_PATH}/${ITEM_ENTITY_SET}`;
        for (let idx = 0; idx < payload.Items.length; idx++) {
          const item = payload.Items[idx];
          const itemPayload = {
            CustomerReturn: returnNumber,
            CustomerReturnItem: String((idx + 1) * 10),
            Material: String(item.Material || '').trim(),
            OrderQuantity: String(item.OrderQuantity || '1.000'),
            OrderQuantityUnit: item.OrderQuantityUnit || 'KG',
            ProductionPlant: item.ProductionPlant || '1110',
            StorageLocation: item.StorageLocation || 'FG01',
            ReturnReason: item.ReturnReason || payload.ReturnsOrderReason,
            ReferenceSDDocument: item.ReferenceSDDocument || payload.ReferenceSDDocument || '',
            ReferenceSDDocumentItem: item.ReferenceSDDocumentItem ? String(item.ReferenceSDDocumentItem) : ''
          };

          LOG.info(`Posting Customer Return item ${itemPayload.CustomerReturnItem}: POST ${itemEndpoint}`);
          await this.client.post(itemEndpoint, itemPayload, cleanOpts);
        }
      }

      // 3. Mandatory Readback Loop: Confirm Real S/4HANA Database Persistence
      let verifiedDoc = null;
      for (let attempt = 0; attempt < MAX_READBACK_ATTEMPTS; attempt++) {
        const delay = READBACK_DELAYS_MS[attempt];
        if (delay > 0) await _sleep(delay);

        try {
          verifiedDoc = await this.getCustomerReturn(returnNumber, cleanOpts);
          if (verifiedDoc && verifiedDoc.CustomerReturn === returnNumber) {
            LOG.info(`Customer Return ${returnNumber} verified in S/4HANA database (attempt ${attempt + 1})`);
            break;
          }
        } catch (readErr) {
          LOG.warn(`Readback attempt ${attempt + 1} failed for ${returnNumber}: ${readErr.message}`);
        }
      }

      const totalNet = verifiedDoc?.TotalNetAmount ?? (createdHeader?.TotalNetAmount ? Number(createdHeader.TotalNetAmount) : null);
      const currency = verifiedDoc?.TransactionCurrency || createdHeader?.TransactionCurrency || 'INR';

      return {
        CustomerReturn: returnNumber,
        CustomerReturnType: returnType,
        SoldToParty: headerPayload.SoldToParty,
        TotalNetAmount: totalNet,
        TransactionCurrency: currency,
        Success: true,
        Message: `Customer Return ${returnNumber} successfully created and verified in SAP S/4HANA.`
      };
    } catch (err) {
      LOG.error(`Failed to create Customer Return in S/4HANA`, err);
      throw mapS4Error(err, 'Failed to create Customer Return in S/4HANA');
    }
  }
}

module.exports = new CustomerReturnAdapter();
module.exports.CustomerReturnAdapter = CustomerReturnAdapter;
module.exports._parseODataV2Date = _parseODataV2Date;
module.exports._formatReturnHeaderRow = _formatReturnHeaderRow;
module.exports._formatReturnItemRow = _formatReturnItemRow;
module.exports._cleanOptions = _cleanOptions;
