// PurchaseOrderAdapter for S/4HANA integration using SAP Cloud SDK
const cds = require('@sap/cds');
const connectivity = require('@sap-cloud-sdk/connectivity');
const httpClient = require('@sap-cloud-sdk/http-client');
const SessionContext = require('../../SessionContext');

/**
 * Adapter class to encapsulate all communication with S/4HANA services
 * using SAP Cloud SDK and BTP Destination management.
 *
 * Designed to be completely stateless to guarantee thread-safe concurrent execution
 * without CSRF token or session cookie collisions between parallel requests.
 */
class PurchaseOrderAdapter {
  constructor() {
    this.s4hana = null; // For read service
    this.s4hanaMaint = null; // For PO maintenance service
  }

  /** Initialize the generic read service */
  async init() {
    if (!this.s4hana) {
      this.s4hana = await cds.connect.to('C_PURCHASEORDER_FS_SRV');
    }
  }

  /** Read data from FS service */
  async readFsData(query) {
    await this.init();
    try {
      return await this.s4hana.run(query);
    } catch (error) {
      console.error('[PurchaseOrderAdapter] Error reading data from FS service:', error.message);
      throw error;
    }
  }

  /** Read data from Maintenance service (Value Helps) */
  async readMaintData(query) {
    if (!this.s4hanaMaint) {
      this.s4hanaMaint = await cds.connect.to('MM_PUR_PO_MAINT_V2_SRV');
    }
    try {
      return await this.s4hanaMaint.run(query);
    } catch (error) {
      console.error('[PurchaseOrderAdapter] Error reading data from Maint service:', error.message);
      throw error;
    }
  }

  /**
   * Helper to ensure .env or .env.local variables are loaded in non-standard execution contexts
   */
  _ensureEnvLoaded() {
    if (process.env.S4_DESTINATION_URL) return;
    const fs = require('fs');
    const path = require('path');
    const candidates = ['.env.local', '.env'];
    for (const f of candidates) {
      const fullPath = path.resolve(process.cwd(), f);
      if (fs.existsSync(fullPath)) {
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          for (const line of content.split('\n')) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
              const idx = trimmed.indexOf('=');
              const k = trimmed.substring(0, idx).trim();
              let v = trimmed.substring(idx + 1).trim();
              if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
              if (!process.env[k]) {
                process.env[k] = v;
              }
            }
          }
        } catch (_) {}
      }
    }
  }

  /**
   * Resolve destination for S/4HANA communication using SAP Cloud SDK.
   * Resolves destination via BTP Destination Service (or registered local destination).
   */
  async _getDestination() {
    this._ensureEnvLoaded();
    const destinationName = process.env.S4_DESTINATION_NAME || 'S4HANA_PO_API';
    try {
      const dest = await connectivity.getDestination({ destinationName });
      if (dest) return dest;
    } catch (err) {
      // In local development without BTP Destination Service, fallback to cds.env credentials
    }

    if (process.env.S4_DESTINATION_URL) {
      return {
        url: process.env.S4_DESTINATION_URL.replace(/\/+$/, ''),
        username: process.env.S4_USERNAME,
        password: process.env.S4_PASSWORD,
        headers: { 'sap-client': process.env.S4_CLIENT || '220' }
      };
    }

    const creds = cds.env.requires?.MM_PUR_PO_MAINT_V2_SRV?.credentials ||
                  cds.env.requires?.C_PURCHASEORDER_FS_SRV?.credentials;
    if (creds && creds.url) {
      return {
        url: creds.url.replace(/\/+$/, ''),
        username: creds.username,
        password: creds.password,
        headers: creds.headers || { 'sap-client': '220' }
      };
    }

    throw new Error(`[PurchaseOrderAdapter] Destination '${destinationName}' not found and no local credentials configured in cds.env.`);
  }

  /**
   * Creates a Purchase Order Draft in S/4HANA.
   * Produces an isolated, request-scoped SessionContext containing the session cookies and CSRF token.
   *
   * @param {Object} payload - Mapped S/4 Purchase Order payload
   * @param {Object} [options] - Optional overrides (destination, executeHttpRequest, etc.)
   * @returns {Promise<SessionContext>}
   */
  async createDraft(payload, options = {}) {
    const destination = options.destination || await this._getDestination();
    const servicePath = '/sap/opu/odata/sap/MM_PUR_PO_MAINT_V2_SRV';
    const basePath = (destination.url && destination.url.includes(servicePath)) ? '' : servicePath;
    const executeFn = options.executeHttpRequest || httpClient.executeHttpRequest;

    const draftResp = await executeFn(destination, {
      method: 'post',
      url: `${basePath}/C_PurchaseOrderTP`,
      data: payload,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    }, { fetchCsrfToken: options.fetchCsrfToken !== undefined ? options.fetchCsrfToken : true });

    const draftResult = draftResp.data;
    const draftData = draftResult.d || draftResult;
    const draftUUID = draftData.DraftUUID;
    if (!draftUUID) {
      throw new Error('DraftUUID not returned from draft creation');
    }

    // Wrap in request-isolated session context — zero state stored on the adapter singleton
    return SessionContext.fromResponse(draftResp, {
      draftUUID,
      draftData
    });
  }

  /**
   * Activates a Purchase Order Draft in S/4HANA using the request's isolated session context.
   *
   * @param {Object} draftData - Draft data containing DraftUUID and PurchaseOrder
   * @param {Object|SessionContext} [sessionContext] - Session cookie and CSRF token from draft creation
   * @param {Object} [options] - Optional overrides
   * @returns {Promise<Object>}
   */
  async activateDraft(draftData, sessionContext = {}, options = {}) {
    const destination = options.destination || await this._getDestination();
    const servicePath = '/sap/opu/odata/sap/MM_PUR_PO_MAINT_V2_SRV';
    const basePath = (destination.url && destination.url.includes(servicePath)) ? '' : servicePath;

    const poParam = draftData.PurchaseOrder || '';
    const draftUUID = draftData.DraftUUID;
    if (!draftUUID) {
      throw new Error('DraftUUID is required for activation');
    }

    const cookie = sessionContext.cookie;
    const token = sessionContext.token || sessionContext.csrfToken;
    const executeFn = options.executeHttpRequest || httpClient.executeHttpRequest;

    const actResp = await executeFn(destination, {
      method: 'post',
      url: `${basePath}/C_PurchaseOrderTPActivation`,
      params: {
        PurchaseOrder: `'${poParam}'`,
        DraftUUID: `guid'${draftUUID}'`,
        IsActiveEntity: 'false',
        '$format': 'json'
      },
      headers: {
        'Accept': 'application/json',
        ...(cookie ? { 'Cookie': cookie } : {}),
        ...(token ? { 'X-CSRF-Token': token } : {})
      }
    }, { fetchCsrfToken: options.fetchCsrfToken !== undefined ? options.fetchCsrfToken : !token });

    const activationResult = actResp.data;
    return activationResult.d || activationResult;
  }

  /**
   * Create a Purchase Order using SAP Cloud SDK.
   * Performs draft creation followed by activation with automatic, per-request isolated session context.
   *
   * @param {Object} payload
   * @param {Object} [options]
   * @returns {Promise<Object>}
   */
  async createPurchaseOrder(payload, options = {}) {
    // 1. Create draft and capture request-isolated session context
    const session = await this.createDraft(payload, options);

    // 2. Activate draft within the exact same isolated session context
    return await this.activateDraft(session.draftData, session, options);
  }

  /**
   * Reads the real Business Partner count directly from SAP ZAPI_GETBUPA_SRV.
   *
   * @param {Object} [options]
   * @returns {Promise<number|null>} null when SAP did not return a count
   */
  async getBusinessPartnerCount(options = {}) {
    const dest = options.destination || await this._getDestination();
    const executeFn = options.executeHttpRequest || httpClient.executeHttpRequest;
    const rootUrl = (dest.url || '').replace(/\/sap\/opu\/odata\/.*$/, '');

    try {
      const res = await executeFn(dest, {
        method: 'get',
        url: `${rootUrl}/sap/opu/odata/sap/ZAPI_GETBUPA_SRV/BusinessPartnerSet/$count`,
        headers: {
          'Accept': 'text/plain',
          ...(dest.headers || {}),
          ...(options.headers || {})
        }
      });
      const n = Number(String(res.data ?? '').trim());
      return String(res.data ?? '').trim() !== '' && Number.isInteger(n) && n >= 0 ? n : null;
    } catch (e) {
      console.warn('[PurchaseOrderAdapter] Warning fetching BP count from ZAPI_GETBUPA_SRV:', e.message);
      return null;
    }
  }

  /**
   * Dashboard counts, each read live from its SAP S/4HANA OData service in parallel.
   *
   * A count is a number only when SAP returned it. When a service call fails, or the response carries
   * no count, the metric is null and its key is listed in `unavailable`: nothing is defaulted, sampled
   * or extrapolated, so the dashboard can show "not available" instead of a figure that looks live.
   *
   * @param {Object} [options]
   * @returns {Promise<Object>} One entry per metric (number | null) plus `unavailable: string[]`
   * @throws when the S/4HANA destination cannot be resolved
   */
  async getDashboardMetrics(options = {}) {
    const dest = options.destination || await this._getDestination();
    const executeFn = options.executeHttpRequest || httpClient.executeHttpRequest;
    const rootUrl = (dest.url || '').replace(/\/sap\/opu\/odata\/.*$/, '');

    const reqHeaders = {
      'Accept': 'application/json',
      ...(dest.headers || {}),
      ...(options.headers || {})
    };

    const toCount = (value) => {
      if (value === null || value === undefined || String(value).trim() === '') return null;
      const n = Number(String(value).trim());
      return Number.isInteger(n) && n >= 0 ? n : null;
    };

    // OData V2 $inlinecount (d.__count) or V4 @odata.count; null when SAP returned no count.
    const fetchCount = async (serviceRelPath) => {
      try {
        const res = await executeFn(dest, { method: 'get', url: `${rootUrl}${serviceRelPath}`, headers: reqHeaders });
        const data = res && res.data;
        return toCount(data?.d?.__count ?? data?.['@odata.count']);
      } catch (err) {
        console.warn(`[PurchaseOrderAdapter] Dashboard metric unavailable (${serviceRelPath.split('?')[0]}): ${err.message}`);
        return null;
      }
    };

    // Plain-text /$count responses.
    const fetchRawCount = async (serviceRelPath) => {
      try {
        const res = await executeFn(dest, {
          method: 'get',
          url: `${rootUrl}${serviceRelPath}`,
          headers: { ...reqHeaders, 'Accept': 'text/plain, */*' }
        });
        return toCount(res && res.data);
      } catch (err) {
        console.warn(`[PurchaseOrderAdapter] Dashboard metric unavailable (${serviceRelPath}): ${err.message}`);
        return null;
      }
    };

    const sources = {
      totalCount: () => fetchCount('/sap/opu/odata/sap/C_PURCHASEORDER_FS_SRV/C_PurchaseOrderFs?$inlinecount=allpages&$top=1&$select=PurchaseOrder'),
      supplierCount: () => fetchCount('/sap/opu/odata/sap/MM_PUR_PO_MAINT_V2_SRV/C_MM_SupplierValueHelp?$inlinecount=allpages&$top=1'),
      productCount: () => fetchCount('/sap/opu/odata/sap/MM_PUR_PO_MAINT_V2_SRV/C_MM_MaterialValueHelp?$inlinecount=allpages&$top=1'),
      fiDocCount: () => fetchCount('/sap/opu/odata/sap/FAC_GL_JOURNALENTRY_VER_SRV/C_GLJrnlEntryItemToBeVerified?$inlinecount=allpages&$top=1'),
      salesInquiryCount: () => fetchCount('/sap/opu/odata/sap/SD_F2370_INQY_WL_SRV/C_InquiryWL_F2370?$inlinecount=allpages&$top=1'),
      customerCount: () => fetchCount('/sap/opu/odata/sap/SD_F2370_INQY_WL_SRV/I_Customer_VH?$inlinecount=allpages&$top=1'),
      openSalesOrderCount: () => fetchCount("/sap/opu/odata/sap/SD_F1873_SO_WL_SRV/C_SalesOrderWl_F1873?$inlinecount=allpages&$top=1&$filter=OverallSDProcessStatus ne 'C'"),
      totalSalesOrderCount: () => fetchCount('/sap/opu/odata/sap/SD_F1873_SO_WL_SRV/C_SalesOrderWl_F1873?$inlinecount=allpages&$top=1'),
      bpCount: () => fetchRawCount('/sap/opu/odata/sap/ZAPI_GETBUPA_SRV/BusinessPartnerSet/$count'),
      glAccountCount: () => fetchCount('/sap/opu/odata/sap/C_PURCHASEORDER_FS_SRV/I_GLAccountStdVH?$inlinecount=allpages&$top=1'),
      costCenterCount: () => fetchCount('/sap/opu/odata/sap/C_PURCHASEORDER_FS_SRV/I_CostCenterVH?$inlinecount=allpages&$top=1'),
      profitCenterCount: () => fetchCount('/sap/opu/odata/sap/C_PURCHASEORDER_FS_SRV/I_ProfitCenterStdVH?$inlinecount=allpages&$top=1'),
      fixedAssetCount: () => fetchCount('/sap/opu/odata/sap/C_PURCHASEORDER_FS_SRV/I_MasterFixedAssetStdVH?$inlinecount=allpages&$top=1'),
      wbsElementCount: () => fetchCount('/sap/opu/odata/sap/C_PURCHASEORDER_FS_SRV/I_WBSElementBasicDataStdVH?$inlinecount=allpages&$top=1'),
      internalOrderCount: () => fetchCount('/sap/opu/odata/sap/C_PURCHASEORDER_FS_SRV/I_InternalOrderStdVH?$inlinecount=allpages&$top=1'),
      purchaseContractCount: () => fetchCount('/sap/opu/odata/sap/C_PURCHASEORDER_FS_SRV/C_PurchaseContractValHelp?$inlinecount=allpages&$top=1'),
      companyCodeCount: () => fetchCount('/sap/opu/odata/sap/MM_PUR_PO_MAINT_V2_SRV/C_MM_CompanyCodeValueHelp?$inlinecount=allpages&$top=1'),
      plantCount: () => fetchCount('/sap/opu/odata/sap/MM_PUR_PO_MAINT_V2_SRV/C_MM_PlantValueHelp?$inlinecount=allpages&$top=1'),
      storageLocationCount: () => fetchCount('/sap/opu/odata/sap/MM_PUR_PO_MAINT_V2_SRV/C_MM_StorLocValueHelp?$inlinecount=allpages&$top=1'),
      materialGroupCount: () => fetchCount('/sap/opu/odata/sap/MM_PUR_PO_MAINT_V2_SRV/C_MM_MaterialGroupValueHelp?$inlinecount=allpages&$top=1'),
      purchasingOrgCount: () => fetchCount('/sap/opu/odata/sap/MM_PUR_PO_MAINT_V2_SRV/C_PurchasingOrgValueHelp?$inlinecount=allpages&$top=1'),
      purchasingGroupCount: () => fetchCount('/sap/opu/odata/sap/MM_PUR_PO_MAINT_V2_SRV/C_PurchasingGroupValueHelp?$inlinecount=allpages&$top=1'),
      warehouseCount: () => fetchCount('/sap/opu/odata/sap/API_WAREHOUSE/Warehouse?$inlinecount=allpages&$top=1'),
      openReservationCount: () => fetchCount('/sap/opu/odata/sap/UI_RESERVATION_ITM_MNG_V2/ReservationDocumentItem?$inlinecount=allpages&$top=1&$filter=ReservationItemIsFinallyIssued eq false and ReservationItmIsMarkedForDeltn eq false'),
      inboundDeliveryCount: () => fetchCount('/sap/opu/odata/sap/MMIM_GR4PO_DL_SRV/HMmimGr4inbdelSet?$inlinecount=allpages&$top=1'),
      gatewayCatalogCount: () => fetchRawCount('/sap/opu/odata/IWFND/CATALOGSERVICE;v=2/ServiceCollection/$count')
    };

    const keys = Object.keys(sources);
    const values = await Promise.all(keys.map(key => sources[key]()));

    const metrics = {};
    const unavailable = [];
    keys.forEach((key, i) => {
      metrics[key] = values[i];
      if (values[i] === null) unavailable.push(key);
    });
    metrics.unavailable = unavailable;
    return metrics;
  }
}

const defaultAdapter = new PurchaseOrderAdapter();
defaultAdapter.PurchaseOrderAdapter = PurchaseOrderAdapter;
defaultAdapter.SessionContext = SessionContext;

module.exports = defaultAdapter;
