'use strict';
/* global window */

/**
 * Quarantine Labels screen (wm/quarantine-labels), write guard on. The generateLabels action is MOCKED per case —
 * this proves the UI flow, never SAP rendering (the SAP wrapper Z_MM_QUAR_LABEL_PDF is not yet activated):
 * route opens without requests to SAP; invalid input is refused locally; a PDF answer shows the preview with
 * print/download; a 503 shows the "not available" warning; changing an input removes the preview. No case lets the
 * real action through: once the wrapper is active that would render in SAP (side effects not yet proven).
 */

const { openSession, openHash, inspectScreen } = require('../support/screenCheck');

const ACTION_RE = /\/odata\/v4\/quarantine-label\/(generateLabels|labelRows|listDocuments)$/;
const PDF_B64 = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF').toString('base64');
const json = (status, body) => ({ status, contentType: 'application/json;odata.metadata=minimal', headers: { 'OData-Version': '4.0' }, body: JSON.stringify(body) });

const open = (session) => openHash(session, 'wm/quarantine-labels');

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
        name: 'A PDF that is not the configured 4x6 size shows a warning but stays printable (mocked)',
        respond: (route) => route.fulfill(json(200, {
            MaterialDocument: '9900000001', MaterialDocumentYear: '2026', LabelCount: 1, FileName: 'QuarantineLabels_DEMO.pdf',
            LabelSize: '4x6', PageWidthPt: 595.28, PageHeightPt: 841.89, PageSizeOk: false, PdfBase64: PDF_B64
        })),
        run: async (s) => {
            await fill(s.page, '9900000001', '2026');
            await s.page.click('[id$="--qlPreview"]');
            await s.settle();
            const st = await state(s.page);
            const errs = [];
            if (st.messageType !== 'Warning') errs.push(`message type ${st.messageType}`);
            if (!/595\.28 x 841\.89 pt/.test(st.message) || !/4x6/.test(st.message)) errs.push(`message "${st.message}"`);
            if (!st.pdfShown || !st.actionsShown) errs.push('preview/print not shown with the size warning');
            return errs;
        }
    },
    {
        name: 'App-drawn 4x6 labels: SAP rows (mocked, DEMO) become a 288 x 432 pt PDF; Print sends an exact 4x6 page',
        respond: (route) => route.fulfill(/labelRows$/.test(route.request().url())
            ? json(200, {
                MaterialDocument: '9900000001', MaterialDocumentYear: '2026', LabelSize: null,
                Rows: [1, 2].map((n) => ({
                    Material: 'DEMO-MAT-1', MaterialDescription: 'DEMO MATERIAL', MaterialDocument: '9900000001', PostingDate: '2026-10-27', Batch: 'DEMO-BATCH-01',
                    SupplierBatch: 'DEMO-SB-01', SupplierName: 'DEMO SUPPLIER', BatchCharacteristics: 'DEMO-CHAR', ManufacturingDate: '2026-10-01',
                    DateKind: 'RETEST', DateValue: '2027-04-01', PostedQuantity: '120 KG', ContainerQuantity: '40', Unit: 'KG',
                    Container: `${n} OF 2`, StorageUnit: `0000000000990000000${n}`, Text: 'DEMO'
                }))
            })
            : json(500, { error: { message: 'unexpected SAP PDF call' } })),
        run: async (s, calls) => {
            await fill(s.page, '9900000001', '2026');
            await s.page.click('[id$="--ql4x6"]');
            await s.page.waitForFunction(() => {
                const E = window.sap.ui.require('sap/ui/core/Element');
                const v = E.registry.filter((c) => c.getId().endsWith('--qlPdfViewer'))[0];
                return v && /^blob:/.test(v.getSource());
            }, null, { timeout: 15000 });
            const st = await state(s.page);
            const pdf = await s.page.evaluate(async () => {
                const E = window.sap.ui.require('sap/ui/core/Element');
                const src = E.registry.filter((c) => c.getId().endsWith('--qlPdfViewer'))[0].getSource();
                const t = await (await fetch(src)).text();
                return { boxes: t.match(/\/MediaBox\s*\[[^\]]*\]/g) || [], head: t.slice(0, 5) };
            });
            // Print: the browser gets an HTML page sized exactly to the label (not the PDF fitted to the default paper)
            await s.page.evaluate(() => {
                window.__qlPrintDocs = [];
                new window.MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => {
                    if (n.tagName === 'IFRAME') window.__qlPrintDocs.push(n.srcdoc || n.src || '');
                }))).observe(window.document.body, { childList: true });
            });
            await s.page.click('[id$="--qlPrint"]');
            await s.page.waitForFunction(() => window.__qlPrintDocs.length > 0, null, { timeout: 5000 }).catch(() => {});
            const printed = await s.page.evaluate(() => window.__qlPrintDocs);
            const errs = [];
            if (printed.length !== 1) errs.push(`${printed.length} print frames`);
            else {
                if (!printed[0].includes('>alice</text>')) errs.push('signed-in Prepared by missing from print output');
                if (!printed[0].includes('Item Code') || !printed[0].includes('DEMO-MAT-1')) errs.push('Item Code missing from print output');
                if (!printed[0].includes('@page{size:288pt 432pt;margin:0}')) errs.push('print document not sized 288 x 432 pt with no margin');
                const svgs = printed[0].match(/<svg [^>]*width="288pt" height="432pt"/g) || [];
                if (svgs.length !== 2) errs.push(`${svgs.length} label pages in the print document`);
            }
            if (calls.length !== 1) errs.push(`action called ${calls.length} times`);
            if (st.messageType !== 'Success' || !/2 label/.test(st.message)) errs.push(`message ${st.messageType} "${st.message}"`);
            if (!st.pdfShown || !st.actionsShown) errs.push('PDF or print/download not shown');
            if (pdf.head !== '%PDF-') errs.push('not a PDF');
            if (pdf.boxes.length !== 2 || pdf.boxes.some((b) => !/\[0 0 288\.? 432\.?\]/.test(b))) errs.push(`MediaBox ${pdf.boxes.join(' ')}`);
            return errs;
        }
    },
    {
        name: 'Goods-receipt list (mocked, DEMO): Go lists documents, ticked rows download as one 4x6 PDF, a row prints at 4x6',
        respond: (route) => {
            const url = route.request().url();
            if (/listDocuments$/.test(url)) {
                return route.fulfill(json(200, { Plant: 'DM01', DateFrom: '2026-10-21', DateTo: '2026-10-27', More: false, Documents: [1, 2].map((n) => ({
                    MaterialDocument: `990000000${n}`, MaterialDocumentYear: '2026', PostingDate: '2026-10-2' + n, Plant: 'DM01',
                    Material: `DEMO-MAT-${n}`, MaterialDescription: `DEMO MATERIAL ${n}`, Batch: `DEMOB${n}`, SupplierName: 'DEMO SUPPLIER'
                })) }));
            }
            if (/labelRows$/.test(url)) {
                const doc = route.request().postDataJSON().MaterialDocument;
                return route.fulfill(json(200, { MaterialDocument: doc, MaterialDocumentYear: '2026', LabelSize: null, Rows: [1, 2].map((n) => ({
                    Material: 'DEMO-MAT-1', MaterialDescription: 'DEMO MATERIAL', MaterialDocument: doc, PostingDate: '2026-10-27', Batch: 'DEMOB1', SupplierBatch: 'DEMO-SB',
                    SupplierName: 'DEMO SUPPLIER', BatchCharacteristics: 'DEMO', ManufacturingDate: '2026-10-01', DateKind: 'EXPIRY', DateValue: '2027-04-01',
                    PostedQuantity: '80 KG', ContainerQuantity: '40', Unit: 'KG', Container: `${n} OF 2`, StorageUnit: `${doc}${n}`, Text: ''
                })) }));
            }
            return route.fulfill(json(500, { error: { message: 'unexpected SAP PDF call' } }));
        },
        run: async (s, calls) => {
            const errs = [];
            // Capture downloads (anchor clicks) and print frames instead of leaving the page
            await s.page.evaluate(() => {
                window.__qlSaved = [];
                window.__qlPrintDocs = [];
                const click = window.HTMLAnchorElement.prototype.click;
                window.HTMLAnchorElement.prototype.click = function () {
                    if (this.download) { window.__qlSaved.push({ name: this.download, href: this.href }); return undefined; }
                    return click.call(this);
                };
                new window.MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => {
                    if (n.tagName === 'IFRAME') window.__qlPrintDocs.push(n.srcdoc || '');
                }))).observe(window.document.body, { childList: true });
            });
            await s.page.fill('[id$="--qlListPlant-inner"]', 'DM01');
            await s.page.click('[id$="--qlListGo"]');
            await s.page.waitForFunction(() => {
                const E = window.sap.ui.require('sap/ui/core/Element');
                const t = E.registry.filter((c) => c.getId().endsWith('--qlDocTable'))[0];
                return t && t.getItems().length === 2;
            }, null, { timeout: 15000 });
            const list = calls.find((c) => c && c.Plant);
            if (!list || list.Plant !== 'DM01' || !/^\d{4}-\d{2}-\d{2}$/.test(list.DateFrom || '') || !list.DateTo) errs.push(`list request ${JSON.stringify(list)}`);

            await s.page.evaluate(() => {
                const E = window.sap.ui.require('sap/ui/core/Element');
                E.registry.filter((c) => c.getId().endsWith('--qlDocTable'))[0].selectAll(true);
            });
            await s.page.click('[id$="--qlDownloadSelected"]');
            await s.page.waitForFunction(() => window.__qlSaved.length > 0, null, { timeout: 15000 }).catch(() => {});
            const saved = await s.page.evaluate(async () => Promise.all(window.__qlSaved.map(async (f) => ({
                name: f.name, text: await (await fetch(f.href)).text()
            }))));
            if (saved.length !== 1) errs.push(`${saved.length} downloads`);
            else {
                if (saved[0].name !== 'QuarantineLabels4x6_DM01_2docs.pdf') errs.push(`file name ${saved[0].name}`);
                const boxes = saved[0].text.match(/\/MediaBox\s*\[[^\]]*\]/g) || [];
                if (boxes.length !== 4 || boxes.some((b) => !/\[0 0 288\.? 432\.?\]/.test(b))) errs.push(`combined PDF pages ${boxes.join(' ')}`);
            }
            const labelCalls = calls.filter((c) => c && c.MaterialDocument && !c.Plant).map((c) => c.MaterialDocument);
            if (labelCalls.join() !== '9900000001,9900000002') errs.push(`labelRows calls ${labelCalls.join()}`);

            await s.page.click('[id$="--qlDocTable"] tbody tr:first-child button[title="Print 4x6 labels"]');
            await s.page.waitForFunction(() => window.__qlPrintDocs.length > 0, null, { timeout: 15000 }).catch(() => {});
            const printed = await s.page.evaluate(() => window.__qlPrintDocs);
            if (printed.length !== 1 || !printed[0].includes('@page{size:288pt 432pt;margin:0}')) errs.push(`print frames ${printed.length}`);
            else {
                if ((printed[0].match(/<svg /g) || []).length !== 2) errs.push('row print is not 2 label pages');
                if (!printed[0].includes('>alice</text>') || !printed[0].includes('DEMO-MAT-1')) errs.push('row print missing material code or signed-in Prepared by');
            }
            const st = await state(s.page);
            if (st.messageType !== 'Success') errs.push(`message ${st.messageType} "${st.message}"`);
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
