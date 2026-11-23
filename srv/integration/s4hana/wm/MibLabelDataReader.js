'use strict';

const { parseSapNumber } = require('../sapFacts');
const {
  MAKT_LANGUAGE,
  LIST_MAX_ITEMS,
  LOOKUP_CHUNK,
  httpError,
  sapDate,
  normalizeInput,
  normalizeListInput,
  quote,
  orLines,
} = require('./MibLabelUtils');

/**
 * Read-only data assembly from SAP tables (LTAK, LTAP, MAKT, AFPO) matching report ZMM_R_067_F01.
 */
async function readMibStickerData(rfc, input, options = {}) {
  const { lgnum, tanum, bname, bname1 } = normalizeInput(input);
  const allowedWarehouses = options?.allowedWarehouses ?? input?.allowedWarehouses ?? null;
  if (Array.isArray(allowedWarehouses) && !allowedWarehouses.includes(lgnum)) {
    throw httpError(403, `Warehouse ${lgnum} is outside your authorized warehouses.`);
  }

  const ltakRows = await rfc.readTable(
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

  const ltapRows = await rfc.readTable(
    'LTAP',
    ['LGNUM', 'TANUM', 'TAPOS', 'MATNR', 'CHARG', 'NISTA', 'MEINS', 'VLENR'],
    [`LGNUM = ${quote(lgnum)}`, `AND TANUM = ${quote(tanum)}`]
  );

  if (!ltapRows || ltapRows.length === 0) {
    return [];
  }

  let aufnrBatch = '';
  if (benum) {
    const aufnr = benum.replace(/^0+/, '').padStart(12, '0');
    try {
      const afpoRows = await rfc.readTable(
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

  const matnrs = [...new Set(ltapRows.map((r) => String(r.MATNR || '').trim()).filter(Boolean))];
  const maktMap = new Map();
  if (matnrs.length > 0) {
    try {
      const whereMakt = matnrs.map((m, idx) => (idx === 0 ? `( MATNR = ${quote(m)}` : `OR MATNR = ${quote(m)}`)).concat([`) AND SPRAS = ${quote(MAKT_LANGUAGE)}`]);
      const maktRows = await rfc.readTable('MAKT', ['MATNR', 'MAKTX'], whereMakt);
      for (const row of maktRows) {
        maktMap.set(String(row.MATNR || '').trim(), String(row.MAKTX || '').trim());
      }
    } catch {
      // MAKT optional
    }
  }

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
      CheckedBy: bname1,
    };
  });
}

/**
 * List Transfer Orders for a warehouse by date range or TO number (read-only).
 */
async function listTransferOrders(rfc, input, options = {}) {
  const q = normalizeListInput(input);
  const allowedWarehouses = options?.allowedWarehouses ?? input?.allowedWarehouses ?? null;
  if (Array.isArray(allowedWarehouses) && !allowedWarehouses.includes(q.lgnum)) {
    throw httpError(403, `Warehouse ${q.lgnum} is outside your authorized warehouses.`);
  }
  const sap = (d) => d.replace(/-/g, '');
  const where = [`LGNUM = ${quote(q.lgnum)}`].concat(q.tanum
    ? [`AND TANUM = ${quote(q.tanum)}`]
    : [`AND BDATU BETWEEN ${quote(sap(q.from))} AND ${quote(sap(q.to))}`]);

  const ltakRows = await rfc.readTable(
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
      TransferOrders: [],
    };
  }

  const tanums = headers.map((h) => String(h.TANUM || '').trim()).filter(Boolean);
  const itemsMap = new Map();

  for (let i = 0; i < tanums.length; i += LOOKUP_CHUNK) {
    const chunk = tanums.slice(i, i + LOOKUP_CHUNK);
    const whereLtap = [`LGNUM = ${quote(q.lgnum)}`, 'AND'].concat(
      orLines('', 'TANUM', chunk)
    );
    const ltapChunk = await rfc.readTable(
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

  const matnrs = [...new Set([...itemsMap.values()].map((r) => String(r.MATNR || '').trim()).filter(Boolean))];
  const maktMap = new Map();
  if (matnrs.length > 0) {
    for (let i = 0; i < matnrs.length; i += LOOKUP_CHUNK) {
      const chunk = matnrs.slice(i, i + LOOKUP_CHUNK);
      const whereMakt = [`SPRAS = ${quote(MAKT_LANGUAGE)}`, 'AND'].concat(
        orLines('', 'MATNR', chunk)
      );
      try {
        const maktChunk = await rfc.readTable('MAKT', ['MATNR', 'MAKTX'], whereMakt);
        for (const row of maktChunk) {
          maktMap.set(String(row.MATNR || '').trim(), String(row.MAKTX || '').trim());
        }
      } catch {
        // MAKT optional
      }
    }
  }

  const benums = [...new Set(headers.map((h) => String(h.BENUM || '').trim()).filter(Boolean))];
  const afpoMap = new Map();
  if (benums.length > 0) {
    const aufnrs = benums.map((b) => b.replace(/^0+/, '').padStart(12, '0'));
    for (let i = 0; i < aufnrs.length; i += LOOKUP_CHUNK) {
      const chunk = aufnrs.slice(i, i + LOOKUP_CHUNK);
      const whereAfpo = orLines('', 'AUFNR', chunk);
      try {
        const afpoChunk = await rfc.readTable('AFPO', ['AUFNR', 'CHARG'], whereAfpo);
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
      StorageUnit: vlenr,
    };
  }).sort((a, b) => b.TransferDate.localeCompare(a.TransferDate) || b.TransferOrderNumber.localeCompare(a.TransferOrderNumber));

  return {
    WarehouseNumber: q.lgnum,
    DateFrom: q.from || null,
    DateTo: q.to || null,
    More: more,
    TransferOrders: transferOrders,
  };
}

module.exports = {
  readMibStickerData,
  listTransferOrders,
};
