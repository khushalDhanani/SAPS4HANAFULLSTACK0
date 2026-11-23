'use strict';

/**
 * warehouseScope.js
 *
 * Authoritative server-side user-to-warehouse authorization mapping for Material Issued
 * To Batch Sticker (MIB) operations.
 *
 * Hardened security rules (Finding SEC-01):
 *   - Admin users (user.is('Admin')) -> null (unrestricted, all warehouses permitted).
 *   - Non-Admin users:
 *       1. Evaluates explicit warehouse attributes on user (WarehouseNumber, Warehouse, LGNUM).
 *       2. If explicit warehouse attribute is absent, resolves warehouses via an authoritative
 *          server-side Plant -> Warehouse configuration mapping (table T320).
 *          NOTE: A Plant attribute (e.g. '1120') is NEVER treated as a warehouse code.
 *       3. If neither explicit warehouse nor mapped plant exists, returns [] (fail closed:
 *          no warehouses permitted).
 *   - Normalizes all warehouse numbers: uppercase, trimmed, validated against /^[A-Z0-9]{1,3}$/.
 */

const { httpError } = require('../../integration/s4hana/sapKey');

/**
 * Authoritative default mapping of SAP Plant (WERKS) to SAP Warehouse (LGNUM),
 * reflecting configuration from SAP table T320.
 */
const DEFAULT_PLANT_TO_WAREHOUSE = Object.freeze({
  '1120': Object.freeze(['W01']),
  '1000': Object.freeze(['W01'])
});

const LGNUM_PATTERN = /^[A-Z0-9]{1,3}$/;

/**
 * Extracts and normalizes warehouse strings into a clean, unique array of 1-3 alphanumeric codes.
 *
 * @param {string|string[]} rawValues
 * @returns {string[]}
 */
function normalizeWarehouses(rawValues) {
  const list = Array.isArray(rawValues) ? rawValues : [rawValues];
  const normalized = [];
  for (const item of list) {
    if (item === null || item === undefined) continue;
    const s = String(item).trim().toUpperCase();
    if (LGNUM_PATTERN.test(s) && !normalized.includes(s)) {
      normalized.push(s);
    }
  }
  return normalized;
}

/**
 * Derives the list of warehouse numbers the authenticated user is authorized to access.
 *
 * @param {object} user - The CAP request user (req.user)
 * @param {object} [plantToWarehouseMap=DEFAULT_PLANT_TO_WAREHOUSE] - Authoritative plant-to-warehouse mapping
 * @returns {string[]|null} - Array of authorized warehouse numbers, or null for unrestricted Admin
 */
function warehouseScope(user, plantToWarehouseMap = DEFAULT_PLANT_TO_WAREHOUSE) {
  if (user && typeof user.is === 'function' && user.is('Admin')) {
    return null;
  }

  if (!user || !user.attr) {
    return [];
  }

  // 1. Check explicit user warehouse attributes (WarehouseNumber, Warehouse, LGNUM)
  const explicitWh = user.attr.WarehouseNumber || user.attr.Warehouse || user.attr.LGNUM;
  if (explicitWh !== undefined && explicitWh !== null) {
    const warehouses = normalizeWarehouses(explicitWh);
    if (warehouses.length > 0) {
      return warehouses;
    }
  }

  // 2. Authoritative server-side mapping from user's Plant attribute (T320 configuration)
  // Crucial: Do NOT treat Plant ('1120') as Warehouse ('W01'); map via authoritative table.
  const plants = [].concat(user.attr.Plant || []).map((p) => String(p).trim().toUpperCase()).filter(Boolean);
  if (plants.length > 0) {
    const derived = new Set();
    const map = plantToWarehouseMap || DEFAULT_PLANT_TO_WAREHOUSE;
    for (const plant of plants) {
      const mappedWarehouses = map[plant];
      if (Array.isArray(mappedWarehouses)) {
        for (const wh of mappedWarehouses) {
          const cleanWh = String(wh).trim().toUpperCase();
          if (LGNUM_PATTERN.test(cleanWh)) {
            derived.add(cleanWh);
          }
        }
      }
    }
    return Array.from(derived);
  }

  // 3. Non-Admin with no warehouse or mapped plant attributes is authorized for no warehouses
  return [];
}

/**
 * Checks whether a specific warehouse is permitted under the given warehouse scope.
 *
 * @param {string} warehouse - Requested warehouse number (e.g. 'W01')
 * @param {string[]|null} allowedWarehouses - Authorized scope (null = unrestricted Admin)
 * @returns {boolean}
 */
function isWarehouseAllowed(warehouse, allowedWarehouses) {
  if (allowedWarehouses === null) return true;
  if (!Array.isArray(allowedWarehouses)) return false;
  const normalized = String(warehouse || '').trim().toUpperCase();
  return Boolean(normalized) && allowedWarehouses.includes(normalized);
}

/**
 * Asserts that the requested warehouse is permitted; throws HTTP 403 if unauthorized.
 *
 * @param {string} warehouse - Requested warehouse number
 * @param {string[]|null} allowedWarehouses - Authorized scope (null = unrestricted Admin)
 * @throws {Error} - 403 Forbidden if not authorized
 */
function assertWarehouseAllowed(warehouse, allowedWarehouses) {
  if (!isWarehouseAllowed(warehouse, allowedWarehouses)) {
    const clean = String(warehouse || '').trim().toUpperCase();
    const err = httpError(403, `Warehouse ${clean || '(none)'} is outside the user's authorized warehouse scope.`);
    err.statusCode = 403;
    err.$sanitize = false;
    throw err;
  }
}

module.exports = {
  warehouseScope,
  isWarehouseAllowed,
  assertWarehouseAllowed,
  DEFAULT_PLANT_TO_WAREHOUSE
};
