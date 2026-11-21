const { sapKey } = require('../sapKey');

/**
 * 101 documents of a delivery item, newest first. RFC_READ_TABLE returns rows in no fixed order and can
 * repeat a document, so the last row is not the latest document.
 */
async function _read101Docs(adapter, delivery, item, extraWhere = []) {
  const vbeln = sapKey(delivery, 'vbeln').padStart(10, '0');
  const posnr = sapKey(item, 'posnr').padStart(6, '0');
  const rows = await adapter.rfc.readTable('MATDOC', ['MBLNR', 'MJAHR', 'ZEILE', 'BWART'], [
    `VBELN_IM = '${vbeln}'`, `AND VBELP_IM = '${posnr}'`, `AND BWART = '101'`, ...extraWhere
  ]);
  const unique = new Map((rows || []).map((r) => [`${r.MJAHR}/${r.MBLNR}`, r]));
  return [...unique.keys()].sort().reverse().map((key) => unique.get(key));
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
 * Finds the 101 document of a receipt attempt whose outcome is unknown, using the documents that existed
 * before the post (attempt.BaselineDocs) as evidence:
 *   - exactly one document outside the baseline  -> that document
 *   - no document outside the baseline           -> null (not posted so far)
 *   - no baseline but documents exist, or more than one new document -> { ambiguous: true, reason }
 * An earlier partial receipt is in the baseline, so it is never reported as this attempt's document.
 * Searches from the day before the attempt because SAP's date can be behind the UTC date in createdAt.
 */
async function findReceiptForAttempt(adapter, attempt) {
  const from = new Date(new Date(attempt.createdAt).getTime() - 86400000).toISOString().slice(0, 10).replace(/-/g, '');
  const docs = await adapter._read101Docs(attempt.ReservationNo, attempt.ReservationItem, [`AND CPUDT >= '${from}'`]);
  if (!docs.length) return null;

  const baseline = _baselineOf(attempt);
  if (!baseline) {
    return { ambiguous: true, reason: `${docs.length} goods receipt document(s) exist in S/4HANA but no pre-post baseline was stored, so none can be attributed to this attempt` };
  }
  const fresh = docs.filter((r) => !baseline.has(docKey(r)));
  if (fresh.length > 1) {
    return { ambiguous: true, reason: `${fresh.length} new goods receipt documents exist in S/4HANA since the attempt started; it cannot be told which one belongs to it` };
  }
  return fresh.length ? { MaterialDocument: fresh[0].MBLNR, MaterialDocumentYear: fresh[0].MJAHR } : null;
}

module.exports = {
  docKey,
  _read101Docs,
  findReceiptForAttempt
};
