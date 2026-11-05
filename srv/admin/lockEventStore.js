'use strict';

const cds = require('@sap/cds');

const { SELECT, INSERT, UPDATE } = cds.ql;

const SNAPSHOT = 'saps4hana.admin.UserLockSnapshot';
const EVENT = 'saps4hana.admin.UserLockNotification';

const nowIso = () => new Date().toISOString();

/**
 * Lock notifications and the last seen lock state. Every call commits on its own, never in the calling
 * request's transaction: a request that ends in req.reject rolls back, and these rows must survive it.
 * There is no memory fallback, because production's 2 instances would not share it.
 */
function inTx(fn) {
  return cds.db.tx({ user: cds.User.privileged }, fn);
}

async function readSnapshots() {
  const rows = await inTx((tx) => tx.run(SELECT.from(SNAPSHOT)));
  return new Map(rows.map((row) => [row.username, row]));
}

/** Stores users seen for the first time. No alert: they may have been locked for years. */
async function addBaseline(users) {
  if (!users.length) return;
  await inTx((tx) => tx.run(INSERT.into(SNAPSHOT).entries(users.map(({ username, uflag }) => ({ username, uflag, seenAt: nowIso() })))));
}

/** Records a change that raises no alert. Guarded, so a stale read cannot overwrite a newer state. */
async function updateState(username, oldFlag, newFlag) {
  await inTx((tx) => tx.run(UPDATE(SNAPSHOT).set({ uflag: newFlag, seenAt: nowIso() }).where({ username, uflag: oldFlag })));
}

/** The app is about to lock this user: the job must not report it as an outside lock meanwhile. */
async function markAppLock(username, until) {
  await inTx(async (tx) => {
    const updated = await tx.run(UPDATE(SNAPSHOT).set({ appLockUntil: until }).where({ username }));
    if (!updated) {
      await tx.run(INSERT.into(SNAPSHOT).entries({ username, uflag: 0, appLockUntil: until, seenAt: nowIso() }));
    }
  });
}

async function markUnlocked(username) {
  await inTx(async (tx) => {
    const updated = await tx.run(UPDATE(SNAPSHOT).set({ uflag: 0, appLockUntil: null, seenAt: nowIso() }).where({ username }));
    if (!updated) {
      await tx.run(INSERT.into(SNAPSHOT).entries({ username, uflag: 0, seenAt: nowIso() }));
    }
  });
}

async function lastLockedAt(username) {
  const row = await inTx((tx) => tx.run(SELECT.one.from(EVENT).columns('lockedAt').where({ username }).orderBy('lockedAt desc')));
  return row ? row.lockedAt : '';
}

/**
 * Whoever moves the snapshot from the state it read also owns the event, so the app and the job cannot both
 * report one lock. Both writes share one transaction, so a crash cannot leave a claim with no event.
 *
 * @param {object} event - the notification to insert when the claim wins
 * @param {number} newFlag - current USR02.UFLAG
 * @param {{respectAppWindow?: boolean, expectedOld?: number}} [options]
 * @returns {Promise<boolean>} true when this caller created the event
 */
async function claimLock(event, newFlag, { respectAppWindow = false, expectedOld } = {}) {
  const now = nowIso();
  return inTx(async (tx) => {
    const { username, lockedAt } = event;
    const row = await tx.run(SELECT.one.from(SNAPSHOT).where({ username }));
    const oldFlag = row ? row.uflag : 0;
    if (expectedOld !== undefined && oldFlag !== expectedOld) return false;
    if (respectAppWindow && row && row.appLockUntil && row.appLockUntil > now) return false;

    if (!(newFlag & ~oldFlag)) {
      if (row) await tx.run(UPDATE(SNAPSHOT).set({ appLockUntil: null }).where({ username }));
      return false;
    }
    if (row) {
      const moved = await tx.run(UPDATE(SNAPSHOT).set({ uflag: newFlag, appLockUntil: null, seenAt: now }).where({ username, uflag: oldFlag }));
      if (!moved) return false;
    } else {
      await tx.run(INSERT.into(SNAPSHOT).entries({ username, uflag: newFlag, seenAt: now }));
    }
    const existing = await tx.run(SELECT.one.from(EVENT).columns('username').where({ username, lockedAt }));
    if (existing) return false;
    await tx.run(INSERT.into(EVENT).entries({ ...event, status: 'pending', attempts: 0, createdAt: now }));
    return true;
  });
}

/** Takes the pending events of one run, so only one caller can send them. */
async function claimRun(bulkRunId, actor) {
  const claimId = cds.utils.uuid();
  const where = actor === undefined ? { bulkRunId, status: 'pending' } : { bulkRunId, actor, status: 'pending' };
  return inTx(async (tx) => {
    await tx.run(UPDATE(EVENT).set({ status: 'sending', claimId, claimedAt: nowIso() }).where(where));
    return tx.run(SELECT.from(EVENT).where({ claimId }));
  });
}

async function setStatus(events, status, fields = {}) {
  await inTx(async (tx) => {
    for (const { username, lockedAt } of events) {
      await tx.run(UPDATE(EVENT).set({ status, ...fields }).where({ username, lockedAt }));
    }
  });
}

/** Run ids whose newest event is older than the cutoff and still waits to be sent: the browser went away. */
async function idleRuns(cutoffIso) {
  const pending = await inTx((tx) => tx.run(SELECT.from(EVENT).columns('bulkRunId', 'createdAt').where({ status: 'pending' })));
  const newest = new Map();
  pending.forEach(({ bulkRunId, createdAt }) => {
    if (!newest.has(bulkRunId) || createdAt > newest.get(bulkRunId)) newest.set(bulkRunId, createdAt);
  });
  return [...newest].filter(([, createdAt]) => createdAt <= cutoffIso).map(([bulkRunId]) => bulkRunId);
}

/** Sends left in flight by a crash go back to pending. At-least-once in that one case. */
async function reclaimStale(cutoffIso) {
  await inTx((tx) => tx.run(UPDATE(EVENT).set({ status: 'pending', claimId: null }).where({ status: 'sending', claimedAt: { '<=': cutoffIso } })));
}

module.exports = {
  readSnapshots, addBaseline, updateState, markAppLock, markUnlocked, lastLockedAt,
  claimLock, claimRun, setStatus, idleRuns, reclaimStale,
};
