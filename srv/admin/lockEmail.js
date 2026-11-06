'use strict';

/** Builds the lock alert. Pure: no SAP, database or SMTP. All values reach the HTML escaped. */

const COLUMNS = [
  ['Username', 'username'],
  ['Full Name', 'fullName'],
  ['Lock Type', 'lockType'],
  ['Lock Timestamp (SAP)', 'lockTimestamp'],
  ['Locked By', 'lockedBy'],
  ['Source', 'source'],
  ['Reason', 'reason'],
];

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** A header value holding a line break could add mail headers. */
const oneLine = (value) => String(value ?? '').replace(/[\r\n]+/g, ' ').trim();

const formatDetectedAt = (iso) => (iso ? `${String(iso).slice(0, 19).replace('T', ' ')} UTC` : '');

/** Formats a 14-digit compact timestamp YYYYMMDDHHMMSS into YYYY-MM-DD HH:MM:SS without timezone assumption. */
function formatLockTimestamp(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  if (/^\d{14}$/.test(s)) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)} ${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}`;
  }
  return s;
}

function getFieldValue(event, field) {
  if (field === 'lockTimestamp') {
    return formatLockTimestamp(event.lockTimestamp || event.lockedAt);
  }
  return event[field] || '';
}

/** Opens the SU01 screen with the username search filled in. */
function userLink(username, appUrl) {
  const base = String(appUrl || '').trim().replace(/#.*$/, '');
  if (!base) return '';
  return username ? `${base}#/dashboard/admin?search=${encodeURIComponent(username)}` : `${base}#/dashboard/admin`;
}

function buildUserTableHtml(event) {
  const username = escapeHtml(event.username || '-');
  const fullName = escapeHtml(event.fullName || '-');
  const lockType = escapeHtml(event.lockType || '-');
  const lockTimestamp = escapeHtml(getFieldValue(event, 'lockTimestamp') || '-');
  const lockedBy = escapeHtml(event.lockedBy || '-');
  const source = escapeHtml(event.source || '-');
  const reason = escapeHtml(event.reason || '-');
  const detectedAt = escapeHtml(formatDetectedAt(event.detectedAt) || '-');

  return `                            <table role="presentation" width="100%" cellpadding="6" cellspacing="0"
                                style="background-color:#FAFAFA;border-top:1px solid #E5E7EB;border-bottom:1px solid #E5E7EB;">

                                <tr>
                                    <td width="40%" style="font-size:12px;color:#6B7280;">
                                        <strong>Username</strong>
                                    </td>
                                    <td width="60%" style="font-size:12px;color:#111827;font-weight:bold;">
                                        ${username}
                                    </td>
                                </tr>

                                <tr>
                                    <td style="font-size:12px;color:#6B7280;">
                                        <strong>Full Name</strong>
                                    </td>
                                    <td style="font-size:12px;color:#111827;">
                                        ${fullName}
                                    </td>
                                </tr>

                                <tr>
                                    <td style="font-size:12px;color:#6B7280;">
                                        <strong>Lock Type</strong>
                                    </td>
                                    <td style="font-size:12px;color:#DC2626;font-weight:bold;">
                                        ${lockType}
                                    </td>
                                </tr>

                                <tr>
                                    <td style="font-size:12px;color:#6B7280;">
                                        <strong>Lock Timestamp (SAP)</strong>
                                    </td>
                                    <td style="font-size:12px;color:#111827;">
                                        ${lockTimestamp}
                                    </td>
                                </tr>

                                <tr>
                                    <td style="font-size:12px;color:#6B7280;">
                                        <strong>Locked By</strong>
                                    </td>
                                    <td style="font-size:12px;color:#111827;">
                                        ${lockedBy}
                                    </td>
                                </tr>

                                <tr>
                                    <td style="font-size:12px;color:#6B7280;">
                                        <strong>Source</strong>
                                    </td>
                                    <td style="font-size:12px;color:#111827;">
                                        ${source}
                                    </td>
                                </tr>

                                <tr>
                                    <td style="font-size:12px;color:#6B7280;">
                                        <strong>Reason</strong>
                                    </td>
                                    <td style="font-size:12px;color:#111827;">
                                        ${reason}
                                    </td>
                                </tr>

                                <tr>
                                    <td style="font-size:12px;color:#6B7280;">
                                        <strong>Detected At</strong>
                                    </td>
                                    <td style="font-size:12px;color:#111827;">
                                        ${detectedAt}
                                    </td>
                                </tr>

                            </table>`;
}

/**
 * One email for one poll cycle. Above maxListed, the first are listed and the rest are counted.
 *
 * @param {object[]} events - the locks to report, at least one
 * @param {{appUrl?: string, maxListed?: number}} [options]
 * @returns {{subject: string, text: string, html: string}}
 */
function buildLockEmail(events, { appUrl, maxListed = 50 } = {}) {
  const distinctUsers = new Set(events.map(({ username }) => String(username || '').trim().toUpperCase()));
  const subject = oneLine(distinctUsers.size === 1
    ? `[SAP Alert] User ${events[0].username} locked`
    : `[SAP Alert] ${distinctUsers.size} users locked`);
  const listed = events.slice(0, maxListed);
  const more = events.length - listed.length;

  const text = listed.map((event) => {
    const link = userLink(event.username, appUrl);
    return [
      ...COLUMNS.map(([label, field]) => `${label}: ${getFieldValue(event, field) || '-'}`),
      `Detected At: ${formatDetectedAt(event.detectedAt)}`,
      ...(link ? [`Open in app: ${link}`] : []),
    ].join('\n');
  }).join('\n\n') + (more ? `\n\nand ${more} more` : '');

  const primaryLink = appUrl ? userLink(listed.length === 1 ? listed[0].username : '', appUrl) : '';
  const actionButtonHtml = primaryLink ? `
                    <!-- Action Link / Button -->
                    <tr>
                        <td style="padding:18px 0 10px 0;font-size:13px;color:#111827;line-height:20px;">
                            Kindly review the user status in the SAP Fiori Administrator Dashboard:
                            <br /><br />
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                                <tr>
                                    <td align="center" style="border-radius:4px;background-color:#0070F2;">
                                        <a href="${escapeHtml(primaryLink)}"
                                            target="_blank"
                                            style="display:inline-block;padding:9px 24px;font-size:13px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:4px;background-color:#0070F2;">
                                            Open in App &rarr;
                                        </a>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>` : '';

  const usersDetailsHtml = listed.map((event, idx) => `
                    <!-- Section Title -->
                    <tr>
                        <td style="padding:${idx > 0 ? '20px' : '14px'} 0 8px 0;font-size:13px;color:#111827;font-weight:bold;">
                            User Lock Details${listed.length > 1 ? ` (${escapeHtml(event.username || '')})` : ''}
                        </td>
                    </tr>

                    <!-- Key-Value Table -->
                    <tr>
                        <td>
${buildUserTableHtml(event)}
                        </td>
                    </tr>`).join('\n');

  const moreHtml = more ? `
                    <tr>
                        <td style="padding:12px 0;font-size:13px;color:#6B7280;">
                            and ${more} more
                        </td>
                    </tr>` : '';

  const introEventText = listed.length === 1
    ? 'A user account lock event has been detected with the following details:'
    : 'User account lock events have been detected with the following details:';

  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN">
<html xmlns="http://www.w3.org/1999/xhtml">

<head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(subject)}</title>
</head>

<body style="margin:0;padding:0;background-color:#ffffff;font-family:Helvetica, Arial, sans-serif;">

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
            <td align="center">

                <!-- Main Container -->
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                    style="max-width:660px;margin:0 auto;">

                    <!-- Header -->
                    <tr>
                        <td style="padding:20px 0;">
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                                <tr>
                                    <td width="70%" style="font-size:22px;color:#878787;text-transform:uppercase;">
                                        User Account Locked (Internal)
                                    </td>
                                    <td width="30%" align="right">
                                        <img src="https://myapp.airis.co.in/src/app/ClientResources/Airis/AeElementally.png"
                                            height="60" alt="Aether Industries Limited Logo"
                                            style="display:block;border:0;outline:none;" />
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <!-- Intro -->
                    <tr>
                        <td style="padding:10px 0 14px 0;font-size:13px;color:#111827;line-height:20px;">
                            Dear Team / Administrator,<br /><br />
                            This is an automated security notification from SAP. ${introEventText}
                        </td>
                    </tr>

                    <!-- Divider -->
                    <tr>
                        <td>
                            <hr style="border-color:#c0dbff;" />
                        </td>
                    </tr>
${usersDetailsHtml}
${moreHtml}
${actionButtonHtml}
                    <!-- Divider -->
                    <tr>
                        <td>
                            <hr style="border-color:#c0dbff;" />
                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="padding:20px 0;font-size:13px;color:#111827;line-height:20px;">
                            Thanks &amp; Regards,<br /><br />

                            <strong>SAP Security &amp; Basis Team</strong><br />
                            Aether Industries Limited<br /><br />

                            <span style="font-size:12px;color:#6B7280;">
                                This is a system-generated email from SAP. Please do not reply to this email.
                            </span>
                        </td>
                    </tr>

                </table>
                <!-- End Main Container -->

            </td>
        </tr>
    </table>

</body>

</html>`;

  return { subject, text, html };
}

module.exports = { buildLockEmail, formatDetectedAt, formatLockTimestamp, userLink };
