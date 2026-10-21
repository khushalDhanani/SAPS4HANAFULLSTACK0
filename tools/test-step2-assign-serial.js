require('./live-sap-gate')();
'use strict';
/**
 * Step 2 live execution: Assign Serial Number to Outbound Delivery 0080000134 item 000010
 * via BAPI_OUTB_DELIVERY_CHANGE + BAPI_TRANSACTION_COMMIT, and verify SER01 and OBJK.
 *
 * LIVE SAP WRITE: requires explicit user authorization:
 *   ALLOW_LIVE_SAP_TOOLS=1 node tools/test-step2-assign-serial.js --allow-live-sap <serialNo>
 */
const path = require('path');
const root = path.resolve(__dirname, '..');
require(path.join(root, 'node_modules/dotenv')).config({ path: path.join(root, '.env.local') });

const { RfcClient } = require(path.join(root, 'srv/integration/s4hana/RfcClient'));
const { sapKey } = require(path.join(root, 'srv/integration/s4hana/sapKey'));

(async () => {
  const delivNo = '0080000134';
  const itemNo = '000010';
  const chosenSerial = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : (process.argv[3] || 'MBP00001');

  const rfc = new RfcClient();

  console.log(`\n=== STEP 2: Assign Serial Number '${chosenSerial}' to Delivery ${delivNo} Item ${itemNo} ===\n`);

  // 1. READ-ONLY Pre-checks
  console.log('--- READ-ONLY Pre-check ---');
  const likp = await rfc.readTable('LIKP', ['VBELN', 'WBSTK', 'KOSTK', 'LVSTK'], [`VBELN = '${delivNo}'`], 1);
  console.log('LIKP:', JSON.stringify(likp?.[0] || {}));
  if (likp?.[0]?.KOSTK !== 'C') {
    throw new Error(`Delivery ${delivNo} is not picked yet (KOSTK = '${likp?.[0]?.KOSTK}'). Step 1 must be completed first.`);
  }

  const ser01Pre = await rfc.readTable('SER01', ['LIEF_NR', 'POSNR', 'OBKNR'], [`LIEF_NR = '${delivNo}'`, `AND POSNR = '${itemNo}'`], 1);
  console.log('SER01 before:', JSON.stringify(ser01Pre || []));

  // 2. WRITE: Execute serial number assignment via BAPI_OUTB_DELIVERY_CHANGE in session
  console.log(`\n--- WRITE: Calling BAPI_OUTB_DELIVERY_CHANGE with serial '${chosenSerial}' ---`);
  await rfc.session(async (call) => {
    const s4Serial = sapKey(chosenSerial, 'serial');

    const vepo = await rfc.readTable('VEPO', ['VENUM', 'VEPOS', 'VBELN', 'POSNR'], [`VBELN = '${delivNo}'`, `AND POSNR = '${itemNo}'`], 5);
    const handlingUnitSerno = [];
    for (const v of vepo || []) {
      const vekp = await rfc.readTable('VEKP', ['VENUM', 'EXIDV'], [`VENUM = '${v.VENUM}'`], 1);
      const exidv = vekp?.[0]?.EXIDV;
      if (exidv) {
        handlingUnitSerno.push({
          OBJECT_DOC: delivNo,
          ITM_NUMBER: itemNo,
          HU_EXID: exidv,
          SERIALNO: s4Serial
        });
      }
    }
    console.log('Handling unit serials to pass:', handlingUnitSerno);

    const changeRes = await call('BAPI_OUTB_DELIVERY_CONFIRM_DEC', {
      HEADER_DATA: { DELIV_NUMB: delivNo },
      HEADER_CONTROL: {
        DELIV_NUMB: delivNo,
        POST_GI_FLG: ''
      },
      DELIVERY: delivNo,
      ITEM_DATA: [{
        DELIV_NUMB: delivNo,
        DELIV_ITEM: itemNo
      }],
      ITEM_CONTROL: [{
        DELIV_NUMB: delivNo,
        DELIV_ITEM: itemNo
      }],
      ITEM_SERIAL_NO: [{
        DELIV_NUMB: delivNo,
        ITM_NUMBER: itemNo,
        SERIALNO: s4Serial
      }]
    });

    const errs = (changeRes?.RETURN || []).filter((r) => r.TYPE === 'E' || r.TYPE === 'A');
    if (errs.length) {
      try { await call('BAPI_TRANSACTION_ROLLBACK', {}); } catch (_) {}
      console.error('BAPI_OUTB_DELIVERY_CHANGE returned errors:', JSON.stringify(changeRes.RETURN, null, 2));
      throw new Error(`Serial assignment failed: ${errs.map((e) => `[${e.TYPE}] ${e.MESSAGE || (e.ID + e.NUMBER)}`).join('; ')}`);
    }

    console.log('BAPI_OUTB_DELIVERY_CHANGE success messages:', JSON.stringify(changeRes?.RETURN || [], null, 2));

    const commitRes = await call('BAPI_TRANSACTION_COMMIT', { WAIT: 'X' });
    console.log('BAPI_TRANSACTION_COMMIT result:', JSON.stringify(commitRes?.RETURN || {}));

    return changeRes;
  });

  // 3. READ-ONLY Read-back verification
  console.log('\n--- READ-ONLY Read-back Verification ---');
  const ser01Post = await rfc.readTable('SER01', ['LIEF_NR', 'POSNR', 'OBKNR'], [`LIEF_NR = '${delivNo}'`, `AND POSNR = '${itemNo}'`], 1);
  console.log('SER01 after:', JSON.stringify(ser01Post || []));

  const obknr = ser01Post?.[0]?.OBKNR;
  if (!obknr) {
    throw new Error(`No SER01 record created for delivery ${delivNo} item ${itemNo}!`);
  }

  const objk = await rfc.readTable('OBJK', ['OBKNR', 'OBZAHL', 'EQUNR', 'SERNR', 'MATNR'], [`OBKNR = '${obknr}'`], 5);
  console.log('OBJK serial object records:', JSON.stringify(objk || []));

  const assignedSerial = objk?.[0]?.SERNR?.trim();
  const isAssigned = assignedSerial === chosenSerial.trim();
  console.log(`\nSTEP 2 OUTCOME: ${isAssigned ? 'SUCCESS - SERIAL NUMBER ASSIGNED AND PERSISTED IN SAP' : 'FAILED - SERIAL MISMATCH'}`);
})();
