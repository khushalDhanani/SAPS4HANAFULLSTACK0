'use strict';

/**
 * Real CAP framework-level HTTP authorization pipeline test for SapLogsService.
 * Uses cds.test to serve the application and executes HTTP GET requests
 * against /odata/v4/sap-logs endpoints through CAP's actual HTTP auth pipeline.
 *
 * Scenarios for both getSystemLog and getSecurityAuditLog:
 *   - No credentials (Anonymous) -> 401 Unauthorized
 *   - User without SapLogsReader/Admin role (test-logs-viewer) -> 403 Forbidden
 *   - User with SapLogsReader role (test-logs-reader) -> 200 OK
 *   - User with Admin role (test-admin) -> 200 OK
 */

const cds = require('@sap/cds');
const { SystemLogAdapter } = require('../../../srv/integration/s4hana/admin/SystemLogAdapter');
const { SecurityAuditLogAdapter } = require('../../../srv/integration/s4hana/admin/SecurityAuditLogAdapter');

const { GET } = cds.test(__dirname + '/../../..', 'srv/admin/sap-logs-service.cds');

describe('SapLogsService — HTTP-level CAP authorization pipeline (cds.test)', () => {
  beforeAll(() => {
    jest.spyOn(SystemLogAdapter.prototype, 'readSyslog').mockResolvedValue({
      entries: [],
      count: 0,
      truncated: false,
    });
    jest.spyOn(SecurityAuditLogAdapter.prototype, 'readAuditLog').mockResolvedValue({
      entries: [],
      count: 0,
      truncated: false,
      warnings: [],
    });
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  const sysLogUrl = "/odata/v4/sap-logs/getSystemLog(fromUtc='2024-01-15T07:00:00Z',toUtc='2024-01-15T08:00:00Z')";
  const auditLogUrl = "/odata/v4/sap-logs/getSecurityAuditLog(fromUtc='2024-01-15T07:00:00Z',toUtc='2024-01-15T08:00:00Z')";

  describe('getSystemLog HTTP authorization gate', () => {
    test('no credentials -> 401 Unauthorized', async () => {
      try {
        await GET(sysLogUrl);
        throw new Error('Expected 401 Unauthorized but request succeeded');
      } catch (err) {
        expect(err.response).toBeDefined();
        expect(err.response.status).toBe(401);
      }
    });

    test('user without SapLogsReader or Admin role (test-logs-viewer) -> 403 Forbidden', async () => {
      try {
        await GET(sysLogUrl, { auth: { username: 'test-logs-viewer', password: '' } });
        throw new Error('Expected 403 Forbidden but request succeeded');
      } catch (err) {
        expect(err.response).toBeDefined();
        expect(err.response.status).toBe(403);
      }
    });

    test('user with SapLogsReader role (test-logs-reader) -> 200 OK', async () => {
      const res = await GET(sysLogUrl, { auth: { username: 'test-logs-reader', password: '' } });
      expect(res.status).toBe(200);
      expect(res.data).toBeDefined();
      expect(res.data).toHaveProperty('count', 0);
    });

    test('user with Admin role (test-admin) -> 200 OK', async () => {
      const res = await GET(sysLogUrl, { auth: { username: 'test-admin', password: '' } });
      expect(res.status).toBe(200);
      expect(res.data).toBeDefined();
      expect(res.data).toHaveProperty('count', 0);
    });
  });

  describe('getSecurityAuditLog HTTP authorization gate', () => {
    test('no credentials -> 401 Unauthorized', async () => {
      try {
        await GET(auditLogUrl);
        throw new Error('Expected 401 Unauthorized but request succeeded');
      } catch (err) {
        expect(err.response).toBeDefined();
        expect(err.response.status).toBe(401);
      }
    });

    test('user without SapLogsReader or Admin role (test-logs-viewer) -> 403 Forbidden', async () => {
      try {
        await GET(auditLogUrl, { auth: { username: 'test-logs-viewer', password: '' } });
        throw new Error('Expected 403 Forbidden but request succeeded');
      } catch (err) {
        expect(err.response).toBeDefined();
        expect(err.response.status).toBe(403);
      }
    });

    test('user with SapLogsReader role (test-logs-reader) -> 200 OK', async () => {
      const res = await GET(auditLogUrl, { auth: { username: 'test-logs-reader', password: '' } });
      expect(res.status).toBe(200);
      expect(res.data).toBeDefined();
      expect(res.data).toHaveProperty('count', 0);
    });

    test('user with Admin role (test-admin) -> 200 OK', async () => {
      const res = await GET(auditLogUrl, { auth: { username: 'test-admin', password: '' } });
      expect(res.status).toBe(200);
      expect(res.data).toBeDefined();
      expect(res.data).toHaveProperty('count', 0);
    });
  });
});
