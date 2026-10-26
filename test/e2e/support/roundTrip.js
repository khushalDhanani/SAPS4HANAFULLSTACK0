'use strict';
/* global document, window */

/**
 * Tier C SAP round-trip harness shared by the create-flow suites (mm/roundTripPurchaseOrder, sd/roundTripSales*).
 * Mode comes from liveWriteGate.resolveMode(flow):
 * - dry-run (default): Tier 0 write guard on; only the flow's single CAP write action is answered by a stub shaped
 *   like its CDS return type. Proves the UI flow (fill → submit → document number shown), never SAP persistence.
 * - live: real SAP write through a context whose guard allows exactly that action path; submitted once, never
 *   retried, then the document is read back through the CAP read API. Needs the user's written go per run (AGENTS.md).
 */

const { openSession, inspectScreen } = require('./screenCheck');
const { resolveMode } = require('./liveWriteGate');

const DRY_RUN_DOC = 'DRYRUN-0001';

/** GET-only CAP OData V4 reader: derives dry-run master data and reads documents back in live mode. */
function capReader(baseUrl, user) {
    const headers = { Authorization: 'Basic ' + Buffer.from(`${user}:`).toString('base64'), Accept: 'application/json' };
    return async function read(path, query = {}) {
        const qs = Object.entries(query).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
        const res = await fetch(`${baseUrl}/odata/v4/${path}${qs ? `?${qs}` : ''}`, { method: 'GET', headers });
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(`GET ${path} -> HTTP ${res.status}${body && body.error ? `: ${body.error.message}` : ''}`);
        return body && Array.isArray(body.value) ? body.value : body;
    };
}

/** User-level form helpers bound to one session. */
function formUi(session, modelName) {
    const { page } = session;
    const css = (id) => `[id="${id}"]`;

    /** Types into an input as a user would (fill, then Enter fires the change handler). */
    async function typeInto(domId, value) {
        await page.fill(css(domId), String(value));
        await page.press(css(domId), 'Enter');
        await session.settle();
    }

    return {
        page,
        /** Header field by view-local id, e.g. enter('inSupplier', '100002'). */
        enter: async (localId, value) => {
            const domId = await page.evaluate((id) => {
                const el = document.querySelector(`[id$="--${id}-inner"]`);
                return el ? el.id : null;
            }, localId);
            if (!domId) throw new Error(`input ${localId} not found`);
            await typeInto(domId, value);
        },
        /** Item table cell by its value binding path, e.g. enterItem('poItemsTable', 0, 'Material', 'X'). */
        enterItem: async (tableId, row, path, value) => {
            const domId = await page.evaluate(([t, r, p]) => {
                const Element = window.sap.ui.require('sap/ui/core/Element');
                const table = Element.registry.filter((c) => c.getId().endsWith('--' + t))[0];
                const item = table && table.getItems()[r];
                const input = item && item.getCells().find((c) => c.isA('sap.m.InputBase') && c.getBinding('value') && c.getBinding('value').getPath() === p);
                return input ? input.getId() + '-inner' : null;
            }, [tableId, row, path]);
            if (!domId) throw new Error(`item input ${tableId}[${row}].${path} not found`);
            await typeInto(domId, value);
        },
        /** Snapshot of the form's JSON model (the view state the controller validates and submits). */
        model: () => page.evaluate((name) => {
            const Element = window.sap.ui.require('sap/ui/core/Element');
            const ctl = Element.registry.filter((c) => c.getModel && c.getModel(name))[0];
            return ctl ? JSON.parse(JSON.stringify(ctl.getModel(name).getData())) : null;
        }, modelName),
        /** Presses a button inside the open MessageBox by its text. */
        messageBoxButton: async (text) => {
            await page.locator('.sapMMessageBox').getByRole('button', { name: text, exact: true }).click();
            await session.settle();
        }
    };
}

/** Field-by-field comparison of what the UI sent with what the suite entered. */
function comparePayload(label, actual, expected) {
    return Object.entries(expected)
        .filter(([k, v]) => String(actual && actual[k]).trim().toUpperCase() !== String(v).trim().toUpperCase()
            && Number(actual && actual[k]) !== Number(v))
        .map(([k, v]) => `payload ${label}.${k} = ${JSON.stringify(actual && actual[k])}, entered ${JSON.stringify(v)}`);
}

/**
 * spec: { flow, title, hash, route, service, action, submit, modelName, user?,
 *         deriveData(read) → values (dry-run, READ-ONLY CAP GETs), liveValues(data) → values,
 *         fill(ui, values), expectedPayload(values) → { header, item }, afterSuccess(ui, docNo) → errors[],
 *         readBack(read, docNo) → errors[] }
 */
async function runRoundTrip(spec, options = {}) {
    const baseUrl = (options.baseUrl || process.env.TARGET_URL || 'http://localhost:4004').replace(/\/+$/, '');
    const user = spec.user || 'alice';
    const actionPath = `${spec.service}/${spec.action}`;
    const actionRe = new RegExp(`^${actionPath.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}$`);
    const errors = [];
    const details = { flow: spec.flow, actionPath };
    const result = (mode) => {
        console.log(`  [${errors.length ? 'FAIL' : 'PASS'}] ${spec.title} (${mode})`);
        errors.forEach((e) => console.log(`      - ${e}`));
        return { status: errors.length ? 'FAIL' : 'PASS', mode, errors, details };
    };

    let gate;
    try {
        gate = resolveMode(spec.flow, options.gate);
    } catch (err) {
        errors.push(err.message);
        return result('blocked');
    }
    const live = gate.mode === 'live';
    console.log(`\n=== ${spec.title} — Tier C ${live ? 'LIVE SAP WRITE' : 'READ-ONLY dry-run (stubbed write action)'} ===`);
    if (!(await fetch(`${baseUrl}/fiori-app/webapp/index.html`).then((r) => r.ok, () => false))) {
        errors.push(`server not reachable at ${baseUrl}`);
        return result(gate.mode);
    }

    const read = capReader(baseUrl, user);
    let values;
    try {
        values = live ? spec.liveValues(gate.data) : await spec.deriveData(read);
    } catch (err) {
        errors.push(`test data: ${err.message}`);
        return result(gate.mode);
    }
    details.values = values;
    console.log(`  data (${live ? 'test/e2e/live/testData.json' : 'derived from READ-ONLY CAP value helps'}): ${JSON.stringify(values)}`);

    const session = await openSession({ baseUrl, user, allowWrites: live ? [actionRe] : [] });
    const { page } = session;
    const calls = [];
    page.on('request', (req) => {
        if (req.method() === 'POST' && actionRe.test(new URL(req.url()).pathname)) calls.push(req.postDataJSON());
    });
    if (!live) {
        // Registered after the session's guard, so it takes precedence for this one URL only; all else stays guarded.
        await page.route((url) => actionRe.test(url.pathname), (route) => route.fulfill({
            status: 200,
            contentType: 'application/json;odata.metadata=minimal;IEEE754Compatible=true',
            headers: { 'OData-Version': '4.0' },
            body: JSON.stringify({ '@odata.context': '$metadata#Edm.String', value: DRY_RUN_DOC })
        }));
    }

    try {
        await page.goto(`${baseUrl}/fiori-app/webapp/index.html#/${spec.hash}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForFunction(() => window.sap && window.sap.ui && window.sap.ui.require('sap/ui/core/Component'), null, { timeout: 30000 });
        await session.settle();
        const screen = await inspectScreen(page);
        if (screen.route !== spec.route) throw new Error(`expected route ${spec.route}, got ${screen.route || '(none)'}`);

        const ui = formUi(session, spec.modelName);
        await spec.fill(ui, values);

        const responseP = page.waitForResponse((r) => r.request().method() === 'POST' && actionRe.test(new URL(r.url()).pathname),
            { timeout: live ? 180000 : 30000 }).catch(() => null);
        await page.locator(`[id$="--${spec.submit}"]`).first().click(); // exactly one submit, never retried
        const response = await responseP;
        if (!response) {
            const m = await ui.model();
            throw new Error(`write action ${actionPath} was not called after submit; UI says: ${(m && m.errorMessage) || '(no message)'}`
                + `${m && m.errorList && m.errorList.length ? ` | ${m.errorList.map((e) => e.title || e.message).join(' | ')}` : ''}`);
        }
        const body = await response.json().catch(() => null);
        const docNo = body && typeof body.value === 'string' ? body.value.trim() : '';
        details.httpStatus = response.status();
        details.documentNumber = docNo;
        if (response.status() !== 200 || !docNo) throw new Error(`action returned HTTP ${response.status()} without a document number: ${JSON.stringify(body).slice(0, 300)}`);

        const shown = await page.waitForFunction((no) => [...document.querySelectorAll('.sapMMessageToast, .sapMMessageBox')]
            .some((e) => e.textContent.includes(no)), docNo, { timeout: 15000 }).then(() => true, () => false);
        if (!shown) errors.push(`UI did not show document number ${docNo} (no toast/message box containing it)`);
        errors.push(...await spec.afterSuccess(ui, docNo));
        await session.settle();

        if (calls.length !== 1) errors.push(`write action called ${calls.length} times, expected exactly 1`);
        const sent = calls[0] || {};
        details.payload = sent;
        console.log(`  action calls: ${calls.length}; payload sent: ${JSON.stringify(sent)}`);
        const expected = spec.expectedPayload(values);
        errors.push(...comparePayload('header', sent.header, expected.header));
        errors.push(...comparePayload('items[0]', (sent.items || [])[0], expected.item));

        if (live) {
            details.readBack = 'VERIFIED';
            const rb = await spec.readBack(read, docNo).catch((err) => [`read-back failed: ${err.message}`]);
            if (rb.length) details.readBack = 'FAIL';
            errors.push(...rb);
        } else {
            details.readBack = 'NOT VERIFIED (dry-run)';
        }
    } catch (err) {
        errors.push(`${err.name}: ${err.message.split('\n')[0]}`);
    } finally {
        session.blocked.forEach((b) => errors.push(`write guard blocked ${b.reason}`));
        session.consoleErrors.forEach((e) => errors.push(`console: ${e}`));
        session.networkErrors.forEach((e) => errors.push(`HTTP ${e.status} ${e.url}`));
        await session.close();
    }
    console.log(`  document: ${details.documentNumber || '(none)'}; read-back: ${details.readBack || 'not reached'}`);
    return result(gate.mode);
}

module.exports = { runRoundTrip, capReader, DRY_RUN_DOC };
