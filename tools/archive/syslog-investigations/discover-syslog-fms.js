'use strict';
require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });

const { RfcClient } = require('../srv/integration/s4hana/RfcClient');

async function main() {
  const rfc = new RfcClient();
  const patterns = ['RSLG*', '*SYSLOG*', '*SYSTEM_LOG*', 'RSAU*', '*AUDIT_LOG*'];
  const allFunctions = new Map();

  console.log('--- Step 3: RFC_FUNCTION_SEARCH ---');
  for (const pat of patterns) {
    try {
      console.log(`Searching for pattern: ${pat}...`);
      const res = await rfc.call('RFC_FUNCTION_SEARCH', {
        FUNCNAME: pat,
        LANGUAGE: 'E'
      });
      const list = res.FUNCTIONS || [];
      console.log(`  Found ${list.length} functions for ${pat}`);
      for (const fn of list) {
        if (!allFunctions.has(fn.FUNCNAME)) {
          allFunctions.set(fn.FUNCNAME, {
            FUNCNAME: fn.FUNCNAME,
            GROUPNAME: fn.GROUPNAME,
            STEXT: fn.STEXT,
            pattern: pat
          });
        }
      }
    } catch (err) {
      console.error(`Error searching ${pat}:`, err.message || err);
      if (err.key === 'RFC_LOGON_FAILURE' || (err.message && err.message.includes('AUTHORITY'))) {
        console.error('Authorization failure encountered during RFC_FUNCTION_SEARCH');
        process.exit(1);
      }
    }
  }

  const funcNames = Array.from(allFunctions.keys());
  console.log(`Total unique functions found: ${funcNames.length}`);

  if (funcNames.length === 0) {
    console.log('No function modules found matching patterns.');
    return;
  }

  // Check remote-enabled status (TFDIR-FMODE)
  console.log('--- Checking TFDIR for FMODE (Remote-enabled = R) ---');
  const tfdirMap = new Map();
  // Batch read in chunks of 50 to avoid WHERE clause length limits
  const chunkSize = 40;
  for (let i = 0; i < funcNames.length; i += chunkSize) {
    const chunk = funcNames.slice(i, i + chunkSize);
    const where = chunk.map(fn => `FUNCNAME = '${fn}'`).join(' OR ');
    try {
      const rows = await rfc.readTable('TFDIR', ['FUNCNAME', 'FMODE', 'PNAME'], [where]);
      for (const r of rows) {
        tfdirMap.set(r.FUNCNAME, r);
      }
    } catch (err) {
      console.error('Error reading TFDIR:', err.message || err);
    }
  }

  const results = [];
  for (const [name, info] of allFunctions.entries()) {
    const tf = tfdirMap.get(name);
    const fmode = tf ? tf.FMODE : 'UNKNOWN';
    const isRemote = (fmode === 'R');
    results.push({
      name,
      group: info.GROUPNAME,
      text: info.STEXT,
      fmode,
      isRemote
    });
  }

  console.log('\n--- Candidate Function Modules ---');
  for (const r of results) {
    console.log(`${r.name.padEnd(35)} Group: ${r.group.padEnd(12)} RFC-Enabled: ${r.isRemote ? 'YES (FMODE=R)' : 'NO (FMODE=' + r.fmode + ')'} | ${r.text}`);
  }

  const remoteCandidates = results.filter(r => r.isRemote);
  console.log(`\nRemote-enabled candidates: ${remoteCandidates.length}`);

  console.log('\n--- Step 3b: RFC_GET_FUNCTION_INTERFACE for Remote-Enabled Candidates ---');
  const detailedCandidates = [];
  for (const cand of remoteCandidates) {
    console.log(`\nInspecting interface: ${cand.name}...`);
    try {
      const iface = await rfc.call('RFC_GET_FUNCTION_INTERFACE', {
        FUNCNAME: cand.name,
        LANGUAGE: 'E'
      });
      const params = iface.PARAMS || [];
      cand.params = params;
      detailedCandidates.push(cand);
      console.log(`  Params count: ${params.length}`);
      for (const p of params) {
        console.log(`    [${p.PARAMCLASS}] ${p.PARAMETER.padEnd(25)} ${p.TABNAME || ''} ${p.FIELDNAME || ''} (Opt: ${p.OPTIONAL}) - ${p.PARAMTEXT || ''}`);
      }
    } catch (err) {
      console.error(`  Error inspecting ${cand.name}:`, err.message || err);
      cand.interfaceError = err.message || String(err);
      detailedCandidates.push(cand);
    }
  }

  // Also specifically check RSLG_READ_ENTRIES if it was not in the search results
  if (!allFunctions.has('RSLG_READ_ENTRIES')) {
    console.log('\n--- Explicit check for RSLG_READ_ENTRIES ---');
    try {
      const rows = await rfc.readTable('TFDIR', ['FUNCNAME', 'FMODE', 'PNAME'], ["FUNCNAME = 'RSLG_READ_ENTRIES'"]);
      console.log('TFDIR for RSLG_READ_ENTRIES:', rows);
      if (rows && rows.length > 0) {
        const isRemote = rows[0].FMODE === 'R';
        console.log(`RSLG_READ_ENTRIES exists in TFDIR! FMODE = '${rows[0].FMODE}' (RFC-enabled: ${isRemote})`);
        try {
          const iface = await rfc.call('RFC_GET_FUNCTION_INTERFACE', {
            FUNCNAME: 'RSLG_READ_ENTRIES',
            LANGUAGE: 'E'
          });
          console.log('Interface params for RSLG_READ_ENTRIES:', iface.PARAMS ? iface.PARAMS.length : 0);
          for (const p of (iface.PARAMS || [])) {
            console.log(`    [${p.PARAMCLASS}] ${p.PARAMETER.padEnd(25)} ${p.TABNAME || ''} ${p.FIELDNAME || ''} (Opt: ${p.OPTIONAL}) - ${p.PARAMTEXT || ''}`);
          }
        } catch (e) {
          console.log('RFC_GET_FUNCTION_INTERFACE for RSLG_READ_ENTRIES failed:', e.message);
        }
      } else {
        console.log('RSLG_READ_ENTRIES does NOT exist in TFDIR.');
      }
    } catch (e) {
      console.log('Could not query TFDIR for RSLG_READ_ENTRIES:', e.message);
    }
  }

  // Write detailed JSON to stdout or file for reference
  const fs = require('fs');
  fs.writeFileSync('scratch/discovery_results.json', JSON.stringify({
    allCandidates: results,
    remoteCandidates: detailedCandidates
  }, null, 2));
  console.log('\nResults written to scratch/discovery_results.json');
}

main().catch(err => {
  console.error('Fatal discovery error:', err);
  process.exit(1);
});
