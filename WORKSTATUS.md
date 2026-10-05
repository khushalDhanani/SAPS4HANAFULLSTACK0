# WORKSTATUS

Single source of truth for work history, current status, validation, unresolved issues and next steps (see `AGENTS.md`).
The previous log was removed in commit `b741337`; this file restarts it.

## Current Status

- **Open 261 items + 261 cycle (read-only)** — list (153 for plant 1120 = user's reference, reconciled with RESB) and click-through cycle page validated live against SAP at backend level; UI pages `#/wm/mvt261/open` and `#/wm/mvt261/open/{reservation}/{item}` statically validated, **not yet verified in a browser**. Posting (261, 262, transfer orders) **not built — Blocked** on test reservations and explicit approval.
- **First Goods Issue 261 finder (read-only)** — backend complete and validated live against SAP; UI built, statically validated, **not yet verified in a browser** (login needs the user's SAP credentials).

## Unresolved Issues

0. **OPEN SAP POSTING:** material document 4900050046/2026 (261, 1 NOS, reservation 278650/1, plant 1120, HS01) was posted in live test 1 and is NOT yet reversed; WM transfer requirement 1000744 (W01) was created by it. Waiting for the user's decision to cancel it. Status: **Blocked**.
1. UI page `#/wm/mvt261` not exercised in a browser (see above). Status: **In Progress**.
2. The original spec asked for ABAP RAP objects (ZI_MVT261, ZC_MVT261, DCL, V4 binding). By user decision (2026-10-05) the feature is built as CAP + UI5 on existing SAP services; no ABAP objects exist.
3. "Show a message if authorization removes rows" cannot be detected: SAP filters unauthorized plants / movement types silently inside the OData services. The UI shows a static note instead.
4. Archived material documents are not read (UI shows the SARI / MM_MATBEL hint).
5. The pasted spec ended at "6. Performance:"; later sections were never received.

## Next Steps

0. User to decide: reverse 4900050046/2026 with the API Cancel action (then verify ENMNG, KZEAR, stock and the WM transfer requirement), and whether to run test 2 (418011/4, 1 KG, needs a batch decision).
1. Log in locally, open the dashboard tile "First Goods Issue 261" (WM tab) and confirm the page with plant 1120.
2. Decide whether the ABAP RAP variant is still wanted.

## Changes Log

### 2026-10-05 17:10 IST — SAP discovery for movement type 261 read (no file change)

- **Why:** find a real SAP read service that can sort/filter/count 261 items server-side (AGENTS.md discovery protocol). GET only.
- **Evidence (live, client from `.env.local`):**
  - `$metadata` 200 for `API_MATERIAL_DOCUMENT_SRV`, `MMIM_MATDOC_SRV`, `MMIM_MATDOC_OV_SRV`.
  - `A_MaterialDocumentItem` has no posting date / entry time (header only) → cannot sort items by BUDAT.
  - `MMIM_MATDOC_OV_SRV/F_Mmim_Findmatdoc` has PostingDate, CreationDateTime, GoodsMovementType, Plant, Material, OrderID, IsAutomaticallyCreated, IsCancelled, CreatedByUser; `$orderby`, `$top`, `$inlinecount` work (HTTP 200, 1.3–2.5 s).
  - Each item is returned 3× (StockChangeType/Context 02/01, 02/02, 05/''). `StockChangeType eq '05'` → 9,940 rows = `A_MaterialDocumentItem` count for 261 (9,940).
  - Reversal: `IsCancelled eq true` → 71 = API `GoodsMovementIsCancelled` 71 = 262 items with `ReversedMaterialDocument` 71. Document 4900000255/2025 is reversed by 4900000282/2025.
  - `CreationDateTime` is UTC: 09:41:23Z vs header `CreationTime` 15:11:23 (system zone +05:30).
  - No 261 item with `IsAutomaticallyCreated eq 'X'` exists in this client (manual-only filter returns the same count).
- **Result:** PASS — service and fields proven.

### 2026-10-05 17:25 IST — S/4 adapter `Mvt261Adapter`

- **Files:** `srv/integration/s4hana/wm/Mvt261Adapter.js` (new), `test/unit/wm/mvt261Adapter.test.js` (new), `tools/find-first-261.js` (new, read-only live check).
- **Change:** `findFirst({plant, material, productionOrder, dateFrom, dateTo, definition, excludeReversed, manualOnly})` → `{Definition, SortKey, TotalCount, Top[≤5]}`. Definitions A (BUDAT, CPUDT, CPUTM, MBLNR, MJAHR, ZEILE), B (CPUDT, CPUTM, key), C (MJAHR, MBLNR, ZEILE). Input validated by strict patterns before it reaches `$filter`. Reversing 262 of the shown rows read from `API_MATERIAL_DOCUMENT_SRV` as evidence.
- **Validation:**
  - `npx jest test/unit/wm/mvt261Adapter.test.js` → 3 passed.
  - `node tools/find-first-261.js 1120 A|B|C` → 4,481 matching items, first = 4900000062/2025/0001 (posting 2025-06-04) for all three definitions.
  - Order 1000026 + material 1000000514 + June 2025 → 1 item, 4900000255, reversed by 4900000282/2025/0001; with exclude-reversed → 0.
  - Unsafe plant value → 400 "Plant is missing or invalid", no SAP call.
- **Result:** PASS.

### 2026-10-05 17:35 IST — CAP service `Mvt261Service`

- **Files:** `srv/wm/mvt261/service.cds` (new), `srv/wm/mvt261/service.js` (new), `srv/service.cds` (one `using` line).
- **Change:** read-only function `findFirst` at `/odata/v4/mvt261`, roles Viewer / WarehouseClerk / WarehouseManager / Admin. No entities, no create/update/delete.
- **Validation:** `npx cds compile srv --to csn` OK. Local `cds-serve` on port 4055: anonymous → 401; mocked user → 200 with the SAP result above; empty plant → 400; POST → 405.
- **Result:** PASS.

### 2026-10-05 17:50 IST — UI5 page "First Goods Issue 261"

- **Files:** `app/fiori-app/webapp/modules/wm/mvt261/view/Mvt261.view.xml` (new), `.../controller/Mvt261.controller.js` (new), `manifest.json` (route `wmMvt261`, target), `controller/App.controller.js` (shell title), `controller/Dashboard.controller.js` + `view/Dashboard.view.xml` (WM tile), `i18n/i18n.properties` + `i18n/i18n_en.properties` (`mvt261*` texts).
- **Change:** filter form (plant mandatory, material, production order, posting date range), definition A/B/C, toggles exclude-reversed and manual-only, archive warning, first document header with definition / sort key / total count, table of the first 5 rows.
- **Validation:** `npx ui5lint` on both new files → no findings. `test/unit/controller/uiConsistency.test.js` passes in the full run.
- **Not validated:** rendering in a browser — the app redirects to `#/login`, which needs SAP credentials the agent must not enter. **In Progress.**

### 2026-10-05 18:00 IST — WORKSTATUS.md restored

- **Files:** `WORKSTATUS.md` (new).
- **Why:** mandatory per `AGENTS.md`; its absence since `b741337` also made `test/unit/guard/noGiQueueGuard.test.js` fail (it asserts this file is scanned). That failure existed before this session's changes.
- **Validation:** see final pass below.

### 2026-10-05 18:05 IST — Final validation pass

- `git diff --check` → clean.
- `npx eslint` on new backend/test/tool files → 0 errors, 0 warnings.
- `npm test` → 130 suites passed, 2,070 tests passed (0 failed).
- `mbt validate`, UI5 build, deployment: not run (no MTA / deployment change).

### 2026-10-05 19:10 IST — Source-of-truth discovery for "open 261 items" (no code change)

- **Why:** user asked to find the source of truth after `/WM/MVT261` could not be located. Read-only (RFC_READ_TABLE, OData GET, ADT source GET).
- **Findings (live):**
  - `/WM/MVT261` does not exist: TSTC/TSTCP/TADIR have no `*MVT261*`, no `/WM/*` transaction, TRNSPACE has no `/WM*` namespace. It is also not in this repo's git history.
  - Custom WM transactions present: ZTO, ZB2B, ZDTO, ZZGRN, ZHU, ZHU2, ZLT01, ZLT09, ZS561, ZSU_CUST, ZWM_TO — none lists or posts 261.
  - Program `ZWM_RF_RESERVATION_ISSUE_AIL` exists in `$TMP`, created 2026-10-05 by another SAP user, source is an empty `REPORT` statement, no transaction assigned.
  - System: S4CORE 109, SAP_BASIS 816; classic WM warehouse numbers in T340D.
  - RESB, BWART = '261': 12,636 items; `XLOEK = '' AND KZEAR = ''` → 467 (plants 1110: 117, 1120: 205, 1130: 80, 1140: 2, 1600: 4, 2100: 59); of these 393 have BDMNG > ENMNG; all 467 carry an order number.
  - `UI_RESERVATION_ITM_MNG_V2/ReservationDocumentItem`, `GoodsMovementType eq '261' and ReservationItemIsFinallyIssued eq false and ReservationItmIsMarkedForDeltn eq false` → 467; total 261 → 12,636.
  - Reconciliation RESB vs OData by reservation/item: 0 only in RESB, 0 only in OData, 0 quantity mismatches.
- **Result:** PASS — source of truth is RESB; the OData service reproduces it exactly.
- **Open decision (user):** "open" = 467 (not deleted, not final-issued) or 393 (additionally open quantity > 0).
- **Next:** on the user's decision, build the read-only open-261 list on `UI_RESERVATION_ITM_MNG_V2` (existing `GoodsIssueReservationsClient.getOpenReservations`). Posting stays unproven and is not started.

### 2026-10-05 20:05 IST — Adapter + CAP: open 261 reservation items (`openItems`)

- **Files:** `srv/integration/s4hana/wm/Mvt261Adapter.js` (method `openItems`), `srv/wm/mvt261/service.cds` (types `Open261Item`, `Open261Result`, function `openItems`), `srv/wm/mvt261/service.js` (handler), `test/unit/wm/mvt261Adapter.test.js` (2 tests), `tools/list-open-261.js` (new, read-only live check).
- **Change:** read-only list from `UI_RESERVATION_ITM_MNG_V2/ReservationDocumentItem` (261, not final-issued, not marked for deletion), sorted by requirement date; filters plant, material, order, reservation, requirement date range pushed to SAP. Default returns items with open quantity > 0; `includeFullyWithdrawn` returns all. The user had not yet chosen between the two definitions — default applied as recommended, both counts are returned (`TotalCount`, `SapOpenCount`).
- **Validation:** live `node tools/list-open-261.js` → 393 returned / 467 open in SAP; with `ALL=1` → 467 / 467; plant 1120 → 153 / 205 (all: 205) — equal to the RESB reconciliation of 19:10. `cds compile` OK. Local `cds-serve`: function returns the same counts over HTTP, invalid plant → 400, anonymous → 401.
- **Result:** PASS.

### 2026-10-05 20:20 IST — UI5 page "Open 261 Items"

- **Files:** `app/fiori-app/webapp/modules/wm/mvt261/view/Open261.view.xml` (new), `.../controller/Open261.controller.js` (new), `manifest.json` (route `wmOpen261`, pattern `wm/mvt261/open`), `controller/App.controller.js` (shell title), `controller/Dashboard.controller.js` + `view/Dashboard.view.xml` (WM tile), both i18n bundles (`open261*`).
- **Change:** filter form, responsive growing table, Excel export (`sap/ui/export/Spreadsheet`), i18n texts. Read-only; no posting.
- **Deviations from the Phase 3 text:** (1) freestyle UI5 page, not a Fiori elements List Report — the app is one freestyle UI5 component without `sap.fe`; (2) filters and columns come from the fields SAP returns for reservation items, because the program/selection screen/export the spec refers to do not exist.
- **Validation:** `npx ui5lint` on both files → no findings. `npm test` → 130 suites, 2,072 tests passed. `npx eslint` on changed backend files → clean. `git diff --check` → clean.
- **Not validated:** rendering, Excel download and responsiveness in a browser (login needs the user's SAP credentials). **In Progress.**

### 2026-10-05 20:50 IST — Proof: reconciliation tool `tools/reconcile-open-261.js`

- **Files:** `tools/reconcile-open-261.js` (new, read-only: RFC_READ_TABLE on RESB + OData GET).
- **Change:** compares the app's open 261 list with RESB (`BWART = '261' AND XLOEK = '' AND KZEAR = ''`, optional plant): row counts (all / open quantity > 0), keys on either side only, and material, plant, storage location, order, requirement date, required and withdrawn quantity on matched rows. Exit code 1 on any difference. Unit of measure is not compared (internal vs external code).
- **Validation (live):** all 7 checks PASS for all plants (467 / 393), plant 1120 (205 / 153), plant 2100 (59 / 57) and plant 9999 (0 / 0). No key or field differences.
- **Result:** PASS.
- **Note:** the baseline is RESB, not `/WM/MVT261` — that transaction does not exist (see 19:10).

### 2026-10-05 21:00 IST — Proof tests for the 261 adapter

- **Files:** `test/unit/wm/mvt261Adapter.test.js` (4 tests added).
- **Change:** zero rows; SAP 403 passed on (never an empty list); boundary of open quantity (9.999 of 10 open, 10 of 10 and 10.001 of 10 not open, 0 of 0 not open); paging until SAP's count is reached.
- **Validation:** `npx jest test/unit/wm/mvt261Adapter.test.js` → 9 passed. `npm test` → 130 suites, 2,076 tests passed. `npx eslint` on both files → clean.
- **Result:** PASS.
- **UNVERIFIED:** ABAP Unit tests (no ABAP objects exist); CAP role check answering 403 for a user without the four allowed roles (every mocked user has one; only anonymous → 401 was verified); SAP's own authorization filtering for a restricted SAP user (only one SAP user available); browser rendering and Excel export.

### 2026-10-05 21:40 IST — Discovery for the full 261 cycle (no code change)

- **Why:** new spec (list + click-through 261 cycle with posting). Read-only checks of every data source it names, on reservation 20808 item 8 / order 1000086 / plant 1120.
- **Findings (live):**
  - User's reference count 153 = app default list for plant 1120 (RESB: BWART 261, XLOEK blank, KZEAR blank, BDMNG > ENMNG; all items have an order) — PASS in `tools/reconcile-open-261.js 1120`.
  - Readable via RFC: RESB (incl. CHARG, XWAOK, MEINS, BDTER), AUFK, AFKO, AFPO, JEST + TJ02T, T320, MARD, MCHB, LQUA, LTBK, LTBP, LTAK, LTAP, MATDOC (by RSNUM/RSPOS).
  - Order 1000086: type ZP01 (category 40, process order), active statuses include REL and LKD (locked).
  - Plant 1120: 15 storage locations mapped to a warehouse in T320 → classic WM active. Reservation 20808 has a staging TR (LTBK, movement 319, requirement type P, open) and a 261 TR (requirement type F, status E).
  - Open 261 items in 1120 (205): none carries a batch in RESB; 27 have no storage location.
  - `API_MATERIAL_DOCUMENT_SRV` exposes POST function imports `Cancel` and `CancelItem` (metadata only).
- **UNVERIFIED:** any posting (261, 262, TO create/confirm); BAPI_GOODSMVT_CREATE / BAPI_GOODSMVT_CANCEL over RFC; behaviour of a 261 post on WM-managed locations.
- **Blocked on user:** three test reservations, explicit approval to post real documents in this client, ABAP RAP vs CAP.

### 2026-10-05 22:40 IST — Adapter + CAP: read-only 261 cycle (`cycle`) and order status in the list

- **Trigger:** user answered "Yes" to the proposed build order; it did not name test reservations or settle RAP vs CAP, so only the read-only steps were built (CAP + UI5 as before). Nothing posts.
- **Files:** `srv/integration/s4hana/wm/Mvt261Adapter.js` (`cycle`, `_orderStatuses`, `_table`; `openItems` now adds `OrderStatus`), `srv/wm/mvt261/service.cds` (cycle types, function `cycle`, `OrderStatus`), `srv/wm/mvt261/service.js`, `test/unit/wm/mvt261Adapter.test.js` (5 cycle tests; list tests stub RFC).
- **Change:** `cycle(reservation, item)` reads RESB, AUFK, JEST, MARD, MCHB, T320, LQUA, LTBK, LTBP, LTAK, LTAP, MATDOC over RFC and returns header data, 8 steps (done / open / blocked + reason), stock, quants, transfer requirements, transfer orders and the 261/262 history. Blocking rules: item deleted / final issue / movement not allowed; order not released, locked, technically completed, closed or deletion flag (status texts verified in TJ02T); unrestricted stock below open quantity.
- **Validation (live):** reservation 20808/8 → order "LKD REL", order + availability + goods issue blocked, staging open (TR 1000514, movement 319), no history; 17974/5 → item deleted, order closed, history 4900000255 (261, reversed) + 4900000282 (262). Unknown reservation → 404. List for plant 1120 still 153, statuses seen: "REL", "CRTD", "LKD REL". Over HTTP on local `cds-serve`: same results. `tools/reconcile-open-261.js` (all, 1120) → 7/7 PASS.
- **Tests:** `npm test` → 130 suites, 2,081 tests passed. `npx eslint` on changed files clean, `cds compile` OK, `git diff --check` clean.
- **Result:** PASS (read path). **UNVERIFIED:** posting 261, reversal 262, transfer order create/confirm — not built.
- **Not in the list:** batch column (RESB-CHARG is blank on all open 261 items of plant 1120 and the reservation service does not carry it; the cycle page shows it).

### 2026-10-05 22:55 IST — UI5 page "261 Cycle" and list navigation

- **Files:** `app/fiori-app/webapp/modules/wm/mvt261/view/Cycle261.view.xml` (new), `.../controller/Cycle261.controller.js` (new), `Open261.view.xml` + `Open261.controller.js` (row navigation, order status column, export column), `manifest.json` (route `wmCycle261`, `wm/mvt261/open/{reservation}/{item}`), `controller/App.controller.js` (shell title), both i18n bundles (`cycle261*`, `open261OrderStatus`).
- **Change:** header, step table with status and reason, stock, quants, transfer requirements, transfer orders, document history. No action buttons.
- **Validation:** `npx ui5lint "webapp/modules/wm/mvt261/**"` → no findings; `test/unit/controller/uiConsistency.test.js` passes in the full run.
- **Not validated:** browser rendering and navigation (login needs the user's SAP credentials). **In Progress.**

### 2026-10-05 23:20 IST — Candidate test reservations and evidence (no code change, read-only)

- **Why:** user relayed a review asking for raw evidence and for candidates the user will pick from. Nothing posted.
- **Evidence:** raw RESB row 20808/8 (BWART 261, AUFNR 1000086, MATNR 1000000400, WERKS 1120, LGORT CS01, BDMNG 1200.000, ENMNG 0.000, KG, XLOEK/KZEAR blank, XWAOK X). RESB plant 1120, 261, XLOEK blank, KZEAR blank → 205 rows; with BDMNG > ENMNG → 153. Client category in T000: T (test), text "Pre-Test".
- **Candidates (plant 1120):** of the 153, 97 are on orders with REL and none of LKD/TECO/CLSD/DLFL, movement allowed, storage location set; 72 of those have unrestricted stock ≥ open quantity. Never issued, smallest: 278650/1, 278650/2, 377755/2, 463010/1 (1 NOS each, HS01). Partly issued: 418011/4 (2,145 of 4,290 KG open, CS01), 418011/2 (2,600 of 5,200 KG open, CS01).
- **Blocked:** user to pick the reservations, the maximum quantity, and give the go-ahead.

### 2026-10-05 23:45 IST — Adapter: guarded `postGoodsIssue` and `reverse` (not exposed in CAP or UI)

- **Trigger:** user's limited go-ahead (tests 1–3, plant 1120, max 1 NOS / 1 KG).
- **Files:** `srv/integration/s4hana/wm/Mvt261Adapter.js` (`postGoodsIssue`, `reverse`, `_post`), `tools/test-261-post-cycle.js` (new, supervised live test — WRITES to SAP), `test/unit/wm/mvt261Adapter.test.js` (4 tests).
- **Change:** `postGoodsIssue` re-reads the cycle, refuses with 422 and no SAP call unless the goods issue step is open, quantity ≤ open quantity, storage location set, stock sufficient and batch given where batch stock exists; then one `API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentHeader` deep insert (code 03, 261, reservation + item + order). A response without a material document is an error. `reverse` calls the API `Cancel` action. No idempotency key yet — not wired to CAP/UI.
- **Tests:** `npm test` → 130 suites, 2,085 tests passed; ESLint clean.

### 2026-10-05 23:50 IST — Live test 3 (blocked case, reservation 20808/8)

- **Result:** PASS — app refused with 422 "Goods issue not possible: order is locked", 0 POST calls sent, RESB / MARD / MATDOC identical before and after.

### 2026-10-05 23:58 IST — Live test 1 (reservation 278650/1, 1 NOS) — STOPPED after step 2, document NOT reversed

- **Pre-check:** RESB BDMNG 1.000 / ENMNG 0.000, order REL, MARD HS01 10.000 — as in the evidence.
- **Step 2 (POST):** HTTP 201, material document **4900050046 / 2026**, no sap-message, no delivery.
- **Step 3 (read back):** immediate GET of the document → **HTTP 404** (unexpected). Per the go-ahead rules everything stopped: no retry, no cancel, test 2 not started.
- **State read afterwards (read-only):** document exists (MATDOC/MKPF 4900050046, 261, 1.000, reservation 278650/1, user of the connection); API GET now returns it; RESB ENMNG 1.000 and **KZEAR = X**; MARD HS01 9.000; no failed update record; WM created transfer requirement **1000744** (W01, movement 261, open) for the document.
- **Cause of the 404:** SAP returned the number before its update task had written the document. `tools/test-261-post-cycle.js` now waits for the document (reads only); not re-run.
- **OPEN — needs user decision:** document 4900050046/2026 is posted and not reversed; stock is 1 NOS lower and the reservation item is final-issued. Reversal (API Cancel) and test 2 are **Blocked** until the user says to continue.

### 2026-10-06 00:20 IST — Evidence for the proposed SU-scan screen, reservation 24685/2 (no code change, read-only)

- **Why:** user relayed a design proposal (scan storage units, then post 261) that asked for raw data on 24685/2. Nothing posted, nothing built.
- **Findings (live):** RESB 24685/2: 261, order 1000109, material 8300000159 (AESOL-CN HB CUT, batch-managed), plant **1130**, CS01, BDMNG 510.000, ENMNG 509.000 (open 1 KG), not deleted, not final-issued. Order status "LKD REL" → the app blocks goods issue. MARD: CS01 7,377.036, PT01 7,972.518. LQUA (warehouse W12): 17 quants in CS01, only 2 carry a storage unit (1000033499, 1000033500, type FG1, 200 KG each, batch IN25002833); 15 are in interim type 901 / bin WE-ZONE without storage unit. No block flags set on any quant. Existing 261 documents for the item (4900012536, 397 + 112 KG) were issued from **PT01**, not from the reservation's CS01. No transfer requirement for the reservation.
- **Still open:** document 4900050046/2026 from live test 1 is NOT reversed (see Unresolved Issues).

### 2026-10-06 00:50 IST — Positive test-case search for the SU-scan screen (no code change, read-only)

- **Why:** relayed request for a released, unlocked order with storage-unit stock in the reservation's own storage location, spanning 2–3 drums. Nothing posted, nothing built. The relayed text did not contain a user go-ahead for the reversal, so 4900050046/2026 was NOT reversed.
- **Findings (live, all plants):** 344 open 261 items with storage location and movement allowed; 308 on REL orders without LKD/TECO/CLSD/DLFL; 125 of those have SU stock (LQUA with LENUM, available, not blocked) in the reservation plant/storage location; 72 covered by one SU, 18 fully covered needing ≥ 2 SUs, 35 with SU stock that does not cover the open quantity. Candidates: 519944/1 (plant 1130, CS02, 600 KG), 512835/3 and 512851/3 (1130, CS02, 800 KG), 471326/1 and 471327/1 (1600, CS01, 500 KG), 512830/1 (1120, CS01, 400 KG — its SUs sit in storage type OH1, bin ONHOLD).
- **Still open:** document 4900050046/2026 not reversed (Unresolved Issue 0).
