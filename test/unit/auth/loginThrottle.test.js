const { LoginThrottle } = require('../../../srv/auth/loginThrottle');

describe('Unit: loginThrottle (failed sign-in limiter)', () => {
    let clock;
    const make = (env = {}) => new LoginThrottle({ env, now: () => clock });

    beforeEach(() => { clock = 1000000; });

    it('allows attempts below the per-user limit and blocks at it (default 3)', () => {
        const t = make();
        t.recordFailure('JSmith', '10.0.0.1');
        t.recordFailure('jsmith', '10.0.0.2');
        expect(t.check('JSMITH', '10.0.0.3').allowed).toBe(true);
        t.recordFailure('jsmith', '10.0.0.3');
        const blocked = t.check('JSMITH', '10.0.0.9');
        expect(blocked.allowed).toBe(false);
        expect(blocked.retryAfterSec).toBe(900);
    });

    it('blocks one address that tries many user names (default 20)', () => {
        const t = make();
        for (let i = 0; i < 20; i++) t.recordFailure(`user${i}`, '10.0.0.1');
        expect(t.check('someone-else', '10.0.0.1').allowed).toBe(false);
        expect(t.check('someone-else', '10.0.0.2').allowed).toBe(true);
    });

    it('lets the user in again when the window has passed', () => {
        const t = make({ LOGIN_FAILURE_WINDOW_SEC: '60' });
        for (let i = 0; i < 3; i++) t.recordFailure('a', '');
        expect(t.check('a', '').allowed).toBe(false);
        clock += 60 * 1000;
        expect(t.check('a', '').allowed).toBe(true);
    });

    it('a success clears the user counter but not the address counter', () => {
        const t = make({ LOGIN_MAX_FAILURES_PER_IP: '2' });
        t.recordFailure('a', '10.0.0.1');
        t.recordFailure('a', '10.0.0.1');
        t.recordSuccess('A');
        expect(t.check('a', '10.0.0.5').allowed).toBe(true);
        expect(t.check('a', '10.0.0.1').allowed).toBe(false);
    });

    it('reads its limits from the environment and ignores invalid values', () => {
        const t = make({ LOGIN_MAX_FAILURES_PER_USER: '1', LOGIN_MAX_FAILURES_PER_IP: 'abc' });
        t.recordFailure('a', '10.0.0.1');
        expect(t.check('a', '').allowed).toBe(false);
        expect(t.check('b', '10.0.0.1').allowed).toBe(true);
    });

    describe('proxyNotTrusted (reverse proxy in front, TRUST_PROXY_HOPS not set)', () => {
        const request = (forwardedFor, trustProxy) => ({
            headers: forwardedFor ? { 'x-forwarded-for': forwardedFor } : {},
            app: { get: (name) => (name === 'trust proxy' ? trustProxy : undefined) }
        });

        it('is true once for a forwarded request the app does not trust, and again after reset', () => {
            const t = make();
            expect(t.proxyNotTrusted(request('10.1.2.3', false))).toBe(true);
            expect(t.proxyNotTrusted(request('10.1.2.4', false))).toBe(false);
            t.reset();
            expect(t.proxyNotTrusted(request('10.1.2.3', false))).toBe(true);
        });

        it('is false for a direct request, a trusted proxy and a missing request', () => {
            const t = make();
            expect(t.proxyNotTrusted(request('', false))).toBe(false);
            expect(t.proxyNotTrusted(request('10.1.2.3', 1))).toBe(false);
            expect(t.proxyNotTrusted(undefined)).toBe(false);
            expect(t.proxyNotTrusted({ headers: { 'x-forwarded-for': '10.1.2.3' } })).toBe(true);
        });
    });

    it('does not grow without bound', () => {
        const t = make();
        for (let i = 0; i < 10050; i++) t.recordFailure(`u${i}`, '');
        expect(t._failures.size).toBeLessThanOrEqual(10000);
    });
});
