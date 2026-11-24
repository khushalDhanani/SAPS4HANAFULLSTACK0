'use strict';

/**
 * UserDetailReader
 *
 * Maps and reads user detail via BAPI_USER_GET_DETAIL.
 * Extracts named fields only: password hashes (BCODE, PASSCODE, PWDSALTEDHASH) are strictly excluded.
 */

const LOG = require('../../../common/logger')('user-management-adapter');

const toMessage = (m) => ({ type: m.TYPE, id: m.ID, number: m.NUMBER, message: m.MESSAGE });

// Lock flag characters returned by BAPI_USER_GET_DETAIL ISLOCKED
const LOCK_FLAGS_LOCKED = new Set(['L', 'X']);

/**
 * SUID01/313 "No authorization to display the global user ID for users".
 * SAP returns it as an error next to the complete user data when the connection user may display users but not
 * their global user ID (observed on S4HANA_DEV client 220, 2026-11-24: roles, profiles, logon data and address
 * were all returned). The application does not read the global user ID (see mapDetail), so this one message must
 * not discard the answer. It is matched by message class and number, never by its text.
 */
const isGlobalUserIdNotice = (m) => String(m.ID || '').trim() === 'SUID01' && String(m.NUMBER || '').trim() === '313';

/** Whether the BAPI answer carries the user: without logon data or an address there is nothing to show. */
function hasUserData(raw) {
  const filled = (o) => Boolean(o) && Object.values(o).some((v) => String(v == null ? '' : v).trim() !== '');
  return filled(raw.LOGONDATA) || filled(raw.ADDRESS);
}

// One user list reads every user: the notice is logged once a minute, not once per user.
const NOTICE_LOG_INTERVAL_MS = 60 * 1000;
let lastNoticeLoggedAt = 0;
function logGlobalUserIdNotice() {
  const now = Date.now();
  if (now - lastNoticeLoggedAt < NOTICE_LOG_INTERVAL_MS) return;
  lastNoticeLoggedAt = now;
  LOG.warn(
    'SAP answers BAPI_USER_GET_DETAIL with SUID01/313: the connection user is not authorized to display the global ' +
    'user ID. The user data SAP returned is used without it. Give the connection user that authorization to clear this.'
  );
}

/**
 * Map a BAPI_USER_GET_DETAIL result to the CAP service contract.
 * Named fields only: LOGONDATA also holds password hashes, which must never leave here.
 * @param {string} username
 * @param {object} raw - raw RFC result
 * @returns {object}
 */
function mapDetail(username, raw) {
  const addr   = raw.ADDRESS    || {};
  const ld     = raw.LOGONDATA  || {};
  const lk     = raw.ISLOCKED   || {};
  const lm     = raw.LASTMODIFIED || {};
  const adm    = raw.ADMINDATA  || {};
  const dflt   = raw.DEFAULTS   || {};
  const text   = (value) => String(value || '').trim();

  const lockedWrong  = String(lk.WRNG_LOGON  || 'U');
  const lockedNoPw   = String(lk.NO_USER_PW  || 'U');
  const lockedGlobal = String(lk.GLOB_LOCK   || 'U');
  const lockedLocal  = String(lk.LOCAL_LOCK  || 'U');
  const isLocked     = [lockedWrong, lockedNoPw, lockedGlobal, lockedLocal].some(f => LOCK_FLAGS_LOCKED.has(f));

  return {
    username,
    firstName:     String(addr.FIRSTNAME  || '').trim(),
    lastName:      String(addr.LASTNAME   || '').trim(),
    fullName:      String(addr.FULLNAME   || '').trim(),
    email:         String(addr.E_MAIL     || '').trim(),
    phone:         [text(addr.TEL1_NUMBR), text(addr.TEL1_EXT)].filter(Boolean).join(' '),
    department:    text(addr.DEPARTMENT),
    jobFunction:   text(addr.FUNCTION),
    company:       text(raw.COMPANY?.COMPANY),
    createdBy:     text(adm.ANAME),
    createdOn:     text(adm.ERDAT),
    lastLogonDate: text(adm.TRDAT),
    lastLogonTime: text(ld.LTIME),
    language:      text(dflt.LANGU),
    dateFormat:    text(dflt.DATFM),
    decimalFormat: text(dflt.DCPFM),
    costCenter:    text(dflt.KOSTL),
    timeZone:      text(ld.TZONE),
    userType:      String(ld.USTYP        || '').trim(),
    validFrom:     String(ld.GLTGV        || '').trim(),
    validTo:       String(ld.GLTGB        || '').trim(),
    userGroup:     String(ld.CLASS        || '').trim(),
    lockedWrong,
    lockedNoPw,
    lockedGlobal,
    lockedLocal,
    isLocked,
    roleCount:     (raw.ACTIVITYGROUPS || []).length,
    profileCount:  (raw.PROFILES       || []).length,
    lastChanged:   String(lm.MODDATE   || '').trim(),
    lastChangedTime: text(lm.MODTIME),
    lastChangedBy: String(lm.MODIFIER  || '').trim(),
    roles: (raw.ACTIVITYGROUPS || []).map((r) => ({
      name: text(r.AGR_NAME), description: text(r.AGR_TEXT), validFrom: text(r.FROM_DAT), validTo: text(r.TO_DAT),
    })),
    profiles: (raw.PROFILES || []).map((r) => ({ name: text(r.BAPIPROF), description: text(r.BAPIPTEXT) })),
  };
}

async function readUserDetail(call, username) {
  let res;
  try {
    res = await call('BAPI_USER_GET_DETAIL', { USERNAME: username });
  } catch (e) {
    LOG.error('BAPI_USER_GET_DETAIL failed:', e.message);
    throw Object.assign(new Error('Failed to retrieve user detail from SAP'), { status: 502, cause: e });
  }

  let globalUserIdNotice = null;
  for (const m of (res.RETURN || [])) {
    if (m.TYPE === 'E' || m.TYPE === 'A') {
      if (isGlobalUserIdNotice(m)) {
        globalUserIdNotice = m;
        continue; // every other error still stops the read
      }
      if (m.NUMBER === '121' || (m.MESSAGE || '').toLowerCase().includes('does not exist')) {
        throw Object.assign(new Error(`User '${username}' does not exist in SAP`), { status: 404 });
      }
      throw Object.assign(new Error(`SAP error: ${m.MESSAGE}`), { status: 502 });
    }
  }

  if (globalUserIdNotice) {
    // Tolerated only while SAP did return the user; an empty answer stays an error.
    if (!hasUserData(res)) {
      throw Object.assign(new Error(`SAP error: ${globalUserIdNotice.MESSAGE}`), { status: 502 });
    }
    logGlobalUserIdNotice();
  }

  return mapDetail(username, res);
}

module.exports = {
  toMessage,
  LOCK_FLAGS_LOCKED,
  mapDetail,
  readUserDetail,
  isGlobalUserIdNotice,
  hasUserData,
};
