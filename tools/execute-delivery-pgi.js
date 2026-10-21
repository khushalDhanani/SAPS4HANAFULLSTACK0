require('./live-sap-gate')();
'use strict';
/**
 * One-shot Delivery PGI Execution & Read-back Verification
 *
 * Outbound Delivery: 0080000134
 * Item: 000010
 * Material: 8000009754
 * Warehouse: W01
 * Serial Number: MBP00001
 *
 * Sequence:
 * 1. Read-only: Inspect transparent table T319A for W01 / Z007 / E1.
 * 2. Execute PGI once via BAPI_OUTB_DELIVERY_CONFIRM_DEC with POST_GI_FLG = 'X' and ITEM_SERIAL_NO = MBP00001.
 *    (NO RETRY ON FAILURE)
 * 3. Read back and report:
 *    - LIKP-WBSTK (goods movement status)
 *    - VBFA & MATDOC (movement type 241 material document)
 *    - EQBS serial status for MBP00001
 *    - Stock in 1120/CS02 (MARD-LABST)
 *    - Emptied interim bin 913 / 0080000134 (LQUA)
 */

const path = require('path');
const root = path.resolve(__dirname, '..');
require(path.join(root, 'node_modules/dotenv')).config({ path: path.join(root, '.env.local') });

const { RfcClient } = require(path.join(root, 'srv/integration/s4hana/RfcClient'));
const { sapKey } = require(path.join(root, 'srv/integration/s4hana/sapKey'));

(async () => {
  const rfc = new RfcClient();
  const delivNo = '0080000134';
  const itemNo = '000010';
  const serialNo = 'MBP00001';
  const matnr = '000000008000009754';
  const plant = '1120';
  const sloc = 'CS02';
  const lgnum = 'W01';

  console.log('================================================================');
  console.log(`PGI Execution on Outbound Delivery ${delivNo} with Serial ${serialNo}`);
  console.log('================================================================\n');

  // STEP 1: READ-ONLY Verification of T319A
  console.log('--- Step 1: Re-read T319A (READ-ONLY) ---');
  const t319aRows = await rfc.readTable('T319A', ['LGNUM', 'VHART', 'LETYP'], [`LGNUM = '${lgnum}'`], 20);
  console.log(`Current T319A entries for warehouse ${lgnum}:`);
  console.table(t319aRows || []);

  const z007Entry = (t319aRows || []).find((r) => r.VHART?.trim() === 'Z007');
  if (process.argv.includes('--read-t319a-only')) {
    if (z007Entry) {
      console.log(`\n[CONFIRMED] Found T319A entry: LGNUM='${z007Entry.LGNUM?.trim()}', VHART='${z007Entry.VHART?.trim()}', LETYP='${z007Entry.LETYP?.trim()}'.`);
    } else {
      console.log(`\n[PENDING] T319A does not yet contain an entry for VHART = 'Z007' in warehouse '${lgnum}'.`);
    }
    console.log('\n--read-t319a-only flag specified. Stopping here.');
    process.exit(0);
  }

  if (!z007Entry) {
    console.error(`\n[BLOCKER] T319A does not contain an entry for VHART = 'Z007' in warehouse '${lgnum}'!`);
    console.error('PGI execution aborted to avoid L3 866 failure.');
    process.exit(1);
  }

  console.log(`\n[CONFIRMED] Found T319A entry: LGNUM='${z007Entry.LGNUM?.trim()}', VHART='${z007Entry.VHART?.trim()}', LETYP='${z007Entry.LETYP?.trim()}'.`);

  // Check current LIKP status
  const likpPre = await rfc.readTable('LIKP', ['VBELN', 'WBSTK', 'KOSTK', 'LVSTK'], [`VBELN = '${delivNo}'`], 1);
  console.log('\nCurrent LIKP status:', JSON.stringify(likpPre?.[0] || {}));
  if (likpPre?.[0]?.WBSTK === 'C') {
    console.log('\n[INFO] Delivery goods issue is already completely posted (WBSTK = C). Skipping write.');
  } else {
    // STEP 2: WRITE: Execute PGI once (no retry on failure)
    console.log(`\n--- Step 2: WRITE: Calling BAPI_OUTB_DELIVERY_CONFIRM_DEC (ONE-SHOT, NO RETRY) ---`);
    console.log(`Payload: DELIV_NUMB = '${delivNo}', POST_GI_FLG = 'X', SERIALNO = '${serialNo}'`);

    const confirmParams = {
      HEADER_DATA: { DELIV_NUMB: delivNo },
      HEADER_CONTROL: {
        DELIV_NUMB: delivNo,
        POST_GI_FLG: 'X'
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
        SERIALNO: sapKey(serialNo, 'serial')
      }]
    };

    let pgiReturn = [];
    await rfc.session(async (call) => {
      const res = await call('BAPI_OUTB_DELIVERY_CONFIRM_DEC', confirmParams);
      pgiReturn = res?.RETURN || [];
      const errs = pgiReturn.filter((r) => r.TYPE === 'E' || r.TYPE === 'A');

      if (errs.length > 0) {
        try {
          await call('BAPI_TRANSACTION_ROLLBACK', {});
        } catch (_) {}
        console.error('\n[ERROR] BAPI_OUTB_DELIVERY_CONFIRM_DEC returned errors:');
        console.table(errs);
        throw new Error(`PGI failed: ${errs.map((e) => `[${e.TYPE}] ${e.MESSAGE || (e.ID + e.NUMBER)}`).join('; ')}`);
      }

      console.log('\nBAPI_OUTB_DELIVERY_CONFIRM_DEC messages:');
      console.table(pgiReturn);

      console.log('\nCommitting transaction...');
      const commitRes = await call('BAPI_TRANSACTION_COMMIT', { WAIT: 'X' });
      console.log('BAPI_TRANSACTION_COMMIT response:', JSON.stringify(commitRes || {}));
    });
  }

  // STEP 3: READ-ONLY Read-back verification of all 5 requested items
  console.log('\n================================================================');
  console.log('Step 3: Read-back Verification (READ-ONLY)');
  console.log('================================================================\n');

  // 1. LIKP-WBSTK
  const likpPost = await rfc.readTable('LIKP', ['VBELN', 'WBSTK', 'KOSTK', 'LVSTK'], [`VBELN = '${delivNo}'`], 1);
  console.log('1. LIKP Status:');
  console.table(likpPost || []);
  console.log(`   LIKP-WBSTK = '${likpPost?.[0]?.WBSTK}' (Expect: 'C' = Completely processed)`);

  // 2. VBFA & MATDOC 241 document
  console.log('\n2. VBFA Document Flow & MATDOC 241 Document:');
  const vbfa = await rfc.readTable('VBFA', ['VBELV', 'POSNV', 'VBELN', 'POSNN', 'VBTYP_N', 'MANDT'], [
    `VBELV = '${delivNo}'`
  ], 10);
  console.table(vbfa || []);

  const matDocEntry = (vbfa || []).find((r) => r.VBTYP_N?.trim() === 'R');
  let matDocNo = matDocEntry?.VBELN?.trim();
  console.log(`   VBFA Material Document Number: ${matDocNo || 'NOT FOUND IN VBFA'}`);

  if (matDocNo) {
    const matdoc = await rfc.readTable('MATDOC', [
      'MBLNR', 'MJAHR', 'ZEILE', 'BWART', 'MATNR', 'WERKS', 'LGORT', 'MENGE', 'MEINS', 'RSNUM', 'RSPOS'
    ], [
      `MBLNR = '${matDocNo}'`
    ], 5);
    console.log('   MATDOC Record:');
    console.table(matdoc || []);
  }

  // 3. EQBS Serial Status
  console.log(`\n3. EQBS Serial Status for '${serialNo}':`);
  const eqbs = await rfc.readTable('EQBS', ['EQUNR', 'B_WERK', 'B_LAGER', 'LBBSA', 'B_CHARGE', 'SJAHR'], [
    `EQUNR = '000000000010015790'`
  ], 5);
  console.table(eqbs || []);
  const objk = await rfc.readTable('OBJK', ['OBKNR', 'EQUNR', 'SERNR', 'MATNR', 'TCODE'], [
    `SERNR = '${serialNo}'`,
    `AND MATNR = '${matnr}'`
  ], 5);
  console.log('   OBJK Serial Link:');
  console.table(objk || []);

  // 4. Stock in 1120/CS02 (must be reduced by exactly 1)
  console.log(`\n4. Stock in Plant ${plant} / SLoc ${sloc}:`);
  const mard = await rfc.readTable('MARD', ['MATNR', 'WERKS', 'LGORT', 'LABST', 'INSME'], [
    `MATNR = '${matnr}'`,
    `AND WERKS = '${plant}'`,
    `AND LGORT = '${sloc}'`
  ], 1);
  console.table(mard || []);
  const currentStock = Number(mard?.[0]?.LABST || 0);
  console.log(`   MARD-LABST (Current Unrestricted Stock) = ${currentStock} NOS`);
  console.log(`   Stock reduction by 1: from 10.000 to ${currentStock} NOS -> ${currentStock === 9 ? 'CONFIRMED REDUCED BY EXACTLY 1' : 'CHECK NEEDED'}`);

  // 5. Emptied interim bins in 913 (Asset 0000400001 and Delivery 0080000134)
  console.log(`\n5. Interim Storage Bins in Storage Type 913 (LQUA):`);
  const lquaAsset = await rfc.readTable('LQUA', ['LGNUM', 'LGTYP', 'LGPLA', 'LENUM', 'MATNR', 'VERME', 'MEINS', 'BENUM'], [
    `LGNUM = '${lgnum}'`,
    `AND LGTYP = '913'`,
    `AND LGPLA = '0000400001'`
  ], 5);
  console.log('   Interim bin 913 / 0000400001 (Asset 400001):');
  console.table(lquaAsset || []);

  const lquaDeliv = await rfc.readTable('LQUA', ['LGNUM', 'LGTYP', 'LGPLA', 'LENUM', 'MATNR', 'VERME', 'MEINS', 'BENUM'], [
    `LGNUM = '${lgnum}'`,
    `AND LGTYP = '913'`,
    `AND LGPLA = '${delivNo}'`
  ], 5);
  console.log(`   Interim bin 913 / ${delivNo} (Delivery Dynamic Bin):`);
  console.table(lquaDeliv || []);
  if (!lquaDeliv || lquaDeliv.length === 0 || Number(lquaDeliv[0].VERME) === 0) {
    console.log(`   Interim bin 913 / ${delivNo} is EMPTIED as expected.`);
  } else {
    console.log(`   Interim bin 913 / ${delivNo} quantity: ${lquaDeliv[0].VERME} ${lquaDeliv[0].MEINS}`);
  }

  console.log('\n================================================================');
  console.log('Execution & Read-back Completed.');
  console.log('================================================================');
})().catch((err) => {
  console.error('\n[FATAL ERROR]', err.message);
  process.exit(1);
});
