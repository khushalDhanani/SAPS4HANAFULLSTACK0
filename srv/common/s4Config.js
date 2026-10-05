/**
 * s4Config.js
 * Central configuration module for S/4HANA environment-specific values and defaults.
 * Reads directly from cds.env (package.json "cds.s4", .cdsrc.json, or environment variables)
 * and fails loudly with a ConfigurationError when any required value is missing.
 */

let cds;
try {
  cds = require('@sap/cds');
} catch (_) {
  cds = { env: {} };
}

class ConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

class S4Config {
  /**
   * Access the active cds.env object dynamically to support runtime and test environment updates.
   */
  get env() {
    return (cds && cds.env) ? cds.env : {};
  }

  /**
   * Retrieves raw value from cds.env.s4, cds.env.s4hana, or fallback process.env variables.
   * @private
   */
  _getRaw(key, envVars = []) {
    const s4Section = (this.env.s4 || this.env.s4hana) || {};
    let val = s4Section[key];

    if (val === undefined || val === null || val === '') {
      for (const envName of envVars) {
        if (process.env[envName] !== undefined && process.env[envName] !== '') {
          val = process.env[envName];
          break;
        }
      }
    }

    return val;
  }

  /**
   * Retrieves a non-empty string or throws ConfigurationError.
   * @private
   */
  _requireString(key, envVars = []) {
    const val = this._getRaw(key, envVars);
    if (val === undefined || val === null || String(val).trim() === '') {
      const candidates = [`cds.s4.${key}`, ...envVars].join(' / ');
      throw new ConfigurationError(
        `Missing required S/4HANA configuration: s4.${key}. Define it in cds.env (e.g. package.json "cds.s4.${key}" or environment variable ${candidates}).`
      );
    }
    return String(val).trim();
  }

  /**
   * Retrieves a non-empty array of strings or throws ConfigurationError.
   * @private
   */
  _requireArray(key, envVars = []) {
    const raw = this._getRaw(key, envVars);
    let arr = [];
    if (Array.isArray(raw)) {
      arr = raw.map(v => String(v).trim()).filter(Boolean);
    } else if (typeof raw === 'string' && raw.trim() !== '') {
      arr = raw.split(',').map(v => v.trim()).filter(Boolean);
    }

    if (!Array.isArray(arr) || arr.length === 0) {
      const candidates = [`cds.s4.${key}`, ...envVars].join(' / ');
      throw new ConfigurationError(
        `Missing required S/4HANA configuration: s4.${key}. Define it as a non-empty list in cds.env (e.g. package.json "cds.s4.${key}" or environment variable ${candidates}).`
      );
    }
    return arr;
  }

  /** S/4 System Name (e.g. 'DEV', 'PRD', or configured value from S4_SYSTEM_NAME / cds.s4.systemName) */
  getSystemName() {
    const val = this._getRaw('systemName', ['CDS_S4_SYSTEM_NAME', 'S4_SYSTEM_NAME']);
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      return String(val).trim();
    }
    return process.env.NODE_ENV === 'production' ? 'PRD' : 'DEV';
  }

  /**
   * Builds the formatted system label from environment settings.
   * e.g. `${systemName} - Client ${client}` (e.g. 'DEV - Client 220', 'S4HANA_DEV - Client 220')
   * @param {string} [clientOverride] - Optional SAP client override
   * @param {string} [systemNameOverride] - Optional system name override
   * @returns {string}
   */
  getSystemLabel(clientOverride, systemNameOverride) {
    const systemName = (systemNameOverride && String(systemNameOverride).trim()) || this.getSystemName();
    let client = clientOverride;
    if (!client) {
      client = (process.env.S4_CLIENT && process.env.S4_CLIENT.trim()) || this.getClient();
    }
    if (client && String(client).trim() !== '') {
      return `${systemName} - Client ${String(client).trim()}`;
    }
    return systemName;
  }

  /** SAP Client (e.g. '220') */
  getClient() {
    return this._requireString('client', ['CDS_S4_CLIENT', 'S4_CLIENT']);
  }

  /** Default Plant ID (e.g. '1120') */
  getPlant() {
    return this._requireString('plant', ['CDS_S4_PLANT', 'S4_PLANT']);
  }

  /** Default Storage Location (e.g. 'CS01') */
  getStorageLocation() {
    return this._requireString('storageLocation', ['CDS_S4_STORAGE_LOCATION', 'S4_STORAGE_LOCATION', 'S4_SLOC']);
  }

  /** Default Sales Organization (e.g. '1000') */
  getSalesOrganization() {
    return this._requireString('salesOrganization', ['CDS_S4_SALES_ORGANIZATION', 'S4_SALES_ORGANIZATION', 'S4_SALES_ORG']);
  }

  /** Default Distribution Channel (e.g. '10') */
  getDistributionChannel() {
    return this._requireString('distributionChannel', ['CDS_S4_DISTRIBUTION_CHANNEL', 'S4_DISTRIBUTION_CHANNEL', 'S4_CHANNEL']);
  }

  /** Default Organization Division (e.g. '52') */
  getDivision() {
    return this._requireString('division', ['CDS_S4_DIVISION', 'S4_DIVISION']);
  }

  /** Default Currency (e.g. 'INR') */
  getCurrency() {
    return this._requireString('currency', ['CDS_S4_CURRENCY', 'S4_CURRENCY']);
  }

  /** Sales Inquiry Document Type (e.g. 'ZIN') */
  getInquiryType() {
    return this._requireString('inquiryType', ['CDS_S4_INQUIRY_TYPE', 'S4_INQUIRY_TYPE']);
  }

  /** Sales Order Document Type (e.g. 'ZDOM') */
  getOrderType() {
    return this._requireString('orderType', ['CDS_S4_ORDER_TYPE', 'S4_ORDER_TYPE']);
  }

  /** Pricing Condition Type (e.g. 'ZPR1') */
  getConditionType() {
    return this._requireString('conditionType', ['CDS_S4_CONDITION_TYPE', 'S4_CONDITION_TYPE']);
  }

  /** Material types offered in the sales material value help (e.g. ['ZFRT', 'FERT']) — org scope, configured, never hardcoded */
  getSalesMaterialTypes() {
    return this._requireArray('salesMaterialTypes', ['CDS_S4_SALES_MATERIAL_TYPES', 'S4_SALES_MATERIAL_TYPES']);
  }

  /**
   * WM interim storage type that Goods Issue differences are cleared to (e.g. '999').
   * Warehouse customizing, not transactional data: must be configured explicitly, never defaulted.
   */
  getDifferenceStorageType() {
    return this._requireString('differenceStorageType', ['CDS_S4_DIFFERENCE_STORAGE_TYPE', 'S4_DIFFERENCE_STORAGE_TYPE']);
  }

  /** Specific Shipping Points (e.g. ['1120', '1112', '1108', '1109']) */
  getShippingPoints() {
    return this._requireArray('shippingPoints', ['CDS_S4_SHIPPING_POINTS', 'S4_SHIPPING_POINTS']);
  }

  // Getters for convenient property access
  get systemName() { return this.getSystemName(); }
  get systemLabel() { return this.getSystemLabel(); }
  get client() { return this.getClient(); }
  get plant() { return this.getPlant(); }
  get storageLocation() { return this.getStorageLocation(); }
  get salesOrganization() { return this.getSalesOrganization(); }
  get distributionChannel() { return this.getDistributionChannel(); }
  get division() { return this.getDivision(); }
  get currency() { return this.getCurrency(); }
  get inquiryType() { return this.getInquiryType(); }
  get orderType() { return this.getOrderType(); }
  get conditionType() { return this.getConditionType(); }
  get shippingPoints() { return this.getShippingPoints(); }
  get differenceStorageType() { return this.getDifferenceStorageType(); }
  get salesMaterialTypes() { return this.getSalesMaterialTypes(); }

  /**
   * Returns a snapshot of all configured values.
   */
  getAll() {
    return {
      client: this.getClient(),
      plant: this.getPlant(),
      storageLocation: this.getStorageLocation(),
      salesOrganization: this.getSalesOrganization(),
      distributionChannel: this.getDistributionChannel(),
      division: this.getDivision(),
      currency: this.getCurrency(),
      inquiryType: this.getInquiryType(),
      orderType: this.getOrderType(),
      conditionType: this.getConditionType(),
      shippingPoints: this.getShippingPoints()
    };
  }

  /**
   * Validates all required values at once and returns the configuration object.
   * Throws ConfigurationError if any required value is missing.
   */
  validate() {
    return this.getAll();
  }
}

const s4ConfigInstance = new S4Config();
s4ConfigInstance.S4Config = S4Config;
s4ConfigInstance.ConfigurationError = ConfigurationError;

module.exports = s4ConfigInstance;
