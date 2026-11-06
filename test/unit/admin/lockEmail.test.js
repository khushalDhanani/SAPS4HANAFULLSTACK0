'use strict';

const { buildLockEmail, formatDetectedAt, formatLockTimestamp, userLink } = require('../../../srv/admin/lockEmail');

const event = (username, extra = {}) => ({
  username,
  fullName: `${username} Name`,
  lockType: 'Locked by administrator',
  lockedBy: 'ADMIN',
  source: 'Fiori app',
  reason: '',
  detectedAt: '2026-11-05T10:15:00.000Z',
  ...extra,
});

describe('buildLockEmail', () => {
  test('one user: subject and every column in both versions', () => {
    const mail = buildLockEmail([event('ALICE', { reason: 'Left the company' })], { appUrl: 'https://app.test/index.html' });

    expect(mail.subject).toBe('[SAP Alert] User ALICE locked');
    ['ALICE', 'ALICE Name', 'Locked by administrator', 'ADMIN', 'Fiori app', 'Left the company', '2026-11-05 10:15:00 UTC', 'https://app.test/index.html#/dashboard/admin?search=ALICE']
      .forEach((text) => {
        expect(mail.text).toContain(text);
        expect(mail.html).toContain(text);
      });
    ['Username', 'Full Name', 'Lock Type', 'Lock Timestamp (SAP)', 'Locked By', 'Source', 'Reason', 'Detected At'].forEach((header) => {
      expect(mail.html).toContain(`<strong>${header}</strong>`);
    });
    expect(mail.html).toContain('User Account Locked (Internal)');
    expect(mail.html).toContain('Aether Industries Limited Logo');
    expect(mail.html).toContain('Open in App &rarr;');
    expect(mail.html).toContain('Unlock User &rarr;');
    expect(mail.html).toContain('https://app.test/index.html#/dashboard/admin?search=ALICE&amp;action=unlock');
    expect(mail.text).toContain('Unlock in app: https://app.test/index.html#/dashboard/admin?search=ALICE&action=unlock');
  });

  test('shows a history timestamp without assigning a timezone', () => {
    const mail = buildLockEmail([event('ALICE', { lockTimestamp: '2026-11-05 10:15:00' })]);
    expect(mail.text).toContain('Lock Timestamp (SAP): 2026-11-05 10:15:00');
    expect(mail.html).toContain('2026-11-05 10:15:00');
  });

  test('formats 14-digit lockedAt timestamp from database queue without timezone assumption', () => {
    const mail = buildLockEmail([event('ALICE', { lockedAt: '20261105165702' })]);
    expect(mail.text).toContain('Lock Timestamp (SAP): 2026-11-05 16:57:02');
    expect(mail.html).toContain('2026-11-05 16:57:02');
  });

  test('formatLockTimestamp helper formats 14-digit compact timestamp or passes through', () => {
    expect(formatLockTimestamp('20261105165702')).toBe('2026-11-05 16:57:02');
    expect(formatLockTimestamp('2026-11-05 16:57:02')).toBe('2026-11-05 16:57:02');
    expect(formatLockTimestamp('')).toBe('');
    expect(formatLockTimestamp(null)).toBe('');
    expect(formatLockTimestamp(undefined)).toBe('');
  });

  test('several users: one table per user, subject with the count', () => {
    const mail = buildLockEmail([event('ALICE'), event('BOB')]);

    expect(mail.subject).toBe('[SAP Alert] 2 users locked');
    expect(mail.html).toContain('ALICE');
    expect(mail.html).toContain('BOB');
    expect(mail.html).toContain('User Lock Details (ALICE)');
    expect(mail.html).toContain('User Lock Details (BOB)');
    expect(mail.text).toContain('Username: ALICE');
    expect(mail.text).toContain('Username: BOB');
  });

  test('subject counts distinct usernames when a user has multiple lock events', () => {
    const mail = buildLockEmail([
      event('DIPEN', { lockedAt: '20261105165702' }),
      event('dipen', { lockedAt: '20261105165704' }),
    ]);

    expect(mail.subject).toBe('[SAP Alert] User DIPEN locked');
    expect(mail.text.match(/Username: /g)).toHaveLength(2);
  });

  test('flood guard: lists the first ones and says how many more', () => {
    const events = Array.from({ length: 53 }, (_, i) => event(`U${i}`));

    const mail = buildLockEmail(events, { maxListed: 50 });

    expect(mail.subject).toBe('[SAP Alert] 53 users locked');
    expect(mail.text).toContain('Username: U49');
    expect(mail.text).not.toContain('Username: U50');
    expect(mail.text).toContain('and 3 more');
    expect(mail.html).toContain('U49');
    expect(mail.html).not.toContain('U50');
    expect(mail.html).toContain('and 3 more');
  });

  test('exactly the limit says nothing about more', () => {
    expect(buildLockEmail([event('A'), event('B')], { maxListed: 2 }).text).not.toContain('more');
  });

  test('escapes HTML from SAP values and the reason, in the HTML version only', () => {
    const mail = buildLockEmail([event('ALICE', { fullName: '<img src=x onerror=1>', reason: '"><script>alert(1)</script>' })]);

    expect(mail.html).not.toContain('<img src=x');
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;img src=x onerror=1&gt;');
    expect(mail.text).toContain('<img src=x onerror=1>');
  });

  test('a line break cannot add a mail header through the subject', () => {
    expect(buildLockEmail([event('A\r\nBcc: x@example.test')]).subject).toBe('[SAP Alert] User A Bcc: x@example.test locked');
  });

  test('an empty value shows as a dash, and no app URL means no link', () => {
    const mail = buildLockEmail([event('ALICE', { reason: '' })]);

    expect(mail.text).toContain('Reason: -');
    expect(mail.text).not.toContain('Open in app');
    expect(mail.html).not.toContain('<a ');
    expect(mail.html).not.toContain('Open in App &rarr;');
  });

  test('the link encodes the username and replaces any fragment in the base URL', () => {
    expect(userLink('A/B#C', 'https://app.test/#/old')).toBe('https://app.test/#/dashboard/admin?search=A%2FB%23C');
    expect(userLink('A/B#C', 'https://app.test/#/old', 'unlock')).toBe('https://app.test/#/dashboard/admin?search=A%2FB%23C&action=unlock');
    expect(userLink('A', '  ')).toBe('');
  });

  test('shows a missing time as empty', () => {
    expect(formatDetectedAt(null)).toBe('');
  });
});
