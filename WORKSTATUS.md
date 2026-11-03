# WORKSTATUS

Single source of truth for work history, current status, validation, unresolved issues and next steps (see `AGENTS.md`).

## Archive Directory

All historical change logs and past milestone statuses are preserved verbatim in dedicated archive volumes under `docs/archive/`:

| Archive Volume | Date Coverage | Size | Major Work & Deliverables |
| :--- | :--- | :--- | :--- |
| [`WORKSTATUS-archive-2026-10-22.md`](docs/archive/WORKSTATUS-archive-2026-10-22.md) | Inception to 2026-10-22 | 13,416 lines (1.93 MB) | Initial full-stack CAP & SAPUI5 baseline, SD/MM/FI/WM initial modules, S/4HANA connectivity, early live SAP tests. |
| [`WORKSTATUS-archive-2026-10-31.md`](docs/archive/WORKSTATUS-archive-2026-10-31.md) | 2026-10-22 to 2026-10-31 | 6,585 lines (1.14 MB) | ZQUAR 4x6 labels (vertical variant, Aether SVG logo, barcode & colon alignment, inspection lot), E2E hardening & concurrency, RFC preflight gate, HU stock transfer audit. |

> **Archive & Rotation Policy**: `WORKSTATUS.md` maintains active operational status, immediate next steps, and change logs for the active milestone/cycle. When `WORKSTATUS.md` reaches ~2,000 lines or upon completing a sprint milestone, completed historical logs are rotated verbatim into a time-indexed archive volume under `docs/archive/` and indexed above.

## Current Status

- **Database removal inventory (2026-11-03 14:37 IST) — BLOCKED on the user's OK and answers:** Nothing deleted. `AllowSAPtool` does not exist in this repository, and `ALLOW_LIVE_SAP_TOOLS` only gates tools, so there is no DB-or-SAP switch to remove. Posting-attempt protection cannot work on SAP reads alone with 2 production instances. See the entry of 14:37 IST below.

- **SAP-only / application database removal (2026-11-03 14:02 IST) — BLOCKED:** User selected ZAMM and will provide the development target and transport request. Live metadata confirms ZAMM exists and the currently connected client has role Test; it is not implicitly the approved development target. Required persistence contracts remain UNKNOWN. See docs/decisions/sap-only-persistence-migration.md. No runtime/database changes or SAP writes made.

- **Theme switcher in the header (2026-11-03 14:00 IST) — PASS, committed locally (`39cd7044`), not pushed:** A palette button in the `ShellBar` offers Morning Horizon, Evening Horizon, Quartz Light and Quartz Dark. The choice is saved under `app.theme`, and UI5 boots with it, so the default theme CSS is never requested. In the browser it applied without a reload, survived a refresh and a new tab, and invalid or missing values fell back to `sap_horizon`. See the Change Entry below.

- **Standard sidebar on all screens (2026-11-03 14:00 IST) — PASS, committed locally (`1b717ddd`, `0faa075e`), not pushed:** The dashboard's four tabs are a `sap.tnt.SideNavigation` in the app shell, closed by default at the user's request. The user accepted SAP's `aria-allowed-attr` ×4 from the closed sidebar into `test/e2e/a11y/baseline.json` (uncommitted). See the Change Entry below.

- **`tr-to` security fix and limited cleanup (2026-11-03) — PARTIAL, on local branch `fix/tr-to-lookup-readonly`, not pushed:** `lookupTR` no longer writes to SAP, read operations enforce plant scope, and 6 unreachable handler names and `getAvailableSUs` are removed. Backend `tr-to` stays deployed. See the Change Entry below.

- **Scan To screen removed (2026-11-03) — PARTIAL, on local branch `feature/remove-scan-to`, not pushed:** The UI at `#/wm/scan-to` is gone; old URLs show the dashboard. This was the last screen for Transfer Order create and confirm and the follow-up goods movement. Backend and database are unchanged. See the Change Entry below.

- **Reservation Entry screen removed (2026-11-03) — PARTIAL, on local branch `feature/remove-reservation-entry`, not pushed:** The UI at `#/wm/reservation-entry` is gone, and the three old URLs now show the dashboard with no console errors. Backend, API and database are unchanged. The five `verifyMvt*` browser suites and the other reservation-entry tests were then deleted at the user's request, and the backend service `/odata/v4/reservation-entry` was removed as well. `tr-to` can still post reservations through `executeReservationWarehouseFlow`. See the four Change Entries of 2026-11-03 below for what was run and what was not.

- **MIGO resend versus further issue, reservation-entry and tr-to (2026-11-03 09:55 IST) — PARTIAL, uncommitted:** A resend with the same id returns its document without posting, and a new id posts the further quantity, on both `postMigoGoodsMovement` actions. A further issue with no id gets HTTP 400 before SAP (`ClientAttemptId` on reservation-entry, `ProcessId` on tr-to). The false repeat is fixed once in `checkMigoIdempotency`. Jest: 228 suites and 4,464 tests passed, 59 skipped. SAP-free browser E2E: 3 of 3 passed; those suites do not post a goods movement. Not proven against live SAP. See Change Entry 2026-11-03 09:55 IST.

- **Reservation create (/wm/reservation-entry/create) Batch-managed material detection & BatchVH Value Help fixed (2026-11-02 17:55 IST) — PASS, uncommitted:**
  1. Root cause: In SAP S/4HANA (Client 220), material `8000006684` has `MARC-XCHPF = 'X'` (Batch management requirement indicator active in Plant 1120). Reservations for batch-managed materials require `RESB-CHARG`. `ReservationProcessAdapter.js:226-228` validates `MARC-XCHPF === 'X'` and rejects with HTTP 400 (`"Batch is mandatory for batch-managed material 8000006684"`) when batch is omitted. However, `ReservationEntryDetail.view.xml` previously displayed `inputBatch` with no required indicator, placeholder `Batch (optional)`, no value help, and no suggestion items. The user was unaware the material required a batch and had no F4 discovery of live SAP batches from `MCHB`/`MCHA` (e.g. batch `IN26001071` with 8 KG in SLoc HS01).
  2. Resolution:
     - `srv/wm/reservation-entry/service.cds`: Added `@readonly entity BatchVH` with keys `Material`, `Plant`, `Batch`, and fields `StorageLocation`, `Stock`. Added OData function `checkMaterialBatchManaged(material, plant) returns { isBatchManaged: Boolean }`.
     - `srv/wm/reservation-entry/service.js`: Implemented `READ BatchVH` handler reading `MCHB` with fallback to `MCHA` via RFC `RFC_READ_TABLE`, filtering by Material and Plant, deduplicating keys, and sorting by available unrestricted stock descending. Implemented `checkMaterialBatchManaged` querying `MARC-XCHPF` via RFC client.
     - `app/fiori-app/webapp/modules/wm/reservation-entry/service/ReservationEntryService.js`: Added `checkMaterialBatchManaged(sMaterial, sPlant)`.
     - `app/fiori-app/webapp/service/ValueHelpService.js`: Registered `"/BatchVH"` configuration metadata (`title: "Select Batch", key: "Batch", desc: "Batch", info: "StorageLocation"`).
     - `app/fiori-app/webapp/i18n/i18n.properties` & `i18n_en.properties`: Added `resPlaceholderBatchRequired`.
     - `app/fiori-app/webapp/modules/wm/reservation-entry/view/ReservationEntryDetail.view.xml`: Bound Batch label `required="{view>/isBatchRequired}"`, added `showValueHelp="true"`, `showSuggestion="true"`, `suggest=".onSuggest"`, `valueHelpRequest=".onValueHelpRequest"`, `suggestionItemSelected=".onBatchSelect"`, and dynamic suggestion items from `reservationEntry>/BatchVH`.
     - `app/fiori-app/webapp/modules/wm/reservation-entry/controller/ReservationEntryDetail.controller.js`: Implemented `_checkBatchRequirement(sMaterial, sPlant)` to query backend and update `view>/isBatchRequired`, hooked into material/plant selection and live changes, added `onBatchSelect`, added contextual filtering for `BatchVH`, and updated `validateForm()` to validate batch presence client-side when `isBatchRequired` is true.
     - `test/e2e/wm/verifyMvt311.e2e.js`: Updated dynamic Receiving SLoc test to verify that 311 defaults visible, hides upon switching to 201, and reappears upon switching back to 311.
  3. Verification: Target unit tests updated and added in `reservationEntryService.test.js` (108/108 passed) and `reservationEntryUi.test.js` (75/75 passed). All 95 WM unit suites (2,513 passed), UI5 linter (clean), UI5 build (1.19 s), root ESLint (clean), secret scan (clean), browser E2E `verifyWmScreens.e2e.js` (17/17 steps passed), and browser E2E `verifyMvt311.e2e.js` (PASS with SAP read-back evidence) PASS. See Change Entry 2026-11-02 17:55 IST.

- **Reservation create (/wm/reservation-entry/create) Movement Type synchronization fixed (2026-11-02 17:35 IST) — PASS, uncommitted:** On `#/wm/reservation-entry/create`, `ReservationEntryDetail.controller.js` initialized `MovementType: ""` in `_getDefaultCreateData()`, whereas `ReservationEntryDetail.view.xml` `<Select id="selectMovementType">` contained no blank item (`key=""`) and defaulted visually to item 0 (`311 - Storage Location Transfer`). UI5's two-way data binding does not update the model on fallback display, leaving `create>/MovementType` empty, hiding the 311 dynamic fields (Receiving Storage Location), suppressing `change` when clicking 311 in the dropdown, and causing `validateForm` to reject with `"Movement Type is required (201, 241, 311, 301, 261)"`. Updated `_getDefaultCreateData()` to default `MovementType: "311"`, aligning model and view as originally documented in controller comment (`// MovementType is the first entry of the select`). Dynamic fields for 311 are now immediately visible and validation passes cleanly. Target unit tests updated and added in `reservationEntryUi.test.js` (72/72 passed). All 95 WM unit suites (2,510 passed), UI5 linter (clean), UI5 build (1.29 s), root ESLint (clean), secret scan (clean), and browser E2E `verifyWmScreens.e2e.js` (17/17 steps passed including Reservation entry create) PASS. See Change Entry 2026-11-02 17:35 IST.

- **Dead-Code Cleanup (Medium-Confidence Candidates: sapFacts.js, obsolete requires, tools audit) (2026-11-02 17:15 IST) — PASS, uncommitted:**
  1. `srv/integration/s4hana/sapFacts.js`: Removed 8 unused dead exports (`MESSAGES`, `RFBSK`, `STATV`, `REFERENCE_PERSISTED_MOVEMENT_TYPES`, `systemUtcOffsetMinutes`, `sapLocalToEpochMs`, `rfcMessageId`, `_resetForTests`) and dead internal state (`offsetPromise`), reducing file from 106 lines to 26 lines. Retained `parseSapNumber` with defensive dash handling. Added dedicated unit test suite `test/unit/wm/sapFacts.test.js` (6/6 tests passing).
  2. `srv/integration/s4hana/wm/goods-issue/BaseGoodsIssueClient.js`: Removed obsolete unused require `const LOG = require('../../logger')('goods-issue-client');`.
  3. Secret Scanner: Redacted real user name in historical LTAK BNAME to `BNAME: 'SAP_USER_22'` to keep repository secret scanner 100% clean (`scanSecrets.test.js` 13/13 passing).
  4. Tools Audit: Audited all 58 JS tools in `tools/` and shell/Python scripts; verified all 58 pass `node --check` syntax check and require resolution. Classified them into active/dormant live SAP test scripts, ADT deployers, and catalog verification tools; preserved them as non-destructive developer tooling per `AGENTS.md`.
  5. Verification: All 227 Jest test suites (4,446 tests passed, 59 skipped, 0 failed), all 95 WM unit suites (2,509 tests passed, 56 skipped), root ESLint (clean), UI5 linter (clean), UI5 build (1.33 s), and browser E2E `verifyWmScreens.e2e.js` (16/16 steps passed) PASS. See Change Entry 2026-11-02 17:15 IST.

- **Reservation entry list (/wm/reservation-entry) Date resolution & formatting fixed (2026-11-02 17:00 IST) — PASS, uncommitted:** In `ReservationEntryList.view.xml`, the date display line under Created By used an invalid OpenUI5 nested expression binding `text="{= ${view>createdAt} ? ${path: 'view>createdAt', formatter: '._formatDateIso'} : (${view>ReservationDate} || '') }"`, which caused UI5 expression parsing to fail and evaluate to empty string. Furthermore, for open SAP reservations fetched via `getOpenReservations`, `GoodsIssueReservationsClient.js` did not include `MatlCompRequirementDate` in `OPEN_RESV_SELECT`, `service.cds` omitted `ReservationDate : Date;` on `OpenReservationRow` and `ReservationDetailRow`, and `service.js` did not map `ReservationDate`. In `ReservationEntryList.controller.js`, `_formatDateIso` was expanded to format compact SAP `YYYYMMDD` (`20261016` from `RKPF-RSDAT`), OData `/Date(ms)/`, and ISO strings into `YYYY-MM-DD`, with composite fallback `(ReservationDate, createdAt)`. View binding updated to standard `{parts: [{path: 'view>ReservationDate'}, {path: 'view>createdAt'}], formatter: '._formatDateIso'}`. Target unit tests added and updated in `goodsIssueClients.test.js` (24/24 passed), `reservationEntryService.test.js` (99/99 passed), and `reservationEntryUi.test.js` (116/116 passed). All 94 WM unit suites (2,503 passed), root ESLint (clean), UI5 linter (clean), UI5 build (1.19 s), and browser E2E `verifyWmScreens.e2e.js` (16/16 steps passed including Reservation entry list with 443 rows) PASS. See Change Entry 2026-11-02 17:00 IST.

- **Warehouse scan-to open TR list completed-TR leak fixed (2026-11-02 16:40 IST) — COMMITTED (`cd317a3d`):** `getOpenTRs` previously queried `LTBK` with `"AND STATU <> 'E'"` only. In SAP S/4HANA WM, transfer posting / posting change TRs (e.g. movement 311 `0001000992` created by MATDOC `4900050356` and processed via TO `0001037677`) receive `STATU = 'U'` upon completion, leaking into the open TR list and sorting to row 1. `TrToAdapter.js` now filters `STATU <> 'E'` AND `STATU <> 'U'` in both the `LTBK` query and in-memory list/lookup/candidate checks. `WarehouseScanToDetail.controller.js` guards against `oDetail.Status === 'U'`. Unit tests added in `trToAdapter.test.js` (79/79 passed) and `warehouseScanToUi.test.js` (67/67 passed); all 94 WM unit suites (2,500 tests passed) and full browser E2E `verifyWmScreens.e2e.js` (16/16 steps passed) and `roundTripScanTo.e2e.js` (createTO passed). See Change Entry 2026-11-02 16:40 IST.

- **Reservation list hid SAP GUI reservations on its first page (2026-11-02 16:17 IST) — PASS for the list fix, uncommitted:** `#/wm/reservation-entry` listed app-tracked rows before SAP-only rows and shows 25 rows at a time, so the newest SAP reservation sat at row 28. The merged list now sorts newest reservation first. Which screen problem the user meant by "GUI based Entry" is INFERRED. See Change Entry 2026-11-02 16:17 IST.

- **Missing i18n keys added (2026-11-02 15:52 IST) — PASS, merged to local `feature01`, not pushed:** 10 literal keys that neither bundle defined now exist in both, plus 1 new key that keeps the invoice wording separate, and no literal `i18n>key` or `getText("key")` is unresolved. Only `huNoSelection` could show a raw key before; the other 9 already showed fallback text, and those messages read the same now. Jest 226 suites passed, 1 skipped; 4,432 tests passed, 59 skipped; `ui5lint` clean. No SAP call was made, and the messages were not triggered on live screens.

- **Quarantine labels E2E case fixed (2026-11-02 15:52 IST) — PASS, merged to local `feature01`, not pushed:** `npm run test:e2e:sap-free` now passes 3 of 3 suites, on 3 runs in a row. The screen was correct; two checks in the test had gone out of date when the label layout changed. Only the test file changed. GitHub Actions has not run this. This supersedes the "2 of 3 suites" result in the cleanup line below. See the Changes Log entries of 2026-11-02 15:49, 15:52 and 15:58 IST.

- **Dead-code cleanup, 7 removal batches (2026-11-02 15:45 IST) — PARTIAL, uncommitted:** 1,354 lines removed across 37 files, including 2 deleted files and 474 unused i18n keys, with no intended behaviour change. Jest is unchanged from baseline (226 suites and 4,428 tests passed, 59 skipped). SAP-free browser E2E is also unchanged at 2 of 3 suites: one Quarantine labels case fails the same way before and after the cleanup. The other 20 browser suites were not run. See Change Entry 2026-11-02 15:45 IST.


- **ZQUAR 4x6 Quarantine Label Production Format & Movement 261 BusinessConfig (2026-10-31 IST) — BASELINE CONFIRMED:** Full ZQUAR 4x6 label layout (vertical left strip, official Aether SVG corporate vector logo, colon alignment on uniform vertical axis, centered barcode, 14 field rows) and Plant 1120 / Warehouse W01 BusinessConfig bootstrap operational. Detailed implementation history, measurements, and evidence archived in [`WORKSTATUS-archive-2026-10-31.md`](docs/archive/WORKSTATUS-archive-2026-10-31.md).

## Next Steps

- Database removal (2026-11-03): the user approves the delete list and answers the questions on posting attempts, sales defaults and local data. Deletion starts only after that, on branch `chore/remove-application-db`.

- SAP-only migration: await the development target and workbench transport request the user will provide; ZAMM is selected. Then establish verified replacement contracts for durable posting claims, tracking and settings as specified in docs/decisions/sap-only-persistence-migration.md. Preserve existing data until migration and retention are settled.

- Accessibility baseline (2026-11-03): commit `test/e2e/a11y/baseline.json` and `WORKSTATUS.md` when the user asks. If a later UI5 version stops setting `aria-selected` on these items, remove the rule from the baseline.
- Theme switcher (2026-11-03): committed locally as `39cd7044`, not pushed. The Aether logo is nearly invisible on dark themes; decide whether to fix it separately.

- `tr-to` (2026-11-03): review `fix/tr-to-lookup-readonly` and decide about merging. Check outside callers of `/odata/v4/tr-to` with API owners. Decide about `createTO`, `_createTO`, `checkSU`, `tools/test-rfc-trto.js` and the `scan-to` flow entry. `getAvailableSerials` is still not limited by plant in its SAP read.

- Scan To removal (2026-11-03): review `feature/remove-scan-to` and decide whether to merge it. `/odata/v4/tr-to` now has no screen calling it but stays deployed and can post to SAP. Decide about it separately, and check for outside callers first.

- Reservation Entry removal (2026-11-03): review `feature/remove-reservation-entry` and decide whether to merge it. Before merging, check for outside callers of `/odata/v4/reservation-entry`. Any production drop of the `ReservationCreateAttempt` table needs a data export and a written go. This screen was the only UI for creating a reservation entry or retrying a failed reservation step.

- MIGO resend versus further issue (2026-11-03): commit when the user asks, then restart the local CAP server to load it. Live proof needs a written go: post a partial issue, resend the same id, post a further issue with a new id, and read MATDOC and RESB back. Decide whether one Transfer Order may have more than one goods movement; today a new id on the same TO posts again.

- Reservation create batch detection & Value Help (2026-11-02 17:55 IST): RESOLVED (PASS, uncommitted). Batch management dynamically detected via `checkMaterialBatchManaged`, Batch marked mandatory on batch-managed materials, `BatchVH` value help implemented reading `MCHB`/`MCHA` stock, unit tests (108/108 service, 75/75 UI) and browser E2E (17/17 screens, verifyMvt311) pass. Commit when the user asks.
- Reservation create Movement Type default (2026-11-02 17:35 IST): RESOLVED (PASS, uncommitted). Model and Select dropdown synchronized with `MovementType: "311"`; unit tests (72/72) and browser E2E (17/17) pass. Commit when the user asks.
- Reservation list date display (2026-11-02): RESOLVED (2026-11-02 17:00 IST). Date resolved and formatted on `#/wm/reservation-entry` across UI XML, controller formatter, CAP service mapping, and S/4HANA OData client; verifyWmScreens 16/16 steps PASS. Commit when the user asks.
- Reservation list (2026-11-02): user confirms the fix on `#/wm/reservation-entry` after a browser refresh; commit when the user asks.
- Warehouse scan-to detail (2026-11-02): RESOLVED & COMMITTED (`cd317a3d`). Completed TR 1000992 with LTBK-STATU = 'U' excluded from open TR list.
- Missing i18n keys (2026-11-02): pushed to `origin/feature01` (`3aa2ad95`). The new test in `uiConsistency.test.js` fails on any new literal key that is not in both bundles.
- Quarantine labels E2E (2026-11-02): the fix is pushed to `origin/feature01` (`3aa2ad95`). CI run 41429280039 on `3aa2ad95` passed, including `Build, Test & Validate` and `Browser E2E, SAP-free suites (PR gate)`. The separately controlled SAP validation and 23-suite browser jobs were skipped.
- Dead-code cleanup (2026-11-02 17:15 IST): PASS (uncommitted). Cleaned unused exports from `sapFacts.js`, removed obsolete `LOG` require from `BaseGoodsIssueClient.js`, added `sapFacts.test.js` (6/6 tests), audited `tools/` scripts, and verified full Jest (227 suites / 4,446 tests) and browser E2E (16/16). Commit when the user asks.
- **URGENT, user action (2026-11-02):** The SAP password in `S4_PASSWORD` was committed in `2256822d` to `origin/feature01`, and the GitHub API answers 200 without login, so the repository appears public. Change that SAP password and update `.env.local`. Treat the two other removed values as exposed too. Removing them from the current files does not remove them from Git history; rewriting history needs a separate decision and a force push.
- Live proof (2026-11-02): reversal of 4900050046/2026 is DONE and read back from SAP (262 document 4900050348/2026). The live 261 post is PROVEN on reservation 528779/1 (document 4900050350/2026, read back from SAP); serial-managed materials are still unsupported by this flow. The goods receipt is PROVEN on inbound delivery 0180000137 (document 5000005789/2026, read back from SAP) for a full quantity on an unpacked delivery; partial receipts are refused. Scan-to is proven for TO create and confirm on TR 1000982 (TO 1037664, read back from SAP); automatic MIGO and Retry MIGO are not. Route count from `docs/e2e-coverage-matrix.md`: 7 proven, 2 partial, 12 not proven. Each later run needs read-only data discovery and its own written go. A live reservation goods movement should prove the new `BKTXT` replay check (audit finding 10).

- Goods receipt (2026-11-02): the storage-unit path now checks the delivery's plant (audit finding 6). Deploy note: `ReservationItem` widens from String(4) to String(6) on HANA.

- Movement 261 (2026-11-02): decide whether the Scan 261 screen should send a client attempt id, which is the only way to tell a repeat of a confirmed posting from a new partial issue of the same quantity.

- MIGO guard (2026-11-02): decide whether an empty LTAK result (Transfer Order not found) should stop posting on either path. The guard code is in local commit e4393ce5, not pushed. An end-to-end action run needs a written go; it should use a TR with `MBLNR` set, so nothing is posted if the guard works.

- P-1: commit and push the SAP-free PR gate, confirm `browser-e2e-sap-free` runs green on GitHub Actions, then mark it a required status check in branch protection (repo settings, user action). Follow-up for a fuller gate: a deterministic S/4 fixture backend so the 20 SAP-reading suites can run per PR.

- Restart the existing local CAP process using its current environment (running metadata still omits Material), refresh Quarantine Labels and regenerate PDF; verify real material code, signed-in Prepared by, and physical print margins.

- Restart the local CAP server if it has not reloaded the updated LabelRow contract, refresh Quarantine Labels, and generate a custom label with live data to verify Item Code; physical print remains pending.

- List latency (2026-10-28): user decides which findings to fix: duplicate list/metrics requests (PO, Sales Inquiries/Orders, Customer Returns), unpaged WM reads (`handling-unit/list` 586 KB, `getOpenReservations` 208 KB), `$top=0` returning every row. Each needs a plan and a before/after profile.

## Changes Log

### 2026-11-03 14:00 IST — Accessibility baseline: closed sidebar accepted: PASS

- **Status:** PASS. Not committed. No SAP write was made.
- **Why:** The user chose to accept the violation into the baseline rather than open the sidebar by default.
- **Changes:** `test/e2e/a11y/baseline.json`: added `"aria-allowed-attr": 4` to the 17 signed-in routes. Edited by hand rather than with `E2E_UPDATE_BASELINE=1`, so no other recorded count moved. App code is unchanged.
- **Test decision:** TEST UPDATED (the baseline).
- **Executed validation:**
  - `TARGET_URL=http://localhost:4010 node test/e2e/runAllE2E.js --only=a11y --workers=1`: Total 1, Passed 1, Failed 0; 18 of 18 routes passed.
  - `npx jest --silent`: 225 suites passed, 1 skipped; 4,153 tests passed, 59 skipped. `git diff --check`: clean.
  - The other 16 browser suites were not rerun: they passed in the full run on the same app code, and only the a11y suite reads this file. So 17 of 17 passed across two runs, not in one run.
- **Known limit:** The suite compares rule ids per route, not node counts, so this rule growing past 4 nodes on a route would not fail it.
- **Next action:** Commit when the user asks.

### 2026-11-03 13:56 IST — Theme switcher in the header: PARTIAL

- **Status:** PARTIAL. Committed as `39cd7044` under the git user, not by the agent; not pushed. The tested code equals that commit (`git diff HEAD -- app test` is empty). The theme tests pass, but the full browser run has one failing suite, explained in the sidebar entry below. No SAP write was made.
- **Why:** The user asked for a header theme control whose choice survives every load and refresh.
- **Changes:**
  - New `service/ThemeService.js`: list of themes, saving under `app.theme`, restoring, invalid-value fallback, storage access in try/catch.
  - New `themeStartup.js`, loaded by `index.html` before `sap-ui-core.js`: sets `window["sap-ui-config"].theme`. `data-sap-ui-theme` removed from `index.html`. An external file because `ui5lint` flagged an inline script (`csp-unsafe-inline-script`).
  - `Component.js`: restores the theme before base init, for entry points that skip `index.html`.
  - `CommonHeader.fragment.xml`: `OverflowToolbarButton` and a single-select `Menu`. `App.controller.js`: `onThemeMenuPressed`, `onThemeSelected`, `/theme` in `shellModel`.
  - `i18n.properties` and `i18n_en.properties`: 5 new keys.
- **Theme availability:** all 4 themes returned HTTP 200 for `library.css` of `sap/ui/core`, `sap/m`, `sap/f`, `sap/tnt`, `sap/uxap`, `sap/ui/comp` on UI5 1.136.22 (24 of 24).
- **Dependencies:** none added. `sap/ui/core/Theming` is part of UI5.
- **Test decision:** TEST ADDED and TEST UPDATED: new `themeService.test.js`, `AppController.test.js`, `componentAuthGate.test.js`, `verifyShellScreens.e2e.js`.
- **Failures found and fixed on the way:** the first browser run failed on every screen because `MenuItemGroup` has no default aggregation (`Cannot add direct child`); an explicit `<items>` fixed it. A test regex also failed on `>` inside bindings, and was fixed.
- **Executed validation (final code):**
  - `npx jest --silent`: 225 suites passed, 1 skipped; 4,153 tests passed, 59 skipped.
  - `npx eslint --max-warnings 0 .`: clean. `npm --prefix app/fiori-app run lint`: clean. `npm --prefix app/fiori-app run build`: succeeded, and `dist` contains `themeStartup.js`. `node tools/scan-secrets.js`: 0 found. `git diff --check`: clean.
  - `npm run test:e2e:sap-free`: 3 of 3 passed.
  - `TARGET_URL=http://localhost:4010 node test/e2e/runAllE2E.js`: Total 17, Passed 16, Failed 1 (`Accessibility (axe-core)`). SAP read-only; writes guarded or mocked. Shell suite passed, including theme selection without reload, refresh, new tab, no default theme CSS request, invalid and missing values.
- **Not covered:** `npm run test:e2e:sap` not run. The a11y suite scans the default theme only. Dark themes were looked at by screenshot on the dashboard and purchase orders only. No check with a real blocked-storage browser (unit test only). The FLP preview path through `Component.js` was not opened.
- **Finding, not changed:** The Aether logo is nearly invisible on dark themes.
- **Next action:** The user decides about the accessibility baseline.

### 2026-11-03 13:15 IST — Standard sidebar on all screens: PARTIAL

- **Status:** In Progress. Not committed. No SAP write was made; browser runs read from SAP behind the write guard.
- **Why:** The user asked to move the `#/dashboard` tabs into a standard UI5 sidebar, and chose all screens over the dashboard only.
- **Changes:**
  - `App.view.xml`: root is now `sap.tnt.ToolPage`, with the `ShellBar` in `header`, `SideNavigation` in `sideContent` and `<App id="app">` in `mainContents`.
  - `App.controller.js`: `_getSideNavKey` picks the highlight from the route's first segment (`mm`, `sd` and `le`, `wm`); added `onSideNavItemPress` and `onMenuButtonPressed`. A phone closes the sidebar after a selection.
  - `CommonHeader.fragment.xml`: `ShellBar` menu button turned on.
  - `Dashboard.view.xml`: `IconTabBar` replaced by four `VBox` sections shown by `selectedTab`. Tile IDs are unchanged.
  - `Dashboard.controller.js`: section comes from the route, an unknown section shows the overview, and figures reload only on arrival from another screen. `onTabSelect` removed as unused; `switchToTab` now navigates.
  - `manifest.json`: added `sap.tnt`; `dashboard` pattern is now `dashboard/:section:`. `i18n.properties` and `i18n_en.properties`: added `sideNavAriaLabel`. `docs/e2e-coverage-matrix.md`: `dashboard` row updated.
  - `screenCheck.js`: `openSession` takes `contextOptions`, used for the phone check.
- **Dependencies:** `sap.tnt` is part of the pinned UI5 1.136.22 on the CDN, and no existing library has a sidebar with this layout. No npm package was added.
- **Test decision:** TEST ADDED and TEST UPDATED: `AppController.test.js`, `dashboardMetrics.test.js`, `verifyShellScreens.e2e.js`.
- **Executed validation:**
  - `npx jest`: 224 suites passed, 1 skipped; 4,136 tests passed, 59 skipped. Run before the one-line ESLint comment added to `verifyShellScreens.e2e.js`.
  - `npm run lint`: first run 4 errors in the new E2E file (`document` and `window` undefined), fixed; rerun clean.
  - `npm --prefix app/fiori-app run lint`: clean. `npm --prefix app/fiori-app run build`: succeeded. `git diff --check`: clean.
  - `TARGET_URL=http://localhost:4010 node test/e2e/runAllE2E.js --only=shell --workers=1`: PASS, 21 of 21 steps.
- **Not covered:** No check that the sidebar is usable on a real phone or tablet; the phone check is an emulated Android browser. Screens were looked at by screenshot only for dashboard, purchase orders, rack demo, login and phone.
- **Update 2026-11-03 13:56 IST:**
  - The user asked for the sidebar closed by default: `sideExpanded="false"` in `App.view.xml`, covered by new shell E2E steps. These edits were committed as `1b717ddd` and `0faa075e` under the git user, not by the agent.
  - Browser runs: the first full run was stopped by the agent because its code was superseded, and is not a result (its Accessibility suite had passed with the sidebar open). The next was stopped by the user or the app. A run from terminal `ttys008` ended without writing a summary. Neither counts as evidence.
  - Full run on the final code (with the theme switcher): Total 17, Passed 16, Failed 1.
  - **FAIL:** `Accessibility (axe-core)`: new `aria-allowed-attr` ×4 on 17 routes. Root cause: with the sidebar closed, `sap.tnt.NavigationListItem` renders `role="menuitemradio"` and still sets `aria-selected` (UI5 1.136.22 `NavigationListItem-dbg.js:790-793`). With the sidebar open, axe reports 0 of these. Baseline not edited.
- **Next action:** The user decides between accepting this in `baseline.json` and opening the sidebar by default.

### 2026-11-03 — Scan To removal and `tr-to` fixes merged into `feature01`: PARTIAL

- **Status:** PARTIAL. Merged locally by fast-forward at the user's request. Not pushed. Outside API callers are not verified, and the `lookupTR` fix was not proven against a real status-E TR in SAP.
- **Changes:** `feature01` moved to `fix/tr-to-lookup-readonly`, which includes `feature/remove-scan-to`. Both branches were kept.
- **Executed validation:** the merged tree hash equals the verified branch tree. No test was rerun, because the code is identical. See the Orders Due entry below for the 17 of 17 browser run on `af656790`.
- **Next action:** Check outside callers before pushing. Pushing needs the user's request.

### 2026-11-03 — Orders Due scroll error fixed: PASS for this screen

- **Status:** PASS for the screen error. The branch stays PARTIAL overall for the reasons in the `tr-to` entry below.
- **Why:** Scrolling before a plant was set raised an uncaught error from the suspended table, which made the LE browser suite fail intermittently.
- **Changes:** `OrdersDueForDelivery.view.xml` starts with `growingScrollToLoad="false"`; `OrdersDueForDelivery.controller.js` turns it on after `resume()`. `verifyLeScreens.e2e.js` scrolls before a plant is set and checks scrolling loads more rows afterwards. `ordersDueForDeliveryController.test.js` and `docs/e2e-coverage-matrix.md` updated.
- **Test decision:** TEST ADDED and TEST UPDATED.
- **Executed validation:**
  - The new browser step failed before the fix with the same page error, then passed 5 of 5 after it.
  - On `af656790`: clean `npm run build`, `npx cds build --production` to a scratch folder, UI5 lint, `npx eslint --max-warnings 0 .`, `node tools/scan-secrets.js`, `npm run validate:mta`, `git diff --check`: clean.
  - `npx jest --silent --runInBand`: 224 suites passed, 1 skipped; 4,127 tests passed, 59 skipped.
  - `npm run test:e2e:sap-free`: 3 of 3 passed.
  - `TARGET_URL=http://localhost:4010 npm run test:e2e`: Total 17, Passed 17, Failed 0 (SAP read-only; writes guarded or mocked).
- **Next action:** The user reviews `fix/tr-to-lookup-readonly` and decides about merging.

### 2026-11-03 — Orders Due intermittent E2E failure diagnosed: root cause found, not fixed

- **Status:** Diagnosis only. No code changed. No SAP write was made.
- **Evidence:** The trace of the failed run shows `_onScroll` → `onScrollToLoad` → `requestNewPage` → `updateItems` → `getContexts` → `checkSuspended`.
- **Root cause:** `OrdersDueForDelivery.view.xml` has `growingScrollToLoad="true"` on a table whose binding starts `suspended: true`. A scroll event before a plant is set makes UI5 request the next page from the suspended binding, which throws an uncaught error. This corrects the earlier inferred `filter`/`refresh` cause in the final report of the `tr-to` work.
- **Reproduced in a browser (test login, port 4010, write guard on):** no plant and no scroll, 0 page errors; no plant with scroll, 1 page error (2 of 2 runs); plant set with scroll, 0 page errors. Because a scroll depends on page timing, the LE suite fails only sometimes.
- **Origin:** the suspended binding came with `82060ce2` (2026-10-26). This work did not introduce it. The `tr-to` branch did not change this screen.
- **Recommended fix, not applied:** start with `growingScrollToLoad="false"` and enable it after `resume()` in `_loadForPlant`.
- **Next action:** The user decides whether to apply the fix.

### 2026-11-03 — `tr-to` lookupTR read-only, plant scope, limited removal: PARTIAL

- **Status:** PARTIAL. Tested with SAP writes mocked or guarded. Outside callers are not verified, and the fix was not proven against a real status-E TR in SAP.
- **Why:** Audit finding 5: a Viewer could trigger `Z_WM_TR_CREATE` through `lookupTR`. The user approved option (b) and a limited removal.
- **Branch:** `fix/tr-to-lookup-readonly`, from `feature/remove-scan-to`. Not pushed.
- **Changes:**
  - `TrToAdapter.lookupTR`: returns `RecoveryRequired: true` and `RecoveryMessage` instead of recovering. `createTOFromTR` keeps the recovery. `service.cds`: 2 new `TRDetail` fields.
  - `trTo.handler.js`: `lookupTR`, `getTR` and `verifyReservation` answer 404 for a document outside the user's plants. `getOpenTRs` and `getFifoBatches` refuse an out-of-scope warehouse with 403. `getFifoBatches`, `getAvailableSerials`, `verifyMaterialDocument` and `verifyStock` require a plant of the user's own for non-Admins.
  - `TrToAdapter.assertWarehouseInScope`: new.
  - Removed: 6 handler registrations with no service definition; `getAvailableSUs` and its 3 tests.
  - `test/unit/wm/trToLookupReadOnly.test.js`: new; `trToHandler.test.js`, `trToAdapter.test.js`, `test/support/trToHandlerAsAdmin.js` updated.
- **Test decision:** TEST ADDED and TEST UPDATED.
- **Executed validation:**
  - Read-only tests against the old adapter: 2 of 4 failed, so they catch the old write.
  - `npx jest --silent --runInBand`: 224 suites passed, 1 skipped; 4,127 tests passed, 59 skipped.
  - `npm run build` in `app/fiori-app`, `npx cds build --production` to a scratch folder, `npx eslint --max-warnings 0 .`, `node tools/scan-secrets.js`, `npm run validate:mta`, `git diff --check`: clean.
  - `npm run test:e2e:sap-free`: 3 of 3 passed.
  - `TARGET_URL=http://localhost:4010 npm run test:e2e` on `2e6cda74`: **Total 17, Passed 16, Failed 1** (SAP read-only; writes guarded or mocked). FAIL: LE screens, "Orders due, no Plant attribute: nothing requested until a plant is set", with the page error "Must not call method when the binding's root binding is suspended" on `/OrdersDueForDelivery`.
  - Repeat on `1eb76853`: `verifyLeScreens.e2e.js` alone passed 6 of 6, then `npm run test:e2e` passed Total 17, Passed 17, Failed 0.
  - **Failure classed as intermittent, cause UNKNOWN:** 1 failure in 8 LE runs on this code. No file under `app/` changed since `71ddf805`, which passed 17 of 17, and this branch changed only `tr-to` backend files. It was not reproduced on purpose, and it is not proven to exist before this branch.
- **Finding:** `OutboundDeliveryAdapter.js:120` passes `fields`, not `flow`, so nothing in `srv` passes `scan-to`. The entry was kept, as instructed.
- **Known limit:** `getAvailableSerials` reads `EQUI` by material only, so a plant check limits who may ask, not which serials return. `verifyStock` checks the plant named in the request; it was not proven to compare that plant with the document.
- **Not run:** `npm run test:e2e:sap`, including the HU and goods receipt round trips.
- **Next action:** The user reviews the branch and decides about merging.

### 2026-11-03 — Scan To screen removed: PARTIAL

- **Status:** PARTIAL. Live SAP behaviour and outside API callers are not verified. No SAP write was made.
- **Why:** The user asked to remove the feature at `#/wm/scan-to`, and approved the classified list and both decisions: remove the last Transfer Order screen, and keep `tr-to` backend tests.
- **Branch:** `feature/remove-scan-to`, from `feature01`. Not pushed.
- **Deleted:** `app/fiori-app/webapp/modules/wm/warehouse-scan-to/` (7 files), `test/unit/wm/warehouseScanToUi.test.js`, `test/e2e/wm/roundTripScanTo.e2e.js`, `docs/images/scan_to_landing_1280px.png`, `docs/images/scan_to_landing_360px.png`.
- **Changed:**
  - `manifest.json`: 3 routes, 2 targets, `trTo` model and data source.
  - `App.controller.js`, Dashboard controller and view, `AuthService.js`.
  - 153 keys from each i18n bundle.
  - `verifyWmScreens`, `verifyActionFailures`, `runSapRoundTrips`, `wmRoundTripKit` (`postReadOnlyAction` removed), both baselines, `testData.example.json`.
  - `componentAuthGate`, `movement261UnifiedLifecycle` and `migoClientAttempt` tests.
  - `docs/e2e-coverage-matrix.md`: rows removed. Its totals were stale and are now counted from the rows.
  - `docs/abap/flow-decision.md`.
- **Test decision:** TEST UPDATED.
- **Executed validation:**
  - Deleted `dist`, `coverage`, `gen` and caches. `npm run build` in `app/fiori-app` succeeded, with 0 feature matches in `dist`.
  - `npx cds build --production` to a scratch folder succeeded. Feature words remain only in the 3 backend files listed below.
  - `npm run lint` in `app/fiori-app`, `npx eslint --max-warnings 0 .`, `node tools/scan-secrets.js`, `npm run validate:mta`: clean.
  - `npx jest --silent --runInBand`: 223 suites passed, 1 skipped; 4,108 tests passed, 59 skipped.
  - `npm run test:e2e:sap-free`: 3 of 3 passed.
  - `TARGET_URL=http://localhost:4010 npm run test:e2e` on `71ddf805`: Total 17, Passed 17, Failed 0 (SAP read-only; writes guarded or mocked).
  - Browser, test login: `#/wm/scan-to`, `/TR/1000757` and `/W01/TR/1000757` show the dashboard, with 0 console errors, 0 network errors and 0 blocked writes; no tile on the Warehouse tab.
- **Kept:** `WORKSTATUS.md`, `docs/archive/`, `srv/common/BusinessConfigResolver.js`, `srv/integration/s4hana/wm/TrToAdapter.js`, `srv/integration/s4hana/wm/ReservationProcessAdapter.js`, `test/unit/common/BusinessConfigResolver.test.js`, and shared `BarcodeScanService.js` and `.rfScanInput`.
- **Not run:** `npm run test:e2e:sap`, which needs a written go for live runs. `knip` and `ts-prune` are not installed.
- **Next action:** The user reviews the branch and decides about merging, and separately about the `tr-to` backend.

### 2026-11-03 — Reservation Entry removal merged into `feature01`: PARTIAL

- **Status:** PARTIAL. Merged locally by fast-forward at the user's request. Not pushed. Outside API callers and the production table are not verified, and no live SAP write was proven.
- **Changes:** `feature01` moved to `feature/remove-reservation-entry-final`. Both removal branches were kept.
- **Executed validation:** the merged tree hash equals the audited branch tree. No test was rerun, because the code is identical. See the final audit entry below.
- **Next action:** Check outside API callers before pushing. Pushing needs the user's request.

### 2026-11-03 10:58 IST — Final Reservation Entry audit: PARTIAL

- **Status:** PARTIAL. The frontend, tests, tools and config have no feature reference. The word search cannot reach zero, by user decision. No live SAP write was proven, and outside API callers and the production table are not verified.
- **Why:** The user asked for a final exhaustive audit and accepted the recommended answers: keep history, ABAP and SQL files, and use a new branch from the existing tip.
- **Branch:** `feature/remove-reservation-entry-final`, not pushed.
- **Deleted:** `test/e2e/support/uiReady.js` and `test/e2e/support/shots.js`, used only by the removed suites.
- **Changed:** the `test/e2e/wm/screenshots/` path was removed from `.github/workflows/ci.yml` and `.gitignore`.
- **Test decision:** EXISTING TEST SUFFICIENT: full Jest and `verifyWmScreens.e2e.js`.
- **Executed validation:**
  - Deleted `dist`, `coverage`, `gen` and caches, then `npm run build` in `app/fiori-app`: succeeded, with 0 feature matches in the fresh `dist`.
  - `npx cds build --production` to a scratch folder: succeeded, with 0 feature matches.
  - `npm run lint` in `app/fiori-app`, `npx eslint --max-warnings 0 .`, `node tools/scan-secrets.js`, `npm run validate:mta`: clean.
  - `npx jest --silent --runInBand`: 224 suites passed, 1 skipped; 4,176 tests passed, 59 skipped.
  - `npm run test:e2e`: 17 of 17 passed; see the entries below for which commit it ran on. `npm run test:e2e:sap-free` on the new tip: 3 of 3 passed.
  - Browser, test login, port 4010: `#/wm/reservation-entry`, `/create` and `/0000525278/0001` show the dashboard, with 0 console errors, 0 network errors and 0 blocked writes. The Warehouse tab has no Reservation Entry tile.
- **Remaining feature-name lines:** `WORKSTATUS.md`, `docs/archive/`, 5 `docs/abap/z*_res_entry*` files and 2 `db-migrate-20261021-*.sql` files. `srv/wm/readScope.js:18` also says `ReservationEntries`.
- **Not run:** `npm run test:e2e:sap`, which needs a written go for live runs. `knip` and `ts-prune` are not installed, so unused exports were checked by script only.
- **Next action:** The user checks outside API callers and the production table, then decides about merging.

### 2026-11-03 — Correction: branch moved during the full browser run

- **Status:** Correction to the full browser E2E entry below. No code changed in this entry.
- **What happened:** While the run was in progress, the working tree moved to a new branch, `feature/remove-reservation-entry-final`, with 2 new commits: `5b99d041` deleted `test/e2e/support/uiReady.js`, and `86771016` deleted `test/e2e/support/shots.js` and its paths in `.gitignore` and `.github/workflows/ci.yml`. The source of those commits is UNKNOWN; this session did not make them. The result commit `b12d18d8` landed on that new branch, not on `feature/remove-reservation-entry` (still at `ae945e76`).
- **Effect on the result:** The 17 of 17 run started before those commits and ended after them (summary written 10:52:58 IST; commits at 10:41 IST), and its server was started from `ae945e76`. The commits change no app or backend code, and no file in `test/e2e` requires the deleted helpers. The full run was not repeated on the branch tip.
- **Executed validation on the tip of the new branch:**
  - `npx jest --silent --runInBand`: 224 suites passed, 1 skipped; 4,176 tests passed, 59 skipped.
  - `npx eslint .`: clean.
  - A check of relative requires in `test/e2e`: none missing.
  - `npm run test:e2e:sap-free`: 3 of 3 passed.
- **Next action:** The user confirms which branch to keep.

### 2026-11-03 — Full browser E2E after the removal: PASS for this run

- **Status:** The browser run passed. The branch stays PARTIAL overall, because no live SAP write was proven and outside API callers and the production table are not verified.
- **Executed validation:** `TARGET_URL=http://localhost:4010 npm run test:e2e`, on a fresh server from `feature/remove-reservation-entry`: Total 17, Passed 17, Failed 0. SAP use was read-only; writes were guarded or mocked.
- **Not run:** `npm run test:e2e:sap`, including live round trips, because each live run needs a written go.
- **Changes:** this log entry only.
- **Next action:** The user decides about merging into `feature01`, after checking for outside API callers.

### 2026-11-03 — Backend removal confirmed

- **Status:** Decision recorded. No code changed and no test was run.
- **Decision:** The user confirmed that the earlier backend removal stays on `feature/remove-reservation-entry`. This resolves the conflict recorded in the leftover sweep entry.
- **Still open:** outside API callers, the production `ReservationCreateAttempt` table, the full 17-suite browser run, and the merge decision.

### 2026-11-03 10:40 IST — Reservation Entry leftover sweep: PARTIAL

- **Status:** PARTIAL. No SAP call was made in this step. The full 17-suite browser run was not run.
- **Why:** The user asked for an exhaustive sweep, with before and after search results.
- **Deleted:** `AUDIT_RESERVATION_CREATE.md`; `docs/abap/sandbox-results.md`, the output of the deleted `tools/sandbox-matrix.js`.
- **Changed:** the section comment in both i18n bundles; one line each in `docs/abap/test-runbook.md`, `docs/wm_tr_create_rfc_wrapper.md` and `migo_idempotency_design.md`.
- **Local files removed, not in Git:** `app/fiori-app/dist/modules/wm/reservation-entry/`, `test/e2e/wm/screenshots/mvt*.png` and the emptied folder, and the empty `modules/wm/hu-stock-transfer/model/` folder.
- **Kept on purpose:**
  - `WORKSTATUS.md` and `docs/archive/`: `AGENTS.md` forbids rewriting history.
  - `db-migrate-20261021-*.sql`: database code. These scripts recreate a view of the removed service, so they should not be rerun.
  - `docs/abap/z*_res_entry*`: SAP-side ABAP source.
  - `srv/wm/readScope.js:18`: an error message in backend code.
- **Conflict recorded:** this request says not to touch backend or database code, but the earlier approved commits on this branch already removed the backend service and `ReservationCreateAttempt`. They were not reverted.
- **Test decision:** EXISTING TEST SUFFICIENT: `test/unit/controller/uiConsistency.test.js`, full Jest. Only comments and docs changed.
- **Executed validation:**
  - `npx jest --silent --runInBand`: 224 suites passed, 1 skipped; 4,176 tests passed, 59 skipped.
  - `npx eslint .`: clean. `node tools/scan-secrets.js`: 0 secrets. `git diff --check`: clean.
  - `npm run lint` and `npm run build` in `app/fiori-app`: clean; `dist` has no `reservation-entry`.
  - `npm run test:e2e:sap-free`: 3 of 3 passed.
- **Search results:** saved in `test-results/reservation-search/` (ignored by Git).
- **Next action:** The user reviews the branch and decides whether to keep the backend removal, then whether to merge.

### 2026-11-03 — Reservation-entry backend removed: PARTIAL

- **Status:** PARTIAL. Production behaviour, outside API callers and the production table are not verified. No SAP write was made.
- **Why:** The user approved the backend removal plan.
- **Deleted:** `srv/wm/reservation-entry/service.js`, `service.cds`, `ReservationAttemptStore.js`; `tools/run1-mvt201-live.js` to `run5-mvt261-live.js`; `tools/sandbox-matrix.js`, because its first step needs `createReservationEntry`.
- **Moved:** `srv/wm/reservation-entry/readScope.js` to `srv/wm/readScope.js`, with its 5 importers updated. `test/unit/wm/reservationEntryReadScope.test.js` is now `readScope.test.js`.
- **Changed:** `srv/service.cds`; `db/wm/reservation-track.cds` (`ReservationCreateAttempt` removed); `tools/smoke-test-deployment.js` and `test/smoke/postDeploymentSmoke.test.js` (10 checks to 9); the Postman collection (folder 16 removed); `docs/runbooks/rollback-and-reconciliation.md`.
- **Test decision:** TEST UPDATED.
- **Executed validation:**
  - `npx cds compile db srv --to json`: exit 0; the compiled model has no `ReservationEntryService`.
  - `npx jest --silent --runInBand`: 224 suites passed, 1 skipped; 4,176 tests passed, 59 skipped, on 2 runs in a row.
  - **Failure seen:** one earlier full run on this commit crashed with exit 139 and no summary, while other work may have been running. The cause is UNKNOWN. An earlier run in this session also printed no summary while the SAP-free E2E started in parallel.
  - `npx eslint .`: clean. `node tools/scan-secrets.js`: 0 secrets. `git diff --check`: clean.
  - `npm run validate:mta`: exit 0.
  - `tools/smoke-test-deployment.js` on a test-profile server: 9 passed, 0 failed.
  - On that server, `$metadata` returned 404 for `reservation-entry` and 200 for `tr-to`, `goods-issue`, `goods-receipt`, `hu-stock-transfer`, `outbound-delivery` and `reservation-track`.
  - `npm run test:e2e:sap-free`: 3 of 3 passed.
  - `verifyWmScreens.e2e.js` on port 4010: all 14 steps passed (READ-ONLY, write guard on).
- **Not run:** the full 17-suite browser run and `npm run test:e2e:sap`.
- **Not changed:** `ReservationProcessAdapter.js`, because `tr-to` uses it. `ReservationTrack` and `ReservationLog` are kept, because `tr-to` and `reservation-track` use them.
- **Dead-code candidates, left in place:** in `srv`, `applyPlantScope`, `userFacingSapError`, `SUPPORTED_MOVEMENT_TYPES`, `STEP_ERROR`, `isTrClosedWithoutTo` and `isLockConflict` are now referenced only by their own modules. The adapter methods `assertGoodsMovementNotPosted`, `checkStockForReservation`, `writeApplicationLog` and `getTransferRequirement` have few internal references. Reachability is not proven.
- **Historical references kept:** `AUDIT_RESERVATION_CREATE.md`, root `db-migrate-*.sql`, `docs/abap/sandbox-results.md`, `docs/abap/test-runbook.md`, `docs/wm_tr_create_rfc_wrapper.md`.
- **Next action:** The user checks for outside API callers, then decides about merging, and separately about the production table.

### 2026-11-03 — Reservation-entry tests deleted: PARTIAL

- **Status:** PARTIAL. No SAP call was made in this step. The full 17-suite browser run and `roundTripHuTransfer` were not run.
- **Why:** The user asked to delete all tests and E2E related to `/wm/reservation-entry`.
- **Deleted:** `test/unit/wm/reservationEntryService.test.js`, `reservationCreateRecovery.test.js`, `reservationIdempotency.test.js`.
- **Reservation-entry cases removed from mixed files:**
  - `criticalTransactionAuth.test.js`: section 1.
  - `duplicateConcurrentTimeoutRecovery.test.js`: 4 `createReservation` and `createReservationEntry` tests.
  - `reservationMonitorRetry.test.js`: the retry section.
  - `sapReadBackEvidence.test.js`: section 7.
  - `migoClientAttempt.test.js`: 7 reservation-entry tests; the 4 tr-to tests stay.
  - `verifyWriteAuthorization.e2e.js`: 2 plant cases.
- **Pointed at another service:** `roundTripHuTransfer.e2e.js` read-back now calls `/odata/v4/tr-to/verifyMaterialDocument`, which uses the same adapter method. `e2eWriteGuard.test.js` uses a handling-unit sample URL.
- **Kept, because they cover shared code:**
  - `reservationEntryReadScope.test.js`: other services import `readScope.js`.
  - `reservationProcess`, `reservationBapiPayload`, `reservationStockPrecheck`, `reservationTrack`, `reservationValidationMatrix`: they do not reference this service.
  - `verifyWriteAuthorization.e2e.js` still generates 401 and 403 checks from the CDS model, which is not specific to this service but includes its actions.
- **Test decision:** TEST UPDATED. Tests were removed at the user's request.
- **Executed validation:**
  - `npx jest --silent --runInBand`: 224 suites passed, 1 skipped; 4,176 tests passed, 59 skipped.
  - `npx eslint .`: clean. `node tools/scan-secrets.js`: 0 secrets. `git diff --check`: clean.
  - `npm run test:e2e:sap-free`: 3 of 3 passed.
  - `node --check` on `roundTripHuTransfer.e2e.js` only.
- **Risk:** `srv/wm/reservation-entry/service.js` stays deployed and can write to SAP, but its handlers, plant checks and duplicate-reservation protection no longer have dedicated tests. This includes the `ClientAttemptId` guard from commit `0903aafe`.
- **Next action:** The user decides whether to remove the backend service as well, then whether to merge the branch.

### 2026-11-03 — Movement browser suites deleted: PARTIAL

- **Status:** PARTIAL. The full 17-suite browser run was not run. No SAP call was made in this step.
- **Why:** The user asked to delete all `verifyMvt*` suites as well. This supersedes the earlier decision on this branch to keep their scan-to and read-back steps.
- **Deleted:** `test/e2e/wm/verifyMvt201.e2e.js`, `verifyMvt241.e2e.js`, `verifyMvt261.e2e.js`, `verifyMvt301.e2e.js`, `verifyMvt311.e2e.js`.
- **Changed:**
  - `test/e2e/runAllE2E.js`: 5 imports and 5 suite entries removed.
  - `docs/e2e-coverage-matrix.md`: the `wmWarehouseScanToDetail` row now cites `verifyWmScreens.e2e.js`; suite count changed from 22 to 17.
  - `.github/workflows/ci.yml`: suite count changed from 22 to 17.
- **Test decision:** TEST UPDATED. Suites were removed at the user's request.
- **Executed validation:**
  - `npx jest --silent --runInBand`: 227 suites passed, 1 skipped; 4,388 tests passed, 59 skipped.
  - `npx eslint .`: clean. `node tools/scan-secrets.js`: 0 secrets. `git diff --check`: clean.
  - `npm run test:e2e:sap-free`: 3 of 3 passed.
  - `runAllE2E.js` lists 17 suites, and every file exists.
- **Coverage lost:** No browser suite now opens these fixed TRs per movement type or calls `verifyMaterialDocument` after a movement. `verifyWmScreens.e2e.js` still opens the first open TR. `test/unit/wm/sapReadBackEvidence.test.js` still covers read-back with mocks.
- **Not changed:** `AUDIT_RESERVATION_CREATE.md` mentions these suites as a historical record.
- **Next action:** The user reviews the branch and decides about merging.

### 2026-11-03 — Reservation Entry screen removed: PARTIAL

- **Status:** PARTIAL. The full 22-suite browser run and `npm run test:e2e:sap` were not run. No SAP write was made; SAP use was read-only through the WM screens suite.
- **Why:** The user asked to remove the feature at `#/wm/reservation-entry` from the frontend, and approved the EXCLUSIVE and SHARED lists.
- **Branch:** `feature/remove-reservation-entry`, from `feature01`. Not pushed.
- **Deleted:**
  - `app/fiori-app/webapp/modules/wm/reservation-entry/` (5 files)
  - `test/unit/wm/reservationEntryUi.test.js`
  - `test/e2e/wm/roundTripGoodsIssue.e2e.js`, `roundTripReservationRetry.e2e.js`, `verifyHardeningUI.e2e.js`
- **Changed:**
  - Routing and navigation: `manifest.json`, `App.controller.js`, Dashboard controller and view.
  - HU Rack and Detail views and controllers: the Standard 311 link is removed, by user decision. The warning banner stays.
  - Services and text: `AuthService.js`, `ValueHelpService.js` (`/OrderTypeVH` is kept for Sales Order), and 96 keys removed from each i18n bundle.
  - Suites: `verifyMvt201`, `241`, `261`, `301`, `311` keep their scan-to and read-back steps and lose their Reservation Entry steps. `verifyWmScreens`, `verifyNegativeUi`, `verifyActionFailures`, `verifyPlantIsolation`, `profileLists`, both baselines and `testData.example.json` lose this screen's entries.
  - Docs and CI: `docs/e2e-coverage-matrix.md`, and the suite count in `.github/workflows/ci.yml` (23 to 22).
- **Test decision:** TEST UPDATED.
- **Executed validation:**
  - `npx jest --silent --runInBand`: 227 suites passed, 1 skipped; 4,388 tests passed, 59 skipped. This count is lower than before because `reservationEntryUi.test.js` was deleted.
  - `npx eslint .`: clean. `node tools/scan-secrets.js`: 0 secrets. `git diff --check`: clean.
  - `npm run lint` and `npm run build` in `app/fiori-app`: clean, build succeeded.
  - `npm run test:e2e:sap-free`: 3 of 3 passed.
  - `TARGET_URL=http://localhost:4010 node test/e2e/wm/verifyWmScreens.e2e.js`: all 14 listed steps passed (READ-ONLY, write guard on).
  - Browser session on port 4010, signed in as the E2E test user: `#/wm/reservation-entry`, `/create` and `/1/1` show the dashboard, with 0 console errors, 0 network errors and 0 blocked writes.
- **Not run:** the trimmed `verifyMvt*` suites (syntax check and ESLint only), `verifyPlantIsolation`, `verifyActionFailures`, and the mbt validation.
- **Known behaviour:** the old URL stays in the address bar while the dashboard shows, because the router's `bypassed` target does not change the hash.
- **Backend with no UI caller, not changed:** `/odata/v4/reservation-entry`, still used by `tools/run*-mvt*-live.js`, `tools/sandbox-matrix.js`, `tools/smoke-test-deployment.js` and the `verifyMvt*` read-back; `saps4hana.wm.ReservationCreateAttempt`, used only by `srv/wm/reservation-entry/ReservationAttemptStore.js`. `srv/wm/reservation-entry/readScope.js` is imported by other services, so that folder cannot be deleted whole.
- **Next action:** The user reviews the branch and decides about merging and about the backend.

### 2026-11-03 09:55 IST — MIGO false repeat fixed in the shared check, tr-to guard added: PARTIAL

- **Status:** PARTIAL. Implemented and tested with SAP mocked. No live SAP call was made.
- **Why:** The user asked to fix the same false repeat in `tr-to/postMigoGoodsMovement`, the action behind the scan screen.
- **Root cause:** Both handlers write `ProcessId` before posting. `checkMigoIdempotency` then read that row and treated a matching `ProcessId` or Transfer Order as proof that the row's document belonged to this request.
- **Changes:**
  - `srv/integration/s4hana/wm/ReservationProcessAdapter.js`: when a row has a stored `MigoBusinessKey`, only that key proves the row's document. `ProcessId` and Transfer Order matching now applies only to rows with no stored key, or to Transfer Order matching when the caller sends no id.
  - `srv/wm/tr-to/handlers/trTo.handler.js`: a further issue with no `ProcessId` returns HTTP 400 before SAP. Without this, the adapter fix would let a resend with no id post twice.
  - `srv/wm/reservation-entry/service.js`: removed the special cases from the 09:48 entry (the skipped pre-write, `ProcessId` written with the result, and `ProcessId` written in the error path), because the shared fix replaces them. This supersedes that part of the 09:48 entry.
  - `test/unit/wm/migoClientAttempt.test.js`: now 11 tests, including 4 for tr-to.
- **Test decision:** TEST ADDED and TEST UPDATED.
- **Executed validation:**
  - `npx jest --silent --runInBand`: 228 suites passed, 1 skipped; 4,464 tests passed, 59 skipped.
  - Same new test file against the committed adapter: 7 of 11 failed, so these tests catch the old behaviour.
  - `npx eslint .`: clean.
  - `node tools/scan-secrets.js`: 0 secrets.
  - `git diff --check`: clean.
  - `npm run test:e2e:sap-free`: 3 of 3 passed. These suites do not post a goods movement.
- **Not run:** the scan-screen round trip `test/e2e/wm/roundTripScanTo.e2e.js`, because proving this change needs a live post and a written go. A dry run stubs the write, so it would not exercise this logic.
- **Behaviour to decide:** A caller that sends a new `ProcessId` on a Transfer Order that already has a document now posts again; before, it got the earlier document back. This matches the handler's documented rule that a new id is a new step. The scan screen reuses its id on retry. Whether one Transfer Order may have more than one goods movement is UNKNOWN.
- **Limit:** A posted row with no stored `MigoBusinessKey` can still report its earlier document once. This is marked `shortcut:` in the code. In the local `db.sqlite`, 3 of the 10 rows with a material document have no key and are not complete. The production count is UNKNOWN.
- **Next action:** Commit when the user asks, then run the live proof if the user gives a written go.

### 2026-11-03 09:48 IST — Reservation-entry MIGO `ClientAttemptId`: PARTIAL

- **Status:** PARTIAL. Implemented and tested with SAP mocked. No live SAP call was made.
- **Why:** The audit of 2026-11-03 reported that resending a partial goods issue posts twice.
- **Correction to that audit finding:** A temporary probe on the committed code gave a different result when the tracking row is readable. The handler saved a new `ProcessId` before posting, and `checkMigoIdempotency` then read that row and matched it (`pidMatches`, source `DB`). The second request returned the earlier document as success and did not post. A resend was therefore not posted twice on this path, but a genuine further issue was also not posted.
- **Changes:**
  - `srv/wm/reservation-entry/service.cds`: added `ClientAttemptId : String(36)` to `postMigoGoodsMovement`.
  - `srv/wm/reservation-entry/service.js`:
    - The process id is a SHA-256 hash of reservation, item and `ClientAttemptId`, so one id on another item is a separate attempt.
    - Over a posted document, `ProcessId` is written with the result instead of before posting, which removes the false repeat.
    - On failure, the attempt's `ProcessId` is saved, so a retry looks for that attempt's document.
    - A resend no longer counts its quantity again when the SAP read-back is unavailable.
    - A further issue with no `ClientAttemptId` returns HTTP 400 before SAP. First postings without an id are unchanged.
  - `test/unit/wm/migoClientAttempt.test.js`: new suite, 7 tests, running the real `checkMigoIdempotency` with the BAPI and RFC reads mocked.
  - `test/unit/wm/reservationEntryService.test.js`: 3 existing POSTs now send `ClientAttemptId`, because they post over a document left by an earlier test.
- **Test decision:** TEST ADDED and TEST UPDATED.
- **Executed validation:**
  - `npx jest --silent --runInBand`: 228 suites passed, 1 skipped; 4,460 tests passed, 59 skipped.
  - `npx eslint .`: clean.
  - `node tools/scan-secrets.js`: 0 secrets.
  - `git diff --check`: clean.
- **Not run:** browser E2E and UI5 checks, because no screen calls this action and no webapp file changed. Live SAP proof was not run because it needs a written go.
- **Open findings, not changed:**
  - `srv/wm/tr-to/handlers/trTo.handler.js:264-269` has the same false repeat. A temporary mock probe with a new `ProcessId` returned the earlier document. The scan screen uses this action.
  - No screen sends `ClientAttemptId` yet, because no screen calls this action. The `tools/run*-mvt*-live.js` scripts send no id, so a further issue from them now gets HTTP 400.
- **Assumption (INFERRED):** Refusing a further issue with no id is safe because the repository shows no screen caller. External API callers are UNKNOWN.
- **Next action:** Decide on the `tr-to` fix, and give a written go for the live proof if wanted.

### 2026-11-02 17:55 IST — Reservation Entry Batch Detection & BatchVH Value Help: PASS

- **Status:** PASS.
- **Why:** On `#/wm/reservation-entry/create`, submitting a reservation for material `8000006684` failed with backend error `"Failed to create reservation: Batch is mandatory for batch-managed material 8000006684"`.
- **Root Cause & SAP Discovery:**
  1. Read-only live SAP table inspection (`RFC_READ_TABLE` on `MARC` for Material `000000008000006684` in Plant `1120`) confirmed `XCHPF = 'X'` (Batch management requirement indicator is active).
  2. In SAP S/4HANA IM/WM, reservations (`RKPF`/`RESB`) for batch-managed materials require `RESB-CHARG`.
  3. Backend preflight guard in `srv/integration/s4hana/wm/reservation-entry/ReservationProcessAdapter.js:226-228` checks `MARC-XCHPF === 'X'` and throws HTTP 400 (`"Batch is mandatory for batch-managed material " + sMaterial`) when `sBatch` is empty.
  4. In `ReservationEntryDetail.view.xml`, `inputBatch` was marked optional (`required="false"`), had placeholder `Batch (optional)`, lacked value help (`showValueHelp="false"`), and provided no suggestion items.
  5. The UI had no discovery of live SAP batches from `MCHB` / `MCHA` (e.g. batch `IN26001071` with 8.000 KG in `1120/HS01`), did not check `MARC-XCHPF` when the material was selected, and did not validate batch presence in `validateForm()`.
- **Changes:**
  - `srv/wm/reservation-entry/service.cds`:
    - Added `@readonly entity BatchVH` with keys `Material`, `Plant`, `Batch`, and fields `StorageLocation`, `Stock`.
    - Added OData function `checkMaterialBatchManaged(material: String(40), plant: String(4)) returns { isBatchManaged: Boolean; };`.
  - `srv/wm/reservation-entry/service.js`:
    - Implemented `READ BatchVH` handler dynamically reading `MCHB` (fallback to `MCHA`), extracting `Material` and `Plant` filters, deduplicating keys, and sorting by available unrestricted stock descending.
    - Implemented `checkMaterialBatchManaged` function handler querying `MARC-XCHPF` via RFC client.
  - `app/fiori-app/webapp/modules/wm/reservation-entry/service/ReservationEntryService.js`:
    - Added `checkMaterialBatchManaged(sMaterial, sPlant)` calling `/odata/v4/reservation-entry/checkMaterialBatchManaged`.
  - `app/fiori-app/webapp/service/ValueHelpService.js`:
    - Registered `"/BatchVH"` configuration metadata (`title: "Select Batch", key: "Batch", desc: "Batch", info: "StorageLocation"`).
  - `app/fiori-app/webapp/i18n/i18n.properties` & `i18n_en.properties`:
    - Added `resPlaceholderBatchRequired=Enter or select Batch (required)`.
  - `app/fiori-app/webapp/modules/wm/reservation-entry/view/ReservationEntryDetail.view.xml`:
    - Bound Batch label `required="{view>/isBatchRequired}"`.
    - Enhanced `inputBatch`: added `showValueHelp="true"`, `showSuggestion="true"`, `suggest=".onSuggest"`, `valueHelpRequest=".onValueHelpRequest"`, `suggestionItemSelected=".onBatchSelect"`, `suggestionItems="{path: 'reservationEntry>/BatchVH', templateShareable: false}"`, and dynamic placeholder binding.
  - `app/fiori-app/webapp/modules/wm/reservation-entry/controller/ReservationEntryDetail.controller.js`:
    - Initialized `view>/isBatchRequired: false` in `_onRouteCreateMatched`.
    - Implemented `_checkBatchRequirement(sMaterial, sPlant)` to query backend and update `view>/isBatchRequired`.
    - Hooked `_checkBatchRequirement` into material/plant selection and change handlers.
    - Added `onBatchSelect` event handler.
    - Enhanced `onSuggest` and `onValueHelpRequest` with `Material` and `Plant` contextual filters for `inputBatch`.
    - Updated `validateForm(oData)` to validate batch presence client-side when `isBatchRequired` is true.
  - `test/e2e/wm/verifyMvt311.e2e.js`:
    - Updated dynamic Receiving SLoc test to verify that 311 defaults visible, hides upon switching to 201, and reappears upon switching back to 311.
  - `test/unit/wm/reservationEntryService.test.js`:
    - Added unit tests for `GET BatchVH` 503 error bubbling, `MCHB` stock sorted desc, and `checkMaterialBatchManaged` (108/108 passed).
  - `test/unit/wm/reservationEntryUi.test.js`:
    - Added unit tests for Batch required validation, `_checkBatchRequirement`, and `onBatchSelect` (75/75 passed).
- **Verification Commands Run:**
  - `npx cds compile srv/wm/reservation-entry/service.cds --to csn`: PASS (CSN compiled cleanly).
  - `npx jest test/unit/wm/reservationEntryService.test.js`: PASS (108/108 passed).
  - `npx jest test/unit/wm/reservationEntryUi.test.js`: PASS (75/75 passed).
  - `npx jest test/unit/wm`: PASS (95 passed suites, 1 skipped, 2,513 passed tests, 56 skipped, 0 failed).
  - `cd app/fiori-app && npm run lint`: PASS (0 findings).
  - `cd app/fiori-app && npm run build`: PASS (Build succeeded in 1.19 s).
  - `npm run lint`: PASS (0 errors, 0 warnings).
  - `npm run scan:secrets`: PASS (0 secrets, credentials, or private keys detected).
  - `test/unit/tools/e2eCoverageMatrix.test.js`: PASS (8/8 passed).
  - `ALLOW_LIVE_SAP_TOOLS=1 node test/e2e/wm/verifyWmScreens.e2e.js --allow-live-sap`: PASS (17/17 steps passed).
  - `ALLOW_LIVE_SAP_TOOLS=1 node test/e2e/wm/verifyMvt311.e2e.js`: PASS (all steps, network/console health, and SAP read-back passed).
- **Assumptions:** None.


### 2026-11-02 17:35 IST — Reservation Entry Create Movement Type Synchronization: PASS

- **Status:** PASS.
- **Why:** On `#/wm/reservation-entry/create`, user reported error `"Movement Type is required (201, 241, 311, 301, 261)"` when attempting to create a reservation.
- **Root Cause:**
  1. `ReservationEntryDetail.controller.js`: `_getDefaultCreateData()` initialized `MovementType: ""` (empty string), despite the author comment stating `// MovementType is the first entry of the select.`.
  2. `ReservationEntryDetail.view.xml`: `<Select id="selectMovementType">` has keys `311`, `201`, `241`, `301`, `261` with no blank item (`key=""`). In OpenUI5, when `selectedKey` is empty and no matching item exists, `sap.m.Select` with `forceSelection="true"` displays item 0 (`311`) visually.
  3. UI5's two-way data binding does not push fallback selection back into the model, nor does it fire `change`. The model retained `create>/MovementType === ""`.
  4. Movement 311 dynamic fields (Receiving Storage Location) remained hidden because `visible="{= ${create>/MovementType} === '311' || ${create>/MovementType} === '301' }"`.
  5. Clicking "311" in the dropdown did not fire `change` because index 0 was already selected in the UI control.
  6. Submitting triggered `validateForm(oData)` line 491: `if (!oData.MovementType) return "Movement Type is required (201, 241, 311, 301, 261)"`.
- **Changes:**
  - `app/fiori-app/webapp/modules/wm/reservation-entry/controller/ReservationEntryDetail.controller.js`:
    - Updated `_getDefaultCreateData()` line 50 to return `MovementType: "311"`.
  - `test/unit/wm/reservationEntryUi.test.js`:
    - Updated `_getDefaultCreateData` default test to expect `'311'`.
    - Added test `initializes default MovementType to 311 so UI select and model stay synchronized without validation failure` (72/72 passed).
- **Verification Commands Run:**
  - `npx jest test/unit/wm/reservationEntryUi.test.js`: PASS (72/72 tests).
  - `npx jest test/unit/wm/reservationEntry`: PASS (3 suites, 181/181 tests).
  - `npx jest test/unit/wm`: PASS (95 passed suites, 1 skipped, 2,510 passed tests, 56 skipped, 0 failed).
  - `cd app/fiori-app && npm run lint`: PASS (Success! No findings detected).
  - `cd app/fiori-app && npm run build`: PASS (Build succeeded in 1.29 s).
  - `npm run lint`: PASS (0 errors, 0 warnings).
  - `npm run scan:secrets`: PASS (0 secrets, credentials, or private keys detected).
  - `ALLOW_LIVE_SAP_TOOLS=1 node test/e2e/wm/verifyWmScreens.e2e.js --allow-live-sap`: PASS (17/17 steps passed).
- **Assumptions:** None.

### 2026-11-02 17:15 IST — Dead-Code Cleanup (Medium-Confidence Candidates): PASS

- **Status:** PASS.
- **Why:** User requested dead-code cleanup of Medium-Confidence candidates from the 2026-11-02 15:45 IST review: unused members from `sapFacts.js`, obsolete requires, and review of unreferenced tools.
- **Root Cause & Reachability Verification:**
  1. `srv/integration/s4hana/sapFacts.js`: AST and word-exact searches across `srv/`, `app/`, `db/`, `test/`, and `tools/` confirmed that 8 of 9 exports (`MESSAGES`, `RFBSK`, `STATV`, `REFERENCE_PERSISTED_MOVEMENT_TYPES`, `systemUtcOffsetMinutes`, `sapLocalToEpochMs`, `rfcMessageId`, `_resetForTests`) and internal helper `offsetPromise` had zero references in the codebase. Stale header comment cited `tools/smoke-sap-readonly.js` which did not exist. Only `parseSapNumber` was actively imported and used (in `Mvt261Adapter.js`, `QuarantineLabelAdapter.js`, and `tools/test-261-post-cycle.js`).
  2. `srv/integration/s4hana/wm/goods-issue/BaseGoodsIssueClient.js`: Line 1 imported `const LOG = require('../../logger')('goods-issue-client');`, but `LOG` was never referenced anywhere in `BaseGoodsIssueClient.js`.
  3. `tools/` Scripts: Full scan of `tools/*.js` showed 58 JS files and multiple shell/Python utilities. Syntax checking (`node --check`) and module resolution checks confirmed all 58 scripts are valid with zero broken imports. Categorized into: (a) Gated live SAP verification & cycle test harnesses (`test-261-post-cycle.js`, `post-261-once.js`, `run1-mvt201-live.js` through `run5-mvt261-live.js`, etc.); (b) ADT ABAP deployment scripts (`adt-create-quar-label.js`, `adt-create-to-wrapper.js`, `adt-extend-tr-wrapper.js`); (c) Catalog, DDIC and metadata discovery utilities; (d) Build/preflight/release tools. Preserved as non-destructive developer tooling per `AGENTS.md`.
  4. Redacted real user name in historical LTAK BNAME to `BNAME: 'SAP_USER_22'` in WORKSTATUS to resolve secret scanner rule `Real name in an SAP user field`.
- **Changes:**
  - `srv/integration/s4hana/sapFacts.js`:
    - Removed unused constants `MESSAGES`, `RFBSK`, `STATV`, `REFERENCE_PERSISTED_MOVEMENT_TYPES`.
    - Removed unused functions `systemUtcOffsetMinutes`, `sapLocalToEpochMs`, `rfcMessageId`, `_resetForTests`, and internal variable `offsetPromise`.
    - Retained only `parseSapNumber` with defensive whitespace and dash handling (`if (!s || s === '-') return NaN;`).
    - Cleaned header documentation.
  - `srv/integration/s4hana/wm/goods-issue/BaseGoodsIssueClient.js`:
    - Removed unused import `const LOG = require('../../logger')('goods-issue-client');`.
  - `test/unit/wm/sapFacts.test.js`:
    - Added comprehensive unit test suite covering `parseSapNumber` (positive integers, decimals, trailing-minus strings, standard prefix negatives, whitespace trimming, blank/null/undefined returning NaN, non-numeric strings returning NaN).
  - `WORKSTATUS.md`:
    - Sanitized historical SAP user name to `SAP_USER_22`.
- **Verification Commands Run:**
  - `npx jest test/unit/wm/sapFacts.test.js`: PASS (6/6 tests).
  - `npx jest test/unit/wm/goodsIssueClients.test.js`: PASS (63/63 tests).
  - `npx jest test/unit/wm/mvt261Adapter.test.js test/unit/wm/quarantineLabelAdapter.test.js`: PASS (121/121 tests).
  - `npx jest test/unit/wm`: PASS (95 passed suites, 1 skipped, 2,509 passed tests, 56 skipped, 0 failed).
  - `npm run scan:secrets`: PASS (0 secrets, credentials, or private keys detected).
  - `npx jest test/unit/tools/scanSecrets.test.js`: PASS (13/13 tests).
  - `npm run lint`: PASS (0 errors, 0 warnings).
  - `cd app/fiori-app && npm run lint`: PASS (Success! No findings detected).
  - `cd app/fiori-app && npm run build`: PASS (Build succeeded in 1.33 s).
  - `npx jest --runInBand`: PASS (227 passed suites, 1 skipped, 4,446 passed tests, 59 skipped, 0 failed).
  - `ALLOW_LIVE_SAP_TOOLS=1 node test/e2e/wm/verifyWmScreens.e2e.js --allow-live-sap`: PASS (16/16 steps passed).
- **Assumptions:** None.
- **Test Impact Decision:** TEST ADDED (`test/unit/wm/sapFacts.test.js`).

### 2026-11-02 17:00 IST — Reservation list (/wm/reservation-entry) Date display & SAP date resolution: PASS

- **Status:** PASS.
- **Why:** On `#/wm/reservation-entry`, the reservation creation/requirement date in the table (under the Created By username column) was not being rendered and was always blank.
- **Root Cause:**
  1. In `app/fiori-app/webapp/modules/wm/reservation-entry/view/ReservationEntryList.view.xml`: Line 131 used an invalid OpenUI5 nested expression binding `text="{= ${view>createdAt} ? ${path: 'view>createdAt', formatter: '._formatDateIso'} : (${view>ReservationDate} || '') }"`. In OpenUI5, expression bindings (`{= ... }`) cannot contain embedded property binding objects with formatters (`${path: ..., formatter: ...}`). The UI5 ExpressionParser rejects the syntax and fails to evaluate `text`.
  2. In `srv/integration/s4hana/wm/goods-issue/GoodsIssueReservationsClient.js`: `OPEN_RESV_SELECT` did not include `MatlCompRequirementDate` when querying `/sap/opu/odata/sap/UI_RESERVATION_ITM_MNG_V2/ReservationDocumentItem`, and `resvMap` entries did not populate `ReservationDate`.
  3. In `srv/wm/reservation-entry/service.cds`: `type OpenReservationRow` and `type ReservationDetailRow` omitted `ReservationDate : Date;`.
  4. In `srv/wm/reservation-entry/service.js`: `getOpenReservations` handler mapping did not forward `r.ReservationDate`, and `fetchSapReservation` did not query `RKPF-RSDAT`.
  5. In `app/fiori-app/webapp/modules/wm/reservation-entry/controller/ReservationEntryList.controller.js`:
     - `loadData()` did not populate or normalize `e.ReservationDate` on tracked rows, did not merge `o.ReservationDate` into tracked rows, and did not normalize `o.ReservationDate` on open SAP rows.
     - `_formatDateIso` did not handle compact SAP `YYYYMMDD` strings (e.g. `'20261016'` from `RKPF-RSDAT`) or OData `/Date(ms)/` JSON timestamps.
     - `onSearchFieldSearch` did not search by `ReservationDate`.
- **Changes:**
  - `app/fiori-app/webapp/modules/wm/reservation-entry/view/ReservationEntryList.view.xml`:
    - Replaced invalid expression binding with standard composite binding:
      `text="{parts: [{path: 'view>ReservationDate'}, {path: 'view>createdAt'}], formatter: '._formatDateIso'}"`
      `visible="{= !!${view>ReservationDate} || !!${view>createdAt} }"`.
  - `app/fiori-app/webapp/modules/wm/reservation-entry/controller/ReservationEntryList.controller.js`:
    - Updated `_formatDateIso` to accept `(sResDate, sCreatedAt)`, parse compact `YYYYMMDD`, `/Date(ms)/`, ISO strings, and Date objects into `YYYY-MM-DD`.
    - In `loadData()`: Populated and normalized `e.ReservationDate = that._formatDateIso(e.ReservationDate, e.createdAt)` on tracked rows and `o.ReservationDate = that._formatDateIso(o.ReservationDate)` on SAP-only rows. Enriched existing tracked rows with `o.ReservationDate` when absent.
    - In `onSearchFieldSearch`: Added `(e.ReservationDate && e.ReservationDate.includes(sQuery))`.
  - `srv/integration/s4hana/wm/goods-issue/GoodsIssueReservationsClient.js`:
    - Added `'MatlCompRequirementDate'` to `OPEN_RESV_SELECT`.
    - Populated `ReservationDate: this._formatDate(r.MatlCompRequirementDate) || ''` when building and updating `resvMap` entries.
  - `srv/wm/reservation-entry/service.cds`:
    - Added `ReservationDate : Date;` to `OpenReservationRow` and `ReservationDetailRow`.
  - `srv/wm/reservation-entry/service.js`:
    - In `getOpenReservations`: Mapped `ReservationDate: r.ReservationDate || ''`.
    - In `fetchSapReservation`: Added `RSDAT` to `RKPF` read and mapped `ReservationDate: (h && h.RSDAT) ? formatDateToYMD(h.RSDAT) : ''`.
    - In `getReservationDetail`: Populated `ReservationDate` from tracking row when missing on live document.
  - `test/unit/wm/goodsIssueClients.test.js`:
    - Updated `$select` query assertion to include `MatlCompRequirementDate`.
    - Added unit test verifying `ReservationDate` formatted from `MatlCompRequirementDate`.
  - `test/unit/wm/reservationEntryService.test.js`:
    - Updated `getOpenReservations` test to assert `ReservationDate`.
  - `test/unit/wm/reservationEntryUi.test.js`:
    - Added tests for `_formatDateIso` (compact `YYYYMMDD`, `/Date(ms)/`, ISO, Date, fallback), `loadData()` date normalization across tracked and SAP-only rows, and `onSearchFieldSearch` date matching.
- **Verification Commands Run:**
  - `npx jest test/unit/wm/goodsIssueClients.test.js test/unit/wm/reservationEntryService.test.js test/unit/wm/reservationEntryUi.test.js`: PASS (3 suites, 239/239 tests).
  - `npx jest test/unit/wm`: PASS (94 passed suites, 1 skipped, 2,503 passed tests, 56 skipped, 0 failed).
  - `npm run lint`: PASS (0 errors, 0 warnings).
  - `cd app/fiori-app && npm run lint`: PASS (Success! No findings detected).
  - `cd app/fiori-app && npm run build`: PASS (Build succeeded in 1.19 s).
  - `npx cds compile srv --to json > /dev/null`: PASS (exit 0).
  - `ALLOW_LIVE_SAP_TOOLS=1 node test/e2e/wm/verifyWmScreens.e2e.js --allow-live-sap`: PASS (16/16 steps passed, including Reservation entry list with 443 rows).
- **Assumptions:** None.
- **Test Impact Decision:** TEST UPDATED & TEST ADDED (`goodsIssueClients.test.js`, `reservationEntryService.test.js`, `reservationEntryUi.test.js`).

### 2026-11-02 16:40 IST — Scan-to completed TR (STATU = U) leak fixed: PASS

- **Status:** PASS.
- **Why:** `#/wm/scan-to` listed completed Transfer Requirement `0001000992` as the very first open TR. Clicking on it opened `#/wm/scan-to/W01/TR/0001000992` with the error "Transfer Requirement 1000992 has no open items (already completed)", causing step `Warehouse scan-to detail (first open TR)` in `verifyWmScreens.e2e.js` to fail.
- **Root Cause:**
  1. Live read-only SAP trace of `LTBK` and `LTBP` for `0001000992` confirmed:
     - `LTBK`: `{ LGNUM: 'W01', TBNUM: '0001000992', BWLVS: '311', STATU: 'U', BDATU: '20261102', MBLNR: '4900050356' }`.
     - `LTBP`: `{ MENGE: '1.000', TAMEN: '1.000', ELIKZ: 'X', TANUM: '0001037677' }`.
     - `LTAK`: `{ TANUM: '0001037677', KQUIT: 'X', BNAME: 'SAP_USER_22' }`.
     The TR was 100% processed and confirmed via Transfer Order `1037677`.
  2. In SAP WM, transfer postings / posting changes (movement type 311, 301, etc.) receive header status `STATU = 'U'` (Umbuchung vollzogen) upon completion, whereas standard TRs receive `STATU = 'E'`.
  3. `TrToAdapter.getOpenTRs` previously queried `LTBK` with only `AND STATU <> 'E'`. Because `'U' <> 'E'`, `0001000992` was returned as open and sorted to the top (newest date `20261102`).
  4. In `lookupTR` and `createTOFromTR`, completed TR validation only checked `tr.Statu === 'E'`, falling through to the open-items check (`open.length === 0`).
- **Changes:**
  - `srv/integration/s4hana/wm/TrToAdapter.js`:
    - `getOpenTRs`: Added `"AND STATU <> 'U'"` to the `LTBK` RFC WHERE clause and added in-memory defensive filtering `r.STATU !== 'E' && r.STATU !== 'U'`.
    - `getTRByReservation`: Excluded `r.STATU !== 'E' && r.STATU !== 'U'`.
    - `lookupTR`: Candidate status mapping and `openCandidates` filter now treat both `'E'` and `'U'` as completed.
    - `lookupTR`: Checks `if (tr.Statu === 'E' || tr.Statu === 'U')` and surfaces `already completed (STATU = ${tr.Statu})`. Returned `Status` is `STATUS.TO_CONFIRMED` when completed.
    - `createTOFromTR`: Checks `if (tr.Statu === 'E' || tr.Statu === 'U')` and throws 400.
  - `app/fiori-app/webapp/modules/wm/warehouse-scan-to/controller/WarehouseScanToDetail.controller.js`:
    - `loadDetail`: Added `oDetail.Status === 'U'` to the client-side completion check.
  - `test/unit/wm/trToAdapter.test.js`:
    - Added unit test: `excludes completed TRs with STATU = E and STATU = U from open TR list and queries LTBK with both excluded`.
    - Added unit test: `lookupTR rejects TR that is already completed (STATU = U) with 400`.
    - Added unit test: `createTOFromTR rejects TR already completed with STATU = U with 400`.
  - `test/unit/wm/warehouseScanToUi.test.js`:
    - Added unit test: `Step 6: rejects TR that is already completed (STATU = U) with clear error`.
- **Validation:**
  - Unit tests: `npm test test/unit/wm/trToAdapter.test.js` (79/79 passed, 0 failed).
  - UI controller unit tests: `npm test test/unit/wm/warehouseScanToUi.test.js` (67/67 passed, 0 failed).
  - All WM unit tests: `npm test test/unit/wm` (94 suites / 2,500 tests passed, 56 skipped, 0 failed).
  - Tools tests: `npm test test/unit/tools` (20 suites / 221 tests passed, 0 failed).
  - UI5 linter: `cd app/fiori-app && npm run lint` (0 findings).
  - UI5 build: `cd app/fiori-app && npm run build` (build succeeded in 1.29 s).
  - Root ESLint: `npm run lint` (0 findings).
  - Browser E2E suite: `node test/e2e/wm/verifyWmScreens.e2e.js` (16 of 16 steps PASS, exit code 0):
    - `Warehouse scan-to entry (rows: listOpenTRs=1841)` PASS
    - `Warehouse scan-to detail (first open TR) (rows: tableSuggestedBatches=6)` PASS (opened open TR `0001000988` cleanly without error)
  - Round-trip scan-to E2E: `node test/e2e/wm/roundTripScanTo.e2e.js` (createTO PASS, exit code 0).
- **SAP Calls:** READ-ONLY RFC queries were performed during discovery (`LTBK`, `LTBP`, `LTAK`, `MATDOC`, `DD03L`, `DD07L`, `DD07T`, `TFDIR`, `RPY_PROGRAM_READ`). No SAP write was performed.

### 2026-11-02 15:58 IST — Quarantine labels E2E fix merged to local `feature01`: PASS

- **Status:** PASS. The user asked for the cherry-pick. `2a8461b6` landed on `feature01` as `da5fe837`, on top of the i18n commits `25b050de` and `309a0a42`. Not pushed; `feature01` is 5 commits ahead of `origin/feature01` with this entry.
- **Conflict:** Only in `WORKSTATUS.md`, in 3 places where the i18n session and this session both added text. Both sides were kept. The cleanup line in Next Steps listed both fixes as open, so it now says both are resolved. The test file applied cleanly.
- **Validation on `feature01` at `da5fe837`:** `npm run test:e2e:sap-free` 2 runs in a row: 3 of 3 suites, exit 0 each, and the `Goods-receipt list` case passed. `npx jest --no-coverage --testPathIgnorePatterns '/\.claude/'` on `zquarLabel`, `quarantineLabelsController`, `quarantineLabelAdapter`, `e2eRunner`, `e2eCoverageMatrix`, `uiConsistency`: 6 suites, 170 tests passed. No SAP call was made.
- **Not run:** The full Jest suite on this commit, the other 20 browser suites, which need SAP, and GitHub Actions.
- **Next:** Push when the user asks, then confirm `browser-e2e-sap-free` on GitHub Actions.

### 2026-11-02 15:56 IST — Missing i18n keys merged to local `feature01`: PASS

- **Status:** PASS. The user asked for the merge. `feature01` was clean and had not moved, so it fast-forwarded from `b0a879b9` to `25b050de`. Nothing was pushed.
- **Files:** `WORKSTATUS.md` only for this entry; the merge brought in the 7 files from `25b050de`.
- **Validation on `feature01` at `25b050de`:** `npx jest --no-coverage --testPathIgnorePatterns '/\.claude/' '/node_modules/'`: 226 suites passed, 1 skipped; 4,432 tests passed, 59 skipped. `npx ui5lint`: no findings.
- **Warning:** Plain `npx jest` in the main checkout also runs the test copies under `.claude/worktrees/`: 681 suites, 8 failed. All 8 failures are in those copies (4 in `loving-hugle-dd58b1`, 4 in `xenodochial-edison-130e3c`). The errors read show missing modules, because those worktrees have no `node_modules`. `jest.config.js` was not changed.

### 2026-11-02 15:52 IST — Change 1 of 4: 10 missing i18n keys added to both bundles: PASS

- **Status:** PASS. Based on `feature01` at `b0a879b9`, which includes the dead-code cleanup. The worktree first pointed at `main`, which is 818 commits behind and has none of these keys, so its empty branch was moved to `feature01` before any edit.
- **Why:** The UI referenced keys that neither bundle defined.
- **What users saw before:** `huNoSelection` had no fallback, so the toast showed the raw key. Its button is disabled when nothing is selected, so normal use does not reach it. The other 9 keys had fallback text in the code, so users saw that text and never a raw key. The stale-data body texts only appear when the SAP error has no message of its own.
- **Added to both bundles:** `poValCompanyCodeMismatch`, `poValSupplierAccountGroupMismatch`, `poValPurchOrgMismatch`, `poValCurrencyMismatch`, `msgStaleDataConflict`, `msgPromptReloadData`, `titleStaleDataConflict`, `grErrStaleData`, `grPromptReloadData`, `huNoSelection`. Text is the existing fallback, except `huNoSelection`, which had none and is new wording: "Select at least one handling unit."
- **Files:** `app/fiori-app/webapp/i18n/i18n.properties`, `app/fiori-app/webapp/i18n/i18n_en.properties`.
- **Validation:** Scan of XML views and JS: 17 unresolved before, 7 after, and all 7 are runtime prefixes left out by request (`cycle261Status_`, `cycle261Step_`, `ql4x6Error_`, `qlLabelWarn_`, `scan261Reject_`, `scan261Unit_`, `scan261Warn_`). UI5 1.136.20 `ResourceBundle` in the browser loaded both bundles and returned the expected text for all new keys. `npx jest --no-coverage`: 226 suites passed, 1 skipped; 4,432 tests passed, 59 skipped. `npx ui5lint`: no findings. `git diff --check`: clean.
- **Not verified:** The messages were not triggered on live screens, and the 409 paths were not run against SAP. No SAP call was made. E2E suites were not run. The completed forms of the 7 runtime prefixes were not checked.

### 2026-11-02 15:52 IST — Change 2 of 4: PO mismatch warnings pass the selected value to the bundle text: PASS

- **Status:** PASS.
- **Why:** The fallback texts name the selected value, for example "Selected Company Code 9999", but the call args did not include it. The new bundle entries take priority over the fallback, so without this change the warnings would have lost that value. The supplier warning would also have lost the document type.
- **What changed:** The selected value is appended to the args at all 5 call sites, and the supplier call also gets the document type. Existing placeholder positions are unchanged. The warning text users see is the same as before.
- **File:** `app/fiori-app/webapp/modules/mm/purchase-order/controller/CreatePurchaseOrder.controller.js`.
- **Validation:** New tests in `test/unit/purchase-order/headerValueHelpSelection.test.js` run `_onDocTypeSelectedCheck` against each real bundle and assert the filled text equals the code's fallback, for a rule-based type (ZIMP) and for ZSTO. 64 of 64 pass in that file. Full Jest and `ui5lint` results are in Change 1.

### 2026-11-02 15:52 IST — Change 3 of 4: Invoice stale-data message gets its own key: PASS

- **Status:** PASS.
- **Why:** `msgStaleDataConflict` had two different fallback texts. Deliveries say "This delivery was modified…", and invoices say "This document was modified… The list has been refreshed…". One bundle entry would have given one screen the wrong message.
- **What changed:** Deliveries keep `msgStaleDataConflict`. The invoice call now uses a new key, `msgInvoiceStaleDataConflict`, with its existing fallback text, added to both bundles. Both bundles therefore grow by 11 keys, from 1,597 to 1,608: the 10 from Change 1 plus this one.
- **File:** `app/fiori-app/webapp/modules/sd/customer-invoice/controller/CustomerInvoices.controller.js`, plus both bundles.
- **Validation:** The browser `ResourceBundle` check in Change 1 returned the correct separate text for each key. Full Jest and `ui5lint` results are in Change 1. The invoice 409 path was not run against SAP.

### 2026-11-02 15:52 IST — Change 4 of 4: Test now covers literal keys in JS: PASS

- **Status:** PASS.
- **Why:** The existing test only checked `{i18n>key}` in XML views, so missing keys in JS went unnoticed.
- **What changed:** The test now also checks literal `getText("key")`, `_getText("key")` and `_text("key")` calls in app JS, excluding `thirdparty`. Keys built at runtime do not match. The XML pattern now also catches `i18n>key` written without braces.
- **File:** `test/unit/controller/uiConsistency.test.js`.
- **Validation:** Before the bundle change it failed and listed the missing keys across 5 controllers. After the change it passes. Full Jest and `ui5lint` results are in Change 1.

### 2026-11-02 15:52 IST — Quarantine labels E2E, second stale check: row print counted the logo as a label page: PASS locally

- **Status:** PASS locally. Test-only change; no SAP call was made.
- **Changed:** `test/e2e/wm/verifyQuarantineLabels.e2e.js`, the row print check in the `Goods-receipt list` case. It now counts only page-sized SVGs (`width="288pt" height="432pt"`), the same match the `App-drawn 4x6 labels` case already uses.
- **Why:** With the first fix in place the case reached this check and failed with `row print is not 2 label pages`. It counted every `<svg `. A check of `ZquarLabelPdf.buildHtml` with 2 labels on the vertical variant gave 4 `<svg ` tags: 2 label pages and 1 nested logo in each. The logo was added in `e6207dd1`. The print output is correct.
- **Tested:** `npm run test:e2e:sap-free` 3 runs in a row: 3 of 3 suites, exit 0 each. `npx jest` on `zquarLabel`, `quarantineLabelsController`, `quarantineLabelAdapter`, `e2eRunner`, `e2eCoverageMatrix`: 5 suites, 162 tests passed. `npx eslint` on the test file: clean. `git diff --check`: clean.
- **Not run:** The full Jest suite, because only this E2E file changed; the other 20 browser suites, which need SAP; GitHub Actions.
- **Next:** Merge into `feature01`, then confirm `browser-e2e-sap-free` on GitHub Actions.

### 2026-11-02 15:49 IST — Quarantine labels E2E, first stale check: demo storage unit too long for the default label: PASS for this cause

- **Status:** PASS for this cause. The case then stopped at the second stale check, logged in the 15:52 entry above. Test-only change; no SAP call was made.
- **Failing click (CONFIRMED from the Playwright trace):** The row print click at line 226 timed out. The button was found, visible and enabled, but `sap-ui-blocklayer-popup` intercepted every click attempt.
- **Root cause (CONFIRMED):** The earlier `Download selected` step had failed and left an error dialog open: `Label 1: the storage unit is too long for the barcode at this label size. Nothing was printed.` The wait for the download swallows its timeout (`.catch(() => {})`), so the test went on and reported the later click instead.
- **Screen or test:** The test. The mock returned an 11-digit storage unit (`${doc}${n}`). On the default vertical label at 203 dpi, a check of `barcodeGeometry` shows 10 characters fit and 11 throw `barcodeTooLong`. The layout refuses rather than squeezes bars by design. Storage units recorded in this file from SAP have 10 digits (for example 2000019372 and 1000059430), so real labels of that length print.
- **When it started (INFERRED from the layout code, not run at each commit):** `ee2f909f` made vertical the default with a wide barcode area. `3ae4435a` narrowed that area, which is when 11 digits stopped fitting. Jest does not run this browser case, which is why the Jest passes recorded on 2026-10-31 did not show it. The cleanup did not cause it.
- **Changed:** `test/e2e/wm/verifyQuarantineLabels.e2e.js`: the mock now returns a zero-padded 20-character storage unit with 10 significant digits, as SAP does.
- **Tested:** `npm run test:e2e:sap-free`, 3 runs: the click timeout was gone and the case failed at the next check, `row print is not 2 label pages`. Jest on the 5 related suites: 162 tests passed. Baseline before the change: reproduced `TimeoutError: page.click: Timeout 30000ms exceeded` on `b0a879b9`.
- **Findings, not changed:** (1) The vertical label also refuses 10-digit values at 300 dpi, because the minimum module is 5 dots there. The screen does not pass a dpi today, so it always uses 203; this matters only if 300 dpi is offered. (2) A storage unit with more than 10 significant digits is refused on the vertical label, but fits the Top Header variant. `NLENR` allows 20 characters. Whether SAP issues longer numbers here is Not verified. (3) The swallowed download timeout makes any failure of that step show up as a misleading 30 s click timeout.
- **CI flakiness:** This failure is deterministic, so it does not explain the earlier `route null` failure of run 41033598034, which had a different cause. Whether GitHub runs failed on this case since 2026-10-31 is Not verified.

### 2026-11-02 IST — SAP accepts the stored password again at 15:11; rejections remain unexplained: PARTIAL, uncommitted

- **Status:** PARTIAL. SAP access works right now, but the earlier rejections are not explained, so it is not proven stable. No SAP write was sent, and no code changed since the entry below.
- **Input from the user:** The account was reported as not locked, which rules out a lock as seen at that moment. Whether a short lock came and cleared is Not verified.
- **Observed at 15:11:16:** Direct `validateCredentials`: 200. Purchase order read through the server on port 4004, started 15:08:14: HTTP 200. `.env.local` was unchanged since 15:07:37, with the host name. So this server and these settings work, and the earlier failure followed the time, not the server or sign-in type.
- **Timeline for the same stored password and client:** accepted up to 14:44; rejected 14:56 to 14:59; accepted about 15:08; rejected about 15:10; accepted 15:11.
- **Cause:** UNKNOWN. The Basis audit log for 14:40 to 15:15 remains the way to find it.
- **User confirmation after this:** The user reports that the login and the Purchase Orders screen both work on port 4004.
- **Next:** Commit the certificate-error message fix when asked. The Basis team reviews the audit log for 14:40 to 15:15, the user replaces the exposed password, and the writer of the IP address in `.env.local` is found. If it fails again, note the exact time.

### 2026-11-02 IST — SAP rejects the stored password again at about 15:10: BLOCKED, uncommitted

- **Status:** BLOCKED. This corrects the PASS in the entry below: SAP access is not stable. All SAP calls from this session stopped. No SAP write was sent.
- **Observed:** Server on port 4004, started 15:08:14 with the host name. App login route: authenticated, token issued. Purchase order read: HTTP 502 from SAP 401, with both a Bearer token and Basic sign-in, so sign-in type is not the cause.
- **Timeline for the same stored password:** worked at or before 14:44:56; rejected 14:56 to 14:59; accepted about 15:08; rejected about 15:10.
- **Correction:** For `khushal`, the login route compares the password locally when it equals `S4_PASSWORD`, without asking SAP. So `authenticated: true` on that route does not prove SAP accepts the password. Only the `validateCredentials` check proved that, at about 15:08.
- **Cause:** UNKNOWN. A lock from repeated failed logons would fit (Not verified). Failed logons today include this session's checks; a server on 4004 and login attempts typed in the browser may also count. Only SAP can show this.
- **Next:** Stop the server on port 4004. The Basis team checks the `KHUSHAL` lock status and audit log in client 220.

### 2026-11-02 IST — Login error resolved on a fresh server: PASS for the app login route, uncommitted

- **Status:** The app login route and SAP reads work on a fresh server. The browser login screen with a typed password was not exercised here. The server on port 4004 needs a restart, because it started at 15:07:00, before `.env.local` was corrected at 15:07:37. Changes are uncommitted. No SAP write was sent.
- **What fixed it:** `S4_DESTINATION_URL` back on the host name on the certificate. The stored password was not changed. The user's `curl` with `sap-client: 220` returned 200, then `validateCredentials` with the stored password returned 200.
- **Corrections to the entry below:** A new password was not needed. My advice that the stored value was wrong did not hold: it was rejected at 14:56 to 14:59 and accepted after 15:07.
- **Validation:** App route `POST /odata/v4/auth/login`: HTTP 200, authenticated, `S4HANA_DEV - Client 220`, token issued. HTTPS and RFC reads through CAP: HTTP 200. Browser `Shell screens` and `MM screens`: PASS. `npm run scan:secrets` and `git diff --check`: clean. Jest last ran before this result with no code change since: 225 suites passed, 1 skipped; 4,419 tests passed, 59 skipped.
- **Still UNKNOWN:** Why the same password was rejected from 14:56 to 14:59, and what wrote the IP address into `.env.local` at 14:49 and 15:00. If it is written again, this error returns. The Basis audit log should cover the rejection window, and the password should still be replaced, because it is exposed on GitHub and in this chat.

### 2026-11-02 IST — Login error `Cannot connect to S/4HANA`: certificate cause fixed; SAP now rejects the configured password: BLOCKED, uncommitted

- **Status:** BLOCKED on the user updating `S4_PASSWORD`. The certificate cause is fixed; the login is not proven working. No SAP write was sent. All SAP calls stopped once the 401 appeared.
- **Reported:** Login at port 4004 showed `Cannot connect to S/4HANA system`.
- **Root cause 1 (fixed):** `.env.local` was modified at 14:49:34 and `S4_DESTINATION_URL` held an IP address, which SAP's certificate does not cover (`ERR_TLS_CERT_ALTNAME_INVALID`). SAP itself was reachable. `AuthAdapter` reported every connection failure as a network problem.
- **Changes:** `.env.local` (local, not in Git): only the host in `S4_DESTINATION_URL`, restored to the name recovered from Git history; it resolves to the same address and answers 401 without credentials, with the certificate verified. `srv/integration/s4hana/AuthAdapter.js`: a certificate failure now has its own message and shows no address. `.env.example`: comment. `test/unit/authAdapter.test.js`: 3 new cases. Certificate checks were not bypassed.
- **Root cause 2 (open, UNKNOWN):** With credentials from `.env.local`, SAP answers HTTP 401 and RFC reports `Name or password is incorrect`. The user confirms they did not change the password, which removes my earlier inference. The local username, password format, client and file encoding show no fault. The same password read SAP successfully at or before 14:44:56 and failed at 14:56:43. What changed in between can only be seen in SAP: a password reset by someone else or a locked account (SAP may hide a lock behind the same message; Not verified on this system). The password was exposed on GitHub, so an unauthorized change cannot be ruled out; no evidence for or against it was seen.
- **Side effect of this diagnosis:** My checks sent failed logons with that password: one direct check, one purchase order read, one RFC read and the signed-in `Shell screens` browser run, whose dashboard made more. This counts against the account's failed-logon limit, so it may be locked. Lock state is UNKNOWN.
- **Note on local logins:** `khushal` with the value in `S4_PASSWORD` is accepted locally without asking SAP, so that old value still signs in to the local app until `.env.local` is updated.
- **TEST DECISION:** TEST ADDED.
- **Validation:** 3 new cases failed on the old code. Full `npx jest`: 225 suites passed, 1 skipped; 4,419 tests passed, 59 skipped. `eslint` on the 2 JS files, `npm run scan:secrets`, `git diff --check`: clean. `Shell screens` FAILED on the rejected SAP password; it was not rerun.
- **Not verified:** A successful login, HTTPS or RFC read with the correct password; the new message in the browser.
- **Update after the user's SAP GUI check:** The user reports that a SAP GUI logon works with their current password, so the account is not locked in the client used. One read-only `validateCredentials` check at 14:59 with `.env.local` still returned 401. So `S4_PASSWORD` is rejected in client 220 while the GUI logon works. Why is UNKNOWN: the typed password may differ, the GUI may use another client, or the GUI may sign in without a typed password. No further SAP calls were made.
- **Update at 15:01:** `.env.local` was saved again at 15:00:21. It holds the IP address again, undoing the host fix, and `S4_PASSWORD` is unchanged (the same old exposed value as this morning). No SAP call was made, because it would only fail. What saved the file is UNKNOWN. INFERRED candidate: the Antigravity editor, which is running, with a stale open copy or its agent; it is not confirmed. The server on port 4004 was restarted at 15:00:38 with these values.
- **Update at 15:07:** The user supplied a `curl` they describe as working. It uses the stored password and sends no client. One read-only equivalent with the stored credentials, certificate verified, returned HTTP 401 with `sap-authenticated: false` and realm client 100. So with no client SAP uses client 100, not the app's 220, and this request did not authenticate from here. Whether the user's own `curl` returned 200 is UNKNOWN. This added one failed logon, in client 100. The password was also pasted into the chat. The app was not changed to bypass certificate checks.
- **Next:** The user reports the HTTP status of the same request with `sap-client: 220`, finds what is rewriting the file and confirms the GUI client, sets a new password, updates `S4_PASSWORD` in `.env.local`, stops the server on port 4004 and restarts with `npm start`. Then run one read-only check. The Basis team should still review the account's audit log, because the old password was exposed.

### 2026-11-02 IST — Other people's SAP user names replaced with neutral labels: PARTIAL, uncommitted

- **Status:** PARTIAL. Done and uncommitted for the current files. The names stay in Git history and on the remote until history is rewritten. No SAP call or write was made.
- **Requested by the user:** Replace other SAP users' names in docs and tests.
- **Scope was larger than first reported:** 29 SAP user names, not 7. Field scanning found more, and reading the diff found a surname, one more user and personal email addresses.
- **Change:** 592 name replacements across 38 files, as `SAP_USER_01` to `SAP_USER_29`, stable per person. 6 email addresses now use `example.invalid`. The mapping is not saved anywhere, because a list in the repository would expose the names again. No file under `srv/` or `app/` changed.
- **Left in place, on purpose:** `KHUSHAL`, as agreed. `IP10...` values in `ERNAM` of one evidence file, which look system-generated (INFERRED). The company email domain on its own in 5 places (for example a suffix check in the ABAP copy), which is not personal. A job title on one archived ticket line.
- **Side effect:** `docs/abap/zrf_res_hu_transfer_dnr.abap` is a copy of SAP source, so its user and email constants no longer match the source in SAP, and `tools/save-abap-source.js` would bring names back if rerun. Older entries and evidence were edited; only names changed.
- **Scanner:** `tools/scan-secrets.js` has a new rule for a real name in `USNAM`, `ERNAM`, `AENAM`, `BNAME` or `UNAME`, in non-test files. It does not catch names in prose.
- **TEST DECISION:** TEST ADDED (rule test) and TEST UPDATED (renamed fixtures).
- **Validation:** `npm run scan:secrets`: exit 0. A check over tracked text found none of the replaced names. All 60 evidence JSON files parse. Full `npx jest`: 225 suites passed, 1 skipped; 4,416 tests passed, 59 skipped. `eslint` on the 2 scanner files: clean. `git diff --check` reports 15 trailing-whitespace lines: the edited ABAP file uses CRLF line endings (6,670 lines at HEAD), and the markdown lines end in two spaces. These are not new; left unchanged.
- **Not verified:** Names that appear only in free text outside the fields scanned, beyond those found by reading the diff.
- **Next:** The user decides on repository visibility and rewriting history. Remaining: audit finding 13 and moving the AI prompt to the server.

### 2026-11-02 IST — Audit finding 12: SAP address and hostnames removed from tracked files; scanner strengthened: PARTIAL, uncommitted

- **Status:** PARTIAL. Done and uncommitted for the current files. These values stay in Git history and on the remote until history is rewritten. No SAP call or write was made. The finding 1 password exposure is still open.
- **Checked against current state:** Local `S4_DESTINATION_URL` is already `https` on port 44300, so the plain-HTTP part of the finding no longer applies to the current setup. `.env.example` held the real private address.
- **Change:** The real private address (16 places) and SAP hostnames (17 places) are now `sap-host.invalid` in `.env.example`, `WORKSTATUS.md`, `docs/evidence/2026-10-26/261-sap-system-info.raw.json` and 3 `docs/wm-discovery` files. This is a deliberate edit of older log entries and evidence; only those values changed. A test-only private address in 4 test files stays.
- **Scanner:** `tools/scan-secrets.js` reported 0 while passwords were in code because its rules matched only fixed forms. Added rules for a hardcoded password in a comparison and for private network addresses, plus a check for real values from `.env.local` (secrets and SAP host) in any form, reporting file and line only. `test/unit/tools/scanSecrets.test.js` also runs this over the repository.
- **Mistake during this work:** My first replacement script used a wrong address pattern and left the address in place; the new scanner caught it. One of my commands also printed the `.env.example` line with that address to this session's output. It was already public.
- **TEST DECISION:** TEST ADDED.
- **Validation:** 5 new tests failed on the old code. After the fix: `npm run scan:secrets`: exit 0 over 1,028 files with 8 rules. Full `npx jest`: 225 suites passed, 1 skipped; 4,415 tests passed, 59 skipped. `eslint` on the 2 changed files and `git diff --check`: clean. The evidence JSON parses, and the 3 XML files pass `xmllint`.
- **Not verified:** The scanner's local-value check in CI, where `.env.local` does not exist, so it adds nothing there. It also does not read `docs/archive`, which the scanner ignores; a separate scan of that folder found no address.
- **Open, needs a decision:** The SAP hostname appears in 5 commits across all refs, and the address and passwords are in history too. Rewriting history needs a force push. `KHUSHAL`, the SAP user, is in 97 files, including tests and the GitHub name, and was left. Seven other SAP user names appear 331 times in tracked docs and tests, which is personal data in a repository that appears public.
- **Note:** The audit finding 11 work was committed outside this session as `916d3e77`.
- **Next:** The user decides on repository visibility, history rewrite and other users' names. Remaining: audit finding 13 and moving the AI prompt to the server.

### 2026-11-02 IST — Audit finding 11: AI provider must be chosen, masking covers streaming, models limited: PARTIAL, uncommitted

- **Status:** PARTIAL. Code and tests are done and uncommitted. No SAP write was sent, and no call reached an AI provider. The prompt is still built in the browser (below).
- **Confirmed problem:** With `AI_PROVIDER` blank, the client chose NVIDIA unless an SAP AI Core key was present, and any unknown value also went to NVIDIA. The local `.env.local` has it blank with an NVIDIA key set, so Ask AI sent purchase order rows to NVIDIA there.
- **New bug found:** `chatStream` built its own SAP client without `AI_SAP_MASK_PII` masking or the resource group check path shared with chat. The screen streams first, so masking did not apply to the main path.
- **Changes:**
  - `srv/common/aiClient.js`: `AI_PROVIDER` must be `sap` or `nvidia`; otherwise `AI_NOT_CONFIGURED` with no provider call. `sapClient` is now shared by chat and streaming.
  - `srv/ai/service.js`: a request's `model` must be the configured model or listed in new `AI_ALLOWED_MODELS`.
  - `tools/check-service-connectivity.js`, `.env.example`, `srv/ai/service.cds`: same rule and wording.
- **Behaviour change:** Ask AI stops wherever `AI_PROVIDER` is blank, including local. `.env.local` was not changed; setting it is a deliberate choice for its owner.
- **TEST DECISION:** TEST ADDED and TEST UPDATED (`test/unit/ai/aiClient.test.js`, `test/unit/ai/aiService.test.js`).
- **Validation:** 6 new cases failed on the old code. After the fix: full `npx jest`: 225 suites passed, 1 skipped; 4,410 tests passed, 59 skipped. `eslint` on the 4 changed JS and test files, `cds compile srv/ai/service.cds`, `git diff --check`: clean. Running server with blank provider and an NVIDIA key: `/odata/v4/ai/chat` HTTP 503 in about 0.01 s; `/ai/chat/stream` reports the same error; an unlisted model gets 400. Browser `MM screens`: PASS.
- **Not verified:** A real AI answer through either provider; masking with real SAP AI Core (no key here, tested with a mock SDK); the Ask AI error display in the browser, which `MM screens` does not exercise.
- **Open, needs a decision:** The browser still builds the system prompt from purchase order rows, so a logged-in user can send their own `system` text. Moving it means about 120 lines of prompt code, the browser's row gathering (`PurchaseOrders.controller.js`, 1,830 lines) and an 890-line test file. An allowed `nvidia` setting still sends this data to NVIDIA by choice; `AI_SAP_MASK_PII` still defaults to false.
- **Note:** The audit finding 10 work was committed outside this session as `4bbe72b6`.
- **Next:** Decide on moving the prompt to the server. Audit finding 12 follows.

### 2026-11-02 IST — Audit finding 10: reservation replay check uses the process id stored in SAP: PARTIAL, uncommitted

- **Status:** PARTIAL. Code and tests are done and uncommitted. No SAP write was sent. A live goods movement has not run through this code, including a real retry after a lost response.
- **Confirmed problem:** `checkMigoIdempotency` searched `MATDOC-SGTXT`, which is blank on reservation postings, so the exact check never matched. A guess decided instead: SAP withdrawn above tracked withdrawn, or final issued, or no tracking row, returned an old document as this request's success and posted nothing.
- **READ-ONLY evidence:** `BKTXT` holds the first 25 characters of the process id on every line of real documents, with `SGTXT` blank (4900050153 for 311, 4900050304 for 201). Documents with this text exist for all of 201, 241, 261, 301 and 311 since 2026-10-15. Earlier documents have it blank. Lookups took about 0.1 to 0.3 s in client 220; production table size is UNKNOWN.
- **Change in `ReservationProcessAdapter.js`:** With a process id: a `BKTXT` match is a replay. On a miss, a document on the reservation item means: final issued = 422; no tracking row = 409; tracked = post the new quantity. Without a process id the quantity comparison stays as the only guard (`shortcut:` comment). HEADER_TXT and the lookup share `processHeaderText`.
- **Behaviour change:** A request that used to receive an old document as success now gets a refusal, or posts if tracked. A tracked item withdrawn outside this flow now posts, which is intended.
- **Not done from the design:** The Tier 3 open-quantity check (quantity above open is left to SAP) and a process id for `executeReservationWarehouseFlow` calls that send none.
- **Remaining double-post exposure (INFERRED):** A caller sending a new `ProcessId` on a tracked item after a lost response. The screen resends the returned one, and `reservation-entry` declares no such input.
- **TEST DECISION:** TEST ADDED and TEST UPDATED. Mocks in 11 test files answered on the old `SGTXT` field and now answer on `BKTXT`; a fresh-id test changed because ids differing only at the end share a 25-character text.
- **Validation:** 4 new cases failed on the old code. After the fix: full `npx jest`: 225 suites passed, 1 skipped; 4,405 tests passed, 59 skipped. `eslint` on the source and main test files and `git diff --check`: clean. Browser, write guard on: `verifyMvt201`, `verifyMvt311`, `verifyHardeningUI` PASS. Dry-run `reservationRetry` and `scanTo`: PASS.
- **READ-ONLY live run of `checkMigoIdempotency`:** real id on reservation 525877 returned document 4900050153 as a replay; unknown ids on final-issued 525877 and 528779 got 422; an unknown id on 529651, with no document, returned not posted.
- **Note:** The audit finding 9 work was committed outside this session as `34a7cad1`.
- **Next:** Audit finding 11 (SAP data to the AI provider).

### 2026-11-02 IST — Audit finding 9: database is the only attempt source when one is bound: PARTIAL, uncommitted

- **Status:** PARTIAL. Code and tests are done and uncommitted. No SAP write was sent. Not exercised on 2 real running instances; the test uses 2 store objects on one database.
- **Finding checked against current code:** The false 409 in `hasOpenAttemptForReservation` was already removed by the audit finding 3 work. Still wrong: `create()` added every attempt to memory and never removed it; `getOpenAttemptReservations` merged stale memory with the database; `getByReference` fell back to memory; `setStatus` kept writing to memory.
- **Change:** `srv/wm/goods-issue/GoodsIssueAttemptStore.js`: with a database bound, none of these read or write memory. Memory stays as the no-database fallback. `test/unit/wm/goodsIssueAttemptInstances.test.js` is new.
- **Behaviour change:** If the database read in `getOpenAttemptReservations` fails, the list now shows no pending marks rather than this instance's memory. It logs a warning. The posting check `hasOpenAttemptForReservation` still fails closed.
- **TEST DECISION:** TEST ADDED.
- **Validation:** 3 of the 6 new tests failed on the old code. After the fix: full `npx jest`: 225 suites passed, 1 skipped; 4,401 tests passed, 59 skipped. `eslint` on the 2 files and `git diff --check`: clean. Browser suites `verifyHardeningUI` and `verifyMvt261`: PASS.
- **Test flakiness found and fixed:** `verifyMvt201` failed 3 of 4 runs alongside other suites (`Movement Type 201 not displayed on page`) and passed 3 of 3 alone. Cause: the suite read the page text before the reservation data arrived; the 241, 261, 301 and 311 suites already wait. `test/e2e/wm/verifyMvt201.e2e.js` now waits for the material number. After the fix: 8 of 8 runs of the same 3 suites PASS. The higher parallel default of 4 workers made this race easier to hit; the two earlier full runs passed anyway.
- **Note:** The dependency fix was committed outside this session as `09f12898`.
- **Next:** Audit finding 10 (reservation replay check).

### 2026-11-02 IST — Audit finding 8: dependency vulnerabilities fixed: PASS for the audit result, uncommitted

- **Status:** `npm audit --omit=dev` is at 0 vulnerabilities, from 11 (5 high, 6 moderate). Uncommitted. No SAP write was sent. Not deployed, and `npm run build:mta` was not run.
- **Change:** `npm audit fix`, without `--force` or `--omit=dev`; only `package-lock.json` changed. `body-parser` 2.3.0 to 2.4.0, `follow-redirects` 1.16.0 to 1.16.2, `node-forge` 1.4.0 to 1.4.2, `undici` 6.28.1 to 6.29.1, `zod` 4.6.5 to 4.6.7, plus other in-range updates including `qs` and dev tools such as `jest` 30.5.2 and `eslint` 10.14.0. No dependency was added on purpose.
- **Avoided:** `--omit=dev` in the dry run would have removed the dev tools. `--force` suggested `eslint` 4.0.0, a large downgrade.
- **TEST DECISION:** EXISTING TEST SUFFICIENT: the full Jest suite and the browser suites named below.
- **Validation:** Full `npx jest`: 224 suites passed, 1 skipped; 4,395 tests passed, 59 skipped. `npx eslint .`, `cds compile srv` and `npm ci --dry-run`: exit 0. `npm ls --all`: no invalid or missing packages. `node-rfc` loads. Browser, write guard on: `Shell screens`, `MM screens` and `Write authorization` PASS. Dry-run `mvt261` and `goodsReceipt`: PASS, using live read-only SAP data. `app/fiori-app` audit: already 0.
- **Not verified:** Full browser suite after this change; the deployed build; `follow-redirects` header handling in a real redirect.
- **Note:** The `WORKSTATUS.md` and test work for audit finding 6 was committed outside this session as `12612858`.
- **Next:** Audit finding 9 (attempt memory not shared between instances).

### 2026-11-02 IST — Audit finding 6: plant limits added to reservation entry write actions: PARTIAL, uncommitted

- **Status:** PARTIAL. Code and tests are done and uncommitted. No SAP write or real write action was sent, so a live refusal was not exercised. This closes the reservation entry item left open in the entry below.
- **Review:** All `srv/wm/reservation-entry/service.js` write actions were checked. `createReservation`, `createReservationEntry`, `postMigoGoodsMovement` and `executeReservationWarehouseFlow` already had a plant check. `verify*` actions were not changed. Four actions had none.
- **Changes in `service.js`, all through `assertPlantsInScope`:**
  - `createTransferRequirement`: the tracked reservation's plant.
  - `createTOFromTR`: the tracked plant plus `LTBP-WERKS`, because the TR number comes from the request.
  - `confirmTransferOrder`: the tracked plant, if any, plus `LTAP-WERKS`.
  - `retryStep`: the tracked plant, or the SAP reservation's plant before it is imported into tracking.
- **Behaviour change:** For a non-Admin, `createTOFromTR` on a TR with no `LTBP` rows now gets 503 before the existing `TR_VALIDATION` result, and `confirmTransferOrder` on a TO with no `LTAP` rows gets 503.
- **TEST DECISION:** TEST ADDED (7 cases in `test/unit/wm/criticalTransactionAuth.test.js`) and TEST UPDATED (plant rows added to the mocks in `reservationEntryService.test.js` and `reservationCreateRecovery.test.js`).
- **Validation:** 6 of the 7 new cases failed on the old code; the Admin case passed. After the fix: full `npx jest`: 224 suites passed, 1 skipped; 4,395 tests passed, 59 skipped. `eslint` on the 4 changed files and `git diff --check`: clean. Browser, write guard on: `Write authorization` and `Plant isolation` PASS. Dry-run `reservationRetry`: PASS.
- **Not verified:** A refusal through a real write action on a live server. These actions' `LTBP` and `LTAP` plant reads use the same tables and field read successfully earlier today on TR 1000982 and TO 1037664, not through this new code path.
- **Still open from the entry below:** `postGoodsReceipt` by purchase order with no delivery; `tr-to` read functions; whether `gm.checkAuthorization` runs as the technical account; `postMigoGoodsMovement` and `retryStep` trust the tracking table's plant, which is written after a checked create or from SAP (INFERRED).
- **Next:** Decide on committing. Remaining audit findings not started: 8 to 13.

### 2026-11-02 IST — Audit finding 6: plant limits read from SAP on goods receipt, reversal and transfer orders: PARTIAL, uncommitted

- **Status:** PARTIAL. Code and tests are done and uncommitted. No SAP write or real write action was sent, so a live refusal was not exercised. Similar gaps in reservation entry remain open (below).
- **Problem:** Goods receipt checked the plant named by the request, while SAP posts by delivery number. `reverseGoodsIssue` and the `tr-to` `createTOFromTR` and `postMigoGoodsMovement` handlers had no check of the user's plant.
- **Changes:**
  - `srv/wm/reservation-entry/readScope.js`: new `assertPlantsInScope`. For a non-Admin, every plant read from SAP must be in scope; an unreadable plant is a 503 and nothing is posted. Admins skip the read.
  - `goodsReceipt.handler.js` and `GoodsReceiptAdapter.js`: both post actions now check the delivery item's `LIPS-WERKS`.
  - `goodsIssue.handler.js` and `GoodsIssueAdapter.js`: reversal checks every `MATDOC-WERKS` of the document.
  - `trTo.handler.js`: `createTOFromTR` checks the TR item plants. `postMigoGoodsMovement` checks the named plant, `RESB-WERKS` and `LTAP-WERKS`.
  - `test/unit/wm/plantLimits.test.js` (new, 24 tests); `test/support/trToHandlerAsAdmin.js` (new) runs older no-user tests as Admin; 5 older test files use it; `goodsReceiptPlantScope.test.js` mock updated.
- **Behaviour change:** A request with no user or no plant attribute is now refused on these actions.
- **TEST DECISION:** TEST ADDED and TEST UPDATED.
- **Validation:** The new tests failed on the old code (22 of 24). Full `npx jest`: 224 suites passed, 1 skipped; 4,388 tests passed, 59 skipped. `eslint` on the changed source and new test files: clean. `git diff --check`: clean.
- **READ-ONLY live reads matched the expected plants:** delivery 0180000137 = 1130; document 4900050350/2026 = 1120; document 5000005789/2026 = 1130; TR 1000982 = 1120; `RESB` 528779/1 = 1120; `LTAP` TO 1037664 = 1120.
- **Browser, write guard on:** `Write authorization`, `Plant isolation` and `Movement 261` PASS. Dry-run `goodsReceipt` and `scanTo`: PASS.
- **Not verified:** A refusal through a real write action on a live server; I did not send one, because a failed check could reverse a real document. Whether a live clerk flow has any other issue with the extra read.
- **Open:**
  - `srv/wm/reservation-entry/service.js`: `createTOFromTR` and `confirmTransferOrder` show no plant check in the code read (INFERRED, not tested); `createTransferRequirement` was not reviewed.
  - `postGoodsReceipt` with a purchase order and no delivery still checks only the named plant; that path failed live in October.
  - `srv/wm/tr-to` read functions `getTR`, `getFifoBatches` and `getAvailableSerials` were not changed.
  - `gm.checkAuthorization` running as the technical account was not confirmed.
- **Next:** Decide whether to apply the same check to reservation entry.

### 2026-11-02 IST — Browser E2E runner: run part of the suite, show progress, 4 workers: PASS for the runner change

- **Status:** Runner change done and uncommitted. The full suite still reports 1 failure, which predates this work (below).
- **Requested by the user:** Fix how long the browser suite takes and how frozen it looks.
- **Cause:** I piped output through `grep | tail`, which held it back until the end. The runner could only run everything or the SAP-free subset. Two suites took 712 s and 428 s of about 32 minutes of total suite time, on 2 workers.
- **Changes:**
  - `test/e2e/runAllE2E.js`: added `--only=` or `E2E_ONLY`, a `[n/total]` counter, a slowest-5 list, and a default of 4 workers.
  - `test/e2e/support/selectSuites.js`: new filter; a term matching nothing throws, so a typo cannot pass with no tests run.
  - `test/unit/tools/e2eSelectSuites.test.js`: new tests.
- **Not changed, on purpose:** The 712 s handling unit, 261 and scan-to group stays in one suite, because the code says those flows share the kit's module-level failure mode. That group sets the floor for a full run.
- **Measured:** 4 workers: 991 s (16.5 minutes), 22 of 23 suites passed. 2 workers: about 19.5 minutes (INFERRED from process times, not timed directly), 22 of 23 passed with the same failure. `--only=shell`: 5 s, PASS. `--only=wmm`: refused, exit 1. Final full `npx jest`: 223 suites passed, 1 skipped; 4,364 tests passed, 59 skipped. `eslint` on the runner and `git diff --check`: clean.
- **TEST DECISION:** TEST ADDED.
- **Pre-existing failure, not fixed:** `Quarantine labels (mocked)` fails in `Goods-receipt list (mocked, DEMO)` with `page.click: Timeout 30000ms exceeded`. The same suite was recorded FAIL in `test-results/e2e-summary.json` on 2026-10-31, before today's user changes. Evidence is in `test-results/e2e-evidence/quarantine-labels-mocked`.

### 2026-11-02 IST — Remove `bob`, `dave`, `eve`, `carol` and CAP's built-in mock users: PASS for the removal, uncommitted

- **Status:** Removal done and uncommitted. The credential exposure below is still open.
- **Requested by the user:** Remove the invented mock users.
- **Correction:** The `alice` entry below reported that user as removed, but CAP's built-in defaults still supplied `alice`, `bob`, `carol`, `dave`, `erin`, `fred`, `me`, `yves` and a `*` wildcard that accepted any username over HTTP Basic. Deleting from `package.json` alone was not enough.
- **Changes:**
  - `package.json`: `[development]` and `[test]` now keep only `khushal`, and set the built-in users and `*` to `false`. CAP's `mocked-users.js` refuses those.
  - `srv/auth-service.js`: removed the mock-only login branch.
  - `test/testUsers.js` (new): 4 test-only identities named by role and plant, loaded through `CDS_CONFIG` by `test/setupEnv.js`, `test/e2e/support/isolatedServer.js` and the CI E2E server. They are kept because the permission tests need low-privilege users.
  - 18 test, tool and doc files renamed; `test/unit/auth/authService.test.js` rewritten for one login path.
  - `.claude/launch.json` (local, not in Git): new `cap-e2e` configuration.
- **TEST DECISION:** TEST ADDED and TEST UPDATED.
- **Validation:** Against a running development-profile server without test identities: `alice`, `bob`, `carol`, `dave`, `eve`, `erin`, `fred`, `me`, `yves`, `any-other-name`, `test-viewer-1120` and no login all got HTTP 401 on `$metadata`; `khushal` got 200. Full `npx jest` before the runner change: 222 suites passed, 1 skipped; 4,359 tests passed, 59 skipped. Full browser suite: 22 of 23 PASS, including `Plant isolation` and `Write authorization`.
- **Findings, not fixed:** `khushal` still has no password in mocked HTTP Basic on a development-profile server. Customer returns still has the bypass for a user with id `mock`. `AUDIT_RESERVATION_CREATE.md` still names `bob` as a historical note.

### 2026-11-02 IST — Remove invented user `alice`; local passwords compared exactly: PARTIAL, uncommitted

- **Status:** PARTIAL. Code and tests are done and uncommitted. No SAP write was sent, and the credential exposure in the entry below is still open.
- **Requested by the user:** Remove `alice`, and compare local mock passwords with exact case.
- **Changes in source:**
  - `package.json`: removed `alice` from the `[development]` and `[test]` mocked users. `khushal` already had the same roles.
  - `srv/auth-service.js`: `alice` removed from the mock-only check, and `LOCAL_DEV_PASSWORD` compared exactly for `bob` and `khushal`.
  - `srv/sd/customer-return/handlers/customerReturn.handler.js`: removed the check that let a user named `alice` create returns with no role.
  - `SalesOrderModel.js`, `SalesInquiryModel.js`: the default creator name is now empty, not `alice`.
  - `i18n.properties`, `i18n_en.properties`: removed `loginDemoAdmin` (no code uses it) and `alice` from the username placeholder.
- **Changes in tests and tools:** 66 files used `alice` as a login and now use `khushal`, including `test/e2e`, `test/unit`, `test/integration`, `tools/`, the Postman collection and one matrix note. In `test/unit/auth/authService.test.js` the mock-only cases use `bob`, so no test reaches SAP.
- **Not renamed, on purpose:** `WORKSTATUS.md`, `docs/archive/`, `docs/evidence/` and `docs/abap/sandbox-results.md`, because they record what actually happened.
- **TEST DECISION:** TEST ADDED and TEST UPDATED (exact-case compare, no `alice` login or mocked user, no `alice` access to customer returns, empty default creator).
- **Validation:** Full `npx jest`: 222 suites passed, 1 skipped; 4,331 tests passed, 59 skipped. `eslint` on the changed source and test files checked: clean. `git diff --check`: clean. Browser shell suite: PASS. Dry-run `salesOrder`, `customerReturn` and `mvt261` suites: PASS as `khushal`. The server log shows read-only `$batch` POSTs only for these runs.
- **Findings, not fixed:**
  - Mocked auth accepts `khushal:` with an empty password over HTTP Basic on any server running the development profile, which is how the browser suites sign in. So API access there is still not protected by a password, even though the login action now is.
  - `bob`, `dave`, `eve` and `carol` are still mocked users.
  - Customer returns still has the same bypass for a user with id `mock`.
  - Unused i18n keys `loginDemoTitle` and `loginDemoPurchaser` remain, and the second shows `khushal / khushal`.
- **Not verified:** the rest of the browser suites and other Tier C dry runs after the rename; CI; whether anyone used `alice` on a shared development server.
- **Next:** The user changes the SAP password and decides on commit, repository visibility and history.

### 2026-11-02 IST — Audit finding 1: login accepted any password for `khushal`; hardcoded passwords removed: PARTIAL, credential exposure open

- **Status:** PARTIAL. The code fix is done and uncommitted. The exposed SAP password is not resolved: it needs the user to change it, and the commit is still in Git history and on the remote. No SAP write and no failed SAP login was sent.
- **Root cause:** `srv/auth-service.js` treated any non-empty password as known for `khushal` outside production, and that user gets all roles including Admin. This applied wherever the dev issuer is on (`ENABLE_DEV_TOKEN_ISSUER=true` is set in `.env.local`). The same check held 3 passwords in source, added in `2256822d` (2026-10-29).
- **Exposure, checked without printing values:** One of the 3 values equals `S4_PASSWORD` in `.env.local`. All 3 are on `origin/feature01` in `srv/auth-service.js` and `WORKSTATUS.md`, and none on `origin/main`. Unauthenticated `GET https://api.github.com/repos/khushalDhanani/SAPS4HANAFULLSTACK0` returned 200, so the repository appears public. Whether anyone used them is UNKNOWN.
- **Changes:**
  - `srv/auth-service.js`: removed the any-password condition and the 3 values. `khushal` now needs `LOCAL_DEV_PASSWORD`, `S4_PASSWORD`, or SAP's own check.
  - `test/unit/auth/authService.test.js`: added a wrong-password test and a no-literal-password test.
  - `WORKSTATUS.md`: replaced 6 occurrences of those values with `[REDACTED]` in older entries. This is a deliberate exception to not changing history in this file, and only the values changed.
- **TEST DECISION:** TEST ADDED.
- **Validation:** Both new tests failed on the old code. After the fix: `test/unit/auth` 4 suites and 55 tests passed. Full `npx jest`: 222 suites passed, 1 skipped; 4,328 tests passed, 59 skipped. `eslint` on the 2 changed JS files and `git diff --check`: clean. `git grep` finds none of the 3 values in tracked files. Browser suite `test/e2e/shell/verifyShellScreens.e2e.js`: default route, dashboard and login screen PASS, signed out.
- **Not verified:** a real wrong-password login through the browser, on purpose, because it would send a failed logon to SAP and count against the `KHUSHAL` account. Whether a deployed environment had the dev issuer on; `productionGuard.js` blocks it in production.
- **Findings, not fixed:** Mock and `khushal` local passwords are compared case-insensitively (`toLowerCase`). This session's local transcript displayed the values when reading the file. A full secret scan of Git history was not run.
- **Next:** The user changes the SAP password, then decides on rewriting history and on making the repository private.

### 2026-11-02 IST — Live scan-to on TR 1000982 after the user's written go: PASS for TO create and confirm, read back from SAP

- **Status:** PASS for this TO; PARTIAL for the route. Finding 7 stays open. No tracked code changed.
- **Command (WRITE, one run):** the `scanTo` Tier C suite in live mode with `E2E_SAP_LIVE_TARGET='S4HANA_DEV - Client 220'`. RFC preflight passed; suite `[PASS] [live]`. The server log shows one `POST /odata/v4/tr-to/createTOFromTR`, then the read-only `verifyMaterialDocument`.
- **READ-ONLY read-back from SAP:** `LTAK` TO 1037664, movement 261, `KQUIT` X, user KHUSHAL. `LTAP` item 0001: GS1/0002000589 to 914/0000001011, 1 KG, batch 2CED260006, `PQUIT` X, source unit `VLENR` 1000059430. `LTBK` 1000982 `STATU` E; `LTBP` `TANUM` 1037664, `ELIKZ` X.
- **Stock effect:** Storage unit 1000059430 fell from 220 to 219 KG. The negative interim quant in 914 is gone. `MARD` `CS01` stays 14,019 KG. This closes the 1 KG IM/WM difference from document 4900050350. Whole-warehouse totals were not compared.
- **Observed:** TR `STATU` E appears here on a completed TR, which suggests the `E` on TR 1000744 is not an error state. INFERRED; its meaning is not confirmed from SAP documentation.
- **Change:** `docs/e2e-coverage-matrix.md` row `wmWarehouseScanToDetailWithWh` moved to SAP 🟡. Row `wmWarehouseScanToDetail` stays 🔴 because this run did not use that route. The finished `scanTo` section was removed from local gitignored `test/e2e/live/testData.json`.
- **TEST DECISION:** EXISTING TEST SUFFICIENT: `test/e2e/wm/roundTripScanTo.e2e.js`.
- **Validation:** Live suite as above. `npx jest test/unit/tools/e2eCoverageMatrix.test.js`: 8 tests passed. `git diff --check`: clean.
- **Not verified:** automatic MIGO; Retry MIGO; the audit finding 2 guard on a TO whose goods movement is not yet posted; live negative paths; undoing a confirmed TO.
- **Next:** Proving the automatic MIGO needs a TR with its goods movement unposted and a new written go. The remaining not-proven routes need the same one-at-a-time approach.

### 2026-11-02 IST — Prepare scan-to live run on TR 1000982: BLOCKED on the user's written go

- **Status:** Blocked. No SAP write was sent. No tracked code changed. The scan-to flow is not proven live through the screen.
- **Change:** Local gitignored `test/e2e/live/testData.json` now holds `scanTo` (W01, TR 1000982).
- **Why this TR:** It was created by today's authorized 261 post (document 4900050350/2026), so it is this work's own leftover, not another user's open work. A confirmed TO should clear the 1 KG difference between IM and WM (INFERRED).
- **READ-ONLY target:** LTBK `STATU` blank, movement 261, `TRART` A, `BETYP` F, `BENUM` 1011, `MBLNR` 4900050350. LTBP item 0001: material 8400000046, batch 2CED260006, 1 KG, no TO. No TO in `LTAK`. Destination bin: interim type 914 bin 0000001011 holds `VERME` 1.000- (the negative 1 KG). Source candidate: GS1 bin 0002000589, where storage unit 1000059430 holds 220 KG.
- **Stubbed rehearsal:** Screen `READY FOR TO`, `autoPostMigo` false because the goods movement is already posted. 1 call; session errors none. Body: `{"lgnum":"W01","tbnum":"1000982","tbpos":"0001","qty":1,"unit":"KG","batch":"2CED260006","serials":[],"sourceStorageType":"GS1","sourceStorageBin":"0002000589","receivingPlant":"","receivingStorageLocation":"","costCenter":"","assetNo":"","subNumber":"0000","orderId":"1011","autoConfirm":true,"autoPostMigo":false,"CompleteReservation":false,"storageUnit":"","ReservationMovementType":"","ReservationNo":"","ReservationItem":"0"}`.
- **Not verified:** whether SAP accepts a 1 KG pick from a storage-unit bin with `storageUnit` blank; which unit it uses; whether the remainder of the 220 KG stays on the same unit; how a confirmed TO would be undone. This run cannot prove the `Retry MIGO` path or the audit finding 2 guard's post-MIGO branch, because the goods movement is already posted.
- **Next:** After the written go, send one `createTOFromTR` through the `scanTo` Tier C suite in live mode and read the TO, TR and quants back from SAP.

### 2026-11-02 IST — Live goods receipt on delivery 0180000137 after a new written go: PASS for the post, read back from SAP

- **Status:** PASS for this post. Finding 7 stays open for the other write flows. The fix behind it is uncommitted.
- **Command (WRITE, one run):** the `goodsReceipt` Tier C suite in live mode with `E2E_SAP_LIVE_TARGET='S4HANA_DEV - Client 220'`. RFC preflight passed. The server log shows one `POST /odata/v4/goods-receipt/postGoodsReceiptWithStorageUnit`.
- **Suite result recorded honestly:** The suite reported FAIL with a 404 from `getStorageUnitDetails` after the post. That was its read-back step, because a completed delivery is no longer found by that lookup. The post itself succeeded. The suite has not had a complete live PASS, because this delivery cannot be posted again.
- **READ-ONLY read-back from SAP:** `MATDOC` 5000005789/2026 item 0001, movement 101, material 8000004571, plant 1130, `HS01`, 100 KG, PO 0300002116/00010, `CANCELLED` blank, user KHUSHAL. LIKP `WBSTK` C, `WADAT_IST` 20261102. LIPS `WBSTA` C. `EKPO` `ELIKZ` X. `EKBE` shows the 101 for 100 KG. `MARD` `HS01` rose from 500 to 600 KG. `LTBK` has no transfer requirement for this document in W12.
- **Change:** `test/e2e/wm/roundTripGoodsReceipt.e2e.js` now reads back from `MATDOC` by document and delivery. `docs/e2e-coverage-matrix.md` rows `wmGoodsReceipt` and `wmGoodsReceiptDetail` moved to SAP 🟢. The finished `goodsReceipt` section was removed from local gitignored `test/e2e/live/testData.json`.
- **TEST DECISION:** TEST UPDATED (the suite's read-back).
- **Validation:** The new read-back, run READ-ONLY against this document: no errors for 100; an error for 99 and for no rows. Dry-run `goodsReceipt` suite: PASS. `eslint` on the suite: clean. Full `npx jest`: 222 suites passed, 1 skipped; 4,326 tests passed, 59 skipped. `git diff --check`: clean.
- **Findings, not fixed:**
  - After completion, `getStorageUnitDetails` tells the user the number `does not exist in any active record`, which is misleading for a delivery that has been received.
  - The server logged `Tier 5 Production Order check failed: Property ManufacturingOrder not found in type MMIMProductionOrderVHType`, so that lookup tier fails.
- **Not verified:** whether this delivery was really test data; reversing it (`tools/test-gr-su-post-cycle.js cancel` was not run); live negative paths; partial receipts.
- **Next:** Decide whether to keep or reverse 5000005789/2026 with SAP_USER_21. Then do read-only data discovery for the scan-to live run.

### 2026-11-02 IST — Goods receipt `VLBAPI 004`: cause found by simulation and fixed: PARTIAL, live proof pending

- **Status:** PARTIAL. Code and tests are done and uncommitted. No real post or commit was sent in this change, so the goods receipt is still not proven live.
- **Simulation (after the user's written go; `SIMULATE` X, no commit, two calls on 0180000137):** The call as sent today returned `E VLBAPI 004` and `W VL 268` with values 0 and 0. `T100` for `VL 268`: `Conversion factors &1:&2 are zero, not defined mathematically`. The call with `SALES_UNIT` KG, `BASE_UOM` KG, `FACT_UNIT_NOM` 1 and `FACT_UNIT_DENOM` 1 returned no messages. `SIMULATE` was confirmed in `BAPIIBDLVHDRCTRLCON` first.
- **READ-ONLY state after the simulation:** LIKP `WBSTK` A; no `MATDOC` rows for this delivery; `MARD` plant 1130 `HS01` still 500 KG.
- **Change:** `srv/integration/s4hana/wm/GoodsReceiptAdapter.js`: for an unpacked delivery, the BAPI now receives units and factors read from `LIPS`. The handling-unit path is unchanged.
- **New refusals on the unpacked path, none reaching the BAPI:** a quantity other than the full delivery quantity (422); a unit that differs from the delivery unit, a delivery unit that differs from the base unit, or a factor other than 1:1 (422); an unreadable delivery item (503). Reason: `CHG_DELQTY` is not sent there, and the archive says SAP then confirms the whole item. So this fix must not make the partial-quantity bug reachable. Partial receipts stay unsupported until proven; the code has a `shortcut:` comment.
- **TEST DECISION:** TEST ADDED and TEST UPDATED (`test/unit/wm/goodsReceiptAttempt.test.js`).
- **Validation:** That suite: 38 tests passed. Full `npx jest`: 222 suites passed, 1 skipped; 4,326 tests passed, 59 skipped. `eslint` on the 2 changed JS files and `git diff --check`: clean. Dry-run `goodsReceipt` suite: PASS (UI wiring only).
- **Not verified:** a real post with these fields; whether partial receipts are possible with `CHG_DELQTY` or `PART_GR_QTY`; why the packed path worked without factors; other flows that call this BAPI.
- **Next:** After a new written go, send one real post through the `goodsReceipt` Tier C suite and read it back from SAP.

### 2026-11-02 IST — Live goods receipt on delivery 0180000137 after the user's written go: FAIL, refused by SAP, nothing posted

- **Status:** FAIL for the live run, not retried. BLOCKED on the user's written go for a simulate-only diagnosis. No tracked code changed. The goods receipt screen is not proven live.
- **Command (WRITE, one run):** the `goodsReceipt` Tier C suite in live mode with `E2E_SAP_LIVE_TARGET='S4HANA_DEV - Client 220'`. RFC preflight passed. The UI and server log show HTTP 422 from `postGoodsReceiptWithStorageUnit`, mapped from SAP message `VLBAPI 004`. `T100` text: `Error in document &1 item &2 (quantity consistency check)`.
- **READ-ONLY state after the run:** LIKP `WBSTK` A, `KOSTK` C, `WADAT_IST` blank; no `MATDOC` rows for this delivery; `MARD` plant 1130 `HS01` still 500 KG. The local attempt row was not read; by the code path it is `rejected`.
- **Delivery facts:** LIPS `LFIMG` and `LGMNG` both 100 KG; factors 1/1; `KOSTA` and `LVSTA` C; `PKSTA` blank; no handling units in `VEKP` by delivery. TO 1013081 by SAP_USER_21 is confirmed (`KQUIT` X). So the requested quantity equals the delivery quantity and putaway is complete.
- **Root cause:** UNKNOWN. The adapter reports only the first error row of the BAPI `RETURN`. The archived proof (document 5000005654, `docs/archive/WORKSTATUS-archive-2026-10-22.md:3739`) was a packed delivery with real handling units and `CHG_DELQTY`. The unpacked path sends `DLV_QTY` with no flag, and no live success on that path was found in the logs searched. The screen sends the delivery number as the storage unit, so it always uses this unpacked path when a row is selected. INFERRED: the screen may be unable to post by delivery at all. One untested idea is the unit fields of `ITEM_DATA` (`FACT_UNIT_NOM`, `FACT_UNIT_DENOM`, `SALES_UNIT`, `BASE_UOM`), which exist in `BAPIIBDLVITEMCON` but are not sent.
- **Correction:** My earlier note that the BAPI route "worked once before" applied only to that packed delivery, not to this kind of delivery.
- **Change:** `docs/e2e-coverage-matrix.md` row `wmGoodsReceiptDetail` moved to SAP 🟡 with this result.
- **Next:** With a written go, call `BAPI_INB_DELIVERY_CONFIRM_DEC` on 0180000137 with `SIMULATE` X and no commit, once as sent today and once with the unit fields, and print the full `RETURN`.

### 2026-11-02 IST — Prepare goods receipt live run on delivery 0180000137: BLOCKED on the user's written go

- **Status:** Blocked. No SAP write was sent. No tracked code changed. The goods receipt flow is not proven live through the app after the audit finding 5 changes.
- **Change:** Local gitignored `test/e2e/live/testData.json` now holds `goodsReceipt` (delivery 180000137, quantity 100). The finished `mvt261` section was removed.
- **Stubbed rehearsal:** UI success with stub document DRYRUNGR01; 1 call; session errors none. Body: `{"StorageUnit":"180000137","DeliveryDocument":"180000137","DeliveryDocumentItem":"000010","PurchaseOrder":"300002116","PurchaseOrderItem":"00010","Unit":"KG","Material":"8000004571","Plant":"1130","StorageLocation":"HS01","Batch":"","Quantity":100,"PackagingMaterial":"","ExpiryDate":""}`.
- **READ-ONLY target:** LIKP `WBSTK` A, `KOSTK` C, `LGNUM` W12, created by SAP_USER_21 2026-10-21. LIPS item 000010: 100 KG, plant 1130, `HS01`, `WBSTA` A. PO 0300002116 item 00010 (ZDOM, created by SAP_USER_21), 100 KG, not closed. No `MATDOC` rows for this delivery. Candidates were read from the first 60 deliveries in the 33-row list; none is under 100 units apart from a 0-quantity item on 0180000001.
- **Candidate bug, not fixed:** `postGoodsReceiptWithStorageUnit` sets `CHG_DELQTY` only for a real handling unit, and the screen sends the delivery number as the storage unit, so that flag is not sent. `docs/archive/WORKSTATUS-archive-2026-10-22.md:9490` records that without it SAP confirms the entire delivery item. So a partial quantity entered on this screen may post the full item while the app reports the entered quantity. INFERRED from code and the archive; not tested. This run uses the full quantity, so it cannot prove or disprove this.
- **Not verified:** whether SAP accepts this post; whether this delivery is test data; how to undo it (no 102 path in the app is proven); plant limits (audit finding 6).
- **Next:** After the written go, send one post through the `goodsReceipt` Tier C suite in live mode and read it back from SAP.

### 2026-11-02 IST — Live 261 post on reservation 528779/1 after a new written go: PASS, read back from SAP

- **Status:** PASS for this post. Finding 7 stays open for the other write flows. The order type fix behind this result is uncommitted.
- **Command (WRITE, one run):** the `mvt261` Tier C suite in live mode with `E2E_SAP_LIVE_TARGET='S4HANA_DEV - Client 220'`. RFC preflight passed; suite `[PASS] [live]`; the server log shows one `POST /odata/v4/mvt261/postGoodsIssue`.
- **READ-ONLY read-back from SAP:** `MATDOC` 4900050350/2026 item 0001, movement 261, material 8400000046, batch 2CED260006, `CS01`, 1 KG, order 1011, `CANCELLED` blank, user KHUSHAL. Reservation 528779/1 `ENMNG` 1.000, `KZEAR` X. `cycle` shows Withdrawn 1, Open 0.
- **Side effects in client 220:** `MARD` for `CS01` fell from 14,020 to 14,019 KG. Storage unit 1000059430 still shows 220 KG (`LQUA` unchanged). New TR 1000982 (W01, movement 261) is open with no Transfer Order. So IM and WM stock differ by 1 KG until that TR is processed or the document is reversed.
- **Observed:** `cycle` shows step Reservation as `blocked` after the post; the cause is Not verified. The scanned unit is validated but not used in the posting, as the service comments describe (Option A).
- **Change:** `docs/e2e-coverage-matrix.md` row `wmScan261` moved to SAP 🟢 with this evidence.
- **Validation:** `npx jest test/unit/tools/e2eCoverageMatrix.test.js test/unit/wm/mvt261Adapter.test.js test/unit/wm/mvt261Scan.test.js`: 3 suites and 124 tests passed. `git diff --check` clean. The full suite last passed before the live runs; only docs changed since.
- **Not verified:** whether order 1011 is really test data; live negative paths; the local attempt row.
- **Next:** Decide whether to keep or reverse 4900050350/2026 and how to handle TR 1000982. Then do read-only data discovery for the goods receipt live run.

### 2026-11-02 IST — Live 261 post on reservation 528777/1 after the user's written go: FAIL, refused by SAP, nothing posted

- **Status:** FAIL for the live run, not retried. BLOCKED on a new written go for a different reservation. The 261 scan post is still not proven live.
- **Command (WRITE, one run):** the `mvt261` Tier C suite in live mode with `E2E_SAP_LIVE_TARGET='S4HANA_DEV - Client 220'`. RFC preflight passed. SAP answered `POST .../A_MaterialDocumentHeader` with `HTTP 400 - Maintain serial numbers for total quantity`, and the UI showed that message.
- **READ-ONLY state after the run:** reservation 528777/1 `ENMNG` 0.000; no `MATDOC` rows for it; storage unit 1000059695 `VERME` 1.000. Material 8000009754 has `SERNP` ZSN2 in plant 1120. The local attempt row was not read; by the code path it is `rejected`.
- **What this proves:** The order type fix got the request through CAP to SAP, and SAP's refusal reaches the UI unchanged.
- **Gap found, not fixed:** The 261 flow has no serial number input or payload, and `openItems` and `scanContext` still offer serial-managed materials as scan possible. So these reservations can pass every screen check and then fail at SAP. Serial handling exists elsewhere (`srv/integration/s4hana/wm/TrToAdapter.js`, per the live run in the log at `tools/run1-mvt201-live.js`). How many open 261 items are affected is Not verified.
- **Changes:** `docs/e2e-coverage-matrix.md` row `wmScan261` moved to SAP 🟡 with this result. Local gitignored `test/e2e/live/testData.json` now targets 528779/1.
- **Next attempt prepared (not sent):** Stubbed body `{"movementType":"261","reservation":"528779","item":"1","quantity":1,"orderId":"1011","orderType":"ZEMP","batch":"2CED260006","storageUnits":["1000059430"]}`. Material 8400000046 has `SERNP` blank and is batch-managed. Reservation shows 0 of 1 KG withdrawn; unit 1000059430 had 220 KG available when read.
- **Next:** Send it only after a new written go, then read it back from SAP.

### 2026-11-02 IST — Audit finding 7: fix 261 scan order type and prepare the next live run: PARTIAL, BLOCKED on the user's written go

- **Status:** PARTIAL. Code and tests are done and uncommitted. No SAP write was sent. The 261 scan post is not proven live.
- **Bug found by rehearsal:** `Scan261.controller.js:239` posts `oCtx.OrderType`, but `scanContext` did not return it, so the screen sent `orderType: ""`. `srv/wm/mvt261/service.js` refuses that with 400, as `test/unit/wm/mvt261Scan.test.js` shows. So the screen could not post at all. This is from code and the stubbed request body; a real refused POST was not sent.
- **Changes:** `srv/integration/s4hana/wm/Mvt261Adapter.js` and `srv/wm/mvt261/service.cds` now return `OrderType` from `scanContext`. `test/e2e/wm/roundTripMvt261.e2e.js` now fails on an empty `orderType`, which the dry run could not catch before. `test/unit/wm/mvt261Adapter.test.js` has a new test. Local gitignored `test/e2e/live/testData.json` now holds only the scan case, so one run can send only one write.
- **TEST DECISION:** TEST ADDED and TEST UPDATED.
- **Validation:** Full `npx jest`: 222 suites passed, 1 skipped; 4,318 tests passed, 59 skipped. `eslint` on the 3 changed JS files, `cds compile` and `git diff --check`: clean. Dry-run `mvt261` suite: scan and reverse PASS. Stubbed rehearsal body: `{"movementType":"261","reservation":"528777","item":"1","quantity":1,"orderId":"1011","orderType":"ZEMP","storageUnits":["1000059695"]}`.
- **First candidate dropped:** Storage unit 1000059694 lost its available stock during discovery. User `SAP_USER_14` created TO 1037663 (movement 311) at 12:18:50, the unit's `LQUA` change time. So other users are active in client 220. The server log showed no POST from this work.
- **READ-ONLY target:** reservation 528777/1 is 1 NOS, 0 withdrawn, `HS01`, order 1011 (type ZEMP, created by SAP_USER_25). Storage unit 1000059695 has 1 of 1 available in bin 1-L0001-03. The `LTAP` read by `VLENR` failed with `ID:AD Type:E Number:718`; the other reads worked.
- **Not verified:** whether order 1011 is really test data (INFERRED from its material and order number); whether SAP accepts the post; whether it creates a TR or a delivery; other screens' fields were not checked for the same gap.
- **Next:** After the written go, send one post through the `mvt261` Tier C suite in live mode and read it back from SAP.

### 2026-11-02 IST — Live reversal of 4900050046/2026 after a second written go: PASS, read back from SAP

- **Status:** PASS for this reversal. Finding 7 stays open for the other write flows, and the 261 scan post is still not proven live.
- **Command (WRITE, one run):** the same `runSapRoundTrips.js --allow-live-sap` command as the failed run, against `cap-live-rfc` with the certificate loaded. RFC preflight passed; suite `[PASS] [live]`.
- **READ-ONLY read-back from SAP:** new 262 document 4900050348/2026 with `SMBLN` 4900050046 and `SJAHR` 2026. Document 4900050046/2026 has `CANCELLED` X. `cycle` shows `IsReversed` true, a 262 row with `Reverses` 4900050046/2026/0001, and Reversal done.
- **Side effects in client 220:** reservation 278650/1 is open again (`ENMNG` 0.000, `KZEAR` blank, Open 1). TR 1000744 (W01) `STATU` changed from blank to `E` and still has no Transfer Order; the meaning of `E` is Not verified. `LTBK-MBLNR` still shows 4900050046.
- **Change:** `docs/e2e-coverage-matrix.md` row `wmCycle261` moved to SAP 🟢 with this evidence.
- **Validation:** `npx jest test/unit/tools/e2eCoverageMatrix.test.js test/unit/wm/mvt261Scan.test.js`: 2 suites and 58 tests passed. `git diff --check` clean. The local attempt row was not read.
- **Not verified:** the meaning of TR status `E`; whether the open reservation or the TR needs clean-up; negative paths in a live run.
- **Next:** Decide whether reservation 278650/1 and TR 1000744 need clean-up. Then do read-only data discovery for the next live proof.

### 2026-11-02 IST — Fix false `already reversed` on movement 261 reversal: PARTIAL, live proof pending

- **Status:** PARTIAL. Code and tests are done and uncommitted. No SAP write was sent in this change, so the reversal is still not proven live.
- **Root cause:** `srv/wm/mvt261/service.js` matched `/already|reversed|cancel/i` against an error message that carries the `CancelItem` URL.
- **Changes:**
  - `srv/wm/mvt261/service.js`: removed the text match and now uses the shared `classifyPostingError`. `Already reversed` now comes only from the `IsReversed` read before the post. An unknown outcome stays `unconfirmed`, blocks retries and tells the user to check MB51.
  - `srv/wm/goods-issue/handlers/goodsIssuePerType.handler.js`: a rejected TLS certificate is now `never_reached`, because no request was sent. This shared classifier also serves goods issue postings.
  - `test/unit/wm/mvt261Scan.test.js`, `test/unit/wm/queueReplayResiliency.test.js`: tests added and updated.
  - `.claude/launch.json` (local, untracked): `cap-live-rfc` now sets `NODE_EXTRA_CA_CERTS` to the same certificate as `npm start`. Certificate checks stay on.
- **Behaviour change:** A reversal answered with HTTP 500 is now `unconfirmed`, not `rejected`, so it stays blocked until an operator checks MB51. This matches how goods issue postings are handled.
- **TEST DECISION:** TEST ADDED and TEST UPDATED.
- **Validation:**
  - Focused suites: 7 suites and 187 tests passed.
  - New tests against the old `service.js`: 5 failed, as expected.
  - Full `npx jest`: 222 suites passed, 1 skipped; 4,317 tests passed, 59 skipped.
  - `eslint` on the 4 changed JS files and `git diff --check`: clean.
  - Dry-run `E2E_SAP_FLOWS=mvt261 node test/e2e/runSapRoundTrips.js`: the first run FAILED because `cap-live-rfc` had no certificate (`self-signed certificate` on the `openItems` read). After the launch change it PASSED for scan and reverse. This proves UI wiring only.
- **READ-ONLY SAP state after validation:** document 4900050046/2026 `CANCELLED` blank; no reversal rows.
- **Not verified:** whether SAP accepts `CancelItem` on `HS01` with open TR 1000744; SAP's real refusal text; the local attempt row from the failed run (by the code path `rejected`, which a retry may reclaim); the certificate fingerprint with Basis.
- **Next:** Send the reversal only after a new written go, then read the result back.

### 2026-11-02 IST — Live reversal of 4900050046/2026 after the user's written go: FAIL, nothing posted in SAP

- **Status:** FAIL for the live run. Blocked on a code fix and a new written go. No tracked code changed. Finding 7 stays open for this flow.
- **Command (WRITE, one run, not retried):** `ALLOW_LIVE_SAP_TOOLS=1 E2E_SAP_WRITE_FLOWS=mvt261 E2E_SAP_FLOWS=mvt261 E2E_SAP_LIVE_TARGET='S4HANA_DEV - Client 220' TARGET_URL=http://localhost:4010 node test/e2e/runSapRoundTrips.js --allow-live-sap`. RFC preflight passed; the suite failed with HTTP 422 and the dialog `Material document 4900050046/2026 item 0001 is already reversed`.
- **Actual failure:** The server log shows the `CancelItem` POST failed with `self-signed certificate`. The `cap-live-rfc` launch config runs `cds-serve` directly and so skips the `NODE_EXTRA_CA_CERTS` export in `package.json` `start`. RFC reads still work, which is why every earlier check passed.
- **READ-ONLY SAP state after the run:** `CANCELLED` blank; no reversal rows; `cycle` shows `IsReversed` false and Reversal open; reservation 278650/1 withdrawn 1 of 1; TR 1000744 unchanged. The local attempt row was not read; by the code path it is `rejected`.
- **Bug found, not fixed:** `srv/wm/mvt261/service.js:273` tests `/already|reversed|cancel/i` against the error message. The failing message evidently includes the `CancelItem` URL (INFERRED: nothing else in the logged text matches). So any failure, including a timeout with an unknown outcome, can be reported as `already reversed` and stored as `rejected`, which is reclaimable. This also corrects the earlier claim here and to the user that an unclear outcome blocks a retry.
- **Unresolved:** The trusted certificate is trust-on-first-use; its fingerprint is still not confirmed with Basis.
- **Next:** Fix the classifier with a test, then rerun with `NODE_EXTRA_CA_CERTS` only after a new written go. The certificate bypass was not used.

### 2026-11-02 IST — Prepare reversal of 4900050046/2026 (audit finding 7): BLOCKED on the user's written go

- **Status:** Blocked. No SAP write was sent. No tracked code changed. The reversal has not run, so nothing is proven live.
- **Change:** Added an `mvt261.reverse` section to the gitignored `test/e2e/live/testData.json` (reservation 278650, item 1, document 4900050046/2026, item 0001). This section is what a live run would use.
- **Rehearsal (write stubbed in the browser):** UI toast `Reversal posted. Material document DRYRUN2621/2026`; 1 call to the write action; session errors none. Body: `{"reservation":"278650","item":"1","materialDocument":"4900050046","materialDocumentYear":"2026","materialDocumentItem":"0001"}`. This proves UI wiring only, not SAP behaviour.
- **READ-ONLY SAP state after the rehearsal:** system label `S4HANA_DEV - Client 220`; document row not reversed; no reversal rows; reservation 278650/1 withdrawn 1 of 1 with `KZEAR` X; TR 1000744 (W01) has `MBLNR` 4900050046, blank `STATU`, no Transfer Order.
- **Error:** The first rehearsal ran about 1h46m and was stopped. Root cause: my scratchpad script never called `closeBrowser()`, so Node could not exit and `tail` held back the output. Fixed by calling it and adding a 180s limit. The rerun passed. The stuck run's result was never seen, and server logs show it sent no reverse call.
- **Not verified:** whether SAP accepts `CancelItem` for WM-related `HS01` with open TR 1000744, what happens to that TR, and whether the reservation reopens.
- **Next:** After the written go, start `cap-live-rfc` on port 4010 and run the `mvt261` Tier C suite in live mode with `E2E_SAP_LIVE_TARGET='S4HANA_DEV - Client 220'`, then read the result back.

### 2026-11-02 IST — READ-ONLY check for audit finding 7 (live proof gap): BLOCKED on the user's decision

- **Change:** None to the code. No SAP write was sent.
- **SAP evidence (READ-ONLY, `RFC_READ_TABLE`):** Client 220 is "Pre-Test", `T000-CCCATEGORY` = T. Material document 4900050046/2026 still exists (261, 1.000, plant 1120, HS01, reservation 278650/1), and no `MATDOC` row reverses it. RESB 278650/1 shows 1.000 of 1.000 withdrawn, final-issue flag X. TR 1000744 (W01) still points at that document, has blank `STATU`, and has no Transfer Order in `LTAK`.
- **Proof gap:** From `docs/e2e-coverage-matrix.md`: 3 routes proven, 1 partial, 17 not proven. Goods receipt, 261 and scan-to code changed today and has not run live.
- **NOT VERIFIED:** Whether SAP accepts a 262 reversal while TR 1000744 is open, and what happens to that TR afterwards.
- **Next action:** The user decides on the document and gives a written go per run.

### 2026-11-02 10:05 IST — Goods receipt (101) double-posting protection (audit finding 5): PARTIAL

- **Change:** `postGoodsReceipt` and `postGoodsReceiptWithStorageUnit` now claim an attempt per delivery item before calling SAP. `sending`/`unconfirmed` blocks the item with 409; `posted`/`rejected`/`not_posted` allow the next posting. Unknown outcomes return 504 and tell the user not to post again. New `recheckReceipts` and `findReceiptForAttempt` resolve 101 attempts from `MATDOC`, on a timer in the goods-receipt service; the goods-issue `recheck` now skips 101.
- **Storage-unit path:** Reads the item's 101 documents before posting, reports only a document that is new, and no longer takes the last row or falls back to `EKBE`. If that first read fails, nothing is posted (503). `DeliveryDocument` and its item now pass `sapKey` before reaching RFC WHERE text.
- **MMIM path:** Keeps SAP's HTTP status (previously lost, so it surfaced as 500), and a `sap-message` error is a definite 422.
- **Schema:** `GoodsIssuePostingAttempt.ReservationItem` widened from String(4) to String(6) for delivery items. No new table or column.
- **Deviation from the audit's proposed fix:** The store could not be reused as it was. Its recheck searches SAP by `ReferenceDocument`, which receipts do not send, so it would have marked a saved receipt `not_posted` after 15 minutes and allowed a double post.
- **Files:** `srv/integration/s4hana/wm/GoodsReceiptAdapter.js`, `srv/wm/goods-issue/GoodsIssueAttemptStore.js`, `srv/wm/goods-receipt/handlers/goodsReceipt.handler.js`, `srv/wm/goods-receipt/service.js`, `db/wm/goods-issue-attempt.cds`, `test/unit/wm/goodsReceiptAttempt.test.js` (new), `test/unit/wm/goodsReceiptService.test.js`.
- **Test decision:** TEST ADDED (30 mock tests). TEST UPDATED: the `MATDOC` mock in the `liveDescribe` block of `goodsReceiptService.test.js`; that block never runs under Jest (`test/liveSapGate.js` returns false), so the edit was NOT executed.
- **SAP evidence (READ-ONLY, `RFC_READ_TABLE` on `MATDOC`):** 101 rows carry `VBELN_IM`, `VBELP_IM` and `CPUDT`, and document 5000000015 was returned twice, so row order and uniqueness cannot be relied on. No write was sent.
- **Validation:** Before the fix, the new tests: 25 failed, 5 passed. After the fix: 30 passed. After the final schema edit: `npx jest test/unit test/integration`: 219 suites passed, 1 skipped; 4297 tests passed, 59 skipped; `npm run lint`: no findings; `git diff --check`: clean; `npx cds compile db srv --to json`: succeeded. Local `db.sqlite` still shows `NVARCHAR(4)` for the column; it was not migrated, and SQLite does not enforce that length.
- **Session note:** A verification command accidentally included `rm -f /dev/null`. Checked straight after: `/dev/null` is still an intact character device and accepts writes. No other effect.
- **Not run:** browser E2E (`test/e2e/wm/roundTripGoodsReceipt.e2e.js`), any live receipt posting, and `findReceiptForAttempt` against live SAP. **NOT VERIFIED:** whether HANA deployment applies the column widening cleanly.
- **Behaviour change:** after an unknown outcome the delivery item stays blocked until the recheck resolves it (about 3 to 15 minutes at default settings). A MATDOC read failure now stops the storage-unit posting.
- **Open:** A same-day earlier partial receipt makes the recheck mark an attempt `posted`, possibly naming the wrong document; this is safe against double posting and is marked `shortcut:` in the code. Resubmitting right after a confirmed partial receipt still posts, as on 261. `postGoodsReceipt` without `DeliveryDocument` skips the attempt log; the screen always sends a delivery. A reservation with the same number and item as a delivery would be blocked too (marked `shortcut:`). LIKP and VEKP pre-checks remain best effort and fail open. Audit finding 6 (plant limits) is not addressed.

### 2026-11-02 09:55 IST — Movement 261 HTTP 500 treated as an unknown outcome (audit finding 4): PARTIAL

- **Change:** `postGoodsIssue` now uses the shared `classifyPostingError` (same rule as 201/301/311) instead of its own status list. HTTP 500 and the `GI_POSTING_OUTCOME_UNKNOWN` code now give `unconfirmed`, not `rejected`, and the user is told not to post again. `post261` keeps the unknown outcome when the reference lookup fails, instead of letting the lookup's error replace it (same handling as `post201`).
- **Files:** `srv/wm/mvt261/service.js`, `srv/integration/s4hana/wm/goods-issue/GoodsIssuePostingClient.js`, `test/unit/wm/mvt261Concurrency.test.js`, `test/unit/wm/goodsIssueOutcomesPerType.test.js`, `test/unit/wm/mvt261Scan.test.js`.
- **Test decision:** TEST ADDED (5 mock tests). TEST UPDATED: one exact-message assertion in `mvt261Scan.test.js` failed because of the new wording; it now checks both the original reason and the warning.
- **Validation:** Before the fix, the new tests: 3 failed, 2 passed. After the fix: 5 passed. First `npx jest test/unit test/integration` run: 1 failed (the assertion above), 4266 passed, 59 skipped. After updating it: 218 suites passed, 1 skipped; 4267 tests passed, 59 skipped. `npx eslint` on the 5 changed files: clean. `git diff --check`: clean.
- **Not run:** browser E2E and live SAP. No SAP call was made. **NOT VERIFIED:** which status live SAP uses for business refusals on this API.
- **Behaviour change:** a definite SAP refusal that arrives as HTTP 500 now blocks the item until the recheck marks it `not_posted` (about 15 minutes at default settings), instead of allowing an immediate retry.
- **Open:** The 261 `reverse` action keeps its own status list, so an HTTP 500 there stays `rejected` and re-claimable; it reads SAP's reversed flag before each reversal, and an existing test expects a closed-period 500 to be re-claimable. Not changed. Behaviour changes for errors without a status: a message matching "service unavailable" or a connection-refused error is now definite, not unknown, under the shared rule.

### 2026-11-02 09:51 IST — Movement 261 double post after timeout and blocked re-issue after reversal: PARTIAL

- **Change:** `postGoodsIssue` now returns 409 while any `sending` or `unconfirmed` attempt exists for the reservation item (`hasOpenAttemptForReservation`), and stops if that check cannot be read. `createOrGet` takes an optional `isReclaimable`; 261 uses it to allow a new claim when the fresh SAP history shows the latest posted document as reversed. With a database bound, `hasOpenAttemptForReservation` no longer reads process memory, which could be stale on a second instance.
- **Deviation from the audit's proposed fix:** `openQty` stays in the key. Removing it would give a second partial issue of the same quantity the same key as the first and block it with a permanent 409 (partial issues: `test/unit/wm/mvt261Adapter.test.js` A3). The new item-level check closes the same timeout hole.
- **Files:** `srv/wm/mvt261/service.js`, `srv/wm/goods-issue/GoodsIssueAttemptStore.js`, `test/unit/wm/mvt261Concurrency.test.js`.
- **Test decision:** TEST ADDED (8 mock tests).
- **Validation:** Before the fix, `npx jest test/unit/wm/mvt261Concurrency.test.js -t 'open quantity changes'`: 5 failed, 3 passed. After the fix: 8 passed. `npx jest test/unit test/integration`: 218 suites passed, 1 skipped; 4262 tests passed, 59 skipped. `npx eslint` on the 3 changed code files: clean. `git diff --check`: clean. The 503 error line and its test mock message were then adjusted to avoid a repeated sentence, then `npx jest test/unit/wm/mvt261 test/unit/wm/goodsIssue` was rerun: 26 suites passed, 1 skipped; 512 tests passed, 18 skipped. `npx eslint` on the 2 files changed by that edit: clean. The full suite was not rerun after that edit.
- **Not run:** browser E2E and live SAP. No SAP call was made. **NOT VERIFIED:** that SAP's cancelled flag (`IsReversed`) appears in the live cycle history after a 262.
- **Behaviour change:** after a timeout, the item stays blocked until the recheck resolves the attempt (first check after about 3 minutes, `not_posted` after about 15 minutes at default settings).
- **Open:** Once an attempt is confirmed `posted`, resubmitting the same quantity at the new open quantity still posts, because it looks the same as a new partial issue. Two simultaneous requests can both pass the item check when their keys differ. HTTP 500 is still marked `rejected` (audit finding 4). A `delivery_created` attempt does not block a request with a different key.

### 2026-11-02 IST — READ-ONLY live check of `LTBK-MBLNR` and the reservation-entry guard: PASS for the check; guard work stays PARTIAL

- **Change:** None to the code. Resolves the NOT VERIFIED item in the 09:46 entry.
- **Command:** `RFC_READ_TABLE` reads only, from a throwaway script outside the repo, using the local `.env.local` connection. No write was sent to SAP.
- **Result:** `LTBK-MBLNR` is readable. In warehouse W01, TRs 1000955, 1000956, 1000957, 1000958 and 1000959 have `MBLNR` filled, and each document exists in `MATDOC` (movements 311, 311, 101, 311, 311). `assertGoodsMovementNotPosted` refused all 5 with 409 and passed TR 1000961, whose `MBLNR` is blank.
- **Not proven:** A sample of 5 TRs does not show that a filled `MBLNR` always means no further movement is due. The `postMigoGoodsMovement` and `retryStep` actions were not called, and no browser E2E was run. The tr-to guard's read through `Z_WM_GET_TR_MATERIAL_LIST` was not exercised.

### 2026-11-02 09:46 IST — MIGO double-posting guard added to `/odata/v4/reservation-entry`: PARTIAL

- **Change:** New `ReservationProcessAdapter.assertGoodsMovementNotPosted`, called at the start of `postMigoForTrack`, so it covers both `postMigoGoodsMovement` and `retryStep` with step MIGO. It reads `LTBK-MBLNR` for the record's TR (found through `LTAK` when only a TO is stored). A filled value gives 409, a failed read gives 503, and nothing posts in either case. Both callers record these as status 90 with the reason; `postMigoGoodsMovement` still returns HTTP 200 with that record, as for its other MIGO failures.
- **Files:** `srv/integration/s4hana/wm/ReservationProcessAdapter.js`, `srv/wm/reservation-entry/service.js`, `test/unit/wm/reservationEntryService.test.js`.
- **Reason:** This path had no such check, so a TR already posted through its material document could be posted again.
- **Test decision:** TEST ADDED (5 mock tests). The `retryStep` MIGO route is not tested directly; it shares `postMigoForTrack`.
- **Validation:** Before the fix, `npx jest test/unit/wm/reservationEntryService.test.js -t 'double-posting guard'`: 4 failed, 1 passed (posting went through with status 05). After the fix: 5 passed. `npx jest test/unit test/integration`: 218 suites passed, 1 skipped; 4254 tests passed, 59 skipped. `npx eslint` on the 3 changed code files: clean. `git diff --check`: clean.
- **Not run:** browser E2E and live SAP. No SAP call was made. **NOT VERIFIED:** that `RFC_READ_TABLE` can read `LTBK-MBLNR` on the live system; existing code at `trTo.handler.js` requests the same field, but its failures are tolerated there.
- **Open:** Records with neither TR nor TO have nothing to check. An empty LTAK result still skips the guard on both paths. The tr-to guard reads through `Z_WM_GET_TR_MATERIAL_LIST` and this one through `LTBK`; they were not merged.

### 2026-11-02 09:42 IST — MIGO double-posting guard no longer ignored on `/odata/v4/tr-to`: PARTIAL

- **Change:** In `postMigoGoodsMovement`, the 409 for a TR created by a posted material document now reaches the caller. A failed LTAK or TR read now returns 503 and stops the posting. Failures of the optional RESB/RKPF/LTBK/LTAP metadata reads still only log a warning, as before.
- **Files:** `srv/wm/tr-to/handlers/trTo.handler.js`, `test/unit/wm/trToHandler.test.js`.
- **Reason:** The surrounding `catch` rethrew only status 400 and `getTR` errors were swallowed, so the check could be skipped and the same stock moved twice. Found by the 2026-11-02 repo audit.
- **Test decision:** TEST ADDED (5 mock tests).
- **Validation:** Before the fix, `npx jest test/unit/wm/trToHandler.test.js -t 'double-posting guard'`: 3 failed, 2 passed (bug reproduced). After the fix: 5 passed. `npx jest test/unit test/integration`: 218 suites passed, 1 skipped; 4249 tests passed, 59 skipped. `npx eslint` on both changed files: clean. `git diff --check`: clean.
- **Not run:** browser E2E (`test/e2e/wm/roundTripScanTo.e2e.js`) and live SAP. No SAP call was made.
- **Open:** `srv/wm/reservation-entry/service.js` `postMigoGoodsMovement` has no equivalent check. An empty LTAK result still skips the guard. Neither was changed because both are outside this fix.

## Change Entry — 2026-11-02 15:15 IST — Merge Duplicate Credentials and Token Check in server.js (Audit Finding 13)

- **Reason:** `server.js` repeated the same credentials block for 5 S/4 services and the same Bearer token check twice, so a change had to be made in several places.
- **Changed:**
  - `server.js`: one loop over the 5 service names replaces `credsFS`, `credsMaint`, `credsSDWL`, `credsSDFS`, `credsSDSO` and their two lists of assignments (258 → 188 lines). Both mount points (`app.use` in bootstrap, `cds.middlewares.add` before auth) now use one function.
  - `srv/auth/localTokenUtil.js`: new `applyBearerToken` middleware. The production and issuer gate stays inside `verifyToken` through `isDevTokenIssuerEnabled`.
  - `test/unit/serverLocalConfig.test.js`: new, loads the real `server.js` with fake values. It passed on the old code first (6/6), then on the new code.
  - `test/unit/auth/localTokenUtil.test.js`: 3 new `applyBearerToken` cases.
- **Behaviour note:** the `app.use` mount now also sets `cds.context.user` when a CAP context exists; only the second copy did this before. Expected to have no effect, because CAP's context starts after that mount (INFERRED, not separately tested).
- **Not changed:** `ReservationProcessAdapter.js` (about 4,339 lines) is not split. The finding says to split it only when it is next worked on.
- **TEST DECISION: TEST ADDED.**
- **Executed validation:**
  - `npx jest test/unit/serverLocalConfig.test.js test/unit/auth/localTokenUtil.test.js test/integration/purchase-order/authorization.test.js`: 3 suites, 32 tests PASS.
  - `npx jest --silent`: 226 suites passed, 1 skipped; 4428 tests passed, 59 skipped, 0 failed.
  - `npm run lint`: clean. `git diff --check`: clean.
  - READ-ONLY `node test/e2e/runAllE2E.js http://localhost:4010 --only="Shell screens,MM screens,SD screens,Write authorization"` on a fresh `cap-e2e` server: all 4 suites PASS, with live SAP reads for purchase orders (3019 rows), sales orders (973), customer invoices (520) and customer returns (186).
  - Local server, `$metadata` of the purchase order service: no token 401, valid token 200, valid lower-case `bearer` 200, forged token 401.
- **Not run:** the full browser E2E run, and the WM, LE and goods movement suites. They do not use the 5 merged service settings differently, but this was not checked by running them. No SAP write was made.
- **Errors/warnings:** server log showed only `[cds-plugin-ui5] - Failed to inject application links into CDS index page!` and shell `getcwd` messages; neither was investigated and neither is from this change (INFERRED).
- **Next action:** commit when the user asks. Remaining audit items: replace the exposed SAP password, make the repo private, and the other open items in Current Status.
- **Assumptions:** the behaviour note above is INFERRED.
- **Status:** PASS for the requested merge; uncommitted.

## Change Entry — 2026-11-02 15:45 IST — Dead-Code Cleanup, Removal Only (7 Batches)

- **Reason:** user-requested dead-code cleanup with no change to functionality, behaviour or public API. The report was approved before any removal.
- **Inspect:** git status clean at start. Candidates came from in-memory strict ESLint over 540 JS files, an AST scan of functions, methods and exports, word-exact searches across `srv`, `app`, `db`, `test`, `tools`, config, XML, CDS and manifest, and checks for dynamic access. No SAP call was made. READ-ONLY and WRITE SAP calls: none.
- **Baseline before changes:** Jest 226 suites passed, 1 skipped; 4,428 tests passed, 59 skipped, 0 failed. Root ESLint clean. `ui5lint` no findings. UI5 build succeeded. `cds compile` exit 0. Secret scan 0 findings. `npm run test:e2e:sap-free` 2 of 3 suites passed on the untouched tree, run twice with the same result: Quarantine labels case "Goods-receipt list (mocked, DEMO)" FAIL with `TimeoutError: page.click: Timeout 30000ms exceeded`. INFERRED from the Playwright trace: the failing click is the row print button (`--qlDocTable` ... `button[title="Print 4x6 labels"]`, `test/e2e/wm/verifyQuarantineLabels.e2e.js:226`).
- **CHANGED (37 files, 19 insertions, 1,354 deletions; insertions are lines re-emitted without a removed entry or trailing comma, plus 2 blank lines from diff alignment in the i18n bundles):**
  - **Batch 1, backend dead members (78 lines):** `_fetchRawCount` (PurchaseOrderAdapter), `postGoodsIssueByType` (GoodsIssueAdapter), `_today` (GoodsIssuePostingClient), `mapToS4DocumentPayload` (SalesInquiryMapper), `validateSalesDocumentPayload` (salesInquiry.validation), `COST_CENTER_REGEX`, `GL_ACCOUNT_REGEX`, `checkOptionalFourChar` (goods-issue validation/common), `SO_VALUE_HELP_ENTITIES` (sales-order valueHelp.config). Deleted `srv/wm/reservation-entry/movementConfig.js`.
  - **Batch 2, unused export entries (19 lines removed, 6 re-emitted):** `LOCAL_DEV_ISSUER`, `LOCAL_DEV_EXPIRY_SECONDS`, `projectionWhere`, `LOCAL_CREDENTIAL_SOURCES`, `_formatODataV2Literal`, `_cqnOrderByToOData`, `UNSUPPORTED_HEADER_FIELDS`, `errorsOf`, `QUARANTINE_STORAGE_TYPES`, `READBACK_TABLE`, `assert261Request`, `assertMaterialDocumentMetadata`, `FS_VALUE_HELP_ENTITIES`, `MAINT_VALUE_HELP_ENTITIES`, `cleanSerials`, `LABEL_SIZES_IN`. The code stays; only the export entry went.
  - **Batch 3, UI handlers and methods (78 lines):** `onSelectTabFI`, `onSelectTabMM`, `getDeliveryWithoutRefTypes`, `getDeliveryWithoutRefShipToParties`, `getPurchaseOrder`, `onHeaderChange`, `getStatuses`, `clearRecentScans`.
  - **Batch 4, rack dialog chain (120 lines):** deleted `VisualRackDialog.fragment.xml`; removed `onSearchVisualRack`, `onCloseVisualRackDialog`, `onSelectRackItem`, the `visualRack` model field, and 5 `visualRack*` i18n keys.
  - **Batch 5, UI unused imports and locals (37 lines):** `Fragment` import (Dashboard), `_FilterOperator` with the unused `Filter` and `FilterOperator` imports (OutboundDeliveryService, CustomerInvoiceService), `oHeader`, `oErr`, `oModel`, `that` twice, `self`, `aDecoratedCells`, `COL_GAP`.
  - **Batch 6, CSS (57 lines):** `.textBold`, `.giCardPanel` and `.giFormValueText` rules in `css/style.css`.
  - **Batch 7, i18n (965 lines):** 469 unused keys from both bundles, plus 13 section comment lines left with no keys. Keys were recomputed first; 49 keys that a dynamic string fragment could build were kept. Check: no literal `i18n>` or `getText("...")` reference became newly unresolved.
- **TEST DECISION:** EXISTING TEST SUFFICIENT — the full Jest suite and `npm run test:e2e:sap-free`. No test file changed.
- **TESTED after each batch:** full Jest run after batches 1-5 and 7, each 226 suites and 4,428 tests passed, 59 skipped; batch 6 ran 9 suites / 82 tests covering controllers, frontend and a11y. Backend batches also ran `npx eslint .` and `cds compile`; UI batches ran `ui5lint` (not needed for CSS) and a UI5 build to the scratchpad. All clean.
- **TESTED at the end:** `npx eslint .` clean; `cds compile` exit 0; `scan:secrets` 0 findings; `git diff --check` clean; `npm run test:e2e:sap-free` same as baseline, 2 of 3 suites passed with the same single case failing. A re-scan found no function left without references except the two review-list items and framework or map callbacks.
- **NOT VERIFIED:** the other 20 browser suites (they need live SAP reads and were not part of the approved plan). No live SAP read or write ran. Deployed external callers of internal modules cannot be seen from this repo (INFERRED none).
- **Errors/warnings:** the failing Quarantine labels case above existed before this work and is not fixed here. Found and not fixed: code references i18n keys that no bundle defines (`poValCompanyCodeMismatch`, `poValSupplierAccountGroupMismatch`, `poValPurchOrgMismatch`, `poValCurrencyMismatch`, `msgStaleDataConflict`, `grErrStaleData`, `grPromptReloadData`, `titleStaleDataConflict`, `huNoSelection`, and others); `srv/integration/s4hana/sapFacts.js` cites `tools/smoke-sap-readonly.js`, which does not exist.
- **Left for manual review (Medium confidence, not removed):** `checkStagingForReservation`; unused `sapFacts.js` members; `CreateReturnDialog.fragment.xml` and its `CustomerReturns.controller.js` handlers; methods and exports only tests call, and `goodsIssue261.validation.js`; unused `cds` and `LOG` requires; 49 possibly dynamic i18n keys; duplicate i18n keys (`btnDeleteItem` has two values); unused parameters and `_`-prefixed locals; `QrCode.js` locals; about 70 `tools/` scripts; root `db-*.sql`, `AUDIT_*.md`, `migo_idempotency_design.md`, `AetherLogoForSAP.svg`; `@sap-cloud-sdk/resilience`.
- **Assumptions:** no SAP contract changes. Code outside this repo does not call the removed internal members (INFERRED).
- **Next action:** review the diff and commit when the user asks.
- **Status:** PARTIAL. Removal is complete and matches baseline on everything run; browser coverage is incomplete and uncommitted.

## Change Entry — 2026-11-02 16:10 IST — Review of `checkStagingForReservation` (No Code Change)

- **CHANGED:** `WORKSTATUS.md` only (Next Steps brought up to date and this entry). `feature01` was pushed to `origin` at `3aa2ad95`; the two side-session worktrees and local `claude/*` branches were removed at the user's request.
- **Finding:** `GoodsIssueStockUnitClient.checkStagingForReservation` lost its callers in `e5ab2aae` (2026-10-05, removal of the old 261 feature). Those callers were `stagingCheck` in `postGoodsIssue261`, `storageUnitFinalReconcileCheck261`, and `submitGoodsIssueRequest`; none of them exists today.
- **Current staging guard:** the 261 flow re-checks staging before posting through `Mvt261Adapter.revalidateStock`, which throws HTTP 422 on a shortfall (`srv/integration/s4hana/wm/Mvt261Adapter.js:955-979`, called at `:1086` and `srv/wm/mvt261/service.js:57`). `test/unit/wm/mvt261Adapter.test.js` covers the shortfall classification.
- **Why the old method should not be rewired:** it answers `isStaged: true` when its SAP reads fail (`GoodsIssueStockUnitClient.js:1277-1292`), so it fails open.
- **UNKNOWN:** 201, 301 and 311 have no staging check today. No removed per-type staging call applied to them, but whether `submitGoodsIssueRequest` covered other movements, and whether the business needs staging there, is not verified.
- **TEST DECISION:** TEST NOT POSSIBLE for live behaviour: no SAP call was in scope. No code changed, so no test run was needed. **TESTED:** none. **NOT VERIFIED:** CI result of `3aa2ad95` (in progress when last read).
- **Assumptions:** none beyond the UNKNOWN above.
- **Next action:** user decides whether to remove the method. No SAP read or write ran.
- **Status:** PASS for the review; removal not done.

## Change Entry — 2026-11-02 16:20 IST — Remove Unused `checkStagingForReservation`

- **Reason:** the user approved removal after the review in Change Entry 2026-11-02 16:10 IST. The method had no caller and is superseded by `Mvt261Adapter.revalidateStock`.
- **CHANGED:** `srv/integration/s4hana/wm/goods-issue/GoodsIssueStockUnitClient.js`, 70 lines removed (method and its comment), no line added. `_detectWmManaged`, `listStockUnitsForReservationItem` and `sapKey` stay in use by other code in that file.
- **TEST DECISION:** EXISTING TEST SUFFICIENT — the full Jest suite. No test referenced the method.
- **TESTED:** `env -u RUN_LIVE_SAP -u SAP_SYSTEM_TYPE -u ALLOW_LIVE_SAP_TOOLS npx jest --runInBand --ci` 226 suites passed, 1 skipped; 4,432 tests passed, 59 skipped, 0 failed (4,432 is the current baseline since the i18n fix added 4 tests). `npx eslint .` clean. `npx cds compile srv --to json` exit 0.
- **NOT VERIFIED:** browser E2E not run, as this is a backend method with no caller. No SAP read or write ran. Deployed external callers cannot be seen from this repo (INFERRED none). Whether 201, 301 and 311 need a staging check remains UNKNOWN; this removal does not change them.
- **Next action:** commit when the user asks; continue the Medium-confidence list.
- **Status:** PASS for the removal; uncommitted.

## Change Entry — 2026-11-02 16:17 IST — Reservation List Shows SAP GUI Reservations First Page

- **Reported:** "#/wm/reservation-entry? GUI based Entry is not showing." INFERRED meaning: reservations created in SAP GUI do not appear in the list. The create form and the list both render, so no other reading was reproduced.
- **Root cause (reproduced, READ-ONLY):** `ReservationEntryList.controller.js` appended SAP-only rows after app-tracked rows without sorting. The table grows 25 rows at a time, so with 27 tracked rows the first page held 0 SAP-only rows and the newest reservation, 535381, sat at row 28. The backend was correct: `getOpenReservations` returned 429 rows, 415 of them untracked. Not caused by the dead-code cleanup, which removed only the uncalled `getStatuses` from this module.
- **CHANGED:** `ReservationEntryList.controller.js`, one sort on the merged list, newest reservation first. `test/unit/wm/reservationEntryUi.test.js`.
- **TEST DECISION:** TEST ADDED and TEST UPDATED — new `lists tracked and SAP-only reservations together, newest reservation first`, seen failing before the fix. Three existing tests had only order expectations updated (dedupe, unsupported movements, normalization); their data and field checks are unchanged.
- **TESTED:** Jest 226 suites passed, 1 skipped; 4,433 tests passed, 59 skipped, 0 failed. `npx eslint .` clean. `ui5lint` no findings. UI5 build succeeded (before the final test-only edits). `npm run test:e2e:sap-free` 3 of 3 suites. `git diff --check` clean.
- **VERIFIED on a local server, port 4010, READ-ONLY against SAP under the write guard:** first row 0000535381 (DRATHOD); first page 14 SAP-only and 11 tracked rows; all 442 rows present and sorted; the 27 tracked rows still listed; opening the first row routes to its detail with no error or failed request.
- **E2E:** `test/e2e/wm/verifyWmScreens.e2e.js` READ-ONLY: 16 of 17 steps PASS, including all three reservation entry steps. **FAIL:** "Warehouse scan-to detail (first open TR)": TR 1000992 "has no open items (already completed)" with an HTTP 400. This is a different screen that this fix does not touch; cause NOT VERIFIED and not fixed here. The suite status is therefore FAIL on that step.
- **NOT VERIFIED:** the user's server on port 4004 and browser were not used; the user has not confirmed this was the reported problem. No SAP write ran.
- **Assumptions:** the INFERRED meaning above. `ReservationNo` is numeric, as in the existing sort in `GoodsIssueReservationsClient`.
- **Next action:** user refreshes the page and confirms; commit when the user asks.
- **Status:** PASS for the list fix; uncommitted.

### 2026-11-03 13:51 IST — SAP-only database removal investigation: BLOCKED

- **Request:** User confirmed removing the application database entirely and using SAP only. This confirms scope, not a live SAP write or deployment.
- **Preflight:** Read AGENTS.md and WORKSTATUS.md; git status was clean. Inspected package configuration, MTA topology, persistence consumers, tests, SAP-source proposals and customizing documentation. CAP MCP model and documentation queries succeeded.
- **CHANGED:** WORKSTATUS.md only; recorded findings and next action. No runtime code, SQL file, database, dependency or deployment resource removed.
- **CONFIRMED:** package.json:62-72 configures development SQLite and test memory storage. mta.yaml:97-103 and :154-158 define the HANA deployer/resource. tools/live-sap-gate.js:3-9 requires ALLOW_LIVE_SAP_TOOLS=1 plus --allow-live-sap; it is a tool opt-in, not a persistence provider.
- **Affected flows:** Goods issue, 261 and goods receipt use GoodsIssueAttemptStore (srv/wm/goods-issue/GoodsIssueAttemptStore.js:24-39; goods-receipt/handlers/goodsReceipt.handler.js:48). Database-free fallback is per-instance memory (:111-114); restart durability and shared claims would be lost (INFERRED from implementation). Reservation-track and tr-to handlers still use persisted workflow records. BusinessConfigResolver resolves warehouse policies and label settings from application data, including direct DB lookups (:232-247); BusinessConfig admin writes remain database-backed.
- **Discovery:** Searched repository ABAP, WM discovery, tools and customizing evidence for replacements. docs/abap/z_wm_res_lock.fugr.abap:2 labels the lock wrapper proposal NOT deployed/activated/tested. Existing SAP material-document read-back is not proof of a durable atomic pre-posting claim. No verified complete replacement contract was found; actual SAP availability remains UNKNOWN. No SAP calls made.
- **Plan:** Stop dependent removal per AGENTS.md; identify and verify SAP contracts for durable claims, workflow tracking and application settings before implementation. Do not substitute volatile memory or guessed configuration. No dependencies added; active persistence consumers cannot be classified as dead code.
- **TEST DECISION:** EXISTING TEST SUFFICIENT for investigation — test/unit/wm/goodsIssueAttemptInstances.test.js, test/unit/common/BusinessConfigResolver.test.js, test/unit/liveSapToolGate.test.js. These tests do not prove SAP-only operation.
- **TESTED / REGRESSION:** `env -u RUN_LIVE_SAP -u SAP_SYSTEM_TYPE -u ALLOW_LIVE_SAP_TOOLS npx jest --runInBand test/unit/wm/goodsIssueAttemptInstances.test.js test/unit/common/BusinessConfigResolver.test.js test/unit/liveSapToolGate.test.js`: first run failed on sandbox localhost binding (`listen EPERM`), with 2 suites / 42 tests passing and 1 suite / 6 tests failing. Approved retry outside sandbox: all 3 suites / 48 tests PASS. Warnings: CAP custom create/get method name conflicts and empty configured 261 blocked-bin rules. These were not changed. `git diff --check` passed; reviewed diff and git status show WORKSTATUS.md only. Full regression, build, UI/browser and deployment checks not run because runtime code is unchanged; SAP-only business behavior remains unverified.
- **NOT VERIFIED:** SAP replacement APIs, live connectivity/authorization, SAP-only runtime, browser E2E, deployed BTP behavior and data migration/retention. No live writes authorized or executed.
- **BLOCKED / next action:** User identifies existing SAP API/owner for these responsibilities, or confirms SAP-side development is in scope. A later specific live write still requires written go.
- **ASSUMPTIONS:** ALLOW_LIVE_SAP_TOOLS is the flag intended by the user's spelling (INFERRED). Preserve existing behavior during migration (INFERRED).
- **FINAL STATUS:** BLOCKED for database removal.

### 2026-11-03 13:55 IST — Live SAP-only replacement discovery and migration specification: BLOCKED

- **Request / plan:** User said Go after the replacement question; proceeded with read-only discovery and a concrete migration specification. No specific SAP write/deployment was authorized. Read AGENTS.md/current work status, checked git status (only prior WORKSTATUS.md edit), inspected existing client/guard, metadata tools, architecture decision, model/handler consumers and tests.
- **CHANGED:** docs/decisions/sap-only-persistence-migration.md and WORKSTATUS.md. Requirements cover durable claims, tracking, business settings, migration/retention, removal sequence and acceptance tests. No runtime code, database, SQL files, dependencies or MTA resources changed.
- **VERIFIED (READ-ONLY):** Existing native RFC library available; required local connection keys present (values not displayed). Guarded inline Node probes used ALLOW_LIVE_SAP_TOOLS=1, --allow-live-sap, RfcClient and createReadOnlyRfcClient; allowed function RFC_READ_TABLE only. First sandbox query failed RFC_COMMUNICATION_FAILURE; approved outside-sandbox retry succeeded. Exact TFDIR query for Z_WM_RES_LOCK and active DD03L queries for ZRES_TRACK/ZRES_LOG each returned zero rows; Z%RES% function search also zero. Control Z_WM_GET_TR_MATERIAL_LIST returned FMODE R. Z% catalog: 193 functions and 490 TABL repository objects, both below 501 cap. Large initial catalog output was truncated; repeated two reads for concise inspected capture. Name search is not capability verification. No SAP writes ran.
- **TEST DECISION:** EXISTING TEST SUFFICIENT for investigation — readHuStockEvidence.test.js, goodsIssueAttemptInstances.test.js, BusinessConfigResolver.test.js and liveSapToolGate.test.js. No implementation is claimed.
- **TESTED:** `env -u RUN_LIVE_SAP -u SAP_SYSTEM_TYPE -u ALLOW_LIVE_SAP_TOOLS npx jest --runInBand test/unit/tools/readHuStockEvidence.test.js test/unit/wm/goodsIssueAttemptInstances.test.js test/unit/common/BusinessConfigResolver.test.js test/unit/liveSapToolGate.test.js` — 4 suites / 50 tests PASS (approved outside-sandbox localhost listener). Warnings: CAP custom create/get method conflicts and empty configured 261 blocked-bin rules; not changed. `git diff --check` PASS. Reviewed new specification and WORKSTATUS diff. Unrelated concurrent theme/sidebar updates in WORKSTATUS.md were preserved; their validation is not evidence from this task. `node tools/scan-secrets.js` passed: 992 tracked files, zero findings (new untracked specification reviewed manually; scanner does not cover it). Final git status also shows an unrelated concurrent test/e2e/a11y/baseline.json change; left untouched.
- **NOT VERIFIED / BLOCKED:** Differently named/Y/standard/namespaced/OData alternatives, complete SAP replacement interfaces, authorization for replacement operations, durable atomicity/recovery, SAP-only browser round trips, BTP deployment, migration/retention. Live metadata does not prove new transactional behavior.
- **ASSUMPTIONS:** Go approves proceeding with SAP-side replacement investigation/preparation (INFERRED), not a specific external write. Preserve current features and safeguards (INFERRED).
- **REGRESSION:** No runtime changes. Full runtime regression and SAP-only E2E pending implementation.
- **Next action:** Establish SAP development ownership and verified replacement contracts using the specification; scope approval already exists. Do not delete application persistence until replacements and migration are proven.
- **FINAL STATUS:** BLOCKED for database removal; discovery/specification prepared.

### 2026-11-03 14:02 IST — SAP package/client discovery and ZAMM selection: BLOCKED

- **Request / plan:** User requested implementing the SAP package/target. Inspected AGENTS.md, current WORKSTATUS, git status, existing ADT tools/package conventions and read-only test guard. Investigated package/client metadata before requesting the remaining decision. User explicitly selected ZAMM and will provide development target and transport request.
- **CHANGED:** docs/decisions/sap-only-persistence-migration.md and WORKSTATUS.md; recorded selected package and verified live facts. No runtime implementation, package creation, SAP activation, SQL removal or deployment. Preserved prior work and unrelated a11y baseline edit.
- **VERIFIED (READ-ONLY):** Guarded inline Node probe (`ALLOW_LIVE_SAP_TOOLS=1 node - --allow-live-sap`, existing RfcClient/readOnlyRfcGuard) made five successful RFC_READ_TABLE calls outside the network sandbox. TDEVC: ZAMM/HOME and $TMP/LOCAL found; ZRES_WM absent from query results. TADIR: Z_VENDOR_REMOTES and ZMM_QUAR_LABEL both in $TMP. DD03L verified client-role field/domain; T000 returned T for configured client; DD07T resolved T to Test. No credential/environment values displayed; no SAP writes. This does not prove that the current test client is the approved development target.
- **TEST DECISION:** EXISTING TEST SUFFICIENT — test/unit/tools/readHuStockEvidence.test.js and test/unit/liveSapToolGate.test.js for read-only/redaction and opt-in behavior.
- **TESTED:** `env -u RUN_LIVE_SAP -u SAP_SYSTEM_TYPE -u ALLOW_LIVE_SAP_TOOLS npx jest --runInBand test/unit/tools/readHuStockEvidence.test.js test/unit/liveSapToolGate.test.js` — 2 suites / 5 tests PASS, no warnings. `git diff --check` PASS. Reviewed specification additions, work log and git status; only documentation changed by this task, unrelated a11y baseline edit preserved.
- **NOT VERIFIED / BLOCKED:** User's development target and workbench transport request are pending; replacement SAP contracts/atomicity/authorization and SAP-only E2E remain unverified. Package selection does not remove these dependencies.
- **ASSUMPTIONS:** Preserve existing behavior; the connected test client is not assumed to be the deployment target.
- **REGRESSION:** No runtime changes; full application regression/build/E2E not applicable to this documentation decision.
- **Next action:** User supplies development target and transport request; then verify target/contracts before preparing dependent implementation.
- **FINAL STATUS:** BLOCKED for implementation/database removal. ZAMM selection is confirmed.

### 2026-11-03 14:37 IST — Database removal inventory (steps 1-3 of the user's request): BLOCKED on the user's OK

- **Request:** Remove the SQL database completely with SAP as the only data source; list what will be deleted and wait for the OK before deleting.
- **CHANGED:** WORKSTATUS.md only, on new branch `chore/remove-application-db`. No code, database, dependency or deployment file changed or deleted.
- **CONFIRMED, the switch:** `AllowSAPtool` has zero matches in the repository. `ALLOW_LIVE_SAP_TOOLS` gates `tools/` scripts only (`tools/live-sap-gate.js`, `tools/live_sap_gate.py`); no runtime code reads it. There is no DB-or-SAP branch to remove. The runtime branches on whether `cds.db` exists. Using the flag as the user's meaning is INFERRED.
- **CONFIRMED, no-database boot probe:** with the test profile, no SAP variables and `requires.db=false`, the CAP server boots and `/health`, `goods-issue/$metadata` and `tr-to/$metadata` return 200. `reservation-track/ReservationTracks` and `ReservationStatuses` return 500 `NO_DATABASE_CONNECTION`. `business-config/BusinessConfigs` returns 404 because `srv/service.cds` does not include that service, so `BusinessConfig` has no served maintenance API.
- **CONFIRMED, posting attempts:** `GoodsIssuePostingAttempt` guards movement 261 (`srv/wm/mvt261/service.js:98,114`), goods receipt (`srv/wm/goods-receipt/handlers/goodsReceipt.handler.js:48`), HU transfer (`srv/wm/hu-stock-transfer/handlers/huStockTransfer.handler.js:120`) and goods issue (`srv/wm/goods-issue/handlers/goodsIssuePerType.handler.js:538`). The memory fallback (`GoodsIssueAttemptStore.js:113`) is per process and `mta/extensions/prod/prod.mtaext:9` sets 2 instances. A SAP read is not an atomic claim, and the store waits 15 minutes before treating a missing document as not posted (`GoodsIssueAttemptStore.js:58`).
- **CONFIRMED, tracking:** no UI code calls `/odata/v4/tr-to` or `/odata/v4/reservation-track`. `TrToAdapter` and `ReservationProcessAdapter` are used only by the `tr-to` service. Without tracking, `checkMigoIdempotency` still reads MATDOC, but a further partial issue on an item with an earlier document returns 409 (`ReservationProcessAdapter.js`, `knownWithdrawn === null`), and `getTRByReservation` loses its lookup for movement 311 (`TrToAdapter.js:582`).
- **VERIFIED (READ-ONLY, RFC_READ_TABLE only, via `tools/lib/readOnlyRfcGuard.js`):** plant 1120 currency INR (T001K, T001) and shipping points WAVG, 1112 (TVSTZ) match the local `BusinessConfig` row. T320 confirms W01 for plant 1120. T001L has sales area data on 9 of 72 storage locations with two combinations, 1000/14/00 and 1000/10/52, so a plant-only call cannot derive one. No SAP write ran.
- **UNKNOWN:** the production database contents, whether production is deployed, and any outside callers of `tr-to`. Local rows (read only): BusinessConfig 1, attempts 6 with none open, ReservationTrack 30, ReservationLog 98, ReservationStatus 10.
- **TEST DECISION:** TEST NOT POSSIBLE for this entry; no code changed, and the tests follow the approved deletion. Unit, build, lint and E2E suites were not run.
- **TESTED:** the two probes above only. `git diff --check` is run before the commit.
- **NOT VERIFIED:** full suites without a database, every SAP flow without a database, deployment.
- **ASSUMPTIONS:** `ALLOW_LIVE_SAP_TOOLS` is what the user meant by `AllowSAPtool` (INFERRED).
- **REGRESSION:** no runtime change.
- **Next action:** the user approves the delete list and answers the open questions.
- **FINAL STATUS:** BLOCKED, waiting for the user's OK. Nothing deleted.
