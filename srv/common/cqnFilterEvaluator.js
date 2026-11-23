'use strict';

/**
 * In-Memory CQN Where-Clause Evaluator
 *
 * Compiles and evaluates CAP CQN where clause tokens (req.query.SELECT.where)
 * against in-memory JavaScript objects/records.
 * Used by value helps and RFC-backed data adapters where SAP cannot apply
 * OData $filter expressions natively.
 */

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

/**
 * Compiles one CQN operand (ref / val / func) to a row accessor.
 * Unknown constructs yield undefined.
 *
 * @param {any} token
 * @returns {(row: any) => any}
 */
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
 * Compiles a CQN where token list to a predicate function.
 * Precedence: or < and < not < comparison.
 * A construct this evaluator does not know never hides a row (evaluates to true).
 *
 * @param {Array} tokens
 * @returns {(row: any) => boolean}
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
  applyWhere,
  compileWhere: _compileWhere
};
