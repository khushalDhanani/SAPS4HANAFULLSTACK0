'use strict';

jest.mock('../../../srv/common/mailer', () => ({ isConfigured: jest.fn(() => true), sendMail: jest.fn() }));

const {
  diffLockState, splitSettled, describeLock, describeHistoryLock, addedHistoryLocks,
  lockLabel, pollIntervalSec, maxPerEmail, recipients, startJob, calculateNextRetry,
} = require('../../../srv/admin/lockNotifier');

const NOW = new Date('2026-11-05T10:00:00.000Z');
const secondsAgo = (s) => new Date(NOW.getTime() - s * 1000).toISOString();
const snapshots = (rows) => new Map(rows.map((row) => [row.username, row]));

describe('lockLabel', () => {
  test.each([
    [0, 'Lock status 0'],
    [32, 'Global lock (CUA)'],
    [64, 'Locked by administrator'],
    [128, 'Locked due to incorrect logon attempts'],
    [192, 'Locked by administrator and incorrect logon attempts'],
    [224, 'Global lock (CUA) and Locked by administrator and incorrect logon attempts'],
    [8, 'Lock status 8'],
  ])('UFLAG %i is "%s"', (uflag, label) => {
    expect(lockLabel(uflag)).toBe(label);
  });
});

describe('diffLockState', () => {
  test('unlocked to locked is a new lock', () => {
    expect(diffLockState([{ username: 'A', uflag: 64 }], snapshots([{ username: 'A', uflag: 0 }])).newlyLocked)
      .toEqual([{ username: 'A', uflag: 64 }]);
  });

  test('a user the snapshot has never seen, already locked, is a new lock', () => {
    expect(diffLockState([{ username: 'NEW', uflag: 128 }], snapshots([{ username: 'A', uflag: 0 }])).newlyLocked)
      .toEqual([{ username: 'NEW', uflag: 128 }]);
  });

  test('a new user who is not locked is stored with no alert', () => {
    const diff = diffLockState([{ username: 'NEW', uflag: 0 }], snapshots([{ username: 'A', uflag: 0 }]));
    expect(diff.newlyLocked).toEqual([]);
    expect(diff.states).toEqual([{ username: 'NEW', uflag: 0 }]);
  });

  test('already locked stays silent', () => {
    expect(diffLockState([{ username: 'A', uflag: 64 }], snapshots([{ username: 'A', uflag: 64 }])))
      .toEqual({ newlyLocked: [], states: [], removed: [] });
  });

  test.each([[128, 192], [64, 128], [64, 0]])('a change from %i to %i only updates the snapshot', (from, to) => {
    const diff = diffLockState([{ username: 'A', uflag: to }], snapshots([{ username: 'A', uflag: from }]));
    expect(diff.newlyLocked).toEqual([]);
    expect(diff.states).toEqual([{ username: 'A', uflag: to }]);
  });

  test('a user gone from SAP leaves the snapshot', () => {
    expect(diffLockState([{ username: 'B', uflag: 0 }], snapshots([{ username: 'A', uflag: 64 }, { username: 'B', uflag: 0 }])).removed)
      .toEqual(['A']);
  });
});

describe('splitSettled', () => {
  const locks = [{ username: 'A', uflag: 64 }, { username: 'B', uflag: 64 }, { username: 'C', uflag: 64 }];

  test('a run still locking is held, whole, and an unrelated lock is not', () => {
    const contexts = [
      { username: 'A', bulkRunId: 'r1', at: secondsAgo(40) },
      { username: 'B', bulkRunId: 'r1', at: secondsAgo(5) },
    ];
    const { settled, held } = splitSettled(locks, contexts, NOW);
    expect(held.map((l) => l.username)).toEqual(['A', 'B']);
    expect(settled.map((l) => l.username)).toEqual(['C']);
  });

  test('a run that has gone quiet is released', () => {
    const contexts = [{ username: 'A', bulkRunId: 'r1', at: secondsAgo(21) }, { username: 'B', bulkRunId: 'r1', at: secondsAgo(30) }];
    expect(splitSettled(locks, contexts, NOW).held).toEqual([]);
  });

  test('a single app lock is never held', () => {
    expect(splitSettled(locks, [{ username: 'A', bulkRunId: '', at: secondsAgo(1) }], NOW).held).toEqual([]);
  });
});

describe('describeLock', () => {
  const lock = { username: 'A', uflag: 64 };
  const change = { lockedAt: '20261105095900', changedBy: 'SAPADMIN', uflag: 64 };
  const base = { fullName: 'A Name', previousLockedAt: '', now: NOW };

  test('a recent app note gives the source, who and why', () => {
    const event = describeLock(lock, { ...base, change, context: { actor: 'khushal', reason: 'Left', bulkRunId: 'r1', at: secondsAgo(60) } });
    expect(event).toMatchObject({ source: 'Fiori app', lockedBy: 'khushal', reason: 'Left', bulkRunId: 'r1', lockedAt: '20261105095900', fullName: 'A Name' });
  });

  test('with no note it is SAP, locked by the Changed By value', () => {
    expect(describeLock(lock, { ...base, change })).toMatchObject({ source: 'SAP / automatic', lockedBy: 'SAPADMIN', reason: '' });
  });

  test('with no note and no history, Locked By is Unknown', () => {
    expect(describeLock(lock, { ...base, change: null })).toMatchObject({ source: 'SAP / automatic', lockedBy: 'Unknown' });
  });

  test('history for a different lock does not identify who locked the user', () => {
    const event = describeLock({ username: 'A', uflag: 128 }, { ...base, change });
    expect(event).toMatchObject({ source: 'SAP / automatic', lockedBy: 'Incorrect logon attempts (automatic)' });
  });

  test('an old note is ignored', () => {
    const event = describeLock(lock, { ...base, change, context: { actor: 'khushal', reason: 'Left', at: secondsAgo(301) } });
    expect(event).toMatchObject({ source: 'SAP / automatic', lockedBy: 'SAPADMIN' });
  });

  test('a note never explains an incorrect-logon lock', () => {
    const event = describeLock({ username: 'A', uflag: 128 }, { ...base, change: null, context: { actor: 'khushal', reason: 'Left', at: secondsAgo(5) } });
    expect(event).toMatchObject({
      source: 'SAP / automatic',
      lockType: 'Locked due to incorrect logon attempts',
      lockedBy: 'Incorrect logon attempts (automatic)',
    });
  });

  test('a combined flag containing incorrect-logon lock is not attributed to the app', () => {
    const event = describeLock(
      { username: 'A', uflag: 192 },
      { ...base, change: { ...change, uflag: 192 }, context: { actor: 'khushal', reason: 'Left', at: secondsAgo(5) } },
    );
    expect(event).toMatchObject({
      source: 'SAP / automatic',
      lockType: 'Locked by administrator and incorrect logon attempts',
      lockedBy: 'Incorrect logon attempts (automatic)',
    });
  });

  test('an exact app audit record overrides automatic flag-128 attribution', () => {
    const event = describeLock(
      { username: 'A', uflag: 128 },
      {
        ...base,
        change: { ...change, uflag: 128, historyKey: 'app-lock' },
        context: { actor: 'khushal', reason: 'Admin action', historyKey: 'app-lock' },
      },
    );
    expect(event).toMatchObject({ source: 'Fiori app', lockedBy: 'khushal', reason: 'Admin action' });
  });

  test('uses the detection time when history is older, or does not show this lock', () => {
    const detected = '20261105100000';
    expect(describeLock(lock, { ...base, change, previousLockedAt: change.lockedAt }).lockedAt).toBe(detected);
    expect(describeLock(lock, { ...base, change: { ...change, uflag: 0 } }).lockedAt).toBe(detected);
  });

  test('a detection time never collides with the last one reported', () => {
    expect(describeLock(lock, { ...base, change: null, previousLockedAt: '20261105100000' }).lockedAt).toBe('20261105100001');
  });

  test('a matching app audit history key wins over the shared SAP actor', () => {
    const changeWithKey = { ...change, historyKey: 'app-lock' };
    const event = describeHistoryLock(
      { ...changeWithKey, username: 'A' },
      {
        context: { actor: 'khushal', reason: 'Reason', historyKey: 'app-lock' },
        serviceUser: 'RFC_SHARED',
        now: NOW,
      },
    );
    expect(event).toMatchObject({
      source: 'Fiori app',
      lockedBy: 'khushal',
      reason: 'Short-lived lock (cleared before detection): Reason',
      lockType: expect.stringContaining('Locked by administrator'),
      lockTimestamp: '2026-11-05 09:59:00',
    });
  });

  test('an exact app audit remains valid after the short context window', () => {
    const event = describeLock(lock, {
      ...base,
      change: { ...change, historyKey: 'app-lock' },
      context: { actor: 'khushal', reason: 'Left', historyKey: 'app-lock', at: secondsAgo(301) },
    });
    expect(event).toMatchObject({ source: 'Fiori app', lockedBy: 'khushal' });
  });

  test('an unmatched shared RFC actor is not presented as a person', () => {
    const event = describeHistoryLock(
      { ...change, username: 'A', historyKey: 'other' },
      { context: null, serviceUser: 'SAPADMIN', now: NOW },
    );
    expect(event).toMatchObject({ source: 'SAP / automatic', lockedBy: 'Service account (app or integration)' });
  });

  test('an unmatched flag-128 history event never exposes its USH02 actor', () => {
    const event = describeHistoryLock(
      { ...change, username: 'A', uflag: 128, historyKey: 'other' },
      {
        context: { actor: 'khushal', reason: 'Unrelated', historyKey: 'not-this-lock', at: secondsAgo(1) },
        serviceUser: 'SAPADMIN',
        now: NOW,
      },
    );
    expect(event).toMatchObject({
      source: 'SAP / automatic',
      lockedBy: 'Incorrect logon attempts (automatic)',
      reason: 'Short-lived lock (cleared before detection)',
    });
  });

  test('an exact app audit record takes precedence for a short-lived flag-128 lock', () => {
    const event = describeHistoryLock(
      { ...change, username: 'A', uflag: 128, historyKey: 'app-lock' },
      {
        context: { actor: 'khushal', reason: 'Admin action', historyKey: 'app-lock' },
        serviceUser: 'SAPADMIN',
        now: NOW,
      },
    );
    expect(event).toMatchObject({
      source: 'Fiori app',
      lockedBy: 'khushal',
      reason: 'Short-lived lock (cleared before detection): Admin action',
    });
  });

  test('an unrelated context does not leak its reason into a SAP history alert', () => {
    const event = describeHistoryLock(
      { ...change, username: 'A', historyKey: 'other' },
      { context: { actor: 'khushal', reason: 'Unrelated', historyKey: 'not-this-lock', at: secondsAgo(1) }, serviceUser: 'SAPADMIN', now: NOW },
    );
    expect(event).toMatchObject({ source: 'SAP / automatic', reason: 'Short-lived lock (cleared before detection)' });
  });
});

describe('addedHistoryLocks', () => {
  test('ignores unchanged lock flags and unlock transitions, and reports newly added bits', () => {
    const history = [
      { username: 'A', previousUflag: 128, uflag: 128, lockedAt: '20261105090000' },
      { username: 'B', previousUflag: 0, uflag: 64, lockedAt: '20261105090100' },
      { username: 'C', previousUflag: 64, uflag: 192, lockedAt: '20261105090200' },
      { username: 'D', previousUflag: 192, uflag: 0, lockedAt: '20261105090300' },
      { username: 'E', previousUflag: null, uflag: 64, lockedAt: '20261105090400' },
    ];
    expect(addedHistoryLocks(history))
      .toEqual([
        { ...history[1], addedUflag: 64 },
        { ...history[2], addedUflag: 128 },
      ]);
  });

  test('labels a transition from 64 to 192 as the newly added 128 bit', () => {
    const change = {
      username: 'A',
      previousUflag: 64,
      uflag: 192,
      lockedAt: '20261105090200',
      changedBy: 'SAPADMIN',
    };
    const [lock] = addedHistoryLocks([change]);

    expect(describeHistoryLock(lock, { context: null, serviceUser: 'SAPADMIN', now: NOW }))
      .toMatchObject({
        uflag: 128,
        lockType: 'Short-lived lock (cleared before detection) - Locked due to incorrect logon attempts',
        lockedBy: 'Incorrect logon attempts (automatic)',
      });
  });

  test('uses the saved UFLAG only when USH02 has no preceding row', () => {
    const history = [
      { username: 'A', previousUflag: null, uflag: 64, lockedAt: '20261105090000' },
      { username: 'B', previousUflag: null, uflag: 64, lockedAt: '20261105090100' },
    ];

    expect(addedHistoryLocks(history, new Map([['A', { uflag: 0 }]])))
      .toEqual([{ ...history[0], addedUflag: 64 }]);
  });
});

describe('settings', () => {
  test('the interval defaults to 5 seconds, and 0 turns it off', () => {
    expect(pollIntervalSec({})).toBe(5);
    expect(pollIntervalSec({ LOCK_POLL_INTERVAL_SEC: '30' })).toBe(30);
    expect(pollIntervalSec({ LOCK_POLL_INTERVAL_SEC: '0' })).toBe(0);
    expect(pollIntervalSec({ LOCK_POLL_INTERVAL_SEC: 'x' })).toBe(5);
  });

  test('the email limit defaults to 50', () => {
    expect(maxPerEmail({})).toBe(50);
    expect(maxPerEmail({ LOCK_MAX_PER_EMAIL: '10' })).toBe(10);
    expect(maxPerEmail({ LOCK_MAX_PER_EMAIL: '0' })).toBe(50);
  });

  test('the recipient may be a comma-separated list', () => {
    expect(recipients({ LOCK_NOTIFY_TO: ' a@example.test, b@example.test ,' })).toEqual(['a@example.test', 'b@example.test']);
    expect(recipients({})).toEqual([]);
  });
});

describe('job start conditions', () => {
  const env = { NODE_ENV: 'production', LOCK_POLL_INTERVAL_SEC: '60' };
  let timer;

  beforeEach(() => { process.env.LOCK_NOTIFY_TO = 'alerts@example.test'; });
  afterEach(() => {
    if (timer) clearInterval(timer);
    timer = null;
    delete process.env.LOCK_NOTIFY_TO;
  });

  test('0 turns it off', () => {
    expect(startJob(jest.fn(), { ...env, LOCK_POLL_INTERVAL_SEC: '0' })).toBeNull();
  });

  test('runs on the first instance only', () => {
    expect(startJob(jest.fn(), { ...env, CF_INSTANCE_INDEX: '1' })).toBeNull();
    timer = startJob(jest.fn(), { ...env, CF_INSTANCE_INDEX: '0' });
    expect(timer).not.toBeNull();
  });

  test('does not run under test or without a recipient', () => {
    expect(startJob(jest.fn(), { ...env, NODE_ENV: 'test' })).toBeNull();
    delete process.env.LOCK_NOTIFY_TO;
    expect(startJob(jest.fn(), env)).toBeNull();
  });
});

describe('calculateNextRetry backoff', () => {
  const baseTime = new Date('2026-11-06T10:00:00.000Z');

  test.each([
    [0, 5],
    [1, 5],
    [4, 5],
    [8, 10],
    [12, 20],
    [16, 40],
    [20, 60],
    [32, 60],
  ])('%i attempts yields +%i seconds backoff', (attempts, expectedSec) => {
    const nextRetry = calculateNextRetry(attempts, baseTime);
    const expectedTime = new Date(baseTime.getTime() + expectedSec * 1000).toISOString();
    expect(nextRetry).toBe(expectedTime);
  });
});
