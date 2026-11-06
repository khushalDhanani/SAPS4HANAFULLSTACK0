'use strict';

const os = require('os');
const crypto = require('crypto');
const cds = require('@sap/cds');

const { SELECT, INSERT, UPDATE, DELETE, UPSERT } = cds.ql;

const SNAPSHOT = 'saps4hana.admin.UserLockSnapshot';
const CONTEXT = 'saps4hana.admin.UserLockContext';
const EVENT = 'saps4hana.admin.UserLockNotification';
const MONITOR = 'saps4hana.admin.UserLockMonitor';
const MONITOR_ID = 'lock-monitor';

function generateWorkerId() {
  const instance = process.env.CF_INSTANCE_INDEX ?? '';
  const guid = process.env.CF_INSTANCE_GUID ?? '';
  const prefix = guid || instance !== '' ? `cf:${guid || instance}` : `${os.hostname()}:${process.pid}`;
  return `${prefix}:${crypto.randomBytes(4).toString('hex')}`;
}

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

/**
 * Persists an immediate Fiori application lock event and updates the snapshot
 * so background polling treats the user as already locked.
 */
async function recordAppLockEvent(event) {
  return inTx(async (tx) => {
    const existing = await tx.run(
      SELECT.one.from(EVENT)
        .columns('username', 'status', 'historyKey', 'lockedAt')
        .where({ username: event.username, lockedAt: event.lockedAt })
    );
    if (!existing) {
      await tx.run(INSERT.into(EVENT).entries({
        ...event,
        status: 'pending',
        attempts: 0,
        failureAudited: false,
        claimOwner: null,
        claimedAt: null,
        claimExpiresAt: null,
        nextRetryAt: null,
      }));
    }

    await tx.run(UPSERT.into(SNAPSHOT).entries({
      username: event.username,
      uflag: event.uflag || 64,
      seenAt: event.detectedAt || new Date().toISOString(),
    }));
  });
}

async function lastLockedAt(username) {
  const row = await inTx((tx) => tx.run(SELECT.one.from(EVENT).columns('lockedAt').where({ username }).orderBy('lockedAt desc')));
  return row ? row.lockedAt : '';
}

/**
 * Stores one cycle's outcome in one transaction, so a crash cannot record a lock without its email or the reverse.
 * Deduplicates events by exact primary key (username, lockedAt), stable SAP historyKey, and active queue reconciliation.
 */
async function commitCycle({ states = [], removed = [], events = [], usedContexts = [], expiredBefore, historyCursor }, nowIso) {
  await inTx(async (tx) => {
    if (states.length) {
      await tx.run(UPSERT.into(SNAPSHOT).entries(states.map(({ username, uflag }) => ({ username, uflag, seenAt: nowIso }))));
    }
    if (removed.length) await tx.run(DELETE.from(SNAPSHOT).where({ username: { in: removed } }));
    for (const event of events) {
      // 1. Exact primary key match: same user and same lockedAt timestamp
      const existing = await tx.run(
        SELECT.one.from(EVENT)
          .columns('username', 'status', 'historyKey', 'lockedAt')
          .where({ username: event.username, lockedAt: event.lockedAt })
      );
      if (existing) continue;

      // 2. Reconcile with already queued or processing Fiori lock events:
      // If an active event (pending or processing) for this user is already queued (e.g. from Fiori app)
      // and has no historyKey, reconcile it with this SAP history change rather than duplicating.
      const activePending = await tx.run(
        SELECT.one.from(EVENT)
          .columns('username', 'lockedAt', 'historyKey', 'source', 'status')
          .where({
            username: event.username,
            status: { in: ['pending', 'processing'] },
          })
      );
      if (activePending) {
        if (event.historyKey && !activePending.historyKey) {
          await tx.run(
            UPDATE(EVENT)
              .set({ historyKey: event.historyKey })
              .where({ username: activePending.username, lockedAt: activePending.lockedAt })
          );
        }
        continue;
      }

      // 2b. Reconcile with recently sent Fiori lock event:
      // If a Fiori lock was sent recently without historyKey, enrich it rather than creating a duplicate
      const recentSentAppLock = await tx.run(
        SELECT.one.from(EVENT)
          .columns('username', 'lockedAt', 'historyKey', 'source', 'status', 'detectedAt')
          .where({
            username: event.username,
            source: 'Fiori app',
            status: 'sent',
          })
          .orderBy('detectedAt desc')
      );
      if (recentSentAppLock) {
        const sentTime = new Date(recentSentAppLock.detectedAt).getTime();
        const eventTime = event.detectedAt ? new Date(event.detectedAt).getTime() : Date.now();
        if (Math.abs(eventTime - sentTime) <= 5 * 60 * 1000) {
          if (event.historyKey && !recentSentAppLock.historyKey) {
            await tx.run(
              UPDATE(EVENT)
                .set({ historyKey: event.historyKey })
                .where({ username: recentSentAppLock.username, lockedAt: recentSentAppLock.lockedAt })
            );
          }
          continue;
        }
      }

      // 3. Not existing: insert cleanly into the queue
      await tx.run(INSERT.into(EVENT).entries({
        ...event,
        status: 'pending',
        attempts: 0,
        failureAudited: false,
        claimOwner: null,
        claimedAt: null,
        claimExpiresAt: null,
        nextRetryAt: null,
      }));
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

/**
 * Atomically claims pending or expired-lease events for a worker.
 * Uses a DB transaction with conditional UPDATE to guarantee mutual exclusion across instances/workers.
 */
async function claimPendingEvents({
  workerId = generateWorkerId(),
  now = new Date(),
  leaseDurationMs = 60 * 1000,
  limit = 1000,
} = {}) {
  const nowIso = now.toISOString();
  const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs).toISOString();

  return inTx(async (tx) => {
    const candidates = await tx.run(
      SELECT.from(EVENT)
        .where`(status = 'pending' and (nextRetryAt is null or nextRetryAt <= ${nowIso})) or (status = 'processing' and claimExpiresAt is not null and claimExpiresAt <= ${nowIso})`
        .orderBy('detectedAt', 'username')
        .limit(limit)
    );

    if (!candidates.length) return [];

    const claimed = [];
    for (const candidate of candidates) {
      const updated = await tx.run(
        UPDATE(EVENT)
          .set({
            status: 'processing',
            claimOwner: workerId,
            claimedAt: nowIso,
            claimExpiresAt: leaseExpiresAt,
          })
          .where({
            username: candidate.username,
            lockedAt: candidate.lockedAt,
            status: candidate.status,
          })
      );

      if (updated > 0) {
        claimed.push({
          ...candidate,
          status: 'processing',
          claimOwner: workerId,
          claimedAt: nowIso,
          claimExpiresAt: leaseExpiresAt,
        });
      }
    }

    return claimed;
  });
}

/**
 * Transitions claimed events to 'sent' status upon successful delivery, clearing claim leases.
 */
async function completeEvents(events, { sentAt = new Date().toISOString(), attempts, lastError = '' } = {}) {
  await inTx(async (tx) => {
    for (const event of events) {
      const eventAttempts = typeof attempts === 'function' ? attempts(event) : (attempts ?? event.attempts);
      await tx.run(
        UPDATE(EVENT)
          .set({
            status: 'sent',
            sentAt,
            attempts: eventAttempts,
            lastError,
            claimOwner: null,
            claimedAt: null,
            claimExpiresAt: null,
            nextRetryAt: null,
          })
          .where({
            username: event.username,
            lockedAt: event.lockedAt,
          })
      );
    }
  });
}

/**
 * Releases claimed events back to 'pending' (or marks 'failed' if max attempts reached) with backoff.
 */
async function releaseOrFailEvents(events, {
  attempts,
  lastError = '',
  nextRetryAt = null,
  maxAttempts = 30,
  failureAudited = true,
} = {}) {
  await inTx(async (tx) => {
    for (const event of events) {
      const eventAttempts = typeof attempts === 'function' ? attempts(event) : (attempts ?? event.attempts);
      const isFailed = eventAttempts >= maxAttempts;
      await tx.run(
        UPDATE(EVENT)
          .set({
            status: isFailed ? 'failed' : 'pending',
            attempts: eventAttempts,
            lastError,
            failureAudited,
            nextRetryAt,
            claimOwner: null,
            claimedAt: null,
            claimExpiresAt: null,
          })
          .where({
            username: event.username,
            lockedAt: event.lockedAt,
          })
      );
    }
  });
}

async function pendingEvents({ includeProcessing = true } = {}) {
  const statuses = includeProcessing ? ['pending', 'processing'] : ['pending'];
  return inTx((tx) => tx.run(SELECT.from(EVENT).where({ status: { in: statuses } }).orderBy('detectedAt', 'username')));
}

async function updateEvents(events, fieldsOf) {
  await inTx(async (tx) => {
    for (const event of events) {
      const fields = typeof fieldsOf === 'function' ? fieldsOf(event) : fieldsOf;
      if (fields.status === 'sent') {
        fields.claimOwner = null;
        fields.claimExpiresAt = null;
        fields.claimedAt = null;
        fields.nextRetryAt = null;
      } else if (fields.status === 'pending') {
        fields.claimOwner = null;
        fields.claimExpiresAt = null;
        fields.claimedAt = null;
      }
      await tx.run(UPDATE(EVENT).set(fields).where({ username: event.username, lockedAt: event.lockedAt }));
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

async function failedEvents() {
  return inTx((tx) => tx.run(SELECT.from(EVENT).where({ status: 'failed' })));
}

async function lastDispatchedAt() {
  const row = await inTx((tx) => tx.run(
    SELECT.one.from(EVENT).columns('sentAt').where({ status: 'sent' }).orderBy('sentAt desc')
  ));
  return row ? row.sentAt : null;
}

async function readHistoryCursor() {
  const row = await inTx((tx) => tx.run(SELECT.one.from(MONITOR).columns('ush02At', 'ush02Key').where({ id: MONITOR_ID })));
  return row && row.ush02At && row.ush02Key ? { at: row.ush02At, key: row.ush02Key } : null;
}

module.exports = {
  generateWorkerId, inTx, readSnapshots, readContexts, writeContext, setContextHistoryKey, discardContext,
  recordAppLockEvent, lastLockedAt, commitCycle, claimPendingEvents, completeEvents, releaseOrFailEvents,
  pendingEvents, failedEvents, lastDispatchedAt, updateEvents, eventsOfRun, saveMonitor, readMonitor, readHistoryCursor,
};
