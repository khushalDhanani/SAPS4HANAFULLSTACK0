'use strict';

const os = require('os');
const crypto = require('crypto');
const cds = require('@sap/cds');

const { SELECT, INSERT, UPDATE, UPSERT } = cds.ql;

const SNAPSHOT = 'saps4hana.admin.UserPasswordSnapshot';
const EVENT = 'saps4hana.admin.UserPasswordNotification';
const MONITOR = 'saps4hana.admin.PasswordExpiryMonitor';
const MONITOR_ID = 'main';

function generateWorkerId() {
  const instance = process.env.CF_INSTANCE_INDEX ?? '';
  const guid = process.env.CF_INSTANCE_GUID ?? '';
  const prefix = guid || instance !== '' ? `cf:${guid || instance}` : `${os.hostname()}:${process.pid}`;
  return `${prefix}:${crypto.randomBytes(4).toString('hex')}`;
}

function inTx(fn) {
  if (!cds.db) throw new Error('Database not connected');
  return cds.db.tx({ user: cds.User.privileged }, fn);
}

/**
 * Resolves the milestone bucket for a user based on days remaining.
 */
function resolveMilestone(user) {
  if (user.pwdStatus === 'expired') return 'expired';
  if (user.pwdStatus === 'initial') return 'initial';
  if (user.pwdStatus === 'expiring_soon') {
    const days = user.pwdDaysRemaining;
    if (days !== null && days !== undefined) {
      if (days <= 1) return '1_day';
      if (days <= 3) return '3_days';
      if (days <= 7) return '7_days';
      return '14_days';
    }
    return '14_days';
  }
  return null;
}

/**
 * Commits a polling cycle's password snapshots and queues new milestone alert events.
 *
 * @param {object} params
 * @param {object[]} params.users - enriched users from readPasswordExpiryData
 * @param {string} params.cycleDate - YYYYMMDD
 * @param {string} [params.nowIso] - ISO timestamp
 * @returns {Promise<{snapshotCount: number, queuedEvents: number}>}
 */
async function commitCycle({ users = [], cycleDate, nowIso = new Date().toISOString() }) {
  return inTx(async (tx) => {
    // 1. Upsert snapshots
    if (users.length) {
      const snapshotEntries = users.map((u) => ({
        username: u.username,
        userType: u.userType || '',
        pwdLastChanged: u.pwdLastChanged || '',
        pwdExpiresAt: u.pwdExpiresAt || '',
        pwdDaysRemaining: u.pwdDaysRemaining ?? null,
        pwdStatus: u.pwdStatus || 'valid',
        validFrom: u.validFrom || '',
        validTo: u.validTo || '',
        uflag: u.uflag || 0,
        lastLogonDate: u.lastLogonDate || '',
        seenAt: nowIso
      }));
      await tx.run(UPSERT.into(SNAPSHOT).entries(snapshotEntries));
    }

    // 2. Queue milestone events for users requiring notification
    let queuedEvents = 0;
    for (const u of users) {
      const milestone = resolveMilestone(u);
      if (!milestone) continue;

      // Check if this milestone has already been queued or sent for this user on this cycle date
      const existing = await tx.run(
        SELECT.one.from(EVENT)
          .columns('username', 'milestone', 'cycleDate', 'status')
          .where({ username: u.username, milestone, cycleDate })
      );

      if (!existing) {
        await tx.run(
          INSERT.into(EVENT).entries({
            username: u.username,
            milestone,
            cycleDate,
            fullName: u.fullName || '',
            userType: u.userType || '',
            daysRemaining: u.pwdDaysRemaining ?? null,
            expiryDate: u.pwdExpiresAt || '',
            status: 'pending',
            attempts: 0,
            failureAudited: false,
            detectedAt: nowIso,
            sentAt: null,
            lastError: '',
            claimOwner: null,
            claimedAt: null,
            claimExpiresAt: null,
            nextRetryAt: null
          })
        );
        queuedEvents++;
      }
    }

    return { snapshotCount: users.length, queuedEvents };
  });
}

/**
 * Atomically claims pending or expired-lease notification events for processing.
 */
async function claimPendingEvents(workerId, { limit = 100, leaseMs = 60000, nowIso = new Date().toISOString() } = {}) {
  const leaseExpiresAt = new Date(new Date(nowIso).getTime() + leaseMs).toISOString();

  return inTx(async (tx) => {
    const candidates = await tx.run(
      SELECT.from(EVENT)
        .where`(status = 'pending' and (nextRetryAt is null or nextRetryAt <= ${nowIso})) or (status = 'processing' and claimExpiresAt is not null and claimExpiresAt <= ${nowIso})`
        .orderBy('detectedAt', 'username')
        .limit(limit)
    );

    if (!candidates.length) return [];

    const claimed = [];
    for (const c of candidates) {
      const updated = await tx.run(
        UPDATE(EVENT)
          .set({
            status: 'processing',
            claimOwner: workerId,
            claimedAt: nowIso,
            claimExpiresAt: leaseExpiresAt
          })
          .where({
            username: c.username,
            milestone: c.milestone,
            cycleDate: c.cycleDate,
            status: c.status
          })
      );

      if (updated > 0) {
        claimed.push({
          ...c,
          status: 'processing',
          claimOwner: workerId,
          claimedAt: nowIso,
          claimExpiresAt: leaseExpiresAt
        });
      }
    }

    return claimed;
  });
}

/**
 * Transitions claimed events to 'sent'.
 */
async function completeEvents(events, { sentAt = new Date().toISOString() } = {}) {
  return inTx(async (tx) => {
    for (const e of events) {
      await tx.run(
        UPDATE(EVENT)
          .set({
            status: 'sent',
            sentAt,
            attempts: (e.attempts || 0) + 1,
            lastError: '',
            claimOwner: null,
            claimedAt: null,
            claimExpiresAt: null,
            nextRetryAt: null
          })
          .where({
            username: e.username,
            milestone: e.milestone,
            cycleDate: e.cycleDate
          })
      );
    }
  });
}

/**
 * Releases claimed events back to 'pending' with retry backoff, or marks as 'failed'.
 */
async function releaseOrFailEvents(events, {
  lastError = '',
  nextRetryAt = null,
  maxAttempts = 10
} = {}) {
  return inTx(async (tx) => {
    for (const e of events) {
      const nextAttempts = (e.attempts || 0) + 1;
      const isFailed = nextAttempts >= maxAttempts;

      await tx.run(
        UPDATE(EVENT)
          .set({
            status: isFailed ? 'failed' : 'pending',
            attempts: nextAttempts,
            lastError: String(lastError || '').slice(0, 60),
            claimOwner: null,
            claimedAt: null,
            claimExpiresAt: null,
            nextRetryAt: isFailed ? null : nextRetryAt
          })
          .where({
            username: e.username,
            milestone: e.milestone,
            cycleDate: e.cycleDate
          })
      );
    }
  });
}

/**
 * Updates PasswordExpiryMonitor record.
 */
async function recordMonitorHealth({
  status,
  durationMs = 0,
  totalMonitored = 0,
  counts = {},
  errorMessage = '',
  dispatchedAt = null,
  nowIso = new Date().toISOString()
}) {
  return inTx(async (tx) => {
    const pendingCount = (await tx.run(
      SELECT.one.from(EVENT).columns('count(1) as cnt').where({ status: 'pending' })
    ))?.cnt || 0;

    const failedCount = (await tx.run(
      SELECT.one.from(EVENT).columns('count(1) as cnt').where({ status: 'failed' })
    ))?.cnt || 0;

    await tx.run(
      UPSERT.into(MONITOR).entries({
        id: MONITOR_ID,
        lastRunAt: nowIso,
        lastStatus: status,
        lastRunDurationMs: durationMs,
        totalMonitoredUsers: totalMonitored,
        validCount: counts.valid || 0,
        expiringSoonCount: counts.expiringSoon || 0,
        expiredCount: counts.expired || 0,
        initialPasswordCount: counts.initial || 0,
        exemptCount: counts.exempt || 0,
        lastNotificationDispatchedAt: dispatchedAt,
        pendingNotificationCount: Number(pendingCount),
        failedNotificationCount: Number(failedCount),
        errorMessage: String(errorMessage || '').slice(0, 255)
      })
    );
  });
}

module.exports = {
  generateWorkerId,
  resolveMilestone,
  commitCycle,
  claimPendingEvents,
  completeEvents,
  releaseOrFailEvents,
  recordMonitorHealth,
  SNAPSHOT,
  EVENT,
  MONITOR
};
