'use strict';

/**
 * Tier 0 E2E write guard: Playwright suites must not write to SAP by accident.
 *
 * Every browser request is classified before it leaves the page. Reads pass: GET/HEAD/OPTIONS, and OData
 * `$batch` POSTs whose inner requests are all GET (UI5 OData V4 models send reads this way). Everything else
 * (action POSTs, PATCH/PUT/DELETE/MERGE, `$batch` containing a change, the AI stream) is aborted and recorded.
 * A suite that needs a live SAP write must not use this guard and needs the user's written go per call (AGENTS.md).
 */

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const BATCH_LINE = /^(GET|POST|PUT|PATCH|DELETE|MERGE)\s+\S+\s+HTTP\/1\.[01]\s*$/gm;

/** @returns {{ allow: boolean, reason: string }} */
function classifyRequest({ method, url, postData }) {
    const m = String(method || '').toUpperCase();
    if (READ_METHODS.has(m)) return { allow: true, reason: 'read method' };

    let pathname = '';
    try { pathname = new URL(url).pathname; } catch (_) { pathname = String(url || ''); }

    if (m === 'POST' && /\/\$batch$/.test(pathname)) {
        const inner = [...String(postData || '').matchAll(BATCH_LINE)].map((x) => x[1]);
        if (inner.length === 0) return { allow: false, reason: '$batch without readable request lines' };
        const writes = inner.filter((x) => x !== 'GET');
        return writes.length === 0
            ? { allow: true, reason: `$batch of ${inner.length} GET` }
            : { allow: false, reason: `$batch contains ${writes.join(', ')}` };
    }
    return { allow: false, reason: `${m} ${pathname}` };
}

/**
 * Routes every request of a Playwright context through classifyRequest.
 * @returns {Array<{ method: string, url: string, reason: string }>} live list of blocked requests
 */
async function installWriteGuard(context) {
    const blocked = [];
    await context.route('**/*', (route) => {
        const req = route.request();
        const verdict = classifyRequest({ method: req.method(), url: req.url(), postData: req.postData() });
        if (verdict.allow) return route.continue();
        blocked.push({ method: req.method(), url: req.url(), reason: verdict.reason });
        return route.abort('blockedbyclient');
    });
    return blocked;
}

module.exports = { classifyRequest, installWriteGuard };
