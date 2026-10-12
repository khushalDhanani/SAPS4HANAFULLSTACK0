'use strict';

const { sapKey } = require('../sapKey');

/**
 * Confirmation state of a Transfer Order read from LTAP-PQUIT (per item), not from a message number.
 * true only when the TO has at least one item and every item carries PQUIT = 'X'.
 */
async function isToFullyConfirmed(rfc, lgnum, tanum) {
  const wh = sapKey(lgnum, 'lgnum');
  const to = sapKey(tanum, 'tanum').padStart(10, '0');
  const rows = await rfc.readTable('LTAP', ['TAPOS', 'PQUIT'], [`LGNUM = '${wh}'`, `AND TANUM = '${to}'`]);
  return Array.isArray(rows) && rows.length > 0 && rows.every((r) => String(r.PQUIT || '').trim() === 'X');
}

/**
 * Unconfirmed TO items that already exist for a TR (optionally one TR item):
 * LTAK by LGNUM + TBNUM (the TR number lives on the TO header, LTAP has no TBNUM), then LTAP items with PQUIT blank.
 * Returns [{ TANUM, TAPOS, TBPOS }].
 */
async function findUnconfirmedToItems(rfc, lgnum, tbnum, tbpos = '') {
  const wh = sapKey(lgnum, 'lgnum');
  const tr = sapKey(tbnum, 'tbnum').padStart(10, '0');
  const pos = tbpos ? sapKey(tbpos, 'tbpos').padStart(4, '0') : '';
  const heads = await rfc.readTable('LTAK', ['TANUM', 'KQUIT'], [`LGNUM = '${wh}'`, `AND TBNUM = '${tr}'`]);
  const open = [];
  for (const h of heads || []) {
    if (String(h.KQUIT || '').trim() === 'X') continue;
    const where = [`LGNUM = '${wh}'`, `AND TANUM = '${h.TANUM}'`, "AND PQUIT = ''"];
    if (pos) where.push(`AND TBPOS = '${pos}'`);
    const items = await rfc.readTable('LTAP', ['TAPOS', 'TBPOS'], where);
    for (const i of items || []) open.push({ TANUM: h.TANUM, TAPOS: i.TAPOS, TBPOS: i.TBPOS });
  }
  return open;
}

module.exports = { isToFullyConfirmed, findUnconfirmedToItems };
