'use strict';
/* global window */

/**
 * Tier C SAP round trip: orders due for delivery (#/le/orders-due, OrdersDueForDelivery.controller.js).
 * Four sub-cases, one write each, separate sessions (actions in srv/le/outbound-delivery/service.cds):
 * - createDelivery: plant → ready row "Create Delivery" → CreateDeliveryDialog → createOutboundDelivery (:35-40, returns String)
 * - deliveryWithoutRef: "Create Delivery without Reference" → CreateDeliveryNoRefDialog → createDeliveryWithoutRef (:125-146)
 * - postGoodsIssue: follow-up panel, delivery number → status from SAP → Post Goods Issue → OK → postGoodsIssue (:62-67)
 * - createBilling: follow-up panel, delivery number → Load Billing Types → Create Billing Document → OK → createBillingDocument (:75-81)
 * The UI chains create → follow-up only by loading the new delivery's SAP status; PGI/billing stay disabled until SAP
 * reports picking (PGI) or goods movement (billing) complete (controller :533-534), so a stubbed delivery cannot be
 * chained. PGI/billing need a real delivery in that status; no CAP read lists outbound deliveries (service.cds has
 * only getDeliveryStatus by number), so in dry-run they run only when E2E_DRYRUN_PGI_DELIVERY /
 * E2E_DRYRUN_BILLING_DELIVERY (or options.pgiDelivery / options.billingDelivery) name one; otherwise SKIPPED.
 * All calls are direct POSTs (ODataClient.post, OutboundDeliveryService.js:178, :197, :212, :284).
 *
 * dry-run (default): rows/values from READ-ONLY reads the screen uses (worklist for plant 1120, ShippingPointVH,
 * DeliveryWithoutRefShipToParties). Proves UI wiring only (stubbed actions), never SAP persistence.
 * live: liveWriteGate flow "ordersDue" + the user's written go; testData.json "ordersDue":
 *   { plant, salesOrder, pgiDelivery, billingDelivery,
 *     noRef: { shippingPoint, deliveryType, shipToParty, plant, storageLocation, salesOrg, distChannel, division,
 *              material, quantity, uom } }
 * Live read-back (GET-only): getDeliveryStatus (create, PGI), getDeliveryWithoutRef (no-ref),
 * customer-invoice/CustomerInvoices('<no>') (billing).
 */

const { openSession } = require('../support/screenCheck');
const { resolveMode } = require('../support/liveWriteGate');
const rt = require('../support/actionRoundTrip');

const FLOW = 'ordersDue';
const SERVICE = '/odata/v4/outbound-delivery';
const DRYRUN_PLANT = '1120'; // the plant the LE screen suite uses (verifyLeScreens.e2e.js)
// Synthetic values: never a real SAP number, so a dry-run result cannot be mistaken for a created document.
const STUB_DELIVERY = 'DRYRUNOD01';
const STUB_NOREF_DELIVERY = 'DRYRUNOD02';
const STUB_BILLING = 'DRYRUNBD01';
// The UI reads SAP status of the delivery the action returned (controller :329, :487); for a stub number SAP says 404.
const statusOfStub = (no) => ({ status: 404, url: new RegExp(`/getDeliveryStatus\\(DeliveryDocument='${no}'\\)$`) });

async function openWorklist(session, plant) {
    await rt.openHash(session, 'le/orders-due');
    const current = await rt.modelData(session.page, 'ordersDueView');
    if (!current || current.plant !== plant) await rt.typeInto(session, 'inputPlant', plant);
}

/** Enabled "Create Delivery" buttons of the worklist rows with their row data. */
function rowButtons(page) {
    return page.evaluate(() => {
        const Element = window.sap.ui.require('sap/ui/core/Element');
        const table = Element.registry.filter((c) => c.getId().endsWith('--ordersDueTable'))[0];
        return (table ? table.getItems() : []).map((it) => {
            const btn = it.getCells().find((c) => c.isA('sap.m.Button'));
            const ctx = it.getBindingContext('outboundDelivery');
            return btn && btn.getEnabled() && btn.getVisible() && btn.getDomRef() && ctx ? { id: btn.getId(), row: JSON.parse(JSON.stringify(ctx.getObject())) } : null;
        }).filter(Boolean);
    });
}

/** Opens the follow-up panel (collapsed while it holds no delivery) and enters a delivery number. */
async function enterFollowUpDelivery(session, delivery) {
    const input = session.page.locator('[id$="--inpFollowUpDelivery-inner"]');
    if (!(await input.isVisible())) {
        await session.page.locator('[id$="--deliveryFollowUpPanel-header"]').click();
        await input.waitFor({ state: 'visible', timeout: 10000 });
    }
    await rt.typeInto(session, 'inpFollowUpDelivery', delivery);
}

async function searchWorklist(session, text) {
    await session.page.fill('[id$="--searchOrdersDue-I"]', text);
    await session.page.press('[id$="--searchOrdersDue-I"]', 'Enter');
    await session.settle();
}

const SUBCASES = {
    async createDelivery(session, { live, data }) {
        const plant = live ? data.plant : DRYRUN_PLANT;
        await openWorklist(session, plant);
        if (live) await searchWorklist(session, data.salesOrder);
        const rows = await rowButtons(session.page);
        const pick = live ? rows.find((r) => r.row.SalesOrder === data.salesOrder) : rows[0];
        if (!pick) throw new Error(live ? `sales order ${data.salesOrder} has no enabled Create Delivery row for plant ${plant}` : `no ready row for plant ${plant}`);
        await session.page.click(`[id="${pick.id}"]`);
        await session.settle();
        const dlg = await rt.modelData(session.page, 'deliveryDialog');
        if (!dlg.shippingPoint) throw new Error(`dialog did not take the row's shipping point (row ${pick.row.ShippingPoint})`);
        await session.page.locator('[id$="--btnConfirmDelivery"]').click();
        return {
            row: pick.row,
            expected: { SalesOrder: pick.row.SalesOrder, ShippingPoint: pick.row.ShippingPoint, DeliveryDate: pick.row.GoodsIssueDate },
            docOf: (res) => (live ? (res && res.value) : STUB_DELIVERY),
            async readBack(get, no) {
                const s = await get(`outbound-delivery/getDeliveryStatus(DeliveryDocument='${encodeURIComponent(no)}')`);
                return s.DeliveryDocument === no ? [] : [`getDeliveryStatus(${no}) returned ${JSON.stringify(s)}`];
            }
        };
    },

    async deliveryWithoutRef(session, { live, data, get }) {
        let v;
        if (live) {
            v = data.noRef;
        } else {
            // READ-ONLY: a ship-to party from the dialog's own value-help entity and the shipping point of a worklist row of the plant
            const shipTo = (await get('outbound-delivery/DeliveryWithoutRefShipToParties?$top=1'))[0];
            const row = (await get(`outbound-delivery/OrdersDueForDelivery?$filter=${encodeURIComponent(`Plant eq '${DRYRUN_PLANT}'`)}&$top=1`))[0];
            if (!shipTo || !row) throw new Error('no ship-to party or worklist row to derive dry-run data from');
            v = { shipToParty: shipTo.Customer, shippingPoint: row.ShippingPoint, plant: DRYRUN_PLANT };
        }
        await openWorklist(session, live ? data.plant : DRYRUN_PLANT);
        await session.page.locator('[id$="--btnCreateDeliveryNoRef"]').click();
        await session.settle();
        await rt.selectKey(session, 'comboNoRefShippingPoint', v.shippingPoint);
        if (live) await rt.selectKey(session, 'selNoRefDeliveryType', v.deliveryType);
        await rt.typeInto(session, 'inputNoRefShipTo', v.shipToParty);
        await rt.typeInto(session, 'inputNoRefPlant', v.plant);
        if (live) {
            await rt.typeInto(session, 'inputNoRefSLoc', v.storageLocation);
            await rt.typeInto(session, 'inputNoRefSalesOrg', v.salesOrg);
            await rt.typeInto(session, 'inputNoRefDistChannel', v.distChannel);
            await rt.typeInto(session, 'inputNoRefDivision', v.division);
            await session.page.evaluate((it) => {
                const Element = window.sap.ui.require('sap/ui/core/Element');
                const t = Element.registry.filter((c) => c.getId().endsWith('--tableNoRefItems'))[0];
                const cells = t.getItems()[0].getCells();
                const byPath = (p) => cells.find((c) => c.getBinding('value') && c.getBinding('value').getPath() === p);
                return Object.entries(it).map(([p, val]) => byPath(p).getId() + '-inner|' + val);
            }, { material: v.material, quantity: v.quantity, uom: v.uom }).then(async (targets) => {
                for (const t of targets) {
                    const [id, val] = t.split('|');
                    await session.page.fill(`[id="${id}"]`, val);
                    await session.page.press(`[id="${id}"]`, 'Tab');
                }
                await session.settle();
            });
        }
        const form = await rt.modelData(session.page, 'deliveryNoRefDialog');
        await session.page.locator('[id$="--btnConfirmDeliveryNoRef"]').click();
        return {
            form,
            expected: {
                ShippingPoint: v.shippingPoint, ShipToParty: v.shipToParty, Plant: v.plant, StorageLocation: form.storageLocation,
                DeliveryDocumentType: form.deliveryType, SalesOrganization: form.salesOrg, DistributionChannel: form.distChannel, Division: form.division
            },
            expectedItem: { Material: form.items[0].material, DeliveryQuantityUnit: form.items[0].uom },
            docOf: (res) => (live ? (res && res.OutboundDelivery) : STUB_NOREF_DELIVERY),
            async readBack(get, no) {
                const d = await get(`outbound-delivery/getDeliveryWithoutRef(OutboundDelivery='${encodeURIComponent(no)}')`);
                const errs = [];
                if (d.OutboundDelivery !== no) errs.push(`getDeliveryWithoutRef(${no}) returned ${JSON.stringify(d).slice(0, 200)}`);
                if (d.ShipToParty !== v.shipToParty) errs.push(`read-back ShipToParty ${d.ShipToParty} != ${v.shipToParty}`);
                if (!(d.Items || []).some((i) => i.Material === v.material)) errs.push(`read-back items lack material ${v.material}`);
                return errs;
            }
        };
    },

    async postGoodsIssue(session, { delivery }) {
        await openWorklist(session, DRYRUN_PLANT);
        await enterFollowUpDelivery(session, delivery);
        const fu = await rt.modelData(session.page, 'deliveryFollowUp');
        if (!fu.canPgi) throw new Error(`delivery ${delivery} is not ready for goods issue per SAP: ${fu.statusText}`);
        await session.page.locator('[id$="--btnPostGoodsIssue"]').click();
        await session.settle();
        await rt.pressBoxButton(session, 'OK');
        return {
            expected: { DeliveryDocument: delivery },
            docOf: () => delivery,
            async readBack(get, no) {
                const s = await get(`outbound-delivery/getDeliveryStatus(DeliveryDocument='${encodeURIComponent(no)}')`);
                return s.OverallGoodsMovementStatus === 'C' ? [] : [`getDeliveryStatus(${no}).OverallGoodsMovementStatus=${s.OverallGoodsMovementStatus}, expected C`];
            }
        };
    },

    async createBilling(session, { live, delivery }) {
        await openWorklist(session, DRYRUN_PLANT);
        await enterFollowUpDelivery(session, delivery);
        let fu = await rt.modelData(session.page, 'deliveryFollowUp');
        if (!fu.canBill) throw new Error(`delivery ${delivery} is not ready for billing per SAP: ${fu.statusText}`);
        await session.page.locator('[id$="--btnLoadBillingTypes"]').click();
        await session.settle();
        fu = await rt.modelData(session.page, 'deliveryFollowUp');
        if (!fu.billingTypes.length) throw new Error(`SAP returned no billing document type for delivery ${delivery}`);
        if (!fu.billingType) await rt.selectKey(session, 'selBillingType', fu.billingTypes[0].BillingDocumentType);
        fu = await rt.modelData(session.page, 'deliveryFollowUp');
        await session.page.locator('[id$="--btnCreateBillingDocument"]').click();
        await session.settle();
        await rt.pressBoxButton(session, 'OK');
        return {
            expected: { DeliveryDocument: delivery, BillingDocumentType: fu.billingType },
            docOf: (res) => (live ? (res && res.BillingDocument) : STUB_BILLING),
            async readBack(get, no) {
                const inv = await get(`customer-invoice/CustomerInvoices('${encodeURIComponent(no)}')`);
                return inv.BillingDocument === no ? [] : [`CustomerInvoices('${no}') returned ${JSON.stringify(inv).slice(0, 200)}`];
            }
        };
    }
};

// Action and CDS-shaped dry-run result per sub-case
const ACTIONS = {
    createDelivery: { action: 'createOutboundDelivery', respond: () => ({ '@odata.context': '$metadata#Edm.String', value: STUB_DELIVERY }), expectedHttp: [statusOfStub(STUB_DELIVERY)] },
    deliveryWithoutRef: {
        action: 'createDeliveryWithoutRef',
        respond: (b) => ({
            OutboundDelivery: STUB_NOREF_DELIVERY, ShippingPoint: b.ShippingPoint, DeliveryDocumentType: b.DeliveryDocumentType,
            PlannedGoodsIssueDate: b.PlannedGoodsIssueDate, Plant: b.Plant, StorageLocation: b.StorageLocation, ShipToParty: b.ShipToParty,
            ItemCount: (b.Items || []).length
        }),
        expectedHttp: [statusOfStub(STUB_NOREF_DELIVERY)]
    },
    postGoodsIssue: { action: 'postGoodsIssue', respond: (b) => ({ DeliveryDocument: b.DeliveryDocument, Done: true, ErrorFlags: [] }), expectedHttp: [] },
    createBilling: { action: 'createBillingDocument', respond: () => ({ BillingDocument: STUB_BILLING, BillToParty: '', BillToPartyName: '', Messages: [] }), expectedHttp: [] }
};

async function runCase(baseUrl, name, ctx) {
    const out = { name, errors: [], details: {} };
    const a = ACTIONS[name];
    const session = await openSession({ baseUrl, user: 'alice' });
    try {
        const calls = await rt.interceptAction(session.page, { flow: FLOW, service: SERVICE, action: a.action, live: ctx.live, respond: a.respond });
        const step = await SUBCASES[name](session, ctx);
        const box = await rt.resultBox(session.page, ctx.live ? 180000 : 30000);
        await session.settle();
        out.details.ui = box;
        out.details.calls = calls;
        if (step.row) out.details.row = step.row;
        if (step.form) out.details.form = step.form;
        out.errors.push(...rt.checkCalls(calls, step.expected, a.action));
        const call = calls.find((c) => !c.mixed) || {};
        if (step.expectedItem) {
            const item = ((call.body || {}).Items || [])[0] || {};
            Object.entries(step.expectedItem).forEach(([k, v]) => {
                if (String(item[k]) !== String(v)) out.errors.push(`payload Items[0].${k}=${JSON.stringify(item[k])}, expected ${JSON.stringify(v)}`);
            });
        }
        const docNo = step.docOf(call.result);
        out.details.documentNumber = docNo;
        if (box.type !== 'success') out.errors.push(`UI showed ${box.type || 'no'} result: ${box.text}`);
        if (!docNo || !box.text.includes(docNo)) out.errors.push(`UI result does not show ${docNo || '(no number returned)'}: ${box.text}`);
        if (ctx.live && docNo) {
            out.details.readBack = 'VERIFIED';
            const rb = await step.readBack(ctx.get, docNo).catch((err) => [`read-back failed: ${err.message}`]);
            if (rb.length) out.details.readBack = 'FAIL';
            out.errors.push(...rb);
        } else {
            out.details.readBack = ctx.live ? 'NOT RUN (no document number)' : 'NOT VERIFIED (dry-run)';
        }
    } catch (err) {
        out.errors.push(`${err.name}: ${err.message.split('\n')[0]}`);
    } finally {
        out.errors.push(...rt.sessionErrors(session, undefined, ctx.live ? [] : a.expectedHttp));
        await session.close();
    }
    return out;
}

async function roundTripOrdersDue(options = {}) {
    const baseUrl = (options.baseUrl || process.env.TARGET_URL || 'http://localhost:4004').replace(/\/+$/, '');
    let gate;
    try {
        gate = resolveMode(FLOW, options.gate);
    } catch (err) {
        console.log(`  [FAIL] ${err.message}`);
        return { status: 'FAIL', mode: 'blocked', errors: [err.message], details: {} };
    }
    const live = gate.mode === 'live';
    console.log(`\n=== Orders due for delivery round trip — Tier C ${live ? 'LIVE SAP WRITE' : 'READ-ONLY dry-run (stubbed write actions)'} ===`);
    if (!(await rt.waitForHealth(baseUrl))) return { status: 'FAIL', mode: gate.mode, errors: [`server not healthy at ${baseUrl}`], details: {} };
    const data = gate.data || {};
    const get = rt.capGet(baseUrl);
    const deliveries = {
        postGoodsIssue: live ? data.pgiDelivery : (options.pgiDelivery || process.env.E2E_DRYRUN_PGI_DELIVERY),
        createBilling: live ? data.billingDelivery : (options.billingDelivery || process.env.E2E_DRYRUN_BILLING_DELIVERY)
    };
    const cases = [];
    for (const name of Object.keys(SUBCASES)) {
        if (name in deliveries && !deliveries[name]) {
            cases.push({
                name, errors: [], details: {},
                skipped: `needs a real delivery ready for ${name === 'postGoodsIssue' ? 'goods issue (picking C, goods movement not C)' : 'billing (goods movement C, billing not C)'}; no CAP read lists outbound deliveries — set ${name === 'postGoodsIssue' ? 'E2E_DRYRUN_PGI_DELIVERY' : 'E2E_DRYRUN_BILLING_DELIVERY'}`
            });
            continue;
        }
        cases.push(await runCase(baseUrl, name, { live, data, get, delivery: deliveries[name] }));
    }
    return rt.suiteResult('orders due round trip', gate.mode, cases);
}

if (require.main === module) {
    roundTripOrdersDue().then((r) => {
        console.log(JSON.stringify(r.details, null, 2));
        process.exit(r.status === 'PASS' ? 0 : 1);
    });
}

module.exports = { roundTripOrdersDue, SUBCASES, ACTIONS, SERVICE, DRYRUN_PLANT };
