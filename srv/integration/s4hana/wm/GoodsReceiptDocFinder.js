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

/**
 * The 101 document that may belong to a receipt attempt whose outcome is unknown, or null.
 * shortcut: a same-day partial receipt also matches, so the attempt may name the wrong document; it never
 * allows a double post, because a match only ends the block. Store a pre-post baseline on the attempt to be exact.
 * Searches from the day before the attempt because SAP's date can be behind the UTC date in createdAt.
 */
async function findReceiptForAttempt(adapter, attempt) {
  const from = new Date(new Date(attempt.createdAt).getTime() - 86400000).toISOString().slice(0, 10).replace(/-/g, '');
  const [latest] = await adapter._read101Docs(attempt.ReservationNo, attempt.ReservationItem, [`AND CPUDT >= '${from}'`]);
  return latest ? { MaterialDocument: latest.MBLNR, MaterialDocumentYear: latest.MJAHR } : null;
}

module.exports = {
  _read101Docs,
  findReceiptForAttempt
};
