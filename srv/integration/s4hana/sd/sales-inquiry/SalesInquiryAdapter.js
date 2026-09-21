const cds = require('@sap/cds');
const LOG = require('../../../../common/logger')('sales-inquiry-adapter');
const { S4HttpClient } = require('../../S4HttpClient');
const s4Config = require('../../s4Config');
const TtlCache = require('../../../../common/TtlCache');

const LEAN_ORDER_PATH = '/sap/opu/odata/sap/LORD_ODATA_ORDER_SRV';

/**
 * Header extension values for LORD_ODATA_ORDER_SRV (incompletion procedure Z1 and partner function ZP),
 * keyed by the property names agreed for the Header extension. The standard service has none of them;
 * each is sent only when the live $metadata of the service exposes the property, so the application works
 * unchanged before and after the SAP-side extension. See docs/sap-inquiry-service-extension-spec.md.
 */
const INQUIRY_EXTENSION_FIELDS = ['CustomerGroup2', 'PortOfLoading', 'PortOfDischarge', 'ContactPerson', 'BindingPeriodValidityEndDate'];

/**
 * Error thrown when a multi-step Sales Inquiry creation partially succeeds (header persisted in SAP,
 * but a subsequent item or price condition write fails). Carries the created SAP document number
 * to prevent duplicate retries.
 */
class PartialSalesInquiryError extends Error {
  constructor(message, inquiryId, details = {}) {
    super(message);
    this.name = 'PartialSalesInquiryError';
    this.SalesInquiry = String(inquiryId || '').trim();
    this.documentNumber = this.SalesInquiry;
    this.isPartialCreation = true;
    this.status = details.status || 502;
    this.step = details.step || 'UNKNOWN';
    this.itemNumber = details.itemNumber || '';
    this.sapMessage = details.sapMessage || message;
    if (details.originalError) {
      this.cause = details.originalError;
      if (details.originalError.response) {
        this.response = details.originalError.response;
      }
    }
  }
}

/**
 * Formats a Date instance or ISO string to OData v2 Edm.DateTime JSON representation (/Date(ms)/).
 */
function _formatODataV2Date(dateVal) {
  if (!dateVal) return undefined;
  if (typeof dateVal === 'string' && dateVal.startsWith('/Date(')) return dateVal;
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return undefined;
  return `/Date(${d.getTime()})/`;
}

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
    this.salesOfficeVhCache = new TtlCache({ defaultTtlMs: 300000 }); // 5m TTL
    this.salesGroupVhCache = new TtlCache({ defaultTtlMs: 300000 }); // 5m TTL
    this.inquiryTypesCache = new TtlCache({ defaultTtlMs: 300000 }); // 5m TTL
    this.materialResolutionCache = new TtlCache({ defaultTtlMs: 300000 }); // 5m TTL
  }

  get s4hanaWL() {
    return this._s4hanaWL;
  }

  set s4hanaWL(val) {
    this._s4hanaWL = val;
    if (this.salesOfficeVhCache) this.salesOfficeVhCache.clear();
    if (this.salesGroupVhCache) this.salesGroupVhCache.clear();
    if (this.customerMasterCache) this.customerMasterCache.clear();
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
    this.salesOfficeVhCache.clear();
    this.salesGroupVhCache.clear();
    this.inquiryTypesCache.clear();
    this.materialResolutionCache.clear();
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
   * Retrieves Finished Goods (FG) materials dynamically from S/4HANA SD_F2369_INQY_FS_SRV.I_Material.
   * Restricts strictly to Finished Goods (MaterialType = 'ZFRT' or MaterialType = 'FERT').
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
      // Finished Goods constraint in S/4HANA Client 220
      const fgCondition = [
        '(',
        { ref: ['MaterialType'] },
        '=',
        { val: 'ZFRT' },
        'or',
        { ref: ['MaterialType'] },
        '=',
        { val: 'FERT' },
        ')'
      ];

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
   * Retrieves Sales Inquiries list from S/4HANA worklist service.
   */
  async getInquiries(query) {
    await this.init();
    if (!this.s4hanaWL) {
      const err = new Error('Sales inquiries cannot be read: the SAP SD service SD_F2370_INQY_WL_SRV is not connected.');
      err.status = 503;
      throw err;
    }
    try {
      const execQuery = SELECT.from('SD_F2370_INQY_WL_SRV.C_InquiryWL_F2370');
      if (query?.SELECT?.columns) execQuery.columns(query.SELECT.columns);
      if (query?.SELECT?.where) execQuery.where(query.SELECT.where);
      if (query?.SELECT?.orderBy && query.SELECT.orderBy.length > 0) {
        execQuery.orderBy(query.SELECT.orderBy);
      } else {
        execQuery.orderBy('CreationDate desc', 'SalesInquiry desc');
      }
      if (query?.SELECT?.limit) {
        const rows = query.SELECT.limit.rows?.val ?? query.SELECT.limit.rows ?? 50;
        const offset = query.SELECT.limit.offset?.val ?? query.SELECT.limit.offset ?? 0;
        execQuery.limit(rows, offset);
      } else {
        execQuery.limit(50);
      }
      if (query?.SELECT?.count) {
        execQuery.SELECT.count = true;
      }
      const res = await this.s4hanaWL.run(execQuery);
      const list = Array.isArray(res) ? res : (res?.value || res?.d?.results || []);
      if (res?.$count !== undefined) {
        list.$count = res.$count;
      }
      return list;
    } catch (err) {
      LOG.error('Error fetching inquiries from SD_F2370_INQY_WL_SRV:', err.message);
      if (!err.status) err.status = 502;
      throw err;
    }
  }

  /**
   * Retrieves single Sales Inquiry details by ID directly from S/4HANA.
   * Runs independent worklist header, factsheet header, and factsheet items in parallel.
   */
  async getInquiry(sId) {
    const sKey = String(sId).trim();
    await this.init();
    let header = null;
    let items = [];

    // Parallel fetch: worklist header, factsheet header with partner cards, and factsheet items
    const [wlResult, fsHeaderResult, fsItemsResult] = await Promise.allSettled([
      // 1. Fetch worklist header record (contains OrganizationBPName1, CreationDate, CreatedByUser, SalesOffice, SalesGroup, etc.)
      (async () => {
        if (!this.s4hanaWL) return null;
        try {
          return await this.s4hanaWL.run(
            SELECT.one.from('SD_F2370_INQY_WL_SRV.C_InquiryWL_F2370', inq => {
              inq('*');
              inq.to_SalesOffice('*');
              inq.to_SalesGroup('*');
            }).where({ SalesInquiry: sKey })
          );
        } catch (_e) {
          // Fallback to simple select if navigation expansion fails
          try {
            return await this.s4hanaWL.run(
              SELECT.one.from('SD_F2370_INQY_WL_SRV.C_InquiryWL_F2370').where({ SalesInquiry: sKey })
            );
          } catch (innerErr) {
            LOG.warn('Error fetching WL record for inquiry:', innerErr.message);
            throw innerErr;
          }
        }
      })(),

      // 2. Fetch factsheet header record and partner cards (contains CustomerPurchaseOrderDate, Validity Dates, Partners)
      (async () => {
        if (!this.s4hanaFS) return null;
        try {
          return await this.s4hanaFS.run(
            SELECT.one.from('SD_F2369_INQY_FS_SRV.C_Inquiryfs', doc => {
              doc('*');
              doc.to_SDDocumentPartnerCard('*');
            }).where({ SalesInquiry: sKey })
          );
        } catch (fse) {
          LOG.warn('Error fetching FS record for inquiry:', fse.message);
          throw fse;
        }
      })(),

      // 3. Fetch items with computed NetPriceAmount
      (async () => {
        if (!this.s4hanaFS) return [];
        try {
          return await this.s4hanaFS.run(
            SELECT.from('SD_F2369_INQY_FS_SRV.C_Inquiryitemfs').where({ SalesInquiry: sKey })
          );
        } catch (ie) {
          LOG.warn('Error fetching items for inquiry:', ie.message);
          throw ie;
        }
      })()
    ]);

    const res = wlResult.status === 'fulfilled' ? wlResult.value : null;
    if (res) {
      header = { ...res };
      if (res.to_SalesOffice?.SalesOfficeName) {
        header.SalesOfficeName = res.to_SalesOffice.SalesOfficeName;
      }
      if (res.to_SalesGroup?.SalesGroupName) {
        header.SalesGroupName = res.to_SalesGroup.SalesGroupName;
      }
    }

    const fsDoc = fsHeaderResult.status === 'fulfilled' ? fsHeaderResult.value : null;
    if (fsDoc) {
      header = Object.assign({}, fsDoc, header || {});
      if (fsDoc.CustomerPurchaseOrderDate) header.CustomerPurchaseOrderDate = fsDoc.CustomerPurchaseOrderDate;
      if (fsDoc.BindingPeriodValidityStartDate) header.BindingPeriodValidityStartDate = fsDoc.BindingPeriodValidityStartDate;
      if (fsDoc.BindingPeriodValidityEndDate) header.BindingPeriodValidityEndDate = fsDoc.BindingPeriodValidityEndDate;
      if (fsDoc.SalesAreaDesc) header.SalesAreaDesc = fsDoc.SalesAreaDesc;

      const partners = Array.isArray(fsDoc.to_SDDocumentPartnerCard) ? fsDoc.to_SDDocumentPartnerCard : [];
      const shipTo = partners.find(p => p.PartnerFunction === 'WE');
      if (shipTo) {
        header.ShipToParty = shipTo.Customer || shipTo.BusinessPartner;
        header.ShipToPartyName = shipTo.FullName;
      }
      const contact = partners.find(p => p.PartnerFunction === 'ZP' || p.PartnerFunction === 'CP');
      if (contact) {
        header.ContactPersonName = contact.FullName || '';
        header.ContactPerson = contact.ContactPerson || contact.Personnel || contact.BusinessPartner || '';
      }
      const salesEmp = partners.find(p => p.PartnerFunction === 'ZE');
      if (salesEmp) {
        header.SalesEmployeeName = salesEmp.FullName;
      }
    }

    // Check for outage when header could not be read
    const headerFailures = [];
    if (wlResult.status === 'rejected') {
      headerFailures.push(`WL: ${wlResult.reason?.message || 'failed'}`);
    }
    if (fsHeaderResult.status === 'rejected') {
      headerFailures.push(`FS: ${fsHeaderResult.reason?.message || 'failed'}`);
    }

    if (!header && headerFailures.length > 0) {
      LOG.error(`Failed to read Sales Inquiry ${sKey} from SAP S/4HANA:`, headerFailures.join('; '));
      const err = new Error(`Sales Inquiry ${sKey} could not be read from SAP S/4HANA (${headerFailures.join('; ')}).`);
      err.status = 502;
      throw err;
    }

    let itemsUnavailable = false;
    let itemsUnavailableReason = '';
    if (fsItemsResult.status === 'rejected') {
      itemsUnavailable = true;
      itemsUnavailableReason = fsItemsResult.reason?.message || 'Factsheet item service error';
      LOG.warn(`Line items for inquiry ${sKey} were unavailable:`, itemsUnavailableReason);
    }

    const itemRes = fsItemsResult.status === 'fulfilled' ? fsItemsResult.value : [];
    const rawItems = Array.isArray(itemRes) ? itemRes : (itemRes?.value || itemRes?.d?.results || []);
    items = rawItems.map(item => {
      const price = (item.NetPriceAmount !== undefined && item.NetPriceAmount !== null && item.NetPriceAmount !== '')
        ? String(item.NetPriceAmount)
        : '';
      return {
        ...item,
        NetPriceAmount: price
      };
    });

    if (header) {
      header.ShipToParty = header.ShipToParty || '';
      header.ShipToPartyName = header.ShipToPartyName || '';

      // 4. Resolve descriptions (names) for authentic SalesOffice and SalesGroup present on the SAP document
      // Never borrow SalesOffice or SalesGroup from other inquiries or value help defaults. Show what SAP holds, blank if blank.
      if (this.s4hanaWL) {
        const sOff = header.SalesOffice ? String(header.SalesOffice).trim() : '';
        const sGrp = header.SalesGroup ? String(header.SalesGroup).trim() : '';

        const needsOfficeName = sOff && (!header.SalesOfficeName || header.SalesOfficeName.trim() === '');
        const needsGroupName = sGrp && (!header.SalesGroupName || header.SalesGroupName.trim() === '');

        if (needsOfficeName || needsGroupName) {
          const [nameRes, groupNameRes] = await Promise.allSettled([
            needsOfficeName ? this.salesOfficeVhCache.getOrSet(`office:${sOff}`, async () => {
              const oVH = await this.s4hanaWL.run(
                SELECT.one.from('SD_F2370_INQY_WL_SRV.C_SalesOfficeValueHelp').where({ SalesOffice: sOff })
              );
              return oVH?.SalesOfficeName || '';
            }) : Promise.resolve(header.SalesOfficeName || ''),

            needsGroupName ? this.salesGroupVhCache.getOrSet(`group_name:${sGrp}`, async () => {
              const gVH = await this.s4hanaWL.run(
                SELECT.one.from('SD_F2370_INQY_WL_SRV.C_SalesGroupValueHelp').where({ SalesGroup: sGrp })
              );
              return gVH?.SalesGroupName || '';
            }) : Promise.resolve(header.SalesGroupName || '')
          ]);

          if (needsOfficeName && nameRes.status === 'fulfilled' && nameRes.value) {
            header.SalesOfficeName = nameRes.value;
          }
          if (needsGroupName && groupNameRes.status === 'fulfilled' && groupNameRes.value) {
            header.SalesGroupName = groupNameRes.value;
          }
        }
      }

      header.SalesOffice = header.SalesOffice || '';
      header.SalesOfficeName = header.SalesOfficeName || '';
      header.SalesGroup = header.SalesGroup || '';
      header.SalesGroupName = header.SalesGroupName || '';

      return { header, items, itemsUnavailable, itemsUnavailableReason };
    }

    return null;
  }

  /**
   * Retrieves Sales Orders list from S/4HANA worklist service (SD_F1873_SO_WL_SRV).
   */
  async getSalesOrders(query, options = {}) {
    await this.init();
    if (this.s4hanaSO) {
      try {
        const execQuery = SELECT.from('SD_F1873_SO_WL_SRV.C_SalesOrderWl_F1873');
        if (query?.SELECT?.columns) execQuery.columns(query.SELECT.columns);
        if (query?.SELECT?.where) execQuery.where(query.SELECT.where);
        if (query?.SELECT?.orderBy && query.SELECT.orderBy.length > 0) {
          execQuery.orderBy(query.SELECT.orderBy);
        } else {
          execQuery.orderBy('CreationDate desc', 'SalesOrder desc');
        }
        if (query?.SELECT?.limit) {
          const rows = query.SELECT.limit.rows?.val ?? query.SELECT.limit.rows ?? 50;
          const offset = query.SELECT.limit.offset?.val ?? query.SELECT.limit.offset ?? 0;
          execQuery.limit(rows, offset);
        } else {
          execQuery.limit(50);
        }
        if (query?.SELECT?.count) {
          execQuery.SELECT.count = true;
        }
        const res = await this.s4hanaSO.run(execQuery);
        const list = Array.isArray(res) ? res : (res?.value || res?.d?.results || []);
        if (res?.$count !== undefined) {
          list.$count = res.$count;
        }
        return list;
      } catch (err) {
        LOG.warn('Fetching sales orders from SD_F1873_SO_WL_SRV via CDS failed, falling back to HTTP client:', err.message);
      }
    }

    try {
      const dest = options.destination || await this._getDestination(options);
      const executeFn = options.executeHttpRequest || this.client._execute;
      const bCount = !!(query?.SELECT?.count);
      const sInlineCount = bCount ? '&$inlinecount=allpages' : '';
      const res = await executeFn(dest, {
        method: 'get',
        url: `/sap/opu/odata/sap/SD_F1873_SO_WL_SRV/C_SalesOrderWl_F1873?$top=50&$orderby=CreationDate desc,SalesOrder desc${sInlineCount}`,
        headers: { 'Accept': 'application/json', ...(options.headers || {}) }
      });
      const rawResults = res.data?.d?.results || res.data?.value || [];
      const normalized = rawResults.map(item => {
        const copy = { ...item };
        ['CreationDate', 'SalesOrderDate', 'RequestedDeliveryDate', 'LastChangeDate'].forEach(dateField => {
          if (copy[dateField] && typeof copy[dateField] === 'string') {
            const match = copy[dateField].match(/\/Date\((\d+)\)\//);
            if (match) {
              copy[dateField] = new Date(Number(match[1])).toISOString().split('T')[0];
            }
          }
        });
        if (copy.LastChangeDateTime && typeof copy.LastChangeDateTime === 'string') {
          const match = copy.LastChangeDateTime.match(/\/Date\((\d+)([+-]\d+)?\)\//);
          if (match) {
            copy.LastChangeDateTime = new Date(Number(match[1])).toISOString();
          }
        }
        return copy;
      });
      const rawCount = res.data?.d?.__count ?? res.data?.['@odata.count'];
      if (rawCount !== undefined) {
        normalized.$count = Number(rawCount);
      }
      return normalized;
    } catch (httpErr) {
      LOG.error('Error reading sales orders from SD_F1873_SO_WL_SRV:', httpErr.message);
      const err = new Error(`Sales orders cannot be read: ${httpErr.message}`);
      err.status = httpErr.status || 502;
      throw err;
    }
  }

  /**
   * Retrieves single Sales Order details by ID directly from S/4HANA worklist service.
   */
  async getSalesOrder(sId, options = {}) {
    const sKey = String(sId).trim();
    await this.init();
    if (this.s4hanaSO) {
      try {
        const order = await this.s4hanaSO.run(
          SELECT.one.from('SD_F1873_SO_WL_SRV.C_SalesOrderWl_F1873', so => {
            so('*');
            so.to_SalesDocumentItemWl('*');
          }).where({ SalesOrder: sKey })
        );
        if (order) return order;
      } catch (_err) {
        try {
          const order = await this.s4hanaSO.run(
            SELECT.one.from('SD_F1873_SO_WL_SRV.C_SalesOrderWl_F1873').where({ SalesOrder: sKey })
          );
          if (order) return order;
        } catch (_innerErr) {
          LOG.warn('Fetching sales order via CDS failed, falling back to HTTP client:', _innerErr.message);
        }
      }
    }

    try {
      const dest = options.destination || await this._getDestination(options);
      const executeFn = options.executeHttpRequest || this.client._execute;
      const res = await executeFn(dest, {
        method: 'get',
        url: `/sap/opu/odata/sap/SD_F1873_SO_WL_SRV/C_SalesOrderWl_F1873(%27${sKey}%27)?$expand=to_SalesDocumentItemWl`,
        headers: { 'Accept': 'application/json', ...(options.headers || {}) }
      });
      return res.data?.d || res.data || null;
    } catch (httpErr) {
      if (httpErr.status === 404 || httpErr.statusCode === 404) return null;
      LOG.error(`Error reading sales order ${sKey} from SD_F1873_SO_WL_SRV:`, httpErr.message);
      const err = new Error(`Sales order ${sKey} cannot be read: ${httpErr.message}`);
      err.status = httpErr.status || 502;
      throw err;
    }
  }

  /**
   * Provides standard Sales Order creation defaults.
   */
  async getSalesOrderDefaults() {
    const today = new Date().toISOString().split('T')[0];
    const defaultDelivery = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    return {
      SalesOrderType: s4Config.getOrderType(),
      SalesOrganization: s4Config.getSalesOrganization(),
      DistributionChannel: s4Config.getDistributionChannel(),
      OrganizationDivision: s4Config.getDivision(),
      Plant: s4Config.getPlant(),
      RequestedDeliveryDate: defaultDelivery,
      SalesOrderDate: today,
      CreationDate: today,
      TransactionCurrency: s4Config.getCurrency(),
      derived: true
    };
  }

  /**
   * Derives default organizational and commercial values for a customer.
   * Runs customer master lookup and historical inquiries in parallel, with
   * customer master details and value helps cached with a 5-minute TTL.
   */
  async getCustomerDefaults(sCustomer, sOrg, sChannel, sDivision) {
    if (!sCustomer || String(sCustomer).trim() === '') {
      return {
        Customer: '',
        CustomerName: '',
        City: '',
        Country: '',
        Currency: '',
        ShipToParty: '',
        ShipToPartyName: '',
        SalesOffice: '',
        SalesOfficeName: '',
        SalesGroup: '',
        SalesGroupName: '',
        derived: false
      };
    }

    const sCust = String(sCustomer).trim();
    let sName = '';
    let sCity = '';
    let sCountry = '';
    let sCurrency = s4Config.getCurrency();
    let sOffice = '';
    let sOfficeName = '';
    let sGroup = '';
    let sGroupName = '';

    await this.init();
    if (this.s4hanaWL) {
      try {
        // Parallel fetch: Customer master data (cached) + Customer historical inquiries
        const [custResult, inqResult] = await Promise.allSettled([
          this.customerMasterCache.getOrSet(sCust, async () => {
            const custRows = await this.s4hanaWL.run(
              SELECT.from('SD_F2370_INQY_WL_SRV.I_Customer_VH').where({ Customer: sCust }).limit(1)
            );
            const cust = Array.isArray(custRows) ? custRows[0] : (custRows?.value?.[0] || null);
            if (cust) {
              return {
                Name: cust.CustomerName || cust.OrganizationBPName1 || cust.BusinessPartnerName1 || '',
                City: cust.CityName || cust.BPAddrCityName || '',
                Country: cust.Country || ''
              };
            }
            return null;
          }),

          (async () => {
            return await this.s4hanaWL.run(
              SELECT.from('SD_F2370_INQY_WL_SRV.C_InquiryWL_F2370')
                .columns('TransactionCurrency', 'SalesOrganization', 'DistributionChannel', 'OrganizationDivision', 'SalesOffice', 'SalesGroup')
                .where({ SoldToParty: sCust })
                .limit(5)
            );
          })()
        ]);

        if (custResult.status === 'fulfilled' && custResult.value) {
          sName = custResult.value.Name || '';
          sCity = custResult.value.City || '';
          sCountry = custResult.value.Country || '';
        }

        const rawInqs = inqResult.status === 'fulfilled' ? inqResult.value : [];
        const aInqs = Array.isArray(rawInqs) ? rawInqs : (rawInqs?.value || []);
        for (const inq of aInqs) {
          if (inq?.TransactionCurrency && !sCurrency) sCurrency = inq.TransactionCurrency;
          if (inq?.SalesOffice && !sOffice) sOffice = inq.SalesOffice;
          if (inq?.SalesGroup && !sGroup) sGroup = inq.SalesGroup;
        }

        // If no office found on customer history, query valid office for provided sales area from cache or SAP
        if (!sOffice && sOrg) {
          const areaKey = `${sOrg}:${sChannel || s4Config.getDistributionChannel()}:${sDivision || s4Config.getDivision()}`;
          const oMatch = await this.salesOfficeVhCache.getOrSet(`area:${areaKey}`, async () => {
            const areaOffices = await this.s4hanaWL.run(
              SELECT.from('SD_F2370_INQY_WL_SRV.C_SalesOfficeValueHelp')
                .where({
                  SalesOrganization: sOrg,
                  DistributionChannel: sChannel || s4Config.getDistributionChannel(),
                  OrganizationDivision: sDivision || s4Config.getDivision()
                })
                .limit(1)
            );
            return Array.isArray(areaOffices) ? areaOffices[0] : (areaOffices?.value?.[0] || null);
          });
          if (oMatch?.SalesOffice) {
            sOffice = oMatch.SalesOffice;
            sOfficeName = oMatch.SalesOfficeName || '';
          }
        }

        // Parallel resolution of SalesOfficeName and SalesGroup if both are missing
        const needsOfficeName = sOffice && !sOfficeName;
        const needsGroup = sOffice && !sGroup;

        if (needsOfficeName || needsGroup) {
          const [nameRes, groupRes] = await Promise.allSettled([
            needsOfficeName ? this.salesOfficeVhCache.getOrSet(`office:${sOffice}`, async () => {
              const oVH = await this.s4hanaWL.run(
                SELECT.one.from('SD_F2370_INQY_WL_SRV.C_SalesOfficeValueHelp').where({ SalesOffice: sOffice })
              );
              return oVH?.SalesOfficeName || '';
            }) : Promise.resolve(sOfficeName),

            needsGroup ? this.salesGroupVhCache.getOrSet(`group_by_office:${sOffice}`, async () => {
              const gRows = await this.s4hanaWL.run(
                SELECT.from('SD_F2370_INQY_WL_SRV.C_SalesGroupValueHelp').where({ SalesOffice: sOffice }).limit(1)
              );
              const gRow = Array.isArray(gRows) ? gRows[0] : (gRows?.value?.[0] || null);
              return gRow ? { SalesGroup: gRow.SalesGroup, SalesGroupName: gRow.SalesGroupName || '' } : null;
            }) : Promise.resolve(null)
          ]);

          if (needsOfficeName && nameRes.status === 'fulfilled' && nameRes.value) {
            sOfficeName = nameRes.value;
          }
          if (needsGroup && groupRes.status === 'fulfilled' && groupRes.value) {
            sGroup = groupRes.value.SalesGroup || '';
            sGroupName = groupRes.value.SalesGroupName || '';
          }
        }

        if (sGroup && !sGroupName) {
          try {
            const grpName = await this.salesGroupVhCache.getOrSet(`group_name:${sGroup}`, async () => {
              const gVH = await this.s4hanaWL.run(
                SELECT.one.from('SD_F2370_INQY_WL_SRV.C_SalesGroupValueHelp').where({ SalesGroup: sGroup })
              );
              return gVH?.SalesGroupName || '';
            });
            if (grpName) sGroupName = grpName;
          } catch (e) {
            LOG.warn(`Could not resolve customer sales group name for ${sGroup}:`, e.message);
          }
        }
      } catch (err) {
        LOG.warn('getCustomerDefaults remote query warning:', err.message);
      }
    }

    return {
      Customer: sCust,
      CustomerName: sName,
      City: sCity,
      Country: sCountry,
      Currency: sCurrency,
      ShipToParty: sCust,
      ShipToPartyName: sName,
      SalesOffice: sOffice,
      SalesOfficeName: sOfficeName,
      SalesGroup: sGroup,
      SalesGroupName: sGroupName,
      derived: Boolean(sName || sCity || sOffice)
    };
  }

  /**
   * Retrieves standard default parameters for Sales Inquiry VA11 creation.
   */
  async getSalesInquiryDefaults() {
    const today = new Date().toISOString().split('T')[0];
    const validityEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    return {
      SalesInquiryType: s4Config.getInquiryType(),
      SalesOrganization: s4Config.getSalesOrganization(),
      DistributionChannel: s4Config.getDistributionChannel(),
      OrganizationDivision: s4Config.getDivision(),
      SalesInquiryDate: today,
      BindingPeriodValidityStartDate: today,
      BindingPeriodValidityEndDate: validityEnd,
      TransactionCurrency: s4Config.getCurrency(),
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
   * Creates a Sales Document (Sales Order or Sales Inquiry) in SAP S/4HANA using LORD_ODATA_ORDER_SRV.
   *
   * Architectural execution mode:
   * - Sales Inquiries ('ZIN'): Uses sequential 3-step POSTs (HeaderSet -> ItemSet -> PriceCondSet)
   *   because LORD_ODATA_ORDER_SRV rejects deep insert for Inquiry (SLS_LORD/005).
   * - Sales Orders ('ZDOM' or other order types): Uses OData Deep Insert (HeaderSet with nested ItemSet and PriceCondSet)
   *   because sequential POSTs are blocked by SAP approval workflow locking (V2/468).
   *
   * @param {string} docType - Document type (e.g. 'ZIN', 'ZDOM')
   * @param {Object} header - Normalized document header
   * @param {Array<Object>} items - Normalized line items
   * @param {Object} options - User and execution options
   * @returns {Promise<{ SalesDocument: string, SalesOrderID: string, SalesInquiry: string, SalesOrder: string, TotalNetAmount: string, TransactionCurrency: string, notTransmitted?: string[] }>}
   */
  async createSalesDocument(docType, header, items, options = {}) {
    const destination = options.destination || await this._getDestination(options);
    const servicePath = '/sap/opu/odata/sap/LORD_ODATA_ORDER_SRV';
    const executeFn = options.executeHttpRequest || this.client._execute;

    const custRef = (header.PurchaseOrderNumber || header.PurchaseOrderByCustomer)
      ? String(header.PurchaseOrderNumber || header.PurchaseOrderByCustomer).trim()
      : '';
    const effectiveDocType = String(docType || header.SalesOrderType || header.SalesInquiryType || s4Config.getInquiryType()).trim();
    const isOrder = effectiveDocType !== 'ZIN';

    // Upfront item unit and quantity validation for all document types
    if (Array.isArray(items) && items.length > 0) {
      for (let idx = 0; idx < items.length; idx++) {
        const itm = items[idx];
        const lineNum = itm.SalesOrderItem || itm.SalesInquiryItem || String((idx + 1) * 10).padStart(6, '0');
        const itemUnit = itm.OrderQuantityUnit || itm.SalesUnit || itm.UnitOfMeasure || itm.BaseUnit;
        if (!itemUnit || !String(itemUnit).trim()) {
          throw new Error(`Order quantity unit (SalesUnit) is required for item ${lineNum}`);
        }
        if (itm.OrderQuantity === undefined || itm.OrderQuantity === null || String(itm.OrderQuantity).trim() === '') {
          throw new Error(`OrderQuantity is required for item ${lineNum}`);
        }
        const qty = parseFloat(itm.OrderQuantity);
        if (isNaN(qty) || qty <= 0) {
          throw new Error(`OrderQuantity must be greater than 0 for item ${lineNum}`);
        }
      }
    }

    // -------------------------------------------------------------------------
    // Order Branch: OData Deep Insert
    // -------------------------------------------------------------------------
    if (isOrder) {
      let totalNet = 0;
      const deepItems = [];

      if (Array.isArray(items) && items.length > 0) {
        for (let idx = 0; idx < items.length; idx++) {
          const itm = items[idx];
          const qty = parseFloat(itm.OrderQuantity);
          const price = parseFloat(itm.NetPriceAmount) || 0;
          const net = itm.NetAmount !== undefined && itm.NetAmount !== null ? parseFloat(itm.NetAmount) : (qty * price);
          totalNet += net;

          const _lineNum = itm.SalesOrderItem || itm.SalesInquiryItem || String((idx + 1) * 10).padStart(6, '0');
          const resolvedMaterial = await this.resolveMaterial(itm.Material);

          const itemUnit = itm.OrderQuantityUnit || itm.SalesUnit || itm.UnitOfMeasure || itm.BaseUnit;
          if (!itemUnit || !String(itemUnit).trim()) {
            throw new Error(`Order quantity unit (SalesUnit) is required for item ${_lineNum}`);
          }
          const cleanItemUnit = String(itemUnit).trim().toUpperCase();

          const itemObj = {
            MaterialID: resolvedMaterial || itm.Material || '',
            OrderQty: String(qty.toFixed(3)),
            SalesUnit: cleanItemUnit
          };
          if (itm.Plant && String(itm.Plant).trim() !== '') {
            itemObj.Plant = String(itm.Plant).trim().toUpperCase();
          }
          if (itm.RequestedDeliveryDate) {
            const formattedDate = _formatODataV2Date(itm.RequestedDeliveryDate);
            if (formattedDate) itemObj.RequestedDeliveryDate = formattedDate;
          }

          const effectivePrice = price > 0 ? price : (qty > 0 && net > 0 ? (net / qty) : 0);
          if (effectivePrice > 0) {
            itemObj.PriceCondSet = [
              {
                CondTypeCode: s4Config.getConditionType(),
                AmountInternal: String(effectivePrice.toFixed(2)),
                RateUnitExternal: header.TransactionCurrency || s4Config.getCurrency(),
                PriceUnit: '1.000',
                UnitOfMeasure: cleanItemUnit
              }
            ];
          }
          deepItems.push(itemObj);
        }
      }

      const headerPayload = {
        SalesOrderTypeCode: effectiveDocType,
        SalesOrganization: header.SalesOrganization || s4Config.getSalesOrganization(),
        DistributionChannel: header.DistributionChannel || s4Config.getDistributionChannel(),
        Division: header.OrganizationDivision || s4Config.getDivision(),
        SoldToPartyID: header.SoldToParty || '',
        PurchaseOrderNumber: custRef,
        ItemSet: deepItems
      };
      if (header.RequestedDeliveryDate) {
        const formattedHdrDate = _formatODataV2Date(header.RequestedDeliveryDate);
        if (formattedHdrDate) headerPayload.RequestedDeliveryDate = formattedHdrDate;
      }

      let createResp;
      try {
        createResp = await executeFn(destination, {
          method: 'post',
          url: `${servicePath}/HeaderSet`,
          data: headerPayload,
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            ...(options.headers || {})
          }
        }, { fetchCsrfToken: options.fetchCsrfToken !== undefined ? options.fetchCsrfToken : true });
      } catch (orderErr) {
        const sapMsg = orderErr.response?.data?.error?.message?.value ||
          orderErr.response?.data?.error?.innererror?.errordetails?.[0]?.message ||
          orderErr.message;
        LOG.error('Failed to create Sales Order in S/4HANA:', sapMsg);
        const err = new Error(sapMsg);
        err.status = orderErr.response?.status || 502;
        throw err;
      }

      const sNewOrderId = createResp.data?.d?.SalesOrderID || createResp.data?.SalesOrderID;
      if (!sNewOrderId) {
        throw new Error('Sales Order number not returned from SAP S/4HANA');
      }

      const s4Header = createResp.data?.d || createResp.data || {};
      const sapNet = s4Header.NetAmount ?? s4Header.TotalAmount ?? s4Header.NetValue;
      const sapTotal = s4Header.TotalAmount;
      const sapTax = s4Header.TaxAmount;
      const sapCurrency = s4Header.DocumentCurrency || s4Header.Currency || header.TransactionCurrency || s4Config.getCurrency();

      const finalNet = (sapNet !== undefined && sapNet !== null && String(sapNet).trim() !== '')
        ? String(sapNet)
        : (totalNet > 0 ? String(totalNet.toFixed(2)) : '');

      return {
        SalesDocument: sNewOrderId,
        SalesOrderID: sNewOrderId,
        SalesOrder: sNewOrderId,
        SalesInquiry: sNewOrderId,
        TotalNetAmount: finalNet,
        NetAmount: s4Header.NetAmount !== undefined && s4Header.NetAmount !== null ? String(s4Header.NetAmount) : (finalNet || undefined),
        TotalAmount: sapTotal !== undefined && sapTotal !== null ? String(sapTotal) : undefined,
        TaxAmount: sapTax !== undefined && sapTax !== null ? String(sapTax) : undefined,
        TransactionCurrency: sapCurrency,
        notTransmitted: []
      };
    }

    // -------------------------------------------------------------------------
    // Inquiry Branch: Sequential 3-Step POSTs
    // -------------------------------------------------------------------------
    // 1. Post Header to LORD_ODATA_ORDER_SRV/HeaderSet
    const headerPayload = {
      SalesOrderTypeCode: effectiveDocType,
      SalesOrganization: header.SalesOrganization || s4Config.getSalesOrganization(),
      DistributionChannel: header.DistributionChannel || s4Config.getDistributionChannel(),
      Division: header.OrganizationDivision || s4Config.getDivision(),
      SoldToPartyID: header.SoldToParty || '',
      PurchaseOrderNumber: custRef
    };

    // Extension fields: only those the service exposes can be transmitted.
    const notTransmitted = [];
    const provided = INQUIRY_EXTENSION_FIELDS.filter(f => String(header[f] ?? '').trim() !== '');
    if (provided.length > 0) {
      const fields = await this._getLeanOrderFields(destination, executeFn);
      for (const f of provided) {
        if (fields.header.has(f)) headerPayload[f] = String(header[f]).trim();
        else notTransmitted.push(f);
      }
      if (notTransmitted.length > 0) {
        LOG.warn(`LORD_ODATA_ORDER_SRV has no field for ${notTransmitted.join(', ')};`
          + ' the inquiry will stay incomplete until these are maintained directly in SAP or the service is extended.');
      }
    }

    let headerResp;
    try {
      headerResp = await executeFn(destination, {
        method: 'post',
        url: `${servicePath}/HeaderSet`,
        data: headerPayload,
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          ...(options.headers || {})
        }
      }, { fetchCsrfToken: options.fetchCsrfToken !== undefined ? options.fetchCsrfToken : true });
    } catch (headerErr) {
      const sapMsg = headerErr.response?.data?.error?.message?.value ||
        headerErr.response?.data?.error?.innererror?.errordetails?.[0]?.message ||
        headerErr.message;
      LOG.error('Failed to create Sales Inquiry header in S/4HANA:', sapMsg);
      throw new Error(sapMsg);
    }

    const sNewInquiryId = headerResp.data?.d?.SalesOrderID || headerResp.data?.SalesOrderID;
    if (!sNewInquiryId) {
      throw new Error('Sales Inquiry number not returned from SAP S/4HANA');
    }

    let totalNet = 0;

    // 2. Post line items sequentially to LORD_ODATA_ORDER_SRV/HeaderSet('<SalesOrderID>')/ItemSet
    if (Array.isArray(items) && items.length > 0) {
      for (let idx = 0; idx < items.length; idx++) {
        const itm = items[idx];
        const qty = parseFloat(itm.OrderQuantity);
        const price = parseFloat(itm.NetPriceAmount) || 0;
        const net = itm.NetAmount !== undefined && itm.NetAmount !== null ? parseFloat(itm.NetAmount) : (qty * price);
        totalNet += net;

        const lineNum = itm.SalesInquiryItem || String((idx + 1) * 10).padStart(6, '0');
        const resolvedMaterial = await this.resolveMaterial(itm.Material);

        const itemUnit = itm.OrderQuantityUnit || itm.SalesUnit || itm.UnitOfMeasure || itm.BaseUnit;
        if (!itemUnit || !String(itemUnit).trim()) {
          throw new Error(`Order quantity unit (SalesUnit) is required for item ${lineNum}`);
        }
        const cleanItemUnit = String(itemUnit).trim().toUpperCase();

        const itemPayload = {
          SalesOrderID: sNewInquiryId,
          ItemID: lineNum,
          MaterialID: resolvedMaterial || itm.Material || '',
          OrderQty: String(qty.toFixed(3)),
          SalesUnit: cleanItemUnit
        };
        // Plant is on the ZIN item incompletion procedure; the Item entity carries it.
        if (itm.Plant && String(itm.Plant).trim() !== '') {
          itemPayload.Plant = String(itm.Plant).trim().toUpperCase();
        }

        try {
          await executeFn(destination, {
            method: 'post',
            url: `${servicePath}/HeaderSet(%27${sNewInquiryId}%27)/ItemSet`,
            data: itemPayload,
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              ...(options.headers || {})
            }
          }, { fetchCsrfToken: options.fetchCsrfToken !== undefined ? options.fetchCsrfToken : true });
        } catch (itemErr) {
          const itemSapMsg = itemErr.response?.data?.error?.message?.value ||
            itemErr.response?.data?.error?.innererror?.errordetails?.[0]?.message ||
            itemErr.message;
          LOG.error(`Failed to create item ${itemPayload.ItemID} for inquiry ${sNewInquiryId}:`, itemSapMsg);
          throw new PartialSalesInquiryError(
            `Sales Inquiry ${sNewInquiryId} was created in SAP S/4HANA, but adding item ${lineNum} failed: ${itemSapMsg}. Do not retry: check or complete inquiry ${sNewInquiryId} in SAP.`,
            sNewInquiryId,
            {
              step: 'ItemSet',
              itemNumber: lineNum,
              sapMessage: itemSapMsg,
              originalError: itemErr,
              status: itemErr.response?.status || 502
            }
          );
        }

        // 3. Post price condition (ZPR1) so S/4HANA pricing engine computes and stores Net Amount
        const effectivePrice = price > 0 ? price : (qty > 0 && net > 0 ? (net / qty) : 0);
        if (effectivePrice > 0) {
          const condPayload = {
            SalesOrderID: sNewInquiryId,
            ItemID: lineNum,
            CondTypeCode: s4Config.getConditionType(),
            AmountInternal: String(effectivePrice.toFixed(2)),
            RateUnitExternal: header.TransactionCurrency || s4Config.getCurrency(),
            PriceUnit: '1.000',
            UnitOfMeasure: cleanItemUnit
          };
          try {
            await executeFn(destination, {
              method: 'post',
              url: `${servicePath}/HeaderSet(%27${sNewInquiryId}%27)/PriceCondSet`,
              data: condPayload,
              headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                ...(options.headers || {})
              }
            }, { fetchCsrfToken: options.fetchCsrfToken !== undefined ? options.fetchCsrfToken : true });
          } catch (condErr) {
            const condSapMsg = condErr.response?.data?.error?.message?.value ||
              condErr.response?.data?.error?.innererror?.errordetails?.[0]?.message ||
              condErr.message;
            LOG.error(`Failed to set price condition for item ${lineNum}:`, condSapMsg);
            throw new PartialSalesInquiryError(
              `Sales Inquiry ${sNewInquiryId} was created in SAP S/4HANA with items, but adding price condition for item ${lineNum} failed: ${condSapMsg}. Do not retry: check or complete inquiry ${sNewInquiryId} in SAP.`,
              sNewInquiryId,
              {
                step: 'PriceCondSet',
                itemNumber: lineNum,
                sapMessage: condSapMsg,
                originalError: condErr,
                status: condErr.response?.status || 502
              }
            );
          }
        }
      }
    }

    let s4Header = headerResp.data?.d || headerResp.data || {};

    if (options.readBack) {
      try {
        const readResp = await executeFn(destination, {
          method: 'get',
          url: `${servicePath}/HeaderSet(%27${sNewInquiryId}%27)`,
          headers: {
            'Accept': 'application/json',
            ...(options.headers || {})
          }
        }, { fetchCsrfToken: false });
        if (readResp?.data?.d || readResp?.data) {
          s4Header = readResp.data?.d || readResp.data;
        }
      } catch (readErr) {
        LOG.warn(`Could not read back header totals for inquiry ${sNewInquiryId}:`, readErr.message);
      }
    }

    const sapNet = s4Header.NetAmount ?? s4Header.TotalAmount ?? s4Header.NetValue;
    const sapTotal = s4Header.TotalAmount;
    const sapTax = s4Header.TaxAmount;
    const sapCurrency = s4Header.DocumentCurrency || s4Header.Currency || header.TransactionCurrency || s4Config.getCurrency();

    // Prefer SAP's authentic NetAmount/TotalAmount if returned; otherwise fall back to computed totalNet or blank
    const finalNet = (sapNet !== undefined && sapNet !== null && String(sapNet).trim() !== '' && Number(sapNet) > 0)
      ? String(sapNet)
      : (totalNet > 0 ? String(totalNet.toFixed(2)) : (sapNet !== undefined && sapNet !== null && String(sapNet).trim() !== '' ? String(sapNet) : ''));

    return {
      SalesDocument: sNewInquiryId,
      SalesOrderID: sNewInquiryId,
      SalesInquiry: sNewInquiryId,
      SalesOrder: sNewInquiryId,
      TotalNetAmount: finalNet,
      NetAmount: s4Header.NetAmount !== undefined && s4Header.NetAmount !== null ? String(s4Header.NetAmount) : (finalNet || undefined),
      TotalAmount: sapTotal !== undefined && sapTotal !== null ? String(sapTotal) : undefined,
      TaxAmount: sapTax !== undefined && sapTax !== null ? String(sapTax) : undefined,
      TransactionCurrency: sapCurrency,
      notTransmitted
    };
  }

  /**
   * Creates a Sales Inquiry directly in SAP S/4HANA using LORD_ODATA_ORDER_SRV.
   */
  async createSalesInquiry(header, items, options = {}) {
    const docType = header.SalesInquiryType || s4Config.getInquiryType();
    return this.createSalesDocument(docType, header, items, options);
  }

  /**
   * Creates a Sales Order directly in SAP S/4HANA using LORD_ODATA_ORDER_SRV (Deep Insert).
   */
  async createSalesOrder(header, items, options = {}) {
    const docType = header.SalesOrderType || s4Config.getOrderType();
    return this.createSalesDocument(docType, header, items, options);
  }

  /**
   * Property names of the LORD_ODATA_ORDER_SRV Header and Item entities, read once from the live
   * $metadata and cached for the process. A failed read is not cached and yields empty sets, so
   * inquiry creation still works with the standard fields.
   */
  async _getLeanOrderFields(destination, executeFn = this.client._execute) {
    if (this._leanOrderFields) return this._leanOrderFields;
    const empty = { header: new Set(), item: new Set() };
    try {
      const res = await executeFn(destination, {
        method: 'get',
        url: `${LEAN_ORDER_PATH}/$metadata`,
        headers: { 'Accept': 'application/xml, text/xml' }
      }, { fetchCsrfToken: false });
      const xml = typeof res?.data === 'string' ? res.data : '';
      const props = (name) => {
        const m = xml.match(new RegExp(`<EntityType Name="${name}"[\\s\\S]*?</EntityType>`));
        return new Set(m ? [...m[0].matchAll(/<Property Name="([^"]+)"/g)].map(x => x[1]) : []);
      };
      const fields = { header: props('Header'), item: props('Item') };
      if (fields.header.size === 0) {
        LOG.warn('LORD_ODATA_ORDER_SRV $metadata returned no Header properties; capabilities unknown.');
        return empty;
      }
      this._leanOrderFields = fields;
      return fields;
    } catch (err) {
      LOG.warn('Could not read LORD_ODATA_ORDER_SRV $metadata:', err.message);
      return empty;
    }
  }

  /**
   * Reports which extension fields the SAP inquiry creation service can accept right now.
   * The UI marks accepted fields as required and tells the user to maintain the others directly in SAP.
   */
  async getInquiryCreationCapabilities(options = {}) {
    const destination = options.destination || await this._getDestination(options);
    const executeFn = options.executeHttpRequest || this.client._execute;
    const fields = await this._getLeanOrderFields(destination, executeFn);
    const caps = { service: 'LORD_ODATA_ORDER_SRV' };
    for (const f of INQUIRY_EXTENSION_FIELDS) caps[f] = fields.header.has(f);
    caps.Plant = fields.item.has('Plant');
    return caps;
  }

  /**
   * Sales order counts read live from SAP S/4HANA (SD_F1873_SO_WL_SRV, entity C_SalesOrderWl_F1873):
   * open orders (OverallSDProcessStatus ne 'C') and all orders.
   *
   * Fails when the destination cannot be resolved or SAP does not return both counts; no count is
   * ever defaulted.
   *
   * @param {Object} [options] - destination / executeHttpRequest / headers overrides
   * @returns {Promise<{ openOrdersCount: number, totalOrdersCount: number }>}
   * @throws {Error} status 503 without a destination, 502 when SAP could not be read
   */
  async getSalesMetrics(options = {}) {
    const isOrder = options.entity !== 'inquiry';
    const docLabel = isOrder ? 'Sales order' : 'Sales inquiry';
    const serviceName = isOrder ? 'SD_F1873_SO_WL_SRV' : 'SD_F2370_INQY_WL_SRV';
    const servicePath = isOrder ? '/sap/opu/odata/sap/SD_F1873_SO_WL_SRV' : '/sap/opu/odata/sap/SD_F2370_INQY_WL_SRV';
    const entitySet = isOrder ? 'C_SalesOrderWl_F1873' : 'C_InquiryWL_F2370';

    let dest;
    try {
      dest = options.destination || await this._getDestination(options);
    } catch (e) {
      const err = new Error(`${docLabel} metrics are not available: ${e.message}`);
      err.status = 503;
      throw err;
    }

    const executeFn = options.executeHttpRequest || this.client._execute;
    const request = (query) => executeFn(dest, {
      method: 'get',
      url: `${servicePath}/${entitySet}?${query}`,
      headers: { 'Accept': 'application/json', ...(options.headers || {}) }
    });
    const countOf = (res) => {
      const raw = res?.data?.d?.__count ?? res?.data?.['@odata.count'];
      const n = Number(raw);
      return raw !== undefined && raw !== null && String(raw).trim() !== '' && Number.isInteger(n) && n >= 0 ? n : null;
    };

    let resOpen;
    let resTotal;
    try {
      [resOpen, resTotal] = await Promise.all([
        request("$inlinecount=allpages&$top=1&$filter=OverallSDProcessStatus ne 'C'"),
        request('$inlinecount=allpages&$top=1')
      ]);
    } catch (e) {
      const err = new Error(`${docLabel} metrics could not be read from ${serviceName}: ${e.message}`);
      err.status = 502;
      throw err;
    }

    const openOrdersCount = countOf(resOpen);
    const totalOrdersCount = countOf(resTotal);
    if (openOrdersCount === null || totalOrdersCount === null) {
      const err = new Error(`${docLabel} metrics are not available: ${serviceName} returned no count.`);
      err.status = 502;
      throw err;
    }
    return { openOrdersCount, totalOrdersCount };
  }

  /**
   * Executes CheckATP FunctionImport in LORD_ODATA_ORDER_SRV for a given document and item.
   *
   * @param {string} salesOrderID - Sales document number (10 chars, e.g. "0005000461")
   * @param {string} itemID - Item number (6 chars, e.g. "000010")
   * @param {Object} [options] - Destination / execution overrides
   * @returns {Promise<{ RequestedQty: number, ConfirmedQty: number, ReqDlvDate: string|null, CnfDlvDate: string|null, SalesUnit: string }>}
   */
  async checkATP(salesOrderID, itemID, options = {}) {
    let dest;
    try {
      dest = options.destination || await this._getDestination(options);
    } catch (e) {
      const err = new Error(`ATP check is not available: ${e.message}`);
      err.status = 503;
      throw err;
    }

    const servicePath = '/sap/opu/odata/sap/LORD_ODATA_ORDER_SRV';
    const executeFn = options.executeHttpRequest || this.client._execute;

    const sDocId = String(salesOrderID || '').padStart(10, '0');
    const sItemId = String(itemID || '10').padStart(6, '0');
    const url = `${servicePath}/CheckATP?SalesOrderID='${encodeURIComponent(sDocId)}'&ItemID='${encodeURIComponent(sItemId)}'`;

    let res;
    try {
      res = await executeFn(dest, {
        method: 'post',
        url,
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          ...(options.headers || {})
        }
      }, { fetchCsrfToken: options.fetchCsrfToken !== undefined ? options.fetchCsrfToken : true });
    } catch (err) {
      const sapMsg = err.response?.data?.error?.message?.value ||
        err.response?.data?.error?.innererror?.errordetails?.[0]?.message ||
        err.message;
      const e = new Error(`ATP check failed for document ${sDocId} item ${sItemId}: ${sapMsg}`);
      e.status = err.response?.status || 502;
      throw e;
    }

    const data = (res?.data?.d?.CheckATP || res?.data?.d || res?.data) || {};
    return {
      RequestedQty: parseFloat(data.RequestedQty) || 0,
      ConfirmedQty: parseFloat(data.ConfirmedQty) || 0,
      ReqDlvDate: data.ReqDlvDate || null,
      CnfDlvDate: data.CnfDlvDate || null,
      SalesUnit: data.SalesUnit || ''
    };
  }
}

const defaultAdapter = new SalesInquiryAdapter();
defaultAdapter.SalesInquiryAdapter = SalesInquiryAdapter;
defaultAdapter.PartialSalesInquiryError = PartialSalesInquiryError;

module.exports = defaultAdapter;
module.exports.PartialSalesInquiryError = PartialSalesInquiryError;
