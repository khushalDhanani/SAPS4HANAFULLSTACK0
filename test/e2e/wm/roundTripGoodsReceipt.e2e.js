'use strict';
/* global window */

/**
 * Tier C SAP round trip: goods receipt (101) against an open inbound delivery.
 * UI: #/wm/goods-receipt → row press → #/wm/goods-receipt/{delivery} → quantity → Post → confirm Yes.
 * The controller always calls postGoodsReceiptWithStorageUnit: activeSU.StorageUnit falls back to the scanned
 * delivery number (GoodsReceipt.controller.js:302, :495), so postGoodsReceipt is not reachable from this screen.
 *
 * dry-run (default): write guard on; only that action is answered by a stub. Proves UI wiring, never SAP persistence.
 * live: needs liveWriteGate authorization + the user's written go; data from test/e2e/live/testData.json "goodsReceipt":
 *   { "deliveryDocument": "...", "quantity": 1 }
 */

const { openSession } = require('../support/screenCheck');
const { resolveMode } = require('../support/liveWriteGate');

const FLOW = 'goodsReceipt';
const ACTION = '/odata/v4/goods-receipt/postGoodsReceiptWithStorageUnit';
const AUTH = { Authorization: 'Basic ' + Buffer.from('alice:').toString('base64') };
const RESULT_BOX = '.sapMMessageBoxSuccess, .sapMMessageBoxError, .sapMMessageBoxWarning, .sapMMessageBoxInformation';
// Synthetic values: never a real SAP number, so a dry-run result cannot be mistaken for a posting.
const STUB_DOC = 'DRYRUNGR01';

/** GRStorageUnitPostResult (srv/wm/goods-receipt/service.cds:101-110) as CAP serializes an action result. */
function stubResult(body) {
    return {
        '@odata.context': '$metadata#saps4hana.wm.GoodsReceiptService.GRStorageUnitPostResult',
        Success: true,
        Message: `DRY-RUN stub, nothing posted in SAP (Material Document ${STUB_DOC})`,
        MaterialDocument: STUB_DOC,
        MaterialDocumentYear: String(new Date().getFullYear()),
        DeliveryDocument: body.DeliveryDocument || '',
        StorageUnit: body.StorageUnit || '',
        Quantity: body.Quantity,
        Unit: body.Unit || ''
    };
}

async function waitForHealth(baseUrl) {
    const end = Date.now() + 90000;
    while (Date.now() < end) {
        if (await fetch(`${baseUrl}/health`).then((r) => r.ok, () => false)) return true;
        await new Promise((r) => setTimeout(r, 2000));
    }
    return false;
}

/** READ-ONLY function import used by the detail screen (GoodsReceiptService.js:113). */
async function readDelivery(baseUrl, delivery) {
    const res = await fetch(`${baseUrl}/odata/v4/goods-receipt/getStorageUnitDetails(StorageUnit='${encodeURIComponent(delivery)}')`, { headers: AUTH });
    if (!res.ok) throw new Error(`getStorageUnitDetails ${delivery}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    return res.json();
}

async function open(session, hash) {
    await session.page.goto(`${session.baseUrl}/fiori-app/webapp/index.html#/${hash}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await session.page.waitForFunction(() => window.sap && window.sap.ui && window.sap.ui.require('sap/ui/core/Component'), null, { timeout: 30000 });
    await session.settle();
}

/** grView model of the goods receipt view (found through its open-deliveries table). */
function grView(page) {
    return page.evaluate(() => {
        const table = window.sap.ui.require('sap/ui/core/Element').registry.filter((c) => c.getId().endsWith('--tblOpenDeliveries'))[0];
        const m = table && table.getModel('grView');
        return m ? JSON.parse(JSON.stringify(m.getData())) : null;
    });
}

/** Drives the screen like a user and submits once. Returns what the UI showed. */
async function driveUi(session, { delivery, quantity, waitMs = 120000 }) {
    const { page } = session;
    await open(session, 'wm/goods-receipt');
    const rows = await page.evaluate(() => {
        const table = window.sap.ui.require('sap/ui/core/Element').registry.filter((c) => c.getId().endsWith('--tblOpenDeliveries'))[0];
        return (table ? table.getItems() : []).filter((it) => it.getDomRef())
            .map((it) => ({ id: it.getId(), delivery: it.getBindingContext('grView').getProperty('DeliveryDocument') }));
    });
    let rowId = delivery ? rows.find((r) => r.delivery === delivery) : null;
    if (!delivery) {
        // The list also holds deliveries with nothing left to receive; take the first row SAP reports an open quantity for
        for (const r of rows.slice(0, 15)) {
            if (Number((await readDelivery(session.baseUrl, r.delivery)).OpenQuantity) > 0) { rowId = r; break; }
        }
    }
    if (!rowId) throw new Error(delivery ? `delivery ${delivery} is not in the open inbound delivery list` : `no delivery with an open quantity among the first ${Math.min(rows.length, 15)} of ${rows.length} list rows`);
    // Row press on the open-deliveries list, as a user selects a delivery
    await page.click(`[id="${rowId.id}"]`);
    await session.settle();
    await page.waitForFunction(() => {
        const t = window.sap.ui.require('sap/ui/core/Element').registry.filter((c) => c.getId().endsWith('--tblOpenDeliveries'))[0];
        return t && t.getModel('grView').getProperty('/hasActiveSU');
    }, null, { timeout: 30000 });
    const before = (await grView(page)).activeSU;

    // The quantity the user receives: live from the data file, dry-run the open quantity SAP proposes
    const qty = quantity !== undefined ? quantity : before.Quantity;
    await page.fill('[id$="--inputReceiptQty-inner"]', String(qty));
    await page.press('[id$="--inputReceiptQty-inner"]', 'Tab');
    await page.click('[id$="--btnPostGoodsReceipt"]');
    await page.locator('.sapMMessageBoxQuestion button', { hasText: 'Yes' }).click();
    const box = page.locator(RESULT_BOX).first();
    await box.waitFor({ state: 'visible', timeout: waitMs });
    const cls = await box.getAttribute('class');
    return { delivery: rowId.delivery, activeSU: before, quantity: Number(qty), success: /sapMMessageBoxSuccess/.test(cls), dialog: (await box.innerText()).trim() };
}

function sessionErrors(session) {
    return [
        ...session.consoleErrors.map((e) => `console: ${e}`),
        ...session.networkErrors.map((e) => `HTTP ${e.status} ${e.url}`),
        ...session.blocked.map((b) => `write guard blocked ${b.reason}`)
    ];
}

async function dryRun(baseUrl) {
    const session = await openSession({ baseUrl, user: 'alice' });
    const calls = [];
    const errors = [];
    let ui = null;
    try {
        // Registered after the session's context guard, so it takes precedence for this one URL only
        await session.page.route((url) => url.pathname === ACTION, (route) => {
            const body = route.request().postDataJSON() || {};
            calls.push({ path: ACTION, method: route.request().method(), body });
            return route.fulfill({ status: 200, contentType: 'application/json;odata.metadata=minimal', headers: { 'OData-Version': '4.0' }, body: JSON.stringify(stubResult(body)) });
        });
        ui = await driveUi(session, {});
        if (calls.length !== 1) errors.push(`expected 1 call to ${ACTION}, got ${calls.length}`);
        const body = (calls[0] || {}).body || {};
        if (calls[0] && calls[0].method !== 'POST') errors.push(`expected POST, got ${calls[0].method}`);
        for (const k of ['DeliveryDocument', 'DeliveryDocumentItem', 'Material', 'Plant', 'StorageLocation', 'Unit']) {
            if (body[k] !== ui.activeSU[k]) errors.push(`payload ${k}=${JSON.stringify(body[k])}, UI showed ${JSON.stringify(ui.activeSU[k])}`);
        }
        if (body.DeliveryDocument !== ui.delivery) errors.push(`payload DeliveryDocument ${body.DeliveryDocument} != selected ${ui.delivery}`);
        if (Number(body.Quantity) !== ui.quantity) errors.push(`payload Quantity ${body.Quantity} != entered ${ui.quantity}`);
        if (!ui.success) errors.push(`UI did not show a success dialog: ${ui.dialog}`);
        if (!ui.dialog.includes(STUB_DOC)) errors.push(`UI dialog does not show material document ${STUB_DOC}: ${ui.dialog}`);
    } catch (err) {
        errors.push(`${err.name}: ${err.message.split('\n')[0]}`);
    } finally {
        errors.push(...sessionErrors(session));
        await session.close();
    }
    return { errors, details: { calls, ui, readBack: 'NOT VERIFIED (dry-run)' } };
}

async function live(baseUrl, data) {
    const errors = [];
    const details = { readBack: 'NOT RUN' };
    const before = await readDelivery(baseUrl, data.deliveryDocument);
    const session = await openSession({ baseUrl, user: 'alice', allowWrites: [new RegExp(`^${ACTION}$`)] });
    try {
        const ui = await driveUi(session, { delivery: data.deliveryDocument, quantity: Number(data.quantity) });
        details.ui = ui;
        const doc = (/Material Document (\d{10})/.exec(ui.dialog) || [])[1];
        if (!ui.success || !doc) {
            errors.push(`posting not confirmed by the UI: ${ui.dialog}`);
        } else {
            details.materialDocument = doc;
            // READ-ONLY read-back: verifyMaterialDocument rejects 101 (ReservationProcessAdapter.js:1135), so the
            // delivery is read again from SAP and must show the received quantity as no longer open.
            const after = await readDelivery(baseUrl, data.deliveryDocument);
            details.readBack = { before: { open: before.OpenQuantity, status: before.GoodsMovementStatus }, after: { open: after.OpenQuantity, status: after.GoodsMovementStatus } };
            const received = Number(before.OpenQuantity) - Number(after.OpenQuantity);
            if (after.GoodsMovementStatus !== 'C' && Math.abs(received - Number(data.quantity)) > 0.001) {
                errors.push(`SAP read-back: open quantity ${before.OpenQuantity} → ${after.OpenQuantity}, status ${after.GoodsMovementStatus}; expected ${data.quantity} received`);
            }
        }
    } catch (err) {
        errors.push(`${err.name}: ${err.message.split('\n')[0]}`);
    } finally {
        errors.push(...sessionErrors(session));
        await session.close();
    }
    return { errors, details };
}

async function roundTripGoodsReceipt(options = {}) {
    const baseUrl = (options.baseUrl || process.env.TARGET_URL || 'http://localhost:4004').replace(/\/+$/, '');
    let mode;
    try {
        mode = resolveMode(FLOW);
    } catch (err) {
        console.log(`  [FAIL] ${err.message}`);
        return { status: 'FAIL', mode: 'blocked', errors: [err.message], details: {} };
    }
    console.log(`\n=== Goods receipt round trip (${mode.mode === 'live' ? 'LIVE SAP WRITE' : 'READ-ONLY dry-run, write guard on, action stubbed'}) ===`);
    if (!(await waitForHealth(baseUrl))) return { status: 'FAIL', mode: mode.mode, errors: [`server not healthy at ${baseUrl}`], details: {} };
    const res = mode.mode === 'live' ? await live(baseUrl, mode.data) : await dryRun(baseUrl);
    const status = res.errors.length ? 'FAIL' : 'PASS';
    console.log(`  [${status}] goods receipt ${mode.mode}`);
    res.errors.forEach((e) => console.log(`      - ${e}`));
    return { status, mode: mode.mode, errors: res.errors, details: res.details };
}

if (require.main === module) {
    roundTripGoodsReceipt().then((r) => {
        console.log(JSON.stringify(r.details, null, 2));
        process.exit(r.status === 'PASS' ? 0 : 1);
    });
}

module.exports = { roundTripGoodsReceipt, driveUi, ACTION, stubResult };
