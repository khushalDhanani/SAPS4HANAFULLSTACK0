# REPORT_261.md — Movement type 261 remediation, final report per phase

Remediation of the findings in [AUDIT_261.md](AUDIT_261.md). Full detail per change is in
[WORKSTATUS.md](WORKSTATUS.md); this is the per-phase summary.

**Rule honoured throughout:** a finding is reported *fixed* only where a test demonstrates it. Items
without a behavioural test (a comment correction, a static UI label) are labelled as such, not as
tested fixes. No goods issue, reversal, transfer, or any write was ever posted to S/4HANA — every
write path is exercised against mocks; only read-only GET / RFC_READ_TABLE / `$metadata` calls hit
live SAP.

## Final verification (whole WM suite, run at report time)

```
npx jest test/unit/wm   ->  Test Suites: 55 passed, 55 total   Tests: 1123 passed, 1123 total
npx cds compile srv     ->  OK
cd app/fiori-app && npx ui5lint  ->  Success! No findings detected.
git diff --check        ->  clean
```

## Files changed (remediation)

| File | Role |
|---|---|
| `srv/integration/s4hana/wm/Mvt261Adapter.js` | `_issuable`/`_stagingCore`/`_scopeGuard`, list helpers, RGEKZ/backflush, CancelItem reversal, scope guards |
| `srv/wm/mvt261/service.cds` | role changes, `reverse` action, `Backflush`/`IssuableQuantity`/`SupplyAreaStock`/`PartialCoverage` fields |
| `srv/wm/mvt261/service.js` | F4 role, F11 status, F3 atomic claim, F9 batch, F10 plant scope, F6 reverse handler |
| `app/fiori-app/webapp/modules/wm/mvt261/controller/{Scan261,Open261,Cycle261}.controller.js` | post flow, status localisation, reverse flow, multi-batch guard |
| `app/fiori-app/webapp/modules/wm/mvt261/view/{Scan261,Open261,Cycle261}.view.xml` | partial/backflush/advisory strips, Partial/Backflush status, Reverse button |
| `app/fiori-app/webapp/i18n/i18n.properties`, `i18n_en.properties` | new keys (both locales) |
| `test/unit/wm/mvt261Adapter.test.js`, `mvt261Scan.test.js` | extended |
| `test/unit/wm/mvt261Auth.test.js`, `mvt261ScanController.test.js`, `mvt261CycleController.test.js` | **new** |
| `AUDIT_261.md`, `REPORT_261.md`, `WORKSTATUS.md` | audit, this report, work log |

Final 261 test inventory (it-blocks): `mvt261Adapter` 53 · `mvt261Scan` 33 · `mvt261ScanController` 9 ·
`mvt261CycleController` 7 · `mvt261Auth` 7 · `open261Controller` 5.

---

## Phase 0 — Fiori conformance of the Phase 1–2 UI changes

- **Fixed:** one hard-coded-text violation — `Open261.controller.js` built the exported Status value
  from English literals; now localised via `getText('open261Status_*')`.
- **Files:** `Open261.controller.js`.
- **Tests added:** 0 new (covered by the existing `open261Controller.test.js` + ui5lint); the change is
  a localisation of an export value.
- **Verification:** `jest open261Controller.test.js mvt261Scan.test.js` → 28/28; `ui5lint` → no findings; `git diff --check` clean.
- **UI screens:** Open 261 list (exported Status value).
- **Confirmed conformant (no change):** partial = Warning (not Error); blocked scan page shows the actionable reason; status never colour-only; i18n base+_en; no new inputs.
- **No live SAP data was modified.**

## Phase 1 — Quick wins (F4, F11, F10-comment); F12/F6 held

- **Fixed (tested):**
  - **F4** — `postGoodsIssue` restricted to `WarehouseClerk`/`WarehouseManager`/`Admin` (Viewer removed). *Test:* `mvt261Auth.test.js` — Viewer `bob` → 403 (adapter not called), WarehouseClerk `carol` → 200.
  - **F11** — WM delivery outcome recorded as `delivery_created` (not `not_posted`). *Test:* `mvt261Scan.test.js` service — status set to `delivery_created`.
- **Documentation only (no test — it is a comment):** **F10-comment** — corrected the adapter header that falsely claimed SAP applies the calling user's auth; it now states the RFC path runs as the technical user.
- **Files:** `service.cds`, `service.js`, `Mvt261Adapter.js` (comment); new `mvt261Auth.test.js`.
- **Tests added:** 3 (Auth 2 + F11 1). Red-before confirmed (Viewer got 200; status was `not_posted`).
- **Verification:** `jest test/unit/wm` → 1074/1074; `cds compile` OK (compiled `postGoodsIssue @requires` = write roles only); `ui5lint` no findings; `git diff --check` clean.
- **UI screens:** none.
- **Held:** F12 (no-op), F6 (reversal).
- **No live SAP data was modified.**

## Phase 2 — One shared issuable-stock definition (F1 + F2 + F7)

- **Fixed (tested):**
  - **F1** — issuable==0 now blocks the GoodsIssue step / scan page with an actionable reason (supply-area transfer).
  - **F2** — open list computes readiness per reservation (issue location/warehouse) via the same function, not a plant-wide count; reuses `blockers()`.
  - **F7** — the posting gate uses the same `_issuable` as scan/list.
  - *Tests:* `_issuable` matrix (WM/non-WM × none/partial/full, batch, not-ready, 518006/3 & 450402/3 shapes); `openItems` supply-area-only → not scannable, partial → scannable+flag; `postGoodsIssue` 518006/3 → 422; updated cycle/scanContext tests.
- **Files:** `Mvt261Adapter.js` (`_issuable`, `_stagingCore`, cycle/scanContext/openItems/postGoodsIssue), `service.cds` (+`IssuableQuantity`/`SupplyAreaStock`/`PartialCoverage`), Scan261/Open261 views + Open261 controller + i18n.
- **Tests added:** 8 (plus 2 updated).
- **Verification:** `jest test/unit/wm` → 1082/1082; `cds compile` OK; `ui5lint` no findings; `git diff --check` clean. **Live read-only replay:** all 27 plant-1120 conflict items consistent across scan / list / post gate — 27/27 agree, 0 disagree (GET/RFC only).
- **UI screens:** Scan 261 (partial-coverage strip), Open 261 (Partial status badge).
- **No live SAP data was modified.**

## Phase 3 — Posting safety (F3, F9)

- **Fixed (tested):**
  - **F3** — atomic `createOrGet` with a deterministic key (reservation+item+open qty); fail-closed (503) on store-write failure; consecutive partial posts allowed. *Tests:* two concurrent posts → one adapter call + one 409; store failure → 503, no post; sequential partial posts allowed.
  - **F9** — a batch-pinned reservation forces its batch; a mismatch → 422. *Tests:* mismatch → 422 no-post; reservation batch forced when none supplied.
- **Files:** `service.js`; Scan261 controller/view + i18n; new `mvt261ScanController.test.js`.
- **Tests added:** 11 (service F3/F9 4 + ScanController 7).
- **Verification:** `jest test/unit/wm` → 1093/1093; `cds compile` OK; `ui5lint` no findings; `git diff --check` clean.
- **UI screens:** Scan 261 — confirm dialog → busy/disabled; success `MessageToast` + context reload; 409 info + Refresh; 422 actionable error; network-timeout "status unknown, no blind retry".
- **No live SAP data was modified.**

## Phase 4 — Data guards (F5 hard-block, F10 plant scoping)

- **Fixed (tested):**
  - **F5** — backflush (`RESB-RGEKZ`) read in all three RESB reads and made a hard block (cycle/scan/list/`checkStorageUnit`/`postGoodsIssue`). *Tests:* cycle blocked + reason, scan blocked, checkStorageUnit itemBlocked, `postGoodsIssue` 422, openItems not scannable; non-backflush stays open.
  - **F10** — server-side plant scope (`plantScope(req.user)` → `allowedPlants`) on all six ops; out-of-scope → 403 (never an empty list); list filtered to the user's plants. *Tests:* adapter cycle 403/allowed/null-all, openItems 403 for out-of-scope + empty scope + query filtered; cds.test `dave`→403, `eve`→403 (SAP-free short-circuit).
- **Files:** `Mvt261Adapter.js`, `service.cds` (+`Backflush`), `service.js`, Scan261/Cycle261/Open261 views + i18n, `mvt261Adapter.test.js`, `mvt261Auth.test.js`.
- **Tests added:** 12 (backflush 6 + F10 adapter 4 + F10 cds.test 2).
- **Verification:** `jest test/unit/wm` → 1105/1105; `cds compile` OK; `ui5lint` no findings; `git diff --check` clean.
- **UI screens:** Scan 261 + Cycle 261 (backflush Warning strip), Open 261 (Backflush status).
- **Deferred / not changed:** **principal propagation for the write** is a destination-config change (per instruction not touched) — recommended as an ops task; the HTTP client already forwards the user JWT when the destination is set for it.
- **No live SAP data was modified.**

## Phase 5 — Reversal 262 (F6)

- **Contract first (read-only):** `API_MATERIAL_DOCUMENT_SRV` has `Cancel` (whole doc) and `CancelItem`
  (single item); `CancelItem` params MaterialDocument/Year/Item + optional PostingDate; **no reason
  required**. Used `CancelItem`, PostingDate omitted. Verified via `$metadata` + a live 262 read.
- **Fixed (tested):**
  - **F6** — role-guarded `reverse` action (`WarehouseManager`/`Admin` only, clerks excluded), `CancelItem` on the exact doc+item, rejects an already-reversed document, atomic idempotency claim (fail-closed), SAP already-cancelled → 422; Fiori confirm/busy/409/422/timeout flow with the document/material/qty/batch/location dialog. *Tests:* service reverse 6 (happy, already-reversed 422, not-a-261 422, concurrent → one call + 409, store failure 503, SAP already-cancelled 422); cds.test roles 3 (bob 403, carol 403, alice 200); Cycle261 controller 7; adapter CancelItem path.
- **Files:** `Mvt261Adapter.js` (reverse→CancelItem), `service.cds` (+`reverse`/`ReversalResult`), `service.js` (reverse handler), Cycle261 view/controller + i18n, `mvt261Adapter.test.js`, `mvt261Scan.test.js`, `mvt261Auth.test.js`, new `mvt261CycleController.test.js`.
- **Tests added:** 16 (service 6 + roles 3 + controller 7; adapter reverse test updated).
- **Verification:** `jest test/unit/wm` → 1121/1121; `cds compile` OK (compiled `reverse @requires` = `["WarehouseManager","Admin"]`); `ui5lint` no findings; `git diff --check` clean.
- **UI screens:** Cycle 261 — Reverse button per reversible 261 document + confirmation/busy/toast/error flow.
- **Not verifiable read-only:** a live 262 posting was not executed (mock-only, per instruction); atomicity rests on the DB unique constraint + the tests.
- **No live SAP data was modified.**

## Phase 6 — Fiori conformance of the whole 261 app

- **Result:** PASS within the app's (standalone) framework; **no 261-scoped safe failure found, so no code changed.**
- **Checked:** ui5lint (clean); manifest (data sources, models, routing 4 routes/targets, i18n, minUI5 1.136.0, deviceTypes desktop/tablet/phone); user-facing strings (all i18n), accessibility (labels/aria, icon-button tooltips, table headerText, reading order, keyboard), responsive, error/empty states, scanner focus.
- **Tests added:** 0 (review phase).
- **Listed for the team (app-wide, not safe for 261 alone):** FLP intent/semantic object = **N/A** (standalone app, own Login/Dashboard/CommonHeader); pages are title-less by app convention; theme `sap_fiori_3` vs current `sap_horizon`; 261 uses the shared `ODataClient` rather than a manifest dataSource (architectural).
- **No live SAP data was modified.**

## Phase 7 — F8 decision (no code)

- **Decision:** scanning is advisory; the post sends one batch + total quantity. API confirmed read-only:
  no storage-unit (LENUM) field on `A_MaterialDocumentItem` for this LE-WM system, so per-drum binding is
  not possible via the 261 API (only per-batch). **Chosen: Option A** (advisory label + multi-batch guard).
- **New finding raised:** **F13** — multi-batch mis-post (first batch + total quantity) — tracked to fix.
- **Tests added:** 0 (decision phase).
- **No live SAP data was modified.**

## Phase 8 — F8 Option A + F13 fix

- **Fixed (tested):**
  - **F13 / F8 guard** — `Scan261.onPost` now blocks a scan spanning more than one batch (`scan261MultiBatch`), preventing the first-batch+total mis-post; single/non-batch scans post unchanged. *Tests:* multi-batch → error, no confirm, no post; single-batch → posts after confirm.
  - **F8 advisory label** — Information strip on the scan page stating the drum list is guidance (no behavioural test; static label, covered by ui5lint).
- **Files:** `Scan261.controller.js`, `Scan261.view.xml`, i18n; `mvt261ScanController.test.js` (+2).
- **Tests added:** 2.
- **Verification:** `jest test/unit/wm` → 1123/1123; `ui5lint` no findings; `git diff --check` clean (no `.cds` change).
- **UI screens:** Scan 261 (advisory strip + multi-batch block).
- **No live SAP data was modified.**

---

## Status of every audit finding

| Finding | Outcome | Demonstrating test |
|---|---|---|
| F1 issuable not gated | Fixed | `_issuable` matrix, scanContext 518006/3, openItems |
| F2 list readiness plant-wide | Fixed | openItems supply-area-only / partial; live replay 27/27 |
| F3 racy idempotency | Fixed | concurrent→409, store-failure→503, sequential-partial |
| F4 Viewer can post | Fixed | `mvt261Auth` Viewer→403 / clerk→200 |
| F5 backflush unguarded | Fixed (hard-block) | backflush describe (cycle/scan/list/post) |
| F6 262 reversal unwired | Fixed | service reverse 6 + roles 3 + controller 7 |
| F7 post gate divergent | Fixed | `postGoodsIssue` 518006/3 422; live replay |
| F8 scanning advisory | Decided (Option A) + guard shipped | F13 guard tests |
| F9 reserved batch unenforced | Fixed | batch mismatch→422; batch forced |
| F10 no plant scoping / wrong comment | Fixed (scope) + comment | adapter scope + cds.test; comment (no test) |
| F11 wrong delivery status | Fixed | `delivery_created` test |
| F12 FIFO subtraction | **Closed — no-op, not a defect** (the suggest loop stops once open qty is covered, so full vs `min(quantity, toCover)` yields the identical suggested set; no untestable change added) | n/a |
| F13 multi-batch mis-post | Fixed | multi-batch guard tests |

## Attempt re-claim and the recheck timer (QA review follow-up)

A retry after a provably-not-posted attempt now re-claims on its own: a **post** re-claims a prior
`rejected` or `not_posted` attempt; a **reverse** re-claims only `rejected` — never `not_posted`,
because `CancelItem` stamps the 262 with the original 261's reference, so a posted reversal can be
mislabelled `not_posted` and auto-re-claiming it would risk a double reversal. Old rows are kept
(generation-suffixed reference = audit trail); live/done attempts still 409; concurrent re-claims
resolve to one winner via the unique `ReferenceDocument` claim. Covered by six `mvt261Scan` tests
(rejected/not_posted/posted/in-flight for post; rejected/not_posted for reverse) plus the existing
unconfirmed→409, sequential-partial, and concurrent-post cases.

**Recheck timer — confirmed as an ops prerequisite, not auto-verified here.** The background recheck
that ages `unconfirmed`→`not_posted` is started by `GoodsIssueService.init` in every runtime where
`NODE_ENV` is not `test` and `GI_RECHECK_INTERVAL_MS` > 0, so it **runs in the deployed QA/production
app** — provided QA/prod is not started with `NODE_ENV=test` and the interval is not 0 (the ops
prerequisite). That timer confirms **201** outcomes via the 201 adapter; a **261/262-aware** SAP
confirmation is **deferred**, so for 261/262 the operator trusts MB51, not the status (see the QA
runbook). Clearing a genuinely stuck attempt is a DBA action on an approved ticket, MB51 first.

**Deferred / open:** the 261/262-aware recheck above; principal
propagation (destination config — ops task); app-wide Fiori items from Phase 6 (page titles/back-nav,
theme currency, FLP intent — team decisions). **Not verifiable read-only:** live posting/reversal
outcomes (mock-tested only); the SAP-side root cause of `RESB-LGORT=PT01` (AUDIT_261 §10) and whether
the deployed destination uses principal propagation.

**No live SAP data was modified.**
