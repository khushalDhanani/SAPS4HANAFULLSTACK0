'use strict';
/* global document, window */

/**
 * Negative E2E at submit time (item 8), on the purchase-order create flow, behind the write guard. The write action is
 * answered by a MOCKED response for each case — this proves the UI's failure handling, never SAP behaviour:
 * SAP business error (400), backend unavailable (503), network timeout, expired session (401), double click while the
 * request is pending, and reload while the request is pending. Every case expects: the error is visible, the busy
 * indicator is gone, the user stays on the create screen with no success message, and the expected number of submits.
 */

const { openSession, inspectScreen } = require('../support/screenCheck');
const { capReader, formUi } = require('../support/roundTrip');
const { SPEC } = require('../mm/roundTripPurchaseOrder.e2e');

const ACTION_RE = /\/odata\/v4\/purchase-order\/createPurchaseOrder$/;
const SAP_MESSAGE = 'E2E simulated SAP error: supplier is blocked for purchasing';
const odataError = (status, code, message) => ({
    status,
    contentType: 'application/json;odata.metadata=minimal',
    headers: { 'OData-Version': '4.0' },
    body: JSON.stringify({ error: { code, message } })
});
const success = () => ({
    status: 200,
    contentType: 'application/json;odata.metadata=minimal',
    headers: { 'OData-Version': '4.0' },
    body: JSON.stringify({ '@odata.context': '$metadata#Edm.String', value: 'DRYRUN-NEG1' })
});

/** What the user sees after a failed submit. */
function uiState(page) {
    return page.evaluate(() => {
        const visible = (e) => e.getClientRects().length > 0;
        const texts = (sel) => [...document.querySelectorAll(sel)].filter(visible).map((e) => e.textContent.trim());
        return {
            busy: [...document.querySelectorAll('.sapUiBusyIndicator, .sapUiLocalBusyIndicator')].some(visible),
            errorUi: texts('.sapMMessageBox, .sapMMsgPopover, .sapMMsgStripError'),
            toasts: texts('.sapMMessageToast')
        };
    });
}

const CASES = [
    { name: 'SAP business error (400) is shown and the form stays editable', respond: (route) => route.fulfill(odataError(400, 'ME/045', SAP_MESSAGE)), expectText: /supplier is blocked/i },
    { name: 'Backend unavailable (503) is shown', respond: (route) => route.fulfill(odataError(503, '503', 'E2E simulated: S/4HANA is unavailable')), expectText: /unavailable|S\/4|503/i },
    { name: 'Network timeout is shown', respond: (route) => route.abort('timedout'), expectText: /./ },
    { name: 'Expired session (401) is shown', respond: (route) => route.fulfill(odataError(401, '401', 'E2E simulated: session expired')), expectText: /session|sign|log ?in|authori|401/i }
];

async function prepare(session, values) {
    const { page } = session;
    await page.goto(`${session.baseUrl}/fiori-app/webapp/index.html#/${SPEC.hash}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => window.sap && window.sap.ui && window.sap.ui.require('sap/ui/core/Component'), null, { timeout: 30000 });
    await session.settle();
    await SPEC.fill(formUi(session, SPEC.modelName), values);
}

/** Uncaught page errors and guard blocks are failures in every case; the mocked action's own HTTP error is expected. */
function harness(session) {
    return session.consoleErrors.filter((e) => e.startsWith('PAGEERROR'))
        .concat(session.blocked.map((b) => `write guard blocked ${b.reason}`))
        .concat(session.networkErrors.filter((e) => !ACTION_RE.test(new URL(e.url).pathname)).map((e) => `HTTP ${e.status} ${e.url}`));
}

async function failureCase(baseUrl, values, c) {
    const session = await openSession({ baseUrl });
    let calls = 0;
    try {
        await session.page.route((url) => ACTION_RE.test(url.pathname), (route) => { calls++; return c.respond(route); });
        await prepare(session, values);
        await session.page.locator(`[id$="--${SPEC.submit}"]`).first().click();
        await session.settle();
        await session.page.waitForTimeout(500);
        const st = await uiState(session.page);
        const screen = await inspectScreen(session.page);
        const errors = harness(session);
        if (calls !== 1) errors.push(`write action called ${calls} times, expected 1${calls === 0 ? ` (form not submitted: ${st.errorUi.join(' | ').slice(0, 160) || 'no message'})` : ''}`);
        if (st.busy) errors.push('busy indicator still shown after the failure');
        if (screen.route !== SPEC.route && !(c.allowLogin && screen.route === 'login')) errors.push(`navigated away to ${screen.route}`);
        if (st.toasts.some((t) => /created|DRYRUN/i.test(t))) errors.push(`success shown despite failure: ${st.toasts.join(' | ')}`);
        if (!st.errorUi.some((t) => c.expectText.test(t))) errors.push(`no visible error matching ${c.expectText} (error UI: ${st.errorUi.join(' | ').slice(0, 200) || 'none'})`);
        return errors;
    } finally {
        await session.close();
    }
}

async function doubleClickWhilePending(baseUrl, values) {
    const session = await openSession({ baseUrl });
    let calls = 0;
    try {
        await session.page.route((url) => ACTION_RE.test(url.pathname), async (route) => {
            calls++;
            await new Promise((r) => setTimeout(r, 3000));
            return route.fulfill(success());
        });
        await prepare(session, values);
        await session.page.locator(`[id$="--${SPEC.submit}"]`).first().click({ clickCount: 2 });
        await session.page.waitForTimeout(4000);
        await session.settle();
        const errors = harness(session);
        if (calls !== 1) {
            const st = await uiState(session.page);
            errors.push(`double click while pending sent ${calls} create requests, expected 1${calls === 0 ? ` (form not submitted: ${st.errorUi.join(' | ').slice(0, 160) || 'no message'})` : ''}`);
        }
        return errors;
    } finally {
        await session.close();
    }
}

async function reloadWhilePending(baseUrl, values) {
    const session = await openSession({ baseUrl });
    let calls = 0;
    let release;
    try {
        await session.page.route((url) => ACTION_RE.test(url.pathname), (route) => {
            calls++;
            return new Promise((r) => { release = () => r(route.abort('aborted').catch(() => {})); });
        });
        await prepare(session, values);
        await session.page.locator(`[id$="--${SPEC.submit}"]`).first().click();
        await session.page.waitForTimeout(1000);
        await session.page.reload({ waitUntil: 'domcontentloaded' });
        await session.page.waitForFunction(() => window.sap && window.sap.ui && window.sap.ui.require('sap/ui/core/Component'), null, { timeout: 30000 });
        await session.settle();
        const screen = await inspectScreen(session.page);
        const st = await uiState(session.page);
        const errors = session.consoleErrors.filter((e) => e.startsWith('PAGEERROR')).concat(session.blocked.map((b) => `write guard blocked ${b.reason}`));
        if (calls !== 1) errors.push(`reload re-sent the create request (${calls} calls)`);
        if (screen.route !== SPEC.route) errors.push(`after reload: route ${screen.route}, expected ${SPEC.route}`);
        if (st.busy) errors.push('after reload: busy indicator still shown');
        if (st.toasts.some((t) => /created|DRYRUN/i.test(t))) errors.push('after reload: success shown although nothing completed');
        return errors;
    } finally {
        if (release) release();
        await session.close();
    }
}

async function verifySubmitFailures(options = {}) {
    const baseUrl = (options.baseUrl || process.env.TARGET_URL || 'http://localhost:4004').replace(/\/+$/, '');
    console.log('\n=== Submit failures on PO create (write guard on; create action MOCKED per case, not SAP) ===');
    const values = await SPEC.deriveData(capReader(baseUrl, 'alice'));
    const cases = CASES.map((c) => ({ name: c.name, run: () => failureCase(baseUrl, values, c) })).concat([
        { name: 'Double click while the request is pending sends one create', run: () => doubleClickWhilePending(baseUrl, values) },
        { name: 'Reload while the request is pending does not resubmit or show success', run: () => reloadWhilePending(baseUrl, values) }
    ]);
    const errors = [];
    const details = [];
    for (const c of cases) {
        let errs;
        try {
            errs = await c.run();
        } catch (err) {
            errs = [`${err.name}: ${err.message.split('\n')[0]}`];
        }
        console.log(`  [${errs.length ? 'FAIL' : 'PASS'}] ${c.name}`);
        errs.forEach((e) => console.log(`      - ${e}`));
        details.push({ case: c.name, status: errs.length ? 'FAIL' : 'PASS', errors: errs });
        errs.forEach((e) => errors.push(`${c.name}: ${e}`));
    }
    return { status: errors.length ? 'FAIL' : 'PASS', errors, details };
}

if (require.main === module) {
    verifySubmitFailures().then((r) => process.exit(r.status === 'PASS' ? 0 : 1));
}

module.exports = { verifySubmitFailures };
