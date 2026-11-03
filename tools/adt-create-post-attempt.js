'use strict';
/**
 * ADT creation and activation of table ZWM_POST_ATTEMPT and function group ZWM_POST_ATTEMPT with its three RFC modules,
 * source docs/abap/zwm_post_attempt.* (design and live proof: docs/decisions/sap-only-persistence-migration.md).
 *
 * WRITE to the ABAP repository of the connected system. Run only with explicit written authorization:
 *   ALLOW_LIVE_SAP_TOOLS=1 node tools/adt-create-post-attempt.js --allow-live-sap --package ZAMM --transport <TRKORR>
 * --print-only prints what would be sent and makes no SAP call.
 *
 * The request must be open and owned by the connected user, or hold a task for that user.
 * Creates only: refuses if an object already exists (never overwrites). A run that stops halfway leaves what it made
 * so far on the request; nothing is deleted. Verification is READ-ONLY (DD02L, DD03L, TFDIR) and calls no module.
 * The table collection and media type are listed in docs/wm-discovery/adt_discovery.xml; the create payload has no precedent
 * in this repo (Not verified): any non-2xx answer stops.
 */
const path = require('path');
const fs = require('fs');
const { toAdtSource } = require('./adt-create-quar-label');

const root = path.resolve(__dirname, '..');
const TABLE = 'ZWM_POST_ATTEMPT';
const GROUP = 'ZWM_POST_ATTEMPT';
const MODULES = [
  { name: 'Z_WM_ATTEMPT_CLAIM', description: 'Claim a posting attempt (RFC)' },
  { name: 'Z_WM_ATTEMPT_SET_STATUS', description: 'Set posting attempt status (RFC)' },
  { name: 'Z_WM_ATTEMPT_READ', description: 'Read posting attempts (RFC)' }
];
const TABLE_SOURCE = path.join(root, 'docs/abap/zwm_post_attempt.tabl.ddl');
const GROUP_SOURCE = path.join(root, 'docs/abap/zwm_post_attempt.fugr.abap');
const TABLES = '/sap/bc/adt/ddic/tables';
const GROUPS = '/sap/bc/adt/functions/groups';

function parseArgs(argv) {
  const val = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
  const pkg = val('--package');
  const transport = val('--transport');
  if (pkg !== 'ZAMM') throw new Error('--package must be ZAMM');
  if (!/^[A-Z0-9]{3}K\d{6}$/.test(transport || '')) throw new Error('--transport <TRKORR> is required');
  return { pkg, transport, printOnly: argv.includes('--print-only') };
}

/** The table definition without the file's leading notes: the source starts at the first annotation. */
function tableSource(text) {
  const start = text.indexOf('@EndUserText.label');
  if (start < 0 || !/define table zwm_post_attempt \{/.test(text)) throw new Error('table definition not found in source');
  return text.slice(start);
}

const tableXml = (pkg) => `<?xml version="1.0" encoding="utf-8"?>
<blue:blueSource xmlns:blue="http://www.sap.com/wbobj/blue" xmlns:adtcore="http://www.sap.com/adt/core"
  adtcore:name="${TABLE}" adtcore:type="TABL/DT" adtcore:description="WM posting attempts (double-post guard)">
  <adtcore:packageRef adtcore:name="${pkg}"/>
</blue:blueSource>`;

const groupXml = (pkg) => `<?xml version="1.0" encoding="utf-8"?>
<group:abapFunctionGroup xmlns:group="http://www.sap.com/adt/functions/groups" xmlns:adtcore="http://www.sap.com/adt/core"
  adtcore:name="${GROUP}" adtcore:type="FUGR/F" adtcore:description="WM posting attempts (double-post guard)">
  <adtcore:packageRef adtcore:name="${pkg}"/>
</group:abapFunctionGroup>`;

const moduleXml = (fm, pkg) => `<?xml version="1.0" encoding="utf-8"?>
<fmodule:abapFunctionModule xmlns:fmodule="http://www.sap.com/adt/functions/fmodules" xmlns:adtcore="http://www.sap.com/adt/core"
  adtcore:name="${fm.name}" adtcore:type="FUGR/FF" adtcore:description="${fm.description}" fmodule:processingType="rfc">
  <adtcore:containerRef adtcore:uri="${GROUPS}/${GROUP.toLowerCase()}" adtcore:type="FUGR/F" adtcore:name="${GROUP}" adtcore:packageName="${pkg}"/>
</fmodule:abapFunctionModule>`;

/** Everything the tool would send, built from the source files, so it can be reviewed without touching SAP. */
function buildPlan(pkg) {
  const full = fs.readFileSync(GROUP_SOURCE, 'utf8');
  return {
    table: { xml: tableXml(pkg), source: tableSource(fs.readFileSync(TABLE_SOURCE, 'utf8')) },
    group: { xml: groupXml(pkg) },
    modules: MODULES.map((fm) => ({ ...fm, xml: moduleXml(fm, pkg), source: toAdtSource(full, fm.name) }))
  };
}

/** A client for one stateful ADT session. shortcut: same shape as the other adt-create tools, share it if a fourth appears. */
function adtClient({ base, client, auth }) {
  const cookies = {};
  let csrf = '';
  return async (method, p, { headers = {}, body } = {}) => {
    const r = await fetch(`${base}${p}${p.includes('?') ? '&' : '?'}sap-client=${client}`, {
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
}

async function main() {
  require('./live-sap-gate')();
  const { pkg, transport, printOnly } = parseArgs(process.argv);
  const plan = buildPlan(pkg);
  if (printOnly) {
    console.log(`PRINT ONLY: no SAP call was made. Would create in package ${pkg}, transport ${transport}:`);
    console.log(plan.table.xml, `\n\n${plan.table.source}`);
    console.log(plan.group.xml);
    for (const fm of plan.modules) console.log(`\n${fm.xml}\n\n${fm.source}`);
    return;
  }

  require(path.join(root, 'node_modules/dotenv')).config({ path: path.join(root, '.env.local') });
  const base = (process.env.S4_DESTINATION_URL || '').replace(/\/sap\/opu\/odata.*$/i, '').replace(/\/$/, '');
  if (!base || !process.env.S4_USERNAME) throw new Error('S4_DESTINATION_URL / S4_USERNAME missing in .env.local');
  const req = adtClient({
    base,
    client: process.env.S4_CLIENT || '',
    auth: 'Basic ' + Buffer.from(`${process.env.S4_USERNAME}:${process.env.S4_PASSWORD}`).toString('base64')
  });
  const must = (res, what) => {
    console.log(`${what}: HTTP ${res.status}`);
    if (res.status >= 300) throw new Error(`${what} failed: ${res.text.slice(0, 2000)}`);
    return res;
  };
  const withCorr = (p) => `${p}${p.includes('?') ? '&' : '?'}corrNr=${transport}`;
  const lockAndPut = async (uri, put) => {
    const lock = must(await req('POST', `${uri}?_action=LOCK&accessMode=MODIFY`, {
      headers: { Accept: 'application/vnd.sap.as+xml;charset=UTF-8;dataname=com.sap.adt.lock.result' }
    }), `LOCK ${uri}`);
    const h = (lock.text.match(/<LOCK_HANDLE>([^<]+)<\/LOCK_HANDLE>/) || [])[1];
    if (!h) throw new Error(`no lock handle for ${uri}`);
    try {
      await put(`lockHandle=${encodeURIComponent(h)}`);
    } finally {
      await req('POST', `${uri}?_action=UNLOCK&lockHandle=${encodeURIComponent(h)}`);
    }
  };
  const source = (text) => ({ headers: { 'Content-Type': 'text/plain; charset=utf-8', Accept: 'text/plain' }, body: text });
  const activate = async (refs, what) => {
    const act = must(await req('POST', '/sap/bc/adt/activation?method=activate&preauditRequested=true', {
      headers: { 'Content-Type': 'application/xml', Accept: 'application/xml' },
      body: `<?xml version="1.0" encoding="UTF-8"?><adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">${refs
        .map((r) => `<adtcore:objectReference adtcore:uri="${r.uri}" adtcore:name="${r.name}"/>`).join('')}</adtcore:objectReferences>`
    }), `Activate ${what}`);
    // ADT answers 200 with a message list when activation has errors
    if (/type="E"|<msg[^>]*type="E"/.test(act.text)) throw new Error(`activation of ${what} reported errors: ${act.text.slice(0, 4000)}`);
  };

  const TAB = `${TABLES}/${TABLE.toLowerCase()}`;
  const GRP = `${GROUPS}/${GROUP.toLowerCase()}`;
  console.log(`WRITE: create ${TABLE} and ${GROUP} (${MODULES.map((x) => x.name).join(', ')}) in package ${pkg}, transport ${transport}`);
  must(await req('GET', '/sap/bc/adt/discovery', { headers: { 'X-CSRF-Token': 'Fetch', Accept: 'application/atomsvc+xml' } }), 'CSRF');

  // Create-only: stop before any write if something already exists
  if ((await req('GET', TAB)).status === 200) throw new Error(`table ${TABLE} already exists; this tool never overwrites`);
  if ((await req('GET', GRP)).status === 200) throw new Error(`function group ${GROUP} already exists; this tool never overwrites`);

  try {
    // The table first: the modules are typed against it, so it must be active before they activate.
    const tableTypes = { 'Content-Type': 'application/vnd.sap.adt.tables.v2+xml', Accept: 'application/vnd.sap.adt.tables.v2+xml' };
    must(await req('POST', withCorr(TABLES), { headers: tableTypes, body: plan.table.xml }), `POST table ${TABLE}`);
    await lockAndPut(TAB, async (lh) => {
      must(await req('PUT', withCorr(`${TAB}/source/main?${lh}`), source(plan.table.source)), `PUT ${TABLE} source`);
    });
    await activate([{ uri: TAB, name: TABLE }], `table ${TABLE}`);

    must(await req('POST', withCorr(GROUPS), {
      headers: { 'Content-Type': 'application/vnd.sap.adt.functions.groups.v3+xml', Accept: 'application/vnd.sap.adt.functions.groups.v3+xml' },
      body: plan.group.xml
    }), `POST group ${GROUP}`);

    const fmHeaders = { 'Content-Type': 'application/vnd.sap.adt.functions.fmodules.v3+xml', Accept: 'application/vnd.sap.adt.functions.fmodules.v3+xml' };
    for (const fm of plan.modules) {
      const uri = `${GRP}/fmodules/${fm.name.toLowerCase()}`;
      must(await req('POST', withCorr(`${GRP}/fmodules`), { headers: fmHeaders, body: fm.xml }), `POST ${fm.name}`);
      await lockAndPut(uri, async (lh) => {
        must(await req('PUT', withCorr(`${uri}?${lh}`), { headers: fmHeaders, body: fm.xml }), `PUT ${fm.name} metadata (RFC)`);
        must(await req('PUT', withCorr(`${uri}/source/main?${lh}`), source(fm.source)), `PUT ${fm.name} source`);
      });
    }
    await activate([{ uri: GRP, name: GROUP }, ...MODULES.map((x) => ({ uri: `${GRP}/fmodules/${x.name.toLowerCase()}`, name: x.name }))], `group ${GROUP}`);
  } finally {
    await req('POST', '/sap/bc/adt/sessions?_action=DROP').catch(() => {});
  }

  console.log('READ-ONLY verification over RFC...');
  const { RfcClient } = require(path.join(root, 'srv/integration/s4hana/RfcClient'));
  const rfc = new RfcClient();
  const tab = await rfc.readTable('DD02L', ['TABNAME', 'TABCLASS', 'AS4LOCAL'], [`TABNAME = '${TABLE}'`, "AND AS4LOCAL = 'A'"]);
  if (tab[0]?.TABCLASS?.trim() !== 'TRANSP') throw new Error(`${TABLE} is not an active transparent table`);
  const cols = await rfc.readTable('DD03L', ['FIELDNAME', 'KEYFLAG'], [`TABNAME = '${TABLE}'`, "AND AS4LOCAL = 'A'"]);
  const keys = cols.filter((c) => c.KEYFLAG.trim() === 'X').map((c) => c.FIELDNAME.trim());
  console.log(`DD03L: ${cols.length} columns, key ${keys.join(' + ')}`);
  if (keys.join() !== 'MANDT,REFERENCE_DOCUMENT') throw new Error(`unexpected primary key: ${keys.join()}`);
  const rows = await rfc.readTable('TFDIR', ['FUNCNAME', 'FMODE'], ["FUNCNAME LIKE 'Z_WM_ATTEMPT%'"]);
  console.log('TFDIR:', JSON.stringify(rows));
  for (const fm of MODULES) {
    if (rows.find((r) => r.FUNCNAME.trim() === fm.name)?.FMODE?.trim() !== 'R') throw new Error(`${fm.name} is not active and remote-enabled`);
  }
  console.log(`Created and activated in ${pkg} on ${transport}. No module was called and no row was written.`);
}

if (require.main === module) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}

module.exports = { parseArgs, tableSource, buildPlan, MODULES };
