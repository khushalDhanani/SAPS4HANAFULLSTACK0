'use strict';

/**
 * SystemLogTimeUtil
 *
 * Timezone offset resolution and RSLGTIME conversions for SAP SM21 system logs.
 *
 * Timezone & Offset (CONFIRMED LIVE 2026-11-17):
 *   - System runs in IST (UTC+05:30).
 *   - Live comparison of SM20 ET_LOG (SAL_TIME 14:31:29) and UTC timestamp (LOG_TSTMP 09:01:29) proved the
 *     server-local offset is exactly +330 minutes.
 *   - Configurable via process.env.SAPLOGS_SM21_TZ_OFFSET_MINUTES (default: 330).
 *   - Callers supply UTC; this adapter converts UTC -> server-local for query filters,
 *     and converts returned server-local timestamps back to UTC ISO strings.
 */

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

module.exports = {
  DEFAULT_SERVER_TZ_OFFSET_MINUTES,
  resolveTzOffset,
  toRslgTime,
  fromRslgTimeToUtc,
};
