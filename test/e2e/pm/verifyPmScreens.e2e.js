'use strict';

/** Tier A read-only E2E: PM Maintenance Orders screen. */

const { runScreens } = require('../support/screenCheck');

const STEPS = [
    { name: 'Maintenance Orders list', hash: 'pm/maintenance-orders', route: 'maintenanceOrders', needsList: true }
];

async function verifyPmScreens(options = {}) {
    const baseUrl = (options.baseUrl || process.env.TARGET_URL || 'http://localhost:4004').replace(/\/+$/, '');
    return runScreens({ baseUrl, title: 'PM screens', steps: STEPS });
}

if (require.main === module) {
    verifyPmScreens().then((r) => process.exit(r.status === 'PASS' ? 0 : 1));
}

module.exports = { verifyPmScreens, STEPS };
