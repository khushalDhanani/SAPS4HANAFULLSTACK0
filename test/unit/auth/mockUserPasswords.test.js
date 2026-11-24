'use strict';

const { protectMockUsers } = require('../../../srv/auth/mockUserPasswords');
const mockedUsers = require('@sap/cds/lib/srv/middlewares/auth/mocked-users');

const ROLES = ['Admin', 'Viewer'];
const devAuth = (users) => ({ kind: 'mocked', users: { khushal: { roles: ROLES }, alice: false, '*': false, ...users } });

describe('Mocked users get a password outside the test profile', () => {
  test('CAP itself accepts any password for a mocked user without one (the gap this closes)', () => {
    const cap = mockedUsers({ users: { khushal: { roles: ROLES } } });
    expect(cap.verify('khushal', '').failed).toBeUndefined();
    expect(cap.verify('khushal', 'anything').failed).toBeUndefined();
  });

  test('with LOCAL_DEV_PASSWORD set, CAP accepts only that password', () => {
    const auth = devAuth();
    const result = protectMockUsers({ NODE_ENV: 'development', LOCAL_DEV_PASSWORD: ' local-pass ' }, auth);

    expect(result).toEqual({ applied: true, source: 'LOCAL_DEV_PASSWORD', users: 1 });
    expect(auth.users.khushal.roles).toEqual(ROLES);
    const cap = mockedUsers(auth);
    expect(cap.verify('khushal', '').failed).toMatch(/Wrong password/);
    expect(cap.verify('khushal', 'khushal').failed).toMatch(/Wrong password/);
    expect(cap.verify('khushal', 'local-pass').failed).toBeUndefined();
  });

  test.each([
    ['not set', {}, 'LOCAL_DEV_PASSWORD is not set'],
    ['blank', { LOCAL_DEV_PASSWORD: '   ' }, 'LOCAL_DEV_PASSWORD is not set'],
    ['holding a colon', { LOCAL_DEV_PASSWORD: 'a:b' }, 'LOCAL_DEV_PASSWORD contains a colon']
  ])('with LOCAL_DEV_PASSWORD %s, no password signs a mocked user in', (_name, env, reason) => {
    const auth = devAuth();
    const result = protectMockUsers({ NODE_ENV: 'development', ...env }, auth);

    expect(result).toEqual({ applied: true, source: 'random', users: 1, reason });
    expect(auth.users.khushal.password).toMatch(/^[0-9a-f]{64}$/);
    const cap = mockedUsers(auth);
    for (const guess of ['', 'khushal', 'a', 'a:b', 'undefined']) expect(cap.verify('khushal', guess).failed).toMatch(/Wrong password/);
  });

  test('the random password differs on every start', () => {
    const a = devAuth(); const b = devAuth();
    protectMockUsers({ NODE_ENV: 'development' }, a);
    protectMockUsers({ NODE_ENV: 'development' }, b);
    expect(a.users.khushal.password).not.toBe(b.users.khushal.password);
  });

  test('covers users added at startup and `true` entries, keeps an existing password, and switches the wildcard off', () => {
    const auth = devAuth({ S4USER: { roles: ROLES }, s4user: { roles: ROLES }, flag: true, own: { password: 'kept' }, text: 'kept-too', '*': true });
    const result = protectMockUsers({ NODE_ENV: 'development', LOCAL_DEV_PASSWORD: 'local-pass' }, auth);

    expect(result.users).toBe(4);
    expect(auth.users.S4USER.password).toBe('local-pass');
    expect(auth.users.s4user.password).toBe('local-pass');
    expect(auth.users.flag).toEqual({ password: 'local-pass' });
    expect(auth.users.own.password).toBe('kept');
    expect(auth.users.text).toBe('kept-too');
    expect(auth.users.alice).toBe(false);
    expect(auth.users['*']).toBe(false);
    expect(mockedUsers(auth).verify('nobody', '').failed).toMatch(/not found/);
  });

  test.each([
    ['unset', {}],
    ['empty', { NODE_ENV: '' }],
    ['qa', { NODE_ENV: 'qa' }],
    ['staging', { NODE_ENV: 'staging' }],
    ['production', { NODE_ENV: 'production' }],
    ['Development (not the exact value)', { NODE_ENV: 'Development' }],
    ['test with SAP connectivity', { NODE_ENV: 'test', S4_DESTINATION_URL: 'https://sap.example.test:44300' }],
    ['test in the Docker cap-local role', { NODE_ENV: 'test', APP_ROLE: 'cap-local' }]
  ])('outside NODE_ENV=development (%s) LOCAL_DEV_PASSWORD is not a Basic password', (_name, env) => {
    const auth = devAuth();
    const result = protectMockUsers({ ...env, LOCAL_DEV_PASSWORD: 'local-pass' }, auth);

    expect(result).toEqual({
      applied: true, source: 'random', users: 1,
      reason: 'LOCAL_DEV_PASSWORD is used for Basic authentication only when NODE_ENV=development'
    });
    const cap = mockedUsers(auth);
    for (const guess of ['local-pass', '', 'khushal']) expect(cap.verify('khushal', guess).failed).toMatch(/Wrong password/);
  });

  test('applies when NODE_ENV is unset or anything other than test', () => {
    for (const NODE_ENV of [undefined, '', 'development', 'qa', 'production']) {
      expect(protectMockUsers({ NODE_ENV, LOCAL_DEV_PASSWORD: 'p' }, devAuth()).applied).toBe(true);
    }
  });

  test.each([
    ['S4_DESTINATION_URL is set', { S4_DESTINATION_URL: 'https://sap.example.test:44300' }],
    ['a service binding is present', { VCAP_SERVICES: '{"destination":[{}]}' }],
    ['it is the Docker cap-local role', { APP_ROLE: 'cap-local' }]
  ])('a test-profile server is protected when %s', (_name, extra) => {
    const auth = devAuth();
    expect(protectMockUsers({ NODE_ENV: 'test', ...extra }, auth)).toMatchObject({ applied: true, source: 'random', users: 1 });
    expect(mockedUsers(auth).verify('khushal', '').failed).toMatch(/Wrong password/);
  });

  test('leaves the isolated test profile and non-mocked authentication untouched', () => {
    const testAuth = devAuth();
    expect(protectMockUsers({ NODE_ENV: 'test', LOCAL_DEV_PASSWORD: 'p' }, testAuth)).toEqual({ applied: false });
    expect(testAuth.users.khushal.password).toBeUndefined();

    const jwt = { kind: 'jwt', users: { khushal: { roles: ROLES } } };
    expect(protectMockUsers({ NODE_ENV: 'production' }, jwt)).toEqual({ applied: false });
    expect(jwt.users.khushal.password).toBeUndefined();

    expect(protectMockUsers({}, undefined)).toEqual({ applied: false });
    expect(protectMockUsers({}, { kind: 'mocked' })).toEqual({ applied: false });
  });
});
