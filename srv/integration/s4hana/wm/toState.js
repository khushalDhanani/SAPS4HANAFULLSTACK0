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

/**
 * A TR that SAP completed (LTBK-STATU 'E') without any TO header in LTAK (live 241 run 2026-10-19: Z_WM_TO_CREATE_FROM_TR
 * raised XFELD_WRONG and SAP still closed TR W01/0001000885). Such a TR cannot be retried at LT04; only a new TR helps.
 * READ-ONLY. Returns false when the TR is open, partially processed, or has any TO (confirmed or not).
 */
async function isTrClosedWithoutTo(rfc, lgnum, tbnum) {
  try {
    const wh = sapKey(lgnum, 'lgnum');
    const tr = sapKey(tbnum, 'tbnum').padStart(10, '0');
    const heads = await rfc.readTable('LTBK', ['STATU'], [`LGNUM = '${wh}'`, `AND TBNUM = '${tr}'`], 1);
    if (!Array.isArray(heads) || !heads.length || String(heads[0].STATU || '').trim() !== 'E') return false;
    const tos = await rfc.readTable('LTAK', ['TANUM'], [`LGNUM = '${wh}'`, `AND TBNUM = '${tr}'`], 1);
    return !(Array.isArray(tos) && tos.length);
  } catch (_) {
    return false;
  }
}

/**
 * D20 (live 241, 2026-10-19): SAP can complete a TR without a TO when the PP-WM quantity reduction finds the open quantity
 * already in the destination bin (L3 361 "Open quantity reduced by available stock", L3 362 "Transfer requirement will be
 * updated"); the Z wrapper then misreports it as XFELD_WRONG. READ-ONLY LTBK + LTBP. Returns { nltyp, nlpla } when the TR
 * header is completed (STATU 'E') and every item is delivery-complete (ELIKZ 'X') with no TO number, else null.
 */
async function trCompletedWithoutTo(rfc, lgnum, tbnum) {
  const wh = sapKey(lgnum, 'lgnum');
  const tr = sapKey(tbnum, 'tbnum').padStart(10, '0');
  const where = [`LGNUM = '${wh}'`, `AND TBNUM = '${tr}'`];
  const heads = await rfc.readTable('LTBK', ['STATU', 'NLTYP', 'NLPLA'], where, 1);
  if (!Array.isArray(heads) || !heads.length || String(heads[0].STATU || '').trim() !== 'E') return null;
  const items = await rfc.readTable('LTBP', ['TBPOS', 'ELIKZ', 'TANUM'], where);
  const noTo = Array.isArray(items) && items.length > 0 &&
    items.every((i) => String(i.ELIKZ || '').trim() === 'X' && /^0*$/.test(String(i.TANUM || '').trim()));
  return noTo ? { nltyp: String(heads[0].NLTYP || '').trim(), nlpla: String(heads[0].NLPLA || '').trim() } : null;
}

/**
 * Pre-TO guard for SAP's PP-WM quantity reduction (live 241, 2026-10-19, TR W01/0001000885):
 * for a reservation-linked TR (LTBK-RSNUM) with a destination bin (NLTYP/NLPLA) and T331-MRAUS blank, SAPML03T
 * d0131_tb_bearbeiten takes the stock already in that bin for the item's plant + storage location (L_WMPP_MAT_BIN_SITUATION:
 * FVMNG = LQUA VERME + EINME - bin reservations) and, when it covers the open quantity, completes the TR WITHOUT a TO
 * (L3 361 / 362) - the TR is then unusable. READ-ONLY. Returns the first covered item, or null when SAP would create a TO.
 * shortcut: bin reservations (RESB with LGNUM/LGTYP/LGPLA) are not subtracted; when any exist the guard stays silent and
 * lets SAP decide - upgrade to the supply-area logic of LLCPPF2G if such reservations ever appear on a staging bin.
 */
async function stagedStockCoveringTr(rfc, lgnum, tbnum) {
  const wh = sapKey(lgnum, 'lgnum');
  const tr = sapKey(tbnum, 'tbnum').padStart(10, '0');
  const where = [`LGNUM = '${wh}'`, `AND TBNUM = '${tr}'`];
  const heads = await rfc.readTable('LTBK', ['RSNUM', 'NLTYP', 'NLPLA'], where, 1);
  const h = heads?.[0];
  const rsnum = String(h?.RSNUM || '').trim(), nltyp = String(h?.NLTYP || '').trim(), nlpla = String(h?.NLPLA || '').trim();
  if (!h || /^0*$/.test(rsnum) || !nltyp || !nlpla) return null;
  const t331 = await rfc.readTable('T331', ['MRAUS'], [`LGNUM = '${wh}'`, `AND LGTYP = '${nltyp}'`], 1);
  if (String(t331?.[0]?.MRAUS || '').trim() === 'X') return null;
  const items = await rfc.readTable('LTBP', ['TBPOS', 'MATNR', 'WERKS', 'LGORT', 'MENGE', 'TAMEN', 'MEINS', 'ELIKZ'], where);
  for (const i of items || []) {
    if (String(i.ELIKZ || '').trim() === 'X') continue;
    const open = Number(i.MENGE || 0) - Number(i.TAMEN || 0);
    if (!(open > 0)) continue;
    const binWhere = [`LGNUM = '${wh}'`, `AND LGTYP = '${nltyp}'`, `AND LGPLA = '${nlpla}'`, `AND MATNR = '${i.MATNR}'`, `AND WERKS = '${i.WERKS}'`, `AND LGORT = '${i.LGORT}'`];
    const quants = await rfc.readTable('LQUA', ['LENUM', 'VERME', 'EINME'], binWhere);
    const stock = (quants || []).reduce((sum, q) => sum + Number(q.VERME || 0) + Number(q.EINME || 0), 0);
    if (stock < open) continue;
    const reserved = await rfc.readTable('RESB', ['RSNUM'], [`LGNUM = '${wh}'`, `AND LGTYP = '${nltyp}'`, `AND LGPLA = '${nlpla}'`, `AND MATNR = '${i.MATNR}'`], 1);
    if (Array.isArray(reserved) && reserved.length) continue;
    return {
      tbpos: i.TBPOS, material: i.MATNR, plant: i.WERKS, storageLocation: i.LGORT, open, unit: String(i.MEINS || '').trim(),
      bin: `${nltyp}/${nlpla}`, stock, storageUnits: (quants || []).map((q) => String(q.LENUM || '').trim().replace(/^0+/, '')).filter(Boolean)
    };
  }
  return null;
}

/**
 * Builds Handling Unit confirmation table (T_LTAP_CONF_HU) for a Transfer Order.
 * When LTAP items involve Handling Units (VLENR is present), L_TO_CONFIRM requires
 * T_LTAP_CONF_HU with complete HU withdrawal (HUENT = 'X') to avoid error L3 848
 * ("TO item ... does not contain a destination handling unit").
 */
async function getHuConfirmationItems(rfc, lgnum, tanum) {
  const wh = sapKey(lgnum, 'lgnum');
  const to = sapKey(tanum, 'tanum').padStart(10, '0');
  const ltapItems = await rfc.readTable(
    'LTAP',
    ['TAPOS', 'VLENR', 'NLENR', 'NSOLA', 'ALTME', 'FHUTA'],
    [`LGNUM = '${wh}'`, `AND TANUM = '${to}'`]
  );

  const huItems = (ltapItems || []).filter((item) => {
    const vlenr = String(item.VLENR || '').trim();
    const fhuta = String(item.FHUTA || '').trim();
    return Boolean(vlenr && (fhuta !== '' || vlenr !== ''));
  });

  if (!huItems.length) return [];

  return huItems.map((item) => {
    const vlenr = String(item.VLENR || '').trim();
    const nlenr = String(item.NLENR || '').trim() || vlenr;
    const qty = Number(item.NSOLA || 0);
    return {
      TANUM: to,
      TAPOS: item.TAPOS,
      VONHU: vlenr,
      NACHU: nlenr,
      HUENT: 'X',
      MENGA: qty.toFixed(3),
      ALTME: String(item.ALTME || '').trim()
    };
  });
}

/**
 * Parses SAP storage type search errors (L3 007 / "Data for storage type search is not defined")
 * and produces a detailed, actionable message identifying the exact customizing key in T334T
 * and the specific SPRO navigation path required to resolve it.
 */
function mapStorageTypeSearchError(rawMsg, lgnum, mvt = '') {
  if (!rawMsg) return rawMsg;
  const wh = (lgnum || '').trim().toUpperCase() || 'W01';
  const match = String(rawMsg).match(
    /(?:Data for storage type search is not defined|Daten zur Lagertypfindung sind nicht definiert)\s*\(([^)]*)\)/i
  );
  if (!match) return rawMsg;

  const tokens = match[1].trim().split(/\s+/).filter(Boolean);
  const op = tokens[0] || 'A';
  const indicator = tokens[1] || '(blank)';
  const opText = op === 'A' ? 'Stock Removal' : (op === 'E' ? 'Stock Placement' : op);
  const sproStrategy = op === 'A' ? 'Stock Removal Strategies' : 'Stock Placement Strategies';
  const extra = [];
  if (tokens[2]) extra.push(`Stock Category: '${tokens[2]}'`);
  if (tokens[3]) extra.push(`Special Stock: '${tokens[3]}'`);
  const extraStr = extra.length ? `, ${extra.join(', ')}` : '';

  return `Data for storage type search is not defined in warehouse ${wh} for WM movement type ${mvt || '311'}: missing customizing key in table T334T (Warehouse: ${wh}, Operation: ${op} [${opText}], Storage Type Indicator: '${indicator}'${extraStr}). Maintain search sequence in SPRO: Logistics Execution > Warehouse Management > Strategies > ${sproStrategy} > Determine Storage Type Search.`;
}

module.exports = { isToFullyConfirmed, findUnconfirmedToItems, isTrClosedWithoutTo, trCompletedWithoutTo, stagedStockCoveringTr, getHuConfirmationItems, mapStorageTypeSearchError };
