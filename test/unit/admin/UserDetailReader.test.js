'use strict';

// Mocks only: `call` stands in for the RFC connection. No SAP system is contacted.
const NOTICE = { TYPE: 'E', ID: 'SUID01', NUMBER: '313', MESSAGE: 'No authorization to display the global user ID for users' };
const answer = (extra = {}) => ({
  RETURN: [],
  ADDRESS: { FIRSTNAME: 'Jane', LASTNAME: 'Smith', FULLNAME: 'Jane Smith', E_MAIL: 'jane.smith@example.test' },
  LOGONDATA: { USTYP: 'A', CLASS: 'SALES', GLTGB: '99991231' },
  ISLOCKED: { WRNG_LOGON: 'U', NO_USER_PW: 'U', GLOB_LOCK: 'U', LOCAL_LOCK: 'U' },
  ACTIVITYGROUPS: [{ AGR_NAME: 'ZAPP_SALESMANAGER', AGR_TEXT: 'Sales manager' }, { AGR_NAME: 'SAP_BC_ENDUSER' }],
  PROFILES: [{ BAPIPROF: 'T-12345678' }],
  ...extra
});

describe('Unit: UserDetailReader.readUserDetail (BAPI_USER_GET_DETAIL)', () => {
  let reader;
  let LOG;
  let warn;

  beforeEach(() => {
    jest.resetModules(); // a fresh once-a-minute log state for every test
    reader = require('../../../srv/integration/s4hana/admin/UserDetailReader');
    LOG = require('../../../srv/common/logger')('user-management-adapter');
    warn = jest.spyOn(LOG, 'warn').mockImplementation(() => {});
    jest.spyOn(LOG, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  const callWith = (res) => jest.fn().mockResolvedValue(res);

  it('returns the mapped user for a clean answer', async () => {
    const call = callWith(answer());
    const detail = await reader.readUserDetail(call, 'JSMITH');
    expect(call).toHaveBeenCalledWith('BAPI_USER_GET_DETAIL', { USERNAME: 'JSMITH' });
    expect(detail).toMatchObject({ username: 'JSMITH', fullName: 'Jane Smith', userType: 'A', userGroup: 'SALES', roleCount: 2, isLocked: false });
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps the user data when SAP adds SUID01/313 (no authorization for the global user ID)', async () => {
    const detail = await reader.readUserDetail(callWith(answer({ RETURN: [NOTICE] })), 'JSMITH');
    expect(detail.fullName).toBe('Jane Smith');
    expect(detail.roles.map((r) => r.name)).toEqual(['ZAPP_SALESMANAGER', 'SAP_BC_ENDUSER']);
    expect(detail.profileCount).toBe(1);
  });

  it('logs the notice once for a whole user list, and never a user name or password', async () => {
    for (let i = 0; i < 279; i++) await reader.readUserDetail(callWith(answer({ RETURN: [NOTICE] })), `USER${i}`);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('SUID01/313'));
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/USER\d|passw/i);
  });

  it('still fails when SUID01/313 comes without any user data', async () => {
    const empty = { RETURN: [NOTICE], ADDRESS: { FULLNAME: ' ' }, LOGONDATA: {}, ACTIVITYGROUPS: [], PROFILES: [] };
    await expect(reader.readUserDetail(callWith(empty), 'JSMITH')).rejects.toMatchObject({
      status: 502, message: 'SAP error: No authorization to display the global user ID for users'
    });
    await expect(reader.readUserDetail(callWith({ RETURN: [NOTICE] }), 'JSMITH')).rejects.toMatchObject({ status: 502 });
  });

  it('still fails on any other error, also next to SUID01/313', async () => {
    const notAuthorized = { TYPE: 'E', ID: '01', NUMBER: '512', MESSAGE: 'You are not authorized to display users' };
    await expect(reader.readUserDetail(callWith(answer({ RETURN: [notAuthorized] })), 'JSMITH')).rejects.toMatchObject({
      status: 502, message: 'SAP error: You are not authorized to display users'
    });
    await expect(reader.readUserDetail(callWith(answer({ RETURN: [NOTICE, notAuthorized] })), 'JSMITH')).rejects.toMatchObject({ status: 502 });
    await expect(reader.readUserDetail(callWith(answer({ RETURN: [{ TYPE: 'A', ID: '00', NUMBER: '001', MESSAGE: 'Abort' }] })), 'JSMITH')).rejects.toMatchObject({ status: 502 });
  });

  it('matches the notice by message class and number, not by its text', async () => {
    const sameText = { ...NOTICE, ID: '01', NUMBER: '999' };
    const sameNumberOtherClass = { ...NOTICE, ID: 'ZZ' };
    await expect(reader.readUserDetail(callWith(answer({ RETURN: [sameText] })), 'JSMITH')).rejects.toMatchObject({ status: 502 });
    await expect(reader.readUserDetail(callWith(answer({ RETURN: [sameNumberOtherClass] })), 'JSMITH')).rejects.toMatchObject({ status: 502 });
    const otherText = { ...NOTICE, MESSAGE: 'Keine Berechtigung zum Anzeigen der globalen Benutzer-ID' };
    await expect(reader.readUserDetail(callWith(answer({ RETURN: [otherText] })), 'JSMITH')).resolves.toMatchObject({ username: 'JSMITH' });
    expect(reader.isGlobalUserIdNotice({ ID: ' SUID01 ', NUMBER: '313' })).toBe(true);
    expect(reader.isGlobalUserIdNotice({ ID: 'SUID01', NUMBER: '311' })).toBe(false);
  });

  it('reports an unknown user as 404 and a failed call as 502, as before', async () => {
    await expect(reader.readUserDetail(callWith({ RETURN: [{ TYPE: 'E', ID: '01', NUMBER: '121', MESSAGE: 'User X does not exist' }] }), 'X')).rejects.toMatchObject({ status: 404 });
    await expect(reader.readUserDetail(jest.fn().mockRejectedValue(new Error('RFC_TIMEOUT')), 'JSMITH')).rejects.toMatchObject({
      status: 502, message: 'Failed to retrieve user detail from SAP'
    });
  });

  it('gives the sign-in role lookup the SAP roles again when SAP adds SUID01/313', async () => {
    const { fetchAndMapRoles } = require('../../../srv/auth/sapRoleMapper');
    const authLog = require('../../../srv/common/logger')('auth');
    jest.spyOn(authLog, 'warn').mockImplementation(() => {});
    jest.spyOn(authLog, 'info').mockImplementation(() => {});
    const call = callWith(answer({ RETURN: [NOTICE] }));
    const noRoleMap = { readFileSync: () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); } };

    const roles = await fetchAndMapRoles('JSMITH', (username) => reader.readUserDetail(call, username), {}, '/fake/role-map.json', noRoleMap);
    expect(roles).toEqual(['SalesManager']);
  });
});
