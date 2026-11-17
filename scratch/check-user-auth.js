'use strict';
require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });
const { RfcClient } = require('../srv/integration/s4hana/RfcClient');

async function checkUserAuth() {
  const rfc = new RfcClient();
  const uname = (process.env.S4_USERNAME || '').toUpperCase();
  console.log(`Checking profiles and authorizations for technical user: ${uname}...`);

  try {
    const usr02 = await rfc.readTable('USR02', ['BNAME', 'USTYP', 'CLASS', 'UFLAG'], [`BNAME = '${uname}'`]);
    console.log('USR02 entry:', usr02);
  } catch (e) {
    console.log('USR02 read failed:', e.message);
  }

  try {
    const ust04 = await rfc.readTable('UST04', ['BNAME', 'PROFILE'], [`BNAME = '${uname}'`]);
    console.log(`UST04 profiles for ${uname} (${ust04.length} rows):`, ust04.map(r => r.PROFILE).join(', '));
  } catch (e) {
    console.log('UST04 read failed:', e.message);
  }

  try {
    const agr = await rfc.readTable('AGR_USERS', ['AGR_NAME', 'UNAME'], [`UNAME = '${uname}'`]);
    console.log(`AGR_USERS roles for ${uname} (${agr.length} rows):`, agr.map(r => r.AGR_NAME).join(', '));
  } catch (e) {
    console.log('AGR_USERS read failed:', e.message);
  }

  // Can we test authority check with AUTHORITY_CHECK_RFC or BAPI_USER_GET_DETAIL?
  try {
    const bapi = await rfc.call('BAPI_USER_GET_DETAIL', {
      USERNAME: uname,
      CACHE_RESULTS: ' '
    });
    console.log('BAPI_USER_GET_DETAIL PROFILES count:', (bapi.PROFILES || []).length);
    console.log('BAPI_USER_GET_DETAIL ACTIVITYGROUPS count:', (bapi.ACTIVITYGROUPS || []).length);
    const hasSapAll = (bapi.PROFILES || []).some(p => p.BAPIPROF === 'SAP_ALL');
    console.log(`Has SAP_ALL in PROFILES: ${hasSapAll}`);
  } catch (e) {
    console.log('BAPI_USER_GET_DETAIL failed:', e.message);
  }
}

checkUserAuth().catch(console.error);
