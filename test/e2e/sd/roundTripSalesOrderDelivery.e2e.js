'use strict';

/**
 * Tier C SAP round trip: outbound delivery from the sales order list (#/sd/sales-orders, SalesOrders.controller.js
 * onCreateDeliveryPress → CreateDeliveryDialog → onConfirmCreateDelivery) → OutboundDeliveryService.createOutboundDelivery
 * → POST /odata/v4/outbound-delivery/createOutboundDelivery (srv/le/outbound-delivery/service.cds:35-40, returns String),
 * a direct POST (le/outbound-delivery/service/OutboundDeliveryService.js:178).
 * The list has no ShippingPoint (SalesOrders projection), so the dialog starts empty and the user picks one.
 *
 * dry-run (default): a ready sales order and its shipping point from the READ-ONLY worklist the LE screen uses
 * (outbound-delivery/OrdersDueForDelivery, plant 1120); the order is searched in the list like a user would.
 * When the search cannot show it, that is reported as a failure and the dry-run continues with the first order the
 * unfiltered list enables (shipping point from the worklist, else ShippingPointVH) to still exercise the dialog.
 * Proves UI wiring only (stubbed action), never SAP persistence.
 * live: liveWriteGate flow "salesOrderDelivery" + the user's written go; testData.json "salesOrderDelivery":
 *   { "salesOrder": "...", "shippingPoint": "..." }
 * Live read-back (GET-only): outbound-delivery/getDeliveryStatus(DeliveryDocument='<no>').
 */

const { openSession } = require('../support/screenCheck');
const { resolveMode } = require('../support/liveWriteGate');
const rt = require('../support/actionRoundTrip');

const FLOW = 'salesOrderDelivery';
const SERVICE = '/odata/v4/outbound-delivery';
const ACTION = 'createOutboundDelivery';
const DRYRUN_PLANT = '1120'; // the plant the LE screen suite uses (verifyLeScreens.e2e.js)
// Synthetic value: never a real SAP number, so a dry-run result cannot be mistaken for a created delivery.
const STUB_DELIVERY = 'DRYRUNOD03';

async function deriveData(get) {
    const rows = await get(`outbound-delivery/OrdersDueForDelivery?$filter=${encodeURIComponent(`Plant eq '${DRYRUN_PLANT}' and IsDeliverable eq true`)}&$top=20`);
    const row = rows.find((r) => r.ShippingPoint && !r.DelivBlockReasonForSchedLine);
    if (!row) throw new Error(`no deliverable worklist row for plant ${DRYRUN_PLANT}`);
    return { salesOrder: row.SalesOrder, shippingPoint: row.ShippingPoint };
}

async function roundTripSalesOrderDelivery(options = {}) {
    const baseUrl = (options.baseUrl || process.env.TARGET_URL || 'http://localhost:4004').replace(/\/+$/, '');
    let gate;
    try {
        gate = resolveMode(FLOW, options.gate);
    } catch (err) {
        console.log(`  [FAIL] ${err.message}`);
        return { status: 'FAIL', mode: 'blocked', errors: [err.message], details: {} };
    }
    const live = gate.mode === 'live';
    console.log(`\n=== Sales order → outbound delivery round trip — Tier C ${live ? 'LIVE SAP WRITE' : 'READ-ONLY dry-run (stubbed write action)'} ===`);
    if (!(await rt.waitForHealth(baseUrl))) return { status: 'FAIL', mode: gate.mode, errors: [`server not healthy at ${baseUrl}`], details: {} };

    const get = rt.capGet(baseUrl);
    const out = { name: 'create delivery from sales order list', errors: [], details: {} };
    let v;
    try {
        v = live ? { ...gate.data } : await deriveData(get);
    } catch (err) {
        out.errors.push(`test data: ${err.message}`);
        return rt.suiteResult('sales order delivery round trip', gate.mode, [out]);
    }
    out.details.values = v;
    console.log(`  data (${live ? 'test/e2e/live/testData.json' : 'READ-ONLY CAP reads'}): ${JSON.stringify(v)}`);

    const session = await openSession({ baseUrl, user: 'alice' });
    try {
        const calls = await rt.interceptAction(session.page, { flow: FLOW,
            service: SERVICE, action: ACTION, live,
            respond: () => ({ '@odata.context': '$metadata#Edm.String', value: STUB_DELIVERY })
        });
        await rt.openHash(session, 'sd/sales-orders');
        const before = { console: session.consoleErrors.length, network: session.networkErrors.length, blocked: session.blocked.length };
        await session.page.fill('[id$="--searchOrders-I"]', v.salesOrder);
        await session.page.press('[id$="--searchOrders-I"]', 'Enter');
        await session.settle();
        const listed = (await rt.listButtons(session.page, 'btnSalesOrderCreateDelivery', 'salesOrder')).filter((b) => b.row);
        let pick = listed.find((b) => b.row.SalesOrder === v.salesOrder);
        if (!pick) {
            // The search itself is asserted (its errors stay in the result); dry-run then continues with the first
            // order the unfiltered list enables for delivery, so the create flow is still exercised.
            const searchErrors = rt.sessionErrors(session, before);
            out.errors.push(`list search for ${v.salesOrder} did not show the order${searchErrors.length ? ` (${searchErrors.join('; ')})` : ''}`);
            if (live) throw new Error(`sales order ${v.salesOrder} not reachable in the list`);
            await session.page.fill('[id$="--searchOrders-I"]', '');
            await session.page.press('[id$="--searchOrders-I"]', 'Enter');
            await session.settle();
            pick = (await rt.listButtons(session.page, 'btnSalesOrderCreateDelivery', 'salesOrder')).find((b) => b.row);
            if (!pick) throw new Error('no sales order in the list enables Create Delivery');
            // shipping point for that order: from the worklist when it is there, else the dialog's own value help
            const wl = await get(`outbound-delivery/OrdersDueForDelivery?$filter=${encodeURIComponent(`Plant eq '${DRYRUN_PLANT}' and SalesOrder eq '${pick.row.SalesOrder}'`)}&$top=1`);
            const sp = wl[0] ? wl[0].ShippingPoint : ((await get('outbound-delivery/ShippingPointVH?$top=1'))[0] || {}).ShippingPoint;
            v = { salesOrder: pick.row.SalesOrder, shippingPoint: sp, fallback: true };
            out.details.values = v;
        }
        await session.page.click(`[id="${pick.id}"]`);
        await session.settle();
        await rt.selectKey(session, 'comboDeliveryShippingPoint', v.shippingPoint);
        const dlg = await rt.modelData(session.page, 'deliveryDialog');
        out.details.dialog = dlg;
        await session.page.locator('[id$="--btnConfirmDelivery"]').click(); // exactly one submit, never retried
        const box = await rt.resultBox(session.page, live ? 180000 : 30000);
        await session.settle();
        out.details.ui = box;
        out.details.calls = calls;
        out.errors.push(...rt.checkCalls(calls, { SalesOrder: v.salesOrder, ShippingPoint: v.shippingPoint, DeliveryDate: dlg.deliveryDate }, ACTION));
        const call = calls.find((c) => !c.mixed) || {};
        const docNo = live ? ((call.result || {}).value || '') : STUB_DELIVERY;
        out.details.documentNumber = docNo;
        if (box.type !== 'success') out.errors.push(`UI showed ${box.type || 'no'} result: ${box.text}`);
        if (!docNo || !box.text.includes(docNo)) out.errors.push(`UI result does not show delivery ${docNo || '(none returned)'}: ${box.text}`);
        if (live && docNo) {
            out.details.readBack = 'VERIFIED';
            const rb = await get(`outbound-delivery/getDeliveryStatus(DeliveryDocument='${encodeURIComponent(docNo)}')`)
                .then((s) => (s.DeliveryDocument === docNo ? [] : [`getDeliveryStatus(${docNo}) returned ${JSON.stringify(s).slice(0, 200)}`]),
                    (err) => [`read-back failed: ${err.message}`]);
            if (rb.length) out.details.readBack = 'FAIL';
            out.errors.push(...rb);
        } else {
            out.details.readBack = live ? 'NOT RUN (no document number)' : 'NOT VERIFIED (dry-run)';
        }
    } catch (err) {
        out.errors.push(`${err.name}: ${err.message.split('\n')[0]}`);
    } finally {
        out.errors.push(...rt.sessionErrors(session));
        await session.close();
    }
    return rt.suiteResult('sales order delivery round trip', gate.mode, [out]);
}

if (require.main === module) {
    roundTripSalesOrderDelivery().then((r) => {
        console.log(JSON.stringify(r.details, null, 2));
        process.exit(r.status === 'PASS' ? 0 : 1);
    });
}

module.exports = { roundTripSalesOrderDelivery };
