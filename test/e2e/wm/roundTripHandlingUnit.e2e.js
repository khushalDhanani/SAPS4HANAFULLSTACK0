'use strict';
/* global window */

/**
 * Tier C SAP round trip: handling-unit writes, one sub-case per action the UI exposes, each in its own session.
 * Actions (srv/wm/handling-unit/service.cds:200-210), all returning HandlingUnitWriteResult (:186-196):
 * - create : #/wm/handling-unit → "Create HU" → dialog (packaging material, plant, SLoc, content) → "Create"
 *            → POST create → toast "Handling unit {id} created" → detail route of the new HU
 *            (HandlingUnits.controller.js:433-477).
 * - pack   : #/wm/handling-unit/{hu} → "Pack Item" → dialog (material, qty, unit, batch, plant, SLoc) → "Pack"
 *            → POST pack → toast "{qty} {unit} of {material} packed" → detail reload (HandlingUnitDetail.controller.js:126-166).
 * - unpack : detail item row "Unpack" → confirm OK → POST unpack → toast "Material {m} unpacked" (:169-186).
 * - remove : detail "Delete HU" (enabled only when the HU has no items) → "Delete" → POST remove → toast
 *            "Handling unit {id} deleted" → back to #/wm/handling-unit (:189-205).
 *
 * dry-run (default): write guard on; only the sub-case's action is answered by a stub. Never proves SAP persistence.
 * live: needs liveWriteGate authorization + the user's written go; runs only the sub-cases present in
 *   test/e2e/live/testData.json "handlingUnit": { "create": { "packagingMaterial", "plant", "storageLocation", "content" },
 *   "pack": { "handlingUnitExternalID", "material", "quantity", "unit", "batch" },
 *   "unpack": { "handlingUnitExternalID", "item" }, "remove": { "handlingUnitExternalID" } }.
 *   Read-back: GET detail(handlingUnitExternalID, warehouse) (service.cds:136-137, read-only function).
 */

const { openSession } = require('../support/screenCheck');
const kit = require('./wmRoundTripKit');

const FLOW = 'handlingUnit';
const SERVICE = '/odata/v4/handling-unit';
const PATH = { create: `${SERVICE}/create`, pack: `${SERVICE}/pack`, unpack: `${SERVICE}/unpack`, remove: `${SERVICE}/remove` };
// Synthetic value: never a real SAP HU number, so a dry-run result cannot be mistaken for a created HU.
const STUB_HU = 'DRYRUNHU0001';
const LIST = `${SERVICE}/list(plant='',storageLocation='',warehouse='',packagingMaterial='',handlingUnitExternalID='',status='',shippingPoint='')`;

/** HandlingUnitWriteResult (service.cds:186-196). */
function writeResult(body, over = {}) {
    return {
        '@odata.context': '$metadata#saps4hana.wm.HandlingUnitService.HandlingUnitWriteResult',
        HandlingUnitExternalID: body.handlingUnitExternalID || STUB_HU,
        HandlingUnitInternalNumber: null,
        PackagingMaterial: body.packagingMaterial || null,
        Plant: body.plant || null,
        StorageLocation: body.storageLocation || null,
        Status: null,
        Content: body.content || null,
        Deleted: false,
        Items: [],
        ...over
    };
}

const detailPath = (hu, wh = '') => `${SERVICE}/detail(handlingUnitExternalID='${encodeURIComponent(hu)}',warehouse='${encodeURIComponent(wh)}')`;
const detailHash = (h) => `wm/handling-unit/${encodeURIComponent(h.HandlingUnitExternalID)}?wh=${encodeURIComponent(h.Warehouse || '')}`
    + `&char32=${encodeURIComponent(h.HandlingUnitIDChar32 || '')}&origin=${encodeURIComponent(h.HandlingUnitOrigin || 'ERP')}`;

/**
 * Dry-run data from the READ-ONLY reads the screens use: the HU list (list()) and detail() of listed HUs.
 * create: packaging/plant/SLoc of a listed HU; pack/unpack: a listed HU with a packed item; remove: an empty HU.
 */
async function pickDryRunData(baseUrl) {
    const items = ((await kit.getJson(baseUrl, LIST)) || {}).Items || [];
    if (!items.length) throw new Error('handling-unit list() returned no HU');
    const data = { create: null, withItem: null, empty: null };
    const src = items.find((h) => h.PackagingMaterial && h.Plant && h.StorageLocation);
    if (src) data.create = { source: src.HandlingUnitExternalID, packagingMaterial: src.PackagingMaterial, plant: src.Plant, storageLocation: src.StorageLocation, content: '' };
    for (let i = 0; i < Math.min(items.length, 400) && !(data.withItem && data.empty); i += 10) {
        const batch = await Promise.all(items.slice(i, i + 10).map((h) => kit.getJson(baseUrl, detailPath(h.HandlingUnitExternalID, h.Warehouse))
            .then((d) => [h, d], () => [h, null])));
        for (const [h, d] of batch) {
            if (!d) continue;
            const it = (d.Items || [])[0];
            if (!data.withItem && it && it.Material && Number(it.Quantity) > 0 && (d.Plant || it.Plant) && (d.StorageLocation || it.StorageLocation)) data.withItem = { hu: h, item: it };
            if (!data.empty && (d.Items || []).length === 0) data.empty = { hu: h };
        }
    }
    return data;
}

async function typeInto(page, localId, value) {
    const sel = `[id$="--${localId}-inner"]`;
    await page.fill(sel, String(value));
    await page.press(sel, 'Tab');
}

const SUBCASES = {
    async create(session, d) {
        const { page } = session;
        await kit.open(session, 'wm/handling-unit');
        await page.click('[id$="--huCreateBtn"]');
        await page.locator('[id$="--huCreateDialog"]').waitFor({ state: 'visible', timeout: 15000 });
        await typeInto(page, 'huCreatePkgMat', d.packagingMaterial);
        await typeInto(page, 'huCreatePlant', d.plant);
        await typeInto(page, 'huCreateSloc', d.storageLocation);
        if (d.content) await typeInto(page, 'huCreateContent', d.content);
        await page.click('[id$="--huCreateSubmit"]'); // exactly one submit, never retried
        const toast = await kit.waitForToast(page, ['created'], 180000);
        await session.settle();
        const form = await kit.viewModel(page, 'huCreateBtn', 'huCreate');
        return { toast, error: form && form.error, hash: await kit.currentHash(page) };
    },
    async pack(session, d) {
        const { page } = session;
        await kit.open(session, d.hash);
        await page.click('[id$="--huPackBtn"]');
        await page.locator('[id$="--huPackDialog"]').waitFor({ state: 'visible', timeout: 15000 });
        await typeInto(page, 'huPackMaterial', d.material);
        await typeInto(page, 'huPackQty', d.quantity);
        await typeInto(page, 'huPackUnit', d.unit);
        if (d.batch) await typeInto(page, 'huPackBatch', d.batch);
        const form = await kit.viewModel(page, 'huPackBtn', 'huPack');
        await page.click('[id$="--huPackSubmit"]');
        const toast = await kit.waitForToast(page, ['packed'], 180000);
        await session.settle();
        const after = await kit.viewModel(page, 'huPackBtn', 'huPack');
        return { form, toast, error: after && after.error, hash: await kit.currentHash(page) };
    },
    async unpack(session, d) {
        const { page } = session;
        await kit.open(session, d.hash);
        // The unpack button of the row with that item number (row buttons have no id)
        const btnId = await page.evaluate((item) => {
            const t = window.sap.ui.require('sap/ui/core/Element').registry.filter((e) => e.getId().endsWith('--huItemsTable'))[0];
            const row = t && t.getItems().find((r) => String(r.getBindingContext('huDetail').getProperty('HandlingUnitItem')) === String(item));
            const btn = row && row.getCells().find((c) => c.isA('sap.m.Button'));
            return btn ? btn.getId() : null;
        }, d.item);
        if (!btnId) throw new Error(`no unpack button for item ${d.item} of HU ${d.handlingUnitExternalID}`);
        await page.click(`[id="${btnId}"]`);
        await kit.messageBoxButton(page, 'OK');
        const toast = await kit.waitForToast(page, ['unpacked'], 180000);
        await session.settle();
        const detail = await kit.viewModel(page, 'huPackBtn', 'huDetail');
        return { toast, error: detail && detail.message, hash: await kit.currentHash(page) };
    },
    async remove(session, d) {
        const { page } = session;
        await kit.open(session, d.hash);
        const enabled = await page.locator('[id$="--huDeleteBtn"]').isEnabled();
        if (!enabled) throw new Error(`"Delete HU" is disabled for ${d.handlingUnitExternalID} (HU not empty or not loaded)`);
        await page.click('[id$="--huDeleteBtn"]');
        await kit.messageBoxButton(page, 'Delete');
        const toast = await kit.waitForToast(page, ['deleted'], 180000);
        await session.settle();
        return { toast, hash: await kit.currentHash(page) };
    }
};

/** Expected payload, toast fragment and hash check per sub-case. */
function check(name, d, body, ui, stubbedHu) {
    const errors = [];
    const want = {
        create: { packagingMaterial: d.packagingMaterial, plant: d.plant, storageLocation: d.storageLocation },
        pack: { handlingUnitExternalID: d.handlingUnitExternalID, material: d.material, quantity: Number(d.quantity), unit: d.unit, plant: d.plant, storageLocation: d.storageLocation },
        unpack: { handlingUnitExternalID: d.handlingUnitExternalID, item: String(d.item), material: d.material, quantity: Number(d.quantity), unit: d.unit },
        remove: { handlingUnitExternalID: d.handlingUnitExternalID }
    }[name];
    Object.entries(want).forEach(([k, v]) => {
        if (v !== undefined && v !== null && String(body[k]) !== String(v)) errors.push(`payload ${k} = ${JSON.stringify(body[k])}, expected ${JSON.stringify(v)}`);
    });
    const toastNeedle = { create: stubbedHu || '', pack: d.material, unpack: d.material, remove: d.handlingUnitExternalID }[name];
    if (!ui.toast || !ui.toast.includes(toastNeedle)) errors.push(`UI did not show the ${name} success toast with ${toastNeedle} (toast: ${ui.toast}; error: ${ui.error || '-'})`);
    if (name === 'create' && stubbedHu && !String(ui.hash).startsWith(`wm/handling-unit/${stubbedHu}`)) errors.push(`UI did not open the new HU's detail route, hash "${ui.hash}"`);
    if (name === 'remove' && ui.hash !== 'wm/handling-unit') errors.push(`UI did not return to the HU list after delete, hash "${ui.hash}"`);
    return errors;
}

/** Per-sub-case dry-run inputs from the picked READ-ONLY data; a string = why the sub-case cannot run. */
function dryInputs(data) {
    const w = data.withItem;
    const fromItem = w && {
        handlingUnitExternalID: w.hu.HandlingUnitExternalID, hash: detailHash(w.hu), material: w.item.Material,
        quantity: w.item.Quantity, unit: w.item.Unit, batch: w.item.Batch || '', item: w.item.HandlingUnitItem,
        plant: w.item.Plant || w.hu.Plant, storageLocation: w.item.StorageLocation || w.hu.StorageLocation
    };
    return {
        create: data.create || 'no listed HU with packaging material, plant and SLoc',
        pack: fromItem || 'no HU with a packed item among the first 400 listed',
        unpack: fromItem || 'no HU with a packed item among the first 400 listed',
        remove: data.empty ? { handlingUnitExternalID: data.empty.hu.HandlingUnitExternalID, hash: detailHash(data.empty.hu) } : 'no empty HU among the first 400 listed (Delete HU is disabled for HUs with items)'
    };
}

async function dryRun(baseUrl) {
    const errors = [];
    const details = { subcases: {} };
    let inputs;
    try {
        inputs = dryInputs(await pickDryRunData(baseUrl));
    } catch (err) {
        return { errors: [`test data: ${err.message}`], details };
    }
    for (const name of Object.keys(SUBCASES)) {
        const d = inputs[name];
        const sub = details.subcases[name] = { data: d, readBack: 'NOT VERIFIED (dry-run)' };
        if (typeof d === 'string') {
            // Not a failure: the UI path exists, current SAP data offers no candidate (reported, like runScreens' SKIPPED)
            sub.status = 'SKIPPED';
            console.log(`  [SKIPPED] ${name} — not reachable with current SAP data: ${d}`);
            continue;
        }
        const subErrors = [];
        const session = await openSession({ baseUrl, user: 'alice' });
        try {
            const calls = await kit.stubAction(session, PATH[name], (body) => writeResult(body, name === 'remove' ? { Deleted: true } : {}));
            sub.calls = calls;
            sub.ui = await SUBCASES[name](session, d);
            subErrors.push(...kit.expectCalls(calls, [PATH[name]]));
            subErrors.push(...check(name, d, (calls[0] || {}).body || {}, sub.ui, name === 'create' ? STUB_HU : null));
        } catch (err) {
            subErrors.push(`${err.name}: ${err.message.split('\n')[0]}`);
        } finally {
            // create: the detail screen then reads detail(<stub HU>), which SAP cannot know — the stub's consequence.
            subErrors.push(...kit.sessionErrors(session, name === 'create' ? new RegExp(STUB_HU) : null));
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
        const raw = data[name];
        const sub = details.subcases[name] = { readBack: 'NOT RUN' };
        const subErrors = [];
        const session = await openSession({ baseUrl, user: 'alice', allowWrites: [new RegExp(`^${PATH[name]}$`)] });
        const calls = kit.recordPosts(session, [PATH[name]]);
        try {
            let d = { ...raw };
            if (name !== 'create') {
                const before = await kit.getJson(baseUrl, detailPath(raw.handlingUnitExternalID));
                const hu = { HandlingUnitExternalID: raw.handlingUnitExternalID, Warehouse: before.Warehouse, HandlingUnitIDChar32: before.HandlingUnitIDChar32, HandlingUnitOrigin: before.HandlingUnitOrigin };
                const it = (before.Items || []).find((x) => String(x.HandlingUnitItem) === String(raw.item)) || {};
                d = { ...d, hash: detailHash(hu), plant: before.Plant || it.Plant, storageLocation: before.StorageLocation || it.StorageLocation };
                if (name === 'unpack') d = { ...d, material: it.Material, quantity: it.Quantity, unit: it.Unit };
            }
            sub.ui = await SUBCASES[name](session, d);
            subErrors.push(...kit.expectCalls(calls, [PATH[name]]));
            const created = name === 'create' && /^wm\/handling-unit\/([^?]+)/.exec(sub.ui.hash || '');
            subErrors.push(...check(name, d, (calls[0] || {}).body || {}, sub.ui, created ? decodeURIComponent(created[1]) : null));
            if (!subErrors.length) {
                const hu = created ? decodeURIComponent(created[1]) : d.handlingUnitExternalID;
                const rb = await kit.getJson(baseUrl, detailPath(hu)).then((x) => ({ found: true, x }), (err) => ({ found: false, err: err.message }));
                sub.readBack = { hu, found: rb.found, items: rb.found ? rb.x.Items : undefined };
                const ok = {
                    create: rb.found && rb.x.PackagingMaterial === d.packagingMaterial,
                    pack: rb.found && (rb.x.Items || []).some((x) => x.Material === d.material),
                    unpack: rb.found && !(rb.x.Items || []).some((x) => String(x.HandlingUnitItem) === String(d.item) && Number(x.Quantity) === Number(d.quantity)),
                    remove: !rb.found
                }[name];
                if (!ok) subErrors.push(`SAP read-back does not show the ${name}: ${JSON.stringify(sub.readBack)}`);
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

function roundTripHandlingUnit(options = {}) {
    return kit.runSuite({ flow: FLOW, title: 'Handling unit create/pack/unpack/remove round trip', dryRun, live }, options);
}

if (require.main === module) kit.main(roundTripHandlingUnit);

module.exports = { roundTripHandlingUnit };
