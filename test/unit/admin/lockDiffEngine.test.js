'use strict';

const {
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
  calculateNextRetry,
  SOURCE_APP,
  SOURCE_SAP,
  SHORT_LIVED_LOCK
} = require('../../../srv/admin/LockDiffEngine');

describe('Unit: LockDiffEngine', () => {
  describe('lockLabel', () => {
    test('formats standard bitmask labels accurately', () => {
      expect(lockLabel(0)).toBe('Lock status 0');
      expect(lockLabel(32)).toBe('Global lock (CUA)');
      expect(lockLabel(64)).toBe('Locked by administrator');
      expect(lockLabel(128)).toBe('Locked due to incorrect logon attempts');
      expect(lockLabel(192)).toBe('Locked by administrator and incorrect logon attempts');
      expect(lockLabel(224)).toBe('Global lock (CUA) and Locked by administrator and incorrect logon attempts');
    });
  });

  describe('diffLockState', () => {
    test('detects newly locked user vs state update vs removed user', () => {
      const snapshots = new Map([
        ['ALICE', { username: 'ALICE', uflag: 0 }],
        ['BOB', { username: 'BOB', uflag: 64 }],
        ['CHARLIE', { username: 'CHARLIE', uflag: 0 }],
        ['DAVE', { username: 'DAVE', uflag: 64 }]
      ]);

      const current = [
        { username: 'ALICE', uflag: 64 }, // Newly locked
        { username: 'BOB', uflag: 128 },   // State change (already locked)
        { username: 'CHARLIE', uflag: 0 }, // Unchanged
        { username: 'EVE', uflag: 64 }     // New user, already locked -> newly locked
      ];

      const diff = diffLockState(current, snapshots);
      expect(diff.newlyLocked).toEqual([
        { username: 'ALICE', uflag: 64 },
        { username: 'EVE', uflag: 64 }
      ]);
      expect(diff.states).toEqual([
        { username: 'BOB', uflag: 128 }
      ]);
      expect(diff.removed).toEqual(['DAVE']);
    });
  });

  describe('splitSettled', () => {
    test('holds bulk runs that are still active and releases settled locks', () => {
      const now = new Date('2026-11-20T12:00:00Z');
      const newlyLocked = [
        { username: 'USER1', uflag: 64 },
        { username: 'USER2', uflag: 64 },
        { username: 'USER3', uflag: 64 }
      ];

      const contexts = [
        { username: 'USER1', bulkRunId: 'RUN_1', at: new Date('2026-11-20T11:59:55Z').toISOString() }, // 5s ago (< 20s settle -> held)
        { username: 'USER2', bulkRunId: 'RUN_2', at: new Date('2026-11-20T11:59:00Z').toISOString() }, // 60s ago (> 20s settle -> settled)
        { username: 'USER3', bulkRunId: null, at: new Date('2026-11-20T11:59:55Z').toISOString() }    // Individual -> settled
      ];

      const { settled, held } = splitSettled(newlyLocked, contexts, now);
      expect(held).toEqual([{ username: 'USER1', uflag: 64 }]);
      expect(settled).toEqual([
        { username: 'USER2', uflag: 64 },
        { username: 'USER3', uflag: 64 }
      ]);
    });
  });

  describe('contextMatchesChange and isRecentContext', () => {
    test('matches history key between context and change', () => {
      expect(contextMatchesChange({ historyKey: 'KEY_1' }, { historyKey: 'KEY_1' })).toBe(true);
      expect(contextMatchesChange({ historyKey: 'KEY_1' }, { historyKey: 'KEY_2' })).toBe(false);
      expect(contextMatchesChange(null, { historyKey: 'KEY_1' })).toBe(false);
    });

    test('checks recent context within 5-minute window', () => {
      const now = new Date('2026-11-20T12:05:00Z');
      expect(isRecentContext({ at: '2026-11-20T12:01:00Z' }, now)).toBe(true);
      expect(isRecentContext({ at: '2026-11-20T11:59:00Z' }, now)).toBe(false);
    });
  });

  describe('serviceAccountActor', () => {
    test('identifies matching service account actor case-insensitively', () => {
      expect(serviceAccountActor({ changedBy: 'S4HANA_TECH' }, 's4hana_tech')).toBe(true);
      expect(serviceAccountActor({ changedBy: 'ADMIN' }, 's4hana_tech')).toBe(false);
      expect(serviceAccountActor(null, 's4hana_tech')).toBe(false);
    });
  });

  describe('describeLock and describeHistoryLock', () => {
    test('describes app-initiated lock with actor and reason', () => {
      const now = new Date('2026-11-20T12:00:00Z');
      const lock = { username: 'ALICE', uflag: 64 };
      const context = { actor: 'SEC_ADMIN', reason: 'Security violation', at: '2026-11-20T11:58:00Z' };

      const event = describeLock(lock, { context, fullName: 'Alice Smith', previousLockedAt: '0', now });
      expect(event.source).toBe(SOURCE_APP);
      expect(event.lockedBy).toBe('SEC_ADMIN');
      expect(event.reason).toBe('Security violation');
      expect(event.fullName).toBe('Alice Smith');
      expect(event.lockType).toBe('Locked by administrator');
    });

    test('describes short-lived history lock', () => {
      const now = new Date('2026-11-20T12:00:00Z');
      const change = { username: 'BOB', uflag: 64, addedUflag: 64, lockedAt: '20261120115500', changedBy: 'SAP_SYS' };

      const event = describeHistoryLock(change, { context: null, fullName: 'Bob Jones', now });
      expect(event.source).toBe(SOURCE_SAP);
      expect(event.lockedBy).toBe('SAP_SYS');
      expect(event.lockType).toContain(SHORT_LIVED_LOCK);
    });
  });

  describe('addedHistoryLocks', () => {
    test('extracts added lock bit transitions from history rows', () => {
      const history = [
        { username: 'ALICE', uflag: 192, previousUflag: 64 }, // Added 128 bit
        { username: 'BOB', uflag: 64, previousUflag: 64 },    // Unchanged
        { username: 'CHARLIE', uflag: 0, previousUflag: 64 }  // Unlocked
      ];

      const added = addedHistoryLocks(history);
      expect(added).toHaveLength(1);
      expect(added[0].username).toBe('ALICE');
      expect(added[0].addedUflag).toBe(128);
    });
  });

  describe('cursor helpers', () => {
    test('latestHistoryCursor returns latest row timestamp and key', () => {
      const rows = [
        { lockedAt: '20261120100000', historyKey: 'KEY_1' },
        { lockedAt: '20261120110000', historyKey: 'KEY_2' }
      ];
      const cursor = latestHistoryCursor(rows, null);
      expect(cursor).toEqual({ at: '20261120110000', key: 'KEY_2' });
    });

    test('sameHistoryCursor compares cursor equality accurately', () => {
      expect(sameHistoryCursor({ at: '1', key: 'K' }, { at: '1', key: 'K' })).toBe(true);
      expect(sameHistoryCursor({ at: '1', key: 'K' }, { at: '2', key: 'K' })).toBe(false);
      expect(sameHistoryCursor(null, { at: '1', key: 'K' })).toBe(false);
    });
  });

  describe('calculateNextRetry backoff', () => {
    test('calculates exponential backoff capped at 60 seconds', () => {
      const now = new Date('2026-11-20T12:00:00.000Z');
      expect(calculateNextRetry(0, now)).toBe('2026-11-20T12:00:05.000Z');
      expect(calculateNextRetry(8, now)).toBe('2026-11-20T12:00:10.000Z');
      expect(calculateNextRetry(12, now)).toBe('2026-11-20T12:00:20.000Z');
      expect(calculateNextRetry(16, now)).toBe('2026-11-20T12:00:40.000Z');
      expect(calculateNextRetry(20, now)).toBe('2026-11-20T12:01:00.000Z');
      expect(calculateNextRetry(50, now)).toBe('2026-11-20T12:01:00.000Z');
    });
  });
});
