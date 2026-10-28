'use strict';
/* global window, document, MutationObserver */

/**
 * List latency profile, READ-ONLY behind the write guard (diagnosis, no pass/fail limits).
 * Per list route: navigation -> first OData response -> first rendered row -> settled screen, plus every CAP request
 * with its $top/$skip/$count, duration and size, duplicates, and the DOM size at the end. Output is evidence for deciding
 * whether paging, $top or extra reads cause the latency; it asserts nothing. Run: TARGET_URL=... node <this file>
 */

const fs = require('fs');
const path = require('path');
const { openSession, inspectScreen } = require('../support/screenCheck');

const ROOT = path.join(__dirname, '../../..');
const ROUTES = ['purchaseOrders', 'salesInquiries', 'salesOrders', 'ordersDueForDelivery', 'customerInvoices', 'customerReturns',
    'wmHandlingUnits', 'wmReservationEntryList', 'wmGoodsReceipt', 'wmQuarantineLabels', 'wmPackingInstructions'];
const ROW = '.sapMLIB, .sapUiTableRow, tr.sapMListTblRow';

function listRoutes() {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'app/fiori-app/webapp/manifest.json'), 'utf8'));
    return manifest['sap.ui5'].routing.routes.filter((r) => ROUTES.includes(r.name));
}

/** Records, inside the page, when the first row appeared and how many DOM nodes the screen ends with. */
function installRowProbe(page) {
    return page.addInitScript((sel) => {
        window.__probe = { firstRowMs: null };
        const seen = () => {
            if (window.__probe.firstRowMs === null && document.querySelector(sel)) window.__probe.firstRowMs = Math.round(performance.now());
        };
        new MutationObserver(seen).observe(document, { childList: true, subtree: true });
    }, ROW);
}

async function profile(baseUrl, r) {
    const session = await openSession({ baseUrl, user: 'alice' });
    const { page } = session;
    const calls = [];
    page.on('request', (req) => { if (/\/odata\/v4\//.test(req.url())) req.__t0 = Date.now(); });
    page.on('response', async (res) => {
        const req = res.request();
        if (!/\/odata\/v4\//.test(res.url())) return;
        let size = 0;
        try { size = (await res.body()).length; } catch (_e) { /* aborted */ }
        const body = req.postData() || '';
        calls.push({ at: req.__t0, ms: Date.now() - req.__t0, status: res.status(), size,
            url: decodeURIComponent(res.url().split('/odata/v4/')[1]).slice(0, 140),
            batch: [...body.matchAll(/^GET (\S+)/gm)].map((m) => decodeURIComponent(m[1]).slice(0, 140)) });
    });
    try {
        await installRowProbe(page);
        const t0 = Date.now();
        await page.goto(`${baseUrl}/fiori-app/webapp/index.html#/${r.pattern}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForFunction(() => window.sap && window.sap.ui && window.sap.ui.require('sap/ui/core/Component'), null, { timeout: 30000 });
        const tBoot = Date.now() - t0;
        await session.settle();
        const tSettled = Date.now() - t0;
        const screen = await inspectScreen(page);
        const dom = await page.evaluate((sel) => ({ rows: document.querySelectorAll(sel).length, nodes: document.getElementsByTagName('*').length,
            firstRowMs: window.__probe.firstRowMs }), ROW);
        const first = calls.slice().sort((a, b) => a.at - b.at + a.ms - b.ms)[0];
        const reqs = calls.map((c) => c.batch.length ? c.batch.map((b) => `${b} [batch]`) : [c.url]).flat();
        const dupes = reqs.filter((u, i) => reqs.indexOf(u) !== i);
        return { route: r.name, bootMs: tBoot, firstResponseMs: first ? first.at - t0 + first.ms : null, firstRowMs: dom.firstRowMs,
            settledMs: tSettled, quietWindowMs: 800, requests: calls.length, bytes: calls.reduce((s, c) => s + c.size, 0), dupes: dupes.length,
            renderedRows: dom.rows, domNodes: dom.nodes, shownRoute: screen.route, slowest: calls.sort((a, b) => b.ms - a.ms).slice(0, 4).map((c) => ({ ms: c.ms, size: c.size, url: c.batch.length ? c.batch.join(' | ') : c.url })) };
    } finally {
        await session.close();
    }
}

async function main() {
    const baseUrl = (process.env.TARGET_URL || 'http://localhost:4004').replace(/\/+$/, '');
    const out = [];
    for (const r of listRoutes()) {
        const p = await profile(baseUrl, r).catch((e) => ({ route: r.name, error: e.message.split('\n')[0] }));
        out.push(p);
        console.log(JSON.stringify(p));
    }
    return out;
}

if (require.main === module) main().then(() => process.exit(0));

module.exports = { profile };
