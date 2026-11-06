'use strict';

/**
 * Integration tests for the reliable SAP user-lock notification queue.
 * Tests database-backed atomic claiming, lease recovery, deduplication,
 * SMTP retry handling, restart recovery, already-sent protection, and bulk consolidation.
 */

jest.mock('../../srv/common/mailer', () => ({
  isConfigured: jest.fn(() => true),
  sendMail: jest.fn(),
}));

const cds = require('@sap/cds');
const mailer = require('../../srv/common/mailer');
const monitor = require('../../srv/admin/lockNotifier');
const store = require('../../srv/admin/lockEventStore');

cds.test(__dirname + '/../../');

const EVENT = 'saps4hana.admin.UserLockNotification';
const SNAPSHOT = 'saps4hana.admin.UserLockSnapshot';
const CONTEXT = 'saps4hana.admin.UserLockContext';
const MONITOR = 'saps4hana.admin.UserLockMonitor';
const { SELECT, DELETE, INSERT } = cds.ql;

const NO_WAIT = [0, 0, 0];
let clock;
const tick = (ms = 60000) => { clock = new Date(clock.getTime() + ms); return clock; };

describe('Integration: Reliable User Lock Notification Queue', () => {
  beforeEach(async () => {
    clock = new Date('2026-11-06T10:00:00.000Z');
    for (const entity of [EVENT, SNAPSHOT, CONTEXT, MONITOR]) {
      await cds.db.run(DELETE.from(entity));
    }
    mailer.sendMail.mockReset();
    mailer.sendMail.mockResolvedValue({});
    mailer.isConfigured.mockReturnValue(true);
    process.env.LOCK_NOTIFY_TO = 'khushal@example.test';
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.LOCK_NOTIFY_TO;
  });

  describe('1. Duplicate event insertion', () => {
    test('identical (username, lockedAt) is never inserted twice', async () => {
      const lockEvent = {
        username: 'ALICE',
        lockedAt: '20261106100000',
        uflag: 64,
        lockType: 'Locked by administrator',
        lockedBy: 'ADMIN',
        fullName: 'Alice Smith',
        source: 'SAP / automatic',
        reason: '',
        bulkRunId: '',
        detectedAt: clock.toISOString(),
        historyKey: '["220","ALICE","ADMIN","SU01","SAPMSYST"]',
      };

      // First insertion
      await store.commitCycle({ events: [lockEvent] }, clock.toISOString());
      const firstRows = await cds.db.run(SELECT.from(EVENT));
      expect(firstRows).toHaveLength(1);
      expect(firstRows[0]).toMatchObject({ username: 'ALICE', lockedAt: '20261106100000', status: 'pending' });

      // Second insertion of identical event
      await store.commitCycle({ events: [lockEvent] }, clock.toISOString());
      const secondRows = await cds.db.run(SELECT.from(EVENT));
      expect(secondRows).toHaveLength(1);
    });

    test('reconciles and enriches an existing active event without duplicate insertion', async () => {
      // Step 1: Fiori-queued event without historyKey
      await cds.db.run(INSERT.into(EVENT).entries({
        username: 'BOB',
        lockedAt: '20261106100000',
        uflag: 64,
        lockType: 'Locked by administrator',
        lockedBy: 'KHUSHAL',
        fullName: 'Bob Jones',
        source: 'Fiori app',
        reason: 'Terminated',
        bulkRunId: '',
        status: 'pending',
        attempts: 0,
        failureAudited: false,
        detectedAt: clock.toISOString(),
      }));

      // Step 2: Later poller cycle sees USH02 row and attempts to commit
      const sapHistoryEvent = {
        username: 'BOB',
        lockedAt: '20261106100005',
        uflag: 64,
        lockType: 'Locked by administrator',
        lockedBy: 'KHUSHAL',
        fullName: 'Bob Jones',
        source: 'Fiori app',
        reason: 'Terminated',
        bulkRunId: '',
        detectedAt: clock.toISOString(),
        historyKey: '["220","BOB","KHUSHAL","","RFBAPI_USER_LOCK"]',
      };

      await store.commitCycle({ events: [sapHistoryEvent] }, clock.toISOString());
      const rows = await cds.db.run(SELECT.from(EVENT));
      // Must not insert a duplicate row
      expect(rows).toHaveLength(1);
      // Reconciles historyKey onto the existing active event
      expect(rows[0]).toMatchObject({
        username: 'BOB',
        status: 'pending',
        historyKey: '["220","BOB","KHUSHAL","","RFBAPI_USER_LOCK"]',
      });
    });
  });

  describe('2. Two concurrent workers claiming events', () => {
    test('two workers competing on the same pending events claim exclusively without duplication', async () => {
      // Seed two pending events
      await cds.db.run(INSERT.into(EVENT).entries([
        {
          username: 'USER1', lockedAt: '20261106100001', status: 'pending', attempts: 0,
          detectedAt: clock.toISOString(), uflag: 64, lockType: 'Locked by administrator',
        },
        {
          username: 'USER2', lockedAt: '20261106100002', status: 'pending', attempts: 0,
          detectedAt: clock.toISOString(), uflag: 64, lockType: 'Locked by administrator',
        },
      ]));

      // Worker 1 and Worker 2 claim concurrently
      const [claimed1, claimed2] = await Promise.all([
        store.claimPendingEvents({ workerId: 'worker-1', now: clock }),
        store.claimPendingEvents({ workerId: 'worker-2', now: clock }),
      ]);

      // Exactly one worker claims both (or each claims one disjoint subset), but NO overlap
      const claimedUsers1 = claimed1.map((e) => e.username);
      const claimedUsers2 = claimed2.map((e) => e.username);
      const totalClaimed = claimedUsers1.length + claimedUsers2.length;
      expect(totalClaimed).toBe(2);

      const intersection = claimedUsers1.filter((u) => claimedUsers2.includes(u));
      expect(intersection).toEqual([]);

      // Verify DB shows 'processing' with respective claimOwner
      const dbRows = await cds.db.run(SELECT.from(EVENT).orderBy('username'));
      expect(dbRows.every((r) => r.status === 'processing')).toBe(true);
      expect(dbRows.every((r) => r.claimOwner === 'worker-1' || r.claimOwner === 'worker-2')).toBe(true);
      expect(dbRows.every((r) => r.claimExpiresAt !== null)).toBe(true);
    });

    test('sendPending executed by two workers concurrently delivers email exactly once', async () => {
      await cds.db.run(INSERT.into(EVENT).entries({
        username: 'CONCURRENT_USER', lockedAt: '20261106100000', status: 'pending', attempts: 0,
        detectedAt: clock.toISOString(), uflag: 64, lockType: 'Locked by administrator',
      }));

      // Worker 1 and Worker 2 both call sendPending
      const [res1, res2] = await Promise.all([
        monitor.sendPending({ workerId: 'worker-1', now: clock, retryDelays: NO_WAIT }),
        monitor.sendPending({ workerId: 'worker-2', now: clock, retryDelays: NO_WAIT }),
      ]);

      // One worker sends, the other gets 'none'
      const results = [res1, res2].sort();
      expect(results).toEqual(['none', 'sent']);

      // Mailer called exactly once
      expect(mailer.sendMail).toHaveBeenCalledTimes(1);

      // Event is marked sent
      const [row] = await cds.db.run(SELECT.from(EVENT));
      expect(row.status).toBe('sent');
      expect(row.claimOwner).toBeNull();
      expect(row.claimExpiresAt).toBeNull();
    });
  });

  describe('3. Expired lease recovery', () => {
    test('a worker that crashed leaves an expired lease which is recovered by another worker', async () => {
      const pastTime = new Date(clock.getTime() - 10000); // 10s in the past
      await cds.db.run(INSERT.into(EVENT).entries({
        username: 'CRASHED_WORKER_USER',
        lockedAt: '20261106100000',
        status: 'processing',
        claimOwner: 'dead-worker-pid-999',
        claimedAt: new Date(clock.getTime() - 70000).toISOString(),
        claimExpiresAt: pastTime.toISOString(),
        attempts: 1,
        detectedAt: clock.toISOString(),
        uflag: 64,
        lockType: 'Locked by administrator',
      }));

      // Worker 2 sends email directly, automatically claiming and recovering the crashed worker's expired lease
      const outcome = await monitor.sendPending({ workerId: 'recovering-worker', now: clock, retryDelays: NO_WAIT });
      expect(outcome).toBe('sent');
      expect(mailer.sendMail).toHaveBeenCalledTimes(1);

      const [finalRow] = await cds.db.run(SELECT.from(EVENT));
      expect(finalRow.status).toBe('sent');
      expect(finalRow.claimOwner).toBeNull();
      expect(finalRow.claimExpiresAt).toBeNull();
    });

    test('an active non-expired lease is NOT claimed by another worker', async () => {
      const futureTime = new Date(clock.getTime() + 30000); // 30s in the future
      await cds.db.run(INSERT.into(EVENT).entries({
        username: 'ACTIVE_WORKER_USER',
        lockedAt: '20261106100000',
        status: 'processing',
        claimOwner: 'active-worker-pid-1',
        claimedAt: clock.toISOString(),
        claimExpiresAt: futureTime.toISOString(),
        attempts: 1,
        detectedAt: clock.toISOString(),
        uflag: 64,
        lockType: 'Locked by administrator',
      }));

      const claimed = await store.claimPendingEvents({ workerId: 'other-worker', now: clock });
      expect(claimed).toEqual([]);
    });
  });

  describe('4. SMTP failure and retry handling', () => {
    test('transient SMTP failure increments attempts, records error, releases lease, and sets backoff', async () => {
      await cds.db.run(INSERT.into(EVENT).entries({
        username: 'RETRY_USER', lockedAt: '20261106100000', status: 'pending', attempts: 0,
        detectedAt: clock.toISOString(), uflag: 64, lockType: 'Locked by administrator',
      }));

      mailer.sendMail.mockRejectedValue(Object.assign(new Error('Connection reset'), { code: 'ECONNRESET' }));

      const res = await monitor.sendPending({ workerId: 'worker-1', now: clock, retryDelays: NO_WAIT });
      expect(res).toBe('queued');

      const [row] = await cds.db.run(SELECT.from(EVENT));
      // Reverted to pending for future recovery
      expect(row.status).toBe('pending');
      expect(row.attempts).toBe(4); // initial + 3 retries
      expect(row.lastError).toBe('ECONNRESET');
      expect(row.claimOwner).toBeNull();
      expect(row.claimExpiresAt).toBeNull();
      expect(row.nextRetryAt).toBeTruthy();

      // Immediate retry within backoff period skips claiming (prevents infinite immediate retry loops)
      const immediateClaim = await store.claimPendingEvents({ workerId: 'worker-1', now: clock });
      expect(immediateClaim).toEqual([]);

      // Once backoff passes, it is claimed and sent
      tick(15000); // advance clock past backoff
      mailer.sendMail.mockReset();
      mailer.sendMail.mockResolvedValue({});

      const retryRes = await monitor.sendPending({ workerId: 'worker-1', now: clock, retryDelays: NO_WAIT });
      expect(retryRes).toBe('sent');

      const [sentRow] = await cds.db.run(SELECT.from(EVENT));
      expect(sentRow.status).toBe('sent');
      expect(sentRow.attempts).toBe(5);
    });

    test('exceeding max attempts marks event as failed rather than infinite loop', async () => {
      await cds.db.run(INSERT.into(EVENT).entries({
        username: 'TERMINAL_FAIL_USER', lockedAt: '20261106100000', status: 'pending', attempts: 28,
        detectedAt: clock.toISOString(), uflag: 64, lockType: 'Locked by administrator',
      }));

      mailer.sendMail.mockRejectedValue(new Error('Permanent rejection 550'));

      const res = await monitor.sendPending({
        workerId: 'worker-1', now: clock, retryDelays: NO_WAIT, maxAttempts: 30,
      });
      expect(res).toBe('queued');

      const [row] = await cds.db.run(SELECT.from(EVENT));
      expect(row.status).toBe('failed');
      expect(row.attempts).toBe(32); // 28 + 4
      expect(row.claimOwner).toBeNull();
    });
  });

  describe('5. Process restart recovery', () => {
    test('events queued before restart remain in DB and are sent by fresh process instance', async () => {
      await cds.db.run(INSERT.into(EVENT).entries({
        username: 'RESTART_USER', lockedAt: '20261106100000', status: 'pending', attempts: 0,
        detectedAt: clock.toISOString(), uflag: 64, lockType: 'Locked by administrator',
      }));

      // Simulate complete process restart with fresh module require
      let freshMonitor;
      jest.isolateModules(() => {
        jest.doMock('@sap/cds', () => cds);
        jest.doMock('../../srv/common/mailer', () => mailer);
        freshMonitor = require('../../srv/admin/lockNotifier');
      });

      const outcome = await freshMonitor.sendPending({ now: clock, retryDelays: NO_WAIT });
      expect(outcome).toBe('sent');
      expect(mailer.sendMail).toHaveBeenCalledTimes(1);

      const [row] = await cds.db.run(SELECT.from(EVENT));
      expect(row.status).toBe('sent');
    });
  });

  describe('6. Already-sent event protection', () => {
    test('sent events are never re-claimed or re-sent', async () => {
      await cds.db.run(INSERT.into(EVENT).entries({
        username: 'ALREADY_SENT_USER', lockedAt: '20261106100000', status: 'sent',
        attempts: 1, sentAt: clock.toISOString(), detectedAt: clock.toISOString(),
        uflag: 64, lockType: 'Locked by administrator',
      }));

      const claimed = await store.claimPendingEvents({ workerId: 'worker-1', now: clock });
      expect(claimed).toEqual([]);

      const outcome = await monitor.sendPending({ workerId: 'worker-1', now: clock, retryDelays: NO_WAIT });
      expect(outcome).toBe('none');
      expect(mailer.sendMail).not.toHaveBeenCalled();
    });
  });

  describe('7. Bulk notification consolidation', () => {
    test('multiple locks with the same bulkRunId are consolidated into one email', async () => {
      const runId = 'bulk-run-999';
      const bulkEvents = ['BULK_A', 'BULK_B', 'BULK_C'].map((username, index) => ({
        username,
        lockedAt: `2026110610000${index}`,
        uflag: 64,
        lockType: 'Locked by administrator',
        lockedBy: 'KHUSHAL',
        fullName: `${username} Name`,
        source: 'Fiori app',
        reason: 'Department reorganization',
        bulkRunId: runId,
        detectedAt: clock.toISOString(),
      }));

      // Commit cycle persists the bulk events
      await store.commitCycle({ events: bulkEvents }, clock.toISOString());

      // One worker claims and sends
      const outcome = await monitor.sendPending({ workerId: 'worker-bulk', now: clock, retryDelays: NO_WAIT });
      expect(outcome).toBe('sent');

      // Exactly ONE email delivered to SMTP with all 3 users consolidated
      expect(mailer.sendMail).toHaveBeenCalledTimes(1);
      const [deliveredMail] = mailer.sendMail.mock.calls[0];
      expect(deliveredMail.subject).toBe('[SAP Alert] 3 users locked');
      expect(deliveredMail.text).toContain('BULK_A');
      expect(deliveredMail.text).toContain('BULK_B');
      expect(deliveredMail.text).toContain('BULK_C');

      // All 3 events in DB are now 'sent'
      const rows = await cds.db.run(SELECT.from(EVENT).where({ bulkRunId: runId }));
      expect(rows).toHaveLength(3);
      expect(rows.every((r) => r.status === 'sent')).toBe(true);

      // UI bulk status returns 'sent'
      expect(await monitor.bulkEmailStatus(runId)).toEqual({ status: 'sent' });
    });
  });
});
