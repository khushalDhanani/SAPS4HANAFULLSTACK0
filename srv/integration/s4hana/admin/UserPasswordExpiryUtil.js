'use strict';

const PWD_POLICY_DEFAULT_DAYS = 90;
const PWD_WARNING_DEFAULT_DAYS = 14;

/**
 * Parses an 8-character SAP DATS 'YYYYMMDD' into a UTC Date at 00:00:00Z.
 * Returns null for invalid or empty ('00000000') dates.
 */
function parseSapDate(sDate) {
  const s = String(sDate || '').trim();
  if (!/^\d{8}$/.test(s) || s === '00000000') return null;
  const year = parseInt(s.slice(0, 4), 10);
  const month = parseInt(s.slice(4, 6), 10) - 1;
  const day = parseInt(s.slice(6, 8), 10);
  const d = new Date(Date.UTC(year, month, day));
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Formats a Date object as 'YYYYMMDD' in UTC.
 */
function formatSapDate(date) {
  if (!date || isNaN(date.getTime())) return '';
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/**
 * Adds integer days to a Date object, returning a new Date in UTC.
 */
function addDays(date, days) {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/**
 * Calculates calendar day difference (d1 - d2).
 */
function diffCalendarDays(d1, d2) {
  const MS_PER_DAY = 86400000;
  return Math.round((d1.getTime() - d2.getTime()) / MS_PER_DAY);
}

/**
 * Calculates password expiry attributes from raw USR02 fields.
 *
 * @param {object} row - row from USR02 (BNAME, USTYP, UFLAG, GLTGV, GLTGB, PWDCHGDATE, TRDAT, LTIME)
 * @param {object} [options]
 * @param {number} [options.expirationDays=90] - Days until password expires. If <= 0, passwords do not expire.
 * @param {number} [options.warningDays=14] - Warning threshold in days for expiring_soon status.
 * @param {string|Date} [options.referenceDate] - Current date for calculation (default: today in UTC).
 * @returns {object}
 */
function calculatePasswordStatus(row, options = {}) {
  const expirationDays = Number.isInteger(options.expirationDays)
    ? options.expirationDays
    : (parseInt(process.env.SAP_PASSWORD_EXPIRATION_DAYS, 10) || PWD_POLICY_DEFAULT_DAYS);
  const warningDays = Number.isInteger(options.warningDays)
    ? options.warningDays
    : (parseInt(process.env.SAP_PASSWORD_WARNING_DAYS, 10) || PWD_WARNING_DEFAULT_DAYS);

  const refDate = options.referenceDate
    ? (options.referenceDate instanceof Date ? options.referenceDate : parseSapDate(options.referenceDate))
    : new Date();
  const today = refDate ? new Date(Date.UTC(refDate.getUTCFullYear(), refDate.getUTCMonth(), refDate.getUTCDate())) : new Date();
  const todayStr = formatSapDate(today);

  const username = String(row.BNAME || '').trim();
  const userType = String(row.USTYP || '').trim();
  const uflag = Number(row.UFLAG) || 0;
  const isLocked = uflag !== 0;
  const validFrom = String(row.GLTGV || '').trim();
  const validTo = String(row.GLTGB || '').trim();
  const pwdLastChanged = String(row.PWDCHGDATE || '').trim();
  const lastLogonDate = String(row.TRDAT || '').trim();
  const lastLogonTime = String(row.LTIME || '').trim();

  // 1. Exempt user types: System (B), Communication (C), Service (S), Reference (L)
  if (userType && userType !== 'A') {
    return {
      username,
      userType,
      uflag,
      isLocked,
      validFrom,
      validTo,
      lastLogonDate,
      lastLogonTime,
      pwdLastChanged,
      pwdExpiresAt: null,
      pwdDaysRemaining: null,
      pwdStatus: 'exempt'
    };
  }

  // 2. Initial password (never changed or explicitly 00000000)
  const dChanged = parseSapDate(pwdLastChanged);
  if (!dChanged) {
    return {
      username,
      userType,
      uflag,
      isLocked,
      validFrom,
      validTo,
      lastLogonDate,
      lastLogonTime,
      pwdLastChanged,
      pwdExpiresAt: null,
      pwdDaysRemaining: 0,
      pwdStatus: 'initial'
    };
  }

  // 3. Expiration disabled policy (expirationDays <= 0)
  if (expirationDays <= 0) {
    return {
      username,
      userType,
      uflag,
      isLocked,
      validFrom,
      validTo,
      lastLogonDate,
      lastLogonTime,
      pwdLastChanged,
      pwdExpiresAt: null,
      pwdDaysRemaining: null,
      pwdStatus: 'valid'
    };
  }

  // 4. Calculate effective expiry
  const dExpiry = addDays(dChanged, expirationDays);
  const pwdExpiresAt = formatSapDate(dExpiry);
  const pwdDaysRemaining = diffCalendarDays(dExpiry, today);

  // Check account validity (GLTGB)
  const dValidTo = parseSapDate(validTo);
  const isAccountExpired = Boolean(dValidTo && validTo !== '00000000' && validTo < todayStr);

  let pwdStatus = 'valid';
  if (pwdDaysRemaining < 0 || isAccountExpired) {
    pwdStatus = 'expired';
  } else if (pwdDaysRemaining <= warningDays) {
    pwdStatus = 'expiring_soon';
  }

  return {
    username,
    userType,
    uflag,
    isLocked,
    validFrom,
    validTo,
    lastLogonDate,
    lastLogonTime,
    pwdLastChanged,
    pwdExpiresAt,
    pwdDaysRemaining,
    pwdStatus
  };
}

module.exports = {
  PWD_POLICY_DEFAULT_DAYS,
  PWD_WARNING_DEFAULT_DAYS,
  parseSapDate,
  formatSapDate,
  addDays,
  diffCalendarDays,
  calculatePasswordStatus
};
