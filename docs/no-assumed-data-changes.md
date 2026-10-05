# No assumed data — actual source for every remaining assumed value

Scanned at commit `e0c8796` (21-Sep-2026). "Verified" = the field/entity exists in the service
metadata saved in this repo (`srv/external/*.edmx`, `docs/delivery-metadata/*.xml`) or the row count
comes from `catalog-data-reality-classified.csv` (19-Sep scan). "Not verified" = no metadata in the
repo proves it yet; do one GET before coding.

Rule: missing value -> show empty / block Save with a field error. Never substitute.

## 1. Goods Receipt

| # | Assumed today | Where | Actual source | Change |
|---|---|---|---|---|
| 1.1 | `Quantity: 10` (every scan proposes 10) | `srv/integration/s4hana/wm/GoodsReceiptAdapter.js:582` | `MMIM_GR4PO_DL_SRV` entity `GR4PO_DL_Item`: `OpenQuantity` + `UnitOfMeasure` (also `OrderedQuantity`/`OrderedQuantityUnit`, `QuantityInEntryUnit`/`EntryUnit`). Verified in metadata. Neither `HMmimGr4inbdelSet` nor `PoHelpSet` has any quantity field (verified), so the item entity is the only source. | Read `GR4PO_DL_Headers('<InboundDelivery>')/Items` (navigation name: confirm in $metadata), take the item matching `DeliveryDocumentItem`, return `OpenQuantity`/`UnitOfMeasure`. If the read fails return `Quantity: null` and let the user type it. Delete the literal 10. |
| 1.2 | `Number(oSU.Quantity) \|\| 1` | `GoodsReceipt.controller.js:273` | same as 1.1 | Remove `\|\| 1`; empty quantity = field error, Post disabled. |
| 1.3 | `DeliveryDocumentItem \|\| "000010"`, `PurchaseOrderItem \|\| "00010"` | `GoodsReceipt.controller.js:259,261` | `HMmimGr4inbdelSet.DeliveryDocumentItem` / `.PurchaseOrderItem`, `PoHelpSet.PurchaseOrderItem` (verified; backend already returns them). | Remove both fallbacks. Empty item = error "SAP returned no item for this scan", block Post. |
| 1.4 | `Unit \|\| "KG"` | `GoodsReceipt.controller.js:274` | `GR4PO_DL_Item.UnitOfMeasure` / `EntryUnit` / `MaterialBaseUnit`; second source `MM_PUR_PO_MAINT_V2_SRV/C_MM_MaterialValueHelp.MaterialBaseUnit` (verified, 151,988 rows). | Remove fallback; backend fills from the item read in 1.1. |
| 1.5 | `'Material ' + id`, `'Plant ' + id` as names (18 places) | `GoodsReceiptAdapter.js` | `DeliveryDocumentItemText`, `PurchaseOrderItemText`, `PlantName` on the same entities; `C_MM_MaterialValueHelp.MaterialName`, `C_MM_PlantValueHelp` (verified). | Return `''` when SAP sends no text. The UI already shows the number. |
| 1.6 | Storage location falls back to `cds.s4.storageLocation` (CS01) | `GoodsReceiptAdapter.js:543` | `GR4PO_DL_Item.StorageLocation` / `StorageLocationName` / `WarehouseStorageBin` (verified). Note: `MMIM_MATERIAL_DATA_SRV/MaterialStorLocHelps` has 0 rows (service-map.md), so today the fallback fires on EVERY scan. | Take storage location from the item read in 1.1; if empty leave empty and make the user pick. Config value only as a visible, editable suggestion flagged `derived: true`. |

## 2. Goods Issue

| # | Assumed today | Where | Actual source | Change |
|---|---|---|---|---|
| 2.1 | `Unit \|\| "PC"` | `GoodsIssueService.js:183` | `UI_RESERVATION_ITM_MNG_V2/ReservationDocumentItem.BaseUnit` (14,730 rows; backend already reads it). | Remove fallback; reject when empty. |
| 2.2 | `DifferenceStorageType \|\| '999'` (5 places: `GoodsIssuePostingClient.js:24`, `goodsIssue.handler.js:225`, `GoodsIssue.controller.js:1128`, `GoodsIssueService.js:187,250`) | — | Not verified. No SAP read in the repo returns this value; 999 is a convention, not data. | Ask the warehouse/SAP WM owner for the real value, put it once in `cds.s4` (explicit config), remove the 5 literals. Send it only when a difference quantity exists. |

## 3. Sales Order / Sales Inquiry

| # | Assumed today | Where | Actual source | Change |
|---|---|---|---|---|
| 3.1 | Total = quantity x price; fallback reads `d.NetValue` and `d.Currency` | `SalesInquiryAdapter.js:1176-1177, 1345-1346` | `LORD_ODATA_ORDER_SRV` `Header`: `NetAmount`, `TaxAmount`, `TotalAmount`, `DocumentCurrency` (verified). `NetValue` and `Currency` do NOT exist in the metadata (0 matches) — the current fallback can never return a value. | Return `NetAmount`/`TotalAmount`/`DocumentCurrency` from the create response (or one GET `HeaderSet('<id>')` after create). `null` if SAP sends none. Delete the local sum. |
| 3.2 | Unit `\|\| "KG"` | `SalesOrderModel.js:205`, literals at 92,126 | `C_MM_MaterialValueHelp.MaterialBaseUnit` (verified; line 205 already reads it first). | Remove the `"KG"` tail and the two literals; unit is filled when the material is chosen. |
| 3.3 | Quantity `\|\| 1` | `SalesOrderModel.js:512` | user input only | Remove; empty = field error. Backend already rejects. |
| 3.4 | Plant `"1120"` (model 93,127,524) and `"1000"` (`CreateSalesOrder.controller.js:277`) — two different guesses | — | Explicit config: backend `getSalesOrderDefaults().Plant` (= `cds.s4.plant`). SAP's own delivering plant (customer-material info / material sales data) is not exposed by any service verified in this repo. | Remove all four literals; use the backend default, shown as an editable suggestion; empty if the call fails. |
| 3.5 | `ZDOM`, `1000`, `10`, `52`, `INR` literals | `SalesOrderModel.js:58-75,475-485`, `SalesOrderService.js:352-361`, `SalesInquiryModel.js`, `SalesInquiryService.js` | Backend `getSalesOrderDefaults()` / `getSalesInquiryDefaults()` (config, one place). Order type list: `SD_F2369_INQY_FS_SRV/I_SalesDocumentType` (215 types, recorded in WORKSTATUS.md). | Delete the literals; on backend failure show the error and leave fields empty. |
| 3.6 | Customer currency = config / last inquiry; `Country \|\| 'IN'`; UI returns `Currency: "INR"` on failure | `SalesInquiryAdapter.js` getCustomerDefaults (lines ~23, 43, 62), `SalesOrderService.js:307-337` | `I_Customer_VH.Country`, `.CityName`, `.CustomerName` (verified, 891 rows). Customer sales-area currency: NOT in `I_Customer_VH` (verified absent); source not verified in this repo. | Remove `'IN'` and both `"INR"` returns. Leave currency empty before save; after create show `Header.DocumentCurrency` (SAP determines it). |
| 3.7 | Ship-to = sold-to customer | `SalesOrderService.js:326-337` | Not verified before create. After create: `LORD_ODATA_ORDER_SRV/HeaderPartnerSet` (entity exists, verified). | Leave empty; SAP determines partners at create. Show real partners from `HeaderPartnerSet` afterwards. |
| 3.8 | Requested delivery date = today + 7 | `SalesOrderModel.js:54,120`, `SalesOrderService.js:352`, `SalesInquiryAdapter.js:804` | none — it is a user decision | Remove; leave empty, required field. |
| 3.9 | `'Order Created'`, `'PO Created but no ID returned'`, `'Inquiry Created'` | `salesOrder.handler.js:66`, `purchaseOrder.handler.js:59`, `salesInquiry.handler.js:69` | SAP's returned document number only | RESOLVED: No number = `req.error(502, ...)`. Fake success text completely eliminated. |

## 4. Outbound Delivery

| # | Assumed today | Where | Actual source | Change |
|---|---|---|---|---|
| 4.1 | Hand-typed shipping point list with invented names ("1112 - Shipping Point 1112"), default `"1120"` | `SalesOrders.controller.js:58-65` | `LE_SHP_QC_DLVREF_SRV/C_ShippingPointVH` (`ShippingPoint`, `ShippingPointName`; verified, 60 rows) — already served by the app as `ShippingPointVH`. | Load the list from `ShippingPointVH`; delete the literal array. |
| 4.2 | Shipping point `\|\| "1120"` | `OrdersDueForDelivery.controller.js:196` | The order's own shipping point: `C_SalesOrderDueForDeliveryVH.ShippingPoint` (verified, 369 rows). WORKSTATUS.md Phase 0 recorded that order 5000461 uses `WAVG`, not 1120 — the fallback would be wrong for it. | Remove fallback. From the Sales Orders screen, read the order's line from `OrdersDueForDelivery?$filter=SalesOrder eq '<id>'` and preselect its real shipping point; if the order is not in that list it is not due — say so instead of offering a create. |

## 5. Not assumptions — leave

`Numerator \|\| 1`, `Denominator \|\| 1` (neutral conversion factor), `SyncAttempts \|\| 1` (internal counter),
`currentStep \|\| 1` (wizard step), everything under `cds.s4` in `package.json` (explicit configuration).

## Verification after the change

```
grep -rnE "\|\| *['\"](PC|KG|INR|IN|ZIN|ZDOM|1000|1120|999|00010|000010)['\"]|\|\| *1\b|Quantity: *[0-9]|7 \* 24|NetValue|'Material ' \+|'Plant ' \+" srv app/fiori-app/webapp --include=*.js
```
Every remaining hit needs a one-line justification. Then: cds compile, eslint, jest test/unit, ui5lint,
`npm run build` in app/fiori-app (the browser runs Component-preload.js).
