'use strict';

const cds = require('@sap/cds');
const { UserManagementAdapter } = require('../integration/s4hana/admin/UserManagementAdapter');
const LOG = require('../common/logger')('user-management-service');

/**
 * UserManagementService Handler — Phase 1 (read-only)
 *
 * Orchestrates listUsers and getUserDetail actions.
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
      return users;
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
      return detail;
    } catch (e) {
      LOG.error('getUserDetail error:', e.message);
      return req.reject(e.status || 502, e.message || 'Failed to get user detail from SAP');
    }
  }

  /**
   * lockUser(username) — lock SAP user account.
   */
  async _handleLockUser(req) {
    const username = (req.data.username || '').trim();
    if (!username) return req.reject(400, 'username is required');

    if (!/^[A-Z0-9@._-]{1,40}$/i.test(username)) {
      return req.reject(400, 'username contains invalid characters');
    }

    try {
      const res = await this._getAdapter().lockUser(username);
      LOG.info('lockUser succeeded for:', username);
      return res;
    } catch (e) {
      LOG.error('lockUser error:', e.message);
      return req.reject(e.status || 502, e.message || 'Failed to lock user in SAP');
    }
  }

  /**
   * unlockUser(username) — unlock SAP user account.
   */
  async _handleUnlockUser(req) {
    const username = (req.data.username || '').trim();
    if (!username) return req.reject(400, 'username is required');

    if (!/^[A-Z0-9@._-]{1,40}$/i.test(username)) {
      return req.reject(400, 'username contains invalid characters');
    }

    try {
      const res = await this._getAdapter().unlockUser(username);
      LOG.info('unlockUser succeeded for:', username);
      return res;
    } catch (e) {
      LOG.error('unlockUser error:', e.message);
      return req.reject(e.status || 502, e.message || 'Failed to unlock user in SAP');
    }
  }
};

