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

  for (const m of (res.RETURN || [])) {
    if (m.TYPE === 'E' || m.TYPE === 'A') {
      if (m.NUMBER === '121' || (m.MESSAGE || '').toLowerCase().includes('does not exist')) {
        throw Object.assign(new Error(`User '${username}' does not exist in SAP`), { status: 404 });
      }
      throw Object.assign(new Error(`SAP error: ${m.MESSAGE}`), { status: 502 });
    }
  }

  return mapDetail(username, res);
}

module.exports = {
  toMessage,
  LOCK_FLAGS_LOCKED,
  mapDetail,
  readUserDetail,
};
