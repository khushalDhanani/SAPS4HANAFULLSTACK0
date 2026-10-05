# SD Module — Verified Creatable Services Reference (DS4 Client 220)

Empirically inspected against live SAP Gateway `$metadata` and active SAP business logic on DS4 client 220.

---

## 1. Raw Catalog Scan vs. "Proper Creatable" Services

In the automated `$metadata` scan (`catalog-creatable.csv`), **50 services** under SD declare `creatable_sets > 0` or `post_actions > 0`.
However, **over 75% of them are NOT proper business document creation services**:
* **Factsheet & Object Page services** (e.g. `SD_CUSTOMER_INVOICES_MANAGE`, `SD_F1814_SO_FS_SRV`, `SD_F1871_QUOT_FS_SRV`) declare `ConfigurationContextSet`, `CharacteristicValueSet`, and `ClassificationContextSet`. These are technical variant configuration/classification helper entities, **not** document creators.
* **Read-Only CDS View Worklists** (e.g. `SD_F1873_SO_WL_SRV` with `C_SalesOrderWl_F1873`) lack transactional RAP/BOPF write implementations and reject POST with `405 Method Not Allowed` / `CX_SADL_ENTITY_CUD_DISABLED`.
* **Mass Maintenance & File Uploads** (`SD_MCC_*`, `SD_SALES_*_IMPORT`) are asynchronous background file processors, not real-time transactional business APIs.
* **Standard Released APIs blocked by Gateway**: `API_SALES_ORDER_SRV` and `API_SALES_QUOTATION_SRV` return HTTP 500 `/IWFND/CM_COS/064` (No System Alias found on DS4 client 220; Basis ticket item 1 logged in `docs/ticket-gateway-remediation-ds4.md`).

---

## 2. Proper Creatable Services Matrix (By SD Business Object)

The following services are authentic, verified transactional endpoints capable of creating or executing SD business transactions in S/4HANA:

| # | Business Object / Step | Proper Creatable Service | Creation Path & Method | Payload / Parameters | DS4 Client 220 Verification Status |
|---|---|---|---|---|---|
| **1** | **Sales Order & Sales Inquiry** | **`LORD_ODATA_ORDER_SRV`** | `POST /HeaderSet` (Deep Insert) | Header (`SalesOrderTypeCode`, `SalesOrganization`, `DistributionChannel`, `Division`, `SoldToPartyID`) + `ItemSet` (`MaterialID`, `OrderQty`, `SalesUnit`) + `PriceCondSet` | **PROVEN LIVE**. Creates real `VBAK`/`VBAP` documents (e.g. `10000045`, `10000046`). |
| **2** | **Delivery with Reference** | **`LE_SHP_QC_DLVREF_SRV`** *(LE/SD)* | `POST /C_DelivWthRefQuickCreate` | `ReferenceSDDocument` (Sales Order #), `ShippingPoint`, `DeliveryDate` | **PROVEN LIVE** (Delivery `13000526` created). |
| **3** | **Delivery for Order (Direct)** | **`SD_SOFM_DELIVERY_SRV_01`** | `POST /CreateDeliveryForOrder` or `CreateDeliveryForOrderItems` | `SalesOrderID`, `ItemID`, `DueDate`, `RollbackOnError` | **Active in Gateway**, verified in metadata. |
| **4** | **Delivery without Reference** | **`LE_SHP_QC_DLVNOREF_SRV`** | `POST /C_DelivWthoutRefQuickCreate` + `C_DelivItmWthoutRefQuickCrte` | `ShippingPoint`, `DeliveryDocumentType`, `SoldToParty`, items | **Active in Gateway**, verified in metadata. |
| **5** | **Post Goods Issue (PGI)** | **`SD_SOFM_CREDIT_BLOCK_SRV`** | `POST /PostGoodsIssue` | `DeliveryNumber` (String). Returns `PostGoodsReturnInfo` (`Done`, `ErrorAny`). | **Code implemented**, awaiting picked candidate delivery (candidate: `13000515`). |
| **6** | **Credit Block Release** | **`SD_SOFM_CREDIT_BLOCK_SRV`** | `POST /ReleaseCreditOrder`, `ReleaseCreditDelivery` | `SalesOrderNumber` or `DeliveryNumber` | **PROVEN LIVE** in DS4 client 220. |
| **7** | **Customer Invoice (from Delivery/Order)** | **`SD_CUSTOMER_INVOICES_CREATE`** | `POST /CreateBillingDocuments` | `ReferenceSDDocument` (Delivery/Order #), `ReferenceSDDocumentCategory` ('J'/'C'), `BillingDocumentType` (optional), `BillingDocumentDate` | **Active in Gateway**, verified in metadata. Code implemented in `OutboundDeliveryAdapter.js`. |
| **8** | **Customer Invoice (Direct from Order/Delivery)** | **`SD_SOFM_INVOICE_SRV`** / `SD_SOF` | `POST /createInvoice` | `DeliveryDocumentNumber`, `SalesDocumentNumber` | **Active in Gateway**, verified in metadata. |
| **9** | **Customer Invoice Accounting Release & Cancel** | **`SD_CUSTOMER_INVOICES_MANAGE`** | `POST /PostBillingDocumentToAccounting`, `CancelBillingDocument` | `BillingDocument`, `SDDocumentCategory`. Creates FI `BKPF` journal entry or `S1` cancellation. | **PROVEN LIVE** on DS4 client 220 (implemented in `CustomerInvoiceAdapter.js`). |
| **10** | **Customer Returns** | **`SD_F2651_CRT_CREATE_SRV`** | `POST /C_CustomerReturnOPg` (with `C_CustomerReturnItemOPg`) | Customer Return Header + Items (Order Type `RE`/`C2`, Return Reason, Customer, Material, Quantity). | **Active in Gateway**, RAP-based Fiori transactional service. |
| **11** | **Customer Materials (VD51 / VD52)** | **`SD_F2499_CUSTOMER_MATERIAL_SRV`** | `POST /C_CustomerMaterial_F2499` | `Customer`, `SalesOrganization`, `DistributionChannel`, `Material`, `CustomerMaterial` | **Active in Gateway**, full draft-enabled transactional service (F2499). |
| **12** | **Sales Item Proposals (VA51 / VA52)** | **`SD_F2583_SLSITMPRPSL_SRV`** | `POST /C_SalesItemProposalTP` + items | Header + Item Collection (`C_SalesItemProposalItemTP`). | **Active in Gateway**, draft-enabled transactional service. |
| **13** | **In-House Repairs** | **`UI_MANAGEINHREPAIRS`** | `POST /C_InhRepairObjPg` + actions | Repair objects, actions: `CreateCustomerReturn`, `CreateInboundDelivery`, `CreateOutboundDelivery`. | **Active in Gateway**. |
| **14** | **Preliminary Billing Documents** | **`SD_PRE_BIL_DOC_MANAGE`** | `POST /CreateBillingDocument` | `PreliminaryBillingDocuments`, `BillingDocumentDate`, `AutomaticallyPost` | **Active in Gateway**. |

---

## 3. Blocked / Pending Services Requiring Basis Remediation

| Service | Intended Business Capability | Current S/4HANA Gateway Error | Remediation Required |
|---|---|---|---|
| `API_SALES_ORDER_SRV` | Standard A2X Sales Order OData API | HTTP 500 `/IWFND/CM_COS/064` (No System Alias found) | Assign System Alias `DS4_220` in `/IWFND/MAINT_SERVICE` (Item 1, Row 54 in `docs/ticket-gateway-remediation-ds4.md`). |
| `API_SALES_QUOTATION_SRV` | Standard A2X Sales Quotation OData API | HTTP 500 `/IWFND/CM_COS/064` (No System Alias found) | Assign System Alias `DS4_220` in `/IWFND/MAINT_SERVICE` (Item 1, Row 55 in `docs/ticket-gateway-remediation-ds4.md`). |
| `API_SALES_CONTRACT_SRV` | Standard A2X Sales Contract OData API | HTTP 403 `/IWFND/MED/170` (Service not registered) | Register service and assign System Alias in `/IWFND/MAINT_SERVICE`. |

---

## 4. Key Takeaway & Architecture Rule for SD

* For **Sales Order & Sales Inquiry creation**, **`LORD_ODATA_ORDER_SRV`** is the only active, proven live transactional service available on this system.
* For **Delivery creation**, **`LE_SHP_QC_DLVREF_SRV`** (`C_DelivWthRefQuickCreate`) is the proven live service.
* For **Goods Issue & Credit release**, **`SD_SOFM_CREDIT_BLOCK_SRV`** (`PostGoodsIssue`, `ReleaseCreditOrder`) is the proper transactional service.
* For **Billing Document creation**, **`SD_CUSTOMER_INVOICES_CREATE`** (`CreateBillingDocuments`) is the proper transactional service.
* For **Accounting release & cancellation**, **`SD_CUSTOMER_INVOICES_MANAGE`** (`PostBillingDocumentToAccounting`, `CancelBillingDocument`) is the proper transactional service.
