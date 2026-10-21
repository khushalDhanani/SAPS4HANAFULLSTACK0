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

async function run1() {
  console.log('================================================================');
  console.log(' RUN 1: MOVEMENT TYPE 201 (GOODS ISSUE TO COST CENTER)');
  console.log(' Live SAP S/4HANA (Client 220) Verification Workflow');
  console.log('================================================================\n');

  const resumeArg = process.argv.find(a => a.startsWith('--resume'));
  let resumeRsnum = null;
  if (resumeArg) {
    const parts = resumeArg.split('=');
    resumeRsnum = parts[1] || process.argv[process.argv.indexOf(resumeArg) + 1] || '0000525278';
  }

  let rsnum, rspos = '0001', tbnum, tanum;

  if (resumeRsnum) {
    console.log(`[RESUME MODE] Resuming existing SAP Reservation ${resumeRsnum}...`);
    rsnum = resumeRsnum;
    const s4Rsnum = rsnum.padStart(10, '0');

    // Read back Reservation
    console.log('\n--- Reading back Reservation from SAP via RFC (RKPF / RESB) ---');
    const rkpfRows = await rfc.readTable('RKPF', ['RSNUM', 'BWART', 'KOSTL', 'USNAM', 'RSDAT'], [
      `RSNUM = '${s4Rsnum}'`
    ]);
    console.log('SAP RKPF (Header):', rkpfRows[0]);

    const resbRows = await rfc.readTable('RESB', ['RSNUM', 'RSPOS', 'MATNR', 'WERKS', 'LGORT', 'BDMNG', 'ENMNG', 'KZEAR'], [
      `RSNUM = '${s4Rsnum}'`,
      `AND RSPOS = '${rspos.padStart(4, '0')}'`
    ]);
    console.log('SAP RESB (Item):', resbRows[0]);

    // Read back TR from LTBK
    console.log('\n--- Reading back TR from SAP via RFC (LTBK / LTBP) ---');
    const ltbkRows = await rfc.readTable('LTBK', ['LGNUM', 'TBNUM', 'BWLVS', 'BETYP', 'BENUM', 'RSNUM', 'STATU', 'BDATU'], [
      "LGNUM = 'W01'",
      `AND RSNUM = '${s4Rsnum}'`
    ]);
    if (ltbkRows.length) {
      tbnum = ltbkRows[0].TBNUM;
      console.log('SAP LTBK (Header):', ltbkRows[0]);
      const ltbpRows = await rfc.readTable('LTBP', ['LGNUM', 'TBNUM', 'TBPOS', 'MATNR', 'WERKS', 'LGORT', 'MENGA', 'ELIKZ'], [
        "LGNUM = 'W01'",
        `AND TBNUM = '${tbnum}'`
      ]);
      console.log('SAP LTBP (Item):', ltbpRows[0]);
    }

    // Read back TO from LTAK
    if (tbnum) {
      console.log('\n--- Reading back TO from SAP via RFC (LTAK / LTAP) ---');
      const ltakRows = await rfc.readTable('LTAK', ['LGNUM', 'TANUM', 'BWLVS', 'TBNUM', 'KQUIT', 'BNAME', 'BDATU'], [
        "LGNUM = 'W01'",
        `AND TBNUM = '${tbnum}'`
      ]);
      if (ltakRows.length) {
        tanum = ltakRows[0].TANUM;
        console.log('SAP LTAK (Header):', ltakRows[0]);
        const ltapRows = await rfc.readTable('LTAP', ['LGNUM', 'TANUM', 'TAPOS', 'MATNR', 'VLTYP', 'VLPLA', 'NLTYP', 'NLPLA', 'PQUIT', 'NSOLA'], [
          "LGNUM = 'W01'",
          `AND TANUM = '${tanum}'`
        ]);
        console.log('SAP LTAP (Item):', ltapRows[0]);
      }
    }
  } else {
    // ------------------------------------------------------------------
    // STEP 1: CREATE RESERVATION (201) & AUTO-CREATE TR
    // ------------------------------------------------------------------
    console.log('--- Step 1: POST /odata/v4/reservation-entry/createReservationEntry ---');
    const resPayload = {
      MovementType: '201',
      Plant: '1120',
      StorageLocation: 'HS01',
      Material: '8000009754',
      Quantity: 1,
      Unit: 'NOS',
      CostCenter: '1011201301'
    };
    console.log('Request Payload:', JSON.stringify(resPayload, null, 2));

    const resResponse = await postJson(
      `${CAP_BASE}/odata/v4/reservation-entry/createReservationEntry`,
      resPayload
    );
    console.log('\n[CAP Response - Step 1]:', JSON.stringify(resResponse, null, 2));

    const createdEntry = resResponse;
    rsnum = createdEntry.ReservationNo || createdEntry.reservationNo;
    rspos = createdEntry.ReservationItem || createdEntry.reservationItem || '0001';
    tbnum = createdEntry.TransferRequirement || createdEntry.transferRequirement;

    if (!rsnum) {
      throw new Error('No ReservationNo returned by CAP service!');
    }
    console.log(`\n==> SAP Reservation Number: ${rsnum}/${rspos}`);

    // Read back directly from SAP DDIC tables via RFC
    console.log('\n--- Reading back Reservation directly from SAP via RFC (RKPF / RESB) ---');
    const s4Rsnum = rsnum.padStart(10, '0');
    const rkpfRows = await rfc.readTable('RKPF', ['RSNUM', 'BWART', 'KOSTL', 'USNAM', 'RSDAT'], [
      `RSNUM = '${s4Rsnum}'`
    ]);
    console.log('SAP RKPF (Header):', rkpfRows[0]);

    const resbRows = await rfc.readTable('RESB', ['RSNUM', 'RSPOS', 'MATNR', 'WERKS', 'LGORT', 'BDMNG', 'ENMNG', 'KZEAR'], [
      `RSNUM = '${s4Rsnum}'`,
      `AND RSPOS = '${rspos.padStart(4, '0')}'`
    ]);
    console.log('SAP RESB (Item):', resbRows[0]);

    // If TR was not auto-created, retry TR creation via retryStep (LB01)
    if (!tbnum || tbnum === '0000000000') {
      console.log('\nTR not returned in immediate response. Calling retryStep (LB01)...');
      const retryTrResp = await postJson(
        `${CAP_BASE}/odata/v4/reservation-entry/retryStep`,
        {
          ReservationNo: rsnum,
          ReservationItem: rspos,
          Step: 'LB01'
        }
      );
      console.log('retryStep LB01 response:', retryTrResp);
      tbnum = retryTrResp.TransferRequirement;
    }

    console.log(`\n==> SAP Transfer Requirement Number: ${tbnum}`);

    // Read back TR from SAP LTBK / LTBP via RFC
    console.log('\n--- Reading back TR directly from SAP via RFC (LTBK / LTBP) ---');
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
      unit: 'NOS',
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
  }

  // Read back Quant status from LQUA before GI
  console.log('\n--- Inspecting LQUA Quant Position in SAP before GI ---');
  const lquaRows = await rfc.readTable('LQUA', ['LGNUM', 'LQNUM', 'MATNR', 'WERKS', 'LGORT', 'VERME', 'MEINS', 'LGTYP', 'LGPLA', 'BESTQ'], [
    "LGNUM = 'W01'",
    `AND MATNR LIKE '%8000009754%'`,
    "AND WERKS = '1120'",
    "AND LGORT = 'HS01'"
  ]);
  console.log('SAP LQUA Quants in 1120/HS01:');
  lquaRows.forEach(q => console.log(`  Quant ${q.LQNUM}: ${q.VERME} ${q.MEINS} at ${q.LGTYP}/${q.LGPLA} (Stock Category: ${q.BESTQ || 'unrestricted'})`));

  // ------------------------------------------------------------------
  // STEP 3: GOODS MOVEMENT POSTING (BAPI_GOODSMVT_CREATE / MIGO)
  // ------------------------------------------------------------------
  console.log('\n--- Step 3: POST /odata/v4/reservation-entry/postMigoGoodsMovement ---');
  const migoPayload = {
    ReservationNo: rsnum,
    ReservationItem: rspos,
    Serials: ['ABS1234567']
  };
  console.log('Request Payload:', JSON.stringify(migoPayload, null, 2));

  const migoResponse = await postJson(
    `${CAP_BASE}/odata/v4/reservation-entry/postMigoGoodsMovement`,
    migoPayload
  );
  console.log('\n[CAP Response - Step 3]:', JSON.stringify(migoResponse, null, 2));

  const mblnr = migoResponse.materialDocument || migoResponse.MaterialDocument;
  const mjahr = migoResponse.materialDocYear || migoResponse.MaterialDocYear;
  console.log(`\n==> SAP Material Document: ${mblnr}/${mjahr}`);

  // Read back Material Document directly from SAP MATDOC via RFC
  console.log('\n--- Reading back Material Document directly from SAP via RFC (MATDOC) ---');
  const matdocRows = await rfc.readTable('MATDOC', ['MBLNR', 'MJAHR', 'ZEILE', 'BWART', 'MATNR', 'WERKS', 'LGORT', 'MENGE', 'MEINS', 'KOSTL', 'RSNUM', 'RSPOS'], [
    `MBLNR = '${mblnr}'`,
    `AND MJAHR = '${mjahr}'`
  ]);
  console.log('SAP MATDOC (Posting Record):', matdocRows[0]);

  // Read back final Reservation status from RESB
  console.log('\n--- Verifying final Reservation Status in SAP RESB ---');
  const s4Rsnum = rsnum.padStart(10, '0');
  const finalResb = await rfc.readTable('RESB', ['RSNUM', 'RSPOS', 'MATNR', 'BDMNG', 'ENMNG', 'KZEAR'], [
    `RSNUM = '${s4Rsnum}'`,
    `AND RSPOS = '${rspos.padStart(4, '0')}'`
  ]);
  console.log('SAP RESB Final Record:', finalResb[0]);

  // Read back final LQUA quants
  console.log('\n--- Inspecting final LQUA Quants in SAP ---');
  const finalLqua = await rfc.readTable('LQUA', ['LGNUM', 'LQNUM', 'MATNR', 'VERME', 'MEINS', 'LGTYP', 'LGPLA'], [
    "LGNUM = 'W01'",
    `AND MATNR LIKE '%8000009754%'`,
    "AND WERKS = '1120'",
    "AND LGORT = 'HS01'"
  ]);
  console.log('SAP Final LQUA Quants:');
  finalLqua.forEach(q => console.log(`  Quant ${q.LQNUM}: ${q.VERME} ${q.MEINS} at ${q.LGTYP}/${q.LGPLA}`));

  console.log('\n================================================================');
  console.log(' RUN 1: COMPLETE LIVE WALKTHROUGH PROVEN ON SAP S/4HANA (CLIENT 220)');
  console.log('================================================================');
}

run1().catch((err) => {
  console.error('\n*** RUN 1 FAILED ***');
  if (err.data) {
    console.error('Status:', err.status);
    console.error('Data:', JSON.stringify(err.data, null, 2));
  } else {
    console.error(err.message);
  }
  process.exit(1);
});
