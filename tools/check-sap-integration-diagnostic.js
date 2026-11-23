#!/usr/bin/env node
'use strict';

/**
 * tools/check-sap-integration-diagnostic.js
 *
 * Separately controlled, read-only SAP integration diagnostic CLI tool.
 * Resolves Finding MON-01 (P1): Dependency health is not the same as live SAP connectivity.
 *
 * Distinct lifecycle states reported per integration channel (OData and RFC):
 * 1. Configured             — Destination, configuration, and libraries present
 * 2. Reachable              — Low-level network transport / Gateway port reachable
 * 3. Authenticated          — SAP accepted technical credentials
 * 4. Authorized             — User has authorizations for the service/catalogs
 * 5. Metadata verified      — OData $metadata or RFC interface definition retrieved & valid
 * 6. Functionally verified  — Safe, strictly READ-ONLY business/customizing query succeeded
 *
 * Safety:
 * - Strictly READ-ONLY. Zero data mutations, zero writes.
 * - Credentials completely redacted in all outputs.
 * - Requires explicit live opt-in (ALLOW_LIVE_SAP_TOOLS=1 or --allow-live-sap) for live probes.
 */

require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env' });

const { runIntegrationDiagnostics } = require('../srv/common/integrationDiagnostics');

async function main() {
  const channelArg = process.argv.find(a => a.startsWith('--channel='))?.split('=')[1] || 'all';
  const allowLive = process.env.ALLOW_LIVE_SAP_TOOLS === '1' || process.argv.includes('--allow-live-sap');

  console.log('='.repeat(80));
  console.log('   SAP S/4HANA READ-ONLY INTEGRATION DIAGNOSTIC REPORT (MON-01)');
  console.log('='.repeat(80));
  console.log(`Timestamp:        ${new Date().toISOString()}`);
  console.log(`Channel Scope:    ${channelArg.toUpperCase()}`);
  console.log(`Live Probe Mode:  ${allowLive ? 'ACTIVE (Live SAP Probes Enabled)' : 'CONFIG / GATED (Run with ALLOW_LIVE_SAP_TOOLS=1 to probe live SAP)'}`);
  console.log(`Discipline:       CONFIRMED READ-ONLY (Zero data mutations, zero side effects)`);
  console.log('-'.repeat(80));

  if (!allowLive && process.env.NODE_ENV !== 'test') {
    console.log('NOTE: Live SAP network probes are gated to prevent unintended network egress.');
    console.log('      Executing configuration and prerequisite diagnostic inspection.');
    console.log('      To execute full live network probes against SAP, run with:');
    console.log('      ALLOW_LIVE_SAP_TOOLS=1 npm run check:sap-diagnostic -- --allow-live-sap\n');
  }

  const report = await runIntegrationDiagnostics({
    channel: channelArg,
    user: process.env.S4_USERNAME || 'technical-cli'
  });

  const printChannelStages = (channelName, channelData) => {
    if (!channelData) return;
    console.log(`\n[${channelName.toUpperCase()} CHANNEL] -> Status: ${channelData.status}`);
    channelData.stages.forEach((st, i) => {
      const idx = `${i + 1}.`.padEnd(3);
      const name = st.stage.padEnd(23);
      const statusStr = `[${st.status}]`.padEnd(10);
      const latency = `${st.latencyMs}ms`.padStart(7);
      console.log(`  ${idx} ${name} ${statusStr} ${st.details} (${latency})`);
    });
  };

  if (report.channels.odata) {
    printChannelStages('OData HTTP Gateway', report.channels.odata);
  }

  if (report.channels.rfc) {
    printChannelStages('RFC', report.channels.rfc);
  }

  console.log('\n' + '-'.repeat(80));
  console.log(`Summary: ${report.summary.totalStages} stages evaluated | ` +
              `${report.summary.passed} PASSED | ` +
              `${report.summary.failed} FAILED | ` +
              `${report.summary.skipped} SKIPPED`);
  console.log(`Target System:  ${report.systemLabel} (Client ${report.targetClient})`);
  console.log(`Overall Status: ${report.overallStatus}`);
  console.log('='.repeat(80));

  return report;
}

if (require.main === module) {
  main().then((report) => {
    process.exit(report.overallStatus === 'FAILED' ? 1 : 0);
  }).catch((err) => {
    console.error('Fatal diagnostic error:', err.message);
    process.exit(1);
  });
}

module.exports = { main };
