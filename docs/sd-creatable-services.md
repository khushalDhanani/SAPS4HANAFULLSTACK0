# SD module — verified creatable services (DS4 client 220, 22 Sep 2026, GET-only)

Read from live `$metadata` (saved in `docs/sd-metadata/*.xml`, gitignored). "!" = parameter not nullable.

| Step in order-to-cash | Service | Create path (verified in metadata) | Status |
|---|---|---|---|
| Sales order | `LORD_ODATA_ORDER_SRV` | `HeaderSet` deep insert | proven live (ZDOM) |
| Delivery with reference | `LE_SHP_QC_DLVREF_SRV` | `C_DelivWthRefQuickCreate` POST | proven live (13000526) |
| Delivery for order (alternative) | `SD_SOFM_DELIVERY_SRV_01` / `SD_SOF` | `CreateDeliveryForOrder(SalesOrderID, ItemID)`, `CreateDeliveryForOrderItems(SalesOrderID, ItemIDs, DueDate, RollbackOnError)` | creatable, untested |
| Delivery without reference | `LE_SHP_QC_DLVNOREF_SRV` | `C_DelivWthoutRefQuickCreate` + `C_DelivItmWthoutRefQuickCrte` | creatable, untested |
| Post goods issue | `SD_SOFM_CREDIT_BLOCK_SRV` | `PostGoodsIssue(DeliveryNumber)` → `PostGoodsReturnInfo` | creatable, untested |
| Credit release | `SD_SOFM_CREDIT_BLOCK_SRV` | `ReleaseCreditOrder(SalesOrderNumber)`, `ReleaseCreditDelivery(DeliveryNumber)`, `RecheckCredit*`, `RejectOrder(SalesOrderNumber, ReasonForRejection)` | creatable, untested |
| Billing document | `SD_CUSTOMER_INVOICES_CREATE` | `CreateBillingDocuments(ReferenceSDDocument, ReferenceSDDocumentCategory, BillingDocumentType, BillingDocumentDate, …)`; `GetBillingDocumentTypes(ReferenceSDDocument)` gives the allowed types first | creatable, untested |
| Billing document (simple) | `SD_SOFM_INVOICE_SRV` / `SD_SOF` | `createInvoice(DeliveryDocumentNumber, SalesDocumentNumber)`; `postToAccount(BillingDocumentNumber)` | creatable, untested |
| Billing document follow-up | `SD_CUSTOMER_INVOICES_MANAGE` | `PostBillingDocumentToAccounting(BillingDocument, SDDocumentCategory)`, `CancelBillingDocument(...)` | creatable, untested |
| Preliminary billing | `SD_PRE_BIL_DOC_MANAGE` | `CreateBillingDocument(PreliminaryBillingDocuments, BillingDocumentDate, AutomaticallyPost)` | creatable, untested |
| Sales quotation / sales contract | — | none registered (`API_SALES_QUOTATION_SRV` no alias, `API_SALES_CONTRACT_SRV` not registered) | blocked — Basis ticket |

Recommended next build: **Post Goods Issue + Create Billing Document from a delivery** — closes order-to-cash with services that exist today. Every parameter is String; no document number is ever invented — the created number comes only from the function-import result.
