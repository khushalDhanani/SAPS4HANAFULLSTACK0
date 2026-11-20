const cds = require('@sap/cds');
const LOG = require('../../../../common/logger')('sales-inquiry-adapter');
const { S4HttpClient } = require('../../S4HttpClient');
const { RfcClient } = require('../../RfcClient');
const s4Config = require('../../s4Config');
const businessConfigResolver = require('../../../../common/BusinessConfigResolver');
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

  /** Initialize the remote S/4HANA read services */
  async init() {
    if (!this.s4hanaWL) {
      try {
        this.s4hanaWL = await cds.connect.to('SD_F2370_INQY_WL_SRV');
      } catch (err) {
        LOG.warn('Could not connect to SD_F2370_INQY_WL_SRV:', err.message);
      }
    }
    if (!this.s4hanaFS) {
      try {
        this.s4hanaFS = await cds.connect.to('SD_F2369_INQY_FS_SRV');
      } catch (err) {
        LOG.warn('Could not connect to SD_F2369_INQY_FS_SRV:', err.message);
      }
    }
    if (!this.s4hanaSO) {
      try {
        this.s4hanaSO = await cds.connect.to('SD_F1873_SO_WL_SRV');
      } catch (err) {
        LOG.warn('Could not connect to SD_F1873_SO_WL_SRV:', err.message);
      }
    }
  }

  /**
   * Resolve destination for S/4HANA communication using the shared S4HttpClient.
   * Propagates caller userJwt for Principal Propagation when available.
   *
   * @param {Object} [options]
   */
  async _getDestination(options = {}) {
    const dest = await this.client.resolveDestination(options);
    if (!dest) {
      const destinationName = this.client.destinationName;
      throw new Error(`[SalesInquiryAdapter] Destination '${destinationName}' not found and no local credentials configured.`);
    }
    return dest;
  }

  /** Read data from SD Worklist & Value Help service */
  async readWlData(query) {
    await this.init();
    if (!this.s4hanaWL) {
      const err = new Error('Sales inquiry worklist data cannot be read: the SAP SD service SD_F2370_INQY_WL_SRV is not connected.');
      err.status = 503;
      throw err;
    }
    try {
      return await this.s4hanaWL.run(query);
    } catch (error) {
      LOG.error('Error reading data from WL service:', error.message);
      if (!error.status) error.status = 502;
      throw error;
    }
  }

  /** Read data from SD Factsheet & Item service */
  async readFsData(query) {
    await this.init();
    if (!this.s4hanaFS) {
      const err = new Error('Sales inquiry factsheet data cannot be read: the SAP SD service SD_F2369_INQY_FS_SRV is not connected.');
      err.status = 503;
      throw err;
    }
    try {
      return await this.s4hanaFS.run(query);
    } catch (error) {
      LOG.error('Error reading data from FS service:', error.message);
      const err = new Error(`Sales inquiry factsheet data could not be read from SAP S/4HANA: ${error.message}`);
      err.status = error.status || 502;
      throw err;
    }
  }

  /** Read data from SD Sales Order Worklist & Value Help service (SD_F1873_SO_WL_SRV) */
  async readSoData(query) {
    await this.init();
    if (!this.s4hanaSO) {
      const err = new Error('Sales order worklist data cannot be read: the SAP SD service SD_F1873_SO_WL_SRV is not connected.');
      err.status = 503;
      throw err;
    }
    try {
      return await this.s4hanaSO.run(query);
    } catch (error) {
      LOG.error('Error reading data from SO service:', error.message);
      if (!error.status) error.status = 502;
      throw error;
    }
  }

  /**
   * Retrieves sales materials dynamically from S/4HANA SD_F2369_INQY_FS_SRV.I_Material.
   * Scoped to the material types configured in cds.s4.salesMaterialTypes (finished goods); the scope is stated on screen.
   * Merges incoming search filters, applies stable deterministic sorting, and supports pagination.
   */
  async getMaterials(query) {
    await this.init();
    if (!this.s4hanaFS) {
      const err = new Error('Finished Goods materials cannot be read: the SAP SD service SD_F2369_INQY_FS_SRV is not connected.');
      err.status = 503;
      throw err;
    }
    try {
      // Material-type scope comes from configuration (cds.s4.salesMaterialTypes), not a literal list
      const fgCondition = ['('];
      let matTypes = ['ZFRT', 'FERT'];
      try {
        if (typeof s4Config.getSalesMaterialTypes === 'function') {
          matTypes = s4Config.getSalesMaterialTypes();
        }
      } catch (_) {}
      matTypes.forEach((t, i) => {
        if (i > 0) fgCondition.push('or');
        fgCondition.push({ ref: ['MaterialType'] }, '=', { val: t });
      });
      fgCondition.push(')');

      // Helper to map alias MaterialName -> physical field Material_Text in S/4HANA CDS
      const mapWhereNode = (node) => {
        if (!node) return node;
        if (Array.isArray(node)) return node.map(mapWhereNode);
        if (typeof node === 'object') {
          const copy = { ...node };
          if (Array.isArray(copy.ref)) {
            copy.ref = copy.ref.map(r => r === 'MaterialName' ? 'Material_Text' : r);
          }
          if (Array.isArray(copy.args)) {
            copy.args = copy.args.map(mapWhereNode);
          }
          return copy;
        }
        return node;
      };

      let execQuery = SELECT.from('SD_F2369_INQY_FS_SRV.I_Material')
        .columns('Material', 'Material_Text', 'MaterialType', 'MaterialGroup', 'MaterialBaseUnit')
        .orderBy('Material asc');

      if (query && query.SELECT) {
        if (query.SELECT.where && query.SELECT.where.length > 0) {
          const mappedUserWhere = mapWhereNode(query.SELECT.where);
          execQuery.where(['(', ...mappedUserWhere, ')', 'and', ...fgCondition]);
        } else {
          execQuery.where(fgCondition);
        }

        if (query.SELECT.limit) {
          const lRows = typeof query.SELECT.limit.rows === 'object' && query.SELECT.limit.rows !== null && 'val' in query.SELECT.limit.rows
            ? Number(query.SELECT.limit.rows.val)
            : Number(query.SELECT.limit.rows);
          const lOffset = typeof query.SELECT.limit.offset === 'object' && query.SELECT.limit.offset !== null && 'val' in query.SELECT.limit.offset
            ? Number(query.SELECT.limit.offset.val)
            : (query.SELECT.limit.offset ? Number(query.SELECT.limit.offset) : 0);
          if (!isNaN(lRows) && lRows >= 0) {
            execQuery.limit(lRows, lOffset || 0);
          }
        }
        if (query.SELECT.count) {
          execQuery.SELECT.count = true;
        }
      } else {
        execQuery.where(fgCondition);
      }

      const raw = await this.s4hanaFS.run(execQuery);
      const rawList = Array.isArray(raw) ? raw : (raw?.value || raw?.d?.results || []);

      const items = rawList.map(m => ({
        ...m,
        MaterialName: m.MaterialName || m.Material_Text || ''
      }));

      if (raw && raw.$count !== undefined) {
        items.$count = raw.$count;
      }

      return items;
    } catch (error) {
      LOG.error('Error querying Finished Goods materials from SAP S/4HANA:', error.message);
      const err = new Error(`Finished Goods materials could not be read from SAP S/4HANA: ${error.message}`);
      err.status = error.status || 502;
      throw err;
    }
  }

  /**
   * Sales inquiry document types (category A) as configured in SAP S/4HANA.
   *
   * Reads SD_F2369_INQY_FS_SRV.I_SalesDocumentType and falls back to
   * SD_F2370_INQY_WL_SRV.C_SalesInquiryTypeValueHelp only when the factsheet service returns nothing.
   * Descriptions, number ranges and procedures are passed through exactly as SAP returns them; the only
   * derived fields are the active/inactive status (from SAP's IsLocked flag) and the category name of
   * category A. When SAP cannot be read, the call fails: no built-in list of types is ever returned.
   *
   * @param {Object} [query] - CAP query (limit / offset are honoured)
   * @returns {Promise<Array<Object>>}
   * @throws {Error} status 503 when no SD service is connected, 502 when SAP could not be read
   */
  async getInquiryTypes(query) {
    const isStandard = !query || !query.SELECT || (!query.SELECT.where && !query.SELECT.limit && !query.SELECT.orderBy);
    if (isStandard && this.inquiryTypesCache.has('standard_inquiry_types')) {
      return this.inquiryTypesCache.get('standard_inquiry_types');
    }

    await this.init();
    if (!this.s4hanaFS && !this.s4hanaWL) {
      const err = new Error('Sales inquiry types cannot be read: the SAP SD services SD_F2369_INQY_FS_SRV and SD_F2370_INQY_WL_SRV are not connected.');
      err.status = 503;
      throw err;
    }

    const failures = [];
    let rawList = [];

    if (this.s4hanaFS) {
      try {
        const execQuery = SELECT.from('SD_F2369_INQY_FS_SRV.I_SalesDocumentType')
          .columns(
            'SalesDocumentType',
            'SalesDocumentType_Text',
            'SDDocumentCategory',
            'ScreenSequenceGroup',
            'NumberRangeForIntIDAssignment',
            'NumberRangeForExtIDAssignment',
            'IsLocked',
            'TextDeterminationProcedure',
            'PartnerDeterminationProcedure'
          )
          .where([{ ref: ['SDDocumentCategory'] }, '=', { val: 'A' }])
          .orderBy('SalesDocumentType asc');
        if (query && query.SELECT && query.SELECT.limit) {
          const lRows = typeof query.SELECT.limit.rows === 'object' && query.SELECT.limit.rows !== null && 'val' in query.SELECT.limit.rows
            ? Number(query.SELECT.limit.rows.val)
            : Number(query.SELECT.limit.rows);
          const lOffset = typeof query.SELECT.limit.offset === 'object' && query.SELECT.limit.offset !== null && 'val' in query.SELECT.limit.offset
            ? Number(query.SELECT.limit.offset.val)
            : (query.SELECT.limit.offset ? Number(query.SELECT.limit.offset) : 0);
          if (!isNaN(lRows) && lRows >= 0) {
            execQuery.limit(lRows, lOffset || 0);
          }
        }
        const raw = await this.s4hanaFS.run(execQuery);
        rawList = Array.isArray(raw) ? raw : (raw?.value || raw?.d?.results || []);
      } catch (error) {
        failures.push(`SD_F2369_INQY_FS_SRV: ${error.message}`);
        LOG.warn('Error querying I_SalesDocumentType from FS:', error.message);
      }
    }

    if (rawList.length === 0 && this.s4hanaWL) {
      try {
        const wlQuery = SELECT.from('SD_F2370_INQY_WL_SRV.C_SalesInquiryTypeValueHelp');
        if (query && query.SELECT && query.SELECT.limit) {
          const lRows = typeof query.SELECT.limit.rows === 'object' && query.SELECT.limit.rows !== null && 'val' in query.SELECT.limit.rows
            ? Number(query.SELECT.limit.rows.val)
            : Number(query.SELECT.limit.rows);
          const lOffset = typeof query.SELECT.limit.offset === 'object' && query.SELECT.limit.offset !== null && 'val' in query.SELECT.limit.offset
            ? Number(query.SELECT.limit.offset.val)
            : (query.SELECT.limit.offset ? Number(query.SELECT.limit.offset) : 0);
          if (!isNaN(lRows) && lRows >= 0) {
            wlQuery.limit(lRows, lOffset || 0);
          }
        }
        if (query && query.SELECT && query.SELECT.count) {
          wlQuery.SELECT.count = true;
        }
        const rawWl = await this.s4hanaWL.run(wlQuery);
        rawList = Array.isArray(rawWl) ? rawWl : (rawWl?.value || rawWl?.d?.results || []);
      } catch (wlError) {
        failures.push(`SD_F2370_INQY_WL_SRV: ${wlError.message}`);
        LOG.warn('Error querying C_SalesInquiryTypeValueHelp from WL:', wlError.message);
      }
    }

    if (rawList.length === 0 && failures.length > 0) {
      const err = new Error(`Sales inquiry types could not be read from SAP S/4HANA (${failures.join('; ')}).`);
      err.status = 502;
      throw err;
    }

    const result = rawList.map(item => {
      const sCode = item.SalesDocumentType || item.SalesInquiryType || '';
      const sText = item.SalesDocumentType_Text || item.SalesInquiryType_Text || item.SalesDocumentTypeName || '';
      const isActive = item.IsLocked !== 'X' && item.IsLocked !== true;
      return {
        SalesDocumentType: sCode,
        SalesDocumentType_Text: sText,
        SalesDocumentTypeName: sText,
        // Both sources return sales inquiry types only, i.e. SD document category A.
        SDDocumentCategory: item.SDDocumentCategory || 'A',
        SDDocumentCategoryName: 'Inquiry',
        IsLocked: item.IsLocked ?? null,
        IsActive: isActive,
        StatusText: isActive ? 'Active' : 'Inactive',
        StatusState: isActive ? 'Success' : 'Warning',
        ScreenSequenceGroup: item.ScreenSequenceGroup ?? null,
        NumberRangeForIntIDAssignment: item.NumberRangeForIntIDAssignment ?? null,
        NumberRangeForExtIDAssignment: item.NumberRangeForExtIDAssignment ?? null,
        TextDeterminationProcedure: item.TextDeterminationProcedure ?? null,
        PartnerDeterminationProcedure: item.PartnerDeterminationProcedure ?? null
      };
    });

    if (isStandard && result.length > 0) {
      this.inquiryTypesCache.set('standard_inquiry_types', result);
    }

    return result;
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
   * Retrieves standard default parameters for Sales Inquiry VA11 creation.
   */
  async getSalesInquiryDefaults(context = {}) {
    const today = new Date().toISOString().split('T')[0];
    const plant = (context && context.plant) || '1120';
    let cfg = {};
    try {
      cfg = await (this.resolver || businessConfigResolver).resolve({
        plant,
        flow: 'sd',
        fields: ['salesOrganization', 'distributionChannel', 'division', 'currency', 'inquiryType'],
        isTrusted: true
      });
    } catch (_) {
      cfg = {
        inquiryType: 'ZIN',
        salesOrganization: '1000',
        distributionChannel: '10',
        division: '52',
        currency: 'INR'
      };
    }
    return {
      SalesInquiryType: cfg.inquiryType || 'ZIN',
      SalesOrganization: cfg.salesOrganization || '1000',
      DistributionChannel: cfg.distributionChannel || '10',
      OrganizationDivision: cfg.division || '52',
      SalesInquiryDate: today,
      BindingPeriodValidityStartDate: today,
      BindingPeriodValidityEndDate: today,
      TransactionCurrency: cfg.currency || 'INR',
      derived: true
    };
  }

  /**
   * Resolves material description to official S/4HANA material number using factsheet service.
   * Cached with a 5-minute TTL.
   */
  async resolveMaterial(matInput) {
    if (!matInput || String(matInput).trim() === '') return '';
    const raw = String(matInput).trim();
    if (/^\d{6,18}$/.test(raw)) {
      return raw;
    }
    const cached = this.materialResolutionCache.get(raw);
    if (cached !== undefined) return cached;

    await this.init();
    if (this.s4hanaFS) {
      try {
        const rows = await this.s4hanaFS.run(
          SELECT.from('SD_F2369_INQY_FS_SRV.I_Material').where({ Material_Text: raw }).limit(1)
        );
        if (rows && rows[0]?.Material) {
          this.materialResolutionCache.set(raw, rows[0].Material);
          return rows[0].Material;
        }
      } catch (e) {
        LOG.warn('Could not resolve material description:', raw, e.message);
      }
    }
    return raw;
  }

  /**
   * Creates a Sales Document in SAP S/4HANA via LORD_ODATA_ORDER_SRV (delegated to salesInquiryDocumentCreator).
   */
  async createSalesDocument(docType, header, items, options = {}) {
    return documentCreator.createSalesDocument(this, docType, header, items, options);
  }

  /**
   * Creates a Sales Inquiry directly in SAP S/4HANA using LORD_ODATA_ORDER_SRV.
   */
  async createSalesInquiry(header, items, options = {}) {
    const docType = header.SalesInquiryType;
    if (!docType || String(docType).trim() === '') {
      throw new Error('SalesInquiryType is required for Sales Inquiry creation');
    }
    return this.createSalesDocument(docType, header, items, options);
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

  /**
   * Reads a whole SAP table via RFC_READ_TABLE (no row cap); the CAP value-help handler applies the
   * OData $filter in memory. Fails with 503 when RFC is unavailable: no local list is ever substituted.
   */
  async _readTableOrFail(table, fields, where = []) {
    try {
      return await this.rfc.readTable(table, fields, where, 0);
    } catch (err) {
      LOG.warn(`RFC readTable ${table} failed:`, err.message);
      const e = new Error(`SAP table ${table} could not be read via RFC: ${err.message}`);
      e.status = err.status || 503;
      throw e;
    }
  }

  /**
   * Payment terms with English texts from SAP table T052U, cached for 5 minutes.
   *
   * @returns {Promise<Array<{ PaymentTerms: string, PaymentTermsName: string }>>}
   */
  async getPaymentTerms(_query) {
    const cached = this.masterDataCache.get('paymentTerms');
    if (cached) return cached;
    const rows = await this._readTableOrFail('T052U', ['ZTERM', 'TEXT1'], ["SPRAS = 'E'"]);
    const terms = rows.map((r) => ({
      PaymentTerms: r.ZTERM ? r.ZTERM.trim() : '',
      PaymentTermsName: r.TEXT1 ? r.TEXT1.trim() : (r.ZTERM ? r.ZTERM.trim() : '')
    })).filter((r) => r.PaymentTerms);
    this.masterDataCache.set('paymentTerms', terms);
    return terms;
  }

  /**
   * Contact persons from SAP table KNVK, cached for 5 minutes per customer. A `Customer eq` filter is
   * pushed to SAP; any other filter (name search) is applied in memory by the value-help handler.
   * `Customer` is returned without leading zeros, as the rest of the application shows customers.
   */
  async getContactPersons(query) {
    let sCustomer = '';
    const where = query?.SELECT?.where;
    if (Array.isArray(where)) {
      for (let i = 0; i < where.length; i++) {
        const item = where[i];
        if (item && ((item.ref && item.ref[0] === 'Customer') || item === 'Customer')) {
          if (where[i + 2] && where[i + 2].val !== undefined) {
            sCustomer = String(where[i + 2].val).trim();
          }
        }
      }
    }
    const sCustPadded = sCustomer ? sCustomer.padStart(10, '0') : '';
    const cacheKey = `contacts:${sCustPadded || '*'}`;
    const cached = this.masterDataCache.get(cacheKey);
    if (cached) return cached;

    const rows = await this._readTableOrFail(
      'KNVK',
      ['PARNR', 'KUNNR', 'NAME1', 'NAMEV', 'TELF1'],
      sCustPadded ? [`KUNNR = '${sCustPadded}'`] : []
    );
    const noZeros = (v) => String(v || '').trim().replace(/^0+/, '');
    const contacts = rows.map((r) => {
      const first = r.NAMEV ? r.NAMEV.trim() : '';
      const last = r.NAME1 ? r.NAME1.trim() : '';
      return {
        ContactPerson: r.PARNR ? r.PARNR.trim() : '',
        Customer: noZeros(r.KUNNR),
        FirstName: first,
        LastName: last,
        FullName: [first, last].filter(Boolean).join(' ') || last,
        PhoneNumber: r.TELF1 ? r.TELF1.trim() : ''
      };
    }).filter((c) => c.ContactPerson);
    this.masterDataCache.set(cacheKey, contacts);
    return contacts;
  }
}


SalesInquiryAdapter.prototype._formatODataV2Date = _formatODataV2Date;
SalesInquiryAdapter.prototype._formatODataV2Literal = _formatODataV2Literal;
SalesInquiryAdapter.prototype._cqnOrderByToOData = _cqnOrderByToOData;
SalesInquiryAdapter.prototype._cqnWhereToODataFilter = _cqnWhereToODataFilter;

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
