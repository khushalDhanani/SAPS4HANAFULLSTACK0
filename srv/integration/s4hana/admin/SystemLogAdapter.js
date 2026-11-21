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
 * Field allow-list:
 *   Only allow-listed fields are returned.
 *   Raw fields SLGDATA, SLGPASSPORT, SLGROOTCONTEXT, SLGCONNECTION, SLGLTRM, SLGTERMIDNEW,
 *   SLGDUMMY2, SLGCONNECTIONCOUNTER are not exposed raw.
 *   User field: SLGUSER is only returned when SAPLOGS_INCLUDE_USER=true.
 */

const { RfcClient } = require('../RfcClient');
const LOG = require('../../../common/logger')('system-log-adapter');

const {
  resolveTzOffset,
  toRslgTime,
  fromRslgTimeToUtc,
} = require('./SystemLogTimeUtil');

const {
  sanitizeMessage,
  sanitizeSyslogData,
} = require('./SystemLogSanitizer');

const {
  formatMessageText,
} = require('./SystemLogTemplateParser');

/**
 * Map one T_SYSLOG_ENTRIES row to allow-listed shape.
 * @param {object} row
 * @param {string} instanceName
 * @param {number} offsetMinutes
 * @param {boolean} includeUser
 * @param {boolean} enableMessageText
 * @param {string[]} knownInstances
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
