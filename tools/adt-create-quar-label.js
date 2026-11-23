'use strict';
/**
 * ADT creation and activation of function group ZMM_QUAR_LABEL with Z_MM_QUAR_LABEL_DATA (normal) and
 * Z_MM_QUAR_LABEL_PDF (RFC), source docs/abap/z_mm_quar_label.fugr.abap (review: docs/zquaran-pdf-wrapper.md).
 *
 * WRITE to the ABAP repository of the connected system. Run only with explicit written authorization:
 *   ALLOW_LIVE_SAP_TOOLS=1 node tools/adt-create-quar-label.js --allow-live-sap --package '$TMP'
 *   ALLOW_LIVE_SAP_TOOLS=1 node tools/adt-create-quar-label.js --allow-live-sap --package ZAMM --transport <TRKORR>
 *
 * Creates only: refuses if the group or either module already exists (never overwrites). Renders nothing:
 * verification is READ-ONLY (TFDIR, RFC_GET_FUNCTION_INTERFACE). The function-group create payload follows the
 * standard ADT format and has no precedent in this repo (Not verified): any non-2xx answer stops the run.
 */
const path = require('path');
const fs = require('fs');

const root = path.resolve(__dirname, '..');
const GROUP = 'ZMM_QUAR_LABEL';
const MODULES = [
  { name: 'Z_MM_QUAR_LABEL_DATA', rfc: false, description: 'Quarantine label rows (ZQUARAN)' },
  { name: 'Z_MM_QUAR_LABEL_PDF', rfc: true, description: 'Quarantine labels as PDF (ZQUARAN, RFC)' }
];
const SOURCE = path.join(root, 'docs/abap/z_mm_quar_label.fugr.abap');

function parseArgs(argv) {
  const val = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
  const pkg = val('--package');
  const transport = val('--transport');
  if (pkg !== '$TMP' && pkg !== 'ZAMM') throw new Error("--package must be '$TMP' or ZAMM");
  if (pkg === 'ZAMM' && !/^[A-Z0-9]{3}K\d{6}$/.test(transport || '')) throw new Error('--transport <TRKORR> is required for ZAMM');
  if (pkg === '$TMP' && transport) throw new Error('$TMP objects take no transport');
  return { pkg, transport };
}

/** One module from the proposal file, with the SE37 `*"` signature block turned into the inline signature ADT expects. */
function toAdtSource(full, fm) {
  const m = full.match(new RegExp(`^FUNCTION ${fm.toLowerCase()}\\.\\n([\\s\\S]*?)^ENDFUNCTION\\.`, 'm'));
  if (!m) throw new Error(`${fm} not found in source`);
  const lines = m[1].split('\n');
  const sig = [];
  let i = 0;
  for (; i < lines.length && lines[i].startsWith('*"'); i++) {
    const l = lines[i].slice(2).replace(/".*$/, '').trim();
    if (!l || /^-+$/.test(l)) continue;
    sig.push(/^(IMPORTING|EXPORTING|CHANGING|TABLES|EXCEPTIONS)$/.test(l) ? `  ${l}` : `    ${l.replace(/\s+/g, ' ')}`);
  }
  if (!sig.length) throw new Error(`${fm} has no signature block`);
  return `FUNCTION ${fm.toLowerCase()}\n${sig.join('\n')}.\n${lines.slice(i).join('\n')}ENDFUNCTION.\n`;
}

async function main() {
  require('./live-sap-gate')();
  const { pkg, transport } = parseArgs(process.argv);
  require(path.join(root, 'node_modules/dotenv')).config({ path: path.join(root, '.env.local') });
  const base = (process.env.S4_DESTINATION_URL || '').replace(/\/sap\/opu\/odata.*$/i, '').replace(/\/$/, '');
  const client = process.env.S4_CLIENT || '';
  if (!base || !process.env.S4_USERNAME) throw new Error('S4_DESTINATION_URL / S4_USERNAME missing in .env.local');
  const auth = 'Basic ' + Buffer.from(`${process.env.S4_USERNAME}:${process.env.S4_PASSWORD}`).toString('base64');
  const full = fs.readFileSync(SOURCE, 'utf8');
  const sources = Object.fromEntries(MODULES.map((x) => [x.name, toAdtSource(full, x.name)]));
  const corr = transport ? `corrNr=${transport}` : '';
  const GRP = `/sap/bc/adt/functions/groups/${GROUP.toLowerCase()}`;

  const cookies = {};
  let csrf = '';
  const req = async (method, p, { headers = {}, body } = {}) => {
    const url = `${base}${p}${p.includes('?') ? '&' : '?'}sap-client=${client}`;
    const r = await fetch(url, {
      method,
      headers: {
        Authorization: auth,
        'X-sap-adt-sessiontype': 'stateful',
        ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
        ...(Object.keys(cookies).length ? { Cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
        ...headers
      },
      body
    });
    for (const c of (r.headers.getSetCookie ? r.headers.getSetCookie() : [])) {
      const [kv] = c.split(';');
      const i = kv.indexOf('=');
      if (i > 0) cookies[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
    }
    const t = r.headers.get('x-csrf-token');
    if (t && t !== 'Required') csrf = t;
    return { status: r.status, text: await r.text() };
  };
  const must = (res, what) => {
    console.log(`${what}: HTTP ${res.status}`);
    if (res.status >= 300) throw new Error(`${what} failed: ${res.text.slice(0, 2000)}`);
    return res;
  };
  const withCorr = (p) => (corr ? `${p}${p.includes('?') ? '&' : '?'}${corr}` : p);

  console.log(`WRITE: create ${GROUP} (${MODULES.map((x) => x.name).join(', ')}) in package ${pkg}${transport ? `, transport ${transport}` : ''}`);
  must(await req('GET', '/sap/bc/adt/discovery', { headers: { 'X-CSRF-Token': 'Fetch', Accept: 'application/atomsvc+xml' } }), 'CSRF');

  // Create-only: stop before any write if something already exists
  if ((await req('GET', GRP)).status === 200) throw new Error(`${GROUP} already exists; this tool never overwrites`);

  try {
    must(await req('POST', withCorr('/sap/bc/adt/functions/groups'), {
      headers: { 'Content-Type': 'application/vnd.sap.adt.functions.groups.v3+xml', Accept: 'application/vnd.sap.adt.functions.groups.v3+xml' },
      body: `<?xml version="1.0" encoding="utf-8"?>
<group:abapFunctionGroup xmlns:group="http://www.sap.com/adt/functions/groups" xmlns:adtcore="http://www.sap.com/adt/core"
  adtcore:name="${GROUP}" adtcore:type="FUGR/F" adtcore:description="ZQUARAN quarantine labels (PDF)">
  <adtcore:packageRef adtcore:name="${pkg}"/>
</group:abapFunctionGroup>`
    }), `POST group ${GROUP}`);

    for (const fm of MODULES) {
      const uri = `${GRP}/fmodules/${fm.name.toLowerCase()}`;
      const meta = `<?xml version="1.0" encoding="utf-8"?>
<fmodule:abapFunctionModule xmlns:fmodule="http://www.sap.com/adt/functions/fmodules" xmlns:adtcore="http://www.sap.com/adt/core"
  adtcore:name="${fm.name}" adtcore:type="FUGR/FF" adtcore:description="${fm.description}"${fm.rfc ? ' fmodule:processingType="rfc"' : ''}>
  <adtcore:containerRef adtcore:uri="${GRP}" adtcore:type="FUGR/F" adtcore:name="${GROUP}" adtcore:packageName="${pkg}"/>
</fmodule:abapFunctionModule>`;
      const fmHeaders = { 'Content-Type': 'application/vnd.sap.adt.functions.fmodules.v3+xml', Accept: 'application/vnd.sap.adt.functions.fmodules.v3+xml' };
      must(await req('POST', withCorr(`${GRP}/fmodules`), { headers: fmHeaders, body: meta }), `POST ${fm.name}`);
      const lock = must(await req('POST', `${uri}?_action=LOCK&accessMode=MODIFY`, {
        headers: { Accept: 'application/vnd.sap.as+xml;charset=UTF-8;dataname=com.sap.adt.lock.result' }
      }), `LOCK ${fm.name}`);
      const h = (lock.text.match(/<LOCK_HANDLE>([^<]+)<\/LOCK_HANDLE>/) || [])[1];
      if (!h) throw new Error(`no lock handle for ${fm.name}`);
      try {
        const lh = `lockHandle=${encodeURIComponent(h)}`;
        if (fm.rfc) must(await req('PUT', withCorr(`${uri}?${lh}`), { headers: fmHeaders, body: meta }), `PUT ${fm.name} metadata (RFC)`);
        must(await req('PUT', withCorr(`${uri}/source/main?${lh}`), {
          headers: { 'Content-Type': 'text/plain; charset=utf-8', Accept: 'text/plain' },
          body: sources[fm.name]
        }), `PUT ${fm.name} source`);
      } finally {
        await req('POST', `${uri}?_action=UNLOCK&lockHandle=${encodeURIComponent(h)}`);
      }
    }

    const refs = [{ uri: GRP, name: GROUP }, ...MODULES.map((x) => ({ uri: `${GRP}/fmodules/${x.name.toLowerCase()}`, name: x.name }))]
      .map((r) => `<adtcore:objectReference adtcore:uri="${r.uri}" adtcore:name="${r.name}"/>`).join('');
    const act = must(await req('POST', '/sap/bc/adt/activation?method=activate&preauditRequested=true', {
      headers: { 'Content-Type': 'application/xml', Accept: 'application/xml' },
      body: `<?xml version="1.0" encoding="UTF-8"?><adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">${refs}</adtcore:objectReferences>`
    }), 'Activation');
    // ADT answers 200 with a message list when activation has errors
    if (/type="E"|<msg[^>]*type="E"/.test(act.text)) throw new Error(`activation reported errors: ${act.text.slice(0, 4000)}`);
  } finally {
    await req('POST', '/sap/bc/adt/sessions?_action=DROP').catch(() => {});
  }

  console.log('READ-ONLY verification over RFC...');
  const { RfcClient } = require(path.join(root, 'srv/integration/s4hana/RfcClient'));
  const rfc = new RfcClient();
  const rows = await rfc.readTable('TFDIR', ['FUNCNAME', 'FMODE'], [`FUNCNAME LIKE 'Z_MM_QUAR_LABEL%'`]);
  console.log('TFDIR:', JSON.stringify(rows));
  const pdf = rows.find((r) => r.FUNCNAME.trim() === 'Z_MM_QUAR_LABEL_PDF');
  if (!pdf || pdf.FMODE.trim() !== 'R') throw new Error('Z_MM_QUAR_LABEL_PDF is not active and remote-enabled');
  const iface = await rfc.call('RFC_GET_FUNCTION_INTERFACE', { FUNCNAME: 'Z_MM_QUAR_LABEL_PDF', LANGUAGE: 'E' });
  for (const p of iface.PARAMS || []) console.log(`  ${p.PARAMCLASS} ${p.PARAMETER} ${p.TABNAME || ''}${p.FIELDNAME ? '-' + p.FIELDNAME : ''} optional=${p.OPTIONAL}`);
}

if (require.main === module) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}

module.exports = { parseArgs, toAdtSource };
