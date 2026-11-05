'use strict';

const { buildLockEmail, formatLockedAt, userLink } = require('../../../srv/admin/lockEmail');

const event = (username, extra = {}) => ({
  username,
  fullName: `${username} Name`,
  lockType: 'admin-local',
  lockedBy: 'ADMIN',
  lockedAt: '20261105101500',
  lockedAtSource: 'sap',
  source: 'app',
  reason: '',
  ...extra,
});

describe('buildLockEmail', () => {
  test('single lock: subject and every field in both versions', () => {
    const mail = buildLockEmail([event('ALICE', { reason: 'Left the company' })], { appUrl: 'https://app.test/index.html' });

    expect(mail.subject).toBe('[SAP Alert] User ALICE locked');
    ['ALICE', 'ALICE Name', 'Locked locally by administrator', 'ADMIN', '05-11-2026 10:15:00 (SAP time)', 'This app', 'Left the company', 'https://app.test/index.html#/dashboard/admin?user=ALICE']
      .forEach((text) => {
        expect(mail.text).toContain(text);
        expect(mail.html).toContain(text);
      });
  });

  test('bulk summary: one mail listing exactly the events given', () => {
    const mail = buildLockEmail([event('ALICE'), event('BOB', { lockType: 'wrong-password', source: 'auto' })]);

    expect(mail.subject).toBe('[SAP Alert] 2 users locked');
    expect(mail.text).toContain('Username: ALICE');
    expect(mail.text).toContain('Username: BOB');
    expect(mail.text).toContain('Locked by incorrect logons');
    expect(mail.text).toContain('Automatic (SAP)');
    expect(mail.text).not.toContain('CAROL');
  });

  test('escapes HTML from SAP values and the reason, in the HTML version only', () => {
    const mail = buildLockEmail([event('ALICE', { fullName: '<img src=x onerror=1>', reason: '"><script>alert(1)</script>' })]);

    expect(mail.html).not.toContain('<img');
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;img src=x onerror=1&gt;');
    expect(mail.text).toContain('<img src=x onerror=1>');
  });

  test('a line break cannot add a mail header through the subject', () => {
    expect(buildLockEmail([event('A\r\nBcc: x@example.test')]).subject).toBe('[SAP Alert] User A Bcc: x@example.test locked');
  });

  test('leaves out empty fields, and the link when no app URL is set', () => {
    const mail = buildLockEmail([event('ALICE', { reason: '', lockedBy: '' })]);

    expect(mail.text).not.toContain('Reason');
    expect(mail.text).not.toContain('Locked by:');
    expect(mail.text).not.toContain('Open in app');
    expect(mail.html).not.toContain('<a ');
  });

  test('labels a detection time apart from a time SAP recorded', () => {
    expect(formatLockedAt({ lockedAt: '20261105101500', lockedAtSource: 'detected' })).toBe('05-11-2026 10:15:00 (detected, UTC)');
  });

  test('the link encodes the username and replaces any fragment in the base URL', () => {
    expect(userLink('A/B#C', 'https://app.test/#/old')).toBe('https://app.test/#/dashboard/admin?user=A%2FB%23C');
    expect(userLink('A', '  ')).toBe('');
  });
});
