# SAP S/4HANA Creatable Services — Live Metadata Report

> **Source**: Live `$metadata` scan of **1,237 services** on DS4 client 220 — 23 Sep 2026 12:05 IST
> **Errors**: 0 (previous scan had 1 timeout on `MD_CUSTOMER_MASTER_SRV_01` — now resolved)
> **Tooling**: `python3 tools/find-creatable.py` → `catalog-creatable.csv` → `python3 tools/build-creatable-xlsx.py` → [`creatable-services.xlsx`](file:///Users/khushaldhanani/Desktop/SAPS4HANA/SAPS4HANAFULLSTACK/creatable-services.xlsx)

---

## Scan Summary

| Metric | Count |
|---|---|
| Services scanned | 1,237 |
| Scan errors | **0** |
| Services with ≥1 creatable entity set | **496** |
| Services with ≥1 POST function import | **524** |
| Services that can write (either) | **635** |
| Read-only services | 602 |

---

## Creatable Services by Module

| Module | Total | API_* | Fiori | Entity Sets | POST Actions |
|---|---|---|---|---|---|
| FI - Finance | 162 | 0 | 162 | 650 | 1,224 |
| Basis - Fiori - Technical | 65 | 0 | 65 | 232 | 388 |
| MM - Purchasing | 53 | 0 | 53 | 213 | 576 |
| PP - Production | 52 | 0 | 52 | 109 | 598 |
| SD - Sales | 50 | 0 | 50 | 79 | 284 |
| EHS - Health &amp; Safety | 39 | 0 | 39 | 138 | 345 |
| PM - Maintenance | 35 | 2 | 33 | 122 | 677 |
| CO - Controlling | 32 | 0 | 32 | 118 | 256 |
| ATP - Availability | 31 | 0 | 31 | 120 | 328 |
| QM - Quality | 23 | 0 | 23 | 43 | 265 |
| Defense (DFS) | 18 | 0 | 18 | 93 | 1,018 |
| EWM - Warehouse | 15 | 5 | 10 | 46 | 80 |
| Master data - MDG | 14 | 0 | 14 | 84 | 257 |
| MM - Inventory | 12 | 0 | 12 | 12 | 101 |
| HR - Payroll - Travel | 10 | 0 | 10 | 17 | 17 |
| Retail (RFM) | 10 | 0 | 10 | 14 | 38 |
| Legal - Trade - Compliance | 6 | 0 | 6 | 52 | 178 |
| LE - Shipping | 5 | 0 | 5 | 13 | 53 |
| PS - Projects | 3 | 0 | 3 | 9 | 21 |
| **TOTAL** | **635** | **7** | **628** | **2,164** | **6,704** |

---

## Services Used by This App — Status &amp; Pending

These are the SAP OData services actually referenced in `srv/integration/s4hana/`. Each has its CREATE capability verified from live `$metadata`.

### Fully Implemented &amp; Proven Live

| Service | Module | Create Capability | App Usage | Status |
|---|---|---|---|---|
| `LORD_ODATA_ORDER_SRV` | SD | `HeaderSet` deep insert + `Simulate`, `CheckATP`, `RemoveBillingBlock`, `RemoveDeliveryBlock` | Sales Order &amp; Sales Inquiry creation | **Proven live** (ZDOM orders created) |
| `LE_SHP_QC_DLVREF_SRV` | LE | `C_DelivWthRefQuickCreate` POST | Outbound Delivery with reference | **Proven live** (delivery 13000526 created) |
| `MM_PUR_PO_MAINT_V2_SRV` | MM | 13 creatable entity sets + 57 POST actions (`C_PurchaseOrderTP`, items, notes, scheduling) | Purchase Order create/maintain | **Proven live** (POs created) |
| `MMIM_GR4PO_DL_SRV` | WM | `GR4PO_DL_Headers` + items, sub-items, serial numbers, batch create | Goods Receipt posting | **Proven live** (GR posted) |

### Implemented but Awaiting First Live POST

| Service | Module | Create Capability | App Usage | Pending |
|---|---|---|---|---|
| `SD_SOFM_CREDIT_BLOCK_SRV` | SD | `PostGoodsIssue(DeliveryNumber)` + credit release/reject actions (7 POST actions) | Post Goods Issue from delivery | **Code done**, awaiting supervised PGI on a picked delivery (candidate: 13000515) |
| `SD_CUSTOMER_INVOICES_CREATE` | SD | `CreateBillingDocuments(...)` + `GetBillingDocumentTypes(...)` | Create Billing Document | **Code done**, awaiting supervised billing test on a goods-issued delivery (candidate: 13000522) |

### Used for READ Only (Metadata Declares Creatable, Not Used for CREATE)

| Service | Module | Declared Create Capability | App Usage (READ only) | Pending |
|---|---|---|---|---|
| `SD_F1873_SO_WL_SRV` | SD | `C_SalesOrderWl_F1873` (creatable in metadata) | Sales order worklist + approval status lookup | No CREATE planned — worklist is read-only by design |
| `LO_BM_BATCH_SRV` | WM | 4 creatable entity sets + 34 POST actions (batch management) | Batch info lookup for GR/GI | No batch CREATE planned currently |
| `PACK_OUTBDLV_SRV` | EWM | 6 creatable entity sets + 9 POST actions (packing station) | Delivery packing info | Packing module not yet built |
| `PICKLIST_PAPER_SRV` | EWM | 5 creatable entity sets + 5 POST actions (pick confirmation) | Pick list info | Pick confirmation not yet built |
| `SIMPLE_INB_DLV_SRV` | EWM | 7 creatable entity sets + 9 POST actions (inbound delivery) | Inbound delivery info for GR | Inbound delivery management not yet built |
| `SD_SOF` | SD | `ItemCollection` + 4 POST actions (`CreateDeliveryForOrderItems`, `CheckATP`, `createInvoice`, `postToAccount`) | Delivery status lookup | Alternative delivery/billing path — not yet wired |
| `UI_RESERVATION_ITM_MNG_V2` | MM | 0 entity sets but 10 POST actions (`CreateDraft`, `MarkAsCompleted`, `Copy`, etc.) | Reservation lookup for Goods Issue | Reservation creation not yet built |

### Used for READ Only (Not Creatable per Metadata)

| Service | Module | App Usage | Notes |
|---|---|---|---|
| `C_PURCHASEORDER_FS_SRV` | MM | PO list/detail fact sheet | Read-only by metadata (`sap:creatable="false"`) |
| `C_STOCKQUANTITYVALUEBYTYPE_CDS` | MM | Stock quantity queries for GI | Read-only CDS view |
| `FAC_GL_JOURNALENTRY_VER_SRV` | FI | Journal entry items to verify | Read-only by metadata |
| `SD_F2369_INQY_FS_SRV` | SD | Sales inquiry fact sheet | Read-only |
| `SD_F2370_INQY_WL_SRV` | SD | Sales inquiry worklist | Read-only |
| `MMIM_MATERIAL_DATA_SRV` | MM | Material data for GI | Read-only |
| `MMIM_MULTIPLE_MATERIAL_SRV` | MM | Multiple material lookup | Read-only |
| `ZAPI_GETBUPA_SRV` | MD | Business partner lookup | Read-only custom service |

### Blocked — Not Registered on Gateway

| Service | Module | Needed For | Blocker | Ticket |
|---|---|---|---|---|
| `API_MATERIAL_DOCUMENT_SRV` | MM | Goods Issue movement 261 posting | **Not registered** — `/IWFND/MED/170` | [Item 2 in gateway ticket](file:///Users/khushaldhanani/Desktop/SAPS4HANA/SAPS4HANAFULLSTACK/docs/ticket-gateway-remediation-ds4.md) |
| `ZMMIM_MATDOC_SRV` | MM | Goods Issue (fallback) | Registered but returns **HTTP 501** `CREATE_ENTITY not implemented` | Not viable — use `API_MATERIAL_DOCUMENT_SRV` |

---

## Key Creatable Services NOT Yet Used by the App

### SD - Sales (38 additional creatable services)

| Service | Create Capability | Potential Use |
|---|---|---|
| `SD_SOFM_DELIVERY_SRV_01` | `CreateDeliveryForOrder`, `CreateDeliveryForOrderItems` | Alternative delivery creation path |
| `LE_SHP_QC_DLVNOREF_SRV` | `C_DelivWthoutRefQuickCreate` + items | Delivery without sales order reference |
| `SD_SOFM_INVOICE_SRV` | `createInvoice`, `postToAccount` | Simple billing from delivery |
| `SD_CUSTOMER_INVOICES_MANAGE` | `PostBillingDocumentToAccounting`, `CancelBillingDocument` | Billing follow-up actions |
| `SD_PRE_BIL_DOC_MANAGE` | `CreateBillingDocument(PreliminaryBillingDocuments...)` | Preliminary billing |

> [!WARNING]
> **Sales Quotation** (`API_SALES_QUOTATION_SRV`) and **Sales Contract** (`API_SALES_CONTRACT_SRV`) remain **blocked** — no system alias / not registered. Tracked in [gateway remediation ticket Items 1 and 4](file:///Users/khushaldhanani/Desktop/SAPS4HANA/SAPS4HANAFULLSTACK/docs/ticket-gateway-remediation-ds4.md).

### FI - Finance (121 creatable services — largest module)

| Service | Create Capability | Potential Use |
|---|---|---|
| `FAC_GL_JOURNALENTRY_MANAGE_SRV` | Journal entry header/item create + 40 POST actions | Manual journal entry posting |
| `FI_GL_JOURNALENTRY_POST_SRV` | Journal entry posting actions | G/L posting |
| `FAP_MANAGE_SUPPLIER_INVOICES_SRV` | Supplier invoice create (6 entity sets, 18 actions) | AP invoice management |
| `FAR_CUSTOMER_LINE_ITEMS_SRV` | Customer line item actions | AR processing |
| `FCLM_BAM_MONITOR_SRV` | Bank account monitoring actions | Cash management |

### MM - Purchasing (45 additional creatable services)

| Service | Create Capability | Potential Use |
|---|---|---|
| `MM_PUR_RFQ_MAINT_V2_SRV` | RFQ create/maintain (13 entity sets, 50 actions) | Request for Quotation |
| `MM_SUPPLIER_INVOICE_MANAGE` | Supplier invoice creation | **Blocked** — no system alias (Item 1 in ticket) |
| `MM_PUR_SOURCELIST_MANAGE_SRV` | Source list management | Sourcing |
| `MM_PUR_INFO_RECORDS_MANAGE_SRV` | Purchasing info record maintenance | Master data |

### LE - Shipping (4 creatable services)

| Service | Create Capability | Pending |
|---|---|---|
| `LE_SHP_DELIVERY_PICK` | Pick list confirmation actions | **Blocked** — no system alias (Item 1 in ticket) |
| `LE_SHP_OUTBOUND_DELIVERY_FS` | Delivery detail actions | **Blocked** — no system alias (Item 1 in ticket) |

---

## Blocked Services Summary (Gateway Remediation)

| Blocker | Count | Ticket Item | Key Services Affected |
|---|---|---|---|
| **No system alias** (`/IWFND/CM_COS/064`) | 74 (36 business-critical) | Item 1 | `API_SALES_ORDER_SRV`, `API_SALES_QUOTATION_SRV`, `LE_SHP_DELIVERY_PICK`, `LE_SHP_OUTBOUND_DELIVERY_FS`, `MM_SUPPLIER_INVOICE_MANAGE` |
| **Empty alias** (`/IWFND/CM_COS/002`) | 1 | Item 1b | `LE_SHP_OD_CREATE_SRV` |
| **Not registered** (`/IWFND/MED/170`) | 9+ | Item 2 | `API_MATERIAL_DOCUMENT_SRV` (critical for GI 261), `API_SALES_CONTRACT_SRV` |
| **V4 not published** (`/IWBEP/CM_V4_COS/014`) | Unknown | Item 3 | `ZUI_GI_ORDER_RSV_O4`, `API_SALESCONTRACT`, `UI_SALESCONTRACTMANAGE` |

---

## Pending Action Items

### Critical (Blocks Current Features)

| # | Action | Owner | Status |
|---|---|---|---|
| 1 | **Register `API_MATERIAL_DOCUMENT_SRV`** on Gateway | Basis team | Blocked — Goods Issue 261 cannot post |
| 2 | **Supervised PGI test** on delivery 13000515 | User/Dev | Code ready, needs explicit go-ahead |
| 3 | **Supervised billing test** on delivery 13000522 | User/Dev | Code ready, needs explicit go-ahead |

### Important (Unlocks New Capabilities)

| # | Action | Owner | Status |
|---|---|---|---|
| 4 | **Assign system aliases** for 36 business-critical services | Basis team | Ticket Item 1 raised |
| 5 | **Register `API_SALES_CONTRACT_SRV`** | Basis team | Ticket Item 4 raised |
| 6 | **Fix empty alias** on `LE_SHP_OD_CREATE_SRV` | Basis team | Ticket Item 1b raised |
| 7 | **Confirm V4 enablement** on DS4 hub | Basis team | Ticket Item 3 raised |

### Development Ready (No Blockers)

| # | Feature | Service | Notes |
|---|---|---|---|
| 8 | Delivery without reference | `LE_SHP_QC_DLVNOREF_SRV` | Metadata verified, untested |
| 9 | Credit release/reject | `SD_SOFM_CREDIT_BLOCK_SRV` | Actions available, untested |
| 10 | Billing follow-up (post to accounting, cancel) | `SD_CUSTOMER_INVOICES_MANAGE` | Metadata verified, untested |
| 11 | Preliminary billing | `SD_PRE_BIL_DOC_MANAGE` | Metadata verified, untested |
| 12 | RFQ management | `MM_PUR_RFQ_MAINT_V2_SRV` | 13 entity sets, 50 actions |
| 13 | Reservation management | `UI_RESERVATION_ITM_MNG_V2` | 10 POST actions |
| 14 | Inbound delivery management | `SIMPLE_INB_DLV_SRV` | 7 entity sets, 9 actions |
| 15 | Packing station | `PACK_OUTBDLV_SRV` | 6 entity sets, 9 actions |

---

## Environment Items (Person-Dependent)

| Item | Owner | Status |
|---|---|---|
| `S4_DIFFERENCE_STORAGE_TYPE` value | WM owner | Pending — needed for GI differences |
| `LOCAL_DEV_PASSWORD` in `.env.local` | Developer | Set per-session only |
| SAP AI Core `AICORE_SERVICE_KEY` | BTP admin | Placeholder only — NVIDIA fallback active |

---

> [!NOTE]
> **Files regenerated**: [`catalog-creatable.csv`](file:///Users/khushaldhanani/Desktop/SAPS4HANA/SAPS4HANAFULLSTACK/catalog-creatable.csv) (23 Sep 12:05 IST) and [`creatable-services.xlsx`](file:///Users/khushaldhanani/Desktop/SAPS4HANA/SAPS4HANAFULLSTACK/creatable-services.xlsx) (23 Sep 12:06 IST) — both from live SAP `$metadata`, 0 errors.
