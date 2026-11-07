'use strict';
/* global window */

/**
 * Material Issued Batch Sticker screen (wm/mib-label), write guard on.
 * The generateMibSticker and readMibStickerData actions are MOCKED per case:
 * - Route opens without requests to SAP;
 * - Invalid input is refused locally;
 * - A successful PDF answer shows the preview with print/download;
 * - A 503 shows the "not available" warning and sticker items;
 * - Changing an input removes the preview.
 */

const { openSession, openHash, inspectScreen } = require('../support/screenCheck');

const ACTION_RE = /\/odata\/v4\/mib-label\/(generateMibSticker|readMibStickerData)$/;
const PDF_B64 = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF').toString('base64');
const json = (status, body) => ({
  status,
  contentType: 'application/json;odata.metadata=minimal',
  headers: { 'OData-Version': '4.0' },
  body: JSON.stringify(body)
});

const open = (session) => openHash(session, 'wm/mib-label');

function state(page) {
  return page.evaluate(() => {
    const E = window.sap.ui.require('sap/ui/core/Element');
    const byId = (id) => E.registry.filter((c) => c.getId().endsWith('--' + id))[0];
    const strip = byId('mibMessageStrip');
    const viewer = byId('mibPdfViewer');
    const printBtn = byId('mibPrintBtn');
    const downloadBtn = byId('mibDownloadBtn');
    const dataTable = byId('mibDataTable');
    return {
      message: strip && strip.getVisible() ? strip.getText() : '',
      messageType: strip ? strip.getType() : '',
      pdfShown: !!viewer && viewer.getVisible() && /^blob:/.test(viewer.getSource()),
      printEnabled: printBtn ? printBtn.getEnabled() : false,
      downloadEnabled: downloadBtn ? downloadBtn.getEnabled() : false,
      rowCount: dataTable ? dataTable.getItems().length : 0,
      warehouseState: byId('mibWarehouseInput').getValueState(),
      toState: byId('mibTransferOrderInput').getValueState(),
      variant: byId('mibVariantSelect') ? byId('mibVariantSelect').getSelectedKey() : ''
    };
  });
}

async function fill(page, warehouse, to) {
  if (warehouse !== undefined) {
    await page.fill('[id$="--mibWarehouseInput-inner"]', warehouse);
  }
  if (to !== undefined) {
    await page.fill('[id$="--mibTransferOrderInput-inner"]', to);
  }
}

const CASES = [
  {
    name: 'Route opens with the form and sends no request to the label action',
    run: async (s, calls) => {
      const screen = await inspectScreen(s.page);
      const errs = [];
      if (screen.route !== 'wmMibLabel') errs.push(`route ${screen.route}`);
      if (!screen.title) errs.push('no page title');
      if (calls.length) errs.push('label action called on open');
      return errs;
    }
  },
  {
    name: 'Invalid input is refused locally',
    respond: (route) => route.fulfill(json(200, {})),
    run: async (s, calls) => {
      await fill(s.page, '@@', 'abc');
      await s.page.click('[id$="--mibPreviewBtn"]');
      await s.settle();
      const st = await state(s.page);
      const errs = [];
      if (st.warehouseState !== 'Error') errs.push('warehouse not marked error');
      if (st.toState !== 'Error') errs.push('TO not marked error');
      if (calls.length) errs.push('action called despite invalid input');
      return errs;
    }
  },
  {
    name: 'Successful PDF returns and displays preview with print and download enabled',
    respond: (route) => {
      const url = route.request().url();
      if (url.includes('generateMibSticker')) {
        return route.fulfill(json(200, {
          WarehouseNumber: 'W01',
          TransferOrderNumber: '0001037246',
          LabelCount: 1,
          FileName: 'MIB-Sticker-W01-0001037246.pdf',
          PdfBase64: PDF_B64
        }));
      }
      if (url.includes('readMibStickerData')) {
        return route.fulfill(json(200, {
          value: [{
            Material: 'MAT-001',
            MaterialDescription: 'Raw Material 1',
            Batch: 'BATCH-01',
            TransferOrder: '0001037246',
            TransferRequirement: '100',
            RequirementNumber: '200',
            TransferDate: '2026-10-23',
            QuantityWithUom: '10 KG',
            StorageUnit: 'SU-1',
            WeightedBy: 'USER1',
            CheckedBy: 'USER2'
          }]
        }));
      }
      return route.fulfill(json(200, {}));
    },
    run: async (s, calls) => {
      await fill(s.page, 'W01', '1037246');
      await s.page.click('[id$="--mibPreviewBtn"]');
      await s.settle();
      const st = await state(s.page);
      const errs = [];
      if (!st.pdfShown) errs.push('PDF not shown in viewer');
      if (!st.printEnabled) errs.push('print button not enabled');
      if (!st.downloadEnabled) errs.push('download button not enabled');
      if (!calls.some((c) => c && c.TransferOrderNumber === '1037246')) errs.push('generateMibSticker was not called');
      return errs;
    }
  },
  {
    name: '503 error shows informative warning and falls back to sticker data inspection',
    respond: (route) => {
      const url = route.request().url();
      if (url.includes('generateMibSticker')) {
        return route.fulfill(json(503, {
          error: { code: '503', message: 'Material Issued Batch Sticker PDF is not available yet: the SAP interface Z_MM_MIB_LABEL_PDF is not installed on this system.' }
        }));
      }
      if (url.includes('readMibStickerData')) {
        return route.fulfill(json(200, {
          value: [{
            Material: 'MAT-001',
            MaterialDescription: 'Raw Material 1',
            Batch: 'BATCH-01',
            TransferOrder: '0001037246',
            TransferRequirement: '100',
            RequirementNumber: '200',
            TransferDate: '2026-10-23',
            QuantityWithUom: '10 KG',
            StorageUnit: 'SU-1',
            WeightedBy: 'USER1',
            CheckedBy: 'USER2'
          }]
        }));
      }
      return route.fulfill(json(200, {}));
    },
    run: async (s) => {
      await fill(s.page, 'W01', '1037246');
      await s.page.click('[id$="--mibPreviewBtn"]');
      await s.settle();
      await s.page.waitForFunction(() => {
        const E = window.sap.ui.require('sap/ui/core/Element');
        const v = E && E.registry && E.registry.filter((c) => c.getId().endsWith('--mibPdfViewer'))[0];
        return v && v.getVisible() && /^blob:/.test(v.getSource());
      }, { timeout: 10000 });
      const st = await state(s.page);
      const errs = [];
      if (!st.message.includes('Z_MM_MIB_LABEL_PDF')) errs.push(`message unexpected: ${st.message}`);
      if (st.messageType !== 'Warning') errs.push(`message type was ${st.messageType}, expected Warning`);
      if (st.rowCount !== 1) errs.push(`row count was ${st.rowCount}, expected 1`);
      if (!st.pdfShown) errs.push('fallback PDF not shown');
      if (!st.printEnabled) errs.push('print button not enabled on fallback');
      if (!st.downloadEnabled) errs.push('download button not enabled on fallback');
      return errs;
    }
  },
  {
    name: 'Changing an input removes the preview',
    respond: (route) => {
      const url = route.request().url();
      if (url.includes('generateMibSticker')) {
        return route.fulfill(json(200, {
          WarehouseNumber: 'W01',
          TransferOrderNumber: '0001037246',
          LabelCount: 1,
          FileName: 'MIB-Sticker-W01-0001037246.pdf',
          PdfBase64: PDF_B64
        }));
      }
      return route.fulfill(json(200, { value: [] }));
    },
    run: async (s) => {
      await fill(s.page, 'W01', '1037246');
      await s.page.click('[id$="--mibPreviewBtn"]');
      await s.settle();
      await fill(s.page, 'W02');
      await s.settle();
      const st = await state(s.page);
      return st.pdfShown ? ['preview still visible after input change'] : [];
    }
  },
  {
    name: '503 fallback: Vertical sticker variant option can be selected and switches layout',
    respond: (route) => {
      const url = route.request().url();
      if (url.includes('generateMibSticker')) {
        return route.fulfill(json(503, {
          error: { code: '503', message: 'Z_MM_MIB_LABEL_PDF not installed' }
        }));
      }
      if (url.includes('readMibStickerData')) {
        return route.fulfill(json(200, {
          value: [{
            Material: 'MAT-001',
            MaterialDescription: 'Raw Material 1',
            Batch: 'BATCH-01',
            TransferOrder: '0001037246',
            TransferRequirement: '100',
            RequirementNumber: '200',
            TransferDate: '2026-10-23',
            QuantityWithUom: '10 KG',
            StorageUnit: 'SU-1',
            WeightedBy: 'USER1',
            CheckedBy: 'USER2'
          }]
        }));
      }
      return route.fulfill(json(200, {}));
    },
    run: async (s) => {
      await fill(s.page, 'W01', '1037246');
      await s.page.click('[id$="--mibPreviewBtn"]');
      await s.settle();
      const stInitial = await state(s.page);
      const errs = [];
      if (stInitial.variant !== 'standard') errs.push(`initial variant ${stInitial.variant}, expected standard`);
      await s.page.click('[id$="--mibVariantSelect"] .sapMSegBBtn:nth-child(2)');
      await s.settle();
      const stVertical = await state(s.page);
      if (stVertical.variant !== 'vertical') errs.push(`switched variant ${stVertical.variant}, expected vertical`);
      if (!stVertical.pdfShown) errs.push('PDF preview not shown after switching to vertical');
      return errs;
    }
  }
];

async function verifyMibLabels(options = {}) {
  const baseUrl = (options.baseUrl || process.env.TARGET_URL || 'http://localhost:4004').replace(/\/+$/, '');
  console.log('\n=== MIB Labels screen (write guard on; label action mocked in every case) ===');
  const errors = [];
  const details = [];

  for (const c of CASES) {
    const s = await openSession({ baseUrl });
    const calls = [];
    let errs;
    try {
      await s.page.route((url) => ACTION_RE.test(url.pathname), (route) => {
        try {
          calls.push(route.request().postDataJSON());
        } catch {
          calls.push({});
        }
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
  verifyMibLabels().then((r) => process.exit(r.status === 'PASS' ? 0 : 1));
}

module.exports = { verifyMibLabels };
