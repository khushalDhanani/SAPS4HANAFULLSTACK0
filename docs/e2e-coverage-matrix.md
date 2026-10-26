# Business E2E Coverage Matrix

One row per UI5 route in `app/fiori-app/webapp/manifest.json`. `test/unit/tools/e2eCoverageMatrix.test.js` fails when a route is missing, a row names a route that no longer exists, a status is invalid, or a 🟢/🟡 row cites no existing E2E suite. Governance rule: `AGENTS.md` → *Change and test rules* → *Business E2E coverage*.

Statuses (reviewed 2026-10-26 from repository evidence only):

- **Browser E2E** — a Playwright suite under `test/e2e/` opens the route in a browser.
- **SAP round trip** — that suite performs the business action through the UI and reads the SAP result back (Browser → route → controller → CAP → S/4 → SAP result → UI).
- 🟢 covered · 🟡 partial (say what is missing) · 🔴 no E2E evidence found · **N/A** not applicable (give the reason).

A 🔴 means no E2E evidence was found in the repository, not that the feature has no unit or integration tests.

## CAP services and declared write actions

From each `srv/**/service.cds`; which screen calls which action is **Not verified** per route.

| CAP service | Declared actions |
| --- | --- |
| `/odata/v4/purchase-order` | `createPurchaseOrder` (plus functions) |
| `/odata/v4/ai` | `askAI`, `chat` |
| `/odata/v4/sales-inquiry` | `createSalesInquiry` |
| `/odata/v4/sales-order` | `createSalesOrder`, `checkATP` |
| `/odata/v4/outbound-delivery` | `createOutboundDelivery`, `postGoodsIssue`, `createBillingDocument`, `createDeliveryWithoutRef` |
| `/odata/v4/customer-invoice` | `releaseInvoiceToAccounting`, `cancelBillingDocument` |
| `/odata/v4/customer-return` | `createCustomerReturn` |
| `/odata/v4/goods-receipt` | `postGoodsReceipt`, `postGoodsReceiptWithStorageUnit` |
| `/odata/v4/reservation-entry` | `createReservation`, `createTransferRequirement`, `createTOFromTR`, `confirmTransferOrder`, `createReservationEntry`, `postMigoGoodsMovement`, `retryStep`, `executeReservationWarehouseFlow`, `verify*` |
| `/odata/v4/tr-to` | `createTOFromTR`, `postMigoGoodsMovement`, `executeReservationWarehouseFlow`, `verify*` |
| `/odata/v4/mvt261` | `postGoodsIssue`, `reverse` |
| `/odata/v4/hu-stock-transfer` | `validateHuStockTransferSelection`, `executeHuStockTransfer`, `executeHuStockTransferSelection` |
| `/odata/v4/handling-unit` | `labels`, `create`, `pack`, `unpack`, `remove` |
| `/odata/v4/packing-instruction` | `create` |

## Route coverage

| Route | Pattern | Module · flow | CAP service | Browser E2E | SAP round trip | Evidence / notes |
| --- | --- | --- | --- | --- | --- | --- |
| `default` | *(empty)* | Shell · dashboard | `/odata/v4/purchase-order` | 🔴 | N/A | Dashboard metrics are read-only (`getDashboardMetrics` function); no SAP write. |
| `login` | `login` | Shell · login | — | 🔴 | N/A | Authentication only; no SAP transaction. Playwright suites log in but assert nothing about this screen. |
| `dashboard` | `dashboard` | Shell · dashboard | `/odata/v4/purchase-order` | 🔴 | N/A | Same view as `default`; read-only metrics. |
| `purchaseOrders` | `mm/purchase-orders` | MM · PO list + Ask AI | `/odata/v4/purchase-order`, `/odata/v4/ai` | 🔴 | 🔴 | |
| `createPurchaseOrder` | `mm/purchase-orders/create` | MM · PO create | `/odata/v4/purchase-order` | 🔴 | 🔴 | `test/integration/purchase-order/createPurchaseOrderFlow.test.js` is a mocked CAP test, not E2E. No live PO create recorded. |
| `purchaseOrderDetail` | `mm/purchase-orders/{PurchaseOrder}` | MM · PO detail | `/odata/v4/purchase-order` | 🔴 | N/A | Read-only display; `PurchaseOrderDetail.controller.js` makes no service calls. |
| `salesInquiries` | `sd/sales-inquiries` | SD · inquiry list | `/odata/v4/sales-inquiry` | 🔴 | 🔴 | |
| `createSalesInquiry` | `sd/sales-inquiries/create` | SD · inquiry create | `/odata/v4/sales-inquiry` | 🔴 | 🔴 | |
| `salesInquiryDetail` | `sd/sales-inquiries/{SalesInquiry}` | SD · inquiry detail | `/odata/v4/sales-inquiry` | 🔴 | 🔴 | |
| `salesOrders` | `sd/sales-orders` | SD · order list | `/odata/v4/sales-order` | 🔴 | 🔴 | |
| `createSalesOrder` | `sd/sales-orders/create` | SD · order create | `/odata/v4/sales-order` | 🔴 | 🔴 | |
| `wmGoodsReceipt` | `wm/goods-receipt` | WM · goods receipt list | `/odata/v4/goods-receipt` | 🔴 | 🔴 | |
| `wmGoodsReceiptDetail` | `wm/goods-receipt/{delivery}` | WM · goods receipt post | `/odata/v4/goods-receipt` | 🔴 | 🔴 | |
| `ordersDueForDelivery` | `le/orders-due` | LE · deliveries, PGI, billing | `/odata/v4/outbound-delivery` | 🔴 | 🔴 | |
| `customerInvoices` | `sd/invoices` | SD · invoices | `/odata/v4/customer-invoice` | 🔴 | 🔴 | Release/cancel actions exist. |
| `customerReturns` | `sd/returns` | SD · return list | `/odata/v4/customer-return` | 🔴 | 🔴 | |
| `createCustomerReturn` | `sd/returns/create` | SD · return create | `/odata/v4/customer-return` | 🔴 | 🔴 | |
| `wmCycle261` | `wm/mvt261/open/{reservation}/{item}/cycle` | WM · mvt 261 cycle | `/odata/v4/mvt261` | 🔴 | 🔴 | |
| `wmScan261` | `wm/mvt261/open/{reservation}/{item}` | WM · mvt 261 scan | `/odata/v4/mvt261` | 🔴 | 🔴 | |
| `wmHandlingUnitDetail` | `wm/handling-unit/{hu}:?query:` | WM · HU detail | `/odata/v4/handling-unit` | 🔴 | 🔴 | |
| `wmHandlingUnits` | `wm/handling-unit` | WM · HU list | `/odata/v4/handling-unit` | 🔴 | 🔴 | |
| `wmPackingInstructionDetail` | `wm/packing-instruction/{systemUUID}` | WM · packing instruction detail | `/odata/v4/packing-instruction` | 🔴 | 🔴 | |
| `wmPackingInstructions` | `wm/packing-instruction` | WM · packing instruction list | `/odata/v4/packing-instruction` | 🔴 | 🔴 | |
| `wmReservationEntryList` | `wm/reservation-entry` | WM · reservation list | `/odata/v4/reservation-entry` | 🔴 | 🔴 | |
| `wmReservationEntryCreate` | `wm/reservation-entry/create` | WM · reservation create | `/odata/v4/reservation-entry` | 🟡 | 🔴 | `test/e2e/wm/verifyHardeningUI.e2e.js` (empty-form double Save; validation message only logged), `test/e2e/wm/verifyMvt241.e2e.js` and siblings (page loads, movement select present). Nothing is submitted. Run 2026-10-26 14:3x IST: `test/e2e/wm/verifyMvt311.e2e.js` FAILED ("Receiving SLoc input not found on create page"; stale test: it relied on the old default movement 311 removed in `feff094`); the other five suites passed. Suite fixed 2026-10-26 14:41 IST to select 311 and assert Receiving SLoc hidden before / visible after; not yet re-run. |
| `wmReservationEntryDetail` | `wm/reservation-entry/{ReservationNo}/{ReservationItem}` | WM · reservation detail, mvt 201/241/261/301/311 | `/odata/v4/reservation-entry` | 🟡 | 🔴 | `test/e2e/wm/verifyMvt201.e2e.js`, `test/e2e/wm/verifyMvt241.e2e.js`, `test/e2e/wm/verifyMvt261.e2e.js`, `test/e2e/wm/verifyMvt301.e2e.js`, `test/e2e/wm/verifyMvt311.e2e.js`, `test/e2e/wm/verifyHardeningUI.e2e.js`: display of documents posted earlier (fixed reservations/material documents) plus `verifyMaterialDocument` read-back; no transaction is run through the UI. Last live posting 2026-10-24 (WORKSTATUS.md). |
| `wmWarehouseScanTo` | `wm/scan-to` | WM · scan-to entry | `/odata/v4/tr-to` | 🔴 | 🔴 | |
| `wmWarehouseScanToDetailWithWh` | `wm/scan-to/{lgnum}/{docType}/{number}` | WM · scan-to detail (warehouse) | `/odata/v4/tr-to` | 🔴 | 🔴 | |
| `wmWarehouseScanToDetail` | `wm/scan-to/{docType}/{number}` | WM · scan-to detail | `/odata/v4/tr-to` | 🟡 | 🔴 | `test/e2e/wm/verifyMvt201.e2e.js` and siblings open existing TRs (`#/wm/scan-to/TR/...`) and check display; no TO is created or confirmed through the UI. |
| `wmHuStockTransfer` | `wm/hu-stock-transfer` | WM · HU stock transfer list | `/odata/v4/hu-stock-transfer` | 🔴 | 🔴 | Never proven live (WORKSTATUS.md). |
| `wmHuStockTransferRackDemo` | `wm/hu-stock-transfer/demo-rack` | WM · rack demo | — | 🔴 | N/A | Demo visualization route; `HuStockTransferRackDemo.controller.js` makes no service calls. |
| `wmHuStockTransferRack` | `wm/hu-stock-transfer/{reservation}/{item}/rack` | WM · HU rack selection | `/odata/v4/hu-stock-transfer` | 🔴 | 🔴 | |
| `wmHuStockTransferDetail` | `wm/hu-stock-transfer/{reservation}/{item}` | WM · HU stock transfer post | `/odata/v4/hu-stock-transfer` | 🔴 | 🔴 | |

## Required negative E2E cases for SAP write flows

When a write flow gets its E2E suite, it also covers, where applicable: unauthorized user, invalid input, missing mandatory SAP data, SAP 4xx/5xx surfaced in the UI, duplicate submission, timeout/backend failure, stale data, reload/navigation during submit, and session expiry.

## Running

`npm run test:e2e` runs the Playwright suites (`node test/e2e/runAllE2E.js`) against a running server (`npm start`); it is not part of CI, which has no SAP connectivity. Live SAP writes still require the user's written go per call (`AGENTS.md`).
