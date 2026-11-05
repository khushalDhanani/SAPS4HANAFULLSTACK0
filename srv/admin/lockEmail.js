'use strict';

/** Builds the lock alert. Pure: no SAP, database or SMTP. All values reach the HTML escaped. */

const COLUMNS = [
  ['Username', 'username'],
  ['Full Name', 'fullName'],
  ['Lock Type', 'lockType'],
  ['Locked By', 'lockedBy'],
  ['Source', 'source'],
  ['Reason', 'reason'],
];

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** A header value holding a line break could add mail headers. */
const oneLine = (value) => String(value ?? '').replace(/[\r\n]+/g, ' ').trim();

const formatDetectedAt = (iso) => (iso ? `${String(iso).slice(0, 19).replace('T', ' ')} UTC` : '');

/** Opens the SU01 screen with the username search filled in. */
function userLink(username, appUrl) {
  const base = String(appUrl || '').trim().replace(/#.*$/, '');
  return base ? `${base}#/dashboard/admin?search=${encodeURIComponent(username)}` : '';
}

/**
 * One email for one poll cycle. Above maxListed, the first are listed and the rest are counted.
 *
 * @param {object[]} events - the locks to report, at least one
 * @param {{appUrl?: string, maxListed?: number}} [options]
 * @returns {{subject: string, text: string, html: string}}
 */
function buildLockEmail(events, { appUrl, maxListed = 50 } = {}) {
  const subject = oneLine(events.length === 1
    ? `[SAP Alert] User ${events[0].username} locked`
    : `[SAP Alert] ${events.length} users locked`);
  const listed = events.slice(0, maxListed);
  const more = events.length - listed.length;

  const text = listed.map((event) => {
    const link = userLink(event.username, appUrl);
    return [
      ...COLUMNS.map(([label, field]) => `${label}: ${event[field] || '-'}`),
      `Detected At: ${formatDetectedAt(event.detectedAt)}`,
      ...(link ? [`Open in app: ${link}`] : []),
    ].join('\n');
  }).join('\n\n') + (more ? `\n\nand ${more} more` : '');

  const headers = [...COLUMNS.map(([label]) => label), 'Detected At', ...(appUrl ? ['Link'] : [])];
  const rows = listed.map((event) => {
    const link = userLink(event.username, appUrl);
    const cells = [
      ...COLUMNS.map(([, field]) => escapeHtml(event[field] || '-')),
      escapeHtml(formatDetectedAt(event.detectedAt)),
      ...(appUrl ? [link ? `<a href="${escapeHtml(link)}">Open in app</a>` : ''] : []),
    ];
    return `<tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`;
  }).join('');
  const html = `<p>${escapeHtml(subject)}</p><table border="1" cellpadding="4" cellspacing="0">`
    + `<tr>${headers.map((header) => `<th align="left">${escapeHtml(header)}</th>`).join('')}</tr>${rows}</table>`
    + (more ? `<p>and ${more} more</p>` : '');

  return { subject, text, html };
}

module.exports = { buildLockEmail, formatDetectedAt, userLink };
