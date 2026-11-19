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
const LIST_MAX_DAYS = 31;
const LIST_MAX_ITEMS = 5000;
const LOOKUP_CHUNK = 50;

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

const isoDate = (v) => {
  const s = String(v ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null;
};

const sapDate = (v) => {
  const s = String(v ?? '').trim();
  return /^\d{8}$/.test(s) && s !== '00000000' ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : '';
};

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

/** Warehouse number and either one TO (number) or a transfer-date range of at most LIST_MAX_DAYS days. */
function normalizeListInput(input = {}) {
  const lgnum = String(input.WarehouseNumber ?? input.warehouseNumber ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9]{1,3}$/.test(lgnum)) {
    throw httpError(400, 'Warehouse number must be 1 to 3 letters or digits.');
  }
  const toRaw = String(input.TransferOrderNumber ?? input.transferOrderNumber ?? '').trim();
  if (toRaw) {
    if (!/^\d{1,10}$/.test(toRaw)) {
      throw httpError(400, 'Transfer order number must be up to 10 digits.');
    }
    return { lgnum, tanum: toRaw.padStart(10, '0') };
  }

  const from = isoDate(input.DateFrom ?? input.dateFrom);
  const to = isoDate(input.DateTo ?? input.dateTo);
  if (!from || !to) {
    throw httpError(400, 'Transfer order dates must be valid dates (yyyy-mm-dd).');
  }
  if (from > to) {
    throw httpError(400, 'The transfer order date "from" must not be after "to".');
  }
  if ((Date.parse(to) - Date.parse(from)) / 86400000 + 1 > LIST_MAX_DAYS) {
    throw httpError(400, `The transfer order date range must be at most ${LIST_MAX_DAYS} days.`);
  }
  return { lgnum, from, to };
}

const quote = (v) => `'${String(v).replace(/'/g, "''")}'`;

const orLines = (prefix, field, values) => values.map((v, i) => `${i ? 'OR' : `${prefix} (`} ${field} = ${quote(v)}`)
  .concat(')');

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

  /**
   * List Transfer Orders for a warehouse by date range or TO number (read-only).
   */
  async listTransferOrders(input) {
    const q = normalizeListInput(input);
    const sap = (d) => d.replace(/-/g, '');
    const where = [`LGNUM = ${quote(q.lgnum)}`].concat(q.tanum
      ? [`AND TANUM = ${quote(q.tanum)}`]
      : [`AND BDATU BETWEEN ${quote(sap(q.from))} AND ${quote(sap(q.to))}`]);

    const ltakRows = await this.rfc.readTable(
      'LTAK',
      ['LGNUM', 'TANUM', 'BDATU', 'TBNUM', 'BENUM', 'BWLVS', 'BNAME'],
      where,
      LIST_MAX_ITEMS + 1
    );

    const more = ltakRows.length > LIST_MAX_ITEMS;
    const headers = ltakRows.slice(0, LIST_MAX_ITEMS);

    if (headers.length === 0) {
      return {
        WarehouseNumber: q.lgnum,
        DateFrom: q.from || null,
        DateTo: q.to || null,
        More: false,
        TransferOrders: []
      };
    }

    const tanums = headers.map((h) => String(h.TANUM || '').trim()).filter(Boolean);
    const itemsMap = new Map();

    for (let i = 0; i < tanums.length; i += LOOKUP_CHUNK) {
      const chunk = tanums.slice(i, i + LOOKUP_CHUNK);
      const whereLtap = [`LGNUM = ${quote(q.lgnum)}`, 'AND'].concat(
        orLines('', 'TANUM', chunk)
      );
      const ltapChunk = await this.rfc.readTable(
        'LTAP',
        ['LGNUM', 'TANUM', 'TAPOS', 'MATNR', 'CHARG', 'NISTA', 'MEINS', 'VLENR'],
        whereLtap
      );
      for (const item of ltapChunk) {
        const t = String(item.TANUM || '').trim();
        const existing = itemsMap.get(t);
        if (!existing || Number(item.TAPOS) < Number(existing.TAPOS)) {
          itemsMap.set(t, item);
        }
      }
    }

    // Collect distinct materials for MAKT lookup
    const matnrs = [...new Set([...itemsMap.values()].map((r) => String(r.MATNR || '').trim()).filter(Boolean))];
    const maktMap = new Map();
    if (matnrs.length > 0) {
      for (let i = 0; i < matnrs.length; i += LOOKUP_CHUNK) {
        const chunk = matnrs.slice(i, i + LOOKUP_CHUNK);
        const whereMakt = [`SPRAS = ${quote(MAKT_LANGUAGE)}`, 'AND'].concat(
          orLines('', 'MATNR', chunk)
        );
        try {
          const maktChunk = await this.rfc.readTable('MAKT', ['MATNR', 'MAKTX'], whereMakt);
          for (const row of maktChunk) {
            maktMap.set(String(row.MATNR || '').trim(), String(row.MAKTX || '').trim());
          }
        } catch {
          // MAKT optional
        }
      }
    }

    // Collect production order requirement numbers for AFPO batch lookup if needed
    const benums = [...new Set(headers.map((h) => String(h.BENUM || '').trim()).filter(Boolean))];
    const afpoMap = new Map();
    if (benums.length > 0) {
      const aufnrs = benums.map((b) => b.replace(/^0+/, '').padStart(12, '0'));
      for (let i = 0; i < aufnrs.length; i += LOOKUP_CHUNK) {
        const chunk = aufnrs.slice(i, i + LOOKUP_CHUNK);
        const whereAfpo = orLines('', 'AUFNR', chunk);
        try {
          const afpoChunk = await this.rfc.readTable('AFPO', ['AUFNR', 'CHARG'], whereAfpo);
          for (const row of afpoChunk) {
            const rawAufnr = String(row.AUFNR || '').trim().replace(/^0+/, '');
            afpoMap.set(rawAufnr, String(row.CHARG || '').trim());
          }
        } catch {
          // AFPO optional
        }
      }
    }

    const transferOrders = headers.map((h) => {
      const tanum = String(h.TANUM || '').trim();
      const item = itemsMap.get(tanum) || {};
      const matnr = String(item.MATNR || '').trim();
      const maktx = maktMap.get(matnr) || '';
      const benum = String(h.BENUM || '').trim();
      const rawBenum = benum.replace(/^0+/, '');
      const aufnrBatch = afpoMap.get(rawBenum) || '';
      const charg = aufnrBatch || String(item.CHARG || '').trim();
      const nista = parseSapNumber(item.NISTA) || 0;
      const meins = String(item.MEINS || '').trim();
      const vlenr = String(item.VLENR || '').trim();
      const bdatu = String(h.BDATU || '').trim();

      return {
        WarehouseNumber: String(h.LGNUM || q.lgnum).trim(),
        TransferOrderNumber: tanum,
        TransferDate: sapDate(bdatu),
        TransferRequirement: String(h.TBNUM || '').trim(),
        RequirementNumber: benum,
        MovementType: String(h.BWLVS || '').trim(),
        Material: matnr,
        MaterialDescription: maktx,
        Batch: charg,
        QuantityWithUom: nista ? `${nista} ${meins}`.trim() : (meins ? `0 ${meins}` : ''),
        StorageUnit: vlenr
      };
    }).sort((a, b) => b.TransferDate.localeCompare(a.TransferDate) || b.TransferOrderNumber.localeCompare(a.TransferOrderNumber));

    return {
      WarehouseNumber: q.lgnum,
      DateFrom: q.from || null,
      DateTo: q.to || null,
      More: more,
      TransferOrders: transferOrders
    };
  }
}

module.exports = {
  MibLabelAdapter,
  normalizeInput,
  normalizeListInput,
  LIST_MAX_DAYS,
  LIST_MAX_ITEMS,
  FUNCTION_NAME,
  RESULT_STATUS
};
