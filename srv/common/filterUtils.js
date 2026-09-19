/**
 * Shared Query Filter and Parameter Extraction Utilities for CAP Handlers
 *
 * Provides centralized extraction of OData filter parameters and primary keys
 * across req.data, req.params, req.query.SELECT.where, and raw OData $filter options.
 */

/**
 * Normalizes a raw where-clause token value to a clean string or primitive value.
 *
 * @param {any} val
 * @returns {string|any}
 */
function _normalizeValue(val) {
  if (val === undefined || val === null) return '';
  if (typeof val === 'object') {
    return val.val !== undefined ? String(val.val).trim() : (val.ref ? String(val.ref[0]).trim() : '');
  }
  return String(val).replace(/^['"]|['"]$/g, '').trim();
}

/**
 * Extracts a single filter parameter value from a CAP request.
 *
 * Checks in order:
 *  1. req.data[fieldName]
 *  2. req.params (as object { fieldName: val } or first primitive parameter)
 *  3. req.query.SELECT.where array
 *  4. Raw $filter string in req._queryOptions.$filter or req.req.url
 *
 * @param {import('@sap/cds').Request} req - The CAP request object
 * @param {string} fieldName - The parameter name to extract (e.g., 'Plant', 'Warehouse', 'OrderNo')
 * @returns {string|null} The extracted parameter value or null if not found
 */
function extractFilterParam(req, fieldName) {
  if (!req || !fieldName) return null;

  // 1. Direct payload in req.data
  if (req.data && req.data[fieldName] !== undefined && req.data[fieldName] !== null) {
    const s = String(req.data[fieldName]).trim();
    if (s !== '') return s;
  }

  // 2. Bound key parameters in req.params (e.g. ['0000000010'] or [{ SalesInquiry: '0000000010' }])
  if (Array.isArray(req.params) && req.params.length > 0) {
    const firstParam = req.params[0];
    if (firstParam && typeof firstParam === 'object' && firstParam[fieldName] !== undefined && firstParam[fieldName] !== null) {
      const s = String(firstParam[fieldName]).trim();
      if (s !== '') return s;
    } else if ((typeof firstParam === 'string' || typeof firstParam === 'number') && req.params.length === 1) {
      const s = String(firstParam).trim();
      if (s !== '') return s;
    }
  }

  // 3. CAP SELECT.where AST array
  const where = req.query?.SELECT?.where;
  if (Array.isArray(where)) {
    for (let i = 0; i < where.length; i++) {
      const token = where[i];
      const isMatch = (token === fieldName) || (token && typeof token === 'object' && token.ref && token.ref[0] === fieldName);
      if (isMatch && (where[i + 1] === '=' || where[i + 1] === '==') && where[i + 2] !== undefined) {
        const val = _normalizeValue(where[i + 2]);
        if (val !== '') return val;
      }
    }
  }

  // 4. Raw OData query option ($filter) or request URL fallback
  const rawFilter = req._queryOptions?.$filter || (req.req && req.req.url ? decodeURIComponent(req.req.url) : '');
  if (rawFilter) {
    const re = new RegExp(`${fieldName}\\s+eq\\s+['"]?([^'"&\\s)]+)['"]?`, 'i');
    const m = rawFilter.match(re);
    if (m && m[1]) return m[1].trim();
  }

  return null;
}

/**
 * Extracts multiple filter parameters from a CAP request in a single call.
 *
 * @param {import('@sap/cds').Request} req - The CAP request object
 * @param {string[]} fieldNames - List of parameter names to extract
 * @returns {Record<string, string>} An object mapping each fieldName to its extracted string value (or empty string if not found)
 */
function extractFilterParams(req, fieldNames) {
  const result = {};
  if (!Array.isArray(fieldNames)) return result;

  for (const field of fieldNames) {
    result[field] = extractFilterParam(req, field) || '';
  }
  return result;
}

/**
 * Applies pagination ($top, $skip) and @odata.count to an array of results based on req.query.
 *
 * @param {Array} items
 * @param {import('@sap/cds').Request} req
 * @returns {Array}
 */
function applyPaging(items, req) {
  if (!Array.isArray(items)) return items;

  const totalCount = items.$count !== undefined ? items.$count : items.length;

  const limitObj = req?.query?.SELECT?.limit;
  let rows = null;
  let offset = 0;

  if (limitObj) {
    if (limitObj.rows !== undefined) {
      rows = typeof limitObj.rows === 'object' && limitObj.rows !== null && 'val' in limitObj.rows
        ? Number(limitObj.rows.val)
        : Number(limitObj.rows);
    }
    if (limitObj.offset !== undefined) {
      offset = typeof limitObj.offset === 'object' && limitObj.offset !== null && 'val' in limitObj.offset
        ? Number(limitObj.offset.val)
        : Number(limitObj.offset);
    }
  }

  // Also check raw query options if limit was not in SELECT.limit
  if (rows === null && req?._queryOptions?.$top) {
    rows = parseInt(req._queryOptions.$top, 10);
  }
  if (!offset && req?._queryOptions?.$skip) {
    offset = parseInt(req._queryOptions.$skip, 10) || 0;
  }

  let result = items;
  if (rows !== null && !isNaN(rows) && rows >= 0) {
    const start = Math.max(0, offset || 0);
    result = items.slice(start, start + rows);
  } else if (offset > 0) {
    result = items.slice(offset);
  }

  // Preserve or set $count if count was requested or already present
  if (req?.query?.SELECT?.count || req?._queryOptions?.$count === 'true' || items.$count !== undefined) {
    result.$count = totalCount;
  }

  return result;
}

module.exports = {
  extractFilterParam,
  extractFilterParams,
  applyPaging
};
