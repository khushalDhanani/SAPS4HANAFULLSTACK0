'use strict';

/**
 * Tier C SAP round-trip runner (`npm run test:e2e:sap`). Kept apart from `npm run test:e2e` so routine runs never
 * include write flows. Every suite runs in dry-run (write guard on, its write action stubbed) unless
 * support/liveWriteGate.js authorizes live mode for that flow — which also needs the user's written go (AGENTS.md).
 */

const fs = require('fs');
const path = require('path');
const { roundTripPurchaseOrder } = require('./mm/roundTripPurchaseOrder.e2e');
const { roundTripSalesInquiry } = require('./sd/roundTripSalesInquiry.e2e');
const { roundTripSalesOrder } = require('./sd/roundTripSalesOrder.e2e');
const { roundTripGoodsReceipt } = require('./wm/roundTripGoodsReceipt.e2e');
const { roundTripGoodsIssue } = require('./wm/roundTripGoodsIssue.e2e');
const { roundTripHuTransfer } = require('./wm/roundTripHuTransfer.e2e');

const SUITES = [
    { flow: 'po', name: 'Purchase order create', fn: roundTripPurchaseOrder },
    { flow: 'salesInquiry', name: 'Sales inquiry create', fn: roundTripSalesInquiry },
    { flow: 'salesOrder', name: 'Sales order create', fn: roundTripSalesOrder },
    { flow: 'goodsReceipt', name: 'Goods receipt post', fn: roundTripGoodsReceipt },
    { flow: 'goodsIssue', name: 'Goods issue 201 (reservation entry)', fn: roundTripGoodsIssue },
    { flow: 'huTransfer', name: 'HU stock transfer 311', fn: roundTripHuTransfer }
];

async function runSapRoundTrips(options = {}) {
    const baseUrl = (options.baseUrl || process.env.TARGET_URL || 'http://localhost:4004').replace(/\/+$/, '');
    const only = String(process.env.E2E_SAP_FLOWS || '').split(',').map((s) => s.trim()).filter(Boolean);
    const results = [];
    for (const s of SUITES.filter((x) => only.length === 0 || only.includes(x.flow))) {
        console.log(`\n>>> ${s.name} (${s.flow})`);
        let r;
        try {
            r = await s.fn({ baseUrl });
        } catch (err) {
            r = { status: 'FAIL', mode: 'unknown', errors: [err.message.split('\n')[0]] };
        }
        console.log(`<<< ${r.status} [${r.mode}] ${s.name}${r.errors && r.errors.length ? ' — ' + r.errors.join('; ') : ''}`);
        results.push({ flow: s.flow, suite: s.name, status: r.status, mode: r.mode, errors: r.errors || [] });
    }
    const out = path.join(__dirname, '../../test-results');
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'e2e-sap-round-trips.json'), JSON.stringify({ when: new Date().toISOString(), baseUrl, results }, null, 2));
    return results;
}

if (require.main === module) {
    runSapRoundTrips().then((rs) => process.exit(rs.every((r) => r.status === 'PASS') ? 0 : 1));
}

module.exports = { runSapRoundTrips, SUITES };
