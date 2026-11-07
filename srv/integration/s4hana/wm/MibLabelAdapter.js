'use strict';

const { RfcClient } = require('../RfcClient');
const { parseSapNumber } = require('../sapFacts');

/**
 * Adapter for Material Issued To Batch Sticker (transaction ZMIB, report ZMM_R_067, Adobe form ZMM_AF_021).
 * Calls remote RFC wrapper Z_MM_MIB_LABEL_PDF for PDF rendering, and provides direct read-only SAP queries
 * against LTAK, LTAP, MAKT, AFPO for sticker item data extraction.
 */
const FUNCTION_NAME = 'Z_MM_MIB_LABEL_PDF';
const MAKT_LANGUAGE = 'E';

const RESULT_STATUS = {
  INVALID_INPUT: 400,
  NOT_FOUND: 404,
  NOT_AUTHORIZED: 403,
  FORM_ERROR: 502,
  EMPTY_PDF: 502
};

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function normalizeInput(input = {}) {
  const lgnum = String(input.WarehouseNumber ?? input.warehouseNumber ?? '').trim().toUpperCase();
  const tanumRaw = String(input.TransferOrderNumber ?? input.transferOrderNumber ?? '').trim();
  const bname = String(input.WeightedBy ?? input.weightedBy ?? '').trim().toUpperCase();
  const bname1 = String(input.CheckedBy ?? input.checkedBy ?? '').trim().toUpperCase();

  if (!lgnum || !/^[A-Z0-9]{1,3}$/.test(lgnum)) {
    throw httpError(400, 'Warehouse number must be 1 to 3 letters or digits.');
  }
  if (!tanumRaw || !/^\d{1,10}$/.test(tanumRaw)) {
    throw httpError(400, 'Transfer order number must be up to 10 digits.');
  }
  if (bname.length > 12) {
    throw httpError(400, 'Weighted by username must be at most 12 characters.');
  }
  if (bname1.length > 12) {
    throw httpError(400, 'Checked by username must be at most 12 characters.');
  }

  const tanum = tanumRaw.padStart(10, '0');
  return { lgnum, tanum, bname, bname1 };
}

const quote = (v) => `'${String(v).replace(/'/g, "''")}'`;

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
  async generateMibSticker(input) {
    const { lgnum, tanum, bname, bname1 } = normalizeInput(input);
    await this.assertAvailable(FUNCTION_NAME);

    let res;
    try {
      res = await this.rfc.call(FUNCTION_NAME, {
        IV_LGNUM: lgnum,
        IV_TANUM: tanum,
        IV_BNAME: bname,
        IV_BNAME1: bname1
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
      PdfBase64: pdfBuffer.toString('base64')
    };
  }

  /**
   * Read-only data assembly from SAP tables (LTAK, LTAP, MAKT, AFPO) matching report ZMM_R_067_F01.
   */
  async readMibStickerData(input) {
    const { lgnum, tanum, bname, bname1 } = normalizeInput(input);

    // Read TO Header (LTAK) and Items (LTAP)
    const ltakRows = await this.rfc.readTable(
      'LTAK',
      ['LGNUM', 'TANUM', 'TBNUM', 'BDATU', 'BENUM'],
      [`LGNUM = ${quote(lgnum)}`, `AND TANUM = ${quote(tanum)}`],
      1
    );

    if (!ltakRows || ltakRows.length === 0) {
      return [];
    }

    const header = ltakRows[0];
    const benum = String(header.BENUM || '').trim();
    const tbnum = String(header.TBNUM || '').trim();
    const bdatu = String(header.BDATU || '').trim();

    const ltapRows = await this.rfc.readTable(
      'LTAP',
      ['LGNUM', 'TANUM', 'TAPOS', 'MATNR', 'CHARG', 'NISTA', 'MEINS', 'VLENR'],
      [`LGNUM = ${quote(lgnum)}`, `AND TANUM = ${quote(tanum)}`]
    );

    if (!ltapRows || ltapRows.length === 0) {
      return [];
    }

    // Lookup batch from production order in AFPO if BENUM is populated
    let aufnrBatch = '';
    if (benum) {
      const aufnr = benum.replace(/^0+/, '').padStart(12, '0');
      try {
        const afpoRows = await this.rfc.readTable(
          'AFPO',
          ['AUFNR', 'CHARG'],
          [`AUFNR = ${quote(aufnr)}`],
          1
        );
        if (afpoRows && afpoRows.length > 0) {
          aufnrBatch = String(afpoRows[0].CHARG || '').trim();
        }
      } catch {
        // AFPO optional read
      }
    }

    // Collect distinct materials for MAKT lookup
    const matnrs = [...new Set(ltapRows.map((r) => String(r.MATNR || '').trim()).filter(Boolean))];
    const maktMap = new Map();
    if (matnrs.length > 0) {
      try {
        const whereMakt = matnrs.map((m, idx) => (idx === 0 ? `( MATNR = ${quote(m)}` : `OR MATNR = ${quote(m)}`)).concat([`) AND SPRAS = ${quote(MAKT_LANGUAGE)}`]);
        const maktRows = await this.rfc.readTable('MAKT', ['MATNR', 'MAKTX'], whereMakt);
        for (const row of maktRows) {
          maktMap.set(String(row.MATNR || '').trim(), String(row.MAKTX || '').trim());
        }
      } catch {
        // MAKT optional
      }
    }

    // Format formatted date yyyy-mm-dd
    const formattedDate = /^\d{8}$/.test(bdatu) && bdatu !== '00000000'
      ? `${bdatu.slice(0, 4)}-${bdatu.slice(4, 6)}-${bdatu.slice(6)}`
      : bdatu;

    return ltapRows.map((item) => {
      const matnr = String(item.MATNR || '').trim();
      const maktx = maktMap.get(matnr) || '';
      const charg = aufnrBatch || String(item.CHARG || '').trim();
      const nista = parseSapNumber(item.NISTA) || 0;
      const meins = String(item.MEINS || '').trim();
      const vlenr = String(item.VLENR || '').trim();

      return {
        Material: matnr,
        MaterialDescription: maktx,
        Batch: charg,
        TransferOrder: tanum,
        TransferRequirement: tbnum,
        RequirementNumber: benum,
        TransferDate: formattedDate,
        QuantityWithUom: `${nista} ${meins}`.trim(),
        StorageUnit: vlenr,
        WeightedBy: bname,
        CheckedBy: bname1
      };
    });
  }
}

module.exports = {
  MibLabelAdapter,
  normalizeInput,
  FUNCTION_NAME,
  RESULT_STATUS
};
