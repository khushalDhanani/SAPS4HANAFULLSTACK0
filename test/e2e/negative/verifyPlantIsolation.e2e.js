'use strict';
/* global window */

/**
 * Authorization / plant-isolation E2E (READ-ONLY, write guard on), as CAP mock user `test-viewer-1120` (Viewer, Plant 1120):
 * - choosing a plant outside the user's scope on Orders Due is refused and loads no rows.
 */

const { openSession, openHash } = require('../support/screenCheck');

const OWN_PLANT = '1120';

const open = openHash;

/** Server errors (5xx) and guard blocks since `from` are failures; 403/404 are the expected refusals. */
function serverProblems(session, from) {
    return session.networkErrors.slice(from.network).filter((e) => e.status >= 500).map((e) => `HTTP ${e.status} ${e.url}`)
        .concat(session.blocked.slice(from.blocked).map((b) => `write guard blocked ${b.reason}`))
        .concat(session.consoleErrors.slice(from.console).filter((e) => e.startsWith('PAGEERROR')));
}

const mark = (s) => ({ network: s.networkErrors.length, blocked: s.blocked.length, console: s.consoleErrors.length });

async function verifyPlantIsolation(options = {}) {
    const baseUrl = (options.baseUrl || process.env.TARGET_URL || 'http://localhost:4004').replace(/\/+$/, '');
    console.log(`\n=== Plant isolation as test-viewer-1120 (Viewer, Plant ${OWN_PLANT}) — READ-ONLY, write guard on ===`);

    const cases = [
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
        const session = await openSession({ baseUrl, user: 'test-viewer-1120' });
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
