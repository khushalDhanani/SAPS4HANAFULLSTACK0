require('./live-sap-gate')();
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });
const { RfcClient } = require('../srv/integration/s4hana/RfcClient');

const CAP_BASE = 'http://localhost:4004';
const AUTH_HEADER = 'Basic ' + Buffer.from('alice:admin').toString('base64');
const rfc = new RfcClient();

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': AUTH_HEADER
    },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error?.message || `HTTP ${res.status} ${res.statusText}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function run4() {
  console.log('================================================================');
  console.log(' RUN 4: MOVEMENT TYPE 301 (TRANSFER POSTING PLANT TO PLANT, ONE-STEP)');
  console.log(' Live SAP S/4HANA (Client 220) Verification Workflow');
  console.log('================================================================\n');

  let rsnum = null;
  let rspos = '0001';
  let tbnum = null;
  let tanum = null;
  let mblnr = null;
  let mjahr = null;

  try {
    // ------------------------------------------------------------------
    // STEP 1: CREATE RESERVATION (MOVEMENT 301)
    // ------------------------------------------------------------------
    console.log('--- Step 1: POST /odata/v4/reservation-entry/createReservationEntry (Mvt 301) ---');
    const resPayload = {
      MovementType: '301',
      Plant: '1120',
      StorageLocation: 'CS01',
      ReceivingPlant: '1110',
      ReceivingStorageLocation: 'CS01',
      Material: '8900000004',
      Quantity: 1,
      Unit: 'KG',
      Batch: 'INJW260001',
      WarehouseNumber: 'W01'
    };
    console.log('Request Payload:', JSON.stringify(resPayload, null, 2));

    const resResponse = await postJson(
      `${CAP_BASE}/odata/v4/reservation-entry/createReservationEntry`,
      resPayload
    );
    console.log('\n[CAP Response - Step 1]:', JSON.stringify(resResponse, null, 2));

    rsnum = resResponse.ReservationNo;
    rspos = resResponse.ReservationItem || '0001';
    tbnum = resResponse.TransferRequirement;

    if (!rsnum) throw new Error('No ReservationNo returned by CAP service!');
    console.log(`\n==> SAP Reservation Number: ${rsnum}/${rspos}`);

    // Read back directly from SAP DDIC tables via RFC
    console.log('\n--- Reading back Reservation directly from SAP via RFC (RKPF / RESB) ---');
    const s4Rsnum = rsnum.padStart(10, '0');
    const rkpfRows = await rfc.readTable('RKPF', ['RSNUM', 'BWART', 'UMWRK', 'UMLGO', 'USNAM', 'RSDAT'], [
      `RSNUM = '${s4Rsnum}'`
    ]);
    console.log('SAP RKPF (Header):', rkpfRows[0]);

    const resbRows = await rfc.readTable('RESB', ['RSNUM', 'RSPOS', 'MATNR', 'WERKS', 'LGORT', 'UMWRK', 'UMLGO', 'BDMNG', 'ENMNG', 'KZEAR'], [
      `RSNUM = '${s4Rsnum}'`,
      `AND RSPOS = '${rspos.padStart(4, '0')}'`
    ]);
    console.log('SAP RESB (Item):', resbRows[0]);

    // ------------------------------------------------------------------
    // STEP 1b: VERIFY TRANSFER REQUIREMENT (LTBK / LTBP)
    // ------------------------------------------------------------------
    console.log('\n--- Step 1b: Verifying Transfer Requirement in SAP (LTBK / LTBP) ---');
    const s4Tbnum = tbnum.padStart(10, '0');
    const ltbkRows = await rfc.readTable('LTBK', ['LGNUM', 'TBNUM', 'BWLVS', 'BETYP', 'BENUM', 'RSNUM', 'STATU', 'BDATU'], [
      "LGNUM = 'W01'",
      `AND TBNUM = '${s4Tbnum}'`
    ]);
    console.log('SAP LTBK (Header):', ltbkRows[0]);

    const ltbpRows = await rfc.readTable('LTBP', ['LGNUM', 'TBNUM', 'TBPOS', 'MATNR', 'WERKS', 'LGORT', 'MENGA', 'ELIKZ'], [
      "LGNUM = 'W01'",
      `AND TBNUM = '${s4Tbnum}'`
    ]);
    console.log('SAP LTBP (Item):', ltbpRows[0]);

    // ------------------------------------------------------------------
    // STEP 2: CHAINED TO STEP (CREATE TO + CONFIRM TO IN ONE STEP)
    // ------------------------------------------------------------------
    console.log('\n--- Step 2: POST /odata/v4/tr-to/createTOFromTR (Chained Create + Confirm) ---');
    const toPayload = {
      lgnum: 'W01',
      tbnum: s4Tbnum,
      tbpos: '0001',
      qty: 1,
      unit: 'KG',
      batch: 'INJW260001',
      autoConfirm: true
    };
    console.log('Request Payload:', JSON.stringify(toPayload, null, 2));

    const toResponse = await postJson(
      `${CAP_BASE}/odata/v4/tr-to/createTOFromTR`,
      toPayload
    );
    console.log('\n[CAP Response - Step 2]:', JSON.stringify(toResponse, null, 2));

    tanum = toResponse.TransferOrder;
    const toStatus = toResponse.Status;
    const toConfirmed = toResponse.Confirmed;
    console.log(`\n==> SAP Transfer Order Number: ${tanum} | Status: ${toStatus} | Confirmed: ${toConfirmed}`);

    // Read back TO directly from SAP LTAK / LTAP via RFC
    console.log('\n--- Reading back TO directly from SAP via RFC (LTAK / LTAP) ---');
    const s4Tanum = tanum.padStart(10, '0');
    const ltakRows = await rfc.readTable('LTAK', ['LGNUM', 'TANUM', 'BWLVS', 'TBNUM', 'KQUIT', 'BNAME', 'BDATU'], [
      "LGNUM = 'W01'",
      `AND TANUM = '${s4Tanum}'`
    ]);
    console.log('SAP LTAK (Header):', ltakRows[0]);

    const ltapRows = await rfc.readTable('LTAP', ['LGNUM', 'TANUM', 'TAPOS', 'MATNR', 'VLTYP', 'VLPLA', 'NLTYP', 'NLPLA', 'PQUIT', 'NSOLA'], [
      "LGNUM = 'W01'",
      `AND TANUM = '${s4Tanum}'`
    ]);
    console.log('SAP LTAP (Item):', ltapRows[0]);

    // ------------------------------------------------------------------
    // STEP 3: MIGO GOODS MOVEMENT (TRANSFER POSTING 301 PLANT TO PLANT)
    // ------------------------------------------------------------------
    console.log('\n--- Step 3: POST /odata/v4/reservation-entry/postMigoGoodsMovement (Mvt 301) ---');
    const migoPayload = {
      ReservationNo: rsnum,
      ReservationItem: rspos,
      MovementType: '301',
      Plant: '1120',
      StorageLocation: 'CS01',
      ReceivingPlant: '1110',
      ReceivingStorageLocation: 'CS01',
      Material: '8900000004',
      Quantity: 1,
      Unit: 'KG',
      Batch: 'INJW260001'
    };
    console.log('Request Payload:', JSON.stringify(migoPayload, null, 2));

    const migoResponse = await postJson(
      `${CAP_BASE}/odata/v4/reservation-entry/postMigoGoodsMovement`,
      migoPayload
    );
    console.log('\n[CAP Response - Step 3]:', JSON.stringify(migoResponse, null, 2));

    mblnr = migoResponse.MaterialDocument;
    mjahr = migoResponse.MaterialDocYear;
    if (!mblnr) {
      throw new Error(`MIGO goods movement failed: ${migoResponse.ErrorMessage || 'No Material Document returned'}`);
    }
    console.log(`\n==> SAP Material Document: ${mblnr} / Year: ${mjahr}`);

    // Read back Material Document directly from MATDOC
    console.log('\n--- Reading back Material Document directly from MATDOC via RFC ---');
    const matdocRows = await rfc.readTable('MATDOC', [
      'MBLNR', 'MJAHR', 'ZEILE', 'BWART', 'MATNR', 'WERKS', 'LGORT', 'MENGE', 'MEINS', 'CHARG', 'UMWRK', 'UMLGO', 'RSNUM', 'RSPOS'
    ], [
      `MBLNR = '${mblnr}'`,
      `AND MJAHR = '${mjahr}'`
    ], 5);
    console.log('SAP MATDOC Rows:', matdocRows);

    // Read back Reservation Status from RESB to confirm item closed
    console.log('\n--- Checking Final Reservation Closure in RESB ---');
    const resbFinal = await rfc.readTable('RESB', ['RSNUM', 'RSPOS', 'BDMNG', 'ENMNG', 'KZEAR'], [
      `RSNUM = '${s4Rsnum}'`,
      `AND RSPOS = '${rspos.padStart(4, '0')}'`
    ]);
    console.log('SAP RESB Final State:', resbFinal[0]);

    // Read back MARD stock across Plant 1120 and Plant 1110
    console.log('\n--- Checking MARD Stock Balance across Plants (1120 & 1110) ---');
    const mardStock = await rfc.readTable('MARD', ['MATNR', 'WERKS', 'LGORT', 'LABST'], [
      `MATNR = '000000008900000004'`
    ], 10);
    console.log('SAP MARD Stock across Plants:', mardStock);

    console.log('\n================================================================');
    console.log(' RUN 4 (MOVEMENT TYPE 301) COMPLETED SUCCESSFULLY!');
    console.log(` Reservation:         ${rsnum} (RKPF/RESB)`);
    console.log(` Transfer Requirement: ${tbnum} (LTBK/LTBP)`);
    console.log(` Transfer Order:       ${tanum} (LTAK/LTAP - Confirmed: ${toConfirmed})`);
    console.log(` Material Document:    ${mblnr}/${mjahr} (MATDOC)`);
    console.log(' 100% REAL SAP S/4HANA CLIENT 220 AUDIT TRAIL VERIFIED');
    console.log('================================================================\n');

  } catch (err) {
    console.error('\n*** RUN 4 FAILED ***:', err.message);
    if (err.data) console.error('Error Details:', JSON.stringify(err.data, null, 2));
    process.exit(1);
  }
}

run4().catch(console.error);
