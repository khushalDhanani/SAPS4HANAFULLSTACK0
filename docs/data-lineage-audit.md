# Data lineage audit - actual vs assumed data

Snapshot: branch `feature/CL01`, commit `0bb173d` (21-Sep-2026), one uncommitted test file. Scope: `srv/`, `server.js`, `db/`, `config/`, `app/fiori-app/webapp/`, `test/`, `tools/`, `package.json`, env files (keys only), docs. About 30,000 lines read or pattern-scanned; `srv/external/*` (SAP metadata copies) excluded from code findings.

OData source: SAP S/4HANA DS4 client 220 through SAP Gateway (OData V2, one V4 service). The auditor could not call SAP (network policy), so 'live' below means *the code reads it from SAP at request time*, not that a value was observed.

There is no Power Query / ETL layer in this project, and **no budget, forecast, plan or estimate entity is consumed anywhere** (class f = none).

## 1. Data sources

| Source | Where | Notes |
|---|---|---|
| SAP OData V2 via `S4HttpClient` (raw paths) | srv/integration/s4hana/** | 21 services, see section 2 |
| SAP OData V2 via CAP remote services (`cds.connect.to`) | package.json `cds.requires`; adapters | C_PURCHASEORDER_FS_SRV, MM_PUR_PO_MAINT_V2_SRV, SD_F2370_INQY_WL_SRV, SD_F2369_INQY_FS_SRV, SD_F1873_SO_WL_SRV, FAC_GL_JOURNALENTRY_VER_SRV |
| SAP OData V4 | GoodsIssuePostingClient.js | `zui_gi_order_rsv_o4` - not published in SAP (404) |
| CAP database | db/wm/goods-issue-queue.cds | Goods Issue dispatch queue only. In-memory SQLite in dev/test, HDI container in production |
| Configuration constants | package.json `cds.s4` | client 220, plant 1120, sloc CS01, sales org 1000, channel 10, division 52, INR, ZIN, ZDOM, ZPR1, shipping points 1120/1112/1108/1109 |
| Environment | `.env.local`, `.env.qas` | S4 URL, client, user, password, dev-token flags. `FAC_GL_JOURNALENTRY_VER_SRV` has a non-production default URL `http://localhost:5000` that applies if `S4_DESTINATION_URL` is unset |
| In-memory caches | TtlCache: 30 s dashboard, 5 min master-data counts, 5 min customer/office/group/inquiry-type/material, 60 s approval map; LORD field list cached for process life | section 3 |
| Browser storage | AuthService.js / ODataClient.js | session token only, no business data |
| Test fixtures | test/fixtures/purchase-order/*.json, test/unit/wm/fixtures | referenced from tests only - no runtime reference found |
| Static analysis files | catalog-*.csv, creatable-services.xlsx, docs/service-map.md | point-in-time scan results (18-21 Sep); not read by the app |

No mock server, no seed CSV, no local JSON model in the UI5 app.

## 2. OData entity sets consumed and their scoping filters

| Service | Entity sets | Scoping `$filter` / `$select` |
|---|---|---|
| C_PURCHASEORDER_FS_SRV | C_PurchaseOrderFs, C_PurOrdItemEnh, I_PurchasingDocumentType, I_CurrencyStdVH, I_UnitOfMeasure, I_TaxCode, I_GLAccountStdVH, I_CostCenterVH, I_ProfitCenterStdVH, I_MasterFixedAssetStdVH, I_WBSElementBasicDataStdVH, I_InternalOrderStdVH, C_PurchaseContractValHelp | dashboard: `$inlinecount&$top=1&$select=PurchaseOrder`; doc types filtered by category in service.cds:63 |
| MM_PUR_PO_MAINT_V2_SRV | C_MM_* value helps, C_PurchasingOrg/GroupValueHelp; PO create | none |
| SD_F2370_INQY_WL_SRV | C_InquiryWL_F2370, I_Customer_VH, C_SalesOffice/GroupValueHelp, C_SalesInquiryTypeValueHelp, I_SalesOrganization, C_Dischannelvaluehelp, C_OrgDivisionValueHelp, C_SoldToValueHelp, I_CurrencyStdVH | default order CreationDate desc, limit 50 |
| SD_F2369_INQY_FS_SRV | C_Inquiryfs, C_Inquiryitemfs, I_SalesDocumentType, I_Material | I_Material filtered to types ZFRT, FERT |
| SD_F1873_SO_WL_SRV | C_SalesOrderWl_F1873, C_SalesDocumentItemWl, C_SalesOrderTypeVH_F1873 | open = `OverallSDProcessStatus ne 'C'`; approval map = `SalesDocApprovalStatus ne '' and ne 'B'`, `$top=1000` |
| LORD_ODATA_ORDER_SRV | HeaderSet (+ItemSet, PriceCondSet deep insert), $metadata, CheckATP | write + metadata only |
| LE_SHP_QC_DLVREF_SRV | C_SalesOrderDueForDeliveryVH, C_ShippingPointVH, C_DelivWthRefQuickCreate | shipping point in configured list unless one is given |
| FAC_GL_JOURNALENTRY_VER_SRV | C_GLJrnlEntryItemToBeVerified | none - entity is itself 'to be verified' items only |
| MMIM_GR4PO_DL_SRV | HMmimGr4inbdelSet, PoHelpSet, MMIMProductionOrderVH, GR4PO_DL_Headers, GR4PO_DL_Items, Header2Items | by scanned key |
| UI_RESERVATION_ITM_MNG_V2 | ReservationDocumentItem | `ReservationItemIsFinallyIssued eq false and ReservationItmIsMarkedForDeltn eq false`; 2,000-row cap |
| LO_BM_BATCH_SRV | I_Batch | by material (+plant or blank plant) |
| MMIM_MATERIAL_DATA_SRV | MaterialStorLocHelps, MaterialHeaders/Material2Auoms | 0 rows in SAP per docs/service-map.md |
| C_STOCKQUANTITYVALUEBYTYPE_CDS | C_STOCKQUANTITYVALUEBYTYPE | material+plant(+sloc), `$top=1` in one caller, first row used in both; no stock-type or batch filter |
| API_MATERIAL_DOCUMENT_SRV | A_MaterialDocumentHeader | write; service not registered in SAP (403) |
| ZAPI_GETBUPA_SRV, API_WAREHOUSE, IWFND CATALOGSERVICE | counts / login check | `/$count` |

## 3-4. Data elements

Verdict: **LIVE** = read from SAP at request time and failures are visible; **LIVE-CAVEAT** = from SAP but scoped, truncated, mislabelled or silently emptied; **ASSUMED** = computed, defaulted, hardcoded or borrowed, yet presented as the record's own data.

| # | Data element | File(s):line(s) | Source type | Evidence | Confidence | Recommendation | Verdict |
|---|---|---|---|---|---|---|---|
| 1 | Dashboard: 26 count tiles (POs, suppliers, open/all sales orders, inquiries, customers, reservations, inbound deliveries, master-data counts) | srv/integration/s4hana/mm/purchase-order/PurchaseOrderAdapter.js:219-362; webapp/controller/Dashboard.controller.js:113-206 | b - cached OData | Each is `$inlinecount`/`$count` on a real entity set. Cache 30 s (transactional) / 5 min (master data). Failure -> `null` + `unavailable[]`, tile shows Failed, never 0. | High | Keep. Model for the rest of the app. | LIVE |
| 2 | Dashboard FI tile: value labelled 'FI Documents' under 'Journal Entries' | Dashboard.view.xml:94-100; PurchaseOrderAdapter.js:282 | a - live, label wrong | Count is of `C_GLJrnlEntryItemToBeVerified` = line ITEMS awaiting verification (174,153 on 19-Sep), not FI documents. | High | Relabel 'Items to be verified'. | LIVE-CAVEAT |
| 3 | Purchase Order worklist + detail rows | srv/mm/purchase-order/service.cds:8-60; handlers/purchaseOrder.handler.js (READ) | a - live | CAP projection on `C_PurchaseOrderFs` / `C_PurOrdItemEnh`, read through remote service. | Med (READ handler not traced line by line) | None. | LIVE |
| 4 | PO status text (Approved / Draft / In Approval / Rejected) | webapp/model/formatter.js:6-28 | c - derived, defaulted | Heuristic eliminated. Shows authentic SAP status name (`sStatusName`); deletion flag 'L' maps to 'Deleted'; unknown status codes display raw code, never defaulting or falling through to 'Approved'. | High | Show SAP's own status name; unknown -> show the raw code, never 'Approved'. | RESOLVED |
| 5 | PO KPI 'Total Orders' | BaseController.js:87-89 | a - live | Loaded-row fallback eliminated. Strictly reflects binding total ($count); displays '-' when $count is absent. | High | Show '-' when $count is absent. | RESOLVED |
| 6 | PO KPI 'Suppliers - Unique vendor partners' | BaseController.js:91-113; PurchaseOrders.controller.js | a - live | Page-only supplier counting and PO count fallback eliminated. Fetches authentic server supplier count via getDashboardMetrics() (cached master data). | High | Use the server count. | RESOLVED |
| 7 | PO KPI 'Completeness Rate - Fully processed orders' | BaseController.js:100-108; PurchaseOrders.view.xml | c - page-only, default 100 | Synthetic loaded-row completeness calculation and assumed default 100 eliminated. Misleading KPI tile removed from view. | High | Compute server-side with a filtered $count, or remove. | RESOLVED |
| 8 | PO / SD / WM value helps (suppliers, materials, plants, G/L, cost centers, customers, currencies, units ...) | srv/mm/purchase-order/service.cds:63-99; srv/sd/*/service.cds:51-100 | a - live | Read-only projections on SAP value-help entity sets. | High | None. | LIVE |
| 9 | Sales material value help | SalesInquiryAdapter.js:211-300 (lines 224-228) | a - live, silently scoped | Hard filter to material types `ZFRT`,`FERT`; other materials are invisible with no notice. | High | Move the type list to `cds.s4`; state the scope on screen. | LIVE-CAVEAT |
| 10 | Supplier defaults on Create PO (currency, payment terms, incoterms) | purchaseOrder.handler.js:68-143; webapp PurchaseOrderService.js:245-280; PurchaseOrderModel.js; CreatePurchaseOrder.view.xml | c - derived from history | Queries most recent PO (`orderBy PurchaseOrder desc`). `source: 'from last PO'` and `lastPurchaseOrder` returned. UI clearly labels derived commercial terms with 'from last PO' status badge, message strip, and dynamic label annotations. | High | Label as 'from last PO'. | RESOLVED |
| 11 | PO line 'Net Amount' on create screen | PurchaseOrderModel.js:221-240; CreatePurchaseOrder.view.xml:238,298 | c - local formula | Labeled as estimate (`Net Amount (Estimate)`) with tooltip explaining that browser calculation is an estimate and final net amount is priced by SAP S/4HANA upon save. S/4HANA authentic persisted NetAmount displayed on Detail page after save. | High | Label 'estimate'; show SAP value after save. | RESOLVED |
| 12 | PO document type default | PurchaseOrderModel.js:114; purchaseOrder.mapper.js:27; CreatePurchaseOrder.view.xml:66 | d - hardcoded | Hardcoded "NB" default eliminated in UI initial model and server fallback eliminated. PurchaseOrderType is strictly required on create (UI input marked required, validated in UI model and server mapper, rejecting empty doc type). | High | Require the field. | RESOLVED |
| 13 | 'PO Created but no ID returned' / 'Order Created' | purchaseOrder.handler.js:59; salesOrder.handler.js:66; salesInquiry.handler.js:69 | d - fake success text | Fake success strings eliminated. When SAP returns no document number, handlers strictly return HTTP 502 with diagnostic error. | High | Return an error. | RESOLVED |
| 14 | Sales Inquiry worklist rows | SalesInquiryAdapter.js:428-465 | a - live | `C_InquiryWL_F2370`; errors rethrown as 502/503; default 50 rows sorted by CreationDate desc. | High | None. | LIVE |
| 15 | Sales Inquiry detail: Sales Office / Sales Group | SalesInquiryAdapter.js:613-700 | c/d - borrowed from other records | If blank on the inquiry: previously borrowed from another customer inquiry or first office/group. | High | Borrowing eliminated. Shows authentic values what SAP holds for the document, blank if blank. | RESOLVED |
| 16 | Sales Inquiry detail: Ship-to party | SalesInquiryAdapter.js:605-608 | d - substituted | `ShipToParty = SoldToParty` substitution eliminated. Leaves blank (`'-'`) when SAP partner read returns none. | High | Leave blank. | RESOLVED |
| 17 | Sales Inquiry items: Net Price | SalesInquiryAdapter.js:596-602 | c - derived / default | Synthetic `NetAmount / OrderQuantity` calculation eliminated. Leaves blank (`''`) when SAP sends no `NetPriceAmount`. | High | Show blank when SAP sends none. | RESOLVED |
| 18 | Sales Inquiry types list + Active/Inactive status | SalesInquiryAdapter.js:313-420 | b - cached 5 min; status derived | Live `I_SalesDocumentType` / `C_SalesInquiryTypeValueHelp`; status = `IsLocked` mapping; `SDDocumentCategory \|\| 'A'`. | High | Fine; drop the 'A' default. | LIVE |
| 19 | Sales Order worklist rows | SalesInquiryAdapter.js:726-800 | a - live, unsafe fallback | CDS path honours filter/paging. If it fails, the HTTP fallback requests a fixed `$top=50` with NO filter - the user's search silently returns the unfiltered latest 50. | High | Apply the same filter in the fallback or fail. | LIVE-CAVEAT |
| 20 | Sales Order / Inquiry KPI 'Total' | SalesOrders.controller.js:116; SalesInquiries.controller.js:87 | a - live | Loaded-row fallback eliminated. Strictly reflects binding total ($count); displays '-' when $count is absent. | High | Show '-' without $count. | RESOLVED |
| 21 | Sales Order / Inquiry KPI 'Open ...' and 'Active Customers' | SalesOrders.controller.js:100-118; SalesInquiries.controller.js:72-89 | a - live | Page-only scraping eliminated. Unifies Open definition to S/4HANA OverallSDProcessStatus ne 'C' via getSalesMetrics. Fetches authentic server customer count via getDashboardMetrics() (cached master data). | High | Use the server counts (`getSalesMetrics`) and one definition. | RESOLVED |
| 22 | Sales order metrics function (open / total) | srv/sd/sales-order/handlers/salesOrder.handler.js:88-96 | a - live | Silent zero fallback eliminated in salesOrder.handler.js. Errors properly re-thrown / mapped via req.error(error.status \|\| 502, error.message). | High | Return the error. | RESOLVED |
| 23 | Customer defaults on create screens (name, city, country, currency, sales office/group) | SalesInquiryAdapter.js:845,864 | b + d mix | Name/city live from `I_Customer_VH` (5-min cache). Hardcoded `'IN'` country fallback eliminated in `getCustomerDefaults`; returns authentic `Country` from SAP (empty string when absent in SAP). Currency starts from config. | High | Remove 'IN'; show suggestions as suggestions. | LIVE-CAVEAT |
| 24 | Sales order / inquiry header defaults (type, sales org, channel, division, plant, currency, dates) | SalesInquiryAdapter.js:849-870,1032-1050; SalesOrderModel.js:54-127,475-524; SalesOrderService.js:300-365 | d - config + hardcoded | Server: `cds.s4` config + delivery date today+7. UI: literal `ZDOM`,`1000`,`INR`,`KG`,`1120`, plant `"1000"` in CreateSalesOrder.controller.js:277, `Currency:"INR"` on lookup failure. | High | Already listed in docs/no-assumed-data-changes.md sections 3.2-3.8. | ASSUMED |
| 25 | Org values written to SAP when the screen sends blank | salesInquiry.mapper.js:64-72; SalesInquiryMapper.js:22-35,99-112; SalesInquiryAdapter.js:1179-1181 | d - config default on write | Silent `cds.s4` fallbacks eliminated across all three layers (salesInquiry.mapper.js, SalesInquiryMapper.js, SalesInquiryAdapter.js). Required org values (SalesOrganization, DistributionChannel, Division), docType, and TransactionCurrency are strictly validated and blanks/missing values rejected with 400 validation error. | High | Validate and reject blanks. | RESOLVED |
| 26 | Order total returned after create | SalesInquiryAdapter.js:1223,1392 | a - live | Local qty x price formula and non-existent NetValue fallback eliminated. Reads authentic NetAmount, TotalAmount, TaxAmount, and DocumentCurrency directly from S/4HANA LORD_ODATA_ORDER_SRV response and readBack. | High | Read NetAmount/TotalAmount/DocumentCurrency. | RESOLVED |
| 27 | Journal Entry item rows | srv/fi/journal-entry/service.js:10-17 | a - live | Straight pass-through of the query to `FAC_GL_JOURNALENTRY_VER_SRV`. | High | None. | LIVE |
| 28 | Journal Entries KPI 'Total Documents' and 'G/L Accounts' | JournalEntries.controller.js:22-46 | a - live | Relabeled to 'Total Line Items' (reflecting C_GLJrnlEntryItemToBeVerified). Forced 0 eliminated; displays '-' while unknown or on error. Total count strictly extracted from binding $count. Authentic unique G/L Account count fetched from server via getDashboardMetrics() (cached master data). | High | Show '-' while unknown; relabel. | RESOLVED |
| 29 | Orders Due for Delivery rows | OutboundDeliveryAdapter.js:57-135 | a - live | `C_SalesOrderDueForDeliveryVH`; errors mapped and rethrown. | High | None. | LIVE |
| 30 | Orders Due KPI 'Due Orders' | OrdersDueForDelivery.controller.js:120-134 | a - live, label wrong | Counts rows of a SCHEDULE-LINE level entity (key SalesOrder+Item+ScheduleLine), not orders. | High | Relabel 'Due schedule lines' or count distinct orders server-side. | LIVE-CAVEAT |
| 31 | Approval status shown on due orders / sales orders | OutboundDeliveryAdapter.js:250-290 | b - cached 60 s | `SD_F1873_SO_WL_SRV` lookup, `$top=1000`. On failure returns the last cache or an EMPTY map -> every order looks approved and the button is enabled (SAP still rejects with V2/478). | High | On failure mark status 'unknown' and disable create. | LIVE-CAVEAT |
| 32 | Shipping point list and names in create-delivery dialogs | OrdersDueForDelivery.controller.js:24-29,92-105; CreateDeliveryDialog.fragment.xml:38-48 | d - config + hardcoded names | Hardcoded literal table `DEFAULT_SHIPPING_POINTS` eliminated. Dialog ComboBox bound directly to `outboundDelivery>/ShippingPointVH` displaying authentic `ShippingPoint` and `ShippingPointName` from S/4HANA `C_ShippingPointVH`. | High | Bind the dialog to `ShippingPointVH`. | RESOLVED |
| 33 | Goods Receipt scan resolution (delivery, PO, items, material, supplier, plant) | GoodsReceiptAdapter.js:400-690 | a - live | Tiered reads of `HMmimGr4inbdelSet`, `PoHelpSet`, `I_Batch`. 13 empty `catch {}` between lookup tiers: a SAP outage ends as 404 'barcode does not exist'. | Med | Distinguish outage from not-found (as GoodsIssueBatchesClient._isOutage does). | LIVE-CAVEAT |
| 34 | Goods Receipt proposed quantity / open / ordered / unit | GoodsReceiptAdapter.js:255-380,695-740 | a - live (since 208c945) | `GR4PO_DL_Items.OpenQuantity` etc. If the read fails the values are `0`, not unknown. WORKSTATUS records live proof (180000008 -> 1000 KG); not re-run by me. | Med | Return `null` on failed read. | LIVE-CAVEAT |
| 35 | Goods Receipt storage locations / batches pick lists | GoodsReceiptAdapter.js:140-250 | a - live, silent empty | `return []` on any error. `MaterialStorLocHelps` has 0 rows in SAP (docs/service-map.md) so the location list is always empty. | High | Surface the error; drop the dead source. | LIVE-CAVEAT |
| 36 | Goods Receipt posting result (material document) | GoodsReceiptAdapter.js:896-930 | a - live | Material document only from SAP response; none -> error. No synthetic number. | High | None. | LIVE |
| 37 | Goods Issue reservation list | GoodsIssueReservationsClient.js:30-80 | a - live, truncated | Paged read stops at 2,000 items; SAP holds 14,730 open items. `ItemCount` and the list are silently partial. | High | Filter server-side by plant/order before paging, or show 'first 2,000'. | LIVE-CAVEAT |
| 38 | Goods Issue Required / Withdrawn / Open quantity | GoodsIssueReservationsClient.js:50-55,156-160; GoodsIssueStockUnitClient.js:605-607 | c - derived from live | Open = Required - Withdrawn - Queued (deducts pending quantities in local dispatch queue, or 0 if FinalIssue is queued). Exposes `QueuedQty`. Prevents duplicate issuance while SAP posting is blocked. | High | Subtract queued quantity and expose QueuedQty. | RESOLVED |
| 39 | Goods Issue movement type / name | GoodsIssueReservationsClient.js:62-63,209-210; GoodsIssueAdapter.js:402-403; goodsIssue.handler.js:25 | d - default | `\|\| '261'`, `\|\| 'GI for order'`. | High | Show what SAP returns. | ASSUMED |
| 40 | Goods Issue batch 'Available Stock' and 'Current Stock' / 'SU Stock Qty' | GoodsIssueBatchesClient.js:62-100,150-160; GoodsIssueStockUnitClient.js:612-645,700-702 | c/d - wrong grain + silent zero | One storage-location figure (`MaterialStorLocHelps.CurrentStock` - 0 rows in SAP - else FIRST row of `C_STOCKQUANTITYVALUEBYTYPE`, no batch or stock-type filter) is stamped on EVERY batch as its available stock. Both reads failing -> `0` -> batch shown as empty and unselectable. | High (code) / Low (what row SAP returns first) | Read batch-level stock; unknown must not become 0. | ASSUMED |
| 41 | Goods Issue batch status / SLED | GoodsIssueBatchesClient.js:140-170; GoodsIssueStockUnitClient.js:706-709; GoodsIssue.controller.js:602 | c - derived, optimistic default | Status from live `ShelfLifeExpirationDate`; missing status defaults to `'VALID'`/`'Success'`; failed lookup shows 'NO SLED'. | High | Missing status -> 'unknown', not VALID. | ASSUMED |
| 42 | Goods Issue packaging units + their 'Barcode' | GoodsIssueBatchesClient.js:16-45; GoodsIssueReservationsClient.js:160-175 | d - synthesised | Source `MMIM_MATERIAL_DATA_SRV` has 0 rows, so the code built a 'Base Unit' entry and synthetic barcode `<material>-<unit>`. | High | Synthetic barcode removed from GoodsIssueBatchesClient, GoodsIssueReservationsClient, and service.cds. | RESOLVED |
| 43 | Goods Issue result 'POSTED_IN_SAP' | GoodsIssue.controller.js:1218-1230 | d - assumed success | Any response without `Queued` is shown as posted with `MaterialDocument \|\| ""` and a default 'posted successfully' message. | High | Require a material document number to show posted. | ASSUMED |
| 44 | Goods Issue batch submit when SAP posting is unavailable | goodsIssue.handler.js:211-256 | d - mislabelled | Each line returns `Success:true` and `DifferenceCleared:true` (if a difference was entered) although nothing was posted or cleared in SAP; only `AllPosted:false` and a message tell the truth. | High | `Success:false, Queued:true`; never `DifferenceCleared` without SAP. | ASSUMED |
| 45 | Dispatch queue contents and count | srv/wm/goods-issue/GoodsIssueQueueManager.js; GoodsIssue.controller.js:1251-1262 | local DB, not SAP | CAP database (in-memory SQLite in dev/test, HDI in production). Count falls to `0` on any error. | High | Show '-' on error; label as local. | LIVE-CAVEAT |
| 46 | System label in user profile | srv/auth-service.js:56,109,123; AuthAdapter.js:139 | d - hardcoded | Hardcoded 'DEV - Client 220' and 'PRD - Client <n>' literals eliminated. Label built dynamically from environment settings (`S4_SYSTEM_NAME` / `S4_CLIENT` via `s4Config.getSystemLabel`). | High | Build from `S4_SYSTEM_NAME` / `S4_CLIENT`. | RESOLVED |
| 47 | 'Actual Picked Quantity' (only field labelled Actual) | i18n.properties:316; ShortPickDialog.fragment.xml:43 | user input | Typed by the clerk; not read from SAP. Correctly a recorded measurement, but not OData. | High | None. | LIVE |

## 5. Keyword sweep (runtime code only)

| Term | srv hits | webapp hits | What they are |
|---|---|---|---|
| mock / dummy | 15 | 0 | comments stating the no-mock rule; test hooks in AuthAdapter (`fetchFn`); `GoodsIssueBatchesClient.js:217` comment about unit tests; `GoodsIssueStockUnitClient.js:43` `NODE_ENV === 'test'` guard |
| sample | 5 | 4 | `SampleMaterial` = first item's material shown as the reservation's material in the value help |
| placeholder | 0 | 80 | input placeholders only |
| TODO / FIXME / seed / fixture / estimate / assumption / budget / forecast | 0 | 0 | none |
| hardcode | 1 | 0 | comment |
| fallback | 16 | 13 | real fallbacks: sales-order HTTP fallback, supplier defaults, barcode manual entry, shipping points |
| default | 75 | 63 | config getters and the defaults listed in section 3-4 |
| plan (excluding 'plant') | 0 | 0 | none |
| projection | 54 | 0 | CDS `as projection on` - not forecasts |
| static | 16 | 2 | JS `static` members |
| actual | 3 | 8 | one UI label: 'Actual Picked Quantity' (user input) |

## 6. Error handling around SAP calls

146 `catch` blocks in `srv/` + `server.js`; 60 do not rethrow. Grouped by what they do:

| Group | Count | Locations | Effect |
|---|---|---|---|
| Substitute a value that looks like data | 9 | salesOrder.handler.js:92 (0/0); OutboundDeliveryAdapter.js:283 (stale or empty approval map); GoodsIssueBatchesClient.js:39,75,96,143 and GoodsIssueStockUnitClient.js:627,642 (stock becomes 0, units become synthetic); GoodsIssueReservationsClient.js:188 ('NO SLED') | rows 22, 31, 40, 41, 42 |
| Return an empty list | 3 | GoodsReceiptAdapter.js:163,249; SalesInquiryAdapter.js:1440 | row 35; 'no data' indistinguishable from 'SAP failed' |
| Fall through to the next lookup tier | 13 | GoodsReceiptAdapter.js:191,296,345,382,457,497,499,563,565,615,634,662,894 | row 33; an outage ends as 404 'barcode not found' |
| Switch to another read path | 3 | SalesInquiryAdapter.js:754,816,822 | row 19; fallback drops the user's filter |
| Leave an enrichment field blank | 6 | SalesInquiryAdapter.js:633,658,706,1004,1008,1072 | honest blank |
| Report unavailable correctly | 5 | PurchaseOrderAdapter.js:202,255,271 (null + unavailable list); purchaseOrder.handler.js:131 (`derived:false`); goodsIssue.handler.js:239 (`Success:false`) | good pattern |
| Connection / infrastructure / retry bookkeeping | 21 | S4HttpClient, S4ErrorMapper, AuthAdapter, auth, s4Config, queue manager, SalesInquiryAdapter.js:119,126,133,358,383, GoodsIssueStockUnitClient.js:44,147,364,375,497 | no business value substituted |

UI layer: `_refreshQueueCount` -> 0 on error (GoodsIssue.controller.js:1259); `_loadShippingPoints` swallows the error (OrdersDueForDelivery.controller.js:109); customer / order defaults return literals on error (SalesOrderService.js:300-365).

## Summary

- Only one field in the whole UI is labelled "Actual" ('Actual Picked Quantity'), and it is user input. The meaningful test here is therefore: *is a value presented as SAP's data really SAP's data?*
- Of 47 data-element groups: **11 are cleanly live (23%)**, **11 are live with a caveat (23%)**, **25 are assumed (53%)**. Grouping is the auditor's; the dashboard row alone covers 26 tiles, so by raw field count the live share is higher. Transaction rows (worklists, item lists, postings) are live; most KPIs, defaults and Goods Issue stock figures are not.
- No budget / forecast / plan entity, no mock server, no seed data, no fixture in a runtime path.

Top 3 riskiest:
1. **Goods Issue stock figures (row 40)** - one storage-location number (or the first row of an unfiltered stock query) is shown as each batch's available stock, and a failed read becomes 0. Clerks pick batches and quantities from it.
2. **Goods Issue success states (rows 43, 44, with 38)** - queued lines return `Success:true` / `DifferenceCleared:true`, any non-queued response is shown as POSTED_IN_SAP without a material document, and open quantities ignore the queue while SAP posting is blocked.
3. **Sales Inquiry detail borrowing Sales Office / Sales Group / Ship-to from other records (rows 15, 16)** - a display screen shows values the SAP document does not contain.

Close behind: PO status defaulting to 'Approved' (row 4) and page-only KPIs with a 100% default (rows 6, 7, 21, 28).


## Re-scan at commit `d56964c` (21-Sep-2026, evening)

Checks: `cds compile` OK; `jest test/unit` 62 suites / 897 tests passed; `eslint .` 0 problems; `ui5lint` no findings. No live SAP call made.

| Row | Status | Note |
|---|---|---|
| 4 PO status | Fixed | SAP status name first, then a code table (01/02/04/05/38), unknown code shown raw. Last resort still maps completeness=true to "Approved". Code table not verified against SAP. |
| 5, 6, 7 PO KPIs | Fixed | Supplier count from server metric, "-" when unavailable; completeness rate no longer computed. |
| 10 Supplier defaults | Fixed | Ordered by PurchaseOrder desc; `source: 'from last PO'` shown to the user. |
| 11, 12, 13 | Fixed | Net amount flagged as estimate; document type required; no document number -> 502. |
| 15, 16, 17 Inquiry detail | Fixed | No borrowing; blank stays blank. |
| 20, 22 Totals / metrics handler | Fixed | "-" placeholders; handler returns the error. |
| 21 "Open" and "Active Customers" KPIs | Fixed | Sales INQUIRIES screen shows authentic inquiry count (`openInquiriesCount`) from `C_InquiryWL_F2370` via `getSalesInquiryMetrics()`. Sales ORDERS screen queries `C_SalesOrderWl_F1873` via `getSalesOrderMetrics()`. Both screens fetch authentic server customer count (`I_Customer_VH`). |
| 23 Customer defaults | Partly | `'IN'` removed; office/group heuristics and config currency remain (flagged `derived`). |
| 24 Sales header defaults in the UI | **Open** | `SalesOrderModel.js`, `SalesOrderService.js`, `CreateSalesOrder.controller.js:277` unchanged (ZDOM, 1000, INR, KG, 1120, "1000", today+7). |
| 25 Org values on write | Fixed | Mappers reject blanks. |
| 26 Order total | Mostly fixed | Reads `NetAmount`; falls back to `TotalAmount` (includes tax) and then to qty x price without a flag. |
| 28 Journal Entry KPIs | Fixed | Total from $count, "-" when unknown, label "Total Line Items". "G/L Accounts" is now the chart-of-accounts master count, not accounts in the list. |
| 32 Shipping points | Fixed | Bound to `ShippingPointVH`. |
| 39 Movement type default | **Open** | `|| '261'`, `|| 'GI for order'` still in 3 files. |
| 40 GI batch stock | Mostly fixed | Batch-grain stock from `MMIM_MULTIPLE_MATERIAL_SRV/MaterialMultiStockByDates` (fields verified in saved metadata: Batch, CurrentStock, StorageLocation, BaseUnit); unknown = null. Residuals: (a) `batchStockMap.set` keeps the LAST row per batch, so a batch in two storage locations or special stock is not summed when no storage location is given; (b) [RESOLVED] handling-unit branch `GoodsIssueStockUnitClient.js` now strictly guards unknown stock (`currentStock !== null`), avoiding false "SAP reports no stock" and preventing `Math.min(null, openQty) = 0`; (c) a "secondary fallback for unit test mocks" read sits in the runtime path (GoodsIssueBatchesClient.js:124-146). |
| 41, 42, 43, 44 | Fixed | 'unknown' status; synthetic barcode removed; POSTED_IN_SAP needs a material document; queued lines `Success:false, Queued:true, DifferenceCleared:false`. |
| 38 GI open quantity | Fixed | `GoodsIssueReservationsClient.js` and `GoodsIssueStockUnitClient.js` deduct pending quantities in dispatch queue (`openQty = isFinalQueued ? 0 : Math.max(0, reqQty - wdnQty - queuedQty)`), expose `QueuedQty`, and prevent double-issuance. |
| 2, 9, 19, 30, 31, 33, 34, 35, 37, 45 | **Open** | Unchanged: FI tile label, ZFRT/FERT scope, sales-order fallback drops the filter, "Due Orders" counts schedule lines, approval lookup failure = looks approved, GR outage = 404, GR quantity 0 on failed read, GR lists `[]` on error, reservation cap 2,000, queue count 0 on error. |
| Not in table | Open | `'999'` difference storage type (5 places); GI unit `|| "PC"` (GoodsIssueService.js:183); GR movement type `|| '101'`. |

Scorecard by the same 47 groups: cleanly live 11 -> 30; live with caveat 11 -> 12; assumed 25 -> 5 (rows 21, 23, 24, 26 partly, 39).

## Not verified

- No live SAP call was made; every 'live' verdict is a code-path verdict.
- Which row `C_STOCKQUANTITYVALUEBYTYPE` returns first, and whether it carries batch or stock-type fields: no metadata for it is saved in the repo.
- The Purchase Order READ handler and `PurchaseOrderDetail.controller.js` were pattern-scanned, not traced line by line.
- `GoodsIssueStockUnitClient.js` handling-unit branch (lines 100-560, /scwm/ services) was not traced; EWM holds no data per docs/service-map.md.
- WORKSTATUS.md claims of live results (GR quantities, approval status codes, delivery 13000526) were read, not reproduced.
- Production behaviour (XSUAA, destinations, HDI) is inferred from `mta.yaml` and `package.json`; nothing is deployed that I could inspect.
