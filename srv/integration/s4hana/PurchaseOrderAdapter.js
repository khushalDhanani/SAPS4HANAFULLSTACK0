// PurchaseOrderAdapter for S/4HANA integration using SAP Cloud SDK
const cds = require('@sap/cds');
const { getDestination } = require('@sap-cloud-sdk/connectivity');
const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');

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
      const dest = await getDestination({ destinationName });
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
   * Create a Purchase Order using SAP Cloud SDK.
   * Performs draft creation followed by activation with automatic CSRF management.
   */
  async createPurchaseOrder(payload) {
    if (!this.s4hanaMaint) {
      this.s4hanaMaint = await cds.connect.to('MM_PUR_PO_MAINT_V2_SRV');
    }

    const destination = await this._getDestination();
    const servicePath = '/sap/opu/odata/sap/MM_PUR_PO_MAINT_V2_SRV';
    const basePath = (destination.url && destination.url.includes(servicePath)) ? '' : servicePath;

    // 1. Create draft using SAP Cloud SDK (automatic CSRF token retrieval)
    const draftResp = await executeHttpRequest(destination, {
      method: 'post',
      url: `${basePath}/C_PurchaseOrderTP`,
      data: payload,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });

    const draftResult = draftResp.data;
    const draftData = draftResult.d || draftResult;
    const draftUUID = draftData.DraftUUID;
    if (!draftUUID) {
      throw new Error('DraftUUID not returned from draft creation');
    }

    // Extract session cookie and CSRF token from draft creation request context
    const req = draftResp.request;
    const cookie = req?.getHeader ? req.getHeader('cookie') : req?._headers?.cookie;
    const token = req?.getHeader ? req.getHeader('x-csrf-token') : req?._headers?.['x-csrf-token'];

    // 2. Activate draft using SAP Cloud SDK
    const poParam = draftData.PurchaseOrder || '';
    const actResp = await executeHttpRequest(destination, {
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
    }, { fetchCsrfToken: !token });

    const activationResult = actResp.data;
    return activationResult.d || activationResult;
  }
}

module.exports = new PurchaseOrderAdapter();
