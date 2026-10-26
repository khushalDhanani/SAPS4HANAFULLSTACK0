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
 *   - Per-key TTL cache (default 5 min) with invalidation on admin writes.
 *   - Resolves dynamically per request/document in strict order:
 *       1. Trusted server-side overrides
 *       2. Cached valid entry (per plant/warehouse key)
 *       3. SAP customizing tables (T001L, T320 via RFC or customizer provider)
 *       4. Admin-maintained BusinessConfig table (CDS entity keyed by plant or warehouse)
 *       5. Throw BusinessConfigError with actionable diagnostic message
 *
 * Fields resolved:
 *   salesOrg / salesOrganization, distChannel / distributionChannel, division, currency,
 *   orderType, inquiryType, conditionType,
 *   shippingPoints (string[]), materialTypes / salesMaterialTypes (string[]),
 *   mvt261NotReadyBins ({ storageType, bin, reason }[]),
 *   differenceStorageType
 */

let cds;
try {
  cds = require('@sap/cds');
} catch (_) {
  cds = null;
}

const { sapKey } = require('../integration/s4hana/sapKey');

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
 * Parses a JSON string into an array.
 * Returns [] if input is null/undefined/blank.
 * Throws BusinessConfigError if invalid.
 */
function parseJsonArray(json, fieldName) {
  if (!json || !String(json).trim()) return [];
  let parsed;
  try {
    parsed = typeof json === 'string' ? JSON.parse(json) : json;
  } catch (e) {
    throw new BusinessConfigError(
      `BusinessConfig.${fieldName} contains invalid JSON: ${e.message}`
    );
  }
  if (!Array.isArray(parsed)) {
    throw new BusinessConfigError(
      `BusinessConfig.${fieldName} must be a JSON array, got: ${typeof parsed}`
    );
  }
  return parsed;
}

function validateHuStorageTypeLists(values = {}) {
  const fields = ['pickableStorageTypes', 'holdStorageTypes', 'interimStorageTypes'];
  const result = {};
  for (const field of fields) {
    const raw = values[field] ?? values[field[0].toUpperCase() + field.slice(1)];
    const list = Array.isArray(raw) ? raw : parseCsv(raw);
    if (!list.length) throw new BusinessConfigError(`BusinessConfig.${field} must be non-empty.`);
    let normalized;
    try {
      normalized = list.map((item) => sapKey(item, 'lgtyp'));
    } catch (error) {
      throw new BusinessConfigError(`BusinessConfig.${field} contains an invalid storage type: ${error.message}`);
    }
    if (new Set(normalized).size !== normalized.length) {
      throw new BusinessConfigError(`BusinessConfig.${field} contains duplicate storage types.`);
    }
    result[field] = normalized;
  }
  const seen = new Map();
  for (const field of fields) {
    for (const code of result[field]) {
      if (seen.has(code)) {
        throw new BusinessConfigError(`Storage type ${code} overlaps ${seen.get(code)} and ${field}.`);
      }
      seen.set(code, field);
    }
  }
  return result;
}

/**
 * Flow-specific required fields mappings.
 * Each flow specifies only the business config fields it actually needs:
 * - delivery-no-ref: salesOrganization, distributionChannel, division
 * - 261 (mvt261):   mvt261NotReadyBins
 * - scan-to:        warehouseNumber, plant
 * - sd:             salesOrganization, distributionChannel, division, currency, orderType, inquiryType, conditionType, shippingPoints, salesMaterialTypes
 */
const FLOW_REQUIRED_FIELDS = Object.freeze({
  'delivery-no-ref': Object.freeze(['salesOrganization', 'distributionChannel', 'division']),
  'delivery':        Object.freeze(['salesOrganization', 'distributionChannel', 'division']),
  '261':             Object.freeze(['mvt261NotReadyBins']),
  'mvt261':          Object.freeze(['mvt261NotReadyBins']),
  'scan-to':         Object.freeze(['warehouseNumber', 'plant']),
  'hu-stock-transfer': Object.freeze(['pickableStorageTypes', 'holdStorageTypes', 'interimStorageTypes']),
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

// Configured warehouse storage type rules (warehouse-specific customizing)
// Zero guessed defaults; must be supplied by business configuration or registered explicitly
const CONFIGURED_WAREHOUSE_STORAGE_TYPES = new Map();

class BusinessConfigResolver {
  /**
   * Flow-specific required field definitions.
   */
  static get FLOW_REQUIRED_FIELDS() {
    return FLOW_REQUIRED_FIELDS;
  }

  /**
   * @param {Object} [options]
   * @param {Function} [options.dbQuery] - Injectable async (plant, warehouseNumber) => row | null
   * @param {Function} [options.sapCustomizing] - Injectable async (context) => partialConfig | null
   * @param {Object} [options.rfc] - Optional RFC client for querying SAP customizing tables (T001L, T320)
   * @param {number} [options.ttlMs=300000] - Per-key TTL cache duration in milliseconds (default 5 minutes; 0 disables)
   */
  constructor(options = {}) {
    this._dbQuery = options.dbQuery || null;
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

  /** Oversize-HU setting: “default BLOCK, pending the user's confirmation”. */
  async resolveOversizeHuSelectionBehavior(context = {}) {
    const row = await this._queryDb(
      String(context.plant || '').trim().toUpperCase(),
      String(context.warehouse || context.warehouseNumber || '').trim().toUpperCase()
    );
    const value = String(row?.OversizeHuSelectionBehavior || 'BLOCK').trim().toUpperCase();
    if (!['BLOCK', 'WARN'].includes(value)) {
      throw new BusinessConfigError('BusinessConfig.OversizeHuSelectionBehavior must be BLOCK or WARN.');
    }
    return value;
  }

  /**
   * Query SAP customizing tables via RFC or customizer provider.
   * @private
   */
  async _querySapCustomizing(context) {
    const customizer = context.sapCustomizing || this._sapCustomizing;
    if (typeof customizer === 'function') {
      try {
        const res = await customizer(context);
        if (res && typeof res === 'object') return res;
      } catch (_err) {
        // Continue to next resolution step
      }
    } else if (customizer && typeof customizer === 'object') {
      return customizer;
    }

    const rfc = context.rfc || this._rfc;
    if (rfc && typeof rfc.readTable === 'function') {
      const result = {};
      const plant = context.plant;
      const sLoc = context.storageLocation;
      const wh = context.warehouse;
      // Read failures are not silent: they are reported in the final error when a field stays unresolved.
      const sapReadErrors = [];
      const readFailed = (table, e) => sapReadErrors.push(`${table}: ${e && e.message ? e.message : e}`);

      // 1. T001L: Storage Location in Plant (gives VKORG, VTWEG, SPART)
      if (plant && sLoc) {
        try {
          const t001l = await rfc.readTable('T001L', ['WERKS', 'LGORT', 'VKORG', 'VTWEG', 'SPART'], [
            `WERKS = '${plant}'`,
            `AND LGORT = '${sLoc}'`
          ]);
          if (t001l && t001l[0]) {
            if (t001l[0].VKORG && t001l[0].VKORG.trim()) result.salesOrganization = t001l[0].VKORG.trim();
            if (t001l[0].VTWEG && t001l[0].VTWEG.trim()) result.distributionChannel = t001l[0].VTWEG.trim();
            if (t001l[0].SPART && t001l[0].SPART.trim()) result.division = t001l[0].SPART.trim();
          }
        } catch (e) { readFailed('T001L', e); }
      }

      // 1b. T001K (valuation area = plant) -> company code, T001 -> company code currency
      if (plant) {
        try {
          const t001k = await rfc.readTable('T001K', ['BWKEY', 'BUKRS'], [`BWKEY = '${plant}'`], 1);
          const bukrs = String(t001k?.[0]?.BUKRS || '').trim();
          if (bukrs) {
            result.companyCode = bukrs;
            const t001 = await rfc.readTable('T001', ['BUKRS', 'WAERS'], [`BUKRS = '${bukrs}'`], 1);
            const waers = String(t001?.[0]?.WAERS || '').trim();
            if (waers) result.currency = waers;
          }
        } catch (e) { readFailed('T001K/T001', e); }
      }

      // 2. T320: Warehouse assignment
      if (plant && sLoc && !wh) {
        try {
          const t320 = await rfc.readTable('T320', ['LGNUM'], [
            `WERKS = '${plant}'`,
            `AND LGORT = '${sLoc}'`
          ]);
          if (t320 && t320[0] && t320[0].LGNUM) {
            result.warehouseNumber = t320[0].LGNUM.trim();
            result.warehouse = result.warehouseNumber;
          }
        } catch (e) { readFailed('T320', e); }
      } else if (wh && !plant) {
        try {
          const t320 = await rfc.readTable('T320', ['WERKS'], [`LGNUM = '${wh}'`]);
          if (t320 && t320[0] && t320[0].WERKS) {
            result.plant = t320[0].WERKS.trim();
          }
        } catch (e) { readFailed('T320', e); }
      }

      // 3. TVSTZ: Plant to Shipping Point assignment
      if (plant && result.shippingPoints === undefined) {
        try {
          const tvstz = await rfc.readTable('TVSTZ', ['WERKS', 'VSTEL'], [
            `WERKS = '${plant}'`
          ]);
          if (Array.isArray(tvstz) && tvstz.length > 0) {
            const points = Array.from(new Set(tvstz.map(r => r.VSTEL && r.VSTEL.trim()).filter(Boolean)));
            if (points.length > 0) {
              result.shippingPoints = points;
            }
          }
        } catch (e) { readFailed('TVSTZ', e); }
      }

      if (sapReadErrors.length) result.sapReadErrors = sapReadErrors;
      return Object.keys(result).length > 0 ? result : null;
    }

    return null;
  }

  /**
   * Queries the BusinessConfig table for the given plant/warehouse combination.
   * @private
   */
  async _queryDb(plant, warehouseNumber) {
    if (this._dbQuery) {
      return this._dbQuery(plant, warehouseNumber);
    }

    if (!cds || typeof cds.entities !== 'function' || !cds.model) {
      return null;
    }

    let BusinessConfig;
    try {
      const entities = cds.entities('saps4hana.wm');
      BusinessConfig = entities ? entities.BusinessConfig : null;
    } catch (_) {
      return null;
    }
    if (!BusinessConfig) return null;

    const pl = (plant || '').trim();
    const wh = (warehouseNumber || '').trim();

    // 1. Exact match: plant + warehouse
    if (pl && wh) {
      const exact = await cds.run(
        SELECT.one.from(BusinessConfig).where({ Plant: pl, WarehouseNumber: wh, Active: true })
      );
      if (exact) return exact;
    }

    // 2. Warehouse-level row (e.g. when warehouse is supplied)
    if (wh) {
      const byWh = await cds.run(
        SELECT.one.from(BusinessConfig).where({ WarehouseNumber: wh, Active: true })
      );
      if (byWh) return byWh;
    }

    // 3. Plant-level fallback (WarehouseNumber = '')
    if (pl) {
      const plantLevel = await cds.run(
        SELECT.one.from(BusinessConfig).where({ Plant: pl, WarehouseNumber: '', Active: true })
      );
      if (plantLevel) return plantLevel;

      // Or any active row for this plant
      const anyPlant = await cds.run(
        SELECT.one.from(BusinessConfig).where({ Plant: pl, Active: true })
      );
      if (anyPlant) return anyPlant;
    }

    return null;
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
    // Keys are validated before they are used in any SAP WHERE text or cache key; an invalid key fails closed.
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
    // Overrides are accepted ONLY from trusted server-side context.
    // Untrusted request bodies with salesOrg/currency/etc. are strictly ignored.
    const isTrusted = context.isTrusted === true || context.trustedContext === true;
    let overrides = {};

    if (context.trustedOverrides && typeof context.trustedOverrides === 'object') {
      overrides = { ...context.trustedOverrides };
    } else if (isTrusted && context.overrides && typeof context.overrides === 'object') {
      overrides = { ...context.overrides };
    } else if (isTrusted) {
      const DIRECT_KEYS = [
        'salesOrganization', 'salesOrg',
        'distributionChannel', 'distChannel',
        'division', 'currency',
        'inquiryType', 'orderType', 'conditionType',
        'shippingPoints',
        'salesMaterialTypes', 'materialTypes',
        'differenceStorageType',
        'mvt261NotReadyBins',
        'pickableStorageTypes',
        'holdStorageTypes',
        'interimStorageTypes'
      ];
      for (const k of DIRECT_KEYS) {
        if (context[k] !== undefined) {
          overrides[k] = context[k];
        }
      }
    }

    // Normalize trusted override keys
    if (overrides.salesOrg !== undefined && overrides.salesOrganization === undefined) {
      overrides.salesOrganization = overrides.salesOrg;
    }
    if (overrides.distChannel !== undefined && overrides.distributionChannel === undefined) {
      overrides.distributionChannel = overrides.distChannel;
    }
    if (overrides.materialTypes !== undefined && overrides.salesMaterialTypes === undefined) {
      overrides.salesMaterialTypes = overrides.materialTypes;
    }

    for (const [k, v] of Object.entries(overrides)) {
      if (v !== undefined && v !== null && v !== '') {
        if (k === 'shippingPoints' && typeof v === 'string') {
          result[k] = parseCsv(v);
        } else if (k === 'salesMaterialTypes' && typeof v === 'string') {
          result[k] = parseCsv(v);
        } else if (k === 'mvt261NotReadyBins' && typeof v === 'string') {
          result[k] = parseJsonArray(v, 'mvt261NotReadyBins');
        } else if ((k === 'pickableStorageTypes' || k === 'holdStorageTypes' || k === 'interimStorageTypes') && typeof v === 'string') {
          result[k] = parseCsv(v);
        } else if ((k === 'pickableStorageTypes' || k === 'holdStorageTypes' || k === 'interimStorageTypes') && Array.isArray(v)) {
          result[k] = v.map(s => String(s).trim().toUpperCase()).filter(Boolean);
        } else {
          result[k] = v;
        }
      }
    }

    let missing = requiredFields.filter(f => result[f] === undefined);

    // If completely satisfied by trusted overrides, return immediately (no cache pollution)
    if (missing.length === 0) {
      if (result.mvt261NotReadyBins === undefined) result.mvt261NotReadyBins = [];
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
        if (sapData.companyCode && result.companyCode === undefined) result.companyCode = sapData.companyCode;
        if (sapData.salesOrganization && result.salesOrganization === undefined) result.salesOrganization = sapData.salesOrganization;
        if (sapData.salesOrg && result.salesOrganization === undefined) result.salesOrganization = sapData.salesOrg;
        if (sapData.distributionChannel && result.distributionChannel === undefined) result.distributionChannel = sapData.distributionChannel;
        if (sapData.distChannel && result.distributionChannel === undefined) result.distributionChannel = sapData.distChannel;
        if (sapData.division && result.division === undefined) result.division = sapData.division;
        if (sapData.currency && result.currency === undefined) result.currency = sapData.currency;
        if (sapData.orderType && result.orderType === undefined) result.orderType = sapData.orderType;
        if (sapData.inquiryType && result.inquiryType === undefined) result.inquiryType = sapData.inquiryType;
        if (sapData.conditionType && result.conditionType === undefined) result.conditionType = sapData.conditionType;
        if (sapData.shippingPoints && result.shippingPoints === undefined) {
          result.shippingPoints = typeof sapData.shippingPoints === 'string' ? parseCsv(sapData.shippingPoints) : sapData.shippingPoints;
        }
        if (sapData.salesMaterialTypes && result.salesMaterialTypes === undefined) {
          result.salesMaterialTypes = typeof sapData.salesMaterialTypes === 'string' ? parseCsv(sapData.salesMaterialTypes) : sapData.salesMaterialTypes;
        }
        if (sapData.materialTypes && result.salesMaterialTypes === undefined) {
          result.salesMaterialTypes = typeof sapData.materialTypes === 'string' ? parseCsv(sapData.materialTypes) : sapData.materialTypes;
        }
        if (sapData.mvt261NotReadyBins && result.mvt261NotReadyBins === undefined) {
          result.mvt261NotReadyBins = typeof sapData.mvt261NotReadyBins === 'string'
            ? parseJsonArray(sapData.mvt261NotReadyBins, 'mvt261NotReadyBins')
            : sapData.mvt261NotReadyBins;
        }
        if (sapData.differenceStorageType && result.differenceStorageType === undefined) {
          result.differenceStorageType = sapData.differenceStorageType;
        }
        if (sapData.plant && !result.plant) result.plant = sapData.plant;
        if (sapData.warehouse && !result.warehouse) {
          result.warehouse = sapData.warehouse;
          result.warehouseNumber = sapData.warehouse;
        }
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

    // ─── Step 4: Admin Config Table (BusinessConfig) ──────────────────────────
    if (missing.length > 0) {
      const row = await this._queryDb(result.plant || plant, result.warehouse || warehouse);
      if (row) {
        if (!result.plant && row.Plant) result.plant = row.Plant;
        if (!result.warehouse && row.WarehouseNumber) {
          result.warehouse = row.WarehouseNumber;
          result.warehouseNumber = row.WarehouseNumber;
        }

        const assign = (field, val) => {
          if (result[field] === undefined && val && String(val).trim()) {
            result[field] = String(val).trim();
          }
        };

        assign('salesOrganization',   row.SalesOrganization);
        assign('distributionChannel', row.DistributionChannel);
        assign('division',            row.Division);
        assign('currency',            row.Currency);
        assign('inquiryType',         row.InquiryType);
        assign('orderType',           row.OrderType);
        assign('conditionType',       row.ConditionType);
        assign('differenceStorageType', row.DifferenceStorageType);

        if (result.shippingPoints === undefined && row.ShippingPoints) {
          result.shippingPoints = parseCsv(row.ShippingPoints);
        }
        if (result.salesMaterialTypes === undefined && row.SalesMaterialTypes) {
          result.salesMaterialTypes = parseCsv(row.SalesMaterialTypes);
        }
        if (result.mvt261NotReadyBins === undefined && row.Mvt261NotReadyBinsJson) {
          result.mvt261NotReadyBins = parseJsonArray(row.Mvt261NotReadyBinsJson, 'Mvt261NotReadyBinsJson');
        }
        if (result.pickableStorageTypes === undefined && (row.PickableStorageTypes || row.pickableStorageTypes)) {
          result.pickableStorageTypes = parseCsv(row.PickableStorageTypes || row.pickableStorageTypes);
        }
        if (result.holdStorageTypes === undefined && (row.HoldStorageTypes || row.holdStorageTypes)) {
          result.holdStorageTypes = parseCsv(row.HoldStorageTypes || row.holdStorageTypes);
        }
        if (result.interimStorageTypes === undefined && (row.InterimStorageTypes || row.interimStorageTypes)) {
          result.interimStorageTypes = parseCsv(row.InterimStorageTypes || row.interimStorageTypes);
        }
      }

      missing = requiredFields.filter(f => result[f] === undefined);
    }

    // ─── Step 5: Throw if required fields remain unresolved ───────────────────
    if (missing.length > 0) {
      const loc = `Plant=${result.plant || plant || '(none)'}, Warehouse=${result.warehouse || warehouse || '(none)'}, StorageLocation=${storageLocation || '(none)'}`;
      if (flow === 'hu-stock-transfer') {
        throw new BusinessConfigError(
          `BusinessConfigResolver could not resolve storage type rules [${missing.join(', ')}] for ${loc}. Storage types must be supplied by business configuration; fail-closed without hardcoded defaults.`
        );
      }
      throw new BusinessConfigError(
        `BusinessConfigResolver could not resolve required business config fields [${missing.join(', ')}] for ${loc}. ` +
        `Maintain the values in SAP customizing or via the BusinessConfig admin table.` +
        (sapReadErrors.length ? ` SAP reads failed: ${sapReadErrors.join('; ')}.` : '')
      );
    }

    // Default optional mvt261NotReadyBins to empty array if not defined
    if (result.mvt261NotReadyBins === undefined) {
      result.mvt261NotReadyBins = [];
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

  /**
   * Registers custom storage type rules for a warehouse (for tests or administrative setup).
   */
  static registerWarehouseStorageTypes(warehouse, rules) {
    if (warehouse && rules) {
      CONFIGURED_WAREHOUSE_STORAGE_TYPES.set(String(warehouse).trim().toUpperCase(), rules);
    }
  }

  /**
   * Unregisters custom storage type rules for a warehouse.
   */
  static unregisterWarehouseStorageTypes(warehouse) {
    if (warehouse) {
      CONFIGURED_WAREHOUSE_STORAGE_TYPES.delete(String(warehouse).trim().toUpperCase());
    }
  }

  /**
   * Resolves storage type rules for HU operations.
   * Fails closed when pickable, hold, or interim storage types are not configured.
   * Zero hardcoded literals in business logic.
   *
   * @param {Object} [context={}]
   * @returns {Promise<{ pickableStorageTypes: string[], holdStorageTypes: string[], interimStorageTypes: string[], isPickable: Function, isOnHold: Function, isInterim: Function }>}
   */
  async resolveHuStorageTypeRules(context = {}) {
    const isTrusted = context.isTrusted !== false;
    const wh = String(context.warehouse || context.warehouseNumber || context.lgnum || '').trim().toUpperCase();
    const configured = CONFIGURED_WAREHOUSE_STORAGE_TYPES.get(wh) || null;

    const res = await this.resolve({
      ...context,
      isTrusted,
      flow: 'hu-stock-transfer',
      fields: ['pickableStorageTypes', 'holdStorageTypes', 'interimStorageTypes'],
      ...(configured ? {
        trustedOverrides: {
          ...configured,
          ...(context.trustedOverrides || {})
        }
      } : {})
    });

    let validatedLists;
    try {
      validatedLists = validateHuStorageTypeLists(res);
    } catch (error) {
      throw new BusinessConfigError(
        `BusinessConfigResolver could not resolve valid storage type rules for ${context.warehouse || context.plant || 'warehouse'}: ${error.message}`
      );
    }
    const { pickableStorageTypes: pickable, holdStorageTypes: hold, interimStorageTypes: interim } = validatedLists;

    return {
      pickableStorageTypes: pickable,
      holdStorageTypes: hold,
      interimStorageTypes: interim,
      isPickable(lgtyp) {
        if (!lgtyp) return false;
        return pickable.includes(String(lgtyp).trim().toUpperCase());
      },
      isOnHold(lgtyp, _lgpla = '') {
        if (!lgtyp) return false;
        const type = String(lgtyp).trim().toUpperCase();
        // Classified as hold only when explicitly included in holdStorageTypes; no string heuristics on bin names
        return hold.includes(type);
      },
      isInterim(lgtyp) {
        if (!lgtyp) return false;
        const type = String(lgtyp).trim().toUpperCase();
        return interim.includes(type);
      }
    };
  }
}

// Singleton export with class constructors attached
const instance = new BusinessConfigResolver();
instance.BusinessConfigResolver = BusinessConfigResolver;
instance.BusinessConfigError = BusinessConfigError;
instance.parseCsv = parseCsv;
instance.validateHuStorageTypeLists = validateHuStorageTypeLists;
instance.parseJsonArray = parseJsonArray;
instance.registerWarehouseStorageTypes = BusinessConfigResolver.registerWarehouseStorageTypes;
instance.unregisterWarehouseStorageTypes = BusinessConfigResolver.unregisterWarehouseStorageTypes;

module.exports = instance;
