'use strict';

/** Tier A read-only E2E: purchase order list, detail and create screens. */

const { runScreens } = require('../support/screenCheck');

const STEPS = [
    { name: 'Purchase order list', hash: 'mm/purchase-orders', route: 'purchaseOrders', needsList: true },
    { name: 'Purchase order detail (first row)', route: 'purchaseOrderDetail', fromFirstRow: true },
    { name: 'Purchase order create', hash: 'mm/purchase-orders/create', route: 'createPurchaseOrder' }
];

function verifyMmScreens(options = {}) {
    const baseUrl = (options.baseUrl || process.env.TARGET_URL || 'http://localhost:4004').replace(/\/+$/, '');
    return runScreens({ baseUrl, title: 'MM screens', steps: STEPS });
}

if (require.main === module) {
    verifyMmScreens().then((r) => process.exit(r.status === 'PASS' ? 0 : 1));
}

module.exports = { verifyMmScreens, STEPS };
