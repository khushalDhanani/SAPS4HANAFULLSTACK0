#!/usr/bin/env node
'use strict';

/**
 * RFC preflight: one READ-ONLY T000 read that says, before any live SAP test or tool runs, which layer of the RFC
 * environment is broken. Stages, in check order:
 *   sdk      node-rfc / SAP NW RFC SDK not loadable
 *   config   connection parameters missing (.env.local keys or the BTP RFC destination)
 *   auth     SAP rejected the logon (RFC_LOGON_FAILURE, "Name or password is incorrect")
 *   network  host not reachable (RFC_COMMUNICATION_FAILURE, ECONNREFUSED, timeout)
 *   client   connected, but S4_CLIENT is not in T000
 *   unknown  anything else (message kept)
 *   ok       connected to the expected client
 * CLI (gated like every live tool): ALLOW_LIVE_SAP_TOOLS=1 node tools/rfc-preflight.js --allow-live-sap
 */

const { RfcClient } = require('../srv/integration/s4hana/RfcClient');

const STAGE_PATTERNS = [
  ['sdk', /node-rfc is not available/i],
  ['config', /RFC connection not configured|RFC destination|S4_RFC_DESTINATION_NAME/i],
  ['auth', /RFC_LOGON_FAILURE|name or password|logon|password logon no longer possible|user .* locked/i],
  ['network', /RFC_COMMUNICATION_FAILURE|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|not reached|connection refused|timed out/i]
];

function classify(err) {
  const text = `${err && err.key ? err.key + ' ' : ''}${(err && err.message) || ''}`;
  const hit = STAGE_PATTERNS.find(([, re]) => re.test(text));
  return hit ? hit[0] : 'unknown';
}

/**
 * @param {object} [opts]
 * @param {object} [opts.env=process.env]
 * @param {object} [opts.rfcClient]  injected client (tests); default `new RfcClient(env)`
 * @param {string} [opts.client]     expected SAP client; default env.S4_CLIENT
 * @returns {Promise<{ok: boolean, stage: string, message: string, client?: string}>}
 */
async function rfcPreflight({ env = process.env, rfcClient, client } = {}) {
  const expected = String(client || env.S4_CLIENT || '').trim();
  if (!expected) return { ok: false, stage: 'config', message: 'S4_CLIENT is not set' };
  const rfc = rfcClient || new RfcClient(env);
  let rows;
  try {
    rows = await rfc.readTable('T000', ['MANDT', 'MTEXT'], [`MANDT = '${expected}'`]);
  } catch (err) {
    return { ok: false, stage: classify(err), message: String(err.message || err).split('\n')[0] };
  }
  if (!rows || rows.length === 0) return { ok: false, stage: 'client', message: `Client ${expected} not found in T000` };
  return { ok: true, stage: 'ok', message: `Connected to client ${rows[0].MANDT} (${rows[0].MTEXT})`, client: rows[0].MANDT };
}

if (require.main === module) {
  require('./live-sap-gate')();
  require('dotenv').config({ path: '.env.local' });
  console.log('READ-ONLY: RFC preflight (RFC_READ_TABLE T000)');
  rfcPreflight().then((r) => {
    console.log(`RFC PREFLIGHT ${r.ok ? 'PASS' : 'FAIL'} [${r.stage}]: ${r.message}`);
    process.exit(r.ok ? 0 : 1);
  });
}

module.exports = { rfcPreflight, classify };
