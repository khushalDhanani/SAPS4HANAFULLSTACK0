'use strict';

/**
 * BusinessConfigResolver.js
 *
 * Resolves business-data values (SD org context, WM customizing) for a specific
 * plant/warehouse/storageLocation context at request time.
 *
 * Hardened enterprise security & performance discipline:
 *   - Overrides are accepted ONLY from trusted server-side context (trustedOverrides / isTrusted).
 *     Request body values can never tamper with business customizing.
 *   - Never reads business defaults from package.json or process.env.
 *   - Never falls back to silent defaults.
 *   - Per-key TTL cache (default 5 min).
 *   - Resolves dynamically per request/document in strict order:
 *       1. Trusted server-side overrides
 *       2. Cached valid entry (per plant/warehouse key)
 *       3. SAP customizing tables (T001L, T320 via RFC or customizer provider)
 *       4. Throw BusinessConfigError with actionable diagnostic message
 */

const { sapKey } = require('../integration/s4hana/sapKey');
const { querySapCustomizing, applySapCustomizingData } = require('./BusinessConfigCustomizer');
const { extractTrustedOverrides } = require('./BusinessConfigOverrides');

class BusinessConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BusinessConfigError';
  }
}

/**
 * Parses a CSV string into a trimmed, non-empty string array.
 * Returns [] if input is null/undefined/blank.
 */
function parseCsv(csv) {
  if (!csv || !String(csv).trim()) return [];
  return String(csv).split(',').map(v => v.trim()).filter(Boolean);
}

/**
 * Flow-specific required fields mappings.
 */
const FLOW_REQUIRED_FIELDS = Object.freeze({
  'delivery-no-ref': Object.freeze(['salesOrganization', 'distributionChannel', 'division']),
  'delivery':        Object.freeze(['salesOrganization', 'distributionChannel', 'division']),
  'scan-to':         Object.freeze(['warehouseNumber', 'plant']),
  'sd':              Object.freeze([
    'salesOrganization', 'distributionChannel', 'division', 'currency',
    'orderType', 'inquiryType', 'conditionType',
    'shippingPoints', 'salesMaterialTypes'
  ])
});

/**
 * Standard required fields when full resolution is requested.
 */
const ALL_REQUIRED_FIELDS = FLOW_REQUIRED_FIELDS.sd;

class BusinessConfigResolver {
  /**
   * Flow-specific required field definitions.
   */
  static get FLOW_REQUIRED_FIELDS() {
    return FLOW_REQUIRED_FIELDS;
  }

  /**
   * @param {Object} [options]
   * @param {Function} [options.sapCustomizing] - Injectable async (context) => partialConfig | null
   * @param {Object} [options.rfc] - Optional RFC client for querying SAP customizing tables (T001L, T320)
   * @param {number} [options.ttlMs=300000] - Per-key TTL cache duration in milliseconds (default 5 minutes; 0 disables)
   */
  constructor(options = {}) {
    this._sapCustomizing = options.sapCustomizing || null;
    this._rfc = options.rfc || null;
    this._ttlMs = options.ttlMs !== undefined ? options.ttlMs : 300000;
    this._cache = new Map();
    this.FLOW_REQUIRED_FIELDS = FLOW_REQUIRED_FIELDS;
  }

  /**
   * Generates a per-key cache identifier.
   * @private
   */
  _getCacheKey(plant, warehouse, fields, flow = '') {
    const pl = plant || '*';
    const wh = warehouse || '*';
    const f = Array.isArray(fields) && fields.length > 0 ? fields.slice().sort().join(',') : 'ALL';
    return `${pl}|${wh}|${flow || '*'}|${f}`;
  }

  /**
   * Invalidate cached entries.
   * @param {string} [plant]
   * @param {string} [warehouse]
   */
  invalidate(plant, warehouse) {
    const pl = plant ? String(plant).trim() : '';
    const wh = warehouse ? String(warehouse).trim() : '';

    if (!pl && !wh) {
      this._cache.clear();
      return;
    }

    for (const [key, entry] of this._cache.entries()) {
      const matchPlant = !pl || entry.plant === pl;
      const matchWh = !wh || entry.warehouse === wh;
      if (matchPlant && matchWh) {
        this._cache.delete(key);
      }
    }
  }

  /** Clears the entire TTL cache. */
  clearCache() {
    this._cache.clear();
  }

  /** Returns number of active cache keys. */
  getCacheSize() {
    return this._cache.size;
  }

  /** Returns raw cache entry for testing. */
  getCacheEntry(plant, warehouse, fields, flow = '') {
    const key = this._getCacheKey(plant, warehouse, fields, flow);
    return this._cache.get(key) || null;
  }

  /**
   * Query SAP customizing tables via RFC or customizer provider.
   * @private
   */
  async _querySapCustomizing(context) {
    return querySapCustomizing(context, this._sapCustomizing, this._rfc);
  }

  /**
   * Resolves business configuration.
   *
   * @param {Object} context
   * @param {string} [context.warehouse]       - WM Warehouse (e.g. 'W01')
   * @param {string} [context.warehouseNumber] - Alias for warehouse
   * @param {string} [context.plant]           - SAP Plant (WERKS, e.g. '1120')
   * @param {string} [context.storageLocation] - Storage Location (LGORT, e.g. 'CS01')
   * @param {Array<string>} [context.fields]   - Specific required fields; defaults to all standard fields
   * @param {Object} [context.trustedOverrides] - Explicit trusted overrides from verified server-side context
   * @param {boolean} [context.isTrusted]      - Flag declaring context is trusted server-side (enables context.overrides)
   * @param {boolean} [context.trustedContext]  - Alias for isTrusted
   * @param {Object} [context.overrides]       - Overrides evaluated ONLY when isTrusted/trustedContext is true
   * @returns {Promise<Object>}
   * @throws {BusinessConfigError} if a required field cannot be resolved
   */
  async resolve(context = {}) {
    const keyOf = (value, field, label) => {
      const v = String(value || '').trim();
      if (!v) return '';
      try { return sapKey(v, field); } catch (e) {
        throw new BusinessConfigError(`BusinessConfigResolver rejected ${label} '${v.slice(0, 20)}': ${e.message}`);
      }
    };
    const warehouse = keyOf(context.warehouse || context.warehouseNumber || context.lgnum, 'lgnum', 'warehouse');
    const plant = keyOf(context.plant || context.werks, 'plant', 'plant');
    const storageLocation = keyOf(context.storageLocation || context.lgort, 'lgort', 'storage location');

    const flow = context.flow ? String(context.flow).toLowerCase().trim() : '';
    const requiredFields = Array.isArray(context.fields) && context.fields.length > 0
      ? context.fields
      : (flow && FLOW_REQUIRED_FIELDS[flow])
        ? FLOW_REQUIRED_FIELDS[flow]
        : ALL_REQUIRED_FIELDS;

    const result = {
      plant: plant || '',
      warehouse: warehouse || '',
      warehouseNumber: warehouse || '',
      storageLocation: storageLocation || ''
    };

    // ─── Step 1: Trusted Server-Side Overrides (Tamper Protection) ───────────
    const overrides = extractTrustedOverrides(context, result, parseCsv);

    let missing = requiredFields.filter(f => result[f] === undefined);

    // If completely satisfied by trusted overrides, return immediately (no cache pollution)
    if (missing.length === 0) {
      result.salesOrg = result.salesOrganization;
      result.distChannel = result.distributionChannel;
      result.materialTypes = result.salesMaterialTypes;
      return result;
    }

    // ─── Step 2: Per-Key TTL Cache Check ─────────────────────────────────────
    const cacheKey = this._getCacheKey(plant, warehouse, requiredFields, flow);
    const hasOverrides = Object.keys(overrides).length > 0;

    if (!hasOverrides && this._ttlMs > 0) {
      const cached = this._cache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        return JSON.parse(JSON.stringify(cached.value));
      }
    }

    // ─── Step 3: SAP Customizing ──────────────────────────────────────────────
    let sapReadErrors = [];
    if (missing.length > 0) {
      const sapData = await this._querySapCustomizing({
        plant,
        warehouse,
        storageLocation,
        rfc: context.rfc,
        sapCustomizing: context.sapCustomizing
      });

      if (sapData) {
        if (Array.isArray(sapData.sapReadErrors)) sapReadErrors = sapData.sapReadErrors;
        applySapCustomizingData(sapData, result, parseCsv);
      }

      missing = requiredFields.filter(f => result[f] === undefined);
    }

    // Fail closed: without a plant or warehouse there is no key to look anything up by.
    if (!(result.plant || plant) && !(result.warehouse || warehouse)) {
      throw new BusinessConfigError(
        `BusinessConfigResolver cannot resolve [${missing.join(', ')}]: neither plant nor warehouse could be determined` +
        (sapReadErrors.length ? ` (SAP reads failed: ${sapReadErrors.join('; ')})` : '') + '.'
      );
    }

    // ─── Step 4: Throw if required fields remain unresolved ───────────────────
    if (missing.length > 0) {
      const loc = `Plant=${result.plant || plant || '(none)'}, Warehouse=${result.warehouse || warehouse || '(none)'}, StorageLocation=${storageLocation || '(none)'}`;
      throw new BusinessConfigError(
        `BusinessConfigResolver could not resolve required business config fields [${missing.join(', ')}] for ${loc}. ` +
        `Maintain the values in SAP customizing.` +
        (sapReadErrors.length ? ` SAP reads failed: ${sapReadErrors.join('; ')}.` : '')
      );
    }

    // Map convenient aliases
    result.salesOrg = result.salesOrganization;
    result.distChannel = result.distributionChannel;
    result.materialTypes = result.salesMaterialTypes;

    // Cache the resolved authentic configuration (if no request overrides were applied)
    if (!hasOverrides && this._ttlMs > 0) {
      this._cache.set(cacheKey, {
        value: JSON.parse(JSON.stringify(result)),
        expiresAt: Date.now() + this._ttlMs,
        plant: result.plant || plant,
        warehouse: result.warehouse || warehouse
      });
    }

    return result;
  }
}

// Singleton export with class constructors attached
const instance = new BusinessConfigResolver();
instance.BusinessConfigResolver = BusinessConfigResolver;
instance.BusinessConfigError = BusinessConfigError;
instance.parseCsv = parseCsv;
module.exports = instance;
