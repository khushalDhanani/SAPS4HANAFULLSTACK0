'use strict';

/**
 * UserManagementAdapter — Phase 1 (read-only)
 *
 * Encapsulates all SU01 BAPI calls within srv/integration/s4hana/ per architecture rules.
 * Phase 1: BAPI_USER_GETLIST + BAPI_USER_GET_DETAIL only.
 *
 * Evidence (DS4/220, 2026-11-03):
 *   - BAPI_USER_GETLIST: import param MAX_ROWS; table USERLIST {USERNAME, FIRSTNAME, LASTNAME, FULLNAME}
 *     WITH_USERNAME range table rejected by node-rfc on this system → client-side filter used instead.
 *   - BAPI_USER_GET_DETAIL: import param USERNAME (confirmed; BNAME throws "field not found").
 *     Returns ADDRESS (FULLNAME, SMTP_ADDR), LOGONDATA, ISLOCKED, ACTIVITYGROUPS, PROFILES, LASTMODIFIED.
 *   - RFC connection user has S_USER_GRP (5 roles, blank ACTVT/CLASS), NO S_USR_ADM.
 *     Cross-user GET_DETAIL confirmed working (AAKANSHA PATEL, DS4/220).
 */

const { RfcClient } = require('../RfcClient');
const LOG = require('../../../common/logger')('user-management-adapter');

// Lock flag characters returned by BAPI_USER_GET_DETAIL ISLOCKED
const LOCK_FLAGS_LOCKED = new Set(['L', 'X']);

/**
 * Map a BAPI_USER_GET_DETAIL result to the CAP service contract.
 * @param {string} username
 * @param {object} raw - raw RFC result
 * @returns {object}
 */
function mapDetail(username, raw) {
  const addr   = raw.ADDRESS    || {};
  const ld     = raw.LOGONDATA  || {};
  const lk     = raw.ISLOCKED   || {};
  const lm     = raw.LASTMODIFIED || {};

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
    email:         String(addr.SMTP_ADDR  || '').trim(),
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
    lastChangedBy: String(lm.MODUSER   || '').trim(),
  };
}

class UserManagementAdapter {
  /**
   * @param {object} [options]
   * @param {RfcClient} [options.rfcClient] - injected for tests
   */
  constructor(options = {}) {
    this._rfc = options.rfcClient || new RfcClient();
  }

  /**
   * List SAP users via BAPI_USER_GETLIST.
   * Returns up to maxRows users. Client-side search filter applied when provided.
   * WITH_USERNAME range table is not used (node-rfc struct-packing incompatibility on DS4).
   *
   * @param {object} [params]
   * @param {string} [params.search]   - substring filter on USERNAME (case-insensitive)
   * @param {number} [params.maxRows]  - max rows to fetch from SAP (default 200)
   * @returns {Promise<Array<{username, firstName, lastName, fullName}>>}
   */
  async listUsers({ search = '', maxRows = 200 } = {}) {
    LOG.info('listUsers', { search: search || '(none)', maxRows });

    let res;
    try {
      res = await this._rfc.call('BAPI_USER_GETLIST', { MAX_ROWS: maxRows });
    } catch (e) {
      LOG.error('BAPI_USER_GETLIST failed:', e.message);
      throw Object.assign(new Error('Failed to retrieve user list from SAP'), { status: 502, cause: e });
    }

    const userList = res.USERLIST || [];
    // Surface any SAP error/warning messages
    for (const m of (res.RETURN || [])) {
      if (m.TYPE === 'E' || m.TYPE === 'A') {
        LOG.error('BAPI_USER_GETLIST RETURN:', m.TYPE, m.ID, m.NUMBER, m.MESSAGE);
        throw Object.assign(new Error(`SAP error in user list: ${m.MESSAGE}`), { status: 502 });
      }
      if (m.TYPE === 'W') LOG.warn('BAPI_USER_GETLIST RETURN:', m.MESSAGE);
    }

    // Client-side filter (WITH_USERNAME range table not usable from node-rfc on this system)
    const needle = search ? search.trim().toLowerCase() : '';
    const filtered = needle
      ? userList.filter(u => (u.USERNAME || '').toLowerCase().includes(needle))
      : userList;

    return filtered.map(u => ({
      username:  String(u.USERNAME  || '').trim(),
      firstName: String(u.FIRSTNAME || '').trim(),
      lastName:  String(u.LASTNAME  || '').trim(),
      fullName:  String(u.FULLNAME  || '').trim(),
    }));
  }

  /**
   * Get full detail for a single user via BAPI_USER_GET_DETAIL.
   * CONFIRMED: import param is USERNAME (not BNAME).
   *
   * @param {string} username
   * @returns {Promise<object>}
   */
  async getUserDetail(username) {
    if (!username || typeof username !== 'string' || !username.trim()) {
      throw Object.assign(new Error('username is required'), { status: 400 });
    }
    const bname = username.trim().toUpperCase();
    LOG.info('getUserDetail', { username: bname });

    let res;
    try {
      res = await this._rfc.call('BAPI_USER_GET_DETAIL', { USERNAME: bname });
    } catch (e) {
      LOG.error('BAPI_USER_GET_DETAIL failed:', e.message);
      throw Object.assign(new Error('Failed to retrieve user detail from SAP'), { status: 502, cause: e });
    }

    for (const m of (res.RETURN || [])) {
      if (m.TYPE === 'E' || m.TYPE === 'A') {
        // Common: 121 = user not found
        if (m.NUMBER === '121' || (m.MESSAGE || '').toLowerCase().includes('does not exist')) {
          throw Object.assign(new Error(`User '${bname}' does not exist in SAP`), { status: 404 });
        }
        throw Object.assign(new Error(`SAP error: ${m.MESSAGE}`), { status: 502 });
      }
    }

    return mapDetail(bname, res);
  }
}

module.exports = { UserManagementAdapter };

