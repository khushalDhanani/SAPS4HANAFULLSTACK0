require('./live-sap-gate')();
'use strict';
/**
 * ADT deployment of the extended TR wrappers (live 241 audit, 2026-10-19):
 * adds optional IV_BETYP / IV_BENUM to Z_WM_TR_CREATE and its alias ZWM_TR_CREATE (function group Z_VENDOR_REMOTES, $TMP),
 * assigns them into the LTBA item before L_TR_CREATE, captures the real return code, activates both, then verifies the
 * ACTIVE interface over RFC (read-only). Reads the connection from .env.local (S4_DESTINATION_URL, S4_CLIENT, S4_USERNAME,
 * S4_PASSWORD). Prints statuses only - never credentials.
 *
 * WRITE to the ABAP repository of the connected system. Run only with explicit authorization:
 *   node tools/adt-extend-tr-wrapper.js
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

const root = path.resolve(__dirname, '..');
require(path.join(root, 'node_modules/dotenv')).config({ path: path.join(root, '.env.local') });

const base = (process.env.S4_DESTINATION_URL || '').replace(/\/sap\/opu\/odata.*$/i, '').replace(/\/$/, '');
const client = process.env.S4_CLIENT || '';
const auth = 'Basic ' + Buffer.from(`${process.env.S4_USERNAME}:${process.env.S4_PASSWORD}`).toString('base64');
const GRP = '/sap/bc/adt/functions/groups/Z_VENDOR_REMOTES/fmodules';

if (!base || !process.env.S4_USERNAME) {
  console.error('S4_DESTINATION_URL / S4_USERNAME missing in .env.local');
  process.exit(1);
}

let cookies = {};
let csrf = '';
const cookieHeader = () => Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
const req = async (method, p, { headers = {}, body } = {}) => {
  const url = `${base}${p}${p.includes('?') ? '&' : '?'}sap-client=${client}`;
  const r = await fetch(url, {
    method,
    headers: {
      Authorization: auth,
      'X-sap-adt-sessiontype': 'stateful',
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      ...(Object.keys(cookies).length ? { Cookie: cookieHeader() } : {}),
      ...headers
    },
    body
  });
  const setc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  for (const c of setc) {
    const [kv] = c.split(';');
    const i = kv.indexOf('=');
    if (i > 0) cookies[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
  }
  const t = r.headers.get('x-csrf-token');
  if (t && t !== 'Required') csrf = t;
  return { status: r.status, text: await r.text() };
};

// Same edits as docs/abap/z_wm_tr_create.fugr_z_vendor_remotes.abap and zwm_tr_create.fugr_z_vendor_remotes.abap
const edit = (src, fm) => {
  const nl = src.includes('\r\n') ? '\r\n' : '\n';
  let s = src.replace(/\r\n/g, '\n');
  if (/iv_betyp/i.test(s)) return null; // already extended
  const sig = "    VALUE(iv_commit) TYPE char1 DEFAULT 'X'\n";
  if (!s.includes(sig)) throw new Error(`${fm}: signature anchor not found`);
  s = s.replace(sig, sig + '    VALUE(iv_betyp) TYPE ltbk-betyp OPTIONAL\n    VALUE(iv_benum) TYPE ltbk-benum OPTIONAL\n');
  if (fm === 'Z_WM_TR_CREATE') {
    const a1 = '  ls_ltba-altme = iv_altme.\n';
    if (!s.includes(a1)) throw new Error('altme anchor');
    s = s.replace(a1, a1 + '\n  " Requirement type / number for dynamic-coordinate WM movements (T333 NKDYN):\n  " 201 -> K + cost centre, 241 -> A + asset, 261 -> F + order. BENUM is CHAR10, no conversion exit.\n  IF iv_betyp IS NOT INITIAL.\n    ls_ltba-betyp = iv_betyp.\n  ENDIF.\n  IF iv_benum IS NOT INITIAL.\n    ls_ltba-benum = iv_benum.\n  ENDIF.\n');
    const a2 = '      OTHERS                = 5.\n\n  IF sy-subrc = 0.\n    READ TABLE lt_ltba INTO ls_ltba INDEX 1.\n';
    if (!s.includes(a2)) throw new Error('subrc anchor');
    s = s.replace(a2, '      OTHERS                = 5.\n\n  DATA(lv_subrc) = sy-subrc.\n\n  IF lv_subrc = 0.\n    READ TABLE lt_ltba INTO ls_ltba INDEX 1.\n');
    const a3 = '    ev_message = |Failed to create Transfer Requirement in warehouse { iv_lgnum } (sy-subrc = { sy-subrc }).|.\n';
    if (!s.includes(a3)) throw new Error('message anchor');
    s = s.replace(a3, '    ev_message = |Failed to create Transfer Requirement in warehouse { iv_lgnum } (L_TR_CREATE exception { lv_subrc }: 1 ITEM_ERROR, 2 ITEM_WITHOUT_NUMBER, 3 NO_ENTRY_IN_INT_TABLE, 4 NO_UPDATE_ITEM_ERROR).|.\n');
  } else {
    const a1 = '      iv_commit   = iv_commit\n';
    if (!s.includes(a1)) throw new Error('alias anchor');
    s = s.replace(a1, a1 + '      iv_betyp    = iv_betyp\n      iv_benum    = iv_benum\n');
  }
  return s.replace(/\n/g, nl);
};

(async () => {
  const log = [];
  try {
    const d = await req('GET', '/sap/bc/adt/discovery', { headers: { 'X-CSRF-Token': 'Fetch', Accept: 'application/atomsvc+xml' } });
    log.push(['discovery', d.status, Boolean(csrf)]);
    for (const fm of ['Z_WM_TR_CREATE', 'ZWM_TR_CREATE']) {
      const cur = await req('GET', `${GRP}/${fm}/source/main`, { headers: { Accept: 'text/plain' } });
      if (cur.status !== 200) throw new Error(`${fm}: GET source ${cur.status}`);
      const next = edit(cur.text, fm);
      if (next === null) { log.push([fm, 'already extended, skipped']); continue; }
      fs.writeFileSync(path.join(os.tmpdir(), `adt_${fm}.new.abap`), next);
      const lock = await req('POST', `${GRP}/${fm}?_action=LOCK&accessMode=MODIFY`, { headers: { Accept: 'application/vnd.sap.as+xml;charset=UTF-8;dataname=com.sap.adt.lock.result' } });
      const h = (lock.text.match(/<LOCK_HANDLE>([^<]+)<\/LOCK_HANDLE>/) || [])[1];
      log.push([fm, 'lock', lock.status, Boolean(h), h ? '' : lock.text.replace(/\s+/g, ' ').slice(0, 300)]);
      if (!h) throw new Error(`${fm}: no lock handle`);
      const put = await req('PUT', `${GRP}/${fm}/source/main?lockHandle=${encodeURIComponent(h)}`, { headers: { 'Content-Type': 'text/plain; charset=utf-8', Accept: 'text/plain' }, body: next });
      log.push([fm, 'put', put.status, put.status >= 300 ? put.text.replace(/\s+/g, ' ').slice(0, 300) : '']);
      const unlock = await req('POST', `${GRP}/${fm}?_action=UNLOCK&lockHandle=${encodeURIComponent(h)}`);
      log.push([fm, 'unlock', unlock.status]);
      if (put.status >= 300) throw new Error(`${fm}: PUT failed ${put.status}`);
    }
    const body = `<?xml version="1.0" encoding="UTF-8"?><adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:objectReference adtcore:uri="${GRP}/Z_WM_TR_CREATE" adtcore:name="Z_WM_TR_CREATE"/><adtcore:objectReference adtcore:uri="${GRP}/ZWM_TR_CREATE" adtcore:name="ZWM_TR_CREATE"/></adtcore:objectReferences>`;
    const act = await req('POST', '/sap/bc/adt/activation?method=activate&preauditRequested=true', { headers: { 'Content-Type': 'application/xml', Accept: 'application/xml' }, body });
    log.push(['activate', act.status, act.text.replace(/\s+/g, ' ').slice(0, 600)]);
    await req('POST', '/sap/bc/adt/sessions?_action=DROP').catch(() => {});
  } catch (e) {
    log.push(['error', String(e.message).slice(0, 300)]);
  }
  console.log(JSON.stringify(log, null, 1));

  // READ-ONLY verification over RFC
  const { RfcClient } = require(path.join(root, 'srv/integration/s4hana/RfcClient'));
  const rfc = new RfcClient();
  for (const fm of ['Z_WM_TR_CREATE', 'ZWM_TR_CREATE']) {
    try {
      const names = await rfc.session(async (call) => (await call('RFC_GET_FUNCTION_INTERFACE', { FUNCNAME: fm, LANGUAGE: 'E' })).PARAMS.map((p) => `${p.PARAMETER}:${p.TABNAME || ''}${p.FIELDNAME ? '-' + p.FIELDNAME : ''}:${p.OPTIONAL || ''}`));
      console.log(fm, 'ACTIVE INTERFACE params:', names.length, 'BETYP/BENUM:', JSON.stringify(names.filter((n) => /BETYP|BENUM/.test(n))));
    } catch (e) {
      console.log(fm, 'verify error', String(e.message).slice(0, 160));
    }
  }
})();
