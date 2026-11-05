'use strict';

const mailer = require('../common/mailer');
const store = require('./lockEventStore');
const { buildLockEmail } = require('./lockEmail');
const { audit } = require('./audit');
const LOG = require('../common/logger')('lock-monitor');

/**
 * The lock monitor: the single source of truth for detecting that an SAP user became locked, from any source.
 * The app only leaves a note of who is locking and why; the email always comes from a poll cycle.
 */

const DEFAULT_INTERVAL_SEC = 60;
const DEFAULT_MAX_PER_EMAIL = 50;
const CONTEXT_WINDOW_MS = 5 * 60 * 1000; // how long an app note can explain a lock
const RUN_SETTLE_MS = 20 * 1000; // a bulk run still locking is held back, so that it stays in one email
const RETRY_DELAYS_MS = [1000, 2000, 4000];
const STALE_AFTER_INTERVALS = 3;
const SOURCE_APP = 'Fiori app';
const SOURCE_SAP = 'SAP / automatic';
const INCORRECT_LOGONS = 128;

// USR02.UFLAG bits (domain XUUFLAG, DS4/220).
const LOCK_LABELS = [
  [32, 'Global lock (CUA)'],
  [64, 'Locked by administrator'],
  [INCORRECT_LOGONS, 'Locked due to incorrect logon attempts'],
];

const recipients = (env = process.env) => String(env.LOCK_NOTIFY_TO || '').split(',').map((s) => s.trim()).filter(Boolean);
const isEnabled = () => mailer.isConfigured() && recipients().length > 0;

function positiveInt(value, fallback, { allowZero = false } = {}) {
  const n = Number(value);
  const valid = value !== undefined && value !== '' && Number.isInteger(n) && (allowZero ? n >= 0 : n > 0);
  return valid ? n : fallback;
}
const pollIntervalSec = (env = process.env) => positiveInt(env.LOCK_POLL_INTERVAL_SEC, DEFAULT_INTERVAL_SEC, { allowZero: true });
const maxPerEmail = (env = process.env) => positiveInt(env.LOCK_MAX_PER_EMAIL, DEFAULT_MAX_PER_EMAIL);

function lockLabel(uflag) {
  const labels = LOCK_LABELS.filter(([bit]) => uflag & bit).map(([, label]) => label);
  return labels.length ? labels.join(' + ') : `Lock status ${uflag}`;
}

/**
 * What changed between SAP and the snapshot. Pure.
 * New lock: was not locked, or is a user the snapshot has never seen, and is locked now.
 * Anyone already locked stays silent, even if the kind of lock changes.
 */
function diffLockState(current, snapshots) {
  const result = { newlyLocked: [], states: [], removed: [] };
  const seen = new Set();
  current.forEach(({ username, uflag }) => {
    seen.add(username);
    const snapshot = snapshots.get(username);
    if (uflag && (!snapshot || !snapshot.uflag)) {
      result.newlyLocked.push({ username, uflag });
    } else if (!snapshot || snapshot.uflag !== uflag) {
      result.states.push({ username, uflag });
    }
  });
  snapshots.forEach((_row, username) => {
    if (!seen.has(username)) result.removed.push(username);
  });
  return result;
}

/** Locks of a bulk run still in progress wait for the next cycle, so that the run stays in one email. Pure. */
function splitSettled(newlyLocked, contexts, now) {
  const nowMs = now.getTime();
  const newestOfRun = new Map();
  contexts.forEach(({ bulkRunId, at }) => {
    if (!bulkRunId) return;
    const ms = new Date(at).getTime();
    if (ms > (newestOfRun.get(bulkRunId) || 0)) newestOfRun.set(bulkRunId, ms);
  });
  const contextOf = new Map(contexts.map((context) => [context.username, context]));
  const settled = [];
  const held = [];
  newlyLocked.forEach((lock) => {
    const context = contextOf.get(lock.username);
    const stillRunning = context && context.bulkRunId && nowMs - newestOfRun.get(context.bulkRunId) < RUN_SETTLE_MS;
    (stillRunning ? held : settled).push(lock);
  });
  return { settled, held };
}

/**
 * Merges the app's note into a detected lock. Pure.
 * A note explains the lock only if it is recent, and never an incorrect-logon lock, which no admin made.
 */
function describeLock({ username, uflag }, { context, change, fullName, previousLockedAt, now }) {
  const noteApplies = context
    && now.getTime() - new Date(context.at).getTime() <= CONTEXT_WINDOW_MS
    && uflag !== INCORRECT_LOGONS;
  const shownByHistory = change && change.uflag === uflag && change.lockedAt > previousLockedAt;
  const detected = now.toISOString().replace(/\D/g, '').slice(0, 14);
  return {
    username,
    uflag,
    lockedAt: shownByHistory ? change.lockedAt : (detected > previousLockedAt ? detected : String(Number(previousLockedAt) + 1)),
    lockType: lockLabel(uflag),
    lockedBy: noteApplies ? context.actor : ((change && change.changedBy) || 'Unknown'),
    fullName: fullName || '',
    source: noteApplies ? SOURCE_APP : SOURCE_SAP,
    reason: noteApplies ? (context.reason || '') : '',
    bulkRunId: noteApplies ? (context.bulkRunId || '') : '',
    detectedAt: now.toISOString(),
  };
}

const errorCode = (e) => String((e && (e.responseCode || e.code)) || 'send-failed').slice(0, 60);
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
 * cycle. Never throws, so a mail failure cannot affect the poller, and it cannot reach a lock at all.
 */
async function sendPending({ retryDelays = RETRY_DELAYS_MS } = {}) {
  const events = await store.pendingEvents();
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
      await store.updateEvents(events, (event) => ({
        status: 'sent', attempts: event.attempts + tries, sentAt: new Date().toISOString(), lastError: '',
      }));
      auditLocks(events, 'notification sent');
      return 'sent';
    } catch (e) {
      lastError = errorCode(e);
      LOG.warn('Lock email attempt failed:', lastError);
    }
  }
  // Audited once per lock, not once per minute for as long as the mail server is down.
  auditLocks(events.filter((event) => !event.failureAudited), 'notification failed');
  await store.updateEvents(events, (event) => ({ attempts: event.attempts + tries, failureAudited: true, lastError }));
  LOG.error('Lock email failed after retries:', lastError, '-', events.length, 'lock(s) stay queued');
  return 'queued';
}

/**
 * One cycle: one read of all users, compare, store, one email.
 * If SAP cannot be read, the snapshot stays as it was and nothing is sent.
 */
async function pollOnce(adapter, { now = new Date(), retryDelays } = {}) {
  let current;
  try {
    current = await adapter.readLockFlags();
    if (!current.length) throw new Error('USR02 returned no users');
  } catch (e) {
    LOG.error('Lock check failed, snapshot kept:', e.message);
    await store.saveMonitor({ lastCheckedAt: now.toISOString(), lastStatus: 'failed' });
    return { failed: true, newlyLocked: 0, email: 'none' };
  }

  const nowIso = now.toISOString();
  const snapshots = await store.readSnapshots();
  if (!snapshots.size) {
    await store.commitCycle({ states: current }, nowIso);
    await store.saveMonitor({ lastCheckedAt: nowIso, lastStatus: 'ok' });
    return { baseline: current.length, newlyLocked: 0, email: 'none' };
  }

  const diff = diffLockState(current, snapshots);
  const contexts = await store.readContexts();
  const { settled, held } = splitSettled(diff.newlyLocked, contexts, now);
  const contextOf = new Map(contexts.map((context) => [context.username, context]));

  const events = [];
  if (settled.length) {
    let names = new Map();
    try {
      names = await adapter.readFullNames();
    } catch (e) {
      LOG.warn('Full names not readable:', e.message);
    }
    for (const lock of settled) {
      let change = null;
      try {
        change = await adapter.readLastLockChange(lock.username);
      } catch (e) {
        LOG.warn('Lock history not readable for', lock.username, e.message);
      }
      events.push(describeLock(lock, {
        context: contextOf.get(lock.username),
        change,
        fullName: names.get(lock.username),
        previousLockedAt: await store.lastLockedAt(lock.username),
        now,
      }));
    }
  }

  await store.commitCycle({
    states: [...diff.states, ...settled],
    removed: diff.removed,
    events,
    usedContexts: settled.map(({ username }) => username),
    expiredBefore: new Date(now.getTime() - CONTEXT_WINDOW_MS).toISOString(),
  }, nowIso);
  await store.saveMonitor({ lastCheckedAt: nowIso, lastStatus: 'ok' });

  const email = await sendPending({ retryDelays });
  return { newlyLocked: events.length, held: held.length, email };
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

/** Runs on one instance only: production's 2 instances would otherwise each send the same cycle. */
function startJob(getAdapter, env = process.env) {
  const everySec = pollIntervalSec(env);
  const instance = env.CF_INSTANCE_INDEX;
  if (env.NODE_ENV === 'test' || everySec <= 0 || !isEnabled() || (instance !== undefined && String(instance) !== '0')) {
    return null;
  }
  const timer = setInterval(() => runCycle(getAdapter()), everySec * 1000);
  timer.unref();
  return timer;
}

/** The app is about to lock this user. Never throws: a note must not stop the lock. */
async function recordAppLock({ username, actor, reason, bulkRunId }) {
  if (!isEnabled()) return;
  try {
    await store.writeContext({ username, actor, reason, bulkRunId, at: new Date().toISOString() });
  } catch (e) {
    LOG.warn('Could not note the app lock of', username, e.message);
  }
}

/** The lock failed or was undone, so the note must not explain a later lock by someone else. */
async function discardAppLock(username) {
  if (!isEnabled()) return;
  try {
    await store.discardContext(username);
  } catch (e) {
    LOG.warn('Could not clear the app lock note of', username, e.message);
  }
}

/** What the SU01 header shows. Read from the database, because the instance answering may not run the job. */
async function monitorStatus(now = new Date()) {
  const settings = {
    recipient: recipients().join(', '),
    pollIntervalSec: pollIntervalSec(),
    maxPerEmail: maxPerEmail(),
  };
  if (!isEnabled() || settings.pollIntervalSec <= 0) {
    return { state: 'off', lastCheckedAt: null, pendingEmails: 0, ...settings };
  }
  try {
    const monitor = await store.readMonitor();
    const pending = await store.pendingEvents();
    const base = { lastCheckedAt: monitor ? monitor.lastCheckedAt : null, pendingEmails: pending.length, ...settings };
    if (!monitor) return { state: 'starting', ...base };
    if (monitor.lastStatus !== 'ok') return { state: 'failed', ...base };
    const age = now.getTime() - new Date(monitor.lastCheckedAt).getTime();
    return { state: age > settings.pollIntervalSec * 1000 * STALE_AFTER_INTERVALS ? 'stale' : 'ok', ...base };
  } catch (e) {
    LOG.error('Could not read the lock monitor state:', e.message);
    return { state: 'failed', lastCheckedAt: null, pendingEmails: 0, ...settings };
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
  pollOnce, runCycle, sendPending, startJob, recordAppLock, discardAppLock, monitorStatus, bulkEmailStatus,
};
