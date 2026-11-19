'use strict';

/**
 * test/unit/monitoring/integrationDiagnostics.test.js
 *
 * Unit tests for srv/common/integrationDiagnostics.js.
 * Resolves Finding MON-01 (P1): Dependency health is not the same as live SAP connectivity.
 */

const {
  runIntegrationDiagnostics,
  diagnoseOData,
  diagnoseRfc,
  redactUrl
} = require('../../../srv/common/integrationDiagnostics');

describe('Monitoring Finding MON-01: SAP Integration Diagnostics Engine', () => {

  describe('Utility & Redaction', () => {
    it('redacts URL to origin only and strips credentials/query params', () => {
      expect(redactUrl('https://user:pass@saps4.example.corp:8443/sap/opu/odata?client=220'))
        .toBe('https://saps4.example.corp:8443');
      expect(redactUrl('http://localhost:4004')).toBe('http://localhost:4004');
      expect(redactUrl('')).toBe('');
    });
  });

  describe('OData Gateway Channel 6-Stage Diagnostics', () => {
    it('reports FAILED on Configured stage when destination cannot be resolved, skipping remaining 5 stages', async () => {
      const mockClient = {
        resolveDestination: jest.fn().mockResolvedValue(null)
      };

      const result = await diagnoseOData({ s4HttpClient: mockClient });
      expect(result.channel).toBe('ODATA');
      expect(result.status).toBe('FAILED');
      expect(result.stages).toHaveLength(6);

      expect(result.stages[0]).toMatchObject({ stage: 'Configured', status: 'FAILED' });
      for (let i = 1; i < 6; i++) {
        expect(result.stages[i].status).toBe('SKIPPED');
      }
    });

    it('reports FAILED on Reachable stage when network is unreachable (ECONNREFUSED)', async () => {
      const mockClient = {
        resolveDestination: jest.fn().mockResolvedValue({ url: 'https://saps4.corp:443', sapClient: '220' }),
        get: jest.fn().mockImplementation((path) => {
          if (path === '/') {
            const err = new Error('connect ECONNREFUSED');
            err.code = 'ECONNREFUSED';
            throw err;
          }
        })
      };

      const result = await diagnoseOData({ s4HttpClient: mockClient });
      expect(result.status).toBe('FAILED');
      expect(result.stages[0]).toMatchObject({ stage: 'Configured', status: 'PASSED' });
      expect(result.stages[1]).toMatchObject({ stage: 'Reachable', status: 'FAILED' });
      expect(result.stages[2].status).toBe('SKIPPED'); // Authenticated
      expect(result.stages[3].status).toBe('SKIPPED'); // Authorized
      expect(result.stages[4].status).toBe('SKIPPED'); // Metadata verified
      expect(result.stages[5].status).toBe('SKIPPED'); // Functionally verified
    });

    it('reports FAILED on Authenticated stage when SAP returns HTTP 401', async () => {
      const mockClient = {
        resolveDestination: jest.fn().mockResolvedValue({ url: 'https://saps4.corp:443', sapClient: '220' }),
        get: jest.fn().mockImplementation((path) => {
          if (path === '/') return { status: 200 };
          if (path.includes('C_PURCHASEORDER_FS_SRV')) {
            const err = new Error('Logon failed: Name or password is incorrect');
            err.status = 401;
            throw err;
          }
        })
      };

      const result = await diagnoseOData({ s4HttpClient: mockClient });
      expect(result.status).toBe('FAILED');
      expect(result.stages[0]).toMatchObject({ stage: 'Configured', status: 'PASSED' });
      expect(result.stages[1]).toMatchObject({ stage: 'Reachable', status: 'PASSED' });
      expect(result.stages[2]).toMatchObject({ stage: 'Authenticated', status: 'FAILED' });
      expect(result.stages[3].status).toBe('SKIPPED'); // Authorized
      expect(result.stages[4].status).toBe('SKIPPED'); // Metadata verified
      expect(result.stages[5].status).toBe('SKIPPED'); // Functionally verified
    });

    it('reports FAILED on Authorized stage when SAP returns HTTP 403 Forbidden', async () => {
      const mockClient = {
        resolveDestination: jest.fn().mockResolvedValue({ url: 'https://saps4.corp:443', sapClient: '220' }),
        get: jest.fn().mockImplementation((path) => {
          if (path === '/') return { status: 200 };
          if (path.includes('C_PURCHASEORDER_FS_SRV')) {
            const err = new Error('No authorization to access the service: CX_SADL_AUTHORIZATION_ERROR');
            err.status = 403;
            throw err;
          }
        })
      };

      const result = await diagnoseOData({ s4HttpClient: mockClient });
      expect(result.status).toBe('FAILED');
      expect(result.stages[0]).toMatchObject({ stage: 'Configured', status: 'PASSED' });
      expect(result.stages[1]).toMatchObject({ stage: 'Reachable', status: 'PASSED' });
      expect(result.stages[2]).toMatchObject({ stage: 'Authenticated', status: 'PASSED' });
      expect(result.stages[3]).toMatchObject({ stage: 'Authorized', status: 'FAILED' });
      expect(result.stages[4].status).toBe('SKIPPED'); // Metadata verified
      expect(result.stages[5].status).toBe('SKIPPED'); // Functionally verified
    });

    it('reports FAILED on Metadata verified stage when $metadata schema is invalid or empty', async () => {
      const mockClient = {
        resolveDestination: jest.fn().mockResolvedValue({ url: 'https://saps4.corp:443', sapClient: '220' }),
        get: jest.fn().mockResolvedValue({ status: 200 }),
        getText: jest.fn().mockResolvedValue('<html><body>Bad Gateway 502</body></html>')
      };

      const result = await diagnoseOData({ s4HttpClient: mockClient });
      expect(result.status).toBe('FAILED');
      expect(result.stages[0]).toMatchObject({ stage: 'Configured', status: 'PASSED' });
      expect(result.stages[1]).toMatchObject({ stage: 'Reachable', status: 'PASSED' });
      expect(result.stages[2]).toMatchObject({ stage: 'Authenticated', status: 'PASSED' });
      expect(result.stages[3]).toMatchObject({ stage: 'Authorized', status: 'PASSED' });
      expect(result.stages[4]).toMatchObject({ stage: 'Metadata verified', status: 'FAILED' });
      expect(result.stages[5].status).toBe('SKIPPED'); // Functionally verified
    });

    it('reports ALL 6 STAGES PASSED when S/4HANA OData service is fully operational', async () => {
      const mockClient = {
        resolveDestination: jest.fn().mockResolvedValue({ url: 'https://saps4.corp:443', sapClient: '220' }),
        get: jest.fn().mockImplementation((path) => {
          if (path.includes('C_PurchaseOrderFs')) {
            return { status: 200, data: { d: { results: [{ PurchaseOrder: '4500000001' }] } } };
          }
          return { status: 200, data: {} };
        }),
        getText: jest.fn().mockResolvedValue('<edmx:Edmx Version="1.0"><edmx:DataServices><Schema Namespace="C_PURCHASEORDER_FS_SRV"></Schema></edmx:DataServices></edmx:Edmx>')
      };

      const result = await diagnoseOData({ s4HttpClient: mockClient });
      expect(result.status).toBe('HEALTHY');
      expect(result.stages).toHaveLength(6);
      result.stages.forEach((st) => {
        expect(st.status).toBe('PASSED');
        expect(st.latencyMs).toBeGreaterThanOrEqual(0);
      });
      expect(result.stages.map(s => s.stage)).toEqual([
        'Configured',
        'Reachable',
        'Authenticated',
        'Authorized',
        'Metadata verified',
        'Functionally verified'
      ]);
    });
  });

  describe('RFC Channel 6-Stage Diagnostics', () => {
    it('reports FAILED on Configured stage when parameters are missing', async () => {
      const mockRfc = {
        resolveConnectionParams: jest.fn().mockResolvedValue(null)
      };

      // When RfcClient is not available or params missing
      const result = await diagnoseRfc({ rfcClient: mockRfc });
      expect(result.channel).toBe('RFC');
      expect(result.status).toBe('FAILED');
      expect(result.stages[0].status).toBe('FAILED');
      for (let i = 1; i < 6; i++) {
        expect(result.stages[i].status).toBe('SKIPPED');
      }
    });

    it('reports ALL 6 STAGES PASSED when RFC client and T000 read-back succeed', async () => {
      const { RfcClient } = require('../../../srv/integration/s4hana/RfcClient');
      const origIsAvailable = RfcClient.isAvailable;
      RfcClient.isAvailable = () => true;

      try {
        const mockRfc = {
          resolveConnectionParams: jest.fn().mockResolvedValue({ client: '220', ashost: 'saps4.corp', sysnr: '00' }),
          ping: jest.fn().mockResolvedValue(true),
          describeTable: jest.fn().mockResolvedValue({ fields: [{ name: 'MANDT' }] }),
          readTable: jest.fn().mockResolvedValue([{ MANDT: '220', MTEXT: 'Sandbox Client 220' }])
        };

        const result = await diagnoseRfc({ rfcClient: mockRfc, env: { S4_CLIENT: '220' } });
        expect(result.status).toBe('HEALTHY');
        expect(result.stages).toHaveLength(6);
        result.stages.forEach((st) => {
          expect(st.status).toBe('PASSED');
        });
        expect(mockRfc.readTable).toHaveBeenCalledWith('T000', ['MANDT', 'MTEXT'], ["MANDT = '220'"]);
      } finally {
        RfcClient.isAvailable = origIsAvailable;
      }
    });
  });

  describe('Aggregated Diagnostics Runner', () => {
    it('executes both OData and RFC channels when channel is all and reports summary', async () => {
      const { RfcClient } = require('../../../srv/integration/s4hana/RfcClient');
      const origIsAvailable = RfcClient.isAvailable;
      RfcClient.isAvailable = () => true;

      try {
        const mockOData = {
          resolveDestination: jest.fn().mockResolvedValue({ url: 'https://saps4.corp:443', sapClient: '220' }),
          get: jest.fn().mockResolvedValue({ status: 200, data: { d: { results: [] } } }),
          getText: jest.fn().mockResolvedValue('<edmx:Edmx Version="1.0"><edmx:DataServices><Schema Namespace="Test"></Schema></edmx:DataServices></edmx:Edmx>')
        };
        const mockRfc = {
          resolveConnectionParams: jest.fn().mockResolvedValue({ client: '220', ashost: 'saps4.corp', sysnr: '00' }),
          ping: jest.fn().mockResolvedValue(true),
          describeTable: jest.fn().mockResolvedValue({ fields: [{ name: 'MANDT' }] }),
          readTable: jest.fn().mockResolvedValue([{ MANDT: '220', MTEXT: 'Test 220' }])
        };

        const report = await runIntegrationDiagnostics({
          channel: 'all',
          s4HttpClient: mockOData,
          rfcClient: mockRfc,
          user: 'test-admin'
        });

        expect(report.channel).toBe('ALL');
        expect(report.overallStatus).toBe('HEALTHY');
        expect(report.operator).toBe('test-admin');
        expect(report.readOnlyNotice).toBe('CONFIRMED READ-ONLY: Zero data mutations executed.');
        expect(report.summary.totalStages).toBe(12);
        expect(report.summary.passed).toBe(12);
        expect(report.summary.failed).toBe(0);
        expect(report.summary.skipped).toBe(0);
        expect(report.channels.odata).toBeDefined();
        expect(report.channels.rfc).toBeDefined();
      } finally {
        RfcClient.isAvailable = origIsAvailable;
      }
    });

    it('filters execution to only OData channel when requested', async () => {
      const mockOData = {
        resolveDestination: jest.fn().mockResolvedValue({ url: 'https://saps4.corp:443', sapClient: '220' }),
        get: jest.fn().mockResolvedValue({ status: 200, data: {} }),
        getText: jest.fn().mockResolvedValue('<edmx:Edmx><Schema></Schema></edmx:Edmx>')
      };

      const report = await runIntegrationDiagnostics({
        channel: 'odata',
        s4HttpClient: mockOData
      });

      expect(report.channel).toBe('ODATA');
      expect(report.summary.totalStages).toBe(6);
      expect(report.channels.odata).toBeDefined();
      expect(report.channels.rfc).toBeUndefined();
    });
  });
});
