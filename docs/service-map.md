# S/4HANA Service Map — verified

**System:** DS4 client 220 (`172.27.100.32:8000`)  
**Verified:** 18 September 2026, by fetching `$metadata` for every service and checking every
entity set against it. Generated from a scan of `srv/`, not written by hand.

Every row below was observed. Nothing is inferred from naming, documentation or the
service catalog alone. Where a fact was not measured, the cell says so.

## Services called from application code

| Service | Ver | Module | `$metadata` | Entity sets verified | Data present |
|---|---|---|---|---|---|
| `API_MATERIAL_DOCUMENT_SRV` | V2 | Goods Issue / Receipt | 403 /IWFND/MED/170 — NOT REGISTERED | `A_MaterialDocumentHeader` | not measured |
| `API_WAREHOUSE` | V2 | Purchase Order, Warehouse Cockpit | 200 | `Warehouse` | 1 (warehouse 0001 — SAP sample, no text/storage types) |
| `API_WAREHOUSE_ORDER_TASK` | V2 | Warehouse Cockpit | 200 | `CancelWarehouseTask`, `ConfirmWarehouseTaskExact`, `WarehouseOrder`, `WarehouseTask` | 0 |
| `API_WAREHOUSE_RESOURCE` | V2 | Warehouse Cockpit | 200 | `WarehouseResource` | 0 |
| `API_WAREHOUSE_STORAGE_BIN` | V2 | Warehouse Cockpit | 200 | `WarehouseStorageBin` | 0 |
| `API_WHSE_INBOUND_DELIVERY` | V2 | Goods Issue / Receipt, Warehouse Cockpit | 200 | `PostGoodsReceipt`, `WhseInboundDeliveryHead` | 0 |
| `API_WHSE_OUTB_DLV_ORDER` | V2 | Warehouse Cockpit | 200 | `PostGoodsIssue`, `WhseOutboundDeliveryOrderHead` | 0 |
| `C_PURCHASEORDER_FS_SRV` | V2 | Purchase Order, Warehouse Cockpit | 200 | `C_MM_StorLocValueHelp`, `C_PurchaseContractValHelp`, `C_PurchaseOrderFs`, `I_CostCenterVH`, `I_GLAccountStdVH`, `I_InternalOrderStdVH`, `I_MasterFixedAssetStdVH`, `I_ProfitCenterStdVH`, `I_WBSElementBasicDataStdVH` | not measured |
| `C_STOCKQUANTITYVALUEBYTYPE_CDS` | V2 | Goods Issue / Receipt | 200 | `C_STOCKQUANTITYVALUEBYTYPE` | stock rows returned (479,766 KG unrestricted for 1000000204) |
| `FAC_GL_JOURNALENTRY_VER_SRV` | V2 | Purchase Order | 200 | `C_GLJrnlEntryItemToBeVerified` | not measured |
| `LE_SHP_OD_LIST_SRV` | V2 | Warehouse Cockpit | 200 | `I_WarehouseStdVH` | not measured |
| `LE_SHP_WHSE_CLERK_OVP_SRV` | V2 | Warehouse Cockpit | 200 | `C_WhseClerkInbDeliv`, `C_WhseClerkOutbDeliv` | not measured |
| `LORD_ODATA_ORDER_SRV` | V2 | Sales Inquiry | 200 | — (no entity set in code) | not measured |
| `LO_BM_BATCH_SRV` | V2 | Goods Issue / Receipt | 200 | `I_Batch` | not measured |
| `MMIM_GR4PO_DL_SRV` | V2 | Goods Issue / Receipt, Purchase Order | 200 | `HMmimGr4inbdelSet`, `MMIMProductionOrderVH`, `PoHelpSet` | not measured |
| `MMIM_MATERIAL_DATA_SRV` | V2 | Goods Issue / Receipt | 200 | `MaterialHeaders`, `MaterialStorLocHelps` | not measured |
| `MM_PUR_PO_MAINT_V2_SRV` | V2 | Purchase Order | 200 | `C_MM_CompanyCodeValueHelp`, `C_MM_MaterialGroupValueHelp`, `C_MM_MaterialValueHelp`, `C_MM_PlantValueHelp`, `C_MM_StorLocValueHelp`, `C_MM_SupplierValueHelp`, `C_PurchasingGroupValueHelp`, `C_PurchasingOrgValueHelp` | not measured |
| `SD_F1873_SO_WL_SRV` | V2 | Purchase Order, Sales Inquiry | 200 | `C_SalesOrderWl_F1873` | not measured |
| `SD_F2369_INQY_FS_SRV` | V2 | shared / core | 200 | — (no entity set in code) | not measured |
| `SD_F2370_INQY_WL_SRV` | V2 | Purchase Order | 200 | `C_InquiryWL_F2370`, `I_Customer_VH` | not measured |
| `UI_RESERVATION_ITM_MNG_V2` | V2 | Goods Issue / Receipt, Purchase Order | 200 | `ReservationDocumentItem` | 10+ open items returned |
| `ZAPI_GETBUPA_SRV` | V2 | Purchase Order | 200 | `BusinessPartnerSet` | not measured |
| `PACK_OUTBDLV_SRV` | V2 | Goods Issue / Receipt | 200 | — (no entity set in code) | not measured |
| `PICKCART_SRV` | V2 | Warehouse Cockpit | 200 | `LogonRSRC`, `WarehouseTaskSet` | 0 (PickCartSet, WarehouseOrderSet, ShRsrcSet) |
| `PICKLIST_PAPER_SRV` | V2 | Goods Issue / Receipt | 200 | — (no entity set in code) | not measured |
| `SIMPLE_INB_DLV_SRV` | V2 | Goods Issue / Receipt | 200 | — (no entity set in code) | not measured |
| `WAREHOUSE_KPIS_SRV` | V2 | Warehouse Cockpit | 200 | `I_EWM_WhseProcTypeVH` | not measured |

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

*Internal Document / Confidential*