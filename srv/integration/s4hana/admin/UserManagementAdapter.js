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
  PWD_POLICY_DEFAULT_DAYS,
  PWD_WARNING_DEFAULT_DAYS,
  parseSapDate,
  formatSapDate,
  addDays,
  diffCalendarDays,
  calculatePasswordStatus,
} = require('./UserPasswordExpiryUtil');

const { readUserDetail } = require('./UserDetailReader');
const { changeLock } = require('./UserLockCoordinator');
const { LIST_DETAIL_CONNECTIONS, enrichUserList } = require('./UserListEnricher');
const {
  readLockFlags,
  readFullNames,
  readPasswordExpiryData,
  readLastLockChange,
  readLockHistory,
} = require('./UserTableReader');

class UserManagementAdapter {
  /**
   * @param {object} [options]
   * @param {RfcClient} [options.rfcClient] - injected for tests
   * @param {number} [options.detailCacheTtlMs] - TTL for user details cache (default 60s)
   * @param {number} [options.listCacheTtlMs] - TTL for user list cache (default 30s)
   * @param {number} [options.listDetailConnections] - max connections for list enrichment
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
   * Returns up to maxRows users, enriched with BAPI_USER_GET_DETAIL reads on bounded RFC connections.
   *
   * @param {object} [params]
   * @param {string} [params.search]        - substring filter on USERNAME (case-insensitive)
   * @param {number} [params.maxRows]       - max rows to fetch from SAP (default 200)
   * @param {boolean} [params.forceRefresh] - bypass cache and fetch fresh from SAP
   * @returns {Promise<Array<object>>}
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
          ? userList.filter((u) => (u.USERNAME || '').toLowerCase().includes(needle))
          : userList;

        const enriched = await enrichUserList({
          rfc: this._rfc,
          call,
          filtered,
          forceRefresh,
          getCachedDetail: (u) => this._getCachedDetail(u),
          setCachedDetail: (u, d) => this._setCachedDetail(u, d),
          listDetailConnections: this._listDetailConnections,
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

  async readLockFlags(username) {
    return readLockFlags(this._rfc, username);
  }

  async readFullNames() {
    return readFullNames(this._rfc);
  }

  async readPasswordExpiryData(options = {}) {
    return readPasswordExpiryData(this._rfc, options);
  }

  async readLastLockChange(username) {
    return readLastLockChange(this._rfc, username);
  }

  async readLockHistory(cursor = null) {
    return readLockHistory(this._rfc, cursor);
  }

  /** The user RFC logs on with: local env, or the BTP destination in production. */
  async getConnectionUser() {
    const { user } = await this._rfc.resolveConnectionParams();
    return String(user || '').trim().toUpperCase();
  }

  /**
   * Lock an SAP user account via BAPI_USER_LOCK + BAPI_TRANSACTION_COMMIT.
   *
   * @param {string} username
   * @returns {Promise<{success: boolean, message: string, username: string}>}
   */
  async lockUser(username) {
    if (!username || typeof username !== 'string' || !username.trim()) {
      throw Object.assign(new Error('username is required'), { status: 400 });
    }
    const bname = username.trim().toUpperCase();
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
  PWD_WARNING_DEFAULT_DAYS,
};
