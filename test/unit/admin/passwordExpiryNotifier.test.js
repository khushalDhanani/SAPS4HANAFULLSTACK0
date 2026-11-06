'use strict';

jest.mock('../../../srv/common/mailer', () => ({
  isConfigured: jest.fn(() => true),
  send: jest.fn().mockResolvedValue({ accepted: ['admin@aether.co.in'] })
}));

const mailer = require('../../../srv/common/mailer');
const store = require('../../../srv/admin/passwordExpiryStore');
const notifier = require('../../../srv/admin/passwordExpiryNotifier');
const cds = require('@sap/cds');

cds.test(__dirname + '/../../../');

describe('passwordExpiryNotifier pure helpers', () => {
  describe('recipients', () => {
    test('parses comma-separated PWD_NOTIFY_TO', () => {
      const env = { PWD_NOTIFY_TO: 'a@test.com, b@test.com, ' };
      expect(notifier.recipients(env)).toEqual(['a@test.com', 'b@test.com']);
    });

    test('falls back to LOCK_NOTIFY_TO when PWD_NOTIFY_TO is not set', () => {
      const env = { LOCK_NOTIFY_TO: 'admin@test.com' };
      expect(notifier.recipients(env)).toEqual(['admin@test.com']);
    });

    test('returns empty array when neither is set', () => {
      expect(notifier.recipients({})).toEqual([]);
    });
  });

  describe('configuration helpers', () => {
    test('pollIntervalSec returns configured or default', () => {
      expect(notifier.pollIntervalSec({ PWD_POLL_INTERVAL_SEC: '3600' })).toBe(3600);
      expect(notifier.pollIntervalSec({ PWD_POLL_INTERVAL_SEC: '0' })).toBe(0);
      expect(notifier.pollIntervalSec({})).toBe(86400);
    });

    test('expirationDays returns configured or default 90', () => {
      expect(notifier.expirationDays({ SAP_PASSWORD_EXPIRATION_DAYS: '60' })).toBe(60);
      expect(notifier.expirationDays({})).toBe(90);
    });

    test('warningDays returns configured or default 14', () => {
      expect(notifier.warningDays({ SAP_PASSWORD_WARNING_DAYS: '21' })).toBe(21);
      expect(notifier.warningDays({})).toBe(14);
    });

    test('formatCycleDate returns YYYYMMDD in UTC', () => {
      const date = new Date(Date.UTC(2026, 10, 6)); // Nov 6, 2026
      expect(notifier.formatCycleDate(date)).toBe('20261106');
    });
  });
});

describe('passwordExpiryNotifier pollOnce', () => {
  let mockAdapter;
  let savedPwdNotify;
  let savedLockNotify;

  beforeEach(async () => {
    savedPwdNotify = process.env.PWD_NOTIFY_TO;
    savedLockNotify = process.env.LOCK_NOTIFY_TO;

    for (const entity of [store.SNAPSHOT, store.EVENT, store.MONITOR]) {
      await cds.db.run(cds.ql.DELETE.from(entity));
    }

    mailer.send.mockClear();
    mailer.isConfigured.mockReturnValue(true);

    mockAdapter = {
      readPasswordExpiryData: jest.fn().mockResolvedValue([
        {
          username: 'ALICE',
          fullName: 'Alice Smith',
          userType: 'A',
          pwdLastChanged: '20260822',
          pwdExpiresAt: '20261120',
          pwdDaysRemaining: 14,
          pwdStatus: 'expiring_soon'
        },
        {
          username: 'BOB',
          fullName: 'Bob Jones',
          userType: 'A',
          pwdLastChanged: '20260101',
          pwdExpiresAt: '20260401',
          pwdDaysRemaining: -219,
          pwdStatus: 'expired'
        },
        {
          username: 'CHARLIE',
          fullName: 'Charlie Valid',
          userType: 'A',
          pwdLastChanged: '20261001',
          pwdExpiresAt: '20261230',
          pwdDaysRemaining: 54,
          pwdStatus: 'valid'
        },
        {
          username: 'INITIAL_USER',
          fullName: 'New Hire',
          userType: 'A',
          pwdLastChanged: '',
          pwdExpiresAt: '',
          pwdDaysRemaining: null,
          pwdStatus: 'initial'
        },
        {
          username: 'SAP_SYSTEM',
          fullName: 'System User',
          userType: 'B',
          pwdLastChanged: '20200101',
          pwdExpiresAt: '',
          pwdDaysRemaining: null,
          pwdStatus: 'exempt'
        }
      ])
    };
  });

  afterEach(() => {
    if (savedPwdNotify !== undefined) process.env.PWD_NOTIFY_TO = savedPwdNotify;
    else delete process.env.PWD_NOTIFY_TO;

    if (savedLockNotify !== undefined) process.env.LOCK_NOTIFY_TO = savedLockNotify;
    else delete process.env.LOCK_NOTIFY_TO;
  });

  test('executes successful poll cycle and dispatches email when enabled', async () => {
    process.env.PWD_NOTIFY_TO = 'security@aether.co.in';

    const result = await notifier.pollOnce(() => mockAdapter, new Date('2026-11-06T10:00:00.000Z'));

    expect(result.status).toBe('ok');
    expect(result.totalMonitored).toBe(5);
    expect(result.counts).toEqual({
      valid: 1,
      expiringSoon: 1,
      expired: 1,
      initial: 1,
      exempt: 1
    });
    expect(result.dispatchedCount).toBe(3); // ALICE (expiring_soon), BOB (expired), INITIAL_USER (initial)

    // Verify mailer.send was invoked with correct arguments
    expect(mailer.send).toHaveBeenCalledTimes(1);
    const mailArgs = mailer.send.mock.calls[0][0];
    expect(mailArgs.to).toEqual(['security@aether.co.in']);
    expect(mailArgs.subject).toContain('[SAP Security Alert] 3 User Passwords Expired & Expiring Soon');
    expect(mailArgs.html).toContain('Alice Smith');
    expect(mailArgs.html).toContain('Bob Jones');

    // Verify monitor health was recorded in database
    const monitor = await cds.db.run(cds.ql.SELECT.one.from(store.MONITOR).where({ id: 'main' }));
    expect(monitor).toBeDefined();
    expect(monitor.lastStatus).toBe('ok');
    expect(monitor.lastNotificationDispatchedAt).not.toBeNull();
  });

  test('commits cycle without sending email when email is disabled', async () => {
    delete process.env.PWD_NOTIFY_TO;
    delete process.env.LOCK_NOTIFY_TO;

    const result = await notifier.pollOnce(() => mockAdapter, new Date('2026-11-06T10:00:00.000Z'));

    expect(result.status).toBe('ok');
    expect(result.dispatchedCount).toBe(0);
    expect(mailer.send).not.toHaveBeenCalled();

    // Events are queued in DB with status pending
    const events = await cds.db.run(cds.ql.SELECT.from(store.EVENT).where({ status: 'pending' }));
    expect(events.length).toBeGreaterThan(0);
  });

  test('handles SMTP dispatch failure by releasing claimed events with retry backoff', async () => {
    process.env.PWD_NOTIFY_TO = 'security@aether.co.in';
    mailer.send.mockRejectedValueOnce(new Error('SMTP connection refused'));

    const result = await notifier.pollOnce(() => mockAdapter, new Date('2026-11-06T10:00:00.000Z'));

    // The cycle itself finishes ok (snapshots and monitor updated), but dispatch failed
    expect(result.status).toBe('ok');
    expect(result.dispatchedCount).toBe(0);

    // Claimed events should be released back to 'pending' with error message
    const events = await cds.db.run(cds.ql.SELECT.from(store.EVENT));
    expect(events.every((e) => e.status === 'pending')).toBe(true);
    expect(events.some((e) => e.lastError.includes('SMTP connection refused'))).toBe(true);
  });

  test('records monitor failure when adapter fails to read data', async () => {
    mockAdapter.readPasswordExpiryData.mockRejectedValueOnce(new Error('RFC_COMMUNICATION_FAILURE'));

    const result = await notifier.pollOnce(() => mockAdapter, new Date('2026-11-06T10:00:00.000Z'));

    expect(result.status).toBe('failed');
    expect(result.error).toBe('RFC_COMMUNICATION_FAILURE');

    const monitor = await cds.db.run(cds.ql.SELECT.one.from(store.MONITOR).where({ id: 'main' }));
    expect(monitor).toBeDefined();
    expect(monitor.lastStatus).toBe('failed');
    expect(monitor.errorMessage).toBe('RFC_COMMUNICATION_FAILURE');
  });

  test('daemon startJob and stopJob lifecycle', () => {
    notifier._resetStatusForTest();
    expect(notifier.monitorStatus()).toBeNull();
    // When in test environment, startJob logs and skips
    notifier.startJob(() => mockAdapter);
    notifier.stopJob();
    expect(notifier.monitorStatus()).toBeNull();
  });
});
