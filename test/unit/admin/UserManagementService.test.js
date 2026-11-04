'use strict';

/**
 * Unit tests for UserManagementService handler (Phase 1 — read-only)
 * Tests the private _handleListUsers and _handleGetUserDetail methods directly,
 * bypassing cds.ApplicationService's init lifecycle to keep tests fast and isolated.
 */

// ── Mock the adapter before requiring the service ─────────────────────────────
const mockListUsers     = jest.fn();
const mockGetUserDetail = jest.fn();
const mockLockUser      = jest.fn();
const mockUnlockUser    = jest.fn();

jest.mock('../../../srv/integration/s4hana/admin/UserManagementAdapter', () => ({
  UserManagementAdapter: jest.fn().mockImplementation(() => ({
    listUsers:     mockListUsers,
    getUserDetail: mockGetUserDetail,
    lockUser:      mockLockUser,
    unlockUser:    mockUnlockUser,
  })),
}));

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

  test('calls adapter.listUsers with correct params and returns result', async () => {
    const users = [{ username: 'ALICE', firstName: 'Alice', lastName: 'Smith', fullName: 'Alice Smith' }];
    mockListUsers.mockResolvedValue(users);
    const req    = makeReq({ search: 'ALI', maxRows: 100 });
    const result = await svc._handleListUsers(req);
    expect(mockListUsers).toHaveBeenCalledWith({ search: 'ALI', maxRows: 100 });
    expect(result).toBe(users);
    expect(req.reject).not.toHaveBeenCalled();
  });

  test('defaults maxRows to 200 when not provided', async () => {
    mockListUsers.mockResolvedValue([]);
    await svc._handleListUsers(makeReq({}));
    expect(mockListUsers).toHaveBeenCalledWith({ search: '', maxRows: 200 });
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

  test('rejects 502 when adapter throws', async () => {
    mockListUsers.mockRejectedValue(Object.assign(new Error('RFC error'), { status: 502 }));
    const req = makeReq({});
    await svc._handleListUsers(req);
    expect(req.reject).toHaveBeenCalledWith(502, expect.any(String));
  });
});

// ── getUserDetail ─────────────────────────────────────────────────────────────

describe('UserManagementService._handleGetUserDetail', () => {
  beforeEach(() => mockGetUserDetail.mockReset());

  const DETAIL = {
    username: 'ALICE', firstName: 'Alice', lastName: 'Smith', fullName: 'Alice Smith',
    email: 'alice@test.com', userType: 'A', validFrom: '00000000', validTo: '00000000',
    userGroup: '', lockedWrong: 'U', lockedNoPw: 'U', lockedGlobal: 'U', lockedLocal: 'U',
    isLocked: false, roleCount: 2, profileCount: 1, lastChanged: '20261001', lastChangedBy: 'ADMIN',
  };

  test('calls adapter.getUserDetail with trimmed username and returns result', async () => {
    mockGetUserDetail.mockResolvedValue(DETAIL);
    const req    = makeReq({ username: '  alice  ' });
    const result = await svc._handleGetUserDetail(req);
    expect(mockGetUserDetail).toHaveBeenCalledWith('alice');
    expect(result).toBe(DETAIL);
    expect(req.reject).not.toHaveBeenCalled();
  });

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

  test('rejects 502 when adapter throws RFC error', async () => {
    mockGetUserDetail.mockRejectedValue(Object.assign(new Error('RFC timeout'), { status: 502 }));
    const req = makeReq({ username: 'ALICE' });
    await svc._handleGetUserDetail(req);
    expect(req.reject).toHaveBeenCalledWith(502, expect.any(String));
  });
});

// ── lockUser ──────────────────────────────────────────────────────────────────

describe('UserManagementService._handleLockUser', () => {
  beforeEach(() => mockLockUser.mockReset());

  test('calls adapter.lockUser with trimmed username and returns result', async () => {
    const outcome = { success: true, message: "User 'ALICE' locked", username: 'ALICE' };
    mockLockUser.mockResolvedValue(outcome);
    const req = makeReq({ username: '  alice  ' });
    const result = await svc._handleLockUser(req);
    expect(mockLockUser).toHaveBeenCalledWith('alice');
    expect(result).toBe(outcome);
    expect(req.reject).not.toHaveBeenCalled();
  });

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

  test('surfaces 403 when adapter rejects self-lock', async () => {
    mockLockUser.mockRejectedValue(Object.assign(new Error('Cannot lock connection user'), { status: 403 }));
    const req = makeReq({ username: 'CONNECTED_ADMIN' });
    await svc._handleLockUser(req);
    expect(req.reject).toHaveBeenCalledWith(403, expect.stringContaining('connection user'));
  });

  test('rejects 502 when adapter throws RFC error', async () => {
    mockLockUser.mockRejectedValue(Object.assign(new Error('RFC error'), { status: 502 }));
    const req = makeReq({ username: 'ALICE' });
    await svc._handleLockUser(req);
    expect(req.reject).toHaveBeenCalledWith(502, expect.any(String));
  });
});

// ── unlockUser ────────────────────────────────────────────────────────────────

describe('UserManagementService._handleUnlockUser', () => {
  beforeEach(() => mockUnlockUser.mockReset());

  test('calls adapter.unlockUser with trimmed username and returns result', async () => {
    const outcome = { success: true, message: "User 'BOB' unlocked", username: 'BOB' };
    mockUnlockUser.mockResolvedValue(outcome);
    const req = makeReq({ username: '  bob  ' });
    const result = await svc._handleUnlockUser(req);
    expect(mockUnlockUser).toHaveBeenCalledWith('bob');
    expect(result).toBe(outcome);
    expect(req.reject).not.toHaveBeenCalled();
  });

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

  test('rejects 502 when adapter throws RFC error', async () => {
    mockUnlockUser.mockRejectedValue(Object.assign(new Error('RFC error'), { status: 502 }));
    const req = makeReq({ username: 'BOB' });
    await svc._handleUnlockUser(req);
    expect(req.reject).toHaveBeenCalledWith(502, expect.any(String));
  });
});
