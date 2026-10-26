'use strict';

/**
 * Tier C SAP round trip: retry a failed warehouse step of a tracked reservation.
 * UI: #/wm/reservation-entry/{ReservationNo}/{ReservationItem} → header action "Retry" (btnRetryDetail, visible for a
 * tracked entry whose status is not 05, ReservationEntryDetail.view.xml:62-70) → exactly one POST retryStep
 * { ReservationNo, ReservationItem, Step: 'AUTO', MovementType } (ReservationEntryDetail.controller.js:165-191,
 * ReservationEntryService.js retryStep) → toast "Step successfully executed! Current Status: {code}" (or a warning
 * MessageBox for 11/12/13/90/99) → detail reload by GET only. The UI triggers no follow-up write: any further step
 * (TO, confirmation, MIGO) runs server-side inside retryStep.
 * Action: retryStep(...) returns ReservationEntries (srv/wm/reservation-entry/service.cds:313-323; entity :17-21 on
 * db/wm/reservation-track.cds:21-62).
 *
 * dry-run (default): write guard on; only retryStep is answered by a stub. Never proves SAP persistence.
 * live: needs liveWriteGate authorization + the user's written go; data from test/e2e/live/testData.json
 *   "reservationRetry": { "reservationNo", "reservationItem" }. Read-back: GET getReservationDetail (service.cds:389-394,
 *   @readonly, reads SAP RKPF/RESB) for TR/TO/material document, then the read-only verifyMaterialDocument action
 *   (MATDOC/MSEG reads, ReservationProcessAdapter.js:1100-1160) when a material document is reported.
 */

const { openSession } = require('../support/screenCheck');
const kit = require('./wmRoundTripKit');

const FLOW = 'reservationRetry';
const SERVICE = '/odata/v4/reservation-entry';
const ACTION = `${SERVICE}/retryStep`;
const RETRYABLE = ['11', '12', '13', '90']; // formatStatusRetryable (ReservationEntryDetail.controller.js:738-740)
// Synthetic values: never a real SAP number, so a dry-run result cannot be mistaken for a posting.
const STUB_TO = 'DRYRUNTO01';
const STUB_DOC = 'DRYRUNMD01';

/** ReservationEntries row after a fully successful retry: the selected entry with status 05 and stub documents. */
function stubResult(entry) {
    const row = { ...entry };
    delete row.Logs;
    delete row.Status;
    return {
        '@odata.context': '$metadata#ReservationEntries/$entity',
        ...row,
        TransferOrder: row.TransferOrder || STUB_TO,
        MaterialDocument: STUB_DOC,
        MaterialDocYear: String(new Date().getFullYear()),
        ProcessStatus: 'COMPLETED',
        Status_code: '05',
        StatusText: 'Goods Issue Posted',
        ErrorMessage: null,
        ErrorStep: null
    };
}

/** Dry-run data: the tracked entries the list screen reads (READ-ONLY ReservationEntries GET), one in a retryable error. */
async function pickDryRunData(baseUrl) {
    const filter = RETRYABLE.map((c) => `Status_code eq '${c}'`).join(' or ');
    const rows = await kit.getJson(baseUrl, `${SERVICE}/ReservationEntries?$filter=${encodeURIComponent(filter)}&$orderby=modifiedAt%20desc&$top=20`);
    if (!rows.length) throw new Error(`no tracked reservation entry in a retryable status (${RETRYABLE.join('/')}): the Retry flow is not reachable with current data`);
    return rows[0];
}

/** Opens the detail like a user and presses Retry once. */
async function driveUi(session, entry) {
    const { page } = session;
    await kit.open(session, `wm/reservation-entry/${entry.ReservationNo}/${entry.ReservationItem}`);
    const view = await kit.viewModel(page, 'btnRetryDetail', 'view');
    const detail = await kit.viewModel(page, 'btnRetryDetail', 'detail');
    const btn = page.locator('[id$="--btnRetryDetail"]');
    if (!(await btn.isVisible())) return { retried: false, isTracked: view && view.isTracked, status: detail && detail.Status_code };
    await btn.click(); // exactly one retry, never repeated
    const toast = await kit.waitForToast(page, ['Current Status'], 180000);
    const dialog = toast ? '' : await kit.messageBoxText(page);
    await session.settle();
    return { retried: true, statusBefore: detail && detail.Status_code, errorStepBefore: detail && detail.ErrorStep, toast, dialog };
}

function payloadErrors(body, entry) {
    const want = { ReservationNo: entry.ReservationNo, ReservationItem: entry.ReservationItem, Step: 'AUTO', MovementType: entry.MovementType };
    return Object.entries(want).filter(([k, v]) => String(body[k]) !== String(v))
        .map(([k, v]) => `payload ${k} = ${JSON.stringify(body[k])}, expected ${JSON.stringify(v)}`);
}

async function dryRun(baseUrl) {
    const errors = [];
    let entry = null;
    let ui = null;
    let calls = [];
    const session = await openSession({ baseUrl, user: 'alice' });
    try {
        entry = await pickDryRunData(baseUrl);
        calls = await kit.stubAction(session, ACTION, () => stubResult(entry));
        ui = await driveUi(session, entry);
        if (!ui.retried) {
            errors.push(`Retry button not shown for ${entry.ReservationNo}/${entry.ReservationItem} (tracked ${ui.isTracked}, status ${ui.status})`);
        } else {
            errors.push(...kit.expectCalls(calls, [ACTION]));
            errors.push(...payloadErrors((calls[0] || {}).body || {}, entry));
            if (!ui.toast || !ui.toast.includes('Current Status: 05')) errors.push(`UI did not show the stubbed retry success (status 05): toast ${ui.toast}; dialog ${ui.dialog || '-'}`);
        }
    } catch (err) {
        errors.push(`${err.name}: ${err.message.split('\n')[0]}`);
    } finally {
        errors.push(...kit.sessionErrors(session));
        await session.close();
    }
    const data = entry && { ReservationNo: entry.ReservationNo, ReservationItem: entry.ReservationItem, MovementType: entry.MovementType, Status_code: entry.Status_code, ErrorStep: entry.ErrorStep, ErrorMessage: entry.ErrorMessage };
    return { errors, details: { data, calls, ui, readBack: 'NOT VERIFIED (dry-run)' } };
}

async function live(baseUrl, data) {
    const errors = [];
    const details = { readBack: 'NOT RUN' };
    const session = await openSession({ baseUrl, user: 'alice', allowWrites: [new RegExp(`^${ACTION}$`)] });
    const calls = kit.recordPosts(session, [ACTION]);
    try {
        const entry = await kit.getJson(baseUrl, `${SERVICE}/ReservationEntries(ReservationNo='${data.reservationNo}',ReservationItem='${data.reservationItem}')`);
        const ui = await driveUi(session, entry);
        details.ui = ui;
        if (!ui.retried) throw new Error(`Retry button not shown (tracked ${ui.isTracked}, status ${ui.status})`);
        errors.push(...kit.expectCalls(calls, [ACTION]));
        errors.push(...payloadErrors((calls[0] || {}).body || {}, entry));
        if (!ui.toast) errors.push(`retry did not succeed: ${ui.dialog}`);
        const sap = await kit.getJson(baseUrl, `${SERVICE}/getReservationDetail(ReservationNo='${encodeURIComponent(entry.ReservationNo)}',ReservationItem='${encodeURIComponent(entry.ReservationItem)}')`);
        details.readBack = { TransferRequirement: sap.TransferRequirement, TransferOrder: sap.TransferOrder, MaterialDocument: sap.MaterialDocument, MaterialDocYear: sap.MaterialDocYear };
        if (sap.MaterialDocument) {
            const v = await kit.postReadOnlyAction(baseUrl, `${SERVICE}/verifyMaterialDocument`, {
                materialDocument: sap.MaterialDocument, materialDocumentYear: sap.MaterialDocYear, movementType: entry.MovementType,
                material: entry.Material, plant: entry.Plant, reservationNo: entry.ReservationNo, reservationItem: entry.ReservationItem
            });
            details.readBack.verification = v;
            if (v.status !== 200 || !v.body || v.body.success !== true) errors.push(`SAP read-back of material document ${sap.MaterialDocument} failed: ${JSON.stringify(v)}`);
        } else if (!sap.TransferOrder) {
            errors.push(`SAP read-back shows neither a TO nor a material document after the retry: ${JSON.stringify(details.readBack)}`);
        }
    } catch (err) {
        errors.push(`${err.name}: ${err.message.split('\n')[0]}`);
    } finally {
        errors.push(...kit.sessionErrors(session));
        await session.close();
    }
    return { errors, details };
}

function roundTripReservationRetry(options = {}) {
    return kit.runSuite({ flow: FLOW, title: 'Reservation entry retry-step round trip', dryRun, live }, options);
}

if (require.main === module) kit.main(roundTripReservationRetry);

module.exports = { roundTripReservationRetry };
