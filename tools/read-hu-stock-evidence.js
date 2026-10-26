#!/usr/bin/env node
'use strict';

/**
 * READ-ONLY evidence collection for a small, explicit HU/311 scope.
 * RFC allow-list: RFC_READ_TABLE only. Every table's field names are confirmed
 * through a DD03L read first; a read whose fields DD03L does not confirm is
 * skipped and recorded, never guessed. No warehouse is hardcoded: it is derived
 * per plant/storage location from T320.
 * Closed unless RUN_LIVE_SAP=1 and SAP_SYSTEM_TYPE is explicitly non-production.
 */
const fs = require('fs');
const path = require('path');
const {
  createReadOnlyRfcClient,
  assertNoSensitiveEnvironmentValues,
  assertNoSensitiveEnvironmentValuesInFile
} = require('./lib/readOnlyRfcGuard');

// Scope (plant/storage location, HUs, storage-type texts) is explicit; the
// warehouse is never part of it. Candidate field names below are confirmed by
// DD03L at run time before any table read uses them.
const DEFAULT_SCOPE = Object.freeze({
  reservations: [{ plant: '1120', storageLocation: 'CS02' }, { plant: '1150', storageLocation: 'CS02' }],
  movementType: '311',
  targetHus: ['2000019372', '2000019371', '2000020150', '2000020151'],
  storageTypeTextCodes: ['902', '911', '913', '921', 'OH1', 'EN1'],
  // User request 2026-10-26: "current T319A rows for W01 and W15" — W15 is a
  // comparison warehouse, read in addition to the warehouses derived from T320.
  t319aComparisonWarehouses: ['W15'],
  language: 'E'
});

const FIELDS = Object.freeze({
  DD03L: ['TABNAME', 'FIELDNAME', 'POSITION', 'KEYFLAG', 'ROLLNAME', 'DATATYPE', 'LENG'],
  RESB: ['RSNUM', 'RSPOS', 'BWART', 'MATNR', 'WERKS', 'LGORT', 'UMLGO', 'BDMNG', 'ENMNG', 'MEINS', 'KZEAR', 'XLOEK', 'AUFNR'],
  RKPF: ['RSNUM', 'BWART'],
  T320: ['WERKS', 'LGORT', 'LGNUM'],
  T001L: ['WERKS', 'LGORT', 'XHUPF', 'VSTEL'],
  T301: ['LGNUM', 'LGTYP'],
  T301T: ['SPRAS', 'LGNUM', 'LGTYP', 'LTYPT'],
  LQUA: ['LENUM', 'LGTYP', 'LGPLA', 'GESME', 'VERME', 'LETYP', 'MEINS'],
  VEKP: ['VENUM', 'EXIDV', 'STATUS', 'WERKS', 'LGORT', 'LGNUM', 'VPOBJ', 'VPOBJKEY', 'VHART', 'VHILM'],
  VEPO: ['VENUM', 'VEPOS', 'MATNR', 'WERKS', 'LGORT', 'CHARG', 'VEMNG', 'VEMEH'],
  LTAP: ['TANUM', 'TAPOS', 'PQUIT', 'VLENR', 'NLENR', 'MATNR', 'WERKS', 'LGORT', 'VLTYP', 'VLPLA', 'NLTYP', 'NLPLA', 'LETYP', 'VSOLM', 'VISTM', 'MEINS'],
  LTAK: ['TANUM', 'LGNUM', 'KQUIT'],
  SER06: ['OBKNR', 'VENUM'],
  OBJK: ['OBKNR', 'OBZAE', 'SERNR', 'MATNR'],
  MARA: ['MATNR', 'VHART'],
  T319A: ['LGNUM', 'VHART', 'LETYP'],
  LIPS: ['VBELN', 'POSNR', 'MATNR', 'WERKS', 'LGORT', 'LFIMG', 'VRKME', 'VGBEL', 'VGPOS', 'RSNUM', 'RSPOS'],
  LIKP: ['VBELN', 'LFART', 'VSTEL', 'WBSTK', 'KOSTK', 'LVSTK']
});

// RFC_READ_TABLE OPTIONS are 72-character lines; longer text is truncated by SAP
// and surfaces as an ABAP exception (observed 2026-10-26, RFC code 5).
const MAX_OPTION_LINE = 72;
const RFC_RC_NAMES = { 1: 'RFC_COMMUNICATION_FAILURE', 2: 'RFC_LOGON_FAILURE', 3: 'RFC_ABAP_RUNTIME_FAILURE', 4: 'RFC_ABAP_MESSAGE', 5: 'RFC_ABAP_EXCEPTION', 6: 'RFC_CLOSED', 7: 'RFC_CANCELED', 8: 'RFC_TIMEOUT' };
const padded = (value, length) => String(value).trim().padStart(length, '0');
const blank = (value) => !String(value || '').trim();
const uniq = (values) => [...new Set(values.filter(Boolean))];

function createCollector({ rfc, scope = DEFAULT_SCOPE, now = () => new Date() }) {
  const evidence = {
    capturedAt: now().toISOString(),
    mode: 'READ-ONLY',
    scope,
    queries: [],
    schemas: {},
    skippedReads: [],
    open311Reservations: [],
    locations: {},
    t301: { dd03lRows: [], keyFields: [], storageTypesByWarehouse: {}, storageTypeCodesByWarehouse: {}, status: 'NOT_READ' },
    t301t: {},
    stockByStorageType: [],
    huSummaries: [],
    serials: [],
    packaging: { vekpVhilm: [], mara: [] },
    t319a: {},
    deliveries: []
  };

  async function read(table, fields, where, rowCount = 9999) {
    const query = { table, fields, where, rowCount };
    const tooLong = where.find((line) => line.length > MAX_OPTION_LINE);
    if (tooLong) {
      throw Object.assign(new Error(`WHERE line exceeds ${MAX_OPTION_LINE} characters for ${table}: ${tooLong}`), { code: 'OPTION_LINE_TOO_LONG', query });
    }
    evidence.inFlight = query;
    const startedAt = now().toISOString();
    let rows;
    try {
      rows = await rfc.readTable(table, fields, where, rowCount);
    } catch (error) {
      error.query = query;
      throw error;
    }
    delete evidence.inFlight;
    evidence.queries.push({ query, timestamp: startedAt, completedAt: now().toISOString(), rowCount: rows.length, rows });
    return rows;
  }

  // DD03L first: returns the confirmed field set for a table (cached per run).
  async function schema(table) {
    if (!evidence.schemas[table]) {
      const rows = await read('DD03L', FIELDS.DD03L, [`TABNAME = '${table}'`], 9999);
      const confirmed = new Set(rows.map((row) => String(row.FIELDNAME || '').trim()).filter(Boolean));
      evidence.schemas[table] = { rows, confirmed: [...confirmed].sort() };
    }
    return new Set(evidence.schemas[table].confirmed);
  }

  // Reads only when DD03L confirms every selected and filtered field; otherwise
  // records the skip and returns null so callers fail closed.
  async function readChecked(table, where, rowCount = 9999, whereFields = []) {
    const confirmed = await schema(table);
    const missing = [...FIELDS[table], ...whereFields].filter((field) => !confirmed.has(field));
    if (missing.length) {
      evidence.skippedReads.push({ table, where, reason: 'DD03L_FIELDS_UNCONFIRMED', missing: uniq(missing) });
      return null;
    }
    return read(table, FIELDS[table], where, rowCount);
  }

  async function collectReservations() {
    for (const { plant, storageLocation } of scope.reservations) {
      const rows = await readChecked('RESB', [`WERKS = '${plant}'`, `AND LGORT = '${storageLocation}'`, `AND BWART = '${scope.movementType}'`]);
      if (!rows) continue;
      const openRows = rows.filter((row) => Number(row.BDMNG || 0) > Number(row.ENMNG || 0) && blank(row.KZEAR) && blank(row.XLOEK));
      for (const row of openRows) {
        let resolvedBWART = String(row.BWART || '').trim();
        let movementTypeSource = 'RESB';
        let rkpfRows = [];
        if (!resolvedBWART) {
          rkpfRows = (await readChecked('RKPF', [`RSNUM = '${padded(row.RSNUM, 10)}'`], 2)) || [];
          if (rkpfRows.length !== 1) throw new Error(`READ-ONLY evidence incomplete: RKPF fallback for reservation ${row.RSNUM} returned ${rkpfRows.length} rows.`);
          resolvedBWART = String(rkpfRows[0].BWART || '').trim();
          movementTypeSource = 'RKPF';
        }
        if (!resolvedBWART) throw new Error(`READ-ONLY evidence incomplete: both RESB and RKPF BWART are blank for ${row.RSNUM}/${row.RSPOS}.`);
        evidence.open311Reservations.push({ ...row, OpenQty: Number(row.BDMNG) - Number(row.ENMNG), ResolvedBWART: resolvedBWART, BWARTSource: movementTypeSource, RKPF: rkpfRows });
      }
    }
  }

  // Warehouse per plant/storage location from T320; XHUPF/VSTEL from T001L.
  async function collectLocations() {
    const keys = uniq(evidence.open311Reservations.map((row) => `${row.WERKS}/${row.LGORT}`));
    for (const key of keys) {
      const [plant, storageLocation] = key.split('/');
      const where = [`WERKS = '${plant}'`, `AND LGORT = '${storageLocation}'`];
      const t320 = await readChecked('T320', where, 2);
      const t001l = await readChecked('T001L', where, 2);
      const warehouse = t320 && t320.length === 1 ? String(t320[0].LGNUM || '').trim() : '';
      evidence.locations[key] = {
        plant, storageLocation, T320: t320 || [], T001L: t001l || [],
        warehouse: warehouse || null,
        warehouseStatus: !t320 ? 'NOT_READ' : t320.length === 1 && warehouse ? 'DERIVED' : `T320_ROWS_${t320.length}`,
        XHUPF: t001l && t001l.length === 1 ? t001l[0].XHUPF : null,
        VSTEL: t001l && t001l.length === 1 ? t001l[0].VSTEL : null
      };
    }
    for (const row of evidence.open311Reservations) {
      const loc = evidence.locations[`${row.WERKS}/${row.LGORT}`] || {};
      Object.assign(row, { Warehouse: loc.warehouse || null, XHUPF: loc.XHUPF ?? null, VSTEL: loc.VSTEL ?? null });
    }
    return uniq(Object.values(evidence.locations).map((loc) => loc.warehouse));
  }

  async function collectStorageTypes(warehouses) {
    const t301Schema = await schema('T301');
    evidence.t301.dd03lRows = evidence.schemas.T301.rows;
    evidence.t301.keyFields = evidence.t301.dd03lRows
      .filter((row) => String(row.KEYFLAG || '').trim().toUpperCase() === 'X')
      .sort((a, b) => Number(a.POSITION || 0) - Number(b.POSITION || 0));
    evidence.t301.status = t301Schema.has('LGNUM') && t301Schema.has('LGTYP') ? 'READ' : 'NOT_READ_SCHEMA_FIELDS_UNAVAILABLE';
    for (const warehouse of warehouses) {
      const rows = await readChecked('T301', [`LGNUM = '${warehouse}'`]);
      if (rows) {
        evidence.t301.storageTypesByWarehouse[warehouse] = rows;
        evidence.t301.storageTypeCodesByWarehouse[warehouse] = uniq(rows.map((row) => row.LGTYP)).sort();
      }
      // One OPTIONS line per code keeps every line under the 72-character limit.
      const codes = scope.storageTypeTextCodes.map((code, index) => `${index === 0 ? 'AND (' : 'OR'} LGTYP = '${code}'${index === scope.storageTypeTextCodes.length - 1 ? ' )' : ''}`);
      const texts = await readChecked('T301T', [`SPRAS = '${scope.language}'`, `AND LGNUM = '${warehouse}'`, ...codes]);
      if (texts) evidence.t301t[warehouse] = texts;
    }
  }

  // Stock per storage type only; negative quants are flagged, no totals or
  // shortfalls are derived (pending the user's OH1 decision).
  async function collectStock() {
    const targets = uniq(evidence.open311Reservations.map((row) => `${row.MATNR}|${row.WERKS}|${row.LGORT}`));
    const lenums = [];
    for (const target of targets) {
      const [matnr, plant, storageLocation] = target.split('|');
      const loc = evidence.locations[`${plant}/${storageLocation}`] || {};
      if (!loc.warehouse) {
        evidence.skippedReads.push({ table: 'LQUA', where: [`MATNR = '${matnr}'`, `WERKS = '${plant}'`, `LGORT = '${storageLocation}'`], reason: 'WAREHOUSE_NOT_DERIVED' });
        continue;
      }
      const rows = await readChecked('LQUA', [`LGNUM = '${loc.warehouse}'`, `AND WERKS = '${plant}'`, `AND LGORT = '${storageLocation}'`, `AND MATNR = '${matnr}'`]);
      if (!rows) continue;
      lenums.push(...rows.map((row) => row.LENUM));
      const byType = {};
      for (const row of rows) {
        const qty = Number(String(row.GESME || '0').replace(/^(.*)-$/, '-$1'));
        const bucket = byType[row.LGTYP] || (byType[row.LGTYP] = { quantity: 0, unit: row.MEINS, storageUnits: [], negativeQuants: [] });
        bucket.quantity = Number((bucket.quantity + qty).toFixed(3));
        bucket.storageUnits.push(row.LENUM);
        if (qty < 0) bucket.negativeQuants.push({ LENUM: row.LENUM, LGPLA: row.LGPLA, GESME: row.GESME });
      }
      evidence.stockByStorageType.push({ material: matnr, plant, storageLocation, warehouse: loc.warehouse, rowCount: rows.length, byStorageType: byType, hasNegativeQuants: rows.some((row) => /-$/.test(String(row.GESME || ''))) });
    }
    return uniq(lenums);
  }

  async function collectHandlingUnits(lquaLenums) {
    const hus = uniq([...scope.targetHus.map((hu) => padded(hu, 20)), ...lquaLenums.map((lenum) => padded(lenum, 20))]);
    const vhilms = [];
    for (const exidv of hus) {
      const isTarget = scope.targetHus.some((hu) => padded(hu, 20) === exidv);
      const vekpRows = (await readChecked('VEKP', [`EXIDV = '${exidv}'`], 2)) || [];
      const vepoRows = [];
      const ser06Rows = [];
      const objkRows = [];
      for (const vekp of vekpRows) {
        if (blank(vekp.VENUM)) continue;
        if (!blank(vekp.VHILM)) vhilms.push(vekp.VHILM);
        if (isTarget) vepoRows.push(...((await readChecked('VEPO', [`VENUM = '${vekp.VENUM}'`])) || []));
        // SER06 (HU serial document header) → OBKNR → OBJK serial rows.
        const ser06 = (await readChecked('SER06', [`VENUM = '${vekp.VENUM}'`])) || [];
        ser06Rows.push(...ser06);
        for (const obknr of uniq(ser06.map((row) => row.OBKNR))) {
          objkRows.push(...((await readChecked('OBJK', [`OBKNR = '${obknr}'`])) || []));
        }
      }
      if (isTarget) evidence.huSummaries.push({ HU: exidv, VEKP: vekpRows, VEPO: vepoRows });
      evidence.serials.push({ HU: exidv, VENUM: vekpRows.map((row) => row.VENUM), SER06: ser06Rows, OBJK: objkRows, serialNumbers: uniq(objkRows.map((row) => row.SERNR)), status: evidence.skippedReads.some((s) => s.table === 'SER06' || s.table === 'OBJK') ? 'NOT_READ_SCHEMA_FIELDS_UNCONFIRMED' : 'READ' });
      if (isTarget) await collectTransferOrders(exidv);
    }
    evidence.packaging.vekpVhilm = hus.map((exidv) => ({ HU: exidv, VHILM: uniq(evidence.queries.filter((q) => q.query.table === 'VEKP' && q.query.where[0] === `EXIDV = '${exidv}'`).flatMap((q) => q.rows.map((row) => row.VHILM))) }));
    for (const vhilm of uniq(vhilms)) {
      evidence.packaging.mara.push(...((await readChecked('MARA', [`MATNR = '${vhilm}'`], 2)) || []));
    }
  }

  async function collectTransferOrders(exidv) {
    const toRows = await readChecked('LTAP', [`( VLENR = '${exidv}' OR NLENR = '${exidv}' )`]);
    if (!toRows) return;
    const toHeaders = [];
    for (const tanum of uniq(toRows.map((row) => row.TANUM))) {
      toHeaders.push(...((await readChecked('LTAK', [`TANUM = '${padded(tanum, 10)}'`], 2)) || []));
    }
    const headerByTo = new Map(toHeaders.map((header) => [header.TANUM, header]));
    const huToEvidence = evidence.queries.find((q) => q.query.table === 'LTAP' && q.query.where.includes(`( VLENR = '${exidv}' OR NLENR = '${exidv}' )`));
    huToEvidence.headers = toHeaders;
    huToEvidence.openTransferOrders = toRows.filter((row) => blank(row.PQUIT) && blank(headerByTo.get(row.TANUM)?.KQUIT));
  }

  async function collectT319a(warehouses) {
    for (const warehouse of uniq([...warehouses, ...scope.t319aComparisonWarehouses])) {
      const rows = await readChecked('T319A', [`LGNUM = '${warehouse}'`]);
      evidence.t319a[warehouse] = rows === null ? { status: 'NOT_READ_SCHEMA_FIELDS_UNCONFIRMED', rows: [] } : { status: 'READ', rows };
    }
  }

  async function collectDeliveries() {
    for (const row of evidence.open311Reservations) {
      const rsnum = padded(row.RSNUM, 10);
      const rspos = padded(row.RSPOS, 4);
      const byReservation = await readChecked('LIPS', [`RSNUM = '${rsnum}'`, `AND RSPOS = '${rspos}'`]);
      const byReference = await readChecked('LIPS', [`VGBEL = '${rsnum}'`]);
      const likp = [];
      for (const vbeln of uniq([...(byReservation || []), ...(byReference || [])].map((item) => item.VBELN))) {
        likp.push(...((await readChecked('LIKP', [`VBELN = '${vbeln}'`], 2)) || []));
      }
      evidence.deliveries.push({ RSNUM: rsnum, RSPOS: rspos, status: byReservation && byReference ? 'READ' : 'NOT_READ_SCHEMA_FIELDS_UNCONFIRMED', LIPS_byReservation: byReservation || [], LIPS_byReference: byReference || [], LIKP: likp });
    }
  }

  async function collect() {
    await collectReservations();
    const warehouses = await collectLocations();
    await collectStorageTypes(warehouses);
    const lenums = await collectStock();
    await collectHandlingUnits(lenums);
    await collectT319a(warehouses);
    await collectDeliveries();
    return evidence;
  }

  return { evidence, collect };
}

function evidenceFilePath(outDir, now = new Date(), { partial = false } = {}) {
  const base = path.join(outDir, `hu-stock-evidence${partial ? '.partial' : ''}.raw.json`);
  if (!fs.existsSync(base)) return base;
  // Never overwrite saved evidence; add a UTC time suffix instead.
  return path.join(outDir, `hu-stock-evidence.${now.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '')}${partial ? '.partial' : ''}.raw.json`);
}

// Describes a collection failure without secrets: RFC return code name, ABAP
// exception key, and the query that was in flight. Messages are not copied.
function describeFailure(error) {
  const safe = (value, max = 48) => (/^[A-Z0-9_]{1,48}$/.test(String(value || '')) ? String(value).slice(0, max) : null);
  const code = error && error.code;
  return {
    code: safe(code) || 'COLLECTION_FAILED',
    rfcReturnCode: Number.isInteger(Number(code)) && RFC_RC_NAMES[Number(code)] ? RFC_RC_NAMES[Number(code)] : null,
    abapException: safe(error && error.key),
    // Environment variable names or JSON field names that the redaction scan hit; never their values.
    leakedKeys: Array.isArray(error && error.keys) ? error.keys.map((key) => String(key).slice(0, 80)) : null,
    query: (error && error.query) || null
  };
}

function saveEvidence(evidence, outDir, env, now = new Date(), { partial = false } = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = evidenceFilePath(outDir, now, { partial });
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  assertNoSensitiveEnvironmentValues(serialized, env);
  fs.writeFileSync(outFile, serialized, { mode: 0o600 });
  try {
    assertNoSensitiveEnvironmentValuesInFile(outFile, env);
  } catch (error) {
    fs.unlinkSync(outFile);
    throw error;
  }
  return outFile;
}

async function runCollector() {
  require('dotenv').config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });
  const { shouldRunLiveSapTests } = require('../test/liveSapGate');
  const { RfcClient } = require('../srv/integration/s4hana/RfcClient');
  const rfc = createReadOnlyRfcClient(new RfcClient(), { onCall: (functionName) => console.log(`READ-ONLY RFC call: ${functionName}`) });
  const outDir = path.resolve(__dirname, `../docs/evidence/${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())}`);
  let collector = null;
  try {
    if (!shouldRunLiveSapTests()) {
      throw Object.assign(new Error('READ-ONLY SAP gate is closed.'), { code: 'SAP_READ_ONLY_GATE_CLOSED' });
    }
    collector = createCollector({ rfc });
    await collector.collect();
    const outFile = saveEvidence(collector.evidence, outDir, process.env);
    console.log(`READ-ONLY evidence saved: ${path.relative(process.cwd(), outFile)}`);
    console.log(`Captured ${collector.evidence.queries.length} query results, ${collector.evidence.open311Reservations.length} open 311 reservations, ${collector.evidence.skippedReads.length} skipped reads.`);
  } catch (error) {
    const failure = describeFailure(error);
    console.error(`READ-ONLY HU evidence collection failed: ${JSON.stringify(failure)}`);
    process.exitCode = 1;
    if (collector && collector.evidence.queries.length) {
      try {
        collector.evidence.failure = failure;
        const partialFile = saveEvidence(collector.evidence, outDir, process.env, new Date(), { partial: true });
        console.error(`Partial READ-ONLY evidence (${collector.evidence.queries.length} completed reads) saved: ${path.relative(process.cwd(), partialFile)}`);
      } catch (saveError) {
        console.error(`Partial evidence not saved (${describeFailure(saveError).code}).`);
      }
    }
  } finally {
    console.log(`RFC functions called: ${JSON.stringify(rfc.getCalledFunctions())}`);
  }
}

module.exports = { createCollector, evidenceFilePath, saveEvidence, describeFailure, MAX_OPTION_LINE, DEFAULT_SCOPE, FIELDS };

if (require.main === module) runCollector();
