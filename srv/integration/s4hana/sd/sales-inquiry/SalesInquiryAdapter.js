const cds = require('@sap/cds');
const LOG = require('../../../../common/logger')('sales-inquiry-adapter');
const { S4HttpClient } = require('../../S4HttpClient');
const { RfcClient } = require('../../RfcClient');
const s4Config = require('../../s4Config');
const businessConfigResolver = require('../../../../common/BusinessConfigResolver');
const TtlCache = require('../../../../common/TtlCache');
const { sapKey } = require('../../sapKey');

const { PartialSalesInquiryError } = require('./PartialSalesInquiryError');
const {
  _formatODataV2Date,
  _formatODataV2Literal,
  _cqnOrderByToOData,
  _cqnWhereToODataFilter
} = require('./salesInquiryODataHelper');
const documentCreator = require('./salesInquiryDocumentCreator');


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
      const bCount = !!(query?.SELECT?.count || query?._queryOptions?.$count === 'true');

      // 1. Pagination: honour limit.rows and limit.offset if specified
      const limitObj = query?.SELECT?.limit;
      let top = options.top;
      let skip = options.skip;

      if (limitObj) {
        if (limitObj.rows !== undefined) {
          top = limitObj.rows?.val !== undefined ? Number(limitObj.rows.val) : Number(limitObj.rows);
        }
        if (limitObj.offset !== undefined) {
          skip = limitObj.offset?.val !== undefined ? Number(limitObj.offset.val) : Number(limitObj.offset);
        }
      }
      if (top === undefined || top === null || isNaN(top)) {
        top = query?._queryOptions?.$top ? parseInt(query._queryOptions.$top, 10) : 50;
      }
      if (skip === undefined || skip === null || isNaN(skip)) {
        skip = query?._queryOptions?.$skip ? parseInt(query._queryOptions.$skip, 10) : 0;
      }

      // 2. Ordering: honour query.SELECT.orderBy if specified
      let orderByStr = options.orderBy || _cqnOrderByToOData(query?.SELECT?.orderBy);
      if (!orderByStr) {
        orderByStr = 'CreationDate desc,SalesOrder desc';
      }

      // 3. Filtering: honour user's filter and refuse to drop it
      const rawWhere = query?.SELECT?.where || query?.where;
      const hasFilterRequirement = !!(options.filter || rawWhere || query?._queryOptions?.$filter);
      let filterStr = options.filter || (query?._queryOptions?.$filter ? query._queryOptions.$filter.trim() : '');
      if (!filterStr && rawWhere) {
        filterStr = _cqnWhereToODataFilter(rawWhere);
      }

      if (hasFilterRequirement && !filterStr) {
        const err = new Error('Cannot safely translate sales order query filter to OData HTTP fallback; refusing to return unfiltered results.');
        err.status = 500;
        throw err;
      }

      const queryParts = [];
      if (top !== undefined && top !== null && !isNaN(top) && top > 0) {
        queryParts.push(`$top=${top}`);
      } else {
        queryParts.push('$top=50');
      }
      if (skip !== undefined && skip !== null && !isNaN(skip) && skip > 0) {
        queryParts.push(`$skip=${skip}`);
      }
      if (orderByStr) {
        queryParts.push(`$orderby=${orderByStr}`);
      }
      if (bCount) {
        queryParts.push('$inlinecount=allpages');
      }
      if (filterStr) {
        queryParts.push(`$filter=${filterStr}`);
      }

      const queryString = queryParts.join('&');
      const res = await executeFn(dest, {
        method: 'get',
        url: `/sap/opu/odata/sap/SD_F1873_SO_WL_SRV/C_SalesOrderWl_F1873${queryString ? `?${queryString}` : ''}`,
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
  async getSalesOrderDefaults(context = {}) {
    const today = new Date().toISOString().split('T')[0];
    const plant = (context && context.plant) || '1120';
    let cfg = {};
    try {
      cfg = await (this.resolver || businessConfigResolver).resolve({
        plant,
        flow: 'sd',
        fields: ['salesOrganization', 'distributionChannel', 'division', 'currency', 'orderType'],
        isTrusted: true
      });
    } catch (_) {
      cfg = {
        orderType: 'ZDOM',
        salesOrganization: '1000',
        distributionChannel: '10',
        division: '52',
        currency: 'INR'
      };
    }
    return {
      SalesOrderType: cfg.orderType || 'ZDOM',
      SalesOrganization: cfg.salesOrganization || '1000',
      DistributionChannel: cfg.distributionChannel || '10',
      OrganizationDivision: cfg.division || '52',
      Plant: plant,
      // No proposed delivery date: S/4HANA derives it from customizing when the user leaves it blank.
      RequestedDeliveryDate: '',
      SalesOrderDate: today,
      CreationDate: today,
      TransactionCurrency: cfg.currency || 'INR',
      derived: true
    };
  }

  /**
   * Derives default organizational and commercial values for a customer.
   * Runs customer master lookup and historical inquiries in parallel, with
   * customer master details and value helps cached with a 5-minute TTL.
   */
  // Sales area parameters are accepted for API compatibility; no office/group is guessed from them any more.
  async getCustomerDefaults(sCustomer, _sOrg, _sChannel, _sDivision) {
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
        PaymentTerms: '',
        Incoterms: '',
        IncotermsLocation1: '',
        INCO1: '',
        INCO2: '',
        validForSalesArea: true,
        salesAreaError: '',
        maintainedSalesAreasSummary: '',
        derived: false
      };
    }

    const sCust = String(sCustomer).trim();
    const sOrg = _sOrg ? String(_sOrg).trim() : '';
    const sChannel = _sChannel ? String(_sChannel).trim() : '';
    const sDivision = _sDivision ? String(_sDivision).trim() : '';
    let sName = '';
    let sCity = '';
    let sCountry = '';
    let sCurrency = '';
    let bDerived = false; // true when a value was taken from the customer's previous documents
    let sOffice = '';
    let sOfficeName = '';
    let sGroup = '';
    let sGroupName = '';
    let sPaymentTerms = '';
    let sInco1 = '';
    let sInco2 = '';
    let bValidForSalesArea = true;
    let sSalesAreaError = '';
    let sMaintainedSalesAreasSummary = '';

    await this.init();
    if (this.s4hanaWL) {
      try {
        // Parallel fetch: Customer master data (cached) + Customer historical inquiries + Customer sales areas (cached)
        const [custResult, inqResult, salesAreaResult] = await Promise.allSettled([
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
          })(),

          (async () => {
            if (!this.client || typeof this.client.get !== 'function') return null;
            if (process.env.NODE_ENV === 'test' && !this.client.get._isMockFunction) return null;
            return await this.customerSalesAreaCache.getOrSet(sCust, async () => {
              try {
                const res = await this.client.get(`/sap/opu/odata/sap/FAR_CUSTOMER_LIST_V2/C_CustomerList?$filter=Customer eq '${sCust}'`);
                const items = Array.isArray(res.data?.d?.results) ? res.data.d.results : (Array.isArray(res.data?.value) ? res.data.value : []);
                return items;
              } catch (e) {
                LOG.warn('FAR_CUSTOMER_LIST_V2 customer sales area lookup warning:', e.message);
                return null;
              }
            });
          })()
        ]);

        let bCustMasterFound = false;
        if (custResult.status === 'fulfilled' && custResult.value) {
          sName = custResult.value.Name || '';
          sCity = custResult.value.City || '';
          sCountry = custResult.value.Country || '';
          bCustMasterFound = true;
        }

        const rawInqs = inqResult.status === 'fulfilled' ? inqResult.value : [];
        const aInqs = Array.isArray(rawInqs) ? rawInqs : (rawInqs?.value || []);
        for (const inq of aInqs) {
          if (inq?.TransactionCurrency && !sCurrency) { sCurrency = inq.TransactionCurrency; bDerived = true; }
          if (inq?.SalesOffice && !sOffice) { sOffice = inq.SalesOffice; bDerived = true; }
          if (inq?.SalesGroup && !sGroup) { sGroup = inq.SalesGroup; bDerived = true; }
        }

        // Evaluate customer sales area maintenance from FAR_CUSTOMER_LIST_V2
        if (salesAreaResult.status === 'fulfilled' && Array.isArray(salesAreaResult.value) && salesAreaResult.value.length > 0) {
          const aRecords = salesAreaResult.value;
          const firstRec = aRecords[0];
          if (!bCustMasterFound) {
            if (!sName && firstRec.CustomerName) sName = firstRec.CustomerName;
            if (!sCity && firstRec.CityName) sCity = firstRec.CityName;
            if (!sCountry && firstRec.Country) sCountry = firstRec.Country;
          }

          if (sOrg || sChannel || sDivision) {
            const matchingArea = aRecords.find(r =>
              (!sOrg || r.SalesOrganization === sOrg) &&
              (!sChannel || r.DistributionChannel === sChannel) &&
              (!sDivision || r.Division === sDivision)
            );

            if (matchingArea) {
              bValidForSalesArea = true;
              if (matchingArea.SalesOffice && !sOffice) sOffice = matchingArea.SalesOffice;
              if (matchingArea.SalesGroup && !sGroup) sGroup = matchingArea.SalesGroup;
              if (matchingArea.CustomerPaymentTerms || matchingArea.PaymentTerms) {
                sPaymentTerms = matchingArea.CustomerPaymentTerms || matchingArea.PaymentTerms;
              }
              if (matchingArea.Incoterms || matchingArea.IncotermsClassification || matchingArea.INCO1) {
                sInco1 = matchingArea.Incoterms || matchingArea.IncotermsClassification || matchingArea.INCO1;
              }
              if (matchingArea.IncotermsLocation1 || matchingArea.IncotermsTransferLocation || matchingArea.INCO2 || matchingArea.INCO2_L) {
                sInco2 = matchingArea.IncotermsLocation1 || matchingArea.IncotermsTransferLocation || matchingArea.INCO2 || matchingArea.INCO2_L;
              }
            } else {
              bValidForSalesArea = false;
              const aAreas = aRecords.map(r => `${r.SalesOrganization || ''} ${r.DistributionChannel || ''} ${r.Division || ''}`.trim()).filter(Boolean);
              sMaintainedSalesAreasSummary = [...new Set(aAreas)].join(', ');
              sSalesAreaError = `Sold-to party ${sCust} not maintained for sales area ${sOrg} ${sChannel} ${sDivision}`;
            }
          }
        }

        // Sales office name is master data for a known office; no office or group is ever picked from the
        // first row of a value help (that was a guess, not the customer's data).
        if (sOffice && !sOfficeName) {
          try {
            sOfficeName = await this.salesOfficeVhCache.getOrSet(`office:${sOffice}`, async () => {
              const oVH = await this.s4hanaWL.run(
                SELECT.one.from('SD_F2370_INQY_WL_SRV.C_SalesOfficeValueHelp').where({ SalesOffice: sOffice })
              );
              return oVH?.SalesOfficeName || '';
            });
          } catch (e) {
            LOG.warn(`Could not resolve sales office name for ${sOffice}:`, e.message);
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

    // Direct RFC read on KNVV (Customer Master Sales Data) for INCO1, INCO2, ZTERM, VKBUR, VKGRP
    if (this.rfc && typeof this.rfc.readTable === 'function') {
      try {
        const sCustPadded = sapKey(sCust, 'kunnr').padStart(10, '0');
        const sOrgKey = sOrg ? sapKey(sOrg, 'vkorg') : '';
        const sChannelKey = sChannel ? sapKey(sChannel, 'vtweg') : '';
        const sDivisionKey = sDivision ? sapKey(sDivision, 'spart') : '';
        const knvvWhere = [`KUNNR = '${sCustPadded}'`];
        if (sOrgKey) knvvWhere.push(`AND VKORG = '${sOrgKey}'`);
        if (sChannelKey) knvvWhere.push(`AND VTWEG = '${sChannelKey}'`);
        if (sDivisionKey) knvvWhere.push(`AND SPART = '${sDivisionKey}'`);
        let knvvRows = await this.rfc.readTable('KNVV', ['INCO1', 'INCO2', 'ZTERM', 'VKBUR', 'VKGRP'], knvvWhere).catch(() => []);
        if ((!knvvRows || knvvRows.length === 0) && (sOrg || sChannel || sDivision)) {
          knvvRows = await this.rfc.readTable('KNVV', ['INCO1', 'INCO2', 'ZTERM', 'VKBUR', 'VKGRP'], [`KUNNR = '${sCustPadded}'`]).catch(() => []);
        }
        if (knvvRows && knvvRows.length > 0) {
          const kRow = knvvRows[0];
          if (kRow.INCO1 && !sInco1) sInco1 = kRow.INCO1.trim();
          if (kRow.INCO2 && !sInco2) sInco2 = kRow.INCO2.trim();
          if (kRow.ZTERM && !sPaymentTerms) sPaymentTerms = kRow.ZTERM.trim();
          if (kRow.VKBUR && !sOffice) sOffice = kRow.VKBUR.trim();
          if (kRow.VKGRP && !sGroup) sGroup = kRow.VKGRP.trim();
        }
      } catch (knvvErr) {
        LOG.warn('KNVV customer lookup warning:', knvvErr.message);
      }
    }

    return {
      Customer: sCust,
      CustomerName: sName,
      City: sCity,
      Country: sCountry,
      Currency: sCurrency,
      // Ship-to is not proposed: S/4HANA partner determination sets it on create when left blank.
      ShipToParty: '',
      ShipToPartyName: '',
      SalesOffice: sOffice,
      SalesOfficeName: sOfficeName,
      SalesGroup: sGroup,
      SalesGroupName: sGroupName,
      PaymentTerms: sPaymentTerms,
      Incoterms: sInco1,
      IncotermsLocation1: sInco2,
      INCO1: sInco1,
      INCO2: sInco2,
      validForSalesArea: bValidForSalesArea,
      salesAreaError: sSalesAreaError,
      maintainedSalesAreasSummary: sMaintainedSalesAreasSummary,
      derived: bDerived
    };
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
    if (isOrder) {
      return { openOrdersCount, totalOrdersCount };
    }
    return {
      openInquiriesCount: openOrdersCount,
      totalInquiriesCount: totalOrdersCount,
      openOrdersCount,
      totalOrdersCount
    };
  }

  /**
   * Retrieves Sales Inquiry metrics from SD_F2370_INQY_WL_SRV / C_InquiryWL_F2370.
   *
   * @param {Object} [options] - destination / executeHttpRequest / headers overrides
   * @returns {Promise<{ openInquiriesCount: number, totalInquiriesCount: number, openOrdersCount: number, totalOrdersCount: number }>}
   */
  async getInquiryMetrics(options = {}) {
    return this.getSalesMetrics({ ...options, entity: 'inquiry' });
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
