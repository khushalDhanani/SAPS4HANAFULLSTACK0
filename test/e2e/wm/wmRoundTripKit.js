'use strict';
/* global window, document */

/**
 * Small helpers shared by the WM Tier C round-trip suites (roundTripScanTo, roundTripMvt261, roundTripHandlingUnit,
 * roundTripPackingInstruction, roundTripReservationRetry). Same patterns as roundTripHuTransfer.e2e.js:
 * dry-run = write guard on + page.route stub for exactly the expected action path(s); live = allowWrites with exact
 * path regexes, one submit, never retried. All CAP reads here are GET-only.
 */

const { resolveMode } = require('../support/liveWriteGate');

const AUTH = { Authorization: 'Basic ' + Buffer.from('alice:').toString('base64') };
const RESTART = /ECONNREFUSED|ECONNRESET|ERR_CONNECTION|ERR_EMPTY_RESPONSE|fetch failed|socket hang up|server not healthy|HTTP 50[23]/;

async function waitForHealth(baseUrl) {
    const end = Date.now() + 90000;
    while (Date.now() < end) {
        if (await fetch(`${baseUrl}/health`).then((r) => r.ok, () => false)) return true;
        await new Promise((r) => setTimeout(r, 2000));
    }
    return false;
}

/** READ-ONLY CAP GET; returns body.value when present. */
async function getJson(baseUrl, path) {
    const res = await fetch(`${baseUrl}${path}`, { headers: AUTH });
    const text = await res.text();
    if (!res.ok) throw new Error(`GET ${path.split('(')[0]}: HTTP ${res.status} ${text.slice(0, 300)}`);
    const body = text ? JSON.parse(text) : null;
    return body && body.value !== undefined ? body.value : body;
}

/**
 * POST to an action that only reads SAP (e.g. verifyMaterialDocument: MATDOC/MSEG reads,
 * srv/integration/s4hana/wm/ReservationProcessAdapter.js:1100-1160). Live read-back only, from Node, outside the browser.
 */
async function postReadOnlyAction(baseUrl, path, body) {
    // Runs outside the browser write guard, so only the read-only verify* actions are accepted here.
    if (!/\/verify(MaterialDocument|Stock|Reservation)$/.test(path)) throw new Error(`postReadOnlyAction refuses non-read-only action ${path}`);
    const res = await fetch(`${baseUrl}${path}`, { method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => null) };
}

async function open(session, hash) {
    await session.page.goto(`${session.baseUrl}/fiori-app/webapp/index.html#/${hash}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await session.page.waitForFunction(() => window.sap && window.sap.ui && window.sap.ui.require('sap/ui/core/Component'), null, { timeout: 30000 });
    await session.settle();
}

/** A named JSON model of the view that owns the control with the given local id (copy of its data). */
function viewModel(page, controlId, model) {
    return page.evaluate(([id, name]) => {
        const c = window.sap.ui.require('sap/ui/core/Element').registry.filter((e) => e.getId().endsWith('--' + id))[0];
        const m = c && c.getModel(name);
        return m ? JSON.parse(JSON.stringify(m.getData())) : null;
    }, [controlId, model]);
}

/** Current router hash. */
function currentHash(page) {
    return page.evaluate(() => window.sap.ui.require('sap/ui/core/routing/HashChanger').getInstance().getHash());
}

/**
 * Failure mode for the submit-failure E2E (negative/verifyActionFailures): while set, every stubbed action answers the
 * failure instead of its success stub ({ status, code, message } = OData error, 'timeout' = aborted request).
 * capWaits(ms) caps waitForToast so a failed write is observed after ms instead of the suites' 2-3 minute success waits.
 */
let failure = null;
let waitCap = Infinity;
let delayMs = 0;
let actionGate = null;
function setFailure(f) { failure = f; }
function capWaits(ms) { waitCap = ms; }
function setDelay(ms) { delayMs = ms || 0; }
function setGate(g) { actionGate = g || null; }
function failAction(route) {
    if (failure === 'timeout') return route.abort('timedout');
    return route.fulfill({
        status: failure.status,
        contentType: 'application/json;odata.metadata=minimal',
        headers: { 'OData-Version': '4.0' },
        body: JSON.stringify({ error: { code: failure.code || String(failure.status), message: failure.message } })
    });
}

/**
 * Dry-run stub for exactly one action path, registered after the session's guard so it wins for that URL only.
 * respond(body, callIndex) returns the CAP-serialized action result. Returns the live list of recorded calls.
 */
async function stubAction(session, path, respond) {
    const calls = [];
    await session.page.route((url) => url.pathname === path, async (route) => {
        const body = route.request().postDataJSON() || {};
        calls.push({ path, method: route.request().method(), body });
        if (actionGate) await actionGate;
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
        const answer = (p) => (delayMs || actionGate ? p.catch(() => {}) : p);
        if (failure) return answer(failAction(route));
        return answer(route.fulfill({
            status: 200,
            contentType: 'application/json;odata.metadata=minimal;IEEE754Compatible=true',
            headers: { 'OData-Version': '4.0' },
            body: JSON.stringify(respond(body, calls.length - 1))
        }));
    });
    return calls;
}

/** Records the POSTs a live run sends to the allowed action paths (for payload assertions). */
function recordPosts(session, paths) {
    const calls = [];
    session.page.on('request', (req) => {
        const p = new URL(req.url()).pathname;
        if (req.method() === 'POST' && paths.includes(p)) calls.push({ path: p, method: 'POST', body: req.postDataJSON() });
    });
    return calls;
}

/** Waits for a MessageToast whose text contains every given fragment; returns its text or null. */
async function waitForToast(page, fragments, timeout = 20000) {
    timeout = Math.min(timeout, waitCap);
    const handle = await page.waitForFunction((f) => [...document.querySelectorAll('.sapMMessageToast')]
        .map((e) => e.textContent).find((t) => f.every((x) => t.includes(x))) || null, fragments, { timeout }).catch(() => null);
    return handle ? handle.jsonValue() : null;
}

/** Clicks a button inside the open MessageBox by its exact text. */
async function messageBoxButton(page, text) {
    await page.locator('.sapMMessageBox').getByRole('button', { name: text, exact: true }).click();
}

/** Text of a visible MessageBox, if any. */
async function messageBoxText(page) {
    const box = page.locator('.sapMMessageBox').first();
    return (await box.isVisible().catch(() => false)) ? (await box.innerText()).trim() : '';
}

/**
 * Guard blocks, console errors and HTTP >= 400 of the session. ignore: RegExp of URLs/console lines that are a
 * direct, expected consequence of a dry-run stub (e.g. the follow-up read of a synthetic stub key).
 */
function sessionErrors(session, ignore) {
    const keep = (s) => !(ignore && ignore.test(s));
    // Chrome logs each failed request as a console line without its URL: drop one such line per ignored response
    const skip = session.networkErrors.filter((e) => !keep(e.url)).map((e) => `status of ${e.status} `);
    const consoleKept = session.consoleErrors.filter((line) => {
        const i = skip.findIndex((s) => line.startsWith('Failed to load resource') && line.includes(s));
        if (i < 0) return keep(line);
        skip.splice(i, 1);
        return false;
    });
    return [
        ...consoleKept.map((e) => `console: ${e}`),
        ...session.networkErrors.filter((e) => keep(e.url)).map((e) => `HTTP ${e.status} ${e.url}`),
        ...session.blocked.map((b) => `write guard blocked ${b.reason}`)
    ];
}

/** Checks the recorded calls hit exactly the expected paths, in order. */
function expectCalls(calls, expectedPaths) {
    const got = calls.map((c) => c.path);
    return got.length === expectedPaths.length && got.every((p, i) => p === expectedPaths[i])
        ? [] : [`expected action calls [${expectedPaths.join(', ')}], got [${got.join(', ')}]`];
}

/**
 * Suite runner: resolves the mode for the flow, waits for the server, runs dryRun(baseUrl) or live(baseUrl, data) and
 * prints the result. A dry-run that fails only because cds watch restarted is run once more.
 */
async function runSuite({ flow, title, dryRun, live }, options = {}) {
    const baseUrl = (options.baseUrl || process.env.TARGET_URL || 'http://localhost:4004').replace(/\/+$/, '');
    let mode;
    try {
        mode = resolveMode(flow);
    } catch (err) {
        console.log(`  [FAIL] ${err.message}`);
        return { status: 'FAIL', mode: 'blocked', errors: [err.message], details: {} };
    }
    console.log(`\n=== ${title} (${mode.mode === 'live' ? 'LIVE SAP WRITE' : 'READ-ONLY dry-run, write guard on, actions stubbed'}) ===`);
    let res;
    for (let attempt = 0; attempt < 2; attempt++) {
        if (!(await waitForHealth(baseUrl))) return { status: 'FAIL', mode: mode.mode, errors: [`server not healthy at ${baseUrl}`], details: {} };
        res = mode.mode === 'live' ? await live(baseUrl, mode.data) : await dryRun(baseUrl);
        if (mode.mode === 'live' || !res.errors.some((e) => RESTART.test(e))) break;
        console.log(`  server restarted during the dry-run; running it once more (${res.errors.find((e) => RESTART.test(e))})`);
    }
    const status = res.errors.length ? 'FAIL' : 'PASS';
    console.log(`  [${status}] ${title} ${mode.mode}`);
    res.errors.forEach((e) => console.log(`      - ${e}`));
    return { status, mode: mode.mode, errors: res.errors, details: res.details };
}

/** Standard `node <file>` entry point. */
function main(fn) {
    fn().then((r) => {
        console.log(JSON.stringify(r.details, null, 2));
        process.exit(r.status === 'PASS' ? 0 : 1);
    });
}

module.exports = {
    setFailure, capWaits, setDelay, setGate, AUTH, waitForHealth, getJson, postReadOnlyAction, open, viewModel, currentHash, stubAction, recordPosts,
    waitForToast, messageBoxButton, messageBoxText, sessionErrors, expectCalls, runSuite, main
};
