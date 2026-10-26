'use strict';

/**
 * Tier A read-only E2E: orders due for delivery screen. The server fails closed without a plant, so a user without a
 * Plant attribute must choose one before anything loads, and a plant-scoped user starts with theirs pre-selected.
 */

const { runScreens } = require('../support/screenCheck');

const NO_PLANT_USER = [
    { name: 'Orders due, no Plant attribute: nothing requested until a plant is set', hash: 'le/orders-due', route: 'ordersDueForDelivery', needsList: true },
    { name: 'Orders due, no Plant attribute: entered plant 1120 loads the worklist', hash: 'le/orders-due', route: 'ordersDueForDelivery', fill: { id: 'inputPlant', value: '1120' }, expectRows: true }
];
const PLANT_USER = [
    { name: 'Orders due, Plant attribute 1120: pre-selected and loaded', hash: 'le/orders-due', route: 'ordersDueForDelivery', expectRows: true }
];

async function verifyLeScreens(options = {}) {
    const baseUrl = (options.baseUrl || process.env.TARGET_URL || 'http://localhost:4004').replace(/\/+$/, '');
    const a = await runScreens({ baseUrl, title: 'LE screens (Admin without plant)', steps: NO_PLANT_USER });
    const b = await runScreens({ baseUrl, user: 'bob', title: 'LE screens (plant-scoped user)', steps: PLANT_USER });
    const errors = a.errors.concat(b.errors);
    return { status: errors.length ? 'FAIL' : 'PASS', errors, details: a.details.concat(b.details) };
}

if (require.main === module) {
    verifyLeScreens().then((r) => process.exit(r.status === 'PASS' ? 0 : 1));
}

module.exports = { verifyLeScreens };
