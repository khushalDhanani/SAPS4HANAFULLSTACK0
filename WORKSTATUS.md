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

- **"Nothing was posted" refusals stay visible in production (2026-11-04 17:32 IST) — PARTIAL, uncommitted, not deployed, not run against SAP:** Plant scope refusals, shipping point read failures, posting-log failures, goods receipt read failures and HU stock transfer checks now keep their text in production. Still hidden there: the handling unit read failure right after a commit (no number, duplicate risk), the lock and unlock SAP reason, and other 5xx text.

- **Errors naming work that may already be in SAP stay visible in production (2026-11-04 17:26 IST) — PARTIAL, uncommitted, not deployed, not run against SAP:** Sales inquiry partial creation, a failed commit after a sales inquiry or return was created, goods receipt and HU stock transfer with an unknown outcome, and a handling unit committed but not read back now keep their text in production, instead of a generic "Bad Gateway". The "nothing was posted" refusals are in the entry above.

- **Unconfirmed invoice cancel and customer return (2026-11-04 17:12 IST) — PARTIAL, committed locally as `5b9621e6`, not pushed, not deployed, not run against SAP:** When SAP accepts the write but no read-back confirms it, these now answer 502 with the document number and "NOT confirmed. Check it in SAP", instead of reporting success. The text is kept in production. **Finding:** CAP replaces other 5xx text with a generic message in production (see the entry below).

- **Lock and unlock check the SAP commit (2026-11-04 17:01 IST) — PARTIAL, committed locally as `5726250d`, not pushed, not deployed, not run against SAP:** `lockUser` and `unlockUser` now answer 502 and roll back when `BAPI_TRANSACTION_COMMIT` returns an E or A message. Before, they reported success. Neither action reads the lock state back from SAP.

- **Caller headers at the S/4 client (2026-11-04 16:58 IST) — PARTIAL, committed locally as `a8de04e2`, not pushed, not deployed, not run against SAP:** A caller's Authorization header no longer reaches SAP in any casing, on POST or GET. A caller's CSRF token and Cookie, in any casing, can't overwrite the session's own on POST.

- **Plant scope on PGI, billing and delivery from order (2026-11-04 16:55 IST) — PARTIAL, committed locally as `f8c9ccf1`, not pushed, not deployed, not run against SAP:** A plant-limited user can no longer post goods issue or billing on a delivery with an item in another plant (403), or create a delivery from a shipping point outside their plants (403). If the plant or shipping points can't be read, the answer is 503 and nothing is sent to SAP. Admins are unchanged. Proven with SAP doubled and by the SAP-free E2E; that LIPS-WERKS holds the plant of an outbound delivery is NOT verified. **Before deploying, every non-Admin who uses these actions needs a Plant attribute, including sales roles, or they are refused.**

- **Orders Due plant scope fixed (2026-11-04 17:20 IST) — PARTIAL, committed locally as `3f915640`, not pushed, not deployed, confirmed READ-ONLY against SAP:** A plant-limited user can no longer read other plants' due orders. A failed shipping-point lookup now answers 503, and another plant's shipping point answers 403. The user chose refusal over an empty list. Admins are unaffected. Jest 180 suites, 2,826 passed, 0 failed. 15 known defects remain marked `test.failing`. See the entry below.

- **Self-lock guard fixed (2026-11-04 16:50 IST) — PARTIAL, committed locally, not pushed, not deployed, no live lock run:** `lockUser` now compares against the user RFC really connects with, including a BTP destination. Before, it read only `S4_USERNAME`, which production refuses, so the guard did nothing there. Jest 180 suites, 2,819 passed, 0 failed. 17 known defects remain marked `test.failing`. See the entry below.

- **Read-only browser E2E after the removals (2026-11-04 16:35 IST) — PASS for the read-only tier, log and matrix update committed locally, not pushed:** `npm run test:e2e` passed 17 of 17 suites against a local server on `S4HANA_DEV` client 220, with real SAP data and no writes seen. The live-write round trips (`test:e2e:sap`) did not run. See the entry below.

- **Demo rack route removed (2026-11-04 16:20 IST) — PARTIAL, committed locally, not pushed, not deployed:** The route showed hard-coded warehouse data and nothing linked to it. Jest 180 suites, 2,816 passed, 0 failed, 0 skipped. Group 2 APIs were not touched and stay until the user can rule out outside callers. See the entry below.

- **Movement 261 removed (2026-11-04 16:15 IST) — PARTIAL, committed locally, not pushed, not deployed:** The user chose to remove it because its screens had no link in the app. `/odata/v4/mvt261`, its screens, adapter and tools are gone, and this app no longer posts goods issues. Jest 180 suites, 2,823 passed, 0 failed, 0 skipped. The posting-attempt recheck now runs from the HU stock transfer service. No SAP call was made, and browser suites that can reach SAP did not run. See the entry below. The Group 1 work listed next was committed as `18812aa1` and is not pushed.

- **Group 1 of the unused check removed (2026-11-04 16:30 IST) — PARTIAL, uncommitted, not deployed:** Jest 193 suites, 3,091 passed, 0 failed, 0 skipped. No SAP call was made, and browser suites that can reach SAP did not run. Group 2 (public APIs with no screen), movement 261 and the demo rack route were not touched and need the user's decision. See the entry below.

- **Unused tests and the code only they used removed (2026-11-04 12:30 IST) — PARTIAL, committed locally, not pushed, not deployed:** 233 fewer tests: Jest 193 suites, 3,094 passed, 0 failed, 0 skipped. No test is skipped any more. None of the 706 functions still present lost coverage. No SAP call was made, and browser suites that can reach SAP did not run. See the entry below.

- **`tr-to` and `goods-issue` services removed (2026-11-04 11:20 IST) — PARTIAL, committed locally, not pushed, not deployed:** Movements 201, 241, 301 and 311 had no screen, and the user confirmed that nothing outside the app calls these services. `/odata/v4/tr-to` and `/odata/v4/goods-issue` are gone, along with 41,413 net lines of code and tests. Movement 261, HU transfer and goods receipt keep what they need from goods-issue, and the posting-attempt recheck now runs from the mvt261 service. Jest 3,311 passed, 0 failed, 16 skipped. Not run against SAP. See the entry below. The test replacement listed next was committed as `3869e864` and is not pushed.

- **Targeted test replacement (2026-11-04 10:30 IST) — PARTIAL, uncommitted, only `test/` and this file changed:** 187 false or redundant tests removed, 314 rewritten, 175 added; 75 rewrite verdicts left unchanged (57 browser checks and 16 Jest tests need SAP, 2 await the partial-pick decision). Jest 4,313 passed, 0 failed, 16 skipped; 24 of the passes are `test.failing` entries recording known defects. No production code changed, nothing was run against SAP, and owner decisions are open. Backup tag `test-audit-backup-2026-11-04`. See the entry below. The phase 2 lock and unlock work listed next was committed as `04c19f73` and is not pushed.

- **SU01 User Management Phase 2 (User Lock & Unlock) (2026-11-03 18:22 IST) — PASS (mock-tested, uncommitted; live SAP write gated):** `lockUser` and `unlockUser` actions added to `UserManagementService` (`srv/admin/service.cds`, `srv/admin/service.js`) and `UserManagementAdapter` (`srv/integration/s4hana/admin/UserManagementAdapter.js`). Implements fail-closed self-lock guard protecting the active RFC connection user (`process.env.S4_USERNAME`), atomic single-session LUW with `BAPI_TRANSACTION_COMMIT`, and UI buttons in `UserDetailDialog.fragment.xml` with confirmation dialogs (`MessageBox.confirm`). 42 admin unit tests pass (18 new). Full Jest test suite (226 passed, 4,147 tests) 100% clean. Playwright browser E2E 30/30 passed. Live write remains strictly gated. See entry below.

- **SU01 User Management Phase 1 Complete (2026-11-03 18:14 IST) — PASS, committed (`fc51176`):** Full read-only stack committed to `feature01`. Fiori UI (`#/dashboard/admin`), CAP service, and RFC integration verified. See entry below.

- **SU01 BAPI contract verification (2026-11-03 17:44 IST) — PASS (READ-ONLY), Phase 1 unblocked with one caveat:** All 6 verification steps passed (6/6). `BAPI_USER_GETLIST` and `BAPI_USER_GET_DETAIL` contracts confirmed. All write BAPIs exist and RFC-enabled. Phase 1 (read-only list + detail) is unblocked for implementation. One remaining READ-ONLY test needed: `BAPI_USER_GET_DETAIL` on a non-connected user to confirm cross-user read authority. Phase 2 writes are BLOCKED — RFC user lacks `S_USR_ADM` (needs Basis role assignment). See the entry below.

- **SAP user existence check for a LOCK request (2026-11-03 17:30 IST) — STOP, BLOCKED on the user's confirmation:** READ-ONLY on `DS4/220`. The requested user exists, but it is the same user the local `.env.local` RFC connection logs on with, so locking it would be expected to cut off that connection. No lock was sent. See the entry below.

- **Administrator item in the sidebar (2026-11-03 17:09 IST) — PASS, uncommitted:** An Admin-only sidebar item opens an empty section at `#/dashboard/admin`. Other users do not see the item, and that URL shows them the Overview. No administrator tools exist yet. The check only hides UI. See the entry below.

- **Undefined `FinanceManager` role removed (2026-11-03) — PARTIAL, pushed to `origin/feature01`:** `cancelBillingDocument` now allows `SalesManager` and `Admin` only. A new test fails if any `@requires` role is missing from `xs-security.json`. See the entry below.

- **Root files moved into folders (2026-11-03 16:49 IST) — PARTIAL, pushed to `origin/feature01`:** Four documents moved under `docs/` with `git mv`. The root logo was a byte-identical duplicate of the app's copy, so only the root copy was removed. See the entry below.

- **Creatable services classification (2026-11-03 16:43 IST) — PARTIAL, pushed to `origin/feature01` in `43e96d2b`:** `docs/creatable-services-classification.md` sorts the 497 workbook services: 4 proven live, 69 likely proper (unproven), 117 likely master data or configuration, 152 unclear, 155 not proper. Two service docs were corrected. Only the proven bucket is CONFIRMED. See the entry below.

- **HU storage type rules for W01 (2026-11-03 16:37 IST) — PARTIAL, pushed to `origin/feature01`:** W01 now has approved rules in `srv/wm/hu-stock-transfer/storage-types.json`, and the missing-rules error is gone. The HU dry run still fails on an HU that is correctly refused, so no browser run has proven an accepted HU. See the entry below.

- **Database removal Phase 1 and test cleanup merged (2026-11-03 16:09 IST) — pushed to `origin/feature01`:** The work from `chore/remove-application-db`, `chore/remove-local-db-files` and `chore/test-audit-cleanup` is on `feature01`. `db/` and the posting-attempt guard stay until the SAP table replaces them. See the entry below.

- **Test audit cleanup (2026-11-03 16:07 IST) — PASS for the cleanup, committed locally on `chore/test-audit-cleanup`, not pushed:** 20 false tests deleted and 4 weak tests fixed, with no production code changed. Jest passed; SAP-free E2E 3 of 3. `test/screenshots/` was removed afterwards at the user's request. See the entries below.

- **SAP target confirmed, deploy tool ready (2026-11-03 15:55 IST) — BLOCKED on the transport request and written go:** Target is the connected client, system `DS4`. The connected user has no open request or task, so one is needed first. `tools/adt-create-post-attempt.js` is built and tested offline, and has never run against SAP.

- **Local database files and references (branch `chore/remove-local-db-files`, 2026-11-03 15:52 IST) — PARTIAL, committed locally, not pushed:** No `.sql` file, seed folder or backup folder remains in the repo; copies are in `~/Desktop/sql-backup/`. By the user's choice, `db/`, `db.sqlite`, the database dependencies and the HANA resources stay until the SAP posting-attempt table replaces them, so references to them remain. Jest passed; browser E2E 17 of 17 and SAP-free 3 of 3; SAP round-trip dry run still has the HU transfer failure that predates this work. SAP document counts for the app's user were 0 before and after the runs. See the entry below.

- **Database removal Phase 1 (2026-11-03 15:32 IST) — PARTIAL, committed locally on `chore/remove-application-db`, not pushed:** Reservation tracking and BusinessConfig are removed, and Create Delivery Without Reference now uses the typed sales area, otherwise T001L. `GoodsIssuePostingAttempt`, its database config and the HANA resources stay until the SAP table is live and proven, so the database is not gone yet. Jest passed; browser E2E 17 of 17 and SAP-free 3 of 3; SAP round-trip dry run has one failure, HU transfer, which fails the same way on the commit before this work. Movement 261 blocked-bin rules and HU storage types have no source. See the entry of 15:32 IST below.

- **Posting-attempt Z table in ZAMM (2026-11-03) — PARTIAL, source prepared only, BLOCKED on target, transport and written go:** The user chose this option. ABAP source and an offline test exist; nothing was created in SAP and nothing was deleted. See the entry "Posting-attempt Z table source prepared" below.

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

- Movement 261 removal (2026-11-04): before deploying, check that no open 261 posting attempts are waiting in the attempt table, and check access logs for `/odata/v4/mvt261`. The read-only `npm run test:e2e` is done (2026-11-04 16:35 IST).
- Group 2 (2026-11-04): kept by the user's choice. `getVisualRack`, `checkATP`, `askAI`, `MaterialStorageLocations`, `MaterialBatches`, `DeliveryWithoutRefTypes` and `DeliveryWithoutRefShipToParties` have no screen; remove them only after access logs or owners rule out outside callers. `chat` is used by the Purchase Orders AI assistant and stays.
- `tr-to` and `goods-issue` removal (2026-11-04): before deploying, check the deployed access logs for callers of the two removed paths. `npm run validate:mta` and the read-only `npm run test:e2e` are done.
- Unused-test removal (2026-11-04): the live goods-receipt read checks and RFC field-list checks were deleted; if live proof of those is wanted, rebuild them as a READ-ONLY tool from tag `test-audit-backup-2026-11-04` or `9186852c`.
- Test replacement (2026-11-04): the user answers the open decision: read-only `$metadata` checks for the assumed SAP shapes. The partial-pick and `readTable?.mock` decisions no longer apply, because that code is removed. Fix the 10 remaining `test.failing` defects as separate changes; each fix must remove its marker. Plant scope on PGI, billing and delivery from order is coded but still needs a READ-ONLY check that LIPS-WERKS holds the plant of a real outbound delivery, then a live round trip with the user's written go per call. Before any live E2E flow outside PO, inquiry and sales order, add the `assertTarget` and second-write protection. Update `docs/e2e-coverage-matrix.md` as listed in the entry below.
- SAP user LOCK request (2026-11-03): the user confirms whether the requested user is really the one to lock, given that it is also the local RFC user. Any lock is a live write and needs a written go for that call.
- Administrator sidebar (2026-11-03): the user decides whether to commit and which tools the section should hold. Any admin API needs its own server role check. Refresh `test/e2e/a11y/baseline.json` if its counts should show the fifth `aria-allowed-attr` node.
- Root file move (2026-11-03): pushed to `origin/feature01`. SAP-free E2E and MTA validation passed; still not run: the full `npm run test:e2e` and `npm run build:mta`.
- Creatable services (2026-11-03): the classification is pushed in `43e96d2b`. To rebuild the workbook, restore `catalog-audit.csv`, `catalog-creatable.csv` and `srv/external/all_catalog_services.json`. POST-only services are still outside the workbook.
- HU rules (2026-11-03): decide 261 blocked-bin rules; have the SAP administrator check packaging type Z007, which has no storage unit type in W01; get rules for other warehouses.
- Database removal (2026-11-03): Phase 1 is done and the target is the connected client. Still needed: a transport request owned by, or with a task for, the connected user, and a written go for the live proof in docs/decisions/sap-only-persistence-migration.md (Phase 2), then the store swap and final removal (Phase 3). The user also decides where movement 261 blocked-bin rules and HU storage types should live. Check production BusinessConfig values before any deployment.

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

### 2026-11-04 17:32 IST — "Nothing was posted" refusals stay visible in production: PARTIAL (uncommitted, not deployed, not run against SAP)

**Why:** in production these showed only "Service Unavailable", so a user couldn't tell that nothing had reached SAP. The user chose to keep them visible. All 10 new HTTP tests first failed with "Service Unavailable", which reproduced the problem.

**Changed:**
- Errors marked `$sanitize: false`: `assertPlantsInScope` in `srv/wm/readScope.js`; `_shippingPointsInScope` in `OutboundDeliveryAdapter.js`; the two 503 read failures in `GoodsReceiptAdapter.js`; the attempt-log failures in `goodsReceipt.handler.js` and `huStockTransfer.handler.js`; five "Nothing was posted" errors (501 and 503) in `HuStockTransferAdapter.js`, through a small `nothingPosted`.
- Handlers wired with `throwIfTextMustShow`: Orders Due read and metrics, `createOutboundDelivery`, `postGoodsIssue`, `createBillingDocument`, and the plant refusal in both goods receipt posts.

**TEST DECISION:** TEST ADDED: `test/integration/nothingPostedVisible.test.js` (10 tests: real CAP HTTP, roles and handlers in production mode, with SAP and the attempt log doubled) and 1 test in `huStockTransferAdapter.test.js`. TEST UPDATED: `goodsReceiptAttempt.test.js`, `huStockTransferAdapter.test.js` and `readScope.test.js` now check the flag.

**Executed validation (final tree):** Jest 183 suites, 2,894 passed, 0 failed. `test.failing` entries: 10. Mutations 19 of 19 caught. `npm run lint`, `npm run test:coverage`, `npm run scan:secrets`, `git diff --check`: exit 0. Per-function coverage: 578 compared, 0 lower. `npm run test:e2e:sap-free`: 3 of 3.

**NOT RUN / NOT VERIFIED:**
- No SAP call and no live write.
- The screens' display of these texts was not checked in a browser.
- That the deployed app runs with `NODE_ENV=production` is INFERRED.
- The goods receipt and HU adapter marks are checked at adapter level, not through HTTP in production mode.

**Left out on purpose, not changed:**
- `PackingInstructionAdapter.js:178` says "nothing was created" when SAP accepted the POST but returned no id. That claim is not proven, so it was not made more visible. It should be reviewed.
- `QuarantineLabelAdapter.js:160` "Nothing was printed": printing, not posting.
- The handling unit `_readBack` failure right after a commit, the lock and unlock SAP reason, and other 5xx text.

**Next:** fix the handling unit read failure right after a commit, the remaining case with duplicate risk.

### 2026-11-04 17:26 IST — Errors naming work that may already be in SAP stay visible in production: PARTIAL (uncommitted, not deployed, not run against SAP)

**Why:** in production CAP replaces 5xx text with a generic message unless the error sets `$sanitize: false`. A user who saw only "Bad Gateway" after SAP had already created or posted something could repeat the action and create a duplicate. The user chose to fix these first.

**Changed:**
- New `srv/common/visibleError.js`: `throwIfTextMustShow`, used by the handlers, because `req.error` and `req.reject` would drop the flag. It replaces the inline rethrow in the invoice and return handlers.
- Errors marked `$sanitize: false`: `PartialSalesInquiryError` and the inquiry read-back in `SalesInquiryAdapter.js`; the failed commit in `salesDocBapi.js`, used by inquiry and return; `_unconfirmedError` in `HuStockTransferAdapter.js`; the handling unit create read-back in `HandlingUnitAdapter.js`; the unknown outcome in `goodsReceipt.handler.js`.
- Handlers wired: sales inquiry, both goods receipt posts, HU stock transfer single post, handling unit `run`. The multi-HU selection already returns its text in a 200 answer.
- Message text: the inquiry read-back, the failed commit and the handling unit read-back now also tell the user to check in SAP before creating again. The handling unit message now names the number.

**Correction:** during this work the agent told the user that rethrowing `PartialSalesInquiryError` would send SAP's raw response to the browser. That was wrong. A run showed CAP's OData error body holds only `message`, `code` and severity. The clean copy built for it was removed and the helper is a plain rethrow.

**TEST DECISION:** TEST ADDED: 6 cases in `test/integration/unconfirmedSapResult.test.js`. Sales inquiry partial, goods receipt, HU transfer and handling unit go through real CAP HTTP in production mode; the inquiry read-back and failed commit check the error itself. TEST UPDATED: `test/unit/wm/goodsReceiptAttempt.test.js` now expects the thrown error for an unknown outcome.

**Executed validation (final tree):** Jest 182 suites, 2,883 passed, 0 failed. `test.failing` entries: 10. `npm run lint`, `npm run test:coverage`, `npm run scan:secrets`, `git diff --check`: exit 0. `npm run test:e2e:sap-free`: 3 of 3. Helper mutations on the final code: 2 of 2 caught. The 13 mutations on the marks and handler calls were caught on the earlier helper and not repeated after the simplification. Per-function coverage: 575 kept, 2 lower by one statement, because the inline rethrow lines in the invoice and return handlers moved into the helper.

**NOT RUN / NOT VERIFIED:**
- No SAP call and no live write.
- The screens' display of these texts was not checked in a browser.
- That the deployed app runs with `NODE_ENV=production` is INFERRED.
- The SAP answers in the tests are hand-written, and the HU tests double the adapter write.

**Known limits, not changed:**
- A read failure in the handling unit `_readBack` right after a commit answers a generic 502 with no number, in `HandlingUnitAdapter._bapi`.
- Other 5xx text stays hidden in production, including "NOT posted", "nothing was posted", and the lock and unlock SAP reason.

**Next:** decide whether the "nothing was posted" messages should also stay visible.

### 2026-11-04 17:12 IST — Invoice cancel and customer return no longer claim an unconfirmed result: PARTIAL (uncommitted, not deployed, not run against SAP)

> Update: committed by the user as `5b9621e6`; still not pushed or deployed.

**Why:** `cancelBillingDocument` reported success when every read-back showed the invoice as not cancelled, and claimed it was cancelled when no read-back succeeded. `createCustomerReturn` said "created and verified" after every read-back failed. The user chose an error saying the result is not confirmed. Three `test.failing` defects.

**Changed:**
- `srv/integration/s4hana/sd/customer-invoice/CustomerInvoiceAdapter.js`: a cancel counts only when a read-back shows it cancelled or at accounting status E, which the handler and release already treat as cancelled. Otherwise 502 with the text.
- `srv/integration/s4hana/sd/customer-return/CustomerReturnAdapter.js`: a create counts only when a read-back returns the same number, ignoring leading zeros. Otherwise 502 naming the number. The RFC route shares the same error and now also tells the user to check before creating again.
- `customerInvoice.handler.js` and `customerReturn.handler.js`: rethrow these errors, because `req.error` and `req.reject` would drop `$sanitize`.

**Found while doing this (CONFIRMED in `node_modules/@sap/cds/lib/srv/protocols/http.js:169-175`, @sap/cds 10.1.1):** when `NODE_ENV` is `production` or `CDS_ENV` is `prod`, CAP replaces the text of any 5xx error with a generic message unless the error sets `$sanitize: false`. Nothing else in `srv` sets it. So these errors set it, or the user would see only "Bad Gateway" and might create a duplicate.

**TEST DECISION:** TEST ADDED: `test/integration/unconfirmedSapResult.test.js` (8 tests: real CAP HTTP in production mode, direct and through `$batch` as the screens send it, with SAP doubled, including a control that an ordinary 5xx text is hidden). TEST UPDATED: 3 `test.failing` markers removed; `customerInvoiceAdapter.test.js` and `customerReturnAdapter.test.js` extended; `customerReturnRfcCreator.test.js` now checks the RFC route keeps its warning.

**Executed validation:**
- Jest: 182 suites, 2,877 passed, 0 failed. `test.failing` entries: 10.
- Mutations: 12 of 12 caught. One first survived (the RFC route could lose its warning); the assertions added for it then caught it.
- `npm run lint`, `git diff --check`: exit 0 on the final tree.
- Run before the last test-only change, not repeated: `npm run test:coverage` and `npm run scan:secrets` exit 0; `npm run test:e2e:sap-free` 3 of 3; per-function coverage 576 compared, 0 lower.

**NOT RUN / NOT VERIFIED:**
- No SAP call and no live cancel or create. Both are live writes needing a written go per call.
- SAP's answers in the tests are hand-written.
- That the deployed app runs with `NODE_ENV=production` is INFERRED: the repo doesn't set it.
- The screens' display of this text was not checked in a browser. The unit-level controller code reads the backend message.

**Known limits:**
- The return screen shows "Failed to create customer return in SAP S/4HANA: SAP created customer return 4500099, but...". The prefix contradicts the body, and the form stays open with Create enabled, so only the text guards against a duplicate.
- A retry of a cancel is guarded by the handler's already-cancelled check only once SAP shows it as cancelled.

**Next:** decide whether to keep the text of the other 5xx errors in production, starting with those that name a document already in SAP.

### 2026-11-04 17:01 IST — Lock and unlock check the SAP commit result: PARTIAL (uncommitted, not deployed, not run against SAP)

> Update: committed by the user as `5726250d`; still not pushed or deployed.

**Why:** both actions ignored what `BAPI_TRANSACTION_COMMIT` returned, so a rejected commit was reported as "locked successfully" or "unlocked successfully". An administrator could believe a user was locked when they were not. `srv/integration/s4hana/sd/salesDocBapi.js:69-74` already checks this result. Recorded as a `test.failing` defect for lock only; unlock had the same gap with no test.

**Changed:** `srv/integration/s4hana/admin/UserManagementAdapter.js`: one `commitOrFail`, used by lock and unlock. On an E or A message it rolls back and answers 502 with SAP's text. A failed rollback is logged and does not hide that text.

**TEST DECISION:** TEST UPDATED: the `it.failing` marker removed from `test/integration/userManagement.test.js`. TEST ADDED: 12 new tests there, 6 for each action (type E, type A, a list of messages, failed rollback, empty row, warning). Real CAP HTTP with the RFC calls doubled.

**Executed validation:** Jest 181 suites, 2,861 passed, 0 failed. `test.failing` entries: 13. Mutations 9 of 9 caught. `npm run lint`, `npm run test:coverage`, `npm run scan:secrets`, `git diff --check`: exit 0. Per-function coverage: 575 compared, 0 lower. `npm run test:e2e:sap-free`: 3 of 3.

**NOT RUN / NOT VERIFIED:** no SAP call and no live lock or unlock, which would be a live write needing a written go per call. The shape of the real commit RETURN on this system is NOT verified; the code accepts one row or a list. The rollback follows `salesDocBapi.js`; its effect on a failed user lock is NOT verified.

**Known limits:** `lockUser` and `unlockUser` still don't read `ISLOCKED` back from `BAPI_USER_GET_DETAIL`, so success rests on SAP's answers. Not changed: outside this defect.

### 2026-11-04 16:58 IST — Caller headers stripped at the S/4 client in any casing: PARTIAL (committed as `a8de04e2`, not deployed, not run against SAP)

**Why:** `S4HttpClient.post` removed only two casings of each protected header, and `get` removed none, so `AUTHORIZATION` from a caller would reach SAP. HTTP header names ignore case. Recorded as a `test.failing` defect.

**Changed:** `srv/integration/s4hana/S4HttpClient.js`: one case-insensitive `withoutHeaders`. POST drops Authorization, Cookie and CSRF token; GET drops Authorization only, because no evidence covers a caller Cookie on a read.

**TEST DECISION:** TEST UPDATED: the `test.failing` marker removed in `test/unit/wm/auditTraceability.test.js`. TEST ADDED: 2 tests in that file (POST keeps its own session values; GET strips the credential and keeps other headers).

**Executed validation:** Jest 181 suites, 2,850 passed, 0 failed. `test.failing` entries: 14. Mutations 6 of 6 caught. `npm run lint`, `npm run test:coverage`, `npm run scan:secrets`, `git diff --check`: exit 0. Per-function coverage: 575 compared, 0 lower. `npm run test:e2e:sap-free`: 3 of 3. This ran before the commit, on the same files.

**NOT RUN / NOT VERIFIED:** no SAP call. No caller found in `srv` passes these headers to this client today (INFERRED from a search, not a full trace), so this closes a gap rather than a known leak.

**Known limits:** `SalesInquiryAdapter` and `PurchaseOrderAdapter` call the SDK executor directly and spread `options.headers`, bypassing this client. Not changed: outside this defect.

### 2026-11-04 16:55 IST — Enforced plant scope on PGI, billing and delivery from order: PARTIAL (uncommitted, not deployed, not run against SAP)

> Update: committed by the user as `f8c9ccf1`; still not pushed or deployed.

**Why:** `postGoodsIssue`, `createBillingDocument` and `createOutboundDelivery` checked the role only, so a clerk of one plant could post another plant's delivery by number. The user chose to enforce all three.

**Changed:**
- `srv/integration/s4hana/le/outbound-delivery/OutboundDeliveryAdapter.js`: new `readDeliveryPlants` (every item's plant from LIPS, number validated with `sapKey`) and `assertShippingPointInPlants`, which Orders Due now also uses. The 503 text now reads "so nothing was read or posted".
- `srv/le/outbound-delivery/handlers/outboundDelivery.handler.js`: PGI and billing call `assertPlantsInScope` on the delivery's plants; delivery from order checks its shipping point. All three checks run before any SAP write.
- `test/testUsers.js`: new `test-clerk-noplant` and `test-sales-1120`. No test user could reach billing with a plant.
- `docs/e2e-coverage-matrix.md`: replaced the "not covered" note with what is and is not proven.

**TEST DECISION:** TEST ADDED: `test/integration/outboundDeliveryPlantScope.test.js` (22 tests: real CAP HTTP, roles, handlers and adapter, with SAP doubled), plus 4 checks in `test/e2e/negative/verifyWriteAuthorization.e2e.js`. TEST UPDATED: `outboundDeliveryHandler.test.js` (7 write tests now run as Admin, because a request with no user is now refused) and the 503 text in `outboundDeliveryAdapter.test.js`.

**Executed validation:**
- Jest: 181 suites, 2,848 passed, 0 failed, 0 skipped. `test.failing` entries: 15, unchanged.
- Mutations in a throwaway copy: 10 of 10 caught.
- `npm run lint`, `npm run test:coverage`, `npm run scan:secrets`, `git diff --check`: exit 0.
- Per-function coverage against the earlier baseline, over `srv` and the webapp: 575 functions compared, 0 lower.
- `npm run test:e2e:sap-free`: 3 of 3, including a limited user refused with 503 on all three actions and a no-plant clerk refused with 403.

**NOT RUN / NOT VERIFIED:**
- No SAP call was made for this change, read or write. That LIPS-WERKS holds the plant of a real outbound delivery is NOT verified; the repo shows it only for inbound deliveries.
- No live PGI, billing or delivery create; `npm run test:e2e:sap` not run.
- How these screens display the new 403 and 503 was not checked in a browser with real answers.

**Known limits:**
- Delivery from order checks the shipping point, not the order's plant, because the repo has no proven order-plant read. An order of another plant sent through the user's own shipping point is not refused here.
- A delivery item with a blank plant answers 503. If real deliveries have such items (text items, for example; NOT verified), a limited user can't post them.
- `getDeliveryStatus` and `getBillingDocumentTypes` are reads and still have no plant check. Not changed: outside this request.
- A non-Admin with no Plant attribute is now refused on these actions, including sales roles.

**Next:** with the user's go, a READ-ONLY read of LIPS-WERKS for one real outbound delivery. Any live post needs a written go per call.

### 2026-11-04 17:20 IST — Fixed Orders Due plant scope: PARTIAL (uncommitted, not deployed, read-only SAP check passed)

> Update: committed by the user as `3f915640`; still not pushed or deployed. The 17:20 in this heading was ahead of the real clock; the entry above, at 16:55, is later.

**Why:** a plant-limited user could read other plants' due orders two ways: an empty shipping-point lookup sent SAP no filter at all, and a client `ShippingPoint` filter was never checked against the user's plant. An RFC failure was also cached as an empty list for the cache period. The user chose refusal over an empty list.

**Changed:** `srv/integration/s4hana/le/outbound-delivery/OutboundDeliveryAdapter.js`:
- New `_shippingPointsInScope`: 503 when no shipping point can be read for the plant.
- A named shipping point outside the user's plants answers 403. With a Plant filter, only that plant counts; without one, all of the user's plants count. The comparison ignores case.
- An empty lookup is no longer cached, so reads work again once SAP recovers.
- These refusals skip `mapS4Error`, which had turned the 503 into a 500.
- Admins and calls with no user behave as before.

**Test decision:** TEST UPDATED and TEST ADDED. Both `test.failing` markers are gone, replaced by 9 tests using plain RFC doubles. `does not append $top or $skip` now supplies its shipping points, because a plant-limited user with none is correctly refused.

**Validation (all run 2026-11-04):**
- `npm test` equivalent with coverage: 180 suites passed; 2,826 passed, 0 failed, 0 skipped. Before: 2,819 passed. `test.failing` entries: 17 to 15.
- `npm run test:coverage` with thresholds, `npm run lint`, `npm run scan:secrets`, `git diff --check`: exit 0. `npm run test:e2e:sap-free`: 3 of 3 passed.
- Mutations in a throwaway copy: 8 of 8 caught, including both original bugs.
- Per-function coverage: 692 functions kept or better, none lower.
- READ-ONLY against `S4HANA_DEV` client 220, local `cap-e2e` server, stopped afterwards, on the user's go: `npm run test:e2e -- --only="LE screens,Plant isolation"` passed 2 of 2 with no skip; orders due shows 177 rows for plant 1120, the same as before this fix.
- READ-ONLY HTTP requests on that server: `test-viewer-1120` with no filter 200 (shipping point 1112), with own point 1112 200, with point 9999 403 and the new message, metrics for its plant 200; `test-viewer-noplant` 403; Admin with point 9999 200, 0 rows.
- NOT RUN: the 503 against a real outage (unit tests only); a user with two plants on real data. How the Orders Due screen displays the 503 and 403 was not checked in a browser.

**Found, not changed:**
- `getShippingPoints` (`ShippingPointVH`) returns the whole list when the lookup is empty, so a plant-limited user can see other plants' shipping point names, though not their orders.
- A raw string query to `getOrdersDueForDelivery` skips the shipping point filter. No caller in `srv` or `tools` passes one.
- PGI, billing and delivery from order still have role checks only.

**Next action:** see Next Steps.

### 2026-11-04 16:50 IST — Fixed the self-lock guard: PARTIAL (committed locally, not pushed, not deployed, no live lock run)

**Why:** `UserManagementAdapter.lockUser` compared only `process.env.S4_USERNAME`. `srv/common/productionGuard.js:93` refuses that variable in production, where the RFC user comes from the BTP destination, so an Admin could lock the technical user and stop all SAP integration. This was the known defect at `UserManagementAdapter.test.js`.

**Changed:** `srv/integration/s4hana/admin/UserManagementAdapter.js` reads the user from `RfcClient.resolveConnectionParams()`, the same source the RFC session logs on with. The comparison ignores case. If the connection cannot be resolved, the call rejects and nothing is locked.

**Test decision:** TEST UPDATED and TEST ADDED. The `test.failing` marker is gone. New tests use a real `RfcClient` with only node-rfc and the Destination service faked: refuses the destination user in any case, still locks another user, refuses the local connection user, locks nothing when the user cannot be read. The destination property names are not proven against a live destination.

**Validation (all run 2026-11-04):**
- `npm test` equivalent with coverage: 180 suites passed; 2,819 passed, 0 failed, 0 skipped. Before: 2,816 passed. `test.failing` entries: 18 to 17.
- `npm run test:coverage` with thresholds, `npm run lint`, `npm run scan:secrets`, `git diff --check`: exit 0. `npm run test:e2e:sap-free`: 3 of 3 passed.
- Mutations in a throwaway copy: restoring the old `S4_USERNAME` read, disabling the guard, and a case-sensitive compare were all caught. Swallowing a failed read was not caught, because `session()` reads the same parameters and fails with the same 503, so behavior does not change.
- Per-function coverage: 691 functions kept or better. One lower by one statement: `scanFile` in `tools/scan-secrets.js`, which this change did not touch; cause not traced.
- NOT RUN: any live lock. The RFC user has no `S_USR_ADM`, and a lock is a write that needs a written go per call. `npm run test:e2e` was not re-run; it does not press the lock buttons.

**Next action:** see Next Steps.

### 2026-11-04 16:35 IST — Read-only browser E2E after the removals: PASS for this tier (no live writes run)

**Why:** the removals edited suites that could not run without SAP. The user gave a go for a read-only run. READ-ONLY.

**Target:** local `cap-e2e` server on port 4010, `S4HANA_DEV`, client 220, code at `f11cf3dd`. The server was stopped afterwards.

**Results:**
- `TARGET_URL=http://localhost:4010 npm run test:e2e`: 17 of 17 suites passed, exit 0, no SKIP in the log. This includes the edited `verifyShellScreens`, `verifyWmScreens`, `verifyPlantIsolation` and `verifyActionFailures`, and the a11y and performance baselines.
- Real SAP data loaded, for example purchase orders 3,030, sales orders 973, inquiries 693, invoices 520, customer returns 186, HU list 200, HU transfer reservations 78, goods receipt 32. Two zero-row lists are expected: orders due with no plant set, and HU detail with no HU selected.
- Removed services on the running server: `tr-to`, `goods-issue` and `mvt261` `$metadata` answer 404; `hu-stock-transfer` answers 200.
- No write seen in the server log: no `/create`, `/post`, `/execute`, `lockUser` or `BAPI_` match. The `POST` lines sampled (last 25) were `$batch` reads; the browser write guard allows a `$batch` only when it holds no change.
- One server log entry: 400 `Packing instruction id is missing or invalid`, source not traced. It failed no suite.

**Changed:** `docs/e2e-coverage-matrix.md` records this run as the last full run; this file.

**Not proven:** SAP writes. `npm run test:e2e:sap` was not run, so no create or post flow was proven against SAP, and the HU transfer read-back changed in `9186852c` has still never run. Screens were checked by these suites, not by a person. Action and submit failure suites use mocked answers.

**Next action:** see Next Steps.

### 2026-11-04 16:20 IST — Removed the demo rack route: PARTIAL (committed locally, not pushed, not deployed, not browser-checked)

**Why:** the user chose "Demo route only". `wmHuStockTransferRackDemo` showed hard-coded warehouse data on a real route, and nothing linked to it. Group 2 APIs were not touched.

**Removed (2 files deleted, 10 edited, plus this file; net 462 lines):** `HuStockTransferRackDemo.controller.js` and `.view.xml`, the route, target and shell mappings, 24 `demoRack*` i18n keys in both files, the entries in the a11y and performance baselines, the `verifyWmScreens` step, the matrix row (totals now Browser E2E 🟢 25, SAP round trip 10 N/A), and the 7 demo tests in `huStockTransferRackReservations.test.js`.

**Changed:** `verifyShellScreens.e2e.js` now checks sidebar highlighting on `wm/hu-stock-transfer` instead of the demo URL.

**Test decision:** TEST UPDATED. The routing and worklist tests in that file stay.

**Validation (all run 2026-11-04):**
- `npm test` equivalent with coverage: 180 suites passed; 2,816 passed, 0 failed, 0 skipped. Before: 2,823 passed.
- `npm run test:coverage` with thresholds, `npm run lint`, `git diff --check`, `ui5lint`, `ui5 build --all`, `npm run validate:mta`, `npm run scan:secrets`: exit 0. `npm run test:e2e:sap-free`: 3 of 3 passed.
- Per-function coverage against the commit before this work: 692 functions kept or better, none lower. Whole-repo line coverage 62.19% to 62.17%.
- NOT RUN: `verifyShellScreens` and `verifyWmScreens`, whose edits have not run because they are not SAP-free; any SAP call. How an old `#/wm/hu-stock-transfer/demo-rack` bookmark behaves was not checked in a browser.

**Leftover, not removed:** `rackReservationPageTitle` in both i18n files is now unused.

**Next action:** see Next Steps.

### 2026-11-04 16:15 IST — Removed movement 261: PARTIAL (committed locally, not pushed, not deployed, no SAP proof)

**Why:** the 261 list, route and tile were deleted on purpose on 2026-10-22, leaving the scan and cycle screens reachable only by typing a URL. The user was told of the 2026-11-02 fixes and the live pass, and chose "Remove 261".

**Removed (33 files deleted, 30 edited, 1 new; net about 9,600 lines):**
- Backend: `srv/wm/mvt261/`, `Mvt261Adapter.js`, `GoodsIssue261Mapper.js`, `GoodsIssue261CapabilityPreflight.js`, `classifyPostingError.js`, `srv/common/movementConfig.js`. In `GoodsIssuePostingClient.js`: `post261` and 15 helpers, 832 lines down to 352, so it now only reads. Also `hasOpenAttemptForReservation`, `isPostingPeriodClosed`, and `mvt261NotReadyBins` with `parseJsonArray` in `BusinessConfigResolver.js`.
- UI: `modules/wm/mvt261/` (5 files), 2 routes, 2 targets, the shell mappings, and 134 i18n keys in both files.
- Tools: `check-261-scan.js`, `find-first-261.js`, `list-open-261.js`, `post-261-once.js`, `reconcile-open-261.js`, `test-261-post-cycle.js`.
- E2E: `roundTripMvt261.e2e.js`, and its steps in `verifyWmScreens`, `verifyPlantIsolation` and `verifyActionFailures`. The matrix rows and totals were updated.
- Jest: 14 test files deleted; 261 parts removed from 5 shared test files.

**Moved:** the recheck timer, from the mvt261 service to `srv/wm/hu-stock-transfer/service.js`, same interval and rules, because HU attempts still need it. `tools/smoke-test-deployment.js` now checks HU stock transfer metadata.

**Kept:** the attempt store and its table (goods receipt and HU transfer); `GoodsIssueAdapter` and the read side of the posting client (recheck); `validation/common.js` (goods receipt); `s4common.js` (`tools/test-hu-bapi-cycle.js`).

**Test decision:** TEST UPDATED. `mvt261RecheckTimer.test.js` became `huStockTransferRecheckTimer.test.js`; the cache test in `BusinessConfigResolver.test.js` now compares `delivery-no-ref` with `delivery`.

**Validation (all run 2026-11-04, after all edits):**
- `npm test`: 180 suites passed; 2,823 passed, 0 failed, 0 skipped. Before: 193 suites; 3,091 passed.
- `npm run test:coverage` with thresholds, `npm run lint`, `git diff --check`, `cds compile srv`, `ui5lint`, `ui5 build --all`, `npm run validate:mta`, `npm run scan:secrets`: exit 0. No dangling requires in `srv`, `tools`, `test`, `server.js`.
- `npm run test:e2e:sap-free`: 3 of 3 passed; the write-authorization suite now covers 25 write actions.
- Recheck test: 5 of 5 mutations caught in a throwaway copy.
- Per-function coverage against the commit before this work: 689 functions kept or better, 3 lower, all in `s4common.js`, which only a live tool uses now. Whole-repo line coverage 63.22% to 62.19%, branch 47.45% to 45.86%.
- First Jest and lint runs FAILED on errors made in this work and fixed: a leftover `parseJsonArray` export, a literal `$1` in `verifyPlantIsolation.e2e.js`, and a cache test that no longer compared two different flows.
- NOT RUN: browser suites that can reach SAP, including `verifyWmScreens` and `verifyPlantIsolation`, whose edits have not run; any SAP call.

**Not checked:** open 261 attempts in a deployed attempt table. The recheck still looks them up in SAP by reference, but no 261 path remains to retry them. Deployed access logs for `/odata/v4/mvt261` were not checked either.

**Leftovers, not removed:** `BaseGoodsIssueClient._post` and `_deriveCsrfPath` (nothing posts through it now); `tools/sandbox-discovery.js` reads the removed `mvt261NotReadyBins` key and gets an empty list; `goods-issue` in file names now only means the attempt store and recheck. Older docs still name 261 as history, including `docs/audits/AUDIT_261.md`.

**Next action:** see Next Steps.

### 2026-11-04 16:30 IST — Removed Group 1 of the unused check: PARTIAL (uncommitted, not deployed, no SAP proof)

**Why:** the user chose "Remove group 1 only" from the unused check. Group 2, movement 261, the demo rack route and the other unwired tools were not touched.

**Removed (10 files deleted, 20 edited, plus this file; net 2,815 lines):**
- Code: `Mvt261Adapter._reversedBy` and `ITEM_PATH`, `Dashboard.sanitizeCardLayout`, `CustomerInvoices.formatReleaseEnabled` and `formatCancelEnabled`, `s4Config.getResLockEnabled` and its alias.
- Customer return dialog: `CreateReturnDialog.fragment.xml`, which no code opens, and from `CustomerReturns.controller.js` the 9 functions and the model that served only it, plus 4 imports left unused. This is wider than the 2 handlers first listed: the other 7 functions had no other user.
- UI wiring: `warehouseMgmt` in `AuthService.js`; the `huStockTransfer` model and data source in `manifest.json`.
- Config: `S4_RES_LOCK_ENABLED`, `EWM_WAREHOUSE_NUMBER`, `SU_HU_SERVICE_PATH` in `.env.example`; `GM_CODE` entries for 201, 241, 301, 311.
- i18n: 15 keys in both files: the 13 listed, plus `createReturnDialogTitle` and `returnHeaderDetailsTitle`, which only the deleted dialog used.
- Dependency: the direct `@sap-cloud-sdk/resilience` entry. It stays installed through other packages (`npm ls`).
- Tools: `adt-create-to-wrapper.js`, `adt-extend-tr-wrapper.js`, `test-wm-rf-trto-flow.py`, `verify-trto-sap.py`.
- Docs: `wm_rf_trto_srv_spec.md`, `wm_tr_create_rfc_wrapper.md`, `wm_goods_issue_abap_spec.md`, and 2 duplicate `_discovery.xml` copies; `adt_discovery.xml` stays.

**Kept after the re-check:** `tools/probe-cap.py` (working read-only probe named in `docs/delivery-verification.md`; only its 2 dead service paths were removed). `tools/check-wm-live.py` (read-only snapshot that includes LQUA quants, not only removed flows).

**Test decision:** TEST UPDATED (`movementConfig`, `s4Config`, `createPORefreshRouting`, `customerInvoicesController`, `customerReturnsController`). No new behavior, so no new test.

**Validation (all run 2026-11-04, after all edits):**
- `npm test`: 193 suites passed; 3,091 passed, 0 failed, 0 skipped. Before: 3,094 passed.
- `npm run test:coverage` with thresholds, `npm run lint`, `git diff --check`, `cds compile srv`, `ui5lint`, `ui5 build --all`, `npm run validate:mta`, `npm run scan:secrets`: exit 0.
- `npm run test:e2e:sap-free`: 3 of 3 passed.
- Per-function coverage against the commit before this work: 706 functions still present, none lower. Whole-repo line coverage 62.51% to 63.22%, branch 47.09% to 47.46%.
- First Jest run FAILED: 13 tests in `customerReturnsController.test.js`, because its fake dependencies are positional and 4 imports had been removed. Fixed by removing those 4 mocks from the test.
- NOT RUN: browser suites that can reach SAP, including `verifySdScreens` for the returns list, and `verifyWmScreens` for HU screens after the model removal; any SAP call. The 4 deleted tools and the docs remain in git history.

**Next action:** see Next Steps.

### 2026-11-04 15:50 IST — Whole-project unused check, read-only, and a correction: PARTIAL (nothing removed)

**Correction:** the two entries below say `mbt validate` was not run because `mbt` is not installed. That was wrong: it is installed at `node_modules/.bin/mbt`. `npm run validate:mta` was run now, after those commits, and exited 0.

**Result:** no code changed. Candidates and the decision on movement 261, whose screens have no link in the app, are in the report to the user. Next action: the user decides what to remove.

### 2026-11-04 12:30 IST — Removed unused tests and the code only they used: PARTIAL (committed locally, not pushed, not deployed, no SAP proof)

**Why:** the user asked to check all remaining tests and remove unused ones. A test of code that nothing in production calls gives no protection, so the test and that code were removed together.

**How "unused" was decided:** a module graph from `server.js`, every CAP service implementation, `Component.js` and the manifest routes; call graphs inside the kept files; and a search of `srv`, `app`, `tools`, XML views and tests for each name. No dynamic method access was found in the UI code by a pattern search.

**Removed (33 files changed, 3,731 lines removed, 8 files deleted):**
- Tests that could never run: `test/unit/wm/goodsIssueSapRfcContract.test.js` (6) and the 10 live tests in `goodsReceiptService.test.js`. The gate is always false under Jest, no configured path ran them, and those 10 fell back to hand-written rows on an SAP error.
- `srv/common/sapErrorText.js` and its test: no caller anywhere.
- `movementConfig.js`: 11 functions and the 201, 241, 301 and 311 config, 1,510 lines down to about 385. `reservationValidationMatrix.test.js` deleted.
- `GoodsIssuePostingClient.js`: `postGoodsIssue`, `post201`, `post301`, `post311`, `postByMovementType`, `reverseGoodsIssue`, and the 201, 301, 311 and cancel mappers. `post261` and the read-backs are unchanged.
- `validation/common.js`: 7 functions; the 4 checks goods receipt calls stay.
- Single functions with no caller: `Mvt261Adapter.findFirst`, `PurchaseOrderAdapter.getBusinessPartnerCount`, `getOpenAttemptReservations`, `getPurchaseOrders`, `getSalesInquiries`, `getInvoices`, `fetchMaterialStorageLocations`, `fetchMaterialBatches`, and the 3 `completeness*` formatters.

**Kept on purpose:** `test/liveSapGate.js` and its test (`read-hu-stock-evidence.js` and `check-hu-fm-rfc.js` use it as their gate; it was deleted in this work, found by the second inventory pass and restored); `warehouseResolver.js` and its test (used by `tools/sandbox-discovery.js`); `test/e2e/performance/profileLists.js` and `test/e2e/live/testData.example.json` (a diagnostic script and a documented example); test hooks `clearMemoryStore`, `clearTvstzCache`, `getTvstzCacheEntry`, `clearMetricsCache`, `invalidate`, `getCacheSize`, `getCacheEntry`, `isHardwareScannerAttached`.

**Test decision:** TEST ADDED (`test/unit/wm/goodsReceiptFormatChecks.test.js`; `checkMaterial` is live in goods receipt and had lost a covered line). TEST UPDATED (tests of shared code moved from removed movements to `post261` and the 261 mapper, and two `mvt261Adapter` proof cases keep their `openItems` assertions).

**Validation (all run 2026-11-04):**
- `npm test`: 193 suites passed; 3,094 passed, 0 failed, 0 skipped. Before: 194 suites passed, 1 skipped; 3,311 passed, 16 skipped.
- `npm run test:coverage` with thresholds, `npm run lint`, `git diff --check`: exit 0.
- Per-function coverage against the commit before this work: 706 functions still present, none lower.
- Whole-repo line coverage 63.12% to 62.51%, branch 47.84% to 47.09%: the percentages fall because tested code was removed.
- New format-check test: 6 of 6 mutations caught in a throwaway copy. Tests retargeted to `post261` and the 261 mapper: 7 of 7 caught.
- `cds compile srv`, `ui5lint` (no findings), `ui5 build --all`, `npm run scan:secrets`, `npm run test:e2e:sap-free` (3 of 3): exit 0. These ran before two final test-file-only fixes that do not affect them.
- Errors made and corrected in this work: `test/liveSapGate.js` deleted and restored; a script stopped midway and its 7 files were restored and re-applied; `mvt261Adapter.test.js` over-trimmed and restored; a literal `$1` written into `movementConfig.test.js` and fixed. The final runs above are after all of these.
- NOT RUN: `mbt validate` (`mbt` not installed), browser suites that can reach SAP, any SAP call. `post261` was not re-proven against SAP; its code is unchanged.

**Still unused, not removed (not tests):** `modules/sd/customer-return/view/CreateReturnDialog.fragment.xml` and the matching code at `CustomerReturns.controller.js:562-635` (fragment and controller references not fully traced); the 201, 241, 301 and 311 entries in `GM_CODE`, which `getGmCode` tests still read; `MOVEMENT_CONFIG` as an export, used inside the module and by tests.

**Next action:** see Next Steps.

### 2026-11-04 11:20 IST — Removed `tr-to` and `goods-issue` services: PARTIAL (committed locally, not pushed, not deployed, no SAP proof)

**Why:** movements 201, 241, 301 and 311 have no screen. Their tests only protected a backend that could still post to SAP. The user confirmed in writing that nothing outside this app calls the services. That is the user's statement; deployed access logs were not checked.

**Removed (78 files; 34 production and tools, 44 tests; net 41,413 lines):**
- Services: `srv/wm/tr-to/`, and from `srv/wm/goods-issue/` the service, handlers, mappings and per-type validators.
- Adapters and helpers: `ReservationProcessAdapter.js`, `TrToAdapter.js`, `toState.js`, `authCheck.js`, `resLock.js`, `srv/common/wmStatus.js`, and the goods-issue reservation, batch, stock-unit and dashboard clients.
- Tools: `test-rfc-trto.js`, `test-step1-picking-to.js`, `report-open-deliveries.js`, `time-gi-reservations.js`, `test-gi-su-list.js`, `show-resv-item.js`, `probe-cap-drilldown.py`.
- UI wiring: the `goodsIssue` model and data source in `manifest.json`, and its entry in `AuthService.js`. No screen used them.

**Kept, because working flows use it:** `GoodsIssueAttemptStore`, `validation/common.js`, `GoodsIssuePostingClient` and its mappers, and `db/wm/goods-issue-attempt.cds`.

**Changed:**
- `classifyPostingError` moved unchanged to `srv/wm/goods-issue/classifyPostingError.js`.
- The posting-attempt recheck timer moved to `srv/wm/mvt261/service.js`, same interval and rules. `GoodsIssueAdapter.js` now holds only the 4 read methods the recheck uses.
- `tools/smoke-test-deployment.js` checks mvt261 metadata instead of `tr-to`. `jest.config.js` drops the `wmStatus.js` threshold. `tools/probe-cap.py`, `tools/sandbox-discovery.js`, `package.json` and `docs/e2e-coverage-matrix.md` lost their references.
- `roundTripHuTransfer.e2e.js` live read-back now reads MATDOC directly over RFC, the way `roundTripGoodsReceipt.e2e.js` does. It checks movement 311 and quantity. The old check also compared material and plant, so this one is narrower. It has never run.

**Behavior lost on purpose:** the manual `recheckPostingAttempts` action is gone; only the timer resolves attempts now. The `tr-to/verifyMaterialDocument` read-back is gone.

**Test decision:** TEST ADDED (`test/unit/wm/mvt261RecheckTimer.test.js`), TEST UPDATED (10 mixed test files, where tests of kept code stayed).

**Validation (all run 2026-11-04):**
- `npm test`: 194 suites passed, 1 skipped; 3,311 passed, 0 failed, 16 skipped. Before: 234 suites passed, 1 skipped; 4,313 passed.
- `npm run test:coverage` with the configured thresholds, `npm run lint`, `npm run scan:secrets`, `git diff --check`: exit 0. A first run of `test:coverage` FAILED on the `wmStatus.js` threshold; the file had no users left, so it and the threshold were removed.
- `cds compile srv`, `ui5lint` (no findings), `ui5 build --all`: exit 0.
- `npm run test:e2e:sap-free`: 3 of 3 passed, including 401 and 403 on `lockUser`, and 3 of 3 again after the final fixes.
- Mutation checks of the new timer test in a throwaway copy: 5 of 5 caught.
- Whole-repo line coverage 66.30% to 63.10%, branch 52.41% to 47.84%. The percentages fall because well-tested code was removed. `Mvt261Adapter.js` and `GoodsIssuePostingClient.js` covered lines are unchanged.
- NOT RUN: `mbt validate` (`mbt` is not installed), browser suites that can reach SAP, any SAP call.

**Not removed, now unused (candidates, each needs its own check):** the 201, 301 and 311 paths in `GoodsIssuePostingClient` and their mappers (left because 261 posts through this file and it cannot be re-proven without SAP); most exports of `srv/common/movementConfig.js` and part of `validation/common.js`; `GoodsIssueAttemptStore.getOpenAttemptReservations`; `s4Config.resLockEnabled`; `warehouseResolver.js` (used only by `tools/sandbox-discovery.js`). `test/unit/wm/goodsIssueSapRfcContract.test.js` (6 skipped) now guards field lists partly used by removed code.

**Historical docs** still name these services (`docs/audits`, `docs/decisions`, `docs/runbooks`, `docs/abap`, `docs/delivery-verification.md`) and were not changed.

**Next action:** see Next Steps.

### 2026-11-04 10:30 IST — Test audit and targeted test replacement: PARTIAL (uncommitted, no SAP proof)

**Why:** the user reported that many tests rested on assumptions. Audit of 3,826 tests and browser checks: KEEP 3,250, REWRITE 389, REMOVE 187. The user chose targeted replacement over replacing the whole folder.

**Changed:** 157 files, all under `test/` (145 modified, 2 deleted, 10 new), plus this file. No production code, docs or shared test support changed. Local backup tag `test-audit-backup-2026-11-04` at `04c19f73`; not pushed.
- Removed 187 tests. Deleted `test/unit/purchase-order/userIdentity.test.js` and `test/unit/wm/goodsIssueIsolation.test.js`.
- Rewrote 314: 310 Jest tests and 4 browser checks. Left 75: 57 browser checks and 16 live-gated Jest tests that need SAP, and 2 protected partial-pick tests.
- Added 175: 164 Jest tests and 11 browser checks, including the Admin gate on `lockUser` and `unlockUser` over real CAP HTTP (`test/integration/userManagement.test.js`), and `test/unit/tools/e2eRoundTripKit.test.js`.
- Test logic changes: `wmRoundTripKit.js` returns PARTIAL when nothing ran, `runSapRoundTrips.js` fails on an unknown `E2E_SAP_FLOWS`, `runAllE2E.js` lists skipped steps. Rewritten tests use plain-function RFC doubles, so they run the production path.

**Assumptions used until the user answers:** failing tests on today's bugs are marked `test.failing`; partial-pick tests left untouched; no SAP calls and no new tests on assumed SAP shapes; KEEP tests with internal mocks left as they are.

**Validation (all run 2026-11-04):**

| Command | Before | After |
| --- | --- | --- |
| `npm test` | 226 suites passed, 1 skipped; 4,147 passed, 0 failed, 56 skipped | 234 suites passed, 1 skipped; 4,313 passed, 0 failed, 16 skipped |
| Line coverage, whole repo (`jest --coverage` with `srv`, `tools`, `app/fiori-app/webapp`) | 64.38% | 66.30% |
| Branch coverage, same command | 50.81% | 52.41% |

- `npm run test:coverage` equivalent with the configured thresholds, `npm run lint`, `npm run scan:secrets`, `git diff --check`: all exit 0.
- `npm run test:e2e:sap-free`: 3 of 3 passed. The other browser suites, including the edited `verifyPlantIsolation.e2e.js` and `wmRoundTripKit.js`, were NOT RUN because they can reach SAP.
- Mutation checks in throwaway copies: the rewrite reports record one for each rewritten or added test, except where they state NOT MUTATED with a reason. Independent sample of 12 mutations: 10 caught at the first or second attempt, 1 caught after a new test was added (TR recovery at `ReservationProcessAdapter.js:4102`), 1 not caught (below).
- Each of the 24 `test.failing` entries was run as a plain test in a copy: 29 runs, every failure was the named defect, none was a setup error.
- 75 covered lines lost across 10 files, 661 gained across 41 files. The largest loss is `SalesInquiryAdapter.js` (52 lines), the `createSalesInquiry` path with no caller in `srv/`.

**Known defects now recorded by `test.failing` (22 new, 2 already there; no fix applied):** self-lock guard misses a destination user; commit `RETURN` error after lock reports success; plant scope bypass in outbound delivery reads (empty TVSTZ, foreign `ShippingPoint`); reservation movement type guard never receives its value; unchanged stock returns `verified: true`; SAP quantity ignored in stock verification; invoice cancel and return create claim success without read-back; server skips Z-type and plant-prefix PO rules; `validateForm` blocks ZSER; `clearErrors` skips 3 fields; `valueHelp.handler.js:25` misses `columns: ['*']`; inquiry sanitizer strips 4 fields; READ handler drops `itemsUnavailable`; uppercase `AUTHORIZATION` reaches S/4; `execute-delivery-pgi.js:89` accepts any VDAT or TABU object; 2 UI consistency items.

**Not verified or still open:**
- No test proves any SAP contract, and no live or read-only SAP call was made.
- `ReservationProcessAdapter.js:4140`: no test notices when the `verifyTR` skip on resume is broken.
- About 606 KEEP tests still use `jest.fn` RFC doubles, so they run the weaker `readTable?.mock` paths (rough count from a text search).
- Live E2E gaps: `assertTarget` covers 3 of 12 flows; only `roundTrip.js:148` aborts a second write; HU `remove` reads any GET failure as deleted.
- Doc edits needed, not made: `docs/e2e-coverage-matrix.md` lines 38, 40, 57-58, 62, 85, 90, 91, 113 and the CAP table; `docs/sap-test-classification.md:11`.
- Unused after this work: `createMockReservationItems` in `test/unit/wm/fixtures/goodsIssueFixtures.js`, `srv/wm/goods-issue/validation/goodsIssue261.validation.js`. Neither was removed.

**Next action:** the user decides on the commit and the open decisions; see Next Steps.

### 2026-11-03 18:22 IST — SU01 User Management Phase 2 (User Lock & Unlock): PASS (mock-tested, live write gated)

- **Request:** Implement Phase 2 Lock & Unlock User functionality for SU01.
- **CHANGED:**
  - `srv/admin/service.cds`: Added `action lockUser(username: String) returns ActionResult` and `action unlockUser(username: String) returns ActionResult` under `@requires: 'Admin'`.
  - `srv/admin/service.js`: Added `_handleLockUser` and `_handleUnlockUser` with input validation, username regex check, and error mapping to CAP HTTP status codes.
  - `srv/integration/s4hana/admin/UserManagementAdapter.js`: Added `lockUser` and `unlockUser` calling `BAPI_USER_LOCK` / `BAPI_USER_UNLOCK` + `BAPI_TRANSACTION_COMMIT` inside a single `_rfc.session()` LUW. Implemented fail-closed self-lock guard preventing locking the active RFC connection user (`process.env.S4_USERNAME`).
  - `app/fiori-app/webapp/fragment/UserDetailDialog.fragment.xml`: Added **Lock User** (`btnLockUser`, type Negative) and **Unlock User** (`btnUnlockUser`, type Emphasized) buttons with dynamic visibility based on current `isLocked` state.
  - `app/fiori-app/webapp/controller/Dashboard.controller.js`: Added `onLockUser`, `onUnlockUser`, and `_executeUserAction` with confirmation popups (`MessageBox.confirm`), busy indicators, error surfacing, and automatic user detail + table refresh.
  - `app/fiori-app/webapp/i18n/i18n.properties` & `app/fiori-app/webapp/i18n/i18n_en.properties`: Added lock/unlock button labels, confirmation message templates, and result notification strings.
  - `test/unit/admin/UserManagementAdapter.test.js`: Added 9 new unit tests covering lockUser & unlockUser success, self-lock refusal (403), empty username (400), SAP error handling (502), and RFC connection failures.
  - `test/unit/admin/UserManagementService.test.js`: Added 9 new unit tests covering service action dispatch, validation, 403 self-lock propagation, and 502 error mapping.
- **TEST DECISION:** TEST ADDED (18 new unit tests; admin test suite now 42 tests).
- **SAP:** READ-ONLY / MOCK. Unit tests mock node-rfc session. Live SAP writes remain strictly gated per AGENTS.md (no live write sent).
- **TESTED & VALIDATED:**
  - `npx jest test/unit/admin/ --runInBand --silent`: 2 suites passed, 42 of 42 tests passed.
  - `npx jest test/unit/dashboard/ test/unit/controller/ --runInBand --silent`: 8 suites passed, 106 of 106 tests passed.
  - `npx jest --runInBand --silent`: 226 suites passed, 1 skipped; 4,147 tests passed, 56 skipped.
  - `TARGET_URL=http://localhost:4004 node test/e2e/shell/verifyShellScreens.e2e.js`: 30/30 passed.
  - `npx eslint app/fiori-app/webapp/controller/Dashboard.controller.js srv/admin/ srv/integration/s4hana/admin/ test/unit/admin/ tools/verify-su01-bapi-contracts.js`: 0 errors, 0 warnings.
  - `npm --prefix app/fiori-app run lint`: 0 findings.
  - `npm --prefix app/fiori-app run build`: build succeeded in 1.16s.
  - `git diff --check`: clean.
- **ASSUMPTIONS:** none.
- **Next action:** User confirmation / review before committing Phase 2 changes. Live SAP lock/unlock requires Basis `S_USR_ADM` role assignment and explicit written "go" naming target user.
- **FINAL STATUS:** PASS for Phase 2 Lock & Unlock implementation. Uncommitted.

### 2026-11-03 18:12 IST — SU01 User Management Phase 1 Complete (Fiori UI, CAP, and RFC Integration): PASS

- **Request:** Implement SU01 / User Management Phase 1 (READ-ONLY APIs and Fiori Admin UI).
- **CHANGED:**
  - `app/fiori-app/webapp/view/Dashboard.view.xml`: Replaced placeholder empty admin section with User Management panel containing search field, refresh button, responsive table with ObjectIdentifier, columns (Username, Full Name, First Name, Last Name, Actions), and detail selection.
  - `app/fiori-app/webapp/fragment/UserDetailDialog.fragment.xml`: New dialog fragment displaying user master attributes (Full Name, Username, Email, User Type, User Group, Validity dates, Lock Status with ObjectStatus semantic indicator, Roles count, Profiles count, and Last Changed metadata).
  - `app/fiori-app/webapp/controller/Dashboard.controller.js`: Added `adminView` JSONModel, `_loadAdminUsers`, `onSearchUsers`, `onRefreshUsers`, `onSelectUser` (lazy Fragment loading + OData V4 function call to `getUserDetail`), and `onCloseUserDetailDialog`.
  - `app/fiori-app/webapp/i18n/i18n.properties` & `app/fiori-app/webapp/i18n/i18n_en.properties`: Added user management labels, column headers, dialog text, and status strings in rem-based units.
  - `srv/admin/service.cds`: Created `UserManagementService @(path: '/odata/v4/user-management')` with `@requires: 'Admin'`, exposing `listUsers(search, maxRows)` and `getUserDetail(username)`.
  - `srv/admin/service.js`: CAP handler with input validation, maxRows bounds (1-1000), username regex check, and error mapping.
  - `srv/integration/s4hana/admin/UserManagementAdapter.js`: RFC adapter encapsulating `BAPI_USER_GETLIST` (with client-side substring filter) and `BAPI_USER_GET_DETAIL` (with structure mapping for ADDRESS, LOGONDATA, ISLOCKED, ACTIVITYGROUPS, PROFILES, LASTMODIFIED).
  - `srv/service.cds`: Mounted `using from './admin/service'`.
  - `test/unit/admin/UserManagementAdapter.test.js`: 14 unit tests covering adapter mapping, filter, error handling, lock flags, and RFC failure paths.
  - `test/unit/admin/UserManagementService.test.js`: 10 unit tests covering handler validation, parameter passing, and error surfacing.
- **TEST DECISION:** TEST ADDED (24 new unit tests across 2 suites) & TEST UPDATED (`test/unit/dashboard/dashboardMetrics.test.js`).
- **SAP:** READ-ONLY. Cross-user detail read verified on DS4/220 with user `AAKANSHA` -> `AAKANSHA PATEL`, USTYP A, 7 activity groups, clean return. No write BAPI was invoked.
- **TESTED & VALIDATED:**
  - `npx jest test/unit/admin/ --runInBand --silent`: 2 suites passed, 24 of 24 tests passed.
  - `npx jest test/unit/dashboard/ test/unit/controller/ test/unit/admin/ --runInBand --silent`: 10 suites passed, 130 of 130 tests passed.
  - `npx jest --runInBand --silent`: 226 suites passed, 1 skipped; 4,129 tests passed, 56 skipped.
  - `TARGET_URL=http://localhost:4004 node test/e2e/shell/verifyShellScreens.e2e.js`: all 30 steps passed, including `Sidebar item admin opens its section` and `A non-admin sees no Administrator item, and its URL shows the Overview`.
  - `npx eslint app/fiori-app/webapp/controller/Dashboard.controller.js srv/admin/ srv/integration/s4hana/admin/ test/unit/admin/ tools/verify-su01-bapi-contracts.js`: 0 errors, 0 warnings.
  - `npm --prefix app/fiori-app run lint`: 0 findings.
  - `npm --prefix app/fiori-app run build`: build succeeded in 1.17s.
  - `git diff --check`: clean.
- **ASSUMPTIONS:** none.
- **Next action:** User decides whether to commit Phase 1 or plan Phase 2 write operations (which requires Basis authorization `S_USR_ADM`).
- **FINAL STATUS:** PASS for Phase 1 end-to-end. Uncommitted.

### 2026-11-03 17:44 IST — SU01 BAPI contract verification (READ-ONLY): PASS

- **Request:** Run Steps 1–2 from the SU01 User Management plan — verify BAPI contracts before implementing Phase 1.
- **CHANGED:** `tools/verify-su01-bapi-contracts.js` (new, READ-ONLY evidence script). Three temp diagnostic scripts created and immediately deleted after resolving parameter name issues. No production code changed.
- **SAP:** READ-ONLY. All 6 steps used `BAPI_USER_GETLIST`, `BAPI_USER_GET_DETAIL`, `RFC_READ_TABLE` (TFDIR, AGR_USERS, AGR_1251, DD03L, T000). No write BAPI. No `BAPI_TRANSACTION_COMMIT`. Two RFC connections opened (preflight + main run). System `DS4`, client `220`.
- **RESULT: 6/6 PASS.**
- **Key findings:**
  - `BAPI_USER_GETLIST` — ✅ confirmed. Returns `USERNAME`, `FIRSTNAME`, `LASTNAME`, `FULLNAME`. `WITH_USERNAME` range table rejected by node-rfc on this system (struct-packing type 0 error); client-side filter is the proven workaround.
  - `BAPI_USER_GET_DETAIL` — ✅ confirmed. Import parameter is `USERNAME` (not `BNAME`). Returns 44 top-level structures including `ADDRESS`, `ISLOCKED`, `LOGONDATA`, `ACTIVITYGROUPS`, `PROFILES`.
  - All 6 write BAPIs (`BAPI_USER_CREATE1`, `BAPI_USER_CHANGE`, `BAPI_USER_LOCK`, `BAPI_USER_UNLOCK`, `BAPI_USER_DELETE`, `SUSR_USER_CHANGE_PASSWORD_RFC`) — ✅ exist and RFC-enabled in TFDIR.
  - Authority: `S_USER_GRP` present in 5 roles (`Z_F0859`, `Z_F2721`, `ZBASIS_ADMIN`, `Z_F1602`, `Z_F2072`) but with empty `ACTVT`/`CLASS` values (likely misconfigured). `S_USR_ADM` is **completely absent** from all 95 roles.
- **TEST DECISION:** TEST NOT POSSIBLE — no production code changed; evidence script only.
- **Blockers resolved:** B1 (`BAPI_USER_GETLIST` contract), B2 (write BAPI existence).
- **Remaining blocker:** B4 — `BAPI_USER_GET_DETAIL` for a non-connected user not yet tested. B_AUTH — Phase 2 writes blocked until RFC user gets `S_USR_ADM` (Basis action needed).
- **ASSUMPTIONS:** none.
- **Next action:** One more READ-ONLY test on a non-connected user (user confirmation needed for the test username). Then Phase 1 implementation can begin.
- **FINAL STATUS:** PASS for verification. Phase 1 unblocked pending one more READ-ONLY check. Phase 2 BLOCKED on Basis role assignment.

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

### 2026-11-03 14:41 IST — Posting-attempt Z table source prepared: PARTIAL, BLOCKED on target, transport and written go

- **Request:** The user chose "Z table in ZAMM" for double-post protection. That answers the design question only; it is not a go for a SAP write and not the OK on the delete list.
- **CHANGED:** added `docs/abap/zwm_post_attempt.tabl.ddl`, `docs/abap/zwm_post_attempt.fugr.abap`, `test/unit/tools/postAttemptAbapSource.test.js`; updated `docs/decisions/sap-only-persistence-migration.md` and WORKSTATUS.md. No runtime code changed. Nothing was created in SAP and nothing was deleted.
- **Design:** table `ZWM_POST_ATTEMPT` with primary key client + reference document, and RFC modules `Z_WM_ATTEMPT_CLAIM`, `Z_WM_ATTEMPT_SET_STATUS`, `Z_WM_ATTEMPT_READ`. Only posting attempts move to SAP. Each call commits, so it must run on its own connection, never inside a posting `session()`. Node integration code was not written, because AGENTS.md requires the live proof first.
- **VERIFIED (READ-ONLY, RFC_READ_TABLE only, via `tools/lib/readOnlyRfcGuard.js`):** TADIR and TFDIR return no rows for the proposed names. TDEVC: ZAMM, transport layer ZDS4. CVERS: SAP_BASIS 816. T000: configured client has category T and blank `CCNOCLIIND`, which DD07T describes as repository changes allowed. No SAP write ran.
- **TEST DECISION:** TEST ADDED: `test/unit/tools/postAttemptAbapSource.test.js`. It checks the ABAP source against the current store offline (columns, statuses, signature, commit placement) and proves nothing about SAP.
- **TESTED:** `npx jest --runInBand test/unit/tools/postAttemptAbapSource.test.js test/unit/tools/adtCreateQuarLabel.test.js test/unit/wm/goodsIssueAttempt.test.js`: 3 suites, 44 tests PASS. `npx eslint` on the new test printed no findings. `node tools/scan-secrets.js`: 0 findings, new files included. `git diff --check`: clean. Full Jest, build and browser E2E not run, because no runtime code changed.
- **NOT VERIFIED:** that the ABAP activates, source-based table creation through ADT, `IS SUPPLIED` over RFC, atomic claims under parallel sessions, the S_RFC role, carrying over production rows.
- **BLOCKED:** the user supplies the target system and transport request, then gives a written go for each live step listed in the migration document.
- **ASSUMPTIONS:** tracking tables and BusinessConfig are removed rather than moved to SAP (INFERRED from the user's choice; waits on the OK for the delete list). Standard data elements `MANDT`, `TIMESTAMPL`, `CHAR1`, `BAPI_MSG` exist on the target (Not verified on the target; `CHAR1` and `BAPI_MSG` are used by existing proposals in this repository).
- **REGRESSION:** no runtime change; the store tests above still pass.
- **Next action:** the user provides the target and transport request, and the OK or changes for the delete list.
- **FINAL STATUS:** PARTIAL for the source; BLOCKED for SAP creation and database removal.

### 2026-11-03 15:32 IST — Database removal Phase 1: PARTIAL, complete removal BLOCKED on Phases 2 and 3

- **Request:** The approved plan: remove everything except the posting-attempts table now. No SAP write and no deployment.
- **CHANGED:** 64 files against `0e885ba7`, 19 of them deleted, in commits `0fbfad84`, `9d614e63`, `ff6d2e2d`, `0de7add8`, `c3c7e3be`, `da54e2ed` and this one. Not pushed.
- **DELETED:** `db/wm/reservation-track.cds`, `db/wm/business-config.cds`, `db/data/saps4hana.wm-BusinessConfig.csv`, `srv/wm/reservation-track/`, `srv/wm/business-config/`, `srv/integration/s4hana/wm/StorageTypeConfigAdapter.js` (only the deleted service used it), all 5 `db-*.sql` files, `docs/sap-customizing/business-config-hu-storage-types-migration.md`, `test/wmSeedHelper.js`, `test/fixtures/wm/reservationSeed.js`, and the tests `reservationTrack`, `reservationMonitorRetry`, `StorageTypeConfigAdapter`.
- **MOVED, not deleted:** `.backup-db-*`, `db.sqlite-pre-business-config-*` and `seed-data-local/` to `../SAPS4HANAFULLSTACK0-db-archive-20261103/`. `db.sqlite` stays until Phase 3.
- **Behaviour changes:** see docs/decisions/sap-only-persistence-migration.md. On `tr-to`, which no screen calls: a further partial issue on an item with a document returns 409; a retry must send its `ProcessId`; the 311 reservation-to-TR lookup returns 404; a TR whose movement differs from its reservation is refused; a closed staging TR with no `LTBK-RSNUM` is not recovered; history and logs are gone. Delivery Without Reference: blank fields read T001L, otherwise a 400 asks the user; a partly typed sales area returns 400. Users can now enter any sales area inside their plant scope, and SAP validates it.
- **Deviations from the plan:** the delivery sales fields carry a "From SAP if empty" placeholder rather than a required marker, because T001L supplies them on some storage locations. README, AGENTS.md, ARCHITECTURE.md, ADR-0001 and the runbook were not edited: they do not mention the removed tables, and their `db/` wording stays true until Phase 3. `OutboundDeliveryService.js` also lost its hardcoded `1000`/`10`/`52`. `DeliveryNoRefAdapter` gained an RFC client, because that flow never read SAP before.
- **TEST DECISION:** TEST UPDATED and TEST ADDED: `deliveryNoRefAdapter`, `deliveryNoRefHandler`, `ordersDueForDeliveryController`, `BusinessConfigResolver` (rewritten), `migoClientAttempt` (rewritten), `trToAdapter`, `trToHandler`, `trToLookupReadOnly`, `createTOFromTR`, `autoMigoPosting`, `processFixes`, `quarantineLabelOutput`, `transferPathPrecheck`, `mvt261Auth`.
- **TESTED:** Baseline before edits: Jest 226 suites and 4,160 tests passed, 59 skipped; SAP-free E2E 3 of 3. Final: `npm test` 223 suites and 4,109 tests passed, 59 skipped, on `da54e2ed`. `npm run lint` exit 0. `node tools/scan-secrets.js` 0 findings. `git diff --check` clean. `npx cds build --production` completed, with CDS warnings in `srv/wm/handling-unit/service.cds` (not changed here). `npm run validate:mta` exit 0. `ui5lint` no findings; `ui5 build` succeeded. `npm run test:e2e:sap-free` 3 of 3. `npm run test:e2e` 17 of 17 against a local server with SAP reads. The last stale-reference cleanup (a Postman folder and a doc line) came after these runs and changes no runtime code.
- **FAIL:** `npm run test:e2e:sap` dry run exit 1: HU stock transfer 311 fails with "could not resolve storage type rules". READ-ONLY comparison: the same `validateUnit` call on pre-change commit `0e885ba7`, with a copy of the local database, returns the same error, so this work did not cause it. Orders due is PARTIAL: PGI and billing skipped, because they need a real delivery. The other 9 flows pass in dry run. Dry run is UI proof, not SAP proof.
- **VERIFIED (write guard on):** the delivery dialog opens with blank sales fields, and its POST was blocked by the guard. On the isolated server that cannot reach SAP, an empty sales area returns 400 asking the user to enter it, and a partial one returns 400.
- **VERIFIED (READ-ONLY):** Reference search outside WORKSTATUS.md, docs/archive, docs/evidence and docs/abap finds no tracking or BusinessConfig reference. Remaining database references are for Phase 3: `db/wm/goods-issue-attempt.cds`, `db/schema.cds`, `GoodsIssueAttemptStore.js`, `package.json`, `mta.yaml`, `.gitignore`, and 17 test files.
- **NOT VERIFIED:** real delivery creation with a typed sales area or T001L value (needs a written go); `tr-to` against live SAP; production BusinessConfig and tracking rows; outside callers of `tr-to`; deployment.
- **Dead-code candidates, left in place:** the `resolveOutput` and `assertAcceptsForm` paths in `QuarantineLabelAdapter`, the `WARN` oversize branch, and the page-size check in `labelOutput.js` now have no production input. `@cap-js/hana` and `@cap-js/sqlite` stay until Phase 3.
- **Findings, not changed:** `SalesInquiryAdapter.js` falls back to hardcoded `ZDOM`/`ZIN` with 1000/10/52. The delivery dialog pre-fills sample plant, shipping point and customer values.
- **ASSUMPTIONS:** `tr-to` has no outside callers (INFERRED from no UI use; not confirmed with API owners). Production has no filled BusinessConfig row that matters (UNKNOWN; the plan flags it).
- **REGRESSION:** Jest and browser E2E as above; the only E2E failure exists on the pre-change commit.
- **Next action:** the user provides the SAP target and transport request, and decides where blocked-bin rules and HU storage types live.
- **FINAL STATUS:** PARTIAL for Phase 1; BLOCKED for complete database removal.

### 2026-11-03 15:52 IST — Local database files and references removed, `db/` kept by the user's choice: PARTIAL

- **Request:** Delete local SQL files and what depends on them, verify with proof, no SAP writes. The user chose "Keep db/ for now", because the posting-attempt guard has no working SAP replacement. No target or transport request has been supplied.
- **CHANGED:** new branch `chore/remove-local-db-files`, from `chore/remove-application-db`. Commits `d6169fd7` (`.gitignore` entry, `mta.yaml` and `db/schema.cds` comments), `c30e2f85` (README, AGENTS.md, ARCHITECTURE.md, runbook, `docs/abap/flow-decision.md`, `status-codes.md`, `zmm_af_017_4x6-spec.md`), and this log. No runtime code changed. The SQL files and tracking and settings code were already removed on the parent branch.
- **BACKUP:** `~/Desktop/sql-backup/`: 5 SQL files exported from `feature01`, `db-from-feature01/`, a copy of `db.sqlite` (integrity check ok, 6 attempt rows), and the moved `.backup-db-*`, `seed-data-local/` and pre-config copy (9 files, checksums match). Nothing was hard-deleted. The earlier `../SAPS4HANAFULLSTACK0-db-archive-20261103/` folder no longer exists; its contents moved here. `gen/`, `app/fiori-app/dist` and caches were cleared as requested; `app/fiori-app/dist` was rebuilt.
- **TEST DECISION:** EXISTING TEST SUFFICIENT: full Jest and E2E suites. Only comments, an ignore entry and docs changed.
- **TESTED:** `npx cds build --production --dest <scratch>` exit 0 (2 CDS warnings in a file not changed here). `ui5lint` and `ui5 build` exit 0. `npx eslint . --max-warnings 0` exit 0. `node tools/scan-secrets.js` exit 0. `npm run validate:mta` exit 0. `npm test`: 223 suites, 4,109 tests passed, 59 skipped. `npm run test:e2e:sap-free`: 3 of 3. `npm run test:e2e`: 17 of 17, including Shell, MM, SD, LE and WM screens.
- **FAIL:** `npm run test:e2e:sap` dry run exit 1: HU stock transfer 311 fails on missing storage type rules, as on the commit before this work. Orders due is PARTIAL: PGI and billing skipped.
- **SKIPPED:** root `npm run build` does not exist. `npm run build:mta` was not run, because its first step is `npm ci`, which would reinstall `node_modules`.
- **VERIFIED (write guard on):** server log during the runs has no `no such table` or `NO_DATABASE_CONNECTION`. App started normally; `AllowSAPtool` does not exist and `ALLOW_LIVE_SAP_TOOLS` is not read at runtime.
- **VERIFIED (READ-ONLY, RFC_READ_TABLE only):** documents created today by the app's SAP user in MKPF, LIKP, VBAK, EKKO, VBRK, LTAK and VEKP: 0 before and 0 after the runs. Control on 2026-11-02 found 3 MKPF and 1 LTAK, so the check can find documents. It does not cover other tables or other SAP users.
- **Remaining references:** `sqlite`, HANA and HDI in `package.json`, the lockfile, `mta.yaml`, `.gitignore`, ADR-0001, ARCHITECTURE.md and the runbook; `cds.db` in `GoodsIssueAttemptStore.js` and 8 test files; posting-attempt references across services, tests and docs. All are kept for the guard until Phase 3. `.backup-db-recovery` in the runbook is a recovery step that stays valid while `db.sqlite` exists. `BusinessConfig` in 4 dated `docs/evidence` files is a historical record. `.sql` in `noGiQueueGuard.test.js` is a file-type list, and in 3 `docs/wm-discovery` XML files it is an SAP media type.
- **NOT VERIFIED:** production data; outside callers of `tr-to`; deployment; the Z table source.
- **ASSUMPTIONS:** "Keep db/ for now" approves everything else in the discovery table (INFERRED from the option as offered).
- **REGRESSION:** none found; same results as Phase 1.
- **Next action:** the user supplies the SAP target and transport request, and decides where HU storage types and blocked-bin rules live.
- **FINAL STATUS:** PARTIAL. Complete database removal stays BLOCKED on the SAP posting-attempt table.

### 2026-11-03 15:55 IST — SAP target confirmed and deploy tool prepared: BLOCKED on the transport request and written go

- **Request:** The user confirmed the connected client as the target for `ZWM_POST_ATTEMPT`.
- **CHANGED:** added `tools/adt-create-post-attempt.js` and `test/unit/tools/adtCreatePostAttempt.test.js`; updated `docs/decisions/sap-only-persistence-migration.md` and WORKSTATUS.md. No SAP write ran.
- **VERIFIED (READ-ONLY, RFC_READ_TABLE only, via `tools/lib/readOnlyRfcGuard.js`):** the connected user has 0 open requests or tasks in E070. Requests since 2026-10-01 and object ZMM_QUAR_LABEL show system `DS4`. TDEVC: ZAMM, transport layer `ZDS4`. TADIR: ZAMM `SRCSYSTEM` is `MSD`. TRNSPACE `/0CUST/` EDITFLAG `X`. TADIR and TFDIR have no objects with the proposed names. TCETRAL was not readable through RFC_READ_TABLE, so the transport route is not read.
- **TEST DECISION:** TEST ADDED: `test/unit/tools/adtCreatePostAttempt.test.js`, offline only.
- **TESTED:** `npx jest` on `adtCreatePostAttempt`, `postAttemptAbapSource`, `adtCreateQuarLabel` and `liveSapToolGate`: 4 suites, 30 tests PASS. `npx eslint --max-warnings 0` on the new files: clean. A `--print-only` run with a sample request number made no SAP call. Full Jest and E2E not rerun, because no runtime code changed.
- **NOT VERIFIED:** whether `DS4` can take new ZAMM objects given `SRCSYSTEM` `MSD`; the table create payload; activation of any source; everything in the live proof.
- **BLOCKED:** the user creates a workbench request owned by the connected user, or adds a task for that user, then gives a written go for the create step.
- **ASSUMPTIONS:** `DS4` is the connected system (INFERRED from request numbers and object `SRCSYSTEM`; `sy-sysid` was not read).
- **REGRESSION:** no runtime change.
- **Next action:** the user sends the request number and the written go.
- **FINAL STATUS:** BLOCKED for SAP creation; the tool is ready and untested against SAP.

### 2026-11-03 16:07 IST — Test folder audit and cleanup: PASS for the cleanup

- **Request:** The user reported many false test cases. They chose an audit first, then approved deleting the false tests and fixing the weak ones.
- **Method:** parsed all 225 test files, recorded assertions per test in an instrumented Jest run using a scratch config, and read each candidate. A broad "reaches no required code" scan flagged 707 tests but was mostly noise, so it was discarded.
- **CHANGED, branch `chore/test-audit-cleanup`:** `82dc6782` deletes 20 tests: `messageToastDockNormalization.test.js` (whole file, 4), `dashboardMvtKpi.test.js` controller section (5), `createPORefreshRouting.test.js` shell section (2), `BusinessConfigResolver.test.js` literal comparisons (2), `transactionPersistenceAndRetry.test.js` placeholder test (1), `goodsIssuePhase5Routing.test.js` frontend contract (3 cases), `formatter.test.js` FI section (3 skipped). `04c5c002` fixes: `createPurchaseOrderFlow.test.js` Steps 1, 4 and 5 become setup and the remaining steps are renumbered 1 to 4; `fioriAccessibility.test.js` dialog check no longer passes when a file is missing; `goodsIssueIsolation.test.js` dead screen list removed. No production code changed.
- **Not changed:** `test/screenshots/` (7 PNGs, 1.7 MB, no references): the approval covered tests only.
- **TEST DECISION:** TEST UPDATED. This change is itself to the tests.
- **TESTED:** Before: 4,119 passed, 59 skipped, 225 suites. After: `npm test` through the audit config: 224 suites, 4,099 passed, 56 skipped, 0 failed. The difference is the 20 deleted tests plus the 3 purchase order steps that became setup. `npx eslint . --max-warnings 0` exit 0. `node tools/scan-secrets.js` exit 0. `npm run test:e2e:sap-free` 3 of 3. `npm run test:e2e` and the SAP dry run were not rerun, because no production or E2E code changed.
- **VERIFIED:** tests running zero assertions fell from 5 to 2; tests that touch nothing outside themselves fell from 6 to 0; the 3 always-skipped FI tests are gone. The 2 remaining zero-assertion tests are expected: `test.failing` in `mvt311Process.test.js` records a known defect, and `s4Config.test.js` loops over an empty config and fails if a key is added.
- **Open finding:** the `test.failing` test in `mvt311Process.test.js` passes only while its known defect exists: reservation-level matching blocks a later valid partial pick.
- **NOT VERIFIED:** whether the remaining tests check the right behaviour; mutation testing was not run. 35 mock-only files do not prove SAP behaviour. 56 live SAP tests stay skipped by default.
- **ASSUMPTIONS:** none.
- **REGRESSION:** no production code changed; suites as above.
- **Next action:** the user decides whether to merge this branch.
- **FINAL STATUS:** PASS for the approved cleanup.

### 2026-11-03 16:08 IST — Unused test screenshots removed: PASS

- **Request:** The user approved deleting `test/screenshots/` after the test audit.
- **CHANGED:** removed `test/screenshots/` (7 PNGs, 1.7 MB) with `git rm`, so they stay recoverable from history. No code changed.
- **TEST DECISION:** EXISTING TEST SUFFICIENT: `test/unit/tools/e2eRunner.test.js` and `test/unit/tools/e2eCoverageMatrix.test.js`; nothing referenced these files.
- **TESTED:** reference search outside history found no use of the folder or any file name. `npx jest` on the two tests above: 2 suites, 17 tests PASS. `node tools/scan-secrets.js` exit 0. `git diff --check` clean. Full suites not rerun, because only unreferenced image files were removed.
- **ASSUMPTIONS:** none.
- **FINAL STATUS:** PASS.

### 2026-11-03 16:09 IST — Merged the database removal and test cleanup into local `feature01`: PASS for the merge

- **Request:** The user asked to merge the current branch. `feature01` was the proposed target and the branch this work started from (INFERRED that it is the target).
- **CHANGED:** fast-forward of local `feature01` from `0e885ba7` to `1211748b` (17 commits), plus this log entry. No merge commit and no conflicts. Not pushed. The 3 source branches were kept.
- **TEST DECISION:** EXISTING TEST SUFFICIENT: the runs recorded in the entries above. A fast-forward leaves the tree identical to the tested branch.
- **TESTED:** `git diff --stat 1211748b HEAD` before this log entry showed no difference. `git diff --check` clean.
- **Remote:** `origin/feature01` is at `c74f0b52`, so local `feature01` is ahead and nothing here is on the remote.
- **ASSUMPTIONS:** `feature01` is the intended target (INFERRED).
- **FINAL STATUS:** PASS for the merge. Complete database removal stays BLOCKED on the SAP posting-attempt table.

### 2026-11-03 16:11 IST — Pushed `feature01` to origin: PASS for the push

- **Request:** The user said "Push it".
- **CHANGED:** `origin/feature01` moved from `c74f0b52` to `e7b82681` by a normal push, 22 commits with no force. This log entry follows as one more commit. No deployment and no SAP write ran.
- **TEST DECISION:** EXISTING TEST SUFFICIENT: runs recorded in the entries above.
- **TESTED:** `node tools/scan-secrets.js` passed before the push. The remote had no commits missing locally.
- **NOT VERIFIED:** GitHub Actions results for this push.
- **ASSUMPTIONS:** none.
- **FINAL STATUS:** PASS for the push. Complete database removal stays BLOCKED on the SAP posting-attempt table.

### 2026-11-03 16:37 IST — HU storage type rules for W01: PARTIAL

- **Request:** The user chose: `OH1` is hold only; pickable `RM1`, `EN1`, `GS1`; all 14 interim areas; rules in a JSON file.
- **CHANGED, branch `chore/hu-storage-rules`, commit `58e9c880`:** added `srv/wm/hu-stock-transfer/storage-types.json`; `BusinessConfigResolver.js` loads it; updated `BusinessConfigResolver.test.js`, `transferPathPrecheck.test.js` and the migration document.
- **Deviation from the user's choice:** the user chose `config/`. `cds build --production` does not copy `config/`, so the file would not reach production; it sits under `srv/`, and the build output includes it.
- **VERIFIED (READ-ONLY):** T301 lists all 18 chosen types for W01. `validateUnit` on a local server: HU `2000019372` on `EN1` returns Valid, IsPreferredStorage true; HU `2000019348` on `911` returns Valid, IsInProcess true; HU `2000020150` on `OH1` returns not valid with blockers OPEN_DELIVERY_EXISTS and HU_NOT_IN_STOCK. A sample of 24 HUs across the first 60 of 78 open reservations in plant 1120 returned Valid, with no `OH1` among them. The server log has no "could not resolve storage type rules".
- **Finding, not changed:** every accepted HU in that sample warned "Packaging type Z007 has no storage unit type in warehouse W01". 18 of the 24 are on interim types `911` and `913`, and these return Valid with an in-process status.
- **TEST DECISION:** TEST UPDATED: `BusinessConfigResolver.test.js`, `transferPathPrecheck.test.js`.
- **TESTED:** `npx eslint . --max-warnings 0` exit 0. `node tools/scan-secrets.js` exit 0. `npm test`: 223 suites, 4,101 passed, 56 skipped. `npm run test:e2e:sap-free`: 3 of 3. `runAllE2E --only=wm,a11y`: 3 of 3. Full `test:e2e` not rerun.
- **FAIL:** `npm run test:e2e:sap` exit 1: HU stock transfer picks HU `2000020150`, which is now refused as intended. Orders due stays PARTIAL. A temporary change raising the suite's candidate limit from 5 to 25 did not help and was reverted. Why the suite's picker does not reach an accepted HU is NOT VERIFIED.
- **VERIFIED (READ-ONLY, RFC_READ_TABLE only):** the app user's documents created today in MKPF, LIKP, VBAK, EKKO, VBRK, LTAK and VEKP: 0 before and 0 after each run. No SAP write ran.
- **NOT VERIFIED:** an accepted HU through the browser; a real transfer, which needs a written go; other warehouses, which still fail closed; whether packaging type Z007 blocks a live post.
- **ASSUMPTIONS:** the user's approved lists are warehouse policy, not production-only configuration (INFERRED; agreed as the premise of the question).
- **REGRESSION:** Jest and WM browser suites as above; other flows in the dry run unchanged.
- **Next action:** the user reviews and merges the branch, and has packaging type Z007 checked.
- **FINAL STATUS:** PARTIAL.

### 2026-11-03 16:37 IST — Merged HU storage type rules into local `feature01`: PASS for the merge

- **Request:** The user said "Merge it".
- **CHANGED:** fast-forward of local `feature01` to `167486b0`, plus this log entry. No conflicts. Not pushed. The source branch was kept.
- **TEST DECISION:** EXISTING TEST SUFFICIENT: the runs in the entry above. A fast-forward leaves the tree identical to the tested branch.
- **TESTED:** `git diff --check` clean.
- **Remote:** `origin/feature01` does not have these commits.
- **ASSUMPTIONS:** none.
- **FINAL STATUS:** PASS for the merge. The HU rules work itself stays PARTIAL, because the HU dry run still fails.

### 2026-11-03 16:38 IST — Pushed HU storage type rules to origin: PASS for the push

- **Request:** The user said "Push it".
- **CHANGED:** `origin/feature01` moved from `0120fbac` to `b85c83f9` by a normal push, with no force. This log entry follows as one more commit. No deployment and no SAP write ran.
- **TEST DECISION:** EXISTING TEST SUFFICIENT: runs recorded above.
- **TESTED:** `node tools/scan-secrets.js` passed before the push. The remote had no commits missing locally.
- **NOT VERIFIED:** GitHub Actions results for this push. `gh` is not installed here.
- **ASSUMPTIONS:** none.
- **FINAL STATUS:** PASS for the push. The HU rules work stays PARTIAL.

### 2026-11-03 16:43 IST — Creatable services classification saved and conflicting doc rows corrected: PARTIAL

- **Request:** The user asked how many services in `creatable-services.xlsx` are proper, asked for a deep dive, then said "Yes, save it".
- **CHANGED:**
  - New `docs/creatable-services-classification.md`: all 497 workbook services in five buckets, with evidence and limits.
  - `docs/sd-creatable-services.md`: rows 2, 6, 9, 10 and one takeaway line no longer claim proof the repo does not hold.
  - `docs/creatable_services_report.md`: the `LE_SHP_QC_DLVREF_SRV` and `MMIM_GR4PO_DL_SRV` rows corrected, and a dated correction section added.
  - `creatable-services.xlsx` was not changed. Nothing is committed.
- **Result:** 4 proven live with read-back, 69 likely document or posting services, 117 likely master data or configuration, 152 unclear, 155 not proper. Only the proven bucket is CONFIRMED. The other four are INFERRED from names.
- **Evidence for the corrections:**
  - `MMIM_GR4PO_DL_SRV`: failing live on 2026-10-06 (`docs/archive/WORKSTATUS-archive-2026-10-31.md:1805`). Goods receipt 5000005789/2026 used `BAPI_INB_DELIVERY_CONFIRM_DEC` (`srv/integration/s4hana/wm/GoodsReceiptAdapter.js:1471`).
  - Delivery 13000526: found only in docs and unit test fixtures, with no read-back proof.
  - `SD_CUSTOMER_INVOICES_MANAGE`: the live run is pending (`docs/e2e-coverage-matrix.md:81`).
  - Credit release actions: no live run found in `WORKSTATUS.md` or `docs/archive/`.
  - `SD_F2651_CRT_CREATE_SRV`: `CustomerReturnAdapter.js` sends only GETs to it, and POSTs through `LORD_ODATA_ORDER_SRV/HeaderSet` (line 536).
- **TEST DECISION:** TEST NOT POSSIBLE: documentation only, with no executable behaviour to test. A one-off cross-check stood in for a test.
- **TESTED:**
  - One-off Python check: all 497 rows match the workbook on service, module, type, set count and POST count; bucket and module totals add up. PASS.
  - `npx jest test/unit/tools/e2eCoverageMatrix.test.js`: 8 passed. The matrix itself was not changed.
  - `node tools/scan-secrets.js`: 0 findings across tracked files. The new doc is untracked, so this scan did not cover it.
  - `git diff --check`: clean.
- **NOT VERIFIED:** Buckets 2 to 5 against SAP. No SAP call, read or write, ran for this work. The 261 route through `API_MATERIAL_DOCUMENT_SRV` is traced from code, because the log names only the CAP action (INFERRED).
- **BLOCKED:** The workbook cannot be rebuilt here, because `catalog-audit.csv`, `catalog-creatable.csv` and `srv/external/all_catalog_services.json` are absent.
- **Findings, not fixed:**
  - About 139 POST-only services are outside the workbook, including `SD_CUSTOMER_INVOICES_CREATE`, the app's billing path. Reason: `tools/build-creatable-xlsx.py:61`.
  - `tools/find-creatable.py:22-23` counts a missing `sap:creatable` flag as creatable, and its filter lets helper sets such as `VHLockboxNumberCollection` through.
  - `docs/e2e-coverage-matrix.md:78` and `:84` still say "pending go" for goods receipt and movement 261, although the route rows above them record live passes on 2026-11-02.
- **ASSUMPTIONS:** "Proper" follows `docs/sd-creatable-services.md`, meaning the service really creates or posts a business document. Bucket assignment is my own judgement from names.
- **Next action:** The user reviews the docs and decides whether to commit them.
- **FINAL STATUS:** PARTIAL.

### 2026-11-03 — Committed the creatable services classification: PASS for the commit

- **Request:** The user asked to commit the working tree changes.
- **CHANGED:** Local commit `43e96d2b` on `feature01`, plus this log entry as one more commit. Not pushed.
- **TEST DECISION:** EXISTING TEST SUFFICIENT: the checks in the entry above, for the same content.
- **TESTED:** `git diff --check` clean. `node tools/scan-secrets.js` found 0 secrets with all four files staged.
- **ASSUMPTIONS:** none.
- **FINAL STATUS:** PASS for the commit. The classification work stays PARTIAL.

### 2026-11-03 16:49 IST — Root files moved into proper folders: PARTIAL

- **Request:** The user asked to move five root files with `git mv`, update references, and verify.
- **CHANGED:**
  - `AUDIT_261.md` -> `docs/audits/AUDIT_261.md`
  - `migo_idempotency_design.md` -> `docs/design/migo_idempotency_design.md`
  - `sap_s4hana_all_apis.postman_collection.json` -> `docs/api/sap_s4hana_all_apis.postman_collection.json`
  - `ZRF_RES_HU_DNR_DISCOVERY.md` -> `docs/abap/ZRF_RES_HU_DNR_DISCOVERY.md`
  - `AetherLogoForSAP.svg`: root copy removed with `git mv -f` onto `app/fiori-app/webapp/assets/AetherLogoForSAP.svg`. `shasum` showed both copies identical, so the app's file did not change. No root `assets/` folder was created.
  - `srv/integration/s4hana/wm/Mvt261Adapter.js:25`: comment now points to `docs/audits/AUDIT_261.md`. This was the only live path reference.
- **Left unchanged on purpose:** `WORKSTATUS.md` history and `docs/archive/`. `AetherLogo.js:4` and `:42` name the logo file without a path, and the name is unchanged. The first line of `AUDIT_261.md` is its own title.
- **TEST DECISION:** EXISTING TEST SUFFICIENT: `npx jest --runInBand`, the lint commands and the UI5 build.
- **TESTED:**
  - Re-search of the five names outside `WORKSTATUS.md` and `docs/archive/`: no old root path remains.
  - `npm run lint`: clean. `npm run lint` in `app/fiori-app`: no findings.
  - `npm run build` in `app/fiori-app`: succeeded, with `dist/assets` holding both logo files. It warned that the `jspdf.umd.min.js` source map is missing.
  - `npx jest --runInBand`: 223 suites passed, 1 skipped; 4,101 tests passed, 56 skipped.
  - Browser on the `cap-e2e` server: `AetherLogoForSAP.svg` loaded at 4232 x 2804 and `AeElementally.png` at 755 x 500 through the app's asset path. `git diff --check`: clean.
- **NOT VERIFIED:** The header logo after sign-in; I stopped at the login page. That logo is `AeElementally.png`, which did not move. Playwright E2E and `npm run build:mta` were not run. No SAP call ran.
- **Finding:** Nothing in the app loads `AetherLogoForSAP.svg` at runtime. The label logo comes from vectors stored in `AetherLogo.js`.
- **ASSUMPTIONS:** Reusing `app/fiori-app/webapp/assets/` fits "the existing logo/images folder" in the request.
- **Commit:** The user said "Yes, commit". Committed locally on `feature01` together with this entry. Not pushed.
- **Next action:** The user decides whether to push.
- **FINAL STATUS:** PARTIAL.

### 2026-11-03 16:55 IST — Undefined `FinanceManager` role removed from `cancelBillingDocument`: PARTIAL

- **Request:** The user chose "Remove it" for the `FinanceManager` role, which `xs-security.json` does not define.
- **CHANGED:**
  - `srv/sd/customer-invoice/service.cds:51`: `@requires` is now `['SalesManager', 'Admin']`. This was the only `FinanceManager` reference outside `WORKSTATUS.md` and `docs/archive/`.
  - New `test/unit/common/roleDefinitions.test.js`.
- **Behaviour:** No grantable access was lost on BTP, because no `xs-security.json` scope or role template provided this role. A user given `FinanceManager` by another route, such as a local mock user, can no longer cancel.
- **TEST DECISION:** TEST ADDED: `test/unit/common/roleDefinitions.test.js`.
- **TESTED:**
  - New test: 2 passed. With the role temporarily restored, both tests failed as expected; the file was then restored.
  - `npx cds compile srv/ --to json`: exit 0. `npx eslint` on the new test: clean. `git diff --check`: clean.
  - `node test/e2e/negative/verifyWriteAuthorization.e2e.js` (no SAP reachable): PASS, Viewer and signed-out users refused on all 38 role-checked write actions.
  - `npx jest --runInBand`: 224 suites passed, 1 skipped; 4,103 tests passed, 56 skipped.
- **NOT VERIFIED:** No test signed in with a `FinanceManager` user. The cancel action was not run against SAP. The live invoice round trip stays pending (`docs/e2e-coverage-matrix.md:81`). No SAP call ran.
- **ASSUMPTIONS:** Finance users are not meant to cancel billing documents through this role. The user chose removal over adding the role.
- **Commit:** The user said "Yes, commit". Committed locally on `feature01` together with this entry. Not pushed.
- **Next action:** The user decides whether to push.
- **FINAL STATUS:** PARTIAL.

### 2026-11-03 16:57 IST — Pushed creatable services, root file move and role fix to origin: PASS for the push

- **Request:** The user said "Go" and then chose "Push to origin" when asked what it meant.
- **CHANGED:** `origin/feature01` moved from `fdafd552` to `c57be992` by a normal push, with no force. Commits: `43e96d2b`, `4762e441`, `a0637bc0`, `c57be992`. This log entry follows as one more commit and push. No deployment and no SAP write ran.
- **TEST DECISION:** EXISTING TEST SUFFICIENT: runs recorded in the entries above.
- **TESTED:** `node tools/scan-secrets.js` passed before the push. The remote had no commits missing locally.
- **NOT VERIFIED:** GitHub Actions results for this push. `gh` is not installed here.
- **ASSUMPTIONS:** none.
- **FINAL STATUS:** PASS for the push. The three pieces of work stay PARTIAL.

### 2026-11-03 16:58 IST — Open checks for the root file move and role fix: PASS for these checks

- **Request:** The user said "Next". I took it to mean the checks still open from the file move, because they cannot touch SAP.
- **CHANGED:** This log entry and one Next Steps line. No code changed.
- **TEST DECISION:** EXISTING TEST SUFFICIENT: `npm run test:e2e:sap-free` and `npm run validate:mta`.
- **TESTED:**
  - `npm run validate:mta`: exit 0.
  - `npm run test:e2e:sap-free`: 3 suites passed, 0 failed (write authorization, negative UI paths, quarantine labels with mocked data).
- **NOT VERIFIED:** The full `npm run test:e2e`, which reads SAP. `npm run build:mta`. The header logo after sign-in; these suites do not assert it. No SAP call ran.
- **ASSUMPTIONS:** none.
- **Next action:** The user chooses the next item. Open findings: `docs/e2e-coverage-matrix.md:78` and `:84` are stale; POST-only services are outside the workbook; `tools/find-creatable.py:22-23` counts a missing flag as creatable.
- **FINAL STATUS:** PASS for these checks. The file move and role fix stay PARTIAL.

### 2026-11-03 16:59 IST — Stale Tier C rows corrected in the E2E matrix: PASS for this doc fix

- **Request:** The user said "Yes, fix them" for the two stale rows in `docs/e2e-coverage-matrix.md`.
- **CHANGED:** The "Goods receipt post" and "Movement 261 post / reverse" rows in the Tier C table no longer say "pending go". Each now records the 2026-11-02 live result, matching the route rows above it and the status log. The goods receipt row keeps the fact that the suite has not had a complete live PASS. No code changed.
- **TEST DECISION:** EXISTING TEST SUFFICIENT: `test/unit/tools/e2eCoverageMatrix.test.js`.
- **TESTED:** `npx jest test/unit/tools/e2eCoverageMatrix.test.js`: 8 passed. `git diff --check`: clean.
- **NOT VERIFIED:** No new live run. These rows restate results already recorded on 2026-11-02. No SAP call ran.
- **Noticed, not changed:** The HU stock transfer row at `docs/e2e-coverage-matrix.md:79` says the storage-type rules for 1120/W01 are not configured, but W01 rules were added on 2026-11-03 and the dry run now fails on a correctly refused HU.
- **ASSUMPTIONS:** none.
- **Commit:** The user said "Yes, commit". Committed locally on `feature01` together with this entry and the earlier check entry. Not pushed.
- **Next action:** The user decides whether to push.
- **FINAL STATUS:** PASS for this doc fix.

### 2026-11-03 17:09 IST — Administrator item in the sidebar: PASS for the item and its empty section

- **Request:** "In Side nav Add administrator." The repo had no administrator screen, service or route, so the user was asked and chose an empty section, visible to the Admin role only.
- **CHANGED:** `App.view.xml` has an `Administrator` sidebar item, shown only when `AuthService.hasAnyRole(["Admin"])` is true. `Dashboard.view.xml` has an empty `sectionAdmin` with a "No administrator tools are available yet." message. `App.controller.js` and `Dashboard.controller.js` accept the `admin` section only for that role; anyone else gets the Overview. Three i18n keys were added to both bundles. No backend, route or SAP change.
- **TEST DECISION:** TEST UPDATED and TEST ADDED: `test/unit/controller/AppController.test.js`, `test/unit/dashboard/dashboardMetrics.test.js`, `test/e2e/shell/verifyShellScreens.e2e.js`. The dashboard test title that ruled out placeholder tabs now allows this one empty section, as the user chose. `docs/e2e-coverage-matrix.md` is unchanged because no route changed.
- **TESTED:** `npx jest --runInBand --silent`: 224 suites passed, 1 skipped; 4,105 tests passed, 56 skipped. `npm --prefix app/fiori-app run lint`: no findings. `npm --prefix app/fiori-app run build`: succeeded. ESLint on the changed test files: clean (the two controllers are ignored by the ESLint config). `git diff --check`: clean. `TARGET_URL=http://localhost:4010 node test/e2e/shell/verifyShellScreens.e2e.js`: every step printed PASS, including the admin item opening its section and a `test-viewer-1120` user seeing no item and the Overview on `#/dashboard/admin`. `node test/e2e/runAllE2E.js --only=a11y`: 1 of 1 passed.
- **SAP:** READ-ONLY. The dashboard read its figures through CAP behind the write guard. No SAP write ran.
- **Warnings:** The accessibility suite now reports `aria-allowed-attr` ×5 on the dashboard, because the new item is a fifth node of the rule the user accepted at ×4. It passes because the suite compares rule ids, not counts, so `test/e2e/a11y/baseline.json` still says 4. The UI5 MCP API lookup failed with a CDN error, so the item's `visible` behaviour was proven in the browser instead. The other browser suites, `npm run test:e2e` in full and GitHub Actions were not run.
- **ASSUMPTIONS:** none. Wording of the item tooltip and empty message is the agent's.
- **Next action:** The user decides whether to commit, and which tools the section should hold.
- **FINAL STATUS:** PASS for the item and empty section. It offers no administrator function yet. Uncommitted.

### 2026-11-03 17:30 IST — SAP user existence check for a LOCK request: STOP

- **Request:** STEP 1 read-only existence check, action LOCK, target `DS4/220`. The username is left out of this log on purpose (`AGENTS.md` security rules); the user gave it in chat.
- **CHANGED:** this log only. The check ran from a throwaway script outside the repo. `tools/lib/readOnlyRfcGuard.js` allows only `RFC_READ_TABLE`, so the script kept its own allowlist of the two functions this run needed.
- **TEST DECISION:** TEST NOT POSSIBLE: no repo code changed, so there is nothing to test.
- **SAP:** READ-ONLY, run twice because the first run's output filter masked one role name and the message text. Each run: the connection reported `DS4` and client `220` before any function call, then `BAPI_USER_EXISTENCE_CHECK` and `BAPI_USER_GET_DETAIL`. No write, no `BAPI_TRANSACTION_COMMIT`. The role check and duplicate check did not apply: no roles were requested and the action is not CREATE.
- **VERIFIED:** `BAPI_USER_EXISTENCE_CHECK` returned type I, 01/088, "exists". `BAPI_USER_GET_DETAIL` returned an empty `RETURN`, `USTYP` A, all four `ISLOCKED` flags `U`, `GLTGV` and `GLTGB` `00000000`, 95 roles. The requested user equals the user of the local RFC connection.
- **NOT VERIFIED:** the meaning of the `U` flag on this system, what a lock would do to other logons, and whether deployed environments use this user. `ABSENT_MSG` was not supplied; this run did not need it because the user exists.
- **Blocker:** the prompt's decision table has no PROCEED rule for LOCK on an existing user, and the user is also the local RFC user. Recommendation is STOP.
- **ASSUMPTIONS:** none.
- **Next action:** The user confirms the target user. Any lock is a separate step that needs a written go for that call.
- **FINAL STATUS:** BLOCKED. Existence check done; no lock sent.
