# S/4HANA Service Map — verified

**System:** DS4 client 220 (`172.27.100.32:8000`)  
**Verified:** 18 September 2026, by fetching `$metadata` for every service and checking every
entity set against it. Generated from a scan of `srv/`, not written by hand.

Every row below was observed. Nothing is inferred from naming, documentation or the
service catalog alone. Where a fact was not measured, the cell says so.

## Services called from application code

| Service | Ver | Module | `$metadata` | Entity sets verified | Data present |
|---|---|---|---|---|---|
|`API_MATERIAL_DOCUMENT_SRV`|V2|Goods Issue / Receipt|403 /IWFND/MED/170 — NOT REGISTERED|`A_MaterialDocumentHeader`| not countable (function import / needs key) |
|`API_WAREHOUSE`|V2|Purchase Order, Warehouse Cockpit|200|`Warehouse`| Warehouse: 1 |
|`API_WAREHOUSE_ORDER_TASK`|V2|Warehouse Cockpit|200|`CancelWarehouseTask`, `ConfirmWarehouseTaskExact`, `WarehouseOrder`, `WarehouseTask`| **0 rows** (filtered query confirms empty) |
|`API_WAREHOUSE_RESOURCE`|V2|Warehouse Cockpit|200|`WarehouseResource`| **0 rows** (filtered query confirms empty) |
|`API_WAREHOUSE_STORAGE_BIN`|V2|Warehouse Cockpit|200|`WarehouseStorageBin`| **0 rows** (filtered query confirms empty) |
|`API_WHSE_INBOUND_DELIVERY`|V2|Goods Issue / Receipt, Warehouse Cockpit|200|`PostGoodsReceipt`, `WhseInboundDeliveryHead`| **0 rows** (filtered query confirms empty) |
|`API_WHSE_OUTB_DLV_ORDER`|V2|Warehouse Cockpit|200|`PostGoodsIssue`, `WhseOutboundDeliveryOrderHead`| **0 rows** (filtered query confirms empty) |
|`C_PURCHASEORDER_FS_SRV`|V2|Purchase Order, Warehouse Cockpit|200|`C_MM_StorLocValueHelp`, `C_PurchaseContractValHelp`, `C_PurchaseOrderFs`, `I_CostCenterVH`, `I_GLAccountStdVH`, `I_InternalOrderStdVH`, `I_MasterFixedAssetStdVH`, `I_ProfitCenterStdVH`, `I_WBSElementBasicDataStdVH`| I_GLAccountStdVH: 33784, C_PurchaseOrderFs: 2780, I_CostCenterVH: 952, C_MM_StorLocValueHelp: 696, I_WBSElemen |
|`C_STOCKQUANTITYVALUEBYTYPE_CDS`|V2|Goods Issue / Receipt|200|`C_STOCKQUANTITYVALUEBYTYPE`| not countable (function import / needs key) |
|`FAC_GL_JOURNALENTRY_VER_SRV`|V2|Purchase Order|200|`C_GLJrnlEntryItemToBeVerified`| C_GLJrnlEntryItemToBeVerified: 174153 |
|`LE_SHP_OD_LIST_SRV`|V2|Warehouse Cockpit|200|`I_WarehouseStdVH`| I_WarehouseStdVH: 25 |
|`LE_SHP_WHSE_CLERK_OVP_SRV`|V2|Warehouse Cockpit|200|`C_WhseClerkInbDeliv`, `C_WhseClerkOutbDeliv`| C_WhseClerkOutbDeliv: 740, C_WhseClerkInbDeliv: 40 |
|`LORD_ODATA_ORDER_SRV`|V2|Sales Inquiry|200|— (no entity set in code)| not measured |
|`LO_BM_BATCH_SRV`|V2|Goods Issue / Receipt|200|`I_Batch`| I_Batch: 39989 |
|`MMIM_GR4PO_DL_SRV`|V2|Goods Issue / Receipt, Purchase Order|200|`HMmimGr4inbdelSet`, `MMIMProductionOrderVH`, `PoHelpSet`| PoHelpSet: 6112, MMIMProductionOrderVH: 891, HMmimGr4inbdelSet: 17 |
|`MMIM_MATERIAL_DATA_SRV`|V2|Goods Issue / Receipt|200|`MaterialHeaders`, `MaterialStorLocHelps`| **0 rows** — empty filtered and unfiltered (corrected 19-Sep-2026) |
|`MM_PUR_PO_MAINT_V2_SRV`|V2|Purchase Order|200|`C_MM_CompanyCodeValueHelp`, `C_MM_MaterialGroupValueHelp`, `C_MM_MaterialValueHelp`, `C_MM_PlantValueHelp`, `C_MM_StorLocValueHelp`, `C_MM_SupplierValueHelp`, `C_PurchasingGroupValueHelp`, `C_PurchasingOrgValueHelp`| C_MM_MaterialValueHelp: 151988, C_MM_SupplierValueHelp: 4376, C_MM_StorLocValueHelp: 696, C_MM_MaterialGroupVa |
|`SD_F1873_SO_WL_SRV`|V2|Purchase Order, Sales Inquiry|200|`C_SalesOrderWl_F1873`| C_SalesOrderWl_F1873: 883 |
|`SD_F2369_INQY_FS_SRV`|V2|shared / core|200|— (no entity set in code)| not measured |
|`SD_F2370_INQY_WL_SRV`|V2|Purchase Order|200|`C_InquiryWL_F2370`, `I_Customer_VH`| I_Customer_VH: 891, C_InquiryWL_F2370: 629 |
|`UI_RESERVATION_ITM_MNG_V2`|V2|Goods Issue / Receipt, Purchase Order|200|`ReservationDocumentItem`| ReservationDocumentItem: 14730 |
|`ZAPI_GETBUPA_SRV`|V2|Purchase Order|200|`BusinessPartnerSet`| BusinessPartnerSet: 6677 |
|`PACK_OUTBDLV_SRV`|V2|Goods Issue / Receipt|200|— (no entity set in code)| not measured |
|`PICKCART_SRV`|V2|Warehouse Cockpit|200|`LogonRSRC`, `WarehouseTaskSet`| **0 rows** (filtered query confirms empty) |
|`PICKLIST_PAPER_SRV`|V2|Goods Issue / Receipt|200|— (no entity set in code)| not measured |
|`SIMPLE_INB_DLV_SRV`|V2|Goods Issue / Receipt|200|— (no entity set in code)| not measured |
|`WAREHOUSE_KPIS_SRV`|V2|Warehouse Cockpit|200|`I_EWM_WhseProcTypeVH`| I_EWM_WhseProcTypeVH: 33 |

27 services. All entity sets listed were confirmed present in that service's
`$metadata` (function imports confirmed as function imports). The single exception is
`A_MaterialDocumentHeader`, which cannot be checked while its service is unregistered.

## Blocked

| Service | Observed | Meaning | Owner |
|---|---|---|---|
| `API_MATERIAL_DOCUMENT_SRV` | HTTP 403 carrying `/IWFND/MED/170` | Not registered on the hub. Not an authorisation fault. | Basis — `/IWFND/MAINT_SERVICE` |
| `ZUI_GI_ORDER_RSV_O4` | HTTP 404 | Not published. | ABAP/Basis — `/IWFND/V4_ADMIN` |

Either one unblocks goods issue movement 261. See `ticket-gateway-remediation-ds4.md`.

## EWM has no data

**Verified 19-Sep-2026 with a valid filter**, not an unfiltered count. `Warehouse eq '0001'` against
storage bins, warehouse orders and resources each returns `{"d":{"results":[]}}` — an empty result set,
not an error. Unfiltered zeros must always be re-tested with a valid filter before being believed —
though re-testing can also confirm the zero, as it did for `MMIM_MATERIAL_DATA_SRV` (see correction below).

`API_WAREHOUSE` returns exactly one warehouse, `0001` — the SAP-delivered sample, with no
text and no storage types. Storage bins, inbound deliveries, outbound deliveries, warehouse
orders, warehouse resources and every `PICKCART_SRV` set return **0 rows**.

The services respond; there is nothing behind them. The warehouse cockpit therefore cannot
be validated against real data, and field mappings in `EwmMapper.js` are unverifiable by
execution. AIL's live warehouse process is IM / Stock Room Management — movement 261 against
reservations at plant 1120, storage location CS01 — which is a different component.

## Declared but not called

`srv/external/` holds `.csn`/`.edmx` for `LORD_ODATA_ORDER_SRV`, which is no longer in
`cds.requires`; it is reached through raw `S4HttpClient` calls, so the local model is unused.

## How to re-verify

```bash
./verify-services.sh      # $metadata status per service
./verify-entitysets.sh    # every entity set the code calls
./verify-fields.sh        # field reads with no valid fallback
./audit-catalog.sh        # all 1,345 catalogued services
```

Re-run after any S/4HANA upgrade, Gateway transport or system refresh.

## Corrections

**19 September 2026 — `MMIM_MATERIAL_DATA_SRV` does not hold data.**
This map previously claimed the service "has data — requires a filter". That was an inference, and it
was wrong. Three independent observations contradict it:

1. `MaterialStorLocHelps?$filter=Material eq '1000000045'` through the application layer → `200`, **0 rows**,
   for a material that returned 2 batches on the same screen. Same for material 1000000458 (0 locations, 5 batches).
2. The full catalogue depth scan (19-Sep-2026, all 1,236 live services, 71,119 entity sets) counted both
   `MaterialHeaders` and `MaterialStorLocHelps` at **0**.
3. No filter combination tried has returned a row.

Consequence: the storage-location picker on the Goods Receipt screen has nothing to show, and no code
change fixes it. Either MM maintains this data or the field is removed from the screen.

**19 September 2026 — the EWM services are no longer called.**
The warehouse cockpit and RF terminal modules were removed (commits `95b8054`, `834816d`, `c4b2d48`)
after the scan confirmed 0 warehouse orders, 0 tasks, 0 resources and 0 outbound deliveries across all
26 warehouses, with 4 storage bins in total. The EWM rows above are retained as the evidence behind that
removal, not as a description of services in use.

**19 September 2026 — catalogue names differ from path names.**
The warehouse services are registered under `Z`-prefixed technical names (`ZAPI_WAREHOUSE`,
`ZAPI_WHSE_INBOUND_DELIVERY`, `ZPICKCART_SRV` …) on their original `/sap/opu/odata/sap/API_*` paths.
Matching the catalogue by service name rather than path makes them look absent when they are not.
`API_MATERIAL_DOCUMENT_SRV` is the only service the code references that is genuinely not in the catalogue.

*Internal Document / Confidential*
