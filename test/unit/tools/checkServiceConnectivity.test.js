'use strict';

/**
 * test/unit/tools/checkServiceConnectivity.test.js
 *
 * Unit tests for tools/check-service-connectivity.js.
 */

const { checkServiceConnectivity } = require('../../../tools/check-service-connectivity');

describe('Release Automation: Service Connectivity Checker Unit Tests', () => {
  it('passes cleanly in default config mode without live SAP flag', async () => {
    const summary = await checkServiceConnectivity({ allowLiveSap: false });
    expect(summary.allHealthy).toBe(true);
    expect(summary.results.length).toBeGreaterThanOrEqual(3);

    const guardCheck = summary.results.find(r => r.check === 'Production Guardrails');
    expect(guardCheck).toBeDefined();
    expect(guardCheck.status).toBe('PASSED');

    const configCheck = summary.results.find(r => r.check === 'S/4HANA Config Resolution');
    expect(configCheck).toBeDefined();
    expect(configCheck.status).toBe('PASSED');

    const rfcCheck = summary.results.find(r => r.check === 'Live SAP RFC');
    expect(rfcCheck).toBeDefined();
    expect(rfcCheck.status).toBe('SKIPPED');
  });

  it('probes live RFC connection when allowLiveSap is true', async () => {
    const mockRfc = {
      readTable: jest.fn().mockResolvedValue([{ MANDT: '220', MTEXT: 'Test Client 220' }])
    };
    const summary = await checkServiceConnectivity({ allowLiveSap: true, rfcClient: mockRfc });
    expect(summary.allHealthy).toBe(true);

    const rfcCheck = summary.results.find(r => r.check === 'Live SAP RFC');
    expect(rfcCheck).toBeDefined();
    expect(rfcCheck.status).toBe('PASSED');
    expect(rfcCheck.client).toBe('220');
    expect(mockRfc.readTable).toHaveBeenCalledWith('T000', ['MANDT', 'MTEXT'], ["MANDT = '220'"]);
  });
});
