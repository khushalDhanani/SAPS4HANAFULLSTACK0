#!/usr/bin/env node
'use strict';
/**
 * ZRF_RES_HU_DNR — ABAP Source & Dynpro Deep Dive — READ-ONLY
 * Uses SYST_BAPI_GETDETAIL / FUNCTION_IMPORT_INTERFACE and alternate RFC_READ_REPORT variant.
 * Also reads REPOSRC (source repository), INCLUDES via TRDIR, and tries available source-read FMs.
 */
require('./live-sap-gate')();
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.local') });

const { RfcClient } = require('../srv/integration/s4hana/RfcClient');
const rfc = new RfcClient();
const PROG = 'ZRF_RES_HU_TRANSFER_DNR';
const out = (s = '') => console.log(s);
const notRead = (what, e) => out(`> **NOT VERIFIED** (${what}): ${String(e && e.message || e).split('\n')[0]}`);
const h2 = (s) => out(`\n## ${s}\n`);
const h3 = (s) => out(`\n### ${s}\n`);

function mdTable(rows, cols) {
  if (!rows || !rows.length) { out('*(no rows)*'); return; }
  out(`| ${cols.join(' | ')} |`);
  out(`|${cols.map(() => '---').join('|')}|`);
  for (const r of rows) {
    out(`| ${cols.map((c) => String(r[c] ?? '').replace(/\|/g, '/').replace(/\n/g, ' ').trim()).join(' | ')} |`);
  }
}

async function readTable(table, fields, where = [], max = 9999) {
  return rfc.readTable(table, fields, where, max);
}

(async () => {
  out(`# ZRF_RES_HU_DNR — ABAP Source & Dynpro Deep Dive`);
  out(`*${new Date().toISOString()} — READ-ONLY*\n`);

  // ── Try 1: REPOSRC (ABAP source repository table) ──────────────────────────
  h2('A. REPOSRC — ABAP Source Repository Table');
  let sourceLines = [];
  try {
    const rows = await readTable('REPOSRC', ['PROG', 'REMO', 'LINE'],
      [`PROG = '${PROG}'`], 5000);
    out(`- Rows returned: ${rows.length}`);
    if (rows.length) {
      // REPOSRC stores source lines in LINE field, REMO is line number
      const sorted = rows.sort((a, b) => Number(a.REMO || 0) - Number(b.REMO || 0));
      sourceLines = sorted.map((r) => r.LINE || '');
      out('\n```abap');
      out(sourceLines.join('\n'));
      out('```');
    } else {
      out('*(no rows returned — program may have no source in REPOSRC or access denied)*');
    }
  } catch (e) { notRead('REPOSRC', e); }

  // ── Try 2: INCLUDE list from TRDIR (all programs in ZRF_RES_HU* group) ─────
  h2('B. TRDIR — Program & Include List for ZAMM package / ZRF_RES_HU*');
  let includes = [];
  try {
    const rows = await readTable('TRDIR', ['NAME', 'SUBC', 'CNAM', 'CDAT', 'UNAM', 'UDAT'],
      [`NAME LIKE 'ZRF_RES_HU%'`], 50);
    mdTable(rows, ['NAME', 'SUBC', 'CNAM', 'CDAT', 'UNAM', 'UDAT']);
    includes = rows.map((r) => r.NAME).filter(Boolean);
    out(`\n- Programs/Includes found: ${includes.join(', ') || '(none)'}`);
  } catch (e) { notRead('TRDIR ZRF_RES_HU%', e); }

  // ── Try 3: Read REPOSRC for each include ───────────────────────────────────
  if (includes.length > 1) {
    h2('C. REPOSRC — Source of each ZRF_RES_HU* include');
    for (const inc of includes) {
      if (inc === PROG) continue;
      h3(`Include: ${inc}`);
      try {
        const rows = await readTable('REPOSRC', ['PROG', 'REMO', 'LINE'],
          [`PROG = '${inc}'`], 2000);
        if (rows.length) {
          const sorted = rows.sort((a, b) => Number(a.REMO || 0) - Number(b.REMO || 0));
          const lines = sorted.map((r) => r.LINE || '');
          out('\n```abap');
          out(lines.join('\n'));
          out('```');
        } else {
          out('*(no rows)*');
        }
      } catch (e) { notRead(`REPOSRC ${inc}`, e); }
    }
  }

  // ── Try 4: D020S screen fields via different WHERE ─────────────────────────
  h2('D. Screen Fields — D020S (broader read)');
  try {
    // Try without SPRSL constraint
    const rows = await readTable('D020S',
      ['PROG', 'DNUM', 'FNAM', 'FLENG', 'FTYPE', 'FLDTP', 'EDIT', 'INPUT', 'OUTPUT'],
      [`PROG = '${PROG}'`], 999);
    out(`- Rows returned: ${rows.length}`);
    mdTable(rows, ['DNUM', 'FNAM', 'FLENG', 'FTYPE', 'FLDTP', 'EDIT', 'INPUT', 'OUTPUT']);
  } catch (e) {
    notRead('D020S direct', e);
    // Try with DNUM
    try {
      const rows1000 = await readTable('D020S',
        ['PROG', 'DNUM', 'FNAM', 'FLENG', 'FTYPE'],
        [`PROG = '${PROG}'`, `AND DNUM = '1000'`], 200);
      out(`Screen 1000 fields: ${rows1000.length}`);
      mdTable(rows1000, ['DNUM', 'FNAM', 'FLENG', 'FTYPE']);
    } catch (e2) { notRead('D020S screen 1000', e2); }
  }

  // ── Try 5: D020T screen titles ─────────────────────────────────────────────
  h2('E. Screen Titles — D020T');
  try {
    const rows = await readTable('D020T', ['PROG', 'DNUM', 'SPRSL', 'DTXT', 'NFLDS'],
      [`PROG = '${PROG}'`], 20);
    out(`- Rows returned: ${rows.length}`);
    mdTable(rows, ['PROG', 'DNUM', 'SPRSL', 'DTXT', 'NFLDS']);
  } catch (e) { notRead('D020T', e); }

  // ── Try 6: D022S PBO/PAI modules ──────────────────────────────────────────
  h2('F. PBO/PAI Modules — D022S');
  try {
    const rows = await readTable('D022S',
      ['PROG', 'DNUM', 'TYPE', 'MODNAM', 'MODBEF', 'MODAFT', 'MODCOMP'],
      [`PROG = '${PROG}'`], 100);
    out(`- Rows returned: ${rows.length}`);
    mdTable(rows, ['DNUM', 'TYPE', 'MODNAM', 'MODBEF', 'MODAFT', 'MODCOMP']);
  } catch (e) { notRead('D022S', e); }

  // ── Try 7: D021S — flow logic (alternate to D022S) ─────────────────────────
  h2('G. Flow Logic — D021S');
  try {
    const rows = await readTable('D021S', ['PROG', 'DNUM', 'LINNO', 'LINE'],
      [`PROG = '${PROG}'`], 500);
    out(`- Rows returned: ${rows.length}`);
    if (rows.length) {
      const sorted = rows.sort((a, b) => Number(a.DNUM || 0) - Number(b.DNUM || 0) || Number(a.LINNO || 0) - Number(b.LINNO || 0));
      out('\n```abap');
      sorted.forEach((r) => out(`[Screen ${r.DNUM}] ${r.LINE}`));
      out('```');
    }
  } catch (e) { notRead('D021S', e); }

  // ── Try 8: TADIR full package ZAMM listing ─────────────────────────────────
  h2('H. Full ZAMM Package — All Objects (TADIR)');
  try {
    const rows = await readTable('TADIR',
      ['PGMID', 'OBJECT', 'OBJ_NAME', 'DEVCLASS', 'AUTHOR', 'CREATED_ON'],
      [`DEVCLASS = 'ZAMM'`], 200);
    mdTable(rows, ['PGMID', 'OBJECT', 'OBJ_NAME', 'AUTHOR', 'CREATED_ON']);
    out(`\n- Total ZAMM objects: ${rows.length}`);
  } catch (e) { notRead('TADIR ZAMM', e); }

  // ── Try 9: Function module source reader via RFC call ──────────────────────
  h2('I. Try RFC_READ_REPORT alternate (with PROGRAM parameter)');
  try {
    // Some systems expose this as SYST_READ_PROGRAM
    const res = await rfc.call('SYST_READ_PROGRAM', { PROGRAM: PROG });
    const lines = (res.SOURCE || res.QTAB || res.PROGRAM_SOURCE || []).map((r) =>
      typeof r === 'string' ? r : (r.LINE || r.QTAB || ''));
    out(`- Lines: ${lines.length}`);
    if (lines.length) {
      out('\n```abap');
      out(lines.join('\n'));
      out('```');
    }
  } catch (e) { notRead('SYST_READ_PROGRAM', e); }

  // ── Try 10: WB_OBJECT_GET_ATTRIBUTES ──────────────────────────────────────
  h2('J. WB_OBJECT_GET_ATTRIBUTES — Program metadata');
  try {
    const res = await rfc.call('WB_OBJECT_GET_ATTRIBUTES', {
      OBJECT_TYPE: 'PROG', OBJECT_NAME: PROG
    });
    out('```json');
    out(JSON.stringify(res, null, 2).slice(0, 3000));
    out('```');
  } catch (e) { notRead('WB_OBJECT_GET_ATTRIBUTES', e); }

  // ── Try 11: RFC_GET_FUNCTION_INTERFACE on ZRF custom FMs ──────────────────
  h2('K. Check for custom ZRF/ZAMM function modules in TFDIR');
  try {
    const rows = await readTable('TFDIR', ['FUNCNAME', 'FMODE', 'PNAME'],
      [`FUNCNAME LIKE 'Z%HU%'`], 50);
    mdTable(rows, ['FUNCNAME', 'FMODE', 'PNAME']);
    if (!rows.length) out('*(no Z*HU* FMs in TFDIR)*');
  } catch (e) { notRead('TFDIR Z*HU*', e); }

  try {
    const rows = await readTable('TFDIR', ['FUNCNAME', 'FMODE', 'PNAME'],
      [`FUNCNAME LIKE 'Z%RES%'`], 50);
    mdTable(rows, ['FUNCNAME', 'FMODE', 'PNAME']);
    if (!rows.length) out('*(no Z*RES* FMs in TFDIR)*');
  } catch (e) { notRead('TFDIR Z*RES*', e); }

  // ── Try 12: DD02L for ZAMM custom tables ──────────────────────────────────
  h2('L. DD02L — All custom tables in ZAMM package');
  try {
    // First get all TADIR objects of type TABL in ZAMM
    const tadirTabs = await readTable('TADIR', ['OBJ_NAME'],
      [`DEVCLASS = 'ZAMM'`, `AND OBJECT = 'TABL'`], 50);
    const zTables = tadirTabs.map((r) => r.OBJ_NAME).filter(Boolean);
    out(`- Custom tables in ZAMM: ${zTables.join(', ') || '(none)'}`);
    for (const tab of zTables) {
      h3(`DD03L — ${tab}`);
      try {
        const fields = await readTable('DD03L',
          ['FIELDNAME', 'KEYFLAG', 'DATATYPE', 'LENG', 'DECIMALS', 'DOMNAME', 'REFTABLE', 'REFFIELD'],
          [`TABNAME = '${tab}'`, `AND AS4LOCAL = 'A'`], 100);
        mdTable(fields, ['FIELDNAME', 'KEYFLAG', 'DATATYPE', 'LENG', 'DECIMALS', 'DOMNAME', 'REFTABLE', 'REFFIELD']);
      } catch (e2) { notRead(`DD03L ${tab}`, e2); }
    }
    if (!zTables.length) {
      out('*(no TABL objects in ZAMM — Z-tables may be in a different package or do not exist)*');
    }
  } catch (e) { notRead('TADIR TABL ZAMM', e); }

  // ── Try 13: TSTCT for all ZRF* transactions ────────────────────────────────
  h2('M. TSTCT — All ZRF* transaction descriptions');
  try {
    const rows = await readTable('TSTCT', ['SPRSL', 'TCODE', 'TTEXT'],
      [`TCODE LIKE 'ZRF%'`, `AND SPRSL = 'E'`], 50);
    mdTable(rows, ['TCODE', 'TTEXT']);
  } catch (e) { notRead('TSTCT ZRF*', e); }

  // ── Try 14: TSTC for all ZRF* transactions ────────────────────────────────
  h2('N. TSTC — All ZRF* transactions');
  try {
    const rows = await readTable('TSTC', ['TCODE', 'PGMNA', 'DYPNO'],
      [`TCODE LIKE 'ZRF%'`], 50);
    mdTable(rows, ['TCODE', 'PGMNA', 'DYPNO']);
  } catch (e) { notRead('TSTC ZRF%', e); }

  out('\n---\n');
  out(`*Completed: ${new Date().toISOString()} — READ-ONLY only. No writes.*`);

})().catch((e) => { out(`\n> **FATAL:** ${e.message}`); process.exit(1); });
