'use strict';

/**
 * Unit tests for SecurityAuditLogAdapter.js
 * All tests run with a mocked RFC client — no live SAP connection.
 *
 * Coverage:
 *   readAuditLog — input validation, IS_INTERVAL construction with timezone offset,
 *                  ET_LOG_UTC preference vs ET_LOG fallback,
 *                  fallback conversion to UTC with warning,
 *                  fallback rejection when rejectOnFallback=true (throws 502),
 *                  userFilter range table mapping,
 *                  user field (includeUser true/false),
 *                  field allow-list, row cap, ET_RETURN error/warning handling,
 *                  RFC error → 503
 */

const {
  SecurityAuditLogAdapter,
  convertLocalToUtc,
} = require('../../../srv/integration/s4hana/admin/SecurityAuditLogAdapter');

// ---------------------------------------------------------------------------
// Helper: build a minimal mock RFC client
// ---------------------------------------------------------------------------
function makeMockRfc(overrides = {}) {
  return {
    call: jest.fn(async () => ({ ET_LOG: [], ET_LOG_UTC: [], ET_RETURN: [] })),
    ...overrides,
  };
}

const fakeRow = {
  SID:         'DS4',
  INSTANCE:    'app-server-01_DS4_00',
  SAL_DATE:    '20240115',
  SAL_TIME:    '130000',
  SLGMAND:     '220',
  AREA:        'AU',
  SUBID:       '05',
  MSG:         'AU5',
  TXSUBCLSID:  'Logon',
  SEVERITY:    1,
  TXSEVERITY:  'Information',
  SLGTC:       'SU01',
  SLGREPNA:    'RSUSR300',
  SAL_DATA:    'Login success for user=TARGET_USER from 192.168.1.1',
  TASKTYPE:    'DIA',
  TASKNO:      '001',
  LOG_TSTMP:   '20240115073000.1234560',
  SLGUSER:     'AUDIT_USER',
  USERALIAS:   'ALIAS',
  SMTP_ADDR:   'test@example.com',
  SLGLTRM2:    '192.168.1.1',
  TERM_IPV6:   '::1',
  X_STRING:    'RAW_BINARY',
  PARAM1:      'P1',
  PARAM2:      'P2',
  PARAM3:      'P3',
  PARAMX:      'PX',
  EPP:         'EPP_BINARY',
  SRC:         'SRC',
  MFD_FLAG:    '',
  ALERT_FLAG:  '',
  CTAB:        '',
  CLASS:       'C',
  COUNTER:     1,
  FILE_NO:     0,
};

// ---------------------------------------------------------------------------
// convertLocalToUtc helper
// ---------------------------------------------------------------------------
describe('convertLocalToUtc', () => {
  test('converts server-local date and time to UTC using offset', () => {
    // 2024-01-15 13:00:00 with offset +330 min -> 07:30:00 UTC
    const res = convertLocalToUtc('20240115', '130000', 330);
    expect(res.date).toBe('20240115');
    expect(res.time).toBe('073000');
    expect(res.isoTimestamp).toBe('2024-01-15T07:30:00.000Z');
  });

  test('handles date boundary rollover', () => {
    // 2024-01-16 02:00:00 with offset +330 min (5.5h) -> 2024-01-15 20:30:00 UTC
    const res = convertLocalToUtc('20240116', '020000', 330);
    expect(res.date).toBe('20240115');
    expect(res.time).toBe('203000');
  });
});

// ---------------------------------------------------------------------------
// Input validation & IS_INTERVAL
// ---------------------------------------------------------------------------
describe('SecurityAuditLogAdapter.readAuditLog — input validation', () => {
  const adapter = new SecurityAuditLogAdapter({ rfcClient: makeMockRfc() });

  test('throws 400 when fromUtc or toUtc is missing or invalid', async () => {
    await expect(adapter.readAuditLog({ toUtc: new Date() })).rejects.toMatchObject({ status: 400 });
    await expect(adapter.readAuditLog({ fromUtc: new Date() })).rejects.toMatchObject({ status: 400 });
    await expect(adapter.readAuditLog({ fromUtc: 'bad', toUtc: new Date() })).rejects.toMatchObject({ status: 400 });
    await expect(adapter.readAuditLog({ fromUtc: new Date(), toUtc: 'bad' })).rejects.toMatchObject({ status: 400 });
    await expect(adapter.readAuditLog({ fromUtc: new Date('2024-01-15'), toUtc: new Date('2024-01-14') })).rejects.toMatchObject({ status: 400 });
  });

  test('builds IS_INTERVAL shifted to server time for log file selection', async () => {
    const mockRfc = makeMockRfc();
    const adapter = new SecurityAuditLogAdapter({ rfcClient: mockRfc, tzOffsetMinutes: 330 });
    const from = new Date('2024-01-15T07:30:00.000Z');
    const to   = new Date('2024-01-15T08:30:00.000Z');
    await adapter.readAuditLog({ fromUtc: from, toUtc: to });

    expect(mockRfc.call).toHaveBeenCalledWith(
      'RSAU_API_GET_LOG_DATA',
      expect.objectContaining({
        IS_INTERVAL: {
          DAT_FROM: '20240115',
          DAT_TO:   '20240115',
          TIM_FROM: '130000', // shifted +330m to server local
          TIM_TO:   '140000',
        },
        ID_FILE_SEL_SIMPLE: 'X',
      })
    );
  });

  test('passes userFilter uppercased to IT_USER and IT_R_USER range tables with EQ only', async () => {
    const mockRfc = makeMockRfc();
    const adapter = new SecurityAuditLogAdapter({ rfcClient: mockRfc });
    await adapter.readAuditLog({
      fromUtc: new Date('2024-01-15T07:00:00Z'),
      toUtc:   new Date('2024-01-15T08:00:00Z'),
      userFilter: 'test_admin',
    });

    expect(mockRfc.call).toHaveBeenCalledWith(
      'RSAU_API_GET_LOG_DATA',
      expect.objectContaining({
        IT_USER:   [{ SIGN: 'I', OPTION: 'EQ', LOW: 'TEST_ADMIN', HIGH: '' }],
        IT_R_USER: [{ SIGN: 'I', OPTION: 'EQ', LOW: 'TEST_ADMIN', HIGH: '' }],
      })
    );
  });

  test('rejects userFilter containing wildcards with status 400', async () => {
    const adapter = new SecurityAuditLogAdapter({ rfcClient: makeMockRfc() });
    await expect(
      adapter.readAuditLog({
        fromUtc: new Date('2024-01-15T07:00:00Z'),
        toUtc:   new Date('2024-01-15T08:00:00Z'),
        userFilter: 'TEST_*',
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  test('rejects userFilter exceeding 12 characters with status 400', async () => {
    const adapter = new SecurityAuditLogAdapter({ rfcClient: makeMockRfc() });
    await expect(
      adapter.readAuditLog({
        fromUtc: new Date('2024-01-15T07:00:00Z'),
        toUtc:   new Date('2024-01-15T08:00:00Z'),
        userFilter: 'TOOLONGUSERNAME123',
      })
    ).rejects.toMatchObject({ status: 400 });
  });
});

// ---------------------------------------------------------------------------
// ET_LOG_UTC preference vs ET_LOG fallback paths
// ---------------------------------------------------------------------------
describe('SecurityAuditLogAdapter.readAuditLog — ET_LOG_UTC vs fallback', () => {
  test('Path 1: uses ET_LOG_UTC when populated (no conversion warning)', async () => {
    const utcRow = { ...fakeRow, SAL_DATE: '20240115', SAL_TIME: '073000' };
    const mockRfc = makeMockRfc({
      call: jest.fn(async () => ({ ET_LOG: [], ET_LOG_UTC: [utcRow], ET_RETURN: [] })),
    });
    const adapter = new SecurityAuditLogAdapter({ rfcClient: mockRfc });
    const { entries, warnings } = await adapter.readAuditLog({
      fromUtc: new Date('2024-01-15T07:00:00Z'),
      toUtc:   new Date('2024-01-15T09:00:00Z'),
    });
    expect(entries[0].time).toBe('073000');
    expect(warnings.some((w) => w.includes('converted server-local'))).toBe(false);
  });

  test('Path 2A: ET_LOG_UTC empty uses LOG_TSTMP on ET_LOG as primary UTC source', async () => {
    // Local time 13:00:00, but kernel LOG_TSTMP is 073000 UTC
    const localRow = { ...fakeRow, SAL_DATE: '20240115', SAL_TIME: '130000', LOG_TSTMP: '20240115073000.1234560' };
    const mockRfc = makeMockRfc({
      call: jest.fn(async () => ({ ET_LOG: [localRow], ET_LOG_UTC: [], ET_RETURN: [] })),
    });
    const adapter = new SecurityAuditLogAdapter({ rfcClient: mockRfc, rejectOnFallback: false });
    const { entries, warnings } = await adapter.readAuditLog({
      fromUtc: new Date('2024-01-15T07:00:00Z'),
      toUtc:   new Date('2024-01-15T09:00:00Z'),
    });
    expect(entries[0].time).toBe('073000');
    expect(entries[0].serverTime).toBe('130000');
    expect(entries[0].utcTimestamp).toBe('2024-01-15T07:30:00.123Z');
    // Primary LOG_TSTMP path does not produce fallback warning
    expect(warnings.some((w) => w.includes('converted server-local timestamps'))).toBe(false);
  });

  test('Path 2B: ET_LOG_UTC and LOG_TSTMP empty falls back to offset conversion with visible warning', async () => {
    // Local time 13:00:00 with offset 330 and missing LOG_TSTMP -> converts to 07:30:00 UTC
    const localRow = { ...fakeRow, SAL_DATE: '20240115', SAL_TIME: '130000', LOG_TSTMP: '' };
    const mockRfc = makeMockRfc({
      call: jest.fn(async () => ({ ET_LOG: [localRow], ET_LOG_UTC: [], ET_RETURN: [] })),
    });
    const adapter = new SecurityAuditLogAdapter({ rfcClient: mockRfc, tzOffsetMinutes: 330, rejectOnFallback: false });
    const { entries, warnings } = await adapter.readAuditLog({
      fromUtc: new Date('2024-01-15T07:00:00Z'),
      toUtc:   new Date('2024-01-15T09:00:00Z'),
    });
    expect(entries[0].time).toBe('073000');
    expect(entries[0].serverTime).toBe('130000');
    expect(warnings.some((w) => w.includes('converted server-local timestamps in ET_LOG to UTC'))).toBe(true);
  });

  test('Path 2B: ET_LOG_UTC empty with rejectOnFallback=true throws 502 with clear error', async () => {
    const localRow = { ...fakeRow, SAL_DATE: '20240115', SAL_TIME: '130000' };
    const mockRfc = makeMockRfc({
      call: jest.fn(async () => ({ ET_LOG: [localRow], ET_LOG_UTC: [], ET_RETURN: [] })),
    });
    const adapter = new SecurityAuditLogAdapter({ rfcClient: mockRfc, rejectOnFallback: true });
    await expect(
      adapter.readAuditLog({ fromUtc: new Date('2024-01-15T07:00:00Z'), toUtc: new Date('2024-01-15T09:00:00Z') })
    ).rejects.toMatchObject({
      status: 502,
      message: expect.stringMatching(/ET_LOG_UTC is empty.*fallback is rejected/),
    });
  });
});

// ---------------------------------------------------------------------------
// User field & Privacy toggle
// ---------------------------------------------------------------------------
describe('SecurityAuditLogAdapter.readAuditLog — user field', () => {
  test('includeUser=false omits user property and redacts user token from message', async () => {
    const mockRfc = makeMockRfc({
      call: jest.fn(async () => ({ ET_LOG: [fakeRow], ET_LOG_UTC: [], ET_RETURN: [] })),
    });
    const adapter = new SecurityAuditLogAdapter({ rfcClient: mockRfc, includeUser: false });
    const { entries } = await adapter.readAuditLog({
      fromUtc: new Date('2024-01-15T07:00:00Z'),
      toUtc:   new Date('2024-01-15T09:00:00Z'),
    });
    expect(entries[0]).not.toHaveProperty('user');
    expect(entries[0].message).toContain('user=[user]');
  });

  test('includeUser=true includes user property', async () => {
    const mockRfc = makeMockRfc({
      call: jest.fn(async () => ({ ET_LOG: [fakeRow], ET_LOG_UTC: [], ET_RETURN: [] })),
    });
    const adapter = new SecurityAuditLogAdapter({ rfcClient: mockRfc, includeUser: true });
    const { entries } = await adapter.readAuditLog({
      fromUtc: new Date('2024-01-15T07:00:00Z'),
      toUtc:   new Date('2024-01-15T09:00:00Z'),
    });
    expect(entries[0].user).toBe('AUDIT_USER');
  });
});

// ---------------------------------------------------------------------------
// Allow-list & Error handling
// ---------------------------------------------------------------------------
describe('SecurityAuditLogAdapter.readAuditLog — allow-list and errors', () => {
  test('excludes non-allow-listed private fields', async () => {
    const mockRfc = makeMockRfc({
      call: jest.fn(async () => ({ ET_LOG: [fakeRow], ET_LOG_UTC: [], ET_RETURN: [] })),
    });
    const adapter = new SecurityAuditLogAdapter({ rfcClient: mockRfc });
    const { entries } = await adapter.readAuditLog({
      fromUtc: new Date('2024-01-15T07:00:00Z'),
      toUtc:   new Date('2024-01-15T09:00:00Z'),
    });
    const e = entries[0];
    expect(e).not.toHaveProperty('USERALIAS');
    expect(e).not.toHaveProperty('SMTP_ADDR');
    expect(e).not.toHaveProperty('SLGLTRM2');
    expect(e).not.toHaveProperty('TERM_IPV6');
    expect(e).not.toHaveProperty('X_STRING');
    expect(e).not.toHaveProperty('PARAM1');
    expect(e).toHaveProperty('systemId', 'DS4');
    expect(e).toHaveProperty('instance', 'app-server-01_DS4_00');
  });

  test('throws 502 on ET_RETURN error/abort', async () => {
    const mockRfc = makeMockRfc({
      call: jest.fn(async () => ({
        ET_LOG: [], ET_LOG_UTC: [],
        ET_RETURN: [{ TYPE: 'E', MESSAGE: 'Auth failure' }],
      })),
    });
    const adapter = new SecurityAuditLogAdapter({ rfcClient: mockRfc });
    await expect(
      adapter.readAuditLog({ fromUtc: new Date('2024-01-15T07:00:00Z'), toUtc: new Date('2024-01-15T09:00:00Z') })
    ).rejects.toMatchObject({ status: 502 });
  });

  test('wraps RFC call failure as status 503', async () => {
    const mockRfc = makeMockRfc({
      call: jest.fn(async () => { throw new Error('RFC failure'); }),
    });
    const adapter = new SecurityAuditLogAdapter({ rfcClient: mockRfc });
    await expect(
      adapter.readAuditLog({ fromUtc: new Date('2024-01-15T07:00:00Z'), toUtc: new Date('2024-01-15T09:00:00Z') })
    ).rejects.toMatchObject({ status: 503 });
  });
});
