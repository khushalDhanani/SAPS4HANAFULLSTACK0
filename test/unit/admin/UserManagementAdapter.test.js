'use strict';

/**
 * Unit tests for UserManagementAdapter (Phase 1 — read-only)
 * All RFC calls are mocked; no live SAP connection.
 */

const { UserManagementAdapter } = require('../../../srv/integration/s4hana/admin/UserManagementAdapter');

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeRfcCallMock(results) {
  return jest.fn().mockImplementation(async (fm) => {
    if (fm in results) return results[fm];
    throw new Error(`Unexpected RFC call: ${fm}`);
  });
}

const GETLIST_RESULT = {
  USERLIST: [
    { USERNAME: 'ALICE',   FIRSTNAME: 'Alice',   LASTNAME: 'Smith',  FULLNAME: 'Alice Smith' },
    { USERNAME: 'BOB',     FIRSTNAME: 'Bob',     LASTNAME: 'Jones',  FULLNAME: 'Bob Jones'   },
    { USERNAME: 'CHARLIE', FIRSTNAME: 'Charlie', LASTNAME: 'Brown',  FULLNAME: 'Charlie Brown'},
  ],
  RETURN: [],
};

const DETAIL_RESULT = {
  ADDRESS:   { FIRSTNAME: 'Alice', LASTNAME: 'Smith', FULLNAME: 'Alice Smith', SMTP_ADDR: 'alice@test.com' },
  LOGONDATA: { USTYP: 'A', GLTGV: '00000000', GLTGB: '00000000', CLASS: 'GRP1' },
  ISLOCKED:  { WRNG_LOGON: 'U', NO_USER_PW: 'U', GLOB_LOCK: 'U', LOCAL_LOCK: 'U' },
  ACTIVITYGROUPS: [{ AGR_NAME: 'Z_ROLE_1' }, { AGR_NAME: 'Z_ROLE_2' }],
  PROFILES:       [{ BAPIPRNAM: 'SAP_ALL' }],
  LASTMODIFIED:   { MODDATE: '20261001', MODUSER: 'ADMIN' },
  RETURN: [],
};

function makeAdapter(rfcCallResult) {
  const mockCall = makeRfcCallMock(rfcCallResult);
  const rfcClient = { call: mockCall };
  const adapter = new UserManagementAdapter({ rfcClient });
  return { adapter, mockCall };
}

// ── listUsers ────────────────────────────────────────────────────────────────

describe('UserManagementAdapter.listUsers', () => {
  test('returns mapped list from BAPI_USER_GETLIST', async () => {
    const { adapter } = makeAdapter({ BAPI_USER_GETLIST: GETLIST_RESULT });
    const result = await adapter.listUsers();
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ username: 'ALICE', firstName: 'Alice', lastName: 'Smith', fullName: 'Alice Smith' });
    expect(result[1]).toEqual({ username: 'BOB', firstName: 'Bob', lastName: 'Jones', fullName: 'Bob Jones' });
  });

  test('passes MAX_ROWS to RFC call', async () => {
    const { adapter, mockCall } = makeAdapter({ BAPI_USER_GETLIST: GETLIST_RESULT });
    await adapter.listUsers({ maxRows: 50 });
    expect(mockCall).toHaveBeenCalledWith('BAPI_USER_GETLIST', { MAX_ROWS: 50 });
  });

  test('applies client-side search filter on USERNAME', async () => {
    const { adapter } = makeAdapter({ BAPI_USER_GETLIST: GETLIST_RESULT });
    const result = await adapter.listUsers({ search: 'ALIC' }); // matches ALICE only, not BOB or CHARLIE
    expect(result).toHaveLength(1);
    expect(result[0].username).toBe('ALICE');
  });

  test('search filter is case-insensitive', async () => {
    const { adapter } = makeAdapter({ BAPI_USER_GETLIST: GETLIST_RESULT });
    const result = await adapter.listUsers({ search: 'alice' });
    expect(result).toHaveLength(1);
    expect(result[0].username).toBe('ALICE');
  });

  test('returns empty array when no users match filter', async () => {
    const { adapter } = makeAdapter({ BAPI_USER_GETLIST: GETLIST_RESULT });
    const result = await adapter.listUsers({ search: 'ZZZNOMATCH' });
    expect(result).toHaveLength(0);
  });

  test('throws 502 when RFC call fails', async () => {
    const rfcClient = { call: jest.fn().mockRejectedValue(new Error('RFC_COMM_FAILURE')) };
    const adapter = new UserManagementAdapter({ rfcClient });
    await expect(adapter.listUsers()).rejects.toMatchObject({ status: 502 });
  });

  test('throws 502 when RETURN contains error message', async () => {
    const { adapter } = makeAdapter({
      BAPI_USER_GETLIST: {
        USERLIST: [],
        RETURN: [{ TYPE: 'E', ID: 'SU', NUMBER: '001', MESSAGE: 'Authorization failed' }],
      },
    });
    await expect(adapter.listUsers()).rejects.toMatchObject({ status: 502 });
  });
});

// ── getUserDetail ─────────────────────────────────────────────────────────────

describe('UserManagementAdapter.getUserDetail', () => {
  test('returns mapped detail from BAPI_USER_GET_DETAIL', async () => {
    const { adapter, mockCall } = makeAdapter({ BAPI_USER_GET_DETAIL: DETAIL_RESULT });
    const result = await adapter.getUserDetail('alice');
    // Input should be uppercased
    expect(mockCall).toHaveBeenCalledWith('BAPI_USER_GET_DETAIL', { USERNAME: 'ALICE' });
    expect(result).toMatchObject({
      username:    'ALICE',
      firstName:   'Alice',
      lastName:    'Smith',
      fullName:    'Alice Smith',
      email:       'alice@test.com',
      userType:    'A',
      userGroup:   'GRP1',
      isLocked:    false,
      roleCount:   2,
      profileCount: 1,
      lastChanged:  '20261001',
      lastChangedBy: 'ADMIN',
    });
  });

  test('isLocked is true when GLOB_LOCK is L', async () => {
    const { adapter } = makeAdapter({
      BAPI_USER_GET_DETAIL: {
        ...DETAIL_RESULT,
        ISLOCKED: { WRNG_LOGON: 'U', NO_USER_PW: 'U', GLOB_LOCK: 'L', LOCAL_LOCK: 'U' },
      },
    });
    const result = await adapter.getUserDetail('ALICE');
    expect(result.isLocked).toBe(true);
    expect(result.lockedGlobal).toBe('L');
  });

  test('isLocked is true when WRNG_LOGON is X', async () => {
    const { adapter } = makeAdapter({
      BAPI_USER_GET_DETAIL: {
        ...DETAIL_RESULT,
        ISLOCKED: { WRNG_LOGON: 'X', NO_USER_PW: 'U', GLOB_LOCK: 'U', LOCAL_LOCK: 'U' },
      },
    });
    const result = await adapter.getUserDetail('ALICE');
    expect(result.isLocked).toBe(true);
  });

  test('throws 400 when username is empty', async () => {
    const { adapter } = makeAdapter({});
    await expect(adapter.getUserDetail('')).rejects.toMatchObject({ status: 400 });
    await expect(adapter.getUserDetail('   ')).rejects.toMatchObject({ status: 400 });
  });

  test('throws 404 on SAP user-not-found RETURN message', async () => {
    const { adapter } = makeAdapter({
      BAPI_USER_GET_DETAIL: {
        ...DETAIL_RESULT,
        RETURN: [{ TYPE: 'E', ID: 'SU', NUMBER: '121', MESSAGE: 'User NOBODY does not exist' }],
      },
    });
    await expect(adapter.getUserDetail('NOBODY')).rejects.toMatchObject({ status: 404 });
  });

  test('throws 502 when RFC call fails', async () => {
    const rfcClient = { call: jest.fn().mockRejectedValue(new Error('RFC timeout')) };
    const adapter = new UserManagementAdapter({ rfcClient });
    await expect(adapter.getUserDetail('ALICE')).rejects.toMatchObject({ status: 502 });
  });

  test('throws 502 on SAP error in RETURN', async () => {
    const { adapter } = makeAdapter({
      BAPI_USER_GET_DETAIL: {
        ...DETAIL_RESULT,
        RETURN: [{ TYPE: 'E', ID: 'SU', NUMBER: '999', MESSAGE: 'Backend error' }],
      },
    });
    await expect(adapter.getUserDetail('ALICE')).rejects.toMatchObject({ status: 502 });
  });
});
