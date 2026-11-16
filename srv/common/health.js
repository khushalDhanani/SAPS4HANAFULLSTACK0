'use strict';

const cds = require('@sap/cds');

/**
 * Health endpoints, registered before authentication (the platform probes them without credentials):
 *   /health/live          the process answers; never depends on anything else
 *   /health/ready         the app can serve requests: its own database answers (503 otherwise)
 *   /health/dependencies  the state of each dependency; informational, always 200
 * SAP being down must not fail liveness or readiness: the app still serves its UI and reports the SAP error.
 * Responses carry status words only, never hosts, users or error text.
 */

// Unauthenticated endpoints: a burst of calls must not become a burst of dependency checks.
const CACHE_MS = 15 * 1000;

async function checkDatabase() {
  try {
    await cds.db.run(cds.ql.SELECT.one.from('saps4hana.admin.UserLockMonitor').columns('id'));
    return 'UP';
  } catch {
    return 'DOWN';
  }
}

/** Whether a destination resolves (Destination service in BTP, env locally). It does not call SAP. */
async function checkS4Destination() {
  try {
    const { S4HttpClient } = require('../integration/s4hana/S4HttpClient');
    return (await new S4HttpClient().resolveDestination()) ? 'CONFIGURED' : 'NOT_CONFIGURED';
  } catch {
    return 'DOWN';
  }
}

function checkRfcSdk() {
  try {
    return require('../integration/s4hana/RfcClient').RfcClient.isAvailable() ? 'UP' : 'DOWN';
  } catch {
    return 'DOWN';
  }
}

const defaultChecks = { database: checkDatabase, s4Destination: checkS4Destination, rfcSdk: checkRfcSdk };

function registerHealth(app, { checks = defaultChecks, cacheMs = CACHE_MS, now = Date.now } = {}) {
  let cached = null;

  async function dependencies() {
    if (cached && now() - cached.at < cacheMs) return cached.value;
    const names = Object.keys(checks);
    const results = await Promise.all(names.map((name) => checks[name]()));
    const value = Object.fromEntries(names.map((name, i) => [name, results[i]]));
    // shortcut: SAP OData reachability is not probed, because an unauthenticated probe would log on to SAP
    // with the service user (failed-logon lock risk); upgrade when a safe probe is decided.
    value.sapOData = 'NOT_CHECKED';
    cached = { at: now(), value };
    return value;
  }

  const send = (res, code, body) => res.set('Cache-Control', 'no-store').status(code).json(body);

  app.get('/health/live', (_req, res) => send(res, 200, { status: 'UP' }));

  app.get('/health/ready', async (_req, res) => {
    const up = (await dependencies()).database === 'UP';
    send(res, up ? 200 : 503, { status: up ? 'UP' : 'DOWN' });
  });

  app.get('/health/dependencies', async (_req, res) => {
    const deps = await dependencies();
    const degraded = deps.database !== 'UP' || deps.s4Destination !== 'CONFIGURED' || deps.rfcSdk !== 'UP';
    send(res, 200, { status: degraded ? 'DEGRADED' : 'UP', dependencies: deps, checkedAt: new Date(cached.at).toISOString() });
  });
}

module.exports = { registerHealth };
