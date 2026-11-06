'use strict';

const cds = require('@sap/cds');

const { SELECT, INSERT, UPDATE, DELETE, UPSERT } = cds.ql;

const SNAPSHOT = 'saps4hana.admin.UserLockSnapshot';
const CONTEXT = 'saps4hana.admin.UserLockContext';
const EVENT = 'saps4hana.admin.UserLockNotification';
const MONITOR = 'saps4hana.admin.UserLockMonitor';
const MONITOR_ID = 'lock-monitor';

/**
 * Every call commits on its own, never in the calling request's transaction: a request that ends in
 * req.reject rolls back, and these rows must survive it. There is no memory fallback, because a restart must
 * not lose them and production's 2 instances would not share it.
 */
function inTx(fn) {
  return cds.db.tx({ user: cds.User.privileged }, fn);
}

async function readSnapshots() {
  const rows = await inTx((tx) => tx.run(SELECT.from(SNAPSHOT)));
  return new Map(rows.map((row) => [row.username, row]));
}

async function readContexts() {
  return inTx((tx) => tx.run(SELECT.from(CONTEXT)));
}

async function writeContext(context) {
  await inTx((tx) => tx.run(UPSERT.into(CONTEXT).entries(context)));
}

async function setContextHistoryKey(username, historyKey) {
  await inTx((tx) => tx.run(UPDATE(CONTEXT).set({ historyKey }).where({ username })));
}

async function discardContext(username) {
  await inTx((tx) => tx.run(DELETE.from(CONTEXT).where({ username })));
}

async function lastLockedAt(username) {
  const row = await inTx((tx) => tx.run(SELECT.one.from(EVENT).columns('lockedAt').where({ username }).orderBy('lockedAt desc')));
  return row ? row.lockedAt : '';
}

/**
 * Stores one cycle's outcome in one transaction, so a crash cannot record a lock without its email or the reverse.
 * A key that already exists is the same lock again: it is not inserted, so it is not emailed twice.
 */
async function commitCycle({ states = [], removed = [], events = [], usedContexts = [], expiredBefore, historyCursor }, nowIso) {
  await inTx(async (tx) => {
    if (states.length) {
      await tx.run(UPSERT.into(SNAPSHOT).entries(states.map(({ username, uflag }) => ({ username, uflag, seenAt: nowIso }))));
    }
    if (removed.length) await tx.run(DELETE.from(SNAPSHOT).where({ username: { in: removed } }));
    for (const event of events) {
      const existing = await tx.run(SELECT.one.from(EVENT).columns('username').where({ username: event.username, lockedAt: event.lockedAt }));
      if (!existing) {
        await tx.run(INSERT.into(EVENT).entries({ ...event, status: 'pending', attempts: 0, failureAudited: false }));
      }
    }
    if (usedContexts.length) await tx.run(DELETE.from(CONTEXT).where({ username: { in: usedContexts } }));
    if (expiredBefore) {
      await tx.run(DELETE.from(CONTEXT).where({
        at: { '<': expiredBefore },
        historyKey: '',
      }));
      await tx.run(DELETE.from(CONTEXT).where({ at: { '<': expiredBefore }, historyKey: null }));
    }
    if (historyCursor) {
      const fields = { ush02At: historyCursor.at, ush02Key: historyCursor.key };
      const monitor = await tx.run(SELECT.one.from(MONITOR).columns('id').where({ id: MONITOR_ID }));
      if (monitor) await tx.run(UPDATE(MONITOR).set(fields).where({ id: MONITOR_ID }));
      else await tx.run(INSERT.into(MONITOR).entries({ id: MONITOR_ID, ...fields }));
    }
  });
}

async function pendingEvents() {
  return inTx((tx) => tx.run(SELECT.from(EVENT).where({ status: 'pending' }).orderBy('detectedAt', 'username')));
}

async function updateEvents(events, fieldsOf) {
  await inTx(async (tx) => {
    for (const event of events) {
      await tx.run(UPDATE(EVENT).set(fieldsOf(event)).where({ username: event.username, lockedAt: event.lockedAt }));
    }
  });
}

async function eventsOfRun(bulkRunId) {
  return inTx((tx) => tx.run(SELECT.from(EVENT).columns('status', 'attempts').where({ bulkRunId })));
}

async function saveMonitor(fields) {
  await inTx((tx) => tx.run(UPSERT.into(MONITOR).entries({ id: MONITOR_ID, ...fields })));
}

async function readMonitor() {
  const row = await inTx((tx) => tx.run(SELECT.one.from(MONITOR).where({ id: MONITOR_ID })));
  return row || null;
}

async function readHistoryCursor() {
  const row = await inTx((tx) => tx.run(SELECT.one.from(MONITOR).columns('ush02At', 'ush02Key').where({ id: MONITOR_ID })));
  return row && row.ush02At && row.ush02Key ? { at: row.ush02At, key: row.ush02Key } : null;
}

module.exports = {
  readSnapshots, readContexts, writeContext, setContextHistoryKey, discardContext, lastLockedAt, commitCycle,
  pendingEvents, updateEvents, eventsOfRun, saveMonitor, readMonitor, readHistoryCursor,
};
