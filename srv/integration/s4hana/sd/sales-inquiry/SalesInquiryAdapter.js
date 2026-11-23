const { S4HttpClient } = require('../../S4HttpClient');
const { RfcClient } = require('../../RfcClient');
const TtlCache = require('../../../../common/TtlCache');

const { PartialSalesInquiryError } = require('./PartialSalesInquiryError');
const {
  _formatODataV2Date,
  _formatODataV2Literal,
  _cqnOrderByToOData,
  _cqnWhereToODataFilter
} = require('./salesInquiryODataHelper');
const documentCreator = require('./salesInquiryDocumentCreator');
const detailReader = require('./salesInquiryDetailReader');
const worklistReader = require('./salesInquiryWorklistReader');
const customerDefaultsReader = require('./salesInquiryCustomerDefaults');
const salesOrderReader = require('./salesOrderReader');
const connectionMethods = require('./salesInquiryConnection');
const catalogReaderMethods = require('./salesInquiryCatalogReader');
const masterDataMethods = require('./salesInquiryMasterData');


/**
 * Adapter class to encapsulate communication with SAP S/4HANA Sales Inquiry services:
 * - SD_F2370_INQY_WL_SRV (Manage Sales Inquiries Worklist & Configuration Value Helps)
 * - SD_F2369_INQY_FS_SRV (Sales Inquiry Factsheet & Line Items)
 * - LORD_ODATA_ORDER_SRV (Lean Order OData Service for Sales Document Creation)
 */
class SalesInquiryAdapter {
  constructor(options = {}) {
    this.client = options.client || new S4HttpClient();
    this.destinationName = this.client.destinationName;
    this._s4hanaWL = null;
    this._s4hanaFS = null;
    this._s4hanaSO = null;
    this.customerMasterCache = new TtlCache({ defaultTtlMs: 300000 }); // 5m TTL
    this.customerSalesAreaCache = new TtlCache({ defaultTtlMs: 300000 }); // 5m TTL
    this.salesOfficeVhCache = new TtlCache({ defaultTtlMs: 300000 }); // 5m TTL
    this.salesGroupVhCache = new TtlCache({ defaultTtlMs: 300000 }); // 5m TTL
    this.inquiryTypesCache = new TtlCache({ defaultTtlMs: 300000 }); // 5m TTL
    this.materialResolutionCache = new TtlCache({ defaultTtlMs: 300000 }); // 5m TTL
    this.masterDataCache = new TtlCache({ defaultTtlMs: 300000 }); // 5m TTL: T052U / KNVK RFC table reads
    this.rfc = options.rfcClient || new RfcClient();
  }

  get s4hanaWL() {
    return this._s4hanaWL;
  }

  set s4hanaWL(val) {
    this._s4hanaWL = val;
    if (this.salesOfficeVhCache) this.salesOfficeVhCache.clear();
    if (this.salesGroupVhCache) this.salesGroupVhCache.clear();
    if (this.customerMasterCache) this.customerMasterCache.clear();
    if (this.customerSalesAreaCache) this.customerSalesAreaCache.clear();
    if (this.inquiryTypesCache) this.inquiryTypesCache.clear();
  }

  get s4hanaFS() {
    return this._s4hanaFS;
  }

  set s4hanaFS(val) {
    this._s4hanaFS = val;
    if (this.inquiryTypesCache) this.inquiryTypesCache.clear();
    if (this.materialResolutionCache) this.materialResolutionCache.clear();
  }

  get s4hanaSO() {
    return this._s4hanaSO;
  }

  set s4hanaSO(val) {
    this._s4hanaSO = val;
  }

  /**
   * Resets all internal master data caches.
   */
  clearCache() {
    this.customerMasterCache.clear();
    if (this.customerSalesAreaCache) this.customerSalesAreaCache.clear();
    this.salesOfficeVhCache.clear();
    this.salesGroupVhCache.clear();
    this.inquiryTypesCache.clear();
    this.materialResolutionCache.clear();
    this.masterDataCache.clear();
  }

  /**
   * Retrieves Sales Inquiries list from S/4HANA worklist service (delegated to salesInquiryWorklistReader).
   */
  async getInquiries(query) {
    return worklistReader.getInquiries(this, query);
  }

  /**
   * Retrieves single Sales Inquiry details by ID directly from S/4HANA (delegated to salesInquiryDetailReader).
   */
  async getInquiry(sId) {
    return detailReader.getInquiry(this, sId);
  }

  /**
   * Retrieves Sales Orders list from S/4HANA worklist service (delegated to salesOrderReader).
   */
  async getSalesOrders(query, options = {}) {
    return salesOrderReader.getSalesOrders(this, query, options);
  }

  /**
   * Retrieves single Sales Order details by ID directly from S/4HANA (delegated to salesOrderReader).
   */
  async getSalesOrder(sId, options = {}) {
    return salesOrderReader.getSalesOrder(this, sId, options);
  }

  /**
   * Provides standard Sales Order creation defaults (delegated to salesOrderReader).
   */
  async getSalesOrderDefaults(context = {}) {
    return salesOrderReader.getSalesOrderDefaults(this, context);
  }

  /**
   * Derives default organizational and commercial values for a customer (delegated to salesInquiryCustomerDefaults).
   */
  async getCustomerDefaults(sCustomer, _sOrg, _sChannel, _sDivision) {
    return customerDefaultsReader.getCustomerDefaults(this, sCustomer, _sOrg, _sChannel, _sDivision);
  }


  /**
   * Creates a Sales Order in SAP S/4HANA via LORD_ODATA_ORDER_SRV (delegated to salesInquiryDocumentCreator).
   * Inquiry type ZIN is refused here; inquiries go through createSalesInquiryViaRfc.
   */
  async createSalesDocument(docType, header, items, options = {}) {
    return documentCreator.createSalesDocument(this, docType, header, items, options);
  }

  /**
   * Creates a Sales Inquiry through BAPI_INQUIRY_CREATEFROMDATA2 (RFC) and reads it back from SAP.
   */
  async createSalesInquiryViaRfc(header, items, options = {}) {
    return documentCreator.createSalesInquiryViaRfc(this, header, items, options);
  }

  /**
   * Creates a Sales Order directly in SAP S/4HANA using LORD_ODATA_ORDER_SRV (Deep Insert).
   */
  async createSalesOrder(header, items, options = {}) {
    const docType = header.SalesOrderType;
    if (!docType || String(docType).trim() === '') {
      throw new Error('SalesOrderType is required for Sales Order creation');
    }
    return this.createSalesDocument(docType, header, items, options);
  }

  /**
   * Property names of the LORD_ODATA_ORDER_SRV Header and Item entities.
   */
  async _getLeanOrderFields(destination, executeFn = this.client._execute) {
    return documentCreator._getLeanOrderFields(this, destination, executeFn);
  }

  /**
   * Reports which extension fields the inquiry creation route can carry.
   */
  async getInquiryCreationCapabilities() {
    return documentCreator.getInquiryCreationCapabilities();
  }

  /**
   * Sales order counts read live from SAP S/4HANA (delegated to salesInquiryWorklistReader).
   */
  async getSalesMetrics(options = {}) {
    return worklistReader.getSalesMetrics(this, options);
  }

  /**
   * Retrieves Sales Inquiry metrics from SD_F2370_INQY_WL_SRV / C_InquiryWL_F2370 (delegated to salesInquiryWorklistReader).
   */
  async getInquiryMetrics(options = {}) {
    return worklistReader.getInquiryMetrics(this, options);
  }

  /**
   * Executes CheckATP FunctionImport in LORD_ODATA_ORDER_SRV for a given document and item (delegated to salesOrderReader).
   */
  async checkATP(salesOrderID, itemID, options = {}) {
    return salesOrderReader.checkATP(this, salesOrderID, itemID, options);
  }
}


SalesInquiryAdapter.prototype._formatODataV2Date = _formatODataV2Date;
SalesInquiryAdapter.prototype._formatODataV2Literal = _formatODataV2Literal;
SalesInquiryAdapter.prototype._cqnOrderByToOData = _cqnOrderByToOData;
SalesInquiryAdapter.prototype._cqnWhereToODataFilter = _cqnWhereToODataFilter;

// Connection, catalog and master-data methods live in focused modules and are mixed in here.
Object.assign(SalesInquiryAdapter.prototype, connectionMethods, catalogReaderMethods, masterDataMethods);

const defaultAdapter = new SalesInquiryAdapter();
defaultAdapter.SalesInquiryAdapter = SalesInquiryAdapter;
defaultAdapter.PartialSalesInquiryError = PartialSalesInquiryError;
defaultAdapter._formatODataV2Date = _formatODataV2Date;
defaultAdapter._formatODataV2Literal = _formatODataV2Literal;
defaultAdapter._cqnOrderByToOData = _cqnOrderByToOData;
defaultAdapter._cqnWhereToODataFilter = _cqnWhereToODataFilter;

module.exports = defaultAdapter;
module.exports.PartialSalesInquiryError = PartialSalesInquiryError;
module.exports._formatODataV2Date = _formatODataV2Date;
module.exports._cqnWhereToODataFilter = _cqnWhereToODataFilter;
