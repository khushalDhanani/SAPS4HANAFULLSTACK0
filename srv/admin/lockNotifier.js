'use strict';

const store = require('./lockEventStore');
const LOG = require('../common/logger')('lock-monitor');

const {
  DEFAULT_INTERVAL_SEC,
  DEFAULT_LEASE_MS,
  DEFAULT_MAX_ATTEMPTS,
  MAX_CURSOR_STALL_CYCLES,
  CURSOR_STALL_ERROR,
  isTestProfile,
  recipients,
  isEnabled,
  pollIntervalSec,
  maxPerEmail,
} = require('./LockNotifierConfig');

const {
  CONTEXT_WINDOW_MS,
  SOURCE_APP,
  lockLabel,
  diffLockState,
  splitSettled,
  describeLock,
  describeHistoryLock,
  addedHistoryLocks,
  latestHistoryCursor,
  sameHistoryCursor,
  calculateNextRetry,
} = require('./LockDiffEngine');

const { sendPending } = require('./LockNotificationSender');
const { monitorStatus, bulkEmailStatus } = require('./LockNotifierStatus');
const {
  recordAppLock,
  recordAppLockHistory,
  discardAppLock,
  notifyAppLock,
} = require('./LockAppContext');

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

module.exports = {
  isEnabled,
  pollIntervalSec,
  maxPerEmail,
  recipients,
  lockLabel,
  diffLockState,
  splitSettled,
  describeLock,
  describeHistoryLock,
  addedHistoryLocks,
  pollOnce,
  runCycle,
  sendPending,
  startJob,
  recordAppLock,
  recordAppLockHistory,
  discardAppLock,
  notifyAppLock,
  monitorStatus,
  bulkEmailStatus,
  calculateNextRetry,
  DEFAULT_INTERVAL_SEC,
  DEFAULT_LEASE_MS,
  DEFAULT_MAX_ATTEMPTS,
};
