const AuthServiceHandler = require('../../../srv/auth-service');
const authAdapter = require('../../../srv/integration/s4hana/AuthAdapter');
const loginThrottle = require('../../../srv/auth/loginThrottle');

describe('Unit: AuthService (CAP Authentication Handler)', () => {
    let service;
    const originalEnv = { ...process.env };

    beforeEach(() => {
        service = new AuthServiceHandler();
        loginThrottle.reset();
        delete process.env.APP_USER_ROLES;
        delete process.env.APP_USERS_FILE;
        delete process.env.APP_ALLOW_ANY_SAP_USER;
        delete process.env.APP_DEFAULT_ROLES;
        delete process.env.APP_ADMIN_USERS;
        delete process.env.ENABLE_DEV_TOKEN_ISSUER;
        delete process.env.LOCAL_AUTH_SECRET;
        delete process.env.S4_SYSTEM_NAME;
        delete process.env.S4_CLIENT;
        process.env.NODE_ENV = 'development';
    });

    afterEach(() => {
        process.env = { ...originalEnv };
        jest.restoreAllMocks();
    });

    describe('getUserInfo', () => {
        it('should return unauthenticated when req.user is null or anonymous', async () => {
            const res1 = await service._handleGetUserInfo({ user: null });
            expect(res1).toEqual(expect.objectContaining({
                authenticated: false,
                message: 'Unauthenticated'
            }));

            const res2 = await service._handleGetUserInfo({ user: { _is_anonymous: true } });
            expect(res2).toEqual(expect.objectContaining({
                authenticated: false,
                message: 'Unauthenticated'
            }));
        });

        it('should return authenticated user profile and mapped scopes for XSUAA user', async () => {
            const req = {
                user: {
                    id: 'CB9980000001',
                    _is_anonymous: false,
                    roles: ['PurchasingManager', 'Viewer'],
                    token: 'xsuaa.jwt.token'
                }
            };
            const res = await service._handleGetUserInfo(req);
            expect(res).toEqual(expect.objectContaining({
                authenticated: true,
                username: 'CB9980000001',
                avatarInitials: 'CB',
                token: 'xsuaa.jwt.token',
                scopes: ['$XSAPPNAME.PurchasingManager', '$XSAPPNAME.Viewer']
            }));
        });

        it('should handle role objects (e.g. from cds.User internal roles map)', async () => {
            const req = {
                user: {
                    id: 'jdoe',
                    attr: { logon_name: 'john.doe' },
                    _is_anonymous: false,
                    roles: { PurchasingManager: 1, Viewer: 1 }
                }
            };
            const res = await service._handleGetUserInfo(req);
            expect(res.authenticated).toBe(true);
            expect(res.username).toBe('john.doe');
            expect(res.avatarInitials).toBe('JO');
            expect(res.scopes).toEqual(expect.arrayContaining(['$XSAPPNAME.PurchasingManager', '$XSAPPNAME.Viewer']));
        });
    });

    describe('login (Custom Login Restrictions)', () => {
        it.each([
            ['khushal', 'local-password', true],
            ['khushal', 'wrong-password', false],
            ['another-user', 'local-password', false],
            ['khushal', 'sap-password', false]
        ])('isolated local login for %s authenticates=%s without SAP fallback', async (username, password, authenticated) => {
            process.env.APP_ROLE = 'cap-local';
            process.env.ENABLE_DEV_TOKEN_ISSUER = 'true';
            process.env.LOCAL_AUTH_SECRET = 'local-test-signing-secret-at-least-32-characters';
            process.env.LOCAL_DEV_PASSWORD = 'local-password';
            process.env.S4_PASSWORD = 'sap-password';
            const sap = jest.spyOn(authAdapter, 'validateCredentials').mockRejectedValue(new Error('SAP must not be called'));
            const result = await service._handleLogin({ data: { username, password } });
            expect(result.authenticated).toBe(authenticated);
            expect(sap).not.toHaveBeenCalled();
            if (authenticated) expect(result.token).toEqual(expect.any(String));
            else {
                expect(result.token).toBeUndefined();
                expect(result.message).toContain('Invalid local credentials');
            }
        });

        it('should reject with 403 in production environment', async () => {
            process.env.NODE_ENV = 'production';
            process.env.ENABLE_DEV_TOKEN_ISSUER = 'true';
            process.env.LOCAL_AUTH_SECRET = 'secret';

            const req = {
                data: { username: 'khushal', password: 'password' },
                error: jest.fn((status, msg) => {
                    const err = new Error(msg);
                    err.status = status;
                    throw err;
                })
            };

            await expect(service._handleLogin(req)).rejects.toThrow(/disabled in deployed environments/i);
            expect(req.error).toHaveBeenCalledWith(403, expect.stringContaining('SAP BTP XSUAA Single Sign-On'));
        });

        it('should reject with 403 when dev token issuer is not enabled', async () => {
            delete process.env.ENABLE_DEV_TOKEN_ISSUER;
            delete process.env.LOCAL_AUTH_SECRET;

            const req = {
                data: { username: 'khushal', password: 'password' },
                error: jest.fn((status, msg) => {
                    const err = new Error(msg);
                    err.status = status;
                    throw err;
                })
            };

            await expect(service._handleLogin(req)).rejects.toThrow(/disabled in deployed environments/i);
            expect(req.error).toHaveBeenCalledWith(403, expect.stringContaining('SAP BTP XSUAA Single Sign-On'));
        });

        it('should allow dev login for khushal with the local password and keep the configured roles', async () => {
            process.env.ENABLE_DEV_TOKEN_ISSUER = 'true';
            process.env.LOCAL_AUTH_SECRET = 'secret1234567890-padded-to-32-characters';
            process.env.LOCAL_DEV_PASSWORD = 'local-password';

            const req = {
                data: { username: 'khushal', password: 'local-password' }
            };

            const res = await service._handleLogin(req);
            expect(res.authenticated).toBe(true);
            expect(res.username).toBe('khushal');
            expect(res.token).toBeDefined();
            expect(typeof res.token).toBe('string');
            expect(res.scopes).toEqual(expect.arrayContaining(['$XSAPPNAME.PurchasingManager']));
        });

        it('compares the local password exactly, including upper and lower case', async () => {
            process.env.ENABLE_DEV_TOKEN_ISSUER = 'true';
            process.env.LOCAL_AUTH_SECRET = 'secret1234567890-padded-to-32-characters';
            process.env.LOCAL_DEV_PASSWORD = 'Local-Password';
            const validate = jest.spyOn(authAdapter, 'validateCredentials').mockResolvedValue({ authenticated: false });

            const wrongCase = await service._handleLogin({ data: { username: 'khushal', password: 'local-password' } });
            expect(wrongCase.authenticated).toBe(false);
            expect(validate).toHaveBeenCalledTimes(1);

            const exact = await service._handleLogin({ data: { username: 'khushal', password: 'Local-Password' } });
            expect(exact.authenticated).toBe(true);
        });

        it('allows a whitelisted second user to log in under cap-local with LOCAL_DEV_PASSWORD and grants configured roles', async () => {
            process.env.APP_ROLE = 'cap-local';
            process.env.ENABLE_DEV_TOKEN_ISSUER = 'true';
            process.env.LOCAL_AUTH_SECRET = 'secret1234567890-padded-to-32-characters';
            process.env.LOCAL_DEV_PASSWORD = 'local-password';
            process.env.APP_USER_ROLES = JSON.stringify({ jdoe: ['Viewer', 'SalesManager'] });
            const sap = jest.spyOn(authAdapter, 'validateCredentials').mockRejectedValue(new Error('SAP must not be called'));

            const res = await service._handleLogin({ data: { username: 'JDOE', password: 'local-password' } });

            expect(res.authenticated).toBe(true);
            expect(res.username).toBe('JDOE');
            expect(res.scopes).toEqual(expect.arrayContaining(['$XSAPPNAME.Viewer', '$XSAPPNAME.SalesManager']));
            expect(res.token).toEqual(expect.any(String));
            expect(sap).not.toHaveBeenCalled();
        });

        it('refuses a non-whitelisted user under cap-local even with LOCAL_DEV_PASSWORD', async () => {
            process.env.APP_ROLE = 'cap-local';
            process.env.ENABLE_DEV_TOKEN_ISSUER = 'true';
            process.env.LOCAL_AUTH_SECRET = 'secret1234567890-padded-to-32-characters';
            process.env.LOCAL_DEV_PASSWORD = 'local-password';
            process.env.APP_USER_ROLES = JSON.stringify({ jdoe: ['Viewer'] });
            const sap = jest.spyOn(authAdapter, 'validateCredentials').mockRejectedValue(new Error('SAP must not be called'));

            const res = await service._handleLogin({ data: { username: 'stranger', password: 'local-password' } });

            expect(res.authenticated).toBe(false);
            expect(res.token).toBeUndefined();
            expect(res.message).toContain('Invalid local credentials');
            expect(sap).not.toHaveBeenCalled();
        });

        it('locks out a cap-local user after three failed sign-in attempts', async () => {
            process.env.APP_ROLE = 'cap-local';
            process.env.ENABLE_DEV_TOKEN_ISSUER = 'true';
            process.env.LOCAL_AUTH_SECRET = 'secret1234567890-padded-to-32-characters';
            process.env.LOCAL_DEV_PASSWORD = 'local-password';
            process.env.APP_USER_ROLES = JSON.stringify({ jdoe: ['Viewer'] });

            const attempt = (password) => service._handleLogin({ data: { username: 'jdoe', password } });

            expect((await attempt('wrong-1')).authenticated).toBe(false);
            expect((await attempt('wrong-2')).authenticated).toBe(false);
            expect((await attempt('wrong-3')).authenticated).toBe(false);

            const blocked = await attempt('local-password');
            expect(blocked.authenticated).toBe(false);
            expect(blocked.message).toContain('Too many failed sign-in attempts');
        });

        it.each(['alice', 'bob', 'carol', 'dave', 'eve', 'erin', 'fred', 'me', 'yves'])('%s is not a listed user: refused without asking SAP', async (name) => {
            process.env.ENABLE_DEV_TOKEN_ISSUER = 'true';
            process.env.LOCAL_AUTH_SECRET = 'secret1234567890-padded-to-32-characters';
            process.env.LOCAL_DEV_PASSWORD = 'local-password';
            const validate = jest.spyOn(authAdapter, 'validateCredentials').mockResolvedValue({ authenticated: true });

            const res = await service._handleLogin({ data: { username: name, password: 'local-password' } });

            expect(res.authenticated).toBe(false);
            expect(res.token).toBeUndefined();
            expect(res.message).toBe('Invalid username or password.');
            expect(validate).not.toHaveBeenCalled();
        });

        describe.each(['[development]', '[test]'])('mocked users in the %s profile', (profile) => {
            const { cds: config } = require('../../../package.json');
            const MockedUsers = require('@sap/cds/lib/srv/middlewares/auth/mocked-users');
            // Merged over CAP's built-in users, as cds.env does: a built-in user or the wildcard must not survive.
            const builtIn = { alice: {}, bob: {}, carol: {}, dave: {}, erin: {}, fred: {}, me: {}, yves: {}, '*': true };
            const users = () => MockedUsers({ users: { ...builtIn, ...JSON.parse(JSON.stringify(config.requires.auth[profile].users)) } });

            it.each(['alice', 'bob', 'carol', 'dave', 'eve', 'erin', 'fred', 'me', 'yves', 'any-other-name'])('refuses %s', (name) => {
                expect(users().verify(name, '').failed).toBeDefined();
            });

            it('keeps only khushal', () => {
                expect(Object.entries(config.requires.auth[profile].users).filter(([, v]) => v !== false).map(([k]) => k)).toEqual(['khushal']);
            });
        });

        it('should reject login for khushal when password is missing or wrong', async () => {
            jest.spyOn(authAdapter, 'validateCredentials').mockResolvedValue({ authenticated: false, message: 'Invalid username or password.' });
            process.env.ENABLE_DEV_TOKEN_ISSUER = 'true';
            process.env.LOCAL_AUTH_SECRET = 'secret1234567890-padded-to-32-characters';
            process.env.LOCAL_DEV_PASSWORD = 'local-password';

            const req1 = {
                data: { username: 'khushal', password: '' }
            };
            const res1 = await service._handleLogin(req1);
            expect(res1.authenticated).toBe(false);
            expect(res1.message).toContain('Password is required');

            const req2 = {
                data: { username: 'khushal', password: 'wrongpassword' }
            };
            const res2 = await service._handleLogin(req2);
            expect(res2.authenticated).toBe(false);
            expect(res2.message).toContain('Invalid username or password');
        });

        it('never accepts the SAP connection password (S4_PASSWORD) as a login password', async () => {
            process.env.ENABLE_DEV_TOKEN_ISSUER = 'true';
            process.env.LOCAL_AUTH_SECRET = 'secret1234567890-padded-to-32-characters';
            process.env.S4_USERNAME = 'khushal';
            process.env.S4_PASSWORD = 'RealS4Password!@#';
            process.env.LOCAL_DEV_PASSWORD = 'local-password';
            process.env.S4_CLIENT = '220';
            const validate = jest.spyOn(authAdapter, 'validateCredentials').mockResolvedValue({
                authenticated: false, statusCode: 401, message: 'Invalid username or password.'
            });

            // The connection password is not compared locally: SAP is asked, and here SAP refuses.
            const res = await service._handleLogin({ data: { username: 'KHUSHAL', password: 'RealS4Password!@#' } });
            expect(res.authenticated).toBe(false);
            expect(res.token).toBeUndefined();
            expect(validate).toHaveBeenCalledWith('KHUSHAL', 'RealS4Password!@#');

            const local = await service._handleLogin({ data: { username: 'KHUSHAL', password: 'local-password' } });
            expect(local.authenticated).toBe(true);
            expect(local.system).toBe('DEV - Client 220');
        });

        it('the SAP connection user (S4_USERNAME) is not an application user unless it is listed', async () => {
            process.env.ENABLE_DEV_TOKEN_ISSUER = 'true';
            process.env.LOCAL_AUTH_SECRET = 'secret1234567890-padded-to-32-characters';
            process.env.S4_USERNAME = 'custom_dev_user';
            process.env.S4_PASSWORD = 'devPassword123';
            const validate = jest.spyOn(authAdapter, 'validateCredentials').mockResolvedValue({ authenticated: true });

            const res = await service._handleLogin({ data: { username: 'CUSTOM_DEV_USER', password: 'devPassword123' } });

            expect(res.authenticated).toBe(false);
            expect(validate).not.toHaveBeenCalled();
        });

        it('stops asking SAP after three wrong passwords for a user, and a success clears the count', async () => {
            process.env.ENABLE_DEV_TOKEN_ISSUER = 'true';
            process.env.LOCAL_AUTH_SECRET = 'secret1234567890-padded-to-32-characters';
            process.env.LOCAL_DEV_PASSWORD = 'local-password';
            const validate = jest.spyOn(authAdapter, 'validateCredentials').mockResolvedValue({
                authenticated: false, statusCode: 401, message: 'Invalid username or password.'
            });
            const attempt = (password) => service._handleLogin({ data: { username: 'khushal', password } });

            await attempt('wrong-1');
            await attempt('wrong-2');
            expect((await attempt('local-password')).authenticated).toBe(true); // success resets the counter

            await attempt('wrong-1');
            await attempt('wrong-2');
            await attempt('wrong-3');
            expect(validate).toHaveBeenCalledTimes(5);

            const blocked = await attempt('wrong-4');
            expect(blocked.authenticated).toBe(false);
            expect(blocked.message).toContain('Too many failed sign-in attempts');
            expect(validate).toHaveBeenCalledTimes(5);

            // Even the right password waits for the window to pass.
            expect((await attempt('local-password')).authenticated).toBe(false);
        });

        it('does not count an unreachable SAP system as a failed attempt', async () => {
            process.env.ENABLE_DEV_TOKEN_ISSUER = 'true';
            process.env.LOCAL_AUTH_SECRET = 'secret1234567890-padded-to-32-characters';
            const validate = jest.spyOn(authAdapter, 'validateCredentials').mockResolvedValue({
                authenticated: false, statusCode: 503, message: 'Cannot connect to S/4HANA system.'
            });

            for (let i = 0; i < 6; i++) await service._handleLogin({ data: { username: 'khushal', password: 'x' } });

            expect(validate).toHaveBeenCalledTimes(6);
        });

        it('refuses khushal with a wrong password and asks SAP, instead of accepting any password', async () => {
            process.env.ENABLE_DEV_TOKEN_ISSUER = 'true';
            process.env.LOCAL_AUTH_SECRET = 'secret1234567890-padded-to-32-characters';
            process.env.LOCAL_DEV_PASSWORD = 'mock-password';
            process.env.S4_PASSWORD = 'real-password';
            const validate = jest.spyOn(authAdapter, 'validateCredentials').mockResolvedValue({
                authenticated: false,
                message: 'Invalid username or password.'
            });

            const res = await service._handleLogin({ data: { username: 'KHUSHAL', password: 'not-the-password' } });

            expect(res.authenticated).toBe(false);
            expect(res.token).toBeUndefined();
            expect(validate).toHaveBeenCalledWith('KHUSHAL', 'not-the-password');
        });

        it('should validate a user listed in APP_USER_ROLES against authAdapter and grant the listed roles', async () => {
            process.env.ENABLE_DEV_TOKEN_ISSUER = 'true';
            process.env.LOCAL_AUTH_SECRET = 'secret1234567890-padded-to-32-characters';
            process.env.APP_USER_ROLES = JSON.stringify({ real_sap_user: ['Viewer'] });

            jest.spyOn(authAdapter, 'validateCredentials').mockResolvedValueOnce({
                authenticated: true,
                message: 'Authentication successful.',
                system: 'PRD - Client 220'
            });

            const req = {
                data: { username: 'REAL_SAP_USER', password: 'realpassword' }
            };

            const res = await service._handleLogin(req);
            expect(res.authenticated).toBe(true);
            expect(res.username).toBe('REAL_SAP_USER');
            expect(res.token).toBeDefined();
            // Exactly the listed roles, never an implicit Admin
            expect(res.scopes).toEqual(['$XSAPPNAME.Viewer']);
            expect(authAdapter.validateCredentials).toHaveBeenCalledWith('REAL_SAP_USER', 'realpassword');
        });

        it('should build system label dynamically from S4_SYSTEM_NAME and S4_CLIENT in user profile and login', async () => {
            process.env.ENABLE_DEV_TOKEN_ISSUER = 'true';
            process.env.LOCAL_AUTH_SECRET = 'secret1234567890-padded-to-32-characters';
            process.env.S4_SYSTEM_NAME = 'S4HANA_DEV';
            process.env.S4_CLIENT = '300';
            process.env.LOCAL_DEV_PASSWORD = 'local-password';

            const req = {
                data: { username: 'khushal', password: 'local-password' }
            };

            const res = await service._handleLogin(req);
            expect(res.system).toBe('S4HANA_DEV - Client 300');

            const infoRes = await service._handleGetUserInfo({
                user: { id: 'khushal', _is_anonymous: false, roles: ['Viewer'] }
            });
            expect(infoRes.system).toBe('S4HANA_DEV - Client 300');
        });

        // ── APP_ALLOW_ANY_SAP_USER behaviour ───────────────────────────────

        it('refuses an unlisted user when APP_ALLOW_ANY_SAP_USER is false (default)', async () => {
            process.env.ENABLE_DEV_TOKEN_ISSUER = 'true';
            process.env.LOCAL_AUTH_SECRET = 'secret1234567890-padded-to-32-characters';
            const validate = jest.spyOn(authAdapter, 'validateCredentials');

            const res = await service._handleLogin({
                data: { username: 'STRANGER', password: 'any-password' }
            });

            expect(res.authenticated).toBe(false);
            // SAP must NOT be contacted for an unlisted user when ALLOW_ANY is false
            expect(validate).not.toHaveBeenCalled();
        });

        it('grants only APP_DEFAULT_ROLES to an unlisted SAP user when APP_ALLOW_ANY_SAP_USER=true', async () => {
            process.env.ENABLE_DEV_TOKEN_ISSUER = 'true';
            process.env.LOCAL_AUTH_SECRET = 'secret1234567890-padded-to-32-characters';
            process.env.APP_ALLOW_ANY_SAP_USER = 'true';
            process.env.APP_DEFAULT_ROLES = 'Viewer';

            jest.spyOn(authAdapter, 'validateCredentials').mockResolvedValueOnce({
                authenticated: true,
                message: 'Authentication successful.',
                system: 'DS4 - Client 220'
            });

            const res = await service._handleLogin({
                data: { username: 'NEWUSER', password: 'valid-sap-password' }
            });

            expect(res.authenticated).toBe(true);
            expect(res.scopes).toEqual(['$XSAPPNAME.Viewer']);
            // Must never grant Admin to an unlisted user
            expect(res.scopes).not.toContain('$XSAPPNAME.Admin');
        });

        it('never grants Admin via APP_DEFAULT_ROLES even when misconfigured (blocked at parseDefaultRoles)', () => {
            // parseDefaultRoles throws if Admin appears in APP_DEFAULT_ROLES
            const { parseDefaultRoles } = require('../../../srv/auth/appUsers');
            expect(() => parseDefaultRoles({ APP_DEFAULT_ROLES: 'Admin' })).toThrow(/Admin/);
        });

        it('refuses an unlisted user when SAP rejects them, even with APP_ALLOW_ANY_SAP_USER=true', async () => {
            process.env.ENABLE_DEV_TOKEN_ISSUER = 'true';
            process.env.LOCAL_AUTH_SECRET = 'secret1234567890-padded-to-32-characters';
            process.env.APP_ALLOW_ANY_SAP_USER = 'true';

            jest.spyOn(authAdapter, 'validateCredentials').mockResolvedValueOnce({
                authenticated: false,
                statusCode: 401,
                message: 'Invalid username or password. S/4HANA logon failed.'
            });

            const res = await service._handleLogin({
                data: { username: 'BADUSER', password: 'wrong-password' }
            });

            expect(res.authenticated).toBe(false);
            expect(res.token).toBeUndefined();
        });

        it('uses default ["Viewer"] when APP_ALLOW_ANY_SAP_USER=true and APP_DEFAULT_ROLES is unset', async () => {
            process.env.ENABLE_DEV_TOKEN_ISSUER = 'true';
            process.env.LOCAL_AUTH_SECRET = 'secret1234567890-padded-to-32-characters';
            process.env.APP_ALLOW_ANY_SAP_USER = 'true';
            // APP_DEFAULT_ROLES not set → parseDefaultRoles returns ['Viewer']

            jest.spyOn(authAdapter, 'validateCredentials').mockResolvedValueOnce({
                authenticated: true,
                message: 'Authentication successful.',
                system: 'DS4 - Client 220'
            });

            const res = await service._handleLogin({
                data: { username: 'ANYUSER', password: 'valid-sap-password' }
            });

            expect(res.authenticated).toBe(true);
            expect(res.scopes).toEqual(['$XSAPPNAME.Viewer']);
        });

        // ── Req 3: SAP role mapping via BAPI_USER_GET_DETAIL ──────────────────

        it('maps SAP roles via BAPI_USER_GET_DETAIL and role-map.json for APP_ALLOW_ANY_SAP_USER', async () => {
            process.env.ENABLE_DEV_TOKEN_ISSUER = 'true';
            process.env.LOCAL_AUTH_SECRET = 'secret1234567890-padded-to-32-characters';
            process.env.APP_ALLOW_ANY_SAP_USER = 'true';

            jest.spyOn(authAdapter, 'validateCredentials').mockResolvedValueOnce({
                authenticated: true,
                message: 'Authentication successful.',
                system: 'DS4 - Client 220'
            });

            service._fetchDetail = jest.fn().mockResolvedValue({
                roles: [{ name: 'Z_APP_SALES_MGR' }]
            });

            const res = await service._handleLogin({
                data: { username: 'SALES_REP_1', password: 'valid-password' }
            });

            expect(res.authenticated).toBe(true);
            expect(res.scopes).toEqual(['$XSAPPNAME.SalesManager']);
            expect(service._fetchDetail).toHaveBeenCalledWith('SALES_REP_1');
        });

        it('maps SAP roles via prefix ZAPP_<ROLE> without role-map for APP_ALLOW_ANY_SAP_USER', async () => {
            process.env.ENABLE_DEV_TOKEN_ISSUER = 'true';
            process.env.LOCAL_AUTH_SECRET = 'secret1234567890-padded-to-32-characters';
            process.env.APP_ALLOW_ANY_SAP_USER = 'true';

            jest.spyOn(authAdapter, 'validateCredentials').mockResolvedValueOnce({
                authenticated: true,
                message: 'Authentication successful.',
                system: 'DS4 - Client 220'
            });

            service._fetchDetail = jest.fn().mockResolvedValue({
                roles: [{ name: 'ZAPP_WarehouseClerk' }]
            });

            const res = await service._handleLogin({
                data: { username: 'PREFIX_USER', password: 'valid-password' }
            });

            expect(res.authenticated).toBe(true);
            expect(res.scopes).toEqual(['$XSAPPNAME.WarehouseClerk']);
        });

        it('falls back to APP_DEFAULT_ROLES when BAPI fails or throws', async () => {
            process.env.ENABLE_DEV_TOKEN_ISSUER = 'true';
            process.env.LOCAL_AUTH_SECRET = 'secret1234567890-padded-to-32-characters';
            process.env.APP_ALLOW_ANY_SAP_USER = 'true';
            process.env.APP_DEFAULT_ROLES = 'Viewer';

            jest.spyOn(authAdapter, 'validateCredentials').mockResolvedValueOnce({
                authenticated: true,
                message: 'Authentication successful.',
                system: 'DS4 - Client 220'
            });

            service._fetchDetail = jest.fn().mockRejectedValue(new Error('RFC connection timeout'));

            const res = await service._handleLogin({
                data: { username: 'SOME_USER', password: 'valid-password' }
            });

            expect(res.authenticated).toBe(true);
            expect(res.scopes).toEqual(['$XSAPPNAME.Viewer']);
        });

        it('never grants Admin through role mapping unless user is in APP_ADMIN_USERS', async () => {
            process.env.ENABLE_DEV_TOKEN_ISSUER = 'true';
            process.env.LOCAL_AUTH_SECRET = 'secret1234567890-padded-to-32-characters';
            process.env.APP_ALLOW_ANY_SAP_USER = 'true';

            const { loadRoleMap: _originalLoad } = require('../../../srv/auth/sapRoleMapper');
            // Inject a map with Admin
            const sapRoleMapper = require('../../../srv/auth/sapRoleMapper');
            jest.spyOn(sapRoleMapper, 'loadRoleMap').mockReturnValue({
                Z_SAP_SUPER: ['Admin', 'Viewer']
            });

            jest.spyOn(authAdapter, 'validateCredentials').mockResolvedValue({
                authenticated: true,
                message: 'Authentication successful.',
                system: 'DS4 - Client 220'
            });

            service._fetchDetail = jest.fn().mockResolvedValue({
                roles: [{ name: 'Z_SAP_SUPER' }]
            });

            // 1. Regular user: Admin stripped
            const res1 = await service._handleLogin({
                data: { username: 'REGULAR_USER', password: 'valid-password' }
            });
            expect(res1.authenticated).toBe(true);
            expect(res1.scopes).toEqual(['$XSAPPNAME.Viewer']);
            expect(res1.scopes).not.toContain('$XSAPPNAME.Admin');

            // 2. Admin user listed in APP_ADMIN_USERS: Admin allowed
            process.env.APP_ADMIN_USERS = 'admin_user';
            const res2 = await service._handleLogin({
                data: { username: 'ADMIN_USER', password: 'valid-password' }
            });
            expect(res2.authenticated).toBe(true);
            expect(res2.scopes).toContain('$XSAPPNAME.Admin');
        });

        it('the token of an unlisted SAP user is accepted on later requests with the SAP-mapped roles', async () => {
            process.env.ENABLE_DEV_TOKEN_ISSUER = 'true';
            process.env.LOCAL_AUTH_SECRET = 'secret1234567890-padded-to-32-characters';
            process.env.APP_ALLOW_ANY_SAP_USER = 'true';
            jest.spyOn(authAdapter, 'validateCredentials').mockResolvedValueOnce({
                authenticated: true, message: 'Authentication successful.', system: 'DS4 - Client 220'
            });
            service._fetchDetail = jest.fn().mockResolvedValue({ roles: [{ name: 'ZAPP_SALESMANAGER' }] });

            const res = await service._handleLogin({ data: { username: 'JSMITH', password: 'valid-sap-password' } });
            expect(res.authenticated).toBe(true);
            expect(res.scopes).toEqual(['$XSAPPNAME.SalesManager']);

            const user = require('../../../srv/auth/localTokenUtil').verifyToken(res.token);
            expect(user).not.toBeNull();
            expect(user.id).toBe('JSMITH');
            expect(user.is('SalesManager')).toBe(true);
            expect(user.is('Admin')).toBe(false);
        });

        it('khushal signing in with the SAP password has the same roles in the login answer and on later requests', async () => {
            process.env.ENABLE_DEV_TOKEN_ISSUER = 'true';
            process.env.LOCAL_AUTH_SECRET = 'secret1234567890-padded-to-32-characters';
            jest.spyOn(authAdapter, 'validateCredentials').mockResolvedValueOnce({
                authenticated: true, message: 'Authentication successful.', system: 'DS4 - Client 220'
            });
            service._fetchDetail = jest.fn().mockResolvedValue({ roles: [{ name: 'SOME_OTHER_SAP_ROLE' }] });

            const res = await service._handleLogin({ data: { username: 'khushal', password: 'valid-sap-password' } });
            expect(res.authenticated).toBe(true);
            expect(res.scopes).toEqual(['$XSAPPNAME.Viewer']);

            const user = require('../../../srv/auth/localTokenUtil').verifyToken(res.token);
            expect(user.is('Viewer')).toBe(true);
            expect(user.is('Admin')).toBe(false);
        });

        it('a user of a sign-in list still gets the roles of the list on every request', async () => {
            process.env.ENABLE_DEV_TOKEN_ISSUER = 'true';
            process.env.LOCAL_AUTH_SECRET = 'secret1234567890-padded-to-32-characters';
            process.env.APP_USER_ROLES = JSON.stringify({ listed_user: ['WarehouseClerk'] });
            jest.spyOn(authAdapter, 'validateCredentials').mockResolvedValueOnce({
                authenticated: true, message: 'Authentication successful.', system: 'DS4 - Client 220'
            });

            const res = await service._handleLogin({ data: { username: 'LISTED_USER', password: 'valid-sap-password' } });
            const util = require('../../../srv/auth/localTokenUtil');
            expect(util.verifyToken(res.token).is('WarehouseClerk')).toBe(true);

            process.env.APP_USER_ROLES = JSON.stringify({ listed_user: ['Viewer'] });
            expect(util.verifyToken(res.token).is('WarehouseClerk')).toBe(false);
            delete process.env.APP_USER_ROLES;
            expect(util.verifyToken(res.token)).toBeNull();
        });

        it('warns once when sign-in requests come through a reverse proxy the app does not trust', async () => {
            process.env.ENABLE_DEV_TOKEN_ISSUER = 'true';
            process.env.LOCAL_AUTH_SECRET = 'secret1234567890-padded-to-32-characters';
            const LOG = require('../../../srv/common/logger')('auth');
            const warn = jest.spyOn(LOG, 'warn').mockImplementation(() => {});
            const viaProxy = {
                data: { username: 'STRANGER', password: 'any-password' },
                http: { req: { ip: '172.18.0.5', headers: { 'x-forwarded-for': '10.20.30.40' }, app: { get: () => false } } }
            };

            await service._handleLogin(viaProxy);
            await service._handleLogin(viaProxy);

            const proxyWarnings = warn.mock.calls.filter(([text]) => String(text).includes('TRUST_PROXY_HOPS'));
            expect(proxyWarnings).toHaveLength(1);
        });

        it('explicit entries in APP_USER_ROLES override SAP role mapping', async () => {
            process.env.ENABLE_DEV_TOKEN_ISSUER = 'true';
            process.env.LOCAL_AUTH_SECRET = 'secret1234567890-padded-to-32-characters';
            process.env.APP_USER_ROLES = JSON.stringify({
                overridden_user: ['WarehouseClerk']
            });

            jest.spyOn(authAdapter, 'validateCredentials').mockResolvedValueOnce({
                authenticated: true,
                message: 'Authentication successful.',
                system: 'DS4 - Client 220'
            });

            service._fetchDetail = jest.fn().mockResolvedValue({
                roles: [{ name: 'Z_APP_SALES_MGR' }] // would map to SalesManager
            });

            const res = await service._handleLogin({
                data: { username: 'OVERRIDDEN_USER', password: 'valid-password' }
            });

            expect(res.authenticated).toBe(true);
            // Explicit entry in APP_USER_ROLES wins (WarehouseClerk, NOT SalesManager)
            expect(res.scopes).toEqual(['$XSAPPNAME.WarehouseClerk']);
            expect(service._fetchDetail).not.toHaveBeenCalled();
        });
    });
});

