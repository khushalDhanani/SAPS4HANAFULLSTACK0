'use strict';

const cds = require('@sap/cds');
const store = require('../../../srv/admin/passwordExpiryStore');

const { SELECT, DELETE } = cds.ql;

cds.test(__dirname + '/../../../');

describe('passwordExpiryStore pure helpers', () => {
  describe('resolveMilestone', () => {
    test('resolves expired when status is expired', () => {
      expect(store.resolveMilestone({ pwdStatus: 'expired' })).toBe('expired');
    });

    test('resolves initial when status is initial', () => {
      expect(store.resolveMilestone({ pwdStatus: 'initial' })).toBe('initial');
    });

    test('resolves milestone buckets for expiring_soon based on days remaining', () => {
      expect(store.resolveMilestone({ pwdStatus: 'expiring_soon', pwdDaysRemaining: 14 })).toBe('14_days');
      expect(store.resolveMilestone({ pwdStatus: 'expiring_soon', pwdDaysRemaining: 10 })).toBe('14_days');
      expect(store.resolveMilestone({ pwdStatus: 'expiring_soon', pwdDaysRemaining: 7 })).toBe('7_days');
      expect(store.resolveMilestone({ pwdStatus: 'expiring_soon', pwdDaysRemaining: 5 })).toBe('7_days');
      expect(store.resolveMilestone({ pwdStatus: 'expiring_soon', pwdDaysRemaining: 3 })).toBe('3_days');
      expect(store.resolveMilestone({ pwdStatus: 'expiring_soon', pwdDaysRemaining: 2 })).toBe('3_days');
      expect(store.resolveMilestone({ pwdStatus: 'expiring_soon', pwdDaysRemaining: 1 })).toBe('1_day');
      expect(store.resolveMilestone({ pwdStatus: 'expiring_soon', pwdDaysRemaining: 0 })).toBe('1_day');
    });

    test('returns 14_days when pwdDaysRemaining is missing for expiring_soon', () => {
      expect(store.resolveMilestone({ pwdStatus: 'expiring_soon' })).toBe('14_days');
    });

    test('returns null for valid and exempt users', () => {
      expect(store.resolveMilestone({ pwdStatus: 'valid' })).toBeNull();
      expect(store.resolveMilestone({ pwdStatus: 'exempt' })).toBeNull();
      expect(store.resolveMilestone({})).toBeNull();
    });
  });

  describe('generateWorkerId', () => {
    let savedIndex;
    let savedGuid;

    beforeEach(() => {
      savedIndex = process.env.CF_INSTANCE_INDEX;
      savedGuid = process.env.CF_INSTANCE_GUID;
    });

    afterEach(() => {
      if (savedIndex !== undefined) process.env.CF_INSTANCE_INDEX = savedIndex;
      else delete process.env.CF_INSTANCE_INDEX;

      if (savedGuid !== undefined) process.env.CF_INSTANCE_GUID = savedGuid;
      else delete process.env.CF_INSTANCE_GUID;
    });

    test('generates worker ID with hostname and pid when not in Cloud Foundry', () => {
      delete process.env.CF_INSTANCE_INDEX;
      delete process.env.CF_INSTANCE_GUID;
      const workerId = store.generateWorkerId();
      expect(workerId).toMatch(/^[^:]+:\d+:[a-f0-9]{8}$/);
    });

    test('generates worker ID with CF instance index when present', () => {
      process.env.CF_INSTANCE_INDEX = '0';
      delete process.env.CF_INSTANCE_GUID;
      const workerId = store.generateWorkerId();
      expect(workerId).toMatch(/^cf:0:[a-f0-9]{8}$/);
    });

    test('generates worker ID with CF instance GUID when present', () => {
      process.env.CF_INSTANCE_GUID = 'abcd-1234';
      const workerId = store.generateWorkerId();
      expect(workerId).toMatch(/^cf:abcd-1234:[a-f0-9]{8}$/);
    });
  });
});

describe('passwordExpiryStore database operations', () => {
  beforeEach(async () => {
    for (const entity of [store.SNAPSHOT, store.EVENT, store.MONITOR]) {
      await cds.db.run(DELETE.from(entity));
    }
  });

  describe('commitCycle', () => {
    test('persists snapshots and inserts milestone notification events', async () => {
      const users = [
        {
          username: 'ALICE',
          userType: 'A',
          fullName: 'Alice Smith',
          pwdLastChanged: '20260822',
          pwdExpiresAt: '20261120',
          pwdDaysRemaining: 14,
          pwdStatus: 'expiring_soon'
        },
        {
          username: 'BOB',
          userType: 'A',
          fullName: 'Bob Jones',
          pwdLastChanged: '20260101',
          pwdExpiresAt: '20260401',
          pwdDaysRemaining: -219,
          pwdStatus: 'expired'
        },
        {
          username: 'CHARLIE',
          userType: 'A',
          fullName: 'Charlie Brown',
          pwdLastChanged: '20261001',
          pwdExpiresAt: '20261230',
          pwdDaysRemaining: 54,
          pwdStatus: 'valid'
        }
      ];

      const result = await store.commitCycle({
        users,
        cycleDate: '20261106',
        nowIso: '2026-11-06T10:00:00.000Z'
      });

      expect(result.snapshotCount).toBe(3);
      expect(result.queuedEvents).toBe(2); // ALICE (14_days) and BOB (expired)

      const snapshots = await cds.db.run(SELECT.from(store.SNAPSHOT));
      expect(snapshots).toHaveLength(3);

      const events = await cds.db.run(SELECT.from(store.EVENT));
      expect(events).toHaveLength(2);
      expect(events.map((e) => e.username).sort()).toEqual(['ALICE', 'BOB']);
      expect(events.find((e) => e.username === 'ALICE').milestone).toBe('14_days');
      expect(events.find((e) => e.username === 'BOB').milestone).toBe('expired');
    });

    test('deduplicates milestone events for the same cycle date and milestone', async () => {
      const users = [
        {
          username: 'ALICE',
          fullName: 'Alice Smith',
          pwdDaysRemaining: 14,
          pwdStatus: 'expiring_soon'
        }
      ];

      // First run
      const run1 = await store.commitCycle({
        users,
        cycleDate: '20261106'
      });
      expect(run1.queuedEvents).toBe(1);

      // Second run on same cycle date
      const run2 = await store.commitCycle({
        users,
        cycleDate: '20261106'
      });
      expect(run2.queuedEvents).toBe(0);

      const events = await cds.db.run(SELECT.from(store.EVENT));
      expect(events).toHaveLength(1);
    });

    test('queues new event if milestone changes on subsequent cycle', async () => {
      const usersDay1 = [
        {
          username: 'ALICE',
          fullName: 'Alice Smith',
          pwdDaysRemaining: 14,
          pwdStatus: 'expiring_soon'
        }
      ];

      await store.commitCycle({
        users: usersDay1,
        cycleDate: '20261106'
      });

      // 7 days later: milestone changes to 7_days
      const usersDay7 = [
        {
          username: 'ALICE',
          fullName: 'Alice Smith',
          pwdDaysRemaining: 7,
          pwdStatus: 'expiring_soon'
        }
      ];

      const run2 = await store.commitCycle({
        users: usersDay7,
        cycleDate: '20261113'
      });
      expect(run2.queuedEvents).toBe(1);

      const events = await cds.db.run(SELECT.from(store.EVENT));
      expect(events).toHaveLength(2);
    });
  });

  describe('claimPendingEvents, completeEvents, and releaseOrFailEvents', () => {
    beforeEach(async () => {
      await store.commitCycle({
        users: [
          {
            username: 'USER1',
            fullName: 'User One',
            pwdDaysRemaining: 14,
            pwdStatus: 'expiring_soon'
          },
          {
            username: 'USER2',
            fullName: 'User Two',
            pwdDaysRemaining: -5,
            pwdStatus: 'expired'
          }
        ],
        cycleDate: '20261106',
        nowIso: '2026-11-06T10:00:00.000Z'
      });
    });

    test('claimPendingEvents claims events atomically with worker lease', async () => {
      const claimed = await store.claimPendingEvents('worker-1', {
        limit: 10,
        leaseMs: 30000,
        nowIso: '2026-11-06T10:00:00.000Z'
      });

      expect(claimed).toHaveLength(2);
      expect(claimed[0].claimOwner).toBe('worker-1');
      expect(claimed[0].status).toBe('processing');

      // Second worker attempting to claim should get 0 because lease is active
      const secondClaim = await store.claimPendingEvents('worker-2', {
        nowIso: '2026-11-06T10:00:10.000Z'
      });
      expect(secondClaim).toHaveLength(0);
    });

    test('reclaims expired lease', async () => {
      await store.claimPendingEvents('worker-1', {
        limit: 10,
        leaseMs: 30000,
        nowIso: '2026-11-06T10:00:00.000Z'
      });

      // After lease expires (31s later)
      const reclaimed = await store.claimPendingEvents('worker-2', {
        limit: 10,
        leaseMs: 30000,
        nowIso: '2026-11-06T10:00:31.000Z'
      });

      expect(reclaimed).toHaveLength(2);
      expect(reclaimed[0].claimOwner).toBe('worker-2');
    });

    test('completeEvents marks events as sent and clears lease', async () => {
      const claimed = await store.claimPendingEvents('worker-1', {
        nowIso: '2026-11-06T10:00:00.000Z'
      });

      await store.completeEvents(claimed, { sentAt: '2026-11-06T10:00:05.000Z' });

      const events = await cds.db.run(SELECT.from(store.EVENT));
      expect(events.every((e) => e.status === 'sent')).toBe(true);
      expect(events.every((e) => e.sentAt === '2026-11-06T10:00:05.000Z')).toBe(true);
      expect(events.every((e) => e.claimOwner === null)).toBe(true);
      expect(events.every((e) => e.attempts === 1)).toBe(true);
    });

    test('releaseOrFailEvents releases back to pending with backoff', async () => {
      const claimed = await store.claimPendingEvents('worker-1', {
        nowIso: '2026-11-06T10:00:00.000Z'
      });

      const nextRetryAt = '2026-11-06T10:01:00.000Z';
      await store.releaseOrFailEvents(claimed, {
        lastError: 'SMTP connection timeout',
        nextRetryAt,
        maxAttempts: 3
      });

      const events = await cds.db.run(SELECT.from(store.EVENT));
      expect(events.every((e) => e.status === 'pending')).toBe(true);
      expect(events.every((e) => e.lastError === 'SMTP connection timeout')).toBe(true);
      expect(events.every((e) => e.nextRetryAt === nextRetryAt)).toBe(true);
      expect(events.every((e) => e.attempts === 1)).toBe(true);
      expect(events.every((e) => e.claimOwner === null)).toBe(true);
    });

    test('releaseOrFailEvents marks as failed when max attempts exceeded', async () => {
      const claimed = await store.claimPendingEvents('worker-1', {
        nowIso: '2026-11-06T10:00:00.000Z'
      });

      // Simulate event already had 2 attempts
      claimed[0].attempts = 2;
      claimed[1].attempts = 2;

      await store.releaseOrFailEvents(claimed, {
        lastError: 'Permanent failure',
        maxAttempts: 3
      });

      const events = await cds.db.run(SELECT.from(store.EVENT));
      expect(events.every((e) => e.status === 'failed')).toBe(true);
      expect(events.every((e) => e.attempts === 3)).toBe(true);
    });
  });

  describe('recordMonitorHealth', () => {
    test('records ok monitor status and aggregates pending & failed counts', async () => {
      // Seed 1 pending and 1 failed event
      await store.commitCycle({
        users: [
          { username: 'PENDING_USER', pwdStatus: 'expiring_soon', pwdDaysRemaining: 14 },
          { username: 'FAILED_USER', pwdStatus: 'expired' }
        ],
        cycleDate: '20261106'
      });

      const claimed = await store.claimPendingEvents('worker-1');
      // Mark one failed
      claimed[1].attempts = 9;
      await store.releaseOrFailEvents([claimed[1]], { maxAttempts: 10 });

      await store.recordMonitorHealth({
        status: 'ok',
        durationMs: 750,
        totalMonitored: 100,
        counts: {
          valid: 80,
          expiringSoon: 10,
          expired: 8,
          initial: 1,
          exempt: 1
        },
        dispatchedAt: '2026-11-06T10:00:00.000Z'
      });

      const monitor = await cds.db.run(SELECT.one.from(store.MONITOR).where({ id: 'main' }));
      expect(monitor).toBeDefined();
      expect(monitor.lastStatus).toBe('ok');
      expect(monitor.lastRunDurationMs).toBe(750);
      expect(monitor.totalMonitoredUsers).toBe(100);
      expect(monitor.validCount).toBe(80);
      expect(monitor.expiringSoonCount).toBe(10);
      expect(monitor.expiredCount).toBe(8);
      expect(monitor.lastNotificationDispatchedAt).toBe('2026-11-06T10:00:00.000Z');
      expect(monitor.pendingNotificationCount).toBe(0); // USER1 is processing or pending
      expect(monitor.failedNotificationCount).toBe(1);
    });
  });
});
