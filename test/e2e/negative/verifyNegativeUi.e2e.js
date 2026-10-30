'use strict';
/* global document */

/**
 * Tier B negative-path E2E, all behind the write guard (no SAP write possible):
 * B1 signed-out deep link → login; B2 empty-form double submit on every create screen → validation feedback and
 * no write request attempted; B3 simulated list read failure (mocked HTTP 500, not SAP) → load-error text, no crash.
 */

const { openSession, openHash, inspectScreen } = require('../support/screenCheck');

const CREATE_SCREENS = [
    { name: 'Purchase order create', hash: 'mm/purchase-orders/create', route: 'createPurchaseOrder', button: 'btnSave' },
    { name: 'Sales inquiry create', hash: 'sd/sales-inquiries/create', route: 'createSalesInquiry', button: 'btnSaveInquiry' },
    { name: 'Sales order create', hash: 'sd/sales-orders/create', route: 'createSalesOrder', button: 'btnSaveOrder' },
    { name: 'Customer return create', hash: 'sd/returns/create', route: 'createCustomerReturn', button: 'btnFooterCreateInSAP' },
    { name: 'Reservation entry create', hash: 'wm/reservation-entry/create', route: 'wmReservationEntryCreate', button: 'btnSaveReservation' }
];

const FAILING_LISTS = [
    { name: 'Purchase order list read fails', hash: 'mm/purchase-orders', route: 'purchaseOrders', service: '/odata/v4/purchase-order/' },
    { name: 'Sales order list read fails', hash: 'sd/sales-orders', route: 'salesOrders', service: '/odata/v4/sales-order/' }
];

/** Visible validation feedback: inputs in error state or a message box/strip/toast/popover. */
function feedback(page) {
    return page.evaluate(() => {
        const visible = (e) => e.getClientRects().length > 0;
        const count = (sel) => [...document.querySelectorAll(sel)].filter(visible).length;
        return {
            invalidFields: count('[aria-invalid="true"]'),
            messages: count('.sapMMessageBox, .sapMMsgStripError, .sapMMessageToast, .sapMMsgPopover')
        };
    });
}

async function b1SignedOut(baseUrl) {
    const session = await openSession({ baseUrl, user: null });
    try {
        await openHash(session, 'mm/purchase-orders');
        const screen = await inspectScreen(session.page);
        return screen.route === 'login' ? [] : [`expected redirect to login, got ${screen.route || '(none)'} (hash "${screen.hash}")`];
    } finally {
        await session.close();
    }
}

async function b2EmptySubmit(baseUrl, screen) {
    const session = await openSession({ baseUrl });
    try {
        await openHash(session, screen.hash);
        const errors = [];
        const shown = await inspectScreen(session.page);
        if (shown.route !== screen.route) return [`expected route ${screen.route}, got ${shown.route}`];
        const btn = session.page.locator(`[id$="--${screen.button}"]`).first();
        if (!(await btn.isVisible())) return [`submit button ${screen.button} not visible`];
        const blockedBefore = session.blocked.length;
        await btn.click({ clickCount: 2 });
        await session.settle();
        const fb = await feedback(session.page);
        session.blocked.slice(blockedBefore).forEach((b) => errors.push(`empty form attempted a write (blocked by guard): ${b.reason}`));
        if (fb.invalidFields === 0 && fb.messages === 0) errors.push('no validation feedback after submitting an empty form');
        console.log(`      feedback: ${fb.invalidFields} invalid field(s), ${fb.messages} message(s)`);
        return errors;
    } finally {
        await session.close();
    }
}

async function b3ListFailure(baseUrl, list) {
    const session = await openSession({ baseUrl });
    try {
        // Simulated backend failure for this service's reads only (registered after the guard, so it takes precedence)
        await session.page.route(`**${list.service}$batch`, (route) => route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ error: { code: '500', message: 'E2E simulated backend failure' } })
        }));
        await openHash(session, list.hash);
        const screen = await inspectScreen(session.page);
        const errors = [];
        if (screen.route !== list.route) errors.push(`expected route ${list.route}, got ${screen.route}`);
        if (!screen.lists.some((l) => /could not be loaded/i.test(l.noDataText))) {
            errors.push(`no load-error text on the list (noDataText: ${screen.lists.map((l) => l.noDataText).join(' | ') || 'no visible list'})`);
        }
        session.consoleErrors.filter((e) => e.startsWith('PAGEERROR')).forEach((e) => errors.push(`uncaught page error: ${e}`));
        return errors;
    } finally {
        await session.close();
    }
}

async function verifyNegativeUi(options = {}) {
    const baseUrl = (options.baseUrl || process.env.TARGET_URL || 'http://localhost:4004').replace(/\/+$/, '');
    console.log('\n=== Negative UI paths (READ-ONLY, write guard on; B3 uses a mocked 500, not SAP) ===');
    const cases = [{ name: 'B1 signed-out deep link redirects to login', run: () => b1SignedOut(baseUrl) }]
        .concat(CREATE_SCREENS.map((s) => ({ name: `B2 ${s.name}: empty double submit`, run: () => b2EmptySubmit(baseUrl, s) })))
        .concat(FAILING_LISTS.map((l) => ({ name: `B3 ${l.name}`, run: () => b3ListFailure(baseUrl, l) })));
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
    verifyNegativeUi().then((r) => process.exit(r.status === 'PASS' ? 0 : 1));
}

module.exports = { verifyNegativeUi };
