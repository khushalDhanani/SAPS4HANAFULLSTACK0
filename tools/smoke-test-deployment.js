#!/usr/bin/env node
'use strict';

/**
 * tools/smoke-test-deployment.js
 *
 * Post-Deployment Smoke Test Runner.
 * Executes non-destructive, read-only smoke tests against a running CAP / Fiori deployment
 * (local server, Cloud Foundry staging, or production approuter).
 *
 * Checks:
 * 1. Health & readiness probe (/health) -> 200 OK, { status: 'UP' }, Cache-Control: no-store
 * 2. Unauthenticated endpoint protection -> 401 Unauthorized (proves auth guards are active)
 * 3. Authenticated OData core metadata ($metadata for purchase-order, reservation-entry, tr-to, auth) -> 200 OK
 * 4. User info and scope resolution (/odata/v4/auth/getUserInfo()) -> 200 OK
 * 5. UI5 Layered Repository & preload endpoints (/sap/bc/lrep/flex/settings, Component-preload.js) -> 200 OK
 * 6. AI assistant streaming route presence (/ai/chat/stream) -> Not 404
 *
 * Zero data mutations. Zero credentials logged.
 */

const urlArg = process.argv.find(a => a.startsWith('--url='))?.split('=')[1]
  || process.argv.find(a => a.startsWith('--target-url='))?.split('=')[1]
  || process.env.TARGET_URL
  || process.env.APP_URL
  || 'http://localhost:4004';

const userArg = process.argv.find(a => a.startsWith('--user='))?.split('=')[1]
  || process.env.SMOKE_AUTH_USER
  || (process.env.NODE_ENV === 'production' ? '' : 'alice:');

const waitArg = process.argv.find(a => a.startsWith('--wait=') || a === '--wait');
const waitSecs = waitArg ? (waitArg.includes('=') ? parseInt(waitArg.split('=')[1], 10) : 30) : 0;

/**
 * Polls the server health endpoint with bounded backoff until ready or timeout expires.
 */
async function waitForServer(baseUrl, timeoutMs = 30000, intervalMs = 1000) {
  const target = (baseUrl || 'http://localhost:4004').replace(/\/+$/, '');
  const healthUrl = `${target}/health`;
  const startTime = Date.now();
  let lastError = null;

  console.log(`[Readiness Probe] Waiting up to ${timeoutMs / 1000}s for server at ${target} to become ready...`);

  while (Date.now() - startTime < timeoutMs) {
    try {
      const res = await fetch(healthUrl, { method: 'GET', signal: AbortSignal.timeout(3000) });
      if (res.status === 200) {
        const body = await res.text();
        let json = null;
        try { json = JSON.parse(body); } catch (_) {}
        if (json && json.status === 'UP') {
          const elapsed = Date.now() - startTime;
          console.log(`[Readiness Probe] Server is ready at ${target} (${elapsed}ms).`);
          return true;
        }
      }
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error(
    `Bounded readiness timeout exceeded: Server at ${target} failed to report status 'UP' within ${timeoutMs}ms${
      lastError ? ' (last error: ' + lastError.message + ')' : ''
    }`
  );
}

async function executeSmokeTests(options = {}) {
  const baseUrl = (options.baseUrl || urlArg).replace(/\/+$/, '');
  const authUser = options.authUser !== undefined ? options.authUser : userArg;
  const shouldWait = options.wait || options.waitTimeoutMs != null || waitSecs > 0;
  const timeoutMs = options.waitTimeoutMs || (options.wait === true ? 30000 : (typeof options.wait === 'number' ? options.wait : waitSecs * 1000));

  if (shouldWait && timeoutMs > 0) {
    await waitForServer(baseUrl, timeoutMs, options.waitIntervalMs || 1000);
  }

  console.log('='.repeat(72));
  console.log('   POST-DEPLOYMENT SMOKE TEST RUNNER');
  console.log('='.repeat(72));
  console.log(`Target URL:  ${baseUrl}`);
  console.log(`Auth Mode:   ${authUser ? 'Authenticated (' + authUser.split(':')[0] + ')' : 'Anonymous / Cookie'}`);
  console.log(`Timestamp:   ${new Date().toISOString()}`);
  console.log('-'.repeat(72));

  const authHeader = authUser ? { Authorization: 'Basic ' + Buffer.from(authUser).toString('base64') } : {};

  const tests = [
    {
      name: 'CF Readiness Health Check (/health)',
      url: `${baseUrl}/health`,
      method: 'GET',
      headers: {},
      validate: (res, body) => {
        if (res.status !== 200) return `Expected status 200, got ${res.status}`;
        let json;
        try { json = JSON.parse(body); } catch (_) { return 'Body is not valid JSON'; }
        if (json.status !== 'UP') return `Expected status 'UP', got '${json.status}'`;
        const cc = res.headers.get('cache-control') || '';
        if (!cc.includes('no-store')) return `Expected cache-control: no-store, got '${cc}'`;
        return null;
      }
    },
    {
      name: 'Unauthenticated Security Gating (/odata/v4/purchase-order/$metadata)',
      url: `${baseUrl}/odata/v4/purchase-order/$metadata`,
      method: 'GET',
      headers: {},
      validate: (res) => {
        if (res.status !== 401 && res.status !== 403) {
          return `Expected 401/403 unauthenticated rejection, got ${res.status}`;
        }
        return null;
      }
    },
    {
      name: 'OData V4 Purchase Order Metadata',
      url: `${baseUrl}/odata/v4/purchase-order/$metadata`,
      method: 'GET',
      headers: { ...authHeader },
      validate: (res, body) => {
        if (res.status !== 200) return `Expected 200 OK, got ${res.status}`;
        if (!body.includes('PurchaseOrders') && !body.includes('edmx:Edmx')) {
          return 'Response does not contain valid EDMX metadata';
        }
        return null;
      }
    },
    {
      name: 'OData V4 Reservation Entry Metadata',
      url: `${baseUrl}/odata/v4/reservation-entry/$metadata`,
      method: 'GET',
      headers: { ...authHeader },
      validate: (res, body) => {
        if (res.status !== 200) return `Expected 200 OK, got ${res.status}`;
        if (!body.includes('ReservationEntries') && !body.includes('edmx:Edmx')) {
          return 'Response does not contain valid EDMX metadata';
        }
        return null;
      }
    },
    {
      name: 'OData V4 Transfer Order Metadata',
      url: `${baseUrl}/odata/v4/tr-to/$metadata`,
      method: 'GET',
      headers: { ...authHeader },
      validate: (res, body) => {
        if (res.status !== 200) return `Expected 200 OK, got ${res.status}`;
        if (!body.includes('TransferOrders') && !body.includes('edmx:Edmx')) {
          return 'Response does not contain valid EDMX metadata';
        }
        return null;
      }
    },
    {
      name: 'OData V4 Auth Service Metadata',
      url: `${baseUrl}/odata/v4/auth/$metadata`,
      method: 'GET',
      headers: { ...authHeader },
      validate: (res, body) => {
        if (res.status !== 200) return `Expected 200 OK, got ${res.status}`;
        if (!body.includes('AuthService') && !body.includes('edmx:Edmx')) {
          return 'Response does not contain valid EDMX metadata';
        }
        return null;
      }
    },
    {
      name: 'Session & User Info Resolution (/odata/v4/auth/getUserInfo())',
      url: `${baseUrl}/odata/v4/auth/getUserInfo()`,
      method: 'GET',
      headers: { ...authHeader },
      validate: (res, body) => {
        if (res.status !== 200) return `Expected 200 OK, got ${res.status}`;
        let json;
        try { json = JSON.parse(body); } catch (_) { return 'Body is not valid JSON'; }
        if (!json || typeof json !== 'object') return 'Expected JSON object';
        if (authUser && !json.authenticated) return 'Expected authenticated=true for authenticated call';
        return null;
      }
    },
    {
      name: 'UI5 Flexibility Settings (/sap/bc/lrep/flex/settings)',
      url: `${baseUrl}/sap/bc/lrep/flex/settings`,
      method: 'GET',
      headers: {},
      validate: (res, body) => {
        if (res.status !== 200) return `Expected 200 OK, got ${res.status}`;
        let json;
        try { json = JSON.parse(body); } catch (_) { return 'Body is not valid JSON'; }
        if (json.isKeyUser === undefined && json.isProductiveSystem === undefined) {
          return 'Response missing standard LRep flexibility settings';
        }
        return null;
      }
    },
    {
      name: 'UI5 Component Preload Bundle Route (/Component-preload.js)',
      url: `${baseUrl}/Component-preload.js`,
      method: 'GET',
      headers: {},
      validate: (res) => {
        if (res.status !== 200) return `Expected 200 OK, got ${res.status}`;
        const ct = res.headers.get('content-type') || '';
        if (!ct.includes('javascript')) return `Expected javascript content-type, got '${ct}'`;
        return null;
      }
    },
    {
      name: 'AI Streaming Route Presence (/ai/chat/stream)',
      url: `${baseUrl}/ai/chat/stream`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader },
      body: JSON.stringify({}),
      validate: (res) => {
        // Must return 200 (if ready/streaming), 400 (if client sent empty body), or 401/403 (if auth guard triggered)
        // Must NEVER return 404 (route missing) or 5xx (server exception / unhandled error)
        if (res.status === 404) return 'Route /ai/chat/stream is missing (HTTP 404)';
        if (res.status >= 500) return `Expected 200/400/401/403, got server error HTTP ${res.status}`;
        if (![200, 400, 401, 403].includes(res.status)) {
          return `Unexpected status code HTTP ${res.status} on /ai/chat/stream`;
        }
        return null;
      }
    }
  ];

  let passed = 0;
  let failed = 0;
  const results = [];
  const startTime = Date.now();

  for (const t of tests) {
    const t0 = Date.now();
    try {
      const response = await fetch(t.url, {
        method: t.method,
        headers: t.headers,
        body: t.body
      });
      const body = await response.text();
      const durationMs = Date.now() - t0;
      const errorMsg = t.validate(response, body);

      if (errorMsg) {
        failed++;
        results.push({ name: t.name, status: 'FAILED', durationMs, error: errorMsg });
        console.log(`  [FAIL] ${t.name} (${durationMs}ms) -> ${errorMsg}`);
      } else {
        passed++;
        results.push({ name: t.name, status: 'PASSED', durationMs });
        console.log(`  [PASS] ${t.name} (${durationMs}ms)`);
      }
    } catch (err) {
      const durationMs = Date.now() - t0;
      failed++;
      results.push({ name: t.name, status: 'ERROR', durationMs, error: err.message });
      console.log(`  [ERR]  ${t.name} (${durationMs}ms) -> ${err.message}`);
    }
  }

  const totalDuration = Date.now() - startTime;
  console.log('-'.repeat(72));
  console.log(`Summary: ${passed} passed, ${failed} failed in ${totalDuration}ms`);
  console.log('='.repeat(72));

  return {
    passed,
    failed,
    totalDuration,
    results,
    isSuccess: failed === 0
  };
}

if (require.main === module) {
  executeSmokeTests().then(({ isSuccess }) => {
    process.exit(isSuccess ? 0 : 1);
  }).catch(err => {
    console.error('Fatal smoke test error:', err);
    process.exit(1);
  });
}

module.exports = { executeSmokeTests, waitForServer };
