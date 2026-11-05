'use strict';

/** Builds the lock alert. Pure: no SAP, database or SMTP. All values reach the HTML escaped. */

const LOCK_TYPE_TEXT = {
  'admin-global': 'Locked globally by administrator',
  'admin-local': 'Locked locally by administrator',
  'wrong-password': 'Locked by incorrect logons',
};
const SOURCE_TEXT = { app: 'This app', SAP: 'SAP', auto: 'Automatic (SAP)' };

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** A header value holding a line break could add mail headers. */
const oneLine = (value) => String(value ?? '').replace(/[\r\n]+/g, ' ').trim();

function formatLockedAt({ lockedAt, lockedAtSource }) {
  const t = String(lockedAt || '');
  if (!/^\d{14}$/.test(t)) return t;
  const label = lockedAtSource === 'sap' ? 'SAP time' : 'detected, UTC';
  return `${t.slice(6, 8)}-${t.slice(4, 6)}-${t.slice(0, 4)} ${t.slice(8, 10)}:${t.slice(10, 12)}:${t.slice(12, 14)} (${label})`;
}

function userLink(username, appUrl) {
  const base = String(appUrl || '').trim().replace(/#.*$/, '');
  return base ? `${base}#/dashboard/admin?user=${encodeURIComponent(username)}` : '';
}

function fieldsOf(event, appUrl) {
  return {
    link: userLink(event.username, appUrl),
    rows: [
      ['Username', event.username],
      ['Full name', event.fullName],
      ['Lock type', LOCK_TYPE_TEXT[event.lockType] || event.lockType],
      ['Locked by', event.lockedBy],
      ['Time', formatLockedAt(event)],
      ['Source', SOURCE_TEXT[event.source] || event.source],
      ['Reason', event.reason],
    ].filter(([, value]) => value),
  };
}

/**
 * @param {object[]} events - the notified locks, at least one
 * @param {{appUrl?: string}} [options]
 * @returns {{subject: string, text: string, html: string}}
 */
function buildLockEmail(events, { appUrl } = {}) {
  const subject = oneLine(events.length === 1
    ? `[SAP Alert] User ${events[0].username} locked`
    : `[SAP Alert] ${events.length} users locked`);

  const blocks = events.map((event) => fieldsOf(event, appUrl));
  const text = blocks.map(({ rows, link }) => [
    ...rows.map(([label, value]) => `${label}: ${value}`),
    ...(link ? [`Open in app: ${link}`] : []),
  ].join('\n')).join('\n\n');

  const html = blocks.map(({ rows, link }) => `<table>${rows
    .map(([label, value]) => `<tr><th align="left">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`)
    .join('')}${link ? `<tr><td colspan="2"><a href="${escapeHtml(link)}">Open in app</a></td></tr>` : ''}</table>`).join('<hr>');

  return { subject, text, html: `<p>${escapeHtml(subject)}</p>${html}` };
}

module.exports = { buildLockEmail, formatLockedAt, userLink };
