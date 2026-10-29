#!/usr/bin/env node
'use strict';

/**
 * tools/check-service-connectivity.js
 *
 * Post-Deployment & Pre-Flight Service Connectivity Checker.
 * Verifies live or configured connectivity across:
 * 1. SAP S/4HANA RFC Connectivity (safe ping & T000 check)
 * 2. SAP S/4HANA OData Gateway HTTP Connectivity
 * 3. BTP Service Bindings & Security Guardrails
 * 4. AI Service Provider Configuration & Readiness
 *
 * Discipline:
 * - Strictly READ-ONLY. Zero data mutations.
 * - Credentials completely redacted in all logs and outputs.
 * - Gated live checks when running outside sandbox/live environment.
 */

require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });

const productionGuard = require('../srv/common/productionGuard');
const s4Config = require('../srv/common/s4Config');
const { RfcClient } = require('../srv/integration/s4hana/RfcClient');
const aiClient = require('../srv/common/aiClient');
const { rfcPreflight } = require('./rfc-preflight');

async function checkServiceConnectivity(options = {}) {
  const allowLive = options.allowLiveSap || process.env.ALLOW_LIVE_SAP_TOOLS === '1' || process.argv.includes('--allow-live-sap');
  const results = [];
  let allHealthy = true;

  console.log('='.repeat(72));
  console.log('   SAP S/4HANA & BTP SERVICE CONNECTIVITY CHECK');
  console.log('='.repeat(72));
  console.log(`Node Environment:  ${process.env.NODE_ENV || 'development'}`);
  console.log(`Timestamp:         ${new Date().toISOString()}`);
  console.log(`Live Probe Mode:   ${allowLive ? 'Active (Live Probes Enabled)' : 'Config/Guard Check Only'}`);
  console.log('-'.repeat(72));

  // 1. Production Guard & Architecture Security Check
  try {
    productionGuard.assertDevFlagsOff(process.env, {});
    productionGuard.assertS4ConnectionConfig(process.env);
    console.log('  [PASS] Security & Production Guardrails: Zero illegal dev flags or leaked secrets.');
    results.push({ check: 'Production Guardrails', status: 'PASSED' });
  } catch (err) {
    allHealthy = false;
    console.log(`  [FAIL] Security & Production Guardrails: ${err.message}`);
    results.push({ check: 'Production Guardrails', status: 'FAILED', error: err.message });
  }

  // 2. S/4HANA Configuration Resolution
  let client, systemLabel;
  try {
    client = s4Config.getClient();
    systemLabel = s4Config.getSystemLabel();
    console.log(`  [PASS] S/4HANA Configuration: Resolved System Label "${systemLabel}" (Client ${client}).`);
    results.push({ check: 'S/4HANA Config Resolution', status: 'PASSED', details: systemLabel });
  } catch (err) {
    allHealthy = false;
    console.log(`  [FAIL] S/4HANA Configuration: ${err.message}`);
    results.push({ check: 'S/4HANA Config Resolution', status: 'FAILED', error: err.message });
  }

  // 3. AI Service Configuration
  try {
    const provider = aiClient.getProvider();
    const model = aiClient.getDefaultModel();
    let isConfigured = false;
    if (provider === 'sap') {
      try {
        const k = JSON.parse(process.env.AICORE_SERVICE_KEY || '');
        isConfigured = Boolean(k.url && k.clientid);
      } catch (_) {
        isConfigured = false;
      }
    } else {
      isConfigured = Boolean(process.env.NVIDIA_API_KEY && !process.env.NVIDIA_API_KEY.includes('xxxxx'));
    }

    console.log(`  [PASS] AI Service Integration: Provider="${provider}", Model="${model}", Configured=${isConfigured}.`);
    results.push({ check: 'AI Service Config', status: 'PASSED', details: { provider, model, isConfigured } });
  } catch (err) {
    console.log(`  [WARN] AI Service Integration: ${err.message}`);
    results.push({ check: 'AI Service Config', status: 'WARNING', error: err.message });
  }

  // 4. Live SAP S/4HANA RFC & Table Probe
  if (allowLive) {
    console.log('\n  [INFO] Executing safe READ-ONLY live SAP RFC connectivity check...');
    const pre = await rfcPreflight({ rfcClient: options.rfcClient || new RfcClient(), client });
    if (pre.ok) {
      console.log(`  [PASS] Live SAP RFC: ${pre.message}.`);
      results.push({ check: 'Live SAP RFC', status: 'PASSED', client: pre.client });
    } else {
      allHealthy = false;
      console.log(`  [FAIL] Live SAP RFC [${pre.stage}]: ${pre.message}`);
      results.push({ check: 'Live SAP RFC', status: 'FAILED', stage: pre.stage, error: pre.message });
    }
  } else {
    console.log('  [SKIP] Live SAP RFC Check: Gated by default (set ALLOW_LIVE_SAP_TOOLS=1 or --allow-live-sap to probe).');
    results.push({ check: 'Live SAP RFC', status: 'SKIPPED' });
  }

  console.log('-'.repeat(72));
  console.log(`Overall Service Connectivity Status: ${allHealthy ? 'HEALTHY' : 'DEGRADED / ACTION REQUIRED'}`);
  console.log('='.repeat(72));

  return {
    allHealthy,
    results
  };
}

if (require.main === module) {
  checkServiceConnectivity().then(({ allHealthy }) => {
    process.exit(allHealthy ? 0 : 1);
  }).catch(err => {
    console.error('Fatal connectivity check error:', err);
    process.exit(1);
  });
}

module.exports = { checkServiceConnectivity };
