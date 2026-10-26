#!/usr/bin/env node
'use strict';

/**
 * READ-ONLY probe: is HU_CREATE_GOODS_MOVEMENT callable via RFC, and what is its interface?
 * Reads only through RFC_READ_TABLE (allow-listed guard): DD03L confirms every field first, then
 *   TFDIR     -> FMODE ('R' = remote-enabled) for the function,
 *   FUPARAREF -> its parameters (name, kind, type),
 *   DD40L     -> the row type of every declared parameter type that is a table type (e.g. HUM_EXIDV_T),
 *   DD03L     -> the fields of each structured row type (e.g. HUM_EXIDV), so a payload can be shaped from evidence.
 * Writes docs/evidence/<IST date>/hu-fm-rfc-probe[.<utc>].json after the sensitive-value scan.
 * Closed unless RUN_LIVE_SAP=1 and SAP_SYSTEM_TYPE is non-production (same gate as the HU collector).
 */
const fs = require('fs');
const path = require('path');
const { createReadOnlyRfcClient, assertNoSensitiveEnvironmentValues, assertNoSensitiveEnvironmentValuesInFile } = require('./lib/readOnlyRfcGuard');

const FUNCTION_NAME = 'HU_CREATE_GOODS_MOVEMENT';
const WANTED = Object.freeze({
  TFDIR: ['FUNCNAME', 'FMODE', 'PNAME'],
  FUPARAREF: ['FUNCNAME', 'PARAMETER', 'PARAMTYPE', 'STRUCTURE', 'OPTIONAL', 'PPOSITION'],
  DD40L: ['TYPENAME', 'ROWTYPE', 'ROWKIND', 'DATATYPE', 'LENG']
});

function createProbe({ rfc, functionName = FUNCTION_NAME }) {
  const evidence = { capturedAt: new Date().toISOString(), readOnly: true, functionName, queries: [], skippedReads: [], result: {} };

  async function confirmedFields(table) {
    const rows = await rfc.readTable('DD03L', ['TABNAME', 'FIELDNAME'], [`TABNAME = '${table}'`], 500);
    const present = new Set(rows.map((r) => r.FIELDNAME));
    const fields = WANTED[table].filter((f) => present.has(f));
    const missing = WANTED[table].filter((f) => !present.has(f));
    if (missing.length) evidence.skippedReads.push({ table, missingFields: missing });
    return fields;
  }

  async function read(table, where, rowCount = 200) {
    const fields = await confirmedFields(table);
    if (!fields.length) return [];
    const rows = await rfc.readTable(table, fields, where, rowCount);
    evidence.queries.push({ table, fields, where, rowCount: rows.length, rows });
    return rows;
  }

  async function run() {
    const tfdir = await read('TFDIR', [`FUNCNAME = '${functionName}'`], 1);
    evidence.result.exists = tfdir.length > 0;
    evidence.result.fmode = tfdir[0]?.FMODE ?? null;
    evidence.result.rfcEnabled = tfdir.length ? tfdir[0].FMODE === 'R' : null; // FMODE 'R' = remote-enabled (TFDIR)
    const params = await read('FUPARAREF', [`FUNCNAME = '${functionName}'`], 200);
    evidence.result.parameters = params.map((p) => ({ name: p.PARAMETER, kind: p.PARAMTYPE, type: p.STRUCTURE, optional: p.OPTIONAL }));
    // Parameter direction does not determine its type: IMPORT/EXPORT/CHANGING can
    // also use DDIC table types. Look up every declared type; absent DD40L rows
    // remain explicit found:false results, without guessing from a name/suffix.
    const tableTypes = [...new Set(params.filter((p) => p.STRUCTURE).map((p) => p.STRUCTURE))];
    evidence.result.tableTypes = [];
    for (const typeName of tableTypes) {
      const dd40l = await read('DD40L', [`TYPENAME = '${typeName}'`], 1);
      const entry = { typeName, rowType: dd40l[0]?.ROWTYPE ?? null, rowKind: dd40l[0]?.ROWKIND ?? null, found: dd40l.length > 0 };
      // A structured row (ROWKIND S) needs its DD03L fields before any payload can be shaped after it.
      if (entry.rowKind === 'S' && entry.rowType) {
        const fieldRows = await rfc.readTable('DD03L', ['FIELDNAME', 'POSITION', 'ROLLNAME', 'DATATYPE', 'LENG'], [`TABNAME = '${entry.rowType}'`], 200);
        evidence.queries.push({ table: 'DD03L', fields: ['FIELDNAME', 'POSITION', 'ROLLNAME', 'DATATYPE', 'LENG'], where: [`TABNAME = '${entry.rowType}'`], rowCount: fieldRows.length, rows: fieldRows });
        entry.rowFields = fieldRows
          .sort((a, b) => String(a.POSITION).localeCompare(String(b.POSITION)))
          .map((f) => ({ name: f.FIELDNAME, rollname: f.ROLLNAME, datatype: f.DATATYPE, length: f.LENG }));
      }
      evidence.result.tableTypes.push(entry);
    }
    return evidence;
  }

  return { evidence, run };
}

function saveEvidence(evidence, outDir, env) {
  fs.mkdirSync(outDir, { recursive: true });
  let outFile = path.join(outDir, 'hu-fm-rfc-probe.json');
  if (fs.existsSync(outFile)) outFile = path.join(outDir, `hu-fm-rfc-probe.${new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '')}.json`);
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  assertNoSensitiveEnvironmentValues(serialized, env);
  fs.writeFileSync(outFile, serialized, { mode: 0o600 });
  try { assertNoSensitiveEnvironmentValuesInFile(outFile, env); } catch (e) { fs.unlinkSync(outFile); throw e; }
  return outFile;
}

async function main() {
  require('dotenv').config({ path: path.resolve(__dirname, '../.env.local'), quiet: true });
  const { shouldRunLiveSapTests } = require('../test/liveSapGate');
  const { RfcClient } = require('../srv/integration/s4hana/RfcClient');
  const rfc = createReadOnlyRfcClient(new RfcClient(), { onCall: (fm) => console.log(`READ-ONLY RFC call: ${fm}`) });
  const outDir = path.resolve(__dirname, `../docs/evidence/${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())}`);
  try {
    if (!shouldRunLiveSapTests()) throw Object.assign(new Error('READ-ONLY SAP gate is closed.'), { code: 'SAP_READ_ONLY_GATE_CLOSED' });
    const probe = createProbe({ rfc });
    await probe.run();
    const outFile = saveEvidence(probe.evidence, outDir, process.env);
    console.log(`READ-ONLY probe saved: ${path.relative(process.cwd(), outFile)}`);
    console.log(JSON.stringify({ exists: probe.evidence.result.exists, fmode: probe.evidence.result.fmode, rfcEnabled: probe.evidence.result.rfcEnabled, parameters: probe.evidence.result.parameters.length, tableTypes: probe.evidence.result.tableTypes }));
  } catch (error) {
    // No message text is printed: it could carry connection details.
    console.error(`READ-ONLY probe failed: ${JSON.stringify({ code: error.code || 'PROBE_FAILED', abapException: error.key || null })}`);
    process.exitCode = 1;
  } finally {
    console.log(`RFC functions called: ${JSON.stringify(rfc.getCalledFunctions())}`);
  }
}

module.exports = { createProbe, saveEvidence, FUNCTION_NAME, WANTED };
if (require.main === module) main();
