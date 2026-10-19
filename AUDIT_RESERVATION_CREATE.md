# STEP 7.1 — Reservation Creation Baseline Audit (`/wm/reservation-entry/create`)

- Branch: `feature01` @ `23f6ff1` (HEAD, clean tree). Date: 2026-10-19 12:01 IST.
- Mode: static trace of the current HEAD + read-only Jest run. No code changed. No SAP call made (no live RFC/OData executed by this audit).
- Evidence tags: **CONFIRMED** = read in the cited file/line or in test output. **INFERRED** = derived from code without a live run. **Not verified** = SAP-side behaviour this audit could not prove.

## A. COMPLETE FLOW (as implemented on HEAD)

1. **Route** — `manifest.json:400-402` `wmReservationEntryCreate` pattern `wm/reservation-entry/create` → target `TargetReservationEntryDetail` (view `ReservationEntryDetail`, `manifest.json:584-587`). Same view serves create and detail; `view>/isCreate` toggles the forms.
2. **View** — `ReservationEntryDetail.view.xml`. Create form `formReservationCreate` (161-272): `selectMovementType` (keys 311/201/241/301/261), `inputPlant`, `inputStorageLocation`, `inputWarehouseNumber`, `inputMaterial`, `inputMaterialName`, `inputQuantity` (type Number), `inputUnit`, `inputBatch`. Dynamic form `formDynamicCreate` (342-500): `inputCostCenter` (201), `inputAssetNo`+`inputSubNumber` (241), `inputRecPlant` (301), `inputRecSLoc` (311|301), `inputOrderType`+`inputOrderId` (261). Footer `btnSaveReservation` → `.onSave`.
3. **Controller** — `ReservationEntryDetail.controller.js`. `_getDefaultCreateData` (45-64) seeds MovementType 311, Plant 1120, SLoc CS01, Material 1000000045, Qty 10 KG, RecSLoc ST02. `onMovementTypeChange` (181-248) clears cross-type fields and injects defaults (CC 1011201301, Asset 000000400092/0000, RecPlant 1130, RecSLoc ST02, OrderType ZEMP). `validateForm` (496-571) client-side rules. `onSave` (573-635) builds the payload below and calls `ReservationEntryService.createReservationEntry`.
4. **OData V4 request** — `ReservationEntryService.js:116-119`: `POST /odata/v4/reservation-entry/createReservationEntry` via `ODataClient.post` (CSRF fetched from `/odata/v4/auth/`, `maxRetries: 0` for POST, `ODataClient.js:143-149`). Body (always all 15 keys, `controller.js:587-604`):
   `{ MovementType, Plant, StorageLocation, WarehouseNumber, Material, MaterialName, Quantity:Number, Unit:UPPER, ReceivingStorageLocation, ReceivingPlant, CostCenter, AssetNo, SubNumber, OrderType, OrderID, Batch }` (strings trimmed, empty string when not applicable; no ReservationDate, no Serials).
5. **CDS action** — `srv/wm/reservation-entry/service.cds:143-167` `createReservationEntry(...) returns ReservationEntries`, `@requires ['WarehouseClerk','WarehouseManager','Admin']`. Note the same handler is also bound to OData `CREATE ReservationEntries` (`service.js:1120-1122`), which carries **no** role annotation (`service.cds:12-16`, service-level `authenticated-user` only).
6. **Handler** — `service.js:1115-1117` → `executeReservationAndAutoTR(req.data, req)` (`service.js:40-382`).
7. **Validation** — `validateMovementType` → `validateReservationInput(data, { req })` (`movementConfig.js:411-544`): movement type in config; Plant/SLoc/Material/Unit non-empty; Quantity > 0; optional ReservationDate parseable; per type: 201 CostCenter, 241 AssetNo, 311 `validateMovement311Destination` (634-696), 301 `validateMovement301Destination` (564-620), 261 OrderType+OrderID required and CostCenter/AssetNo/RecPlant/RecSLoc rejected. Errors go to `req.error(400, …)`; handler returns early if `req.errors.length`.
8. **movementConfig** — `MOVEMENT_CONFIG` (`movementConfig.js:32-357`) is the policy table (requiredFields, forbiddenFields, destinationRules, batchRules, serialRules, accountAssignment). At reservation creation only the checks in step 7 are applied; `forbiddenFields` is consulted only by posting-time validators (`movementConfig.js:1209-1222, 1388-1400`), **not** by `validateReservationInput`.
9. **SLoc stock pre-check (warning only)** — `service.js:67-118`: `warehouseFor()` (T320 unless WarehouseNumber supplied) then `RFC_READ_TABLE LQUA` (VERME>0, LGTYP not 9xx). No stock → `req.warn(...)`; any error swallowed. Never blocks.
10. **Adapter** — `ReservationProcessAdapter.createReservation` (`ReservationProcessAdapter.js:67-352`), called with `{movementType, plant, storageLocation, material, quantity, unit, reservationDate: undefined, receivingPlant: ReceivingPlant || (311 ? Plant : undefined), receivingStorageLocation, costCenter, assetNo, subNumber, orderId, orderType, batch}` (`service.js:120-139`). Sequence:
    - `validateReservationInput(params, {throwError:true})` again (87).
    - 201: `validateCostCenter` → CSKS (KOSTL, DATAB/DATBI window, BKZKP≠X) (2722-2752). 241: `validateAsset` → T001K→BUKRS (fallback `'1000'`), ANLA (XLOEV, XSPEB, DEAKT, AKTIV ≤ today) (2756-2810). 261: `validateOrder` → AUFK (LOEKZ, WERKS=plant, AUART=OrderType) + JEST (I0043/I0045/I0046/I0076 reject, I0002 required) (2814-2905).
    - 301: `verifyReceivingLocationInSap` (MARC receiving plant, T320 cross-check, MARD receiving SLoc; T001L skipped) (104-116).
    - All types: issuing T320 row required (119-131). 311: `verifyReceivingLocationInSap` with checkT320 only (134-151).
    - Header build (153-174): `RES_DATE` (server date, YYYYMMDD), `MOVE_TYPE`, `MOVE_PLANT` (receivingPlant, or plant for 311), `MOVE_STLOC` if receivingStorageLocation, `COSTCENTER` = `pad10(costCenter)` if any, `ASSET_NO`/`SUB_NUMBER` = `pad12`/`pad4('0000')` if assetNo, `ORDERID` = `pad12` if orderId. 261 statistical order: `COSTCENTER` auto-filled from `AUFK-KOSTV` (165-174).
    - MARC existence + `XCHPF='X'` ⇒ batch mandatory; 301 with batch ⇒ `validateReceivingBatch` (MCHA/MCH1) (176-198).
    - Item (200-208): `MATERIAL` (18-pad numeric), `PLANT` (`sapKey`), `STGE_LOC` (raw trim), `ENTRY_QNT` Number, `ENTRY_UOM` UPPER, `MOVEMENT:'X'`, `BATCH` (`sapKeyOpt`, UPPER).
    - MARD preflight: material extended to issuing SLoc and (if MOVE_STLOC) receiving SLoc (210-231); MARD read failure ⇒ skip.
11. **BAPI** — one RFC session (233-351): `BAPI_RESERVATION_CREATE1 { RESERVATIONHEADER, RESERVATIONITEMS:[item] }` → RETURN E/A ⇒ 400 `BAPI_RESERVATION_CREATE1 failed: …` (261 + M7 126 ⇒ "adopt" existing RESB component row, see D5) → `BAPI_TRANSACTION_COMMIT { WAIT:'X' }` → `RESERVATION` number; empty ⇒ 500. Returns `{ reservation:{number, item:'0001'}, reservationNoRaw, … }`.
12. **RKPF/RESB read-back** — **none in the create path.** The created document is never read back (`createReservation` returns the BAPI export only; `grep RKPF/RESB` hits are the detail fallback `fetchSapReservation` `service.js:384-515`, `verifyReservation`, and posting paths).
13. **Persistence** — `service.js:155-241`: SLG1 `writeApplicationLog` (failure ⇒ synthetic handle `LOG_<ts>`), `INSERT ReservationLogs` (MB21/01), then `SELECT` existing track row → `UPDATE` (full overwrite) or `INSERT ReservationTrack` with Status 01 / ProcessStatus RESERVATION_CREATED, `CreatedByUser = payload.CreatedByUser || resResult.USNAM || req.user.id || 'KHUSHAL'`.
14. **Auto-TR (same request)** — `service.js:243-374`: `warehouseFor` (+ receiving SLoc for 311) → `adapter.createTransferRequirement` (`L_TR_CREATE`, fallback `ZWM_TR_CREATE`/`Z_WM_TR_CREATE`; BWLVS 311 staging for 201/241 unless `WM_TR_REAL_MOVEMENT=true`; RSNUM blank for 301 and 261-as-311) → verify → `UPDATE` Status 02 + log LB01. Failure ⇒ Status 11, ErrorStep LB01, ErrorMessage; **no** `req.error`, so the SAP reservation and the local row are kept.
15. **Response** — the `ReservationEntries` row (`SELECT.one`, `service.js:379-382`).
16. **UI result handling** — `controller.js:606-634`: success ⇒ `MessageBox.success("Reservation <ReservationNo> created successfully." + TR or "Note: <ErrorMessage>")`, then `navTo wmReservationEntryDetail`. Failure ⇒ `view>/errorMessage` + `MessageBox.error(err.message)` (message from CAP `error.message`, `ODataClient.parseError` 71-111). The detail route then issues `GET ReservationEntries(ReservationNo,ReservationItem)?$expand=Status,Logs` and, if TR/TO/MatDoc/CreatedBy missing, `getReservationDetail` (live RKPF/RESB) to merge (`controller.js:102-129`).

## B. MOVEMENT-BY-MOVEMENT MATRIX

Common to all five (CONFIRMED): UI always sends the 15-key payload above; backend normalized payload is the adapter call in A.10; required base fields Plant, StorageLocation, Material, Quantity>0, Unit; issuing T320 row, MARC row, MARD extension of issuing SLoc required; `XCHPF='X'` ⇒ Batch mandatory; serials never used; quantity sent as `Number(Quantity)` with no decimal-precision check, unit uppercased and not checked against MARA/MARM; warehouse = `WarehouseNumber` as given (unvalidated) else T320 of issuing plant/SLoc; stock check = LQUA warning only; duplicate protection = UI `busy` flag only, none server-side; SAP RETURN E/A ⇒ HTTP 400 with joined MESSAGE text, no `BAPI_TRANSACTION_ROLLBACK` call (session close discards the LUW, `RfcClient.js:60-73`); local persistence = ReservationTrack + ReservationLog as in A.13; partial failure = SAP document kept and status 11 on TR failure, HTTP 500 + orphan SAP document if local INSERT fails after COMMIT; RKPF/RESB read-back = none.

| # | Item | 201 (GI → Cost Center) | 241 (GI → Asset) | 261 (GI → Order) | 301 (Plant → Plant) | 311 (SLoc → SLoc) |
|---|---|---|---|---|---|---|
| 1 | UI fields visible | base + `inputCostCenter` | base + `inputAssetNo`, `inputSubNumber` | base + `inputOrderType`, `inputOrderId` (enabled once OrderType set) | base + `inputRecPlant`, `inputRecSLoc` | base + `inputRecSLoc` |
| 4 | Required (UI `validateForm` / backend `validateReservationInput`) | CostCenter | AssetNo | OrderType, OrderID | ReceivingPlant (4 alnum, ≠ Plant), ReceivingStorageLocation (4 alnum) | ReceivingStorageLocation (4 alnum, ≠ SLoc); ReceivingPlant if sent must = Plant |
| 5 | Forbidden — policy `forbiddenFields` | RecPlant, RecSLoc, GLAccount, AssetNo, SubNumber, OrderID, OrderType | CostCenter, RecPlant, RecSLoc, GLAccount, OrderID, OrderType | CostCenter, AssetNo, SubNumber, RecPlant, RecSLoc, GLAccount | CostCenter, AssetNo, SubNumber, GLAccount, OrderID, OrderType | same as 301 |
| 5 | Forbidden — actually enforced at create | **none** (UI clears on type switch only) | **none** | CostCenter, AssetNo, RecPlant, RecSLoc (backend + UI) | **none** | **none** |
| 6 | BAPI header fields | RES_DATE, MOVE_TYPE, COSTCENTER=pad10 | RES_DATE, MOVE_TYPE, ASSET_NO=pad12, SUB_NUMBER=pad4('0000') | RES_DATE, MOVE_TYPE, ORDERID=pad12, COSTCENTER (only if AUFK-ASTKZ='X', from KOSTV) | RES_DATE, MOVE_TYPE, MOVE_PLANT=ReceivingPlant, MOVE_STLOC | RES_DATE, MOVE_TYPE, MOVE_PLANT=Plant, MOVE_STLOC |
| 6 | BAPI item | MATERIAL, PLANT, STGE_LOC, ENTRY_QNT, ENTRY_UOM, MOVEMENT='X', [BATCH] | same | same | same | same |
| 7 | Plant/SLoc rules | sapKey 4 alnum; T320; MARD issuing | same | same + AUFK-WERKS must equal Plant | same | same |
| 8 | Receiving Plant/SLoc | not applicable (but passed through to BAPI if supplied) | same | rejected | MARC(recv plant), T320 cross-warehouse, MARD(recv SLoc) twice (adapter 104-116 and 219-231), T001L skipped; receiving batch MCHA/MCH1 if Batch | ReceivingPlant forced = Plant; T320 cross-warehouse (same warehouse required); MARD(recv SLoc) |
| 9 | Account assignment | CSKS validity window + BKZKP; `pad10` pads alphanumerics too | ANLA via T001K BUKRS (fallback `'1000'`); `pad12` | AUFK/JEST; order type match; statistical ⇒ COSTCENTER auto | none (forbidden by policy, not enforced) | none (same) |
| 10 | Batch / Serial | Batch optional, UPPER, `sapKey` pattern `[A-Z0-9_\-./]{1,10}`; mandatory if XCHPF; serials ignored | same | same (pinned-batch rule is posting-time only) | same + receiving-plant batch existence | same |
| 12 | Warehouse determination (auto-TR) | T320 issuing; BWLVS 311 staging (default) | same | T320 issuing; BWLVS 261, BETYP F, BENUM order; RSNUM blank when staged as 311 | T320 issuing; BWLVS 301, RSNUM/RSPOS blank | T320 issuing + T320 receiving (skipped if WarehouseNumber given); BWLVS 311 with RSNUM |
| 15 | SAP error handling specifics | BAPI E/A ⇒ 400 | same | M7 126 ⇒ adopt RESB component row and return success | same as 201 | same as 201 |
| 16 | Track row extras | CostCenter | AssetNo, SubNumber | OrderID, OrderType | ReceivingPlant, ReceivingStorageLocation | ReceivingStorageLocation (ReceivingPlant '' although BAPI got MOVE_PLANT=Plant) |
| 18 | RKPF/RESB read-back | none | none | none (adoption path reads RESB *before* returning, not after) | none | none |

Items 2, 3, 11, 13, 14, 17 are identical across types and covered in the "Common" paragraph.

## C–G. DEFECTS (file, function, severity, repro, fix)

**D1 — P0 — FIXED 2026-10-19 12:20 IST (`@restrict` on `ReservationEntries`, tests in `reservationEntryService.test.js` block 1b) — Role check bypass: any authenticated user can create a SAP reservation + TR via OData CREATE.**
`srv/wm/reservation-entry/service.cds:12-16` (`ReservationEntries` has no `@requires`/`@restrict`), `srv/wm/reservation-entry/service.js:1120-1122` (`this.on('CREATE', ReservationEntries, … executeReservationAndAutoTR)`). The role gate exists only on the actions (`service.cds:143`). UPDATE/DELETE on the entity are also open to `authenticated-user` (generic handlers).
Repro: as mocked user `bob` (role Viewer only, `package.json`), `POST /odata/v4/reservation-entry/ReservationEntries` with a valid 311 body ⇒ handler runs `BAPI_RESERVATION_CREATE1` + `L_TR_CREATE`. (CONFIRMED statically; not executed.)
Fix: `@restrict` the entity (`CREATE/UPDATE/DELETE` to the three warehouse roles, or drop the CREATE-entity binding and make the entity `@readonly` for non-key updates) so the only write path is the role-gated action.

**D2 — P1 — No RKPF/RESB read-back after create; item number assumed.**
`ReservationProcessAdapter.js:290-313` returns `item: '0001'` and the BAPI `RESERVATION` export; nothing reads RKPF/RESB. Violates AGENTS.md Definition of Done #9. `ReservationTrack` stores the user's Plant/SLoc/Qty/Unit/MaterialName, not SAP's.
Repro: mock BAPI returning a number ⇒ row persisted with Status 01 without any `RFC_READ_TABLE RKPF/RESB` call (visible in `reservationEntryService.test.js:201-256`, no readTable assertion).
Fix: after COMMIT, read `RKPF (RSNUM, BWART, KOSTL, ANLN1, ANLN2, UMWRK, UMLGO, AUFNR, USNAM, RSDAT)` and `RESB (RSPOS, MATNR, WERKS, LGORT, BDMNG, MEINS, CHARG, XLOEK)`, assert they match the request, persist SAP values (incl. real RSPOS, USNAM, ReservationDate), fail with a clear error if the row is missing.

**D3 — P1 — No idempotency / duplicate guard on reservation creation.**
`service.js:40-382` (`executeReservationAndAutoTR`) has no client attempt id, request hash, or in-flight lock (compare `GoodsIssueAttemptStore` used by goods issue). UI protection is only `view>/busy` (`controller.js:575`). `ODataClient` does not retry POSTs, but a 504/connection drop after `BAPI_TRANSACTION_COMMIT` leaves the user with an error and a committed reservation; resubmitting creates a second one. Same for a failed `BAPI_TRANSACTION_COMMIT` call (`adapter.js:325-327`): outcome unknown, reported as failure.
Repro: mock `createReservation` to resolve after the client aborts, then resubmit ⇒ two track rows / two BAPI calls.
Fix: accept a `ClientAttemptId`, persist an attempt row keyed by it (plus a SHA-256 of the normalized payload) before calling SAP, return the existing result on replay, and on commit-timeout reconcile by reading RKPF/RESB (`USNAM`, `RSDAT`, material/qty) before allowing a retry.

**D4 — P1 — `forbiddenFields` not enforced at creation for 201/241/301/311; cross-type values reach the BAPI header.**
`movementConfig.js:validateReservationInput` 411-544 only rejects extras for 261. `ReservationProcessAdapter.js:153-162` adds `MOVE_STLOC`, `COSTCENTER`, `ASSET_NO`, `ORDERID` whenever the value is truthy, regardless of movement type.
Repro: `POST createReservationEntry` 311 body with `CostCenter: "1011201301"` ⇒ passes validation, header `{MOVE_TYPE:'311', MOVE_PLANT, MOVE_STLOC, COSTCENTER:'1011201301'}` is sent. What SAP does with it is **Not verified**.
Fix: in `validateReservationInput`, reject any non-empty field listed in `cfg.forbiddenFields`; build the header only from the fields the type allows.

**D5 — P1 — 261 "adoption" path reports a reservation as created, ignores SLoc/quantity, and overwrites existing tracking.**
`ReservationProcessAdapter.js:244-299`: on M7 126 the code selects the first open `RESB` row for `AUFNR+MATNR+WERKS` (no `LGORT`, no quantity comparison) and returns `success:true`; `service.js:186-203` then `SELECT existing` → `UPDATE … set(initialTrackRecord)` which resets `TransferRequirement`, `Status_code` 01, `ErrorMessage` etc. The UI shows "Reservation N created successfully" and the auto-TR is created with the user's quantity against SAP's component line.
Repro: mock BAPI RETURN `{TYPE:'E', ID:'M7', NUMBER:'126'}` and a RESB row with `LGORT` ≠ request SLoc and `BDMNG` ≠ request Qty; a pre-existing track row with Status 05 for that RSNUM/RSPOS is reset to 01.
Fix: never upsert over a tracked row with progress (reject or merge); on adoption require `LGORT` match, cap quantity to `BDMNG−ENMNG`, return a distinct `stage: 'ADOPTED'` so the UI can say "linked to existing component reservation"; cover with tests.

**D6 — P2 — Padding differs between validation and BAPI header for alphanumeric cost centers/assets.**
`validateCostCenter` pads only numeric values (`adapter.js:2727`) but the header uses `pad10` unconditionally (`adapter.js:159`); same for `pad12` on `ASSET_NO` (160). Example `SAP-DUMMY` validates against CSKS as `SAP-DUMMY` but is sent as `0SAP-DUMMY`. The TR path already handles this case correctly (`adapter.js:483-485`).
Fix: one shared `padIfNumeric` helper used by validation, header and TR mapping.

**D7 — P2 — Hard-coded environment and user values.**
`service.js:168` and `service.js:567` fallback `CreatedByUser … || 'KHUSHAL'`; `adapter.js:2756` `plant = '1120'` default and `2765` `bukrs = '1000'` fallback; `controller.js:45-64, 187-246` default master data (1120, CS01, 1000000045, 1011201301, 000000400092, 1130, ST02, ZEMP). AGENTS.md forbids environment-specific values in code; a wrong `CreatedByUser` corrupts the audit trail.
Fix: drop the `'KHUSHAL'` fallback (fail or store `''`), require BUKRS from T001K (error if missing), move UI defaults to configuration or leave empty.

**D8 — P2 — User-supplied `WarehouseNumber` bypasses T320 validation; 311 receiving-warehouse check skipped when given.**
`service.js:25-37` `warehouseFor` returns `sapKey(given)` without a T320 lookup; `service.js:246-249` uses it for both issuing and receiving checks. A wrong warehouse reaches `L_TR_CREATE` (SAP then rejects or, worse, creates a TR in the wrong warehouse — **Not verified**).
Fix: always resolve T320 and, if a `WarehouseNumber` was supplied, require it to equal the T320 value.

**D9 — P2 — Production code branches on Jest mocks; "does not exist" paths untested.**
`adapter.js:105, 185, 2741, 2787, 2840, 2938` use `!this.rfc.readTable?.mock || this._check*Existence`. `reservationEntryService.test.js` and `reservationProcess.test.js` never set the flags, so CSKS/ANLA/AUFK/MARC/MCHA "not found" rejections and the 301 receiving-location SAP check are skipped under test.
Fix: remove the mock sniffing; make the checks unconditional and drive the tests with explicit readTable fixtures.

**D10 — P2 — Partial-failure ordering and synthetic data after SAP commit.**
`service.js:157-183`: SLG1 failure stores a fabricated `LogHandle` (`LOG_<ts>`); the log row is inserted before the track row; if the track INSERT/UPDATE throws (e.g. HANA length violation on `MaterialName` > 40, or DB outage) CAP rolls back the local tx and returns 500 while the SAP reservation is already committed, with no record and no retry handle.
Fix: insert the track row first inside the same tx, store `''` when SLG1 fails, and on local failure after SAP success return the reservation number in the error so the user/ops can import it (the READ auto-import at `service.js:1125-1210` already exists for that).

**D11 — P2 — Storage-location/plant strings reach the BAPI un-normalized.**
`adapter.js:155-157, 203` send `MOVE_PLANT`, `MOVE_STLOC`, `STGE_LOC` as `String(x).trim()` while every preflight uses `sapKey` (upper-cased). Lower-case input `cs01` passes MARD/T320 checks and is sent as `cs01`; SAP behaviour **Not verified**.
Fix: use `sapKey(...,'lgort'/'plant')` for those header/item fields.

**D12 — P2 — Action accepts `SerialNo`/`Serials` and silently drops them.**
`service.cds:159-160` declares them; `service.js:44-66` never reads them; nothing is sent or persisted. Callers get a false contract.
Fix: remove the parameters from `createReservationEntry` (reservations carry no serials) or reject non-empty values.

**D13 — P3 — ReservationDate never sent; track stores `null` while SAP stores today.** `controller.js:587-604` omits it; `adapter.js:154` defaults `RES_DATE` to the server date; `service.js:178` persists `effResDate || null`. Fix: persist the date actually sent (or read `RKPF-RSDAT` back, see D2).

**D14 — P3 — FIXED 2026-10-19 12:45 IST (Step 7.2) — `createReservation` action omits `OrderType` from its track record** (`service.js:548-575`) while `createReservationEntry` persists it (`service.js:180`). Fix: share one record builder.

**D15 — P3 — Batch character rules disagree.** `sapKey` batch pattern allows `_ - . /` (`sapKey.js:18`), `MOVEMENT_CONFIG.batchRules.regex` allows alphanumerics only (`movementConfig.js:72`). Fix: one regex.

**D16 — P3 — Redundant work / schema noise.** 301 receiving MARD read twice (`adapter.js:104-116` and `219-231`); `@assert.unique` on the key fields (`reservation-track.cds:20`); `sapNum` unused (`adapter.js:24`). Fix: remove duplicates.

**D17 — P3 — Error texts for 5xx may be sanitized in production.** `service.js:143, 150` emit 500 for "no reservation number" and non-400 adapter errors; CAP replaces 5xx messages with a generic text outside development (**Not verified** on this project's CAP 10 config). Fix: map SAP-originated failures to 4xx/502 with explicit codes or set `cds.env.log.sanitize` consciously.

## H. TESTS REQUIRED (read-only run results first)

Executed: `npx jest test/unit/wm/reservationEntryService.test.js test/unit/wm/reservationEntryUi.test.js test/unit/wm/reservationProcess.test.js test/unit/wm/reservationTrack.test.js test/unit/wm/movementConfig.test.js test/unit/controller/uiConsistency.test.js` → **PASS, 6 suites, 249 tests**. `git diff --check` clean. Not run: e2e (`verifyMvt*.e2e.js`) and anything needing a live SAP system.

Coverage gaps the defects expose (all CONFIRMED by grep of the suites):
1. D1: `POST /ReservationEntries` as a Viewer-only user must return 403 and must not call the adapter.
2. D2: a test asserting `RFC_READ_TABLE RKPF`/`RESB` is called after COMMIT and that persisted Plant/SLoc/Qty/RSPOS come from SAP.
3. D3: replay with the same `ClientAttemptId` returns the first result and calls `BAPI_RESERVATION_CREATE1` once; concurrent submissions → one BAPI call + 409.
4. D4: 311/301/201/241 payloads carrying a forbidden field return 400 and the header excludes it (parametrized over `MOVEMENT_CONFIG[*].forbiddenFields`).
5. D5: adapter unit test for the M7 126 adoption branch (none exists today; `grep 126 test/unit/wm/reservationProcess.test.js` is empty) incl. SLoc mismatch and an already-tracked row.
6. D6: alphanumeric cost center / asset keeps its value in the header.
7. D8: supplied WarehouseNumber ≠ T320 ⇒ 400.
8. D9: CSKS/ANLA/AUFK/MARC/MCHA not-found ⇒ 400 with the mock flags removed.
9. D10: local INSERT failure after SAP success ⇒ error carries the reservation number; SLG1 failure ⇒ `LogHandle ''`.
10. D11: lower-case SLoc/plant input is upper-cased in the BAPI header/item.
11. D12: non-empty `Serials` ⇒ 400 (or parameter removed from CDS).
12. e2e: existing `verifyMvt*.e2e.js` already open `/create`; add an assertion on the detail page that SAP (RKPF/RESB via `getReservationDetail`) matches the persisted row.

## Done / Not done / Still unknown / Assumptions

- **Done:** full static trace UI → BAPI → persistence → response; matrix for 201/241/261/301/311; 17 defects with file/function, severity, repro, fix, tests; 6 Jest suites run read-only (249 pass).
- **Not done:** no live SAP call (no metadata, table, or BAPI check executed); e2e suites not run; no code changed.
- **Still unknown (Not verified):** how `BAPI_RESERVATION_CREATE1` treats cross-type header fields (D4) and lower-case SLoc/plant (D11); whether CAP sanitizes the 5xx texts in this deployment (D17); what `L_TR_CREATE` does with a wrong `WarehouseNumber` (D8).
- **Assumptions:** none beyond the tags above.
