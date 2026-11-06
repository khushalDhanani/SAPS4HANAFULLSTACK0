'use strict';

/**
 * Unit tests for UserManagementService handler (Phase 1 — read-only)
 * Input validation and non-default status pass-through of the private handlers, called directly with the adapter
 * mocked. The real service, adapter and role gate run together in test/integration/userManagement.test.js.
 */

// ── Mock the adapter before requiring the service ─────────────────────────────
const mockListUsers              = jest.fn();
const mockGetUserDetail          = jest.fn();
const mockLockUser               = jest.fn();
const mockUnlockUser             = jest.fn();
const mockReadPasswordExpiryData = jest.fn();

jest.mock('../../../srv/integration/s4hana/admin/UserManagementAdapter', () => ({
  UserManagementAdapter: jest.fn().mockImplementation(() => ({
    listUsers:              mockListUsers,
    getUserDetail:          mockGetUserDetail,
    lockUser:               mockLockUser,
    unlockUser:             mockUnlockUser,
    readPasswordExpiryData: mockReadPasswordExpiryData,
    getConnectionUser:      jest.fn().mockResolvedValue('CONNECTED_ADMIN'),
  })),
}));

const cds = require('@sap/cds');
const UserManagementService = require('../../../srv/admin/service');

// ── Build a service instance with adapter pre-wired (no full CAP bootstrap) ──

let svc;
beforeAll(() => {
  // Instantiate without calling init() — test methods directly
  svc = Object.create(UserManagementService.prototype);
  // Inject the mock adapter as the lazy singleton
  const { UserManagementAdapter } = require('../../../srv/integration/s4hana/admin/UserManagementAdapter');
  svc._adapter = new UserManagementAdapter();
  svc._getAdapter = () => svc._adapter;
});

// ── Helper: build a minimal CAP request object ───────────────────────────────

function makeReq(data = {}) {
  const req = {
    data,
    user: { roles: { Admin: true } },
    reject: jest.fn((status, message) => Object.assign(new Error(message), { status })),
  };
  return req;
}

// ── listUsers ────────────────────────────────────────────────────────────────

describe('UserManagementService._handleListUsers', () => {
  beforeEach(() => mockListUsers.mockReset());

  test('defaults maxRows to 200 when not provided', async () => {
    mockListUsers.mockResolvedValue([]);
    mockReadPasswordExpiryData.mockResolvedValue([]);
    await svc._handleListUsers(makeReq({}));
    expect(mockListUsers).toHaveBeenCalledWith({ search: '', maxRows: 200 });
  });

  test('enriches listed users with password expiry data', async () => {
    mockListUsers.mockResolvedValue([{ username: 'ALICE', fullName: 'Alice Smith' }]);
    mockReadPasswordExpiryData.mockResolvedValue([{
      username: 'ALICE',
      pwdLastChanged: '20261027',
      pwdExpiresAt: '20270125',
      pwdDaysRemaining: 80,
      pwdStatus: 'valid'
    }]);

    const res = await svc._handleListUsers(makeReq({}));
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({
      username: 'ALICE',
      pwdLastChanged: '20261027',
      pwdExpiresAt: '20270125',
      pwdDaysRemaining: 80,
      pwdStatus: 'valid'
    });
  });

  test('falls back gracefully if readPasswordExpiryData rejects', async () => {
    mockListUsers.mockResolvedValue([{ username: 'BOB', fullName: 'Bob Jones' }]);
    mockReadPasswordExpiryData.mockRejectedValue(new Error('USR02 unavailable'));

    const res = await svc._handleListUsers(makeReq({}));
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({
      username: 'BOB',
      pwdStatus: 'valid',
      pwdLastChanged: ''
    });
  });

  test('rejects 400 when maxRows is 0', async () => {
    const req = makeReq({ maxRows: 0 });
    await svc._handleListUsers(req);
    expect(req.reject).toHaveBeenCalledWith(400, expect.any(String));
  });

  test('rejects 400 when maxRows exceeds 1000', async () => {
    const req = makeReq({ maxRows: 1001 });
    await svc._handleListUsers(req);
    expect(req.reject).toHaveBeenCalledWith(400, expect.any(String));
  });
});

// ── protection uses the SAP logon of the caller ──

describe('UserManagementService lock protection identity', () => {
  beforeEach(() => {
    mockLockUser.mockReset();
    mockGetUserDetail.mockReset();
    mockGetUserDetail.mockResolvedValue({ username: 'ALICE', userType: 'A' });
    mockLockUser.mockResolvedValue({ status: 'success' });
  });

  test.each([
    ['the XSUAA logon name', { id: 'alice.smith@example.test', attr: { logon_name: 'alice' } }],
    ['the email name when no logon name is set', { id: 'someone-else', attr: { email: 'alice@example.test' } }],
    ['the CAP id when no attributes are set', { id: 'alice' }],
  ])('refuses self-lock when the caller is identified by %s', async (_name, user) => {
    const req = makeReq({ username: 'ALICE' });
    req.user = user;

    await svc._handleLockUser(req);

    expect(req.reject).toHaveBeenCalledWith(403, expect.stringContaining('your own user'));
    expect(mockLockUser).not.toHaveBeenCalled();
  });

  test('locks another user', async () => {
    const req = makeReq({ username: 'ALICE' });
    req.user = { id: 'bob@example.test', attr: { logon_name: 'BOB' } };

    await svc._handleLockUser(req);

    expect(mockLockUser).toHaveBeenCalledWith('ALICE');
    expect(req.reject).not.toHaveBeenCalled();
  });
});

// ── getUserDetail ─────────────────────────────────────────────────────────────

describe('UserManagementService._handleGetUserDetail', () => {
  beforeEach(() => mockGetUserDetail.mockReset());

  test('rejects 400 when username is empty', async () => {
    const req = makeReq({ username: '' });
    await svc._handleGetUserDetail(req);
    expect(req.reject).toHaveBeenCalledWith(400, expect.any(String));
  });

  test('rejects 400 when username contains invalid characters', async () => {
    const req = makeReq({ username: '<script>' });
    await svc._handleGetUserDetail(req);
    expect(req.reject).toHaveBeenCalledWith(400, expect.any(String));
  });

  test('rejects 404 when adapter throws 404', async () => {
    mockGetUserDetail.mockRejectedValue(Object.assign(new Error('User not found'), { status: 404 }));
    const req = makeReq({ username: 'NOBODY' });
    await svc._handleGetUserDetail(req);
    expect(req.reject).toHaveBeenCalledWith(404, expect.any(String));
  });

  test('enriches user detail with password expiry data', async () => {
    mockGetUserDetail.mockResolvedValue({ username: 'CHARLIE', fullName: 'Charlie Brown', userType: 'A' });
    mockReadPasswordExpiryData.mockResolvedValue([{
      username: 'CHARLIE',
      pwdLastChanged: '20260818',
      pwdExpiresAt: '20261116',
      pwdDaysRemaining: 10,
      pwdStatus: 'expiring_soon'
    }]);

    const res = await svc._handleGetUserDetail(makeReq({ username: 'CHARLIE' }));
    expect(res).toMatchObject({
      username: 'CHARLIE',
      pwdLastChanged: '20260818',
      pwdExpiresAt: '20261116',
      pwdDaysRemaining: 10,
      pwdStatus: 'expiring_soon'
    });
  });
});

// ── lockUser ──────────────────────────────────────────────────────────────────

describe('UserManagementService._handleLockUser', () => {
  beforeEach(() => mockLockUser.mockReset());

  test('rejects 400 when username is empty', async () => {
    const req = makeReq({ username: '' });
    await svc._handleLockUser(req);
    expect(req.reject).toHaveBeenCalledWith(400, expect.any(String));
  });

  test('rejects 400 when username contains invalid characters', async () => {
    const req = makeReq({ username: 'BAD USER;' });
    await svc._handleLockUser(req);
    expect(req.reject).toHaveBeenCalledWith(400, expect.any(String));
  });
});

// ── unlockUser ────────────────────────────────────────────────────────────────

describe('UserManagementService._handleUnlockUser', () => {
  beforeEach(() => mockUnlockUser.mockReset());

  test('rejects 400 when username is empty', async () => {
    const req = makeReq({ username: '' });
    await svc._handleUnlockUser(req);
    expect(req.reject).toHaveBeenCalledWith(400, expect.any(String));
  });

  test('rejects 400 when username contains invalid characters', async () => {
    const req = makeReq({ username: 'BOB*INVAL' });
    await svc._handleUnlockUser(req);
    expect(req.reject).toHaveBeenCalledWith(400, expect.any(String));
  });
});

// ── getPasswordExpirySummary ──────────────────────────────────────────────────

describe('UserManagementService._handleGetPasswordExpirySummary', () => {
  beforeEach(() => mockReadPasswordExpiryData.mockReset());

  test('aggregates counts correctly across statuses', async () => {
    mockReadPasswordExpiryData.mockResolvedValue([
      { username: 'U1', pwdStatus: 'valid', pwdDaysRemaining: 50 },
      { username: 'U2', pwdStatus: 'expiring_soon', pwdDaysRemaining: 10 },
      { username: 'U3', pwdStatus: 'expiring_soon', pwdDaysRemaining: 2 }, // critical
      { username: 'U4', pwdStatus: 'expired', pwdDaysRemaining: -5 },
      { username: 'U5', pwdStatus: 'initial', pwdDaysRemaining: 0 },
      { username: 'U6', pwdStatus: 'exempt', pwdDaysRemaining: null },
    ]);

    const res = await svc._handleGetPasswordExpirySummary(makeReq({}));
    expect(res).toEqual({
      totalMonitored: 6,
      valid: 1,
      expiringSoon: 2,
      criticalExpiring: 1,
      expired: 1,
      initialPassword: 1,
      exempt: 1,
      policyDays: 90,
      warningDays: 14,
    });
  });

  test('rejects 502 if adapter throws', async () => {
    mockReadPasswordExpiryData.mockRejectedValue(new Error('SAP connection lost'));
    const req = makeReq({});
    await svc._handleGetPasswordExpirySummary(req);
    expect(req.reject).toHaveBeenCalledWith(502, expect.stringContaining('SAP connection lost'));
  });
});

// ── getPasswordExpiryList ─────────────────────────────────────────────────────

describe('UserManagementService._handleGetPasswordExpiryList', () => {
  beforeEach(() => mockReadPasswordExpiryData.mockReset());

  test('filters list by status and search keyword', async () => {
    mockReadPasswordExpiryData.mockResolvedValue([
      { username: 'ALICE', fullName: 'Alice Smith', pwdStatus: 'expiring_soon' },
      { username: 'BOB', fullName: 'Bob Jones', pwdStatus: 'expired' },
      { username: 'ALEX', fullName: 'Alex Turner', pwdStatus: 'expiring_soon' },
    ]);

    const res = await svc._handleGetPasswordExpiryList(makeReq({ status: 'expiring_soon', search: 'al' }));
    expect(res).toHaveLength(2);
    expect(res.map((r) => r.username)).toEqual(['ALICE', 'ALEX']);
  });

  test('rejects 400 when maxRows is invalid', async () => {
    const req = makeReq({ maxRows: 0 });
    await svc._handleGetPasswordExpiryList(req);
    expect(req.reject).toHaveBeenCalledWith(400, expect.any(String));
  });

  test('caps results to maxRows', async () => {
    mockReadPasswordExpiryData.mockResolvedValue([
      { username: 'U1', pwdStatus: 'valid' },
      { username: 'U2', pwdStatus: 'valid' },
      { username: 'U3', pwdStatus: 'valid' },
    ]);

    const res = await svc._handleGetPasswordExpiryList(makeReq({ maxRows: 2 }));
    expect(res).toHaveLength(2);
  });
});

// ── getPasswordExpiryMonitor ──────────────────────────────────────────────────

describe('UserManagementService._handleGetPasswordExpiryMonitor', () => {
  const originalDb = cds.db;

  afterEach(() => {
    cds.db = originalDb;
  });

  test('returns state off when no database record exists', async () => {
    cds.db = {
      run: jest.fn().mockResolvedValue(null)
    };

    const res = await svc._handleGetPasswordExpiryMonitor(makeReq({}));
    expect(res).toMatchObject({
      state: 'off',
      totalMonitoredUsers: 0,
      lastStatus: 'off'
    });
  });

  test('returns populated health record when present in database', async () => {
    cds.db = {
      run: jest.fn().mockResolvedValue({
        id: 'main',
        lastRunAt: '2026-11-06T08:00:00.000Z',
        lastStatus: 'ok',
        lastRunDurationMs: 650,
        totalMonitoredUsers: 278,
        expiringSoonCount: 19,
        expiredCount: 173,
        initialPasswordCount: 0,
        exemptCount: 9,
        lastNotificationDispatchedAt: '2026-11-06T08:01:00.000Z',
        pendingNotificationCount: 0,
        failedNotificationCount: 0,
        errorMessage: ''
      })
    };

    const res = await svc._handleGetPasswordExpiryMonitor(makeReq({}));
    expect(res).toMatchObject({
      state: 'ok',
      totalMonitoredUsers: 278,
      expiringSoonCount: 19,
      expiredCount: 173,
      lastRunDurationMs: 650
    });
  });
});
