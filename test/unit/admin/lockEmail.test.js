'use strict';

const { buildLockEmail, formatDetectedAt, userLink } = require('../../../srv/admin/lockEmail');

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
    ['Username', 'Full Name', 'Lock Type', 'Locked By', 'Source', 'Reason', 'Detected At'].forEach((header) => {
      expect(mail.html).toContain(`<th align="left">${header}</th>`);
    });
  });

  test('several users: one table, subject with the count', () => {
    const mail = buildLockEmail([event('ALICE'), event('BOB')]);

    expect(mail.subject).toBe('[SAP Alert] 2 users locked');
    expect(mail.html.match(/<table/g)).toHaveLength(1);
    expect(mail.html.match(/<tr>/g)).toHaveLength(3);
    expect(mail.text).toContain('Username: ALICE');
    expect(mail.text).toContain('Username: BOB');
  });

  test('flood guard: lists the first ones and says how many more', () => {
    const events = Array.from({ length: 53 }, (_, i) => event(`U${i}`));

    const mail = buildLockEmail(events, { maxListed: 50 });

    expect(mail.subject).toBe('[SAP Alert] 53 users locked');
    expect(mail.text).toContain('Username: U49');
    expect(mail.text).not.toContain('Username: U50');
    expect(mail.text).toContain('and 3 more');
    expect(mail.html).toContain('<td>U49</td>');
    expect(mail.html).not.toContain('<td>U50</td>');
    expect(mail.html).toContain('and 3 more');
  });

  test('exactly the limit says nothing about more', () => {
    expect(buildLockEmail([event('A'), event('B')], { maxListed: 2 }).text).not.toContain('more');
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

  test('an empty value shows as a dash, and no app URL means no link', () => {
    const mail = buildLockEmail([event('ALICE', { reason: '' })]);

    expect(mail.text).toContain('Reason: -');
    expect(mail.text).not.toContain('Open in app');
    expect(mail.html).not.toContain('<a ');
    expect(mail.html).not.toContain('Link</th>');
  });

  test('the link encodes the username and replaces any fragment in the base URL', () => {
    expect(userLink('A/B#C', 'https://app.test/#/old')).toBe('https://app.test/#/dashboard/admin?search=A%2FB%23C');
    expect(userLink('A', '  ')).toBe('');
  });

  test('shows a missing time as empty', () => {
    expect(formatDetectedAt(null)).toBe('');
  });
});
