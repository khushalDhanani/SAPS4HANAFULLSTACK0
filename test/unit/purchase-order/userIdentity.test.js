const { resolveUserIdentity } = require('../../../srv/mm/purchase-order/handlers/purchaseOrder.handler');

describe('Unit: User Identity Resolution (resolveUserIdentity)', () => {
    const originalEnv = process.env.S4_USER;

    afterEach(() => {
        if (originalEnv !== undefined) {
            process.env.S4_USER = originalEnv;
        } else {
            delete process.env.S4_USER;
        }
    });

    it('should derive user identity from XSUAA logon_name attribute', () => {
        const req = {
            user: {
                id: '12345',
                attr: { logon_name: 'XSUAA_BUYER' }
            }
        };
        expect(resolveUserIdentity(req)).toBe('XSUAA_BUYER');
    });

    it('should derive user identity from XSUAA email attribute when logon_name is absent', () => {
        const req = {
            user: {
                id: '12345',
                attr: { email: 'john.doe@example.com' }
            }
        };
        expect(resolveUserIdentity(req)).toBe('john.doe');
    });

    it('should derive user identity from CAP req.user.id when authenticated and not anonymous', () => {
        const req = {
            user: {
                id: 'CB9980000001'
            }
        };
        expect(resolveUserIdentity(req)).toBe('CB9980000001');
    });

    it('should derive user identity from CAP req.user.name when id is anonymous', () => {
        const req = {
            user: {
                id: 'anonymous',
                name: 'CAP_USER'
            }
        };
        expect(resolveUserIdentity(req)).toBe('CAP_USER');
    });

    it('should derive user identity from custom header x-user-id', () => {
        const req = {
            user: { id: 'anonymous' },
            headers: { 'x-user-id': 'GATEWAY_BUYER' }
        };
        expect(resolveUserIdentity(req)).toBe('GATEWAY_BUYER');
    });

    it('should fall back to process.env.S4_USER when anonymous and no user info', () => {
        delete process.env.S4_USER;
        process.env.S4_USER = 'CONFIGURED_S4_USER';
        const req = { user: { id: 'anonymous' } };
        expect(resolveUserIdentity(req)).toBe('CONFIGURED_S4_USER');
    });

    it('should fall back to SYSTEM when request is unauthenticated and no env user is set', () => {
        delete process.env.S4_USER;
        const req = { user: { id: 'anonymous' } };
        expect(resolveUserIdentity(req)).toBe('SYSTEM');
    });

    it('should safely return SYSTEM when req is null or undefined in development', () => {
        delete process.env.S4_USER;
        expect(resolveUserIdentity(null)).toBe('SYSTEM');
        expect(resolveUserIdentity(undefined)).toBe('SYSTEM');
    });

    describe('Production Security Isolation (NODE_ENV=production)', () => {
        const origNodeEnv = process.env.NODE_ENV;

        beforeEach(() => {
            process.env.NODE_ENV = 'production';
        });

        afterEach(() => {
            process.env.NODE_ENV = origNodeEnv;
        });

        it('should derive identity from trusted XSUAA logon_name in production', () => {
            const req = {
                user: {
                    id: '12345',
                    attr: { logon_name: 'PROD_BUYER' }
                }
            };
            expect(resolveUserIdentity(req)).toBe('PROD_BUYER');
        });

        it('should IGNORE client-supplied x-user-id header in production and fail closed', () => {
            const req = {
                user: { id: 'anonymous' },
                headers: { 'x-user-id': 'MALICIOUS_CLIENT_USER' }
            };
            expect(() => resolveUserIdentity(req)).toThrow('Authentication required: Trusted user identity cannot be determined');
        });

        it('should fail closed when unauthenticated without falling back to SYSTEM in production', () => {
            const req = { user: { id: 'anonymous' } };
            expect(() => resolveUserIdentity(req)).toThrow('Authentication required: Trusted user identity cannot be determined');
        });

        it('should fail closed when req is null in production', () => {
            expect(() => resolveUserIdentity(null)).toThrow('Authentication required: Missing request context in production');
        });
    });

});
