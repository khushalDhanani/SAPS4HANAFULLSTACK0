'use strict';

/**
 * Unit tests for UserManagementAdapter (Phase 1 — read-only)
 * All RFC calls are mocked; no live SAP connection.
 */

const { UserManagementAdapter } = require('../../../srv/integration/s4hana/admin/UserManagementAdapter');
const { RfcClient } = require('../../../srv/integration/s4hana/RfcClient');

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
  const mockCall = makeRfcCallMock({ BAPI_USER_GET_DETAIL: DETAIL_RESULT, ...rfcCallResult });
  const rfcClient = {
    call: mockCall,
    session: jest.fn().mockImplementation((fn) => fn(mockCall)),
    resolveConnectionParams: jest.fn().mockResolvedValue({ user: 'CONNECTED_ADMIN' })
  };
  const adapter = new UserManagementAdapter({ rfcClient });
  return { adapter, mockCall, rfcClient };
}

// ── listUsers ────────────────────────────────────────────────────────────────

describe('UserManagementAdapter.listUsers', () => {
  test('returns mapped list from BAPI_USER_GETLIST', async () => {
    const { adapter } = makeAdapter({ BAPI_USER_GETLIST: GETLIST_RESULT });
    const result = await adapter.listUsers();
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({
      username: 'ALICE',
      firstName: 'Alice',
      lastName: 'Smith',
      fullName: 'Alice Smith',
      detailsAvailable: true,
      isLocked: false,
      userType: 'A',
      validFrom: '00000000',
      validTo: '00000000',
      lastChanged: '20261001',
      lastChangedBy: 'ADMIN'
    });
    expect(result[1]).toMatchObject({ username: 'BOB', fullName: 'Bob Jones', detailsAvailable: true });
  });

  test('passes MAX_ROWS to RFC call', async () => {
    const { adapter, mockCall } = makeAdapter({ BAPI_USER_GETLIST: GETLIST_RESULT });
    await adapter.listUsers({ maxRows: 50 });
    expect(mockCall).toHaveBeenCalledWith('BAPI_USER_GETLIST', { MAX_ROWS: 50 });
    expect(mockCall).toHaveBeenCalledWith('BAPI_USER_GET_DETAIL', { USERNAME: 'ALICE' });
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

  test('keeps a row visible but marks its detail unavailable when SAP rejects that user detail read', async () => {
    const mockCall = jest.fn().mockImplementation(async (fm, params) => {
      if (fm === 'BAPI_USER_GETLIST') return GETLIST_RESULT;
      if (fm === 'BAPI_USER_GET_DETAIL' && params.USERNAME === 'BOB') {
        return {
          ...DETAIL_RESULT,
          RETURN: [{ TYPE: 'E', ID: 'SU', NUMBER: '001', MESSAGE: 'Not authorized' }]
        };
      }
      return DETAIL_RESULT;
    });
    const rfcClient = {
      session: jest.fn().mockImplementation((fn) => fn(mockCall))
    };
    const adapter = new UserManagementAdapter({ rfcClient });

    const result = await adapter.listUsers();

    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ username: 'ALICE', detailsAvailable: true, isLocked: false });
    expect(result[1]).toMatchObject({
      username: 'BOB',
      detailsAvailable: false,
      isLocked: null,
      userType: null,
      validFrom: null,
      validTo: null,
      lastChanged: null,
      lastChangedBy: null
    });
    expect(mockCall).toHaveBeenCalledTimes(4);
  });

  test('throws 502 when RFC call fails', async () => {
    const rfcClient = {
      session: jest.fn().mockImplementation(() => Promise.reject(new Error('RFC_COMM_FAILURE')))
    };
    const adapter = new UserManagementAdapter({ rfcClient });
    await expect(adapter.listUsers()).rejects.toMatchObject({
      status: 502,
      message: 'Failed to retrieve user list from SAP'
    });
  });

  test('does not expose RFC session setup errors from the list endpoint', async () => {
    const rfcClient = {
      session: jest.fn().mockRejectedValue(Object.assign(new Error('RFC destination unavailable'), { status: 503 }))
    };
    const adapter = new UserManagementAdapter({ rfcClient });

    await expect(adapter.listUsers()).rejects.toMatchObject({
      status: 502,
      message: 'Failed to retrieve user list from SAP'
    });
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
    const mockCall = jest.fn().mockRejectedValue(new Error('RFC timeout'));
    const rfcClient = { session: jest.fn().mockImplementation((fn) => fn(mockCall)) };
    const adapter = new UserManagementAdapter({ rfcClient });
    await expect(adapter.getUserDetail('ALICE')).rejects.toMatchObject({ status: 502 });
  });

  test('does not expose RFC session setup errors from the detail endpoint', async () => {
    const rfcClient = {
      session: jest.fn().mockRejectedValue(Object.assign(new Error('RFC destination unavailable'), { status: 503 }))
    };
    const adapter = new UserManagementAdapter({ rfcClient });

    await expect(adapter.getUserDetail('ALICE')).rejects.toMatchObject({
      status: 502,
      message: 'Failed to retrieve user detail from SAP'
    });
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

// ── lockUser ──────────────────────────────────────────────────────────────────

describe('UserManagementAdapter.lockUser', () => {
  test('calls BAPI_USER_LOCK and BAPI_TRANSACTION_COMMIT in a single session', async () => {
    const { adapter, mockCall, rfcClient } = makeAdapter({
      BAPI_USER_LOCK: { RETURN: [] },
      BAPI_TRANSACTION_COMMIT: {},
    });
    const result = await adapter.lockUser('alice');
    expect(rfcClient.session).toHaveBeenCalled();
    expect(mockCall).toHaveBeenCalledWith('BAPI_USER_LOCK', { USERNAME: 'ALICE' });
    expect(mockCall).toHaveBeenCalledWith('BAPI_TRANSACTION_COMMIT', { WAIT: 'X' });
    expect(result).toEqual({
      success: true,
      message: "User 'ALICE' locked successfully in SAP",
      username: 'ALICE',
    });
  });

  test('throws 400 when username is empty', async () => {
    const { adapter } = makeAdapter({});
    await expect(adapter.lockUser('')).rejects.toMatchObject({ status: 400 });
  });

  test('refuses to lock the active RFC connection user (fail-closed self-lock guard)', async () => {
    const { adapter, mockCall } = makeAdapter({});
    await expect(adapter.lockUser('CONNECTED_ADMIN')).rejects.toMatchObject({
      status: 403,
      message: expect.stringContaining('active RFC connection user'),
    });
    expect(mockCall).not.toHaveBeenCalled();
  });

  test('throws 502 when BAPI_USER_LOCK returns error in RETURN', async () => {
    const { adapter } = makeAdapter({
      BAPI_USER_LOCK: {
        RETURN: [{ TYPE: 'E', ID: 'SU', NUMBER: '001', MESSAGE: 'Not authorized to lock users' }],
      },
    });
    await expect(adapter.lockUser('ALICE')).rejects.toMatchObject({
      status: 502,
      message: 'SAP error: Not authorized to lock users',
    });
  });

  test('throws 502 when RFC call fails', async () => {
    const mockCall = jest.fn().mockRejectedValue(new Error('RFC connection dropped'));
    const rfcClient = { session: jest.fn().mockImplementation((fn) => fn(mockCall)), resolveConnectionParams: jest.fn().mockResolvedValue({ user: 'CONNECTED_ADMIN' }) };
    const adapter = new UserManagementAdapter({ rfcClient });
    await expect(adapter.lockUser('ALICE')).rejects.toMatchObject({ status: 502 });
  });
});

// ── unlockUser ────────────────────────────────────────────────────────────────

describe('UserManagementAdapter.unlockUser', () => {
  test('calls BAPI_USER_UNLOCK and BAPI_TRANSACTION_COMMIT in a single session', async () => {
    const { adapter, mockCall, rfcClient } = makeAdapter({
      BAPI_USER_UNLOCK: { RETURN: [] },
      BAPI_TRANSACTION_COMMIT: {},
    });
    const result = await adapter.unlockUser('bob');
    expect(rfcClient.session).toHaveBeenCalled();
    expect(mockCall).toHaveBeenCalledWith('BAPI_USER_UNLOCK', { USERNAME: 'BOB' });
    expect(mockCall).toHaveBeenCalledWith('BAPI_TRANSACTION_COMMIT', { WAIT: 'X' });
    expect(result).toEqual({
      success: true,
      message: "User 'BOB' unlocked successfully in SAP",
      username: 'BOB',
    });
  });

  test('throws 400 when username is empty', async () => {
    const { adapter } = makeAdapter({});
    await expect(adapter.unlockUser('')).rejects.toMatchObject({ status: 400 });
  });

  test('throws 502 when BAPI_USER_UNLOCK returns error in RETURN', async () => {
    const { adapter } = makeAdapter({
      BAPI_USER_UNLOCK: {
        RETURN: [{ TYPE: 'E', ID: 'SU', NUMBER: '002', MESSAGE: 'User is not locked' }],
      },
    });
    await expect(adapter.unlockUser('BOB')).rejects.toMatchObject({
      status: 502,
      message: 'SAP error: User is not locked',
    });
  });

  test('throws 502 when RFC call fails', async () => {
    const mockCall = jest.fn().mockRejectedValue(new Error('RFC connection dropped'));
    const rfcClient = { session: jest.fn().mockImplementation((fn) => fn(mockCall)), resolveConnectionParams: jest.fn().mockResolvedValue({ user: 'CONNECTED_ADMIN' }) };
    const adapter = new UserManagementAdapter({ rfcClient });
    await expect(adapter.unlockUser('BOB')).rejects.toMatchObject({ status: 502 });
  });
});

// ── self-lock guard with the production connection ───────────────────────────

describe('UserManagementAdapter.lockUser self-lock guard with a real RfcClient', () => {
  // Only node-rfc and the Destination service are faked. Property names follow RFC_DESTINATION_PROPS in RfcClient.js; not proven against a live destination.
  function fakeNodeRfc() {
    const called = [];
    const noderfc = {
      Client: function Client() {
        return {
          open: async () => {},
          close: async () => {},
          call: async (fm) => { called.push(fm); return { RETURN: [] }; }
        };
      }
    };
    return { called, noderfc };
  }
  const destination = async () => ({
    originalProperties: { 'jco.client.ashost': 'sap.internal', 'jco.client.sysnr': '00', 'jco.client.client': '220', 'jco.client.user': 'TECH_USER', 'jco.client.passwd': 'x' }
  });

  test('refuses to lock the user the BTP destination connects with', async () => {
    const { called, noderfc } = fakeNodeRfc();
    const rfcClient = new RfcClient({ S4_RFC_DESTINATION_NAME: 'S4_RFC', NODE_ENV: 'production' }, () => noderfc, destination);
    const adapter = new UserManagementAdapter({ rfcClient });

    await expect(adapter.lockUser('tech_user')).rejects.toMatchObject({
      status: 403,
      message: "Cannot lock user 'TECH_USER': operation refused because it is the active RFC connection user"
    });
    expect(called).toEqual([]);
  });

  test('still locks another user through that destination', async () => {
    const { called, noderfc } = fakeNodeRfc();
    const rfcClient = new RfcClient({ S4_RFC_DESTINATION_NAME: 'S4_RFC', NODE_ENV: 'production' }, () => noderfc, destination);
    const adapter = new UserManagementAdapter({ rfcClient });

    await expect(adapter.lockUser('ALICE')).resolves.toMatchObject({ success: true, username: 'ALICE' });
    expect(called).toEqual(['BAPI_USER_LOCK', 'BAPI_TRANSACTION_COMMIT']);
  });

  test('refuses to lock the user a local connection logs on with', async () => {
    const { called, noderfc } = fakeNodeRfc();
    const env = { S4_DESTINATION_URL: 'https://sap.internal', S4_RFC_SYSNR: '00', S4_CLIENT: '220', S4_USERNAME: 'Local_User', S4_PASSWORD: 'x' };
    const adapter = new UserManagementAdapter({ rfcClient: new RfcClient(env, () => noderfc) });

    await expect(adapter.lockUser('LOCAL_USER')).rejects.toMatchObject({ status: 403 });
    expect(called).toEqual([]);
  });

  test('locks nothing when the connection user cannot be read', async () => {
    const { called, noderfc } = fakeNodeRfc();
    const unreachable = async () => { throw new Error('Destination service down'); };
    const rfcClient = new RfcClient({ S4_RFC_DESTINATION_NAME: 'S4_RFC', NODE_ENV: 'production' }, () => noderfc, unreachable);
    const adapter = new UserManagementAdapter({ rfcClient });

    await expect(adapter.lockUser('ALICE')).rejects.toMatchObject({ status: 503 });
    expect(called).toEqual([]);
  });
});
