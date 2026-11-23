'use strict';

const LOG = require('../common/logger')('user-management-service');
const { protectionReason } = require('./protectedUsers');
const { resolveUserIdentity } = require('../auth/userIdentity');
const lockNotifier = require('./lockNotifier');
const { audit } = require('./audit');

const MAX_REASON_LENGTH = 500;
const RUN_ID = /^[\w-]{1,64}$/;

const PROTECTED_MESSAGES = {
  self: (username) => `Cannot lock user '${username}': you cannot lock your own user`,
  type: (username) => `Cannot lock user '${username}': System and Service users are protected`,
};

/**
 * Resolves the protection context for the current user and connection user.
 */
async function getProtectionContext(service, req) {
  return {
    actor: resolveUserIdentity(req),
    connectionUser: await service._getAdapter().getConnectionUser(),
  };
}

/**
 * Records an audit log entry for user lock/unlock actions.
 */
function recordAudit(req, action, username, result, reason) {
  audit({ who: req.user?.id, target: username, action, result, reason });
}

/**
 * Validates the input common to lockUser and unlockUser; rejects and returns null when it is invalid.
 */
function validateLockInput(req) {
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

/**
 * Runs one lock or unlock, audits the outcome and rejects with SAP's own message id when SAP gave one.
 */
async function executeLockChange(service, req, action, run, { username, reason }) {
  try {
    const res = await run();
    LOG.info(`${action}User succeeded for:`, username);
    recordAudit(req, action, username, res.status || 'success', reason);
    return res;
  } catch (e) {
    LOG.error(`${action}User error:`, e.message);
    recordAudit(req, action, username, e.status === 403 ? 'refused' : 'error', reason);
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
async function handleLockUser(service, req) {
  const input = service._lockInput(req);
  if (!input) return undefined;

  const adapter = service._getAdapter();
  let locked = false;
  try {
    return await service._changeLock(req, 'lock', async () => {
      const context = await service._protectionContext(req);
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
    if (!locked) await lockNotifier.discardAppLock(input.username);
  }
}

/**
 * unlockUser(username, reason?) — unlock SAP user account.
 */
async function handleUnlockUser(service, req) {
  const input = service._lockInput(req);
  if (!input) return undefined;

  const result = await service._changeLock(req, 'unlock', async () => {
    const res = await service._getAdapter().unlockUser(input.username);
    return res;
  }, input);
  return result;
}

/**
 * getBulkLockEmailStatus(bulkRunId) — whether the lock monitor has emailed a bulk run yet.
 */
async function handleBulkLockEmailStatus(req) {
  const bulkRunId = String(req.data.bulkRunId ?? '').trim();
  if (!RUN_ID.test(bulkRunId)) return req.reject(400, 'bulkRunId is required');
  return lockNotifier.bulkEmailStatus(bulkRunId);
}

module.exports = {
  getProtectionContext,
  recordAudit,
  validateLockInput,
  executeLockChange,
  handleLockUser,
  handleUnlockUser,
  handleBulkLockEmailStatus,
};
