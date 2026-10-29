'use strict';

/**
 * SAP-dependent test classification (docs/sap-test-classification.md):
 *   Jest (test/unit, test/integration, ...)  never reaches SAP: setupEnv.js scrubs S4_/SAP_/RFC_ keys, node-rfc is
 *                                            mocked, outbound network is blocked. This gate therefore returns false
 *                                            under Jest whatever RUN_LIVE_SAP says, so "live" describe blocks skip
 *                                            instead of failing on the mock.
 *   Browser E2E (npm run test:e2e)           CAP server reads, write guard on, writes mocked.
 *   Tier C (npm run test:e2e:sap)            dry-run by default; live needs liveWriteGate + RFC preflight + written go.
 *   Tools (tools/*.js)                       ALLOW_LIVE_SAP_TOOLS=1 --allow-live-sap; RUN_LIVE_SAP=1 + non-prod
 *                                            SAP_SYSTEM_TYPE for the sandbox validation stage.
 */
function shouldRunLiveSapTests(env = process.env) {
  if (env.JEST_WORKER_ID) return false;
  const systemType = String(env.SAP_SYSTEM_TYPE || '').trim().toLowerCase();
  return env.RUN_LIVE_SAP === '1' && Boolean(systemType) && systemType !== 'prod';
}

module.exports = { shouldRunLiveSapTests };
