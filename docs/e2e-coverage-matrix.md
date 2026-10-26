# Business E2E Coverage Matrix

One row per UI5 route in `app/fiori-app/webapp/manifest.json`. `test/unit/tools/e2eCoverageMatrix.test.js` fails when a route is missing, a row names a route that no longer exists, a status is invalid, or a 🟢/🟡 row cites no existing E2E suite. Governance rule: `AGENTS.md` → *Change and test rules* → *Business E2E coverage*.

Statuses (updated 2026-10-26 ~15:40 IST from a READ-ONLY run of `npm run test:e2e` against the local server on :4004; no SAP write):

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
| `purchaseOrders` | `mm/purchase-orders` | MM · PO list + Ask AI | `/odata/v4/purchase-order`, `/odata/v4/ai` | 🟢 | N/A | `test/e2e/mm/verifyMmScreens.e2e.js`; `test/e2e/negative/verifyNegativeUi.e2e.js` B3: simulated list read failure shows the load-error text. Ask AI not exercised (guard blocks the AI stream). SAP N/A: no SAP write on this route: its only POST is the AI chat (`/odata/v4/ai/chat`); create is `createPurchaseOrder`. |
| `createPurchaseOrder` | `mm/purchase-orders/create` | MM · PO create | `/odata/v4/purchase-order` | 🟢 | 🔴 | `test/e2e/mm/verifyMmScreens.e2e.js`: passes since 15:26 IST fix of the Item Category / Account Assignment value-help text bindings (`PurgDocItemCategoryName`, `AcctAssignmentCategoryName`). `test/e2e/negative/verifyNegativeUi.e2e.js` B2: empty double submit shows validation, no write attempted. Item Category / Account Assignment value helps still list DE and EN rows (projection `where Language = 'EN'` not applied; cause UNKNOWN). No live PO create recorded. Tier C: `test/e2e/mm/roundTripPurchaseOrder.e2e.js` — dry-run PASS; live run pending written go (no SAP persistence proven). |
| `purchaseOrderDetail` | `mm/purchase-orders/{PurchaseOrder}` | MM · PO detail | `/odata/v4/purchase-order` | 🟢 | N/A | `test/e2e/mm/verifyMmScreens.e2e.js` (first list row). SAP N/A: read-only display; `PurchaseOrderDetail.controller.js` makes no service calls. |
| `salesInquiries` | `sd/sales-inquiries` | SD · inquiry list | `/odata/v4/sales-inquiry` | 🟢 | N/A | `test/e2e/sd/verifySdScreens.e2e.js`. SAP N/A: `SalesInquiries.controller.js` makes no write calls. |
| `createSalesInquiry` | `sd/sales-inquiries/create` | SD · inquiry create | `/odata/v4/sales-inquiry` | 🟢 | 🔴 | `test/e2e/sd/verifySdScreens.e2e.js`; `test/e2e/negative/verifyNegativeUi.e2e.js` B2: empty double submit shows validation, no write attempted. Tier C: `test/e2e/sd/roundTripSalesInquiry.e2e.js` — dry-run FAIL: item Plant dropped by `SalesInquiryService.js:106-115` allowlist (app defect); live run pending written go (no SAP persistence proven). |
| `salesInquiryDetail` | `sd/sales-inquiries/{SalesInquiry}` | SD · inquiry detail | `/odata/v4/sales-inquiry` | 🟢 | N/A | `test/e2e/sd/verifySdScreens.e2e.js` (first list row). SAP N/A: `SalesInquiryDetail.controller.js` only reads (`getSalesInquiry`). |
| `salesOrders` | `sd/sales-orders` | SD · order list | `/odata/v4/sales-order` | 🟢 | 🔴 | `test/e2e/sd/verifySdScreens.e2e.js`; `test/e2e/negative/verifyNegativeUi.e2e.js` B3: simulated list read failure shows the load-error text. Tier C pending (2026-10-26): list action `createOutboundDelivery`; no Tier C suite yet. |
| `createSalesOrder` | `sd/sales-orders/create` | SD · order create | `/odata/v4/sales-order` | 🟢 | 🔴 | `test/e2e/sd/verifySdScreens.e2e.js`; `test/e2e/negative/verifyNegativeUi.e2e.js` B2: empty double submit shows a validation message, no write attempted. Tier C: `test/e2e/sd/roundTripSalesOrder.e2e.js` — dry-run PASS; live run pending written go (no SAP persistence proven). |
| `wmGoodsReceipt` | `wm/goods-receipt` | WM · goods receipt list | `/odata/v4/goods-receipt` | 🟢 | 🔴 | `test/e2e/wm/verifyWmScreens.e2e.js`. Tier C: `test/e2e/wm/roundTripGoodsReceipt.e2e.js` — dry-run PASS (starts on this list); live run pending written go (no SAP persistence proven). |
| `wmGoodsReceiptDetail` | `wm/goods-receipt/{delivery}` | WM · goods receipt post | `/odata/v4/goods-receipt` | 🟢 | 🔴 | `test/e2e/wm/verifyWmScreens.e2e.js` (first open delivery). Posting not exercised. Tier C: `test/e2e/wm/roundTripGoodsReceipt.e2e.js` — dry-run PASS; live run pending written go (no SAP persistence proven). |
| `ordersDueForDelivery` | `le/orders-due` | LE · deliveries, PGI, billing | `/odata/v4/outbound-delivery` | 🟢 | 🔴 | `test/e2e/le/verifyLeScreens.e2e.js`: user without a `Plant` attribute (`alice`) sees the required Plant selector and no request is sent until a plant is entered, then plant 1120 loads 169 rows; plant-scoped user (`bob`) opens pre-selected and loaded. Backend stays fail-closed (no plant → 400, out-of-scope plant → 403). Search on SoldToParty/Material still fails with 400 (undeclared properties; not fixed). Delivery/PGI/billing actions not exercised. Tier C pending (2026-10-26): `createOutboundDelivery`, `postGoodsIssue`, `createBillingDocument`, `createDeliveryWithoutRef`; no Tier C suite yet. Authorization: `test/e2e/negative/verifyPlantIsolation.e2e.js` (plant isolation). |
| `customerInvoices` | `sd/invoices` | SD · invoices | `/odata/v4/customer-invoice` | 🟢 | 🔴 | `test/e2e/sd/verifySdScreens.e2e.js`. Release/cancel actions not exercised. Tier C pending (2026-10-26): `releaseInvoiceToAccounting`, `cancelBillingDocument`; no Tier C suite yet. |
| `customerReturns` | `sd/returns` | SD · return list | `/odata/v4/customer-return` | 🟢 | 🔴 | `test/e2e/sd/verifySdScreens.e2e.js`. Tier C pending (2026-10-26): `createCustomerReturn`; no Tier C suite yet. |
| `createCustomerReturn` | `sd/returns/create` | SD · return create | `/odata/v4/customer-return` | 🟢 | 🔴 | `test/e2e/sd/verifySdScreens.e2e.js`; `test/e2e/negative/verifyNegativeUi.e2e.js` B2: empty double submit shows the validation MessageBox, no write attempted. Tier C pending (2026-10-26): `createCustomerReturn`; no Tier C suite yet. |
| `wmCycle261` | `wm/mvt261/open/{reservation}/{item}/cycle` | WM · mvt 261 cycle | `/odata/v4/mvt261` | 🟢 | 🔴 | `test/e2e/wm/verifyWmScreens.e2e.js` (first item from the read-only `openItems()` function). Tier C pending (2026-10-26): mvt 261 posting (`postGoodsIssue`, `reverse`); no Tier C suite yet. |
| `wmScan261` | `wm/mvt261/open/{reservation}/{item}` | WM · mvt 261 scan | `/odata/v4/mvt261` | 🟢 | 🔴 | `test/e2e/wm/verifyWmScreens.e2e.js` (first item from the read-only `openItems()` function). Tier C pending (2026-10-26): mvt 261 posting (`postGoodsIssue`); no Tier C suite yet. Authorization: `test/e2e/negative/verifyPlantIsolation.e2e.js` (foreign-plant deep link refused). |
| `wmHandlingUnitDetail` | `wm/handling-unit/{hu}:?query:` | WM · HU detail | `/odata/v4/handling-unit` | 🟢 | 🔴 | `test/e2e/wm/verifyWmScreens.e2e.js` (first list row). Tier C pending (2026-10-26): HU `pack`/`unpack`/`remove`; no Tier C suite yet. |
| `wmHandlingUnits` | `wm/handling-unit` | WM · HU list | `/odata/v4/handling-unit` | 🟢 | 🔴 | `test/e2e/wm/verifyWmScreens.e2e.js`: passes since 15:26 IST fix of `OverflowToolbarLayoutData priority="Medium"` → `"Low"` (`HandlingUnits.view.xml:95`). Tier C pending (2026-10-26): HU `create`/`pack`/`unpack`/`remove`; no Tier C suite yet. |
| `wmPackingInstructionDetail` | `wm/packing-instruction/{systemUUID}` | WM · packing instruction detail | `/odata/v4/packing-instruction` | 🟢 | N/A | `test/e2e/wm/verifyWmScreens.e2e.js` (first list row). SAP N/A: `PackingInstructionDetail.controller.js` makes no write calls. |
| `wmPackingInstructions` | `wm/packing-instruction` | WM · packing instruction list | `/odata/v4/packing-instruction` | 🟢 | 🔴 | `test/e2e/wm/verifyWmScreens.e2e.js`. Tier C pending (2026-10-26): packing instruction `create`; no Tier C suite yet. |
| `wmReservationEntryList` | `wm/reservation-entry` | WM · reservation list | `/odata/v4/reservation-entry` | 🟢 | N/A | `test/e2e/wm/verifyWmScreens.e2e.js`. SAP N/A: `ReservationEntryList.controller.js` only reads (`getEntries`, `getOpenReservations`). Authorization: `test/e2e/negative/verifyPlantIsolation.e2e.js` (plant isolation). |
| `wmReservationEntryCreate` | `wm/reservation-entry/create` | WM · reservation create | `/odata/v4/reservation-entry` | 🟢 | 🔴 | `test/e2e/wm/verifyWmScreens.e2e.js`; `test/e2e/negative/verifyNegativeUi.e2e.js` B2; `test/e2e/wm/verifyHardeningUI.e2e.js`; `test/e2e/wm/verifyMvt201.e2e.js`, `test/e2e/wm/verifyMvt241.e2e.js`, `test/e2e/wm/verifyMvt261.e2e.js`, `test/e2e/wm/verifyMvt301.e2e.js`, `test/e2e/wm/verifyMvt311.e2e.js` (create page checks; `verifyMvt311` fixed 14:41 and passing). Nothing is submitted. Tier C: `test/e2e/wm/roundTripGoodsIssue.e2e.js` — dry-run PASS (movement 201); live run pending written go (no SAP persistence proven). |
| `wmReservationEntryDetail` | `wm/reservation-entry/{ReservationNo}/{ReservationItem}` | WM · reservation detail, mvt 201/241/261/301/311 | `/odata/v4/reservation-entry` | 🟢 | 🔴 | `test/e2e/wm/verifyWmScreens.e2e.js` (first list row); `test/e2e/wm/verifyMvt201.e2e.js`, `test/e2e/wm/verifyMvt241.e2e.js`, `test/e2e/wm/verifyMvt261.e2e.js`, `test/e2e/wm/verifyMvt301.e2e.js`, `test/e2e/wm/verifyMvt311.e2e.js`; `test/e2e/wm/verifyHardeningUI.e2e.js`: display of documents posted earlier plus `verifyMaterialDocument` read-back; no transaction run through the UI. Last live posting 2026-10-24 (WORKSTATUS.md). Tier C pending (2026-10-26): `retryStep` and follow-up warehouse steps (TR/TO/MIGO) from the detail; no Tier C suite yet (create is covered by the goods-issue suite). Authorization: `test/e2e/negative/verifyPlantIsolation.e2e.js` (foreign-plant deep link refused). |
| `wmWarehouseScanTo` | `wm/scan-to` | WM · scan-to entry | `/odata/v4/tr-to` | 🟢 | N/A | `test/e2e/wm/verifyWmScreens.e2e.js`. SAP N/A: `WarehouseScanTo.controller.js` only reads/scans (`getOpenTRs`, scanner). |
| `wmWarehouseScanToDetailWithWh` | `wm/scan-to/{lgnum}/{docType}/{number}` | WM · scan-to detail (warehouse) | `/odata/v4/tr-to` | 🟢 | 🔴 | `test/e2e/wm/verifyWmScreens.e2e.js` (first open TR from the entry screen). Tier C pending (2026-10-26): `createTOFromTR`, `postMigoGoodsMovement`; no Tier C suite yet. |
| `wmWarehouseScanToDetail` | `wm/scan-to/{docType}/{number}` | WM · scan-to detail | `/odata/v4/tr-to` | 🟢 | 🔴 | `test/e2e/wm/verifyMvt201.e2e.js`, `test/e2e/wm/verifyMvt241.e2e.js`, `test/e2e/wm/verifyMvt261.e2e.js`, `test/e2e/wm/verifyMvt301.e2e.js`, `test/e2e/wm/verifyMvt311.e2e.js` open existing TRs and check display; no TO is created or confirmed through the UI. Tier C pending (2026-10-26): `createTOFromTR`, `postMigoGoodsMovement`; no Tier C suite yet. |
| `wmHuStockTransfer` | `wm/hu-stock-transfer` | WM · HU stock transfer list | `/odata/v4/hu-stock-transfer` | 🟢 | N/A | `test/e2e/wm/verifyWmScreens.e2e.js`. Never proven live (WORKSTATUS.md). SAP N/A: `HuStockTransferList.controller.js` makes no service calls; posting is on the detail route. Authorization: `test/e2e/negative/verifyPlantIsolation.e2e.js` (plant isolation). |
| `wmHuStockTransferRackDemo` | `wm/hu-stock-transfer/demo-rack` | WM · rack demo | — | 🟢 | N/A | `test/e2e/wm/verifyWmScreens.e2e.js`. SAP N/A: demo visualization; `HuStockTransferRackDemo.controller.js` makes no service calls. |
| `wmHuStockTransferRack` | `wm/hu-stock-transfer/{reservation}/{item}/rack` | WM · HU rack selection | `/odata/v4/hu-stock-transfer` | 🟢 | N/A | `test/e2e/wm/verifyWmScreens.e2e.js` (first list row opens the rack by design). SAP N/A: `HuStockTransferRack.controller.js` makes no service calls; posting is on the detail route. |
| `wmHuStockTransferDetail` | `wm/hu-stock-transfer/{reservation}/{item}` | WM · HU stock transfer post | `/odata/v4/hu-stock-transfer` | 🟢 | 🔴 | `test/e2e/wm/verifyWmScreens.e2e.js` (same reservation as the rack step). Posting not exercised. Tier C: `test/e2e/wm/roundTripHuTransfer.e2e.js` — dry-run FAIL: `validateUnit` HTTP 500, storage-type rules for 1120/W01 not configured (pending business input); live run pending written go (no SAP persistence proven). |

Totals: Browser E2E 🟢 33 / 🟡 0 / 🔴 0. SAP round trip: 0 🟢 (no live run yet), 20 🔴 (7 with a Tier C suite, 13 "Tier C pending"), 13 N/A.

## Tier C SAP round trips

`npm run test:e2e:sap` (`test/e2e/runSapRoundTrips.js`) runs the round-trip suites; `E2E_SAP_FLOWS=po,salesOrder` limits the flows. Default is **dry-run**: the write guard stays on and the flow's single write action is answered by a stub, so the UI flow (fill → submit → result shown, payload checked) is proven without any SAP write — UI wiring only, never SAP persistence. **Live** mode needs `ALLOW_LIVE_SAP_TOOLS=1`, `--allow-live-sap`, `E2E_SAP_WRITE_FLOWS=<flow>`, `test/e2e/live/testData.json` without placeholders (template: `testData.example.json`), and the user's written go per run; it then allows exactly that action, captures the SAP document number and reads it back.

| Flow | Suite | Dry-run (2026-10-26) | Live |
| --- | --- | --- | --- |
| PO create | `test/e2e/mm/roundTripPurchaseOrder.e2e.js` | PASS | pending go |
| Sales inquiry create | `test/e2e/sd/roundTripSalesInquiry.e2e.js` | FAIL — item `Plant` dropped by `SalesInquiryService.js:106-115` | pending go |
| Sales order create | `test/e2e/sd/roundTripSalesOrder.e2e.js` | PASS | pending go |
| Goods receipt post | `test/e2e/wm/roundTripGoodsReceipt.e2e.js` | PASS | pending go (read-back via open quantity; no read-only 101 document API) |
| Goods issue 201 (reservation entry) | `test/e2e/wm/roundTripGoodsIssue.e2e.js` | PASS | pending go |
| HU stock transfer 311 | `test/e2e/wm/roundTripHuTransfer.e2e.js` | FAIL — storage-type rules for 1120/W01 not configured | pending go |

## Authorization E2E

- `test/e2e/negative/verifyPlantIsolation.e2e.js` (READ-ONLY, write guard on, mock user `bob` = Viewer, Plant 1120): scoped lists show only plant 1120; deep links to another plant's reservation / 261 item are refused (403/404) without showing data; an out-of-scope plant on Orders Due is refused.
- `test/e2e/negative/verifyWriteAuthorization.e2e.js` (private CAP server started with `NODE_ENV=test` and no S4_* variables, S/4 at a dead endpoint — no SAP write possible): every write action that does not grant Viewer (49, generated from the CDS model) answers 401 signed out and 403 for Viewer-only users; a WarehouseClerk of plant 1130 is refused on plant 1120 for reservation create/entry and HU pack, **but not for `postGoodsReceipt` and `createDeliveryWithoutRef`** (requests pass authorization and reach the S/4 client) — open authorization gaps, suite FAILS until fixed.

## Negative E2E cases

Covered (`test/e2e/negative/verifyNegativeUi.e2e.js`, write guard on): signed-out deep link → login (B1); empty-form double submit on all five create screens shows validation and attempts no write (B2); simulated list read failure (mocked HTTP 500, not SAP) shows the load-error text without a crash (B3).

Still required for SAP write flows when their round-trip suites are added: unauthorized role (no UI role gating found; server-side only), SAP 4xx/5xx from real SAP surfaced in the UI, timeout/backend failure during submit, stale data, reload/navigation during submit, and session expiry mid-session.

## Running

`npm run test:e2e` runs the Tier A/B and authorization suites (`node test/e2e/runAllE2E.js`) against a running server (`npm start`); Tier C runs separately via `npm run test:e2e:sap`; it is not part of CI, which has no SAP connectivity. Tier A/B suites read SAP data through CAP (READ-ONLY) behind the write guard. Live SAP writes still require the user's written go per call (`AGENTS.md`).
