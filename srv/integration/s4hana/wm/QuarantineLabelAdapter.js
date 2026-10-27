'use strict';

const { RfcClient } = require('../RfcClient');

/**
 * Quarantine labels from SAP: plants of the material document (MATDOC) for authorization, then the PDF rendered by the
 * RFC Z_MM_QUAR_LABEL_PDF (proposed in docs/abap/z_mm_quar_label.fugr.abap, interface in docs/zquaran-pdf-wrapper.md).
 * Read and render only — nothing is posted and nothing is sent to a printer.
 */
const FUNCTION_NAME = 'Z_MM_QUAR_LABEL_PDF';

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

class QuarantineLabelAdapter {
  constructor(rfc = new RfcClient()) {
    this.rfc = rfc;
  }

  /** 503 (nothing called) unless TFDIR shows the wrapper exists and is remote-enabled (FMODE 'R'). Cached once found. */
  async assertAvailable() {
    if (this._available) return;
    let rows;
    try {
      rows = await this.rfc.readTable('TFDIR', ['FUNCNAME', 'FMODE'], [`FUNCNAME = '${FUNCTION_NAME}'`], 1);
    } catch (e) {
      throw httpError(503, `Cannot verify in SAP whether ${FUNCTION_NAME} is available: ${e.message}`);
    }
    const fmode = rows.length ? String(rows[0].FMODE || '').trim() : null;
    if (fmode !== 'R') {
      throw httpError(503, `Quarantine labels are not available yet: the SAP interface ${FUNCTION_NAME} is `
        + `${fmode === null ? 'not installed' : 'not remote-enabled'} on this system.`);
    }
    this._available = true;
  }

  /** Distinct plants of the material document (MATDOC fields MBLNR/MJAHR/WERKS, read live elsewhere in this app). */
  async documentPlants(mblnr, mjahr) {
    const rows = await this.rfc.readTable('MATDOC', ['WERKS'], [`MBLNR = '${mblnr}'`, `AND MJAHR = '${mjahr}'`]);
    return [...new Set(rows.map((r) => String(r.WERKS || '').trim().toUpperCase()).filter(Boolean))];
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

    const plants = await this.documentPlants(mblnr, mjahr);
    if (plants.length === 0) throw httpError(404, `Material document ${mblnr}/${mjahr} not found.`);
    if (allowedPlants !== null) {
      const outside = plants.filter((p) => !(allowedPlants || []).includes(p));
      if (outside.length) throw httpError(403, `Material document ${mblnr}/${mjahr} includes plant(s) outside your authorization: ${outside.join(', ')}.`);
    }

    const output = resolveOutput ? await resolveOutput(plants) : { formName: null, labelSize: null };
    const params = { IV_MBLNR: mblnr, IV_MJAHR: mjahr, IV_TEXT: text };
    if (output.formName) params.IV_FORM = output.formName;
    const res = await this.rfc.call(FUNCTION_NAME, params);
    const result = String(res.EV_RESULT || '').trim();
    const message = String(res.EV_MESSAGE || '').trim();
    if (result !== 'OK') {
      throw httpError(RESULT_STATUS[result] || 502, message || `SAP returned ${result || 'no result'} for ${mblnr}/${mjahr}.`);
    }
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
