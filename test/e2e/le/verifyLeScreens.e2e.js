'use strict';

/** Tier A read-only E2E: orders due for delivery screen. */

const { runScreens } = require('../support/screenCheck');

const STEPS = [
    { name: 'Orders due for delivery', hash: 'le/orders-due', route: 'ordersDueForDelivery', needsList: true }
];

function verifyLeScreens(options = {}) {
    const baseUrl = (options.baseUrl || process.env.TARGET_URL || 'http://localhost:4004').replace(/\/+$/, '');
    return runScreens({ baseUrl, title: 'LE screens', steps: STEPS });
}

if (require.main === module) {
    verifyLeScreens().then((r) => process.exit(r.status === 'PASS' ? 0 : 1));
}

module.exports = { verifyLeScreens, STEPS };
