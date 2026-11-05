'use strict';

const cds = require('@sap/cds');
const mailer = require('../common/mailer');
const store = require('./lockEventStore');
const { buildLockEmail } = require('./lockEmail');
const { audit } = require('./audit');
const LOG = require('../common/logger')('lock-notifier');

const APP_LOCK_WINDOW_MS = 2 * 60 * 1000;
const IDLE_RUN_MS = 2 * 60 * 1000;
const STALE_SEND_MS = 10 * 60 * 1000;
const DEFAULT_POLL_MS = 5 * 60 * 1000;
const RETRY_DELAYS_MS = [1000, 2000, 4000];
const SYSTEM_ACTOR = 'system';

// USR02.UFLAG bits and their ISLOCKED flag (domains XUUFLAG and BAPIUSLOCK, DS4/220).
const LOCK_BITS = [
  { bit: 32, flag: 'lockedGlobal', type: 'admin-global' },
  { bit: 64, flag: 'lockedLocal', type: 'admin-local' },
  { bit: 128, flag: 'lockedWrong', type: 'wrong-password' },
];
const WRONG_PASSWORD_BIT = 128;

const recipient = () => String(process.env.LOCK_NOTIFY_TO || '').trim();
const isEnabled = () => mailer.isConfigured() && Boolean(recipient());
const isoAgo = (ms) => new Date(Date.now() - ms).toISOString();
const isLockedFlag = (value) => value === 'L' || value === 'X';

function pollIntervalMs(env = process.env) {
  const value = env.LOCK_POLL_INTERVAL_MS;
  const n = Number(value);
  return value !== undefined && value !== '' && Number.isFinite(n) && n >= 0 ? n : DEFAULT_POLL_MS;
}

/** ISLOCKED names the type; UFLAG decides which lock is the new one and is the fallback if ISLOCKED says nothing. */
function lockTypeOf(newBits, detail) {
  const isNew = LOCK_BITS.filter(({ bit }) => newBits & bit);
  const confirmed = isNew.find(({ flag }) => detail && isLockedFlag(detail[flag]));
  return (confirmed || isNew[0] || LOCK_BITS[0]).type;
}

/**
 * What changed between SAP and the snapshot. Pure.
 * A user missing from the snapshot is stored silently. A user missing from SAP is left alone: not being read is
 * not the same as being unlocked. A user the app is locking right now is skipped.
 */
function diffLockState(current, snapshots, nowIso) {
  const result = { baseline: [], newlyLocked: [], changed: [] };
  current.forEach(({ username, uflag }) => {
    const snapshot = snapshots.get(username);
    if (!snapshot) {
      result.baseline.push({ username, uflag });
      return;
    }
    if (snapshot.uflag === uflag) return;
    const newBits = uflag & ~snapshot.uflag;
    if (!newBits) {
      result.changed.push({ username, oldFlag: snapshot.uflag, uflag });
    } else if (!(snapshot.appLockUntil && snapshot.appLockUntil > nowIso)) {
      result.newlyLocked.push({ username, oldFlag: snapshot.uflag, uflag, newBits });
    }
  });
  return result;
}

/** The newest USH02 row counts only if it shows this lock and is newer than the last one reported. */
async function resolveLockTime(adapter, username, uflag) {
  const previous = await store.lastLockedAt(username);
  let change = null;
  try {
    change = await adapter.readLastLockChange(username);
  } catch (e) {
    LOG.warn('Lock history not readable for', username, e.message);
  }
  if (change && change.uflag === uflag && change.lockedAt > previous) {
    return { lockedAt: change.lockedAt, lockedAtSource: 'sap', changedBy: change.changedBy };
  }
  const detected = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  return { lockedAt: detected > previous ? detected : String(Number(previous) + 1), lockedAtSource: 'detected', changedBy: '' };
}

function auditEach(events, result) {
  events.forEach((event) => audit({ who: event.actor, target: event.username, action: 'notify', result, reason: event.reason || '' }));
}

const buildMail = (events) => ({
  to: recipient(),
  ...buildLockEmail(events, { appUrl: process.env.LOCK_NOTIFY_APP_URL }),
});

function errorCode(e) {
  return String((e && (e.responseCode || e.code)) || 'send-failed').slice(0, 60);
}

/** Retries in the background. A lock is already done by now: nothing here can undo it. */
function retryInBackground(events, delays, attempt = 1) {
  if (!delays.length) {
    return store.setStatus(events, 'failed').then(() => {
      LOG.error('Lock notification failed after retries for', events.length, 'event(s)');
      auditEach(events, 'notification failed');
      return 'failed';
    });
  }
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, delays[0]);
    if (timer.unref) timer.unref();
  }).then(async () => {
    try {
      await mailer.sendMail(buildMail(events));
    } catch (e) {
      await store.setStatus(events, 'sending', { attempts: attempt + 1, lastError: errorCode(e) });
      return retryInBackground(events, delays.slice(1), attempt + 1);
    }
    await store.setStatus(events, 'sent', { attempts: attempt + 1, sentAt: new Date().toISOString() });
    auditEach(events, 'sent');
    return 'sent';
  });
}

/**
 * One attempt, then background retries.
 * @returns {Promise<'none'|'sent'|'retrying'>}
 */
async function deliver(events, { retryDelays = RETRY_DELAYS_MS } = {}) {
  if (!events.length) return 'none';
  try {
    await mailer.sendMail(buildMail(events));
  } catch (e) {
    LOG.warn('Lock notification attempt failed:', errorCode(e));
    await store.setStatus(events, 'sending', { attempts: 1, lastError: errorCode(e) });
    retryInBackground(events, retryDelays)
      .catch((err) => LOG.error('Lock notification retry failed:', err.message));
    return 'retrying';
  }
  await store.setStatus(events, 'sent', { attempts: 1, sentAt: new Date().toISOString() });
  auditEach(events, 'sent');
  return 'sent';
}

async function beforeAppLock(username) {
  if (!isEnabled()) return;
  try {
    await store.markAppLock(username, new Date(Date.now() + APP_LOCK_WINDOW_MS).toISOString());
  } catch (e) {
    LOG.warn('Could not mark the app lock of', username, e.message);
  }
}

/**
 * Records a successful lock made in this app. Never throws: the lock has already happened.
 * Without a run id the mail goes in the background; with one it waits for finishBulkRun.
 */
async function afterAppLock(adapter, { username, actor, reason, bulkRunId, fullName, detail }) {
  if (!isEnabled()) {
    audit({ who: actor, target: username, action: 'notify', result: 'not_configured', reason });
    return;
  }
  try {
    const [state] = await adapter.readLockFlags(username);
    const uflag = state ? state.uflag : 0;
    if (!uflag) {
      LOG.warn('Lock not visible in USR02 yet for', username, '- the job will report it');
      return;
    }
    const { lockedAt, lockedAtSource } = await resolveLockTime(adapter, username, uflag);
    const runId = bulkRunId || `single-${cds.utils.uuid()}`;
    const created = await store.claimLock({
      username, lockedAt, lockedAtSource, lockType: lockTypeOf(uflag, detail), lockedBy: actor,
      fullName, source: 'app', reason, actor, bulkRunId: runId,
    }, uflag);
    if (created && !bulkRunId) {
      store.claimRun(runId, actor).then((events) => deliver(events))
        .catch((e) => LOG.error('Lock notification failed:', e.message));
    }
  } catch (e) {
    LOG.error('Could not record the lock notification of', username, e.message);
  }
}

async function afterAppUnlock(username) {
  if (!isEnabled()) return;
  try {
    await store.markUnlocked(username);
  } catch (e) {
    LOG.warn('Could not record the unlock of', username, e.message);
  }
}

/** Sends the one summary email of a bulk run. Never throws: the status only informs the result dialog. */
async function finishBulkRun(bulkRunId, actor) {
  if (!isEnabled()) return { status: 'not_configured', count: 0 };
  try {
    const events = await store.claimRun(bulkRunId, actor);
    return { status: await deliver(events), count: events.length };
  } catch (e) {
    LOG.error('Could not send the bulk lock notification:', e.message);
    return { status: 'failed', count: 0 };
  }
}

/** One cycle of the job. Reads SAP only; the writes go to the local tables and the mail. */
async function pollOnce(adapter) {
  const current = await adapter.readLockFlags();
  if (!current.length) {
    LOG.warn('USR02 returned no users: lock check skipped');
    return { skipped: true, newlyLocked: 0, status: 'none' };
  }
  const diff = diffLockState(current, await store.readSnapshots(), new Date().toISOString());
  await store.addBaseline(diff.baseline);
  await Promise.all(diff.changed.map(({ username, oldFlag, uflag }) => store.updateState(username, oldFlag, uflag)));

  const runId = `poll-${cds.utils.uuid()}`;
  let created = 0;
  for (const { username, oldFlag, uflag, newBits } of diff.newlyLocked) {
    let detail = null;
    try {
      detail = await adapter.getUserDetail(username);
    } catch (e) {
      LOG.warn('User detail not readable for', username, e.message);
    }
    const { lockedAt, lockedAtSource, changedBy } = await resolveLockTime(adapter, username, uflag);
    const auto = newBits === WRONG_PASSWORD_BIT;
    const won = await store.claimLock({
      username, lockedAt, lockedAtSource, lockType: lockTypeOf(newBits, detail),
      lockedBy: auto ? 'System' : changedBy, fullName: detail ? detail.fullName : '',
      source: auto ? 'auto' : 'SAP', reason: '', actor: SYSTEM_ACTOR, bulkRunId: runId,
    }, uflag, { respectAppWindow: true, expectedOld: oldFlag });
    if (won) created++;
  }

  const status = await deliver(await store.claimRun(runId));
  await recoverAbandoned();
  return { skipped: false, baseline: diff.baseline.length, newlyLocked: created, status };
}

/** Runs whose browser went away, and sends a crash left in flight. */
async function recoverAbandoned() {
  await store.reclaimStale(isoAgo(STALE_SEND_MS));
  for (const runId of await store.idleRuns(isoAgo(IDLE_RUN_MS))) {
    await deliver(await store.claimRun(runId));
  }
}

let running = false;

/** Starts the job on one instance only: production's 2 instances would otherwise split each summary. */
function startJob(getAdapter, env = process.env) {
  const every = pollIntervalMs(env);
  const instance = env.CF_INSTANCE_INDEX;
  if (env.NODE_ENV === 'test' || every <= 0 || !isEnabled() || (instance !== undefined && String(instance) !== '0')) {
    return null;
  }
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await pollOnce(getAdapter());
    } catch (e) {
      LOG.error('Lock check failed:', e.message);
    } finally {
      running = false;
    }
  }, every);
  timer.unref();
  return timer;
}

module.exports = {
  isEnabled, pollIntervalMs, lockTypeOf, diffLockState, deliver,
  beforeAppLock, afterAppLock, afterAppUnlock, finishBulkRun, pollOnce, recoverAbandoned, startJob,
};
