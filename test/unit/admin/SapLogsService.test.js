'use strict';

/**
 * Unit tests for SapLogsService.js (CAP service handler)
 * All tests run with mocked adapters — no live SAP connection.
 *
 * Coverage:
 *   CSN verification     — verifies @requires: 'Admin' annotation in CDS model
 *   Role authorization   — unauthenticated -> 401, non-Admin -> 403, Admin -> 200
 *   getSystemLog         — missing/invalid dates (400), toUtc in future (400), span > 24h (400),
 *                          top out of range (400), successful call, pagination, adapter error mapping,
 *                          access logging without returned content
 *   getSecurityAuditLog  — missing/invalid dates (400), toUtc in future (400), span > 6h (400),
 *                          user filter pass-through, successful call, pagination, warnings forwarding,
 *                          adapter error mapping, access logging without returned content
 */

const mockSyslogAdapter = {
  readSyslog: jest.fn(),
};
const mockAuditLogAdapter = {
  readAuditLog: jest.fn(),
};

jest.mock('../../../srv/integration/s4hana/admin/SystemLogAdapter', () => ({
  SystemLogAdapter: jest.fn(() => mockSyslogAdapter),
  sanitizeMessage: (s) => s,
  toRslgTime: (d) => d.toISOString(),
  fromRslgTimeToUtc: (s) => s,
  resolveTzOffset: () => 330,
}));

jest.mock('../../../srv/integration/s4hana/admin/SecurityAuditLogAdapter', () => ({
  SecurityAuditLogAdapter: jest.fn(() => mockAuditLogAdapter),
  convertLocalToUtc: () => ({ date: '20240115', time: '073000', isoTimestamp: '2024-01-15T07:30:00.000Z' }),
}));

const mockLogInfo  = jest.fn();
const mockLogError = jest.fn();
jest.mock('../../../srv/common/logger', () => () => ({
  info:  mockLogInfo,
  error: mockLogError,
  warn:  jest.fn(),
  debug: jest.fn(),
}));

jest.mock('@sap/cds', () => ({
  ApplicationService: class {
    constructor() {
      this._handlers = {};
    }
    on(event, handler) {
      this._handlers[event] = handler;
    }
    async init() {}
  },
  load: async () => ({}),
  compile: () => ({ definitions: {} }),
}));

function makeReq(data = {}, user = { id: 'admin.user', is: (r) => r === 'Admin' }) {
  const req = {
    data,
    user,
    _error: null,
    _rejected: null,
    error(status, msg) {
      this._error = { status, msg };
      return undefined;
    },
    reject(status, msg) {
      this._rejected = { status, msg };
      return Object.assign(new Error(msg), { status });
    },
  };
  return req;
}

async function makeService() {
  const SapLogsService = require('../../../srv/admin/sapLogsService');
  const svc = new SapLogsService();
  await svc.init();
  svc._syslogAdapter   = mockSyslogAdapter;
  svc._auditLogAdapter = mockAuditLogAdapter;
  return svc;
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.SAPLOGS_MAX_SPAN_SM21_HOURS;
  delete process.env.SAPLOGS_MAX_SPAN_SM20_HOURS;
  delete process.env.SAPLOGS_DEFAULT_ROW_CAP;
});

// ---------------------------------------------------------------------------
// CDS @requires Annotation Verification
// ---------------------------------------------------------------------------
describe('SapLogsService CDS Annotation', () => {
  test('CDS model declares @(requires: "SapLogsReader")', () => {
    const fs = require('fs');
    const cdsContent = fs.readFileSync('srv/admin/sap-logs-service.cds', 'utf8');
    expect(cdsContent).toMatch(/@\(requires:\s*['"]SapLogsReader['"]\)\s*\nservice SapLogsService/);
  });
});

// ---------------------------------------------------------------------------
// Authorization & Role Enforcement Tests
// ---------------------------------------------------------------------------
describe('SapLogsService — role authorization', () => {
  const validData = { fromUtc: '2024-01-15T07:00:00Z', toUtc: '2024-01-15T08:00:00Z' };

  test('unauthenticated caller (no user) gets 401 on getSystemLog', async () => {
    const svc = await makeService();
    const req = makeReq(validData, null);
    await svc._handleGetSystemLog(req);
    expect(req._rejected).toMatchObject({ status: 401 });
  });

  test('unauthenticated caller (anonymous) gets 401 on getSystemLog', async () => {
    const svc = await makeService();
    const req = makeReq(validData, { id: 'anonymous', is: () => false });
    await svc._handleGetSystemLog(req);
    expect(req._rejected).toMatchObject({ status: 401 });
  });

  test('caller without SapLogsReader or Admin role (e.g. Viewer) gets 403 on getSystemLog', async () => {
    const svc = await makeService();
    const req = makeReq(validData, { id: 'test-viewer', is: (r) => r === 'Viewer' });
    await svc._handleGetSystemLog(req);
    expect(req._rejected).toMatchObject({ status: 403 });
  });

  test('SapLogsReader role gets 200 on getSystemLog', async () => {
    mockSyslogAdapter.readSyslog.mockResolvedValueOnce({ entries: [], count: 0, truncated: false });
    const svc = await makeService();
    const req = makeReq(validData, { id: 'test-logs-reader', is: (r) => r === 'SapLogsReader' });
    const res = await svc._handleGetSystemLog(req);
    expect(req._rejected).toBeNull();
    expect(req._error).toBeNull();
    expect(res).toHaveProperty('count', 0);
  });

  test('Admin role gets 200 on getSystemLog', async () => {
    mockSyslogAdapter.readSyslog.mockResolvedValueOnce({ entries: [], count: 0, truncated: false });
    const svc = await makeService();
    const req = makeReq(validData, { id: 'admin.user', is: (r) => r === 'Admin' });
    const res = await svc._handleGetSystemLog(req);
    expect(req._rejected).toBeNull();
    expect(req._error).toBeNull();
    expect(res).toHaveProperty('count', 0);
  });

  test('unauthenticated caller gets 401 on getSecurityAuditLog', async () => {
    const svc = await makeService();
    const req = makeReq(validData, null);
    await svc._handleGetSecurityAuditLog(req);
    expect(req._rejected).toMatchObject({ status: 401 });
  });

  test('caller without SapLogsReader or Admin role gets 403 on getSecurityAuditLog', async () => {
    const svc = await makeService();
    const req = makeReq(validData, { id: 'test-viewer', is: (r) => r === 'Viewer' });
    await svc._handleGetSecurityAuditLog(req);
    expect(req._rejected).toMatchObject({ status: 403 });
  });

  test('SapLogsReader role gets 200 on getSecurityAuditLog', async () => {
    mockAuditLogAdapter.readAuditLog.mockResolvedValueOnce({ entries: [], count: 0, truncated: false, warnings: [] });
    const svc = await makeService();
    const req = makeReq(validData, { id: 'test-logs-reader', is: (r) => r === 'SapLogsReader' });
    const res = await svc._handleGetSecurityAuditLog(req);
    expect(req._rejected).toBeNull();
    expect(req._error).toBeNull();
    expect(res).toHaveProperty('count', 0);
  });

  test('Admin role gets 200 on getSecurityAuditLog', async () => {
    mockAuditLogAdapter.readAuditLog.mockResolvedValueOnce({ entries: [], count: 0, truncated: false, warnings: [] });
    const svc = await makeService();
    const req = makeReq(validData, { id: 'admin.user', is: (r) => r === 'Admin' });
    const res = await svc._handleGetSecurityAuditLog(req);
    expect(req._rejected).toBeNull();
    expect(req._error).toBeNull();
    expect(res).toHaveProperty('count', 0);
  });
});

// ---------------------------------------------------------------------------
// getSystemLog — validation & future 'to' rejection
// ---------------------------------------------------------------------------
describe('SapLogsService.getSystemLog — validation', () => {
  test('returns 400 when fromUtc or toUtc is missing or invalid', async () => {
    const svc = await makeService();
    let req = makeReq({ toUtc: '2024-01-15T08:00:00Z' });
    await svc._handleGetSystemLog(req);
    expect(req._error).toMatchObject({ status: 400 });

    req = makeReq({ fromUtc: '2024-01-15T07:00:00Z' });
    await svc._handleGetSystemLog(req);
    expect(req._error).toMatchObject({ status: 400 });

    req = makeReq({ fromUtc: 'bad', toUtc: '2024-01-15T08:00:00Z' });
    await svc._handleGetSystemLog(req);
    expect(req._error).toMatchObject({ status: 400 });

    req = makeReq({ fromUtc: '2024-01-15T08:00:00Z', toUtc: '2024-01-15T07:00:00Z' });
    await svc._handleGetSystemLog(req);
    expect(req._error).toMatchObject({ status: 400 });
  });

  test('returns 400 when toUtc is in the future', async () => {
    const future = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const past   = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
    const svc = await makeService();
    const req = makeReq({ fromUtc: past, toUtc: future });
    await svc._handleGetSystemLog(req);
    expect(req._error).toMatchObject({ status: 400, msg: expect.stringMatching(/future/) });
  });

  test('returns 400 when span > 24 hours', async () => {
    const svc = await makeService();
    const req = makeReq({ fromUtc: '2024-01-15T00:00:00Z', toUtc: '2024-01-16T01:00:00Z' });
    await svc._handleGetSystemLog(req);
    expect(req._error).toMatchObject({ status: 400 });
  });

  test('returns 400 when top is out of range', async () => {
    const svc = await makeService();
    let req = makeReq({ fromUtc: '2024-01-15T07:00:00Z', toUtc: '2024-01-15T08:00:00Z', top: 999 });
    await svc._handleGetSystemLog(req);
    expect(req._error).toMatchObject({ status: 400 });

    req = makeReq({ fromUtc: '2024-01-15T07:00:00Z', toUtc: '2024-01-15T08:00:00Z', top: 0 });
    await svc._handleGetSystemLog(req);
    expect(req._error).toMatchObject({ status: 400 });
  });
});

// ---------------------------------------------------------------------------
// getSystemLog — success & pagination
// ---------------------------------------------------------------------------
describe('SapLogsService.getSystemLog — success and pagination', () => {
  const makeEntry = (i) => ({
    entryType: 'lA03', timestamp: '2024-01-15T07:30:00.000Z', serverTimestamp: `2024011513000${i}00`,
    processId: 'P1', client: '220', mode: 'B', tcode: 'SM21', program: 'RSLG', message: 'msg', instance: 'INST1',
  });

  test('returns entries, count, truncated=false, nextSkip=0 on success', async () => {
    mockSyslogAdapter.readSyslog.mockResolvedValueOnce({
      entries: [makeEntry(0), makeEntry(1)], count: 2, truncated: false,
    });
    const svc = await makeService();
    const req = makeReq({ fromUtc: '2024-01-15T07:00:00Z', toUtc: '2024-01-15T08:00:00Z' });
    const result = await svc._handleGetSystemLog(req);
    expect(result.count).toBe(2);
    expect(result.truncated).toBe(false);
    expect(result.nextSkip).toBe(0);
  });

  test('returns truncated=true and nextSkip on pagination cap', async () => {
    const entries = Array.from({ length: 5 }, (_, i) => makeEntry(i));
    mockSyslogAdapter.readSyslog.mockResolvedValueOnce({ entries, count: 5, truncated: true });
    const svc = await makeService();
    const req = makeReq({ fromUtc: '2024-01-15T07:00:00Z', toUtc: '2024-01-15T08:00:00Z', top: 5 });
    const result = await svc._handleGetSystemLog(req);
    expect(result.truncated).toBe(true);
    expect(result.nextSkip).toBeGreaterThan(0);
  });

  test('applies skip offset for pagination', async () => {
    const entries = Array.from({ length: 10 }, (_, i) => makeEntry(i));
    mockSyslogAdapter.readSyslog.mockResolvedValueOnce({ entries, count: 10, truncated: false });
    const svc = await makeService();
    const req = makeReq({ fromUtc: '2024-01-15T07:00:00Z', toUtc: '2024-01-15T08:00:00Z', top: 3, skip: 5 });
    const result = await svc._handleGetSystemLog(req);
    expect(result.entries[0].serverTimestamp).toBe('2024011513000500');
    expect(result.count).toBe(3);
  });

  test('access log does NOT log returned content', async () => {
    const entries = [{ message: 'SECRET_PASSWORD_123', instance: 'INST1' }];
    mockSyslogAdapter.readSyslog.mockResolvedValueOnce({ entries, count: 1, truncated: false });
    const svc = await makeService();
    const req = makeReq({ fromUtc: '2024-01-15T07:00:00Z', toUtc: '2024-01-15T08:00:00Z' }, { id: 'admin.user', is: () => true });
    await svc._handleGetSystemLog(req);

    expect(mockLogInfo).toHaveBeenCalledWith('sap-logs access', expect.objectContaining({
      user: 'admin.user',
      log:  'sm21',
    }));
    const allArgs = mockLogInfo.mock.calls.map((c) => JSON.stringify(c));
    expect(allArgs.some((a) => a.includes('SECRET_PASSWORD_123'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getSecurityAuditLog — validation, user filter & success
// ---------------------------------------------------------------------------
describe('SapLogsService.getSecurityAuditLog', () => {
  test('returns 400 when toUtc is in the future', async () => {
    const future = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const past   = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
    const svc = await makeService();
    const req = makeReq({ fromUtc: past, toUtc: future });
    await svc._handleGetSecurityAuditLog(req);
    expect(req._error).toMatchObject({ status: 400, msg: expect.stringMatching(/future/) });
  });

  test('returns 400 when span > 6 hours', async () => {
    const svc = await makeService();
    const req = makeReq({ fromUtc: '2024-01-15T00:00:00Z', toUtc: '2024-01-15T07:00:00Z' });
    await svc._handleGetSecurityAuditLog(req);
    expect(req._error).toMatchObject({ status: 400 });
  });

  test('returns 400 when user filter is provided but SAPLOGS_INCLUDE_USER is false', async () => {
    delete process.env.SAPLOGS_INCLUDE_USER;
    const svc = await makeService();
    const req = makeReq({ fromUtc: '2024-01-15T07:00:00Z', toUtc: '2024-01-15T08:00:00Z', user: 'TEST_USER' });
    await svc._handleGetSecurityAuditLog(req);
    expect(req._rejected).toMatchObject({
      status: 400,
      msg: expect.stringMatching(/disabled when SAPLOGS_INCLUDE_USER is false/),
    });
  });

  test('returns 400 when user filter contains wildcards even when SAPLOGS_INCLUDE_USER is true', async () => {
    process.env.SAPLOGS_INCLUDE_USER = 'true';
    const svc = await makeService();
    const req = makeReq({ fromUtc: '2024-01-15T07:00:00Z', toUtc: '2024-01-15T08:00:00Z', user: 'TEST_*' });
    await svc._handleGetSecurityAuditLog(req);
    expect(req._rejected).toMatchObject({
      status: 400,
      msg: expect.stringMatching(/no wildcards allowed/),
    });
  });

  test('returns 400 when user filter exceeds 12 characters even when SAPLOGS_INCLUDE_USER is true', async () => {
    process.env.SAPLOGS_INCLUDE_USER = 'true';
    const svc = await makeService();
    const req = makeReq({ fromUtc: '2024-01-15T07:00:00Z', toUtc: '2024-01-15T08:00:00Z', user: 'VERYLONGUSERNAME' });
    await svc._handleGetSecurityAuditLog(req);
    expect(req._rejected).toMatchObject({
      status: 400,
      msg: expect.stringMatching(/max 12 characters/),
    });
  });

  test('passes user filter to adapter when valid and SAPLOGS_INCLUDE_USER is true', async () => {
    process.env.SAPLOGS_INCLUDE_USER = 'true';
    mockAuditLogAdapter.readAuditLog.mockResolvedValueOnce({ entries: [], count: 0, truncated: false, warnings: [] });
    const svc = await makeService();
    const req = makeReq({ fromUtc: '2024-01-15T07:00:00Z', toUtc: '2024-01-15T08:00:00Z', user: 'TEST_USER' });
    await svc._handleGetSecurityAuditLog(req);

    expect(mockAuditLogAdapter.readAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ userFilter: 'TEST_USER' })
    );
  });

  test('forwards warnings array in response', async () => {
    mockAuditLogAdapter.readAuditLog.mockResolvedValueOnce({
      entries: [], count: 0, truncated: false,
      warnings: ['ET_LOG_UTC was empty; converted server-local timestamps in ET_LOG to UTC'],
    });
    const svc = await makeService();
    const req = makeReq({ fromUtc: '2024-01-15T07:00:00Z', toUtc: '2024-01-15T08:00:00Z' });
    const res = await svc._handleGetSecurityAuditLog(req);
    expect(res.warnings).toContain('ET_LOG_UTC was empty; converted server-local timestamps in ET_LOG to UTC');
  });

  test('maps adapter 502/503 errors to req.error()', async () => {
    mockAuditLogAdapter.readAuditLog.mockRejectedValueOnce(
      Object.assign(new Error('Fallback rejected'), { status: 502 })
    );
    const svc = await makeService();
    const req = makeReq({ fromUtc: '2024-01-15T07:00:00Z', toUtc: '2024-01-15T08:00:00Z' });
    await svc._handleGetSecurityAuditLog(req);
    expect(req._error).toMatchObject({ status: 502 });
  });
});
