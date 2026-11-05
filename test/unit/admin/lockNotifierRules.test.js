'use strict';

jest.mock('../../../srv/common/mailer', () => ({ isConfigured: jest.fn(() => true), sendMail: jest.fn() }));

const { diffLockState, lockTypeOf, pollIntervalMs, startJob } = require('../../../srv/admin/lockNotifier');

const NOW = '2026-11-05T10:00:00.000Z';
const snapshots = (rows) => new Map(rows.map((row) => [row.username, row]));

describe('diffLockState', () => {
  test('a user seen for the first time is stored silently, even if locked', () => {
    const diff = diffLockState([{ username: 'A', uflag: 64 }, { username: 'B', uflag: 0 }], snapshots([]), NOW);
    expect(diff).toEqual({ baseline: [{ username: 'A', uflag: 64 }, { username: 'B', uflag: 0 }], newlyLocked: [], changed: [] });
  });

  test('unlocked to locked is a new lock', () => {
    const diff = diffLockState([{ username: 'A', uflag: 64 }], snapshots([{ username: 'A', uflag: 0 }]), NOW);
    expect(diff.newlyLocked).toEqual([{ username: 'A', oldFlag: 0, uflag: 64, newBits: 64 }]);
  });

  test('an added lock type is new, even on an already locked user', () => {
    const diff = diffLockState([{ username: 'A', uflag: 192 }], snapshots([{ username: 'A', uflag: 128 }]), NOW);
    expect(diff.newlyLocked).toEqual([{ username: 'A', oldFlag: 128, uflag: 192, newBits: 64 }]);
  });

  test('no change is nothing', () => {
    const diff = diffLockState([{ username: 'A', uflag: 64 }], snapshots([{ username: 'A', uflag: 64 }]), NOW);
    expect(diff).toEqual({ baseline: [], newlyLocked: [], changed: [] });
  });

  test.each([[64, 0], [192, 64]])('a lock going away (%i to %i) updates the state with no alert', (from, to) => {
    const diff = diffLockState([{ username: 'A', uflag: to }], snapshots([{ username: 'A', uflag: from }]), NOW);
    expect(diff.newlyLocked).toEqual([]);
    expect(diff.changed).toEqual([{ username: 'A', oldFlag: from, uflag: to }]);
  });

  test('a user the app is locking right now is skipped until the window ends', () => {
    const row = { username: 'A', uflag: 0, appLockUntil: '2026-11-05T10:01:00.000Z' };
    expect(diffLockState([{ username: 'A', uflag: 64 }], snapshots([row]), NOW).newlyLocked).toEqual([]);
    expect(diffLockState([{ username: 'A', uflag: 64 }], snapshots([row]), '2026-11-05T10:02:00.000Z').newlyLocked).toHaveLength(1);
  });

  test('a user missing from SAP is left alone, not treated as unlocked', () => {
    const diff = diffLockState([{ username: 'B', uflag: 0 }], snapshots([{ username: 'A', uflag: 64 }, { username: 'B', uflag: 0 }]), NOW);
    expect(diff).toEqual({ baseline: [], newlyLocked: [], changed: [] });
  });
});

describe('lockTypeOf', () => {
  test.each([
    [64, { lockedLocal: 'L' }, 'admin-local'],
    [32, { lockedGlobal: 'L' }, 'admin-global'],
    [128, { lockedWrong: 'L' }, 'wrong-password'],
  ])('bits %i with ISLOCKED %j give %s', (bits, detail, expected) => {
    expect(lockTypeOf(bits, detail)).toBe(expected);
  });

  test('names the new lock, not the older one, when two are set', () => {
    expect(lockTypeOf(128, { lockedLocal: 'L', lockedWrong: 'L' })).toBe('wrong-password');
    expect(lockTypeOf(64, { lockedLocal: 'L', lockedWrong: 'L' })).toBe('admin-local');
  });

  test('falls back to UFLAG when ISLOCKED says nothing or could not be read', () => {
    expect(lockTypeOf(128, { lockedWrong: 'U' })).toBe('wrong-password');
    expect(lockTypeOf(64, null)).toBe('admin-local');
  });

  test('NO_USER_PW never decides the type', () => {
    expect(lockTypeOf(64, { lockedNoPw: 'L', lockedLocal: 'U' })).toBe('admin-local');
  });
});

describe('job start conditions', () => {
  const env = { LOCK_POLL_INTERVAL_MS: '1000', NODE_ENV: 'production' };
  let timer;

  beforeEach(() => { process.env.LOCK_NOTIFY_TO = 'alerts@example.test'; });
  afterEach(() => {
    if (timer) clearInterval(timer);
    timer = null;
    delete process.env.LOCK_NOTIFY_TO;
  });

  test('the interval defaults to 5 minutes, and 0 turns it off', () => {
    expect(pollIntervalMs({})).toBe(300000);
    expect(pollIntervalMs({ LOCK_POLL_INTERVAL_MS: '60000' })).toBe(60000);
    expect(pollIntervalMs({ LOCK_POLL_INTERVAL_MS: 'x' })).toBe(300000);
    expect(startJob(jest.fn(), { ...env, LOCK_POLL_INTERVAL_MS: '0' })).toBeNull();
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
