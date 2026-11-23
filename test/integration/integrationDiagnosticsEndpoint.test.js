'use strict';

/**
 * test/integration/integrationDiagnosticsEndpoint.test.js
 *
 * Integration tests for the separately controlled, authenticated SAP integration diagnostic endpoint.
 * Resolves Finding MON-01 (P1): Dependency health is not the same as live SAP connectivity.
 */

const express = require('express');
const axios = require('axios');
const { registerHealth } = require('../../srv/common/health');

describe('Integration: Separately Controlled SAP Integration Diagnostics (/admin/diagnostics/sap)', () => {
  let app;
  let server;
  let baseUrl;
  let mockDiagnosticsRunner;

  beforeAll((done) => {
    app = express();

    // Mock diagnostics runner
    mockDiagnosticsRunner = jest.fn().mockImplementation(async ({ channel, user }) => ({
      timestamp: new Date().toISOString(),
      channel: (channel || 'ALL').toUpperCase(),
      overallStatus: 'HEALTHY',
      targetClient: '220',
      systemLabel: 'DS4/220',
      operator: user,
      readOnlyNotice: 'CONFIRMED READ-ONLY: Zero data mutations executed.',
      summary: { totalStages: 6, passed: 6, failed: 0, skipped: 0 },
      channels: {
        odata: {
          channel: 'ODATA',
          status: 'HEALTHY',
          stages: [
            { stage: 'Configured', status: 'PASSED', details: 'Destination resolved', latencyMs: 2 },
            { stage: 'Reachable', status: 'PASSED', details: 'Gateway reachable', latencyMs: 15 },
            { stage: 'Authenticated', status: 'PASSED', details: 'Technical user authenticated', latencyMs: 30 },
            { stage: 'Authorized', status: 'PASSED', details: 'Authorized for service', latencyMs: 25 },
            { stage: 'Metadata verified', status: 'PASSED', details: 'Schema valid', latencyMs: 40 },
            { stage: 'Functionally verified', status: 'PASSED', details: 'Read query succeeded', latencyMs: 20 }
          ]
        }
      }
    }));

    // Attach mock authentication middleware simulating req.user
    app.use((req, _res, next) => {
      const auth = req.headers.authorization || '';
      if (auth.includes('Bearer admin-token')) {
        req.user = {
          id: 'admin-user',
          is: (role) => role === 'Admin' || role === 'TechnicalUser'
        };
      } else if (auth.includes('Bearer viewer-token')) {
        req.user = {
          id: 'viewer-user',
          is: (role) => role === 'Viewer'
        };
      }
      next();
    });

    registerHealth(app, {
      diagnosticsRunner: mockDiagnosticsRunner
    });

    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      done();
    });
  });

  afterAll((done) => {
    server.close(done);
  });

  const get = (path, headers = {}) => axios.get(`${baseUrl}${path}`, {
    headers,
    validateStatus: () => true
  });

  describe('Unauthenticated Protection & Lockout Prevention', () => {
    it('rejects unauthenticated calls to /admin/diagnostics/sap with HTTP 401 AUTHENTICATION_REQUIRED', async () => {
      const res = await get('/admin/diagnostics/sap');
      expect(res.status).toBe(401);
      expect(res.data).toMatchObject({
        error: 'AUTHENTICATION_REQUIRED',
        requiredRole: 'Admin'
      });
      expect(res.data.message).toContain('Unauthenticated health probes are prohibited from repeatedly logging on to SAP');
      expect(mockDiagnosticsRunner).not.toHaveBeenCalled();
    });

    it('rejects unauthenticated calls to alias /health/diagnostic with HTTP 401', async () => {
      const res = await get('/health/diagnostic');
      expect(res.status).toBe(401);
      expect(res.data.error).toBe('AUTHENTICATION_REQUIRED');
      expect(mockDiagnosticsRunner).not.toHaveBeenCalled();
    });

    it('rejects authenticated callers lacking Admin role with HTTP 403 FORBIDDEN', async () => {
      const res = await get('/admin/diagnostics/sap', {
        Authorization: 'Bearer viewer-token'
      });
      expect(res.status).toBe(403);
      expect(res.data).toMatchObject({
        error: 'FORBIDDEN',
        requiredRole: 'Admin'
      });
      expect(mockDiagnosticsRunner).not.toHaveBeenCalled();
    });
  });

  describe('Authenticated Diagnostic Execution', () => {
    it('executes 6-stage diagnostic when authenticated with Admin role and returns HTTP 200', async () => {
      const res = await get('/admin/diagnostics/sap?channel=odata', {
        Authorization: 'Bearer admin-token'
      });
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(mockDiagnosticsRunner).toHaveBeenCalledWith({
        channel: 'odata',
        user: 'admin-user'
      });

      expect(res.data).toMatchObject({
        overallStatus: 'HEALTHY',
        channel: 'ODATA',
        operator: 'admin-user',
        readOnlyNotice: 'CONFIRMED READ-ONLY: Zero data mutations executed.',
        summary: { totalStages: 6, passed: 6, failed: 0 }
      });
      expect(res.data.channels.odata.stages).toHaveLength(6);
      expect(res.data.channels.odata.stages.map(s => s.stage)).toEqual([
        'Configured',
        'Reachable',
        'Authenticated',
        'Authorized',
        'Metadata verified',
        'Functionally verified'
      ]);
    });

    it('returns HTTP 502 Bad Gateway when overall diagnostic status is FAILED', async () => {
      mockDiagnosticsRunner.mockResolvedValueOnce({
        timestamp: new Date().toISOString(),
        channel: 'ALL',
        overallStatus: 'FAILED',
        summary: { totalStages: 6, passed: 1, failed: 1, skipped: 4 },
        channels: {
          odata: {
            status: 'FAILED',
            stages: [
              { stage: 'Configured', status: 'PASSED', details: 'Configured' },
              { stage: 'Reachable', status: 'FAILED', details: 'Connection refused' }
            ]
          }
        }
      });

      const res = await get('/admin/diagnostics/sap', {
        Authorization: 'Bearer admin-token'
      });
      expect(res.status).toBe(502);
      expect(res.data.overallStatus).toBe('FAILED');
    });
  });

  describe('Unauthenticated /health/dependencies Metadata Contract', () => {
    it('exposes diagnostics endpoint metadata while keeping sapOData as NOT_CHECKED and dependencies status words only', async () => {
      const res = await get('/health/dependencies');
      expect(res.status).toBe(200);
      expect(res.data.dependencies.sapOData).toBe('NOT_CHECKED');
      expect(res.data.diagnosticsEndpoint).toBe('/admin/diagnostics/sap');
      expect(res.data.note).toContain('Unauthenticated dependency health reports local configuration and SDK state only');
    });
  });
});
