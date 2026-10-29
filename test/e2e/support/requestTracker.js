'use strict';

/**
 * Tracks the requests a Playwright page has started and not yet finished, so settle() can say WHICH request kept the
 * screen from settling. Keyed by the Request object, not a counter: a duplicate or unknown finish event cannot make the
 * count drift, and every outstanding request keeps its own method, URL and start time.
 */

const SERVICE_URL = /\/odata\/v4\/([^/?]+)\//;

function createRequestTracker(page, { user = null, now = Date.now } = {}) {
    const pending = new Map(); // Request -> { method, url, startedAt, responded }

    page.on('request', (req) => pending.set(req, { method: req.method(), url: req.url(), startedAt: now(), responded: false }));
    page.on('response', (res) => {
        const entry = pending.get(res.request());
        if (entry) entry.responded = true;
    });
    page.on('requestfinished', (req) => { pending.delete(req); });
    page.on('requestfailed', (req) => { pending.delete(req); }); // includes route.abort() and navigation cancellations
    page.on('close', () => pending.clear());

    return {
        size: () => pending.size,
        /** One line per outstanding request, oldest first, plus the screen and user they belong to. */
        describe() {
            const at = now();
            let screen = '?';
            try { screen = new URL(page.url()).hash || page.url(); } catch (_) { /* page closed */ }
            const lines = [...pending.values()].sort((a, b) => a.startedAt - b.startedAt).map((e) => {
                const service = (SERVICE_URL.exec(e.url) || [])[1];
                return `${e.method} ${e.url}${service ? ` [service ${service}]` : ''} started ${new Date(e.startedAt).toISOString()}, ` +
                    `open ${at - e.startedAt} ms, ${e.responded ? 'response headers received but body not finished' : 'no response received'}`;
            });
            return `screen ${screen}, user ${user || 'signed out'}: ${lines.join(' | ')}`;
        }
    };
}

module.exports = { createRequestTracker };
