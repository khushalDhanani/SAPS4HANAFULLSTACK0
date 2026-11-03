'use strict';
/* global window, document */

/**
 * Tier A read-only E2E: orders due for delivery screen. The server fails closed without a plant, so a user without a
 * Plant attribute must choose one before anything loads, and a plant-scoped user starts with theirs pre-selected.
 */

const { runScreens, openSession, openHash } = require('../support/screenCheck');

const NO_PLANT_USER = [
    { name: 'Orders due, no Plant attribute: nothing requested until a plant is set', hash: 'le/orders-due', route: 'ordersDueForDelivery', needsList: true },
    { name: 'Orders due, no Plant attribute: entered plant 1120 loads the worklist', hash: 'le/orders-due', route: 'ordersDueForDelivery', fill: { id: 'inputPlant', value: '1120' }, expectRows: true }
];
const PLANT_USER = [
    { name: 'Orders due, Plant attribute 1120: pre-selected and loaded', hash: 'le/orders-due', route: 'ordersDueForDelivery', expectRows: true }
];

const TABLE_ROWS = () => window.sap.ui.require('sap/ui/core/Element').registry
    .filter((e) => e.getId().endsWith('--ordersDueTable'))[0].getItems().length;

async function scrollToEnd(page) {
    await page.mouse.move(640, 300);
    for (let i = 0; i < 4; i++) {
        await page.mouse.wheel(0, 600);
        await page.waitForTimeout(250);
    }
    await page.evaluate(() => document.querySelectorAll('section').forEach((e) => { e.scrollTop = e.scrollHeight; }));
    await page.waitForTimeout(800);
}

/** Scrolling before a plant is set must not ask the suspended table for a page; once loaded, scrolling loads more. */
async function verifyScrollBeforePlant(baseUrl) {
    const name = 'Orders due, no Plant attribute: scrolling before a plant is set raises no error';
    const session = await openSession({ baseUrl });
    const errors = [];
    try {
        const { page } = session;
        await page.setViewportSize({ width: 1280, height: 420 });
        await openHash(session, 'le/orders-due');
        await page.waitForTimeout(2500);
        await scrollToEnd(page);
        const pageErrors = () => session.consoleErrors.filter((e) => e.includes('PAGEERROR'));
        if (pageErrors().length) errors.push(`${name}: ${pageErrors()[0]}`);

        await page.fill('[id$="--inputPlant-inner"]', '1120');
        await page.press('[id$="--inputPlant-inner"]', 'Enter');
        await page.waitForFunction(TABLE_ROWS, null, { timeout: 60000 });
        const firstPage = await page.evaluate(TABLE_ROWS);
        await scrollToEnd(page);
        await page.waitForFunction((n) => (window.sap.ui.require('sap/ui/core/Element').registry
            .filter((e) => e.getId().endsWith('--ordersDueTable'))[0].getItems().length) > n, firstPage, { timeout: 30000 })
            .catch(() => { if (firstPage >= 25) errors.push(`${name}: scrolling did not load past the first ${firstPage} rows`); });
        if (pageErrors().length && !errors.length) errors.push(`${name}: ${pageErrors()[0]}`);
    } finally {
        await session.close();
    }
    console.log(`  [${errors.length ? 'FAIL' : 'PASS'}] ${name}`);
    errors.forEach((e) => console.log(`      - ${e}`));
    return { errors, details: [{ step: name, status: errors.length ? 'FAIL' : 'PASS' }] };
}

async function verifyLeScreens(options = {}) {
    const baseUrl = (options.baseUrl || process.env.TARGET_URL || 'http://localhost:4004').replace(/\/+$/, '');
    const a = await runScreens({ baseUrl, title: 'LE screens (Admin without plant)', steps: NO_PLANT_USER });
    const b = await runScreens({ baseUrl, user: 'test-viewer-1120', title: 'LE screens (plant-scoped user)', steps: PLANT_USER });
    const c = await verifyScrollBeforePlant(baseUrl);
    const errors = a.errors.concat(b.errors, c.errors);
    return { status: errors.length ? 'FAIL' : 'PASS', errors, details: a.details.concat(b.details, c.details) };
}

if (require.main === module) {
    verifyLeScreens().then((r) => process.exit(r.status === 'PASS' ? 0 : 1));
}

module.exports = { verifyLeScreens };
