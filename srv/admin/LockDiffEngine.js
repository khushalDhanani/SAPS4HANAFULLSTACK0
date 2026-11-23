'use strict';

const { formatLockTimestamp } = require('./lockEmail');

const CONTEXT_WINDOW_MS = 5 * 60 * 1000; // how long an app note can explain a lock
const RUN_SETTLE_MS = 20 * 1000; // a bulk run still locking is held back, so that it stays in one email
const SOURCE_APP = 'Fiori app';
const SOURCE_SAP = 'SAP / automatic';
const SERVICE_ACCOUNT = 'Service account (app or integration)';
const SHORT_LIVED_LOCK = 'Short-lived lock (cleared before detection)';
const INCORRECT_LOGONS = 128;

// USR02.UFLAG bits (domain XUUFLAG, DS4/220).
const LOCK_LABELS = [
  [32, 'Global lock (CUA)'],
  [64, 'Locked by administrator'],
  [INCORRECT_LOGONS, 'Locked due to incorrect logon attempts'],
];

function lockLabel(uflag) {
  const hasAdministratorLock = Boolean(uflag & 64);
  const hasIncorrectLogonLock = Boolean(uflag & INCORRECT_LOGONS);
  const labels = LOCK_LABELS
    .filter(([bit]) => (uflag & bit) && !(hasAdministratorLock && hasIncorrectLogonLock && (bit === 64 || bit === INCORRECT_LOGONS)))
    .map(([, label]) => label);
  if (hasAdministratorLock && hasIncorrectLogonLock) labels.push('Locked by administrator and incorrect logon attempts');
  return labels.length ? labels.join(' and ') : `Lock status ${uflag}`;
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
 * A recent note explains non-automatic locks; only an exact history-key match can attribute an automatic lock.
 */
function contextMatchesChange(context, change) {
  return Boolean(context && change && context.historyKey && change.historyKey === context.historyKey);
}

function isRecentContext(context, now) {
  return Boolean(context && now.getTime() - new Date(context.at).getTime() <= CONTEXT_WINDOW_MS);
}

function serviceAccountActor(change, serviceUser) {
  return Boolean(change && change.changedBy && serviceUser
    && change.changedBy.trim().toUpperCase() === serviceUser.trim().toUpperCase());
}

function describeLock({ username, uflag }, { context, change, fullName, previousLockedAt, now, serviceUser }) {
  const incorrectLogonLock = Boolean(uflag & INCORRECT_LOGONS);
  const exactAppAudit = contextMatchesChange(context, change);
  const contextApplies = exactAppAudit
    || (isRecentContext(context, now) && !context?.historyKey && !incorrectLogonLock);
  const noteApplies = contextApplies;
  const shownByHistory = change && change.uflag === uflag && change.lockedAt > previousLockedAt;
  const detected = now.toISOString().replace(/\D/g, '').slice(0, 14);
  const lockedBy = noteApplies
    ? context.actor
    : (incorrectLogonLock
      ? 'Incorrect logon attempts (automatic)'
      : (shownByHistory
        ? (serviceAccountActor(change, serviceUser) ? SERVICE_ACCOUNT : change.changedBy)
        : 'Unknown'));
  const historyKey = change?.historyKey || (contextApplies && context?.historyKey) || '';
  const lockedAt = shownByHistory ? change.lockedAt : (detected > previousLockedAt ? detected : String(Number(previousLockedAt) + 1));
  return {
    username,
    uflag,
    lockedAt,
    lockType: lockLabel(uflag),
    lockedBy,
    fullName: fullName || '',
    source: noteApplies ? SOURCE_APP : SOURCE_SAP,
    reason: noteApplies ? (context.reason || '') : '',
    bulkRunId: noteApplies ? (context.bulkRunId || '') : '',
    lockTimestamp: formatLockTimestamp(lockedAt),
    detectedAt: now.toISOString(),
    historyKey,
  };
}

function describeHistoryLock(change, { context, fullName, serviceUser, now }) {
  const uflag = change.addedUflag ?? change.uflag;
  const incorrectLogonLock = Boolean(uflag & INCORRECT_LOGONS);
  const appAudit = contextMatchesChange(context, change)
    || (!incorrectLogonLock && !context?.historyKey && isRecentContext(context, now));
  const shortReason = appAudit && context.reason ? `${SHORT_LIVED_LOCK}: ${context.reason}` : SHORT_LIVED_LOCK;
  return {
    username: change.username,
    uflag,
    lockedAt: change.lockedAt,
    lockType: `${SHORT_LIVED_LOCK} - ${lockLabel(uflag)}`,
    lockedBy: appAudit
      ? context.actor
      : (incorrectLogonLock
        ? 'Incorrect logon attempts (automatic)'
        : (serviceAccountActor(change, serviceUser) ? SERVICE_ACCOUNT : (change.changedBy || 'Unknown'))),
    fullName: fullName || '',
    source: appAudit ? SOURCE_APP : SOURCE_SAP,
    reason: shortReason,
    bulkRunId: appAudit ? (context.bulkRunId || '') : '',
    lockTimestamp: formatLockTimestamp(change.lockedAt),
    detectedAt: now.toISOString(),
    historyKey: change.historyKey || '',
  };
}

function addedHistoryLocks(history, snapshots = new Map()) {
  return history.reduce((locks, row) => {
    const previousUflag = row.previousUflag ?? snapshots.get(row.username)?.uflag;
    if (previousUflag === null || previousUflag === undefined) return locks;
    const addedUflag = (Number(row.uflag) || 0) & ~(Number(previousUflag) || 0);
    if (addedUflag) locks.push({ ...row, addedUflag });
    return locks;
  }, []);
}

function latestHistoryCursor(rows, previous) {
  if (!rows.length) return previous || { at: '00000000000000', key: '[]' };
  const latest = rows[rows.length - 1];
  return { at: latest.lockedAt, key: latest.historyKey };
}

function sameHistoryCursor(left, right) {
  return Boolean(left && right && left.at === right.at && left.key === right.key);
}

function calculateNextRetry(attempts, now = new Date()) {
  const backoffSec = Math.min(60, 5 * Math.pow(2, Math.max(0, Math.floor(attempts / 4) - 1)));
  return new Date(now.getTime() + backoffSec * 1000).toISOString();
}

module.exports = {
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
};
