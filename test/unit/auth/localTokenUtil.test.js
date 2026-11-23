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
            process.env.LOCAL_AUTH_SECRET = 'super-secret-key-12345';

            expect(localTokenUtil.isDevTokenIssuerEnabled()).toBe(false);
            expect(() => localTokenUtil.issueToken('khushal')).toThrow(/disabled/i);
            expect(localTokenUtil.verifyToken('some.dummy.token')).toBeNull();
        });

        it('should be enabled when ENABLE_DEV_TOKEN_ISSUER=true and LOCAL_AUTH_SECRET is provided', () => {
            process.env.ENABLE_DEV_TOKEN_ISSUER = 'true';
            process.env.LOCAL_AUTH_SECRET = 'super-secret-key-12345';

            expect(localTokenUtil.isDevTokenIssuerEnabled()).toBe(true);
        });

        it('should be disabled when NODE_ENV is production even if flags are set', () => {
            process.env.NODE_ENV = 'production';
            process.env.ENABLE_DEV_TOKEN_ISSUER = 'true';
            process.env.LOCAL_AUTH_SECRET = 'super-secret-key-12345';

            expect(localTokenUtil.isDevTokenIssuerEnabled()).toBe(false);
            expect(() => localTokenUtil.issueToken('khushal')).toThrow(/disabled/i);
        });
    });

    describe('Token Issuance and Verification', () => {
        beforeEach(() => {
            process.env.ENABLE_DEV_TOKEN_ISSUER = 'true';
            process.env.LOCAL_AUTH_SECRET = 'test-secret-key-abcdef';
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
            process.env.LOCAL_AUTH_SECRET = 'super-secret-key-12345';
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
