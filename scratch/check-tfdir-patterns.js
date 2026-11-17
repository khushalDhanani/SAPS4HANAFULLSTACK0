'use strict';
require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });
const { RfcClient } = require('../srv/integration/s4hana/RfcClient');

async function testTfdir() {
  const rfc = new RfcClient();
  console.log('Querying TFDIR for RSLG*...');
  const rslg = await rfc.readTable('TFDIR', ['FUNCNAME', 'FMODE', 'PNAME'], ["FUNCNAME LIKE 'RSLG%'"]);
  console.log(`Found ${rslg.length} RSLG* in TFDIR:`);
  for (const r of rslg) {
    console.log(`  ${r.FUNCNAME.padEnd(35)} FMODE: '${r.FMODE}' (Remote: ${r.FMODE === 'R'})`);
  }

  console.log('\nQuerying TFDIR for RSAU*...');
  const rsau = await rfc.readTable('TFDIR', ['FUNCNAME', 'FMODE', 'PNAME'], ["FUNCNAME LIKE 'RSAU%'"]);
  console.log(`Found ${rsau.length} RSAU* in TFDIR:`);
  for (const r of rsau) {
    console.log(`  ${r.FUNCNAME.padEnd(35)} FMODE: '${r.FMODE}' (Remote: ${r.FMODE === 'R'})`);
  }

  console.log('\nQuerying TFDIR for *SYSLOG*...');
  const syslog = await rfc.readTable('TFDIR', ['FUNCNAME', 'FMODE', 'PNAME'], ["FUNCNAME LIKE '%SYSLOG%'"]);
  console.log(`Found ${syslog.length} *SYSLOG* in TFDIR:`);
  for (const r of syslog) {
    console.log(`  ${r.FUNCNAME.padEnd(35)} FMODE: '${r.FMODE}' (Remote: ${r.FMODE === 'R'})`);
  }

  console.log('\nQuerying TFDIR for *AUDIT_LOG*...');
  const audit = await rfc.readTable('TFDIR', ['FUNCNAME', 'FMODE', 'PNAME'], ["FUNCNAME LIKE '%AUDIT_LOG%'"]);
  console.log(`Found ${audit.length} *AUDIT_LOG* in TFDIR:`);
  for (const r of audit) {
    console.log(`  ${r.FUNCNAME.padEnd(35)} FMODE: '${r.FMODE}' (Remote: ${r.FMODE === 'R'})`);
  }
}

testTfdir().catch(console.error);
