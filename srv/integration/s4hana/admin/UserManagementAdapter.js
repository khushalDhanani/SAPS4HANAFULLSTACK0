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
 *     Returns ADDRESS (FULLNAME, E_MAIL), ADMINDATA, COMPANY, DEFAULTS, LOGONDATA, ISLOCKED, ACTIVITYGROUPS, PROFILES, LASTMODIFIED.
 *     Field names and meanings verified against the DS4/220 dictionary (DDIF_FIELDINFO_GET, DD07T), 2026-11-05.
 *   - RFC connection user has S_USER_GRP (5 roles, blank ACTVT/CLASS), NO S_USR_ADM.
 *     Cross-user GET_DETAIL confirmed working (AAKANSHA PATEL, DS4/220).
 */

const { RfcClient } = require('../RfcClient');
const LOG = require('../../../common/logger')('user-management-adapter');

/** SAP reports a failed commit in RETURN, without throwing, so RETURN decides whether the change really happened. */
async function commitOrFail(call, action, bname) {
  const commit = await call('BAPI_TRANSACTION_COMMIT', { WAIT: 'X' });
  const failed = [].concat(commit?.RETURN || []).find((m) => m.TYPE === 'E' || m.TYPE === 'A');
  if (!failed) return;
  LOG.error('BAPI_TRANSACTION_COMMIT RETURN error:', failed.TYPE, failed.ID, failed.NUMBER, failed.MESSAGE);
  // A failed rollback must not hide the commit error, which is what the caller needs to see.
  await call('BAPI_TRANSACTION_ROLLBACK', {}).catch((e) => LOG.warn('BAPI_TRANSACTION_ROLLBACK failed:', e.message));
  throw Object.assign(new Error(`SAP did not commit the ${action} of user '${bname}': ${failed.MESSAGE}`), { status: 502 });
}

// Lock flag characters returned by BAPI_USER_GET_DETAIL ISLOCKED
const LOCK_FLAGS_LOCKED = new Set(['L', 'X']);

/**
 * Map a BAPI_USER_GET_DETAIL result to the CAP service contract.
 * Named fields only: LOGONDATA also holds password hashes (BCODE, PASSCODE, PWDSALTEDHASH), which must never leave here.
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
   * Returns up to maxRows users, enriched with sequential BAPI_USER_GET_DETAIL reads in the same RFC session.
   * A failed detail read leaves its base user row visible with detailsAvailable=false.
   * Client-side search filter applied when provided.
   * WITH_USERNAME range table is not used (node-rfc struct-packing incompatibility on DS4).
   *
   * @param {object} [params]
   * @param {string} [params.search]   - substring filter on USERNAME (case-insensitive)
   * @param {number} [params.maxRows]  - max rows to fetch from SAP (default 200)
   * @returns {Promise<Array<{username, firstName, lastName, fullName, detailsAvailable, isLocked, userType, validFrom, validTo, lastChanged, lastChangedBy}>>}
   */
  async listUsers({ search = '', maxRows = 200 } = {}) {
    LOG.info('listUsers', { search: search || '(none)', maxRows });

    try {
      return await this._rfc.session(async (call) => {
        let res;
        try {
          res = await call('BAPI_USER_GETLIST', { MAX_ROWS: maxRows });
        } catch (e) {
          LOG.error('BAPI_USER_GETLIST failed:', e.message);
          throw Object.assign(new Error('Failed to retrieve user list from SAP'), { status: 502, cause: e });
        }

        const userList = res.USERLIST || [];
        for (const m of (res.RETURN || [])) {
          if (m.TYPE === 'E' || m.TYPE === 'A') {
            LOG.error('BAPI_USER_GETLIST RETURN:', m.TYPE, m.ID, m.NUMBER, m.MESSAGE);
            throw Object.assign(new Error(`SAP error in user list: ${m.MESSAGE}`), { status: 502 });
          }
          if (m.TYPE === 'W') LOG.warn('BAPI_USER_GETLIST RETURN:', m.MESSAGE);
        }

        const needle = search ? search.trim().toLowerCase() : '';
        const filtered = needle
          ? userList.filter(u => (u.USERNAME || '').toLowerCase().includes(needle))
          : userList;

        const enriched = [];
        for (const user of filtered) {
          const username = String(user.USERNAME || '').trim();
          const listedUser = {
            username,
            firstName: String(user.FIRSTNAME || '').trim(),
            lastName: String(user.LASTNAME || '').trim(),
            fullName: String(user.FULLNAME || '').trim(),
          };

          try {
            const detail = await readUserDetail(call, username.toUpperCase());
            const fullName = detail.fullName
              || listedUser.fullName
              || [detail.firstName || listedUser.firstName, detail.lastName || listedUser.lastName].filter(Boolean).join(' ');
            enriched.push({
              ...listedUser,
              fullName,
              detailsAvailable: true,
              isLocked: detail.isLocked,
              userType: detail.userType,
              validFrom: detail.validFrom,
              validTo: detail.validTo,
              lastChanged: detail.lastChanged,
              lastChangedBy: detail.lastChangedBy,
            });
          } catch (e) {
            LOG.warn('Could not enrich SAP user list row:', username, e.message);
            enriched.push({
              ...listedUser,
              detailsAvailable: false,
              isLocked: null,
              userType: null,
              validFrom: null,
              validTo: null,
              lastChanged: null,
              lastChangedBy: null,
            });
          }
        }
        return enriched;
      });
    } catch (e) {
      if (e.status === 502) throw e;
      LOG.error('BAPI_USER_GETLIST session failed:', e.message);
      throw Object.assign(new Error('Failed to retrieve user list from SAP'), { status: 502, cause: e });
    }
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

    try {
      return await this._rfc.session((call) => readUserDetail(call, bname));
    } catch (e) {
      if (e.status === 404 || e.status === 502) throw e;
      LOG.error('BAPI_USER_GET_DETAIL session failed:', e.message);
      throw Object.assign(new Error('Failed to retrieve user detail from SAP'), { status: 502, cause: e });
    }
  }

  /**
   * Lock an SAP user account via BAPI_USER_LOCK + BAPI_TRANSACTION_COMMIT.
   * Runs in a single RFC session LUW.
   * Enforces self-lock protection against the active RFC connection user.
   *
   * @param {string} username
   * @returns {Promise<{success: boolean, message: string, username: string}>}
   */
  async lockUser(username) {
    if (!username || typeof username !== 'string' || !username.trim()) {
      throw Object.assign(new Error('username is required'), { status: 400 });
    }
    const bname = username.trim().toUpperCase();
    // The user RFC really logs on with: local env, or the BTP destination in production. A failed read rejects, so nothing is locked.
    const { user } = await this._rfc.resolveConnectionParams();
    if (bname === String(user || '').trim().toUpperCase()) {
      throw Object.assign(
        new Error(`Cannot lock user '${bname}': operation refused because it is the active RFC connection user`),
        { status: 403 }
      );
    }
    LOG.info('lockUser', { username: bname });

    return this._rfc.session(async (call) => {
      let res;
      try {
        res = await call('BAPI_USER_LOCK', { USERNAME: bname });
      } catch (e) {
        LOG.error('BAPI_USER_LOCK failed:', e.message);
        throw Object.assign(new Error(`Failed to lock user in SAP: ${e.message}`), { status: 502, cause: e });
      }

      const returnMsgs = res.RETURN || [];
      const errorMsg = returnMsgs.find(m => m.TYPE === 'E' || m.TYPE === 'A');
      if (errorMsg) {
        LOG.error('BAPI_USER_LOCK RETURN error:', errorMsg.TYPE, errorMsg.ID, errorMsg.NUMBER, errorMsg.MESSAGE);
        throw Object.assign(new Error(`SAP error: ${errorMsg.MESSAGE}`), { status: 502 });
      }

      await commitOrFail(call, 'lock', bname);
      return {
        success: true,
        message: `User '${bname}' locked successfully in SAP`,
        username: bname
      };
    });
  }

  /**
   * Unlock an SAP user account via BAPI_USER_UNLOCK + BAPI_TRANSACTION_COMMIT.
   * Runs in a single RFC session LUW.
   *
   * @param {string} username
   * @returns {Promise<{success: boolean, message: string, username: string}>}
   */
  async unlockUser(username) {
    if (!username || typeof username !== 'string' || !username.trim()) {
      throw Object.assign(new Error('username is required'), { status: 400 });
    }
    const bname = username.trim().toUpperCase();
    LOG.info('unlockUser', { username: bname });

    return this._rfc.session(async (call) => {
      let res;
      try {
        res = await call('BAPI_USER_UNLOCK', { USERNAME: bname });
      } catch (e) {
        LOG.error('BAPI_USER_UNLOCK failed:', e.message);
        throw Object.assign(new Error(`Failed to unlock user in SAP: ${e.message}`), { status: 502, cause: e });
      }

      const returnMsgs = res.RETURN || [];
      const errorMsg = returnMsgs.find(m => m.TYPE === 'E' || m.TYPE === 'A');
      if (errorMsg) {
        LOG.error('BAPI_USER_UNLOCK RETURN error:', errorMsg.TYPE, errorMsg.ID, errorMsg.NUMBER, errorMsg.MESSAGE);
        throw Object.assign(new Error(`SAP error: ${errorMsg.MESSAGE}`), { status: 502 });
      }

      await commitOrFail(call, 'unlock', bname);
      return {
        success: true,
        message: `User '${bname}' unlocked successfully in SAP`,
        username: bname
      };
    });
  }
}

module.exports = { UserManagementAdapter };
