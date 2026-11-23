#!/usr/bin/env node
require('./live-sap-gate')();
// Read-only SAP metadata export (Step 0). Uses RFC_GET_FUNCTION_INTERFACE and RFC_READ_TABLE only.
// Prints markdown for docs/abap/system-metadata.md; a failed read prints "NOT READ" with the SAP message.
// Usage: node tools/read-system-metadata.js > /tmp/meta.md
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.local') });
const { RfcClient } = require('../srv/integration/s4hana/RfcClient');
const rfc = new RfcClient();
const out = (s = '') => console.log(s);
const notRead = (what, e) => out(`**NOT READ** (${what}): ${String(e && e.message || e).split('\n')[0]}`);
const table = (rows, cols) => {
  out(`| ${cols.join(' | ')} |`); out(`|${cols.map(() => '---').join('|')}|`);
  for (const r of rows) out(`| ${cols.map((c) => String(r[c] ?? '').replace(/\|/g, '/')).join(' | ')} |`);
};
const dd03l = async (tab, extra = []) => {
  const rows = await rfc.readTable('DD03L', ['POSITION', 'FIELDNAME', 'KEYFLAG', 'ROLLNAME', 'DOMNAME', 'DATATYPE', 'LENG'],
    [`TABNAME = '${tab}'`, "AND AS4LOCAL = 'A'", ...extra]);
  return rows.filter((r) => r.FIELDNAME && !r.FIELDNAME.startsWith('.')).sort((a, b) => Number(a.POSITION) - Number(b.POSITION));
};

(async () => {
  out(`\n*Step 0 export, ${new Date().toISOString().slice(0, 10)}, read-only via RFC_GET_FUNCTION_INTERFACE / RFC_READ_TABLE (DD03L, DD07L, DD07T, DD04T, TOBJ, TOBJT, TFDIR).*\n`);

  out('## 9. Function module interfaces (re-read)');
  for (const fm of ['Z_WM_TO_CREATE_FROM_TR', 'L_TO_CONFIRM']) {
    out(`\n### ${fm}`);
    try {
      const res = await rfc.call('RFC_GET_FUNCTION_INTERFACE', { FUNCNAME: fm, LANGUAGE: 'E' });
      table(res.PARAMS || [], ['PARAMCLASS', 'PARAMETER', 'TABNAME', 'FIELDNAME', 'EXID', 'DEFAULT', 'OPTIONAL', 'PARAMTEXT']);
    } catch (e) { notRead(fm, e); }
  }

  out('\n## 10. LTBK / LTBP / LTAP fields (DD03L)');
  const dom = {};
  for (const tab of ['LTBK', 'LTBP', 'LTAP']) {
    out(`\n### ${tab}`);
    try {
      const rows = await dd03l(tab);
      table(rows, ['POSITION', 'FIELDNAME', 'KEYFLAG', 'ROLLNAME', 'DOMNAME', 'DATATYPE', 'LENG']);
      for (const r of rows) dom[`${tab}-${r.FIELDNAME}`] = r.DOMNAME;
    } catch (e) { notRead(tab, e); }
  }

  out('\n## 11. Domain values of LTBK-STATU');
  try {
    const d = dom['LTBK-STATU'];
    if (!d) throw new Error('LTBK-STATU not in DD03L result');
    out(`Domain: \`${d}\``);
    const vals = await rfc.readTable('DD07L', ['DOMVALUE_L', 'VALPOS'], [`DOMNAME = '${d}'`, "AND AS4LOCAL = 'A'"]);
    const txt = await rfc.readTable('DD07T', ['DOMVALUE_L', 'DDTEXT'], [`DOMNAME = '${d}'`, "AND DDLANGUAGE = 'E'", "AND AS4LOCAL = 'A'"]);
    const t = Object.fromEntries(txt.map((r) => [r.DOMVALUE_L, r.DDTEXT]));
    table(vals.sort((a, b) => Number(a.VALPOS) - Number(b.VALPOS)).map((v) => ({ Value: v.DOMVALUE_L === '' ? '(space)' : v.DOMVALUE_L, Text: t[v.DOMVALUE_L] || '' })), ['Value', 'Text']);
    if (!vals.length) out('(no fixed values in DD07L)');
  } catch (e) { notRead('LTBK-STATU domain', e); }

  out('\n## 12. MARC-XCHPF and MARC-SERNP');
  try {
    const rows = await dd03l('MARC', ["AND ( FIELDNAME = 'XCHPF' OR FIELDNAME = 'SERNP' )"]);
    for (const r of rows) {
      const t = await rfc.readTable('DD04T', ['DDTEXT'], [`ROLLNAME = '${r.ROLLNAME}'`, "AND DDLANGUAGE = 'E'", "AND AS4LOCAL = 'A'"], 1);
      r.TEXT = t[0]?.DDTEXT || '';
    }
    table(rows, ['FIELDNAME', 'ROLLNAME', 'DOMNAME', 'DATATYPE', 'LENG', 'TEXT']);
  } catch (e) { notRead('MARC fields', e); }

  out('\n## 13. Text field lengths for goods movements (re-read)');
  for (const [tab, f] of [['MKPF', 'BKTXT'], ['BAPI2017_GM_ITEM_CREATE', 'ITEM_TEXT'], ['MATDOC', 'SGTXT'], ['MSEG', 'SGTXT'], ['BAPI2017_GM_HEAD_01', 'HEADER_TXT']]) {
    try {
      const rows = await dd03l(tab, [`AND FIELDNAME = '${f}'`]);
      if (!rows.length) throw new Error('no row');
      out(`- \`${tab}-${f}\`: ${rows[0].DATATYPE} ${rows[0].LENG} (data element \`${rows[0].ROLLNAME}\`)`);
    } catch (e) { notRead(`${tab}-${f}`, e); }
  }

  out('\n## 14. MATDOC cancellation / reversal fields');
  try {
    const rows = await dd03l('MATDOC');
    const hit = rows.filter((r) => /CANC|STORN|SMBLN|SJAHR|SMBLP|REVERS/.test(r.FIELDNAME));
    table(hit, ['FIELDNAME', 'ROLLNAME', 'DATATYPE', 'LENG']);
    out(`\n(MATDOC has ${rows.length} fields; TBNUM/TBPOS/PQUIT present in LTAP: ${['TBNUM', 'TBPOS', 'PQUIT', 'VORGA'].map((f) => `${f}=${dom[`LTAP-${f}`] !== undefined}`).join(', ')})`);
  } catch (e) { notRead('MATDOC fields', e); }

  out('\n## 15. Authorization objects (TOBJ / TOBJT)');
  try {
    const objs = ['L_LGNUM', 'L_TCODE', 'L_BWLVS', 'M_MSEG_BWA', 'M_MSEG_WWA', 'M_MRES_BWA', 'M_MRES_WWA'];
    const rows = [];
    for (const o of objs) {
      const r = await rfc.readTable('TOBJ', ['OBJCT', 'FIEL1', 'FIEL2', 'FIEL3', 'FIEL4', 'OCLSS'], [`OBJCT = '${o}'`], 1);
      const t = await rfc.readTable('TOBJT', ['TTEXT'], [`OBJECT = '${o}'`, "AND LANGU = 'E'"], 1);
      rows.push({ Object: o, Exists: r.length ? 'YES' : 'NO', Fields: r.length ? [r[0].FIEL1, r[0].FIEL2, r[0].FIEL3, r[0].FIEL4].filter(Boolean).join(', ') : '', Class: r[0]?.OCLSS || '', Text: t[0]?.TTEXT || '' });
    }
    table(rows, ['Object', 'Exists', 'Fields', 'Class', 'Text']);
  } catch (e) { notRead('TOBJ', e); }

  out('\n## 16. RFC-enabled check of candidate function modules (TFDIR.FMODE, R = remote-enabled)');
  try {
    const fms = ['AUTHORITY_CHECK', 'SUSR_USER_AUTH_FOR_OBJ_GET', 'ENQUEUE_EMRESB', 'DEQUEUE_EMRESB', 'RFC_GET_FUNCTION_INTERFACE', 'L_TO_CONFIRM', 'Z_WM_TO_CREATE_FROM_TR', 'Z_WM_GET_TR_MATERIAL_LIST'];
    const rows = [];
    for (const f of fms) {
      const r = await rfc.readTable('TFDIR', ['FUNCNAME', 'FMODE', 'PNAME'], [`FUNCNAME = '${f}'`], 1);
      rows.push({ FM: f, Exists: r.length ? 'YES' : 'NO', FMODE: r[0]?.FMODE ?? '', Group: r[0]?.PNAME || '' });
    }
    table(rows, ['FM', 'Exists', 'FMODE', 'Group']);
  } catch (e) { notRead('TFDIR', e); }
})().catch((e) => { notRead('script', e); process.exit(1); });
