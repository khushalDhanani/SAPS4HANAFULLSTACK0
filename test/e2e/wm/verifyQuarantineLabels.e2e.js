'use strict';
/* global window */

/**
 * Quarantine Labels screen (wm/quarantine-labels), write guard on. The generateLabels action is MOCKED per case —
 * this proves the UI flow, never SAP rendering (the SAP wrapper Z_MM_QUAR_LABEL_PDF is not yet activated):
 * route opens without requests to SAP; invalid input is refused locally; a PDF answer shows the preview with
 * print/download; a 503 shows the "not available" warning; changing an input removes the preview. No case lets the
 * real action through: once the wrapper is active that would render in SAP (side effects not yet proven).
 */

const { openSession, inspectScreen } = require('../support/screenCheck');

const ACTION_RE = /\/odata\/v4\/quarantine-label\/generateLabels$/;
const PDF_B64 = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF').toString('base64');
const json = (status, body) => ({ status, contentType: 'application/json;odata.metadata=minimal', headers: { 'OData-Version': '4.0' }, body: JSON.stringify(body) });

async function open(session) {
    await session.page.goto(`${session.baseUrl}/fiori-app/webapp/index.html#/wm/quarantine-labels`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await session.page.waitForFunction(() => window.sap && window.sap.ui && window.sap.ui.require('sap/ui/core/Component'), null, { timeout: 30000 });
    await session.settle();
}

function state(page) {
    return page.evaluate(() => {
        const E = window.sap.ui.require('sap/ui/core/Element');
        const byId = (id) => E.registry.filter((c) => c.getId().endsWith('--' + id))[0];
        const strip = byId('qlMessage');
        const viewer = byId('qlPdfViewer');
        return {
            message: strip && strip.getVisible() ? strip.getText() : '',
            messageType: strip ? strip.getType() : '',
            pdfShown: !!viewer && viewer.getVisible() && /^blob:/.test(viewer.getSource()),
            actionsShown: !!byId('qlActions') && byId('qlActions').getVisible(),
            docState: byId('qlDoc').getValueState()
        };
    });
}

async function fill(page, doc, year) {
    for (const [id, v] of [['qlDoc', doc], ['qlYear', year]]) {
        await page.fill(`[id$="--${id}-inner"]`, v);
    }
}

const CASES = [
    {
        name: 'Route opens with the form and sends no request to the label action',
        run: async (s, calls) => {
            const screen = await inspectScreen(s.page);
            const errs = [];
            if (screen.route !== 'wmQuarantineLabels') errs.push(`route ${screen.route}`);
            if (!screen.title) errs.push('no page title');
            if (calls.length) errs.push('label action called on open');
            return errs;
        }
    },
    {
        name: 'Invalid input is refused locally',
        respond: (route) => route.fulfill(json(200, {})),
        run: async (s, calls) => {
            await fill(s.page, 'abc', '26');
            await s.page.click('[id$="--qlPreview"]');
            await s.settle();
            const st = await state(s.page);
            const errs = [];
            if (calls.length) errs.push('request sent for invalid input');
            if (st.docState !== 'Error') errs.push('material document not flagged');
            return errs;
        }
    },
    {
        name: 'A PDF answer shows the preview with print and download (mocked)',
        respond: (route) => route.fulfill(json(200, { MaterialDocument: '4900050304', MaterialDocumentYear: '2026', LabelCount: 2, FileName: 'QuarantineLabels_4900050304_2026.pdf', PdfBase64: PDF_B64 })),
        run: async (s, calls) => {
            await fill(s.page, '4900050304', '2026');
            await s.page.click('[id$="--qlPreview"]');
            await s.settle();
            const st = await state(s.page);
            const errs = [];
            if (calls.length !== 1) errs.push(`action called ${calls.length} times`);
            if (calls[0] && (calls[0].MaterialDocument !== '4900050304' || calls[0].MaterialDocumentYear !== '2026')) errs.push(`payload ${JSON.stringify(calls[0])}`);
            if (!st.pdfShown) errs.push('PDF preview not shown');
            if (!st.actionsShown) errs.push('print/download not shown');
            if (!/2 label/.test(st.message)) errs.push(`message "${st.message}"`);
            // Changing an input must remove the preview
            await s.page.fill('[id$="--qlYear-inner"]', '2025');
            await s.settle();
            const after = await state(s.page);
            if (after.pdfShown) errs.push('stale preview still shown after the year changed');
            return errs;
        }
    },
    {
        name: 'SAP interface not available (503) is shown as a warning (mocked)',
        respond: (route) => route.fulfill(json(503, { error: { code: '503', message: 'Quarantine labels are not available yet: the SAP interface Z_MM_QUAR_LABEL_PDF is not installed on this system.' } })),
        run: async (s) => {
            await fill(s.page, '4900050304', '2026');
            await s.page.click('[id$="--qlPreview"]');
            await s.settle();
            const st = await state(s.page);
            const errs = [];
            if (!/not available yet/.test(st.message)) errs.push(`message "${st.message}"`);
            if (st.messageType !== 'Warning') errs.push(`message type ${st.messageType}`);
            if (st.pdfShown) errs.push('preview shown despite the error');
            return errs;
        }
    }
];

async function verifyQuarantineLabels(options = {}) {
    const baseUrl = (options.baseUrl || process.env.TARGET_URL || 'http://localhost:4004').replace(/\/+$/, '');
    console.log('\n=== Quarantine Labels screen (write guard on; label action mocked in every case) ===');
    const errors = [];
    const details = [];
    for (const c of CASES) {
        const s = await openSession({ baseUrl });
        const calls = [];
        let errs;
        try {
            await s.page.route((url) => ACTION_RE.test(url.pathname), (route) => {
                calls.push(route.request().postDataJSON());
                return (c.respond || ((r) => r.fulfill(json(200, {}))))(route);
            });
            await open(s);
            errs = await c.run(s, calls);
            const expected = /503/.test(c.name) ? [ACTION_RE] : [];
            s.networkErrors.filter((e) => !expected.some((re) => re.test(new URL(e.url).pathname))).forEach((e) => errs.push(`HTTP ${e.status} ${e.url}`));
            s.consoleErrors.filter((e) => e.startsWith('PAGEERROR')).forEach((e) => errs.push(e));
            s.blocked.forEach((b) => errs.push(`write guard blocked ${b.reason}`));
        } catch (err) {
            errs = [`${err.name}: ${err.message.split('\n')[0]}`];
        } finally {
            await s.close();
        }
        console.log(`  [${errs.length ? 'FAIL' : 'PASS'}] ${c.name}`);
        errs.forEach((e) => console.log(`      - ${e}`));
        details.push({ case: c.name, status: errs.length ? 'FAIL' : 'PASS', errors: errs });
        errs.forEach((e) => errors.push(`${c.name}: ${e}`));
    }
    return { status: errors.length ? 'FAIL' : 'PASS', errors, details };
}

if (require.main === module) {
    verifyQuarantineLabels().then((r) => process.exit(r.status === 'PASS' ? 0 : 1));
}

module.exports = { verifyQuarantineLabels };
