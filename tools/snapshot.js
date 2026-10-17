#!/usr/bin/env node
'use strict';

/**
 * tools/snapshot.js
 *
 * Captures a deterministic JSON snapshot of SAP DDIC tables:
 * RESB, LTBK, LTBP, LTAK, LTAP, LQUA (911, 913, 920, 921, 902, plus source type),
 * MATDOC, and MARD.
 *
 * Strictly Read-Only (no SAP writes, no SPRO changes).
 *
 * Usage:
 *   node tools/snapshot.js --mat <mat> --plant <plant> --wh <wh> [--tr <tr>] [--to <to>] [--mblnr <mblnr>] [--out <file>]
 *   node tools/snapshot.js diff <file1.json> <file2.json>
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });
const { RfcClient } = require('../srv/integration/s4hana/RfcClient');

const args = process.argv.slice(2);

function printHelp() {
  console.log(`
Usage:
  node tools/snapshot.js --mat <mat> --plant <plant> --wh <wh> [--tr <tr>] [--to <to>] [--mblnr <mblnr>] [--out <file>]
  node tools/snapshot.js diff <file1.json> <file2.json>

Options:
  --mat        Material number (e.g. 8900000004 or 8000006485)
  --plant      Plant (e.g. 1120)
  --wh         Warehouse number (default: W01)
  --tr         Transfer Requirement number (e.g. 0001000804)
  --to         Transfer Order number (e.g. 0001037292)
  --mblnr      Material Document number (e.g. 4900050153)
  --out        Output JSON file path (prints to stdout if omitted)
  diff         Compare two snapshot files and display differences
`);
}

function parseArgs(argv) {
  const parsed = {
    command: null,
    mat: null,
    plant: null,
    wh: 'W01',
    tr: null,
    to: null,
    mblnr: null,
    out: null,
    diffFiles: []
  };

  if (argv[0] === 'diff') {
    parsed.command = 'diff';
    parsed.diffFiles = argv.slice(1);
    return parsed;
  }

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--mat' && argv[i + 1]) parsed.mat = argv[++i];
    else if (a === '--plant' && argv[i + 1]) parsed.plant = argv[++i];
    else if (a === '--wh' && argv[i + 1]) parsed.wh = argv[++i];
    else if (a === '--tr' && argv[i + 1]) parsed.tr = argv[++i];
    else if (a === '--to' && argv[i + 1]) parsed.to = argv[++i];
    else if (a === '--mblnr' && argv[i + 1]) parsed.mblnr = argv[++i];
    else if (a === '--out' && argv[i + 1]) parsed.out = argv[++i];
  }
  return parsed;
}

function deepDiff(obj1, obj2, prefix = '') {
  const diffs = [];
  if (obj1 === obj2) return diffs;

  if (typeof obj1 !== typeof obj2 || obj1 === null || obj2 === null) {
    diffs.push(`${prefix}: ${JSON.stringify(obj1)} !== ${JSON.stringify(obj2)}`);
    return diffs;
  }

  if (Array.isArray(obj1) && Array.isArray(obj2)) {
    if (obj1.length !== obj2.length) {
      diffs.push(`${prefix}.length: ${obj1.length} !== ${obj2.length}`);
    }
    const max = Math.max(obj1.length, obj2.length);
    for (let i = 0; i < max; i++) {
      diffs.push(...deepDiff(obj1[i], obj2[i], `${prefix}[${i}]`));
    }
    return diffs;
  }

  if (typeof obj1 === 'object') {
    const keys = Array.from(new Set([...Object.keys(obj1), ...Object.keys(obj2)])).sort();
    for (const k of keys) {
      // ignore snapshot runtime metadata if present
      if (prefix === '' && (k === 'snapshotMetadata' || k === 'capturedAt')) continue;
      diffs.push(...deepDiff(obj1[k], obj2[k], prefix ? `${prefix}.${k}` : k));
    }
    return diffs;
  }

  if (obj1 !== obj2) {
    diffs.push(`${prefix}: ${JSON.stringify(obj1)} !== ${JSON.stringify(obj2)}`);
  }
  return diffs;
}

function handleDiff(file1, file2) {
  if (!file1 || !file2) {
    console.error('Error: diff requires two file paths.');
    process.exit(1);
  }
  const data1 = JSON.parse(fs.readFileSync(file1, 'utf8'));
  const data2 = JSON.parse(fs.readFileSync(file2, 'utf8'));

  const diffs = deepDiff(data1, data2);
  if (diffs.length === 0) {
    console.log(`Snapshot diff: EMPTY (Files ${path.basename(file1)} and ${path.basename(file2)} are identical)`);
  } else {
    console.log(`Snapshot diff: ${diffs.length} differences found between ${file1} and ${file2}:`);
    diffs.forEach(d => console.log('  ' + d));
  }
  return diffs;
}

async function captureSnapshot(opts) {
  const rfc = new RfcClient();
  const matPadded = /^\d+$/.test(opts.mat) ? opts.mat.padStart(18, '0') : opts.mat;
  const trPadded = opts.tr ? opts.tr.padStart(10, '0') : null;
  const toPadded = opts.to ? opts.to.padStart(10, '0') : null;
  const mblnrPadded = opts.mblnr ? opts.mblnr.padStart(10, '0') : null;
  const wh = opts.wh || 'W01';
  const plant = opts.plant || '1120';

  const snapshot = {
    RESB: [],
    LTBK: [],
    LTBP: [],
    LTAK: [],
    LTAP: [],
    LQUA: [],
    MATDOC: [],
    MARD: []
  };

  // 1. LTBK & LTBP
  if (trPadded) {
    snapshot.LTBK = await rfc.readTable('LTBK',
      ['LGNUM', 'TBNUM', 'BWLVS', 'BETYP', 'BENUM', 'RSNUM', 'STATU', 'BDATU', 'BZEIT'],
      [`LGNUM = '${wh}'`, `AND TBNUM = '${trPadded}'`]
    );
    snapshot.LTBP = await rfc.readTable('LTBP',
      ['LGNUM', 'TBNUM', 'TBPOS', 'MATNR', 'WERKS', 'LGORT', 'CHARG', 'MENGA', 'MENGE', 'MEINS', 'ELIKZ'],
      [`LGNUM = '${wh}'`, `AND TBNUM = '${trPadded}'`]
    );
  }

  // 2. LTAK & LTAP
  let sourceTypes = ['902'];
  if (toPadded) {
    snapshot.LTAK = await rfc.readTable('LTAK',
      ['LGNUM', 'TANUM', 'BWLVS', 'BWART', 'BDATU', 'BZEIT', 'BNAME', 'TBNUM', 'KQUIT'],
      [`LGNUM = '${wh}'`, `AND TANUM = '${toPadded}'`]
    );
    snapshot.LTAP = await rfc.readTable('LTAP',
      ['LGNUM', 'TANUM', 'TAPOS', 'MATNR', 'WERKS', 'LGORT', 'CHARG', 'VSOLA', 'MEINS', 'VLTYP', 'VLPLA', 'NLTYP', 'NLPLA', 'VLQNR', 'NLQNR', 'PQUIT', 'TBPOS'],
      [`LGNUM = '${wh}'`, `AND TANUM = '${toPadded}'`]
    );
    snapshot.LTAP.forEach(item => {
      if (item.VLTYP && !sourceTypes.includes(item.VLTYP)) {
        sourceTypes.push(item.VLTYP);
      }
    });
  }

  // 3. RESB
  const rsnum = snapshot.LTBK[0]?.RSNUM && snapshot.LTBK[0].RSNUM !== '0000000000'
    ? snapshot.LTBK[0].RSNUM
    : null;
  if (rsnum) {
    snapshot.RESB = await rfc.readTable('RESB',
      ['RSNUM', 'RSPOS', 'MATNR', 'WERKS', 'LGORT', 'CHARG', 'BDMNG', 'ENMNG', 'KZEAR', 'XLOEK'],
      [`RSNUM = '${rsnum}'`]
    );
  } else if (opts.mat && plant) {
    snapshot.RESB = await rfc.readTable('RESB',
      ['RSNUM', 'RSPOS', 'MATNR', 'WERKS', 'LGORT', 'CHARG', 'BDMNG', 'ENMNG', 'KZEAR', 'XLOEK'],
      [`WERKS = '${plant}'`, `AND MATNR = '${matPadded}'`],
      10
    );
  }

  // 4. LQUA (types 911, 913, 920, 921, 902 and source types)
  const targetTypes = Array.from(new Set(['911', '913', '920', '921', '902', ...sourceTypes]));
  const lquaWhere = [
    `LGNUM = '${wh}'`,
    `AND MATNR = '${matPadded}'`,
    "AND ("
  ];
  targetTypes.forEach((t, i) => {
    const prefix = i === 0 ? "  LGTYP = '" : "  OR LGTYP = '";
    const suffix = i === targetTypes.length - 1 ? "' )" : "'";
    lquaWhere.push(`${prefix}${t}${suffix}`);
  });

  snapshot.LQUA = await rfc.readTable('LQUA',
    ['LQNUM', 'LGNUM', 'LGTYP', 'LGPLA', 'LGORT', 'MATNR', 'WERKS', 'CHARG', 'VERME', 'MEINS'],
    lquaWhere
  );
  snapshot.LQUA.sort((a, b) => (a.LQNUM || '').localeCompare(b.LQNUM || ''));

  // 5. MATDOC
  if (mblnrPadded) {
    snapshot.MATDOC = await rfc.readTable('MATDOC',
      ['MBLNR', 'MJAHR', 'ZEILE', 'BWART', 'MATNR', 'WERKS', 'LGORT', 'UMWRK', 'UMLGO', 'MENGE', 'MEINS', 'CPUDT', 'CPUTM'],
      [`MBLNR = '${mblnrPadded}'`]
    );
  }

  // 6. MARD
  if (opts.mat && plant) {
    snapshot.MARD = await rfc.readTable('MARD',
      ['MATNR', 'WERKS', 'LGORT', 'LABST', 'UMLME', 'INSME'],
      [`WERKS = '${plant}'`, `AND MATNR = '${matPadded}'`]
    );
    snapshot.MARD.sort((a, b) => (a.LGORT || '').localeCompare(b.LGORT || ''));
  }

  // Sort other arrays deterministically
  snapshot.RESB.sort((a, b) => (`${a.RSNUM}_${a.RSPOS}`).localeCompare(`${b.RSNUM}_${b.RSPOS}`));
  snapshot.LTBP.sort((a, b) => (a.TBPOS || '').localeCompare(b.TBPOS || ''));
  snapshot.LTAP.sort((a, b) => (a.TAPOS || '').localeCompare(b.TAPOS || ''));
  snapshot.MATDOC.sort((a, b) => (`${a.MBLNR}_${a.ZEILE}`).localeCompare(`${b.MBLNR}_${b.ZEILE}`));

  return snapshot;
}

async function main() {
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  const opts = parseArgs(args);
  if (opts.command === 'diff') {
    handleDiff(opts.diffFiles[0], opts.diffFiles[1]);
    return;
  }

  if (!opts.mat || !opts.plant) {
    console.error('Error: --mat and --plant are required.');
    printHelp();
    process.exit(1);
  }

  const snap = await captureSnapshot(opts);
  const jsonStr = JSON.stringify(snap, null, 2);

  if (opts.out) {
    const outPath = path.resolve(process.cwd(), opts.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, jsonStr, 'utf8');
    console.log(`Snapshot saved to ${outPath}`);
  } else {
    console.log(jsonStr);
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('Snapshot failed:', err);
    process.exit(1);
  });
}

module.exports = { captureSnapshot, deepDiff, handleDiff };
