const AuthServiceHandler = require('../../../srv/auth-service');
const authAdapter = require('../../../srv/integration/s4hana/AuthAdapter');

describe('Unit: AuthService (CAP Authentication Handler)', () => {
    let service;
    const originalEnv = { ...process.env };

    beforeEach(() => {
        service = new AuthServiceHandler();
        delete process.env.ENABLE_DEV_TOKEN_ISSUER;
        delete process.env.LOCAL_AUTH_SECRET;
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
        it('should reject with 403 in production environment', async () => {
            process.env.NODE_ENV = 'production';
            process.env.ENABLE_DEV_TOKEN_ISSUER = 'true';
            process.env.LOCAL_AUTH_SECRET = 'secret';

            const req = {
                data: { username: 'alice', password: 'password' },
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
                data: { username: 'alice', password: 'password' },
                error: jest.fn((status, msg) => {
                    const err = new Error(msg);
                    err.status = status;
                    throw err;
                })
            };

            await expect(service._handleLogin(req)).rejects.toThrow(/disabled in deployed environments/i);
            expect(req.error).toHaveBeenCalledWith(403, expect.stringContaining('SAP BTP XSUAA Single Sign-On'));
        });

        it('should allow dev login for alice when dev token issuer is explicitly enabled', async () => {
            process.env.ENABLE_DEV_TOKEN_ISSUER = 'true';
            process.env.LOCAL_AUTH_SECRET = 'secret1234567890';

            const req = {
                data: { username: 'alice', password: 'any' }
            };

            const res = await service._handleLogin(req);
            expect(res.authenticated).toBe(true);
            expect(res.username).toBe('alice');
            expect(res.token).toBeDefined();
            expect(typeof res.token).toBe('string');
            expect(res.scopes).toEqual(expect.arrayContaining(['$XSAPPNAME.PurchasingManager']));
        });

        it('should allow dev login for khushal and configured S4_USERNAME when dev token issuer is explicitly enabled', async () => {
            process.env.ENABLE_DEV_TOKEN_ISSUER = 'true';
            process.env.LOCAL_AUTH_SECRET = 'secret1234567890';
            process.env.S4_USERNAME = 'custom_dev_user';

            const req1 = {
                data: { username: 'KHUSHAL', password: 'any' }
            };
            const res1 = await service._handleLogin(req1);
            expect(res1.authenticated).toBe(true);
            expect(res1.username).toBe('KHUSHAL');
            expect(res1.system).toBe('DEV - Client 220');

            const req2 = {
                data: { username: 'CUSTOM_DEV_USER', password: 'any' }
            };
            const res2 = await service._handleLogin(req2);
            expect(res2.authenticated).toBe(true);
            expect(res2.username).toBe('CUSTOM_DEV_USER');
            expect(res2.system).toBe('DEV - Client 220');
        });

        it('should validate credentials against authAdapter when username is not a dev user', async () => {
            process.env.ENABLE_DEV_TOKEN_ISSUER = 'true';
            process.env.LOCAL_AUTH_SECRET = 'secret1234567890';

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
            expect(authAdapter.validateCredentials).toHaveBeenCalledWith('REAL_SAP_USER', 'realpassword');
        });
    });
});
