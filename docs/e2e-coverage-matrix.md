# Business E2E Coverage Matrix

One row per UI5 route in `app/fiori-app/webapp/manifest.json`. `test/unit/tools/e2eCoverageMatrix.test.js` fails when a route is missing, a row names a route that no longer exists, a status is invalid, or a 🟢/🟡 row cites no existing E2E suite. Governance rule: `AGENTS.md` → *Change and test rules* → *Business E2E coverage*.

Statuses (updated 2026-10-26 ~15:25 IST from a READ-ONLY run of `npm run test:e2e` against the local server on :4004; no SAP write):

- **Browser E2E** — a Playwright suite under `test/e2e/` opens the route in a browser and checks: the router matched the route, a page title rendered, bound lists loaded without a load error, no error dialog/strip, no console errors, no HTTP >= 400, and no write request (Tier 0 write guard, `test/e2e/support/writeGuard.js`).
- **SAP round trip** — that suite performs the business action through the UI and reads the SAP result back (Browser → route → controller → CAP → S/4 → SAP result → UI). Requires a per-call written go.
- 🟢 suite exists and passed on the last recorded run · 🟡 partial or failing (say what) · 🔴 no E2E evidence · **N/A** not applicable (give the reason).

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
| `default` | *(empty)* | Shell · dashboard | `/odata/v4/purchase-order` | 🟢 | N/A | `test/e2e/shell/verifyShellScreens.e2e.js`. SAP N/A: dashboard metrics are read-only (`getDashboardMetrics` is a `function`). |
| `login` | `login` | Shell · login | — | 🟢 | N/A | `test/e2e/shell/verifyShellScreens.e2e.js` (signed-out browser); `test/e2e/negative/verifyNegativeUi.e2e.js` B1: signed-out deep link redirects here. SAP N/A: authentication only. |
| `dashboard` | `dashboard` | Shell · dashboard | `/odata/v4/purchase-order` | 🟢 | N/A | `test/e2e/shell/verifyShellScreens.e2e.js`. SAP N/A: read-only metrics. |
| `purchaseOrders` | `mm/purchase-orders` | MM · PO list + Ask AI | `/odata/v4/purchase-order`, `/odata/v4/ai` | 🟢 | 🔴 | `test/e2e/mm/verifyMmScreens.e2e.js`; `test/e2e/negative/verifyNegativeUi.e2e.js` B3: simulated list read failure shows the load-error text. Ask AI not exercised (guard blocks the AI stream). |
| `createPurchaseOrder` | `mm/purchase-orders/create` | MM · PO create | `/odata/v4/purchase-order` | 🟢 | 🔴 | `test/e2e/mm/verifyMmScreens.e2e.js`: passes since 15:26 IST fix of the Item Category / Account Assignment value-help text bindings (`PurgDocItemCategoryName`, `AcctAssignmentCategoryName`). `test/e2e/negative/verifyNegativeUi.e2e.js` B2: empty double submit shows validation, no write attempted. Item Category / Account Assignment value helps still list DE and EN rows (projection `where Language = 'EN'` not applied; cause UNKNOWN). No live PO create recorded. |
| `purchaseOrderDetail` | `mm/purchase-orders/{PurchaseOrder}` | MM · PO detail | `/odata/v4/purchase-order` | 🟢 | N/A | `test/e2e/mm/verifyMmScreens.e2e.js` (first list row). SAP N/A: read-only display; `PurchaseOrderDetail.controller.js` makes no service calls. |
| `salesInquiries` | `sd/sales-inquiries` | SD · inquiry list | `/odata/v4/sales-inquiry` | 🟢 | 🔴 | `test/e2e/sd/verifySdScreens.e2e.js`. |
| `createSalesInquiry` | `sd/sales-inquiries/create` | SD · inquiry create | `/odata/v4/sales-inquiry` | 🟢 | 🔴 | `test/e2e/sd/verifySdScreens.e2e.js`; `test/e2e/negative/verifyNegativeUi.e2e.js` B2: empty double submit shows validation, no write attempted. |
| `salesInquiryDetail` | `sd/sales-inquiries/{SalesInquiry}` | SD · inquiry detail | `/odata/v4/sales-inquiry` | 🟢 | 🔴 | `test/e2e/sd/verifySdScreens.e2e.js` (first list row). |
| `salesOrders` | `sd/sales-orders` | SD · order list | `/odata/v4/sales-order` | 🟢 | 🔴 | `test/e2e/sd/verifySdScreens.e2e.js`; `test/e2e/negative/verifyNegativeUi.e2e.js` B3: simulated list read failure shows the load-error text. |
| `createSalesOrder` | `sd/sales-orders/create` | SD · order create | `/odata/v4/sales-order` | 🟢 | 🔴 | `test/e2e/sd/verifySdScreens.e2e.js`; `test/e2e/negative/verifyNegativeUi.e2e.js` B2: empty double submit shows a validation message, no write attempted. |
| `wmGoodsReceipt` | `wm/goods-receipt` | WM · goods receipt list | `/odata/v4/goods-receipt` | 🟢 | 🔴 | `test/e2e/wm/verifyWmScreens.e2e.js`. |
| `wmGoodsReceiptDetail` | `wm/goods-receipt/{delivery}` | WM · goods receipt post | `/odata/v4/goods-receipt` | 🟢 | 🔴 | `test/e2e/wm/verifyWmScreens.e2e.js` (first open delivery). Posting not exercised. |
| `ordersDueForDelivery` | `le/orders-due` | LE · deliveries, PGI, billing | `/odata/v4/outbound-delivery` | 🟡 | 🔴 | `test/e2e/le/verifyLeScreens.e2e.js` FAILS for mock user `alice` (Admin, no `Plant` attribute): `OutboundDeliveryAdapter` fails closed ("No plant resolved") and the screen has no plant selector, so the worklist cannot load for such users; the 400 also surfaces as HTTP 500. The same screen passes for plant-scoped user `bob` (169 rows, 15:2x IST). Fix pending a decision on admin/no-plant behaviour. |
| `customerInvoices` | `sd/invoices` | SD · invoices | `/odata/v4/customer-invoice` | 🟢 | 🔴 | `test/e2e/sd/verifySdScreens.e2e.js`. Release/cancel actions not exercised. |
| `customerReturns` | `sd/returns` | SD · return list | `/odata/v4/customer-return` | 🟢 | 🔴 | `test/e2e/sd/verifySdScreens.e2e.js`. |
| `createCustomerReturn` | `sd/returns/create` | SD · return create | `/odata/v4/customer-return` | 🟢 | 🔴 | `test/e2e/sd/verifySdScreens.e2e.js`; `test/e2e/negative/verifyNegativeUi.e2e.js` B2: empty double submit shows the validation MessageBox, no write attempted. |
| `wmCycle261` | `wm/mvt261/open/{reservation}/{item}/cycle` | WM · mvt 261 cycle | `/odata/v4/mvt261` | 🟢 | 🔴 | `test/e2e/wm/verifyWmScreens.e2e.js` (first item from the read-only `openItems()` function). |
| `wmScan261` | `wm/mvt261/open/{reservation}/{item}` | WM · mvt 261 scan | `/odata/v4/mvt261` | 🟢 | 🔴 | `test/e2e/wm/verifyWmScreens.e2e.js` (first item from the read-only `openItems()` function). |
| `wmHandlingUnitDetail` | `wm/handling-unit/{hu}:?query:` | WM · HU detail | `/odata/v4/handling-unit` | 🟢 | 🔴 | `test/e2e/wm/verifyWmScreens.e2e.js` (first list row). |
| `wmHandlingUnits` | `wm/handling-unit` | WM · HU list | `/odata/v4/handling-unit` | 🟢 | 🔴 | `test/e2e/wm/verifyWmScreens.e2e.js`: passes since 15:26 IST fix of `OverflowToolbarLayoutData priority="Medium"` → `"Low"` (`HandlingUnits.view.xml:95`). |
| `wmPackingInstructionDetail` | `wm/packing-instruction/{systemUUID}` | WM · packing instruction detail | `/odata/v4/packing-instruction` | 🟢 | 🔴 | `test/e2e/wm/verifyWmScreens.e2e.js` (first list row). |
| `wmPackingInstructions` | `wm/packing-instruction` | WM · packing instruction list | `/odata/v4/packing-instruction` | 🟢 | 🔴 | `test/e2e/wm/verifyWmScreens.e2e.js`. |
| `wmReservationEntryList` | `wm/reservation-entry` | WM · reservation list | `/odata/v4/reservation-entry` | 🟢 | 🔴 | `test/e2e/wm/verifyWmScreens.e2e.js`. |
| `wmReservationEntryCreate` | `wm/reservation-entry/create` | WM · reservation create | `/odata/v4/reservation-entry` | 🟢 | 🔴 | `test/e2e/wm/verifyWmScreens.e2e.js`; `test/e2e/negative/verifyNegativeUi.e2e.js` B2; `test/e2e/wm/verifyHardeningUI.e2e.js`; `test/e2e/wm/verifyMvt201.e2e.js`, `test/e2e/wm/verifyMvt241.e2e.js`, `test/e2e/wm/verifyMvt261.e2e.js`, `test/e2e/wm/verifyMvt301.e2e.js`, `test/e2e/wm/verifyMvt311.e2e.js` (create page checks; `verifyMvt311` fixed 14:41 and passing). Nothing is submitted. |
| `wmReservationEntryDetail` | `wm/reservation-entry/{ReservationNo}/{ReservationItem}` | WM · reservation detail, mvt 201/241/261/301/311 | `/odata/v4/reservation-entry` | 🟢 | 🔴 | `test/e2e/wm/verifyWmScreens.e2e.js` (first list row); `test/e2e/wm/verifyMvt201.e2e.js`, `test/e2e/wm/verifyMvt241.e2e.js`, `test/e2e/wm/verifyMvt261.e2e.js`, `test/e2e/wm/verifyMvt301.e2e.js`, `test/e2e/wm/verifyMvt311.e2e.js`; `test/e2e/wm/verifyHardeningUI.e2e.js`: display of documents posted earlier plus `verifyMaterialDocument` read-back; no transaction run through the UI. Last live posting 2026-10-24 (WORKSTATUS.md). |
| `wmWarehouseScanTo` | `wm/scan-to` | WM · scan-to entry | `/odata/v4/tr-to` | 🟢 | 🔴 | `test/e2e/wm/verifyWmScreens.e2e.js`. |
| `wmWarehouseScanToDetailWithWh` | `wm/scan-to/{lgnum}/{docType}/{number}` | WM · scan-to detail (warehouse) | `/odata/v4/tr-to` | 🟢 | 🔴 | `test/e2e/wm/verifyWmScreens.e2e.js` (first open TR from the entry screen). |
| `wmWarehouseScanToDetail` | `wm/scan-to/{docType}/{number}` | WM · scan-to detail | `/odata/v4/tr-to` | 🟢 | 🔴 | `test/e2e/wm/verifyMvt201.e2e.js`, `test/e2e/wm/verifyMvt241.e2e.js`, `test/e2e/wm/verifyMvt261.e2e.js`, `test/e2e/wm/verifyMvt301.e2e.js`, `test/e2e/wm/verifyMvt311.e2e.js` open existing TRs and check display; no TO is created or confirmed through the UI. |
| `wmHuStockTransfer` | `wm/hu-stock-transfer` | WM · HU stock transfer list | `/odata/v4/hu-stock-transfer` | 🟢 | 🔴 | `test/e2e/wm/verifyWmScreens.e2e.js`. Never proven live (WORKSTATUS.md). |
| `wmHuStockTransferRackDemo` | `wm/hu-stock-transfer/demo-rack` | WM · rack demo | — | 🟢 | N/A | `test/e2e/wm/verifyWmScreens.e2e.js`. SAP N/A: demo visualization; `HuStockTransferRackDemo.controller.js` makes no service calls. |
| `wmHuStockTransferRack` | `wm/hu-stock-transfer/{reservation}/{item}/rack` | WM · HU rack selection | `/odata/v4/hu-stock-transfer` | 🟢 | 🔴 | `test/e2e/wm/verifyWmScreens.e2e.js` (first list row opens the rack by design). |
| `wmHuStockTransferDetail` | `wm/hu-stock-transfer/{reservation}/{item}` | WM · HU stock transfer post | `/odata/v4/hu-stock-transfer` | 🟢 | 🔴 | `test/e2e/wm/verifyWmScreens.e2e.js` (same reservation as the rack step). Posting not exercised. |

Totals: Browser E2E 🟢 32 / 🟡 1 / 🔴 0. SAP round trip: 0 🟢, 28 🔴, 5 N/A.

## Negative E2E cases

Covered (`test/e2e/negative/verifyNegativeUi.e2e.js`, write guard on): signed-out deep link → login (B1); empty-form double submit on all five create screens shows validation and attempts no write (B2); simulated list read failure (mocked HTTP 500, not SAP) shows the load-error text without a crash (B3).

Still required for SAP write flows when their round-trip suites are added: unauthorized role (no UI role gating found; server-side only), SAP 4xx/5xx from real SAP surfaced in the UI, timeout/backend failure during submit, stale data, reload/navigation during submit, and session expiry mid-session.

## Running

`npm run test:e2e` runs every Playwright suite (`node test/e2e/runAllE2E.js`) against a running server (`npm start`); it is not part of CI, which has no SAP connectivity. Tier A/B suites read SAP data through CAP (READ-ONLY) behind the write guard. Live SAP writes still require the user's written go per call (`AGENTS.md`).
