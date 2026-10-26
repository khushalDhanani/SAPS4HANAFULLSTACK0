'use strict';

/** Tier A read-only E2E: SD inquiry, order, invoice and return screens load real data without errors or writes. */

const { runScreens } = require('../support/screenCheck');

const STEPS = [
    { name: 'Sales inquiry list', hash: 'sd/sales-inquiries', route: 'salesInquiries', needsList: true },
    { name: 'Sales inquiry detail (first row)', route: 'salesInquiryDetail', fromFirstRow: true },
    { name: 'Sales inquiry create', hash: 'sd/sales-inquiries/create', route: 'createSalesInquiry' },
    { name: 'Sales order list', hash: 'sd/sales-orders', route: 'salesOrders', needsList: true },
    { name: 'Sales order create', hash: 'sd/sales-orders/create', route: 'createSalesOrder' },
    { name: 'Customer invoice list', hash: 'sd/invoices', route: 'customerInvoices', needsList: true },
    { name: 'Customer return list', hash: 'sd/returns', route: 'customerReturns', needsList: true },
    { name: 'Customer return create', hash: 'sd/returns/create', route: 'createCustomerReturn' }
];

function verifySdScreens(options = {}) {
    const baseUrl = (options.baseUrl || process.env.TARGET_URL || 'http://localhost:4004').replace(/\/+$/, '');
    return runScreens({ baseUrl, title: 'SD screens', steps: STEPS });
}

if (require.main === module) {
    verifySdScreens().then((r) => process.exit(r.status === 'PASS' ? 0 : 1));
}

module.exports = { verifySdScreens, STEPS };
