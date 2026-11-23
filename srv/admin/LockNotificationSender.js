'use strict';

/**
 * LockNotificationSender
 *
 * Atomically claims and dispatches email notifications for pending user lock events.
 */

const mailer = require('../common/mailer');
const store = require('./lockEventStore');
const { buildLockEmail } = require('./lockEmail');
const { audit } = require('./audit');
const LOG = require('../common/logger')('lock-monitor');

const {
  DEFAULT_LEASE_MS,
  DEFAULT_MAX_ATTEMPTS,
  defaultRetryDelays,
  recipients,
  maxPerEmail,
} = require('./LockNotifierConfig');

const {
  SOURCE_APP,
  calculateNextRetry,
} = require('./LockDiffEngine');

const errorCode = (e) => String((e && (e.responseCode || e.code || e.message)) || 'send-failed').slice(0, 60);

const wait = (ms) => new Promise((resolve) => {
  const timer = setTimeout(resolve, ms);
  if (timer.unref) timer.unref();
});

function auditLocks(events, result) {
  events.forEach((event) => audit({
    who: event.source === SOURCE_APP ? event.lockedBy : 'system',
    target: event.username,
    action: 'lock-detected',
    result,
    reason: event.reason || '',
  }));
}

/**
 * Sends everything waiting in one email: a first attempt and 3 retries, then the events stay queued for the next
 * cycle. Delivery is at-least-once, not exactly-once: SMTP accepting a mail and the database recording it are two
 * steps, and a crash or database failure between them can repeat that one email. The notification table is the history.
 * Uses atomic database-backed claiming to ensure that two workers or instances never send the same email concurrently.
 * Never throws, so a mail failure cannot affect the poller, and it cannot reach a lock at all.
 */
async function sendPending({
  retryDelays = defaultRetryDelays(),
  workerId,
  now = new Date(),
  leaseDurationMs = DEFAULT_LEASE_MS,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  limit = 1000,
} = {}) {
  const events = await store.claimPendingEvents({
    workerId: workerId || store.generateWorkerId(),
    now,
    leaseDurationMs,
    limit,
  });
  if (!events.length) return 'none';

  const mail = {
    to: recipients().join(', '),
    ...buildLockEmail(events, { appUrl: process.env.LOCK_NOTIFY_APP_URL, maxListed: maxPerEmail() }),
  };

  let lastError = '';
  let tries = 0;
  for (const delay of [0, ...retryDelays]) {
    if (delay) await wait(delay);
    tries++;
    try {
      await mailer.sendMail(mail);
    } catch (e) {
      lastError = errorCode(e);
      LOG.warn('Lock email attempt failed:', lastError);
      continue;
    }
    // The mail is out. A failure from here on must never resend it in this cycle: delivery is at-least-once, and
    // an unrecorded send can repeat once, when the claim lease expires and another cycle picks the events up.
    const sentAt = new Date().toISOString();
    auditLocks(events, 'notification sent');
    try {
      await store.completeEvents(events, {
        attempts: (event) => (event.attempts || 0) + tries,
        sentAt,
        lastError: '',
      });
      await store.saveMonitor({ lastNotificationDispatchedAt: sentAt });
      return 'sent';
    } catch (e) {
      LOG.error('Lock email was sent but could not be recorded as sent; it may be sent again after the lease expires:', errorCode(e));
      return 'sent-unrecorded';
    }
  }

  // Audited once per lock, not once per minute for as long as the mail server is down.
  auditLocks(events.filter((event) => !event.failureAudited), 'notification failed');
  const nextRetryAt = calculateNextRetry((events[0]?.attempts || 0) + tries, now);
  await store.releaseOrFailEvents(events, {
    attempts: (event) => (event.attempts || 0) + tries,
    failureAudited: true,
    lastError,
    nextRetryAt,
    maxAttempts,
  });
  LOG.error('Lock email failed after retries:', lastError, '-', events.length, 'lock(s) stay queued');
  return 'queued';
}

module.exports = {
  errorCode,
  wait,
  auditLocks,
  sendPending,
};
