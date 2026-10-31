'use strict';
/* global window */

/**
 * Tier C SAP round trip: goods issue to cost center (movement 201) through the reservation-entry create screen.
 * UI: #/wm/reservation-entry/create → movement 201 → plant, SLoc, material, quantity, unit, cost center → "Create".
 * One submit = exactly one POST, createReservationEntry (ReservationEntryDetail.controller.js:605); the backend creates
 * the SAP reservation and auto-creates the TR in that call. TO, TO confirmation and MIGO are later, separate steps.
 * 201 is the flow's goods issue (cost center); it needs only master data the read-only value helps provide.
 *
 * dry-run (default): write guard on; only createReservationEntry is answered by a stub. Never proves SAP persistence.
 * live: needs liveWriteGate authorization + the user's written go; data from test/e2e/live/testData.json "goodsIssue":
 *   { "plant", "storageLocation", "warehouseNumber", "material", "quantity", "unit", "costCenter" }
 */

const { openSession, openHash } = require('../support/screenCheck');
const { resolveMode } = require('../support/liveWriteGate');

const FLOW = 'goodsIssue';
const SERVICE = '/odata/v4/reservation-entry';
const ACTION = `${SERVICE}/createReservationEntry`;
const AUTH = { Authorization: 'Basic ' + Buffer.from('alice:').toString('base64') };
const RESULT_BOX = '.sapMMessageBoxSuccess, .sapMMessageBoxError, .sapMMessageBoxWarning, .sapMMessageBoxInformation';
// Synthetic values: never a real SAP number, so a dry-run result cannot be mistaken for a posting.
const STUB_RES = 'DRYRUNRS01';
const STUB_TR = 'DRYRUNTR01';

/** ReservationEntries row (service.cds:169 → db/wm/reservation-track.cds:21-62), status 02 = reservation + TR created. */
function stubResult(body) {
    return {
        '@odata.context': '$metadata#ReservationEntries/$entity',
        ReservationNo: STUB_RES,
        ReservationItem: '0001',
        MovementType: body.MovementType,
        WarehouseNumber: body.WarehouseNumber || null,
        Plant: body.Plant,
        StorageLocation: body.StorageLocation,
        Material: body.Material,
        MaterialName: body.MaterialName || null,
        Quantity: body.Quantity,
        Unit: body.Unit,
        CostCenter: body.CostCenter,
        TransferRequirement: STUB_TR,
        TransferOrder: null,
        MaterialDocument: null,
        MaterialDocYear: null,
        ProcessStatus: 'TR_CREATED',
        Status_code: '02',
        StatusText: 'TR Auto-Created',
        ErrorMessage: null,
        ErrorStep: null
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

async function getJson(baseUrl, path) {
    const res = await fetch(`${baseUrl}${path}`, { headers: AUTH });
    if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const body = await res.json();
    return body.value !== undefined ? body.value : body;
}

/**
 * Dry-run data from READ-ONLY reads the reservation screens use (ReservationEntryService.js:46, :61): the master data
 * of the first open 201 reservation item that has a cost center, so every value is one SAP already accepted together.
 */
async function pickDryRunData(baseUrl) {
    const open = await getJson(baseUrl, `${SERVICE}/getOpenReservations(plant='',movementType='201')`);
    for (const row of open.slice(0, 10)) {
        const d = await getJson(baseUrl, `${SERVICE}/getReservationDetail(ReservationNo='${row.ReservationNo}',ReservationItem='${row.ReservationItem}')`).catch(() => null);
        if (d && d.CostCenter && d.Plant && d.StorageLocation && d.Material && d.Unit) {
            return { source: `${d.ReservationNo}/${d.ReservationItem}`, plant: d.Plant, storageLocation: d.StorageLocation, warehouseNumber: d.WarehouseNumber || '', material: d.Material, quantity: 1, unit: d.Unit, costCenter: d.CostCenter };
        }
    }
    throw new Error(`no open 201 reservation item with plant, SLoc, material, unit and cost center among ${Math.min(open.length, 10)} read`);
}

const open = openHash;

function createModel(page) {
    return page.evaluate(() => {
        const sel = window.sap.ui.require('sap/ui/core/Element').registry.filter((c) => c.getId().endsWith('--selectMovementType'))[0];
        return sel ? JSON.parse(JSON.stringify(sel.getModel('create').getData())) : null;
    });
}

/** Types into an sap.m.Input and leaves it with Tab, as a user would. */
async function type(session, id, value) {
    const sel = `[id$="--${id}-inner"]`;
    await session.page.fill(sel, String(value));
    await session.page.press(sel, 'Tab');
    await session.settle();
}

/** Fills the create form like a user and submits once. Returns what the UI showed. */
async function driveUi(session, data) {
    const { page } = session;
    await open(session, 'wm/reservation-entry/create');
    // Choose movement 201 in the Select (fires the same change event a user's pick does)
    await page.evaluate(() => {
        const sel = window.sap.ui.require('sap/ui/core/Element').registry.filter((c) => c.getId().endsWith('--selectMovementType'))[0];
        const item = sel.getItems().find((i) => i.getKey() === '201');
        sel.setSelectedItem(item);
        sel.fireChange({ selectedItem: item });
    });
    await type(session, 'inputPlant', data.plant);
    await type(session, 'inputStorageLocation', data.storageLocation);
    if (data.warehouseNumber) await type(session, 'inputWarehouseNumber', data.warehouseNumber);
    await type(session, 'inputMaterial', data.material);
    await type(session, 'inputQuantity', data.quantity);
    await type(session, 'inputUnit', data.unit);
    await type(session, 'inputCostCenter', data.costCenter);
    const form = await createModel(page);
    const want = { MovementType: '201', Plant: data.plant, StorageLocation: data.storageLocation, Material: data.material, Unit: data.unit, CostCenter: data.costCenter };
    const formErrors = Object.entries(want).filter(([k, v]) => String(form[k]) !== String(v)).map(([k, v]) => `form ${k}=${JSON.stringify(form[k])}, typed ${JSON.stringify(v)}`);
    if (Number(form.Quantity) !== Number(data.quantity)) formErrors.push(`form Quantity=${form.Quantity}, typed ${data.quantity}`);
    if (formErrors.length) return { form, formErrors };

    await page.click('[id$="--btnSaveReservation"]');
    const box = page.locator(RESULT_BOX).first();
    await box.waitFor({ state: 'visible', timeout: 180000 });
    const cls = await box.getAttribute('class');
    return { form, formErrors, success: /sapMMessageBoxSuccess/.test(cls), dialog: (await box.innerText()).trim(), box };
}

function sessionErrors(session) {
    return [
        ...session.consoleErrors.map((e) => `console: ${e}`),
        ...session.networkErrors.map((e) => `HTTP ${e.status} ${e.url}`),
        ...session.blocked.map((b) => `write guard blocked ${b.reason}`)
    ];
}

async function dryRun(baseUrl) {
    const errors = [];
    const calls = [];
    let data = null;
    let ui = null;
    const session = await openSession({ baseUrl, user: 'alice' });
    try {
        data = await pickDryRunData(baseUrl);
        // Registered after the session's context guard, so it takes precedence for this one URL only
        await session.page.route((url) => url.pathname === ACTION, (route) => {
            const body = route.request().postDataJSON() || {};
            calls.push({ path: ACTION, method: route.request().method(), body });
            return route.fulfill({ status: 201, contentType: 'application/json;odata.metadata=minimal', headers: { 'OData-Version': '4.0' }, body: JSON.stringify(stubResult(body)) });
        });
        ui = await driveUi(session, data);
        errors.push(...ui.formErrors);
        if (!ui.formErrors.length) {
            if (calls.length !== 1) errors.push(`expected 1 call to ${ACTION}, got ${calls.length}`);
            const body = (calls[0] || {}).body || {};
            const want = { MovementType: '201', Plant: data.plant, StorageLocation: data.storageLocation, Material: data.material, Unit: data.unit, CostCenter: data.costCenter };
            Object.entries(want).forEach(([k, v]) => { if (body[k] !== v) errors.push(`payload ${k}=${JSON.stringify(body[k])}, expected ${JSON.stringify(v)}`); });
            if (Number(body.Quantity) !== Number(data.quantity)) errors.push(`payload Quantity ${body.Quantity} != ${data.quantity}`);
            if (!body.ClientAttemptId) errors.push('payload has no ClientAttemptId (idempotency key)');
            if (!ui.success) errors.push(`UI did not show a success dialog: ${ui.dialog}`);
            if (!ui.dialog.includes(STUB_RES) || !ui.dialog.includes(STUB_TR)) errors.push(`UI dialog does not show reservation ${STUB_RES} and TR ${STUB_TR}: ${ui.dialog}`);
            // The dialog is left open: closing it opens the (non-existent) stub reservation's detail page.
        }
    } catch (err) {
        errors.push(`${err.name}: ${err.message.split('\n')[0]}`);
    } finally {
        errors.push(...sessionErrors(session));
        await session.close();
    }
    if (ui) delete ui.box;
    return { errors, details: { data, calls, ui, readBack: 'NOT VERIFIED (dry-run)' } };
}

async function live(baseUrl, data) {
    const errors = [];
    const details = { readBack: 'NOT RUN' };
    const session = await openSession({ baseUrl, user: 'alice', allowWrites: [new RegExp(`^${ACTION}$`)] });
    try {
        const ui = await driveUi(session, { ...data, quantity: Number(data.quantity) });
        errors.push(...ui.formErrors);
        const m = /Reservation (\d+) created in SAP\. Transfer Requirement (\d+) created/.exec(ui.dialog || '');
        if (!ui.formErrors.length && (!ui.success || !m)) errors.push(`create not confirmed by the UI: ${ui.dialog}`);
        if (m) {
            details.reservation = m[1];
            details.transferRequirement = m[2];
            // READ-ONLY read-back from SAP RKPF/RESB (@readonly function, service.cds:390-394)
            const sap = await getJson(baseUrl, `${SERVICE}/getReservationDetail(ReservationNo='${m[1]}',ReservationItem='0001')`);
            details.readBack = sap;
            const strip = (v) => String(v || '').replace(/^0+(?=\d)/, '');
            const want = { MovementType: '201', Plant: data.plant, StorageLocation: data.storageLocation, CostCenter: data.costCenter, TransferRequirement: m[2] };
            Object.entries(want).forEach(([k, v]) => { if (strip(sap[k]) !== strip(v)) errors.push(`SAP read-back ${k}=${sap[k]}, expected ${v}`); });
            if (strip(sap.Material) !== strip(data.material)) errors.push(`SAP read-back Material=${sap.Material}, expected ${data.material}`);
            if (Math.abs(Number(sap.Quantity) - Number(data.quantity)) > 0.001) errors.push(`SAP read-back Quantity=${sap.Quantity}, expected ${data.quantity}`);
            // Closing the dialog opens the reservation page; it must show the SAP reservation
            await ui.box.locator('button', { hasText: 'OK' }).click();
            await session.settle();
            await session.page.waitForFunction((no) => window.document.body.innerText.includes(no), m[1], { timeout: 30000 })
                .catch(() => errors.push(`reservation page does not show ${m[1]}`));
        }
    } catch (err) {
        errors.push(`${err.name}: ${err.message.split('\n')[0]}`);
    } finally {
        errors.push(...sessionErrors(session));
        await session.close();
    }
    return { errors, details };
}

async function roundTripGoodsIssue(options = {}) {
    const baseUrl = (options.baseUrl || process.env.TARGET_URL || 'http://localhost:4004').replace(/\/+$/, '');
    let mode;
    try {
        mode = resolveMode(FLOW);
    } catch (err) {
        console.log(`  [FAIL] ${err.message}`);
        return { status: 'FAIL', mode: 'blocked', errors: [err.message], details: {} };
    }
    console.log(`\n=== Goods issue 201 round trip (${mode.mode === 'live' ? 'LIVE SAP WRITE' : 'READ-ONLY dry-run, write guard on, action stubbed'}) ===`);
    if (!(await waitForHealth(baseUrl))) return { status: 'FAIL', mode: mode.mode, errors: [`server not healthy at ${baseUrl}`], details: {} };
    const res = mode.mode === 'live' ? await live(baseUrl, mode.data) : await dryRun(baseUrl);
    const status = res.errors.length ? 'FAIL' : 'PASS';
    console.log(`  [${status}] goods issue 201 ${mode.mode}`);
    res.errors.forEach((e) => console.log(`      - ${e}`));
    return { status, mode: mode.mode, errors: res.errors, details: res.details };
}

if (require.main === module) {
    roundTripGoodsIssue().then((r) => {
        console.log(JSON.stringify(r.details, null, 2));
        process.exit(r.status === 'PASS' ? 0 : 1);
    });
}

module.exports = { roundTripGoodsIssue };
