'use strict';

/**
 * SecurityAuditLogAdapter
 *
 * Wraps RSAU_API_GET_LOG_DATA (SM20 security audit log) RFC function module.
 * READ-ONLY: does not call any RFC function that changes state.
 *
 * Evidence (DS4/220, Live verification, 2026-11-17):
 *   - RSAU_API_GET_LOG_DATA:  IS_INTERVAL {DAT_FROM, DAT_TO, TIM_FROM, TIM_TO} (DATS/TIMS strings).
 *                              ID_FILE_SEL_SIMPLE='X' required to open log files.
 *                              ET_LOG (38 fields, local-time rows; confirmed LOG_TSTMP is UTC decimal timestamp),
 *                              ET_LOG_UTC (UTC rows; empty on this system when audit log is local-file based).
 *                              ET_RETURN: array of BAPIRET2-style messages.
 *                              No max-rows IMPORTING param — row cap applied post-fetch.
 *   - Server Timezone: IST (+330 minutes).
 *
 * Fallback behavior (ET_LOG_UTC empty):
 *   - If rejectOnFallback=true (or SAPLOGS_SM20_REJECT_ON_FALLBACK=true): rejects with HTTP 502 error.
 *   - Otherwise: converts local date/time from ET_LOG to UTC using SAPLOGS_SM20_TZ_OFFSET_MINUTES (default 330),
 *     and appends an explanatory notice to the response warnings array.
 *
 * User field & Privacy:
 *   - User field SLGUSER is ONLY returned when includeUser=true (or SAPLOGS_INCLUDE_USER=true).
 *   - User filter is supported via IT_USER range table.
 *
 * Field allow-list:
 *   Excluded: USERALIAS, SMTP_ADDR, SLGLTRM2, TERM_IPV6, X_STRING, PARAM1-3, PARAMX, EPP, SRC,
 *   MFD_FLAG, ALERT_FLAG, CTAB, raw SAL_DATA, CLASS, COUNTER, FILE_NO.
 *   SLGUSER excluded when includeUser=false.
 */

const { RfcClient }       = require('../RfcClient');
const { sanitizeMessage } = require('./SystemLogAdapter');
const LOG = require('../../../common/logger')('security-audit-log-adapter');

/** Default server-local UTC offset in minutes for SM20 (IST = UTC+05:30). */
const DEFAULT_SM20_TZ_OFFSET_MINUTES = 330;

/**
 * Resolve configured SM20 timezone offset in minutes independently from SM21.
 * @param {number} [override]
 * @returns {number}
 */
function resolveSm20TzOffset(override) {
  if (typeof override === 'number' && Number.isFinite(override)) return override;
  const envVal = parseInt(process.env.SAPLOGS_SM20_TZ_OFFSET_MINUTES, 10);
  return Number.isFinite(envVal) ? envVal : DEFAULT_SM20_TZ_OFFSET_MINUTES;
}

/**
 * Format a Date (UTC) as 'YYYYMMDD' string.
 * @param {Date} d
 * @returns {string}
 */
function toDateStr(d) {
  const pad2 = (n) => String(n).padStart(2, '0');
  return (
    String(d.getUTCFullYear()).padStart(4, '0') +
    pad2(d.getUTCMonth() + 1) +
    pad2(d.getUTCDate())
  );
}

/**
 * Format a Date (UTC) as 'HHMMSS' string.
 * @param {Date} d
 * @returns {string}
 */
function toTimeStr(d) {
  const pad2 = (n) => String(n).padStart(2, '0');
  return pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + pad2(d.getUTCSeconds());
}

/**
 * Convert server-local date ('YYYYMMDD') and time ('HHMMSS') to UTC { date, time, isoTimestamp }.
 * @param {string} localDateStr
 * @param {string} localTimeStr
 * @param {number} offsetMinutes
 * @returns {{ date: string, time: string, isoTimestamp: string }}
 */
function convertLocalToUtc(localDateStr, localTimeStr, offsetMinutes) {
  const dStr = String(localDateStr || '').trim();
  const tStr = String(localTimeStr || '').trim().padEnd(6, '0');
  if (dStr.length < 8) return { date: dStr, time: tStr, isoTimestamp: '' };

  const year  = parseInt(dStr.slice(0, 4), 10);
  const month = parseInt(dStr.slice(4, 6), 10) - 1;
  const day   = parseInt(dStr.slice(6, 8), 10);
  const hour  = parseInt(tStr.slice(0, 2), 10) || 0;
  const min   = parseInt(tStr.slice(2, 4), 10) || 0;
  const sec   = parseInt(tStr.slice(4, 6), 10) || 0;

  const localUtcMs = Date.UTC(year, month, day, hour, min, sec);
  const realUtcMs  = localUtcMs - offsetMinutes * 60 * 1000;
  const d = new Date(realUtcMs);

  return {
    date:         toDateStr(d),
    time:         toTimeStr(d),
    isoTimestamp: d.toISOString(),
  };
}

/**
 * Parse SAP LOG_TSTMP (UTC timestamp on ET_LOG, e.g. '20261117090129.1775720').
 * @param {string} tstmpStr
 * @returns {{date: string, time: string, isoTimestamp: string}|null}
 */
function parseLogTstmp(tstmpStr) {
  if (!tstmpStr || typeof tstmpStr !== 'string') return null;
  const clean = tstmpStr.trim();
  if (clean.length < 14) return null;
  const y = clean.slice(0, 4);
  const m = clean.slice(4, 6);
  const d = clean.slice(6, 8);
  const hh = clean.slice(8, 10);
  const mm = clean.slice(10, 12);
  const ss = clean.slice(12, 14);
  const frac = clean.slice(14);
  return {
    date: `${y}${m}${d}`,
    time: `${hh}${mm}${ss}`,
    isoTimestamp: `${y}-${m}-${d}T${hh}:${mm}:${ss}${frac ? frac.slice(0, 4) : '.000'}Z`,
  };
}

/**
 * Map one ET_LOG / ET_LOG_UTC row to allow-listed output shape.
 * @param {object} row
 * @param {boolean} isUtcTable - true if row came from ET_LOG_UTC
 * @param {number} offsetMinutes
 * @param {boolean} includeUser
 * @returns {{entry: object, usedFallback: boolean}}
 */
function _mapEntry(row, isUtcTable, offsetMinutes, includeUser) {
  let dateOut = String(row.SAL_DATE || '').trim();
  let timeOut = String(row.SAL_TIME || '').trim();
  let utcTimestampOut = String(row.LOG_TSTMP || '').trim();
  let usedFallback = false;

  if (isUtcTable) {
    // ET_LOG_UTC: timestamps are already UTC
    const parsed = parseLogTstmp(row.LOG_TSTMP);
    if (parsed) {
      utcTimestampOut = parsed.isoTimestamp;
    }
  } else {
    // ET_LOG (local-time table):
    // Primary: use LOG_TSTMP (UTC timestamp generated by SAP kernel on ET_LOG)
    const parsedTstmp = parseLogTstmp(row.LOG_TSTMP);
    if (parsedTstmp) {
      dateOut = parsedTstmp.date;
      timeOut = parsedTstmp.time;
      utcTimestampOut = parsedTstmp.isoTimestamp;
    } else {
      // Second fallback: convert server-local date & time using configured offset
      const converted = convertLocalToUtc(dateOut, timeOut, offsetMinutes);
      dateOut = converted.date;
      timeOut = converted.time;
      utcTimestampOut = converted.isoTimestamp;
      usedFallback = true;
    }
  }

  const entry = {
    systemId:        String(row.SID         || '').trim(),
    instance:        String(row.INSTANCE    || '').trim(),
    date:            dateOut,  // UTC YYYYMMDD
    time:            timeOut,  // UTC HHMMSS
    serverDate:      String(row.SAL_DATE    || '').trim(), // Raw server date
    serverTime:      String(row.SAL_TIME    || '').trim(), // Raw server time
    client:          String(row.SLGMAND    || '').trim(),
    area:            String(row.AREA       || '').trim(),
    subId:           String(row.SUBID      || '').trim(),
    eventId:         String(row.MSG        || '').trim(),
    eventText:       String(row.TXSUBCLSID || '').trim(),
    severity:        typeof row.SEVERITY === 'number' ? row.SEVERITY : Number(row.SEVERITY || 0),
    severityText:    String(row.TXSEVERITY || '').trim(),
    tcode:           String(row.SLGTC      || '').trim(),
    program:         String(row.SLGREPNA   || '').trim(),
    message:         sanitizeMessage(row.SAL_DATA, { redactUserTokens: !includeUser, userToken: row.SLGUSER }),
    taskType:        String(row.TASKTYPE   || '').trim(),
    taskNo:          String(row.TASKNO     || '').trim(),
    utcTimestamp:    utcTimestampOut,
  };

  if (includeUser) {
    entry.user = String(row.SLGUSER || '').trim();
  }

  return { entry, usedFallback };
}

class SecurityAuditLogAdapter {
  /**
   * @param {object} [options]
   * @param {object} [options.rfcClient] - Injected RFC client for unit tests.
   * @param {number} [options.tzOffsetMinutes] - Overrides default timezone offset in minutes.
   * @param {boolean} [options.rejectOnFallback] - Reject when ET_LOG_UTC is empty.
   * @param {boolean} [options.includeUser] - Return user ID if true.
   */
  constructor(options = {}) {
    this._rfc = options.rfcClient || new RfcClient();
    this.tzOffsetMinutes = typeof options.tzOffsetMinutes === 'number'
      ? options.tzOffsetMinutes
      : resolveSm20TzOffset(parseInt(process.env.SAPLOGS_SM20_TZ_OFFSET_MINUTES, 10));
    this.rejectOnFallback = typeof options.rejectOnFallback === 'boolean'
      ? options.rejectOnFallback
      : (process.env.SAPLOGS_SM20_REJECT_ON_FALLBACK === 'true');
    this.includeUser = typeof options.includeUser === 'boolean'
      ? options.includeUser
      : (process.env.SAPLOGS_INCLUDE_USER === 'true');
  }

  /**
   * Read security audit log entries via RSAU_API_GET_LOG_DATA.
   * READ-ONLY. Does not change SAP state.
   *
   * @param {object} params
   * @param {Date|string} params.fromUtc          - Window start (UTC). Required.
   * @param {Date|string} params.toUtc            - Window end (UTC). Required.
   * @param {number}      [params.maxRows=500]    - Row cap (applied post-fetch).
   * @param {string}      [params.userFilter]     - Optional SAP username filter (IT_USER range).
   * @param {string}      [params.tcodeFilter]    - Optional transaction code filter.
   * @param {string}      [params.eventFilter]    - Optional event ID filter.
   * @param {boolean}     [params.rejectOnFallback] - Overrides constructor setting.
   * @param {number}      [params.tzOffsetMinutes]  - Overrides timezone offset.
   * @param {boolean}     [params.includeUser]      - Overrides includeUser setting.
   * @returns {Promise<{entries: object[], count: number, truncated: boolean, warnings: string[]}>}
   */
  async readAuditLog({
    fromUtc,
    toUtc,
    maxRows = 500,
    userFilter,
    tcodeFilter,
    eventFilter,
    rejectOnFallback,
    tzOffsetMinutes,
    includeUser,
  } = {}) {
    if (!fromUtc) throw Object.assign(new Error('fromUtc is required'), { status: 400 });
    if (!toUtc)   throw Object.assign(new Error('toUtc is required'),   { status: 400 });

    const fromDate = fromUtc instanceof Date ? fromUtc : new Date(fromUtc);
    const toDate   = toUtc   instanceof Date ? toUtc   : new Date(toUtc);

    if (isNaN(fromDate.getTime())) throw Object.assign(new Error('fromUtc is not a valid ISO date string'), { status: 400 });
    if (isNaN(toDate.getTime()))   throw Object.assign(new Error('toUtc is not a valid ISO date string'),   { status: 400 });
    if (fromDate >= toDate) throw Object.assign(new Error('fromUtc must be before toUtc'), { status: 400 });

    const cap            = typeof maxRows === 'number' ? maxRows : 500;
    const shouldReject   = typeof rejectOnFallback === 'boolean' ? rejectOnFallback : this.rejectOnFallback;
    const offset         = typeof tzOffsetMinutes === 'number'   ? tzOffsetMinutes  : this.tzOffsetMinutes;
    const withUser       = typeof includeUser === 'boolean'      ? includeUser      : this.includeUser;

    // IS_INTERVAL: Build DATS/TIMS filter strings in server-local time for file selection
    const fromLocal = new Date(fromDate.getTime() + offset * 60 * 1000);
    const toLocal   = new Date(toDate.getTime()   + offset * 60 * 1000);

    const isInterval = {
      DAT_FROM: toDateStr(fromLocal),
      DAT_TO:   toDateStr(toLocal),
      TIM_FROM: toTimeStr(fromLocal),
      TIM_TO:   toTimeStr(toLocal),
    };

    const rfcParams = {
      IS_INTERVAL:        isInterval,
      ID_FILE_SEL_SIMPLE: 'X',
    };
    if (userFilter) {
      const u = String(userFilter).trim();
      if (u.length > 12 || !/^[A-Za-z0-9_.\-@]+$/.test(u) || /[*%?]/.test(u)) {
        throw Object.assign(
          new Error('Invalid userFilter: must be alphanumeric (max 12 characters, no wildcards allowed)'),
          { status: 400 }
        );
      }
      // Apply only EQ ranges, never take sign/option from caller; pass IT_R_USER (SUSR_T_RANGE_4_XUBNAME) and IT_USER
      const range = [{ SIGN: 'I', OPTION: 'EQ', LOW: u.toUpperCase(), HIGH: '' }];
      rfcParams.IT_R_USER = range;
      rfcParams.IT_USER   = range;
    }
    if (tcodeFilter) rfcParams.IT_TCODE  = [{ SIGN: 'I', OPTION: 'EQ', LOW: String(tcodeFilter).trim().toUpperCase(), HIGH: '' }];
    if (eventFilter) rfcParams.IT_EVENT  = [{ SIGN: 'I', OPTION: 'EQ', LOW: String(eventFilter).trim().toUpperCase(), HIGH: '' }];

    LOG.debug('RSAU_API_GET_LOG_DATA', { from: isInterval.DAT_FROM + isInterval.TIM_FROM, to: isInterval.DAT_TO + isInterval.TIM_TO });

    let res;
    try {
      res = await this._rfc.call('RSAU_API_GET_LOG_DATA', rfcParams);
    } catch (err) {
      LOG.error('RSAU_API_GET_LOG_DATA failed', { message: err.message });
      throw Object.assign(new Error(`RSAU_API_GET_LOG_DATA failed: ${err.message}`), { status: 503 });
    }

    const returnMsgs = Array.isArray(res.ET_RETURN) ? res.ET_RETURN : [];
    const warnings   = [];
    for (const msg of returnMsgs) {
      const type = String(msg.TYPE || '').toUpperCase();
      const text = String(msg.MESSAGE || msg.MSG_TEXT || '').trim();
      if (type === 'E' || type === 'A') {
        LOG.error('RSAU_API_GET_LOG_DATA returned error', { type, text });
        throw Object.assign(new Error(`SAP security audit log error: ${text}`), { status: 502 });
      }
      if (type === 'W' || type === 'I') {
        warnings.push(text);
      }
    }

    const utcRows   = Array.isArray(res.ET_LOG_UTC) ? res.ET_LOG_UTC : [];
    const localRows = Array.isArray(res.ET_LOG)     ? res.ET_LOG     : [];

    let isUtcTable = true;
    let rawRows = utcRows;

    if (utcRows.length === 0) {
      if (shouldReject) {
        LOG.warn('RSAU_API_GET_LOG_DATA: ET_LOG_UTC empty and fallback rejected by configuration');
        throw Object.assign(
          new Error('Security audit log returned local timestamps only (ET_LOG_UTC is empty) and fallback is rejected'),
          { status: 502 }
        );
      }
      isUtcTable = false;
      rawRows = localRows;
    }

    let anyUsedFallback = false;
    const allEntries = [];
    for (const row of rawRows) {
      const { entry, usedFallback } = _mapEntry(row, isUtcTable, offset, withUser);
      if (usedFallback) anyUsedFallback = true;
      allEntries.push(entry);
    }

    if (anyUsedFallback) {
      warnings.push(`LOG_TSTMP was missing on entries; converted server-local timestamps in ET_LOG to UTC using offset ${offset} minutes.`);
      LOG.info('RSAU_API_GET_LOG_DATA: LOG_TSTMP missing, converted ET_LOG local timestamps to UTC using offset', { offset });
    }

    const truncated = allEntries.length > cap;
    const entries   = truncated ? allEntries.slice(0, cap) : allEntries;

    return { entries, count: entries.length, truncated, warnings };
  }
}

module.exports = { SecurityAuditLogAdapter, convertLocalToUtc, parseLogTstmp, resolveSm20TzOffset };
