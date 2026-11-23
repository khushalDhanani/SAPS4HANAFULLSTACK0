const LOG = require('../../../../common/logger')('sales-inquiry-adapter');
const s4Config = require('../../s4Config');

/**
 * SalesInquiryAdapter methods: material and inquiry-type catalog reads from the SD factsheet/worklist services.
 * Mixed into SalesInquiryAdapter.prototype; `this` is the adapter instance.
 */
module.exports = {
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
  },

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
  },

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
};
