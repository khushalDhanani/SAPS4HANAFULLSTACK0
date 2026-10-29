'use strict';
/* global window */

/**
 * Tier C SAP round trip: create a packing instruction.
 * UI: #/wm/packing-instruction → "Create" → dialog: external name, weight unit, packaging (P) material/qty/unit,
 * one packed (M) material row → "Create" → exactly one POST create (PackingInstructions.controller.js:113-131) →
 * toast "Packing instruction {number} created" → navigates to #/wm/packing-instruction/{systemUUID} (detail GET).
 * Action: create(externalName, weightUnit, components, texts) returns PackingInstruction
 * (srv/wm/packing-instruction/service.cds:57-63, type :13-33).
 *
 * dry-run (default): write guard on; only create is answered by a stub. Never proves SAP persistence.
 * live: needs liveWriteGate authorization + the user's written go; data from test/e2e/live/testData.json
 *   "packingInstruction": { "externalName", "weightUnit", "packagingMaterial", "packagingQty", "packagingUnit",
 *   "material", "quantity", "unit" }. Read-back: GET get(systemUUID) (service.cds:46-47, read-only function).
 */

const { openSession } = require('../support/screenCheck');
const kit = require('./wmRoundTripKit');

const FLOW = 'packingInstruction';
const SERVICE = '/odata/v4/packing-instruction';
const ACTION = `${SERVICE}/create`;
// Synthetic values: never a real SAP number/UUID, so a dry-run result cannot be mistaken for a created document.
const STUB_NO = 'DRYRUNPI01';
const STUB_UUID = 'dryrun00-0000-4000-8000-000000000001';
// Name typed into the form in dry-run; the stub means nothing is created under it.
const DRY_RUN_NAME = 'E2E-DRYRUN';

/** PackingInstruction (service.cds:13-33) built from the submitted payload. */
function stubResult(body) {
    return {
        '@odata.context': '$metadata#saps4hana.wm.PackingInstructionService.PackingInstruction',
        PackingInstructionSystemUUID: STUB_UUID,
        PackingInstructionNumber: STUB_NO,
        PackingInstructionExternalName: body.externalName,
        HandlingUnitType: null, Length: null, Width: null, Height: null, DimensionUnit: null,
        GrossWeight: null, WeightUnit: body.weightUnit, GrossVolume: null, VolumeUnit: null, IsDeleted: false,
        CreatedByUser: null, CreationDate: null, LastChangedByUser: null, LastChangeDate: null,
        Components: (body.components || []).map((c) => ({ Item: c.item, Material: c.material, TargetQuantity: c.targetQty, Unit: c.unit })),
        Texts: []
    };
}

/**
 * Dry-run data from READ-ONLY reads the screen and dialog use: the packaging value help the dialog loads
 * (handling-unit valueHelp(kind='packaging')) and the components of an existing packing instruction (list → get)
 * whose item 10 is in that value help, so the P/M pair is one SAP already accepted together.
 */
async function pickDryRunData(baseUrl) {
    const vh = ((await kit.getJson(baseUrl, "/odata/v4/handling-unit/valueHelp(kind='packaging')")) || {}).Items || [];
    const packaging = new Set(vh.map((v) => v.key));
    const list = ((await kit.getJson(baseUrl, `${SERVICE}/list(externalName='')`)) || {}).Items || [];
    for (const pi of list.slice(0, 20)) {
        const d = await kit.getJson(baseUrl, `${SERVICE}/get(systemUUID='${pi.PackingInstructionSystemUUID}')`).catch(() => null);
        const comps = (d && d.Components) || [];
        if (comps.length >= 2 && packaging.has(comps[0].Material) && comps[1].Material && comps[1].TargetQuantity > 0) {
            return {
                source: d.PackingInstructionNumber, externalName: DRY_RUN_NAME, weightUnit: d.WeightUnit || 'KG',
                packagingMaterial: comps[0].Material, packagingQty: comps[0].TargetQuantity, packagingUnit: comps[0].Unit,
                material: comps[1].Material, quantity: comps[1].TargetQuantity, unit: comps[1].Unit
            };
        }
    }
    throw new Error(`no packing instruction among the first ${Math.min(list.length, 20)} with a packaging item 10 from the value help`);
}

async function typeInto(page, selector, value) {
    await page.fill(selector, String(value));
    await page.press(selector, 'Tab');
}

/** Opens the create dialog, fills it like a user and presses "Create" once. */
async function driveUi(session, data, waitMs = 180000) {
    const { page } = session;
    await kit.open(session, 'wm/packing-instruction');
    await page.click('[id$="--piCreateBtn"]');
    await page.locator('[id$="--piCreateDialog"]').waitFor({ state: 'visible', timeout: 15000 });
    await session.settle();
    await typeInto(page, '[id$="--piCreateName-inner"]', data.externalName);
    await typeInto(page, '[id$="--piCreateWeightUnit-inner"]', data.weightUnit);
    await typeInto(page, '[id$="--piCreatePkgMat-inner"]', data.packagingMaterial);
    await typeInto(page, '[id$="--piCreatePkgQty-inner"]', data.packagingQty);
    await typeInto(page, '[id$="--piCreatePkgUnit-inner"]', data.packagingUnit);
    // Material row inputs have no ids: resolve the first row's cells by their value binding path
    const ids = await page.evaluate(() => {
        const t = window.sap.ui.require('sap/ui/core/Element').registry.filter((e) => e.getId().endsWith('--piCreateMaterialsTable'))[0];
        const cells = t.getItems()[0].getCells();
        const id = (p) => cells.find((c) => c.getBinding && c.getBinding('value') && c.getBinding('value').getPath() === p).getId() + '-inner';
        return { material: id('material'), qty: id('qty'), unit: id('unit') };
    });
    await typeInto(page, `[id="${ids.material}"]`, data.material);
    await typeInto(page, `[id="${ids.qty}"]`, data.quantity);
    await typeInto(page, `[id="${ids.unit}"]`, data.unit);
    const form = await kit.viewModel(page, 'piCreateBtn', 'piCreate');
    await page.click('[id$="--piCreateSubmit"]'); // exactly one submit, never retried
    const toast = await kit.waitForToast(page, ['created'], waitMs);
    await session.settle();
    const after = await kit.viewModel(page, 'piCreateBtn', 'piCreate');
    delete form.vhPackaging;
    return { form, toast, error: after && after.error, hash: await kit.currentHash(page) };
}

function expectedComponents(d) {
    return [
        { item: '10', category: 'P', material: d.packagingMaterial, targetQty: Number(d.packagingQty), unit: d.packagingUnit },
        { item: '20', category: 'M', material: d.material, targetQty: Number(d.quantity), unit: d.unit }
    ];
}

function payloadErrors(body, data) {
    const errors = [];
    if (body.externalName !== data.externalName) errors.push(`payload externalName ${body.externalName}, entered ${data.externalName}`);
    if (body.weightUnit !== data.weightUnit) errors.push(`payload weightUnit ${body.weightUnit}, entered ${data.weightUnit}`);
    const exp = JSON.stringify(expectedComponents(data));
    const got = JSON.stringify((body.components || []).map((c) => ({ item: c.item, category: c.category, material: c.material, targetQty: Number(c.targetQty), unit: c.unit })));
    if (got !== exp) errors.push(`payload components ${got}, entered ${exp}`);
    return errors;
}

async function dryRun(baseUrl) {
    const errors = [];
    let data = null;
    let ui = null;
    let calls = [];
    const session = await openSession({ baseUrl, user: 'alice' });
    try {
        data = await pickDryRunData(baseUrl);
        calls = await kit.stubAction(session, ACTION, stubResult);
        ui = await driveUi(session, data);
        errors.push(...kit.expectCalls(calls, [ACTION]));
        errors.push(...payloadErrors((calls[0] || {}).body || {}, data));
        if (!ui.toast || !ui.toast.includes(STUB_NO)) errors.push(`UI did not show "Packing instruction ${STUB_NO} created" (toast: ${ui.toast}; dialog error: ${ui.error || '-'})`);
        if (ui.hash !== `wm/packing-instruction/${STUB_UUID}`) errors.push(`UI did not open the created document's detail route, hash "${ui.hash}"`);
    } catch (err) {
        errors.push(`${err.name}: ${err.message.split('\n')[0]}`);
    } finally {
        // The detail screen then reads get(systemUUID=<stub>), which SAP cannot know: that read is the stub's consequence.
        errors.push(...kit.sessionErrors(session, new RegExp(STUB_UUID)));
        await session.close();
    }
    return { errors, details: { data, calls, ui, readBack: 'NOT VERIFIED (dry-run)' } };
}

async function live(baseUrl, data) {
    const errors = [];
    const details = { readBack: 'NOT RUN' };
    const session = await openSession({ baseUrl, user: 'alice', allowWrites: [new RegExp(`^${ACTION}$`)] });
    const calls = kit.recordPosts(session, [ACTION]);
    try {
        const ui = await driveUi(session, data);
        details.ui = ui;
        errors.push(...kit.expectCalls(calls, [ACTION]));
        errors.push(...payloadErrors((calls[0] || {}).body || {}, data));
        const m = /^wm\/packing-instruction\/(.+)$/.exec(ui.hash || '');
        if (!ui.toast || !m) {
            errors.push(`create not confirmed by the UI: toast ${ui.toast}; dialog error ${ui.error || '-'}`);
        } else {
            const uuid = decodeURIComponent(m[1]);
            const doc = await kit.getJson(baseUrl, `${SERVICE}/get(systemUUID='${uuid}')`);
            details.readBack = { uuid, number: doc.PackingInstructionNumber, weightUnit: doc.WeightUnit, components: doc.Components };
            console.log(`  document: packing instruction ${doc.PackingInstructionNumber} (UUID ${uuid})`);
            const got = (doc.Components || []).map((c) => `${c.Material}:${Number(c.TargetQuantity)}:${c.Unit}`).sort().join(',');
            const exp = expectedComponents(data).map((c) => `${c.material}:${c.targetQty}:${c.unit}`).sort().join(',');
            if (doc.PackingInstructionExternalName !== data.externalName || doc.WeightUnit !== data.weightUnit || got !== exp) errors.push(`SAP read-back mismatch: ${JSON.stringify(details.readBack)}`);
        }
    } catch (err) {
        errors.push(`${err.name}: ${err.message.split('\n')[0]}`);
    } finally {
        errors.push(...kit.sessionErrors(session));
        await session.close();
    }
    return { errors, details };
}

function roundTripPackingInstruction(options = {}) {
    return kit.runSuite({ flow: FLOW, title: 'Packing instruction create round trip', dryRun, live }, options);
}

if (require.main === module) kit.main(roundTripPackingInstruction);

module.exports = { roundTripPackingInstruction, driveUi, pickDryRunData, ACTION, stubResult };
