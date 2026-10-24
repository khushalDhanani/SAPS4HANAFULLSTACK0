'use strict';

/**
 * test/smoke/postDeploymentSmoke.test.js
 *
 * Automated Post-Deployment Smoke Test Suite.
 * Validates endpoint readiness, security gating, metadata availability, and error diagnostics.
 */

const { executeSmokeTests } = require('../../tools/smoke-test-deployment');

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
});
