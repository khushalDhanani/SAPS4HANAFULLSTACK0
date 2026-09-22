# Sales Contract creation — which DS4 client 220 service can do it? (evidence only)

**Question:** which OData service creates a Sales Contract (SD document category `G`)?
**Method:** `tools/verify-quotation-services.py` run with `PATTERN='sales.?contract|slscontr|sls_contr|salescntrct|customer.?contract|SDDocumentCategory.{0,40}\bG\b' OUT=docs/contract-metadata` on 2026-09-22 14:15–14:25 IST from the Mac.
GET `$metadata` of every live V2 service in the DS4 catalog (1,237 services from `catalog-audit.csv`) plus 5 direct probes; every verdict below is read from the returned metadata or HTTP status, nothing from service names. Raw metadata of the 35 services whose text matched is in `docs/contract-metadata/*.xml` (gitignored); the machine report is `docs/contract-metadata/REPORT.txt`. No POST was sent.

## Result: no registered service can create a sales contract

| Service | HTTP | What the metadata says about sales contracts |
|---|---|---|
| `SD_F1851_CONTR_WL_SRV` (Manage Sales Contracts worklist, Fiori F1851) | 200 | `C_SalesContractWl_F1851`, `C_SalesContractTypeValueHelp` — both `sap:creatable="false"`; no function import |
| `SD_F2026_CONTR_FS_SRV` (contract fact sheet) | 200 | `C_Salescontractfs`, `C_Salescontractitemfs`, `I_SalesContract`, partner card, process flow — all `sap:creatable="false"` |
| `SD_SALESCONTRACT_WORKFLOW` (approval inbox) | 200 | inbox entity sets only, `creatable="false"` |
| `SD_MCC_CCO_MASS_UPDATE_SRV` (mass change of contracts) | 200 | `SlsContr`, `SlsContrItem` `creatable="false"` (the service's 2 creatable sets are mass-change job objects, not contracts) |
| `C_SALESCONTRACTITMFLFMTQ_CDS`, `SD_CUSTOMER360_OVP`, `SD_F2187_CUST360_SRV`, `C_SALESDOCUMENTWORKFLOWVH_CDS`, `SD_MCC_CR_MASS_UPDATE_SRV` | 200 | analytics / value helps only, `creatable="false"` |
| `LORD_ODATA_ORDER_SRV` (used by this app for orders and inquiries) | 200 | metadata does not name contracts at all; whether `HeaderSet` accepts a contract type (`SalesOrderTypeCode = 'ZGCQ'`) is **not stated** and was **not tested** (it would create a real document) |
| `API_SALES_CONTRACT_SRV` (SAP standard A2X API) | **403** `/IWFND/MED/170` "No service found for namespace '', name 'API_SALES_CONTRACT_SRV', version '0001'" | not registered in the Gateway hub — same state as `API_MATERIAL_DOCUMENT_SRV` (ticket item 2) |
| V4 `API_SALESCONTRACT` | **404** `/IWBEP/CM_V4_COS/014` "Service group 'API_SALESCONTRACT' not published" | not published |
| V4 `UI_SALESCONTRACTMANAGE`, `UI_SALESCONTRACT` | **404** `/IWBEP/CM_V4_COS/014` | not published (the V4 catalog itself is 404 on this hub) |

Across all 1,242 metadata documents fetched, **no entity set whose name or type contains "SalesContract"/"SlsContr" is creatable and no function import creates one**. The Fiori "Manage Sales Contracts" app creates contracts by navigating to SAP GUI `VA41`, which is why its worklist service is read-only.

## Actual data that any implementation will need (read live, GET only)

- Contract document types configured in client 220 (`I_SalesDocumentType` where `SDDocumentCategory = 'G'`): 12 types — `AD1, GCQ, GVC, JSDQ, CQ, MV, PHAM, VBOS, WK1, WK2, WV, ZGCQ`. **Only `ZGCQ` ("Contract") is unlocked**; all SAP-standard types (`WK1`, `WK2`, `CQ`, …) carry `IsLocked = X`.
- Existing sales contracts in client 220: **52** (`C_SalesContractWl_F1851` `$inlinecount`), latest `3000051–3000053`, all type `ZGCQ`, sold-to `20021`, sales org `1000` — created in SAP GUI, so `ZGCQ` is a working type.

## What would make it creatable (SAP side, not application code)

1. **Basis — register `API_SALES_CONTRACT_SRV`** in `/IWFND/MAINT_SERVICE` (system alias `LOCAL`), exactly as requested for `API_MATERIAL_DOCUMENT_SRV`. This is SAP's released OData V2 API for sales contracts (create / read / update, header + item + partner + pricing) and is the correct create path. Added as **Item 4** of `docs/ticket-gateway-remediation-ds4.md`. Until its `$metadata` can be fetched from DS4, its entity and field names are **unverified** here — they come from SAP's API documentation, not from this system.
2. After registration, verify with the same scan (`PATTERN=... DIRECT='API_SALES_CONTRACT_SRV=/sap/opu/odata/sap/API_SALES_CONTRACT_SRV'`) that `A_SalesContract` is `sap:creatable="true"` and that `ZGCQ` is accepted, before writing a single line of application code.
3. Not recommended without a supervised test: posting `SalesOrderTypeCode = 'ZGCQ'` to `LORD_ODATA_ORDER_SRV/HeaderSet`. The metadata gives no indication either way, and the only way to know is a POST that creates a document in DS4 — do this only as an explicit, reviewed test.
