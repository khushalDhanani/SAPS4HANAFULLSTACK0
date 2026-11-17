'use strict';
require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });
const { RfcClient } = require('../srv/integration/s4hana/RfcClient');

async function prep() {
  const rfc = new RfcClient();

  console.log('--- 1. Checking Active Application Servers ---');
  // Try RFC_GET_LOCAL_SERVERS
  try {
    const res = await rfc.call('RFC_GET_LOCAL_SERVERS');
    console.log('RFC_GET_LOCAL_SERVERS:', res.SERVER_LIST || res);
  } catch (e) {
    console.log('RFC_GET_LOCAL_SERVERS failed:', e.message);
  }

  // Try TH_SERVER_LIST
  try {
    const res = await rfc.call('TH_SERVER_LIST');
    console.log('TH_SERVER_LIST:', res.LIST || res);
  } catch (e) {
    console.log('TH_SERVER_LIST failed:', e.message);
  }

  console.log('\n--- 2. Inspecting RSLGTIME structure / domain ---');
  try {
    const rows = await rfc.readTable('DD03L', ['FIELDNAME', 'ROLLNAME', 'DOMNAME', 'DATATYPE', 'LENG'], ["TABNAME = 'RSLGTIME'"]);
    console.log('RSLGTIME in DD03L:', rows);
  } catch (e) {
    console.log('RSLGTIME read failed:', e.message);
  }
  try {
    const dt = await rfc.readTable('DD04L', ['ROLLNAME', 'DOMNAME', 'DATATYPE', 'LENG'], ["ROLLNAME = 'RSLGTIME'"]);
    console.log('RSLGTIME in DD04L:', dt);
  } catch (e) {
    console.log('RSLGTIME DD04L read failed:', e.message);
  }

  console.log('\n--- 3. Inspecting RSLGENTR_NEW structure in DD03L ---');
  try {
    const rows = await rfc.readTable('DD03L', ['POSITION', 'FIELDNAME', 'ROLLNAME', 'DATATYPE', 'LENG'], ["TABNAME = 'RSLGENTR_NEW'"]);
    console.log(`RSLGENTR_NEW fields (${rows.length}):`);
    for (const r of rows) {
      console.log(`  [${r.POSITION}] ${r.FIELDNAME.padEnd(20)} ${r.ROLLNAME} (${r.DATATYPE} ${r.LENG})`);
    }
  } catch (e) {
    console.log('RSLGENTR_NEW read failed:', e.message);
  }

  console.log('\n--- 4. Inspecting RSAU_SEL_INTV in DD03L ---');
  try {
    const rows = await rfc.readTable('DD03L', ['POSITION', 'FIELDNAME', 'ROLLNAME', 'DATATYPE', 'LENG'], ["TABNAME = 'RSAU_SEL_INTV'"]);
    console.log(`RSAU_SEL_INTV fields (${rows.length}):`);
    for (const r of rows) {
      console.log(`  [${r.POSITION}] ${r.FIELDNAME.padEnd(20)} ${r.ROLLNAME} (${r.DATATYPE} ${r.LENG})`);
    }
  } catch (e) {
    console.log('RSAU_SEL_INTV read failed:', e.message);
  }

  console.log('\n--- 5. Inspecting RSAU_T_RESULT structure (RSAU_RESULT) ---');
  try {
    const rows = await rfc.readTable('DD03L', ['POSITION', 'FIELDNAME', 'ROLLNAME', 'DATATYPE', 'LENG'], ["TABNAME = 'RSAU_RESULT' OR TABNAME = 'RSAU_RESULT_UTC'"]);
    console.log(`RSAU_RESULT fields (${rows.length}):`);
    for (const r of rows) {
      console.log(`  ${r.FIELDNAME.padEnd(20)} ${r.ROLLNAME} (${r.DATATYPE} ${r.LENG})`);
    }
  } catch (e) {
    console.log('RSAU_RESULT read failed:', e.message);
  }
}

prep().catch(console.error);
