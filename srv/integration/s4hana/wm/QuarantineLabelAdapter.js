'use strict';

const { RfcClient } = require('../RfcClient');
const {
  FUNCTION_NAME,
  ATINN,
  LIST_MAX_ITEMS,
  httpError,
  normalizeInput,
  normalizeListInput,
  assertResultOk,
} = require('./QuarantineLabelUtils');
const {
  documentPlants,
  readLabelRows,
  listDocuments,
  lookup,
} = require('./QuarantineLabelDataReader');

/**
 * Quarantine labels from SAP: plants of the material document (MATDOC) for authorization, then the PDF rendered by the
 * RFC Z_MM_QUAR_LABEL_PDF.
 */
class QuarantineLabelAdapter {
  constructor(rfc = new RfcClient()) {
    this.rfc = rfc;
  }

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

  async documentPlants(mblnr, mjahr) {
    return documentPlants(this.rfc, mblnr, mjahr);
  }

  async assertAcceptsForm(formName) {
    if (this._acceptsForm) return;
    let iface;
    try {
      iface = await this.rfc.call('RFC_GET_FUNCTION_INTERFACE', { FUNCNAME: FUNCTION_NAME, LANGUAGE: 'E' });
    } catch (e) {
      throw httpError(503, `Cannot verify in SAP whether ${FUNCTION_NAME} accepts a form name: ${e.message}`);
    }
    const accepts = (iface.PARAMS || []).some((p) => String(p.PARAMCLASS || '').trim() === 'I' && String(p.PARAMETER || '').trim() === 'IV_FORM');
    if (!accepts) {
      throw httpError(409, `Form ${formName} is configured for this plant, but the SAP interface ${FUNCTION_NAME} does not accept `
        + 'a form name (IV_FORM) yet. Nothing was printed.');
    }
    this._acceptsForm = true;
  }

  async authorizedPlants(mblnr, mjahr, allowedPlants) {
    const plants = await this.documentPlants(mblnr, mjahr);
    if (plants.length === 0) throw httpError(404, `Material document ${mblnr}/${mjahr} not found.`);
    if (allowedPlants !== null) {
      const outside = plants.filter((p) => !(allowedPlants || []).includes(p));
      if (outside.length) throw httpError(403, `Material document ${mblnr}/${mjahr} includes plant(s) outside your authorization: ${outside.join(', ')}.`);
    }
    return plants;
  }

  async labelRows({ MaterialDocument, MaterialDocumentYear, Text, allowedPlants, resolveOutput }) {
    const { mblnr, mjahr, text } = normalizeInput({ MaterialDocument, MaterialDocumentYear, Text });
    const plants = await this.authorizedPlants(mblnr, mjahr, allowedPlants);
    const output = resolveOutput ? await resolveOutput(plants) : { formName: null, labelSize: null };
    const rows = await this.readLabelRows(mblnr, mjahr, text);
    if (!rows.length) throw httpError(404, `No quarantine label rows for material document ${mblnr}/${mjahr}.`);
    return { MaterialDocument: mblnr, MaterialDocumentYear: mjahr, LabelSize: output.labelSize, Rows: rows };
  }

  async readLabelRows(mblnr, mjahr, text) {
    return readLabelRows(this.rfc, mblnr, mjahr, text);
  }

  async listDocuments(input) {
    return listDocuments(this.rfc, input);
  }

  async lookup(table, keyField, valueField, keys, prefix) {
    return lookup(this.rfc, table, keyField, valueField, keys, prefix);
  }

  async generate({ MaterialDocument, MaterialDocumentYear, Text, allowedPlants, resolveOutput }) {
    const { mblnr, mjahr, text } = normalizeInput({ MaterialDocument, MaterialDocumentYear, Text });
    await this.assertAvailable();
    const plants = await this.authorizedPlants(mblnr, mjahr, allowedPlants);

    const output = resolveOutput ? await resolveOutput(plants) : { formName: null, labelSize: null };
    const params = { IV_MBLNR: mblnr, IV_MJAHR: mjahr, IV_TEXT: text };
    if (output.formName) {
      await this.assertAcceptsForm(output.formName);
      params.IV_FORM = output.formName;
    }
    const res = await this.rfc.call(FUNCTION_NAME, params);
    assertResultOk(res, mblnr, mjahr);
    const pdf = Buffer.isBuffer(res.EV_PDF) ? res.EV_PDF : Buffer.from(res.EV_PDF || '');
    if (pdf.length < 5 || pdf.subarray(0, 5).toString('latin1') !== '%PDF-') {
      throw httpError(502, 'SAP did not return a PDF document.');
    }
    return {
      MaterialDocument: mblnr,
      MaterialDocumentYear: mjahr,
      LabelCount: Number(res.EV_LABEL_COUNT) || 0,
      FileName: `QuarantineLabels_${mblnr}_${mjahr}.pdf`,
      LabelSize: output.labelSize,
      PdfBase64: pdf.toString('base64'),
    };
  }
}

module.exports = QuarantineLabelAdapter;
module.exports.normalizeInput = normalizeInput;
module.exports.normalizeListInput = normalizeListInput;
module.exports.LIST_MAX_ITEMS = LIST_MAX_ITEMS;
module.exports.FUNCTION_NAME = FUNCTION_NAME;
module.exports.ATINN = ATINN;
