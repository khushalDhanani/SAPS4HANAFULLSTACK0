'use strict';

/**
 * Tier C SAP round trip: warehouse scan → transfer order (TO) from a transfer requirement (TR).
 * UI: #/wm/scan-to/{lgnum}/TR/{number} (lookupTR, read-only) → footer "Create & Confirm TO" (btnProcessTO, enabled when
 * scanView>/canSubmit) → exactly ONE POST createTOFromTR with autoConfirm / autoPostMigo from the header switches
 * (defaults true; autoPostMigo forced false when the TR's goods movement is already posted)
 * (WarehouseScanToDetail.controller.js:1045-1172). TO creation, TO confirmation and MIGO all run server-side inside that
 * one action; the result panel and toast show TO / material document. Only when the result is status 90 (TO confirmed,
 * MIGO failed) or a delivery, the UI offers "Retry MIGO Posting" (btnRetryMigo) → one POST postMigoGoodsMovement
 * (:1174-1334).
 * Actions: createTOFromTR returns TOProcessResult; postMigoGoodsMovement returns MigoProcessResult
 * (srv/wm/tr-to/service.cds:233-270 / :46-91; :308-361 / :93-125).
 * Sub-cases (separate sessions):
 * - createTO  : one click → stub createTOFromTR (status 05 + material document when autoPostMigo, else 04 confirmed).
 * - retryMigo : stub createTOFromTR answers status 90 (MIGO failed) → "Retry MIGO Posting" → stub postMigoGoodsMovement.
 *               Needs a TR whose goods movement is not yet posted (autoPostMigo true).
 *
 * dry-run (default): write guard on; only those action paths are answered by stubs. Never proves SAP persistence.
 * live: needs liveWriteGate authorization + the user's written go; data from test/e2e/live/testData.json
 *   "scanTo": { "lgnum", "tbnum", "quantity" }. Only createTOFromTR is allowed; a Retry MIGO offered afterwards is
 *   reported, never clicked. Read-back: the read-only verifyMaterialDocument action (MATDOC/MSEG reads,
 *   ReservationProcessAdapter.js:1100-1160) when a material document is returned; a TO alone has no GET-only CAP read
 *   API (NOT VERIFIED).
 */

const { openSession } = require('../support/screenCheck');
const kit = require('./wmRoundTripKit');

const FLOW = 'scanTo';
const SERVICE = '/odata/v4/tr-to';
const CREATE = `${SERVICE}/createTOFromTR`;
const MIGO = `${SERVICE}/postMigoGoodsMovement`;
// Synthetic values: never a real SAP number, so a dry-run result cannot be mistaken for a posting.
const STUB_TO = 'DRYRUNTO02';
const STUB_DOC = 'DRYRUNMD02';
const YEAR = String(new Date().getFullYear());

/** TOProcessResult (service.cds:46-91) for the submitted payload. mode: 'ok' | 'migoFailed'. */
function toResult(body, mode) {
    const migo = mode === 'ok' && body.autoPostMigo === true;
    const status = mode === 'migoFailed' ? '90' : (migo ? '05' : (body.autoConfirm ? '04' : '03'));
    return {
        '@odata.context': '$metadata#saps4hana.wm.TrToService.TOProcessResult',
        ProcessId: null, ErrorStep: mode === 'migoFailed' ? 'MIGO' : null,
        TransferOrder: STUB_TO, TransferRequirement: body.tbnum, TRItem: body.tbpos,
        ReservationNo: body.ReservationNo || null, ReservationItem: body.ReservationItem || null,
        MovementType: null, ReservationMovementType: body.ReservationMovementType || null,
        Status: status, StatusText: null,
        Confirmed: status !== '03', IsConfirmed: status !== '03', ConfirmationNumber: STUB_TO, ConfirmedBy: null,
        Quantity: body.qty, Unit: body.unit, Batch: body.batch || null, Serials: body.serials || [],
        Success: mode === 'ok', Message: 'DRY-RUN stub, nothing posted in SAP',
        MaterialDocument: migo ? STUB_DOC : null, MaterialDocYear: migo ? YEAR : null, DeliveryNumber: null,
        ErrorMessage: mode === 'migoFailed' ? 'DRY-RUN stub: goods movement not posted' : null,
        success: mode === 'ok', stage: null, error: null, trNumber: body.tbnum, toNumber: STUB_TO, toItem: '0001', confirmed: status !== '03'
    };
}

/** MigoProcessResult (service.cds:93-125). */
function migoResult(body) {
    return {
        '@odata.context': '$metadata#saps4hana.wm.TrToService.MigoProcessResult',
        ProcessId: body.ProcessId || null, ErrorStep: null, Success: true, success: true, stage: 'MIGO', error: null,
        materialDocument: STUB_DOC, materialDocumentYear: YEAR, movementType: body.MovementType,
        MaterialDocument: STUB_DOC, MaterialDocYear: YEAR, DeliveryNumber: null, deliveryNumber: null,
        Status: '05', StatusText: 'Goods Issue Posted', ReservationNo: body.ReservationNo, ReservationItem: body.ReservationItem,
        TransferOrder: body.TransferOrder, MovementType: body.MovementType, Quantity: body.Quantity, Unit: body.Unit,
        Batch: body.Batch || null, Serials: body.Serials || [], StockEffect: null, Message: 'DRY-RUN stub, nothing posted in SAP',
        ErrorMessage: null, alreadyPosted: false, idempotentRetry: false, businessKey: null, stockVerification: null, reservationVerification: null
    };
}

/**
 * Dry-run candidates from READ-ONLY reads: getOpenTRs (the scan screen's open-TR list) and lookupTR (what the detail
 * screen loads), pre-filtered on what _validateForm needs without typing (an item, open quantity, no serials, a source
 * bin when SAP reports a stock deficit). The UI then decides (canSubmit) — see pickInUi.
 */
async function candidates(baseUrl) {
    const open = await kit.getJson(baseUrl, `${SERVICE}/getOpenTRs(lgnum='',mvt='')`);
    const out = [];
    for (const t of open.slice(0, 200)) {
        const d = await kit.getJson(baseUrl, `${SERVICE}/lookupTR(tbnum='${t.Tbnum}',lgnum='${t.Lgnum}',docType='TR',tbpos='')`).catch(() => null);
        if (!d || !d.TRItem || !(Number(d.OpenQuantity) > 0) || d.IsSerialManaged || d.DeliveryCompleted) continue;
        const bin = d.SourceStorageBin || (d.SuggestedBatches || []).some((b) => b.StorageBin);
        if (d.StockWarning && !bin) continue;
        out.push({ lgnum: t.Lgnum, tbnum: t.Tbnum, posted: Boolean(d.GoodsMovementPosted) });
        // enough of both kinds: posted (TO only) and goods movement still to post (retryMigo)
        if (out.filter((x) => x.posted).length >= 10 && out.filter((x) => !x.posted).length >= 10) break;
    }
    return out;
}

async function openTr(session, c) {
    await kit.open(session, `wm/scan-to/${c.lgnum}/TR/${c.tbnum}`);
    return kit.viewModel(session.page, 'btnProcessTO', 'scanView');
}

/** First candidate the detail screen accepts for submit (and, if needed, with MIGO still to post). */
async function pickInUi(session, list, needsMigo) {
    const tried = [];
    for (const c of list.filter((x) => !needsMigo || !x.posted)) {
        const m = await openTr(session, c);
        tried.push(`${c.lgnum}/${c.tbnum}: ${m.canSubmit ? 'ready' : m.scanVerificationStatusText || m.messageText}`);
        if (m.canSubmit && (!needsMigo || (m.autoPostMigo && !m.goodsMovementPosted))) return { cand: c, model: m, tried };
    }
    return { cand: null, tried };
}

function payloadErrors(body, c, m) {
    const want = { lgnum: c.lgnum, tbnum: m.tr.TRNumber, tbpos: m.tr.TRItem, qty: Number(m.pickQty), autoConfirm: m.autoConfirm, autoPostMigo: Boolean(m.autoPostMigo && !m.goodsMovementPosted) };
    return Object.entries(want).filter(([k, v]) => String(body[k]) !== String(v))
        .map(([k, v]) => `payload createTOFromTR.${k} = ${JSON.stringify(body[k])}, expected ${JSON.stringify(v)}`);
}

async function clickProcess(session) {
    await session.page.click('[id$="--btnProcessTO"]'); // exactly one submit, never retried
    const toast = await kit.waitForToast(session.page, ['Transfer Order'], 180000);
    const dialog = toast ? '' : await kit.messageBoxText(session.page);
    await session.settle();
    return { toast, dialog, after: await kit.viewModel(session.page, 'btnProcessTO', 'scanView') };
}

const SUBCASES = {
    async createTO(session, list) {
        const pick = await pickInUi(session, list, false);
        if (!pick.cand) return { skipped: `no open TR the detail screen accepts for submit: ${pick.tried.join(' | ')}` };
        const calls = await kit.stubAction(session, CREATE, (b) => toResult(b, 'ok'));
        const migo = await kit.stubAction(session, MIGO, migoResult);
        await openTr(session, pick.cand); // reload so the stubs are in place before any action
        const ui = await clickProcess(session);
        const body = (calls[0] || {}).body || {};
        const errors = [...kit.expectCalls([...calls, ...migo], [CREATE]), ...payloadErrors(body, pick.cand, pick.model)];
        const needles = body.autoPostMigo ? [STUB_TO, STUB_DOC] : [STUB_TO];
        if (!ui.toast || !needles.every((n) => ui.toast.includes(n))) errors.push(`UI did not show ${needles.join(' + ')} (toast: ${ui.toast}; dialog: ${ui.dialog || '-'})`);
        if (!ui.after.hasResult || !needles.every((n) => String(ui.after.resultMessage).includes(n))) errors.push(`result panel does not show ${needles.join(' + ')}: ${ui.after.resultMessage}`);
        return { data: pick.cand, tried: pick.tried, calls: [...calls, ...migo], ui: { toast: ui.toast, resultMessage: ui.after.resultMessage }, errors };
    },
    async retryMigo(session, list) {
        const pick = await pickInUi(session, list, true);
        if (!pick.cand) return { skipped: `no open TR with goods movement still to post that the detail screen accepts: ${pick.tried.join(' | ')}` };
        const calls = [];
        const create = await kit.stubAction(session, CREATE, (b) => toResult(b, 'migoFailed'));
        const migo = await kit.stubAction(session, MIGO, migoResult);
        await openTr(session, pick.cand);
        const first = await clickProcess(session);
        calls.push(...create);
        const errors = [...payloadErrors((create[0] || {}).body || {}, pick.cand, pick.model)];
        if (!first.after.canRetryMigo) errors.push(`"Retry MIGO Posting" not offered after a status-90 result: ${first.after.resultMessage}`);
        let toast = null;
        if (first.after.canRetryMigo) {
            await session.page.click('[id$="--btnRetryMigo"]');
            toast = await kit.waitForToast(session.page, [STUB_DOC], 180000);
            await session.settle();
        }
        calls.push(...migo);
        errors.push(...kit.expectCalls(calls, [CREATE, MIGO]));
        const mb = (migo[0] || {}).body || {};
        if (mb.TransferOrder !== STUB_TO || String(mb.ReservationNo || '') !== String(pick.model.tr.ReservationNo || '')) errors.push(`payload postMigoGoodsMovement TransferOrder/ReservationNo ${mb.TransferOrder}/${mb.ReservationNo}, expected ${STUB_TO}/${pick.model.tr.ReservationNo}`);
        if (!toast) errors.push(`UI did not show material document ${STUB_DOC} after Retry MIGO: ${await kit.messageBoxText(session.page)}`);
        return { data: pick.cand, tried: pick.tried, calls, ui: { firstToast: first.toast, retryToast: toast }, errors };
    }
};

async function dryRun(baseUrl) {
    const errors = [];
    const details = { subcases: {} };
    let list;
    try {
        list = await candidates(baseUrl);
    } catch (err) {
        return { errors: [`test data: ${err.message}`], details };
    }
    for (const name of Object.keys(SUBCASES)) {
        const session = await openSession({ baseUrl, user: 'alice' });
        let res;
        try {
            res = await SUBCASES[name](session, list);
        } catch (err) {
            res = { errors: [`${err.name}: ${err.message.split('\n')[0]}`] };
        }
        // A skipped sub-case is not a failure: the UI path exists, current SAP data offers no candidate (reported)
        const subErrors = res.skipped ? [] : res.errors;
        subErrors.push(...kit.sessionErrors(session));
        await session.close();
        details.subcases[name] = { ...res, status: subErrors.length ? 'FAIL' : (res.skipped ? 'SKIPPED' : 'PASS'), readBack: 'NOT VERIFIED (dry-run)' };
        console.log(`  [${details.subcases[name].status}] ${name}${res.skipped ? ` — not reachable with current SAP data: ${res.skipped}` : ''}`);
        errors.push(...subErrors.map((e) => `${name}: ${e}`));
    }
    return { errors, details };
}

async function live(baseUrl, data) {
    const errors = [];
    const details = { readBack: 'NOT RUN' };
    const session = await openSession({ baseUrl, user: 'alice', allowWrites: [new RegExp(`^${CREATE}$`)] });
    const calls = kit.recordPosts(session, [CREATE, MIGO]);
    try {
        const c = { lgnum: data.lgnum, tbnum: data.tbnum };
        let m = await openTr(session, c);
        if (data.quantity !== undefined) {
            await session.page.fill('[id$="--inputPickQty-inner"]', String(data.quantity));
            await session.page.press('[id$="--inputPickQty-inner"]', 'Tab');
            m = await kit.viewModel(session.page, 'btnProcessTO', 'scanView');
        }
        if (!m.canSubmit) throw new Error(`detail screen does not allow submit: ${m.scanVerificationStatusText} ${m.messageText || ''}`);
        const ui = await clickProcess(session);
        errors.push(...kit.expectCalls(calls, [CREATE]));
        errors.push(...payloadErrors((calls[0] || {}).body || {}, c, m));
        const r = ui.after.result || {};
        details.ui = { toast: ui.toast, dialog: ui.dialog, status: r.Status, transferOrder: r.TransferOrder, materialDocument: r.MaterialDocument, retryMigoOffered: ui.after.canRetryMigo };
        if (!ui.toast || !r.TransferOrder) errors.push(`TO creation not confirmed by the UI: ${ui.toast || ui.dialog}`);
        if (ui.after.canRetryMigo) errors.push(`MIGO not posted (status ${r.Status}): Retry MIGO offered but not clicked in this run (${r.ErrorMessage || ''})`);
        if (r.MaterialDocument) {
            const v = await kit.postReadOnlyAction(baseUrl, `${SERVICE}/verifyMaterialDocument`, {
                materialDocument: r.MaterialDocument, materialDocumentYear: r.MaterialDocYear, movementType: r.MovementType,
                material: r.Material, plant: r.Plant, reservationNo: r.ReservationNo, reservationItem: r.ReservationItem
            });
            details.readBack = v;
            if (v.status !== 200 || !v.body || v.body.success !== true) errors.push(`SAP read-back of ${r.MaterialDocument} failed: ${JSON.stringify(v)}`);
        } else {
            details.readBack = 'NOT VERIFIED: no GET-only CAP API reads a transfer order by number';
        }
    } catch (err) {
        errors.push(`${err.name}: ${err.message.split('\n')[0]}`);
    } finally {
        errors.push(...kit.sessionErrors(session));
        await session.close();
    }
    return { errors, details };
}

function roundTripScanTo(options = {}) {
    return kit.runSuite({ flow: FLOW, title: 'Warehouse scan → TO round trip', dryRun, live }, options);
}

if (require.main === module) kit.main(roundTripScanTo);

module.exports = { roundTripScanTo, SUBCASES, candidates, CREATE, SERVICE };
