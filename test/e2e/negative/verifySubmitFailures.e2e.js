'use strict';
/* global document, window */

/**
 * Negative E2E at submit time (item 8) on the PO, sales inquiry, sales order and customer return create flows, behind
 * the write guard. The write action is answered by a MOCKED response for each case — this proves the UI's failure
 * handling, never SAP behaviour: SAP business error (400), stale data (409 "changed by another user"), backend
 * unavailable (503), network timeout, expired session (401), double click while the request is pending, and reload
 * while the request is pending. Every case expects: the error is visible, the busy indicator is gone, the user stays
 * on the create screen with no success message, and the expected number of submits.
 * NOT VERIFIED: that the real backend detects stale data — the create actions carry no ETag/version; only the UI's
 * handling of such an answer is proven.
 */

const { openSession, inspectScreen } = require('../support/screenCheck');
const { capReader, formUi } = require('../support/roundTrip');
const rt = require('../support/actionRoundTrip');
const { SPEC: PO } = require('../mm/roundTripPurchaseOrder.e2e');
const { SPEC: SI } = require('../sd/roundTripSalesInquiry.e2e');
const { SPEC: SO } = require('../sd/roundTripSalesOrder.e2e');
const { deriveData: deriveReturn, fill: fillReturn } = require('../sd/roundTripCustomerReturn.e2e');

const SAP_MESSAGE = 'E2E simulated SAP error: supplier is blocked for purchasing';
const STALE_MESSAGE = 'E2E simulated: document was changed by another user, reload and retry';
const JSON_TYPE = 'application/json;odata.metadata=minimal';
const odataError = (status, code, message) => ({
    status, contentType: JSON_TYPE, headers: { 'OData-Version': '4.0' }, body: JSON.stringify({ error: { code, message } })
});

/** Create form driven through the page-object helpers of a roundTrip SPEC (action posted directly). */
const specScreen = (label, SPEC, actionPath) => ({
    label, route: SPEC.route, submit: `[id$="--${SPEC.submit}"]`, actionPath, via: 'direct',
    actionRe: new RegExp(`${actionPath.replace(/[/$]/g, '\\$&')}$`),
    okBody: { '@odata.context': '$metadata#Edm.String', value: 'DRYRUN-NEG1' },
    deriveData: (baseUrl) => SPEC.deriveData(capReader(baseUrl, 'alice')),
    async prepare(session, values) {
        await rt.openHash(session, SPEC.hash);
        await SPEC.fill(formUi(session, SPEC.modelName), values);
    }
});

const SCREENS = [
    specScreen('PO create', PO, '/odata/v4/purchase-order/createPurchaseOrder'),
    specScreen('Sales inquiry create', SI, '/odata/v4/sales-inquiry/createSalesInquiry'),
    specScreen('Sales order create', SO, '/odata/v4/sales-order/createSalesOrder'),
    {
        // The V4 model sends this action as an OData $batch, so mocked answers are batch replies.
        label: 'Customer return create', route: 'createCustomerReturn', submit: '[id$="--btnFooterCreateInSAP"]', via: 'batch',
        actionRe: /\/odata\/v4\/customer-return\/(createCustomerReturn|\$batch)$/,
        okBody: { CustomerReturn: 'DRYRUN-NEG1', Success: true, Message: 'E2E stub' },
        deriveData: (baseUrl) => deriveReturn(rt.capGet(baseUrl)),
        async prepare(session, values) {
            await rt.openHash(session, 'sd/returns/create');
            await fillReturn(session, values, false);
        }
    }
];

/** Mocked answer for a screen: direct POST, or a one-request $batch reply (inner status for 4xx business errors). */
function answer(screen, status, code, message) {
    if (screen.via === 'direct' || status === 401 || status === 503) return odataError(status, code, message);
    const b = 'batchresponse_neg';
    const inner = status === 200 ? screen.okBody : { error: { code, message } };
    return {
        status: 200,
        headers: { 'Content-Type': `multipart/mixed; boundary=${b}`, 'OData-Version': '4.0' },
        body: `--${b}\r\nContent-Type: application/http\r\nContent-Transfer-Encoding: binary\r\n\r\n`
            + `HTTP/1.1 ${status} X\r\nContent-Type: ${JSON_TYPE}\r\nOData-Version: 4.0\r\n\r\n${JSON.stringify(inner)}\r\n--${b}--\r\n`
    };
}
const success = (screen) => (screen.via === 'direct'
    ? { status: 200, contentType: JSON_TYPE, headers: { 'OData-Version': '4.0' }, body: JSON.stringify(screen.okBody) }
    : answer(screen, 200));

/** Routes only this screen's create call (for a $batch: only when it holds the action POST); everything else falls through. */
function routeAction(screen, page, handler) {
    return page.route((url) => screen.actionRe.test(url.pathname), (route) => {
        const req = route.request();
        if (req.method() !== 'POST') return route.fallback();
        if (screen.via === 'batch' && !rt.batchParts(req.postData()).some((p) => p.method === 'POST' && p.url.split('?')[0] === 'createCustomerReturn')) return route.fallback();
        return handler(route);
    });
}

/** What the user sees after a failed submit. */
function uiState(page) {
    return page.evaluate(() => {
        const visible = (e) => e.getClientRects().length > 0;
        const texts = (sel) => [...document.querySelectorAll(sel)].filter(visible).map((e) => e.textContent.trim());
        return {
            busy: [...document.querySelectorAll('.sapUiBusyIndicator, .sapUiLocalBusyIndicator')].some(visible),
            errorUi: texts('.sapMMessageBox, .sapMMsgPopover, .sapMMsgStripError'),
            toasts: texts('.sapMMessageToast'),
            successUi: texts('.sapMMessageBoxSuccess')
        };
    });
}

const CASES = [
    { name: 'SAP business error (400) is shown and the form stays editable', respond: (route, sc) => route.fulfill(answer(sc, 400, 'ME/045', SAP_MESSAGE)), expectText: /supplier is blocked/i },
    { name: 'Stale data (409, changed by another user) is shown, nothing reported as created', respond: (route, sc) => route.fulfill(answer(sc, 409, '409', STALE_MESSAGE)), expectText: /changed by another user/i },
    { name: 'Backend unavailable (503) is shown', respond: (route, sc) => route.fulfill(answer(sc, 503, '503', 'E2E simulated: S/4HANA is unavailable')), expectText: /unavailable|S\/4|503/i },
    { name: 'Network timeout is shown', respond: (route) => route.abort('timedout'), expectText: /./ },
    { name: 'Expired session (401) is shown', respond: (route, sc) => route.fulfill(answer(sc, 401, '401', 'E2E simulated: session expired')), expectText: /session|sign|log ?in|authori|401/i }
];

/** Uncaught page errors and guard blocks are failures in every case; the mocked action's own HTTP error is expected. */
function harness(session, screen) {
    return session.consoleErrors.filter((e) => e.startsWith('PAGEERROR'))
        .concat(session.blocked.map((b) => `write guard blocked ${b.reason}`))
        .concat(session.networkErrors.filter((e) => !screen.actionRe.test(new URL(e.url).pathname)).map((e) => `HTTP ${e.status} ${e.url}`));
}

async function failureCase(screen, baseUrl, values, c) {
    const session = await openSession({ baseUrl });
    let calls = 0;
    try {
        await routeAction(screen, session.page, (route) => { calls++; return c.respond(route, screen); });
        await screen.prepare(session, values);
        await session.page.locator(screen.submit).first().click();
        await session.settle();
        await session.page.waitForTimeout(500);
        const st = await uiState(session.page);
        const shown = await inspectScreen(session.page);
        const errors = harness(session, screen);
        if (calls !== 1) errors.push(`write action called ${calls} times, expected 1${calls === 0 ? ` (form not submitted: ${st.errorUi.join(' | ').slice(0, 160) || 'no message'})` : ''}`);
        if (st.busy) errors.push('busy indicator still shown after the failure');
        if (shown.route !== screen.route && !(c.allowLogin && shown.route === 'login')) errors.push(`navigated away to ${shown.route}`);
        if (st.toasts.some((t) => /created|DRYRUN/i.test(t)) || st.successUi.length) errors.push(`success shown despite failure: ${st.toasts.concat(st.successUi).join(' | ')}`);
        if (!st.errorUi.some((t) => c.expectText.test(t))) errors.push(`no visible error matching ${c.expectText} (error UI: ${st.errorUi.join(' | ').slice(0, 200) || 'none'})`);
        return errors;
    } finally {
        await session.close();
    }
}

async function doubleClickWhilePending(screen, baseUrl, values) {
    const session = await openSession({ baseUrl });
    let calls = 0;
    try {
        await routeAction(screen, session.page, async (route) => {
            calls++;
            await new Promise((r) => setTimeout(r, 3000));
            return route.fulfill(success(screen));
        });
        await screen.prepare(session, values);
        await session.page.locator(screen.submit).first().click({ clickCount: 2 });
        await session.page.waitForTimeout(4000);
        await session.settle();
        const errors = harness(session, screen);
        if (calls !== 1) {
            const st = await uiState(session.page);
            errors.push(`double click while pending sent ${calls} create requests, expected 1${calls === 0 ? ` (form not submitted: ${st.errorUi.join(' | ').slice(0, 160) || 'no message'})` : ''}`);
        }
        return errors;
    } finally {
        await session.close();
    }
}

async function reloadWhilePending(screen, baseUrl, values) {
    const session = await openSession({ baseUrl });
    let calls = 0;
    let release;
    try {
        await routeAction(screen, session.page, (route) => {
            calls++;
            return new Promise((r) => { release = () => r(route.abort('aborted').catch(() => {})); });
        });
        await screen.prepare(session, values);
        await session.page.locator(screen.submit).first().click();
        await session.page.waitForTimeout(1000);
        await session.page.reload({ waitUntil: 'domcontentloaded' });
        await session.page.waitForFunction(() => window.sap && window.sap.ui && window.sap.ui.require('sap/ui/core/Component'), null, { timeout: 30000 });
        await session.settle();
        const shown = await inspectScreen(session.page);
        const st = await uiState(session.page);
        const errors = session.consoleErrors.filter((e) => e.startsWith('PAGEERROR')).concat(session.blocked.map((b) => `write guard blocked ${b.reason}`));
        if (calls !== 1) errors.push(`reload re-sent the create request (${calls} calls)`);
        if (shown.route !== screen.route) errors.push(`after reload: route ${shown.route}, expected ${screen.route}`);
        if (st.busy) errors.push('after reload: busy indicator still shown');
        if (st.toasts.some((t) => /created|DRYRUN/i.test(t)) || st.successUi.length) errors.push('after reload: success shown although nothing completed');
        return errors;
    } finally {
        if (release) release();
        await session.close();
    }
}

async function verifySubmitFailures(options = {}) {
    const baseUrl = (options.baseUrl || process.env.TARGET_URL || 'http://localhost:4004').replace(/\/+$/, '');
    const errors = [];
    const details = [];
    for (const screen of SCREENS) {
        console.log(`\n=== Submit failures on ${screen.label} (write guard on; create action MOCKED per case, not SAP) ===`);
        let values;
        try {
            values = await screen.deriveData(baseUrl);
        } catch (err) {
            const e = `${screen.label}: test data: ${err.message}`;
            console.log(`  [FAIL] ${e}`);
            errors.push(e);
            continue;
        }
        const cases = CASES.map((c) => ({ name: c.name, run: () => failureCase(screen, baseUrl, values, c) })).concat([
            { name: 'Double click while the request is pending sends one create', run: () => doubleClickWhilePending(screen, baseUrl, values) },
            { name: 'Reload while the request is pending does not resubmit or show success', run: () => reloadWhilePending(screen, baseUrl, values) }
        ]);
        for (const c of cases) {
            let errs;
            try {
                errs = await c.run();
            } catch (err) {
                errs = [`${err.name}: ${err.message.split('\n')[0]}`];
            }
            console.log(`  [${errs.length ? 'FAIL' : 'PASS'}] ${c.name}`);
            errs.forEach((e) => console.log(`      - ${e}`));
            details.push({ screen: screen.label, case: c.name, status: errs.length ? 'FAIL' : 'PASS', errors: errs });
            errs.forEach((e) => errors.push(`${screen.label}: ${c.name}: ${e}`));
        }
    }
    return { status: errors.length ? 'FAIL' : 'PASS', errors, details };
}

if (require.main === module) {
    verifySubmitFailures().then((r) => process.exit(r.status === 'PASS' ? 0 : 1));
}

module.exports = { verifySubmitFailures };
