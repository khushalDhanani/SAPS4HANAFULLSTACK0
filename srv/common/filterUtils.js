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

/**
 * Formats a value as an OData string literal (Edm.String).
 * Encloses the value in single quotes and escapes embedded single quotes by doubling them (' -> '').
 *
 * @param {any} val - The input value to format as an OData string literal
 * @returns {string} The escaped OData string literal, e.g. "'O''Neill'"
 */
function odataString(val) {
  if (val === undefined || val === null) return "''";
  return `'${String(val).replace(/'/g, "''")}'`;
}

const COMPARE = {
  '=': (a, b) => _eq(a, b),
  '==': (a, b) => _eq(a, b),
  '!=': (a, b) => !_eq(a, b),
  '<>': (a, b) => !_eq(a, b),
  '<': (a, b) => _cmp(a, b) < 0,
  '<=': (a, b) => _cmp(a, b) <= 0,
  '>': (a, b) => _cmp(a, b) > 0,
  '>=': (a, b) => _cmp(a, b) >= 0
};

function _eq(a, b) {
  const aNull = a === null || a === undefined;
  const bNull = b === null || b === undefined;
  if (aNull || bNull) return aNull && bNull;
  return String(a) === String(b);
}

function _cmp(a, b) {
  const na = Number(a), nb = Number(b);
  if (!isNaN(na) && !isNaN(nb) && String(a).trim() !== '' && String(b).trim() !== '') return na - nb;
  return String(a).localeCompare(String(b));
}

const _str = (v) => (v === null || v === undefined) ? '' : String(v);
const BOOLEAN_FUNCS = new Set(['contains', 'substringof', 'startswith', 'endswith']);

/** Compiles one CQN operand (ref / val / func) to a row accessor. Unknown constructs yield undefined. */
function _operand(token) {
  if (token === null || token === undefined) return () => undefined;
  if (typeof token !== 'object') return () => token;
  if (Array.isArray(token.ref)) {
    const field = token.ref[token.ref.length - 1];
    return (row) => row ? row[field] : undefined;
  }
  if ('val' in token) return () => token.val;
  if (token.func && Array.isArray(token.args)) {
    const name = String(token.func).toLowerCase();
    const args = token.args.map(_operand);
    switch (name) {
      case 'contains': return (row) => _str(args[0](row)).toLowerCase().includes(_str(args[1](row)).toLowerCase());
      case 'substringof': return (row) => _str(args[1](row)).toLowerCase().includes(_str(args[0](row)).toLowerCase());
      case 'startswith': return (row) => _str(args[0](row)).toLowerCase().startsWith(_str(args[1](row)).toLowerCase());
      case 'endswith': return (row) => _str(args[0](row)).toLowerCase().endsWith(_str(args[1](row)).toLowerCase());
      case 'tolower': return (row) => _str(args[0](row)).toLowerCase();
      case 'toupper': return (row) => _str(args[0](row)).toUpperCase();
      case 'trim': return (row) => _str(args[0](row)).trim();
      default: return () => undefined;
    }
  }
  return () => undefined;
}

/**
 * Compiles a CQN where token list to a predicate. Precedence: or < and < not < comparison.
 * A construct this evaluator does not know never hides a row (it evaluates to true).
 */
function _compileWhere(tokens) {
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  const isWord = (t, w) => typeof t === 'string' && t.toLowerCase() === w;

  function parseOr() {
    let left = parseAnd();
    while (isWord(peek(), 'or')) {
      next();
      const l = left, r = parseAnd();
      left = (row) => l(row) || r(row);
    }
    return left;
  }
  function parseAnd() {
    let left = parseNot();
    while (isWord(peek(), 'and')) {
      next();
      const l = left, r = parseNot();
      left = (row) => l(row) && r(row);
    }
    return left;
  }
  function parseNot() {
    if (isWord(peek(), 'not')) {
      next();
      const e = parseNot();
      return (row) => !e(row);
    }
    return parsePrimary();
  }
  function parsePrimary() {
    const t = next();
    if (t === undefined) return () => true;
    if (isWord(t, '(')) {
      const e = parseOr();
      if (isWord(peek(), ')')) next();
      return e;
    }
    if (Array.isArray(t)) return _compileWhere(t);
    if (t && typeof t === 'object' && Array.isArray(t.xpr)) return _compileWhere(t.xpr);
    const left = _operand(t);
    const op = peek();
    if (typeof op === 'string' && COMPARE[op.toLowerCase()]) {
      next();
      const right = _operand(next());
      const cmp = COMPARE[op.toLowerCase()];
      return (row) => cmp(left(row), right(row));
    }
    if (isWord(op, 'is')) {
      next();
      let negate = false;
      if (isWord(peek(), 'not')) { next(); negate = true; }
      if (isWord(peek(), 'null')) next();
      return (row) => { const v = left(row); const isNull = v === null || v === undefined; return negate ? !isNull : isNull; };
    }
    // A boolean function standing alone (contains / startswith / ...); any other function is unknown here.
    if (t && typeof t === 'object' && t.func) {
      return BOOLEAN_FUNCS.has(String(t.func).toLowerCase()) ? (row) => Boolean(left(row)) : () => true;
    }
    return () => true;
  }
  return parseOr();
}

/**
 * Applies a CAP CQN where clause (req.query.SELECT.where) to rows already in memory.
 * Used by value helps that read whole SAP tables via RFC, where SAP itself cannot apply the OData
 * $filter. contains / startswith / endswith compare case-insensitively, as SAP does.
 *
 * @param {Array<Object>} items
 * @param {Array} [where] - CQN where tokens
 * @returns {Array<Object>} the matching rows (the same array when there is nothing to filter)
 */
function applyWhere(items, where) {
  if (!Array.isArray(items) || !Array.isArray(where) || where.length === 0) return items;
  const pred = _compileWhere(where);
  return items.filter((row) => pred(row));
}

module.exports = {
  extractFilterParam,
  extractFilterParams,
  applyPaging,
  applyWhere,
  odataString
};
