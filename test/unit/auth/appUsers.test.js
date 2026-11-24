const {
    parseAppUserRoles,
    loadUsersFile,
    parseCsv,
    parseDefaultRoles,
    isAllowAnySapUser,
    resolveAppUser,
} = require('../../../srv/auth/appUsers');

describe('Unit: appUsers (who may sign in, and with which roles)', () => {
    const auth = { users: { khushal: { roles: ['Admin', 'Viewer'] }, alice: false, '*': false, noroles: {} } };

    // ── Existing tests (unchanged) ──────────────────────────────────────────

    it('allows a configured development user with its roles, ignoring case; Admin only with APP_ADMIN_USERS', () => {
        expect(resolveAppUser('KHUSHAL', auth, {})).toEqual(['Viewer']);
        expect(resolveAppUser('KHUSHAL', auth, { APP_ADMIN_USERS: 'other, Khushal' })).toEqual(['Viewer', 'Admin']);
    });

    describe('Admin comes from APP_ADMIN_USERS only', () => {
        const {
            applyAdminRule, isAdminUser, parseAdminUsers, holdsConfiguredAdmin, getExplicitAppUserRoles
        } = require('../../../srv/auth/appUsers');
        const fileWith = (content) => ({ readFileSync: () => JSON.stringify(content) });

        it('parses the list case-insensitively and ignores blanks', () => {
            expect([...parseAdminUsers({ APP_ADMIN_USERS: ' Boss , ,SECOND ' })]).toEqual(['boss', 'second']);
            expect(isAdminUser('BOSS', { APP_ADMIN_USERS: 'boss' })).toBe(true);
            expect(isAdminUser('boss', {})).toBe(false);
            expect(isAdminUser('', { APP_ADMIN_USERS: 'boss' })).toBe(false);
        });

        it('takes Admin out of any roles and adds it for a named user', () => {
            expect(applyAdminRule('jsmith', ['Admin', 'Viewer', 'Viewer'], {})).toEqual(['Viewer']);
            expect(applyAdminRule('JSMITH', ['Viewer'], { APP_ADMIN_USERS: 'jsmith' })).toEqual(['Viewer', 'Admin']);
            expect(applyAdminRule('jsmith', [], { APP_ADMIN_USERS: 'jsmith' })).toEqual(['Admin']);
        });

        it('a user left without a role gets APP_DEFAULT_ROLES, never Admin', () => {
            expect(applyAdminRule('jsmith', ['Admin'], {})).toEqual(['Viewer']);
            expect(applyAdminRule('jsmith', ['Admin'], { APP_DEFAULT_ROLES: 'SalesRepresentative' })).toEqual(['SalesRepresentative']);
            expect(applyAdminRule('jsmith', ['Admin'], { APP_DEFAULT_ROLES: 'Admin' })).toEqual(['Viewer']);
        });

        it('an Admin entry in APP_USER_ROLES or APP_USERS_FILE grants nothing without APP_ADMIN_USERS', () => {
            const env = { APP_USER_ROLES: '{"MADMIN":["Admin","Viewer"],"ONLYADMIN":["Admin"]}', APP_USERS_FILE: '/fake/users.json' };
            const fsImpl = fileWith({ FADMIN: ['Admin', 'SalesManager'] });

            expect(resolveAppUser('madmin', auth, env, fsImpl)).toEqual(['Viewer']);
            expect(resolveAppUser('onlyadmin', auth, env, fsImpl)).toEqual(['Viewer']);
            expect(resolveAppUser('fadmin', auth, env, fsImpl)).toEqual(['SalesManager']);
            expect(getExplicitAppUserRoles('madmin', env, fsImpl)).toEqual(['Viewer']);
            expect(getExplicitAppUserRoles('fadmin', env, fsImpl)).toEqual(['SalesManager']);

            const withAdmins = { ...env, APP_ADMIN_USERS: 'madmin,fadmin' };
            expect(resolveAppUser('madmin', auth, withAdmins, fsImpl)).toEqual(['Viewer', 'Admin']);
            expect(getExplicitAppUserRoles('fadmin', withAdmins, fsImpl)).toEqual(['SalesManager', 'Admin']);
        });

        it('a user named only in APP_ADMIN_USERS is known, and has no override entry', () => {
            const env = { APP_ADMIN_USERS: 'boss' };
            expect(resolveAppUser('BOSS', auth, env)).toEqual(['Admin']);
            expect(getExplicitAppUserRoles('boss', env)).toBeNull();
            expect(resolveAppUser('stranger', auth, env)).toBeNull();
        });

        it('holdsConfiguredAdmin sees an administrator in every source, also where the entry grants nothing', () => {
            const env = { APP_USER_ROLES: '{"MADMIN":["Admin"],"CLERK":["Viewer"]}', APP_USERS_FILE: '/fake/users.json', APP_ADMIN_USERS: 'boss' };
            const fsImpl = fileWith({ FADMIN: ['Admin'] });
            for (const name of ['khushal', 'MADMIN', 'fadmin', 'Boss']) expect(holdsConfiguredAdmin(name, auth, env, fsImpl)).toBe(true);
            for (const name of ['clerk', 'stranger', '']) expect(holdsConfiguredAdmin(name, auth, env, fsImpl)).toBe(false);
        });
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
        expect(resolveAppUser('khushal', auth, env)).toEqual(['Viewer']);
    });

    // ── APP_USERS_FILE — JSON format ────────────────────────────────────────

    describe('APP_USERS_FILE (JSON)', () => {
        const makeFs = (content) => ({ readFileSync: () => content });

        it('loads a JSON file and resolves a listed user', () => {
            const fsImpl = makeFs('{"JSMITH":["Viewer","SalesManager"],"ACLARKE":["PurchasingManager"]}');
            const env = { APP_USERS_FILE: '/fake/users.json' };
            expect(resolveAppUser('jsmith', {}, env, fsImpl)).toEqual(['Viewer', 'SalesManager']);
            expect(resolveAppUser('ACLARKE', {}, env, fsImpl)).toEqual(['PurchasingManager']);
        });

        it('returns null for a user not in the file', () => {
            const fsImpl = makeFs('{"JSMITH":["Viewer"]}');
            const env = { APP_USERS_FILE: '/fake/users.json' };
            expect(resolveAppUser('stranger', {}, env, fsImpl)).toBeNull();
        });

        it('falls back to ["Viewer"] for an empty roles array in the file', () => {
            const fsImpl = makeFs('{"NOROLESUSER":[]}');
            const env = { APP_USERS_FILE: '/fake/users.json' };
            const result = loadUsersFile(env, fsImpl).get('norolesuser');
            expect(result).toEqual(['Viewer']);
        });

        it('throws on invalid JSON in the file', () => {
            const fsImpl = makeFs('{bad json}');
            expect(() => loadUsersFile({ APP_USERS_FILE: '/fake/users.json' }, fsImpl)).toThrow(/invalid JSON/);
        });

        it('throws on unknown role in the file', () => {
            const fsImpl = makeFs('{"USER":["SuperAdmin"]}');
            expect(() => loadUsersFile({ APP_USERS_FILE: '/fake/users.json' }, fsImpl)).toThrow(/unknown role/);
        });

        it('throws when the file cannot be read', () => {
            const fsImpl = { readFileSync: () => { throw new Error('ENOENT'); } };
            expect(() => loadUsersFile({ APP_USERS_FILE: '/nonexistent.json' }, fsImpl)).toThrow(/could not be read/);
        });

        it('returns empty map when APP_USERS_FILE is not set', () => {
            expect(loadUsersFile({})).toEqual(new Map());
        });
    });

    // ── APP_USERS_FILE — CSV format ─────────────────────────────────────────

    describe('parseCsv', () => {
        it('parses a simple CSV with quoted multi-role cell', () => {
            const result = parseCsv('username,roles\nJSMITH,"Viewer,SalesManager"\nACLARKE,PurchasingManager\n');
            expect(result.get('jsmith')).toEqual(['Viewer', 'SalesManager']);
            expect(result.get('aclarke')).toEqual(['PurchasingManager']);
        });

        it('skips comment lines', () => {
            const result = parseCsv('username,roles\n# a comment\nJSMITH,Viewer\n');
            expect(result.size).toBe(1);
        });

        it('skips comment and blank lines before the header, as in config/users.csv.example', () => {
            const result = parseCsv('# template\n#\n\nusername,roles\nJSMITH,Viewer\n');
            expect(result.get('jsmith')).toEqual(['Viewer']);

            const example = require('fs').readFileSync(require('path').resolve(__dirname, '../../../config/users.csv.example'), 'utf8');
            const shipped = parseCsv(example);
            expect(shipped.size).toBe(6);
            expect(shipped.get('bwilson')).toEqual(['WarehouseClerk', 'WarehouseManager']);
        });

        it('names the line of the file in an error, counting comment and blank lines', () => {
            expect(() => parseCsv('# template\n\nusername,roles\nJSMITH,Viewer\nACLARKE,SuperAdmin')).toThrow(/line 5/);
        });

        it('skips rows without a comma (no roles column)', () => {
            const result = parseCsv('username,roles\nJSMITH\nACLARKE,Viewer\n');
            expect(result.size).toBe(1);
            expect(result.get('aclarke')).toEqual(['Viewer']);
        });

        it('throws when header row does not start with username', () => {
            expect(() => parseCsv('user,role\nJSMITH,Viewer')).toThrow(/header/);
        });

        it('throws on unknown role in CSV', () => {
            expect(() => parseCsv('username,roles\nJSMITH,SuperAdmin')).toThrow(/unknown role/);
        });

        it('throws on invalid user name in CSV', () => {
            expect(() => parseCsv('username,roles\nbad user!,Viewer')).toThrow(/invalid user name/);
        });

        it('deduplicates roles', () => {
            const result = parseCsv('username,roles\nJSMITH,"Viewer,Viewer,SalesManager"\n');
            expect(result.get('jsmith')).toEqual(['Viewer', 'SalesManager']);
        });

        it('handles Windows CRLF line endings', () => {
            const result = parseCsv('username,roles\r\nJSMITH,Viewer\r\nACLARKE,PurchasingManager\r\n');
            expect(result.size).toBe(2);
        });
    });

    // ── APP_USERS_FILE — CSV via loadUsersFile ──────────────────────────────

    it('loadUsersFile detects CSV by absence of leading {', () => {
        const fsImpl = { readFileSync: () => 'username,roles\nJSMITH,Viewer\n' };
        const result = loadUsersFile({ APP_USERS_FILE: '/fake/users.csv' }, fsImpl);
        expect(result.get('jsmith')).toEqual(['Viewer']);
    });

    // ── Source priority: APP_USER_ROLES > APP_USERS_FILE > cds.auth.users ──

    it('APP_USER_ROLES wins over APP_USERS_FILE for the same user', () => {
        const fsImpl = { readFileSync: () => '{"JSMITH":["WarehouseClerk"]}' };
        const env = { APP_USER_ROLES: '{"JSMITH":["SalesManager"]}', APP_USERS_FILE: '/fake/users.json' };
        expect(resolveAppUser('jsmith', {}, env, fsImpl)).toEqual(['SalesManager']);
    });

    it('APP_USERS_FILE wins over cds.auth.users for the same user', () => {
        const fsImpl = { readFileSync: () => '{"KHUSHAL":["Viewer"]}' };
        const env = { APP_USERS_FILE: '/fake/users.json' };
        // auth has khushal with Admin+Viewer; file has only Viewer
        expect(resolveAppUser('khushal', auth, env, fsImpl)).toEqual(['Viewer']);
    });

    it('falls through to cds.auth.users when user is absent from both env and file', () => {
        const fsImpl = { readFileSync: () => '{"OTHER":["Viewer"]}' };
        const env = { APP_USERS_FILE: '/fake/users.json' };
        expect(resolveAppUser('khushal', auth, env, fsImpl)).toEqual(['Viewer']);
    });

    // ── parseDefaultRoles ───────────────────────────────────────────────────

    describe('a users file that breaks after startup', () => {
        const LOG = require('../../../srv/common/logger')('auth');
        const { getExplicitAppUserRoles } = require('../../../srv/auth/appUsers');
        const env = { APP_USERS_FILE: '/run/app-users.json' };
        const good = { readFileSync: () => '{"JSMITH":["Viewer"]}' };
        const broken = { readFileSync: () => '{"JSMITH":["Viewer"' };

        afterEach(() => jest.restoreAllMocks());

        it('allows nobody from it and logs the reason once, not on every request', () => {
            resolveAppUser('JSMITH', auth, env, good); // a readable file clears an earlier fault
            const error = jest.spyOn(LOG, 'error').mockImplementation(() => {});

            expect(resolveAppUser('JSMITH', auth, env, broken)).toBeNull();
            expect(getExplicitAppUserRoles('JSMITH', env, broken)).toBeNull();
            expect(resolveAppUser('KHUSHAL', auth, env, broken)).toEqual(['Viewer']);

            expect(error).toHaveBeenCalledTimes(1);
            expect(error).toHaveBeenCalledWith(expect.stringContaining('invalid JSON'));
            expect(error).toHaveBeenCalledWith(expect.stringContaining('Nobody listed in the file can sign in'));
        });

        it('logs again when the file was readable in between', () => {
            const error = jest.spyOn(LOG, 'error').mockImplementation(() => {});
            resolveAppUser('JSMITH', auth, env, broken);
            expect(resolveAppUser('JSMITH', auth, env, good)).toEqual(['Viewer']);
            resolveAppUser('JSMITH', auth, env, broken);
            expect(error.mock.calls.length).toBeGreaterThanOrEqual(1);
            expect(error).toHaveBeenLastCalledWith(expect.stringContaining('invalid JSON'));
        });
    });

    describe('parseDefaultRoles', () => {
        it('returns ["Viewer"] when APP_DEFAULT_ROLES is unset', () => {
            expect(parseDefaultRoles({})).toEqual(['Viewer']);
        });

        it('parses a comma-separated list of valid roles', () => {
            expect(parseDefaultRoles({ APP_DEFAULT_ROLES: 'Viewer,SalesManager' }))
                .toEqual(['Viewer', 'SalesManager']);
        });

        it('throws when Admin is included', () => {
            expect(() => parseDefaultRoles({ APP_DEFAULT_ROLES: 'Admin' })).toThrow(/Admin/);
        });

        it('throws on an unknown role', () => {
            expect(() => parseDefaultRoles({ APP_DEFAULT_ROLES: 'SuperUser' })).toThrow(/unknown role/);
        });
    });

    // ── isAllowAnySapUser ───────────────────────────────────────────────────

    describe('isAllowAnySapUser', () => {
        it('returns false when unset', () => {
            expect(isAllowAnySapUser({})).toBe(false);
        });

        it.each(['true', 'TRUE', 'True'])('returns true for %s', (val) => {
            expect(isAllowAnySapUser({ APP_ALLOW_ANY_SAP_USER: val })).toBe(true);
        });

        it.each(['false', '1', 'yes', ''])('returns false for %s', (val) => {
            expect(isAllowAnySapUser({ APP_ALLOW_ANY_SAP_USER: val })).toBe(false);
        });
    });
});
