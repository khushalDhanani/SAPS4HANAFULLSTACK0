// PurchaseOrderAdapter for S/4HANA integration
const cds = require('@sap/cds');
const fs = require('fs');
const path = require('path');

// Load .env.local into process.env
(function loadEnvLocal() {
  try {
    const envPath = path.resolve(cds.root || process.cwd(), '.env.local');
    if (fs.existsSync(envPath)) {
      const lines = fs.readFileSync(envPath, 'utf8').split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const key = trimmed.substring(0, eqIdx).trim();
          const val = trimmed.substring(eqIdx + 1).trim();
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      }
    }
  } catch (e) {}
})();

/**
 * Adapter class to encapsulate all communication with the S/4HANA services.
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
   * Create a Purchase Order using the maintenance service.
   * Performs draft creation followed by activation.
   */
// Helper to fetch CSRF token
  async _fetchCsrfToken() {
    const creds = this.s4hanaMaint.options?.credentials || cds.env.requires.MM_PUR_PO_MAINT_V2_SRV.credentials;
    const auth = Buffer.from(`${creds.username}:${creds.password}`).toString('base64');
    const response = await fetch(`${creds.url}`, {
      method: 'GET',
      headers: {
        'X-CSRF-Token': 'Fetch',
        'Authorization': `Basic ${auth}`,
        ...creds.headers
      }
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch CSRF token: ${response.status}`);
    }
    this._csrfToken = response.headers.get('x-csrf-token');
    
    let cookies = [];
    if (typeof response.headers.getSetCookie === 'function') {
      cookies = response.headers.getSetCookie();
    } else {
      const rawCookie = response.headers.get('set-cookie');
      if (rawCookie) {
        cookies = rawCookie.split(/,(?=\s*[A-Za-z0-9_-]+\=)/);
      }
    }
    if (cookies.length > 0) {
      this._csrfCookie = cookies.map(c => c.split(';')[0].trim()).join('; ');
    }
  }

  async createPurchaseOrder(payload) {
    if (!this.s4hanaMaint) {
      this.s4hanaMaint = await cds.connect.to('MM_PUR_PO_MAINT_V2_SRV');
    }
    // Ensure CSRF token
    if (!this._csrfToken) {
      await this._fetchCsrfToken();
    }
    const creds = this.s4hanaMaint.options?.credentials || cds.env.requires.MM_PUR_PO_MAINT_V2_SRV.credentials;
    const auth = Buffer.from(`${creds.username}:${creds.password}`).toString('base64');
    const baseUrl = creds.url;
    // 1. Create draft
    const draftResp = await fetch(`${baseUrl}/C_PurchaseOrderTP`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-CSRF-Token': this._csrfToken,
        'Authorization': `Basic ${auth}`,
        'Cookie': this._csrfCookie,
        ...creds.headers
      },
      body: JSON.stringify(payload)
    });
    if (!draftResp.ok) {
      const txt = await draftResp.text();
      throw new Error(`Draft creation failed: ${draftResp.status} ${txt}`);
    }
    const draftResult = await draftResp.json();
    
    // In V2, the actual content is nested inside 'd'
    const draftData = draftResult.d || draftResult;
    const draftUUID = draftData.DraftUUID;
    if (!draftUUID) {
      throw new Error('DraftUUID not returned from draft creation');
    }
    // 2. Activate draft
    const poParam = draftData.PurchaseOrder || '';
    const query = `?PurchaseOrder='${poParam}'&DraftUUID=guid'${draftUUID}'&IsActiveEntity=false&%24format=json`;
    
    const actResp = await fetch(`${baseUrl}/C_PurchaseOrderTPActivation${query}`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'X-CSRF-Token': this._csrfToken,
        'Authorization': `Basic ${auth}`,
        'Cookie': this._csrfCookie,
        ...creds.headers
      }
    });
    if (!actResp.ok) {
      const txt = await actResp.text();
      throw new Error(`Activation failed: ${actResp.status} ${txt}`);
    }
    const activationResult = await actResp.json();
    return activationResult.d || activationResult;
  }
}

module.exports = new PurchaseOrderAdapter();
