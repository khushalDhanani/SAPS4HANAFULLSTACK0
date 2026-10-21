require('./live-sap-gate')();
'use strict';
/**
 * ADT creation and activation of Z_WM_TO_CREATE_DN wrapper in function group Z_VENDOR_REMOTES ($TMP).
 * Wraps L_TO_CREATE_DN to bypass kernel restriction (SAP Note 2295840).
 *
 * WRITE to the ABAP repository of the connected system. Run only with explicit authorization:
 *   ALLOW_LIVE_SAP_TOOLS=1 node tools/adt-create-to-wrapper.js --allow-live-sap
 */
const path = require('path');
const fs = require('fs');

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

const abapSourcePath = path.join(root, 'docs/abap/z_wm_to_create_dn.fugr_z_vendor_remotes.abap');
if (!fs.existsSync(abapSourcePath)) {
  console.error(`ABAP source file missing at ${abapSourcePath}`);
  process.exit(1);
}
const abapSource = fs.readFileSync(abapSourcePath, 'utf8');

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

(async () => {
  const fm = 'Z_WM_TO_CREATE_DN';
  console.log(`Starting ADT creation/deployment for ${fm} in Z_VENDOR_REMOTES ($TMP)...`);

  const d = await req('GET', '/sap/bc/adt/discovery', { headers: { 'X-CSRF-Token': 'Fetch', Accept: 'application/atomsvc+xml' } });
  if (d.status !== 200 || !csrf) {
    console.error('Failed to obtain CSRF token from ADT discovery:', d.status);
    process.exit(1);
  }

  const metaXml = `<?xml version="1.0" encoding="utf-8"?>
<fmodule:abapFunctionModule xmlns:fmodule="http://www.sap.com/adt/functions/fmodules"
  xmlns:abapsource="http://www.sap.com/adt/abapsource"
  xmlns:adtcore="http://www.sap.com/adt/core"
  adtcore:name="${fm}"
  adtcore:type="FUGR/FF"
  adtcore:description="Picking Transfer Order for Outbound Delivery"
  fmodule:processingType="rfc">
  <adtcore:containerRef adtcore:uri="/sap/bc/adt/functions/groups/z_vendor_remotes" adtcore:type="FUGR/F" adtcore:name="Z_VENDOR_REMOTES" adtcore:packageName="$TMP"/>
</fmodule:abapFunctionModule>`;

  // 1. Check if FM already exists
  const check = await req('GET', `${GRP}/${fm}`, { headers: { Accept: 'application/vnd.sap.adt.functions.fmodules.v3+xml' } });
  if (check.status === 200) {
    console.log(`${fm} already exists in ADT.`);
  } else {
    // Create new function module via POST metadata
    console.log(`Creating metadata for ${fm}...`);
    const postMeta = await req('POST', GRP, {
      headers: {
        'Content-Type': 'application/vnd.sap.adt.functions.fmodules.v3+xml',
        Accept: 'application/vnd.sap.adt.functions.fmodules.v3+xml'
      },
      body: metaXml
    });
    console.log(`POST metadata status: ${postMeta.status}`);
    if (postMeta.status >= 300) {
      console.error('Failed to create function module metadata:', postMeta.text);
      process.exit(1);
    }
  }

  // 2. Lock
  console.log(`Locking ${fm}...`);
  const lock = await req('POST', `${GRP}/${fm}?_action=LOCK&accessMode=MODIFY`, {
    headers: { Accept: 'application/vnd.sap.as+xml;charset=UTF-8;dataname=com.sap.adt.lock.result' }
  });
  const h = (lock.text.match(/<LOCK_HANDLE>([^<]+)<\/LOCK_HANDLE>/) || [])[1];
  if (!h) {
    console.error(`Failed to lock ${fm}:`, lock.text);
    process.exit(1);
  }

  // 3. Ensure metadata has processingType="rfc"
  console.log(`Updating metadata for RFC processing type...`);
  const putMeta = await req('PUT', `${GRP}/${fm}?lockHandle=${encodeURIComponent(h)}`, {
    headers: {
      'Content-Type': 'application/vnd.sap.adt.functions.fmodules.v3+xml',
      Accept: 'application/vnd.sap.adt.functions.fmodules.v3+xml'
    },
    body: metaXml
  });
  console.log(`PUT metadata status: ${putMeta.status}`);

  // 4. PUT source code
  console.log(`Uploading source code to ${fm}...`);
  const put = await req('PUT', `${GRP}/${fm}/source/main?lockHandle=${encodeURIComponent(h)}`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', Accept: 'text/plain' },
    body: abapSource
  });
  console.log(`PUT source status: ${put.status}`);

  // 5. Unlock
  await req('POST', `${GRP}/${fm}?_action=UNLOCK&lockHandle=${encodeURIComponent(h)}`);

  if (put.status >= 300) {
    console.error('Failed to upload source:', put.text);
    process.exit(1);
  }

  // 6. Activate
  console.log(`Activating ${fm}...`);
  const actBody = `<?xml version="1.0" encoding="UTF-8"?><adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:objectReference adtcore:uri="${GRP}/${fm}" adtcore:name="${fm}"/></adtcore:objectReferences>`;
  const act = await req('POST', '/sap/bc/adt/activation?method=activate&preauditRequested=true', {
    headers: { 'Content-Type': 'application/xml', Accept: 'application/xml' },
    body: actBody
  });
  console.log(`Activation status: ${act.status}`);
  if (act.status >= 300) {
    console.error('Activation response:', act.text);
  }

  await req('POST', '/sap/bc/adt/sessions?_action=DROP').catch(() => {});

  // 7. READ-ONLY verification over RFC
  console.log('Verifying RFC interface...');
  const { RfcClient } = require(path.join(root, 'srv/integration/s4hana/RfcClient'));
  const rfc = new RfcClient();
  try {
    const iface = await rfc.call('RFC_GET_FUNCTION_INTERFACE', { FUNCNAME: fm, LANGUAGE: 'E' });
    console.log(`Successfully verified ${fm} over RFC! Active parameter count: ${iface.PARAMS?.length}`);
    for (const p of iface.PARAMS || []) {
      console.log(`  - ${p.PARAMCLASS} ${p.PARAMETER} (${p.TABNAME || ''}${p.FIELDNAME ? '-' + p.FIELDNAME : ''}) optional=${p.OPTIONAL}`);
    }
  } catch (e) {
    console.error(`RFC verification failed: ${e.message}`);
  }
})();
