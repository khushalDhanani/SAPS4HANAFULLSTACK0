#!/usr/bin/env node
'use strict';

/**
 * READ-ONLY evidence collection for a small, explicit HU/311 scope.
 * RFC allow-list: RFC_READ_TABLE only. DD03L metadata is read through the same
 * function; no additional metadata function or SAP write path is used.
 * It is closed unless RUN_LIVE_SAP=1 and SAP_SYSTEM_TYPE is explicitly non-production.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.local'), quiet: true });

const fs = require('fs');
const path = require('path');
const { shouldRunLiveSapTests } = require('../test/liveSapGate');
const {
  createReadOnlyRfcClient,
  assertNoSensitiveEnvironmentValues,
  assertNoSensitiveEnvironmentValuesInFile
} = require('./lib/readOnlyRfcGuard');

const { RfcClient } = require('../srv/integration/s4hana/RfcClient');
const rfc = createReadOnlyRfcClient(new RfcClient(), {
  onCall: (functionName) => console.log(`READ-ONLY RFC call: ${functionName}`)
});
const targetHus = ['2000019372', '2000019371', '2000020150', '2000020151'];
const targetMaterials = [
  { material: '8000009754', plant: '1120' },
  { material: '8000006485', plant: '1120' },
  { material: '8000009802', plant: '1150' },
  { material: '8000009803', plant: '1150' }
];
const evidence = {
  capturedAt: new Date().toISOString(),
  mode: 'READ-ONLY',
  queries: [],
  t301: null,
  huSummaries: [],
  open311Reservations: []
};

function padded(value, length) {
  return String(value).trim().padStart(length, '0');
}

async function read(table, fields, where, rowCount = 9999) {
  const query = { table, fields, where, rowCount };
  const startedAt = new Date().toISOString();
  const rows = await rfc.readTable(table, fields, where, rowCount);
  evidence.queries.push({
    query,
    timestamp: startedAt,
    completedAt: new Date().toISOString(),
    rowCount: rows.length,
    rows
  });
  return rows;
}

async function collect() {
  // DD03L columns below are taken from saved DD03L schema evidence in
  // docs/evidence/2026-10-26/261-dd03l-fields.raw.json. T301 fields are never
  // presumed: the T301 read is issued only if DD03L reports both query fields.
  const t301Dd03lRows = await read('DD03L', [
    'TABNAME', 'FIELDNAME', 'POSITION', 'KEYFLAG', 'ROLLNAME', 'DATATYPE', 'LENG'
  ], ["TABNAME = 'T301'"], 9999);
  const t301FieldNames = new Set(t301Dd03lRows.map((row) => row.FIELDNAME).filter(Boolean));
  const t301KeyFields = t301Dd03lRows
    .filter((row) => String(row.KEYFLAG || '').trim().toUpperCase() === 'X')
    .sort((a, b) => Number(a.POSITION || 0) - Number(b.POSITION || 0));
  evidence.t301 = {
    dd03lRows: t301Dd03lRows,
    keyFields: t301KeyFields,
    storageTypesW01: [],
    storageTypeCodesW01: [],
    storageTypesQueryStatus: 'NOT_READ_SCHEMA_FIELDS_UNAVAILABLE'
  };
  if (t301FieldNames.has('LGNUM') && t301FieldNames.has('LGTYP')) {
    evidence.t301.storageTypesW01 = await read('T301', ['LGNUM', 'LGTYP'], ["LGNUM = 'W01'"], 9999);
    evidence.t301.storageTypeCodesW01 = [...new Set(evidence.t301.storageTypesW01.map((row) => row.LGTYP).filter(Boolean))].sort();
    evidence.t301.storageTypesQueryStatus = 'READ';
  }

  // LQUA fields were checked in the saved DD03L evidence. Keep rows raw; do not
  // infer pickability or stock eligibility in this evidence collector.
  for (const entry of targetMaterials) {
    const matnr = padded(entry.material, 18);
    await read('LQUA', ['LENUM', 'LGTYP', 'LGPLA', 'GESME', 'VERME', 'LETYP', 'MEINS'], [
      "LGNUM = 'W01'",
      `AND WERKS = '${entry.plant}'`,
      "AND LGORT = 'CS02'",
      `AND MATNR = '${matnr}'`
    ]);
  }

  // Resolve external HU identifiers through VEKP, then read the complete VEPO
  // item fields needed to identify each HU's materials and quantities.
  for (const hu of targetHus) {
    const exidv = padded(hu, 20);
    const vekpRows = await read('VEKP', [
      'VENUM', 'EXIDV', 'STATUS', 'WERKS', 'LGORT', 'LGNUM', 'VPOBJ', 'VPOBJKEY', 'VHART'
    ], [`EXIDV = '${exidv}'`], 2);
    const vepoRows = [];
    for (const row of vekpRows) {
      if (!row.VENUM) continue;
      vepoRows.push(...await read('VEPO', [
        'VENUM', 'VEPOS', 'MATNR', 'WERKS', 'LGORT', 'CHARG', 'VEMNG', 'VEMEH'
      ], [`VENUM = '${row.VENUM}'`], 9999));
    }
    evidence.huSummaries.push({ HU: hu, VEKP: vekpRows, VEPO: vepoRows });

    const unitKey = padded(hu, 20);
    const toRows = await read('LTAP', [
      'TANUM', 'TAPOS', 'PQUIT', 'VLENR', 'NLENR', 'MATNR', 'WERKS', 'LGORT',
      'VLTYP', 'VLPLA', 'NLTYP', 'NLPLA', 'LETYP', 'VSOLM', 'VISTM', 'MEINS'
    ], [`( VLENR = '${unitKey}' OR NLENR = '${unitKey}' )`], 9999);
    const toNumbers = [...new Set(toRows.map((row) => row.TANUM).filter(Boolean))];
    const toHeaders = [];
    for (const tanum of toNumbers) {
      toHeaders.push(...await read('LTAK', ['TANUM', 'LGNUM', 'KQUIT'], [`TANUM = '${padded(tanum, 10)}'`], 2));
    }
    const headerByTo = new Map(toHeaders.map((header) => [header.TANUM, header]));
    const huToEvidence = evidence.queries.find((q) => q.table === 'LTAP' && q.where.includes(`( VLENR = '${unitKey}' OR NLENR = '${unitKey}' )`));
    if (huToEvidence) {
      huToEvidence.headers = toHeaders;
      huToEvidence.openTransferOrders = toRows.filter((row) =>
        !String(row.PQUIT || '').trim() && !String(headerByTo.get(row.TANUM)?.KQUIT || '').trim()
      );
    }
  }

  // Discover open 311 RESB rows for the two requested plant/SLoc scopes. RESB
  // BWART is authoritative when populated; RKPF is read only as its blank fallback.
  for (const plant of ['1120', '1150']) {
    const rows = await read('RESB', [
      'RSNUM', 'RSPOS', 'BWART', 'MATNR', 'WERKS', 'LGORT', 'UMLGO', 'BDMNG', 'ENMNG',
      'MEINS', 'KZEAR', 'XLOEK', 'AUFNR'
    ], [
      `WERKS = '${plant}'`,
      "AND LGORT = 'CS02'",
      "AND BWART = '311'"
    ], 9999);
    const openRows = rows.filter((row) =>
      Number(row.BDMNG || 0) > Number(row.ENMNG || 0) &&
      !String(row.KZEAR || '').trim() && !String(row.XLOEK || '').trim()
    );

    for (const row of openRows) {
      let resolvedBWART = String(row.BWART || '').trim();
      let movementTypeSource = 'RESB';
      let rkpfRows = [];
      if (!resolvedBWART) {
        const rsnum = padded(row.RSNUM, 10);
        rkpfRows = await read('RKPF', ['RSNUM', 'BWART'], [`RSNUM = '${rsnum}'`], 2);
        if (rkpfRows.length !== 1) {
          throw new Error(`READ-ONLY evidence incomplete: RKPF fallback for reservation ${rsnum} returned ${rkpfRows.length} rows.`);
        }
        resolvedBWART = String(rkpfRows[0].BWART || '').trim();
        movementTypeSource = 'RKPF';
      }
      if (!resolvedBWART) {
        throw new Error(`READ-ONLY evidence incomplete: both RESB and RKPF BWART are blank for ${row.RSNUM}/${row.RSPOS}.`);
      }
      evidence.open311Reservations.push({
        ...row,
        OpenQty: Number(row.BDMNG) - Number(row.ENMNG),
        ResolvedBWART: resolvedBWART,
        BWARTSource: movementTypeSource,
        RKPF: rkpfRows
      });
    }
  }
}

async function runCollector() {
  try {
    if (!shouldRunLiveSapTests()) {
      throw Object.assign(new Error('READ-ONLY SAP gate is closed.'), { code: 'SAP_READ_ONLY_GATE_CLOSED' });
    }
    await collect();
    const now = new Date();
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now);
    const outDir = path.resolve(__dirname, `../docs/evidence/${date}`);
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, 'hu-stock-evidence.raw.json');
    const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
    assertNoSensitiveEnvironmentValues(serialized, process.env);
    fs.writeFileSync(outFile, serialized, { mode: 0o600 });
    try {
      assertNoSensitiveEnvironmentValuesInFile(outFile, process.env);
    } catch (error) {
      fs.unlinkSync(outFile);
      throw error;
    }
    console.log(`READ-ONLY evidence saved: ${path.relative(process.cwd(), outFile)}`);
    console.log(`Captured ${evidence.queries.length} query results and ${evidence.open311Reservations.length} open 311 reservations.`);
  } catch (error) {
    const safeCode = /^[A-Z0-9_]{1,48}$/.test(String(error.code || '')) ? error.code : 'COLLECTION_FAILED';
    console.error(`READ-ONLY HU evidence collection failed (${safeCode}).`);
    process.exitCode = 1;
  } finally {
    console.log(`RFC functions called: ${JSON.stringify(rfc.getCalledFunctions())}`);
  }
}

runCollector();
