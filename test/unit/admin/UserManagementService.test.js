'use strict';

/**
 * Unit tests for UserManagementService handler (Phase 1 — read-only)
 * Input validation and non-default status pass-through of the private handlers, called directly with the adapter
 * mocked. The real service, adapter and role gate run together in test/integration/userManagement.test.js.
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
    getConnectionUser: jest.fn().mockResolvedValue('CONNECTED_ADMIN'),
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
