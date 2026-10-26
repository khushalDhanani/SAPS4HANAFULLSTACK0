'use strict';
/* global window */

/**
 * Tier C SAP round trip: goods issue to production order (261) by storage-unit scan, and its 262 reversal.
 * Sub-cases, each in its own session (srv/wm/mvt261/service.cds):
 * - scan    : #/wm/mvt261/open/{reservation}/{item} → scan storage units (scanContext / checkStorageUnit, read-only)
 *             until the open quantity is covered → "Post Goods Issue" → confirm OK → exactly one POST postGoodsIssue
 *             (:205-221, returns MaterialDocumentResult :195-203) → toast "...Material Document: {doc}/{year}"
 *             (Scan261.controller.js:214-293).
 * - reverse : #/wm/mvt261/open/{reservation}/{item}/cycle → history row of a not-reversed 261 document → "Reverse"
 *             → confirm OK → exactly one POST reverse (:231-238, returns ReversalResult :223-227, WarehouseManager/Admin)
 *             → toast "Reversal posted. Material document {doc}/{year}" (Cycle261.controller.js:55-99).
 * The 261 item comes from the READ-ONLY function openItems() (:57-66), as in verifyWmScreens.e2e.js.
 *
 * dry-run (default): write guard on; only the sub-case's action is answered by a stub. Never proves SAP persistence.
 * live: needs liveWriteGate authorization + the user's written go; runs only the sub-cases present in
 *   test/e2e/live/testData.json "mvt261": { "scan": { "reservation", "item", "storageUnits" (comma-separated) },
 *   "reverse": { "reservation", "item", "materialDocument", "materialDocumentYear", "materialDocumentItem" } }.
 *   Read-back: GET cycle(reservation, item) (:139-140, read-only) — History must hold the new 261 document / the
 *   reversed row.
 */

const { openSession } = require('../support/screenCheck');
const kit = require('./wmRoundTripKit');

const FLOW = 'mvt261';
const SERVICE = '/odata/v4/mvt261';
const PATH = { scan: `${SERVICE}/postGoodsIssue`, reverse: `${SERVICE}/reverse` };
// Synthetic values: never a real SAP number, so a dry-run result cannot be mistaken for a posting.
const STUB_GI = 'DRYRUN2611';
const STUB_REV = 'DRYRUN2621';
const YEAR = String(new Date().getFullYear());

const q = (s) => `'${encodeURIComponent(String(s))}'`;

const STUBS = {
    scan: () => ({
        '@odata.context': '$metadata#saps4hana.wm.Mvt261Service.MaterialDocumentResult',
        MaterialDocument: STUB_GI, MaterialDocumentYear: YEAR, DeliveryNumber: null, Pending: false,
        Message: 'DRY-RUN stub, nothing posted in SAP', SapMessage: null, StorageUnitPostingSemantics: null
    }),
    reverse: () => ({
        '@odata.context': '$metadata#saps4hana.wm.Mvt261Service.ReversalResult',
        MaterialDocument: STUB_REV, MaterialDocumentYear: YEAR, SapMessage: 'DRY-RUN stub, nothing posted in SAP'
    })
};

/** Available storage units of one batch, FIFO rank order, until their quantity covers the open quantity. */
function coveringUnits(ctx) {
    const avail = (ctx.Units || []).filter((u) => u.Status === 'Available' && Number(u.Quantity) > 0).sort((a, b) => a.Rank - b.Rank);
    if (!avail.length || !(Number(ctx.OpenQuantity) > 0)) return null;
    const batch = avail[0].Batch || '';
    const picked = [];
    let sum = 0;
    for (const u of avail.filter((x) => (x.Batch || '') === batch)) {
        if (sum >= Number(ctx.OpenQuantity) || picked.length >= 10) break;
        picked.push(u.StorageUnit);
        sum += Number(u.Quantity);
    }
    return sum >= Number(ctx.OpenQuantity) ? { storageUnits: picked, batch } : null;
}

/**
 * Dry-run data from READ-ONLY reads: openItems() (scan-possible, not blocked) + the screen's scanContext() for the scan
 * sub-case; openItems() items with a withdrawn quantity + the cycle screen's cycle() for a not-reversed 261 document.
 */
async function pickDryRunData(baseUrl) {
    const res = await kit.getJson(baseUrl, `${SERVICE}/openItems()`);
    const items = (res && res.Items) || [];
    const out = { scan: null, reverse: null };
    for (const it of items.filter((i) => i.ScanPossible && !i.Blocked).slice(0, 40)) {
        const ctx = await kit.getJson(baseUrl, `${SERVICE}/scanContext(reservation=${q(it.Reservation)},item=${q(it.ReservationItem)})`).catch(() => null);
        const cover = ctx && !ctx.Blocked && coveringUnits(ctx);
        if (cover) {
            out.scan = { reservation: it.Reservation, item: it.ReservationItem, openQuantity: Number(ctx.OpenQuantity), productionOrder: ctx.ProductionOrder || '', ...cover };
            break;
        }
    }
    for (const it of items.filter((i) => Number(i.WithdrawnQuantity) > 0).slice(0, 20)) {
        const c = await kit.getJson(baseUrl, `${SERVICE}/cycle(reservation=${q(it.Reservation)},item=${q(it.ReservationItem)})`).catch(() => null);
        const doc = c && (c.History || []).find((h) => h.MovementType === '261' && !h.IsReversed);
        if (doc) {
            out.reverse = { reservation: it.Reservation, item: it.ReservationItem, materialDocument: doc.MaterialDocument, materialDocumentYear: doc.MaterialDocumentYear, materialDocumentItem: doc.MaterialDocumentItem };
            break;
        }
    }
    return out;
}

const SUBCASES = {
    async scan(session, d) {
        const { page } = session;
        await kit.open(session, `wm/mvt261/open/${d.reservation}/${d.item}`);
        for (const su of d.storageUnits) {
            await page.fill('[id$="--scan261Input-inner"]', su);
            await page.press('[id$="--scan261Input-inner"]', 'Enter');
            await session.settle();
        }
        const before = await kit.viewModel(page, 'scan261Post', 'scan261View');
        if (before.state !== 'Covered') {
            return { posted: false, state: before.state, message: before.message, rows: before.rows };
        }
        await page.click('[id$="--scan261Post"]');
        await kit.messageBoxButton(page, 'OK'); // one confirm, one post, never retried
        const toast = await kit.waitForToast(page, ['Material Document'], 180000);
        const box = toast ? '' : await kit.messageBoxText(page);
        await session.settle();
        return { posted: true, state: before.state, total: before.total, toast, dialog: box };
    },
    async reverse(session, d) {
        const { page } = session;
        await kit.open(session, `wm/mvt261/open/${d.reservation}/${d.item}/cycle`);
        const btnId = await page.evaluate(([doc, year, item]) => {
            const t = window.sap.ui.require('sap/ui/core/Element').registry.filter((e) => e.getId().endsWith('--cycle261History'))[0];
            const row = t && t.getItems().find((r) => {
                const o = r.getBindingContext('cycle261View').getObject();
                return o.MaterialDocument === doc && String(o.MaterialDocumentYear) === String(year) && String(o.MaterialDocumentItem) === String(item);
            });
            const btn = row && row.getCells().find((c) => c.isA('sap.m.Button') && c.getVisible());
            return btn ? btn.getId() : null;
        }, [d.materialDocument, d.materialDocumentYear, d.materialDocumentItem]);
        if (!btnId) return { posted: false, message: `no visible Reverse button for ${d.materialDocument}/${d.materialDocumentYear}/${d.materialDocumentItem}` };
        await page.click(`[id="${btnId}"]`);
        await kit.messageBoxButton(page, 'OK');
        const toast = await kit.waitForToast(page, ['Reversal posted'], 180000);
        const box = toast ? '' : await kit.messageBoxText(page);
        await session.settle();
        return { posted: true, toast, dialog: box };
    }
};

function check(name, d, body, ui, stubDoc) {
    const errors = [];
    if (!ui.posted) return [`UI did not allow posting: ${ui.message || `scan state ${ui.state}`}`];
    const want = name === 'scan'
        ? { movementType: '261', reservation: d.reservation, item: d.item, quantity: Number(ui.total) }
        : { reservation: d.reservation, item: d.item, materialDocument: d.materialDocument, materialDocumentYear: d.materialDocumentYear, materialDocumentItem: d.materialDocumentItem };
    Object.entries(want).forEach(([k, v]) => {
        if (String(body[k]) !== String(v)) errors.push(`payload ${k} = ${JSON.stringify(body[k])}, expected ${JSON.stringify(v)}`);
    });
    if (name === 'scan') {
        const sent = (body.storageUnits || []).slice().sort().join(',');
        if (sent !== d.storageUnits.slice().sort().join(',')) errors.push(`payload storageUnits ${sent}, scanned ${d.storageUnits.join(',')}`);
        if (d.batch !== undefined && (body.batch || '') !== d.batch) errors.push(`payload batch ${body.batch}, scanned batch ${d.batch}`);
    }
    if (stubDoc && (!ui.toast || !ui.toast.includes(stubDoc))) errors.push(`UI did not show material document ${stubDoc} (toast: ${ui.toast}; dialog: ${ui.dialog || '-'})`);
    if (!stubDoc && !ui.toast) errors.push(`UI did not confirm the ${name} (dialog: ${ui.dialog || '-'})`);
    return errors;
}

async function dryRun(baseUrl) {
    const errors = [];
    const details = { subcases: {} };
    let data;
    try {
        data = await pickDryRunData(baseUrl);
    } catch (err) {
        return { errors: [`test data: ${err.message}`], details };
    }
    for (const name of Object.keys(SUBCASES)) {
        const d = data[name];
        const sub = details.subcases[name] = { data: d, readBack: 'NOT VERIFIED (dry-run)' };
        if (!d) {
            // Not a failure: the UI path exists, current SAP data offers no candidate (reported, like runScreens' SKIPPED)
            sub.status = 'SKIPPED';
            console.log(`  [SKIPPED] ${name} — no candidate from READ-ONLY openItems()/${name === 'scan' ? 'scanContext' : 'cycle'}()`);
            continue;
        }
        const subErrors = [];
        const session = await openSession({ baseUrl, user: 'alice' });
        try {
            const calls = await kit.stubAction(session, PATH[name], STUBS[name]);
            sub.calls = calls;
            sub.ui = await SUBCASES[name](session, d);
            if (sub.ui.posted) subErrors.push(...kit.expectCalls(calls, [PATH[name]]));
            subErrors.push(...check(name, d, (calls[0] || {}).body || {}, sub.ui, name === 'scan' ? STUB_GI : STUB_REV));
        } catch (err) {
            subErrors.push(`${err.name}: ${err.message.split('\n')[0]}`);
        } finally {
            subErrors.push(...kit.sessionErrors(session));
            await session.close();
        }
        sub.status = subErrors.length ? 'FAIL' : 'PASS';
        console.log(`  [${sub.status}] ${name}`);
        errors.push(...subErrors.map((e) => `${name}: ${e}`));
    }
    return { errors, details };
}

async function live(baseUrl, data) {
    const errors = [];
    const details = { subcases: {} };
    for (const name of Object.keys(SUBCASES).filter((n) => data[n])) {
        const d = name === 'scan' ? { ...data.scan, storageUnits: String(data.scan.storageUnits).split(',').map((s) => s.trim()).filter(Boolean) } : { ...data.reverse };
        const sub = details.subcases[name] = { readBack: 'NOT RUN' };
        const subErrors = [];
        const session = await openSession({ baseUrl, user: 'alice', allowWrites: [new RegExp(`^${PATH[name]}$`)] });
        const calls = kit.recordPosts(session, [PATH[name]]);
        try {
            sub.ui = await SUBCASES[name](session, d);
            if (sub.ui.posted) subErrors.push(...kit.expectCalls(calls, [PATH[name]]));
            subErrors.push(...check(name, { ...d, batch: undefined }, (calls[0] || {}).body || {}, sub.ui, null));
            const m = /(\d{10})\/(\d{4})/.exec(sub.ui.toast || '');
            if (!subErrors.length && m) {
                const c = await kit.getJson(baseUrl, `${SERVICE}/cycle(reservation=${q(d.reservation)},item=${q(d.item)})`);
                const hist = c.History || [];
                sub.readBack = { document: `${m[1]}/${m[2]}`, history: hist.map((h) => `${h.MovementType}:${h.MaterialDocument}/${h.MaterialDocumentYear}${h.IsReversed ? ':reversed' : ''}`) };
                const ok = name === 'scan'
                    ? hist.some((h) => h.MovementType === '261' && h.MaterialDocument === m[1] && String(h.MaterialDocumentYear) === m[2])
                    : hist.some((h) => h.MaterialDocument === d.materialDocument && h.IsReversed);
                if (!ok) subErrors.push(`SAP read-back (cycle History) does not show ${name} ${m[1]}/${m[2]}`);
            } else if (!subErrors.length) {
                subErrors.push(`UI toast has no material document number: ${sub.ui.toast}`);
            }
        } catch (err) {
            subErrors.push(`${err.name}: ${err.message.split('\n')[0]}`);
        } finally {
            subErrors.push(...kit.sessionErrors(session));
            await session.close();
        }
        errors.push(...subErrors.map((e) => `${name}: ${e}`));
    }
    return { errors, details };
}

function roundTripMvt261(options = {}) {
    return kit.runSuite({ flow: FLOW, title: 'Goods issue 261 scan + reversal round trip', dryRun, live }, options);
}

if (require.main === module) kit.main(roundTripMvt261);

module.exports = { roundTripMvt261 };
