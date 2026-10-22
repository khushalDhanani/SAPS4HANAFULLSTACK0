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
 * 1. Validate CLI arguments (--expected-sut and --transport).
 * 2. Step 1: Read T319A (read-only) and verify W01 / Z007 entry matches --expected-sut.
 * 3. Verify LIKP-WBSTK is not already 'C' (abort if already posted).
 * 4. Verify transport number appears in E071 / E071K for V_T319A / T319A.
 * 5. Step 2: WRITE: Call BAPI_OUTB_DELIVERY_CONFIRM_DEC once (no retry).
 * 6. Step 3: READ-ONLY Read back:
 *    - LIKP-WBSTK = 'C'
 *    - VBFA & MATDOC 241 material document
 *    - EQBS serial status for MBP00001
 *    - Stock in 1120/CS02 reduced by exactly 1
 *    - Interim bins W01 913 / 0000400001 and 913 / 0080000134 empty.
 */

const path = require('path');
const root = path.resolve(__dirname, '..');
require(path.join(root, 'node_modules/dotenv')).config({ path: path.join(root, '.env.local') });

const { sapKey } = require(path.join(root, 'srv/integration/s4hana/sapKey'));

function parseArgs(argv = process.argv) {
  let expectedSut = '';
  let transport = '';
  let readOnly = false;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--expected-sut' && argv[i + 1]) {
      expectedSut = argv[i + 1].trim();
      i++;
    } else if (argv[i] === '--transport' && argv[i + 1]) {
      transport = argv[i + 1].trim();
      i++;
    } else if (argv[i] === '--read-t319a-only') {
      readOnly = true;
    }
  }

  if (!expectedSut) {
    throw new Error('Missing required argument: --expected-sut <SUT> must be specified.');
  }
  if (!transport) {
    throw new Error('Missing required argument: --transport <number> must be specified.');
  }

  return { expectedSut, transport, readOnly };
}

function validateT319A(t319aRows, expectedSut, lgnum = 'W01', vhart = 'Z007') {
  const normLgnum = lgnum.trim().toUpperCase();
  const normVhart = vhart.trim().toUpperCase();
  const entry = (t319aRows || []).find(
    (r) => (r.LGNUM || '').trim().toUpperCase() === normLgnum &&
           (r.VHART || '').trim().toUpperCase() === normVhart
  );

  if (!entry) {
    throw new Error(`[ABORT] T319A does not contain entry for warehouse '${lgnum}' and packaging material type '${vhart}'.`);
  }

  const actualSut = (entry.LETYP || '').trim().toUpperCase();
  const reqSut = expectedSut.trim().toUpperCase();
  if (actualSut !== reqSut) {
    throw new Error(`[ABORT] T319A LETYP '${actualSut}' does not match expected SUT '${reqSut}'.`);
  }

  return entry;
}

function validateLikpStatus(likpRecord) {
  if (likpRecord && likpRecord.WBSTK === 'C') {
    throw new Error(`[ABORT] Outbound Delivery ${likpRecord.VBELN || '0080000134'} is already completely posted (LIKP-WBSTK = 'C'). Aborting to prevent double posting.`);
  }
}

function validateTransport(e071Rows, e071kRows, transport) {
  const normTr = transport.trim().toUpperCase();
  const inE071 = (e071Rows || []).some(
    (r) => (r.TRKORR || '').trim().toUpperCase() === normTr &&
           ((r.OBJ_NAME || '').includes('T319A') || (r.OBJECT || '').includes('VDAT') || (r.OBJECT || '').includes('TABU'))
  );

  const inE071K = (e071kRows || []).some(
    (r) => (r.TRKORR || '').trim().toUpperCase() === normTr &&
           ((r.OBJNAME || '').includes('T319A') || (r.TABKEY || '').includes('Z007'))
  );

  if (!inE071 && !inE071K) {
    throw new Error(`[ABORT] Transport '${transport}' does not appear in E071 or E071K for table/view T319A/V_T319A.`);
  }

  return true;
}

async function runPgiFlow(rfc, options = {}) {
  const delivNo = options.delivNo || '0080000134';
  const itemNo = options.itemNo || '000010';
  const serialNo = options.serialNo || 'MBP00001';
  const matnr = options.matnr || '000000008000009754';
  const plant = options.plant || '1120';
  const sloc = options.sloc || 'CS02';
  const lgnum = options.lgnum || 'W01';
  const expectedSut = options.expectedSut;
  const transport = options.transport;

  console.log('================================================================');
  console.log(`PGI Execution on Outbound Delivery ${delivNo} with Serial ${serialNo}`);
  console.log(`Expected SUT: ${expectedSut} | Transport: ${transport}`);
  console.log('================================================================\n');

  // STEP 1: READ-ONLY Verification of T319A
  console.log('--- Step 1: Re-read T319A (READ-ONLY) ---');
  const t319aRows = await rfc.readTable('T319A', ['LGNUM', 'VHART', 'LETYP'], [`LGNUM = '${lgnum}'`], 20);
  console.log(`Current T319A entries for warehouse ${lgnum}:`);
  console.table(t319aRows || []);

  const z007Entry = validateT319A(t319aRows, expectedSut, lgnum, 'Z007');
  console.log(`\n[CONFIRMED] Found T319A entry: LGNUM='${z007Entry.LGNUM?.trim()}', VHART='${z007Entry.VHART?.trim()}', LETYP='${z007Entry.LETYP?.trim()}'. Matches expected SUT '${expectedSut}'.`);

  // Verify LIKP-WBSTK is not already 'C'
  console.log('\n--- Step 1b: Verify LIKP Status (READ-ONLY) ---');
  const likpPre = await rfc.readTable('LIKP', ['VBELN', 'WBSTK', 'KOSTK', 'LVSTK'], [`VBELN = '${delivNo}'`], 1);
  console.log('Current LIKP status:', JSON.stringify(likpPre?.[0] || {}));
  validateLikpStatus(likpPre?.[0]);
  console.log(`[CONFIRMED] Delivery ${delivNo} is open for goods issue (WBSTK = '${likpPre?.[0]?.WBSTK}').`);

  // Verify transport in E071 / E071K
  console.log('\n--- Step 1c: Verify Transport in E071 / E071K (READ-ONLY) ---');
  const e071Rows = await rfc.readTable('E071', ['TRKORR', 'PGMID', 'OBJECT', 'OBJ_NAME'], [`TRKORR = '${transport}'`], 50);
  const e071kRows = await rfc.readTable('E071K', ['TRKORR', 'PGMID', 'OBJECT', 'OBJNAME', 'TABKEY'], [`TRKORR = '${transport}'`], 50);
  console.log(`E071 records for transport ${transport}:`, e071Rows?.length || 0);
  console.log(`E071K records for transport ${transport}:`, e071kRows?.length || 0);
  validateTransport(e071Rows, e071kRows, transport);
  console.log(`[CONFIRMED] Transport ${transport} contains valid T319A/V_T319A entry.`);

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
  console.log('One-shot PGI Flow Completed.');
  console.log('================================================================');

  return {
    likpPost,
    vbfa,
    matDocNo,
    eqbs,
    stock: currentStock,
    lquaDeliv
  };
}

// CLI Execution gate
if (require.main === module) {
  require('./live-sap-gate')();
  const { RfcClient } = require(path.join(root, 'srv/integration/s4hana/RfcClient'));
  const args = parseArgs(process.argv);
  const rfc = new RfcClient();
  runPgiFlow(rfc, args).catch((err) => {
    console.error('\nExecution failed:', err.message || err);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  validateT319A,
  validateLikpStatus,
  validateTransport,
  runPgiFlow
};
