#!/usr/bin/env node
'use strict';
/**
 * ZRF_RES_HU_DNR Discovery Script — READ-ONLY
 * Phase 1-6: Transaction identity, screen flow, tables, FMs, messages.
 * Requires: .env.local with SAP RFC credentials.
 * Usage: node tools/discover-zrf-res-hu-dnr.js 2>&1 | tee /tmp/zrf_discovery_raw.md
 */
require('./live-sap-gate')();
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.local') });

const { RfcClient } = require('../srv/integration/s4hana/RfcClient');
const rfc = new RfcClient();

const TCODE = 'ZRF_RES_HU_DNR';
const out = (s = '') => console.log(s);
const hr = () => out('\n---\n');
const h2 = (s) => out(`\n## ${s}\n`);
const h3 = (s) => out(`\n### ${s}\n`);
const notRead = (what, e) => out(`> **NOT VERIFIED** (${what}): ${String(e && e.message || e).split('\n')[0]}`);

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
  out(`# ZRF_RES_HU_DNR — SAP Discovery Output`);
  out(`\n*Generated: ${new Date().toISOString()} — READ-ONLY RFC_READ_TABLE calls only*`);
  out(`*SAP Client: ${process.env.S4_CLIENT || 'NOT SET'} — System: ${process.env.S4_SYSTEM_NAME || 'NOT SET'}*`);
  hr();

  // ============================================================
  // PHASE 1 — Transaction Identity
  // ============================================================
  h2('PHASE 1 — Transaction Identity');

  // 1.1 TSTC
  h3('1.1 TSTC — Transaction Catalog');
  let pgmna = null, dypno = null;
  try {
    const rows = await readTable('TSTC', ['TCODE', 'PGMNA', 'DYPNO', 'MENUE', 'CINFO'],
      [`TCODE = '${TCODE}'`], 1);
    if (!rows.length) {
      out(`> **BLOCKER:** Transaction \`${TCODE}\` NOT FOUND in TSTC. The transaction code may be wrong, inactive, or client-specific.`);
    } else {
      mdTable(rows, ['TCODE', 'PGMNA', 'DYPNO', 'MENUE', 'CINFO']);
      pgmna = rows[0].PGMNA;
      dypno = rows[0].DYPNO;
      out(`\n- **Program (PGMNA):** \`${pgmna}\``);
      out(`- **Initial Screen (DYPNO):** \`${dypno}\``);
    }
  } catch (e) { notRead('TSTC', e); }

  // 1.2 TADIR — Object directory entry for the program
  h3('1.2 TADIR — Object Directory');
  let devclass = null;
  try {
    const where = pgmna
      ? [`OBJ_NAME = '${pgmna}'`]
      : [`OBJ_NAME LIKE 'ZRF_RES_HU%'`];
    const rows = await readTable('TADIR',
      ['PGMID', 'OBJECT', 'OBJ_NAME', 'DEVCLASS', 'AUTHOR', 'CREATED_ON'], where, 20);
    mdTable(rows, ['PGMID', 'OBJECT', 'OBJ_NAME', 'DEVCLASS', 'AUTHOR', 'CREATED_ON']);
    if (rows.length) {
      devclass = rows[0].DEVCLASS;
      out(`\n- **Package (DEVCLASS):** \`${devclass}\``);
    }
  } catch (e) { notRead('TADIR', e); }

  // 1.3 TADIR — All Z-objects in the same package
  h3('1.3 TADIR — All ZRF_RES_HU* objects in package');
  try {
    const where = devclass
      ? [`DEVCLASS = '${devclass}'`, `AND OBJ_NAME LIKE 'ZRF_RES_HU%'`]
      : [`OBJ_NAME LIKE 'ZRF_RES_HU%'`];
    const rows = await readTable('TADIR',
      ['PGMID', 'OBJECT', 'OBJ_NAME', 'DEVCLASS', 'AUTHOR', 'CREATED_ON'], where, 100);
    mdTable(rows, ['PGMID', 'OBJECT', 'OBJ_NAME', 'DEVCLASS', 'AUTHOR', 'CREATED_ON']);
    if (!rows.length) out('*(no ZRF_RES_HU* objects in TADIR — or package different)*');
  } catch (e) { notRead('TADIR ZRF_RES_HU%', e); }

  // 1.4 TRDIR — Program attributes
  h3('1.4 TRDIR — ABAP Program Attributes');
  try {
    if (!pgmna) {
      out('> **NOT VERIFIED:** Program name unknown — TSTC read failed.');
    } else {
      const rows = await readTable('TRDIR',
        ['NAME', 'SUBC', 'RSTAT', 'CNAM', 'CDAT', 'UNAM', 'UDAT'], [`NAME = '${pgmna}'`], 1);
      mdTable(rows, ['NAME', 'SUBC', 'RSTAT', 'CNAM', 'CDAT', 'UNAM', 'UDAT']);
      if (rows[0]) {
        const typeMap = { '1': 'Executable (Type 1)', 'M': 'Module Pool', 'F': 'Function Group', 'K': 'Class', 'I': 'Include', 'J': 'Interface', 'S': 'Subroutine Pool', 'T': 'Type Pool' };
        out(`\n- **Program Type (SUBC):** ${rows[0].SUBC} = ${typeMap[rows[0].SUBC] || 'Unknown'}`);
      }
    }
  } catch (e) { notRead('TRDIR', e); }

  // ============================================================
  // PHASE 2 — Screen Flow
  // ============================================================
  h2('PHASE 2 — Screen Flow Discovery');

  // 2.1 D020T — Screen titles
  h3('2.1 D020T — Screen Titles');
  let screenNums = [];
  try {
    if (!pgmna) {
      out('> **NOT VERIFIED:** Program name unknown.');
    } else {
      const rows = await readTable('D020T',
        ['PROG', 'DNUM', 'SPRSL', 'DTXT', 'NFLDS'],
        [`PROG = '${pgmna}'`, `AND SPRSL = 'E'`], 50);
      mdTable(rows, ['PROG', 'DNUM', 'SPRSL', 'DTXT', 'NFLDS']);
      screenNums = [...new Set(rows.map((r) => r.DNUM).filter(Boolean))];
      out(`\n- **Screens found:** ${screenNums.join(', ') || '(none)'}`);
    }
  } catch (e) { notRead('D020T', e); }

  // 2.2 D020S — Screen fields
  h3('2.2 D020S — Screen Fields');
  try {
    if (!pgmna) {
      out('> **NOT VERIFIED:** Program name unknown.');
    } else {
      const rows = await readTable('D020S',
        ['PROG', 'DNUM', 'FNAM', 'FLENG', 'FTYPE', 'FLDTP', 'EDIT', 'INPUT', 'OUTPUT'],
        [`PROG = '${pgmna}'`], 500);
      mdTable(rows, ['DNUM', 'FNAM', 'FLENG', 'FTYPE', 'FLDTP', 'EDIT', 'INPUT', 'OUTPUT']);
      out(`\n- **Total screen fields:** ${rows.length}`);
    }
  } catch (e) { notRead('D020S', e); }

  // 2.3 D022S — PBO/PAI module assignments
  h3('2.3 D022S — PBO/PAI Modules');
  try {
    if (!pgmna) {
      out('> **NOT VERIFIED:** Program name unknown.');
    } else {
      const rows = await readTable('D022S',
        ['PROG', 'DNUM', 'TYPE', 'MODNAM', 'MODBEF', 'MODAFT', 'MODCOMP', 'MODCOND'],
        [`PROG = '${pgmna}'`], 200);
      mdTable(rows, ['DNUM', 'TYPE', 'MODNAM', 'MODBEF', 'MODAFT', 'MODCOMP', 'MODCOND']);
    }
  } catch (e) { notRead('D022S', e); }

  // 2.4 RFC_READ_REPORT — ABAP source
  h3('2.4 ABAP Program Source (RFC_READ_REPORT)');
  let sourceLines = [];
  try {
    if (!pgmna) {
      out('> **NOT VERIFIED:** Program name unknown — cannot read ABAP source.');
    } else {
      out(`> READ-ONLY: Calling RFC_READ_REPORT for \`${pgmna}\``);
      const res = await rfc.call('RFC_READ_REPORT', { PROGRAM: pgmna });
      sourceLines = (res.QTAB || []).map((r) => (typeof r === 'string' ? r : (r.LINE || '')));
      out(`\n- **Source lines read:** ${sourceLines.length}`);
      if (!sourceLines.length) {
        out('> **NOT VERIFIED:** RFC_READ_REPORT returned 0 lines. The program may be locked, encrypted, or the FM not available.');
      } else {
        out('\n```abap');
        // Print first 200 lines to avoid truncation; rest analysed below
        out(sourceLines.slice(0, 200).join('\n'));
        if (sourceLines.length > 200) out(`... [${sourceLines.length - 200} more lines — analysed below]`);
        out('```');
      }
    }
  } catch (e) {
    notRead('RFC_READ_REPORT', e);
    out('> **FALLBACK:** Request SE38 printout of the program from user.');
  }

  // ============================================================
  // PHASE 3 — Data Analysis from Source
  // ============================================================
  h2('PHASE 3 — Source Analysis: Tables, FMs, Messages');

  if (sourceLines.length) {
    const src = sourceLines.join('\n');

    // Extract SELECT/FROM tables
    h3('3.1 Database Tables Referenced in Source');
    const tableRefs = new Set();
    for (const m of src.matchAll(/\bSELECT\b.+?\bFROM\b\s+([A-Z][A-Z0-9_]{1,30})/gi)) tableRefs.add(m[1].toUpperCase());
    for (const m of src.matchAll(/\b(?:INSERT|UPDATE|MODIFY|DELETE)\s+(?:INTO\s+)?([A-Z][A-Z0-9_]{1,30})/gi)) tableRefs.add(m[1].toUpperCase());
    for (const m of src.matchAll(/\bTABLES\s*:\s*([A-Z][A-Z0-9_,\s]{1,200})\./gi)) {
      m[1].split(',').forEach((t) => tableRefs.add(t.trim().toUpperCase()));
    }
    const tabArr = [...tableRefs].filter((t) => t.length > 1 && !['INTO', 'FROM', 'WHERE', 'SET', 'VALUES'].includes(t)).sort();
    out(tabArr.map((t) => `- \`${t}\``).join('\n') || '*(none detected)*');

    // Extract CALL FUNCTION
    h3('3.2 Function Modules Called');
    const fmCalls = new Set();
    for (const m of src.matchAll(/CALL\s+FUNCTION\s+'([A-Z0-9/_-]+)'/gi)) fmCalls.add(m[1].toUpperCase());
    const fmArr = [...fmCalls].sort();
    out(fmArr.map((f) => `- \`${f}\``).join('\n') || '*(none detected)*');

    // Extract MESSAGE statements
    h3('3.3 MESSAGE Statements (raw)');
    const msgLines = sourceLines.filter((l) => /^\s*MESSAGE\s+/i.test(l));
    out(msgLines.map((l) => `- \`${l.trim()}\``).join('\n') || '*(none detected)*');

    // Extract PERFORM subroutines
    h3('3.4 PERFORM / Method Calls');
    const performs = new Set();
    for (const m of src.matchAll(/\bPERFORM\s+([A-Z0-9_]+)/gi)) performs.add(m[1].toUpperCase());
    for (const m of src.matchAll(/\bCALL\s+METHOD\s+([A-Z0-9_>-]+)/gi)) performs.add(m[1].toUpperCase());
    const perfArr = [...performs].sort();
    out(perfArr.map((p) => `- \`${p}\``).join('\n') || '*(none detected)*');

    // Check for HU-specific keywords
    h3('3.5 HU / Reservation / Delivery Keywords in Source');
    const keywords = ['BAPI_HU', 'HU_', 'VEKP', 'VEPO', 'SER06', 'BAPI_RESERVATION', 'RESB', 'LIKP', 'LIPS',
      'MB_CREATE_RESERVATION', 'WM_RF', 'BAPI_GOODSMVT', 'LTAK', 'LTAP', 'LQUA', 'T320'];
    for (const kw of keywords) {
      const hits = sourceLines.filter((l) => l.toUpperCase().includes(kw));
      if (hits.length) {
        out(`\n**\`${kw}\`** — ${hits.length} occurrence(s):`);
        hits.slice(0, 5).forEach((l) => out(`  - \`${l.trim()}\``));
        if (hits.length > 5) out(`  - *(${hits.length - 5} more)*`);
      }
    }

    // Print full source after analysis section
    h3('3.6 Full ABAP Source (all lines)');
    out('\n```abap');
    out(sourceLines.join('\n'));
    out('```');

  } else {
    out('> **NOT VERIFIED:** Source lines not available — skipping source analysis.');
    out('> All FM, table, and message findings below are NOT VERIFIED.');
  }

  // ============================================================
  // PHASE 4 — Custom Tables (DD02L / DD03L)
  // ============================================================
  h2('PHASE 4 — Custom Z-Tables (DD02L / DD03L)');

  h3('4.1 DD02L — Custom Z-Tables matching ZRF_RES_HU* / ZHU* / ZRES*');
  let zTables = [];
  try {
    const rows = await readTable('DD02L',
      ['TABNAME', 'TABCLASS', 'CLIDEP', 'CONTFLAG', 'APPCLASS'],
      [`( TABNAME LIKE 'ZRF_RES_HU%' OR TABNAME LIKE 'ZHU%' OR TABNAME LIKE 'ZRES%' )`], 50);
    mdTable(rows, ['TABNAME', 'TABCLASS', 'CLIDEP', 'CONTFLAG', 'APPCLASS']);
    zTables = rows.map((r) => r.TABNAME).filter(Boolean);
    if (!rows.length) out('*(no matching Z-tables found in DD02L)*');
  } catch (e) { notRead('DD02L', e); }

  h3('4.2 DD03L — Fields of discovered Z-tables');
  if (zTables.length) {
    for (const tab of zTables) {
      h3(`Table: ${tab}`);
      try {
        const rows = await readTable('DD03L',
          ['FIELDNAME', 'KEYFLAG', 'DATATYPE', 'LENG', 'DECIMALS', 'DOMNAME', 'REFTABLE', 'REFFIELD'],
          [`TABNAME = '${tab}'`, `AND AS4LOCAL = 'A'`], 200);
        mdTable(rows, ['FIELDNAME', 'KEYFLAG', 'DATATYPE', 'LENG', 'DECIMALS', 'DOMNAME', 'REFTABLE', 'REFFIELD']);
      } catch (e) { notRead(`DD03L for ${tab}`, e); }
    }
  } else {
    out('*(no custom Z-tables found — skipping DD03L reads)*');
  }

  // ============================================================
  // PHASE 5 — FM RFC-Enablement (TFDIR)
  // ============================================================
  h2('PHASE 5 — FM RFC-Enablement (TFDIR)');

  // Build FM list from source analysis + known HU BAPIs
  const knownFMs = [
    'BAPI_HU_CREATE', 'BAPI_HU_PACK', 'BAPI_HU_UNPACK', 'BAPI_HU_DELETE', 'BAPI_HU_GETLIST',
    'BAPI_RESERVATION_CREATE1', 'MB_CREATE_RESERVATION',
    'BAPI_GOODSMVT_CREATE', 'BAPI_GOODSMVT_CANCEL',
    'RFC_READ_REPORT', 'RFC_GET_FUNCTION_INTERFACE',
    'WM_RF_UI_HU_PACK_01', 'WM_RF_UI_HU_RESERVATION',
    'BAPI_TRANSACTION_COMMIT', 'BAPI_TRANSACTION_ROLLBACK'
  ];

  try {
    const rows = [];
    for (const f of knownFMs) {
      const r = await readTable('TFDIR', ['FUNCNAME', 'FMODE', 'PNAME'],
        [`FUNCNAME = '${f}'`], 1);
      rows.push({
        FM: f,
        Exists: r.length ? 'YES' : 'NO',
        FMODE: r[0]?.FMODE ?? '—',
        'RFC-Enabled': r[0]?.FMODE === 'R' ? '✅ YES' : r.length ? 'NO' : 'NOT FOUND',
        Group: r[0]?.PNAME || ''
      });
    }
    mdTable(rows, ['FM', 'Exists', 'FMODE', 'RFC-Enabled', 'Group']);
  } catch (e) { notRead('TFDIR', e); }

  // ============================================================
  // PHASE 6 — Messages (T100)
  // ============================================================
  h2('PHASE 6 — Messages (T100)');

  // Extract message classes from source
  const msgClasses = new Set();
  for (const m of sourceLines.join('\n').matchAll(/MESSAGE\s+[A-Z]\d+\(([A-Z0-9_]+)\)/gi)) {
    msgClasses.add(m[1].toUpperCase());
  }
  for (const m of sourceLines.join('\n').matchAll(/MESSAGE\s+ID\s+'([A-Z0-9_]+)'/gi)) {
    msgClasses.add(m[1].toUpperCase());
  }

  // Always check ZRF-related classes as candidates
  ['ZRF', 'ZWM', 'ZRES', 'ZHU', 'LR', 'LL', 'WM'].forEach((c) => msgClasses.add(c));

  h3(`6.1 T100 — Message Texts for classes: ${[...msgClasses].join(', ')}`);
  try {
    for (const cls of [...msgClasses]) {
      const rows = await readTable('T100', ['SPRSL', 'ARBGB', 'MSGNR', 'TEXT'],
        [`ARBGB = '${cls}'`, `AND SPRSL = 'E'`], 100);
      if (rows.length) {
        h3(`Message Class: ${cls}`);
        mdTable(rows, ['ARBGB', 'MSGNR', 'TEXT']);
      }
    }
  } catch (e) { notRead('T100', e); }

  // ============================================================
  // PHASE 7 — Transaction text / TSTCT
  // ============================================================
  h2('PHASE 7 — Transaction Description (TSTCT)');
  try {
    const rows = await readTable('TSTCT', ['SPRSL', 'TCODE', 'TTEXT'],
      [`TCODE = '${TCODE}'`], 5);
    mdTable(rows, ['SPRSL', 'TCODE', 'TTEXT']);
    if (!rows.length) out('*(no TSTCT entry)*');
  } catch (e) { notRead('TSTCT', e); }

  // ============================================================
  // PHASE 8 — Related transactions (TSTC LIKE)
  // ============================================================
  h2('PHASE 8 — Related Transactions (ZRF_RES_HU*)');
  try {
    const rows = await readTable('TSTC', ['TCODE', 'PGMNA', 'DYPNO'],
      [`TCODE LIKE 'ZRF_RES_HU%'`], 20);
    mdTable(rows, ['TCODE', 'PGMNA', 'DYPNO']);
    if (!rows.length) out('*(no related ZRF_RES_HU* transactions found)*');
  } catch (e) { notRead('TSTC LIKE ZRF_RES_HU%', e); }

  // ============================================================
  // Summary
  // ============================================================
  hr();
  out('## Discovery Summary');
  out(`\n- Transaction: \`${TCODE}\``);
  out(`- Program: \`${pgmna || 'NOT FOUND'}\``);
  out(`- Package: \`${devclass || 'NOT FOUND'}\``);
  out(`- Initial Screen: \`${dypno || 'NOT FOUND'}\``);
  out(`- Source lines read: ${sourceLines.length}`);
  out(`\n*Run completed: ${new Date().toISOString()}*`);
  out('\n> All reads above are READ-ONLY (RFC_READ_TABLE + RFC_READ_REPORT). No writes were made.');

})().catch((e) => {
  out(`\n> **SCRIPT ERROR:** ${e.message}`);
  process.exit(1);
});
