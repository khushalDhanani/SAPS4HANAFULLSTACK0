'use strict';

const cds = require('@sap/cds');
const { UserManagementAdapter } = require('../integration/s4hana/admin/UserManagementAdapter');
const { protectionReason } = require('./protectedUsers');
const LOG = require('../common/logger')('user-management-service');

const MAX_REASON_LENGTH = 500;

const PROTECTED_MESSAGES = {
  self: (username) => `Cannot lock user '${username}': you cannot lock your own user`,
  type: (username) => `Cannot lock user '${username}': System and Service users are protected`,
};

/**
 * UserManagementService Handler
 *
 * Orchestrates listUsers, getUserDetail, lockUser and unlockUser.
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
      const users = await this._getAdapter().listUsers({ search, maxRows });
      LOG.info('listUsers returned', users.length, 'users');
      const context = await this._protectionContext(req);
      return users.map((user) => ({ ...user, protectedReason: protectionReason(user, context) }));
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
      const detail = await this._getAdapter().getUserDetail(username);
      LOG.info('getUserDetail returned for:', username);
      return { ...detail, protectedReason: protectionReason(detail, await this._protectionContext(req)) };
    } catch (e) {
      LOG.error('getUserDetail error:', e.message);
      return req.reject(e.status || 502, e.message || 'Failed to get user detail from SAP');
    }
  }

  async _protectionContext(req) {
    return { actor: req.user?.id, connectionUser: await this._getAdapter().getConnectionUser() };
  }

  /** Who did what to whom, and why. One line per attempt, so refused and failed attempts are recorded too. */
  _audit(req, action, username, result, reason) {
    LOG.info('AUDIT', JSON.stringify({
      who: req.user?.id, when: new Date().toISOString(), target: username, action, result, reason,
    }));
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
    return { username: username.toUpperCase(), reason };
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
    return this._changeLock(req, 'lock', async () => {
      const context = await this._protectionContext(req);
      // Only the type needs an SAP read, and the adapter itself refuses the connection user.
      const nameReason = protectionReason({ username: input.username }, context);
      const blocked = nameReason || protectionReason(await adapter.getUserDetail(input.username), context);
      if (blocked && blocked !== 'connection') {
        throw Object.assign(new Error(PROTECTED_MESSAGES[blocked](input.username)), { status: 403 });
      }
      return adapter.lockUser(input.username);
    }, input);
  }

  /**
   * unlockUser(username, reason?) — unlock SAP user account. Protection covers locking only, so a locked protected user can be recovered.
   */
  async _handleUnlockUser(req) {
    const input = this._lockInput(req);
    if (!input) return undefined;

    return this._changeLock(req, 'unlock', () => this._getAdapter().unlockUser(input.username), input);
  }
};

