const localTokenUtil = require('../../../srv/auth/localTokenUtil');

describe('Unit: localTokenUtil (Harden Dev Token Issuer)', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        delete process.env.ENABLE_DEV_TOKEN_ISSUER;
        delete process.env.LOCAL_AUTH_SECRET;
    });

    afterEach(() => {
        process.env = { ...originalEnv };
    });

    describe('Gating and Opt-In Validation', () => {
        it('should be disabled by default (no env vars set)', () => {
            expect(localTokenUtil.isDevTokenIssuerEnabled()).toBe(false);
            expect(() => localTokenUtil.issueToken('khushal')).toThrow(/disabled/i);
            expect(localTokenUtil.verifyToken('some.dummy.token')).toBeNull();
        });

        it('should be disabled if ENABLE_DEV_TOKEN_ISSUER is true but LOCAL_AUTH_SECRET is missing', () => {
            process.env.ENABLE_DEV_TOKEN_ISSUER = 'true';
            delete process.env.LOCAL_AUTH_SECRET;

            expect(localTokenUtil.isDevTokenIssuerEnabled()).toBe(false);
            expect(() => localTokenUtil.issueToken('khushal')).toThrow(/disabled/i);
            expect(localTokenUtil.verifyToken('some.dummy.token')).toBeNull();
        });

        it('should be disabled if LOCAL_AUTH_SECRET is set but ENABLE_DEV_TOKEN_ISSUER is not true', () => {
            delete process.env.ENABLE_DEV_TOKEN_ISSUER;
            process.env.LOCAL_AUTH_SECRET = 'super-secret-key-12345-padded-to-32-characters';

            expect(localTokenUtil.isDevTokenIssuerEnabled()).toBe(false);
            expect(() => localTokenUtil.issueToken('khushal')).toThrow(/disabled/i);
            expect(localTokenUtil.verifyToken('some.dummy.token')).toBeNull();
        });

        it('should be enabled when ENABLE_DEV_TOKEN_ISSUER=true and LOCAL_AUTH_SECRET is provided', () => {
            process.env.ENABLE_DEV_TOKEN_ISSUER = 'true';
            process.env.LOCAL_AUTH_SECRET = 'super-secret-key-12345-padded-to-32-characters';

            expect(localTokenUtil.isDevTokenIssuerEnabled()).toBe(true);
        });

        it('should be disabled when NODE_ENV is production even if flags are set', () => {
            process.env.NODE_ENV = 'production';
            process.env.ENABLE_DEV_TOKEN_ISSUER = 'true';
            process.env.LOCAL_AUTH_SECRET = 'super-secret-key-12345-padded-to-32-characters';

            expect(localTokenUtil.isDevTokenIssuerEnabled()).toBe(false);
            expect(() => localTokenUtil.issueToken('khushal')).toThrow(/disabled/i);
        });
    });

    describe('Token Issuance and Verification', () => {
        beforeEach(() => {
            process.env.ENABLE_DEV_TOKEN_ISSUER = 'true';
            process.env.LOCAL_AUTH_SECRET = 'test-secret-key-abcdef-padded-to-32-characters';
        });

        it('should reject token issuance with missing or invalid username', () => {
            expect(() => localTokenUtil.issueToken('')).toThrow(/Username is required/i);
            expect(() => localTokenUtil.issueToken(null)).toThrow(/Username is required/i);
        });

        it('should issue a valid JWT with standard XSUAA claims and verify it', () => {
            const tokenResult = localTokenUtil.issueToken('khushal', ['PurchasingManager', 'Viewer']);
            expect(tokenResult).toHaveProperty('token');
            expect(tokenResult.scopes).toEqual(['$XSAPPNAME.PurchasingManager', '$XSAPPNAME.Viewer']);
            expect(typeof tokenResult.expiresAt).toBe('number');

            const verifiedUser = localTokenUtil.verifyToken(tokenResult.token);
            expect(verifiedUser).not.toBeNull();
            expect(verifiedUser.id).toBe('khushal');
            expect(verifiedUser.is('PurchasingManager')).toBe(true);
            expect(verifiedUser.is('Viewer')).toBe(true);
            expect(verifiedUser.attr.logon_name).toBe('khushal');
            expect(verifiedUser.attr.email).toBe('khushal@example.corp');
        });

        it('should reject tampered token signatures', () => {
            const tokenResult = localTokenUtil.issueToken('test-viewer-1120', ['Viewer']);
            const parts = tokenResult.token.split('.');
            // Tamper with payload
            const tamperedPayload = Buffer.from(JSON.stringify({ user_name: 'admin', scope: ['$XSAPPNAME.Admin'] })).toString('base64url');
            const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

            const verified = localTokenUtil.verifyToken(tamperedToken);
            expect(verified).toBeNull();
        });

        it('should reject tokens with modified signatures', () => {
            const tokenResult = localTokenUtil.issueToken('test-viewer-1120', ['Viewer']);
            const parts = tokenResult.token.split('.');
            const corruptedSig = parts[2].slice(0, -2) + (parts[2].endsWith('a') ? 'b' : 'a');
            const corruptedToken = `${parts[0]}.${parts[1]}.${corruptedSig}`;

            const verified = localTokenUtil.verifyToken(corruptedToken);
            expect(verified).toBeNull();
        });

        it('should reject expired tokens', () => {
            const tokenResult = localTokenUtil.issueToken('test-viewer-1120', ['Viewer'], { expiresInSeconds: -10 });
            const verified = localTokenUtil.verifyToken(tokenResult.token);
            expect(verified).toBeNull();
        });

        it('should return null for malformed tokens', () => {
            expect(localTokenUtil.verifyToken('')).toBeNull();
            expect(localTokenUtil.verifyToken('not.a.valid.jwt.token')).toBeNull();
            expect(localTokenUtil.verifyToken('invalid')).toBeNull();
            expect(localTokenUtil.verifyToken(null)).toBeNull();
        });
    });

    describe('applyBearerToken', () => {
        const run = (authorization) => {
            const req = { headers: { authorization } };
            const next = jest.fn();
            localTokenUtil.applyBearerToken(req, {}, next);
            expect(next).toHaveBeenCalledTimes(1);
            return req;
        };
        const enable = () => {
            process.env.ENABLE_DEV_TOKEN_ISSUER = 'true';
            process.env.LOCAL_AUTH_SECRET = 'super-secret-key-12345-padded-to-32-characters';
        };

        it('signs in the user from a valid token, whatever the case of "Bearer"', () => {
            enable();
            const { token } = localTokenUtil.issueToken('khushal');
            expect(run(`Bearer ${token}`).user.id).toBe('khushal');
            expect(run(`bearer   ${token}`).user.id).toBe('khushal');
        });

        it('leaves the user unset for a missing, blank, non-Bearer or forged token', () => {
            enable();
            const { token } = localTokenUtil.issueToken('khushal');
            for (const header of [undefined, 'Bearer ', 'Basic abc', 'Bearer not.a.token', `${token}`, `Bearer ${token}x`]) {
                expect(run(header).user).toBeUndefined();
            }
        });

        it('ignores a valid token once the issuer is disabled, and in production', () => {
            enable();
            const { token } = localTokenUtil.issueToken('khushal');
            process.env.NODE_ENV = 'production';
            expect(run(`Bearer ${token}`).user).toBeUndefined();
            process.env.NODE_ENV = 'test';
            delete process.env.ENABLE_DEV_TOKEN_ISSUER;
            expect(run(`Bearer ${token}`).user).toBeUndefined();
        });
    });

describe('Unit: localTokenUtil - the sign-in list applies to every request', () => {
    const cds = require('@sap/cds');
    const util = require('../../../srv/auth/localTokenUtil');
    const originalEnv = { ...process.env };
    let originalAuth;

    beforeEach(() => {
        originalAuth = cds.env.requires.auth;
        cds.env.requires.auth = { kind: 'mocked', users: { khushal: { roles: ['Admin', 'Viewer'] } } };
        process.env.NODE_ENV = 'development';
        process.env.ENABLE_DEV_TOKEN_ISSUER = 'true';
        process.env.LOCAL_AUTH_SECRET = 'local-test-signing-secret-at-least-32-characters';
        delete process.env.APP_USER_ROLES;
    });

    afterEach(() => {
        cds.env.requires.auth = originalAuth;
        process.env = { ...originalEnv };
    });

    test('a token of a user who is no longer listed is refused', () => {
        process.env.APP_USER_ROLES = '{"JSMITH":["Viewer"]}';
        const { token } = util.issueToken('JSMITH', ['Viewer']);
        expect(util.verifyToken(token).id).toBe('JSMITH');

        delete process.env.APP_USER_ROLES;
        expect(util.verifyToken(token)).toBeNull();
    });

    test('roles come from the current list, not from the token', () => {
        process.env.APP_USER_ROLES = '{"JSMITH":["Viewer"]}';
        const { token } = util.issueToken('JSMITH', ['Admin', 'Viewer']);
        const user = util.verifyToken(token);
        expect(user.is('Viewer')).toBe(true);
        expect(user.is('Admin')).toBe(false);

        process.env.APP_USER_ROLES = '{"JSMITH":["Viewer","SalesManager"]}';
        expect(util.verifyToken(token).is('SalesManager')).toBe(true);
    });

    test('a configured development user keeps its roles, and Admin still implies SapLogsReader', () => {
        const { token } = util.issueToken('khushal', ['Viewer']);
        const user = util.verifyToken(token);
        expect(user.is('Admin')).toBe(true);
        expect(user.is('SapLogsReader')).toBe(true);
    });
});
});

describe('Unit: localTokenUtil - signing secret length and mandatory claims', () => {
    const crypto = require('crypto');
    const util = require('../../../srv/auth/localTokenUtil');
    const originalEnv = { ...process.env };
    const SECRET = 'local-test-signing-secret-at-least-32-characters';
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const sign = (header, payload) => {
        const body = `${b64(header)}.${b64(payload)}`;
        return `${body}.${crypto.createHmac('sha256', SECRET).update(body).digest('base64url')}`;
    };
    const HS256 = { alg: 'HS256', typ: 'JWT' };
    const now = () => Math.floor(Date.now() / 1000);
    const claims = (extra = {}) => ({
        user_name: 'khushal', scope: ['$XSAPPNAME.Viewer'], iss: 'saps4hana-local-auth-service',
        aud: 'saps4hana-fiori-app', iat: now(), nbf: now(), exp: now() + 600, ...extra
    });
    const without = (key) => { const all = claims(); delete all[key]; return all; };

    beforeEach(() => {
        process.env.NODE_ENV = 'test';
        process.env.ENABLE_DEV_TOKEN_ISSUER = 'true';
        process.env.LOCAL_AUTH_SECRET = SECRET;
    });
    afterEach(() => { process.env = { ...originalEnv }; });

    test('a signing secret shorter than 32 characters keeps the issuer off', () => {
        process.env.LOCAL_AUTH_SECRET = 'x'.repeat(31);
        expect(util.isDevTokenIssuerEnabled()).toBe(false);
        expect(() => util.issueToken('khushal')).toThrow(/at least 32 characters/);
        process.env.LOCAL_AUTH_SECRET = 'x'.repeat(32);
        expect(util.isDevTokenIssuerEnabled()).toBe(true);
    });

    test('a correctly signed token is accepted only with an expiry time, the issuer and HS256', () => {
        expect(util.verifyToken(sign(HS256, claims())).id).toBe('khushal');
        const { exp: _exp, ...noExpiry } = claims();
        expect(util.verifyToken(sign(HS256, noExpiry))).toBeNull();
        expect(util.verifyToken(sign(HS256, claims({ exp: 'never' })))).toBeNull();
        expect(util.verifyToken(sign(HS256, claims({ iss: 'someone-else' })))).toBeNull();
        expect(util.verifyToken(sign({ alg: 'none', typ: 'JWT' }, claims()))).toBeNull();
    });

    test('an issued token names this application as audience, and carries iat and nbf', () => {
        const payload = JSON.parse(Buffer.from(util.issueToken('khushal').token.split('.')[1], 'base64url').toString());
        expect(payload.aud).toBe(util.LOCAL_DEV_AUDIENCE);
        expect(payload.iat).toBeLessThanOrEqual(now());
        expect(payload.nbf).toBe(payload.iat);
    });

    test('a token for another audience, or without one, is refused', () => {
        expect(util.verifyToken(sign(HS256, claims({ aud: ['other-app', 'saps4hana-fiori-app'] }))).id).toBe('khushal');
        expect(util.verifyToken(sign(HS256, claims({ aud: 'some-other-app' })))).toBeNull();
        expect(util.verifyToken(sign(HS256, claims({ aud: ['some-other-app'] })))).toBeNull();
        expect(util.verifyToken(sign(HS256, without('aud')))).toBeNull();
    });

    test('a token without iat or nbf, or issued or valid only in the future, is refused', () => {
        expect(util.verifyToken(sign(HS256, without('iat')))).toBeNull();
        expect(util.verifyToken(sign(HS256, without('nbf')))).toBeNull();
        expect(util.verifyToken(sign(HS256, claims({ iat: 'now' })))).toBeNull();
        expect(util.verifyToken(sign(HS256, claims({ iat: now() + 3600 })))).toBeNull();
        expect(util.verifyToken(sign(HS256, claims({ nbf: now() + 3600 })))).toBeNull();
        // one minute of clock difference between issuer and verifier is tolerated
        expect(util.verifyToken(sign(HS256, claims({ iat: now() + 30, nbf: now() + 30 }))).id).toBe('khushal');
    });
});

describe('Unit: localTokenUtil - roles mapped from SAP at sign-in live in the token', () => {
    const cds = require('@sap/cds');
    const util = require('../../../srv/auth/localTokenUtil');
    const originalEnv = { ...process.env };
    const SAP = { roleSource: util.ROLE_SOURCE_SAP };
    let originalAuth;

    beforeEach(() => {
        originalAuth = cds.env.requires.auth;
        cds.env.requires.auth = { kind: 'mocked', users: { khushal: { roles: ['Admin', 'Viewer'] } } };
        process.env.NODE_ENV = 'development';
        process.env.ENABLE_DEV_TOKEN_ISSUER = 'true';
        process.env.LOCAL_AUTH_SECRET = 'local-test-signing-secret-at-least-32-characters';
        for (const key of ['APP_USER_ROLES', 'APP_USERS_FILE', 'APP_ALLOW_ANY_SAP_USER', 'APP_DEFAULT_ROLES', 'APP_ADMIN_USERS']) {
            delete process.env[key];
        }
    });

    afterEach(() => {
        cds.env.requires.auth = originalAuth;
        process.env = { ...originalEnv };
    });

    test('an unlisted SAP user keeps the mapped roles on later requests while APP_ALLOW_ANY_SAP_USER is on', () => {
        process.env.APP_ALLOW_ANY_SAP_USER = 'true';
        const { token } = util.issueToken('JSMITH', ['SalesManager'], SAP);

        const user = util.verifyToken(token);
        expect(user.id).toBe('JSMITH');
        expect(user.is('SalesManager')).toBe(true);
        expect(user.is('Admin')).toBe(false);
    });

    test('turning APP_ALLOW_ANY_SAP_USER off refuses the token of an unlisted SAP user at once', () => {
        process.env.APP_ALLOW_ANY_SAP_USER = 'true';
        const { token } = util.issueToken('JSMITH', ['Viewer'], SAP);
        expect(util.verifyToken(token)).not.toBeNull();

        process.env.APP_ALLOW_ANY_SAP_USER = 'false';
        expect(util.verifyToken(token)).toBeNull();
    });

    test('a token without the claim is still refused for an unlisted user, whatever APP_ALLOW_ANY_SAP_USER says', () => {
        process.env.APP_ALLOW_ANY_SAP_USER = 'true';
        const { token } = util.issueToken('JSMITH', ['Admin', 'Viewer']);
        expect(util.verifyToken(token)).toBeNull();
    });

    test('a configured development user who signed in through SAP has the mapped roles, not the configured ones', () => {
        const { token } = util.issueToken('khushal', ['Viewer'], SAP);
        const user = util.verifyToken(token);
        expect(user.is('Viewer')).toBe(true);
        expect(user.is('Admin')).toBe(false);
        expect(user.is('SapLogsReader')).toBe(false);
    });

    test('an entry added to APP_USER_ROLES after sign-in replaces the mapped roles at once', () => {
        process.env.APP_ALLOW_ANY_SAP_USER = 'true';
        const { token } = util.issueToken('JSMITH', ['SalesManager'], SAP);

        process.env.APP_USER_ROLES = '{"JSMITH":["WarehouseClerk"]}';
        const user = util.verifyToken(token);
        expect(user.is('WarehouseClerk')).toBe(true);
        expect(user.is('SalesManager')).toBe(false);
    });

    test('Admin from SAP needs APP_ADMIN_USERS on every request, and takes its implied SapLogsReader with it', () => {
        process.env.APP_ALLOW_ANY_SAP_USER = 'true';
        process.env.APP_ADMIN_USERS = 'madmin';
        const { token } = util.issueToken('MADMIN', ['Admin', 'Viewer'], SAP);
        expect(util.verifyToken(token).is('Admin')).toBe(true);
        expect(util.verifyToken(token).is('SapLogsReader')).toBe(true);

        delete process.env.APP_ADMIN_USERS;
        const user = util.verifyToken(token);
        expect(user.is('Admin')).toBe(false);
        expect(user.is('SapLogsReader')).toBe(false);
        expect(user.is('Viewer')).toBe(true);
    });

    test('unknown roles in the token are dropped, and a token left without roles gets APP_DEFAULT_ROLES', () => {
        process.env.APP_ALLOW_ANY_SAP_USER = 'true';
        const mixed = util.verifyToken(util.issueToken('JSMITH', ['Viewer', 'Superuser'], SAP).token);
        expect(mixed.is('Viewer')).toBe(true);
        expect(mixed.is('Superuser')).toBe(false);

        process.env.APP_DEFAULT_ROLES = 'SalesRepresentative';
        const onlyAdmin = util.verifyToken(util.issueToken('JSMITH', ['Admin'], SAP).token);
        expect(onlyAdmin.is('Admin')).toBe(false);
        expect(onlyAdmin.is('SalesRepresentative')).toBe(true);
    });
});
