'use strict';
/* global document, window */

/**
 * Authorization / plant-isolation E2E (READ-ONLY, write guard on), as CAP mock user `bob` (Viewer, Plant 1120):
 * - plant-scoped lists show only rows of plant 1120;
 * - deep links to another plant's documents (ids looked up read-only as `alice`, Admin) show no foreign data and are
 *   refused by the server (403/404), never a 5xx;
 * - choosing a plant outside the user's scope on Orders Due is refused and loads no rows.
 */

const { openSession, openHash, inspectScreen } = require('../support/screenCheck');

const OWN_PLANT = '1120';
const ADMIN = { Authorization: 'Basic ' + Buffer.from('alice:').toString('base64') };

const open = openHash;

/** Values of the scoping `Plant` property of the loaded rows (not ReceivingPlant etc., which may legitimately differ). */
function rowPlants(page) {
    return page.evaluate(() => {
        const Element = window.sap.ui.require('sap/ui/core/Element');
        return Element.registry.filter((c) => c.isA('sap.m.ListBase') && c.getDomRef() && c.getDomRef().getClientRects().length > 0 && c.getBinding('items'))
            .map((list) => {
                const b = list.getBinding('items');
                const ctxs = b.getCurrentContexts ? b.getCurrentContexts() : [];
                const plants = ctxs.map((ctx) => ctx && ctx.getObject && ctx.getObject()).filter(Boolean)
                    .map((o) => o.Plant).filter((p) => typeof p === 'string' && p);
                return { id: list.getId().split('--').pop(), rows: ctxs.length, plants: [...new Set(plants)] };
            });
    });
}

/** Visible text without refusal messages, which may name the refused plant without disclosing its data. */
function visibleText(page) {
    return page.evaluate(() => document.body.innerText.split('\n')
        .filter((l) => !/not authori[sz]ed|denied|outside|not found|not one of your plants/i.test(l)).join('\n'));
}

/** Server errors (5xx) and guard blocks since `from` are failures; 403/404 are the expected refusals. */
function serverProblems(session, from) {
    return session.networkErrors.slice(from.network).filter((e) => e.status >= 500).map((e) => `HTTP ${e.status} ${e.url}`)
        .concat(session.blocked.slice(from.blocked).map((b) => `write guard blocked ${b.reason}`))
        .concat(session.consoleErrors.slice(from.console).filter((e) => e.startsWith('PAGEERROR')));
}

const mark = (s) => ({ network: s.networkErrors.length, blocked: s.blocked.length, console: s.consoleErrors.length });
const refusals = (s, from) => s.networkErrors.slice(from.network).filter((e) => e.status === 403 || e.status === 404);

async function scopedList(session, hash) {
    await open(session, hash);
    const lists = (await rowPlants(session.page)).filter((l) => l.plants.length > 0);
    if (lists.length === 0) return [`no loaded rows with a plant on ${hash}`];
    return lists.filter((l) => l.plants.some((p) => p !== OWN_PLANT)).map((l) => `${l.id} shows foreign plant(s) ${l.plants.join(', ')}`);
}

async function foreignDeepLink(session, hash, foreignPlant, label) {
    const from = mark(session);
    await open(session, hash);
    const errors = serverProblems(session, from);
    if (refusals(session, from).length === 0) errors.push(`no 403/404 refusal for ${label}`);
    const screen = await inspectScreen(session.page);
    const text = await visibleText(session.page);
    if (new RegExp(`\\b${foreignPlant}\\b`).test(text)) errors.push(`foreign plant ${foreignPlant} visible on screen (route ${screen.route})`);
    return errors;
}

async function adminRead(baseUrl, path) {
    const res = await fetch(`${baseUrl}${path}`, { headers: ADMIN });
    return res.ok ? res.json() : null;
}

async function verifyPlantIsolation(options = {}) {
    const baseUrl = (options.baseUrl || process.env.TARGET_URL || 'http://localhost:4004').replace(/\/+$/, '');
    console.log(`\n=== Plant isolation as bob (Viewer, Plant ${OWN_PLANT}) — READ-ONLY, write guard on ===`);

    const res = await adminRead(baseUrl, `/odata/v4/reservation-entry/ReservationEntries?$top=1&$select=ReservationNo,ReservationItem,Plant&$filter=Plant ne '${OWN_PLANT}'`);
    const foreignRes = res && res.value && res.value[0];
    const open261 = await adminRead(baseUrl, '/odata/v4/mvt261/openItems()');
    const foreign261 = open261 && (open261.Items || []).find((i) => i.Plant && i.Plant !== OWN_PLANT);

    const cases = [
        { name: 'Reservation entry list shows only own plant', run: (s) => scopedList(s, 'wm/reservation-entry') },
        { name: 'HU stock transfer list shows only own plant', run: (s) => scopedList(s, 'wm/hu-stock-transfer') },
        foreignRes
            ? { name: `Foreign reservation ${foreignRes.ReservationNo}/${foreignRes.ReservationItem} (plant ${foreignRes.Plant}) is refused`,
                run: (s) => foreignDeepLink(s, `wm/reservation-entry/${foreignRes.ReservationNo}/${foreignRes.ReservationItem}`, foreignRes.Plant, 'foreign reservation') }
            : { name: 'Foreign reservation deep link', skip: 'no reservation outside plant 1120 found' },
        foreign261
            ? { name: `Foreign 261 item ${foreign261.Reservation}/${foreign261.ReservationItem} (plant ${foreign261.Plant}) is refused`,
                run: (s) => foreignDeepLink(s, `wm/mvt261/open/${foreign261.Reservation}/${foreign261.ReservationItem}`, foreign261.Plant, 'foreign 261 item') }
            : { name: 'Foreign 261 item deep link', skip: 'no open 261 item outside plant 1120 found' },
        {
            // The server refuses 1110 with 403 (outboundDeliveryAdapter tests, READ-ONLY curl); the UI refuses it first.
            name: 'Orders due: plant outside scope (1110) is refused, no request, own plant kept',
            run: async (s) => {
                await open(s, 'le/orders-due');
                const from = mark(s);
                const requested = [];
                s.page.on('request', (r) => { if (/Plant%20eq%20'1110'|Plant='1110'|Plant eq '1110'/.test(decodeURIComponent(r.url()) + (r.postData() || ''))) requested.push(r.url()); });
                await s.page.fill('[id$="--inputPlant-inner"]', '1110');
                await s.page.press('[id$="--inputPlant-inner"]', 'Enter');
                await s.settle();
                const errors = serverProblems(s, from);
                if (requested.length) errors.push(`request sent for plant 1110: ${requested[0]}`);
                const state = await s.page.evaluate(() => {
                    const E = window.sap.ui.require('sap/ui/core/Element');
                    const input = E.registry.filter((c) => c.getId().endsWith('--inputPlant'))[0];
                    return { value: input.getValue(), valueState: input.getValueState(), text: input.getValueStateText() };
                });
                if (state.value !== OWN_PLANT) errors.push(`plant input shows ${state.value}, expected the kept plant ${OWN_PLANT}`);
                if (state.valueState !== 'Error' || !/1110/.test(state.text)) errors.push(`no refusal message on the plant input (${state.valueState}: ${state.text})`);
                return errors;
            }
        }
    ];

    const errors = [];
    const details = [];
    for (const c of cases) {
        let errs = [];
        if (c.skip) {
            console.log(`  [SKIPPED] ${c.name} — ${c.skip}`);
            details.push({ case: c.name, status: 'SKIPPED', reason: c.skip });
            continue;
        }
        const session = await openSession({ baseUrl, user: 'bob' });
        try {
            errs = await c.run(session);
        } catch (err) {
            errs = [`${err.name}: ${err.message.split('\n')[0]}`];
        } finally {
            await session.close();
        }
        console.log(`  [${errs.length ? 'FAIL' : 'PASS'}] ${c.name}`);
        errs.forEach((e) => console.log(`      - ${e}`));
        details.push({ case: c.name, status: errs.length ? 'FAIL' : 'PASS', errors: errs });
        errs.forEach((e) => errors.push(`${c.name}: ${e}`));
    }
    return { status: errors.length ? 'FAIL' : 'PASS', errors, details };
}

if (require.main === module) {
    verifyPlantIsolation().then((r) => process.exit(r.status === 'PASS' ? 0 : 1));
}

module.exports = { verifyPlantIsolation };
