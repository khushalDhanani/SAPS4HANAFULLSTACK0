'use strict';

const cds = require('@sap/cds');
const { UserManagementAdapter } = require('../integration/s4hana/admin/UserManagementAdapter');
const lockNotifier = require('./lockNotifier');
const passwordExpiryNotifier = require('./passwordExpiryNotifier');

const {
  getProtectionContext,
  recordAudit,
  validateLockInput,
  executeLockChange,
  handleLockUser,
  handleUnlockUser,
  handleBulkLockEmailStatus,
} = require('./AdminUserLockHandler');

const {
  handleListUsers,
  handleGetUserDetail,
  handleRunIntegrationDiagnostics,
} = require('./AdminUserQueryHandler');

const {
  handleGetPasswordExpirySummary,
  handleGetPasswordExpiryList,
  handleGetPasswordExpiryMonitor,
} = require('./AdminPasswordExpiryHandler');

/**
 * UserManagementService Handler
 *
 * Orchestrates listUsers, getUserDetail, lockUser and unlockUser, and answers for the lock monitor.
 * All actions require the Admin role (declared in service.cds).
 */
module.exports = class UserManagementService extends cds.ApplicationService {
  async init() {
    this._adapter = null;

    this.on('listUsers', this._handleListUsers.bind(this));
    this.on('getUserDetail', this._handleGetUserDetail.bind(this));
    this.on('lockUser', this._handleLockUser.bind(this));
    this.on('unlockUser', this._handleUnlockUser.bind(this));
    this.on('getLockMonitor', () => lockNotifier.monitorStatus());
    this.on('getBulkLockEmailStatus', this._handleBulkLockEmailStatus.bind(this));
    this.on('getPasswordExpirySummary', this._handleGetPasswordExpirySummary.bind(this));
    this.on('getPasswordExpiryList', this._handleGetPasswordExpiryList.bind(this));
    this.on('getPasswordExpiryMonitor', this._handleGetPasswordExpiryMonitor.bind(this));
    this.on('runIntegrationDiagnostics', this._handleRunIntegrationDiagnostics.bind(this));

    lockNotifier.startJob(() => this._getAdapter());
    passwordExpiryNotifier.startJob(() => this._getAdapter());

    await super.init();
  }

  _getAdapter() {
    if (!this._adapter) this._adapter = new UserManagementAdapter();
    return this._adapter;
  }

  async _handleListUsers(req) {
    return handleListUsers(this, req);
  }

  async _handleGetUserDetail(req) {
    return handleGetUserDetail(this, req);
  }

  async _protectionContext(req) {
    return getProtectionContext(this, req);
  }

  _audit(req, action, username, result, reason) {
    recordAudit(req, action, username, result, reason);
  }

  _lockInput(req) {
    return validateLockInput(req);
  }

  async _changeLock(req, action, run, payload) {
    return executeLockChange(this, req, action, run, payload);
  }

  async _handleLockUser(req) {
    return handleLockUser(this, req);
  }

  async _handleUnlockUser(req) {
    return handleUnlockUser(this, req);
  }

  async _handleBulkLockEmailStatus(req) {
    return handleBulkLockEmailStatus(req);
  }

  async _handleGetPasswordExpirySummary(req) {
    return handleGetPasswordExpirySummary(this._getAdapter(), req);
  }

  async _handleGetPasswordExpiryList(req) {
    return handleGetPasswordExpiryList(this._getAdapter(), req);
  }

  async _handleGetPasswordExpiryMonitor(req) {
    return handleGetPasswordExpiryMonitor(req);
  }

  async _handleRunIntegrationDiagnostics(req) {
    return handleRunIntegrationDiagnostics(req);
  }
};
