const { resolveUserIdentity } = require('../../srv/handlers/purchaseOrder.handler');

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

    it('should safely return SYSTEM when req is null or undefined', () => {
        delete process.env.S4_USER;
        expect(resolveUserIdentity(null)).toBe('SYSTEM');
        expect(resolveUserIdentity(undefined)).toBe('SYSTEM');
    });

});
