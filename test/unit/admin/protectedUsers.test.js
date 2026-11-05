'use strict';

const { PROTECTED_USER_TYPES, protectionReason } = require('../../../srv/admin/protectedUsers');

describe('protectionReason', () => {
  const context = { actor: 'khushal', connectionUser: 'RFC_USER' };

  test('protects System and Service types by default', () => {
    expect(PROTECTED_USER_TYPES).toEqual(['B', 'S']);
    expect(protectionReason({ username: 'A', userType: 'B' }, context)).toBe('type');
    expect(protectionReason({ username: 'A', userType: 's' }, context)).toBe('type');
  });

  test.each(['A', 'C', 'L', '', undefined, null])('does not protect a user of type %s', (userType) => {
    expect(protectionReason({ username: 'ALICE', userType }, context)).toBe('');
  });

  test('protects the logged-in user in any case, ahead of the type', () => {
    expect(protectionReason({ username: 'KHUSHAL', userType: 'S' }, context)).toBe('self');
  });

  test('protects the RFC connection user', () => {
    expect(protectionReason({ username: 'rfc_user', userType: 'A' }, context)).toBe('connection');
  });

  test('an empty name never matches a missing actor or connection user', () => {
    expect(protectionReason({ username: '', userType: 'A' }, {})).toBe('');
    expect(protectionReason({ userType: 'A' })).toBe('');
  });
});
