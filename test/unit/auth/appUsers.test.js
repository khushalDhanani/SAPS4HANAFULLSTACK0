const { parseAppUserRoles, resolveAppUser } = require('../../../srv/auth/appUsers');

describe('Unit: appUsers (who may sign in, and with which roles)', () => {
    const auth = { users: { khushal: { roles: ['Admin', 'Viewer'] }, alice: false, '*': false, noroles: {} } };

    it('allows a configured development user with its roles, ignoring case', () => {
        expect(resolveAppUser('KHUSHAL', auth, {})).toEqual(['Admin', 'Viewer']);
    });

    it('refuses switched-off, wildcard, role-less and unknown users', () => {
        for (const name of ['alice', '*', 'noroles', 'stranger', '']) {
            expect(resolveAppUser(name, auth, {})).toBeNull();
        }
    });

    it('allows a user listed in APP_USER_ROLES with exactly the listed roles', () => {
        const env = { APP_USER_ROLES: '{"JSmith":["Viewer","SalesManager"],"clerk":[]}' };
        expect(resolveAppUser('jsmith', auth, env)).toEqual(['Viewer', 'SalesManager']);
        expect(resolveAppUser('CLERK', auth, env)).toEqual(['Viewer']);
        expect(resolveAppUser('other', auth, env)).toBeNull();
    });

    it.each([
        ['not json', /not valid JSON/],
        ['["a"]', /JSON object/],
        ['{"a":"Viewer"}', /must be a list/],
        ['{"a":["SuperUser"]}', /must be a list/],
        ['{"bad name!":["Viewer"]}', /invalid user name/]
    ])('rejects a malformed list %s at startup', (value, message) => {
        expect(() => parseAppUserRoles({ APP_USER_ROLES: value })).toThrow(message);
    });

    it('a malformed list allows nobody from it, while configured users still work', () => {
        const env = { APP_USER_ROLES: '{"a":["SuperUser"]}' };
        expect(resolveAppUser('a', auth, env)).toBeNull();
        expect(resolveAppUser('khushal', auth, env)).toEqual(['Admin', 'Viewer']);
    });
});
