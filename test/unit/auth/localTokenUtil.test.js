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
            expect(() => localTokenUtil.issueToken('alice')).toThrow(/disabled/i);
            expect(localTokenUtil.verifyToken('some.dummy.token')).toBeNull();
        });

        it('should be disabled if ENABLE_DEV_TOKEN_ISSUER is true but LOCAL_AUTH_SECRET is missing', () => {
            process.env.ENABLE_DEV_TOKEN_ISSUER = 'true';
            delete process.env.LOCAL_AUTH_SECRET;

            expect(localTokenUtil.isDevTokenIssuerEnabled()).toBe(false);
            expect(() => localTokenUtil.issueToken('alice')).toThrow(/disabled/i);
            expect(localTokenUtil.verifyToken('some.dummy.token')).toBeNull();
        });

        it('should be disabled if LOCAL_AUTH_SECRET is set but ENABLE_DEV_TOKEN_ISSUER is not true', () => {
            delete process.env.ENABLE_DEV_TOKEN_ISSUER;
            process.env.LOCAL_AUTH_SECRET = 'super-secret-key-12345';

            expect(localTokenUtil.isDevTokenIssuerEnabled()).toBe(false);
            expect(() => localTokenUtil.issueToken('alice')).toThrow(/disabled/i);
            expect(localTokenUtil.verifyToken('some.dummy.token')).toBeNull();
        });

        it('should be enabled when ENABLE_DEV_TOKEN_ISSUER=true and LOCAL_AUTH_SECRET is provided', () => {
            process.env.ENABLE_DEV_TOKEN_ISSUER = 'true';
            process.env.LOCAL_AUTH_SECRET = 'super-secret-key-12345';

            expect(localTokenUtil.isDevTokenIssuerEnabled()).toBe(true);
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
            const tokenResult = localTokenUtil.issueToken('alice', ['PurchasingManager', 'Viewer']);
            expect(tokenResult).toHaveProperty('token');
            expect(tokenResult.scopes).toEqual(['$XSAPPNAME.PurchasingManager', '$XSAPPNAME.Viewer']);
            expect(typeof tokenResult.expiresAt).toBe('number');

            const verifiedUser = localTokenUtil.verifyToken(tokenResult.token);
            expect(verifiedUser).not.toBeNull();
            expect(verifiedUser.id).toBe('alice');
            expect(verifiedUser.is('PurchasingManager')).toBe(true);
            expect(verifiedUser.is('Viewer')).toBe(true);
            expect(verifiedUser.attr.logon_name).toBe('alice');
            expect(verifiedUser.attr.email).toBe('alice@example.corp');
        });

        it('should reject tampered token signatures', () => {
            const tokenResult = localTokenUtil.issueToken('bob', ['Viewer']);
            const parts = tokenResult.token.split('.');
            // Tamper with payload
            const tamperedPayload = Buffer.from(JSON.stringify({ user_name: 'admin', scope: ['$XSAPPNAME.Admin'] })).toString('base64url');
            const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

            const verified = localTokenUtil.verifyToken(tamperedToken);
            expect(verified).toBeNull();
        });

        it('should reject tokens with modified signatures', () => {
            const tokenResult = localTokenUtil.issueToken('bob', ['Viewer']);
            const parts = tokenResult.token.split('.');
            const corruptedSig = parts[2].slice(0, -2) + (parts[2].endsWith('a') ? 'b' : 'a');
            const corruptedToken = `${parts[0]}.${parts[1]}.${corruptedSig}`;

            const verified = localTokenUtil.verifyToken(corruptedToken);
            expect(verified).toBeNull();
        });

        it('should reject expired tokens', () => {
            const tokenResult = localTokenUtil.issueToken('bob', ['Viewer'], { expiresInSeconds: -10 });
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
});
