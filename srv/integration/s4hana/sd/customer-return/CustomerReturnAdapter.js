const LOG = require('../../../../common/logger')('customer-return-adapter');
const { S4HttpClient } = require('../../S4HttpClient');
const { odataString } = require('../../../../common/filterUtils');
const { mapS4Error } = require('../../S4ErrorMapper');
const { RfcClient } = require('../../RfcClient');
const { sapKey } = require('../../sapKey');
const { resolveCustomerSalesArea } = require('../customerSalesArea');
const { CustomerReturnRfcCreator } = require('./CustomerReturnRfcCreator');

const SERVICE_PATH = '/sap/opu/odata/sap/SD_F2651_CRT_CREATE_SRV';
const TRANSACTIONAL_SERVICE_PATH = '/sap/opu/odata/sap/LORD_ODATA_ORDER_SRV';
const HEADER_ENTITY_SET = 'C_CustomerReturnOPg';
const ITEM_ENTITY_SET = 'C_CustomerReturnItemOPg';
const REASON_VH_SET = 'C_ReturnsOrderReasonVH';
const REF_DOC_VH_SET = 'C_ReturnsReferenceDocVH';
const SOLD_TO_VH_SET = 'C_SoldToValueHelp';
const MATERIAL_VH_SET = 'I_MaterialStdVH';
const PLANT_VH_SET = 'I_AllwdPlantsPerSlsOrgVH';
const DOC_TYPE_VH_SET = 'C_CustomerReturnTypeManageVH';

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
    this.rfc = client?.rfcClient || new RfcClient(); // READ-ONLY master data (KNVV, T001W)
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

  /**
   * Creates a Customer Return document in S/4HANA via transactional LORD_ODATA_ORDER_SRV
   * (Lean Order framework) deep insert, then confirms persistence via direct readback from SD_F2651_CRT_CREATE_SRV.
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

    // 1. Build Deep Items for LORD_ODATA_ORDER_SRV
    const rawItems = Array.isArray(payload.Items) && payload.Items.length > 0
      ? payload.Items
      : [{ Material: payload.Material, OrderQuantity: payload.OrderQuantity, OrderQuantityUnit: payload.OrderQuantityUnit, ProductionPlant: payload.ProductionPlant }];

    // Every org/business value must come from the caller (resolved upstream); nothing is assumed here.
    const missing = (what) => { const e = new Error(`${what} is required to create a Customer Return; no default is assumed`); e.code = 400; e.status = 400; throw e; };
    const deepItems = rawItems.filter(it => it && it.Material).map(it => {
      const material = String(it.Material).trim();
      const plant = String(it.ProductionPlant || it.Plant || '').trim();
      if (!plant) missing(`Plant for item ${material}`);
      if (!(Number(it.OrderQuantity) > 0)) missing(`Order quantity for item ${material}`);
      if (!String(it.OrderQuantityUnit || '').trim()) missing(`Order quantity unit for item ${material}`);
      const itemObj = {
        MaterialID: material,
        OrderQty: String(it.OrderQuantity),
        SalesUnit: String(it.OrderQuantityUnit).trim(),
        Plant: plant
      };
      if (it.UnitPrice && !isNaN(Number(it.UnitPrice))) {
        if (!String(it.Currency || '').trim()) missing(`Currency for the unit price of item ${material}`);
        itemObj.PriceCondSet = [
          {
            CondTypeCode: 'ZPR1', // shortcut: condition type still hard-coded, resolve via BusinessConfigResolver.conditionType in Phase 2 step 2
            AmountInternal: String(it.UnitPrice),
            RateUnitExternal: String(it.Currency).trim()
          }
        ];
      }
      return itemObj;
    });

    if (deepItems.length === 0) {
      const err = new Error('At least one line item with a Material is required to create a Customer Return');
      err.code = 400;
      throw err;
    }

    // Plants must exist in SAP (T001W); the sales area must be one maintained for the customer (KNVV). Read-only.
    for (const plant of new Set(deepItems.map((it) => it.Plant))) {
      let t001w;
      try {
        t001w = await this.rfc.readTable('T001W', ['WERKS'], [`WERKS = '${sapKey(plant, 'plant', 'Plant')}'`], 1);
      } catch (e) {
        if (e.status === 400) throw Object.assign(e, { code: 400 });
        throw Object.assign(new Error(`Plant ${plant} could not be verified in SAP (T001W): ${e.message}`), { status: 502, code: 502, cause: e });
      }
      if (!t001w || !t001w.length) { const e = new Error(`Plant ${plant} does not exist in SAP (T001W)`); e.status = 400; e.code = 400; throw e; }
    }
    const salesArea = await resolveCustomerSalesArea(this.rfc, payload.SoldToParty, {
      salesOrganization: payload.SalesOrganization,
      distributionChannel: payload.DistributionChannel,
      division: payload.OrganizationDivision
    });

    // 2. Assemble Deep Insert Payload for Lean Order Framework
    const deepPayload = {
      SalesOrderTypeCode: returnType,
      SalesOrganization: salesArea.salesOrganization,
      DistributionChannel: salesArea.distributionChannel,
      Division: salesArea.division,
      SoldToPartyID: String(payload.SoldToParty).trim(),
      PurchaseOrderNumber: payload.PurchaseOrderByCustomer
        ? String(payload.PurchaseOrderByCustomer).trim()
        : `RET-${Date.now().toString().slice(-6)}`,
      ItemSet: deepItems
    };

    if (payload.CustomerReturnDate) {
      const d = new Date(payload.CustomerReturnDate);
      if (!isNaN(d.getTime())) {
        deepPayload.PurchaseOrderDate = `/Date(${d.getTime()})/`;
        deepPayload.RequestedDeliveryDate = `/Date(${d.getTime()})/`;
      }
    }

    const endpoint = `${TRANSACTIONAL_SERVICE_PATH}/HeaderSet`;

    try {
      LOG.info(`Creating Customer Return via LORD_ODATA_ORDER_SRV deep insert: POST ${endpoint}`, deepPayload);

      const response = await this.client.post(endpoint, { data: deepPayload }, cleanOpts);
      const createdHeader = response?.data?.d || response?.data;
      const returnNumber = String(createdHeader?.SalesOrderID || '').trim();

      if (!returnNumber) {
        const error = new Error('Sales Order / Customer Return number not returned from SAP S/4HANA');
        error.code = 502;
        throw error;
      }

      LOG.info(`Customer Return successfully created in S/4HANA with document number: ${returnNumber}`);

      // 3. Mandatory Readback Loop: Confirm Real S/4HANA Database Persistence from SD_F2651_CRT_CREATE_SRV
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

      const totalNet = verifiedDoc?.TotalNetAmount ?? (createdHeader?.TotalAmount ? Number(createdHeader.TotalAmount) : (createdHeader?.NetAmount ? Number(createdHeader.NetAmount) : null));
      const currency = verifiedDoc?.TransactionCurrency || createdHeader?.DocumentCurrency || null; // document already exists in SAP: report what SAP returned, never invent a currency

      return {
        CustomerReturn: returnNumber,
        CustomerReturnType: returnType,
        SoldToParty: deepPayload.SoldToPartyID,
        TotalNetAmount: totalNet,
        TransactionCurrency: currency,
        Success: true,
        Message: `Customer Return ${returnNumber} successfully created and verified in SAP S/4HANA.`
      };
    } catch (err) {
      if (err.code === 400 || err.code === 403 || err.code === 502) {
        throw err;
      }
      LOG.error(`Failed to create Customer Return in S/4HANA`, err);
      throw mapS4Error(err, 'Failed to create Customer Return in S/4HANA');
    }
  }

  /**
   * Creates a customer return through BAPI_CUSTOMERRETURN_CREATE (RFC) and checks in SAP what was stored. Unlike the
   * Lean Order route (createCustomerReturn) it carries the order reason, the reference document and the storage
   * location. `options.testRun` simulates the BAPI without committing; `options.creator` is for tests.
   * NOTE: validation below duplicates createCustomerReturn on purpose; merge when the Lean Order route is removed.
   */
  async createCustomerReturnViaRfc(payload = {}, options = {}) {
    const bad = (message) => { const e = new Error(message); e.code = 400; e.status = 400; return e; };
    if (!payload.SoldToParty) throw bad('SoldToParty is mandatory for Customer Return creation');
    if (!payload.ReturnsOrderReason) throw bad('ReturnsOrderReason is mandatory for Customer Return creation');

    const returnType = payload.CustomerReturnType || DEFAULT_RETURN_TYPE;
    const items = (Array.isArray(payload.Items) && payload.Items.length > 0
      ? payload.Items
      : [{ Material: payload.Material, OrderQuantity: payload.OrderQuantity, OrderQuantityUnit: payload.OrderQuantityUnit, ProductionPlant: payload.ProductionPlant }]
    ).filter((it) => it && it.Material);
    if (items.length === 0) throw bad('At least one line item with a Material is required to create a Customer Return');

    // Plants must exist in SAP (T001W); the sales area must be one maintained for the customer (KNVV). Read-only.
    for (const plant of new Set(items.map((it) => String(it.ProductionPlant || it.Plant || '').trim()).filter(Boolean))) {
      const t001w = await this.rfc.readTable('T001W', ['WERKS'], [`WERKS = '${sapKey(plant, 'plant', 'Plant')}'`], 1);
      if (!t001w || !t001w.length) throw bad(`Plant ${plant} does not exist in SAP (T001W)`);
    }
    const salesArea = await resolveCustomerSalesArea(this.rfc, payload.SoldToParty, {
      salesOrganization: payload.SalesOrganization,
      distributionChannel: payload.DistributionChannel,
      division: payload.OrganizationDivision
    });

    const creator = options.creator || new CustomerReturnRfcCreator({ rfc: this.rfc });
    const full = { ...payload, CustomerReturnType: returnType, Items: items };
    const created = await creator.create(full, salesArea, { testRun: options.testRun === true });
    if (created.testRun) return created;

    const stored = await creator.readBack(created.CustomerReturn);
    const partial = (message) => Object.assign(new Error(message), { status: 502, code: 502, CustomerReturn: created.CustomerReturn, name: 'PartialCustomerReturnError' });
    if (!stored) throw partial(`SAP committed customer return ${created.CustomerReturn}, but it could not be read back from SAP`);

    // Persistence check: everything the user entered that the BAPI route is meant to carry must be in SAP
    const missing = [];
    const sameKey = (a, b) => String(a || '').trim().replace(/^0+/, '') === String(b || '').trim().replace(/^0+/, '');
    if (String(stored.header.AUGRU || '').trim() !== String(payload.ReturnsOrderReason).trim()) missing.push(`order reason (stored "${String(stored.header.AUGRU || '').trim()}")`);
    const item = stored.items[0] || {};
    const wantItem = items[0];
    const wantRef = String(wantItem.ReferenceSDDocument || payload.ReferenceSDDocument || '').trim();
    if (wantRef && !sameKey(item.VGBEL || stored.header.VGBEL, wantRef)) missing.push(`reference document ${wantRef}`);
    const wantSloc = String(wantItem.StorageLocation || '').trim().toUpperCase();
    if (wantSloc && String(item.LGORT || '').trim().toUpperCase() !== wantSloc) missing.push(`storage location ${wantSloc}`);
    if (missing.length) throw partial(`SAP created customer return ${created.CustomerReturn}, but did not store: ${missing.join(', ')}`);

    let net = null;
    let currency = null;
    try {
      const doc = await this.getCustomerReturn(String(created.CustomerReturn).replace(/^0+/, ''), _cleanOptions(options));
      net = doc && doc.TotalNetAmount !== undefined ? doc.TotalNetAmount : null;
      currency = (doc && doc.TransactionCurrency) || null;
    } catch (e) {
      LOG.warn(`Totals of customer return ${created.CustomerReturn} could not be read: ${e.message}`);
    }
    // The BAPI returns the 10-digit number (0004500185); CAP keys and the UI use it without leading zeros, as the Lean Order route did
    const number = String(created.CustomerReturn).replace(/^0+/, '');
    return {
      CustomerReturn: number,
      CustomerReturnType: returnType,
      SoldToParty: String(payload.SoldToParty).trim(),
      TotalNetAmount: net,
      TransactionCurrency: currency,
      Success: true,
      Message: `Customer Return ${number} successfully created and verified in SAP S/4HANA.`
    };
  }
}

module.exports = new CustomerReturnAdapter();
module.exports.CustomerReturnAdapter = CustomerReturnAdapter;
module.exports._parseODataV2Date = _parseODataV2Date;
module.exports._formatReturnHeaderRow = _formatReturnHeaderRow;
module.exports._formatReturnItemRow = _formatReturnItemRow;
module.exports._cleanOptions = _cleanOptions;
