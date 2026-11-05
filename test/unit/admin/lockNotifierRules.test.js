'use strict';

jest.mock('../../../srv/common/mailer', () => ({ isConfigured: jest.fn(() => true), sendMail: jest.fn() }));

const {
  diffLockState, splitSettled, describeLock, lockLabel, pollIntervalSec, maxPerEmail, recipients, startJob,
} = require('../../../srv/admin/lockNotifier');

const NOW = new Date('2026-11-05T10:00:00.000Z');
const secondsAgo = (s) => new Date(NOW.getTime() - s * 1000).toISOString();
const snapshots = (rows) => new Map(rows.map((row) => [row.username, row]));

describe('lockLabel', () => {
  test.each([
    [32, 'Global lock (CUA)'],
    [64, 'Locked by administrator'],
    [128, 'Locked due to incorrect logon attempts'],
    [192, 'Locked by administrator + Locked due to incorrect logon attempts'],
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
    expect(event).toMatchObject({ source: 'SAP / automatic', lockedBy: 'Unknown' });
  });

  test('an old note is ignored', () => {
    const event = describeLock(lock, { ...base, change, context: { actor: 'khushal', reason: 'Left', at: secondsAgo(301) } });
    expect(event).toMatchObject({ source: 'SAP / automatic', lockedBy: 'SAPADMIN' });
  });

  test('a note never explains an incorrect-logon lock', () => {
    const event = describeLock({ username: 'A', uflag: 128 }, { ...base, change: null, context: { actor: 'khushal', reason: 'Left', at: secondsAgo(5) } });
    expect(event).toMatchObject({ source: 'SAP / automatic', lockType: 'Locked due to incorrect logon attempts' });
  });

  test('uses the detection time when history is older, or does not show this lock', () => {
    const detected = '20261105100000';
    expect(describeLock(lock, { ...base, change, previousLockedAt: change.lockedAt }).lockedAt).toBe(detected);
    expect(describeLock(lock, { ...base, change: { ...change, uflag: 0 } }).lockedAt).toBe(detected);
  });

  test('a detection time never collides with the last one reported', () => {
    expect(describeLock(lock, { ...base, change: null, previousLockedAt: '20261105100000' }).lockedAt).toBe('20261105100001');
  });
});

describe('settings', () => {
  test('the interval defaults to 60 seconds, and 0 turns it off', () => {
    expect(pollIntervalSec({})).toBe(60);
    expect(pollIntervalSec({ LOCK_POLL_INTERVAL_SEC: '30' })).toBe(30);
    expect(pollIntervalSec({ LOCK_POLL_INTERVAL_SEC: '0' })).toBe(0);
    expect(pollIntervalSec({ LOCK_POLL_INTERVAL_SEC: 'x' })).toBe(60);
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
