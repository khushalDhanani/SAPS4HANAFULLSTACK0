'use strict';

const cds = require('@sap/cds');
const { UserManagementAdapter } = require('../integration/s4hana/admin/UserManagementAdapter');
const { protectionReason } = require('./protectedUsers');
const { resolveUserIdentity } = require('../auth/userIdentity');
const lockNotifier = require('./lockNotifier');
const passwordExpiryNotifier = require('./passwordExpiryNotifier');
const { audit } = require('./audit');
const LOG = require('../common/logger')('user-management-service');

const MAX_REASON_LENGTH = 500;
const RUN_ID = /^[\w-]{1,64}$/;

const PROTECTED_MESSAGES = {
  self: (username) => `Cannot lock user '${username}': you cannot lock your own user`,
  type: (username) => `Cannot lock user '${username}': System and Service users are protected`,
};

/**
 * UserManagementService Handler
 *
 * Orchestrates listUsers, getUserDetail, lockUser and unlockUser, and answers for the lock monitor.
 * All actions require the Admin role (declared in service.cds).
 *
 * Input validation happens here before the adapter is called.
 * Error surfacing maps adapter/SAP errors to CAP req.error().
 */
module.exports = class UserManagementService extends cds.ApplicationService {
  async init() {
    // Lazy singleton — one adapter instance per service lifetime (reuses RFC connection params)
    this._adapter = null;

    this.on('listUsers',    this._handleListUsers.bind(this));
    this.on('getUserDetail', this._handleGetUserDetail.bind(this));
    this.on('lockUser',     this._handleLockUser.bind(this));
    this.on('unlockUser',   this._handleUnlockUser.bind(this));
    this.on('getLockMonitor', () => lockNotifier.monitorStatus());
    this.on('getBulkLockEmailStatus', this._handleBulkLockEmailStatus.bind(this));
    this.on('getPasswordExpirySummary', this._handleGetPasswordExpirySummary.bind(this));
    this.on('getPasswordExpiryList', this._handleGetPasswordExpiryList.bind(this));
    this.on('getPasswordExpiryMonitor', this._handleGetPasswordExpiryMonitor.bind(this));

    lockNotifier.startJob(() => this._getAdapter());
    passwordExpiryNotifier.startJob(() => this._getAdapter());

    await super.init();
  }

  _getAdapter() {
    if (!this._adapter) this._adapter = new UserManagementAdapter();
    return this._adapter;
  }

  /**
   * listUsers(search?, maxRows?) — list SAP users, optionally filtered.
   */
  async _handleListUsers(req) {
    const search  = (req.data.search  || '').trim();
    const rawMax  = req.data.maxRows;
    const maxRows = (rawMax === undefined || rawMax === null || rawMax === '') ? 200 : Number(rawMax);

    if (!Number.isFinite(maxRows) || maxRows < 1 || maxRows > 1000) {
      return req.reject(400, 'maxRows must be between 1 and 1000');
    }

    try {
      const [users, context, expiryData] = await Promise.all([
        this._getAdapter().listUsers({ search, maxRows }),
        this._protectionContext(req),
        this._getAdapter().readPasswordExpiryData().catch((err) => {
          LOG.warn('readPasswordExpiryData failed, continuing without expiry fields:', err.message);
          return [];
        })
      ]);
      const expiryMap = new Map((expiryData || []).map((e) => [e.username, e]));
      LOG.info('listUsers returned', users.length, 'users');
      return users.map((user) => {
        const exp = expiryMap.get(user.username);
        return {
          ...user,
          protectedReason: protectionReason(user, context),
          pwdLastChanged: exp?.pwdLastChanged || '',
          pwdExpiresAt: exp?.pwdExpiresAt || '',
          pwdDaysRemaining: exp?.pwdDaysRemaining ?? null,
          pwdStatus: exp?.pwdStatus || 'valid'
        };
      });
    } catch (e) {
      LOG.error('listUsers error:', e.message);
      return req.reject(e.status || 502, e.message || 'Failed to list SAP users');
    }
  }

  /**
   * getUserDetail(username) — full SU01 detail for one user.
   */
  async _handleGetUserDetail(req) {
    const username = (req.data.username || '').trim();
    if (!username) return req.reject(400, 'username is required');

    // Username must be a valid SAP logon name: uppercase alphanumeric + some special chars, max 40
    if (!/^[A-Z0-9@._-]{1,40}$/i.test(username)) {
      return req.reject(400, 'username contains invalid characters');
    }

    try {
      const [detail, context, [expiryItem]] = await Promise.all([
        this._getAdapter().getUserDetail(username),
        this._protectionContext(req),
        this._getAdapter().readPasswordExpiryData({ username }).catch((err) => {
          LOG.warn('readPasswordExpiryData for user detail failed:', err.message);
          return [];
        })
      ]);
      LOG.info('getUserDetail returned for:', username);
      return {
        ...detail,
        protectedReason: protectionReason(detail, context),
        pwdLastChanged: expiryItem?.pwdLastChanged || '',
        pwdExpiresAt: expiryItem?.pwdExpiresAt || '',
        pwdDaysRemaining: expiryItem?.pwdDaysRemaining ?? null,
        pwdStatus: expiryItem?.pwdStatus || 'valid'
      };
    } catch (e) {
      LOG.error('getUserDetail error:', e.message);
      return req.reject(e.status || 502, e.message || 'Failed to get user detail from SAP');
    }
  }

  async _protectionContext(req) {
    // The SAP logon, not the raw CAP id, which can be an email under XSUAA.
    return { actor: resolveUserIdentity(req), connectionUser: await this._getAdapter().getConnectionUser() };
  }

  /** Who did what to whom, and why. */
  _audit(req, action, username, result, reason) {
    audit({ who: req.user?.id, target: username, action, result, reason });
  }

  /** Validates the input common to lockUser and unlockUser; rejects and returns null when it is invalid. */
  _lockInput(req) {
    const username = (req.data.username || '').trim();
    if (!username) return req.reject(400, 'username is required');

    if (!/^[A-Z0-9@._-]{1,40}$/i.test(username)) {
      return req.reject(400, 'username contains invalid characters');
    }

    const reason = String(req.data.reason ?? '').trim();
    if (reason.length > MAX_REASON_LENGTH) {
      return req.reject(400, `reason must be at most ${MAX_REASON_LENGTH} characters`);
    }
    const bulkRunId = String(req.data.bulkRunId ?? '').trim();
    if (bulkRunId && !RUN_ID.test(bulkRunId)) {
      return req.reject(400, 'bulkRunId contains invalid characters');
    }
    return { username: username.toUpperCase(), reason, bulkRunId };
  }

  /** Runs one lock or unlock, audits the outcome and rejects with SAP's own message id when SAP gave one. */
  async _changeLock(req, action, run, { username, reason }) {
    try {
      const res = await run();
      LOG.info(`${action}User succeeded for:`, username);
      this._audit(req, action, username, res.status || 'success', reason);
      return res;
    } catch (e) {
      LOG.error(`${action}User error:`, e.message);
      this._audit(req, action, username, e.status === 403 ? 'refused' : 'error', reason);
      const status = e.status || 502;
      const message = e.message || `Failed to ${action} user in SAP`;
      return e.sapMessage
        ? req.reject({ status, code: `${e.sapMessage.id}/${e.sapMessage.number}`, message })
        : req.reject(status, message);
    }
  }

  /**
   * lockUser(username, reason?) — lock SAP user account, unless it is protected.
   */
  async _handleLockUser(req) {
    const input = this._lockInput(req);
    if (!input) return undefined;

    const adapter = this._getAdapter();
    let locked = false;
    try {
      return await this._changeLock(req, 'lock', async () => {
        const context = await this._protectionContext(req);
        // Only the type needs an SAP read, and the adapter itself refuses the connection user.
        const nameReason = protectionReason({ username: input.username }, context);
        let userDetail = null;
        if (!nameReason) {
          userDetail = await adapter.getUserDetail(input.username);
        }
        const blocked = nameReason || protectionReason(userDetail, context);
        if (blocked && blocked !== 'connection') {
          throw Object.assign(new Error(PROTECTED_MESSAGES[blocked](input.username)), { status: 403 });
        }
        let priorHistoryKey = '';
        let historyBaselineRead = false;
        if (lockNotifier.isEnabled()) {
          try {
            const previousChange = await adapter.readLastLockChange(input.username);
            priorHistoryKey = previousChange ? previousChange.historyKey : '';
            historyBaselineRead = true;
          } catch (e) {
            LOG.warn('Could not read the previous lock history for', input.username, e.message);
          }
        }
        // Written first: the monitor may see the lock before this request ends.
        await lockNotifier.recordAppLock({ ...input, actor: context.actor });
        const res = await adapter.lockUser(input.username);
        locked = true;
        if (lockNotifier.isEnabled()) {
          let change = null;
          if (historyBaselineRead) {
            try {
              const latestChange = await adapter.readLastLockChange(input.username);
              if (latestChange && latestChange.uflag && latestChange.historyKey !== priorHistoryKey) {
                change = latestChange;
              }
            } catch (e) {
              LOG.warn('Could not link the app lock audit to SAP history for', input.username, e.message);
            }
          }

          if (input.bulkRunId) {
            if (change) {
              await lockNotifier.recordAppLockHistory(input.username, change.historyKey);
            }
          } else {
            const fullName = userDetail?.fullName || '';
            await lockNotifier.notifyAppLock({
              username: input.username,
              actor: context.actor,
              reason: input.reason,
              fullName,
              change,
            });
          }
        }
        return res;
      }, input);
    } finally {
      // In finally, because req.reject throws: a failed lock must not leave a note to mislabel a later one.
      if (!locked) await lockNotifier.discardAppLock(input.username);
    }
  }

  /**
   * unlockUser(username, reason?) — unlock SAP user account. Protection covers locking only, so a locked protected user can be recovered.
   */
  async _handleUnlockUser(req) {
    const input = this._lockInput(req);
    if (!input) return undefined;

    const result = await this._changeLock(req, 'unlock', async () => {
      const res = await this._getAdapter().unlockUser(input.username);
      return res;
    }, input);
    return result;
  }

  /**
   * getBulkLockEmailStatus(bulkRunId) — whether the lock monitor has emailed a bulk run yet.
   */
  async _handleBulkLockEmailStatus(req) {
    const bulkRunId = String(req.data.bulkRunId ?? '').trim();
    if (!RUN_ID.test(bulkRunId)) return req.reject(400, 'bulkRunId is required');
    return lockNotifier.bulkEmailStatus(bulkRunId);
  }

  /**
   * getPasswordExpirySummary() — aggregated counts for dashboard tiles.
   */
  async _handleGetPasswordExpirySummary(req) {
    try {
      const users = await this._getAdapter().readPasswordExpiryData();
      const expirationDays = parseInt(process.env.SAP_PASSWORD_EXPIRATION_DAYS, 10) || 90;
      const warningDays = parseInt(process.env.SAP_PASSWORD_WARNING_DAYS, 10) || 14;

      let valid = 0;
      let expiringSoon = 0;
      let criticalExpiring = 0;
      let expired = 0;
      let initialPassword = 0;
      let exempt = 0;

      for (const u of users) {
        if (u.pwdStatus === 'exempt') exempt++;
        else if (u.pwdStatus === 'initial') initialPassword++;
        else if (u.pwdStatus === 'expired') expired++;
        else if (u.pwdStatus === 'expiring_soon') {
          expiringSoon++;
          if (u.pwdDaysRemaining !== null && u.pwdDaysRemaining <= 3) criticalExpiring++;
        } else {
          valid++;
        }
      }

      return {
        totalMonitored: users.length,
        valid,
        expiringSoon,
        criticalExpiring,
        expired,
        initialPassword,
        exempt,
        policyDays: expirationDays,
        warningDays
      };
    } catch (e) {
      LOG.error('getPasswordExpirySummary error:', e.message);
      return req.reject(e.status || 502, e.message || 'Failed to calculate password expiry summary');
    }
  }

  /**
   * getPasswordExpiryList(search?, status?, maxRows?) — filtered list of users with password expiry attributes.
   */
  async _handleGetPasswordExpiryList(req) {
    const search = (req.data.search || '').trim().toLowerCase();
    const status = (req.data.status || '').trim().toLowerCase();
    const rawMax = req.data.maxRows;
    const maxRows = (rawMax === undefined || rawMax === null || rawMax === '') ? 200 : Number(rawMax);

    if (!Number.isFinite(maxRows) || maxRows < 1 || maxRows > 1000) {
      return req.reject(400, 'maxRows must be between 1 and 1000');
    }

    try {
      let users = await this._getAdapter().readPasswordExpiryData();

      if (status) {
        users = users.filter((u) => u.pwdStatus === status);
      }
      if (search) {
        users = users.filter((u) =>
          (u.username && u.username.toLowerCase().includes(search)) ||
          (u.fullName && u.fullName.toLowerCase().includes(search))
        );
      }

      return users.slice(0, maxRows);
    } catch (e) {
      LOG.error('getPasswordExpiryList error:', e.message);
      return req.reject(e.status || 502, e.message || 'Failed to list password expiry data');
    }
  }

  /**
   * getPasswordExpiryMonitor() — daemon run health status.
   */
  async _handleGetPasswordExpiryMonitor(req) {
    try {
      if (!cds.db) {
        return {
          state: 'off',
          lastRunAt: null,
          lastStatus: 'off',
          lastRunDurationMs: 0,
          totalMonitoredUsers: 0,
          expiringSoonCount: 0,
          expiredCount: 0,
          initialPasswordCount: 0,
          exemptCount: 0,
          lastNotificationDispatchedAt: null,
          pendingNotificationCount: 0,
          failedNotificationCount: 0,
          errorMessage: ''
        };
      }

      const monitor = await cds.db.run(cds.ql.SELECT.one.from('saps4hana.admin.PasswordExpiryMonitor').where({ id: 'main' }));
      if (!monitor) {
        return {
          state: 'off',
          lastRunAt: null,
          lastStatus: 'off',
          lastRunDurationMs: 0,
          totalMonitoredUsers: 0,
          expiringSoonCount: 0,
          expiredCount: 0,
          initialPasswordCount: 0,
          exemptCount: 0,
          lastNotificationDispatchedAt: null,
          pendingNotificationCount: 0,
          failedNotificationCount: 0,
          errorMessage: ''
        };
      }

      return {
        state: monitor.lastStatus === 'ok' ? 'ok' : 'failed',
        lastRunAt: monitor.lastRunAt,
        lastStatus: monitor.lastStatus,
        lastRunDurationMs: monitor.lastRunDurationMs || 0,
        totalMonitoredUsers: monitor.totalMonitoredUsers || 0,
        expiringSoonCount: monitor.expiringSoonCount || 0,
        expiredCount: monitor.expiredCount || 0,
        initialPasswordCount: monitor.initialPasswordCount || 0,
        exemptCount: monitor.exemptCount || 0,
        lastNotificationDispatchedAt: monitor.lastNotificationDispatchedAt,
        pendingNotificationCount: monitor.pendingNotificationCount || 0,
        failedNotificationCount: monitor.failedNotificationCount || 0,
        errorMessage: monitor.errorMessage || ''
      };
    } catch (e) {
      LOG.error('getPasswordExpiryMonitor error:', e.message);
      return req.reject(e.status || 502, e.message || 'Failed to retrieve password expiry monitor status');
    }
  }
};
