'use strict';

const LOG = require('../common/logger')('user-management-service');
const { protectionReason } = require('./protectedUsers');

/**
 * AdminUserQueryHandler
 *
 * Handles listUsers, getUserDetail, and runIntegrationDiagnostics requests.
 */

/**
 * listUsers(search?, maxRows?) — list SAP users, optionally filtered.
 */
async function handleListUsers(service, req) {
  const search = (req.data.search || '').trim();
  const rawMax = req.data.maxRows;
  const maxRows = (rawMax === undefined || rawMax === null || rawMax === '') ? 200 : Number(rawMax);

  if (!Number.isFinite(maxRows) || maxRows < 1 || maxRows > 1000) {
    return req.reject(400, 'maxRows must be between 1 and 1000');
  }

  try {
    const [users, context, expiryData] = await Promise.all([
      service._getAdapter().listUsers({ search, maxRows }),
      service._protectionContext(req),
      service._getAdapter().readPasswordExpiryData().catch((err) => {
        LOG.warn('readPasswordExpiryData failed, continuing without expiry fields:', err.message);
        return [];
      }),
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
        pwdStatus: exp?.pwdStatus || 'valid',
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
async function handleGetUserDetail(service, req) {
  const username = (req.data.username || '').trim();
  if (!username) return req.reject(400, 'username is required');

  if (!/^[A-Z0-9@._-]{1,40}$/i.test(username)) {
    return req.reject(400, 'username contains invalid characters');
  }

  try {
    const [detail, context, [expiryItem]] = await Promise.all([
      service._getAdapter().getUserDetail(username),
      service._protectionContext(req),
      service._getAdapter().readPasswordExpiryData({ username }).catch((err) => {
        LOG.warn('readPasswordExpiryData for user detail failed:', err.message);
        return [];
      }),
    ]);
    LOG.info('getUserDetail returned for:', username);
    return {
      ...detail,
      protectedReason: protectionReason(detail, context),
      pwdLastChanged: expiryItem?.pwdLastChanged || '',
      pwdExpiresAt: expiryItem?.pwdExpiresAt || '',
      pwdDaysRemaining: expiryItem?.pwdDaysRemaining ?? null,
      pwdStatus: expiryItem?.pwdStatus || 'valid',
    };
  } catch (e) {
    LOG.error('getUserDetail error:', e.message);
    return req.reject(e.status || 502, e.message || 'Failed to get user detail from SAP');
  }
}

/**
 * runIntegrationDiagnostics(channel?) — execute 6-stage read-only integration diagnostic.
 */
async function handleRunIntegrationDiagnostics(req) {
  try {
    const channel = (req.data && req.data.channel) || 'all';
    const { runIntegrationDiagnostics } = require('../common/integrationDiagnostics');
    const user = req.user?.id || 'admin';
    const report = await runIntegrationDiagnostics({ channel, user });

    const flatStages = [
      ...(report.channels.odata?.stages || []),
      ...(report.channels.rfc?.stages || []),
    ];

    return {
      timestamp: report.timestamp,
      channel: report.channel,
      overallStatus: report.overallStatus,
      targetClient: report.targetClient,
      systemLabel: report.systemLabel,
      operator: report.operator,
      readOnlyNotice: report.readOnlyNotice,
      summary: report.summary,
      stages: flatStages,
    };
  } catch (e) {
    LOG.error('runIntegrationDiagnostics error:', e.message);
    return req.reject(e.status || 502, e.message || 'Failed to execute integration diagnostics');
  }
}

module.exports = {
  handleListUsers,
  handleGetUserDetail,
  handleRunIntegrationDiagnostics,
};
