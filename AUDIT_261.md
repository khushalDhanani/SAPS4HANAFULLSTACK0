# AUDIT_261.md — Read-only audit of the movement type 261 cycle

**Scope:** Full goods-issue-to-production-order (BWART 261) cycle in this repo and against the
live S/4HANA system in `.env.local`. **Read-only. Nothing was changed.**
**Date:** 2026-10-08 · **Trigger case:** reservation 518006 item 3 (order 1002747, component
1000000653, batch IN25072189).

Evidence is cited as `path:line` (code) or `TABLE-FIELD = value` (live SAP). Live reads were
RFC_READ_TABLE and OData `$filter`/`GET` only; no POST/PATCH/PUT/DELETE, no TO/TR, no posting.

---

## 1. Executive summary — top 5 risks

| # | Risk | Severity | Likelihood | Finding |
|---|------|----------|------------|---------|
| 1 | **Open-items list and scan page disagree about what is issuable.** An item whose only stock sits in the production-supply-area location (non-WM reservation) is listed as `ScanPossible=true` and the scan page is **not blocked**, yet nothing can be scanned or posted. Confirmed live for 518006/3 and **27 open items in plant 1120**. | High | High (systemic) | F1, F2 |
| 2 | **Idempotency guard is racy and fails open.** `postGoodsIssue` does check-then-create (TOCTOU) with a *random* reference, not the atomic `createOrGet`; a store-write failure is swallowed. Two concurrent posts can both reach SAP → duplicate 261 → double stock issue. | High | Medium | F3 |
| 3 | **`postGoodsIssue` (a write) is authorized for the read-only `Viewer` role**, and the RFC read path runs as one fixed technical user, so app role is the real gate. | High | Medium | F4, F10 |
| 4 | **Availability is computed but never gates the GoodsIssue step / scan Block.** Stock shortfall at the issue location does not block the scan screen; the operator only fails at post time (or never). Root of risk #1. | High | High | F1 |
| 5 | **Backflush components are invisible to the app** (RESB-RGEKZ is never read). A backflush item issued manually here would be consumed twice at CO11N. Latent today (0 live instances in plant 1120) but unguarded. | Medium→High | Low now | F5 |

**Is 518006/3 isolated?** No — it is one of **27** open 261 items in plant 1120 with the same
`LGORT`-vs-supply-area conflict (section 9).

---

## 2. Findings table

| ID | Stage | Sev | Evidence | Impact on operator / data | Recommended fix (describe only) | Test needed |
|----|-------|-----|----------|---------------------------|---------------------------------|-------------|
| **F1** | 3 Scan context / 5 Post | High | `srv/integration/s4hana/wm/Mvt261Adapter.js:411` computes the Availability step but `:414` builds the GoodsIssue step only from `resvBlockers+orderBlockers+stagingBlocker` (not availability); `:595` sets `scanContext.Blocked = gi.Status!=='open'`. **Live 518006/3:** `Availability:blocked(stock 0<25)` but `GoodsIssue:open`, `scan.Blocked=false`, 1 unit OnHold/not-suggested. | Scan page opens unblocked with nothing suggestable; operator cannot reach "Covered", cannot post, and the reason ("stock is in supply area CS01, not issue location PT01") is only a soft warning. | Fold issuable-stock-at-the-issue-location/warehouse into the GoodsIssue/Blocked decision with an actionable reason; don't rely on the post-time 422. | cycle+scanContext for a released, movement-allowed, non-WM reservation whose issue sloc is empty but supply area holds stock → `Blocked:true` with the supply-area reason. |
| **F2** | 2 Staging / 1 List | High | `Mvt261Adapter.js:460-472` `_readyStorageUnits` reads **all** plant LQUA (no `LGORT`/`LGNUM` filter), grouped `material|plant`; `:243` and `:263-266` derive `ScanPossible` from `su.count`. **Live:** `openItems(518006/3)` → `ScanPossible:true, ReadyStorageUnits:1, ReadyQuantity:25` while `scanContext` has 0 issuable units. | Open tab advertises items that cannot be scanned/posted; clerks chase dead ends; list ≠ scan page. | Compute readiness per reservation's **issue location + warehouse** and the non-WM `issuable` rule (reuse the scanContext logic), not plant-wide. | openItems where plant stock exists only in a non-issue sloc / different warehouse → `ScanPossible:false`. |
| **F3** | 5 Post idempotency | High | `srv/wm/mvt261/service.js:37-59`: `hasOpenAttemptForReservation` **then** `create()` (two steps, not atomic); `create()` is wrapped in try/catch that only `req.warn`s (`:56-59`); refDoc is random `:42`. The atomic `GoodsIssueAttemptStore.createOrGet` (`srv/wm/goods-issue/GoodsIssueAttemptStore.js:119`) exists but is **not** used. Adapter itself has no key/retry (`Mvt261Adapter.js:674-676`). | Double-click / two clerks / client retry → both pass the guard → duplicate 261 postings → **double goods issue**. DB hiccup disables the guard silently. Random reference means SAP-side LIFEX dedup can't catch it either. | Claim atomically via `createOrGet` with a **deterministic** key (reservation+item+open-qty/day); fail **closed** if the attempt store write fails. | Two concurrent `postGoodsIssue` for the same reservation/item → exactly one posts, the other 409; store-write failure → refuse, not post. |
| **F4** | 7 Authorization | High | `srv/wm/mvt261/service.cds:196-202` — `action postGoodsIssue` `@requires` includes **`'Viewer'`** (same role list as every read function). | A role intended as read-only can post a goods issue. | Restrict the write to `WarehouseClerk`/`WarehouseManager`/`Admin`; keep reads at `Viewer`. | Viewer calling `postGoodsIssue` → 403; clerk → allowed. |
| **F5** | 1 Reservation / 7 Edge | Med→High | `grep RGEKZ` → not read anywhere; RESB reads omit RGEKZ (`Mvt261Adapter.js:303,486,614`). **Live:** 0 backflush among plant-1120 open items today. | A backflush component (RGEKZ) issued manually here is consumed again at order confirmation (CO11N) → double consumption. Unguarded. | Read `RESB-RGEKZ`; warn/block manual 261 for backflush items. | Reservation with RGEKZ set → flagged/blocked. |
| **F6** | 7 Reversal (262) | Med | `Mvt261Adapter.js:747` `reverse()` exists and is unit-tested (`test/unit/wm/mvt261Adapter.test.js:380`), but `service.js` wires only 6 handlers (no reverse) and `service.cds` exposes no reverse action; the cycle advertises "N documents can be reversed" (`Mvt261Adapter.js:416`) with no way to act. | 262 reversal is unreachable from the service/UI; the cycle step is misleading. | Decide intent: expose a guarded `reverse` action (write → same role restriction as F4) **or** drop the advertisement. | If exposed: reverse references the exact doc; role-guarded. |
| **F7** | 5 Post stock gate | Med | cycle() restricts MARD/MCHB to `resb.LGORT` (`Mvt261Adapter.js:315,319-320`); `postGoodsIssue` stock gate uses `c.Stock` = that sloc only (`:705-708`). scanContext suggests warehouse-wide / supply-area stock (`:567`). | For WM, drums shown as issuable (other sloc / supply area) are validated against a *different* stock set → inconsistent 422s. The three "what is available" computations disagree (see logic map). | Use one availability definition across list, scan and post. | WM reservation with suggested supply-area stock → post gate agrees with the suggestion. |
| **F8** | 6 Post semantics | Med | `postGoodsIssue` builds a plain 261 from `c.StorageLocation`+qty+optional batch (`Mvt261Adapter.js:719-727`); scanned SU/bin are not sent. `onPost` sends only total qty + first batch (`app/fiori-app/webapp/modules/wm/mvt261/controller/Scan261.controller.js:184-205`). | Operator believes specific drums were issued; SAP picks per its own strategy / delivery+TO. FIFO deviations recorded in the UI have no posting effect. | Document that scanning is advisory, or post per storage unit where the API supports it. | Assert posted payload vs scanned SUs (expected divergence documented). |
| **F9** | 5 Post validation | Med | `postGoodsIssue` takes `batch` from input and validates stock for it, but never compares it to `resb.CHARG` (`Mvt261Adapter.js:679,705-708`). UI enforces it (`checkStorageUnit` wrongBatch `:640-643`), but a direct API caller (see F4) bypasses the UI. | A direct call could issue a batch other than the one the reservation pins (if SAP permits). | When `resb.CHARG` is set, force `batch=resb.CHARG` and reject a mismatch server-side. | `postGoodsIssue` with batch≠`resb.CHARG` → 422. |
| **F10** | 7 Authorization / data | Med | RFC path authenticates as one fixed user `RfcClient.js:27` (`S4_USERNAME`); the adapter header claims "SAP applies the plant / movement type authorizations of the calling user" (`Mvt261Adapter.js:20`) — **false for RFC_READ_TABLE**. OData path depends on destination (`S4HttpClient` supports principal propagation *or* Basic). | Any authenticated Viewer can read any plant's reservations/stock via cycle/scan/openItems. Posting enforcement depends on the (unverified) destination auth mode. | Enforce plant scoping in the service (a `plantScope` pattern already exists in tests); use principal propagation for the write; correct the misleading comment. | Cross-plant read is rejected / scoped; posting uses end-user identity. |
| **F11** | 6 Post-posting status | Low | `service.js:72` sets status `'not_posted'` on the WM-delivery outcome, while the store's own recheck uses `'delivery_created'` (`GoodsIssueAttemptStore.js:14,418`). | Same real outcome recorded under two different statuses → reporting confusion. | Use `'delivery_created'` in the service too. | Delivery outcome → status `delivery_created`. |
| **F12** | 3 FIFO suggestion | Low | `Mvt261Adapter.js:572-573` — `toCover -= quantity` subtracts the full quant even when it only partially covers the remainder. | Minor under-suggestion of drums near the tail. | Subtract `min(quantity, toCover)`. | Suggested set covers the open qty with the fewest drums. |
| | | | **CLOSED — no-op, not a defect (2026-10-08).** A unit is Suggested on `toCover > 0` *before* the subtraction, and `toCover` only decreases, so subtracting the full quant vs `min(quantity, toCover)` yields the **identical suggested set**. There is no observable difference and therefore no fail-before/pass-after test. The original audit overstated this; no change made. | | | |

---

## 3. Duplicate / divergent logic map

**"What stock is issuable / ready" is implemented three different ways:**

1. **Scan page** — `scanContext` `issuable()` + the `here` filter: warehouse-wide for WM, exact issue
   sloc for non-WM, plus the supply-area location flagged `inSupplyArea`.
   `Mvt261Adapter.js:554-582`.
2. **Open list** — `openItems` `ScanPossible` via `_readyStorageUnits(plant)`: **plant-wide**, grouped
   `material|plant`, **no** storage-location/warehouse/supply-area filter.
   `Mvt261Adapter.js:243-266`, `:460-472`.
3. **Post** — `postGoodsIssue` stock gate via `cycle()` MARD/MCHB restricted to `resb.LGORT` **only**.
   `Mvt261Adapter.js:315,319-320,705-708`.

These three disagree for exactly the 518006/3 shape → F1/F2/F7.

**Interim-bin staging shortfall is implemented three times:**
- `cycle()` inline `Mvt261Adapter.js:364-377`
- `_stagingShortfalls()` for the list `:480-516`
- `postGoodsIssue` re-check `:693-704`

**Warehouse (T320) lookup twice:** `cycle()` `:321` and `_warehouses()` `:523-531` (same source,
duplicated read).

**Block-reason logic:** `blockers()` is correctly shared by `cycle()` and `checkStorageUnit`
(`Mvt261Adapter.js:69-86`, `:380`, `:620`), **but** `openItems` re-implements the reasons inline
(`:252-265`) instead of reusing `blockers()` → drift risk.

**Order status:** single source `_orderStatuses()` used by all three paths (good).

---

## 4. Test coverage gap matrix (stage × scenario)

Legend: ✅ covered · ⚠️ partial / locks in current (possibly wrong) behavior · ❌ gap.
Tests: `test/unit/wm/mvt261Adapter.test.js`, `mvt261Scan.test.js`, `open261Controller.test.js`.

| Stage \ scenario | WM reservation | non-WM reservation | supply-area-only stock | batch-pinned | availability shortfall | concurrency/idempotency | backflush | authorization |
|---|---|---|---|---|---|---|---|---|
| 1 Reservation read | ✅ | ✅ | — | ✅ | — | — | ❌ | — |
| 2 Staging / readiness | ✅ (staged ok/short) | ⚠️ list readiness is plant-wide, **untested against a non-issue sloc** | ❌ (F2 not caught) | ✅ | ❌ | — | ❌ | — |
| 3 Scan context | ✅ supply area suggested | ✅ OnHold/not-suggested (⚠️ asserts *display*, not that item should be **Blocked** — locks in F1) | ⚠️ 518006/3 shape tested for display only | ✅ | ❌ (no test that shortfall blocks the scan) | — | ❌ | — |
| 4 Scan validation | ✅ wrongWarehouse/accept | ✅ | — | ✅ wrongBatch | — | — | ❌ | — |
| 5 Post | ✅ delivery (L9/514) | ✅ happy/refusals | ❌ | ⚠️ stock-by-batch, **no resb.CHARG enforcement test** (F9) | ✅ refuses on stock 0 | ⚠️ only pre-seeded "already in progress"; **no real race** (F3) | ❌ | ❌ (Viewer-posts-ok untested, F4) |
| 6 Post-posting | ✅ attempt status set | ✅ | — | — | — | ⚠️ `not_posted` vs `delivery_created` (F11) | — | — |
| 7 Reversal (262) | ✅ adapter unit-tested | ✅ | — | — | — | — | — | ❌ (reverse not wired, F6) |

Biggest gaps: **F1/F2 are implicitly accepted by the current tests** (the scanContext test asserts the
OnHold display but not that the item must be blocked), **no true concurrency test** for posting, **no
authorization test**, **no backflush test**.

---

## 5. Live sweep (section 9) — plant 1120, read-only

Method: `RFC_READ_TABLE` on `T320`, `RESB` (BWART 261, `XLOEK=''`, `KZEAR=''`), `PVBE`, `MARD`;
open = `BDMNG-ENMNG > 0`. Supply-area location from `PVBE-LGORT`; WM sloc = present in `T320`.

- **Open 261 items:** 152 (of 204 not-deleted / not-final).
- **Backflush (RESB-RGEKZ set) among open:** **0** → no backflush+manual-261 overlap today (risk F5 is latent, not active).
- **Conflict A** (`LGORT` non-WM **and** `PRVBE`'s supply-area sloc is WM-managed): **27**.
- **Conflict A′** (`LGORT` non-WM **and** supply-area sloc ≠ `LGORT`): **27** (same set).
- **True dead-ends** (issue sloc empty, supply area holds stock — exactly the 518006/3 shape), among sampled materials: **2** (`518006/3` PT01=0 / CS01=25; `450402/3` PT01=0 / CS01=168). The other 25 have *some* PT01 stock so are partially issuable, but **all 27 still hit the list/scan divergence (F1/F2)** because PT01 is non-WM and the CS01 supply-area stock is flagged OnHold / not counted in readiness.

**Examples (all 27, read live). PO | item (reservation) | material | LGORT=stock | supplyAreaSloc=stock | open | backflush:**

```
1002765 | 1 (518008) | 1000000188 | PT01=0       | CS01=0        | 1500 KG | -
1002765 | 4 (518008) | 1000000371 | PT01=1097    | CS01=86696.52 | 850 M3  | -
1002765 | 6 (518008) | 8300000265 | PT01=38395.8 | CS01=0        | 3900 KG | -
1002765 | 7 (518008) | 1000000600 | PT01=50      | CS01=200      | 50 KG   | -
1002747 | 1 (518006) | 1000000188 | PT01=0       | CS01=0        | 1500 KG | -
1002747 | 3 (518006) | 1000000653 | PT01=0       | CS01=25       | 25 KG   | -   <-- trigger case
1002747 | 4 (518006) | 1000000371 | PT01=1097    | CS01=86696.52 | 713 M3  | -
1002787 | 4 (521103) | 1000000520 | PT01=34649   | CS01=356180   | 2600 KG | -
1002787 | 6 (521103) | 8300000214 | PT01=191895  | CS01=87000    | 1500 L  | -
1002790 | 4 (521169) | 1000000520 | PT01=34649   | CS01=356180   | 2600 KG | -
1002790 | 6 (521169) | 8300000214 | PT01=191895  | CS01=87000    | 1500 L  | -
1002579 | 3 (450402) | 2000000043 | PT01=0       | CS01=168      | 15 NOS  | -
1001385 | 7 (255518) | 8300000151 | PT01=0       | CS01=0        | 569 KG  | -
1002628 | 1 (480096) | 1000000315 | PT01=454632  | CS01=755345   | 7418 KG | -
1002629 | 1 (480097) | 1000000315 | PT01=454632  | CS01=755345   | 7418 KG | -
1002668 | 1 (490788) | 1000000315 | PT01=454632  | CS01=755345   | 7418 KG | -
1000040 | 5 (18025)  | 8300000106 | PT01=945     | CS01=835      | 835 KG  | -
1001493 | 1 (348712) | 8300000103 | PT01=65462   | CS01=2411     | 1362 KG | -
1000186 | 1 (33827)  | 3000000196 | PT01=1558    | CS01=445      | 2907 KG | -
1002178 | 1 (457015) | 3000000207 | PT01=638     | CS01=0        | 6200 KG | -
1002579 | 1 (450402) | 3000000196 | PT01=1558    | CS01=445      | 4450 KG | -
1002619 | 1 (479284) | 3000000150 | PT01=2930    | CS01=0        | 1800 KG | -
1002623 | 1 (481650) | 3000000150 | PT01=2930    | CS01=0        | 1800 KG | -
1002579 | 2 (450402) | 8300000202 | PT01=2276    | CS01=0        | 740 KG  | -
1001385 | 6 (255518) | 8300000110 | PT01=486     | CS01=14563    | 2143 KG | -
1002619 | 5 (479284) | 1000000520 | PT01=34649   | CS01=356180   | 600 KG  | -
1002623 | 5 (481650) | 1000000520 | PT01=34649   | CS01=356180   | 600 KG  | -
```

**Conclusion:** 518006/3 is **systemic**, not isolated — 27 comparable open items in plant 1120, ~2
exact dead-ends, all 27 exposed to F1/F2.

---

## 6. SAP root cause (section 10) — why RESB-LGORT = PT01

**Live confirmation of the conflict (518006/3):**
- `RESB-LGORT = PT01`, `RESB-PRVBE = IP05`, `RESB-LGNUM = ''`, `RESB-LGTYP = ''`, `RESB-RGEKZ = ''`
  (not backflush), `BDMNG=25`, `ENMNG=0`, `POSTP='L'`.
- `PVBE(WERKS 1120, PRVBE IP05)-LGORT = CS01` → the supply area's storage location is **CS01**.
- `PKHD` control cycles (plant 1120) all sit in warehouse **W13**: `IP05 → W13 / IP5` (and a separate
  `PT01 → W13 / IP1`, `IP01..IP04 → W13 / IP1..IP4`).
- `T320(1120)`: CS01, CS02, HS01, … **all → W01**; **PT01 is not in T320** (non-WM). So there is a
  warehouse split — physical slocs are LE-WM **W01**, PP supply areas are **W13**.
- `MARD(1000000653, 1120)`: stock exists **only in CS01 = 25 KG** (batch IN25072189); **PT01 = 0**.

**Where PT01 comes from — traced to every readable master-data source:**
| Source | Table/field | Live value | Drives PT01? |
|---|---|---|---|
| BOM item | `STPO-LGORT` (BOM 00000023/01, POSNR 0030, IDNRK 1000000653) | **`''` (empty)** | No |
| BOM item supply area | `STPO-PRVBE` (same item) | **`''`** | No |
| Material master prod. sloc | `MARC-LGPRO` / `LGFSB` / `VSPVB` (1000000653/1120) | **all `''`** | No |
| Production version | `MKAL` (1000000653/1120) | **none (empty result)** | No |
| Supply area master | `PVBE(IP05)-LGORT` | `CS01` | Would give CS01, **not** PT01 |
| Control cycle | `PKHD(IP05)` | `W13 / IP5` | Warehouse/type, not an issue LGORT |

**Comparison with an order that issued correctly** (same material, batch IN25072189, issued from CS01
per `MATDOC` doc 4900012699):
| Field | 1002747 / res 518006/3 (**fails, PT01**) | 1000184 / res 34789/3 (**OK, CS01**) |
|---|---|---|
| BOM (`AFKO-STLNR/STLAL`) | `00000023 / 01` | `00000023 / 01` (identical) |
| Header material (`AFKO-PLNBEZ`) | `3000000155` | `3000000155` (identical) |
| BOM item `POSNR` | `0030` | `0030` (identical) |
| `RESB-PRVBE` | `IP05` | `IP05` (identical) |
| **`RESB-LGORT`** | **`PT01`** | **`CS01`** ← **the only differing field** |

**Root cause:** every master-data source that could set the component issue storage location is
**empty or identical** between the failing and the working order. The divergence is confined to a
single field — `RESB-LGORT` (PT01 vs CS01) — meaning PT01 was **introduced at planned-/production-order
creation (or a later manual/interface change) for the newer orders**, and it is **inconsistent with the
item's supply area IP05**, whose stock and WM staging resolve to **CS01 / W13**. Because PT01 is a
non-WM location that is empty, the 261 cannot find issuable stock there, while the physical batch sits in
the WM-managed supply-area location CS01.

**Aligned value:** `RESB-LGORT` should be **CS01** (matching `PVBE(IP05)` and where the stock and the
WM-PP control cycle resolve), consistent with the orders that issued successfully. The *mechanism* that
set PT01 is **not derivable read-only** (see section 7).

---

## 7. "Not verifiable read-only" list

1. **The exact mechanism that set `RESB-LGORT = PT01`.** All readable master data is empty/identical
   (section 6), so the value's origin is not in a master-data table. Determining it requires the
   planned order (`PLAF`), MRP-area storage-location config (`T001L`/`MDLV` MRP area), change documents
   (`CDHDR`/`CDPOS` for the order/reservation), or a storage-location-determination user-exit/BAdI —
   i.e. change history or config review, not a read of current master data.
2. **Posting authorization (F4/F10).** Whether the S/4 destination used for `postGoodsIssue` applies the
   *end user's* 261/plant authorization or runs under a technical user depends on the deployed
   destination's auth mode (principal propagation vs Basic). Not determinable from code; verifying it
   would need a controlled POST, which is out of read-only scope.
3. **Whether SAP substitutes a different batch (F9)** for a batch-pinned reservation at 261 posting —
   needs a controlled (non-prod) POST test; not performed.
4. **AFPO** and some wide PP tables returned RFC_READ_TABLE error `AD 718` (row too wide for the
   function module); the needed facts were obtained from `AFKO`/`RESB`/`STPO`/`PKHD`/`MKAL`/`MARD`
   instead, so no conclusion depends on AFPO.
5. **Runtime concurrency behavior of the idempotency guard (F3)** was reasoned from the code, not
   reproduced (reproducing a duplicate posting would require live writes).

---

## 8. Proposed fix order (described only — nothing implemented)

**Quick wins (small, low-risk):**
- F4 — restrict `postGoodsIssue` to clerk/manager/admin (one line in `service.cds`).
- F11 — use `delivery_created` consistently in `service.js`.
- F10 (comment) — correct the misleading "SAP applies the calling user's authorizations" note; it is
  false for the RFC path.
- F6 — decide 262 intent: gate+expose a `reverse` action, or drop the "can be reversed" advertisement.
- F12 — cap the FIFO `toCover` subtraction.

**Structural (design agreement first, then change + tests):**
- **F1 + F2 + F7 together** — one shared "issuable stock at the issue location/warehouse" function used
  by scan, list and post; make availability shortfall block the scan screen and the list, with the
  supply-area reason. This removes the 27-item divergence at the source.
- F3 — switch `postGoodsIssue` to the atomic `createOrGet` with a deterministic key; fail closed on
  store-write errors.
- F9 — enforce `resb.CHARG` server-side at post.
- F5 — read and flag `RESB-RGEKZ`.
- F10 — plant scoping / principal propagation for reads and the write.
- F8 — decide whether scanning should bind the posting (per-SU) or is explicitly advisory.

**Separate (SAP master-data/config, not app code):** correct `RESB-LGORT` determination so new orders
for this BOM get CS01 (or make PT01 a WM-managed/stocked location) — the systemic driver behind the 27
items. This is an SAP PP/WM configuration task, out of this repo.

---

No code, config, or SAP data was modified.
