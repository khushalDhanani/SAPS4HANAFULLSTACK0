require('./live-sap-gate')();
'use strict';
/**
 * Step 1 live execution: Create picking Transfer Order for Outbound Delivery 0080000134 in W01
 * via Z_WM_TO_CREATE_DN, and verify LIKP-KOSTK = 'C' and LTAK.
 *
 * LIVE SAP WRITE: requires explicit user authorization:
 *   ALLOW_LIVE_SAP_TOOLS=1 node tools/test-step1-picking-to.js --allow-live-sap
 */
const path = require('path');
const root = path.resolve(__dirname, '..');
require(path.join(root, 'node_modules/dotenv')).config({ path: path.join(root, '.env.local') });

const ReservationProcessAdapter = require(path.join(root, 'srv/integration/s4hana/wm/ReservationProcessAdapter'));
const { RfcClient } = require(path.join(root, 'srv/integration/s4hana/RfcClient'));

(async () => {
  const delivNo = '0080000134';
  const warehouse = 'W01';
  const rfc = new RfcClient();
  const adapter = new ReservationProcessAdapter(rfc);

  console.log(`\n=== STEP 1: Picking TO for Delivery ${delivNo} in ${warehouse} ===\n`);

  // 1. READ-ONLY Pre-check
  console.log('--- READ-ONLY Pre-check ---');
  const likpPre = await rfc.readTable('LIKP', ['VBELN', 'WBSTK', 'KOSTK', 'LVSTK', 'LFART'], [`VBELN = '${delivNo}'`], 1);
  console.log('LIKP before:', JSON.stringify(likpPre?.[0] || {}));
  const ltakPre = await rfc.readTable('LTAK', ['LGNUM', 'TANUM', 'KQUIT', 'VBELN'], [`VBELN = '${delivNo}'`], 5);
  console.log('Existing TOs in LTAK before:', JSON.stringify(ltakPre || []));

  // 2. WRITE: Execute picking TO creation
  console.log('\n--- WRITE: Calling createDeliveryPickingTO ---');
  const res = await adapter.createDeliveryPickingTO(delivNo, { warehouse });
  console.log('createDeliveryPickingTO result:', JSON.stringify(res, null, 2));

  // 3. READ-ONLY Read-back verification
  console.log('\n--- READ-ONLY Read-back Verification ---');
  const likpPost = await rfc.readTable('LIKP', ['VBELN', 'WBSTK', 'KOSTK', 'LVSTK'], [`VBELN = '${delivNo}'`], 1);
  console.log('LIKP after:', JSON.stringify(likpPost?.[0] || {}));
  const ltakPost = await rfc.readTable('LTAK', ['LGNUM', 'TANUM', 'KQUIT', 'VBELN', 'BNAME', 'BDATU', 'BZEIT'], [`VBELN = '${delivNo}'`], 5);
  console.log('LTAK rows after:', JSON.stringify(ltakPost || []));

  if (res.transferOrder) {
    const ltap = await rfc.readTable('LTAP', ['TANUM', 'TAPOS', 'MATNR', 'WERKS', 'LGORT', 'VSOLA', 'MEINS', 'VLTYP', 'VLPLA', 'NLTYP', 'NLPLA', 'PQUIT'], [`TANUM = '${res.transferOrder.padStart(10, '0')}'`], 5);
    console.log(`LTAP item(s) for TO ${res.transferOrder}:`, JSON.stringify(ltap || []));
  }

  const isPicked = likpPost?.[0]?.KOSTK === 'C';
  console.log(`\nSTEP 1 OUTCOME: ${isPicked ? 'SUCCESS - DELIVERY COMPLETELY PICKED' : 'FAILED - DELIVERY NOT PICKED'}`);
})();
