#!/usr/bin/env node
'use strict';

/**
 * tools/validate-sap-sandbox.js
 *
 * Separately Controlled Non-Production SAP Validation Stage.
 * Performs safe, non-destructive, strictly READ-ONLY connectivity and catalog sanity checks
 * against the target DEV Sandbox (Client 220).
 *
 * Strict Write-Gate & Stop-Rule Discipline:
 * - NEVER executes in production (fails closed if SAP_SYSTEM_TYPE=prod or NODE_ENV=production).
 * - Requires explicit opt-in (ALLOW_LIVE_SAP_TOOLS=1 or RUN_LIVE_SAP=1).
 * - Declares READ-ONLY before every SAP call; zero writes, zero RFC/BAPI mutations.
 * - Redacts all secrets and credentials in logs.
 */

require('dotenv').config({ path: '.env.local' });
const { RfcClient } = require('../srv/integration/s4hana/RfcClient');

async function validateNonProdSap() {
  console.log('[SAP NON-PROD VALIDATION] Starting controlled non-production SAP smoke validation...');

  // 1. Environment & Production Gate Check
  const nodeEnv = String(process.env.NODE_ENV || '').trim().toLowerCase();
  const systemType = String(process.env.SAP_SYSTEM_TYPE || 'dev').trim().toLowerCase();

  if (nodeEnv === 'production' || systemType === 'prod') {
    console.error('[SAP NON-PROD VALIDATION] FAILED: Target is marked as production. Non-production validation is strictly forbidden in production.');
    process.exit(1);
  }

  const isOptedIn = process.env.ALLOW_LIVE_SAP_TOOLS === '1' || process.env.RUN_LIVE_SAP === '1' || process.argv.includes('--allow-live-sap');
  if (!isOptedIn) {
    console.log('[SAP NON-PROD VALIDATION] SKIPPED: Non-production SAP validation stage is gated. Set ALLOW_LIVE_SAP_TOOLS=1 or --allow-live-sap to execute.');
    process.exit(0);
  }

  const s4Client = process.env.S4_CLIENT || '220';
  console.log(`[SAP NON-PROD VALIDATION] Environment target confirmed: Non-Production Client ${s4Client} (Sandbox/DEV).`);
  console.log('[SAP NON-PROD VALIDATION] Mode: Strictly READ-ONLY. Zero mutations or writes.');

  // 2. Initialize RFC Client
  let rfc;
  try {
    rfc = new RfcClient();
  } catch (err) {
    console.error(`[SAP NON-PROD VALIDATION] FAILED: Could not initialize RFC client: ${err.message}`);
    process.exit(1);
  }

  // 3. READ-ONLY SAP Ping & Table Sanity Check
  try {
    console.log('\n[SAP NON-PROD VALIDATION] [READ-ONLY SAP OPERATION] Verifying RFC connectivity and table accessibility...');
    
    // Read T000 for client verification
    const t000Rows = await rfc.readTable('T000', ['MANDT', 'MTEXT'], [`MANDT = '${s4Client}'`]);
    if (!t000Rows || t000Rows.length === 0) {
      console.error(`[SAP NON-PROD VALIDATION] FAILED: SAP Client ${s4Client} not found in T000.`);
      process.exit(1);
    }
    console.log(`[SAP NON-PROD VALIDATION] Verified SAP Client in T000: Client=${t000Rows[0].MANDT}, Name=${t000Rows[0].MTEXT}`);

    // Read T001W for Plant 1120 verification
    const t001wRows = await rfc.readTable('T001W', ['WERKS', 'NAME1'], ["WERKS = '1120'"]);
    if (t001wRows && t001wRows.length > 0) {
      console.log(`[SAP NON-PROD VALIDATION] Verified SAP Plant in T001W: Plant=${t001wRows[0].WERKS}, Description=${t001wRows[0].NAME1}`);
    }

    console.log('\n[SAP NON-PROD VALIDATION] SUCCESS: Non-production SAP S/4HANA connectivity, authentication, and read-only DDIC access confirmed.');
    process.exit(0);
  } catch (err) {
    console.error(`[SAP NON-PROD VALIDATION] FAILED: SAP read-only check failed: ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  validateNonProdSap();
}

module.exports = { validateNonProdSap };
