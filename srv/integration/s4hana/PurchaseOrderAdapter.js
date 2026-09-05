// PurchaseOrderAdapter for S/4HANA integration using SAP Cloud SDK
const cds = require('@sap/cds');
const connectivity = require('@sap-cloud-sdk/connectivity');
const httpClient = require('@sap-cloud-sdk/http-client');

/**
 * Adapter class to encapsulate all communication with S/4HANA services
 * using SAP Cloud SDK and BTP Destination management.
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
   * Resolve destination for S/4HANA communication using SAP Cloud SDK.
   * Resolves destination via BTP Destination Service (or registered local destination).
   */
  async _getDestination() {
    const destinationName = process.env.S4_DESTINATION_NAME || 'S4HANA_PO_API';
    try {
      const dest = await connectivity.getDestination({ destinationName });
      if (dest) return dest;
    } catch (err) {
      // In local development without BTP Destination Service, fallback to cds.env credentials
    }

    const creds = cds.env.requires?.MM_PUR_PO_MAINT_V2_SRV?.credentials;
    if (creds && creds.url) {
      return {
        url: creds.url,
        username: creds.username,
        password: creds.password,
        headers: creds.headers || {}
      };
    }

    throw new Error(`[PurchaseOrderAdapter] Destination '${destinationName}' not found and no local credentials configured in cds.env.`);
  }

  /**
   * Creates a Purchase Order Draft in S/4HANA.
   *
   * @param {Object} payload - Mapped S/4 Purchase Order payload
   * @param {Object} [options] - Optional overrides (destination, executeHttpRequest, etc.)
   * @returns {Promise<{ draftUUID: string, draftData: Object, cookie: string, token: string }>}
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
    }, { fetchCsrfToken: options.fetchCsrfToken !== undefined ? options.fetchCsrfToken : false });

    const draftResult = draftResp.data;
    const draftData = draftResult.d || draftResult;
    const draftUUID = draftData.DraftUUID;
    if (!draftUUID) {
      throw new Error('DraftUUID not returned from draft creation');
    }

    const req = draftResp.request;
    const cookie = req?.getHeader ? req.getHeader('cookie') : req?._headers?.cookie;
    const token = req?.getHeader ? req.getHeader('x-csrf-token') : req?._headers?.['x-csrf-token'];

    return {
      draftUUID,
      draftData,
      cookie,
      token
    };
  }

  /**
   * Activates a Purchase Order Draft in S/4HANA.
   *
   * @param {Object} draftData - Draft data containing DraftUUID and PurchaseOrder
   * @param {Object} [sessionContext] - Session cookie and CSRF token from draft creation
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
    const token = sessionContext.token;
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
   * Performs draft creation followed by activation with automatic CSRF management.
   */
  async createPurchaseOrder(payload, options = {}) {
    const draft = await this.createDraft(payload, options);
    return await this.activateDraft(draft.draftData, { cookie: draft.cookie, token: draft.token }, options);
  }
}

const defaultAdapter = new PurchaseOrderAdapter();
defaultAdapter.PurchaseOrderAdapter = PurchaseOrderAdapter;

module.exports = defaultAdapter;
