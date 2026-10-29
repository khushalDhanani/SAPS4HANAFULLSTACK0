'use strict';
/* global window, document */

/**
 * Tier A read-only screen checks shared by the business E2E suites (docs/e2e-coverage-matrix.md).
 * A session always runs behind the Tier 0 write guard, so opening and navigating screens cannot write to SAP.
 */

const { chromium } = require('../playwrightLoader');
const { installWriteGuard } = require('./writeGuard');
const evidence = require('./evidence');
const { parseMetadata, checkRequest } = require('./contract');
const { batchParts } = require('./actionRoundTrip');
const { createRequestTracker } = require('./requestTracker');

// CAP mock users (package.json cds.requires.auth.users); the UI session mirrors their roles.
const USERS = {
    alice: ['Admin', 'Viewer', 'PurchasingManager', 'SalesRepresentative', 'SalesManager', 'WarehouseClerk', 'WarehouseManager'],
    bob: ['Viewer']
};

const SERVICE_URL = /\/odata\/v4\/([^/?]+)\/([^?]*(?:\?.*)?)$/;
const metaCache = new Map(); // `${baseUrl}|${service}` -> Promise<{ meta } | { error }>

/** Service $metadata, fetched once per run with a GET (read-only). */
function serviceMeta(baseUrl, service) {
    const key = `${baseUrl}|${service}`;
    if (!metaCache.has(key)) {
        metaCache.set(key, fetch(`${baseUrl}/odata/v4/${service}/$metadata`, { headers: { Authorization: 'Basic ' + Buffer.from('alice:').toString('base64') } })
            .then(async (r) => (r.ok ? { meta: parseMetadata(await r.text()) } : { error: `HTTP ${r.status}` }), (e) => ({ error: e.message })));
    }
    return metaCache.get(key);
}

const IGNORED = /i18n_en_US\.properties|favicon|livereload/;

// UI5 resources are version-pinned (index.html), so one download serves every context of the run
const ui5Cache = new Map(); // url -> { status, headers, body }

/** Serves ui5.sap.com GETs from memory after the first fetch; anything else falls through to the next route (the write guard). */
function installUi5Cache(context) {
    return context.route('https://ui5.sap.com/**', async (route) => {
        const req = route.request();
        if (req.method() !== 'GET') return route.fallback();
        const hit = ui5Cache.get(req.url());
        if (hit) return route.fulfill(hit);
        const res = await route.fetch();
        if (res.status() !== 200) return route.fulfill({ response: res });
        const { 'content-encoding': _enc, 'content-length': _len, ...headers } = res.headers(); // body() is already decoded
        const entry = { status: 200, headers, body: await res.body() };
        ui5Cache.set(req.url(), entry);
        return route.fulfill(entry);
    });
}

const QUIET_MS = Number(process.env.E2E_SETTLE_QUIET_MS) || 400; // no request in flight for this long = settled

let sharedBrowser = null; // one Chromium per process; every session still gets its own isolated context

/** Launches Chromium on first use and again if it died; sessions share it, never a context. */
function getBrowser() {
    if (!sharedBrowser) {
        const launched = chromium.launch({ headless: true });
        sharedBrowser = launched;
        launched.then((b) => b.on('disconnected', () => { if (sharedBrowser === launched) sharedBrowser = null; }), () => { sharedBrowser = null; });
    }
    return sharedBrowser;
}

/** Closes the shared browser (end of a process that opened sessions). Safe to call twice. */
async function closeBrowser() {
    const pending = sharedBrowser;
    sharedBrowser = null;
    if (pending) await (await pending).close().catch(() => {});
}

/**
 * user: a CAP mock user name, or null for a signed-out browser (no Basic header, no stored UI session).
 * allowWrites: only for gated live Tier C runs (support/liveWriteGate.js) — exact action paths the guard lets through.
 */
async function openSession({ baseUrl, user = 'alice', allowWrites = [] }) {
    const browser = await getBrowser();
    const context = await browser.newContext({
        extraHTTPHeaders: user ? { Authorization: 'Basic ' + Buffer.from(`${user}:`).toString('base64') } : {},
        viewport: { width: 1440, height: 900 }
    });
    const blocked = await installWriteGuard(context, { allowWrites });
    await installUi5Cache(context); // registered after the guard, so it is asked first and only for ui5.sap.com GETs
    const trace = await evidence.startSession(context); // null outside the runner
    const page = await context.newPage();
    const consoleErrors = [];
    const networkErrors = [];

    page.on('console', (msg) => {
        const loc = (msg.location() && msg.location().url) || '';
        // UI5 logs carry a timestamp and a stack trace; keep the first line only
        if (msg.type() === 'error' && !IGNORED.test(msg.text()) && !IGNORED.test(loc)) consoleErrors.push(msg.text().split('\n')[0].replace(/^\d{4}-\d\d-\d\d [\d:.]+ /, '').slice(0, 300));
    });
    page.on('pageerror', (err) => consoleErrors.push('PAGEERROR: ' + err.message.split('\n')[0].slice(0, 300)));
    page.on('response', (res) => {
        if (res.status() >= 400 && !IGNORED.test(res.url())) networkErrors.push({ status: res.status(), url: res.url() });
    });
    const contractSeen = new Set();
    const contractPending = [];
    /** Request-side contract (support/contract.js): the UI may only ask a CAP service for names its $metadata declares. */
    function contractCheck(service, path) {
        contractPending.push(serviceMeta(baseUrl, service).then((m) => {
            const errs = m.error ? [`$metadata of ${service} unavailable (${m.error})`] : checkRequest(m.meta, path);
            errs.forEach((e) => {
                const msg = `CONTRACT: ${service}: ${e}`;
                if (!contractSeen.has(msg)) { contractSeen.add(msg); consoleErrors.push(msg); }
            });
        }));
    }
    const tracker = createRequestTracker(page, { user });
    page.on('request', (req) => {
        const m = SERVICE_URL.exec(req.url());
        if (!m) return;
        if (req.method() === 'GET') contractCheck(m[1], m[2]);
        else if (req.method() === 'POST' && m[2] === '$batch') {
            batchParts(req.postData()).filter((p) => p.method === 'GET').forEach((p) => contractCheck(m[1], p.url.replace(/^\/+/, '')));
        }
    });

    if (user) {
        await page.addInitScript(([username, scopes]) => {
            window.localStorage.setItem('saps4hana_fiori_auth_session', JSON.stringify({
                user: { username, avatarInitials: username.slice(0, 2).toUpperCase(), system: 'E2E', loginTimestamp: '', token: null, scopes }
            }));
        }, [user, USERS[user] || []]);
    }

    /**
     * Waits until no request has been in flight for QUIET_MS (default 400 ms, max 30 s), then until no UI5 busy indicator is visible
     * (max 15 s). A screen that never settles throws, so the suite reports it instead of asserting on a half-loaded page.
     * A closed dialog keeps a hidden busy indicator in the DOM, so only visible ones count.
     */
    async function settle() {
        const end = Date.now() + 30000;
        let quietSince = Date.now();
        while (Date.now() < end) {
            if (tracker.size() > 0) quietSince = Date.now();
            if (Date.now() - quietSince >= QUIET_MS) break;
            await page.waitForTimeout(100);
        }
        if (tracker.size() > 0) throw new Error(`settle: ${tracker.size()} request(s) still in flight after 30 s: ${tracker.describe()}`);
        await page.waitForFunction(
            () => ![...document.querySelectorAll('.sapUiLocalBusyIndicator, .sapUiBusyIndicator')].some((e) => e.getClientRects().length > 0),
            null, { timeout: 15000 }
        ).catch(() => { throw new Error('settle: a UI5 busy indicator was still visible after 15 s'); });
        await Promise.all(contractPending);
    }

    return {
        baseUrl, page, blocked, consoleErrors, networkErrors, settle,
        close: async () => {
            if (trace) await trace.capture(page);
            await context.close(); // the browser stays up for the next session
        }
    };
}

/** Snapshot of the displayed UI5 screen: matched route, page title, bound lists, visible error UI. */
function inspectScreen(page) {
    return page.evaluate(() => {
        const sap = window.sap;
        const Element = sap.ui.require('sap/ui/core/Element');
        const Component = sap.ui.require('sap/ui/core/Component');
        const HashChanger = sap.ui.require('sap/ui/core/routing/HashChanger');
        // offsetParent is null for position:fixed dialogs, so check rendered boxes instead
        const visible = (dom) => !!dom && dom.getClientRects().length > 0;

        const comp = Component && Component.registry.filter((c) => c.getRouter && c.getRouter())[0];
        const router = comp && comp.getRouter();
        const hash = HashChanger ? HashChanger.getInstance().getHash() : '';
        const info = router && router.getRouteInfoByHash(hash);

        const lists = (Element ? Element.registry.filter((c) => c.isA(['sap.m.ListBase', 'sap.ui.table.Table']) && visible(c.getDomRef())) : [])
            .map((c) => {
                const b = c.getBinding('items') || c.getBinding('rows');
                return {
                    id: c.getId(),
                    bound: !!b,
                    length: b && b.getLength ? b.getLength() : null,
                    noDataText: c.getNoDataText ? c.getNoDataText() : ''
                };
            });

        const titleEl = [...document.querySelectorAll('.sapMPage .sapMTitle, .sapFDynamicPageTitle .sapMTitle, .sapUxAPObjectPageHeaderTitleText, .sapMTitle')]
            .find((e) => visible(e) && e.textContent.trim());
        const errorUi = [...document.querySelectorAll('.sapMMessageBox, .sapMMsgStripError')]
            .filter(visible).map((e) => e.textContent.trim().slice(0, 200));

        return { hash, route: info ? info.name : null, title: titleEl ? titleEl.textContent.trim() : '', lists, errorUi };
    });
}

/**
 * Opens #/<hash>, waits for the screen to settle and returns the checks for it.
 * expect: { route, needsList }. Failures are collected, not thrown, so one suite reports every screen.
 */
async function checkScreen(session, { hash, route, needsList = false, expectRows = false, fill }) {
    const { page } = session;
    const before = { console: session.consoleErrors.length, network: session.networkErrors.length, blocked: session.blocked.length };
    await page.goto(`${session.baseUrl}/fiori-app/webapp/index.html#/${hash}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => window.sap && window.sap.ui && window.sap.ui.require('sap/ui/core/Component'), null, { timeout: 30000 });
    await session.settle();
    if (fill) {
        // Types into an sap.m.Input (its inner <input>) and confirms with Enter, as a user would
        await page.fill(`[id$="--${fill.id}-inner"]`, fill.value);
        await page.press(`[id$="--${fill.id}-inner"]`, 'Enter');
        await session.settle();
    }
    return evaluate(session, { route, needsList, expectRows }, before);
}

/** Clicks the first row of the first visible bound list that has data, then checks the screen it leads to. */
async function openFirstRow(session, { route, needsList = false, fromFirstRow }) {
    const { page } = session;
    const before = { console: session.consoleErrors.length, network: session.networkErrors.length, blocked: session.blocked.length };
    // fromFirstRow may name the list's local id; otherwise the first navigable visible list is used
    const rowId = await page.evaluate((listId) => {
        const Element = window.sap.ui.require('sap/ui/core/Element');
        const navigable = (c) => c.hasListeners('itemPress') || ['Navigation', 'Active'].includes(c.getItems()[0].getType());
        const list = Element.registry.filter((c) => c.isA('sap.m.ListBase') && c.getDomRef() && c.getDomRef().getClientRects().length > 0
            && c.getItems().length > 0 && (listId ? c.getId().endsWith('--' + listId) : navigable(c)))[0];
        const item = list && list.getItems()[0];
        return item && item.getDomRef() ? item.getId() : null;
    }, typeof fromFirstRow === 'string' ? fromFirstRow : null);
    if (!rowId) return { route: null, skipped: 'no list row to open (list empty)', errors: [] };
    await page.click(`[id="${rowId}"]`);
    await session.settle();
    return evaluate(session, { route, needsList }, before);
}

async function evaluate(session, { route, needsList, expectRows }, before) {
    const screen = await inspectScreen(session.page);
    const errors = [];
    if (screen.route !== route) errors.push(`expected route ${route}, got ${screen.route || '(none)'} (hash "${screen.hash}")`);
    if (!screen.title) errors.push('no visible page title');
    if (needsList && !screen.lists.some((l) => l.bound)) errors.push('no visible bound list/table');
    if (expectRows && !screen.lists.some((l) => l.bound && l.length > 0)) errors.push('no bound list/table returned rows');
    screen.lists.filter((l) => /could not be loaded/i.test(l.noDataText)).forEach((l) => errors.push(`list ${l.id}: ${l.noDataText}`));
    screen.errorUi.forEach((t) => errors.push(`error UI shown: ${t}`));
    session.consoleErrors.slice(before.console).forEach((e) => errors.push(`console: ${e}`));
    session.networkErrors.slice(before.network).forEach((e) => errors.push(`HTTP ${e.status} ${e.url}`));
    session.blocked.slice(before.blocked).forEach((b) => errors.push(`write guard blocked ${b.reason}`));
    const counts = new Map();
    errors.forEach((e) => counts.set(e, (counts.get(e) || 0) + 1));
    return { ...screen, errors: [...counts].map(([e, n]) => (n > 1 ? `${e} (x${n})` : e)) };
}

/**
 * Runs a list of screen steps in one session and returns the runner's { status, errors, details } shape.
 * step: { name, route, needsList?, hash } to open a route, { name, route, fromFirstRow: true } to click the
 * first row of the screen opened by the previous step (or of the list with that local id when a string),
 * { name, route, hashFrom: (previousHash) => hash }, or { name, route, skip: 'reason' } when no data allows it.
 * Optional on an opened route: fill: { id, value } types into that input and presses Enter; expectRows: true.
 */
async function runScreens({ baseUrl, user, title, steps }) {
    console.log(`\n=== ${title} (user ${user === null ? '(signed out)' : user || 'alice'}, READ-ONLY, write guard on) ===`);
    const health = await fetch(`${baseUrl}/fiori-app/webapp/index.html`).then((r) => r.ok, () => false);
    if (!health) {
        console.log(`  [FAIL] server not reachable at ${baseUrl}`);
        return { status: 'FAIL', errors: [`server not reachable at ${baseUrl}`], details: [] };
    }
    const session = await openSession({ baseUrl, user });
    const details = [];
    const errors = [];
    try {
        let lastHash = null;
        for (const step of steps) {
            let res;
            try {
                if (step.skip) {
                    res = { route: null, skipped: step.skip, errors: [] };
                } else if (step.hashFrom && !lastHash) {
                    res = { route: null, skipped: 'previous screen did not open', errors: [] };
                } else {
                    res = step.fromFirstRow
                        ? await openFirstRow(session, step)
                        : await checkScreen(session, step.hashFrom ? { ...step, hash: step.hashFrom(lastHash) } : step);
                }
            } catch (err) {
                res = { route: null, errors: [`${err.name}: ${err.message.split('\n')[0]}`] };
            }
            const status = res.skipped ? 'SKIPPED' : (res.errors.length ? 'FAIL' : 'PASS');
            lastHash = res.route === step.route ? res.hash : null;
            const rows = (res.lists || []).map((l) => `${l.id.split('--').pop()}=${l.length}`).join(', ');
            console.log(`  [${status}] ${step.name}${res.skipped ? ` — ${res.skipped}` : ''}${rows ? ` (rows: ${rows})` : ''}`);
            res.errors.forEach((e) => console.log(`      - ${e}`));
            details.push({ step: step.name, status, route: res.route, title: res.title, lists: res.lists, skipped: res.skipped, errors: res.errors });
            res.errors.forEach((e) => errors.push(`${step.name}: ${e}`));
        }
    } finally {
        await session.close();
    }
    return { status: errors.length ? 'FAIL' : 'PASS', errors, details };
}

module.exports = { openSession, closeBrowser, checkScreen, openFirstRow, inspectScreen, runScreens, USERS };
