# WORKSTATUS

Single source of truth for work history, current status, validation, unresolved issues and next steps (see `AGENTS.md`).
The previous log was removed in commit `b741337`; this file restarts it.

## Current Status

- **Open 261 items (read-only list)** — backend validated live against SAP (393 with open quantity / 467 open in SAP, equal to RESB); UI page `#/wm/mvt261/open` built, statically validated, **not yet verified in a browser**. Posting (Phase 2) not started: no proven requirement source.
- **First Goods Issue 261 finder (read-only)** — backend complete and validated live against SAP; UI built, statically validated, **not yet verified in a browser** (login needs the user's SAP credentials).

## Unresolved Issues

1. UI page `#/wm/mvt261` not exercised in a browser (see above). Status: **In Progress**.
2. The original spec asked for ABAP RAP objects (ZI_MVT261, ZC_MVT261, DCL, V4 binding). By user decision (2026-10-05) the feature is built as CAP + UI5 on existing SAP services; no ABAP objects exist.
3. "Show a message if authorization removes rows" cannot be detected: SAP filters unauthorized plants / movement types silently inside the OData services. The UI shows a static note instead.
4. Archived material documents are not read (UI shows the SARI / MM_MATBEL hint).
5. The pasted spec ended at "6. Performance:"; later sections were never received.

## Next Steps

0. User to confirm the default definition of "open" (open quantity > 0 = 393; toggle shows all 467) and to check the page `#/wm/mvt261/open` in a browser, including Excel export.
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
