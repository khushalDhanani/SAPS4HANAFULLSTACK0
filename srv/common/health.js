'use strict';

const cds = require('@sap/cds');
const LOG = require('./logger')('health');

/**
 * Health endpoints, registered before authentication (the platform probes them without credentials):
 *   /health/live          the process answers; never depends on anything else
 *   /health/ready         the app can serve requests: its own database answers (503 otherwise)
 *   /health/dependencies  the state of each dependency; informational, always 200
 *
 * Safety & Architecture Principle (Finding MON-01):
 * - Platform health probes execute without credentials at high frequency (e.g. every 10–30s).
 * - Unauthenticated probes must NEVER repeatedly log on to SAP with service account credentials:
 *   doing so risks technical user account lockouts, connection pool exhaustion, and denial of service.
 * - Therefore, /health/dependencies reports local configuration and SDK readiness only:
 *   - s4Destination: CONFIGURED (destination parameters resolve locally or via BTP)
 *   - rfcSdk:        UP (native NW RFC SDK dynamic libraries can be loaded)
 *   - sapOData:      NOT_CHECKED (intentionally unprobed on unauthenticated requests)
 * - Full end-to-end SAP reachability and persistence verification is provided via the separately
 *   controlled, authenticated diagnostic endpoint: /admin/diagnostics/sap (requires Admin role).
 *
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

function extractUser(req) {
  if (req.user && !req.user._is_anonymous) return req.user;
  const authHeader = req.headers && req.headers.authorization;
  if (authHeader) {
    const [, token] = /^bearer\s+(.+)$/i.exec(authHeader) || [];
    if (token) {
      try {
        const { verifyToken } = require('../auth/localTokenUtil');
        const u = verifyToken(token);
        if (u) return u;
      } catch (_) {}
    }
  }
  if (cds.context && cds.context.user && !cds.context.user._is_anonymous) {
    return cds.context.user;
  }
  return null;
}

function hasAdminRole(user) {
  if (!user) return false;
  if (typeof user.is === 'function') {
    return user.is('Admin') || user.is('TechnicalUser');
  }
  if (Array.isArray(user.roles)) {
    return user.roles.includes('Admin') || user.roles.includes('TechnicalUser');
  }
  return false;
}

const defaultChecks = { database: checkDatabase, s4Destination: checkS4Destination, rfcSdk: checkRfcSdk };

function registerHealth(app, {
  checks = defaultChecks,
  cacheMs = CACHE_MS,
  now = Date.now,
  diagnosticsRunner = null,
  startupLog = process.env.NODE_ENV === 'test' ? null : LOG
} = {}) {
  let cached = null;

  // Say it once at startup instead of on the first RFC call: mta.yaml alone does not install the SAP NW RFC SDK.
  if (startupLog && typeof checks.rfcSdk === 'function' && checks.rfcSdk() !== 'UP') {
    startupLog.warn('SAP NW RFC SDK / node-rfc is not loadable in this runtime: every RFC-based function will answer 503. '
      + 'See docs/deployment/rfc-production-readiness.md and run `npm run check:rfc-runtime`.');
  }

  async function dependencies() {
    if (cached && now() - cached.at < cacheMs) return cached.value;
    const names = Object.keys(checks);
    const results = await Promise.all(names.map((name) => checks[name]()));
    const value = Object.fromEntries(names.map((name, i) => [name, results[i]]));
    // Finding MON-01: SAP OData reachability is NOT probed in unauthenticated health probes
    // to protect technical service accounts from repeated logons and lockouts.
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
    send(res, 200, {
      status: degraded ? 'DEGRADED' : 'UP',
      dependencies: deps,
      checkedAt: new Date(cached.at).toISOString(),
      diagnosticsEndpoint: '/admin/diagnostics/sap',
      note: 'Unauthenticated dependency health reports local configuration and SDK state only (sapOData is NOT_CHECKED to prevent service account lockouts). For full 6-stage live SAP connectivity and persistence verification, use the authenticated integration diagnostic endpoint with an approved technical identity.'
    });
  });

  // Separately controlled, authenticated integration diagnostic endpoint (Finding MON-01)
  const handleDiagnostics = async (req, res) => {
    const user = extractUser(req);
    if (!user) {
      return send(res, 401, {
        error: 'AUTHENTICATION_REQUIRED',
        message: 'SAP integration diagnostics require authentication with an approved technical identity (Admin role). Unauthenticated health probes are prohibited from repeatedly logging on to SAP to prevent service account lockouts and repeated load.',
        requiredRole: 'Admin'
      });
    }

    if (!hasAdminRole(user)) {
      return send(res, 403, {
        error: 'FORBIDDEN',
        message: 'SAP integration diagnostics require an approved technical identity with the Admin role.',
        requiredRole: 'Admin'
      });
    }

    const runner = diagnosticsRunner || require('./integrationDiagnostics').runIntegrationDiagnostics;
    try {
      const channel = req.query.channel || 'all';
      const report = await runner({ channel, user: user.id || 'admin' });
      const statusCode = report.overallStatus === 'FAILED' ? 502 : 200;
      return send(res, statusCode, report);
    } catch (err) {
      return send(res, 500, {
        error: 'DIAGNOSTIC_EXECUTION_ERROR',
        message: String(err && err.message ? err.message : err).split('\n')[0]
      });
    }
  };

  app.get('/admin/diagnostics/sap', handleDiagnostics);
  app.get('/health/diagnostic', handleDiagnostics);
}

module.exports = {
  registerHealth,
  extractUser,
  hasAdminRole
};
