'use strict';

require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });
const { RfcClient } = require('../srv/integration/s4hana/RfcClient');

async function testStepByStep() {
  const rfc = new RfcClient();
  console.log('Testing SAP Function Modules in isolation for Chunk 2...');

  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  
  // Step 1: Test BAPI_RESERVATION_CREATE1 for Movement 311
  console.log('\n--- 1. Testing create_reservation (BAPI_RESERVATION_CREATE1) ---');
  const res311 = await rfc.session(async (call) => {
    const head = {
      RES_DATE: today,
      MOVE_TYPE: '311',
      MOVE_PLANT: '1120',
      MOVE_STLOC: 'CS01'
    };
    const items = [
      {
        MATERIAL: '000000008000000023',
        PLANT: '1120',
        STGE_LOC: 'HS01',
        ENTRY_QNT: 1,
        ENTRY_UOM: 'NOS',
        MOVEMENT: 'X'
      }
    ];
    const out = await call('BAPI_RESERVATION_CREATE1', {
      RESERVATIONHEADER: head,
      RESERVATIONITEMS: items
    });
    const errors = (out.RETURN || []).filter(r => r.TYPE === 'E' || r.TYPE === 'A');
    if (errors.length) {
      throw new Error(`Reservation 311 failed: ${errors.map(e => e.MESSAGE).join(', ')}`);
    }
    await call('BAPI_TRANSACTION_COMMIT', { WAIT: 'X' });
    return out.RESERVATION;
  });
  console.log('Created real Reservation 311:', res311);

  // Read back reservation item from RESB
  const resbRows = await rfc.readTable('RESB', ['RSNUM', 'RSPOS', 'MATNR', 'WERKS', 'LGORT', 'UMLGO', 'BWART'], [`RSNUM = '${res311}'`]);
  console.log('Read back from RESB:', resbRows);

  // Step 2: Test create_tr (L_TR_CREATE) for the created reservation
  console.log('\n--- 2. Testing create_tr (L_TR_CREATE) ---');
  let tbnum = null;
  await rfc.session(async (call) => {
    const ltbaItem = {
      LGNUM: 'W01',
      BWLVS: '311',
      MATNR: '000000008000000023',
      WERKS: '1120',
      LGORT: 'HS01',
      MENGA: 1,
      ALTME: 'NOS',
      RSNUM: res311,
      RSPOS: '0001'
    };
    const out = await call('L_TR_CREATE', {
      I_COMMIT_WORK: 'X',
      I_SAVE_ONLY_ALL: 'X',
      I_SINGLE_ITEM: 'X',
      T_LTBA: [ltbaItem]
    });
    console.log('L_TR_CREATE returned T_LTBA:', out.T_LTBA);
    if (out.T_LTBA && out.T_LTBA[0]) {
      tbnum = out.T_LTBA[0].TBNUM;
      console.log('Generated TR number (TBNUM):', tbnum);
    }
  });

  if (tbnum) {
    const trRow = await rfc.readTable('LTBP', ['LGNUM', 'TBNUM', 'TBPOS', 'MATNR', 'MENGA', 'RSNUM', 'RSPOS'], [`LGNUM = 'W01' AND TBNUM = '${tbnum}'`]);
    console.log('Read back from LTBP:', trRow);
  }

  console.log('\n--- Test Run Complete ---');
}

testStepByStep().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
