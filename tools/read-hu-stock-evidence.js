#!/usr/bin/env node
'use strict';

/**
 * READ-ONLY evidence collection for a small, explicit HU/311 scope.
 * Calls RFC_READ_TABLE only. This script contains no RFC function call or SAP write path.
 * It is closed unless RUN_LIVE_SAP=1 and SAP_SYSTEM_TYPE is explicitly non-production.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.local'), quiet: true });

const fs = require('fs');
const path = require('path');
const { shouldRunLiveSapTests } = require('../test/liveSapGate');

if (!shouldRunLiveSapTests()) {
  throw new Error('READ-ONLY SAP gate closed: set RUN_LIVE_SAP=1 and SAP_SYSTEM_TYPE to a non-production value.');
}

const { RfcClient } = require('../srv/integration/s4hana/RfcClient');
const rfc = new RfcClient();
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
  systemType: String(process.env.SAP_SYSTEM_TYPE || '').trim(),
  queries: [],
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

collect().then(() => {
  const now = new Date();
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now);
  const outDir = path.resolve(__dirname, `../docs/evidence/${date}`);
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'hu-stock-evidence.raw.json');
  fs.writeFileSync(outFile, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  console.log(`READ-ONLY evidence saved: ${path.relative(process.cwd(), outFile)}`);
  console.log(`Captured ${evidence.queries.length} query results and ${evidence.open311Reservations.length} open 311 reservations.`);
}).catch((error) => {
  console.error(`READ-ONLY HU evidence collection failed: ${error.message}`);
  process.exitCode = 1;
});
