'use strict';

const { RfcClient } = require('../RfcClient');
const {
  FUNCTION_NAME,
  LIST_MAX_DAYS,
  LIST_MAX_ITEMS,
  RESULT_STATUS,
  httpError,
  normalizeInput,
  normalizeListInput,
} = require('./MibLabelUtils');
const {
  readMibStickerData,
  listTransferOrders,
} = require('./MibLabelDataReader');

/**
 * Adapter for Material Issued To Batch Sticker (transaction ZMIB, report ZMM_R_067, Adobe form ZMM_AF_021).
 * Calls remote RFC wrapper Z_MM_MIB_LABEL_PDF for PDF rendering, and provides direct read-only SAP queries
 * against LTAK, LTAP, MAKT, AFPO for sticker item data extraction.
 */
class MibLabelAdapter {
  /**
   * @param {RfcClient} [rfc]
   */
  constructor(rfc = new RfcClient()) {
    this.rfc = rfc;
  }

  /**
   * Check whether the RFC wrapper function is available and remote-enabled in TFDIR.
   */
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
      throw httpError(503, `Material Issued Batch Sticker PDF is not available yet: the SAP interface ${name} is `
        + `${fmode === null ? 'not installed' : 'not remote-enabled'} on this system.`);
    }
    this._available.add(name);
  }

  /**
   * Generate Sticker PDF via RFC wrapper Z_MM_MIB_LABEL_PDF.
   */
  async generateMibSticker(input, options = {}) {
    const { lgnum, tanum, bname, bname1 } = normalizeInput(input);
    const allowedWarehouses = options?.allowedWarehouses ?? input?.allowedWarehouses ?? null;
    if (Array.isArray(allowedWarehouses) && !allowedWarehouses.includes(lgnum)) {
      throw httpError(403, `Warehouse ${lgnum} is outside your authorized warehouses.`);
    }
    await this.assertAvailable(FUNCTION_NAME);

    let res;
    try {
      res = await this.rfc.call(FUNCTION_NAME, {
        IV_LGNUM: lgnum,
        IV_TANUM: tanum,
        IV_BNAME: bname,
        IV_BNAME1: bname1,
      });
    } catch (e) {
      throw httpError(502, `SAP RFC ${FUNCTION_NAME} call failed: ${e.message}`);
    }

    const result = String(res && res.EV_RESULT || '').trim();
    const message = String(res && res.EV_MESSAGE || '').trim();
    if (result !== 'OK') {
      throw httpError(RESULT_STATUS[result] || 502, message || `SAP returned ${result || 'unknown error'} for TO ${tanum}.`);
    }

    const pdfBuffer = Buffer.isBuffer(res.EV_PDF)
      ? res.EV_PDF
      : typeof res.EV_PDF === 'string'
        ? Buffer.from(res.EV_PDF, 'binary')
        : null;

    if (!pdfBuffer || pdfBuffer.length === 0) {
      throw httpError(502, 'SAP returned an empty PDF document.');
    }

    return {
      WarehouseNumber: lgnum,
      TransferOrderNumber: tanum,
      LabelCount: Number(res.EV_LABEL_COUNT) || 1,
      FileName: `MIB-Sticker-${lgnum}-${tanum}.pdf`,
      PdfBase64: pdfBuffer.toString('base64'),
    };
  }

  async readMibStickerData(input, options = {}) {
    return readMibStickerData(this.rfc, input, options);
  }

  async listTransferOrders(input, options = {}) {
    return listTransferOrders(this.rfc, input, options);
  }
}

module.exports = {
  MibLabelAdapter,
  normalizeInput,
  normalizeListInput,
  LIST_MAX_DAYS,
  LIST_MAX_ITEMS,
  FUNCTION_NAME,
  RESULT_STATUS,
};
