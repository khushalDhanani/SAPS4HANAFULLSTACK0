const LEAN_ORDER_PATH = '/sap/opu/odata/sap/LORD_ODATA_ORDER_SRV';

/**
 * Header extension values for LORD_ODATA_ORDER_SRV (incompletion procedure Z1 and partner function ZP),
 * keyed by the property names agreed for the Header extension. The standard service has none of them;
 * each is sent only when the live $metadata of the service exposes the property, so the application works
 * unchanged before and after the SAP-side extension. See docs/sap-inquiry-service-extension-spec.md.
 */
const INQUIRY_EXTENSION_FIELDS = ['CustomerGroup2', 'PortOfLoading', 'PortOfDischarge', 'ContactPerson', 'BindingPeriodValidityEndDate', 'Incoterms', 'IncotermsLocation1', 'INCO1', 'INCO2', 'INCO2_L', 'Inco1', 'Inco2'];

/**
 * Formats a Date instance or ISO string to OData v2 Edm.DateTime JSON representation (/Date(ms)/).
 */
function _formatODataV2Date(dateVal) {
  if (!dateVal) return undefined;
  if (typeof dateVal === 'string' && dateVal.startsWith('/Date(')) return dateVal;
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return undefined;
  return `/Date(${d.getTime()})/`;
}

/**
 * Formats a primitive or date value as an OData v2 literal in $filter.
 *
 * @param {any} val
 * @returns {string}
 */
function _formatODataV2Literal(val) {
  if (val === null || val === undefined) return 'null';
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  if (typeof val === 'number') return String(val);
  if (val instanceof Date) {
    return `datetime'${val.toISOString().slice(0, 19)}'`;
  }
  const s = String(val);
  if (/^\/Date\(\d+\)\/$/.test(s)) return s;
  return `'${s.replace(/'/g, "''")}'`;
}

/**
 * Translates CAP CQN order-by clause to an OData v2 $orderby string.
 *
 * @param {any} orderBy
 * @returns {string}
 */
function _cqnOrderByToOData(orderBy) {
  if (!orderBy) return '';
  if (typeof orderBy === 'string') return orderBy.trim();
  if (Array.isArray(orderBy) && orderBy.length > 0) {
    const parts = orderBy.map(item => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object') {
        const col = item.ref ? item.ref[item.ref.length - 1] : (item.val || '');
        const dir = item.sort ? ` ${item.sort}` : '';
        return `${col}${dir}`.trim();
      }
      return '';
    }).filter(Boolean);
    return parts.join(', ');
  }
  return '';
}

/**
 * Translates CAP CQN where clause to an OData v2 $filter expression string.
 *
 * @param {any} where
 * @returns {string}
 */
function _cqnWhereToODataFilter(where) {
  if (!where) return '';
  if (typeof where === 'string') return where.trim();

  // Plain object dictionary: { Field1: 'val1', Field2: 'val2' }
  if (where && typeof where === 'object' && !Array.isArray(where)) {
    if (where.ref || 'val' in where || where.func) {
      where = [where];
    } else {
      const parts = Object.entries(where)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${k} eq ${_formatODataV2Literal(v)}`);
      return parts.join(' and ');
    }
  }

  if (!Array.isArray(where) || where.length === 0) return '';

  const opMap = {
    '=': 'eq',
    '==': 'eq',
    '!=': 'ne',
    '<>': 'ne',
    '>': 'gt',
    '>=': 'ge',
    '<': 'lt',
    '<=': 'le',
    'and': 'and',
    'AND': 'and',
    'or': 'or',
    'OR': 'or',
    'not': 'not',
    'NOT': 'not'
  };

  const tokens = [];

  for (let i = 0; i < where.length; i++) {
    const token = where[i];

    if (token === null || token === undefined) continue;

    if (token === '(' || token === ')') {
      tokens.push(token);
      continue;
    }

    if (typeof token === 'string') {
      const lower = token.toLowerCase();
      if (opMap[token] || opMap[lower]) {
        tokens.push(opMap[token] || opMap[lower]);
      } else {
        tokens.push(token);
      }
      continue;
    }

    if (typeof token === 'object' && token.ref && Array.isArray(token.ref)) {
      let refPath = token.ref;
      if (refPath.length > 1 && (refPath[0] === 'SalesOrders' || refPath[0] === 'C_SalesOrderWl_F1873' || refPath[0] === 'externalSO.C_SalesOrderWl_F1873')) {
        refPath = refPath.slice(1);
      }
      tokens.push(refPath.join('/'));
      continue;
    }

    if (typeof token === 'object' && 'val' in token) {
      tokens.push(_formatODataV2Literal(token.val));
      continue;
    }

    if (typeof token === 'object' && token.func && Array.isArray(token.args)) {
      const fnName = String(token.func).toLowerCase();
      const argTokens = token.args.map(a => {
        if (typeof a === 'object') {
          if (a.ref) {
            let p = a.ref;
            if (p.length > 1 && (p[0] === 'SalesOrders' || p[0] === 'C_SalesOrderWl_F1873')) p = p.slice(1);
            return p.join('/');
          }
          if ('val' in a) return _formatODataV2Literal(a.val);
        }
        if (typeof a === 'string') return _formatODataV2Literal(a);
        return String(a);
      });

      if (fnName === 'contains') {
        tokens.push(`substringof(${argTokens[1]}, ${argTokens[0]})`);
      } else if (fnName === 'substringof') {
        tokens.push(`substringof(${argTokens.join(', ')})`);
      } else if (fnName === 'startswith') {
        tokens.push(`startswith(${argTokens.join(', ')})`);
      } else if (fnName === 'endswith') {
        tokens.push(`endswith(${argTokens.join(', ')})`);
      } else {
        tokens.push(`${fnName}(${argTokens.join(', ')})`);
      }
      continue;
    }

    if (Array.isArray(token)) {
      const sub = _cqnWhereToODataFilter(token);
      if (sub) {
        tokens.push(`(${sub})`);
      }
      continue;
    }

    if (typeof token === 'number' || typeof token === 'boolean') {
      tokens.push(String(token));
      continue;
    }
  }

  let filterStr = tokens.join(' ');
  filterStr = filterStr.replace(/\(\s+/g, '(').replace(/\s+\)/g, ')');
  filterStr = filterStr.replace(/\s+/g, ' ').trim();

  return filterStr;
}

module.exports = {
  LEAN_ORDER_PATH,
  INQUIRY_EXTENSION_FIELDS,
  _formatODataV2Date,
  _formatODataV2Literal,
  _cqnOrderByToOData,
  _cqnWhereToODataFilter
};
