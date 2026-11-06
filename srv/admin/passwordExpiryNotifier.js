'use strict';

const mailer = require('../common/mailer');
const store = require('./passwordExpiryStore');
const { buildPasswordExpiryEmail } = require('./passwordExpiryEmail');
const LOG = require('../common/logger')('password-expiry-notifier');

const DEFAULT_INTERVAL_SEC = 86400; // 24 hours
const DEFAULT_EXPIRATION_DAYS = 90;
const DEFAULT_WARNING_DAYS = 14;

const recipients = (env = process.env) =>
  String(env.PWD_NOTIFY_TO || env.LOCK_NOTIFY_TO || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const isEnabled = () => mailer.isConfigured() && recipients().length > 0;

function positiveInt(value, fallback, { allowZero = false } = {}) {
  const n = Number(value);
  const valid = value !== undefined && value !== '' && Number.isInteger(n) && (allowZero ? n >= 0 : n > 0);
  return valid ? n : fallback;
}

const pollIntervalSec = (env = process.env) =>
  positiveInt(env.PWD_POLL_INTERVAL_SEC, DEFAULT_INTERVAL_SEC, { allowZero: true });

const expirationDays = (env = process.env) =>
  positiveInt(env.SAP_PASSWORD_EXPIRATION_DAYS, DEFAULT_EXPIRATION_DAYS);

const warningDays = (env = process.env) =>
  positiveInt(env.SAP_PASSWORD_WARNING_DAYS, DEFAULT_WARNING_DAYS);

const isWorker = () => (process.env.CF_INSTANCE_INDEX ?? '0') === '0';

function formatCycleDate(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

let timer = null;
let running = false;
let lastCycleStatus = null;

/**
 * Executes a single password expiry check cycle.
 *
 * @param {Function} getAdapter - returns UserManagementAdapter instance
 * @param {Date} [now=new Date()] - current reference time
 * @returns {Promise<object>} cycle execution metrics
 */
async function pollOnce(getAdapter, now = new Date()) {
  if (running) {
    LOG.warn('Previous password expiry poll cycle still active, skipping overlapping execution');
    return { skipped: true };
  }

  running = true;
  const startMs = Date.now();
  const nowIso = now.toISOString();
  const cycleDate = formatCycleDate(now);
  const workerId = store.generateWorkerId();

  try {
    const adapter = typeof getAdapter === 'function' ? getAdapter() : getAdapter;
    if (!adapter) throw new Error('UserManagementAdapter is unavailable');

    const users = await adapter.readPasswordExpiryData({
      expirationDays: expirationDays(),
      warningDays: warningDays(),
      referenceDate: now
    });

    const counts = {
      valid: 0,
      expiringSoon: 0,
      expired: 0,
      initial: 0,
      exempt: 0
    };

    for (const u of users) {
      if (u.pwdStatus === 'exempt') counts.exempt++;
      else if (u.pwdStatus === 'initial') counts.initial++;
      else if (u.pwdStatus === 'expired') counts.expired++;
      else if (u.pwdStatus === 'expiring_soon') counts.expiringSoon++;
      else counts.valid++;
    }

    // Persist snapshots and queue milestone alerts
    await store.commitCycle({ users, cycleDate, nowIso });

    let dispatchedAt = null;
    let dispatchedCount = 0;

    // Dispatch pending notifications if email alerting is enabled
    if (isEnabled()) {
      const claimed = await store.claimPendingEvents(workerId, {
        limit: 100,
        nowIso
      });

      if (claimed.length > 0) {
        try {
          const email = buildPasswordExpiryEmail(claimed, {
            appUrl: process.env.APP_URL,
            policyDays: expirationDays()
          });

          await mailer.send({
            to: recipients(),
            subject: email.subject,
            text: email.text,
            html: email.html
          });

          dispatchedAt = new Date().toISOString();
          dispatchedCount = claimed.length;
          await store.completeEvents(claimed, { sentAt: dispatchedAt });
          LOG.info('Password expiry notification sent for', claimed.length, 'users');
        } catch (mailErr) {
          LOG.error('Failed to send password expiry notification email:', mailErr.message);
          const nextRetry = new Date(Date.now() + 60 * 1000).toISOString();
          await store.releaseOrFailEvents(claimed, {
            lastError: mailErr.code || mailErr.message,
            nextRetryAt: nextRetry
          });
        }
      }
    }

    const durationMs = Date.now() - startMs;
    await store.recordMonitorHealth({
      status: 'ok',
      durationMs,
      totalMonitored: users.length,
      counts,
      dispatchedAt,
      nowIso
    });

    lastCycleStatus = {
      status: 'ok',
      durationMs,
      totalMonitored: users.length,
      counts,
      dispatchedCount,
      timestamp: nowIso
    };

    return lastCycleStatus;
  } catch (err) {
    const durationMs = Date.now() - startMs;
    LOG.error('Password expiry poll cycle failed:', err.message);

    try {
      await store.recordMonitorHealth({
        status: 'failed',
        durationMs,
        errorMessage: err.message,
        nowIso
      });
    } catch (storeErr) {
      LOG.warn('Could not record monitor failure:', storeErr.message);
    }

    lastCycleStatus = {
      status: 'failed',
      durationMs,
      error: err.message,
      timestamp: nowIso
    };

    return lastCycleStatus;
  } finally {
    running = false;
  }
}

/**
 * Starts the recurring password expiry check daemon.
 */
function startJob(getAdapter) {
  if (timer) return;
  const interval = pollIntervalSec();
  if (interval <= 0) {
    LOG.info('Password expiry monitor daemon is disabled (PWD_POLL_INTERVAL_SEC=0)');
    return;
  }

  if (!isWorker()) {
    LOG.info('Password expiry monitor disabled on secondary Cloud Foundry instance (CF_INSTANCE_INDEX != 0)');
    return;
  }

  if (process.env.NODE_ENV === 'test') {
    LOG.info('Password expiry monitor daemon skipped in test environment');
    return;
  }

  LOG.info('Starting password expiry monitor daemon; interval:', interval, 'seconds');
  timer = setInterval(() => {
    pollOnce(getAdapter).catch((err) => LOG.error('Unhandled error in password expiry poll:', err.message));
  }, interval * 1000);

  // Run initial cycle shortly after startup (10s delay to let server bootstrap)
  setTimeout(() => {
    pollOnce(getAdapter).catch((err) => LOG.error('Initial password expiry poll error:', err.message));
  }, 10 * 1000);
}

/**
 * Stops the daemon.
 */
function stopJob() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

function monitorStatus() {
  return lastCycleStatus;
}

function _resetStatusForTest() {
  lastCycleStatus = null;
  running = false;
}

module.exports = {
  pollOnce,
  startJob,
  stopJob,
  monitorStatus,
  _resetStatusForTest,
  isEnabled,
  recipients,
  pollIntervalSec,
  expirationDays,
  warningDays,
  isWorker,
  formatCycleDate
};
