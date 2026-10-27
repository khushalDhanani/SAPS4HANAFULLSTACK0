'use strict';
/* global window */

/**
 * Submit-failure E2E (P1 item 13) for write screens whose write is a CAP action called from a list or dialog
 * (not a create form): SAP business error (400), stale data (409), backend unavailable (503), network timeout and
 * expired session (401), each answered by a MOCKED response (UI handling only, never SAP behaviour; the write guard
 * stays on). Every case expects: exactly one action call, a visible error MessageBox naming the problem, no success
 * result, and the user still on the same screen. Flows are added to FLOWS as drivers: prepare() opens the screen and
 * returns the function that triggers the single write.
 * Covered: customer invoice release / cancel. NOT yet covered (open list in docs/e2e-coverage-matrix.md): delivery,
 * PGI, billing, goods receipt post, handling unit, packing instruction, movement 261, scan-to, reservation retry.
 * Not covered by this suite: double click while pending and reload while pending (the action flows close their
 * confirmation dialog on the first click).
 */

const { openSession } = require('../support/screenCheck');
const rt = require('../support/actionRoundTrip');
const invoice = require('../sd/roundTripCustomerInvoice.e2e');

const SAP_MESSAGE = 'E2E simulated SAP error: document is blocked';
const STALE_MESSAGE = 'E2E simulated: document was changed by another user, reload and retry';

const FAILURES = [
    { name: 'SAP business error (400)', fail: { status: 400, code: 'VF/001', message: SAP_MESSAGE }, expect: /document is blocked/i, httpStatus: null },
    { name: 'Stale data (409, changed by another user)', fail: { status: 409, code: '409', message: STALE_MESSAGE }, expect: /changed by another user/i, httpStatus: null },
    { name: 'Backend unavailable (503)', fail: { status: 503, code: '503', message: 'E2E simulated: S/4HANA is unavailable' }, expect: /unavailable|S\/4|503/i, httpStatus: 503 },
    { name: 'Network timeout', fail: 'timeout', expect: /./, httpStatus: null },
    { name: 'Expired session (401)', fail: { status: 401, code: '401', message: 'E2E simulated: session expired' }, expect: /session|sign|log ?in|authori|401/i, httpStatus: 401 }
];

/** Customer invoice: each CASES entry (button + confirm) of the round-trip suite is a flow. */
const FLOWS = Object.values(invoice.CASES).map((c) => ({
    label: `Customer invoice: ${c.name}`,
    service: invoice.SERVICE,
    action: c.action,
    route: 'customerInvoices',
    respond: c.respond,
    async prepare(session) {
        await rt.openHash(session, invoice.HASH);
        const pick = (await rt.listButtons(session.page, c.button, 'customerInvoice'))[0];
        if (!pick) throw new Error(`no invoice row enables ${c.button}`);
        await session.page.click(`[id="${pick.id}"]`);
        await session.settle();
        return () => c.confirm(session);
    }
}));

async function failureCase(baseUrl, flow, f) {
    const errors = [];
    const session = await openSession({ baseUrl, user: 'alice' });
    try {
        const calls = await rt.interceptAction(session.page, { flow: 'none', service: flow.service, action: flow.action, respond: flow.respond, fail: f.fail });
        const submit = await flow.prepare(session);
        await submit();
        const box = await rt.resultBox(session.page, 30000);
        const real = calls.filter((c) => !c.mixed);
        if (calls.some((c) => c.mixed)) errors.push('action sent in a $batch with other requests');
        if (real.length !== 1) errors.push(`action called ${real.length} times, expected 1`);
        if (box.type === 'success') errors.push(`success shown despite failure: ${box.text}`);
        else if (box.type !== 'error') errors.push(`expected an error box, got ${box.type || 'none'}: ${box.text}`);
        if (!f.expect.test(box.text)) errors.push(`error box does not match ${f.expect}: ${box.text.slice(0, 200)}`);
        const screen = await session.page.evaluate(() => window.location.hash);
        if (!screen.includes('sd/invoices')) errors.push(`navigated away to ${screen}`);
        const expected = f.httpStatus ? [{ status: f.httpStatus, url: /customer-invoice\/(\$batch|release|cancel)/ }] : [];
        errors.push(...rt.sessionErrors(session, undefined, expected).filter((e) => !/Failed to load resource|ERR_|net::|^console: (Failed to invoke \/|\$batch failed)/.test(e))); // UI5 logs the mocked failure itself
    } catch (err) {
        errors.push(`${err.name}: ${err.message.split('\n')[0]}`);
    } finally {
        await session.close();
    }
    return errors;
}

async function verifyActionFailures(options = {}) {
    const baseUrl = (options.baseUrl || process.env.TARGET_URL || 'http://localhost:4004').replace(/\/+$/, '');
    const errors = [];
    const details = [];
    for (const flow of FLOWS) {
        console.log(`\n=== Submit failures: ${flow.label} (write guard on; action MOCKED per case, not SAP) ===`);
        for (const f of FAILURES) {
            const errs = await failureCase(baseUrl, flow, f);
            console.log(`  [${errs.length ? 'FAIL' : 'PASS'}] ${f.name}`);
            errs.forEach((e) => console.log(`      - ${e}`));
            details.push({ flow: flow.label, case: f.name, status: errs.length ? 'FAIL' : 'PASS', errors: errs });
            errs.forEach((e) => errors.push(`${flow.label}: ${f.name}: ${e}`));
        }
    }
    return { status: errors.length ? 'FAIL' : 'PASS', errors, details };
}

if (require.main === module) {
    verifyActionFailures().then((r) => process.exit(r.status === 'PASS' ? 0 : 1));
}

module.exports = { verifyActionFailures };
