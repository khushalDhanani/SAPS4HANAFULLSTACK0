'use strict';

const { sapKey } = require('../sapKey');
const {
  QUARANTINE_STORAGE_TYPES,
  ATINN,
  MAKT_LANGUAGE,
  httpError,
  sapDate,
  quantity,
  quantity2,
  quote,
  key,
  GR_MOVEMENT_TYPE,
  LIST_MAX_ITEMS,
  LOOKUP_CHUNK,
  normalizeListInput,
  orLines,
} = require('./QuarantineLabelUtils');

/**
 * Distinct plants of the material document (MATDOC fields MBLNR/MJAHR/WERKS).
 */
async function documentPlants(rfc, mblnr, mjahr) {
  const cleanMblnr = sapKey(mblnr, 'mblnr', 'Material Document number');
  const cleanMjahr = sapKey(mjahr, 'mjahr', 'Material Document year');
  const rows = await rfc.readTable('MATDOC', ['WERKS'], [`MBLNR = '${cleanMblnr}'`, `AND MJAHR = '${cleanMjahr}'`]);
  return [...new Set(rows.map((r) => String(r.WERKS || '').trim().toUpperCase()).filter(Boolean))];
}

/**
 * The data part of ZMM_R_062_F01 with RFC_READ_TABLE: one label per TO item (LTAP) in a quarantine storage type for
 * the document's material/batch pairs.
 */
async function readLabelRows(rfc, mblnr, mjahr, text) {
  const read = (table, fields, where) => rfc.readTable(table, fields, where);
  const mseg = (await read('MSEG', ['ZEILE', 'MATNR', 'CHARG', 'MENGE', 'MEINS', 'BUDAT_MKPF', 'VBELN_IM', 'LIFNR', 'HSDAT'],
    [`MBLNR = ${quote(mblnr)}`, `AND MJAHR = ${quote(mjahr)}`])).sort((a, b) => a.ZEILE.localeCompare(b.ZEILE));
  if (!mseg.length) return [];

  let preparedBy = '';
  let sapInwNo = '';
  try {
    const mkpf = await read('MKPF', ['USNAM', 'XBLNR', 'LE_VBELN', 'FRBNR', 'BKTXT'], [`MBLNR = ${quote(mblnr)}`, `AND MJAHR = ${quote(mjahr)}`]);
    if (mkpf && mkpf.length) {
      if (mkpf[0].USNAM) {
        preparedBy = mkpf[0].USNAM.trim();
      }
      sapInwNo = (mkpf[0].XBLNR || mkpf[0].LE_VBELN || mkpf[0].FRBNR || mkpf[0].BKTXT || '').trim();
    }
  } catch {
    preparedBy = '';
    sapInwNo = '';
  }

  const inwardNo = text || sapInwNo || String(mseg[0].VBELN_IM || '').trim();

  const qalsMap = new Map();
  try {
    const qalsRows = await read('QALS', ['PRUEFLOS', 'MBLNR', 'MJAHR', 'ZEILE', 'MATNR', 'CHARG'], [
      `MBLNR = ${quote(mblnr)}`,
      `AND MJAHR = ${quote(mjahr)}`,
    ]);
    qalsRows.forEach((q) => {
      const lot = String(q.PRUEFLOS || '').trim();
      if (lot) {
        if (q.MATNR && q.CHARG) qalsMap.set(key(q.MATNR, q.CHARG), lot);
        if (q.ZEILE) qalsMap.set(`ITEM_${q.ZEILE}`, lot);
        if (q.MATNR) qalsMap.set(`MAT_${q.MATNR}`, lot);
        if (!qalsMap.has('DEFAULT')) qalsMap.set('DEFAULT', lot);
      }
    });
  } catch {
    // QALS not configured or read denied
  }

  const pairs = [...new Map(mseg.map((m) => [key(m.MATNR, m.CHARG), m])).values()];
  const vbeln = mseg[0].VBELN_IM;
  const vltyp = `AND ( ${QUARANTINE_STORAGE_TYPES.map((t) => `VLTYP = ${quote(t)}`).join(' OR ')} )`;
  const ltap = new Map();
  const mch1 = [];
  for (const p of pairs) {
    const items = await read('LTAP', ['LGNUM', 'TANUM', 'TAPOS', 'MATNR', 'CHARG', 'VSOLM', 'MEINS', 'NLENR'], [
      `MATNR = ${quote(p.MATNR)}`, `AND CHARG = ${quote(p.CHARG)}`,
      vbeln ? `AND VBELN = ${quote(vbeln)}` : `AND WENUM = ${quote(mblnr)}`, vltyp]);
    items.forEach((i) => ltap.set(key(i.LGNUM, i.TANUM, i.TAPOS), i));
    mch1.push(...await read('MCH1', ['MATNR', 'CHARG', 'CUOBJ_BM', 'LICHA'], [`MATNR = ${quote(p.MATNR)}`, `AND CHARG = ${quote(p.CHARG)}`]));
  }
  if (!ltap.size) return [];

  const materials = new Map();
  for (const matnr of new Set([...ltap.values()].map((item) => item.MATNR))) {
    const [master] = await read('MARA', ['MATNR'], [`MATNR = ${quote(matnr)}`]);
    if (!master || master.MATNR !== matnr) {
      throw httpError(404, `Material master record not found for label material ${matnr}.`);
    }
    materials.set(matnr, master.MATNR);
  }

  const makt = new Map();
  for (const matnr of new Set(mseg.map((m) => m.MATNR))) {
    const [row] = await read('MAKT', ['MAKTX'], [`MATNR = ${quote(matnr)}`, `AND SPRAS = ${quote(MAKT_LANGUAGE)}`]);
    makt.set(matnr, row ? row.MAKTX : '');
  }
  const suppliers = new Map();
  for (const lifnr of new Set(mseg.map((m) => m.LIFNR).filter(Boolean))) {
    const [row] = await read('BUT000', ['NAME_ORG1'], [`PARTNER = ${quote(lifnr)}`]);
    suppliers.set(lifnr, row ? row.NAME_ORG1 : '');
  }
  const objek = (c) => String(c.CUOBJ_BM).padStart(18, '0');
  const ausp = [];
  for (const o of new Set(mch1.map(objek))) {
    const atinn = [...ATINN.names, ATINN.retest, ATINN.expiry].map((a) => `ATINN = ${quote(a)}`);
    ausp.push(...await read('AUSP', ['OBJEK', 'ATINN', 'ATWRT', 'DATE_FROM'],
      [`OBJEK = ${quote(o)}`, `AND ( ${atinn.slice(0, 2).join(' OR ')}`, `OR ${atinn.slice(2).join(' OR ')} )`]));
  }
  const value = (o, atinnCode, field) => (ausp.find((a) => a.OBJEK === o && a.ATINN === atinnCode) || {})[field] || '';

  const sorted = [...ltap.values()].sort((a, b) => a.MATNR.localeCompare(b.MATNR) || a.CHARG.localeCompare(b.CHARG)
    || a.TANUM.localeCompare(b.TANUM) || a.TAPOS.localeCompare(b.TAPOS));
  const totals = new Map();
  sorted.forEach((l) => totals.set(key(l.MATNR, l.CHARG), (totals.get(key(l.MATNR, l.CHARG)) || 0) + 1));
  const seen = new Map();
  return sorted.map((l) => {
    const group = key(l.MATNR, l.CHARG);
    seen.set(group, (seen.get(group) || 0) + 1);
    const m = mseg.find((x) => x.MATNR === l.MATNR && x.CHARG === l.CHARG) || {};
    const batch = mch1.find((c) => c.CHARG === l.CHARG);
    const o = batch ? objek(batch) : null;
    const retest = o ? sapDate(value(o, ATINN.retest, 'DATE_FROM')) : '';
    return {
      Material: materials.get(l.MATNR),
      MaterialDescription: makt.get(l.MATNR) || '',
      MaterialDocument: mblnr,
      PostingDate: sapDate(m.BUDAT_MKPF),
      Batch: batch ? batch.CHARG : '',
      SupplierBatch: batch ? batch.LICHA : '',
      SupplierName: suppliers.get(m.LIFNR) || '',
      BatchCharacteristics: o ? ATINN.names.map((a) => value(o, a, 'ATWRT')).join(' ').replace(/\s+/g, ' ').trim() : '',
      ManufacturingDate: sapDate(m.HSDAT),
      DateKind: retest ? 'RETEST' : 'EXPIRY',
      DateValue: retest || (o ? sapDate(value(o, ATINN.expiry, 'DATE_FROM')) : ''),
      PostedQuantity: m.MENGE !== undefined ? `${quantity2(m.MENGE)} ${m.MEINS}`.trim() : '',
      ContainerQuantity: quantity(l.VSOLM),
      Unit: l.MEINS,
      Container: `${seen.get(group)} of ${totals.get(group)}`,
      StorageUnit: l.NLENR,
      Text: inwardNo,
      InwardNo: inwardNo,
      PreparedBy: preparedBy,
      InspectionLot: qalsMap.get(group) || (m.ZEILE ? qalsMap.get(`ITEM_${m.ZEILE}`) : '') || qalsMap.get(`MAT_${l.MATNR}`) || '',
    };
  });
}

/**
 * keyField -> valueField for distinct non-empty keys, read in chunks with OR lines.
 */
async function lookup(rfc, table, keyField, valueField, keys, prefix) {
  const out = new Map();
  const distinct = [...new Set(keys.filter(Boolean))];
  for (let i = 0; i < distinct.length; i += LOOKUP_CHUNK) {
    const lines = orLines(prefix.trim(), keyField, distinct.slice(i, i + LOOKUP_CHUNK));
    (await rfc.readTable(table, [keyField, valueField], lines)).forEach((r) => {
      if (!out.has(r[keyField])) out.set(r[keyField], r[valueField]);
    });
  }
  return out;
}

/**
 * Goods-receipt documents (movement type 101) of one plant, newest first.
 */
async function listDocuments(rfc, { allowedPlants, ...input }) {
  const q = normalizeListInput(input);
  if (Array.isArray(allowedPlants) && !allowedPlants.includes(q.plant)) {
    throw httpError(403, `You are not authorized for plant ${q.plant}.`);
  }
  const sap = (d) => d.replace(/-/g, '');
  const where = [`BWART = ${quote(GR_MOVEMENT_TYPE)}`, `AND WERKS = ${quote(q.plant)}`].concat(q.mblnr
    ? [`AND MBLNR = ${quote(q.mblnr)}`, `AND MJAHR = ${quote(q.mjahr)}`]
    : [`AND BUDAT_MKPF BETWEEN ${quote(sap(q.from))} AND ${quote(sap(q.to))}`]);
  const items = await rfc.readTable('MSEG', ['MBLNR', 'MJAHR', 'ZEILE', 'MATNR', 'CHARG', 'LIFNR', 'BUDAT_MKPF'],
    where, LIST_MAX_ITEMS + 1);
  const more = items.length > LIST_MAX_ITEMS;

  const docs = new Map();
  items.slice(0, LIST_MAX_ITEMS).forEach((m) => {
    const k = key(m.MBLNR, m.MJAHR);
    const first = docs.get(k);
    if (!first || m.ZEILE < first.ZEILE) docs.set(k, m);
  });
  const firsts = [...docs.values()];
  const makt = await lookup(rfc, 'MAKT', 'MATNR', 'MAKTX', firsts.map((m) => m.MATNR), `SPRAS = ${quote(MAKT_LANGUAGE)} AND`);
  const names = await lookup(rfc, 'BUT000', 'PARTNER', 'NAME_ORG1', firsts.map((m) => m.LIFNR), '');

  const documents = firsts.map((m) => ({
    MaterialDocument: m.MBLNR,
    MaterialDocumentYear: m.MJAHR,
    PostingDate: sapDate(m.BUDAT_MKPF),
    Plant: q.plant,
    Material: m.MATNR,
    MaterialDescription: makt.get(m.MATNR) || '',
    Batch: m.CHARG,
    SupplierName: names.get(m.LIFNR) || '',
  })).sort((a, b) => b.PostingDate.localeCompare(a.PostingDate) || b.MaterialDocument.localeCompare(a.MaterialDocument));
  return { Plant: q.plant, DateFrom: q.from || null, DateTo: q.to || null, More: more, Documents: documents };
}

module.exports = {
  documentPlants,
  readLabelRows,
  listDocuments,
  lookup,
};
