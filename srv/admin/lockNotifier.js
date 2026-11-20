'use strict';

const mailer = require('../common/mailer');
const store = require('./lockEventStore');
const { buildLockEmail, formatLockTimestamp } = require('./lockEmail');
const { audit } = require('./audit');
const LOG = require('../common/logger')('lock-monitor');

/**
 * The lock monitor: the single source of truth for detecting that an SAP user became locked, from any source.
 * The app only leaves a note of who is locking and why; the email always comes from a poll cycle.
 */

const DEFAULT_INTERVAL_SEC = 5;
const DEFAULT_MAX_PER_EMAIL = 50;
const RETRY_DELAYS_MS = [1000, 2000, 4000];
// The local Docker dev profile runs NODE_ENV=test; LOCK_MONITOR_IN_TEST=1 lets the monitor run there like a real server.
const isTestProfile = (env = process.env) => env.NODE_ENV === 'test' && String(env.LOCK_MONITOR_IN_TEST || '').trim() !== '1';
const defaultRetryDelays = () => (isTestProfile() ? [0, 0, 0] : RETRY_DELAYS_MS);
const DEFAULT_LEASE_MS = 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 30;
const STALE_AFTER_INTERVALS = 3;
const MAX_CURSOR_STALL_CYCLES = 5;
const CURSOR_STALL_ERROR = `USH02 cursor did not advance for ${MAX_CURSOR_STALL_CYCLES} consecutive polls`;

const {
  CONTEXT_WINDOW_MS,
  RUN_SETTLE_MS,
  SOURCE_APP,
  SOURCE_SAP,
  SERVICE_ACCOUNT,
  SHORT_LIVED_LOCK,
  INCORRECT_LOGONS,
  LOCK_LABELS,
  lockLabel,
  diffLockState,
  splitSettled,
  contextMatchesChange,
  isRecentContext,
  serviceAccountActor,
  describeLock,
  describeHistoryLock,
  addedHistoryLocks,
  latestHistoryCursor,
  sameHistoryCursor,
  calculateNextRetry
} = require('./LockDiffEngine');

const recipients = (env = process.env) => String(env.LOCK_NOTIFY_TO || '').split(',').map((s) => s.trim()).filter(Boolean);
// Email only. Detection and storage of locks run without it; see startJob and pollOnce.
const isEnabled = () => mailer.isConfigured() && recipients().length > 0;

function positiveInt(value, fallback, { allowZero = false } = {}) {
  const n = Number(value);
  const valid = value !== undefined && value !== '' && Number.isInteger(n) && (allowZero ? n >= 0 : n > 0);
  return valid ? n : fallback;
}
const pollIntervalSec = (env = process.env) => positiveInt(env.LOCK_POLL_INTERVAL_SEC, DEFAULT_INTERVAL_SEC, { allowZero: true });
const maxPerEmail = (env = process.env) => positiveInt(env.LOCK_MAX_PER_EMAIL, DEFAULT_MAX_PER_EMAIL);



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
 * steps, and a crash or database failure between them can repeat that one email. The notification table is the history. Uses atomic database-backed claiming to ensure that two workers or instances never send the same email concurrently.
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

/**
 * One cycle: one read of all users, compare, store, one email.
 * If SAP cannot be read, the snapshot stays as it was and nothing is sent.
 * Without email (no SMTP or no recipient) locks are still detected and stored, as 'recorded': history that is never mailed.
 */
async function pollOnce(adapter, { now = new Date(), retryDelays } = {}) {
  const startMs = Date.now();
  let current;
  try {
    current = await adapter.readLockFlags();
    if (!current.length) throw new Error('USR02 returned no users');
  } catch (e) {
    const pollDurationMs = Date.now() - startMs;
    LOG.error('Lock check failed, snapshot kept:', e.message);
    await store.saveMonitor({
      lastCheckedAt: now.toISOString(),
      lastFailedPollAt: now.toISOString(),
      pollDurationMs,
      lastStatus: 'failed',
      errorMessage: 'USR02 lock-state read failed',
    });
    return { failed: true, newlyLocked: 0, email: 'none' };
  }

  const nowIso = now.toISOString();
  const snapshots = await store.readSnapshots();
  const savedMonitor = await store.readMonitor();
  let cursorStallCount = Number(savedMonitor?.cursorStallCount) || 0;
  let historyRows = [];
  let historyCursor = null;
  let historyReadSucceeded = false;
  try {
    historyCursor = await store.readHistoryCursor();
    historyRows = await adapter.readLockHistory(historyCursor);
    const nextCursor = latestHistoryCursor(historyRows, historyCursor);
    if (historyRows.length && historyCursor && sameHistoryCursor(nextCursor, historyCursor)) {
      cursorStallCount++;
      LOG.error('Lock history catch-up failed; watermark kept: cursor did not advance');
    } else {
      historyReadSucceeded = true;
      cursorStallCount = 0;
    }
  } catch (e) {
    cursorStallCount++;
    LOG.error('Lock history catch-up failed; watermark kept:', e.message);
  }
  const historyNeedsBaseline = historyCursor === null;
  const monitorHealth = {
    lastStatus: cursorStallCount >= MAX_CURSOR_STALL_CYCLES ? 'failed' : 'ok',
    cursorStallCount,
    errorMessage: cursorStallCount >= MAX_CURSOR_STALL_CYCLES ? CURSOR_STALL_ERROR : '',
  };

  if (!snapshots.size) {
    const pollDurationMs = Date.now() - startMs;
    await store.commitCycle({
      states: current,
      usedContexts: current.filter(({ uflag }) => uflag).map(({ username }) => username),
      ...(historyReadSucceeded ? { historyCursor: latestHistoryCursor(historyRows, historyCursor) } : {}),
    }, nowIso);
    await store.saveMonitor({
      lastCheckedAt: nowIso,
      lastSuccessfulPollAt: nowIso,
      pollDurationMs,
      ...monitorHealth,
    });
    return { baseline: current.length, newlyLocked: 0, email: 'none' };
  }

  const diff = diffLockState(current, snapshots);
  const contexts = await store.readContexts();
  const { settled, held } = splitSettled(diff.newlyLocked, contexts, now);
  const contextOf = new Map(contexts.map((context) => [context.username, context]));
  const historyLocks = historyReadSucceeded && !historyNeedsBaseline
    ? addedHistoryLocks(historyRows, snapshots)
    : [];
  const { settled: settledHistoryLocks, held: heldHistoryLocks } = splitSettled(historyLocks, contexts, now);

  const events = [];
  const eventKeys = new Set();
  if (settled.length) {
    let names = new Map();
    try {
      names = await adapter.readFullNames();
    } catch (e) {
      LOG.warn('Full names not readable:', e.message);
    }
    let serviceUser = '';
    try {
      serviceUser = await adapter.getConnectionUser();
    } catch (e) {
      LOG.warn('RFC service account identity not readable:', e.message);
    }
    for (const lock of settled) {
      let change = null;
      try {
        change = await adapter.readLastLockChange(lock.username);
      } catch (e) {
        LOG.warn('Lock history not readable for', lock.username, e.message);
      }
      const event = describeLock(lock, {
        context: contextOf.get(lock.username),
        change,
        fullName: names.get(lock.username),
        previousLockedAt: await store.lastLockedAt(lock.username),
        now,
        serviceUser,
      });
      events.push(event);
      eventKeys.add(`${event.username}|${event.lockedAt}`);
    }
  }

  const reportableHistoryLocks = settledHistoryLocks.filter(
    (change) => !eventKeys.has(`${change.username}|${change.lockedAt}`)
  );
  if (reportableHistoryLocks.length) {
    let names = new Map();
    try {
      names = await adapter.readFullNames();
    } catch (e) {
      LOG.warn('Full names not readable:', e.message);
    }
    let serviceUser = '';
    try {
      serviceUser = await adapter.getConnectionUser();
    } catch (e) {
      LOG.warn('RFC service account identity not readable:', e.message);
    }
    for (const change of reportableHistoryLocks) {
      const eventKey = `${change.username}|${change.lockedAt}`;
      const context = contextOf.get(change.username);
      events.push(describeHistoryLock(change, { context, fullName: names.get(change.username), serviceUser, now }));
      eventKeys.add(eventKey);
    }
  }

  const nextHistoryCursor = historyReadSucceeded && !heldHistoryLocks.length
    ? latestHistoryCursor(historyRows, historyCursor)
    : null;
  const pollDurationMs = Date.now() - startMs;
  await store.commitCycle({
    states: [...diff.states, ...settled],
    removed: diff.removed,
    events,
    usedContexts: [...new Set([
      ...settled.map(({ username }) => username),
      ...events.filter((event) => event.source === SOURCE_APP).map(({ username }) => username),
    ])],
    expiredBefore: new Date(now.getTime() - CONTEXT_WINDOW_MS).toISOString(),
    eventStatus: isEnabled() ? 'pending' : 'recorded',
    ...(nextHistoryCursor ? { historyCursor: nextHistoryCursor } : {}),
  }, nowIso);
  await store.saveMonitor({
    lastCheckedAt: nowIso,
    lastSuccessfulPollAt: nowIso,
    pollDurationMs,
    ...monitorHealth,
  });

  const email = isEnabled() ? await sendPending({ retryDelays, now }) : 'off';
  const heldUsers = new Set([...held, ...heldHistoryLocks].map(({ username }) => username));
  return { newlyLocked: events.length, held: heldUsers.size, email };
}

let running = false;

/** Non-overlapping: a tick that finds the last cycle still running is skipped. */
async function runCycle(adapter, options) {
  if (running) return { skipped: true };
  running = true;
  try {
    return await pollOnce(adapter, options);
  } catch (e) {
    LOG.error('Lock monitor cycle failed:', e.message);
    return { failed: true };
  } finally {
    running = false;
  }
}

/**
 * Runs on one instance only: production's 2 instances would otherwise each send the same cycle.
 * Starts without SMTP too: detection must not depend on the mail server.
 */
function startJob(getAdapter, env = process.env) {
  const everySec = pollIntervalSec(env);
  const instance = env.CF_INSTANCE_INDEX;
  if (isTestProfile(env) || everySec <= 0 || (instance !== undefined && String(instance) !== '0')) {
    return null;
  }
  const timer = setInterval(() => runCycle(getAdapter()), everySec * 1000);
  timer.unref();
  return timer;
}

/** The app is about to lock this user. Never throws: a note must not stop the lock. */
async function recordAppLock({ username, actor, reason, bulkRunId }) {
  if (pollIntervalSec() <= 0) return;
  try {
    await store.writeContext({ username, actor, reason, bulkRunId, at: new Date().toISOString(), historyKey: '' });
  } catch (e) {
    LOG.warn('Could not note the app lock of', username, e.message);
  }
}

async function recordAppLockHistory(username, historyKey) {
  if (pollIntervalSec() <= 0 || !historyKey) return;
  try {
    await store.setContextHistoryKey(username, historyKey);
  } catch (e) {
    LOG.warn('Could not link the app lock history for', username, e.message);
  }
}

/** A failed app lock must not leave a note that can explain a later lock by someone else. */
async function discardAppLock(username) {
  if (pollIntervalSec() <= 0) return;
  try {
    await store.discardContext(username);
  } catch (e) {
    LOG.warn('Could not clear the app lock note of', username, e.message);
  }
}

/**
 * Immediately queues a durable notification event and dispatches it for an individual Fiori lock.
 * Never throws: notification errors must never fail the completed SAP lock operation.
 */
async function notifyAppLock({
  username,
  actor,
  reason = '',
  fullName = '',
  change = null,
  now = new Date(),
  retryDelays = defaultRetryDelays(),
} = {}) {
  if (!isEnabled()) return 'off';

  const nowIso = now.toISOString();
  const detected = nowIso.replace(/\D/g, '').slice(0, 14);
  const previousLockedAt = await store.lastLockedAt(username);
  const lockedAt = change && change.lockedAt
    ? change.lockedAt
    : (detected > previousLockedAt ? detected : String(Number(previousLockedAt) + 1));
  const historyKey = change?.historyKey || '';

  const event = {
    username,
    uflag: 64,
    lockedAt,
    lockType: lockLabel(64),
    lockedBy: actor,
    fullName: fullName || '',
    source: SOURCE_APP,
    reason: reason || '',
    bulkRunId: '',
    lockTimestamp: formatLockTimestamp(lockedAt),
    detectedAt: nowIso,
    historyKey,
  };

  try {
    await store.recordAppLockEvent(event);
  } catch (e) {
    LOG.error('Could not persist app lock notification event for', username, e.message);
    return 'failed';
  }

  try {
    await store.discardContext(username);
  } catch (e) {
    LOG.warn('Could not clear the app lock note of', username, e.message);
  }

  try {
    return await sendPending({ retryDelays, now });
  } catch (e) {
    LOG.error('Immediate lock notification dispatch failed for', username, e.message);
    return 'queued';
  }
}

/** What the SU01 header shows. Read from the database, because the instance answering may not run the job. */
async function monitorStatus(now = new Date()) {
  const settings = {
    recipient: recipients().join(', '),
    pollIntervalSec: pollIntervalSec(),
    maxPerEmail: maxPerEmail(),
    emailEnabled: isEnabled(),
  };
  const baseHealth = {
    lastSuccessfulPollAt: null,
    lastFailedPollAt: null,
    pollDurationMs: null,
    lastNotificationDispatchedAt: null,
    pendingNotificationCount: 0,
    failedNotificationCount: 0,
  };
  if (settings.pollIntervalSec <= 0) {
    return { state: 'off', lastCheckedAt: null, pendingEmails: 0, ...settings, ...baseHealth };
  }
  try {
    const monitor = await store.readMonitor();
    const pending = await store.pendingEvents();
    const failed = await store.failedEvents();
    const lastSent = monitor?.lastNotificationDispatchedAt || (await store.lastDispatchedAt()) || null;
    const healthInfo = {
      lastSuccessfulPollAt: monitor ? monitor.lastSuccessfulPollAt || null : null,
      lastFailedPollAt: monitor ? monitor.lastFailedPollAt || null : null,
      pollDurationMs: monitor?.pollDurationMs ?? null,
      lastNotificationDispatchedAt: lastSent,
      pendingNotificationCount: pending.length,
      failedNotificationCount: failed.length,
    };
    const base = {
      lastCheckedAt: monitor ? monitor.lastCheckedAt : null,
      pendingEmails: pending.length,
      ...settings,
      ...healthInfo,
    };
    if (!monitor) return { state: 'starting', ...base };
    if (monitor.lastStatus !== 'ok') return { state: 'failed', errorMessage: monitor.errorMessage || '', ...base };
    const age = now.getTime() - new Date(monitor.lastCheckedAt).getTime();
    return {
      state: age > settings.pollIntervalSec * 1000 * STALE_AFTER_INTERVALS ? 'stale' : 'ok',
      errorMessage: monitor.errorMessage || '',
      ...base,
    };
  } catch (e) {
    LOG.error('Could not read the lock monitor state:', e.message);
    return {
      state: 'failed',
      errorMessage: 'Lock monitor status could not be read',
      lastCheckedAt: null,
      pendingEmails: 0,
      ...settings,
      ...baseHealth,
    };
  }
}

/** queued until the monitor has reported the run; retrying if its email has failed and stays queued. */
async function bulkEmailStatus(bulkRunId) {
  if (!isEnabled()) return { status: 'not_configured' };
  const events = await store.eventsOfRun(bulkRunId);
  if (!events.length) return { status: 'queued' };
  if (events.every((event) => event.status === 'sent')) return { status: 'sent' };
  return { status: events.some((event) => event.attempts > 0) ? 'retrying' : 'queued' };
}

module.exports = {
  isEnabled, pollIntervalSec, maxPerEmail, recipients, lockLabel, diffLockState, splitSettled, describeLock,
  describeHistoryLock, addedHistoryLocks, pollOnce, runCycle, sendPending, startJob, recordAppLock,
  recordAppLockHistory, discardAppLock, notifyAppLock, monitorStatus, bulkEmailStatus, calculateNextRetry,
  DEFAULT_INTERVAL_SEC, DEFAULT_LEASE_MS, DEFAULT_MAX_ATTEMPTS,
};
