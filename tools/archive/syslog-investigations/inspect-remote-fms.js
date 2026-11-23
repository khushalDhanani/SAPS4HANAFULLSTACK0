'use strict';
require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });
const fs = require('fs');
const { RfcClient } = require('../srv/integration/s4hana/RfcClient');

async function main() {
  const rfc = new RfcClient();
  const whereClauses = [
    "FUNCNAME LIKE 'RSLG%' AND FMODE = 'R'",
    "FUNCNAME LIKE '%SYSLOG%' AND FMODE = 'R'",
    "FUNCNAME LIKE '%SYSTEM_LOG%' AND FMODE = 'R'",
    "FUNCNAME LIKE 'RSAU%' AND FMODE = 'R'",
    "FUNCNAME LIKE '%AUDIT_LOG%' AND FMODE = 'R'"
  ];

  const remoteFMs = new Map();

  console.log('--- Step 3: Finding all remote-enabled (FMODE=R) modules in TFDIR ---');
  for (const clause of whereClauses) {
    try {
      const rows = await rfc.readTable('TFDIR', ['FUNCNAME', 'FMODE', 'PNAME'], [clause]);
      for (const r of rows) {
        if (!remoteFMs.has(r.FUNCNAME)) {
          remoteFMs.set(r.FUNCNAME, r);
        }
      }
    } catch (e) {
      console.error(`Error querying TFDIR with [${clause}]:`, e.message);
    }
  }

  console.log(`Total remote-enabled FMs found: ${remoteFMs.size}`);

  // Also get function group and short text from ENLFDIR / TFTIT
  const details = [];
  for (const [funcName, tf] of remoteFMs.entries()) {
    let group = '';
    let stext = '';
    try {
      const enl = await rfc.readTable('ENLFDIR', ['FUNCNAME', 'AREA'], [`FUNCNAME = '${funcName}'`]);
      if (enl && enl.length > 0) group = enl[0].AREA;
    } catch (_) {}

    try {
      const tft = await rfc.readTable('TFTIT', ['FUNCNAME', 'STEXT'], [`FUNCNAME = '${funcName}'`, "AND SPRAS = 'E'"]);
      if (tft && tft.length > 0) stext = tft[0].STEXT;
    } catch (_) {}

    console.log(`Inspecting ${funcName} (Group: ${group}, Text: ${stext})...`);
    let params = [];
    let err = null;
    try {
      const iface = await rfc.call('RFC_GET_FUNCTION_INTERFACE', {
        FUNCNAME: funcName,
        LANGUAGE: 'E'
      });
      params = iface.PARAMS || [];
    } catch (e) {
      err = e.message || String(e);
      console.error(`  Failed interface inspection for ${funcName}:`, err);
    }

    details.push({
      name: funcName,
      group,
      text: stext,
      fmode: tf.FMODE,
      pname: tf.PNAME,
      params,
      error: err
    });
  }

  // Also query non-remote RSLG* and RSAU* reading candidates to be 100% comprehensive
  const nonRemoteQueries = [
    "FUNCNAME = 'RSLG_READ_FILE'",
    "FUNCNAME = 'RSLG_READ_FILE_ALV'",
    "FUNCNAME = 'RSAU_READ_LOG'",
    "FUNCNAME = 'RSAU_READ_FILE'",
    "FUNCNAME = 'RSAU_CHECK_FILES_LOCAL'"
  ];
  const nonRemoteDetails = [];
  for (const q of nonRemoteQueries) {
    try {
      const rows = await rfc.readTable('TFDIR', ['FUNCNAME', 'FMODE', 'PNAME'], [q]);
      if (rows && rows.length > 0) {
        nonRemoteDetails.push(rows[0]);
      }
    } catch (_) {}
  }

  fs.writeFileSync('scratch/remote_fms_details.json', JSON.stringify({
    remoteFMs: details,
    nonRemoteInspect: nonRemoteDetails
  }, null, 2));

  console.log('Saved inspection to scratch/remote_fms_details.json');
}

main().catch(console.error);
