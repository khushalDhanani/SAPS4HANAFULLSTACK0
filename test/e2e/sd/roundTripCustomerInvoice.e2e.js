'use strict';

/**
 * Tier C SAP round trip: customer invoice follow-up actions on #/sd/invoices (CustomerInvoices.controller.js).
 * Two sub-cases, one write each, separate sessions:
 * - release: row button btnReleaseToAccounting → confirm OK → releaseInvoiceToAccounting
 *   (srv/sd/customer-invoice/service.cds:39-49), shown in a success MessageBox with the accounting document.
 * - cancel: row button btnCancelInvoice → CancelInvoiceDialog → btnConfirmCancelInvoice → cancelBillingDocument
 *   (service.cds:51-61), shown in a success MessageBox with the cancellation document.
 * The UI calls both through ODataModel#bindContext(...).execute() (CustomerInvoiceService.js:58, :76), i.e. as
 * the single request of a `$batch`; support/actionRoundTrip.js stubs (dry-run) or forwards once (live) that call.
 *
 * dry-run (default): rows are the first ones the screen itself enables for the action. Proves UI wiring only.
 * live: liveWriteGate flow "customerInvoice" + the user's written go; testData.json "customerInvoice":
 *   { "releaseBillingDocument": "...", "cancelBillingDocument": "..." }
 * Live read-back (GET-only): customer-invoice/CustomerInvoices('<doc>').
 */

const { openSession } = require('../support/screenCheck');
const { resolveMode } = require('../support/liveWriteGate');
const rt = require('../support/actionRoundTrip');

const FLOW = 'customerInvoice';
const SERVICE = '/odata/v4/customer-invoice';
const HASH = 'sd/invoices';
// Synthetic values: never a real SAP number, so a dry-run result cannot be mistaken for a posting.
const STUB_ACCOUNTING_DOC = 'DRYRUNAC01';
const STUB_CANCEL_DOC = 'DRYRUNCN01';

const CASES = {
    release: {
        name: 'release to accounting',
        action: 'releaseInvoiceToAccounting',
        button: 'btnReleaseToAccounting',
        dataKey: 'releaseBillingDocument',
        // CDS return type service.cds:42-49
        respond: (body) => ({
            BillingDocument: body.BillingDocument,
            AccountingDocument: STUB_ACCOUNTING_DOC,
            FiscalYear: String(new Date().getFullYear()),
            AccountingTransferStatus: 'C',
            Success: true,
            Message: 'DRY-RUN stub, nothing released in SAP'
        }),
        async confirm(session) {
            await rt.pressBoxButton(session, 'OK');
        },
        stubDoc: STUB_ACCOUNTING_DOC,
        resultDoc: (res) => res && res.AccountingDocument,
        async readBack(get, doc, res) {
            const inv = await get(`customer-invoice/CustomerInvoices('${encodeURIComponent(doc)}')`);
            return inv.AccountingTransferStatus === 'C' && (!res.AccountingDocument || inv.AccountingDocument === res.AccountingDocument)
                ? [] : [`read-back CustomerInvoices('${doc}'): AccountingTransferStatus=${inv.AccountingTransferStatus}, AccountingDocument=${inv.AccountingDocument}, action returned ${res.AccountingDocument}`];
        }
    },
    cancel: {
        name: 'cancel billing document',
        action: 'cancelBillingDocument',
        button: 'btnCancelInvoice',
        dataKey: 'cancelBillingDocument',
        // CDS return type service.cds:54-61
        respond: (body) => ({
            BillingDocument: body.BillingDocument,
            CancellationDocument: STUB_CANCEL_DOC,
            BillingDocumentIsCancelled: true,
            AccountingTransferStatus: '',
            Success: true,
            Message: 'DRY-RUN stub, nothing cancelled in SAP'
        }),
        async confirm(session) {
            await session.page.locator('[id$="--btnConfirmCancelInvoice"]').click();
            await session.settle();
        },
        stubDoc: STUB_CANCEL_DOC,
        resultDoc: (res) => res && res.CancellationDocument,
        async readBack(get, doc) {
            const inv = await get(`customer-invoice/CustomerInvoices('${encodeURIComponent(doc)}')`);
            return inv.BillingDocumentIsCancelled === true ? [] : [`read-back CustomerInvoices('${doc}'): BillingDocumentIsCancelled=${inv.BillingDocumentIsCancelled}`];
        }
    }
};

async function runCase(baseUrl, c, live, data) {
    const out = { name: c.name, errors: [], details: {} };
    const session = await openSession({ baseUrl, user: 'alice' });
    try {
        const calls = await rt.interceptAction(session.page, { flow: FLOW, service: SERVICE, action: c.action, live, respond: c.respond });
        await rt.openHash(session, HASH);
        if (live) {
            // The table pages 30 rows; the search field narrows it to the document under test
            await session.page.fill('[id$="--searchInvoices-I"]', data[c.dataKey]);
            await session.page.press('[id$="--searchInvoices-I"]', 'Enter');
            await session.settle();
        }
        const buttons = await rt.listButtons(session.page, c.button, 'customerInvoice');
        const pick = live ? buttons.find((b) => b.row.BillingDocument === data[c.dataKey]) : buttons[0];
        if (!pick) throw new Error(live ? `invoice ${data[c.dataKey]} has no enabled ${c.button} on the screen` : `no invoice row enables ${c.button}`);
        const doc = pick.row.BillingDocument;
        out.details.billingDocument = doc;
        await session.page.click(`[id="${pick.id}"]`);
        await session.settle();
        await c.confirm(session);
        const box = await rt.resultBox(session.page, live ? 180000 : 30000);
        out.details.ui = box;
        out.details.calls = calls;
        out.errors.push(...rt.checkCalls(calls, { BillingDocument: doc }, c.action));
        const res = (calls.find((x) => !x.mixed) || {}).result || {};
        const shownDoc = live ? c.resultDoc(res) : c.stubDoc;
        if (box.type !== 'success') out.errors.push(`UI showed ${box.type || 'no'} result: ${box.text}`);
        if (!box.text.includes(doc)) out.errors.push(`UI result does not name billing document ${doc}: ${box.text}`);
        if (shownDoc && !box.text.includes(shownDoc)) out.errors.push(`UI result does not show document ${shownDoc}: ${box.text}`);
        if (live) {
            out.details.readBack = 'VERIFIED';
            const rb = await c.readBack(rt.capGet(baseUrl), doc, res).catch((err) => [`read-back failed: ${err.message}`]);
            if (rb.length) out.details.readBack = 'FAIL';
            out.errors.push(...rb);
        } else {
            out.details.readBack = 'NOT VERIFIED (dry-run)';
        }
    } catch (err) {
        out.errors.push(`${err.name}: ${err.message.split('\n')[0]}`);
    } finally {
        out.errors.push(...rt.sessionErrors(session));
        await session.close();
    }
    return out;
}

async function roundTripCustomerInvoice(options = {}) {
    const baseUrl = (options.baseUrl || process.env.TARGET_URL || 'http://localhost:4004').replace(/\/+$/, '');
    let gate;
    try {
        gate = resolveMode(FLOW, options.gate);
    } catch (err) {
        console.log(`  [FAIL] ${err.message}`);
        return { status: 'FAIL', mode: 'blocked', errors: [err.message], details: {} };
    }
    const live = gate.mode === 'live';
    console.log(`\n=== Customer invoice release/cancel round trip — Tier C ${live ? 'LIVE SAP WRITE' : 'READ-ONLY dry-run (stubbed write actions)'} ===`);
    if (!(await rt.waitForHealth(baseUrl))) return { status: 'FAIL', mode: gate.mode, errors: [`server not healthy at ${baseUrl}`], details: {} };
    const cases = [];
    for (const c of Object.values(CASES)) cases.push(await runCase(baseUrl, c, live, gate.data));
    return rt.suiteResult('customer invoice round trip', gate.mode, cases);
}

if (require.main === module) {
    roundTripCustomerInvoice().then((r) => {
        console.log(JSON.stringify(r.details, null, 2));
        process.exit(r.status === 'PASS' ? 0 : 1);
    });
}

module.exports = { roundTripCustomerInvoice };
