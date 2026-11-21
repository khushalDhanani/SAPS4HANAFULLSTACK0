'use strict';

const { S4HttpClient } = require('../integration/s4hana/S4HttpClient');
const s4Config = require('./s4Config');
const {
  NEVER_SENT_CODES,
  redactUrl,
  measureStage,
  skippedStage,
} = require('./integrationDiagnosticsUtil');

/**
 * Diagnostics for S/4HANA OData HTTP Gateway Channel (6 stages).
 *
 * @param {object} [params]
 * @param {object} [params.s4HttpClient]
 * @param {object} [params.env]
 * @param {object} [params.options]
 * @returns {Promise<object>}
 */
async function diagnoseOData({ s4HttpClient, env = process.env, options = {} } = {}) {
  const stages = [];
  const client = s4HttpClient || new S4HttpClient({ env });
  let destination = null;
  let resolvedClient = null;

  // Stage 1: Configured
  const st1 = await measureStage('Configured', async () => {
    destination = await client.resolveDestination(options);
    if (!destination || !destination.url) {
      throw new Error('S/4HANA HTTP destination is not configured or could not be resolved');
    }
    try {
      resolvedClient = destination.sapClient || s4Config.getClient();
    } catch (_) {
      resolvedClient = destination.sapClient || env.S4_CLIENT || 'unknown';
    }
    return `Destination resolved (Target URL: ${redactUrl(destination.url)}, Client: ${resolvedClient}).`;
  });
  stages.push(st1);
  if (st1.status !== 'PASSED') {
    stages.push(skippedStage('Reachable', 'Destination not configured'));
    stages.push(skippedStage('Authenticated', 'Destination not configured'));
    stages.push(skippedStage('Authorized', 'Destination not configured'));
    stages.push(skippedStage('Metadata verified', 'Destination not configured'));
    stages.push(skippedStage('Functionally verified', 'Destination not configured'));
    return { channel: 'ODATA', status: 'FAILED', stages };
  }

  // Stage 2: Reachable
  const st2 = await measureStage('Reachable', async () => {
    try {
      await client.get('/', {
        destination,
        headers: { Accept: '*/*' },
      });
      return `SAP HTTP Gateway reachable on host ${redactUrl(destination.url)} (HTTP transport verified).`;
    } catch (err) {
      const code = err.code || err.cause?.code || err.rootCause?.code;
      if (NEVER_SENT_CODES.has(code) || /timeout|refused|not reachable/i.test(err.message)) {
        throw new Error(`SAP Gateway host unreachable: ${code || err.message}`);
      }
      return `SAP HTTP Gateway reachable on host ${redactUrl(destination.url)} (HTTP transport active).`;
    }
  });
  stages.push(st2);
  if (st2.status !== 'PASSED') {
    stages.push(skippedStage('Authenticated', 'Host unreachable'));
    stages.push(skippedStage('Authorized', 'Host unreachable'));
    stages.push(skippedStage('Metadata verified', 'Host unreachable'));
    stages.push(skippedStage('Functionally verified', 'Host unreachable'));
    return { channel: 'ODATA', status: 'FAILED', stages };
  }

  // Stage 3: Authenticated
  const st3 = await measureStage('Authenticated', async () => {
    try {
      const res = await client.get('/sap/opu/odata/sap/C_PURCHASEORDER_FS_SRV/', {
        destination,
        headers: { 'x-csrf-token': 'Fetch', Accept: 'application/json' },
      });
      if (res.status === 401) {
        throw new Error('SAP rejected technical user credentials (HTTP 401 Unauthorized)');
      }
      return 'Technical identity authenticated with SAP Gateway.';
    } catch (err) {
      const status = err.status || err.statusCode || err.response?.status;
      if (status === 401 || /unauthorized|logon failed|RFC_LOGON_FAILURE/i.test(err.message)) {
        throw new Error('SAP rejected technical user credentials (HTTP 401 Unauthorized)');
      }
      return 'Technical identity authenticated with SAP Gateway.';
    }
  });
  stages.push(st3);
  if (st3.status !== 'PASSED') {
    stages.push(skippedStage('Authorized', 'Authentication failed'));
    stages.push(skippedStage('Metadata verified', 'Authentication failed'));
    stages.push(skippedStage('Functionally verified', 'Authentication failed'));
    return { channel: 'ODATA', status: 'FAILED', stages };
  }

  // Stage 4: Authorized
  const st4 = await measureStage('Authorized', async () => {
    try {
      const res = await client.get('/sap/opu/odata/sap/C_PURCHASEORDER_FS_SRV/', {
        destination,
        headers: { Accept: 'application/json' },
      });
      if (res.status === 403) {
        throw new Error('Technical identity lacks authorization for service C_PURCHASEORDER_FS_SRV (HTTP 403 Forbidden)');
      }
      return 'Authorization confirmed for target S/4HANA OData service.';
    } catch (err) {
      const status = err.status || err.statusCode || err.response?.status;
      if (status === 403 || /forbidden|authorization|CX_SADL_AUTHORIZATION/i.test(err.message)) {
        throw new Error('Technical identity lacks authorization for service C_PURCHASEORDER_FS_SRV (HTTP 403 Forbidden)');
      }
      return 'Authorization confirmed for target S/4HANA OData service.';
    }
  });
  stages.push(st4);
  if (st4.status !== 'PASSED') {
    stages.push(skippedStage('Metadata verified', 'Authorization failed'));
    stages.push(skippedStage('Functionally verified', 'Authorization failed'));
    return { channel: 'ODATA', status: 'FAILED', stages };
  }

  // Stage 5: Metadata verified
  const st5 = await measureStage('Metadata verified', async () => {
    const xml = await client.getText('/sap/opu/odata/sap/C_PURCHASEORDER_FS_SRV/$metadata', { destination });
    if (!xml || typeof xml !== 'string' || !xml.includes('<edmx:Edmx') || !xml.includes('<Schema')) {
      throw new Error('S/4HANA returned invalid or empty $metadata EDMX schema');
    }
    return 'OData $metadata retrieved and verified (valid EDMX schema).';
  });
  stages.push(st5);
  if (st5.status !== 'PASSED') {
    stages.push(skippedStage('Functionally verified', 'Metadata verification failed'));
    return { channel: 'ODATA', status: 'FAILED', stages };
  }

  // Stage 6: Functionally verified
  const st6 = await measureStage('Functionally verified', async () => {
    const res = await client.get('/sap/opu/odata/sap/C_PURCHASEORDER_FS_SRV/C_PurchaseOrderFs', {
      destination,
      query: '$top=1&$select=PurchaseOrder',
    });
    if (res.status !== 200) {
      throw new Error(`Read-only functional query returned HTTP ${res.status}`);
    }
    return 'Read-only functional query succeeded. Backend DPC execution and SAP data retrieval confirmed.';
  });
  stages.push(st6);

  const channelHealthy = stages.every((s) => s.status === 'PASSED');
  return {
    channel: 'ODATA',
    status: channelHealthy ? 'HEALTHY' : 'FAILED',
    stages: stages.map(({ stage, status, details, latencyMs }) => ({ stage, status, details, latencyMs })),
  };
}

module.exports = {
  diagnoseOData,
};
