const { resolveUserIdentity } = require('../../../srv/auth/userIdentity');
const salesInquiryHandler = require('../../../srv/sd/sales-inquiry/handlers/salesInquiry.handler');
const purchaseOrderHandler = require('../../../srv/mm/purchase-order/handlers/purchaseOrder.handler');

describe('Unit: Shared User Identity Resolution (srv/auth/userIdentity)', () => {
    const originalEnv = process.env.S4_USER;

    afterEach(() => {
        if (originalEnv !== undefined) {
            process.env.S4_USER = originalEnv;
        } else {
            delete process.env.S4_USER;
        }
    });

    it('should be exported identically by salesInquiry and purchaseOrder handlers', () => {
        expect(salesInquiryHandler.resolveUserIdentity).toBe(resolveUserIdentity);
        expect(purchaseOrderHandler.resolveUserIdentity).toBe(resolveUserIdentity);
    });

    it('should derive user identity from XSUAA logon_name attribute', () => {
        const req = {
            user: {
                id: '12345',
                attr: { logon_name: 'XSUAA_USER' }
            }
        };
        expect(resolveUserIdentity(req)).toBe('XSUAA_USER');
    });

    it('should derive user identity from XSUAA email attribute when logon_name is absent', () => {
        const req = {
            user: {
                id: '12345',
                attr: { email: 'sales.rep@example.com' }
            }
        };
        expect(resolveUserIdentity(req)).toBe('sales.rep');
    });

    it('should derive user identity from CAP req.user.id when authenticated and not anonymous', () => {
        const req = {
            user: {
                id: 'SALES_REP_01'
            }
        };
        expect(resolveUserIdentity(req)).toBe('SALES_REP_01');
    });

    it('should derive user identity from CAP req.user.name when id is anonymous', () => {
        const req = {
            user: {
                id: 'anonymous',
                name: 'NAMED_USER'
            }
        };
        expect(resolveUserIdentity(req)).toBe('NAMED_USER');
    });

    it('should derive user identity from custom header x-user-id in non-production', () => {
        const req = {
            user: { id: 'anonymous' },
            headers: { 'x-user-id': 'DEV_SALES_REP' }
        };
        expect(resolveUserIdentity(req)).toBe('DEV_SALES_REP');
    });

    it('should derive user identity from req._.req.headers x-user-id in non-production', () => {
        const req = {
            user: { id: 'anonymous' },
            _: {
                req: {
                    headers: { 'x-user-id': 'EXPRESS_HEADER_USER' }
                }
            }
        };
        expect(resolveUserIdentity(req)).toBe('EXPRESS_HEADER_USER');
    });

    it('should fall back to process.env.S4_USER when unauthenticated in development', () => {
        delete process.env.S4_USER;
        process.env.S4_USER = 'CONFIGURED_S4_USER';
        const req = { user: { id: 'anonymous' } };
        expect(resolveUserIdentity(req)).toBe('CONFIGURED_S4_USER');
    });

    it('should fall back to SYSTEM when request is unauthenticated and no env user is set in development', () => {
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
                    attr: { logon_name: 'PROD_SALES_REP' }
                }
            };
            expect(resolveUserIdentity(req)).toBe('PROD_SALES_REP');
        });

        it('should derive identity from trusted XSUAA email in production', () => {
            const req = {
                user: {
                    id: '12345',
                    attr: { email: 'prod.sales@example.corp' }
                }
            };
            expect(resolveUserIdentity(req)).toBe('prod.sales');
        });

        it('should IGNORE client-supplied x-user-id header in production and fail closed', () => {
            const req = {
                user: { id: 'anonymous' },
                headers: { 'x-user-id': 'MALICIOUS_CLIENT_USER' }
            };
            expect(() => resolveUserIdentity(req)).toThrow(
                'Authentication required: Trusted user identity cannot be determined'
            );
        });

        it('should fail closed when unauthenticated without falling back to S4_USER or SYSTEM in production', () => {
            process.env.S4_USER = 'INSECURE_FALLBACK';
            const req = { user: { id: 'anonymous' } };
            expect(() => resolveUserIdentity(req)).toThrow(
                'Authentication required: Trusted user identity cannot be determined'
            );
        });

        it('should fail closed when req is null in production', () => {
            expect(() => resolveUserIdentity(null)).toThrow(
                'Authentication required: Missing request context in production'
            );
        });

        it('should fail closed when req is undefined in production', () => {
            expect(() => resolveUserIdentity(undefined)).toThrow(
                'Authentication required: Missing request context in production'
            );
        });
    });
});
