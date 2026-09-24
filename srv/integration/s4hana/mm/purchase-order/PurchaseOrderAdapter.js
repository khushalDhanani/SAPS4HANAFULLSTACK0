// PurchaseOrderAdapter for S/4HANA integration using S4HttpClient
const cds = require('@sap/cds');
const LOG = require('../../../../common/logger')('purchase-order-adapter');
const SessionContext = require('../../SessionContext');
const { S4HttpClient } = require('../../S4HttpClient');
const s4Config = require('../../s4Config');
const TtlCache = require('../../../../common/TtlCache');

/**
 * Adapter class to encapsulate all communication with S/4HANA services
 * using SAP Cloud SDK and BTP Destination management via S4HttpClient.
 *
 * Designed to be completely stateless to guarantee thread-safe concurrent execution
 * without CSRF token or session cookie collisions between parallel requests.
 */
class PurchaseOrderAdapter {
  constructor(options = {}) {
    this.client = options.client || new S4HttpClient();
    this.destinationName = this.client.destinationName;
    this.s4hana = null; // For read service
    this.s4hanaMaint = null; // For PO maintenance service
    this.metricsCache = new TtlCache({ defaultTtlMs: 30000 }); // 30s TTL for aggregated dashboard
    this.masterDataCountCache = new TtlCache({ defaultTtlMs: 300000 }); // 5m TTL for master data counts
    this._validPaymentTermsCache = null;
  }

  /**
   * Resets internal metrics and lookup caches.
   */
  clearMetricsCache() {
    this.metricsCache.clear();
    this.masterDataCountCache.clear();
    this._validPaymentTermsCache = null;
  }

  /**
   * Retrieves the set of valid PaymentTerms defined in S/4HANA customizing (C_MM_PaymentTermValueHelp).
   * Cached to avoid repeated roundtrips.
   *
   * @param {Object} [options]
   * @returns {Promise<Set<string>|null>}
   */
  async getValidPaymentTerms(options = {}) {
    if (this._validPaymentTermsCache && this._validPaymentTermsCache.size > 0 && !options.forceRefresh) {
      return this._validPaymentTermsCache;
    }
    try {
      const dest = options.destination || await this._getDestination(options);
      const executeFn = options.executeHttpRequest || this.client._execute;
      const rootUrl = (dest.url || '').replace(/\/sap\/opu\/odata\/.*$/, '');
      const res = await executeFn(dest, {
        method: 'get',
        url: `${rootUrl}/sap/opu/odata/sap/MM_PUR_PO_MAINT_V2_SRV/C_MM_PaymentTermValueHelp?$select=PaymentTerms&$format=json`,
        headers: {
          'Accept': 'application/json',
          ...(dest.headers || {}),
          ...(options.headers || {})
        }
      });
      const results = res.data?.d?.results || [];
      const termsSet = new Set(results.map(r => String(r.PaymentTerms || '').trim().toUpperCase()).filter(Boolean));
      if (termsSet.size > 0) {
        this._validPaymentTermsCache = termsSet;
        return termsSet;
      }
      return null;
    } catch (e) {
      LOG.warn('Could not fetch valid payment terms from S/4HANA:', e.message);
      return null;
    }
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
      LOG.error('Error reading data from FS service:', error.message);
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
      LOG.error('Error reading data from Maint service:', error.message);
      throw error;
    }
  }

  /**
   * Resolve destination for S/4HANA communication using the shared S4HttpClient.
   * Resolves destination via BTP Destination Service (or registered local destination).
   * Propagates caller userJwt for Principal Propagation when available.
   *
   * @param {Object} [options]
   */
  async _getDestination(options = {}) {
    const dest = await this.client.resolveDestination(options);
    if (!dest) {
      const destinationName = this.client.destinationName;
      throw new Error(`[PurchaseOrderAdapter] Destination '${destinationName}' not found and no local credentials configured in cds.env.`);
    }
    return dest;
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
    const destination = options.destination || await this._getDestination(options);
    const servicePath = '/sap/opu/odata/sap/MM_PUR_PO_MAINT_V2_SRV';
    const basePath = (destination.url && destination.url.includes(servicePath)) ? '' : servicePath;
    const executeFn = options.executeHttpRequest || this.client._execute;

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
    const destination = options.destination || await this._getDestination(options);
    const servicePath = '/sap/opu/odata/sap/MM_PUR_PO_MAINT_V2_SRV';
    const basePath = (destination.url && destination.url.includes(servicePath)) ? '' : servicePath;

    const poParam = draftData.PurchaseOrder || '';
    const draftUUID = draftData.DraftUUID;
    if (!draftUUID) {
      throw new Error('DraftUUID is required for activation');
    }

    const cookie = sessionContext.cookie;
    const token = sessionContext.token || sessionContext.csrfToken;
    const executeFn = options.executeHttpRequest || this.client._execute;

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
    const dest = options.destination || await this._getDestination(options);
    const executeFn = options.executeHttpRequest || this.client._execute;
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
      LOG.warn('Warning fetching BP count from ZAPI_GETBUPA_SRV:', e.message);
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
    const dest = options.destination || await this._getDestination(options);
    const executeFn = options.executeHttpRequest || this.client._execute;
    const rootUrl = (dest.url || '').replace(/\/sap\/opu\/odata\/.*$/, '');

    // By default, caching is enabled unless a custom executeHttpRequest was supplied (unit tests) or useCache is false
    const useCache = options.useCache ?? !options.executeHttpRequest;
    const cacheKey = `${rootUrl}:${dest.url || ''}:${options.userJwt || 'default'}`;

    if (options.forceRefresh) {
      this.metricsCache.delete(cacheKey);
    }

    const fetchMetrics = async () => {
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

      let lastError = null;
      let authFailed = false;

      // OData V2 $inlinecount (d.__count) or V4 @odata.count; null when SAP returned no count.
      const fetchCount = async (serviceRelPath) => {
        if (authFailed) return null;
        try {
          const res = await executeFn(dest, { method: 'get', url: `${rootUrl}${serviceRelPath}`, headers: reqHeaders });
          const data = res && res.data;
          return toCount(data?.d?.__count ?? data?.['@odata.count']);
        } catch (err) {
          lastError = err.message || String(err);
          const status = err.response?.status || err.status;
          if (status === 401 || String(lastError).includes('401')) {
            authFailed = true;
          }
          LOG.warn(`Dashboard metric unavailable (${serviceRelPath.split('?')[0]}): ${err.message}`);
          return null;
        }
      };

      // Plain-text /$count responses.
      const fetchRawCount = async (serviceRelPath) => {
        if (authFailed) return null;
        try {
          const res = await executeFn(dest, {
            method: 'get',
            url: `${rootUrl}${serviceRelPath}`,
            headers: { ...reqHeaders, 'Accept': 'text/plain, */*' }
          });
          return toCount(res && res.data);
        } catch (err) {
          lastError = err.message || String(err);
          const status = err.response?.status || err.status;
          if (status === 401 || String(lastError).includes('401')) {
            authFailed = true;
          }
          LOG.warn(`Dashboard metric unavailable (${serviceRelPath}): ${err.message}`);
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

      const MASTER_DATA_METRIC_KEYS = new Set([
        'supplierCount',
        'productCount',
        'customerCount',
        'bpCount',
        'glAccountCount',
        'costCenterCount',
        'profitCenterCount',
        'fixedAssetCount',
        'wbsElementCount',
        'internalOrderCount',
        'purchaseContractCount',
        'companyCodeCount',
        'plantCount',
        'storageLocationCount',
        'materialGroupCount',
        'purchasingOrgCount',
        'purchasingGroupCount',
        'warehouseCount',
        'gatewayCatalogCount'
      ]);

      const keys = Object.keys(sources);

      // Probe totalCount first to verify backend authentication & reachability before firing remaining queries.
      // If S/4HANA returns 401 Unauthorized, authFailed is set and the remaining 25 queries
      // immediately return null without making HTTP calls, preventing SU01 user locks and 26x gateway load.
      const firstKey = keys[0]; // 'totalCount'
      const firstValue = await sources[firstKey]();

      const otherKeys = keys.slice(1);
      const otherValues = await Promise.all(otherKeys.map(async (key) => {
        if (authFailed) return null;
        if (useCache && !options.forceRefresh && MASTER_DATA_METRIC_KEYS.has(key)) {
          const cachedCount = this.masterDataCountCache.get(key);
          if (cachedCount !== undefined) {
            return cachedCount;
          }
          const val = await sources[key]();
          if (val !== null) {
            this.masterDataCountCache.set(key, val);
          }
          return val;
        }
        return await sources[key]();
      }));

      const values = [firstValue, ...otherValues];

      const metrics = {};
      const unavailable = [];
      keys.forEach((key, i) => {
        metrics[key] = values[i];
        if (values[i] === null) unavailable.push(key);
      });
      metrics.unavailable = unavailable;
      // When these figures were read from SAP. A cached answer keeps its original asOf, so the screen can say how old it is.
      metrics.asOf = new Date().toISOString();
      if (unavailable.length === keys.length && lastError) {
        metrics.error = lastError.includes('401')
          ? `SAP S/4HANA backend logon rejected (HTTP 401 Unauthorized): Check credentials or SU01 lock status for configured user on system DS4 client ${s4Config.getClient()}.`
          : `SAP S/4HANA backend unavailable: ${lastError}`;
      }

      return metrics;
    };

    if (useCache && !options.forceRefresh) {
      return await this.metricsCache.getOrSet(
        cacheKey,
        fetchMetrics,
        (metrics) => (metrics?.unavailable?.length === 26 ? (options.negativeTtlMs || 15000) : (options.ttlMs || 30000))
      );
    }

    const result = await fetchMetrics();
    if (useCache) {
      const ttl = result?.unavailable?.length === 26 ? (options.negativeTtlMs || 15000) : (options.ttlMs || 30000);
      this.metricsCache.set(cacheKey, result, ttl);
    }
    return result;
  }
}

const defaultAdapter = new PurchaseOrderAdapter();
defaultAdapter.PurchaseOrderAdapter = PurchaseOrderAdapter;
defaultAdapter.SessionContext = SessionContext;

module.exports = defaultAdapter;
