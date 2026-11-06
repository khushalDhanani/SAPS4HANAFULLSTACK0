'use strict';

const {
  buildPasswordExpiryEmail,
  formatDisplayDate,
  statusBadge,
  escapeHtml,
  adminLink
} = require('../../../srv/admin/passwordExpiryEmail');

describe('passwordExpiryEmail helpers', () => {
  describe('formatDisplayDate', () => {
    test('formats 8-digit SAP date YYYYMMDD to YYYY-MM-DD', () => {
      expect(formatDisplayDate('20261106')).toBe('2026-11-06');
      expect(formatDisplayDate('20260101')).toBe('2026-01-01');
    });

    test('returns dash for empty, null, or undefined', () => {
      expect(formatDisplayDate('')).toBe('-');
      expect(formatDisplayDate(null)).toBe('-');
      expect(formatDisplayDate(undefined)).toBe('-');
    });

    test('returns raw string if not 8 digits', () => {
      expect(formatDisplayDate('2026-11-06')).toBe('2026-11-06');
      expect(formatDisplayDate('invalid')).toBe('invalid');
    });
  });

  describe('statusBadge', () => {
    test('returns correct badge properties for all statuses', () => {
      expect(statusBadge('expired')).toEqual({ label: 'EXPIRED', color: '#DC2626', bg: '#FEE2E2' });
      expect(statusBadge('expiring_soon')).toEqual({ label: 'EXPIRING SOON', color: '#D97706', bg: '#FEF3C7' });
      expect(statusBadge('initial')).toEqual({ label: 'INITIAL PASSWORD', color: '#7C3AED', bg: '#EDE9FE' });
      expect(statusBadge('exempt')).toEqual({ label: 'EXEMPT', color: '#4B5563', bg: '#F3F4F6' });
      expect(statusBadge('valid')).toEqual({ label: 'ACTIVE', color: '#16A34A', bg: '#DCFCE7' });
      expect(statusBadge('unknown')).toEqual({ label: 'ACTIVE', color: '#16A34A', bg: '#DCFCE7' });
    });
  });

  describe('escapeHtml', () => {
    test('escapes HTML special characters', () => {
      expect(escapeHtml('<script>alert("xss")&\'test\'</script>')).toBe(
        '&lt;script&gt;alert(&quot;xss&quot;)&amp;&#39;test&#39;&lt;/script&gt;'
      );
      expect(escapeHtml(null)).toBe('');
      expect(escapeHtml(undefined)).toBe('');
    });
  });

  describe('adminLink', () => {
    test('builds dashboard link with encoded filter parameter', () => {
      expect(adminLink('https://app.test/index.html')).toBe('https://app.test/index.html#/dashboard/admin?filter=expiring');
      expect(adminLink('https://app.test/index.html#somewhere', 'expired')).toBe('https://app.test/index.html#/dashboard/admin?filter=expired');
      expect(adminLink('')).toBe('');
      expect(adminLink(null)).toBe('');
    });
  });
});

describe('buildPasswordExpiryEmail', () => {
  const sampleUser = (username, extra = {}) => ({
    username,
    fullName: `${username} Full Name`,
    userType: 'A',
    pwdLastChanged: '20260822',
    pwdExpiresAt: '20261120',
    pwdDaysRemaining: 14,
    pwdStatus: 'expiring_soon',
    ...extra
  });

  test('single user expiring soon: subject, metrics banner, row, and CTA button', () => {
    const user = sampleUser('DIPEN', { pwdDaysRemaining: 14, pwdStatus: 'expiring_soon' });
    const email = buildPasswordExpiryEmail([user], { appUrl: 'https://app.test/index.html', policyDays: 90 });

    expect(email.subject).toBe('[SAP Security Alert] 1 User Passwords Expiring Soon');
    expect(email.html).toContain('Password Expiry Monitor');
    expect(email.html).toContain('DIPEN');
    expect(email.html).toContain('DIPEN Full Name');
    expect(email.html).toContain('2026-08-22');
    expect(email.html).toContain('2026-11-20');
    expect(email.html).toContain('14');
    expect(email.html).toContain('EXPIRING SOON');
    expect(email.html).toContain('90-day');
    expect(email.html).toContain('Open Sub-User Master &rarr;');
    expect(email.html).toContain('https://app.test/index.html#/dashboard/admin?filter=expiring');

    expect(email.text).toContain('SAP Security Advisory: Password Expiry Monitoring');
    expect(email.text).toContain('User: DIPEN (DIPEN Full Name)');
    expect(email.text).toContain('Days Remaining: 14');
    expect(email.text).toContain('Review in Sub-User Master: https://app.test/index.html#/dashboard/admin?filter=expiring');
  });

  test('single user expired: subject indicates Expired', () => {
    const user = sampleUser('OLDUSER', { pwdDaysRemaining: -5, pwdStatus: 'expired' });
    const email = buildPasswordExpiryEmail([user]);

    expect(email.subject).toBe('[SAP Security Alert] 1 User Passwords Expired');
    expect(email.html).toContain('EXPIRED');
    expect(email.html).toContain('1 Expired');
  });

  test('multiple users mixed status: subject indicates Expired & Expiring Soon', () => {
    const users = [
      sampleUser('USER1', { pwdStatus: 'expired', pwdDaysRemaining: -10 }),
      sampleUser('USER2', { pwdStatus: 'expiring_soon', pwdDaysRemaining: 5 }),
      sampleUser('USER3', { pwdStatus: 'initial', pwdDaysRemaining: null })
    ];
    const email = buildPasswordExpiryEmail(users);

    expect(email.subject).toBe('[SAP Security Alert] 3 User Passwords Expired & Expiring Soon');
    expect(email.html).toContain('1 Expired');
    expect(email.html).toContain('1 Expiring Soon');
    expect(email.html).toContain('1 Initial Password');
    expect(email.html).toContain('INITIAL PASSWORD');
  });

  test('sanitizes user input to prevent XSS injection', () => {
    const maliciousUser = sampleUser('<script>alert("xss")</script>', {
      fullName: '<b>Hacker</b> & Co'
    });
    const email = buildPasswordExpiryEmail([maliciousUser]);

    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    expect(email.html).toContain('&lt;b&gt;Hacker&lt;/b&gt; &amp; Co');
  });

  test('overflow truncation with maxListed', () => {
    const users = [];
    for (let i = 1; i <= 60; i++) {
      users.push(sampleUser(`USER_${i}`));
    }
    const email = buildPasswordExpiryEmail(users, { maxListed: 50 });

    expect(email.html).toContain('USER_1');
    expect(email.html).toContain('USER_50');
    expect(email.html).not.toContain('USER_51');
    expect(email.html).toContain('... and 10 more users requiring attention.');
    expect(email.text).toContain('... and 10 more users.');
  });

  test('renders without CTA button when appUrl is not provided', () => {
    const email = buildPasswordExpiryEmail([sampleUser('ALICE')]);
    expect(email.html).not.toContain('Open Sub-User Master');
    expect(email.text).not.toContain('Review in Sub-User Master');
  });
});
