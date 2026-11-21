const { sapKey } = require('../sapKey');

// MATDOC fields; all verified in the data dictionary of the dev sandbox on 2026-11-21 (WORKSTATUS.md, step 3).
const DOC_FIELDS = ['MBLNR', 'MJAHR', 'ZEILE', 'BWART', 'USNAM', 'ERFMG', 'MENGE'];

/** RFC_READ_TABLE returns quantities as text, a negative one with a trailing minus. */
function _quantity(value) {
  const text = String(value ?? '').trim();
  const number = parseFloat(text.endsWith('-') ? `-${text.slice(0, -1)}` : text);
  return Number.isFinite(number) ? number : 0;
}

/**
 * 101 documents of a delivery item, newest first, one entry per document with the posting user and the
 * quantities summed over its lines. RFC_READ_TABLE returns rows in no fixed order and can repeat a line.
 */
async function _read101Docs(adapter, delivery, item, extraWhere = []) {
  const vbeln = sapKey(delivery, 'vbeln').padStart(10, '0');
  const posnr = sapKey(item, 'posnr').padStart(6, '0');
  const rows = await adapter.rfc.readTable('MATDOC', DOC_FIELDS, [
    `VBELN_IM = '${vbeln}'`, `AND VBELP_IM = '${posnr}'`, `AND BWART = '101'`, ...extraWhere
  ]);
  const docs = new Map();
  for (const row of rows || []) {
    const key = `${row.MJAHR}/${row.MBLNR}`;
    if (!docs.has(key)) docs.set(key, { ...row, _lines: new Map() });
    docs.get(key)._lines.set(String(row.ZEILE ?? ''), row);
  }
  return [...docs.keys()].sort().reverse().map((key) => {
    const { _lines, ...doc } = docs.get(key);
    const lines = [..._lines.values()];
    return { ...doc, EntryQty: lines.reduce((sum, l) => sum + _quantity(l.ERFMG), 0), BaseQty: lines.reduce((sum, l) => sum + _quantity(l.MENGE), 0) };
  });
}

const docKey = (r) => `${r.MJAHR}/${r.MBLNR}`;

/** Document keys stored on the attempt before the post, or null when no usable baseline was stored. */
function _baselineOf(attempt) {
  try {
    const keys = JSON.parse(attempt.BaselineDocs);
    return Array.isArray(keys) ? new Set(keys) : null;
  } catch (_) {
    return null;
  }
}

/**
 * SAP logon users this application posts with: the RFC logon user and the user of the HTTP destination.
 * Empty when neither can be told (for example a Principal Propagation destination, where SAP records the end user).
 */
async function _postingUsers(adapter) {
  const users = new Set();
  const add = (name) => { const user = String(name || '').trim().toUpperCase(); if (user) users.add(user); };
  try { add((await adapter.rfc.resolveConnectionParams()).user); } catch (_) { /* not resolvable here */ }
  try { add((await adapter.client.resolveDestination()).username); } catch (_) { /* not resolvable here */ }
  return users;
}

const ambiguous = (reason) => ({ ambiguous: true, reason });
const sameQuantity = (a, b) => Math.abs(a - b) < 0.0005;

/**
 * Finds the 101 document of a receipt attempt whose outcome is unknown. SAP gives the document no reference
 * to this application, so a document counts as the attempt's only on all of this evidence:
 *   - it did not exist before the post (attempt.BaselineDocs),
 *   - it was posted by a logon user of this application (MATDOC-USNAM),
 *   - its quantity for the delivery item equals the attempt's quantity (ERFMG, or MENGE in base unit).
 * Exactly one such document -> that document. No document outside the baseline -> null (not posted so far).
 * Everything else -> { ambiguous: true, reason }: the attempt stays open and blocked. In particular a receipt
 * posted directly in SAP by someone else is never taken as this application's posting.
 * Searches from the day before the attempt because SAP's date can be behind the UTC date in createdAt.
 */
async function findReceiptForAttempt(adapter, attempt) {
  const from = new Date(new Date(attempt.createdAt).getTime() - 86400000).toISOString().slice(0, 10).replace(/-/g, '');
  const docs = await adapter._read101Docs(attempt.ReservationNo, attempt.ReservationItem, [`AND CPUDT >= '${from}'`]);
  if (!docs.length) return null;

  const baseline = _baselineOf(attempt);
  if (!baseline) {
    return ambiguous(`${docs.length} goods receipt document(s) exist in S/4HANA but no pre-post baseline was stored, so none can be attributed to this attempt`);
  }
  const fresh = docs.filter((r) => !baseline.has(docKey(r)));
  if (!fresh.length) return null;

  const quantity = Number(attempt.IssueQty);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return ambiguous(`${fresh.length} new goods receipt document(s) exist in S/4HANA but the attempt has no quantity to compare them with`);
  }
  const users = await adapter._postingUsers();
  if (!users.size) {
    return ambiguous(`${fresh.length} new goods receipt document(s) exist in S/4HANA but the SAP user this application posts with cannot be determined`);
  }
  const ours = fresh.filter((r) => users.has(String(r.USNAM || '').trim().toUpperCase())
    && (sameQuantity(r.EntryQty, quantity) || sameQuantity(r.BaseQty, quantity)));
  if (ours.length === 1) return { MaterialDocument: ours[0].MBLNR, MaterialDocumentYear: ours[0].MJAHR };
  return ambiguous(ours.length
    ? `${ours.length} new goods receipt documents match this attempt; it cannot be told which one belongs to it`
    : `${fresh.length} new goods receipt document(s) exist in S/4HANA, but none was posted by this application's user with the attempt's quantity`);
}

module.exports = {
  docKey,
  _postingUsers,
  _read101Docs,
  findReceiptForAttempt
};
