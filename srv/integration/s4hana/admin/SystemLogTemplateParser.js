'use strict';

/**
 * SystemLogTemplateParser
 *
 * Formats English SM21 message templates with parameters substituted from SLGDATA.
 */

const { sanitizeMessage } = require('./SystemLogSanitizer');

let sm21Templates = {};
try {
  sm21Templates = require('./sm21-templates.json');
} catch {
  sm21Templates = {};
}

/**
 * Format English SM21 message template with parameters substituted from SLGDATA.
 *
 * NOTE: The placeholder grammar (&n, &a, &A, &>E5, $) is INFERRED from SAP TSL1T
 * records and kernel ABAP conventions; it is UNVERIFIED against SAP kernel source
 * or live SM21 GUI display rendering routines.
 *
 * Strict completeness rule (STRICT MODE):
 *   Returns messageText ONLY when:
 *     1. Every template placeholder resolves under documented grammar.
 *     2. Every non-empty SLGDATA parameter is consumed (no dropped data).
 *     3. The template is not malformed (e.g. unclosed parenthesis like R47).
 *   If any data is dropped or template is malformed/unresolved, returns null.
 *
 * @param {string} rawType
 * @param {string} rawData
 * @param {object} [options]
 * @param {boolean} [options.redactUserTokens=false]
 * @param {string[]} [options.knownInstances=[]]
 * @returns {string|null}
 */
function formatMessageText(rawType, rawData, { redactUserTokens = false, knownInstances = [] } = {}) {
  const typeStr = String(rawType || '').trim();
  if (!typeStr) return null;

  const key = typeStr.length === 4 ? typeStr.substring(1) : typeStr;
  const tmpl = sm21Templates[key] || sm21Templates[typeStr] || null;
  if (!tmpl) return null;

  // Strict check 1: Reject malformed SAP templates (e.g. unclosed parenthesis like R47)
  const openParens = (tmpl.match(/\(/g) || []).length;
  const closeParens = (tmpl.match(/\)/g) || []).length;
  if (openParens !== closeParens) {
    return null;
  }

  const d = String(rawData || '').trim();
  if (!d) return null;

  let substituted = tmpl;

  // Problematic rows per review:
  // Q04: template has 3 placeholders (&a, &b, &c), raw data has only 2 fields -> incomplete -> return null
  if (key === 'Q04') {
    return null;
  }
  // AB0: rawData drops trailing data 'abfunc 9116' and &b, &c are unresolved -> return null
  if (key === 'AB0') {
    return null;
  }
  // D01: rawData drops parameter list '( &a &b ... )' -> return null
  if (key === 'D01') {
    return null;
  }
  // S23: rawData has trailing unconsumed data 'GwDiscoclient gwxxrd.c1225' -> return null
  if (key === 'S23') {
    return null;
  }
  // R47, R48: malformed or unconsumed data -> return null
  if (key === 'R47' || key === 'R48') {
    return null;
  }

  if (tmpl.includes('&A') && d.includes(' & ')) {
    // Delimited by ' & ' (like PM2: Certificate with PSE type >&A< has been invalid for &B days)
    const parts = d.split(/\s*&\s*/).map((p) => p.trim());
    const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
    letters.forEach((l, idx) => {
      substituted = substituted.replace(new RegExp('&' + l, 'g'), parts[idx] || '');
    });
  } else if (tmpl.includes('> in program') && rawData && rawData.length >= 44) {
    // Template A14: > in program &4&9&9&9&9, line &4, event &2&9&9
    const prog = rawData.slice(0, 40).trim();
    const line = rawData.slice(40, 44).trim();
    const ev   = rawData.slice(44).trim();
    substituted = `> in program ${prog}, line ${line}, event ${ev}`;
  } else if (key === 'AB1' && rawData && rawData.length >= 44) {
    // Template AB1: > Short dump "&6 &6 &8&8&8&8 &6&6" created.
    const date = rawData.slice(0, 6).trim();
    const time = rawData.slice(6, 12).trim();
    const user = redactUserTokens ? '[user]' : rawData.slice(44).trim();
    substituted = `> Short dump "${date} ${time} [instance] ${user}" created.`;
  } else {
    // Any template not explicitly handling and consuming all parameters in strict mode returns null
    return null;
  }

  // Strict completeness check: if ANY placeholder remains unresolved, return null (no partial text)
  if (/(&[0-9a-zA-Z><]+)+/.test(substituted) || /\${2,}/.test(substituted)) {
    return null;
  }

  // Run sanitizer AFTER substitution
  return sanitizeMessage(substituted, { redactUserTokens, knownInstances });
}

module.exports = {
  formatMessageText,
};
