# SAP-only persistence migration — discovery and implementation gate

Date: 2026-11-03 IST. Status: **Phase 1 removed tracking and settings; complete removal is BLOCKED on the SAP posting-attempt table**.

The user confirmed removing the application database and approved proceeding with SAP-side replacement investigation. This document defines required behavior; it does not define a verified new SAP API or authorize deployment or SAP writes.

## Live evidence

READ-ONLY discovery used the existing `RfcClient` and `tools/lib/readOnlyRfcGuard.js`, permitting only `RFC_READ_TABLE`. Connection settings were loaded from local configuration without recording their values. The first sandbox attempt failed with `RFC_COMMUNICATION_FAILURE`; the approved retry outside the sandbox succeeded.

The following queries were executed on the configured SAP system:

- `TFDIR`, fields `FUNCNAME, FMODE`, filter `FUNCNAME = 'Z_WM_RES_LOCK'`: zero rows.
- `DD03L`, fields `TABNAME, FIELDNAME, DATATYPE, LENG`, filter `TABNAME = 'ZRES_TRACK' AND AS4LOCAL = 'A'`: zero rows.
- Same DD03L query for `ZRES_LOG`: zero rows.
- `TFDIR`, filter `FUNCNAME LIKE 'Z%RES%'`: zero rows.
- Control query: `TFDIR`, filter `FUNCNAME = 'Z_WM_GET_TR_MATERIAL_LIST'`: one row, `FMODE = R`.
- `TFDIR`, filter `FUNCNAME LIKE 'Z%'`: 193 rows, below the 501-row cap. A later concise capture found 49 remote-enabled functions.
- `TADIR`, field `OBJ_NAME`, filter `PGMID = 'R3TR' AND OBJECT = 'TABL' AND OBJ_NAME LIKE 'Z%'`: 490 rows, below the 501-row cap. Name filtering for `RES|TRACK|LOG|CONFIG|IDEMP|ATTEMPT|LOCK|CLAIM|WM` matched only `ZWM_S_001` and `ZSTR_WM_BIN_STOCK`. TABL objects can be structures; this is not evidence of a usable storage service.

These exact names were checked because the repository referenced them at the time, including `docs/abap/z_wm_res_lock.fugr.abap:2`. The metadata query pattern is established in `tools/read-system-metadata.js:15-17` and `:100`; the control function is already used by the warehouse integration.

**CONFIRMED:** metadata connectivity and the query results above. No posting, locking, activation, transport, or other SAP write was called.

**UNKNOWN:** whether a differently named, Y-namespace, standard, namespaced, or OData implementation provides the required behavior. Function/table names do not establish contracts. The catalog search does not prove no replacement exists anywhere in SAP. No catalog function other than RFC_READ_TABLE was invoked.

## Package and target decision — 2026-11-03 14:02 IST

The user selected: **Use ZAMM; I will provide the development target and transport request**. ZAMM is the selected package for the planned implementation. No new package needs to be invented or created at this stage.

READ-ONLY package/client discovery used the same guarded RFC client:

- TDEVC returned ZAMM with DLVUNIT HOME and $TMP with DLVUNIT LOCAL. It returned no row for ZRES_WM. Package lookup conventions are present in `tools/check-chunk0-prereqs.js:117` and the ZAMM proposal in `docs/abap/zmm_af_017_4x6-spec.md:28`.
- TADIR returned function groups Z_VENDOR_REMOTES and ZMM_QUAR_LABEL in $TMP. These existing objects do not decide the package for this migration.
- DD03L first confirmed the client-role field and its domain. T000 then returned role T for the configured client; DD07T resolved T to Test. This verifies the current connection's client role, not its suitability as an approved development target or the role of every client in that system.
- Five RFC_READ_TABLE calls succeeded. No environment/credential values were recorded and no SAP writes ran.

**Pending user input:** the development target and assigned workbench transport request. The current test client is not implicitly selected as that target. Do not create, activate or transport SAP objects until the target/transport are supplied, the required contracts/design are verified and the specific write is authorized. Package selection does not resolve the backend persistence contract gaps below.

## Posting-attempt table decision — 2026-11-03 IST

The user chose a Z table in ZAMM for double-post protection, over memory plus SAP reads. Reasons: production runs 2 instances (`mta/extensions/prod/prod.mtaext:9`), memory is lost on restart, and a SAP read is not an atomic claim.

**Prepared, not created in SAP:** `docs/abap/zwm_post_attempt.tabl.ddl` and `docs/abap/zwm_post_attempt.fugr.abap`.

| Object | Purpose |
| --- | --- |
| Table `ZWM_POST_ATTEMPT` | One row per attempt; primary key client + reference document |
| `Z_WM_ATTEMPT_CLAIM` (RFC) | Inserts a `sending` row and commits, or returns the existing row |
| `Z_WM_ATTEMPT_SET_STATUS` (RFC) | Moves an attempt to a new status and commits |
| `Z_WM_ATTEMPT_READ` (RFC) | Reads by reference, by request hash, or all open attempts |

**READ-ONLY checks, 2026-11-03 (`RFC_READ_TABLE` through `tools/lib/readOnlyRfcGuard.js`):** these names return no rows in TADIR and TFDIR. TDEVC shows ZAMM with transport layer ZDS4. CVERS shows SAP_BASIS 816. T000 shows the configured client has category T and a blank `CCNOCLIIND`, which DD07T describes as repository changes allowed. So this client can technically hold the objects; whether it is the approved target is the user's decision.

**Not verified:** that the source activates, including source-based table creation through ADT (no precedent in this repository); `IS SUPPLIED` over RFC from node-rfc; atomicity under parallel sessions; the S_RFC role.

**Pending from the user:** target system, transport request, and a written go for each write below.

### Live proof, each step a separate SAP WRITE

Use references starting `ZTEST` and end every test row in `rejected`, so the app's recheck never picks one up. No delete module exists; removing test rows afterwards is a manual decision.

1. Create and activate the table and function group in ZAMM on the transport request. Read back through TADIR, TFDIR and DD03L.
2. Claim a new reference: `EV_CREATED = X`. Read it back on a new connection, which proves it is durable.
3. Claim the same reference again: `EV_CREATED` blank and the first row returned.
4. Run two parallel claims on two connections for one new reference: exactly one wins. Repeat several times.
5. Set status with only `IV_MATERIAL_DOCUMENT` sent, then with only `IV_LAST_ERROR` sent: the other field is kept. Send `IV_LAST_ERROR` empty: it clears.
6. Read by reference, by hash and open only. Confirm an unknown status and a call with no filter both return `E`.

### After the proof

Add one client under `srv/integration/s4hana/` that calls these modules with `RfcClient.call`, never inside a posting `session()`. Point `GoodsIssueAttemptStore` at it and remove its database and memory branches. Keep the fail-closed behaviour: if a claim cannot be written, nothing is posted. Then carry over production rows: open attempts must be resolved first, and `posted` rows matter too, because re-claim logic reads them. Only then remove the attempts entity, the database configuration and the HDI resources.

## Required replacement behavior

### Durable posting attempts and duplicate protection

Current source: `srv/wm/goods-issue/GoodsIssueAttemptStore.js:24-39`, `:84`, `:150`, `:205`, `:221`, `:429`, `:499`. Consumers include goods issue, movement 261 and goods receipt handlers/services. This is application attempt state, separate from a successfully posted SAP material document.

A verified SAP implementation must provide:

1. An atomic claim for the same posting identity across concurrent application instances. Only one claimant may proceed to posting.
2. Durable state before the posting call, visible after a process restart and independently of a failed CAP request transaction.
3. Reading an attempt by reference and identifying unresolved attempts for a reservation/item or receipt.
4. Controlled state transitions and replay of a confirmed SAP result; preserve the current distinction between retrying the same request and a new partial issue.
5. Recovery after a timeout or lost response by reading SAP's actual outcome. An empty early read must not be treated as proof that posting never happened.
6. Preservation of retry generations and unresolved attempts during migration. A reference search alone is not an atomic claim; a session lock alone does not preserve pending state after connection loss.
7. Authorization, error semantics, transaction/commit behavior and retention defined by an inspected SAP contract.

The existing database-free Map is process-local (`GoodsIssueAttemptStore.js:40`, `:111-114`, `:186`). Using it would not meet the requested SAP-only persistence goal or preserve restart/multi-instance guarantees. New SAP technical names, payloads, and parameter types are **Not verified**; no adapter is implemented against assumed names.

### Reservation workflow tracking: removed, not replaced (2026-11-03)

The user approved removing the local tracking tables and the unused reservation tracking API. No screen called them. `tr-to` keeps its SAP calls and reads SAP documents instead. What changed on `tr-to`:

- A further partial issue on an item that already has a document returns 409, because it cannot be told from a repeat.
- A retry must send its own `ProcessId`.
- The movement 311 reservation-to-TR lookup returns 404, because `LTBK-RSNUM` is empty for 311.
- A TR whose movement type differs from its reservation's is refused unless the sandbox override is on.
- A closed staging TR with no reservation in `LTBK` is no longer recovered.
- Workflow history and step logs are gone. Any production rows are unknown and not migrated.

### Business settings: removed, sources open (2026-11-03)

The user approved removing the local settings table and its unserved admin API.

| Setting | Source now |
| --- | --- |
| Currency, shipping points | SAP (T001K, T001, TVSTZ) |
| Delivery Without Reference sales area | The form, otherwise SAP T001L for the storage location |
| Sales order and inquiry defaults | Unchanged: the existing hardcoded fallback in `SalesInquiryAdapter.js` |
| Oversize HU behaviour | Always `BLOCK` |
| Quarantine label form and size | The wrapper's default form, no size check |
| Movement 261 blocked-bin rules | **No source.** The rule stays off |
| HU pickable, hold and interim storage types | **No source.** HU transfer rules fail closed |

The last two need a decision on where they should live. Nothing guesses them.

## Implementation sequence after contract verification

1. Identify the SAP owner and existing contracts, or obtain the approved SAP development design for the missing responsibilities. Verify callable interfaces, authorization, storage, atomicity, commit behavior and recovery. ZAMM is selected by the user; the development target and transport request are pending. New API/object names remain unverified.
2. Prove the required SAP operations with explicitly authorized test calls and direct read-back. Concurrency and interrupted-response behavior need their own tests; a metadata response alone is insufficient.
3. Implement mappings through the existing integration boundary under `srv/integration/s4hana/`, preserving CAP APIs and UI behavior. Use controlled mocks for unit/integration coverage; mocks must not be described as SAP proof.
4. Inventory actual persisted application data without exposing record contents. Define retention and migration for unresolved attempts, tracking history and configuration. Drain or reconcile in-flight work before cutover. No database export/deletion was performed during this review.
5. Replace the shared persistence boundaries and verify all consumers. Keep existing working SAP reads intact; do not retain a hidden memory/file/SQLite fallback.
6. Once live proofs and relevant E2E pass, remove application persistence models/dependencies/configuration and MTA HDI bindings/deployer coherently. Check all environment extensions, build scripts, CI and tests before editing them. Test-fixture strategy must remain isolated from live SAP.
7. Remove obsolete SQL migration artifacts only after replacement and retention are verified. A deployment/database drop is a separate specific write approval, not implied by editing repository files.

The original architecture decision and its later persistence exception are recorded in `ADR-0001-s4-centric-integration-facade.md`. Update that decision at the implemented cutover rather than claim the current runtime already complies with SAP-only persistence.

## Validation and acceptance

Existing tests to preserve or adapt include:

- `test/unit/wm/goodsIssueAttemptInstances.test.js` — shared state and single claims across instances.
- `test/unit/wm/goodsIssueAttempt.test.js` and `transactionPersistenceAndRetry.test.js` — attempts and retry outcomes.
- `test/unit/wm/duplicateConcurrentTimeoutRecovery.test.js` — concurrent/timeout behavior.
- `test/unit/common/BusinessConfigResolver.test.js` — configuration resolution and errors.
- `test/unit/wm/reservationTrack.test.js` and tr-to coverage — tracking/API behavior.
- `test/unit/tools/readHuStockEvidence.test.js` — read-only guard and redaction behavior used during discovery.

The affected Playwright flows and SAP round trips must be selected from `docs/e2e-coverage-matrix.md` when implementation is possible. Full acceptance includes application restart, two instances, duplicate requests, uncertain SAP outcomes, invalid/missing configuration, authorization failures, existing list/detail reads, SAP result read-back and removal of every application persistence binding. No SAP-only E2E or deployment validation has run.

## Next action

The missing prerequisite is a verified SAP implementation/contract for the responsibilities above. The scoped discovery did not find one. The user selected ZAMM and will supply the development target and transport request. The approved technical design and verified replacement contracts must also be established before dependent implementation or deployment. No further generic approval is needed for the already authorized migration scope; what is missing is backend capability and contract evidence.
