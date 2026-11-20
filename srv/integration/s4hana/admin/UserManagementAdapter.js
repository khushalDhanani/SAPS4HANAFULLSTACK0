'use strict';

/**
 * UserManagementAdapter
 *
 * Encapsulates all SU01 BAPI calls within srv/integration/s4hana/ per architecture rules.
 * Reads: BAPI_USER_GETLIST + BAPI_USER_GET_DETAIL. Writes: BAPI_USER_LOCK / BAPI_USER_UNLOCK + BAPI_TRANSACTION_COMMIT.
 *
 * Evidence (DS4/220, 2026-11-03):
 *   - BAPI_USER_GETLIST: import param MAX_ROWS; table USERLIST {USERNAME, FIRSTNAME, LASTNAME, FULLNAME}
 *     WITH_USERNAME range table rejected by node-rfc on this system → client-side filter used instead.
 *   - BAPI_USER_GET_DETAIL: import param USERNAME (confirmed; BNAME throws "field not found").
 *     Returns ADDRESS (FULLNAME, E_MAIL), ADMINDATA, COMPANY, DEFAULTS, LOGONDATA, ISLOCKED, ACTIVITYGROUPS, PROFILES, LASTMODIFIED.
 *     Field names and meanings verified against the DS4/220 dictionary (DDIF_FIELDINFO_GET, DD07T), 2026-11-05.
 *   - RFC connection user: AUTHORITY_CHECK on S_USER_GRP activity 05 passes (2026-11-05); it holds profile SAP_ALL.
 *     Cross-user GET_DETAIL confirmed working (AAKANSHA PATEL, DS4/220).
 */

const { RfcClient } = require('../RfcClient');
const LOG = require('../../../common/logger')('user-management-adapter');
const {
  USH02_PAGE_SIZE,
  sapLiteral,
  historyCursor,
  compareHistoryRows,
  readUSH02
} = require('./UserHistoryReader');

const toMessage = (m) => ({ type: m.TYPE, id: m.ID, number: m.NUMBER, message: m.MESSAGE });

/** SAP reports a failed commit in RETURN, without throwing, so RETURN decides whether the change really happened. */
async function commitOrFail(call, action, bname) {
  const commit = await call('BAPI_TRANSACTION_COMMIT', { WAIT: 'X' });
  const failed = [].concat(commit?.RETURN || []).find((m) => m.TYPE === 'E' || m.TYPE === 'A');
  if (!failed) return;
  LOG.error('BAPI_TRANSACTION_COMMIT RETURN error:', failed.TYPE, failed.ID, failed.NUMBER, failed.MESSAGE);
  // A failed rollback must not hide the commit error, which is what the caller needs to see.
  await call('BAPI_TRANSACTION_ROLLBACK', {}).catch((e) => LOG.warn('BAPI_TRANSACTION_ROLLBACK failed:', e.message));
  throw Object.assign(new Error(`SAP did not commit the ${action} of user '${bname}': ${failed.MESSAGE}`), { status: 502, sapMessage: toMessage(failed) });
}

/** One lock or unlock BAPI in the caller's LUW: commits only when RETURN holds no E or A, otherwise rolls back. */
async function changeLock(call, fm, action, bname) {
  let res;
  try {
    res = await call(fm, { USERNAME: bname });
  } catch (e) {
    LOG.error(`${fm} failed:`, e.message);
    throw Object.assign(new Error(`Failed to ${action} user in SAP: ${e.message}`), { status: 502, cause: e });
  }

  const messages = [].concat(res.RETURN || []).map(toMessage);
  const errorMsg = messages.find((m) => m.type === 'E' || m.type === 'A');
  if (errorMsg) {
    LOG.error(`${fm} RETURN error:`, errorMsg.type, errorMsg.id, errorMsg.number, errorMsg.message);
    // A failed rollback must not hide the BAPI error, which is what the caller needs to see.
    await call('BAPI_TRANSACTION_ROLLBACK', {}).catch((e) => LOG.warn('BAPI_TRANSACTION_ROLLBACK failed:', e.message));
    throw Object.assign(new Error(`SAP error: ${errorMsg.message}`), { status: 502, sapMessage: errorMsg });
  }

  await commitOrFail(call, action, bname);
  return {
    success: true,
    status: messages.some((m) => m.type === 'W') ? 'warning' : 'success',
    messages,
    message: `User '${bname}' ${action}ed successfully in SAP`,
    username: bname,
  };
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

// List enrichment: at most this many RFC connections read user details at once (measured on DS4/220:
// 278 users took ~17 s on one connection). One more connection is opened per this many uncached users,
// so a short list stays on the single connection that read it.
const LIST_DETAIL_CONNECTIONS = 4;
const LIST_USERS_PER_EXTRA_CONNECTION = 25;

const {
  PWD_POLICY_DEFAULT_DAYS,
  PWD_WARNING_DEFAULT_DAYS,
  parseSapDate,
  formatSapDate,
  addDays,
  diffCalendarDays,
  calculatePasswordStatus
} = require('./UserPasswordExpiryUtil');

class UserManagementAdapter {
  /**
   * @param {object} [options]
   * @param {RfcClient} [options.rfcClient] - injected for tests
   * @param {number} [options.detailCacheTtlMs] - TTL for user details cache (default 60s)
   * @param {number} [options.listCacheTtlMs] - TTL for user list cache (default 30s)
   */
  constructor(options = {}) {
    this._rfc = options.rfcClient || new RfcClient();
    this._detailCache = new Map(); // username.toUpperCase() -> { detail, expiresAt }
    this._listCache = new Map();   // `${search}|${maxRows}` -> { data, expiresAt }
    this._detailCacheTtlMs = options.detailCacheTtlMs || 60000;
    this._listCacheTtlMs = options.listCacheTtlMs || 30000;
    this._listDetailConnections = options.listDetailConnections || LIST_DETAIL_CONNECTIONS;
  }

  _getCachedDetail(username) {
    const key = String(username || '').trim().toUpperCase();
    const hit = this._detailCache.get(key);
    if (hit && hit.expiresAt > Date.now()) {
      return hit.detail;
    }
    this._detailCache.delete(key);
    return null;
  }

  _setCachedDetail(username, detail) {
    const key = String(username || '').trim().toUpperCase();
    this._detailCache.set(key, {
      detail,
      expiresAt: Date.now() + this._detailCacheTtlMs,
    });
  }

  invalidateUserCache(username) {
    this._listCache.clear();
    if (username) {
      this._detailCache.delete(String(username).trim().toUpperCase());
    } else {
      this._detailCache.clear();
    }
  }

  clearCache() {
    this._detailCache.clear();
    this._listCache.clear();
  }

  /**
   * List SAP users via BAPI_USER_GETLIST.
   * Returns up to maxRows users, enriched with BAPI_USER_GET_DETAIL reads on a small, bounded number of RFC connections.
   * Leverages in-memory caching to avoid redundant round-trips on subsequent calls.
   * A failed detail read leaves its base user row visible with detailsAvailable=false.
   * Client-side search filter applied when provided.
   * WITH_USERNAME range table is not used (node-rfc struct-packing incompatibility on DS4).
   *
   * @param {object} [params]
   * @param {string} [params.search]        - substring filter on USERNAME (case-insensitive)
   * @param {number} [params.maxRows]       - max rows to fetch from SAP (default 200)
   * @param {boolean} [params.forceRefresh] - bypass cache and fetch fresh from SAP
   * @returns {Promise<Array<{username, firstName, lastName, fullName, detailsAvailable, isLocked, userType, validFrom, validTo, lastChanged, lastChangedBy}>>}
   */
  async listUsers({ search = '', maxRows = 200, forceRefresh = false } = {}) {
    LOG.info('listUsers', { search: search || '(none)', maxRows, forceRefresh });

    const cacheKey = `${search.trim().toLowerCase()}|${maxRows}`;
    if (!forceRefresh) {
      const cached = this._listCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        LOG.info('listUsers served from cache', { search, maxRows, count: cached.data.length });
        return cached.data;
      }
    }

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

        const enrichOne = async (rfcCall, user) => {
          const username = String(user.USERNAME || '').trim();
          const listedUser = {
            username,
            firstName: String(user.FIRSTNAME || '').trim(),
            lastName: String(user.LASTNAME || '').trim(),
            fullName: String(user.FULLNAME || '').trim(),
          };

          try {
            let detail = !forceRefresh ? this._getCachedDetail(username) : null;
            if (!detail) {
              detail = await readUserDetail(rfcCall, username.toUpperCase());
              this._setCachedDetail(username, detail);
            }
            const fullName = detail.fullName
              || listedUser.fullName
              || [detail.firstName || listedUser.firstName, detail.lastName || listedUser.lastName].filter(Boolean).join(' ');
            return {
              ...listedUser,
              fullName,
              detailsAvailable: true,
              isLocked: detail.isLocked,
              userType: detail.userType,
              validFrom: detail.validFrom,
              validTo: detail.validTo,
              lastChanged: detail.lastChanged,
              lastChangedBy: detail.lastChangedBy,
            };
          } catch (e) {
            LOG.warn('Could not enrich SAP user list row:', username, e.message);
            return {
              ...listedUser,
              detailsAvailable: false,
              isLocked: null,
              userType: null,
              validFrom: null,
              validTo: null,
              lastChanged: null,
              lastChangedBy: null,
            };
          }
        };

        // Workers share one queue, so a slow read or a connection that fails to open never loses a row:
        // the connection that read the list always drains whatever is left.
        const enriched = new Array(filtered.length);
        let next = 0;
        const worker = async (rfcCall) => {
          while (next < filtered.length) {
            const index = next++;
            enriched[index] = await enrichOne(rfcCall, filtered[index]);
          }
        };
        const uncached = forceRefresh
          ? filtered.length
          : filtered.filter((user) => !this._getCachedDetail(String(user.USERNAME || '').trim())).length;
        const extraConnections = Math.min(this._listDetailConnections - 1, Math.floor(uncached / LIST_USERS_PER_EXTRA_CONNECTION));
        const startedAt = Date.now();
        await Promise.all([
          worker(call),
          ...Array.from({ length: Math.max(0, extraConnections) }, () => this._rfc.session(worker).catch((e) => {
            LOG.warn('Extra RFC connection for the user list failed; the remaining connections continue:', e.message);
          })),
        ]);
        LOG.info('listUsers details read', {
          users: filtered.length, detailReads: uncached, connections: 1 + Math.max(0, extraConnections), ms: Date.now() - startedAt,
        });
        this._listCache.set(cacheKey, {
          data: enriched,
          expiresAt: Date.now() + this._listCacheTtlMs,
        });
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
   * Reuses cached detail if available from list enrichment.
   *
   * @param {string} username
   * @param {object} [options]
   * @param {boolean} [options.forceRefresh] - bypass cache
   * @returns {Promise<object>}
   */
  async getUserDetail(username, { forceRefresh = false } = {}) {
    if (!username || typeof username !== 'string' || !username.trim()) {
      throw Object.assign(new Error('username is required'), { status: 400 });
    }
    const bname = username.trim().toUpperCase();
    LOG.info('getUserDetail', { username: bname, forceRefresh });

    if (!forceRefresh) {
      const cached = this._getCachedDetail(bname);
      if (cached) {
        LOG.info('getUserDetail served from cache for:', bname);
        return cached;
      }
    }

    try {
      const detail = await this._rfc.session((call) => readUserDetail(call, bname));
      this._setCachedDetail(bname, detail);
      return detail;
    } catch (e) {
      if (e.status === 404 || e.status === 502) throw e;
      LOG.error('BAPI_USER_GET_DETAIL session failed:', e.message);
      throw Object.assign(new Error('Failed to retrieve user detail from SAP'), { status: 502, cause: e });
    }
  }

  /**
   * USR02.UFLAG, read by name so no hash column is ever requested. One read covers every user in about 60 ms,
   * where listUsers takes about 19 s (DS4/220, 278 users, 2026-11-05).
   * @param {string} [username] - one user, or all when omitted
   * @returns {Promise<Array<{username: string, uflag: number}>>}
   */
  async readLockFlags(username) {
    const where = username ? [`BNAME = '${sapLiteral(username)}'`] : [];
    const rows = await this._rfc.readTable('USR02', ['BNAME', 'UFLAG'], where);
    return rows.map((row) => ({ username: row.BNAME, uflag: Number(row.UFLAG) || 0 }));
  }

  /**
   * All full names in one read of the view USER_ADDR, instead of a BAPI_USER_GET_DETAIL per user.
   * On DS4/220 it held 262 of 278 users (2026-11-05); a user missing here has no name in the alert.
   * @returns {Promise<Map<string, string>>}
   */
  async readFullNames() {
    const rows = await this._rfc.readTable('USER_ADDR', ['BNAME', 'NAME_TEXTC']);
    return new Map(rows.map((row) => [row.BNAME, row.NAME_TEXTC]));
  }

  /**
   * Reads password and account expiry attributes from USR02, enriched with user full names from USER_ADDR.
   * Named non-sensitive fields only; password hash columns are strictly excluded.
   *
   * @param {object} [options]
   * @param {string} [options.username] - filter by single username
   * @param {number} [options.expirationDays=90] - password validity period in days (0 or negative disables expiration)
   * @param {number} [options.warningDays=14] - threshold in days for 'expiring_soon' status
   * @param {string|Date} [options.referenceDate] - reference date for remaining days calculation
   * @returns {Promise<Array<object>>}
   */
  async readPasswordExpiryData(options = {}) {
    const where = options.username ? [`BNAME = '${sapLiteral(options.username)}'`] : [];
    const fields = ['BNAME', 'USTYP', 'UFLAG', 'GLTGV', 'GLTGB', 'PWDCHGDATE', 'TRDAT', 'LTIME'];

    const [usr02Rows, fullNames] = await Promise.all([
      this._rfc.readTable('USR02', fields, where),
      this.readFullNames().catch((err) => {
        LOG.warn('readFullNames for password expiry failed, continuing without full names:', err.message);
        return new Map();
      })
    ]);

    return usr02Rows.map((row) => {
      const calc = calculatePasswordStatus(row, options);
      return {
        ...calc,
        fullName: fullNames.get(calc.username) || ''
      };
    });
  }

  /**
   * The newest USH02 row of a user, including its timestamp, actor and stable history key.
   * RFC_READ_TABLE has no ordering, so all of the user's rows are read and sorted here.
   * @returns {Promise<{lockedAt: string, changedBy: string, uflag: number, historyKey: string}|null>}
   */
  async readLastLockChange(username) {
    const rows = await this._rfc.readTable(
      'USH02',
      ['MANDT', 'BNAME', 'MODDA', 'MODTI', 'MODBE', 'TCODE', 'REPID', 'UFLAG'],
      [`BNAME = '${sapLiteral(username)}'`]
    );
    if (!rows.length) return null;
    const latest = rows.reduce((newest, row) => (compareHistoryRows(row, newest) > 0 ? row : newest));
    const cursor = historyCursor(latest);
    return { lockedAt: cursor.at, changedBy: latest.MODBE, uflag: Number(latest.UFLAG) || 0, historyKey: cursor.key };
  }

  /**
   * Reads USH02 after the durable cursor and resolves each row's preceding same-user UFLAG.
   * @param {{at: string, key: string}|null} cursor
   */
  async readLockHistory(cursor = null) {
    const rows = await readUSH02(this._rfc, cursor);
    return rows;
  }

  /** The user RFC logs on with: local env, or the BTP destination in production. */
  async getConnectionUser() {
    const { user } = await this._rfc.resolveConnectionParams();
    return String(user || '').trim().toUpperCase();
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
    // A failed read rejects, so nothing is locked.
    if (bname === await this.getConnectionUser()) {
      throw Object.assign(
        new Error(`Cannot lock user '${bname}': operation refused because it is the active RFC connection user`),
        { status: 403 }
      );
    }
    LOG.info('lockUser', { username: bname });

    const result = await this._rfc.session((call) => changeLock(call, 'BAPI_USER_LOCK', 'lock', bname));
    this.invalidateUserCache(bname);
    return result;
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

    const result = await this._rfc.session((call) => changeLock(call, 'BAPI_USER_UNLOCK', 'unlock', bname));
    this.invalidateUserCache(bname);
    return result;
  }
}

module.exports = {
  UserManagementAdapter,
  calculatePasswordStatus,
  parseSapDate,
  formatSapDate,
  addDays,
  diffCalendarDays,
  PWD_POLICY_DEFAULT_DAYS,
  PWD_WARNING_DEFAULT_DAYS
};
