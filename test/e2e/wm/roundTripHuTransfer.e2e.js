'use strict';
/* global window */

/**
 * Tier C SAP round trip: single handling-unit stock transfer (311) against an open reservation.
 * UI: #/wm/hu-stock-transfer (list) → #/wm/hu-stock-transfer/{reservation}/{item} → scan HU → Validate (GET
 * validateUnit) → transfer quantity → footer "Post" → confirm OK → POST executeHuStockTransfer
 * (HuStockTransferDetail.controller.js:533-614). That footer path is one write. The multi-HU panel path
 * (validateHuStockTransferSelection, a POST action at service.cds:315 the guard would block, then
 * executeHuStockTransferSelection) is not driven here.
 *
 * dry-run (default): write guard on; only executeHuStockTransfer is answered by a stub. Never proves SAP persistence.
 * live: needs liveWriteGate authorization + the user's written go; data from test/e2e/live/testData.json "huTransfer":
 *   { "reservationNo", "reservationItem", "unitNumber", "transferQty" }
 */

const { openSession, openHash } = require('../support/screenCheck');
const { resolveMode } = require('../support/liveWriteGate');

const FLOW = 'huTransfer';
const SERVICE = '/odata/v4/hu-stock-transfer';
const ACTION = `${SERVICE}/executeHuStockTransfer`;
const AUTH = { Authorization: 'Basic ' + Buffer.from('alice:').toString('base64') };
const RESULT_BOX = '.sapMMessageBoxSuccess, .sapMMessageBoxError, .sapMMessageBoxWarning, .sapMMessageBoxInformation';
// Synthetic value: never a real SAP number, so a dry-run result cannot be mistaken for a posting.
const STUB_DOC = 'DRYRUNHU01';

/** HuStockTransferResult (srv/wm/hu-stock-transfer/service.cds:221-237) as CAP serializes an action result. */
function stubResult(body) {
    return {
        '@odata.context': '$metadata#saps4hana.wm.HuStockTransferService.HuStockTransferResult',
        Success: true,
        ReservationNo: body.ReservationNo,
        ReservationItem: body.ReservationItem,
        MaterialDocument: STUB_DOC,
        MaterialDocYear: String(new Date().getFullYear()),
        PostingPath: 'DRY-RUN',
        TransferredQty: body.TransferQty,
        BaseUnit: null,
        UnitNumber: body.UnitNumber,
        UpdatedOpenQty: null,
        UpdatedStatus: null,
        IsFinalIssue: false,
        ReadBackVerified: false,
        RequesterAlertSent: false,
        Message: 'DRY-RUN stub, nothing posted in SAP'
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
    const text = await res.text();
    if (!res.ok) throw new Error(`GET ${path.split('(')[0]}: HTTP ${res.status} ${text.slice(0, 300)}`);
    const body = JSON.parse(text);
    return body.value !== undefined ? body.value : body;
}

const open = openHash;

/** A named JSON model of the view that owns the control with the given local id. */
function viewModel(page, controlId, model) {
    return page.evaluate(([id, name]) => {
        const c = window.sap.ui.require('sap/ui/core/Element').registry.filter((e) => e.getId().endsWith('--' + id))[0];
        const m = c && c.getModel(name);
        return m ? JSON.parse(JSON.stringify(m.getData())) : null;
    }, [controlId, model]);
}

/**
 * Dry-run data: the reservations the list screen loaded (listView>/items, READ-ONLY getOpenReservations), then for
 * each the HUs the "Storage bins" dialog reads (READ-ONLY getStorageBins), preferring one validateUnit accepts.
 */
async function pickDryRunData(session) {
    await open(session, 'wm/hu-stock-transfer');
    const list = await viewModel(session.page, 'btnRefreshList', 'listView');
    const items = (list && list.items) || [];
    if (!items.length) throw new Error('HU stock transfer list returned no open reservation');
    const candidates = [];
    const probeErrors = [];
    for (const it of items.slice(0, 100)) {
        const bins = await getJson(session.baseUrl, `${SERVICE}/getStorageBins(reservation='${it.ReservationNo}',item='${it.ReservationItem}')`).catch(() => []);
        const hu = bins.find((b) => b.UnitCategory === 'HU' && Number(b.AvailableStock) > 0);
        if (!hu) continue;
        const cand = { reservationNo: it.ReservationNo, reservationItem: it.ReservationItem, unitNumber: hu.UnitNumber };
        candidates.push(cand);
        try {
            const v = await getJson(session.baseUrl, `${SERVICE}/validateUnit(reservation='${it.ReservationNo}',item='${it.ReservationItem}',unitNumber='${hu.UnitNumber}')`);
            if (v.Valid) return { ...cand, probe: 'validateUnit Valid' };
            probeErrors.push(`${cand.reservationNo}/${cand.unitNumber}: ${v.StatusMessage}`);
        } catch (err) {
            probeErrors.push(`${cand.reservationNo}/${cand.unitNumber}: ${err.message}`);
        }
        if (candidates.length >= 5) break;
    }
    if (!candidates.length) throw new Error(`no open reservation with an HU in stock among the first ${Math.min(items.length, 100)} list rows`);
    // No HU validates: still drive the first one through the UI so the failure is the one a user sees
    return { ...candidates[0], probe: `no candidate validated: ${probeErrors.join(' | ')}` };
}

/** Scans and validates the HU like a user, then posts once. Returns what the UI showed. */
async function driveUi(session, data) {
    const { page } = session;
    await open(session, `wm/hu-stock-transfer/${data.reservationNo}/${data.reservationItem}`);
    await page.fill('[id$="--inputUnitNumber-inner"]', data.unitNumber);
    await page.press('[id$="--inputUnitNumber-inner"]', 'Tab');
    await page.click('[id$="--btnValidateUnit"]');
    await session.settle();
    let cockpit = await viewModel(page, 'btnPostTransfer', 'cockpitView');
    if (!cockpit.validatedUnit || !cockpit.validatedUnit.Valid) {
        const err = page.locator('.sapMMessageBoxError').first();
        const shown = await err.isVisible() ? (await err.innerText()).trim() : cockpit.statusMessage;
        return { cockpit, validated: false, dialog: shown };
    }
    if (data.transferQty !== undefined) {
        await page.fill('[id$="--inputTransferQty-input-inner"]', String(data.transferQty));
        await page.press('[id$="--inputTransferQty-input-inner"]', 'Tab');
        cockpit = await viewModel(page, 'btnPostTransfer', 'cockpitView');
    }
    await page.click('[id$="--btnPostTransfer"]');
    await page.locator('.sapMMessageBoxConfirm button, .sapMMessageBoxQuestion button', { hasText: 'OK' }).click();
    const box = page.locator(RESULT_BOX).first();
    await box.waitFor({ state: 'visible', timeout: 180000 });
    const cls = await box.getAttribute('class');
    return { cockpit, validated: true, success: /sapMMessageBoxSuccess/.test(cls), dialog: (await box.innerText()).trim() };
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
        data = await pickDryRunData(session);
        // Registered after the session's context guard, so it takes precedence for this one URL only
        await session.page.route((url) => url.pathname === ACTION, (route) => {
            const body = route.request().postDataJSON() || {};
            calls.push({ path: ACTION, method: route.request().method(), body });
            return route.fulfill({ status: 200, contentType: 'application/json;odata.metadata=minimal', headers: { 'OData-Version': '4.0' }, body: JSON.stringify(stubResult(body)) });
        });
        ui = await driveUi(session, data);
        if (!ui.validated) {
            errors.push(`HU ${data.unitNumber} (reservation ${data.reservationNo}/${data.reservationItem}) not validated, post not reachable: ${ui.dialog}`);
        } else {
            if (calls.length !== 1) errors.push(`expected 1 call to ${ACTION}, got ${calls.length}`);
            const body = (calls[0] || {}).body || {};
            if (body.ReservationNo !== data.reservationNo || body.ReservationItem !== data.reservationItem) errors.push(`payload reservation ${body.ReservationNo}/${body.ReservationItem}, selected ${data.reservationNo}/${data.reservationItem}`);
            if (body.UnitNumber !== ui.cockpit.validatedUnit.UnitNumber) errors.push(`payload UnitNumber ${body.UnitNumber}, validated ${ui.cockpit.validatedUnit.UnitNumber}`);
            if (Number(body.TransferQty) !== Number(ui.cockpit.transferQty) || !(Number(body.TransferQty) > 0)) errors.push(`payload TransferQty ${body.TransferQty}, UI ${ui.cockpit.transferQty}`);
            if (!body.ClientAttemptId) errors.push('payload has no ClientAttemptId (idempotency key)');
            if (!ui.success) errors.push(`UI did not show a success dialog: ${ui.dialog}`);
            if (!ui.dialog.includes(STUB_DOC)) errors.push(`UI dialog does not show material document ${STUB_DOC}: ${ui.dialog}`);
        }
    } catch (err) {
        errors.push(`${err.name}: ${err.message.split('\n')[0]}`);
    } finally {
        errors.push(...sessionErrors(session));
        await session.close();
    }
    return { errors, details: { data, calls, ui, readBack: 'NOT VERIFIED (dry-run)' } };
}

async function live(baseUrl, data) {
    const errors = [];
    const details = { readBack: 'NOT RUN' };
    const session = await openSession({ baseUrl, user: 'alice', allowWrites: [new RegExp(`^${ACTION}$`)] });
    try {
        const ui = await driveUi(session, { ...data, transferQty: Number(data.transferQty) });
        details.ui = { validated: ui.validated, success: ui.success, dialog: ui.dialog };
        const m = /Material Document: (\d{10}) \/ (\d{4})/.exec(ui.dialog || '');
        if (!ui.validated || !ui.success || !m) {
            errors.push(`transfer not confirmed by the UI: ${ui.dialog}`);
        } else {
            details.materialDocument = `${m[1]}/${m[2]}`;
            const c = ui.cockpit.cockpit;
            // READ-ONLY read-back: verifyMaterialDocument is a POST action but only reads MATDOC/MSEG
            // (ReservationProcessAdapter.js:1100-1160). Called from Node, outside the browser write guard.
            const res = await fetch(`${baseUrl}/odata/v4/reservation-entry/verifyMaterialDocument`, {
                method: 'POST',
                headers: { ...AUTH, 'Content-Type': 'application/json' },
                body: JSON.stringify({ materialDocument: m[1], materialDocumentYear: m[2], movementType: '311', material: c.Material, quantity: Number(data.transferQty), plant: c.Plant, reservationNo: data.reservationNo, reservationItem: data.reservationItem })
            });
            details.readBack = { status: res.status, body: await res.json().catch(() => null) };
            if (!res.ok || !details.readBack.body || details.readBack.body.success !== true) errors.push(`SAP read-back of ${details.materialDocument} failed: HTTP ${res.status} ${JSON.stringify(details.readBack.body)}`);
        }
    } catch (err) {
        errors.push(`${err.name}: ${err.message.split('\n')[0]}`);
    } finally {
        errors.push(...sessionErrors(session));
        await session.close();
    }
    return { errors, details };
}

async function roundTripHuTransfer(options = {}) {
    const baseUrl = (options.baseUrl || process.env.TARGET_URL || 'http://localhost:4004').replace(/\/+$/, '');
    let mode;
    try {
        mode = resolveMode(FLOW);
    } catch (err) {
        console.log(`  [FAIL] ${err.message}`);
        return { status: 'FAIL', mode: 'blocked', errors: [err.message], details: {} };
    }
    console.log(`\n=== HU stock transfer 311 round trip (${mode.mode === 'live' ? 'LIVE SAP WRITE' : 'READ-ONLY dry-run, write guard on, action stubbed'}) ===`);
    if (!(await waitForHealth(baseUrl))) return { status: 'FAIL', mode: mode.mode, errors: [`server not healthy at ${baseUrl}`], details: {} };
    const res = mode.mode === 'live' ? await live(baseUrl, mode.data) : await dryRun(baseUrl);
    const status = res.errors.length ? 'FAIL' : 'PASS';
    console.log(`  [${status}] HU stock transfer ${mode.mode}`);
    res.errors.forEach((e) => console.log(`      - ${e}`));
    return { status, mode: mode.mode, errors: res.errors, details: res.details };
}

if (require.main === module) {
    roundTripHuTransfer().then((r) => {
        console.log(JSON.stringify(r.details, null, 2));
        process.exit(r.status === 'PASS' ? 0 : 1);
    });
}

module.exports = { roundTripHuTransfer };
