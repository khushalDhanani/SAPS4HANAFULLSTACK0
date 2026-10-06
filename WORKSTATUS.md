# WORKSTATUS

Single source of truth for work history, current status, validation, unresolved issues and next steps (see `AGENTS.md`).
The previous log was removed in commit `b741337`; this file restarts it.

## Current Status

- **Goods Receipt page `#/wm/goods-receipt` shows open inbound deliveries as a direct list** (table under the scan field, row press starts the existing lookup). Unit tests and ui5lint pass; **verified in a browser on 2026-10-06** (second `cds watch` on port 4005 with `LOCAL_DEV_PASSWORD` set to a session-generated value, mock user `alice`): 25 rows render, row press on 180000077 fills delivery/PO/material/plant/SLoc/batch/open quantity. **GR cycle test HALTED at the first post (2026-10-06 11:15 entry):** the user gave the go, the 40 KG post on 180000077 was rejected by SAP with VLA 307 "Putaway quantity cannot be less than GR posted quantity" (CS02 in plant 1130 is WM-managed, warehouse W12, putaway not done). No document was created, SAP is unchanged. The user then chose 180000008 (non-WM SLoc ST02): the 400 KG post was rejected too, with **MBND_CLOUD 002 "Purchase order 0001800000 was already changed"** (11:45 entry) — a wrong PO number that exists nowhere in SAP. Nothing was posted in either attempt. **Conclusion: the Goods Receipt posting path `MMIM_GR4PO_DL_SRV/GR4PO_DL_Headers` has never produced a material document and is not proven (Unresolved Issue 8).** The user chose to prove `API_MATERIAL_DOCUMENT_SRV` (12:20 entry): metadata read, one 100 KG 101 POST on PO 400000164/10 + delivery 180000008/10 with batch IN25000333 → **HTTP 400 VLA 317 "Inbound delivery batch cannot be changed to IN25000333 here"**, no document. Root cause: the inbound delivery item carries no batch and a GR against an inbound delivery cannot set one; the batch must be on the delivery item before the GR. Cycle halted; waiting for the user's decision (Next Step 8).
- **Open 261 items, scan screen stage 1 and 261 cycle (all read-only)** — list (153 for plant 1120, reconciled with RESB), scan-and-validate page `#/wm/mvt261/open/{reservation}/{item}` and cycle page `.../cycle` validated live against SAP at backend level and by unit tests; UI **not yet verified in a browser**. No posting is exposed. **Open SAP document 4900050046/2026 still not reversed** (Unresolved Issue 0).
- **First Goods Issue 261 finder (read-only)** — backend complete and validated live against SAP; UI built, statically validated, **not yet verified in a browser** (login needs the user's SAP credentials).
- **Handling Unit cockpit (read-only)** — CAP `HandlingUnitService` (`/odata/v4/handling-unit`: `list` / `detail` / `hierarchy` / `valueHelp`) + `HandlingUnitAdapter` over the three V2 read services; UI list (with Plant, SLoc, Status, Packaging Material, Shipping Point, External ID filters + F4 type-ahead suggestions + Excel export) + object-page detail enriched with monitor metadata and combined item details (Material description, Plant, SLoc, Batch, Status badge, Packaging text, Reference doc type, Creation date, clean fallbacks for unmaintained dimensions/weights) and packing TreeTable with expand/collapse controls; dashboard WM tile "Handling Unit Cockpit". Deep-link hierarchy tree resolution verified (resolves `HandlingUnitIDChar32` via monitor without relying on URL query param). 13 unit tests pass, ui5lint clean. **UI not yet verified in a browser** (login needs the user's SAP credentials). No write path — `API_HANDLING_UNIT` is read-only on this system (Issue 9).

## Unresolved Issues

0. **OPEN SAP POSTING:** material document 4900050046/2026 (261, 1 NOS, reservation 278650/1, plant 1120, HS01) was posted in live test 1 and is NOT yet reversed; WM transfer requirement 1000744 (W01) was created by it. Waiting for the user's decision to cancel it. Status: **Blocked**.
1. UI page `#/wm/mvt261` not exercised in a browser (see above). Status: **In Progress**.
2. The original spec asked for ABAP RAP objects (ZI_MVT261, ZC_MVT261, DCL, V4 binding). By user decision (2026-10-05) the feature is built as CAP + UI5 on existing SAP services; no ABAP objects exist.
3. "Show a message if authorization removes rows" cannot be detected: SAP filters unauthorized plants / movement types silently inside the OData services. The UI shows a static note instead.
4. Archived material documents are not read (UI shows the SARI / MM_MATBEL hint).
5. The pasted spec ended at "6. Performance:"; later sections were never received.
8. **Goods Receipt posting via `MMIM_GR4PO_DL_SRV/GR4PO_DL_Headers` is unproven and fails live.** Two live attempts on 2026-10-06 (40 KG on 180000077 → VLA 307 putaway check; 400 KG on 180000008, a non-WM SLoc → MBND_CLOUD 002 "Purchase order 0001800000 was already changed", where 0001800000 is not the delivery's PO 0400000164 and no such PO exists). The old work log (commit b741337^) records only GET reads on this service, never a posted document, so the AGENTS.md "prove CREATE against SAP" step was never done for Goods Receipt. The adapter invents `Temp_Key` (`<doc>GR<timestamp>`) and sends no `PurchaseOrder`/`PurchaseOrderItem` in the items; a GET on `GR4PO_DL_Headers(...)` returns an empty header for every key variant tried, so SAP's own `Temp_Key` cannot be obtained with a plain GET. Status: **Open — blocks any GR 101 posting from the app**.
7. **Goods Receipt lookup falls back to PO-level data when the delivery item read fails.** `GoodsReceiptAdapter.getGoodsReceiptItem` first reads `GR4PO_DL_Items(InboundDelivery=…,DeliveryDocumentItem=…,SourceOfGR='INBDELIV')`; when that read fails (seen for 180000060, 180000057, 180000035, 180000003 among others) it silently continues with `GR4PO_DL_Headers(InboundDelivery=<PO>,SourceOfGR='PURORD')/Header2Items`, so the UI shows the PO open quantity (180000060: 9000 KG instead of the delivery's 1000 KG), an empty SLoc and no delivery batch. A user could over-receive against the delivery. Found 2026-10-06 during the GR cycle test preparation; not part of that cycle. Status: **Open**.
6. `test/unit/guard/noGiQueueGuard.test.js` fails: the gitignored `srv/external/all_catalog_services.json` (refreshed 2026-10-05 18:31, see the 10:05 entry) contains the SAP catalog entry `ZAPI_MATERIAL_DOCUMENT_SRV_0001`, which matches the guard's forbidden pattern. Pre-existing, not caused by the goods-receipt change. Status: **Open**.
9. **Handling Unit services unblocked and verified live.** All six services (`C_HANDLINGUNITMONITOR_CDS`, `UI_HANDLINGUNITHIERNODE`, `API_HANDLING_UNIT`, `API_PACKINGINSTRUCTION`, `FDP_HU_SHIPPINGLABEL_SRV`, `FDP_LOHUM_HU_PACKINGLIST_SRV`) have been assigned system alias `LOCAL` and verified live with **HTTP 200 OK** (2026-10-06 11:38 IST). `API_PACKINGINSTRUCTION` is Creatable (`PackingInstructionHeader`); `API_HANDLING_UNIT` reads live HUs (`HandlingUnit`, `HandlingUnitItem`) but exposes `sap:creatable="false"` in OData V2; `C_HANDLINGUNITMONITOR_CDS` and `UI_HANDLINGUNITHIERNODE` are read-only monitors/trees; FDP services are read-only form data providers. **Read-only HU cockpit built 2026-10-06** on the three read services (list / detail+items / packing tree); backend proven live through the adapter, UI built + lint-clean but **not yet browser-verified** (needs the user's SAP login). Status: **Read-only cockpit delivered; browser verification pending**.

## Next Steps

0. User to decide: reverse 4900050046/2026 with the API Cancel action (then verify ENMNG, KZEAR, stock and the WM transfer requirement), and whether to run test 2 (418011/4, 1 KG, needs a batch decision).
1. Log in locally, open the dashboard tile "First Goods Issue 261" (WM tab) and confirm the page with plant 1120.
2. Decide whether the ABAP RAP variant is still wanted.
3. ~~Log in locally and open `#/wm/goods-receipt`: confirm the open-deliveries table renders and a row press resolves the delivery.~~ Done 2026-10-06 10:40 (browser, port 4005).
6. Fix Unresolved Issue 7 (delivery-item lookup fallback): find out why the `GR4PO_DL_Items(INBDELIV)` key read fails for those deliveries and stop falling back to PO-level quantities for an inbound delivery.
8. **User decision needed (12:20 entry):** how to get a batch onto inbound delivery 180000008 item 10 before the GR — (a) user sets batch IN25000333 in SAP GUI (VL32N) and the agent re-runs the 100 KG proof unchanged; (b) agent discovers an inbound-delivery change API (candidate `API_INBOUND_DELIVERY_SRV`, PATCH item batch) and proves it read→change→read first, then the GR; (c) prove the GR against the PO only (no Delivery/DeliveryItem) on 180000008 — SAP then accepts the batch, but the inbound delivery stays open and the row will not leave the table, so the cycle's last check cannot pass that way. Deliveries already carrying a batch in a non-WM SLoc (180000025, 180000033, 180000038, all HU01) reference batches missing from MCH1/MCHA and are 5,000–20,000 KG; not recommended.
7. (superseded by 8) which posting API to prove for Goods Receipt 101. Recommended: `API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentHeader` (already proven for 261 in `Mvt261Adapter.postGoodsIssue`; `creatable-services.xlsx` lists it as creatable) with `GoodsMovementCode '01'` and items carrying `PurchaseOrder`/`PurchaseOrderItem` (and `DeliveryDocument`/`DeliveryDocumentItem` for the inbound delivery) — inspect `$metadata`, prove one POST on 180000008 (400 KG), read it back, then wire the adapter. Alternative: discover the correct `GR4PO_DL_Headers` deep-insert contract (Temp_Key / item fields) from the standard Fiori app's requests. Only after that can the 400/601/600 cycle and the 102 reversals run.
5. (superseded by 7) 180000077 cannot receive a GR without a WM putaway first. Options: (a) switch the cycle to inbound delivery **180000008** / PO 400000164 item 10 (material 1000000029 "3-Pentanone", plant 1120, SLoc ST02 = not WM-managed, 1000 KG, PO 1000 KG, no history; post 400 KG → over-receive 601 KG → 600 KG; batch e.g. IN26000321), or (b) 180000018 / PO 400000228 item 10 (plant 1110, ST02 not WM-managed, delivery 1000 KG of PO 10000 KG), or (c) stay on 180000077 and create + confirm the W12 putaway transfer order first (outside this app; `TrToAdapter` only creates TOs from transfer requirements and cannot confirm). Original plan for reference — post 40 KG, then 60 KG; verify material document, EKBE 101 rows, MARD/MCHB stock +100 KG in CS02, row gone from `HMmimGr4inbdelSet`; negative tests: over-receive (e.g. 101 KG) and post to the already fully received delivery 180000021 (PO 400000230, ELIKZ = X). Reversal of the two 101 documents afterwards (102) is also the user's decision.
4. Decide how to treat the catalog export in the repo guard (exclude `srv/external/*.json` from the scan, or accept the SAP catalog entry).
9. **Handling Unit cockpit (plan pasted 2026-10-06 10:57 IST):** user/Basis to assign System Alias `LOCAL` to the 6 HU services, then re-run the AGENTS.md discovery (`$metadata` → entity sets → creatable/updatable flags → function imports → one real POST on `API_HANDLING_UNIT` read back). Plan correction before build: the services are OData V2 on this on-premise system, not V4, and the UI must call CAP (`srv/wm/...` → adapter in `srv/integration/s4hana/wm/`) rather than SAP directly; Fiori elements / V4 ODataModel against SAP does not fit this repo. **Done 2026-10-06** — read-only cockpit built (see Changes Log). Remaining: (a) log in locally and open the dashboard tile "Handling Unit Cockpit" (WM tab), confirm the list renders, a row press opens the detail with KPIs, items and the packing TreeTable; (b) decide whether `API_PACKINGINSTRUCTION` header create (metadata-creatable, not yet POST-proven) or the two FDP print services are wanted as a phase 2.

## Changes Log

### 2026-10-06 — HU Detail: Data Enrichment & Display Fixes (HU 2000019990)

- **Why:** user reported "Debug Why So many data is not display #/wm/handling-unit/2000019990/?wh=&char32=89E4C19EA7C11FE1AFDFE7B25F40387F&origin=ERP". Investigation showed: (1) `formatDateToYMD` did not parse SAP compact 14-digit timestamps (`YYYYMMDDhhmmss`), resulting in `null` Creation Date; (2) `HandlingUnitAdapter.detail` only extracted `Char32/Origin` from `C_HANDLINGUNITMONITOR_CDS`, discarding PackagingMaterialName, PackagingMaterialTypeName, StatusText, RefDocName, DeliveryDocument, etc.; (3) items were read exclusively from `API_HANDLING_UNIT`, which lacks MaterialName, Plant, StorageLocation, and Batch (all present in `C_HANDLINGUNITMONITOR_CDS/to_HandlingUnitItem`); (4) header Plant/SLoc for planned inbound HUs is unpopulated in VEKP until GR, but present on the items, so fallback from item level was needed; (5) UI dimensions panel and header statuses rendered raw `0 × 0 × 0 ` and `0 ` without units for unmaintained values instead of clean `-` fallbacks; (6) UI table had no columns for Plant/SLoc or Batch, and displayed only raw material number without description.
- **Files:** `srv/common/dateUtils.js`, `test/unit/common/dateUtils.test.js`, `srv/wm/handling-unit/service.cds`, `srv/integration/s4hana/wm/HandlingUnitAdapter.js`, `test/unit/wm/handlingUnitAdapter.test.js`, `app/fiori-app/webapp/modules/wm/handling-unit/view/HandlingUnitDetail.view.xml`, `app/fiori-app/webapp/i18n/i18n.properties`, `app/fiori-app/webapp/i18n/i18n_en.properties`.
- **Change:**
  - `srv/common/dateUtils.js`: added support for SAP compact `YYYYMMDD` and `YYYYMMDDhhmmss` date strings.
  - `srv/wm/handling-unit/service.cds`: added `MaterialName`, `Plant`, `StorageLocation`, `Batch` to `HandlingUnitItem`; added `WarehouseName`, `PackagingMaterialName`, `PackagingMaterialTypeName`, `PlantName`, `StorageLocationName`, `ShippingPointName`, `ReferenceDocumentType`, `DeliveryDocument`, `StatusText` to `HandlingUnitDetail`.
  - `HandlingUnitAdapter.js`: `detail()` now reads combined items from `C_HANDLINGUNITMONITOR_CDS/to_HandlingUnitItem` (with fallback to `API_HANDLING_UNIT`), selects full metadata from `C_HANDLINGUNITMONITOR_CDS/HandlingUnit`, falls back header Plant/SLoc to item level when blank, and maps all enriched fields.
  - `HandlingUnitDetail.view.xml`: Header now displays PackagingMaterialName/Type, ReferenceDocumentType, Status badge with semantic state, formatted Creation Date; Dimensions & capacity fields display `-` when 0; Items table adds Plant/SLoc and Batch columns, and uses `ObjectIdentifier` for Material with `MaterialName`.
  - `i18n`: added `huItemBatch=Batch` to both `i18n.properties` and `i18n_en.properties`.
- **Validation:**
  - `npx jest test/unit/common/dateUtils.test.js` → 9 passed.
  - `npx jest test/unit/wm/handlingUnitAdapter.test.js` → 13 passed.
  - `npx jest test/unit/controller/uiConsistency.test.js` → 7 passed.
  - `cd app/fiori-app && npx ui5lint "webapp/modules/wm/handling-unit/**"` → 0 findings.
  - `npx cds compile srv --to csn` → OK (exit code 0).
  - Live CAP probe on `2000019990`: returns Plant "1130", SLoc "HS01", PackagingMaterialName "Packing Box", PackagingMaterialTypeName "Boxes", Status "A", StatusText "Planned", RefDoc "180000101", RefDocType "Inbound Delivery", CreationDateTime "2026-10-03", and Item Material "8000007113", MaterialName "FMG, EL - Tantalum, SS316,#150,10MM", Plant "1130", SLoc "HS01".
  - `git diff --check` clean.
- **Result:** PASS.

### 2026-10-06 — HU cockpit: Storage Location Value Help and Excel Export

- **Why:** user requested re-check and updated report; added Storage Location value help from `C_HANDLINGUNITMONITOR_CDS/I_StorageLocationStdVH` and list Excel Export via `sap.ui.export.Spreadsheet`.
- **Files:** `srv/integration/s4hana/wm/HandlingUnitAdapter.js`, `modules/wm/handling-unit/{view,controller}/HandlingUnits*`, `i18n/i18n.properties` + `i18n_en.properties`.
- **Change:**
  - `HandlingUnitAdapter.valueHelp`: added `storagelocation` mapping to `I_StorageLocationStdVH` (`StorageLocation` / `StorageLocationName`), with key deduplication across plants.
  - `HandlingUnits.view.xml`: added `showSuggestion="true"` to `huSloc` input bound to `/vhStorageLocation`; added `Excel Export` button in header toolbar.
  - `HandlingUnits.controller.js`: added `onExport()` using standard UI5 Spreadsheet library.
- **Validation:**
  - `npx jest test/unit/wm/handlingUnitAdapter.test.js` → 12 passed.
  - `npx jest test/unit/controller/uiConsistency.test.js` → 7 passed.
  - `cd app/fiori-app && npm run lint` → 0 findings.
  - `npx cds compile srv --to csn` → OK.
- **Result:** PASS.

### 2026-10-06 — Packing Instruction CREATE unblocked (deep insert) and shipped

- **Why:** the earlier create block (`PI_RAP/003 "Incomplete data"`) is resolved. Root cause (user's ABAP trace of `CL_LO_HU_PI_MANAGE`, independently confirmed by me): a PI cannot be created header-only — SAP needs a **deep insert** with ≥1 component, at least one category `P` (load carrier/packaging). `sap:creatable="false"` on the child only blocks a standalone child POST, not composition-create via the header nav.
- **Proof I verified:** read back the user's docs **52** (`TEST_PI_DISCOVERY`) and **53** (`TEST_PI_FULL`) — both exist, created by KHUSHAL, 2 components each (item 10 `P` 2000000041; item 20 `M` 4000000002), doc 53 with 1 EN text. Then my own live create via the adapter → **doc 54** (`ZCLAUDE_PI_TEST`, UUID `89e4c19e-a7c1-1fe1-b0aa-fb053fe93880`), read back: item 10 P 1 NOS + item 20 M 7 KG + EN text. HTTP 201, persisted.
- **Contract (shipped):** header `PackingInstructionExternalName` (req) + `HandlingUnitWeightUnit`; `to_PackingInstructionComponent` (≥1, ≥1 `P`) each with `PackingInstructionItem`, `PackingInstructionItemCategory` (P|M), `Material`, `PackingInstructionItmTargetQty` (string), `BaseUnitofMeasure`/`UnitOfMeasure`; optional `to_PackingInstructionText`. Do NOT send `PackingInstructionNumber`/`LoadCarrierSystUUID` (SAP generates).
- **Files:** `PackingInstructionAdapter.js` (+CSRF `_post`, +`create` deep insert with fail-fast validation, read-back by UUID), `srv/wm/packing-instruction/service.cds` (+`PackingInstructionComponentInput`, +`create` action) + `service.js` (+binding), `modules/wm/packing-instruction/view/PackingInstructions.view.xml` (+Create button) + `view/CreatePackingInstructionDialog.fragment.xml` (new) + `controller/PackingInstructions.controller.js` (dialog open/add-row/submit; packaging F4 reuses HU `valueHelp('packaging')`), `i18n` (`piCreate*`), `test/unit/wm/packingInstructionAdapter.test.js` (create tests).
- **Validation:** `cds compile` OK; `npx jest` PI adapter (8) + uiConsistency (7) green; **live create proven (doc 54)**; `ui5lint` PI module → no findings; full `npx jest` → 2124 passed, only pre-existing `noGiQueueGuard` (Issue 6) fails; `git diff --check` clean.
- **Not validated:** browser rendering of the create dialog (needs the user's SAP login). Test docs 52/53/54 remain in client 220 (no delete API exposed).
- **Result:** PASS — PI create is proven and shipped (backend + UI). Browser verification pending.

### 2026-10-06 — Stop RFC trace-file spam (RfcClient trace off by default)

- **Why:** the project root accumulated ~38 MB of `rfc*.trc` files (plus `_noderfc.log`, `dev_rfc.log`), regenerated on every RFC connection by the NW RFC SDK's default trace. All gitignored (`.gitignore:55,57`) but cluttering the working tree.
- **Change:** `srv/integration/s4hana/RfcClient.js` `connectionParams()` now sets `trace: this.env.S4_RFC_TRACE || '0'` — trace off by default, with an env knob (`S4_RFC_TRACE=1..3`) to re-enable for debugging. Cleaned the existing `rfc*.trc` + the two logs (regenerable, gitignored, not tracked).
- **Validation (live A/B, client 220):** `RfcClient.readTable('T000',...)` with `S4_RFC_TRACE=3` → **5** new `rfc*.trc`; with the default (`'0'`) → **0** new files, and the call still returned 1 row. So the default suppresses the spam without affecting RFC behaviour.
- **Tests:** `test/unit/wm/trToAdapter.test.js` — added asserts that `connectionParams().trace` is `'0'` by default and honours `S4_RFC_TRACE` (22 passed). Full `npx jest` → 2121 passed; only the pre-existing `noGiQueueGuard` (Issue 6) fails. `git diff --check` clean.
- **Result:** PASS. `.trc` files no longer generated by the app.

### 2026-10-06 — HU round 4: Packing-Instruction read-only UI + HUMO KPI cards (create gated, print deferred)

- **Why:** user chose all four follow-ups; live re-checks decided what is buildable. Built the two provable items; documented the two blockers.
- **Packing Instruction read-only UI (new, shipped):** module `app/fiori-app/webapp/modules/wm/packing-instruction/` — list (`PackingInstructions`) with external-name filter + object page (`PackingInstructionDetail`) showing header specs, Components table and Texts list; dashboard WM tile "Packing Instructions"; routes `wmPackingInstructions` / `wmPackingInstructionDetail`, App.controller hash/title/back cases. Backed by the existing read-only CAP service (no backend change). Page is header-less (ShellBar owns title/back).
- **HUMO KPI cards (shipped):** new CAP `statusKpis()` → `HandlingUnitAdapter.statusKpis()` (status value-help for code→name, then one `$count` per status + total via `getText` on `/$count`). A GenericTile row above the HU filter bar (Total + one tile per status). **Live:** Total 17462; A Planned 1124 / B Active 7588 / C Shipped 8668 / D Deleted 0 / T In Transit 82.
- **PI create — GATED (not built):** still `PI_RAP/003 "Incomplete data"`; pending the standard "Manage Packing Instructions" app's POST body or the BDEF mandatory fields. When provided: re-add `createHeader` (CSRF POST + read-back) + CAP `create` action + create dialog, prove live first.
- **Print — DEFERRED (not built, evidence):** packing-list FDP → HTTP 501 on `Delivery`, 0 rows on `HandlingUnit`; shipping-label FDP returns our HUs as records but the label fields (`MatrixBarcodeNorm4994Value`, addresses) are blank for these LE HUs (the populated flow needs an EWM warehouse they lack). Building print would yield empty output. Revisit only for EWM HUs with a warehouse (parameterized `Query` + client/ADS PDF).
- **Validation:** `cds compile` OK; `npx jest` HU+PI+uiConsistency → 25 passed (incl. new `statusKpis` test); live `statusKpis` + PI `list`/`get` proven; `ui5lint` PI+HU+Dashboard → no findings; full `npx jest` → 2120 passed, only pre-existing `noGiQueueGuard` (Issue 6) fails; `git diff --check` clean.
- **Not validated:** browser rendering (needs the user's SAP login). **In Progress.**
- **Result:** PI read-only UI + KPI cards PASS (backend + static); create gated; print deferred. Browser verification pending.

### 2026-10-06 — HU round 3: Excel export + Storage-Location F4; Packing-Instruction read (create BLOCKED); print spike

- **Why:** a re-pasted gap report; most items were already done, so this round = the two remaining read-only gaps (A), a packing-instruction create attempt (B), and a print feasibility spike (C).
- **Part A (done):** Excel export on the HU list (`onExport` + `sap.ui.export.Spreadsheet`, copied from `Open261`) and a **Storage Location F4** (`I_StorageLocationStdVH`; `valueHelp` now dedupes by key → 82 distinct live). Files: `HandlingUnitAdapter.js` (VALUE_HELP + dedupe), `HandlingUnits.view.xml`/`.controller.js`, `i18n` (`huExport`, `huExportFile`).
- **Part B — read PROVEN, create BLOCKED:**
  - Read-only backend built + proven live: `PackingInstructionAdapter` (`list`, `get` with components/texts) + CAP `PackingInstructionService` (`/odata/v4/packing-instruction`, `list`/`get`). Live: 101 PIs; `get` returns header + 2 components + 1 text. 8 unit tests.
  - **Create cannot be proven and is NOT shipped.** With the user's go-ahead, a live POST of `PackingInstructionHeader` (client 220) was attempted with every informed payload — `{ExternalName}`, `+HandlingUnitType 'E1'`, `+units (KG/HL/CM)`, `+external PackingInstructionNumber`, `+LoadCarrierSystUUID` — **all returned HTTP 400 `PI_RAP/003` "Incomplete data"** with no target field named. **Nothing was created in SAP** (400s persist nothing). The required RAP field set is not discoverable from the service metadata or the generic error, so per AGENTS.md the create action/handler/adapter method were removed; only read is exposed. To unblock: capture the actual request body the standard "Manage Packing Instructions" Fiori app sends, or get the RAP BDEF mandatory fields from SAP; then re-prove POST→read-back before any UI.
  - No PI **UI** was built (the ask was create, which is blocked). The read backend stands ready for a read-only PI list/detail if wanted.
- **Part C (print spike — finding):** `FDP_HU_SHIPPINGLABEL_SRV` and `FDP_LOHUM_HU_PACKINGLIST_SRV` have **no stream/media entity, no FunctionImport, no `/Result` set, no `application/pdf`**. The `Query` entity (keys Warehouse/Language/HandlingUnitNumber) returns label *data* (barcode value, address lines, packaging text), not a PDF. **There is no OData path to an SAP-rendered PDF here.** Options if print is still wanted: render our own PDF from the data (new client dep; not SAP's official label), or integrate ADS/output management outside this app. Not built.
- **Validation:** `cds compile` OK; `npx jest` targeted → 24 passed (PI 8, HU 12, uiConsistency); full `npx jest` → 2119 passed, only pre-existing `noGiQueueGuard` (Issue 6) fails; `ui5lint` HU module → no findings; `git diff --check` clean; PI read re-confirmed live (101).
- **Result:** Part A PASS; Part B read PASS / create BLOCKED (reported, not shipped); Part C investigated + documented. Browser verification of Part A pending (user login).

### 2026-10-06 — HU cockpit bug fixes + read-only polish

- **Why:** a pasted debug/gap report flagged bugs + gaps. Verified each claim against the actual code and live SAP; fixed the 5 real bugs and added the read-only completeness that is provable now (user-approved scope). Print (FDP) and packing-instruction create stay deferred (unproven write/PDF paths).
- **Verified bugs fixed:**
  1. Back-nav from the detail page went to Dashboard — added the `wmHandlingUnitDetail → wmHandlingUnits` case in `controller/App.controller.js onNavButtonPressed`. (Back is owned by the ShellBar per the `uiConsistency` convention; the detail page stays header-less and the orphaned `onNavBack` was removed, not wired to a page button.)
  2. (same as 1 — the project pattern is ShellBar-owned back, so no page header was added.)
  3. Packing tree was empty on a direct link / F5 — `HandlingUnitAdapter.detail()` now resolves `HandlingUnitIDChar32` + `HandlingUnitOrigin` from `C_HANDLINGUNITMONITOR_CDS` and returns them; the detail controller uses the resolved id (query value still preferred when present).
  4. Heavy unfiltered entry (5 serial calls / up to 1000 rows every visit) — the list no longer auto-queries on route match without a filter; it shows "enter a filter" and waits. Manual Go with no filter still allowed.
  5. `" / "` artifact in the items reference cell — guarded (shows `ref`, appends `/ item` only when present, else `-`).
- **Read-only polish:**
  - Detail view now shows the dimensions/capacity the adapter already returned (L×W×H, max weight/volume, net/tare volume, shipping point) and a Shelf-Life Expiration column on the items table.
  - TreeTable Expand All / Collapse All buttons.
  - F4 type-ahead on the filter bar — new CAP `valueHelp(kind)` + adapter method over the 4 monitor value-help sets; added Status + Shipping Point as list filters (adapter + CAP `list` params) so all four F4s are usable.
- **Files:** `srv/integration/s4hana/wm/HandlingUnitAdapter.js`, `srv/wm/handling-unit/service.cds`, `srv/wm/handling-unit/service.js`, `controller/App.controller.js`, `modules/wm/handling-unit/{view,controller}/HandlingUnits* + HandlingUnitDetail*`, `i18n/i18n.properties` + `i18n_en.properties`, `test/unit/wm/handlingUnitAdapter.test.js`.
- **One self-inflicted bug caught in validation:** `valueHelp` uppercased then lowercased the kind, so camelCase `shippingPoint` missed the map → fixed by lowercasing the map key and kind; regression test added.
- **Validation:**
  - `npx cds compile srv --to csn` → OK (`key` is reserved in CDS → declared as `![key]`).
  - `npx jest test/unit/wm/handlingUnitAdapter.test.js` → **12 passed**; `uiConsistency` → passed (page adds no title/back — ShellBar owns it).
  - **Live (read-only, client 220):** `detail('1000000000')` with no warehouse/char32 → returns char32 `005056B4…`, follow-up `hierarchy` → 2 nodes (deep-link fix proven); `valueHelp` plant 30 / packaging 219 / status 5 / shippingPoint 60; `list({status:'B'})` → 7,584; shipping-point data present (HU 2000000000 → SP 1120).
  - `npx ui5lint` on the whole HU module + App/Dashboard controllers → no findings.
  - Full `npx jest` → 2114 passed; only the pre-existing `noGiQueueGuard.test.js` (Issue 6) fails, unrelated.
  - `git diff --check` clean.
- **Not validated:** browser rendering (needs the user's SAP login). **In Progress.**
- **Result:** PASS (backend + static); browser verification pending.

### 2026-10-06 — HU cockpit data double-check + dead-field removal

- **Why:** user reported "so many data is not proper or not coming." Verified field population live before changing anything.
- **Evidence (live, read-only, all 17,440 HUs):** `GrossWeight>0` = **16,155 (93%)**; `Plant` = 965; `StorageLocation` = 679; `Warehouse` = **0/17,440** (these are LE/inventory HUs, not EWM); `StorageType`/`StorageBin` always blank in the monitor and **not filterable** (`CX_SADL_ELEMENT_OP_NOT_IMPLMTD`); `PackagingMaterial` = 17,440/17,440; status A(Planned) 1,119 / B(Active) 7,574 / C 8,665. The default newest-first order surfaced the empty "Planned" HUs first, which is what looked like "no data". Filtered read `list(plant 1120, sloc FG01)` → 25 fully-populated HUs; detail → item `4000000033` 200 KG; tree L0 pkg `2000000083` → L1 product `4000000033` 200 KG batch `PMEP250127`. Mapping is correct; data flows.
- **Files (modified):** `app/fiori-app/webapp/modules/wm/handling-unit/view/HandlingUnits.view.xml` (removed the always-blank Warehouse filter input and the dead "Warehouse / Bin" column; added a "Created" column; Plant/Sloc now shows `-` for blanks), `.../view/HandlingUnitDetail.view.xml` (dropped the blank Warehouse/Bin header attribute), `i18n/i18n.properties` + `i18n/i18n_en.properties` (removed `huWarehouse`, `huColWarehouseBin`; added `huColCreated`). The `warehouse` param stays in the adapter/CAP (valid for EWM systems, always `''` here).
- **Validation:** `npx ui5lint` on both views → no findings; `npx jest test/unit/controller/uiConsistency.test.js test/unit/wm/handlingUnitAdapter.test.js` → 14 passed; full `npx jest` → 2109 passed (same pre-existing Issue 6 failure); `git diff --check` clean.
- **Result:** PASS. The cockpit now shows only fields this system populates; sparse Plant/Sloc is real SAP state, not a bug.

### 2026-10-06 — Read-only Handling Unit cockpit (backend + UI)

- **Why:** user approved option (1) — a read-only HU cockpit on the three V2 read services (the write path does not exist; `API_HANDLING_UNIT` is read-only here, proven in the discovery entry below).
- **Files (new):** `srv/integration/s4hana/wm/HandlingUnitAdapter.js`, `srv/wm/handling-unit/service.cds`, `srv/wm/handling-unit/service.js`, `test/unit/wm/handlingUnitAdapter.test.js`, `app/fiori-app/webapp/modules/wm/handling-unit/{view,controller}/HandlingUnits*.{xml,js}` + `HandlingUnitDetail*.{xml,js}`.
- **Files (modified):** `srv/service.cds` (one `using`), `app/fiori-app/webapp/manifest.json` (2 routes + 2 targets), `controller/App.controller.js` (shell hash + title), `controller/Dashboard.controller.js` + `view/Dashboard.view.xml` (WM tile), `i18n/i18n.properties` + `i18n/i18n_en.properties` (`hu*` texts).
- **Change:** CAP `HandlingUnitService` at `/odata/v4/handling-unit`, roles Viewer/WarehouseClerk/WarehouseManager/Admin, three **read-only** functions: `list` (C_HANDLINGUNITMONITOR_CDS, paged, $filter by plant/sloc/warehouse/packaging/HU id, capped 1000), `detail` (API_HANDLING_UNIT header + `to_HandlingUnitItem`), `hierarchy` (UI_HANDLINGUNITHIERNODE node set → flat rows). Adapter validates every input with strict patterns before the $filter/key. No entities, no create/update/delete. UI: filter-bar list → object-page detail with weight/volume KPIs, items table and a packing TreeTable (flat parent/child nested in the controller).
- **Validation:**
  - `npx cds compile srv --to csn` → OK.
  - `npx jest test/unit/wm/handlingUnitAdapter.test.js` → **7 passed** (list mapping + filter build + 400 injection guard; detail header/items + 404 + 400; hierarchy tree + 400).
  - **Live adapter read (read-only, client 220):** `node -e` driving the adapter → LIST 17,440 HUs (returned 1000, Truncated), first `2000020121`; DETAIL `2000020121` → 1 item material `8000006485` 1 NOS; HIERARCHY 2 nodes (L0 pkg `2000000340` → L1 product `8000006485`). Full chain works through the adapter code.
  - `npx ui5lint` on the 4 new UI files → **no findings** (TreeTable uses `rowMode="Auto"`, not the deprecated `visibleRowCountMode`).
  - `npx jest` (full) → 2109 passed; the single failure is the pre-existing `noGiQueueGuard.test.js` (Unresolved Issue 6), unrelated to this change.
  - `git diff --check` clean.
- **Not validated:** rendering in a browser — the app redirects to `#/login`, which needs SAP credentials the agent must not enter. **In Progress.**
- **Result:** PASS (backend + static); browser verification pending.

### 2026-10-06 (discovery) — HU services unblocked; API_HANDLING_UNIT is READ-ONLY (no file change)

- **Why:** user reported a System Alias was assigned. Ran the AGENTS.md discovery against live `$metadata` (GET only) to establish real capability, not trust the earlier pasted "creatable: YES" table.
- **Evidence (live, read-only GET, client 220):**
  - All 6 HU services now return `$metadata` **HTTP 200** (alias assigned to all, not only `API_PACKINGINSTRUCTION` as the user's status showed).
  - `API_HANDLING_UNIT` = **OData V2** service `cds_api_handling_unit`. Only **2** entity sets: `HandlingUnit`, `HandlingUnitItem` (NOT the 4 in the pasted table — no `HandlingUnitAlternativeId`, no `HandlingUnitItemSerialNumber`). BOTH `sap:creatable="false" sap:updatable="false" sap:deletable="false"`. Zero `sap:creatable="true"` anywhere. **Zero FunctionImports** → none of the pasted actions (`MoveHandlingUnits`, `RepackHandlingUnitHeader/Item`, `LoadHandlingUnit`, `ReverseHandlingUnitLoading`) exist here. Only nav `to_HandlingUnitItem`. → **Fully READ-ONLY on this system.**
  - `API_PACKINGINSTRUCTION` = OData V2 `cds_api_packinginstruction`. 3 entity sets: `PackingInstructionHeader` (no `sap:creatable` attr → V2 default = creatable **true**), `PackingInstructionComponent` (`sap:creatable="false"`), `PackingInstructionText` (`sap:creatable="false"`). Zero FunctionImports. → Only the **Header** is metadata-creatable; the pasted claim that Components/Text are creatable via composition is **false**. Metadata-creatable is necessary but NOT proven (AGENTS.md requires a real POST read-back).
- **Result:** The pasted "Summary Table / Detailed Verification" describes the S/4 **Cloud RAP V4** API (BDEF `A_HANDLINGUNIT_2`); this **on-premise** system exposes only the classic **V2 read** projection. A write-capable HU cockpit (create/update/delete/actions) CANNOT be built on `API_HANDLING_UNIT` as exposed. Options: (a) build a **read-only** HU monitor/display app on the V2 services (valid, low-risk), or (b) discover whether a transactional HU API (V4 RAP `/sap/opu/odata4/...`, or a BAPI/RFC such as a HU creation function) is available on this system before any write feature. Issue 9 updated.

### 2026-10-06 (re-check) — Handling Unit services still blocked (no file change)

- **Why:** user pasted a creatable-capability summary table for the 6 HU services; AGENTS.md requires proving capability from live `$metadata`/POST, not an assumed table. Re-verified the blocker before accepting any of it.
- **Evidence (live, read-only GET, client 220):** `$metadata` for all 6 HU services (`C_HANDLINGUNITMONITOR_CDS`, `UI_HANDLINGUNITHIERNODE`, `API_HANDLING_UNIT`, `API_PACKINGINSTRUCTION`, `FDP_HU_SHIPPINGLABEL_SRV`, `FDP_LOHUM_HU_PACKINGLIST_SRV`) → HTTP **500**. `API_HANDLING_UNIT` body: `CM_COS/064` "No System Alias found for Service 'ZAPI_HANDLING_UNIT_0001' and user 'KHUSHAL'".
- **Result:** Unchanged from the 2026-10-06 10:57 entry. The pasted table cannot be validated against this system. Issue 9 stays **Blocked**; no entity set, creatable flag, action or deep-insert payload can be confirmed until Basis assigns a System Alias in `/IWFND/MAINT_SERVICE`.

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

### 2026-10-06 10:20 IST — Goods Receipt: open inbound deliveries shown as a direct list

- **Trigger:** user request "`/index.html#/wm/goods-receipt` — here I want to show direct list".
- **Files:** `app/fiori-app/webapp/modules/wm/goods-receipt/view/GoodsReceipt.view.xml`, `.../controller/GoodsReceipt.controller.js`, `app/fiori-app/webapp/i18n/i18n.properties`, `app/fiori-app/webapp/i18n/i18n_en.properties` (`grOpenDeliveriesTitle`, `grListColDelivery`, `grListColPlant`), `test/unit/wm/goodsReceiptController.test.js`.
- **Change:** the "Or select open Inbound Delivery" `Select` dropdown is replaced by a `sap.m.Table` (`tblOpenDeliveries`) bound to the already loaded `grView>/openDeliveries` (columns: Inbound Delivery + PO, Material & Description, Supplier, Plant; growing 50; refresh button). Row press (`onSelectInboundDelivery`) now reads `DeliveryDocument` from the row's binding context and runs the unchanged `onScanStorageUnit` lookup. New handler `onRefreshDeliveries` re-calls `_loadOpenDeliveries`. Scan input, camera, value help, details panel and posting are untouched. No backend or service change.
- **Validation:**
  - `npx jest test/unit/wm/goodsReceiptController.test.js test/unit/controller/uiConsistency.test.js` → 2 suites, 27 tests passed (dropdown test rewritten for the row-press event).
  - `cd app/fiori-app && npx ui5lint "webapp/modules/wm/goods-receipt/**"` → no findings.
  - `npx eslint` on the test file → clean (the controller is in the ESLint ignore list, as before).
  - `git diff --check` → clean.
  - `npm test` (full) → 130 suites passed, 1 failed; 2,102 tests passed, 1 failed. The failure is `test/unit/guard/noGiQueueGuard.test.js` (Unresolved Issue 6, pre-existing, unrelated).
  - Local OData read (`GET /odata/v4/goods-receipt/OpenInboundDeliveries?$top=2`, mocked user, running `cds watch` on port 4004) → HTTP 200 with populated DeliveryDocument, Material, MaterialName, SupplierName, Plant, so the table has live data to show.
- **Not validated:** browser rendering of `#/wm/goods-receipt` — the app redirects to `#/login`; `LOCAL_DEV_PASSWORD` is not set, so the mock users are disabled, and the agent must not enter the user's S/4 credentials. **In Progress.**

### 2026-10-06 10:40 IST — GR cycle test: candidate found and table/lookup verified in the browser (no code change, read-only in SAP)

- **Trigger:** user request "Find First" + 6-step GR 101 cycle test plan (pick open PO line → check it is in the open-deliveries table → row press fills details → post partial + remainder → verify → negative tests).
- **Files:** none in the repo. `.claude/launch.json` (gitignored) got a `cap-dev-4005` entry that starts `cds watch` on port 4005 with `LOCAL_DEV_PASSWORD` read from a session scratchpad file (random value generated this session, never the user's S/4 password; not stored in the repo). Read-only scratch scripts in the session scratchpad (adapter `getOpenInboundDeliveries` / `resolveStorageUnit` / `getMaterialBatches` + `RfcClient.readTable` on LIPS, LIKP, EKPO, EKET, EKBE, MARA, MARC, MARD, MCHA, MCHB).
- **Step 1 — open PO lines (read-only, live SAP client 220):** the table source `MMIM_GR4PO_DL_SRV/HMmimGr4inbdelSet` ($top=50) returns 25 rows. Every material in the list is batch-managed (MARA/MARC XCHPF = X) and all but three use split valuation (MARC BWTTY = X); all are stock items (EKPO KNTTP blank, PSTYP 0 except two STO lines 6100000051/6100000055 with PSTYP 7). Three rows are already fully received (EKPO ELIKZ = X: PO 400000011/10, 400000230/10, 300002022/10) but still listed by SAP as "open" inbound deliveries. Delivery status LIPS WBSTA = A for 24 rows (blank for 180000006).
- **Chosen candidate:** inbound delivery **180000077** item 10 → PO **400000342** item 10, material **1000001002** "TEST RM -HU", plant **1130**, SLoc **CS02**, 100 KG, no batch on the delivery, no PO history (EKBE empty), EKET WEMNG 0, ELIKZ blank. Baseline before posting: MARD 1130/CS02 unrestricted **300 KG** (all in batch IN26091921, MCHB); batches in plant 1130 (MCHA): INW2109001, IN26091921, INW2909001 (no SLED). Chosen because it is the smallest clean line (100 KG allows partial 40 + 60), has a storage location, and the batch IN26091921 already exists in the plant with stock.
- **Step 2 — table (browser):** `http://localhost:4005/saps4hana-fiori-app/index.html#/wm/goods-receipt` after mock login (`alice`): "Open Inbound Deliveries (25)" renders; row `180000077 / PO 400000342 / 1000001002 TEST RM -HU / Dynamic Mercantile Private Limited / 1130` present. **PASS.**
- **Step 3 — row press (browser):** pressing the row ran the lookup: status "Entry successfully validated"; details show Inbound Delivery 180000077 (Item 000010), PO 400000342 (Item 00010), supplier Dynamic Mercantile Private Limited (Mumbai), material 1000001002 TEST RM -HU, plant 1130 - Ascend, SLoc CS02 - Raw Material, batch defaulted to IN26091901 (first entry of the LO_BM_BATCH_SRV list; IN26091921 is selectable), SLED "No Expiry Date", quantity 100 KG / Open 100 KG. **PASS** (same fields as the old dropdown path; `resolveStorageUnit('180000077')` at adapter level returns the same values).
- **Observation (pre-existing, not caused by the table change):** for deliveries whose `GR4PO_DL_Items(INBDELIV)` key read fails (e.g. 180000060, 180000035, 180000003), `resolveStorageUnit` falls back to PO-level data: open quantity = PO open quantity (180000060 → 9000 KG instead of the delivery's 1000 KG), SLoc empty, delivery batch not shown. 180000077 is not affected.
- **Steps 4–6 — NOT executed.** Posting 101 creates real material documents and stock in SAP; waiting for the user's explicit go-ahead (Next Step 5). Planned: post 40 KG then 60 KG on 180000077 with batch IN26091921 via the UI (`postGoodsReceipt` → `GR4PO_DL_Headers`), then read back MSEG/EKBE/MARD/MCHB and re-read `HMmimGr4inbdelSet`; negative: 101 KG over-receive on a fresh line, and a post against 180000021 (ELIKZ = X).
- **Validation run:** none required (no repo change). `git status` → clean apart from this file. Port-4004 `cds watch` started by the user at 10:15 was left untouched.

### 2026-10-06 10:55 IST — GR cycle test: preflight for the reviewer's four conditions (no code change, read-only in SAP)

- **Trigger:** user pasted a reviewer's reply ("go, with four conditions"; the go itself is the user's to give) — conditions: non-prod client, over-receive test mid-cycle with EKPO UEBTO checked, closed-delivery test on 180000021, reversal decision; plus logging the 180000060 lookup gap as its own issue.
- **Files:** `WORKSTATUS.md` only (Unresolved Issue 7 added, Next Steps 5/6 updated).
- **Condition 1 — client:** `T000` for the configured client 220 → MTEXT "Pre-Test", CCCATEGORY **T** (test client), CCCORACTIV 2. **Non-production confirmed.**
- **Condition 2 — tolerance:** `EKPO 0400000342/00010` → MENGE 100, UEBTO 0.0, UNTTO 0.0, UEBTK blank, WEPOS X, ELIKZ blank. No over-delivery tolerance, so after 40 KG any post above 60 KG must be rejected by SAP; planned over-receive quantity 61 KG (small and still beyond the open quantity). Order: 40 KG → over-receive 61 KG (expect error, no document) → 60 KG.
- **Condition 3 — closed delivery:** `EKPO 0400000230/00010` → ELIKZ **X**, 1000 of 1000 received (EKBE 101 5000003739/2026 after 101/102 pairs). Delivery 180000021 is still listed in `HMmimGr4inbdelSet`. Expect SAP error and no document.
- **Condition 4 — reversal:** `GoodsReceiptAdapter` has no reversal. `Mvt261Adapter.reverse(doc, year)` calls the standard `API_MATERIAL_DOCUMENT_SRV/Cancel` action (document-agnostic; writes the reversal movement and SMBLN). Not yet proven live in this repo (the 261 document 4900050046 is still unreversed by user decision). If the user chooses to reverse, the two 101 documents will be cancelled with it (SAP posts 102) and the result read back from `A_MaterialDocumentItem`, EKBE, MARD/MCHB and `HMmimGr4inbdelSet`.
- **Lookup gap:** logged as Unresolved Issue 7 (not part of this cycle).
- **Verification plan after every post (per reviewer):** material document number returned; EKBE shows 101 for PO 400000342/10; MARD 1130/CS02 300 → 340 → 400 KG and MCHB batch IN26091921 the same; `HMmimGr4inbdelSet` / `GR4PO_DL_Items` open 60 KG after the first post and the 180000077 row gone after the second.
- **Steps 4–6 still NOT executed** — waiting for the user's own "Go" (the pasted message explicitly leaves it to the user).

### 2026-10-06 11:15 IST — GR cycle test: user "Go" received, first post HALTED on SAP error VLA 307 (no document created, no code change)

- **Trigger:** user: "Go. Non-prod confirmed. Reverse both documents after verification." plus the reviewer's run notes (stop on any surprise; first 102 is a live proof; reverse the 60 KG document first).
- **Files:** `WORKSTATUS.md` only. Read-only scratch scripts in the session scratchpad (`verify.js` snapshot, `putaway-facts*.js`, `alt-candidates.js`).
- **Baseline before the post (`verify.js`):** EKBE 0400000342/00010 0 rows; EKET WEMNG 0; EKPO ELIKZ blank; MARD 1130/CS02 unrestricted 300 KG, MCHB IN26091921 = 300 KG; LIPS 180000077/10 WBSTA A, 100 KG; `HMmimGr4inbdelSet` 25 rows incl. 180000077.
- **Step 4, post 1 (UI, port 4005, user alice):** row press on 180000077 → batch set to IN26091921 (sap.m.Select, keyboard), quantity 40 KG, "Post Goods Receipt (101)" → confirm Yes. Result dialog: **"Goods Receipt Failed: … Posting Goods Receipt for Inbound Delivery '180000077' via MMIM_GR4PO_DL_SRV failed in SAP Gateway (Client 220): Putaway quantity cannot be less than GR posted quantity: 180000077/000010."** The UI showed the SAP error cleanly (no document number, no success state).
- **After the failed post (`verify.js`):** identical to the baseline — EKBE 0 rows, WEMNG 0, MARD 300 KG, MCHB 300 KG, 180000077 still open. **Nothing was posted in SAP.**
- **Error classification (AGENTS.md §7):** SAP business error, message **VLA 307** (found in T100). Facts: T320 maps plant 1130 / SLoc CS02 → warehouse **W12**; LIKP 180000077 has LGNUM W12, KOSTK (putaway status) **A** = not started, LVSTK A, WBSTK A; LTAK has no transfer order for the delivery. For a WM-managed inbound delivery SAP only allows a GR quantity ≤ the put-away quantity, which is 0 here. The same applies to every listed delivery into a W-managed SLoc (T320: 1110/CS01→W10; 1120/CS01, CS02, FG01→W01; 1130/CS01, CS02→W12; 1600/CS02→W01; 2100/CS01→W26). Not WM-managed: 1110/ST02, 1120/ST02, 1120/HU01, 1130/HU01. Pre-existing posting behaviour; the table change did not touch posting.
- **Halt per the run note ("stop on any surprise"):** the cycle was not continued, no alternative was posted.
- **Alternatives baselined (read-only):**
  - **180000008** / PO 400000164 item 10, material 1000000029 "3-Pentanone", plant 1120, SLoc **ST02 (not WM-managed; LIKP LGNUM blank, KOSTK blank)**, delivery 1000 KG = PO 1000 KG, UEBTO 0, ELIKZ blank, EKBE empty, WEMNG 0; batch-managed, split valuation; no MARD/MCHB row for ST02 yet (stock 0); existing batches in plant 1120 include IN26000321. Recommended replacement: post 400 → over-receive 601 (expect rejection) → 600; full receipt closes the PO line and drops the row.
  - **180000018** / PO 400000228 item 10, material 1000000236, plant 1110, SLoc ST02 (not WM-managed), delivery 1000 KG of PO 10000 KG, UEBTO 0, EKBE empty; one batch IN25000345 in plant 1110; MARD ST02 absent.
- **Tooling note:** `RfcClient.readTable('LIPS', …)` fails with AD 718 as soon as PIKMG/LGNUM/LVSTA/PSTYV are requested together; LFIMG/VRKME/LGORT/WERKS/CHARG/MTART/POSNR/WBSTA/KOSTA work. Not investigated further.
- **Validation:** `git diff --check` clean; `git status` → only `WORKSTATUS.md` modified. Browser: error dialog closed, form reset not pressed (180000077 still loaded).

### 2026-10-06 11:45 IST — GR cycle test, option 1 (180000008): first post HALTED on MBND_CLOUD 002, posting path found unproven (no document created, no code change)

- **Trigger:** user: "Go with Option 1, delivery 180000008. Non-prod confirmed. Run the checks above first, then reverse both documents after verification."
- **Files:** `WORKSTATUS.md` only (Unresolved Issue 8, Next Step 7). Scratchpad scripts: `verify.js` (retargeted), `me006-facts.js`, `vgbel.js`, `t100.js`, `tempkey-probe.js` — all read-only.
- **Checks first (read-only):** client 220 = T "Pre-Test" (10:55 entry); EKPO 0400000164/00010: 1000 KG, UEBTO 0.0, UEBTK blank, ELIKZ blank, KNTTP blank, PSTYP 0; EKET WEMNG 0; EKBE 0 rows; LIKP 180000008: LGNUM blank, KOSTK blank, WBSTK A (not WM-relevant); LIPS item 10: 1000 KG, SLoc ST02, VGBEL 0400000164/000010; T320 1120/ST02 → no warehouse; MARA/MARC XCHPF X, BWTTY X; MARD/MCHB 1120/ST02: no rows (stock 0). `HMmimGr4inbdelSet` contains 180000008; `GR4PO_DL_Items(INBDELIV)` returns open 1000 / ordered 1000 KG, SLoc ST02.
- **Steps 2–3 (browser, port 4005, alice):** Reset form → row press on 180000008 → details: delivery 180000008 item 000010, PO 400000164 item 00010, material 1000000029 "3-Pentanone", plant 1120, SLoc ST02, supplier ISSGF India Private Limited, quantity 1000 / open 1000 KG, default batch IN25000333 (exists in MCHA plant 1120; 50 batches offered). **PASS.** Batch left at IN25000333 (chosen batch for the cycle instead of the example IN26000321).
- **Step 4, post 1:** quantity 400 KG (note: cmd+A in the number field appends instead of replacing — cleared with Backspace; model confirmed Quantity "400", Batch IN25000333, SLoc ST02 before posting) → Post Goods Receipt (101) → Yes. Result: **"Goods Receipt Failed: … Posting Goods Receipt for Inbound Delivery '180000008' via MMIM_GR4PO_DL_SRV failed in SAP Gateway (Client 220): Purchase order 0001800000 was already changed."**
- **After the failed post (`verify.js`):** EKBE 0 rows, WEMNG 0, ELIKZ blank, no MARD/MCHB row, LIPS WBSTA A, 180000008 still in the open list. `ENQUE_READ`: 0 locks. **Nothing was posted.**
- **Error classification:** SAP message **MBND_CLOUD 002** "Purchase order &1 was already changed" (T100). `&1` = 0001800000: not the delivery's PO (LIPS VGBEL = 0400000164), and `EKKO` has no PO 0001800000. EKKO 0400000164: type ZIMP, last changed 2025-12-19, no release strategy, STATU 9. So the backend is working with a document number the adapter never sent as a PO — a payload/contract problem in the `GR4PO_DL_Headers` deep insert, not a PO state problem. Halted per the run note; no retry.
- **Discovery (read-only):** `GR4PO_DL_Headers(InboundDelivery='180000008'|'0180000008',SourceOfGR='INBDELIV')` and `(…='400000164',SourceOfGR='PURORD')` all return a header with empty InboundDelivery/SourceOfGR/Temp_Key and no items; `$filter` on the set returns nothing. `$metadata` GET returned HTTP 406 through the shared client (Accept header), not inspected. Old work log (b741337^) has no record of a successful POST on this service — only item/header GET reads. **The GR posting path was never proven live** (AGENTS.md "Prove CREATE directly against SAP" not done); the earlier VLA 307 on 180000077 came from SAP's delivery checks before the same contract problem could surface.
- **Not done:** over-receive test, remainder post, closed-delivery test (180000021), reversals — all depend on a working first post.
- **Validation:** `git diff --check` clean; `git status` → only `WORKSTATUS.md`. Browser: error dialog closed; 180000008 still loaded in the form; port-4005 server still running.

### 2026-10-06 12:20 IST — GR 101 proof on `API_MATERIAL_DOCUMENT_SRV`: metadata read, one POST rejected with VLA 317 (no document created, no code change)

- **Trigger:** user: "Go with Option 1. Read the metadata first, then prove one 100 KG 101 post on 180000008 and reverse it straight away. Wire the adapter and add tests only after that proof succeeds. Non-prod confirmed. Same halt rules apply."
- **Files:** `WORKSTATUS.md` only. Scratchpad scripts: `matdoc-meta.js` (read-only), `prove-gr101.js` (one POST attempt + Cancel path, stops at first failure), `batch-facts.js` (read-only).
- **Metadata (`API_MATERIAL_DOCUMENT_SRV/$metadata`, read-only):** `A_MaterialDocumentHeader` is creatable (only `updatable`/`deletable` = false; 14 properties incl. `GoodsMovementCode`, `PostingDate`, `DocumentDate`, `MaterialDocumentHeaderText`, `ReferenceDocument`); `A_MaterialDocumentItem` is `creatable="false"` as a set (items go in via deep insert `to_MaterialDocumentItem`) and has 86 properties incl. `PurchaseOrder`, `PurchaseOrderItem`, `Delivery`, `DeliveryItem`, `GoodsMovementRefDocType`, `Batch`, `StorageLocation`, `GoodsMovementType`, `EntryUnit`, `QuantityInEntryUnit`, `GoodsMovementIsCancelled`, `ReversedMaterialDocument`; function imports `Cancel`, `CancelItem`.
- **Payload (built with the proven `buildHeaderEnvelope`/`buildBaseItem` from `goods-issue/s4common.js`, same as the 261 posting):** header `GoodsMovementCode '01'`, posting/document date today, text "GR101 proof IBD 180000008"; one item: Material 1000000029, Plant 1120, StorageLocation ST02, Batch IN25000333, GoodsMovementType 101, EntryUnit KG, QuantityInEntryUnit 100, GoodsMovementRefDocType B, PurchaseOrder 400000164, PurchaseOrderItem 10, Delivery 180000008, DeliveryItem 10.
- **Result:** `POST A_MaterialDocumentHeader` → **HTTP 400 — "Inbound delivery batch cannot be changed to IN25000333 here"** = SAP message **VLA 317** (T100). No material document. Snapshot after = snapshot before (EKBE 0, WEMNG 0, no MARD/MCHB row, LIPS WBSTA A, delivery still in the open list). Reversal step not reached. Halted per the run rules; no second attempt.
- **Meaning:** a GR posted with reference to an inbound delivery takes the batch from the delivery item (LIPS-CHARG); 180000008/10 has no batch (and the material is batch-managed), so SAP refuses a batch supplied at GR time. The same would hit the old `MMIM_GR4PO_DL_SRV` path for every listed delivery without a batch. The UI's batch picker therefore cannot work for inbound-delivery GRs of batch-managed materials unless the batch is written to the delivery first. The API path itself got through PO/delivery resolution (the error is a delivery-content check, not a contract error like MBND_CLOUD 002 earlier).
- **Alternatives checked (read-only):** non-WM deliveries that already carry a batch: 180000025 (1120/HU01, THF2627001, 5,000 KG, PO UEBTO 5 %), 180000033 (1130/HU01, INHU100002, 10,000 KG), 180000038 (1130/HU01, IN26091820, 20,000 KG, putaway status C). All three batches are missing from MCH1 and MCHA, so a GR would also have to create the batch; quantities are large. Not recommended as the proof candidate.
- **Validation:** `git diff --check` clean; `git status` → only `WORKSTATUS.md`. SAP unchanged. Browser session and port-4005 server still up.

### 2026-10-06 10:57 IST — Handling Unit app plan: SAP discovery (no file change except this log)

- **Trigger:** user pasted a plan for a Handling Unit Management Fiori app built on 6 SAP services.
- **Inspect (GET only, client from `.env.local`):** all 6 services present in `srv/external/all_catalog_services.json` (added to the catalog on 2026-10-05, SAP-delivered, V2 `ServiceUrl`); all 6 listed as `500` in `catalog-audit.csv` and absent from `catalog-creatable.csv`; live `$metadata` and `/` for each → HTTP 500 `/IWFND/CM_COS/064` "No System Alias found for Service 'Z…_0001'". No HU code, adapter, CAP service or UI module exists in the repo (grep). Existing pattern to reuse once unblocked: `srv/wm/mvt261` + `srv/integration/s4hana/wm/Mvt261Adapter.js` + `app/fiori-app/webapp/modules/wm/mvt261`.
- **Decision:** STOP before Plan/Change (AGENTS.md: capability not provable). Logged as Unresolved Issue 9 / Next Step 9.
- **Validation:** `git diff --check` clean (this file only).
- **Result:** **Blocked** on SAP Gateway configuration.

### 2026-10-06 11:38 IST — Handling Unit services unblocked: all 6 return HTTP 200 OK & verified live

- **Trigger:** user maintained system alias `LOCAL` for the 6 services in `/IWFND/MAINT_SERVICE` / `/IWFND/V_MGDEAM`.
- **Files:** `catalog-audit.csv` (updated to 200), `catalog-creatable.csv` (updated), `tools/build-creatable-xlsx.py` (override `API_PACKINGINSTRUCTION` to `LE - Shipping`), `creatable-services.xlsx` (rebuilt to 497 services), `WORKSTATUS.md` (Unresolved Issue 9 resolved).
- **Live Verification Results (Client 220):**
  - `API_PACKINGINSTRUCTION`: **HTTP 200 OK** (21,790 bytes). **Creatable: YES** (`PackingInstructionHeader` is creatable with associated items and texts). Added to `LE - Shipping` in `creatable-services.xlsx`.
  - `API_HANDLING_UNIT`: **HTTP 200 OK** (8,898 bytes). Reads live HUs and items (`HandlingUnit`, `HandlingUnitItem`). In OData V2 exposure, entity sets are marked `sap:creatable="false"`.
  - `C_HANDLINGUNITMONITOR_CDS`: **HTTP 200 OK** (623,633 bytes, 117 entity sets). Analytical/monitoring consumption model for HUMO. Read-only.
  - `UI_HANDLINGUNITHIERNODE`: **HTTP 200 OK** (45,958 bytes, 15 entity sets). Custom entity query for recursive HU hierarchy trees. Read-only.
  - `FDP_HU_SHIPPINGLABEL_SRV`: **HTTP 200 OK** (8 sets). Form Data Provider for HU shipping label printing. Read-only.
  - `FDP_LOHUM_HU_PACKINGLIST_SRV`: **HTTP 200 OK** (7 sets). Form Data Provider for HU packing list printing. Read-only.
- **Validation:** `git diff --check` clean. All 6 services verified live.
- **Result:** PASS — Unresolved Issue 9 **Resolved**.
