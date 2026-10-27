'use strict';

const { RfcClient } = require('../RfcClient');
const { parseSapNumber } = require('../sapFacts');

/**
 * Quarantine labels from SAP: plants of the material document (MATDOC) for authorization, then the PDF rendered by the
 * RFC Z_MM_QUAR_LABEL_PDF (proposed in docs/abap/z_mm_quar_label.fugr.abap, interface in docs/zquaran-pdf-wrapper.md).
 * Read and render only — nothing is posted and nothing is sent to a printer.
 */
const FUNCTION_NAME = 'Z_MM_QUAR_LABEL_PDF';
// Rules of report ZMM_R_062 (docs/evidence/2026-10-26/zquaran/ZMM_R_062_F01.abap), replicated read-only for the
// app-drawn 4 x 6 label: quarantine storage types of the TO item (F01:78, :95) and the batch characteristics read
// for the label (internal ATINN, F01:154, :162, :295-313). Field names checked in DD03L (READ-ONLY, 2026-10-27).
const QUARANTINE_STORAGE_TYPES = ['920', '902'];
const ATINN = { names: ['0000000818', '0000000828'], retest: '0000000820', expiry: '9999999400' };
// Logon language of the RFC user, as in the other adapters' MAKT reads (the report uses SY-LANGU, F01:32)
const MAKT_LANGUAGE = 'E';

// EV_RESULT of Z_MM_QUAR_LABEL_PDF -> HTTP status
const RESULT_STATUS = {
  INVALID_INPUT: 400,
  NOT_FOUND: 404,
  NOT_AUTHORIZED: 403,
  NO_LABEL_ROWS: 404,
  FORM_ERROR: 502,
  EMPTY_PDF: 502
};

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * Validated, SAP-formatted keys. The document number is left-padded to 10 digits like other material document numbers
 * in this app (e.g. 4900050304); the year must be 4 digits; the optional text is at most 50 characters (P_TEXT CHAR50).
 */
function normalizeInput({ MaterialDocument, MaterialDocumentYear, Text }) {
  const doc = String(MaterialDocument ?? '').trim();
  const year = String(MaterialDocumentYear ?? '').trim();
  const text = String(Text ?? '').trim();
  if (!/^\d{1,10}$/.test(doc)) throw httpError(400, 'Material document must be up to 10 digits.');
  if (!/^\d{4}$/.test(year)) throw httpError(400, 'Material document year must be 4 digits.');
  if (text.length > 50) throw httpError(400, 'Text must be at most 50 characters.');
  if (/[\u0000-\u001f\u007f]/.test(text)) throw httpError(400, 'Text contains an unsupported character.');
  return { mblnr: doc.padStart(10, '0'), mjahr: year, text };
}

const sapDate = (v) => {
  const s = String(v ?? '').trim();
  return /^\d{8}$/.test(s) && s !== '00000000' ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : '';
};
// RFC_READ_TABLE quantity ("40.000", "5.000-") -> "40"; '' when unreadable
const quantity = (v) => {
  const n = parseSapNumber(v);
  return Number.isFinite(n) ? String(n) : '';
};
// The report's qty text: MENGE moved to TYPE p DECIMALS 2 (half up) and written as "120.00" (F01:177, :251-252)
const quantity2 = (v) => {
  const n = parseSapNumber(v);
  if (!Number.isFinite(n)) return '';
  const r = Math.round(Math.abs(n) * 100 + 1e-9) / 100;
  return `${n < 0 && r ? '-' : ''}${r.toFixed(2)}`;
};
const quote = (v) => `'${String(v).replace(/'/g, "''")}'`;
const key = (...parts) => parts.join('|');

/** EV_RESULT/EV_MESSAGE of either wrapper -> HTTP error unless OK. */
function assertResultOk(res, mblnr, mjahr) {
  const result = String(res.EV_RESULT || '').trim();
  const message = String(res.EV_MESSAGE || '').trim();
  if (result !== 'OK') {
    throw httpError(RESULT_STATUS[result] || 502, message || `SAP returned ${result || 'no result'} for ${mblnr}/${mjahr}.`);
  }
}

class QuarantineLabelAdapter {
  constructor(rfc = new RfcClient()) {
    this.rfc = rfc;
  }

  /** 503 (nothing called) unless TFDIR shows the function exists and is remote-enabled (FMODE 'R'). Cached once found. */
  async assertAvailable(name = FUNCTION_NAME) {
    this._available = this._available || new Set();
    if (this._available.has(name)) return;
    let rows;
    try {
      rows = await this.rfc.readTable('TFDIR', ['FUNCNAME', 'FMODE'], [`FUNCNAME = '${name}'`], 1);
    } catch (e) {
      throw httpError(503, `Cannot verify in SAP whether ${name} is available: ${e.message}`);
    }
    const fmode = rows.length ? String(rows[0].FMODE || '').trim() : null;
    if (fmode !== 'R') {
      throw httpError(503, `Quarantine labels are not available yet: the SAP interface ${name} is `
        + `${fmode === null ? 'not installed' : 'not remote-enabled'} on this system.`);
    }
    this._available.add(name);
  }

  /** Distinct plants of the material document (MATDOC fields MBLNR/MJAHR/WERKS, read live elsewhere in this app). */
  async documentPlants(mblnr, mjahr) {
    const rows = await this.rfc.readTable('MATDOC', ['WERKS'], [`MBLNR = '${mblnr}'`, `AND MJAHR = '${mjahr}'`]);
    return [...new Set(rows.map((r) => String(r.WERKS || '').trim().toUpperCase()).filter(Boolean))];
  }

  /** Plants of the document; 404 when unknown, 403 when any is outside allowedPlants (null = Admin, unrestricted). */
  async authorizedPlants(mblnr, mjahr, allowedPlants) {
    const plants = await this.documentPlants(mblnr, mjahr);
    if (plants.length === 0) throw httpError(404, `Material document ${mblnr}/${mjahr} not found.`);
    if (allowedPlants !== null) {
      const outside = plants.filter((p) => !(allowedPlants || []).includes(p));
      if (outside.length) throw httpError(403, `Material document ${mblnr}/${mjahr} includes plant(s) outside your authorization: ${outside.join(', ')}.`);
    }
    return plants;
  }

  /**
   * Label rows for the app's own label renderer, rebuilt in CAP from read-only table reads (no ABAP change; user
   * decision 2026-10-27). Same input and plant checks as generate(); LabelSize from resolveOutput (per-plant config).
   */
  async labelRows({ MaterialDocument, MaterialDocumentYear, Text, allowedPlants, resolveOutput }) {
    const { mblnr, mjahr, text } = normalizeInput({ MaterialDocument, MaterialDocumentYear, Text });
    const plants = await this.authorizedPlants(mblnr, mjahr, allowedPlants);
    const output = resolveOutput ? await resolveOutput(plants) : { formName: null, labelSize: null };
    const rows = await this.readLabelRows(mblnr, mjahr, text);
    if (!rows.length) throw httpError(404, `No quarantine label rows for material document ${mblnr}/${mjahr}.`);
    return { MaterialDocument: mblnr, MaterialDocumentYear: mjahr, LabelSize: output.labelSize, Rows: rows };
  }

  /**
   * The data part of ZMM_R_062_F01 with RFC_READ_TABLE: one label per TO item (LTAP) in a quarantine storage type for
   * the document's material/batch pairs. Differences from the report, all documented in docs/label/zquar-4x6-design.md:
   * MSEG is restricted to the year (as Z_MM_QUAR_LABEL_DATA); "first row" reads pick the lowest MSEG item and the
   * first row SAP returns; the label sort is matnr, charg, tanum, tapos (the report's second SORT is not stable).
   * shortcut: one RFC_READ_TABLE per material/batch pair, material, supplier and batch object; batch them with OR
   * lists if documents with many pairs get slow.
   */
  async readLabelRows(mblnr, mjahr, text) {
    const read = (table, fields, where) => this.rfc.readTable(table, fields, where);
    const mseg = (await read('MSEG', ['ZEILE', 'MATNR', 'CHARG', 'MENGE', 'MEINS', 'BUDAT_MKPF', 'VBELN_IM', 'LIFNR', 'HSDAT'],
      [`MBLNR = ${quote(mblnr)}`, `AND MJAHR = ${quote(mjahr)}`])).sort((a, b) => a.ZEILE.localeCompare(b.ZEILE));
    if (!mseg.length) return [];

    const pairs = [...new Map(mseg.map((m) => [key(m.MATNR, m.CHARG), m])).values()];
    // The report matches LTAP by inbound delivery when the first MSEG item has one, else by document number (WENUM)
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
    const objek = (c) => String(c.CUOBJ_BM).padStart(18, '0'); // |{ cuobj_bm ALPHA = IN WIDTH = 18 }| (F01:135)
    const ausp = [];
    for (const o of new Set(mch1.map(objek))) {
      const atinn = [...ATINN.names, ATINN.retest, ATINN.expiry].map((a) => `ATINN = ${quote(a)}`);
      ausp.push(...await read('AUSP', ['OBJEK', 'ATINN', 'ATWRT', 'DATE_FROM'],
        [`OBJEK = ${quote(o)}`, `AND ( ${atinn.slice(0, 2).join(' OR ')}`, `OR ${atinn.slice(2).join(' OR ')} )`]));
    }
    const value = (o, atinn, field) => (ausp.find((a) => a.OBJEK === o && a.ATINN === atinn) || {})[field] || '';

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
        MaterialDescription: makt.get(l.MATNR) || '',
        MaterialDocument: mblnr,
        PostingDate: sapDate(m.BUDAT_MKPF),
        Batch: batch ? batch.CHARG : '',
        SupplierBatch: batch ? batch.LICHA : '',
        SupplierName: suppliers.get(m.LIFNR) || '',
        // ATWRT of 818, then 828, joined and CONDENSEd (F01:295-306)
        BatchCharacteristics: o ? ATINN.names.map((a) => value(o, a, 'ATWRT')).join(' ').replace(/\s+/g, ' ').trim() : '',
        ManufacturingDate: sapDate(m.HSDAT),
        // Retest date when set, otherwise the expiry date (the report also says "Expiry Date" when both are empty)
        DateKind: retest ? 'RETEST' : 'EXPIRY',
        DateValue: retest || (o ? sapDate(value(o, ATINN.expiry, 'DATE_FROM')) : ''),
        PostedQuantity: m.MENGE !== undefined ? `${quantity2(m.MENGE)} ${m.MEINS}`.trim() : '',
        ContainerQuantity: quantity(l.VSOLM),
        Unit: l.MEINS,
        Container: `${seen.get(group)} OF ${totals.get(group)}`,
        StorageUnit: l.NLENR,
        Text: text
      };
    });
  }

  /**
   * allowedPlants: plantScope(user) — null for Admin (unrestricted), otherwise the user's plants; every plant of the
   * document must be in it before anything is rendered. resolveOutput(plants) -> { formName, labelSize } comes from the
   * CAP layer (per-plant BusinessConfig); IV_FORM is sent only when a form is configured, so without configuration the
   * call is the one the activated wrapper already accepts.
   */
  async generate({ MaterialDocument, MaterialDocumentYear, Text, allowedPlants, resolveOutput }) {
    const { mblnr, mjahr, text } = normalizeInput({ MaterialDocument, MaterialDocumentYear, Text });
    await this.assertAvailable();
    const plants = await this.authorizedPlants(mblnr, mjahr, allowedPlants);

    const output = resolveOutput ? await resolveOutput(plants) : { formName: null, labelSize: null };
    const params = { IV_MBLNR: mblnr, IV_MJAHR: mjahr, IV_TEXT: text };
    if (output.formName) params.IV_FORM = output.formName;
    const res = await this.rfc.call(FUNCTION_NAME, params);
    assertResultOk(res, mblnr, mjahr);
    const pdf = Buffer.isBuffer(res.EV_PDF) ? res.EV_PDF : Buffer.from(res.EV_PDF || '');
    // Never hand anything but a real PDF to the browser
    if (pdf.length < 5 || pdf.subarray(0, 5).toString('latin1') !== '%PDF-') {
      throw httpError(502, 'SAP did not return a PDF document.');
    }
    return {
      MaterialDocument: mblnr,
      MaterialDocumentYear: mjahr,
      LabelCount: Number(res.EV_LABEL_COUNT) || 0,
      FileName: `QuarantineLabels_${mblnr}_${mjahr}.pdf`,
      LabelSize: output.labelSize,
      PdfBase64: pdf.toString('base64')
    };
  }
}

module.exports = QuarantineLabelAdapter;
module.exports.normalizeInput = normalizeInput;
module.exports.FUNCTION_NAME = FUNCTION_NAME;
module.exports.QUARANTINE_STORAGE_TYPES = QUARANTINE_STORAGE_TYPES;
module.exports.ATINN = ATINN;
