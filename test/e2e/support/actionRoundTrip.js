'use strict';
/* global window */

/**
 * Helpers for Tier C round trips whose write is a CAP action called from a list/dialog (not a create form), and
 * whose result is a structured CDS type — cases runRoundTrip (support/roundTrip.js) does not cover.
 *
 * interceptAction() handles the one write action of a sub-case, whether the UI sends it as a direct POST
 * (ODataClient.post) or as the single request of an OData V4 `$batch` (ODataModel#bindContext(...).execute()):
 * - dry-run: the call is answered by a stub shaped like the CDS return type; nothing reaches CAP or SAP.
 * - live: the call is forwarded exactly once (route.fetch, never retried); everything else stays behind the
 *   session's write guard, so a `$batch` holding anything besides that one action call is still blocked.
 * A `$batch` that mixes the action with other requests is recorded as `mixed` and left to the guard (blocked).
 */

const { resolveMode } = require('./liveWriteGate');
const BATCH_LINE = /^(GET|POST|PUT|PATCH|DELETE|MERGE)\s+(\S+)\s+HTTP\/1\.[01]\s*$/gm;
const JSON_TYPE = 'application/json;odata.metadata=minimal;IEEE754Compatible=true';
const RESULT_BOX = '.sapMMessageBoxSuccess, .sapMMessageBoxError, .sapMMessageBoxWarning, .sapMMessageBoxInformation';

function batchParts(body) {
    return [...String(body || '').matchAll(BATCH_LINE)].map((m) => ({ method: m[1], url: m[2] }));
}

/** JSON body of the single request in a `$batch` (the text between its blank line and the closing boundary). */
function batchRequestJson(body) {
    const text = String(body || '');
    const start = text.indexOf('\r\n\r\n', text.search(BATCH_LINE));
    const end = text.indexOf('\r\n--', start + 4);
    const json = text.slice(start + 4, end).trim();
    return json ? JSON.parse(json) : {};
}

/** { status, json } of the single response inside a multipart `$batch` response. */
function batchResponseJson(text) {
    const status = Number((/HTTP\/1\.[01] (\d{3})/.exec(text) || [])[1]);
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    let json = null;
    try { json = start >= 0 ? JSON.parse(text.slice(start, end + 1)) : null; } catch (_) { json = null; }
    return { status, json };
}

function batchFulfill(json) {
    const b = 'batchresponse_dryrun';
    const body = `--${b}\r\nContent-Type: application/http\r\nContent-Transfer-Encoding: binary\r\n\r\n`
        + `HTTP/1.1 200 OK\r\nContent-Type: ${JSON_TYPE}\r\nOData-Version: 4.0\r\n\r\n${JSON.stringify(json)}\r\n--${b}--\r\n`;
    return { status: 200, headers: { 'Content-Type': `multipart/mixed; boundary=${b}`, 'OData-Version': '4.0' }, body };
}

/**
 * Registers the page-level route for `${service}/${action}` (after the session's guard, so it wins for that call only).
 * respond(body) → stub result (dry-run). Returns the live list of calls: { via, body, status, result } or { via, mixed }.
 */
async function interceptAction(page, { flow, service, action, live = false, respond }) {
    // Live forwarding bypasses the context write guard, so the gate is re-checked here instead of trusting the caller.
    if (live && resolveMode(flow).mode !== 'live') {
        throw new Error(`Blocked: live forwarding of ${service}/${action} requires an authorized live gate for flow "${flow}"`);
    }
    const calls = [];
    const direct = `${service}/${action}`;
    const batch = `${service}/$batch`;
    await page.route((url) => url.pathname === direct || url.pathname === batch, async (route) => {
        const req = route.request();
        if (req.method() !== 'POST') return route.fallback();
        const viaBatch = new URL(req.url()).pathname === batch;
        let body;
        if (viaBatch) {
            const parts = batchParts(req.postData());
            if (!parts.some((p) => p.method === 'POST' && p.url.split('?')[0] === action)) return route.fallback();
            if (parts.length !== 1) {
                calls.push({ via: 'batch', mixed: parts });
                return route.fallback();
            }
            body = batchRequestJson(req.postData());
        } else {
            body = req.postDataJSON() || {};
        }
        const call = { via: viaBatch ? 'batch' : 'direct', body };
        calls.push(call);
        if (!live) {
            call.status = 200;
            call.result = respond(body);
            return viaBatch
                ? route.fulfill(batchFulfill(call.result))
                : route.fulfill({ status: 200, contentType: JSON_TYPE, headers: { 'OData-Version': '4.0' }, body: JSON.stringify(call.result) });
        }
        // live: forwarded once; the response is read here and handed to the page unchanged
        const response = await route.fetch({ maxRetries: 0, timeout: 180000 });
        const text = await response.text();
        if (viaBatch) {
            const inner = batchResponseJson(text);
            call.status = inner.status;
            call.result = inner.json;
        } else {
            call.status = response.status();
            try { call.result = JSON.parse(text); } catch (_) { call.result = text; }
        }
        return route.fulfill({ response, body: text });
    });
    return calls;
}

async function waitForHealth(baseUrl) {
    const end = Date.now() + 90000;
    while (Date.now() < end) {
        if (await fetch(`${baseUrl}/health`).then((r) => r.ok, () => false)) return true;
        await new Promise((r) => setTimeout(r, 2000));
    }
    return false;
}

async function openHash(session, hash) {
    await session.page.goto(`${session.baseUrl}/fiori-app/webapp/index.html#/${hash}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await session.page.waitForFunction(() => window.sap && window.sap.ui && window.sap.ui.require('sap/ui/core/Component'), null, { timeout: 30000 });
    await session.settle();
}

/** Waits for the result MessageBox and returns { type, text } (type: success | error | warning | information). */
async function resultBox(page, timeout = 30000) {
    const box = page.locator(RESULT_BOX).last();
    await box.waitFor({ state: 'visible', timeout });
    const cls = (await box.getAttribute('class')) || '';
    const type = (/sapMMessageBox(Success|Error|Warning|Information)/.exec(cls) || [])[1] || '';
    return { type: type.toLowerCase(), text: (await box.innerText()).trim().replace(/\s+/g, ' ') };
}

/** Presses a button of the topmost open MessageBox by its text. */
async function pressBoxButton(session, text) {
    await session.page.locator('.sapMMessageBox').last().getByRole('button', { name: text, exact: true }).click();
    await session.settle();
}

/** Rendered, enabled, visible sap.m.Buttons whose id contains `--<localId>` (incl. table clones), with their row data. */
function listButtons(page, localId, modelName) {
    return page.evaluate(([id, model]) => {
        const Element = window.sap.ui.require('sap/ui/core/Element');
        const re = new RegExp(`--${id}(-|$)`);
        return Element.registry.filter((c) => c.isA('sap.m.Button') && re.test(c.getId()) && c.getEnabled() && c.getVisible() && c.getDomRef())
            .map((c) => {
                const ctx = model ? c.getBindingContext(model) : null;
                const obj = ctx ? ctx.getObject() : undefined;
                return { id: c.getId(), row: obj ? JSON.parse(JSON.stringify(obj)) : null };
            });
    }, [localId, modelName || null]);
}

/** Types into an sap.m.Input by view-local id (Enter fires its change handler), as a user would. */
async function typeInto(session, localId, value) {
    const sel = `[id$="--${localId}-inner"]`;
    await session.page.fill(sel, String(value));
    await session.page.press(sel, 'Enter');
    await session.settle();
}

/** Picks a key in an sap.m.Select/ComboBox by view-local id and fires its change event like a user selection. */
async function selectKey(session, localId, key) {
    const ok = await session.page.evaluate(([id, k]) => {
        const Element = window.sap.ui.require('sap/ui/core/Element');
        const c = Element.registry.filter((x) => x.getId().endsWith('--' + id))[0];
        if (!c) return `control ${id} not found`;
        const item = c.getItems().find((i) => i.getKey() === k);
        if (!item) return `${id} has no item ${k} (items: ${c.getItems().map((i) => i.getKey()).join(', ')})`;
        c.setSelectedKey(k);
        c.fireChange({ selectedItem: item, value: item.getText() });
        return true;
    }, [localId, String(key)]);
    if (ok !== true) throw new Error(ok);
    await session.settle();
}

/** JSON snapshot of a named model found on any control that has it. */
function modelData(page, name) {
    return page.evaluate((n) => {
        const Element = window.sap.ui.require('sap/ui/core/Element');
        const c = Element.registry.filter((x) => x.getModel && x.getModel(n) && x.getModel(n).getData)[0];
        return c ? JSON.parse(JSON.stringify(c.getModel(n).getData())) : null;
    }, name);
}

/**
 * Guard blocks, console errors and HTTP >= 400 since `from` (indexes), minus `expected` HTTP failures
 * ({ status, url: RegExp }) and the browser's generic "Failed to load resource" console line each of them causes.
 */
function sessionErrors(session, from = { console: 0, network: 0, blocked: 0 }, expected = []) {
    const isExpected = (e) => expected.some((x) => x.status === e.status && x.url.test(decodeURIComponent(e.url)));
    const network = session.networkErrors.slice(from.network);
    const allowance = new Map();
    network.filter(isExpected).forEach((e) => allowance.set(e.status, (allowance.get(e.status) || 0) + 1));
    const consoleErrors = session.consoleErrors.slice(from.console).filter((t) => {
        const status = Number((/^Failed to load resource: the server responded with a status of (\d{3})/.exec(t) || [])[1]);
        if (!allowance.get(status)) return true;
        allowance.set(status, allowance.get(status) - 1);
        return false;
    });
    return [
        ...session.blocked.slice(from.blocked).map((b) => `write guard blocked ${b.reason}`),
        ...consoleErrors.map((e) => `console: ${e}`),
        ...network.filter((e) => !isExpected(e)).map((e) => `HTTP ${e.status} ${e.url}`)
    ];
}

/** Assertions shared by every sub-case: exactly one action call, payload keys, no mixed $batch. */
function checkCalls(calls, expectedBody, label) {
    const errors = [];
    const mixed = calls.filter((c) => c.mixed);
    if (mixed.length) errors.push(`${label}: action sent in a $batch with other requests (${JSON.stringify(mixed[0].mixed)})`);
    const real = calls.filter((c) => !c.mixed);
    if (real.length !== 1) errors.push(`${label}: action called ${real.length} times, expected exactly 1`);
    const body = (real[0] || {}).body || {};
    Object.entries(expectedBody).forEach(([k, v]) => {
        if (String(body[k]).trim() !== String(v).trim()) errors.push(`${label}: payload ${k}=${JSON.stringify(body[k])}, expected ${JSON.stringify(v)}`);
    });
    return errors;
}

/** GET-only CAP read used for live read-back (and dry-run data derivation). */
function capGet(baseUrl, user = 'alice') {
    const headers = { Authorization: 'Basic ' + Buffer.from(`${user}:`).toString('base64'), Accept: 'application/json' };
    return async (path) => {
        const res = await fetch(`${baseUrl}/odata/v4/${path}`, { method: 'GET', headers });
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(`GET ${path} -> HTTP ${res.status}${body && body.error ? `: ${body.error.message}` : ''}`);
        return body && Array.isArray(body.value) ? body.value : body;
    };
}

/** Folds sub-case results into the suite's { status, mode, errors, details }; any skipped sub-case makes it PARTIAL. */
function suiteResult(title, mode, cases) {
    const errors = cases.flatMap((c) => c.errors.map((e) => `${c.name}: ${e}`));
    const skipped = cases.filter((c) => c.skipped);
    const status = errors.length ? 'FAIL' : (skipped.length ? 'PARTIAL' : 'PASS');
    cases.forEach((c) => {
        console.log(`  [${c.skipped ? 'SKIPPED' : (c.errors.length ? 'FAIL' : 'PASS')}] ${c.name}${c.skipped ? ` — ${c.skipped}` : ''}`);
        c.errors.forEach((e) => console.log(`      - ${e}`));
    });
    console.log(`  => ${status} ${title} (${mode})`);
    return { status, mode, errors, details: { cases } };
}

module.exports = {
    interceptAction, waitForHealth, openHash, resultBox, pressBoxButton, listButtons, typeInto, selectKey, modelData,
    sessionErrors, checkCalls, capGet, suiteResult, batchParts, batchRequestJson, batchResponseJson
};
