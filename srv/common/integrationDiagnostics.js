'use strict';

/**
 * srv/common/integrationDiagnostics.js
 *
 * Separately controlled, read-only integration diagnostic module for SAP S/4HANA.
 * Resolves Finding MON-01 (P1): Dependency health is not the same as live SAP connectivity.
 *
 * Architecture & Safety Discipline:
 * - Strictly READ-ONLY. Zero data mutations, zero writes, zero side effects.
 * - Requires authentication with an approved technical identity (Admin role).
 * - Reports 6 distinct lifecycle states per integration channel (OData and RFC):
 *   1. Configured             — Destination, configuration, and libraries present
 *   2. Reachable              — Low-level network transport / Gateway port reachable
 *   3. Authenticated          — SAP accepted technical credentials
 *   4. Authorized             — User has authorizations for the service/catalogs
 *   5. Metadata verified      — OData $metadata or RFC interface definition retrieved & valid
 *   6. Functionally verified  — Safe, strictly READ-ONLY business/customizing query succeeded
 * - Redacts all secrets, passwords, and private tokens in logs and responses.
 */

const s4Config = require('./s4Config');
const LOG = require('./logger')('integration-diagnostics');
const {
  NEVER_SENT_CODES,
  redactUrl,
  measureStage,
  skippedStage,
} = require('./integrationDiagnosticsUtil');
const { diagnoseOData } = require('./ODataDiagnostics');
const { diagnoseRfc } = require('./RfcDiagnostics');

/**
 * Execute integration diagnostics across requested channels.
 *
 * @param {Object} [options]
 * @param {string} [options.channel='all'] - 'all' | 'odata' | 'rfc'
 * @param {Object} [options.s4HttpClient]  - injected S4HttpClient (for tests)
 * @param {Object} [options.rfcClient]     - injected RfcClient (for tests)
 * @param {Object} [options.env]           - environment override
 * @param {string} [options.user]          - technical user identity hint
 * @returns {Promise<IntegrationDiagnosticReport>}
 */
async function runIntegrationDiagnostics({
  channel = 'all',
  s4HttpClient,
  rfcClient,
  env = process.env,
  user = 'technical-operator',
} = {}) {
  const normChannel = String(channel || 'all').trim().toLowerCase();
  const runOData = normChannel === 'all' || normChannel === 'odata';
  const runRfc = normChannel === 'all' || normChannel === 'rfc';

  LOG.info(`Running read-only SAP integration diagnostics for channel: ${normChannel} (operator: ${user})`);

  let targetClient = 'unknown';
  let systemLabel = 'unknown';
  try {
    targetClient = s4Config.getClient();
    systemLabel = s4Config.getSystemLabel();
  } catch (_) {
    targetClient = env.S4_CLIENT || 'unknown';
    systemLabel = env.S4_SYSTEM_LABEL || 'S/4HANA';
  }

  const results = {};
  if (runOData) {
    results.odata = await diagnoseOData({ s4HttpClient, env });
  }
  if (runRfc) {
    results.rfc = await diagnoseRfc({ rfcClient, env });
  }

  const allStages = [
    ...(results.odata?.stages || []),
    ...(results.rfc?.stages || []),
  ];

  const totalStages = allStages.length;
  const passed = allStages.filter((s) => s.status === 'PASSED').length;
  const failed = allStages.filter((s) => s.status === 'FAILED').length;
  const skipped = allStages.filter((s) => s.status === 'SKIPPED').length;

  let overallStatus = 'HEALTHY';
  if (failed > 0) {
    overallStatus = passed > 0 ? 'DEGRADED' : 'FAILED';
  }

  return {
    timestamp: new Date().toISOString(),
    channel: normChannel.toUpperCase(),
    overallStatus,
    targetClient,
    systemLabel,
    operator: user,
    readOnlyNotice: 'CONFIRMED READ-ONLY: Zero data mutations executed.',
    summary: {
      totalStages,
      passed,
      failed,
      skipped,
    },
    channels: results,
  };
}

module.exports = {
  runIntegrationDiagnostics,
  diagnoseOData,
  diagnoseRfc,
  measureStage,
  skippedStage,
  redactUrl,
  NEVER_SENT_CODES,
};
