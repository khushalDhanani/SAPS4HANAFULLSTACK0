# Post-Alias Runbook — Per-Order Incoterms on Create (`#/sd/sales-orders/create`)

**Status:** Blocked on Basis. Do **not** start the code change until Step 0 is done.
**Decision (2026-10-08):** Path A (create via `API_SALES_ORDER_SRV` with Incoterms). Path C (customer-master
defaulting) is the interim; Path B (LORD + mass-update) is rejected. See `WORKSTATUS.md` Unresolved Issue 11.

**Why this runbook exists:** the current create service `LORD_ODATA_ORDER_SRV` has **no** Incoterms field
(verified — `grep -ic incoterm` on its `.edmx` = 0), and the landscape scan
(1,243 services; regenerate with `python3 tools/scan-incoterms.py` → `incoterms-capability-scan.csv`, gitignored) found **no** service that creates
or directly updates Incoterms on a sales order except `API_SALES_ORDER_SRV`, which is currently unroutable
(HTTP 500 `No System Alias found for Service 'ZAPI_SALES_ORDER_SRV_0001'`).

---

## Step 0 — Unblock (Basis)

Assign System Alias `LOCAL` to service `ZAPI_SALES_ORDER_SRV_0001` in `/IWFND/MAINT_SERVICE`
(same action performed for the HU services, WORKSTATUS Issue 9). Nothing below can run until this returns HTTP 200.

---

## Step a — Re-verify metadata (read-only, GET only)

Re-run the read-only probe and confirm the service is now routable **and** the Incoterms fields are creatable:

```bash
python3 tools/find-creatable.py            # catalog-wide (GET only); API_SALES_ORDER_SRV should flip 500 -> 200
```

Then GET the service's `$metadata` directly (read-only, same Basic-auth + `sap-client` as `tools/find-creatable.py`
uses from `.env.local`) and inspect the `A_SalesOrderType` entity type for the Incoterms properties and their
`sap:creatable` flags:

```
GET <S4_DESTINATION_URL>/sap/opu/odata/sap/API_SALES_ORDER_SRV/$metadata
```

**Pass criteria** on `A_SalesOrder` (entity type `A_SalesOrderType`):

- `IncotermsClassification` — present, `creatable` (not `sap:creatable="false"`)
- `IncotermsTransferLocation` — present, creatable
- `IncotermsLocation1`, `IncotermsLocation2` — present, creatable
- (note `IncotermsVersion` if the system runs Incoterms versioning)
- `A_SalesOrder` **entity set** is `creatable` and has `to_Item` (deep insert) and `to_Partner` navigations.

If any Incoterms field is `creatable="false"`, **stop** — the field cannot be set on create via this service;
re-open the decision. Do not assume; this must be read from the live `$metadata`.

---

## Step b — One minimal proof POST (needs explicit user go — a live write)

Per `AGENTS.md` SAP-discovery protocol, prove CREATE before any app wiring. One header + one item + Incoterms,
for the failing customer and the sales area in use (sold-to and sales area as configured; e.g. the customer
`10135` used in prior proofs). Use a short-lived test script in `scratchpad/`, not app code.

1. POST `A_SalesOrder` deep insert: header (`SalesOrderType` = configured `S4_ORDER_TYPE`, `SalesOrganization`
   = `S4_SALES_ORGANIZATION`, `DistributionChannel` = `S4_DISTRIBUTION_CHANNEL`, `OrganizationDivision` =
   `S4_DIVISION`, `SoldToParty`), `IncotermsClassification` = `CIF` (test), `IncotermsTransferLocation` /
   `IncotermsLocation1` = test location, one `to_Item` (Material, RequestedQuantity, unit).
2. Confirm HTTP 201 **and** a real `SalesOrder` document number is returned.
3. **Read back** — the document must actually exist with Incoterms:
   - VA03 → Header → **Sales** (and **Shipping/Billing**) tab: Incoterms + location populated.
   - `SE16N` on **VBKD** for that VBELN: `INCO1` = `CIF`, `INCO2_L` (and `INCO2`/`INCOV` if used) set.
4. Record the document number, INCO1/INCO2_L values, and the exact request payload in `WORKSTATUS.md`.

A 201 alone is **not** proof — the Incoterms values must be present in VBKD on read-back.

---

## Step c — Change plan (exact files; preserve what already works)

Add a **new, feature-flagged** create path to `API_SALES_ORDER_SRV`; **do not mutate** the proven LORD path.

| File | Change |
|---|---|
| `srv/sd/sales-order/service.cds` | Add `IncotermsClassification`, `IncotermsTransferLocation`, `IncotermsLocation1`, `IncotermsLocation2` (+ `IncotermsVersion` if used) to the `OrderHeader` type. (CAP drops undeclared fields — this is mandatory.) |
| `app/fiori-app/webapp/modules/sd/sales-order/view/CreateSalesOrder.view.xml` | Add Incoterms Classification input (with value help) + Incoterms Location input. |
| `app/fiori-app/webapp/modules/sd/sales-order/model/SalesOrderModel.js` | Add the Incoterms header fields to the model + any required-field validation (on `change`, not `liveChange` — see Issue 10c). |
| `app/fiori-app/webapp/modules/sd/sales-order/controller/CreateSalesOrder.controller.js` | Wire the Incoterms value help (reuse the `IncotermsClassificationVH` pattern noted in Issue 10b; honour `$filter`, no row cap). |
| `srv/integration/s4hana/sd/sales-inquiry/SalesInquiryMapper.js` | In `mapToS4OrderPayload`, map the Incoterms header fields into the `A_SalesOrder` payload (new path only). |
| `srv/integration/s4hana/sd/sales-inquiry/SalesInquiryAdapter.js` | Add `createSalesOrderViaApi(header, items, options)` posting an `A_SalesOrder` deep insert to `/sap/opu/odata/sap/API_SALES_ORDER_SRV`; the handler picks the path by the feature flag (Step d). |
| `srv/sd/sales-order/handlers/salesOrder.handler.js` | In `createSalesOrder`, branch to the API path when the flag is on; LORD path otherwise. |

**Preservation mapping (LORD HeaderSet → A_SalesOrder) — carry over, do not drop:**

- **ContactPerson** → `to_Partner` entry with the contact partner function (verify the function code / whether a
  header field exists in `A_SalesOrder` metadata first — do not assume).
- **PaymentTerms / PaymentTermCode** → `A_SalesOrder.CustomerPaymentTerms`.
- **HeaderPartner (ShipTo `SH`, etc.)** → `to_Partner` (`A_SalesOrderPartner`, `PartnerFunction`/`Customer`).
- **Deep items** → `to_Item` (`A_SalesOrderItem`: `Material`, `RequestedQuantity`, `RequestedQuantityUnit`,
  `RequestedDeliveryDate`, plant), mirroring the existing `ItemSet` deep-insert shape.
- Keep the existing read-back verification and the `SALES_ORDER_CREATED_VERIFICATION_FAILED` handling.

All changes are additive and behind the flag, so the existing READ/list/detail and the LORD create stay untouched
until the flag is flipped (`AGENTS.md`: protect working functionality; separate READ from CREATE).

---

## Step d — Rollback plan (feature flag; LORD stays the fallback)

- New env/config key, e.g. `S4_SO_CREATE_SERVICE` = `LORD` (default) | `API_SALES_ORDER`.
  Resolve it in `srv/common/s4Config.js` (same pattern as the other `getX()` accessors) and read it in the handler.
- Default `LORD` ⇒ **zero behaviour change** on deploy; flip to `API_SALES_ORDER` only after Step b passes in the
  target environment. Flip back to `LORD` to roll back instantly — no redeploy of code needed.
- Alternatively keep the work on a branch (`feature/so-create-api-incoterms`) and merge only after live proof.
- The Incoterms UI inputs render regardless; if the flag is `LORD` they are harmless (LORD ignores them) — but
  prefer hiding/disabling them under `LORD` so users aren't shown a field that won't persist.

---

## Step e — Test list (order types & sales areas in use)

Run for **each** order type and sales area the business actually uses — at minimum the configured defaults
(`S4_ORDER_TYPE`, `S4_SALES_ORGANIZATION` / `S4_DISTRIBUTION_CHANNEL` / `S4_DIVISION`) plus any export order types
where Incoterms matter most:

1. **Unit** — `SalesInquiryMapper.mapToS4OrderPayload` maps Incoterms into the `A_SalesOrder` payload; omitted/blank
   Incoterms are not sent as empty strings; item mapping unchanged.
2. **Unit** — `createSalesOrderViaApi` builds the correct deep-insert body (header Incoterms + `to_Item` +
   `to_Partner` for ShipTo/ContactPerson + `CustomerPaymentTerms`).
3. **Regression (must stay green)** — the existing LORD path tests: ContactPerson, PaymentTerms, HeaderPartner,
   deep item, read-back verification (`test/unit/sales-order/*`).
4. **Integration (mocked `API_SALES_ORDER_SRV`)** — 201 + document number parsed; 400/403/500 surfaced with the SAP
   message (per `AGENTS.md` error classification).
5. **Live matrix (each order type × sales area, with explicit user go):** create one order with Incoterms →
   confirm VA03 Sales/Billing tab + VBKD `INCO1`/`INCO2_L`; create one order **without** Incoterms → confirm it
   still defaults from customer master (Path C still works); confirm ContactPerson, PaymentTerms, ShipTo partner,
   and items all persisted on the same order.
6. **UI** — Incoterms value help honours `$filter` (no 50-row cap), validation fires on `change` not while typing,
   and the field is hidden/disabled when the flag is `LORD`.
7. `npx jest`, `npx cds compile srv`, `cd app/fiori-app && npx ui5lint`, `git diff --check` — all green before merge.

**Definition of Done:** `A_SalesOrder` Incoterms confirmed creatable in live metadata; proof order read back from VBKD
with the sent INCO1/INCO2_L; all preserved fields still persist; LORD fallback intact behind the flag; tests green.
