'use strict';

/**
 * Builds Aether-branded Password Expiry Notification HTML & Plain-Text emails.
 * Pure rendering: zero network, SAP, or database dependencies.
 * All dynamic SAP attributes, usernames, and reasons are strictly escaped with escapeHtml.
 */

const LOGO_URL = 'https://myapp.airis.co.in/src/app/ClientResources/Airis/AeElementally.png';

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const oneLine = (value) => String(value ?? '').replace(/[\r\n]+/g, ' ').trim();

/**
 * Formats an 8-character SAP DATS 'YYYYMMDD' into 'YYYY-MM-DD'.
 */
function formatDisplayDate(raw) {
  if (!raw) return '-';
  const s = String(raw).trim();
  if (/^\d{8}$/.test(s)) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }
  return s;
}

/**
 * Maps password status to badge label and color.
 */
function statusBadge(status) {
  switch (status) {
    case 'expired':
      return { label: 'EXPIRED', color: '#DC2626', bg: '#FEE2E2' };
    case 'expiring_soon':
      return { label: 'EXPIRING SOON', color: '#D97706', bg: '#FEF3C7' };
    case 'initial':
      return { label: 'INITIAL PASSWORD', color: '#7C3AED', bg: '#EDE9FE' };
    case 'exempt':
      return { label: 'EXEMPT', color: '#4B5563', bg: '#F3F4F6' };
    default:
      return { label: 'ACTIVE', color: '#16A34A', bg: '#DCFCE7' };
  }
}

/**
 * Opens the Sub-User Master screen with password filter.
 */
function adminLink(appUrl, filter = 'expiring') {
  const base = String(appUrl || '').trim().replace(/#.*$/, '');
  if (!base) return '';
  return `${base}#/dashboard/admin?filter=${encodeURIComponent(filter)}`;
}

/**
 * Resolves user password status from pwdStatus or milestone.
 */
function resolveUserStatus(u) {
  if (u.pwdStatus) return u.pwdStatus;
  if (u.milestone === 'expired') return 'expired';
  if (u.milestone === 'initial') return 'initial';
  if (u.milestone && String(u.milestone).includes('days')) return 'expiring_soon';
  return 'valid';
}

/**
 * Builds HTML table rows for listed users.
 */
function buildUserRowHtml(user) {
  const username = escapeHtml(user.username || '-');
  const fullName = escapeHtml(user.fullName || '-');
  const userType = escapeHtml(user.userType || '-');
  const lastChanged = escapeHtml(formatDisplayDate(user.pwdLastChanged));
  const expiresAt = escapeHtml(formatDisplayDate(user.pwdExpiresAt || user.expiryDate));
  const days = user.pwdDaysRemaining !== null && user.pwdDaysRemaining !== undefined
    ? user.pwdDaysRemaining
    : (user.daysRemaining !== null && user.daysRemaining !== undefined ? user.daysRemaining : '-');
  const status = resolveUserStatus(user);
  const badge = statusBadge(status);

  return `
    <tr style="border-bottom: 1px solid #E5E7EB;">
      <td style="padding: 10px 8px; font-size: 12px; font-weight: bold; color: #111827;">${username}</td>
      <td style="padding: 10px 8px; font-size: 12px; color: #374151;">${fullName}</td>
      <td style="padding: 10px 8px; font-size: 12px; color: #6B7280; text-align: center;">${userType}</td>
      <td style="padding: 10px 8px; font-size: 12px; color: #374151;">${lastChanged}</td>
      <td style="padding: 10px 8px; font-size: 12px; color: #374151;">${expiresAt}</td>
      <td style="padding: 10px 8px; font-size: 12px; font-weight: bold; color: ${days < 0 ? '#DC2626' : (days <= 3 ? '#DC2626' : '#D97706')}; text-align: center;">${days}</td>
      <td style="padding: 10px 8px; font-size: 11px; text-align: center;">
        <span style="display: inline-block; padding: 2px 8px; border-radius: 9999px; font-weight: bold; color: ${badge.color}; background-color: ${badge.bg};">
          ${badge.label}
        </span>
      </td>
    </tr>`;
}

/**
 * Builds the consolidated Password Expiry Digest email.
 *
 * @param {object[]} users - Array of user expiry objects
 * @param {object} [options]
 * @param {string} [options.appUrl] - Base application URL
 * @param {number} [options.maxListed=50] - Maximum users displayed before overflow notice
 * @param {number} [options.policyDays=90] - Configured policy days
 * @returns {{subject: string, text: string, html: string}}
 */
function buildPasswordExpiryEmail(users, { appUrl, maxListed = 50, policyDays = 90 } = {}) {
  const expiredCount = users.filter((u) => resolveUserStatus(u) === 'expired').length;
  const expiringSoonCount = users.filter((u) => resolveUserStatus(u) === 'expiring_soon').length;
  const initialCount = users.filter((u) => resolveUserStatus(u) === 'initial').length;

  let subjectTag = 'Expiring Soon';
  if (expiredCount > 0 && expiringSoonCount > 0) subjectTag = 'Expired & Expiring Soon';
  else if (expiredCount > 0) subjectTag = 'Expired';

  const subject = oneLine(`[SAP Security Alert] ${users.length} User Passwords ${subjectTag}`);

  const listed = users.slice(0, maxListed);
  const more = users.length - listed.length;

  // Plain-text representation
  const textRows = listed.map((u) => {
    const status = resolveUserStatus(u);
    return [
      `User: ${u.username || '-'} (${u.fullName || '-'})`,
      `Type: ${u.userType || '-'}`,
      `Last Changed: ${formatDisplayDate(u.pwdLastChanged)}`,
      `Expires: ${formatDisplayDate(u.pwdExpiresAt || u.expiryDate)}`,
      `Days Remaining: ${u.pwdDaysRemaining ?? u.daysRemaining ?? '-'}`,
      `Status: ${status.toUpperCase()}`
    ].join(' | ');
  });

  const appLink = adminLink(appUrl);
  const text = [
    `SAP Security Advisory: Password Expiry Monitoring`,
    `Policy: ${policyDays} days validity`,
    `Summary: ${expiredCount} expired, ${expiringSoonCount} expiring soon, ${initialCount} initial password`,
    ``,
    `Users requiring attention:`,
    ...textRows,
    ...(more > 0 ? [``, `... and ${more} more users.`] : []),
    ...(appLink ? [``, `Review in Sub-User Master: ${appLink}`] : []),
    ``,
    `SAP Security & Basis Team`,
    `Aether Industries Limited`
  ].join('\n');

  const rowsHtml = listed.map(buildUserRowHtml).join('');
  const ctaButtonHtml = appLink ? `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top: 20px;">
      <tr>
        <td align="center" style="border-radius: 4px; background-color: #0070F2;">
          <a href="${escapeHtml(appLink)}"
             target="_blank"
             style="display: inline-block; padding: 10px 24px; font-size: 13px; font-weight: bold; color: #ffffff; text-decoration: none; border-radius: 4px; background-color: #0070F2;">
            Open Sub-User Master &rarr;
          </a>
        </td>
      </tr>
    </table>` : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #F3F4F6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #F3F4F6; padding: 24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 680px; background-color: #FFFFFF; border-radius: 8px; border: 1px solid #E5E7EB; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
          
          <!-- Header Strip with Logo -->
          <tr>
            <td style="background-color: #0F172A; padding: 18px 24px; border-bottom: 3px solid #0070F2;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="left" valign="middle">
                    <span style="font-size: 11px; font-weight: 700; color: #94A3B8; text-transform: uppercase; letter-spacing: 1.5px; display: block;">Security Advisory</span>
                    <span style="font-size: 18px; font-weight: 700; color: #FFFFFF; letter-spacing: 0.5px;">Password Expiry Monitor</span>
                  </td>
                  <td align="right" valign="middle">
                    <img src="${LOGO_URL}" alt="Aether Industries" height="42" style="display: block; max-height: 42px; width: auto; border: 0;" />
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Summary Metric Banner -->
          <tr>
            <td style="padding: 20px 24px 12px 24px; background-color: #F8FAFC; border-bottom: 1px solid #E2E8F0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-size: 14px; color: #334155;">
                    <strong>Dear Administrator / Security Team,</strong><br/>
                    The following SAP S/4HANA user accounts have passwords that are expired or expiring soon according to the <strong>${policyDays}-day</strong> password rotation policy.
                  </td>
                </tr>
                <tr>
                  <td style="padding-top: 14px;">
                    <table role="presentation" cellpadding="0" cellspacing="6">
                      <tr>
                        <td style="background-color: #FEE2E2; color: #DC2626; padding: 6px 12px; border-radius: 4px; font-size: 12px; font-weight: bold;">
                          ${expiredCount} Expired
                        </td>
                        <td style="background-color: #FEF3C7; color: #D97706; padding: 6px 12px; border-radius: 4px; font-size: 12px; font-weight: bold;">
                          ${expiringSoonCount} Expiring Soon
                        </td>
                        ${initialCount > 0 ? `
                        <td style="background-color: #EDE9FE; color: #7C3AED; padding: 6px 12px; border-radius: 4px; font-size: 12px; font-weight: bold;">
                          ${initialCount} Initial Password
                        </td>` : ''}
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- User Table -->
          <tr>
            <td style="padding: 20px 24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse; text-align: left;">
                <thead>
                  <tr style="background-color: #F1F5F9; border-bottom: 2px solid #CBD5E1;">
                    <th style="padding: 10px 8px; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase;">Username</th>
                    <th style="padding: 10px 8px; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase;">Full Name</th>
                    <th style="padding: 10px 8px; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase; text-align: center;">Type</th>
                    <th style="padding: 10px 8px; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase;">Last Changed</th>
                    <th style="padding: 10px 8px; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase;">Expires</th>
                    <th style="padding: 10px 8px; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase; text-align: center;">Days</th>
                    <th style="padding: 10px 8px; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase; text-align: center;">Status</th>
                  </tr>
                </thead>
                <tbody>
                  ${rowsHtml}
                </tbody>
              </table>

              ${more > 0 ? `
              <p style="margin: 14px 0 0 0; font-size: 12px; color: #64748B; font-style: italic;">
                ... and ${more} more users requiring attention.
              </p>` : ''}

              ${ctaButtonHtml}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #F8FAFC; padding: 18px 24px; border-top: 1px solid #E2E8F0; font-size: 11px; color: #64748B; line-height: 16px;">
              <strong>SAP Security & Basis Team</strong><br/>
              Aether Industries Limited &bull; Confidential &bull; System Generated Security Alert
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}

module.exports = {
  buildPasswordExpiryEmail,
  resolveUserStatus,
  formatDisplayDate,
  statusBadge,
  escapeHtml,
  adminLink
};
