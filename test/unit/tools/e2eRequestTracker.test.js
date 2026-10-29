'use strict';

const { EventEmitter } = require('events');
const { createRequestTracker } = require('../../e2e/support/requestTracker');

const request = (method, url) => ({ method: () => method, url: () => url });
const page = (url = 'http://localhost:4004/fiori-app/webapp/index.html#/mm/purchase-orders/create') => Object.assign(new EventEmitter(), { url: () => url });

describe('request tracker', () => {
    it('counts a request until it finishes', () => {
        const p = page(); const t = createRequestTracker(p); const r = request('GET', 'http://x/odata/v4/a/B');
        p.emit('request', r);
        expect(t.size()).toBe(1);
        p.emit('requestfinished', r);
        expect(t.size()).toBe(0);
    });

    it('counts a failed or aborted request as done', () => {
        const p = page(); const t = createRequestTracker(p); const r = request('POST', 'http://x/odata/v4/a/$batch');
        p.emit('request', r);
        p.emit('requestfailed', r);
        expect(t.size()).toBe(0);
    });

    it('cannot drift on duplicate or unknown finish events', () => {
        const p = page(); const t = createRequestTracker(p); const a = request('GET', 'http://x/1'); const b = request('GET', 'http://x/2');
        p.emit('request', a);
        p.emit('requestfinished', a);
        p.emit('requestfinished', a); // duplicate
        p.emit('requestfailed', b); // never started
        expect(t.size()).toBe(0);
        p.emit('request', b);
        expect(t.size()).toBe(1);
    });

    it('describes each outstanding request with method, URL, service, start, elapsed, screen and user', () => {
        let clock = 1000; const p = page(); const t = createRequestTracker(p, { user: 'alice', now: () => clock });
        const slow = request('POST', 'http://localhost:4004/odata/v4/purchase-order/$batch');
        const events = request('GET', 'http://localhost:4004/ai/chat/stream');
        p.emit('request', slow);
        clock = 1500;
        p.emit('request', events);
        p.emit('response', { request: () => events });
        clock = 31000;
        const text = t.describe();
        expect(text).toContain('screen #/mm/purchase-orders/create, user alice');
        expect(text).toContain('POST http://localhost:4004/odata/v4/purchase-order/$batch [service purchase-order] started 1970-01-01T00:00:01.000Z, open 30000 ms, no response received');
        expect(text).toContain('GET http://localhost:4004/ai/chat/stream started 1970-01-01T00:00:01.500Z, open 29500 ms, response headers received but body not finished');
        expect(text.indexOf('$batch')).toBeLessThan(text.indexOf('/ai/chat'));
    });

    it('names a signed-out user and forgets everything when the page closes', () => {
        const p = page(); const t = createRequestTracker(p, { user: null });
        p.emit('request', request('GET', 'http://x/1'));
        expect(t.describe()).toContain('user signed out');
        p.emit('close');
        expect(t.size()).toBe(0);
    });
});
