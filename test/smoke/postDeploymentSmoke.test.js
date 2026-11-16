'use strict';

/**
 * test/smoke/postDeploymentSmoke.test.js
 *
 * Automated Post-Deployment Smoke Test Suite.
 * Validates endpoint readiness, security gating, metadata availability, and error diagnostics.
 */

const { executeSmokeTests, waitForServer } = require('../../tools/smoke-test-deployment');
const { startIsolatedServer } = require('../e2e/support/isolatedServer');
const http = require('http');

describe('Post-Deployment Smoke Test Suite', () => {
  // Own test-profile server (no SAP) on a free port: the suite must not depend on a server someone left on :4004.
  let server;
  beforeAll(async () => { server = await startIsolatedServer(); }, 90000);
  afterAll(() => server && server.stop());

  it('executes smoke tests against the running server and validates all 9 endpoints pass', async () => {
    const summary = await executeSmokeTests({
      baseUrl: server.baseUrl,
      authUser: 'khushal:'
    });

    expect(summary.isSuccess).toBe(true);
    expect(summary.failed).toBe(0);
    expect(summary.passed).toBe(9);
    expect(summary.results.length).toBe(9);

    for (const endpoint of ['/health)', '/health/ready)']) {
      const healthResult = summary.results.find(r => r.name.includes(endpoint));
      expect(healthResult).toBeDefined();
      expect(healthResult.status).toBe('PASSED');
    }

    const authResult = summary.results.find(r => r.name.includes('Auth Service Metadata'));
    expect(authResult).toBeDefined();
    expect(authResult.status).toBe('PASSED');

    const aiResult = summary.results.find(r => r.name.includes('/ai/chat/stream'));
    expect(aiResult).toBeDefined();
    expect(aiResult.status).toBe('PASSED');
  });

  it('fails gracefully when targeting an unreachable port or invalid host', async () => {
    const summary = await executeSmokeTests({
      baseUrl: 'http://127.0.0.1:59999',
      authUser: 'khushal:'
    });

    expect(summary.isSuccess).toBe(false);
    expect(summary.failed).toBe(9);
    expect(summary.passed).toBe(0);
    expect(summary.results[0].status).toBe('ERROR');
  });

  it('validates bounded readiness wait against a healthy server', async () => {
    const isReady = await waitForServer(server.baseUrl, 5000, 200);
    expect(isReady).toBe(true);
  });

  it('waits for database readiness even while process liveness is UP', async () => {
    let ready = false;
    let readinessRequests = 0;
    const probe = http.createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/health') {
        res.writeHead(200).end(JSON.stringify({ status: 'UP' }));
      } else if (req.url === '/health/ready') {
        readinessRequests++;
        res.writeHead(ready ? 200 : 503).end(JSON.stringify({ status: ready ? 'UP' : 'DOWN' }));
      } else {
        res.writeHead(404).end();
      }
    });
    await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${probe.address().port}`;
    const readyTimer = setTimeout(() => { ready = true; }, 100);
    try {
      expect(await waitForServer(baseUrl, 2000, 20)).toBe(true);
      expect(readinessRequests).toBeGreaterThan(1);
    } finally {
      clearTimeout(readyTimer);
      await new Promise((resolve) => probe.close(resolve));
    }
  });

  it('enforces bounded timeout when waiting for an unreachable host', async () => {
    await expect(waitForServer('http://127.0.0.1:59999', 500, 100))
      .rejects.toThrow(/Bounded readiness timeout exceeded/);
  });
});
