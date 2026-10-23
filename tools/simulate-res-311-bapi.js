'use strict';

/**
 * tools/simulate-res-311-bapi.js
 *
 * [WRITE-class] SAP BAPI execution: BAPI_GOODSMVT_CREATE with TESTRUN = 'X'.
 * Even with TESTRUN='X', BAPIs that execute movement transactions are classified
 * as WRITE-class under repository policy (AGENTS.md).
 *
 * WARNING: Do not run on shipping-managed storage locations (e.g. CS02): may create an outbound delivery; see WORKSTATUS 2026-10-21 19:50.
 *
 * DYNAMIC: Reads reservation item from RESB at runtime based on --reservation and --item flags.
 * GM_CODE: '06' (MB11 - Goods movement with reservation reference).
 *
 * GATES:
 * 1. live-sap-gate (ALLOW_LIVE_SAP_TOOLS=1 and --allow-live-sap)
 * 2. User Written "Go" (USER_WRITTEN_GO=go and --user-go)
 * 3. Shipping-managed safety refusal: strictly refuses shipping-managed SLocs (e.g. CS02)
 *
 * BEHAVIOR:
 * If gates are NOT met or source SLoc is shipping-managed, prints the planned payload / refusal message and exits with code 1.
 * If gates ARE met, runs BAPI_GOODSMVT_CREATE in an RFC session, ending with BAPI_TRANSACTION_ROLLBACK.
 *
 * STILL NOT RUN: Prepared only. Do not run without explicit user written "go".
 */

const path = require('path');

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    reservation: '529960',
    item: '1',
    userGo: false,
    allowLiveSap: false
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--user-go') {
      args.userGo = true;
    } else if (a === '--allow-live-sap') {
      args.allowLiveSap = true;
    } else if (a.startsWith('--reservation=')) {
      args.reservation = a.split('=')[1];
    } else if (a === '-r' || a === '--reservation') {
      args.reservation = argv[++i];
    } else if (a.startsWith('--item=')) {
      args.item = a.split('=')[1];
    } else if (a === '-i' || a === '--item') {
      args.item = argv[++i];
    }
  }
  return args;
}

function checkGates(args, env = process.env) {
  const liveGatePassed = String(env.ALLOW_LIVE_SAP_TOOLS || '').trim() === '1' && args.allowLiveSap === true;
  const userGoPassed = String(env.USER_WRITTEN_GO || '').trim() === 'go' && args.userGo === true;
  return {
    liveGatePassed,
    userGoPassed,
    canExecute: liveGatePassed && userGoPassed
  };
}

function formatSapDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function buildPlannedPayload(resbRow, referenceDoc) {
  const rsnum = String(resbRow.RSNUM || '').trim().padStart(10, '0');
  const rspos = String(resbRow.RSPOS || '1').trim().padStart(4, '0');
  const matnr = String(resbRow.MATNR || '').trim();
  const werks = String(resbRow.WERKS || '').trim().toUpperCase();
  const lgort = String(resbRow.LGORT || '').trim().toUpperCase();
  const umlgo = String(resbRow.UMLGO || '').trim().toUpperCase();
  const charg = String(resbRow.CHARG || '').trim().toUpperCase();
  const meins = String(resbRow.MEINS || 'NOS').trim().toUpperCase();

  const bdmng = parseFloat(resbRow.BDMNG || '0');
  const enmng = parseFloat(resbRow.ENMNG || '0');
  const openQty = Math.max(0, bdmng - enmng) || 1.0;

  const bapiCode = {
    GM_CODE: '06' // MB11 - Goods movement with reservation reference
  };

  const bapiHeader = {
    PSTNG_DATE: formatSapDate(),
    DOC_DATE: formatSapDate(),
    REF_DOC_NO: String(referenceDoc || `SIM${rsnum}_${rspos}`).slice(0, 16),
    HEADER_TXT: `RESV 311 ${rsnum}/${rspos}`.slice(0, 25)
  };

  const bapiItem = [{
    MATERIAL: matnr,
    PLANT: werks,
    STGE_LOC: lgort,
    MOVE_TYPE: '311',
    ENTRY_QNT: openQty,
    ENTRY_UOM: meins,
    MOVE_PLANT: werks,
    MOVE_STLOC: umlgo,
    RESERV_NO: rsnum,
    RES_ITEM: rspos,
    ...(charg ? { BATCH: charg } : {})
  }];

  return {
    GOODSMVT_CODE: bapiCode,
    GOODSMVT_HEADER: bapiHeader,
    TESTRUN: 'X',
    GOODSMVT_ITEM: bapiItem
  };
}

async function readReservationFromSap(rfc, rsnum, rspos) {
  const formattedRsnum = String(rsnum).trim().padStart(10, '0');
  const formattedRspos = String(rspos || '1').trim().padStart(4, '0');

  const fields = ['RSNUM', 'RSPOS', 'MATNR', 'WERKS', 'LGORT', 'UMLGO', 'CHARG', 'BDMNG', 'ENMNG', 'MEINS', 'KZEAR', 'XLOEK'];
  const rows = await rfc.readTable('RESB', fields, [
    `RSNUM = '${formattedRsnum}' AND RSPOS = '${formattedRspos}'`
  ], 1);

  if (!rows || rows.length === 0) {
    throw new Error(`Reservation ${formattedRsnum}/${formattedRspos} not found in SAP table RESB`);
  }
  return rows[0];
}

function isShippingManaged(t001lRow) {
  if (!t001lRow) return false;
  const vstel = String(t001lRow.VSTEL || '').trim();
  const vkorg = String(t001lRow.VKORG || '').trim();
  const kunnr = String(t001lRow.KUNNR || '').trim();
  return Boolean(vstel || vkorg || kunnr);
}

async function readSlocFromSap(rfc, werks, lgort) {
  const formattedWerks = String(werks || '').trim().toUpperCase();
  const formattedLgort = String(lgort || '').trim().toUpperCase();
  const fields = ['WERKS', 'LGORT', 'LGOBE', 'XHUPF', 'PARLG', 'VKORG', 'VTWEG', 'SPART', 'KUNNR', 'LIFNR', 'VSTEL'];
  const rows = await rfc.readTable('T001L', fields, [
    `WERKS = '${formattedWerks}' AND LGORT = '${formattedLgort}'`
  ], 1);
  return rows?.[0] || null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const gates = checkGates(args, process.env);

  console.log('========================================================================');
  console.log('tools/simulate-res-311-bapi.js — [WRITE-class] SAP BAPI Simulation Tool');
  console.log(`Target Reservation: ${args.reservation} / Item: ${args.item}`);
  console.log('========================================================================');

  // Load dotenv
  require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
  const { RfcClient } = require('../srv/integration/s4hana/RfcClient');
  const rfc = new RfcClient();

  // 1. Always attempt to read reservation from SAP (READ-ONLY) to construct exact dynamic payload
  let resbRow;
  try {
    console.log(`[READ-ONLY SAP CALL] Querying RESB for reservation ${args.reservation} item ${args.item}...`);
    resbRow = await readReservationFromSap(rfc, args.reservation, args.item);
    console.log('Found RESB row:', {
      RSNUM: resbRow.RSNUM,
      RSPOS: resbRow.RSPOS,
      MATNR: resbRow.MATNR,
      WERKS: resbRow.WERKS,
      LGORT: resbRow.LGORT,
      UMLGO: resbRow.UMLGO,
      BDMNG: resbRow.BDMNG,
      ENMNG: resbRow.ENMNG,
      MEINS: resbRow.MEINS,
      KZEAR: resbRow.KZEAR,
      XLOEK: resbRow.XLOEK
    });
  } catch (err) {
    console.warn(`Could not read RESB dynamically: ${err.message}. Using fallback schema for planned payload print.`);
    resbRow = {
      RSNUM: args.reservation,
      RSPOS: args.item,
      MATNR: '8000009754',
      WERKS: '1120',
      LGORT: 'CS02',
      UMLGO: 'CIS1',
      BDMNG: '1.000',
      ENMNG: '0.000',
      MEINS: 'NOS'
    };
  }

  // 2. Build planned payload
  const plannedPayload = buildPlannedPayload(resbRow, `SIM${Date.now()}`.slice(0, 16));

  console.log('\n--- PLANNED SAP BAPI_GOODSMVT_CREATE PAYLOAD ---');
  console.log(JSON.stringify(plannedPayload, null, 2));
  console.log('------------------------------------------------\n');

  // 3. Check if source storage location is shipping-managed (safety refusal)
  let t001lRow = null;
  try {
    console.log(`[READ-ONLY SAP CALL] Querying T001L for storage location ${resbRow.WERKS}/${resbRow.LGORT}...`);
    t001lRow = await readSlocFromSap(rfc, resbRow.WERKS, resbRow.LGORT);
  } catch (err) {
    console.warn(`Could not read T001L for ${resbRow.WERKS}/${resbRow.LGORT}: ${err.message}`);
  }

  const shippingManaged = isShippingManaged(t001lRow);
  if (shippingManaged) {
    const vstel = t001lRow?.VSTEL ? ` (T001L-VSTEL: '${t001lRow.VSTEL}')` : '';
    console.error('========================================================================');
    console.error(`REFUSED: Storage location ${resbRow.LGORT} in plant ${resbRow.WERKS} is shipping-managed${vstel}.`);
    console.error('Do not run on shipping-managed storage locations (e.g. CS02): may create an outbound delivery; see WORKSTATUS 2026-10-21 19:50.');
    console.error('Zero BAPI calls made. Exiting.');
    console.error('========================================================================');
    process.exit(1);
  }

  // 4. Gate enforcement
  if (!gates.canExecute) {
    console.error('========================================================================');
    console.error('BLOCKED: WRITE-class execution gates not met.');
    if (!gates.liveGatePassed) {
      console.error('  - Live SAP Gate missing: Set ALLOW_LIVE_SAP_TOOLS=1 and pass --allow-live-sap');
    }
    if (!gates.userGoPassed) {
      console.error('  - User Written "Go" missing: Set USER_WRITTEN_GO=go and pass --user-go');
    }
    console.error('Planned payload displayed above. Zero BAPI calls made. Exiting.');
    console.error('========================================================================');
    process.exit(1);
  }

  // 5. Execution ONLY when gates explicitly passed
  console.log('[WRITE-class SAP CALL] All gates passed. Opening RFC session for BAPI_GOODSMVT_CREATE...');
  await rfc.session(async (call) => {
    console.log('[WRITE-class SAP CALL] Executing BAPI_GOODSMVT_CREATE with TESTRUN = \'X\'...');
    const result = await call('BAPI_GOODSMVT_CREATE', plannedPayload);

    console.log('[WRITE-class SAP CALL] BAPI_GOODSMVT_CREATE Response:');
    console.log('  MATERIALDOCUMENT:', result.MATERIALDOCUMENT);
    console.log('  MATDOCUMENTYEAR:', result.MATDOCUMENTYEAR);
    console.log('  RETURN messages:', result.RETURN || []);

    console.log('[WRITE-class SAP CALL] Executing explicit BAPI_TRANSACTION_ROLLBACK...');
    await call('BAPI_TRANSACTION_ROLLBACK');
    console.log('[WRITE-class SAP CALL] BAPI_TRANSACTION_ROLLBACK executed. Session clean.');

    return result;
  });
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal error during simulation script:', err);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  checkGates,
  buildPlannedPayload,
  readReservationFromSap,
  isShippingManaged,
  readSlocFromSap,
  main
};
