# Delivery Verification

**Scope:** what this application and this S/4HANA system actually deliver, measured by execution.
`service-map.md` proves the services answer. This proves what is behind them.

**System:** DS4 client 220 (`172.27.100.32:8000`). **Run:** 19 September 2026.
**Evidence:** `cap-endpoint-reality.csv` (application layer), `catalog-data-reality-classified.csv`
(every catalogued service). Re-runnable: `probe-cap.py`, `verify-catalog-depth.py`, `reclassify.py`.

Nothing below is inferred from code reading or from a `200`. Every claim names its observation.

---

## Part 1 — The application layer

51 endpoints across 6 services, probed through the running CAP server with real keys.

| Module | Endpoints | Verdict |
|---|---|---|
| Purchase Order | 23 | **Delivers.** 2,782 POs, 6,136 items, 20 of 21 value helps carry data |
| Sales Inquiry | 17 | **Delivers.** 629 headers, 628 items, all 12 value helps carry data |
| Journal Entry | 1 | **Delivers.** 174,155 items |
| Goods Issue | 6 | **Delivers on read.** Posting blocked — see Part 3 |
| Goods Receipt | 4 | **Delivers on read.** Posting retargeted, not yet proven |

Goods Issue traced end to end on reservation **168779** (plant 1120, movement 261): 6 items,
material 3000000200 "Diazotization Reaction", 653.847 KG open, storage location CS01, two batches
with real expiry and status (`IN25000963`, exp 2026-12-11, VALID). Reservation 168778 likewise, with a
batch flagged EXPIRING SOON. Goods Receipt traced on storage unit **180000001** → delivery 180000001,
PO 400000011, material 1000000045, 10 KG, batch INS2500000, supplier Dowpol Chemical International.

### Open defects

**1. `$top` and `$count` are ignored by every custom-handler entity.**
`$top=3` returned 132 rows from `sales-inquiry/MaterialVH`; `$top=1` returned 1,040 inbound deliveries.
`@odata.count` returns `0` while 54 / 18 / 132 rows are delivered. No server-side paging; every such
table shows a wrong total and pulls the full set.

**2. Goods Receipt returns HTTP 502 for its own validation errors.**
`MaterialStorageLocations` and `MaterialBatches` without a `Material` filter answer
`502 Material parameter is required`. A missing caller parameter is a `400`. As written, a user mistake
is indistinguishable from an SAP outage in the logs. Goods Issue returns `400` correctly — copy it.

**3. Stock disagrees between two endpoints on the same screen.**
`MaterialBatches` returned `AvailableStock: null` for batch IN25000963 while `resolveIdentifier`
returned `5000` for the same reservation and material. The operator sees both.

**4. `OpenReservations.ItemCount` does not match the item list.**
168779: `ItemCount` 5, `GIItems` returned 6. 168778: `ItemCount` 3, returned 4. Off by one on both.

**5. `StorageBin` on a goods-issue item carries a description, not a bin.**
Observed value `"Raw Material"`. Will not scan and will not match.

**6. `getSupplierDefaults` delivers nothing.**
Supplier 1110 returned `Currency: ""`, `PaymentTerms: ""`, `IncotermsClassification: ""`,
`derived: false`. The sales-side `getCustomerDefaults` returned a full record for the same partner.

**7. `DocumentTypeVH` is empty.** 0 rows. The PO document-type dropdown has nothing in it.

Defects 3, 4 and 5 were each observed on two samples and had not been re-confirmed after the
19-Sep account lockout. Re-check before fixing.

---

## Part 2 — The whole system

Every catalogued service walked: `$metadata` read, every entity set counted.
**1,236 services, 71,119 entity sets, 111 minutes.**

| Verdict | Entity sets | Share |
|---|---|---|
| DATA | 30,530 | 42.9% |
| EMPTY | 14,483 | 20.4% |
| NOT_IMPLEMENTED | 12,357 | 17.4% |
| NOT_COUNTABLE (function imports) | 8,194 | 11.5% |
| ERROR | 3,493 | 4.9% |
| NEEDS_FILTER | 710 | 1.0% |
| FORBIDDEN | 638 | 0.9% |
| BACKEND_DUMP | 465 | 0.7% |
| NOT_LICENSED | 249 | 0.4% |

**43% of what DS4 advertises holds a row.** 38% is empty or has no implementation behind it. Every one
of those 71,119 scored `200` under an existence check. At service level the picture is milder: 1,221 of
1,236 deliver at least one populated entity set, and only 15 are wholly dead. The rot is *inside*
services — SAP ships them broad and most sets are dark.

Two cautions on these numbers:

- `NOT_IMPLEMENTED` is derived from a `$count`. A **post-only** entity set implements `CREATE_ENTITY`
  without `GET_ENTITYSET` and lands in this bucket while being perfectly usable for writing. The count
  is an upper bound on dead sets, not a list of them.
- The largest `DATA` rows are noise. `VL_CH_DD03L` at 18,282,080 is the ABAP data dictionary exposed
  through generic change-tracking services. Exclude `ZMDC_*` and `VL_CH_*` before quoting volumes.

### Of the 48 entity sets this application calls

32 `DATA`, 9 `EMPTY`, 1 `NEEDS_FILTER` (by design), 5 function imports, 1 absent.
The 9 empty are the EWM sets (since removed) plus both `MMIM_MATERIAL_DATA_SRV` sets.
The one absent is `API_MATERIAL_DOCUMENT_SRV`.

---

## Part 3 — Goods Issue posting has no reachable endpoint

Movement 261 is the live AIL process. It cannot post. All three routes are closed:

| Route | State | Who can open it |
|---|---|---|
| `ZUI_GI_ORDER_RSV_O4` (V4) | 404, not published | ABAP — `/IWFND/V4_ADMIN` |
| `API_MATERIAL_DOCUMENT_SRV` | not registered, not in catalogue | Basis — `/IWFND/MAINT_SERVICE` |
| `MMIM_MATDOC_SRV` (MIGO backend) | live, every entity set `creatable="false"` | ABAP |

This is measured, not assumed: all 1,236 services were swept for a creatable goods-movement entity set.
Seven matched; after discarding payroll false positives the only real candidates are
`MMIM_GR4PO_DL_SRV` (goods receipt) and `UI_RESERVATION_HDR_MNG_V2` (reservation maintenance).
**No live endpoint on this system posts a 261 against a reservation.**

Consequence for delivery: the Goods Issue module ships as scan-and-queue. Reads work on real data,
`GoodsIssueQueue` already captures failed posts, and the queue drains when the block clears.

---

## Part 4 — Goods Receipt posting: structurally valid, semantically unproven

Retargeted from `API_WHSE_INBOUND_DELIVERY` (EWM, 0 rows) to
`MMIM_GR4PO_DL_SRV/GR4PO_DL_Headers` (IM, movement 101) — the same service the module already reads.

Dry-run 19-Sep-2026, no document posted:

- Every field the adapter sends **exists** on `GR4PO_DL_Header` and `GR4PO_DL_Item`. No invalid names.
- `Header2Items` is a real navigation property; the nesting is correct. `Header2Refs` exists, which is
  where the code reads the material document number back.
- CSRF token **issued** for `KHUSHAL` on this service. The write channel is open.

Not proven: that SAP accepts the payload semantically — movement type 101, the `SourceOfGR` values
(`INBDELIV` / `PURORD`), and the `Temp_Key` format. Only a real posting closes that.

The `Nullable="false"` flags in `$metadata` are **not** evidence of missing mandatory fields: Gateway
stamps it on every non-nullable ABAP field (84 of 102 item properties). It cannot be used as a checklist.

---

## Part 5 — Not code

`MMIM_MATERIAL_DATA_SRV/MaterialStorLocHelps` is empty in SAP, confirmed three ways. The Goods Receipt
storage-location picker has nothing to show and no code change fixes it. MM maintains the data, or the
field comes off the screen. See the correction in `service-map.md`.

---

## Method note

One earlier run of the drill-down script parsed `.env.local` without stripping the quotes around
`S4_PASSWORD`, sent 12 requests with an 18-character password and locked user `KHUSHAL`. The scripts in
this repository now strip quotes, and `verify-catalog-depth.py` aborts on the first `401` rather than
continuing — repeated attempts extend a lockout. Anything written against SAP should keep both guards.

*Internal Document / Confidential*
