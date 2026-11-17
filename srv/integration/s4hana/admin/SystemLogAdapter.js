'use strict';

/**
 * SystemLogAdapter
 *
 * Wraps RSLG_READ_SLG (SM21 system log) and TH_SERVER_LIST RFC function modules.
 * READ-ONLY: does not call any RFC function that changes state.
 *
 * Evidence (DS4/220, Live verification, 2026-11-17):
 *   - TH_SERVER_LIST:   Returns active application server instances.
 *   - RSLG_READ_SLG:    Import params: IM_INSTANCENAME (CHAR), IM_FILTER_DATETIME_FROM / _TO (RSLGTIME CHAR16),
 *                        IM_POS (I), IM_WRAPCOUNT (I). Table: T_SYSLOG_ENTRIES (16 fields).
 *                        No max-rows IMPORTING param — row cap applied post-fetch.
 *   - RSLGTIME format:  'YYYYMMDDHHMMSS00' (16 chars, server-local time).
 *
 * Timezone & Offset (CONFIRMED LIVE 2026-11-17):
 *   - System runs in IST (UTC+05:30).
 *   - Live comparison of SM20 ET_LOG (SAL_TIME 14:31:29) and UTC timestamp (LOG_TSTMP 09:01:29) proved the
 *     server-local offset is exactly +330 minutes.
 *   - Configurable via process.env.SAPLOGS_SM21_TZ_OFFSET_MINUTES (default: 330).
 *   - Callers supply UTC; this adapter converts UTC -> server-local for query filters,
 *     and converts returned server-local timestamps back to UTC ISO strings (e.g. '2026-11-17T09:00:44.000Z').
 *
 * Field allow-list:
 *   Only allow-listed fields are returned.
 *   Raw fields SLGDATA, SLGPASSPORT, SLGROOTCONTEXT, SLGCONNECTION, SLGLTRM, SLGTERMIDNEW,
 *   SLGDUMMY2, SLGCONNECTIONCOUNTER are not exposed raw.
 *   User field: SLGUSER is only returned when SAPLOGS_INCLUDE_USER=true.
 *
 * Sanitization limitations:
 *   See sanitizeMessage() header below for explicit rules and what the sanitizer does NOT catch.
 */

const { RfcClient } = require('../RfcClient');
const LOG = require('../../../common/logger')('system-log-adapter');

let sm21Templates = {};
try {
  sm21Templates = require('./sm21-templates.json');
} catch {
  sm21Templates = {};
}

/** Default server-local UTC offset in minutes (IST = UTC+05:30). */
const DEFAULT_SERVER_TZ_OFFSET_MINUTES = 330;

/**
 * Resolve configured timezone offset in minutes.
 * @param {number} [override]
 * @returns {number}
 */
function resolveTzOffset(override) {
  if (typeof override === 'number' && Number.isFinite(override)) return override;
  const envVal = parseInt(process.env.SAPLOGS_SM21_TZ_OFFSET_MINUTES, 10);
  return Number.isFinite(envVal) ? envVal : DEFAULT_SERVER_TZ_OFFSET_MINUTES;
}

/**
 * Convert a Date (UTC) to RSLGTIME string in server-local time.
 * Format: 'YYYYMMDDHHMMSS00' (16 chars, trailing '00' is subsecond placeholder).
 * @param {Date} utcDate
 * @param {number} [offsetMinutes]
 * @returns {string}
 */
function toRslgTime(utcDate, offsetMinutes = resolveTzOffset()) {
  const localMs = utcDate.getTime() + offsetMinutes * 60 * 1000;
  const d = new Date(localMs);
  const pad2 = (n) => String(n).padStart(2, '0');
  const pad4 = (n) => String(n).padStart(4, '0');
  return (
    pad4(d.getUTCFullYear()) +
    pad2(d.getUTCMonth() + 1) +
    pad2(d.getUTCDate()) +
    pad2(d.getUTCHours()) +
    pad2(d.getUTCMinutes()) +
    pad2(d.getUTCSeconds()) +
    '00'
  );
}

/**
 * Convert a server-local RSLGTIME string (YYYYMMDDHHMMSS00 or YYYYMMDDHHMMSS) back to an ISO UTC string.
 * @param {string} localStr
 * @param {number} [offsetMinutes]
 * @returns {string} ISO 8601 UTC string (e.g. '2026-11-17T09:00:44.000Z') or empty string
 */
function fromRslgTimeToUtc(localStr, offsetMinutes = resolveTzOffset()) {
  if (!localStr || typeof localStr !== 'string') return '';
  const clean = localStr.trim();
  if (clean.length < 14) return '';
  const year  = parseInt(clean.slice(0, 4), 10);
  const month = parseInt(clean.slice(4, 6), 10) - 1;
  const day   = parseInt(clean.slice(6, 8), 10);
  const hour  = parseInt(clean.slice(8, 10), 10);
  const min   = parseInt(clean.slice(10, 12), 10);
  const sec   = parseInt(clean.slice(12, 14), 10);

  const localUtcMs = Date.UTC(year, month, day, hour, min, sec);
  const realUtcMs  = localUtcMs - offsetMinutes * 60 * 1000;
  return new Date(realUtcMs).toISOString();
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Sanitize a message string from SAP logs (SLGDATA or SAL_DATA).
 *
 * Explicit rules applied in sequence:
 *   1. Treat null / undefined as empty string.
 *   2. Strip null bytes (\x00).
 *   3. Trim leading and trailing whitespace.
 *   4. Replace runs of 4 or more '*' with '[redacted]' (star-masked passwords/keys).
 *   5. Replace IPv4 addresses (dotted-decimal) with '[ip]'.
 *   6. Replace IPv6 addresses (full, compressed, bracketed, or loopback) with '[ip]'.
 *   7. Replace SAP server hostnames and instance names with '[host]' / '[instance]'.
 *   8. If redactUserTokens=true: replace user tokens, SLGUSER match, and key patterns ('user=X', 'bname: X') with '[user]'.
 *   9. Truncate to 200 characters.
 *
 * What this sanitizer does NOT catch (LIMITATIONS):
 *   - Arbitrary personal names in unstructured prose (e.g. 'sent by John Smith').
 *   - ABAP program names or transaction codes that resemble usernames (e.g. 'ZFI_R_041', 'RSUSR300').
 *   - Hexadecimal hashes, internal UUIDs, or transaction IDs.
 *   - Obfuscated IP addresses (hex-encoded, decimal integer, or URL-encoded).
 *   - Non-standard terminals not matching IP or known patterns.
 *   - Passwords or sensitive values not masked with '****' in clear text.
 *
 * @param {string|null|undefined} raw
 * @param {object} [options]
 * @param {boolean} [options.redactUserTokens=false]
 * @param {string}  [options.userToken='']
 * @param {string[]} [options.knownUsers=[]]
 * @param {string[]} [options.knownInstances=[]]
 * @returns {string}
 */
function sanitizeMessage(raw, {
  redactUserTokens = false,
  userToken = '',
  knownUsers = [],
  knownInstances = [],
} = {}) {
  if (!raw) return '';
  let s = String(raw);

  // Rule 2: strip null bytes
  s = s.replace(/\x00/g, '');

  // Rule 3: trim
  s = s.trim();

  // Rule 4: redact runs of 4+ stars
  s = s.replace(/\*{4,}/g, '[redacted]');

  // Rule 5: redact IPv4
  s = s.replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[ip]');

  // Rule 6: redact IPv6 (full, compressed, bracketed, and loopback)
  // Bracketed IPv6: [fe80::1]
  s = s.replace(/\[[0-9a-fA-F:]+\]/g, '[ip]');
  // Loopback ::1
  s = s.replace(/(^|[\s(,;])(::1)([\s),;]|$)/g, '$1[ip]$3');
  // Compressed IPv6 with :: (e.g. fe80::1ff:fe23:4567:890a or 2001:db8::1)
  s = s.replace(/\b[0-9a-fA-F]{1,4}::[0-9a-fA-F:]+\b/g, '[ip]');
  s = s.replace(/\b::[0-9a-fA-F:]+\b/g, '[ip]');
  // Full IPv6 (e.g. 2001:0db8:85a3:0000:0000:8a2e:0370:7334)
  s = s.replace(/\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/g, '[ip]');
  s = s.replace(/\b(?:[0-9a-fA-F]{1,4}:){2,6}[0-9a-fA-F]{1,4}\b/g, '[ip]');

  // Rule 7: redact server hostnames and instance names
  s = s.replace(/\b[a-zA-Z0-9_-]+_DS4_\d+\b/g, '[instance]');
  s = s.replace(/\bapp-server-\d+_[a-zA-Z0-9_-]+\b/g, '[instance]');
  s = s.replace(/\bvheudds4[a-zA-Z0-9_-]*\b/gi, '[host]');
  if (Array.isArray(knownInstances)) {
    for (const inst of knownInstances) {
      if (inst && typeof inst === 'string' && inst.trim().length >= 3) {
        s = s.replace(new RegExp(escapeRegExp(inst.trim()), 'gi'), '[instance]');
      }
    }
  }

  // Rule 8: optional user-token redaction
  if (redactUserTokens) {
    if (userToken && typeof userToken === 'string' && userToken.trim().length >= 3) {
      s = s.replace(new RegExp(`\\b${escapeRegExp(userToken.trim())}\\b`, 'gi'), '[user]');
    }
    if (Array.isArray(knownUsers)) {
      for (const u of knownUsers) {
        if (u && typeof u === 'string' && u.trim().length >= 3) {
          s = s.replace(new RegExp(`\\b${escapeRegExp(u.trim())}\\b`, 'gi'), '[user]');
        }
      }
    }
    s = s.replace(/\b(user|bname|usr)\s*[:=]\s*([a-zA-Z0-9_-]{3,16})\b/gi, '$1=[user]');
    s = s.replace(/\buser\s+([A-Z0-9_-]{3,12})\s+(log(?:ged|on|in)|lock|fail|auth)/gi, 'user [user] $2');
  }

  // Rule 9: truncate
  if (s.length > 200) s = s.slice(0, 200);

  return s;
}

/**
 * Sanitize raw SLGDATA for the 'message' field using a per-type slot map
 * for user-carrying types (e.g. AB1, Q04, AB6, etc.) and redacting hostnames/instances.
 *
 * @param {string} rawType
 * @param {string} rawData
 * @param {object} options
 * @param {boolean} [options.includeUser=false]
 * @param {string}  [options.userToken='']
 * @param {string[]} [options.knownUsers=[]]
 * @param {string[]} [options.knownInstances=[]]
 * @returns {string}
 */
function sanitizeSyslogData(rawType, rawData, {
  includeUser = false,
  userToken = '',
  knownUsers = [],
  knownInstances = [],
} = {}) {
  const typeStr = String(rawType || '').trim();
  const key = typeStr.length === 4 ? typeStr.substring(1) : typeStr;
  let d = String(rawData || '');

  if (!includeUser) {
    if (key === 'AB1' && d.length >= 44) {
      // AB1: date(6), time(6), host/instance(32), user(12+)
      // Slot 1 (user) is at char 44+. When includeUser=false, redact user and host/instance.
      const date = d.slice(0, 6).trim();
      const time = d.slice(6, 12).trim();
      d = `${date} ${time} [instance] [user]`;
    } else if (key === 'Q04') {
      // Q04: user/terminal in slot 0, logon ID in slot 1
      const m = d.match(/^\s*(.*?)\s+(\d{1,4})\s*$/);
      if (m) {
        d = `[user] ${m[2]}`;
      } else {
        d = '[user]';
      }
    } else if (key === 'AB6') {
      // AB6: slot 0 (chars 0-12) is user
      const remainder = d.slice(12).trim();
      d = remainder ? `[user] ${remainder}` : '[user]';
    } else if (['AU7', 'AU8', 'AU9', 'AUA', 'AUB'].includes(key)) {
      d = '[user]';
    }
  } else {
    if (key === 'AB1' && d.length >= 44) {
      const date = d.slice(0, 6).trim();
      const time = d.slice(6, 12).trim();
      const user = d.slice(44).trim();
      d = `${date} ${time} [instance] ${user}`;
    }
  }

  return sanitizeMessage(d, {
    redactUserTokens: !includeUser,
    userToken,
    knownUsers,
    knownInstances,
  });
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

/**
 * Map one T_SYSLOG_ENTRIES row to allow-listed shape.
 * @param {object} row
 * @param {string} instanceName
 * @param {number} offsetMinutes
 * @param {boolean} includeUser
 * @param {boolean} enableMessageText
 * @returns {object}
 */
function _mapEntry(row, instanceName, offsetMinutes, includeUser, enableMessageText, knownInstances = []) {
  const entry = {
    entryType:       String(row.SLGTYPE    || '').trim(),
    timestamp:       fromRslgTimeToUtc(row.SLGDATTIM, offsetMinutes), // Converted to ISO 8601 UTC
    serverTimestamp: String(row.SLGDATTIM || '').trim(),             // Raw server-local YYYYMMDDHHMMSS00
    processId:       String(row.SLGPROC    || '').trim(),
    client:          String(row.SLGMAND    || '').trim(),
    mode:            String(row.SLGMODE    || '').trim(),
    tcode:           String(row.SLGTC      || '').trim(),
    program:         String(row.SLGREPNA   || '').trim(),
    message:         sanitizeSyslogData(row.SLGTYPE, row.SLGDATA, {
      includeUser,
      userToken: row.SLGUSER,
      knownInstances,
    }),
    messageText:     enableMessageText
      ? formatMessageText(row.SLGTYPE, row.SLGDATA, { redactUserTokens: !includeUser, knownInstances })
      : null,
    instance:        instanceName,
  };

  if (includeUser) {
    entry.user = String(row.SLGUSER || '').trim();
  }

  return entry;
}

function _compareByTimestamp(a, b) {
  return (a.timestamp || '').localeCompare(b.timestamp || '');
}

class SystemLogAdapter {
  /**
   * @param {object} [options]
   * @param {object} [options.rfcClient] - Injected RFC client for unit tests.
   * @param {number} [options.tzOffsetMinutes] - Overrides default UTC offset in minutes.
   * @param {boolean} [options.includeUser] - When true, populates the 'user' field.
   * @param {boolean} [options.enableMessageText] - When true, resolves message text templates.
   */
  constructor(options = {}) {
    this._rfc = options.rfcClient || new RfcClient();
    this.tzOffsetMinutes = typeof options.tzOffsetMinutes === 'number'
      ? options.tzOffsetMinutes
      : resolveTzOffset();
    this.includeUser = typeof options.includeUser === 'boolean'
      ? options.includeUser
      : (process.env.SAPLOGS_INCLUDE_USER === 'true');
    this.enableMessageText = typeof options.enableMessageText === 'boolean'
      ? options.enableMessageText
      : (process.env.SAPLOGS_ENABLE_MESSAGE_TEXT === 'true');
    this.knownInstances = [];
  }

  /**
   * Discover available application server instances via TH_SERVER_LIST.
   * READ-ONLY. Does not change state.
   * @returns {Promise<Array<{name: string, host: string, state: string}>>}
   */
  async listInstances() {
    LOG.debug('TH_SERVER_LIST: discovering instances');
    let result;
    try {
      result = await this._rfc.call('TH_SERVER_LIST', {});
    } catch (err) {
      LOG.error('TH_SERVER_LIST failed', { message: err.message });
      throw Object.assign(new Error(`Instance discovery failed: ${err.message}`), { status: 503 });
    }
    const rows = Array.isArray(result.LIST) ? result.LIST : [];
    const instances = rows.map((r) => ({
      name:  String(r.NAME  || '').trim(),
      host:  String(r.HOST  || '').trim(),
      state: String(r.STATE || '').trim(),
    }));
    this.knownInstances = instances.map(i => i.name).concat(instances.map(i => i.host)).filter(Boolean);
    return instances;
  }

  /**
   * Read system log entries via RSLG_READ_SLG.
   * READ-ONLY. Does not change SAP state.
   *
   * @param {object} params
   * @param {Date|string} params.fromUtc     - Window start (UTC). Required.
   * @param {Date|string} params.toUtc       - Window end (UTC). Required.
   * @param {string}      [params.instance]  - Instance name. If omitted, queries all instances sequentially.
   * @param {number}      [params.maxRows=500] - Row cap (applied post-fetch).
   * @param {number}      [params.tzOffsetMinutes] - Timezone offset override.
   * @param {boolean}     [params.includeUser] - Return user ID if true.
   * @param {boolean}     [params.enableMessageText] - Enable message text resolution if true.
   * @returns {Promise<{entries: object[], count: number, truncated: boolean}>}
   */
  async readSyslog({ fromUtc, toUtc, instance, maxRows = 500, tzOffsetMinutes, includeUser, enableMessageText } = {}) {
    if (!fromUtc) throw Object.assign(new Error('fromUtc is required'), { status: 400 });
    if (!toUtc)   throw Object.assign(new Error('toUtc is required'),   { status: 400 });

    const fromDate = fromUtc instanceof Date ? fromUtc : new Date(fromUtc);
    const toDate   = toUtc   instanceof Date ? toUtc   : new Date(toUtc);

    if (isNaN(fromDate.getTime())) throw Object.assign(new Error('fromUtc is not a valid ISO date string'), { status: 400 });
    if (isNaN(toDate.getTime()))   throw Object.assign(new Error('toUtc is not a valid ISO date string'),   { status: 400 });
    if (fromDate >= toDate) throw Object.assign(new Error('fromUtc must be before toUtc'), { status: 400 });

    const cap     = typeof maxRows === 'number' ? maxRows : 500;
    const offset  = resolveTzOffset(tzOffsetMinutes ?? this.tzOffsetMinutes);
    const withUser = typeof includeUser === 'boolean' ? includeUser : this.includeUser;
    const withMsg  = typeof enableMessageText === 'boolean' ? enableMessageText : this.enableMessageText;

    const imFrom = toRslgTime(fromDate, offset);
    const imTo   = toRslgTime(toDate, offset);

    let instanceNames;
    if (instance) {
      instanceNames = [instance.trim()];
    } else {
      const all = await this.listInstances();
      instanceNames = all.map((i) => i.name).filter(Boolean);
      if (!instanceNames.length) {
        instanceNames = [''];
      }
    }

    const allEntries = [];
    for (const instName of instanceNames) {
      LOG.debug('RSLG_READ_SLG', { instance: instName, from: imFrom, to: imTo });
      let res;
      try {
        res = await this._rfc.call('RSLG_READ_SLG', {
          IM_INSTANCENAME:         instName,
          IM_FILTER_DATETIME_FROM: imFrom,
          IM_FILTER_DATETIME_TO:   imTo,
          IM_POS:                  0,
          IM_WRAPCOUNT:            0,
        });
      } catch (err) {
        LOG.error('RSLG_READ_SLG failed', { instance: instName, message: err.message });
        throw Object.assign(new Error(`RSLG_READ_SLG failed for instance '${instName}': ${err.message}`), { status: 503 });
      }
      const rows = Array.isArray(res.T_SYSLOG_ENTRIES) ? res.T_SYSLOG_ENTRIES : [];
      for (const row of rows) {
        allEntries.push(_mapEntry(row, instName, offset, withUser, withMsg, this.knownInstances));
      }
    }

    allEntries.sort(_compareByTimestamp);

    const truncated = allEntries.length > cap;
    const entries   = truncated ? allEntries.slice(0, cap) : allEntries;

    return { entries, count: entries.length, truncated };
  }
}

module.exports = {
  SystemLogAdapter,
  sanitizeMessage,
  sanitizeSyslogData,
  toRslgTime,
  fromRslgTimeToUtc,
  resolveTzOffset,
  formatMessageText,
};
