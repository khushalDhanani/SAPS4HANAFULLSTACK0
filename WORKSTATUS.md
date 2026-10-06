# WORKSTATUS

Single source of truth for work history, current status, validation, unresolved issues and next steps (see `AGENTS.md`).
The previous log was removed in commit `b741337`; this file restarts it.

## Current Status

- **Open 261 items, scan screen stage 1 and 261 cycle (all read-only)** — list (153 for plant 1120, reconciled with RESB), scan-and-validate page `#/wm/mvt261/open/{reservation}/{item}` and cycle page `.../cycle` validated live against SAP at backend level and by unit tests; UI **not yet verified in a browser**. No posting is exposed. **Open SAP document 4900050046/2026 still not reversed** (Unresolved Issue 0).
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

### 2026-10-06 01:10 IST — Handling Unit services catalog discovery (no code change, read-only)

- **Why:** user requested discovery of Handling Unit services from the Gateway catalog.
- **Scope & Method:** analyzed `srv/external/all_catalog_services.json`, `catalog-creatable.csv`, `catalog-data-reality.csv`, `creatable-services.xlsx`, live Gateway endpoints, and SAP backend TADIR objects (`IWSV`/`IWSG`).
- **Findings (live & catalog):**
  - **Active / Registered Catalog Services with HU capabilities:**
    - `UI_SHIPMENTCONTAINERPACKG` (`/sap/opu/odata/sap/UI_SHIPMENTCONTAINERPACKG`): LE - Shipping; live data in client 220 (`C_HandlingUnitVH` 16,442 rows, `C_FldLogsShptItemHandlingUnit` 16,567 rows, `I_FldLogsShptHandlingUnitItem` 32,223 rows); action `PackToContainer`.
    - `/SCWM/SIMPLE_INB_DLV_SRV` (`/sap/opu/odata/scwm/SIMPLE_INB_DLV_SRV`): EWM Inbound; `HUHeadSet`, `HUItemSet`, `HUSingleItemSet`; actions `AutoPack`, `CreateTask`, `GoodsReceipt`, `ReverseGoodsReceipt`.
    - `/SCWM/SIMPLE_INB_PO_SRV` (`/sap/opu/odata/scwm/SIMPLE_INB_PO_SRV`): EWM Inbound PO; `HUSingleItemSet`.
    - `ZPACK_OUTBDLV_SRV` (`/sap/opu/odata/scwm/PACK_OUTBDLV_SRV`): EWM Outbound Packing; `HUSet`, `HUIDENTCollection`, `HUItemWeightSet`, `PackMatSet`, `PackingStationSet`; actions `Pack`, `UnPack`, `Close`, `ChangePackMat`.
    - `ZUI_RETURNSINITIATION` (`/sap/opu/odata/sap/UI_RETURNSINITIATION`): Returns HU; `C_HandlingUnitVH` (16,442 rows); actions `CreateEWMHandlingUnit`, `CreatePackHandlingUnit`, `DeleteHandlingUnit`, `PreviewHandlingUnitLabel`.
    - `ZUI_RETURNPROCESSING` (`/sap/opu/odata/sap/UI_RETURNPROCESSING`): `C_HandlingUnitVH` (16,442 rows); actions `DeleteHandlingUnit`, `DistributeHandlingUnitItmToOrd`, `ReverseHandlingUnitReceipt`, `SendHandlingUnitOutput`.
    - `ZAPI_WAREHOUSE_ORDER_TASK` (`/sap/opu/odata/sap/API_WAREHOUSE_ORDER_TASK`): action `ConfirmWarehouseTaskHU`.
    - `ZPICKCART_SRV`, `ZPICKLIST_PAPER_SRV`, `ZRECORD_INVENTORY_SRV`, `ZCUSTOMER_RETURNS_SRV`, `ZUI_WAREHOUSEDOCUMENT`.
  - **Standard S/4HANA HU Backend Services (in TADIR `IWSV`, NOT activated in Gateway):**
    - `API_HANDLING_UNIT` (Package `ODATA_LO_HU_API_HU`) — standard ERP Handling Unit API; returns `/IWFND/MED/170` (service not activated in `/IWFND/MAINT_SERVICE` on client 220).
    - `API_PACKINGINSTRUCTION` (Package `ODATA_LO_HU_API_PI`) — standard Packing Instructions API; not activated in Gateway.
    - `UI_HANDLINGUNITHIERNODE` / `C_HANDLINGUNITMONITOR_CDS` (Package `ODATA_LO_HU_FIORI_HUMO`) — Handling Unit Monitor (HUMO); not activated in Gateway.
    - `FDP_HU_SHIPPINGLABEL_SRV` / `FDP_LOHUM_HU_PACKINGLIST_SRV` (Package `ODATA_LO_HU_OM`) — HU shipping label & packing list forms.
  - **Database Reality:** VEKP (HU Header) and VEPO (HU Item) exist and are populated in SAP client 220.
- **Result:** PASS (discovery complete).


### 2026-10-06 02:10 IST — Adapter + CAP: scan screen stage 1, read-only (`scanContext`, `checkStorageUnit`)

- **Trigger:** task "Stage 1 of the SU scan screen: scan and validate only, no posting".
- **Files:** `srv/integration/s4hana/wm/Mvt261Adapter.js` (`scanContext`, `checkStorageUnit`, shared `blockers()` now used by `cycle` too, `notReadyBins`), `srv/wm/mvt261/service.cds` (types `ScanContext`, `ScanRow`, `ScanResult`; functions `scanContext`, `checkStorageUnit`), `srv/wm/mvt261/service.js`, `package.json` (`cds.s4.mvt261NotReadyBins`: OH1/ONHOLD → onHold, 901/WE-ZONE → goodsReceiptZone), `tools/check-261-scan.js` (new, read-only).
- **Change:** `scanContext` = cycle header and block checks + MAKT text, MARC batch flag, LQUA quant counts (with / without storage unit). `checkStorageUnit` re-checks the item's blockers (RESB, AUFK, JEST) and refuses before any storage-unit lookup when blocked; otherwise reads LQUA by LENUM and applies R1 (not found / no stock), R2 (material + plant), R3 (SKZUA, SKZUE, SKZSA, SKZSE, SKZSI, SPGRU; AUSME / EINME > 0), R4 (configured not-ready bins), R7 (batch from quant), R8 (storage location warning), R9 (order-bin warning). CAP exposes functions only (GET); POST → 405.
- **Validation (live, read-only, raw output in the session report):**
  - 512851/3: open 800 KG, REL; SUs 2000018193–2000018196 each accepted, 200 KG, batch INHU100005, IP1/0001002707, no warnings.
  - 471327/1: open 500 KG, REL; 1000053753 → 120 KG PTRA260007, 1000053758 → 380 KG PTRA260008 (both GS1/0002000589); 1000053755 (GS1/TRANSFER, 400 KG) accepted with `notInOrderBin`.
  - 519944/1: 2000019210, 2000019211 → rejected `onHold` (OH1 / ONHOLD).
  - 24685/2: context Blocked "order is locked", open 1 KG; scan of 1000033499 → `itemBlocked`.
  - 512851/3 with 1000053753 → `wrongMaterialOrPlant` (8400000034 / 1600 vs 1000001001 / 1130); 9999999999 → `notFound`.
  - Local `cds-serve`: both functions answer over HTTP; POST on them → 405; `/postGoodsIssue` → 404 (not exposed).
- **Result:** PASS. No write was sent to SAP. Material document 4900050046/2026 and transfer requirement 1000744 were not touched.

### 2026-10-06 02:40 IST — UI5 scan page and session rules; cycle page moved to a sub-route

- **Files:** `app/fiori-app/webapp/modules/wm/mvt261/model/ScanSession.js` (new), `.../controller/Scan261.controller.js` (new), `.../view/Scan261.view.xml` (new), `Open261.controller.js` (row opens the scan page), `manifest.json` (route `wmScan261` = `wm/mvt261/open/{reservation}/{item}`; `wmCycle261` moved to `.../cycle`), `controller/App.controller.js` (shell titles), both i18n bundles (`scan261*`).
- **Change:** header, progress (quantity and drum count), scan field (Enter submits, clears, refocuses; the value is used as the raw storage unit number, no barcode parsing; wedge scans outside the field arrive through the existing `BarcodeScanService`), scanned list with editable quantity, remove, clear all, message strip, states Loaded / Scanning / Quantity covered / Blocked, link to the cycle page. Session rules R5 (already scanned), R6 (default = quant quantity, capped at quant and remaining open quantity, "open quantity already covered"). No Post button exists.
- **Tests:** `test/unit/wm/mvt261Scan.test.js` (new, 11 tests): T1–T7, R3, R6, R10 and the no-write assertions (HTTP double throws on any call, RFC double has no function-call method, UI sources contain no write call or post handler, service defines no action). `npm test` → 131 suites, 2,096 tests passed. ESLint clean, `npx ui5lint "webapp/modules/wm/mvt261/**"` no findings, `cds compile` OK, `git diff --check` clean, `tools/reconcile-open-261.js 1120` 7/7 PASS.
- **Not validated:** browser rendering, focus handling, keyboard-only use and a real scanner (login needs the user's SAP credentials). **In Progress.**
- **UNVERIFIED:** the two not-ready bin rules (OH1/ONHOLD seen on real stock; 901/WE-ZONE seen on real stock; neither confirmed as a business rule); order-bin pattern (two cases); storage unit numbers being digits only; over-quantity fifth drum (constructed row — no fifth staged drum exists in SAP); block-flag and pending-transfer-order rejections (constructed rows — no such quant found for the test materials).
- **Note:** `postGoodsIssue` / `reverse` from the approved live test remain in the adapter and in `tools/test-261-post-cycle.js`; they are not reachable from the service or the UI and were not called.

### 2026-10-06 03:20 IST — Open 261 list: show only items where scanning is possible

- **Trigger:** user: the list at `/wm/mvt261/open` shows too many items; show only where a scan is possible.
- **Files:** `srv/integration/s4hana/wm/Mvt261Adapter.js` (`_quantNotReady` shared with `checkStorageUnit`, `_readyStorageUnits`, `openItems` adds `ScanPossible`, `ReadyStorageUnits`, `ReadyQuantity` and the `scanPossibleOnly` filter), `srv/wm/mvt261/service.cds`, `Open261.view.xml` + `Open261.controller.js` (switch "Only where scanning is possible", default on; column and export "Ready storage units"), both i18n bundles, `test/unit/wm/mvt261Scan.test.js` (2 tests).
- **Rule:** scan possible = open quantity > 0, movement allowed, order released and not locked / technically completed / closed / deletion-flagged, and at least one storage unit of the material in the plant that passes the scan rules R3 and R4 (no block flag, no pending transfer order, not in a not-ready bin). Read-only (RESB via OData, JEST and LQUA via RFC).
- **Validation (live):** plant 1120: 152 open items → 49 where scanning is possible (about 1.2–2.1 s); all plants: 392 → 144. 512851/3 and 471327/1 are in, 24685/2 (locked order) is out. Plant 1120 open count is 152, one less than before, because live test 1 final-issued 278650/1. `npm test` → 131 suites, 2,098 tests passed; ESLint and UI5 lint clean; `tools/reconcile-open-261.js 1120` 7/7 PASS.
- **Not validated:** the switch and column in a browser. **In Progress.**
- **Known limits:** readiness is per material and plant, not per storage location or order bin; it does not check that the ready quantity covers the open quantity (519944/1 counts as possible through 25 KG drums in 920/TRANSFER while its 250 KG drums are on hold).

### 2026-10-06 04:30 IST — Scan screen: FIFO storage-unit list, FIFO check, stock-category rule (read-only)

- **Trigger:** task "SU scan screen, Stage 1 (read-only, no posting)" for route `/wm/mvt261/open/375064/7`.
- **Files:** `srv/integration/s4hana/wm/Mvt261Adapter.js` (`scanContext` returns `Units`, `NoUnitQuantCount`, `NoUnitQuantity`; `_quantNotReady` rejects a filled LQUA-BESTQ), `srv/wm/mvt261/service.cds` (type `ScanUnit`), `app/fiori-app/webapp/modules/wm/mvt261/model/ScanSession.js` (`olderAvailable`, `deviations`, `units`), `Scan261.controller.js`, `Scan261.view.xml` (FIFO table, deviation count, note on stock without storage unit), both i18n bundles, `test/unit/wm/mvt261Scan.test.js` (5 tests).
- **FIFO field:** LQUA-WDATU, data element LVS_WDATU, text "Date of Goods Receipt" (read live from DD03L / DD04T). Sort: WDATU, batch, storage unit; units without a date last. FIFO warning only when an available, unscanned unit has a strictly earlier date.
- **New rule (agent's addition, flagged to the user):** LQUA-BESTQ filled (domain values read live: Q "Stock in Quality Control", S "Blocked Stock", R "Returns Stock") → status Blocked, scan rejected `stockCategory`. Effect on the "scan possible" list: plant 1120 49 → 35, all plants 144 → 123.
- **Validation (live, read-only) for 375064/7:** RESB: order 1001944, material 1000000236 (NACOL 18-94, batch-managed), plant 2100, CS01, BDMNG 1335.000, ENMNG 0.000, not deleted / final-issued; order status REL → not blocked. LQUA (warehouse W26, 6 quants): exactly **one** storage unit, 1000032202 (RM1 / 0-L0001-00, batch IN25000346, 10,000 KG, BESTQ = Q, WDATU 00000000); the 1,335 KG staged for the order sit in IP1 / 0001001944 (batch IN26002959, WDATU 2026-06-20) **without a storage unit**; 4 more quants without storage unit. Scans: 1000032202 → rejected `stockCategory` Q; 9999999999 → `notFound`; 2000018193 → `wrongMaterialOrPlant`.
- **Live FIFO tests NOT run:** "oldest first", "newer first", "until covered then one more" need at least two available storage units; 375064/7 has none. Per the task no other item was substituted; these cases are covered by unit tests on constructed rows only. **UNVERIFIED against live data.**
- **Tests:** `npm test` → 131 suites, 2,103 tests passed; ESLint clean; `npx ui5lint "webapp/modules/wm/mvt261/**"` no findings; `cds compile` OK; `git diff --check` clean. No write sent to SAP; document 4900050046/2026 and TR 1000744 untouched.
- **Not validated:** browser rendering. **In Progress.**

### 2026-10-06 10:05 IST — Refresh API Catalog & Rebuild Creatable Services Workbook

- **Trigger:** user request "Refresh API Cataloug".
- **Files:** `srv/external/all_catalog_services.json` (refreshed), `catalog-audit.csv` (re-probed), `catalog-creatable.csv` (regenerated), `tools/build-creatable-xlsx.py` (added override for `API_MATERIAL_DOCUMENT_SRV` to `MM - Inventory`), `creatable-services.xlsx` (rebuilt).
- **Execution & Findings:**
  1. `tools/refresh-catalog.sh`: pulled Gateway catalog from `/sap/opu/odata/IWFND/CATALOGSERVICE;v=2/ServiceCollection`. Services increased from 1,345 to 1,352 (+7 new services).
     - Newly added services: `API_HANDLING_UNIT`, `API_MATERIAL_DOCUMENT_SRV`, `API_PACKINGINSTRUCTION`, `C_HANDLINGUNITMONITOR_CDS`, `FDP_HU_SHIPPINGLABEL_SRV`, `FDP_LOHUM_HU_PACKINGLIST_SRV`, `UI_HANDLINGUNITHIERNODE`.
  2. `tools/audit-catalog.sh`: audited all 1,352 services via live HTTP probes.
     - 1,237 answered HTTP 200 (including `API_MATERIAL_DOCUMENT_SRV`).
     - 89 answered HTTP 500. The 6 newly added HU services return HTTP 500 with `/IWFND/CM_COS/064`: "No System Alias found for Service 'ZAPI_HANDLING_UNIT_0001' and user 'KHUSHAL'". Root cause: services were added in `/IWFND/MAINT_SERVICE` on SAP, but no System Alias (`LOCAL`) has been assigned to them yet in the System Aliases configuration pane.
  3. `tools/find-creatable.py`: scanned live `$metadata` across 1,237 accessible services.
     - 496 services have >= 1 creatable entity set.
     - 524 services have >= 1 POST function import.
     - 635 services can write (either).
     - `API_MATERIAL_DOCUMENT_SRV` verified: 1 creatable set (`A_MaterialDocumentHeader`), 2 POST function imports (`Cancel`, `CancelItem`).
  4. `tools/build-creatable-xlsx.py`: regenerated `creatable-services.xlsx` (496 services across 19 module sheets, `API_MATERIAL_DOCUMENT_SRV` mapped to `MM - Inventory`).
- **Validation:** `git diff --check` clean. Rebuilt workbook verified via openpyxl.
- **Result:** PASS. Next action: user to assign System Alias `LOCAL` to the 6 HU services in `/IWFND/MAINT_SERVICE` if they need to be called over OData.
