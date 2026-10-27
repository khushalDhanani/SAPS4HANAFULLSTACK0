'use strict';
/* global window, document */

/**
 * Submit-failure E2E (P1 item 13) for write screens whose write is a CAP action called from a list or dialog
 * (not a create form): SAP business error (400), stale data (409), backend unavailable (503), network timeout and
 * expired session (401), each answered by a MOCKED response (UI handling only, never SAP behaviour; the write guard
 * stays on). Every case expects: exactly one action call, a visible error MessageBox naming the problem, no success
 * result, and the user still on the same screen. Flows are added to FLOWS as drivers: prepare() opens the screen and
 * returns the function that triggers the single write.
 * Covered: customer invoice release / cancel, goods receipt post, packing instruction create, reservation retry, Orders Due create delivery / delivery without reference (PGI and billing
 * run only when a real delivery in the right SAP status is named, like their round-trip suite). NOT yet covered (open
 * list in docs/e2e-coverage-matrix.md): goods receipt post, handling unit, packing instruction, movement 261, scan-to,
 * reservation retry, HU stock transfer.
 * Not covered by this suite: double click while pending and reload while pending (the action flows close their
 * confirmation dialog on the first click).
 */

const { openSession } = require('../support/screenCheck');
const rt = require('../support/actionRoundTrip');
const invoice = require('../sd/roundTripCustomerInvoice.e2e');
const ordersDue = require('../le/roundTripOrdersDue.e2e');
const goodsReceipt = require('../wm/roundTripGoodsReceipt.e2e');
const packing = require('../wm/roundTripPackingInstruction.e2e');
const retry = require('../wm/roundTripReservationRetry.e2e');
const huRt = require('../wm/roundTripHandlingUnit.e2e');
const mvt261 = require('../wm/roundTripMvt261.e2e');
const scanTo = require('../wm/roundTripScanTo.e2e');
const kit = require('../wm/wmRoundTripKit');

const SAP_MESSAGE = 'E2E simulated SAP error: document is blocked';
const STALE_MESSAGE = 'E2E simulated: document was changed by another user, reload and retry';

const FAILURES = [
    { name: 'SAP business error (400)', fail: { status: 400, code: 'VF/001', message: SAP_MESSAGE }, expect: /document is blocked/i },
    { name: 'Stale data (409, changed by another user)', fail: { status: 409, code: '409', message: STALE_MESSAGE }, expect: /changed by another user/i },
    { name: 'Backend unavailable (503)', fail: { status: 503, code: '503', message: 'E2E simulated: S/4HANA is unavailable' }, expect: /unavailable|S\/4|503/i },
    { name: 'Network timeout', fail: 'timeout', expect: /./ },
    { name: 'Expired session (401)', fail: { status: 401, code: '401', message: 'E2E simulated: session expired' }, expect: /session|sign|log ?in|authori|401/i }
];

/**
 * A flow is { label, service, action, respond, hash, run(session) }: run() opens the screen and performs every step up to
 * and including the click that triggers the single write (the same steps as the flow's round-trip suite).
 */
const invoiceFlows = Object.values(invoice.CASES).map((c) => ({
    label: `Customer invoice: ${c.name}`,
    service: invoice.SERVICE,
    action: c.action,
    respond: c.respond,
    hash: 'sd/invoices',
    async run(session) {
        await rt.openHash(session, invoice.HASH);
        const pick = (await rt.listButtons(session.page, c.button, 'customerInvoice'))[0];
        if (!pick) throw new Error(`no invoice row enables ${c.button}`);
        await session.page.click(`[id="${pick.id}"]`);
        await session.settle();
        await c.confirm(session);
    }
}));

/** Orders Due: the round-trip sub-cases run unchanged; the delivery numbers PGI/billing need come from the same env vars. */
const ordersDueFlows = Object.keys(ordersDue.SUBCASES).map((name) => {
    const a = ordersDue.ACTIONS[name];
    const needs = { postGoodsIssue: process.env.E2E_DRYRUN_PGI_DELIVERY, createBilling: process.env.E2E_DRYRUN_BILLING_DELIVERY };
    return {
        label: `Orders due: ${name}`,
        service: ordersDue.SERVICE,
        action: a.action,
        respond: a.respond,
        hash: 'le/orders-due',
        skipped: name in needs && !needs[name]
            ? `needs a real delivery ready for ${name === 'postGoodsIssue' ? 'goods issue' : 'billing'}: set ${name === 'postGoodsIssue' ? 'E2E_DRYRUN_PGI_DELIVERY' : 'E2E_DRYRUN_BILLING_DELIVERY'}` : null,
        run: (session, baseUrl) => ordersDue.SUBCASES[name](session, { live: false, data: {}, get: rt.capGet(baseUrl), delivery: needs[name] })
    };
});

const WAIT_MS = 8000; // the mocked failure answers at once; do not wait the round-trip suites' 2-3 minutes for a success toast
const split = (action) => ({ service: action.slice(0, action.lastIndexOf('/')), action: action.slice(action.lastIndexOf('/') + 1) });

/**
 * WM screens: the round-trip suites' own UI drivers, called with a short wait. observe() turns what each screen shows
 * after a failed write into { type, text } the way rt.resultBox does for MessageBox-based screens.
 */
const wmFlows = [
    {
        label: 'Goods receipt: post with storage unit', ...split(goodsReceipt.ACTION), respond: goodsReceipt.stubResult, hash: 'wm/goods-receipt',
        run: (session) => goodsReceipt.driveUi(session, { waitMs: WAIT_MS }),
        observe: async (session, ui) => ({ type: ui.success ? 'success' : 'error', text: ui.dialog })
    },
    {
        label: 'Packing instruction: create', ...split(packing.ACTION), respond: packing.stubResult, hash: 'wm/packing-instruction',
        run: async (session, baseUrl) => packing.driveUi(session, await packing.pickDryRunData(baseUrl), WAIT_MS),
        observe: async (session, ui) => (ui.toast ? { type: 'success', text: ui.toast } : { type: ui.error ? 'error' : 'none', text: ui.error || '' })
    },
    {
        label: 'Reservation entry: retry step', ...split(retry.ACTION), respond: () => ({}), hash: 'wm/reservation-entry',
        run: async (session, baseUrl) => {
            const ui = await retry.driveUi(session, await retry.pickDryRunData(baseUrl), WAIT_MS);
            if (!ui.retried) throw new Error('Retry button not shown for the chosen entry');
            return ui;
        },
        observe: async (session, ui) => (ui.toast ? { type: /fail|error/i.test(ui.toast) ? 'error' : 'success', text: ui.toast } : { type: ui.dialog ? 'error' : 'none', text: ui.dialog || '' })
    }
];

/**
 * Round-trip suites that stub their own actions through wmRoundTripKit.stubAction (handling unit, movement 261, scan-to):
 * with kit.setFailure() their stubs answer the failure, and their SUBCASES drive the UI unchanged. Candidates come from
 * READ-ONLY reads, read once per run. A sub-case without a candidate in the current SAP data is SKIPPED, not failed.
 */
const once = (fn) => { let p; return (...a) => { p = p || fn(...a); return p; }; };
const skip = (why) => Object.assign(new Error(why), { skip: true });
const huData = once(async (baseUrl) => huRt.dryInputs(await huRt.pickDryRunData(baseUrl)));
const mvtData = once((baseUrl) => mvt261.pickDryRunData(baseUrl));
const trList = once((baseUrl) => scanTo.candidates(baseUrl));

const kitFlows = [
    ...Object.keys(huRt.SUBCASES).map((name) => ({
        label: `Handling unit: ${name}`, ...split(huRt.PATH[name]), hash: 'wm/handling-unit',
        run: async (session, baseUrl) => {
            const d = (await huData(baseUrl))[name];
            if (typeof d === 'string') throw skip(d);
            return huRt.SUBCASES[name](session, d);
        }
    })),
    ...Object.keys(mvt261.SUBCASES).map((name) => ({
        label: `Movement 261: ${name}`, ...split(mvt261.PATH[name]), hash: 'wm/mvt261',
        run: async (session, baseUrl) => {
            const d = (await mvtData(baseUrl))[name];
            if (!d) throw skip('no candidate from READ-ONLY openItems()/scanContext()/cycle()');
            const ui = await mvt261.SUBCASES[name](session, d);
            if (!ui.posted) throw skip(`UI does not allow posting: ${ui.message || ui.state}`);
            return ui;
        }
    })),
    {
        label: 'Scan-to: create transfer order', ...split(scanTo.CREATE), hash: 'wm/scan-to',
        run: async (session, baseUrl) => {
            const res = await scanTo.SUBCASES.createTO(session, await trList(baseUrl));
            if (res.skipped) throw skip(res.skipped);
            return res;
        }
    }
].map((f) => ({ ...f, kit: true, observe: async (session) => visibleMessage(session.page) }));

/** Text of every visible message the screen shows (MessageBox, error strip, toast); success when it carries a DRYRUN stub value. */
async function visibleMessage(page) {
    const text = (await page.evaluate(() => [...document.querySelectorAll('.sapMMessageBox, .sapMMsgStripError, .sapMMessageToast')]
        .filter((e) => e.getClientRects().length > 0).map((e) => e.textContent.trim()).join(' | '))).slice(0, 400);
    return { type: /DRYRUN/.test(text) ? 'success' : (text ? 'error' : 'none'), text };
}

const FLOWS = [...invoiceFlows, ...ordersDueFlows, ...wmFlows, ...kitFlows];

async function failureCase(baseUrl, flow, f) {
    const errors = [];
    const session = await openSession({ baseUrl, user: 'alice' });
    const calls = [];
    try {
        if (flow.kit) {
            // these suites stub their own action: count its POSTs, and let the kit answer the failure
            session.page.on('request', (req) => { if (req.method() === 'POST' && new URL(req.url()).pathname === `${flow.service}/${flow.action}`) calls.push({}); });
            kit.setFailure(f.fail);
            kit.capWaits(WAIT_MS);
        } else {
            calls.push(...await rt.interceptAction(session.page, { flow: 'none', service: flow.service, action: flow.action, respond: flow.respond, fail: f.fail }));
        }
        const result = await flow.run(session, baseUrl);
        const box = flow.observe ? await flow.observe(session, result) : await rt.resultBox(session.page, 30000);
        const real = calls.filter((c) => !c.mixed);
        if (calls.some((c) => c.mixed)) errors.push('action sent in a $batch with other requests');
        if (real.length !== 1) errors.push(`action called ${real.length} times, expected 1`);
        if (box.type === 'success') errors.push(`success shown despite failure: ${box.text}`);
        else if (box.type !== 'error') errors.push(`expected an error box, got ${box.type || 'none'}: ${box.text}`);
        if (!f.expect.test(box.text)) errors.push(`error box does not match ${f.expect}: ${box.text.slice(0, 200)}`);
        const screen = await session.page.evaluate(() => window.location.hash);
        if (!screen.includes(flow.hash)) errors.push(`navigated away to ${screen}`);
        const expected = f.fail && f.fail.status ? [{ status: f.fail.status, url: new RegExp(`${flow.service}/(\\$batch|${flow.action})`) }] : [];
        errors.push(...rt.sessionErrors(session, undefined, expected).filter((e) => !/Failed to load resource|ERR_|net::|^console: (Failed to invoke \/|\$batch failed)/.test(e))); // UI5 logs the mocked failure itself
    } catch (err) {
        if (err.skip) return { skipped: err.message };
        errors.push(`${err.name}: ${err.message.split('\n')[0]}`);
    } finally {
        kit.setFailure(null);
        kit.capWaits(Infinity);
        await session.close();
    }
    return errors;
}

async function verifyActionFailures(options = {}) {
    const baseUrl = (options.baseUrl || process.env.TARGET_URL || 'http://localhost:4004').replace(/\/+$/, '');
    const errors = [];
    const details = [];
    for (const flow of FLOWS) {
        if (flow.skipped) {
            console.log(`\n=== Submit failures: ${flow.label} === SKIPPED: ${flow.skipped}`);
            details.push({ flow: flow.label, status: 'SKIPPED', reason: flow.skipped });
            continue;
        }
        console.log(`\n=== Submit failures: ${flow.label} (write guard on; action MOCKED per case, not SAP) ===`);
        for (const f of FAILURES) {
            const errs = await failureCase(baseUrl, flow, f);
            if (errs.skipped) {
                console.log(`  [SKIPPED] ${f.name} — ${errs.skipped}`);
                details.push({ flow: flow.label, case: f.name, status: 'SKIPPED', reason: errs.skipped });
                continue;
            }
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
