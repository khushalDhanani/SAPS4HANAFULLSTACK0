'use strict';

const LOG = require('../common/logger')('user-management-service');

/**
 * AdminPasswordExpiryHandler
 *
 * Handles password expiry summary, list, and monitor status queries.
 */

/**
 * getPasswordExpirySummary() — aggregated counts for dashboard tiles.
 */
async function handleGetPasswordExpirySummary(adapter, req) {
  try {
    const users = await adapter.readPasswordExpiryData();
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
      warningDays,
    };
  } catch (e) {
    LOG.error('getPasswordExpirySummary error:', e.message);
    return req.reject(e.status || 502, e.message || 'Failed to calculate password expiry summary');
  }
}

/**
 * getPasswordExpiryList(search?, status?, maxRows?) — filtered list of users with password expiry attributes.
 */
async function handleGetPasswordExpiryList(adapter, req) {
  const search = (req.data.search || '').trim().toLowerCase();
  const status = (req.data.status || '').trim().toLowerCase();
  const rawMax = req.data.maxRows;
  const maxRows = (rawMax === undefined || rawMax === null || rawMax === '') ? 200 : Number(rawMax);

  if (!Number.isFinite(maxRows) || maxRows < 1 || maxRows > 1000) {
    return req.reject(400, 'maxRows must be between 1 and 1000');
  }

  try {
    let users = await adapter.readPasswordExpiryData();

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
async function handleGetPasswordExpiryMonitor(req) {
  const cds = require('@sap/cds');
  const emptyMonitor = {
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
    errorMessage: '',
  };

  try {
    if (!cds.db) {
      return emptyMonitor;
    }

    const monitor = await cds.db.run(cds.ql.SELECT.one.from('saps4hana.admin.PasswordExpiryMonitor').where({ id: 'main' }));
    if (!monitor) {
      return emptyMonitor;
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
      errorMessage: monitor.errorMessage || '',
    };
  } catch (e) {
    LOG.error('getPasswordExpiryMonitor error:', e.message);
    return req.reject(e.status || 502, e.message || 'Failed to retrieve password expiry monitor status');
  }
}

module.exports = {
  handleGetPasswordExpirySummary,
  handleGetPasswordExpiryList,
  handleGetPasswordExpiryMonitor,
};
