'use strict';
/* global window */

/**
 * Tier C SAP round trip: customer return create on #/sd/returns/create (CreateCustomerReturn.controller.js:574)
 * → createCustomerReturn (srv/sd/customer-return/service.cds:122-152), called through
 * ODataModel#bindContext(...).execute() (CustomerReturnService.js:124), i.e. as the single request of a `$batch`.
 * The list (#/sd/returns) does not create: its Create button navigates here (CustomerReturns.controller.js:407-411);
 * its own onConfirmCreateReturn (:559) belongs to CreateReturnDialog.fragment.xml, which no code opens.
 *
 * dry-run (default): reference document picked in the screen's value help (getReferenceDocuments, READ-ONLY);
 * its material from sales-order/SalesOrderItems; quantity/unit/plant/storage location stay as the screen proposes.
 * Proves UI wiring only (stubbed action), never SAP persistence.
 * live: liveWriteGate flow "customerReturn" + the user's written go; testData.json "customerReturn":
 *   { ReferenceSDDocument, SoldToParty, SalesOrganization, DistributionChannel, OrganizationDivision,
 *     ReturnsOrderReason, Material, OrderQuantity, OrderQuantityUnit, ProductionPlant, StorageLocation }
 * Live read-back (GET-only): customer-return/CustomerReturns('<no>') and CustomerReturnItems.
 */

const { openSession } = require('../support/screenCheck');
const { resolveMode } = require('../support/liveWriteGate');
const rt = require('../support/actionRoundTrip');

const FLOW = 'customerReturn';
const SERVICE = '/odata/v4/customer-return';
const ACTION = 'createCustomerReturn';
// Synthetic value: never a real SAP number, so a dry-run result cannot be mistaken for a created document.
const STUB_DOC = 'DRYRUNRE01';

/** Return type of createCustomerReturn (service.cds:144-152). */
function respond(body) {
    return {
        CustomerReturn: STUB_DOC,
        CustomerReturnType: body.CustomerReturnType,
        SoldToParty: body.SoldToParty,
        TotalNetAmount: '0.00',
        TransactionCurrency: '',
        Success: true,
        Message: 'DRY-RUN stub, nothing created in SAP'
    };
}

/** READ-ONLY: newest reference documents the screen offers, with a material from that order's items. */
async function deriveData(get) {
    const docs = await get("customer-return/getReferenceDocuments(search='',top=20)");
    for (const d of docs) {
        if (!d.SoldToParty) continue;
        const items = await get(`sales-order/SalesOrderItems?$filter=${encodeURIComponent(`SalesDocument eq '${d.ReferenceSDDocument}'`)}&$top=1`);
        if (items[0] && items[0].Material) {
            return {
                ReferenceSDDocument: d.ReferenceSDDocument, ReferenceSDDocumentCategory: d.SDDocumentCategory,
                SoldToParty: d.SoldToParty, SalesOrganization: d.SalesOrganization,
                DistributionChannel: d.DistributionChannel, OrganizationDivision: d.Division, Material: items[0].Material,
                ReferenceSDDocumentItem: items[0].SalesDocumentItem
            };
        }
    }
    throw new Error(`none of ${docs.length} reference documents from getReferenceDocuments has a readable item material`);
}

/**
 * Picks the reference document in the screen's value help dialog (fills customer, category and sales area).
 * Returns an error text when the dialog does not offer it; the dialog is then cancelled.
 */
async function pickReferenceDocument(session, doc) {
    const { page } = session;
    await page.click('[id$="--inputRefSDDoc-vhi"]');
    await session.settle();
    const dialog = page.locator('.sapMSelectDialog').last();
    await dialog.waitFor({ state: 'visible', timeout: 15000 });
    await dialog.locator('input[type="search"]').fill(doc);
    await dialog.locator('input[type="search"]').press('Enter');
    await session.settle();
    const item = dialog.locator('.sapMLIB').filter({ has: page.locator('.sapMSLITitleOnly, .sapMSLITitle', { hasText: new RegExp(`^${doc}$`) }) }).first();
    if (await item.count()) {
        await item.click();
        await session.settle();
        return null;
    }
    const shown = (await dialog.locator('.sapMLIB').allInnerTexts()).join(' | ').slice(0, 200);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await session.settle();
    return `reference document value help does not offer ${doc} although getReferenceDocuments returns it (dialog shows: ${shown})`;
}

/** Returns the UI defects met while filling (the flow continues by typing, as a user would). */
async function fill(session, v, live) {
    const defects = [];
    const vhError = await pickReferenceDocument(session, v.ReferenceSDDocument);
    if (vhError) {
        defects.push(vhError);
        await rt.typeInto(session, 'inputRefSDDoc', v.ReferenceSDDocument);
    }
    // The customer's change handler may propose a material (_applyCustomerDefaults), so the material is set after it
    await rt.typeInto(session, 'inputSoldToCustomer', v.SoldToParty);
    await rt.typeInto(session, 'inputSalesOrg', v.SalesOrganization);
    await rt.typeInto(session, 'inputDistChannel', v.DistributionChannel);
    await rt.typeInto(session, 'inputDivision', v.OrganizationDivision);
    if (live) await rt.selectKey(session, 'selReturnReason', v.ReturnsOrderReason);
    const cells = await session.page.evaluate(() => {
        const Element = window.sap.ui.require('sap/ui/core/Element');
        const table = Element.registry.filter((c) => c.getId().endsWith('--tblCreateReturnItems'))[0];
        const item = table && table.getItems()[0];
        const byPath = {};
        (item ? item.getCells() : []).forEach((c) => {
            const b = c.getBinding('value') || c.getBinding('selectedKey');
            if (b) byPath[b.getPath()] = { id: c.getId(), select: c.isA('sap.m.Select') };
        });
        return byPath;
    });
    const set = async (path, value) => {
        const cell = cells[path];
        if (!cell) throw new Error(`item cell ${path} not found`);
        if (cell.select) {
            await rt.selectKey(session, cell.id.split('--').pop(), value);
        } else {
            await session.page.fill(`[id="${cell.id}-inner"]`, String(value));
            await session.page.press(`[id="${cell.id}-inner"]`, 'Enter');
            await session.settle();
        }
    };
    await set('Material', v.Material);
    if (live) {
        await set('OrderQuantity', v.OrderQuantity);
        await set('OrderQuantityUnit', v.OrderQuantityUnit);
        await set('ProductionPlant', v.ProductionPlant);
        await set('StorageLocation', v.StorageLocation);
    }
    return { defects, viaValueHelp: !vhError };
}

async function roundTripCustomerReturn(options = {}) {
    const baseUrl = (options.baseUrl || process.env.TARGET_URL || 'http://localhost:4004').replace(/\/+$/, '');
    let gate;
    try {
        gate = resolveMode(FLOW, options.gate);
    } catch (err) {
        console.log(`  [FAIL] ${err.message}`);
        return { status: 'FAIL', mode: 'blocked', errors: [err.message], details: {} };
    }
    const live = gate.mode === 'live';
    console.log(`\n=== Customer return create round trip — Tier C ${live ? 'LIVE SAP WRITE' : 'READ-ONLY dry-run (stubbed write action)'} ===`);
    if (!(await rt.waitForHealth(baseUrl))) return { status: 'FAIL', mode: gate.mode, errors: [`server not healthy at ${baseUrl}`], details: {} };

    const get = rt.capGet(baseUrl);
    const out = { name: 'create customer return', errors: [], details: {} };
    let v;
    try {
        v = live ? { ...gate.data } : await deriveData(get);
    } catch (err) {
        out.errors.push(`test data: ${err.message}`);
        return rt.suiteResult('customer return round trip', gate.mode, [out]);
    }
    out.details.values = v;
    console.log(`  data (${live ? 'test/e2e/live/testData.json' : 'READ-ONLY CAP reads'}): ${JSON.stringify(v)}`);

    const session = await openSession({ baseUrl, user: 'alice' });
    try {
        const calls = await rt.interceptAction(session.page, { flow: FLOW, service: SERVICE, action: ACTION, live, respond });
        await rt.openHash(session, 'sd/returns/create');
        const filled = await fill(session, v, live);
        out.errors.push(...filled.defects);
        out.details.form = await rt.modelData(session.page, 'createReturnModel');
        await session.page.locator('[id$="--btnFooterCreateInSAP"]').click(); // exactly one submit, never retried
        const box = await rt.resultBox(session.page, live ? 180000 : 30000);
        out.details.ui = box;
        out.details.calls = calls;
        const expected = {
            ReferenceSDDocument: v.ReferenceSDDocument, SoldToParty: v.SoldToParty, SalesOrganization: v.SalesOrganization,
            DistributionChannel: v.DistributionChannel, OrganizationDivision: v.OrganizationDivision
        };
        if (live) expected.ReturnsOrderReason = v.ReturnsOrderReason;
        else if (filled.viaValueHelp) expected.ReferenceSDDocumentCategory = v.ReferenceSDDocumentCategory; // set by the value help selection
        out.errors.push(...rt.checkCalls(calls, expected, ACTION));
        const call = calls.find((c) => !c.mixed) || {};
        const item = ((call.body || {}).Items || [])[0] || {};
        const expItem = live
            ? { Material: v.Material, OrderQuantity: v.OrderQuantity, OrderQuantityUnit: v.OrderQuantityUnit, ProductionPlant: v.ProductionPlant, StorageLocation: v.StorageLocation, ReferenceSDDocument: v.ReferenceSDDocument }
            : { Material: v.Material, ReferenceSDDocument: v.ReferenceSDDocument };
        Object.entries(expItem).forEach(([k, val]) => {
            if (String(item[k]).trim() !== String(val).trim() && Number(item[k]) !== Number(val)) out.errors.push(`payload Items[0].${k}=${JSON.stringify(item[k])}, expected ${JSON.stringify(val)}`);
        });
        const docNo = live ? ((call.result || {}).CustomerReturn || '') : STUB_DOC;
        out.details.documentNumber = docNo;
        if (box.type !== 'success') out.errors.push(`UI showed ${box.type || 'no'} result: ${box.text}`);
        if (!docNo || !box.text.includes(docNo)) out.errors.push(`UI result does not show customer return ${docNo || '(none returned)'}: ${box.text}`);
        // Controller: success OK → back to the returns list (onNavBack)
        await rt.pressBoxButton(session, 'OK');
        const hash = await session.page.evaluate(() => window.location.hash);
        if (!/#\/sd\/returns$/.test(hash)) out.errors.push(`after OK expected #/sd/returns, got ${hash}`);

        if (live && docNo) {
            out.details.readBack = 'VERIFIED';
            const rb = await (async () => {
                const doc = await get(`customer-return/CustomerReturns('${encodeURIComponent(docNo)}')`);
                const items = await get(`customer-return/CustomerReturnItems?$filter=${encodeURIComponent(`CustomerReturn eq '${docNo}'`)}`);
                const errs = [];
                if (doc.SoldToParty !== v.SoldToParty) errs.push(`read-back SoldToParty ${doc.SoldToParty} != ${v.SoldToParty}`);
                if (!items.some((i) => i.Material === v.Material)) errs.push(`read-back items lack material ${v.Material}: ${JSON.stringify(items.map((i) => i.Material))}`);
                return errs;
            })().catch((err) => [`read-back failed: ${err.message}`]);
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
    return rt.suiteResult('customer return round trip', gate.mode, [out]);
}

if (require.main === module) {
    roundTripCustomerReturn().then((r) => {
        console.log(JSON.stringify(r.details, null, 2));
        process.exit(r.status === 'PASS' ? 0 : 1);
    });
}

module.exports = { roundTripCustomerReturn };
