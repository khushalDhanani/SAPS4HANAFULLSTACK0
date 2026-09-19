# Delivery Verification — CAP application layer

**Scope:** every endpoint this application *exposes*, probed live through the running CAP
server, not the SAP services behind it. `docs/service-map.md` proves the S/4HANA services
answer. This proves what the application actually hands the Fiori app.

**System:** DS4 client 220 (`172.27.100.32:8000`), CAP server on `localhost:4004`,
mocked-auth user `khushal` with all roles.
**Run:** 19 September 2026, 04:29–04:45 IST. Raw evidence: `cap-endpoint-reality.csv`.

**Method:** service document read per service to enumerate entity sets, then
`GET {set}?$top=3&$count=true` against each, then a second pass that drilled into real keys
(a real reservation, a real storage unit, all 26 warehouses). Nothing below is inferred from
code reading; every claim names the observation behind it.

## Result

62 endpoints probed. 48 answered `200`. The application delivers real data on
Purchase Order, Journal Entry and Sales Inquiry. Goods Issue delivers real data and is the
only module where a live business document was traced end to end. Goods Receipt delivers
headers but not stock locations. The Warehouse cockpit answers but is empty except inbound.

| Module | Endpoints | Verdict |
|---|---|---|
| Purchase Order | 23 | **Delivers.** 2,780 POs, 6,136 items, 20 of 21 value helps carry data |
| Journal Entry | 1 | **Delivers.** 174,153 items |
| Sales Inquiry | 17 | **Delivers.** 629 headers, 628 items, all 12 value helps carry data |
| Goods Issue | 6 | **Delivers, with defects.** 54 open reservations, plant 1120, movement 261 |
| Goods Receipt | 4 | **Partial.** Deliveries yes; storage locations empty |
| Warehouse (EWM) | 12 | **Does not deliver.** Tasks, orders, resources, outbound all 0 rows |

## Confirmed working, with the data observed

- `PurchaseOrders` 2,780 · `PurchaseOrderItems` 6,136 · `getDashboardMetrics` returns live
  counts (2,780 POs / 4,376 suppliers) computed from SAP, not constants.
- `JournalEntryItems` 174,153.
- `SalesInquiries` 629 · `SalesInquiryItems` 628 · `getCustomerDefaults('1110')` returned a
  real Aether address in SURAT with currency INR.
- Goods Issue traced end to end on reservation **168779** (plant 1120, movement 261):
  6 items, material 3000000200 "Diazotization Reaction", 653.847 KG open, storage location
  CS01, 2 batches with real expiry dates and status (`IN25000963`, exp 2026-12-11, VALID);
  `resolveIdentifier('168779')` returned the same reservation with 2 batches and stock 5000.
  Reservation 168778 likewise, with a batch flagged EXPIRING SOON (exp 2026-09-30).
- Goods Receipt traced on storage unit **180000001** → delivery 180000001, PO 400000011,
  material 1000000045, 10 KG, batch INS2500000, supplier Dowpol Chemical International.

## Defects found — each one observed, not inferred

**1. `$top` and `$count` are ignored by every custom-handler entity.**
`$top=3` returned 132 rows from `sales-inquiry/MaterialVH`, 26 from `Warehouses`, 54 from
`OpenReservations`, 17 from `OpenInboundDeliveries`, 10 from `SalesInquiryTypeVH`.
`$top=1` on the EWM sweep returned 34 storage types and 1,040 inbound deliveries.
`@odata.count` came back `0` on every one of them. There is no server-side paging: each of
these screens pulls the full set and the table shows a wrong total.

**2. The warehouse cockpit has no data behind it, across all 26 warehouses.**
Filtered per warehouse (`Warehouse eq '<id>'`), not an unfiltered count:

| Entity | Warehouses returning any row |
|---|---|
| `WarehouseOrders` | 0 of 26 |
| `WarehouseTasks` | 0 of 26 |
| `WarehouseResources` | 0 of 26 |
| `OutboundDeliveries` | 0 of 26 |
| `StorageBins` | 4 rows in total, all warehouses combined |
| `StorageTypes` | 34 rows in total |
| `WarehouseProcessTypes` | 33 rows in total |
| `InboundDeliveries` | 1,040 rows — the one EWM area that carries data |

`Warehouses` lists 26, only `0001` is flagged `IsEwm`. `WarehouseKPIs('0001')` returns
OpenTasks 0, PendingInbound 40, PendingOutbound 0, TotalStorageBins 4. Task confirmation,
RF picking and resource logon cannot be validated on this system because there is nothing
to confirm, pick or log on to.

**3. Eleven EWM entities are unreadable without a filter; two are unreadable at all.**
`WarehouseProcessTypes`, `StorageTypes`, `StorageBins`, `WarehouseOrders`, `WarehouseTasks`,
`InboundDeliveries`, `OutboundDeliveries`, `WarehouseKPIs`, `WarehouseResources` all return
`400 Warehouse parameter or filter is required`. `InboundDeliveryItems` and
`OutboundDeliveryItems` return `501` — annotated `@cds.persistence.skip` with no READ
handler, so they are reachable only through `$expand`.

**4. Goods Receipt returns no storage locations for materials that have stock.**
`MaterialStorageLocations?$filter=Material eq '1000000045'` → `200`, **0 rows**, while
`MaterialBatches` for the same material returned 2 batches. Same for 1000000458 (0 locations,
5 batches). The backing entity `MMIM_MATERIAL_DATA_SRV/MaterialStorLocHelps` counted 0 in
`data-reality.csv`. The storage-location picker on the GR screen is empty in practice.

**5. Goods Receipt returns HTTP 502 for its own validation errors.**
`MaterialStorageLocations` and `MaterialBatches` without a `Material` filter answer
`502 Material parameter is required`. A missing caller parameter is a `400`. As written, the
UI cannot tell a user mistake from an SAP outage — and neither can anyone reading the logs.
The equivalent check in Goods Issue correctly returns `400`.

**6. Stock disagrees between two endpoints on the same screen.**
`MaterialBatches` returned `AvailableStock: null` for batch IN25000963, while
`resolveIdentifier` returned `AvailableStock: 5000` for the same reservation and material.
One of the two is wrong and the operator sees both.

**7. `OpenReservations.ItemCount` does not match the item list.**
Reservation 168779: `ItemCount` 5, `GIItems` returned 6. Reservation 168778: `ItemCount` 3,
`GIItems` returned 4. Consistent off-by-one on both samples.

**8. `StorageBin` on a goods-issue item carries a description, not a bin.**
Observed value: `"Raw Material"`. That is not a bin code and will not scan or match.

**9. The purchase-order document-type value help is empty.**
`DocumentTypeVH` → `200`, 0 rows (projection filtered to `PurchasingDocumentCategory = 'F'`).
The document-type dropdown on PO creation has nothing in it.

**10. `getSupplierDefaults` delivers nothing.**
For real supplier 1110 it returned `Currency: ""`, `PaymentTerms: ""`,
`IncotermsClassification: ""`, `IncotermsLocation1: ""`, `derived: false`. The equivalent
`getCustomerDefaults` on the sales side returned a full record. PO header defaulting is dead
code paths away from working.

**11. Sales inquiry header → items expand returned nothing (one sample).**
`SalesInquiries?$top=1&$expand=to_Items` on inquiry 100000 returned 0 items while
`SalesInquiryItems` holds 628 rows. Single observation — the re-check was cut short (below).
Treat as suspected, not confirmed.

## Not verified this run

Write paths were **not** exercised. No document was posted to DS4. What is known about them
comes from `service-map.md` and `data-reality.csv`, not from this run:

- `postGoodsIssue` targets `zui_gi_order_rsv_o4` (V4, **404 — not published**) and falls back
  to `API_MATERIAL_DOCUMENT_SRV` (**403 `/IWFND/MED/170` — not registered**). Neither target
  exists on this system, so the action cannot post.
- EWM `createWarehouseTask` / `confirmWarehouseTask` / `cancelWarehouseTask` / `logonResource`
  target `API_WAREHOUSE_ORDER_TASK` and `PICKCART_SRV`, both of which hold 0 rows.
- `createPurchaseOrder` (`MM_PUR_PO_MAINT_V2_SRV`) and `createSalesInquiry`
  (`LORD_ODATA_ORDER_SRV`) target services that respond and hold data. Untested.

## Run interrupted

The second verification pass parsed `.env.local` without stripping the quotes around
`S4_PASSWORD` and sent 12 requests with an 18-character password instead of the real 16.
**SAP user `KHUSHAL` locked out at approximately 04:45 IST.** A subsequent call with the
correct password also returned 401, confirming the lock. No further authenticated calls were
made. Unlock via SU01, or wait for auto-unlock if `login/failed_user_auto_unlock = 1`.

Items 6, 7 and 11 above were observed once each and had not been re-confirmed when the lock
hit. Re-run after the unlock.

## How to re-verify

```bash
node -v                     # must be >= 22; nvm use v22.23.1
npx cds-serve               # CAP on :4004
python3 probe-cap.py        # see cap-endpoint-reality.csv
```

*Internal Document / Confidential*
