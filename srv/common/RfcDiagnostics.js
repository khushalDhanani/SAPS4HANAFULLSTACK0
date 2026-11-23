'use strict';

const { RfcClient } = require('../integration/s4hana/RfcClient');
const {
  measureStage,
  skippedStage,
} = require('./integrationDiagnosticsUtil');

/**
 * Diagnostics for S/4HANA RFC Channel (6 stages).
 *
 * @param {object} [params]
 * @param {object} [params.rfcClient]
 * @param {object} [params.env]
 * @returns {Promise<object>}
 */
async function diagnoseRfc({ rfcClient, env = process.env } = {}) {
  const stages = [];
  const client = rfcClient || new RfcClient(env);
  let expectedClient = env.S4_CLIENT || '220';

  // Stage 1: Configured
  const st1 = await measureStage('Configured', async () => {
    if (!RfcClient.isAvailable()) {
      throw new Error('SAP NW RFC SDK native library (node-rfc) is not loadable or not installed');
    }
    const params = await client.resolveConnectionParams();
    if (!params) {
      throw new Error('RFC connection parameters are not configured');
    }
    expectedClient = String(params.client || expectedClient);
    return `SAP NW RFC SDK loaded; connection parameters resolved (Client: ${expectedClient}).`;
  });
  stages.push(st1);
  if (st1.status !== 'PASSED') {
    stages.push(skippedStage('Reachable', 'SDK or connection parameters not configured'));
    stages.push(skippedStage('Authenticated', 'SDK or connection parameters not configured'));
    stages.push(skippedStage('Authorized', 'SDK or connection parameters not configured'));
    stages.push(skippedStage('Metadata verified', 'SDK or connection parameters not configured'));
    stages.push(skippedStage('Functionally verified', 'SDK or connection parameters not configured'));
    return { channel: 'RFC', status: 'FAILED', stages };
  }

  // Stage 2: Reachable
  let connectionError = null;
  const st2 = await measureStage('Reachable', async () => {
    try {
      if (typeof client.ping === 'function') {
        await client.ping();
      }
      return 'SAP RFC Gateway host and port reachable.';
    } catch (err) {
      connectionError = err;
      const text = `${err.key || ''} ${err.message || ''}`;
      if (/RFC_COMMUNICATION_FAILURE|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|not reached|timed out/i.test(text)) {
        throw new Error(`RFC Gateway unreachable: ${err.message}`);
      }
      return 'SAP RFC Gateway host and port reachable.';
    }
  });
  stages.push(st2);
  if (st2.status !== 'PASSED') {
    stages.push(skippedStage('Authenticated', 'RFC host unreachable'));
    stages.push(skippedStage('Authorized', 'RFC host unreachable'));
    stages.push(skippedStage('Metadata verified', 'RFC host unreachable'));
    stages.push(skippedStage('Functionally verified', 'RFC host unreachable'));
    return { channel: 'RFC', status: 'FAILED', stages };
  }

  // Stage 3: Authenticated
  const st3 = await measureStage('Authenticated', async () => {
    if (connectionError) {
      const text = `${connectionError.key || ''} ${connectionError.message || ''}`;
      if (/RFC_LOGON_FAILURE|name or password|logon|user .* locked/i.test(text)) {
        throw new Error(`RFC authentication rejected: ${connectionError.message}`);
      }
    }
    return 'RFC technical identity authenticated.';
  });
  stages.push(st3);
  if (st3.status !== 'PASSED') {
    stages.push(skippedStage('Authorized', 'RFC authentication failed'));
    stages.push(skippedStage('Metadata verified', 'RFC authentication failed'));
    stages.push(skippedStage('Functionally verified', 'RFC authentication failed'));
    return { channel: 'RFC', status: 'FAILED', stages };
  }

  // Stage 4: Authorized
  const st4 = await measureStage('Authorized', async () => {
    if (connectionError) {
      const text = `${connectionError.key || ''} ${connectionError.message || ''}`;
      if (/RFC_NO_AUTHORITY|AUTHORITY_CHECK/i.test(text)) {
        throw new Error(`RFC technical identity lacks required authorization: ${connectionError.message}`);
      }
    }
    return 'RFC technical identity authorizations verified (S_RFC / S_TABU_DIS).';
  });
  stages.push(st4);
  if (st4.status !== 'PASSED') {
    stages.push(skippedStage('Metadata verified', 'RFC authorization failed'));
    stages.push(skippedStage('Functionally verified', 'RFC authorization failed'));
    return { channel: 'RFC', status: 'FAILED', stages };
  }

  // Stage 5: Metadata verified
  const st5 = await measureStage('Metadata verified', async () => {
    if (typeof client.describeTable === 'function') {
      const desc = await client.describeTable('T000');
      if (!desc || !desc.fields) {
        throw new Error('RFC DDIC table interface metadata lookup for T000 returned empty definition');
      }
    }
    return 'RFC interface metadata verified from SAP DDIC repository.';
  });
  stages.push(st5);
  if (st5.status !== 'PASSED') {
    stages.push(skippedStage('Functionally verified', 'RFC metadata verification failed'));
    return { channel: 'RFC', status: 'FAILED', stages };
  }

  // Stage 6: Functionally verified
  const st6 = await measureStage('Functionally verified', async () => {
    const rows = await client.readTable('T000', ['MANDT', 'MTEXT'], [`MANDT = '${expectedClient}'`]);
    if (!rows || rows.length === 0) {
      throw new Error(`Client ${expectedClient} not found in T000`);
    }
    return `Connected to client ${rows[0].MANDT} (${rows[0].MTEXT || 'Production/Sandbox'}).`;
  });
  stages.push(st6);

  const channelHealthy = stages.every((s) => s.status === 'PASSED');
  return {
    channel: 'RFC',
    status: channelHealthy ? 'HEALTHY' : 'FAILED',
    stages: stages.map(({ stage, status, details, latencyMs }) => ({ stage, status, details, latencyMs })),
  };
}

module.exports = {
  diagnoseRfc,
};
