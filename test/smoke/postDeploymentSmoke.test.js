'use strict';

/**
 * test/smoke/postDeploymentSmoke.test.js
 *
 * Automated Post-Deployment Smoke Test Suite.
 * Validates endpoint readiness, security gating, metadata availability, and error diagnostics.
 */

const { executeSmokeTests, waitForServer } = require('../../tools/smoke-test-deployment');

describe('Post-Deployment Smoke Test Suite', () => {
  it('executes smoke tests against the running server and validates all 10 endpoints pass', async () => {
    const summary = await executeSmokeTests({
      baseUrl: 'http://localhost:4004',
      authUser: 'alice:'
    });

    expect(summary.isSuccess).toBe(true);
    expect(summary.failed).toBe(0);
    expect(summary.passed).toBe(10);
    expect(summary.results.length).toBe(10);

    const healthResult = summary.results.find(r => r.name.includes('/health'));
    expect(healthResult).toBeDefined();
    expect(healthResult.status).toBe('PASSED');

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
      authUser: 'alice:'
    });

    expect(summary.isSuccess).toBe(false);
    expect(summary.failed).toBe(10);
    expect(summary.passed).toBe(0);
    expect(summary.results[0].status).toBe('ERROR');
  });

  it('validates bounded readiness wait against a healthy server', async () => {
    const isReady = await waitForServer('http://localhost:4004', 5000, 200);
    expect(isReady).toBe(true);
  });

  it('enforces bounded timeout when waiting for an unreachable host', async () => {
    await expect(waitForServer('http://127.0.0.1:59999', 500, 100))
      .rejects.toThrow(/Bounded readiness timeout exceeded/);
  });
});
