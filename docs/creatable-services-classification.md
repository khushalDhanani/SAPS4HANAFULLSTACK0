# Creatable Services Classification

> **Date:** 2026-11-03. **Source:** `creatable-services.xlsx`, generated 2026-10-06 from a live `$metadata` scan of DS4 client 220.
> **Method:** repo evidence only. No SAP call was made for this document, and the workbook was not changed.

This document answers how many of the workbook's 497 services are proper creatable services. "Proper" follows `docs/sd-creatable-services.md`: the service really creates or posts a business document.

**Evidence level:** the "Proven" bucket is **CONFIRMED** by recorded live runs. Every other bucket is **INFERRED** from service and entity set names. A service outside "Proven" has not been shown to create anything on this system.

## Result

| Bucket | Services | Meaning |
|---|---|---|
| Proven live with read-back | 4 | A real document was created and read back from SAP |
| Likely document or posting (unproven) | 69 | Reads as a real business document or posting; not proven |
| Likely master data or configuration (unproven) | 117 | Draft-style objects (`TP`/`WD` sets) such as rules and setup; not documents |
| Unclear from name | 152 | Names do not settle it; needs checking service by service |
| Not proper | 155 | Technical service, mass/upload/worklist service, or helper sets only |
| **Total** | **497** | |

Proper services: about **73** (4 proven + 69 likely). This is not a final count. Some of the 69 may fail when tested, and the workbook leaves out POST-only services (see below).

## Proven services

| Service | Live proof | Evidence |
|---|---|---|
| `MM_PUR_PO_MAINT_V2_SRV` | PO 300002151 | `docs/e2e-coverage-matrix.md:75` |
| `LORD_ODATA_ORDER_SRV` | Sales order 5000534 | `docs/e2e-coverage-matrix.md:77` |
| `API_PACKINGINSTRUCTION` | Packing instruction 55 | `docs/e2e-coverage-matrix.md:86` |
| `API_MATERIAL_DOCUMENT_SRV` | 261 document 4900050350/2026; 262 reversal 4900050348/2026 | `WORKSTATUS.md` entry "Live 261 post on reservation 528779/1"; route traced in `srv/integration/s4hana/wm/Mvt261Adapter.js` and `goods-issue/GoodsIssuePostingClient.js` (INFERRED: the log names the CAP action, not the SAP service) |

Return 4500184 also went through `LORD_ODATA_ORDER_SRV`, but its reason, reference and storage location were not persisted (`docs/e2e-coverage-matrix.md:80`).

Goods receipt 5000005789/2026 does not count for any service here. It was posted through `postGoodsReceiptWithStorageUnit`, which calls `BAPI_INB_DELIVERY_CONFIRM_DEC` (`srv/integration/s4hana/wm/GoodsReceiptAdapter.js:1471`).

## By module

| Module | Proven | Likely document | Master data or configuration | Unclear | Not proper | Total |
|---|---|---|---|---|---|---|
| FI - Finance | 0 | 23 | 20 | 52 | 27 | 122 |
| MM - Purchasing | 0 | 13 | 4 | 13 | 15 | 45 |
| SD - Sales | 1 | 7 | 2 | 4 | 24 | 38 |
| PM - Maintenance | 1 | 6 | 2 | 14 | 7 | 30 |
| QM - Quality | 0 | 7 | 1 | 3 | 5 | 16 |
| CO - Controlling | 0 | 5 | 7 | 11 | 7 | 30 |
| MM - Inventory | 1 | 3 | 3 | 0 | 0 | 7 |
| LE - Shipping | 1 | 2 | 1 | 1 | 0 | 5 |
| EWM - Warehouse | 0 | 2 | 0 | 10 | 0 | 12 |
| EHS - Health & Safety | 0 | 1 | 18 | 7 | 10 | 36 |
| ATP - Availability | 0 | 0 | 25 | 2 | 0 | 27 |
| Basis - Fiori - Technical | 0 | 0 | 0 | 0 | 38 | 38 |
| Defense (DFS) | 0 | 0 | 15 | 2 | 0 | 17 |
| HR - Payroll - Travel | 0 | 0 | 0 | 1 | 6 | 7 |
| Legal - Trade - Compliance | 0 | 0 | 4 | 2 | 0 | 6 |
| Master data - MDG | 0 | 0 | 1 | 10 | 1 | 12 |
| PP - Production | 0 | 0 | 12 | 14 | 14 | 40 |
| PS - Projects | 0 | 0 | 1 | 1 | 1 | 3 |
| Retail (RFM) | 0 | 0 | 1 | 5 | 0 | 6 |

## Why 497 overstates the number

- **A missing flag counts as creatable.** `tools/find-creatable.py:22-23` counts every set not marked `sap:creatable="false"`. Seven workbook services have metadata saved in this repo. Their 28 counted sets all lack the flag, and none says `"true"`. Their counts match the workbook.
- **Read-only services get through.** `SD_F1873_SO_WL_SRV` is counted, yet `docs/sd-creatable-services.md:14` records POST rejected with 405 on this worklist type.
- **Helper sets get through.** `VHLockboxNumberCollection` and `DummyCollection` both pass the filter.

## What the workbook leaves out

`tools/build-creatable-xlsx.py:61` keeps only services with at least one creatable entity set, so POST-only services are missing. The 23 Sep report counted 635 services that can write against 496 with creatable sets (`docs/creatable_services_report.md:15-17`), which leaves about 139 outside the workbook.

Four services the SD reference lists as proper are among them: `SD_CUSTOMER_INVOICES_CREATE` (the app's billing path, `srv/integration/s4hana/le/outbound-delivery/OutboundDeliveryAdapter.js:24`), `SD_SOFM_DELIVERY_SRV_01`, `SD_SOFM_INVOICE_SRV` and `SD_PRE_BIL_DOC_MANAGE`. None of the missing services is classified here.

## Limits

- Buckets 2 to 5 are one reviewer's judgement from names. Some services will move once checked.
- Bucket assignments are fixed in this document. They are not regenerated with the workbook.
- Only a real POST with read-back proves a service works, and each one needs written go under `AGENTS.md`.
- The workbook cannot be rebuilt in this checkout: `catalog-audit.csv`, `catalog-creatable.csv` and `srv/external/all_catalog_services.json` are absent.

## All 497 services

"Sets" is creatable entity sets and "POST" is POST actions, both as the workbook reports them.

### Proven live with read-back (4)

| Module | Service | Type | Sets | POST | Reason |
|---|---|---|---|---|---|
| LE - Shipping | `API_PACKINGINSTRUCTION` | Released API | 1 | 0 | Packing instruction 55 |
| MM - Inventory | `API_MATERIAL_DOCUMENT_SRV` | Released API | 1 | 2 | 261 document 4900050350/2026; 262 reversal 4900050348/2026 |
| PM - Maintenance | `MM_PUR_PO_MAINT_V2_SRV` | Fiori app service | 13 | 57 | PO 300002151 |
| SD - Sales | `LORD_ODATA_ORDER_SRV` | Fiori app service | 1 | 4 | Sales order 5000534 |

### Likely document or posting (unproven) (69)

| Module | Service | Type | Sets | POST | Reason |
|---|---|---|---|---|---|
| CO - Controlling | `FCO_MANAGE_DRCT_ACTY_ALLOC_SRV` | Fiori app service | 2 | 13 | Name and sets read as a business document or posting |
| CO - Controlling | `FCO_REASSIGN_COSTS_REVENUES_SRV` | Fiori app service | 2 | 9 | Name and sets read as a business document or posting |
| CO - Controlling | `FCO_STSTCL_KEY_FIG_VALUES_SRV` | Fiori app service | 2 | 9 | Name and sets read as a business document or posting |
| CO - Controlling | `ODATA_BUDGET_TRANSFER_MANAGE_SRV` | Fiori app service | 3 | 30 | Name and sets read as a business document or posting |
| CO - Controlling | `UI_COSTACCTGLINEITM_REPOST` | Fiori app service | 1 | 10 | Name and sets read as a business document or posting |
| EHS - Health & Safety | `EHS_INC_REPORTINCIDENT_SRV` | Fiori app service | 7 | 0 | Name and sets read as a business document or posting |
| EWM - Warehouse | `API_WAREHOUSE_ORDER_TASK` | Released API | 1 | 7 | Name and sets read as a business document or posting |
| EWM - Warehouse | `API_WHSE_PHYSINVENTORYITEM` | Released API | 1 | 1 | Name and sets read as a business document or posting |
| FI - Finance | `BANKACCTOPENINGREQDRFTTP` | Fiori app service | 1 | 9 | Name and sets read as a business document or posting |
| FI - Finance | `FAA_ASSET_MANAGE_SRV` | Fiori app service | 2 | 8 | Name and sets read as a business document or posting |
| FI - Finance | `FAC_GL_DOCUMENT_POST_SRV` | Fiori app service | 10 | 50 | Name and sets read as a business document or posting |
| FI - Finance | `FAC_GL_MANUAL_CLEARING_SRV` | Fiori app service | 12 | 50 | Name and sets read as a business document or posting |
| FI - Finance | `FAC_RECURRING_ACCOUNTING_DOC_SRV` | Fiori app service | 10 | 50 | Name and sets read as a business document or posting |
| FI - Finance | `FAP_CREATE_SINGLE_PAYMENT` | Fiori app service | 6 | 0 | Name and sets read as a business document or posting |
| FI - Finance | `FAP_DOWN_PAYMENT_REQUEST_MANAGE_SRV` | Fiori app service | 10 | 50 | Name and sets read as a business document or posting |
| FI - Finance | `FAR_DOWN_PAYMENT_REQUEST_MANAGE_SRV` | Fiori app service | 10 | 50 | Name and sets read as a business document or posting |
| FI - Finance | `FAR_MANAGE_PAYMENT_ADVICES_SRV` | Fiori app service | 3 | 6 | Name and sets read as a business document or posting |
| FI - Finance | `FAR_PAYMENT_POST_SRV` | Fiori app service | 14 | 50 | Name and sets read as a business document or posting |
| FI - Finance | `FCLM_CASH_BANKTRANSFER_SRV` | Fiori app service | 1 | 10 | Name and sets read as a business document or posting |
| FI - Finance | `FCLM_CASH_MEMORECORDWD_SRV` | Fiori app service | 1 | 16 | Name and sets read as a business document or posting |
| FI - Finance | `FCLM_MBTS_WITHTMPL_SRV` | Fiori app service | 1 | 4 | Name and sets read as a business document or posting |
| FI - Finance | `FINS_TRR_QUICKCRTTMPADJ_SRV` | Fiori app service | 1 | 0 | Name and sets read as a business document or posting |
| FI - Finance | `FIN_SSC_SR_SRV` | Fiori app service | 6 | 0 | Name and sets read as a business document or posting |
| FI - Finance | `FIORI_CREATE_SRV` | Fiori app service | 31 | 11 | Name and sets read as a business document or posting |
| FI - Finance | `LO_JOURNAL_VOUCHER_CREATE_SRV` | Fiori app service | 1 | 0 | Name and sets read as a business document or posting |
| FI - Finance | `RE_CN_CONTRACT_ODATA_SRV` | Fiori app service | 8 | 0 | Name and sets read as a business document or posting |
| FI - Finance | `UI_CADISPUTECASE` | Fiori app service | 8 | 11 | Name and sets read as a business document or posting |
| FI - Finance | `UI_CASECURITYDEPMGMTTP` | Fiori app service | 2 | 11 | Name and sets read as a business document or posting |
| FI - Finance | `UI_DISPUTECASE_MANAGE` | Fiori app service | 1 | 20 | Name and sets read as a business document or posting |
| FI - Finance | `UI_MANUALACCRS_MNG` | Fiori app service | 5 | 26 | Name and sets read as a business document or posting |
| FI - Finance | `UI_PROMISETOPAY_MANAGE` | Fiori app service | 2 | 10 | Name and sets read as a business document or posting |
| LE - Shipping | `LE_SHP_QC_DLVNOREF_SRV` | Fiori app service | 2 | 0 | Name and sets read as a business document or posting |
| LE - Shipping | `LE_SHP_QC_DLVREF_SRV` | Fiori app service | 1 | 0 | Delivery 13000526 recorded as created; no read-back proof in the repo |
| MM - Inventory | `MM_IM_PHYS_INV_MASS_CREATE_SRV_01` | Fiori app service | 1 | 0 | Name and sets read as a business document or posting |
| MM - Inventory | `UI_PI_MANAGE_COUNT_V2` | Fiori app service | 3 | 7 | Name and sets read as a business document or posting |
| MM - Inventory | `UI_RESERVATION_HDR_MNG_V2` | Fiori app service | 1 | 11 | Name and sets read as a business document or posting |
| MM - Purchasing | `FAP_PAYMENT_POST_SRV` | Fiori app service | 12 | 50 | Name and sets read as a business document or posting |
| MM - Purchasing | `MMIM_GR4PO_DL_SRV` | Fiori app service | 9 | 35 | Failed live twice on 2026-10-06 |
| MM - Purchasing | `MMPUR_REQ_SSP_MAINTAIN_SRV` | Fiori app service | 10 | 34 | Name and sets read as a business document or posting |
| MM - Purchasing | `MM_PUR_CNTRL_CTR_MAINTAIN_SRV` | Fiori app service | 30 | 109 | Name and sets read as a business document or posting |
| MM - Purchasing | `MM_PUR_CQTN_MAINTAIN_SRV` | Fiori app service | 6 | 15 | Name and sets read as a business document or posting |
| MM - Purchasing | `MM_PUR_CRFQ_MAINTAIN_SRV` | Fiori app service | 5 | 13 | Name and sets read as a business document or posting |
| MM - Purchasing | `MM_PUR_OA_MAINTAIN_SRV` | Fiori app service | 14 | 50 | Name and sets read as a business document or posting |
| MM - Purchasing | `MM_PUR_QTN_MAINTAIN_SRV` | Fiori app service | 5 | 13 | Name and sets read as a business document or posting |
| MM - Purchasing | `MM_PUR_REQ_EXT_MANAGE_SRV` | Fiori app service | 10 | 20 | Name and sets read as a business document or posting |
| MM - Purchasing | `MM_PUR_REQ_SSP_V2_MAINTAIN_SRV` | Fiori app service | 7 | 19 | Name and sets read as a business document or posting |
| MM - Purchasing | `MM_PUR_RFQ_MAINTAIN_SRV` | Fiori app service | 6 | 19 | Name and sets read as a business document or posting |
| MM - Purchasing | `MM_PUR_SCHEDG_AGRMT_SRV` | Fiori app service | 10 | 29 | Name and sets read as a business document or posting |
| MM - Purchasing | `MM_PUR_SES_MAINTAIN_SRV` | Fiori app service | 4 | 14 | Name and sets read as a business document or posting |
| PM - Maintenance | `API_MAINTNOTIFICATION` | Released API | 6 | 5 | Name and sets read as a business document or posting |
| PM - Maintenance | `API_MAINTORDERCONFIRMATION` | Released API | 1 | 1 | Name and sets read as a business document or posting |
| PM - Maintenance | `EAM_MALFUNCTION_MANAGE` | Fiori app service | 11 | 72 | Name and sets read as a business document or posting |
| PM - Maintenance | `EAM_NTF_CREATE` | Fiori app service | 3 | 0 | Name and sets read as a business document or posting |
| PM - Maintenance | `MM_PUR_PR_PROFNL_MAINTAIN_SRV` | Fiori app service | 8 | 33 | Name and sets read as a business document or posting |
| PM - Maintenance | `RSH_SB_MAINTENANCE_ORDER` | Fiori app service | 3 | 1 | Name and sets read as a business document or posting |
| QM - Quality | `MPE_EXEC_NON_CONFORMANCE_SRV` | Fiori app service | 2 | 1 | Name and sets read as a business document or posting |
| QM - Quality | `QM_DEFECT_RECORD_SRV` | Fiori app service | 1 | 43 | Name and sets read as a business document or posting |
| QM - Quality | `QM_INSPUSGDSC_MANAGE_SRV` | Fiori app service | 1 | 11 | Name and sets read as a business document or posting |
| QM - Quality | `QM_MLTPLRR_SRV` | Fiori app service | 2 | 0 | Name and sets read as a business document or posting |
| QM - Quality | `QM_RR_SRV` | Fiori app service | 2 | 2 | Name and sets read as a business document or posting |
| QM - Quality | `QM_SUBSET_RR_SRV` | Fiori app service | 3 | 5 | Name and sets read as a business document or posting |
| QM - Quality | `UI_INSPLOT_RSLTRECG` | Fiori app service | 4 | 1 | Name and sets read as a business document or posting |
| SD - Sales | `SD_CUSTOMER_INVOICES_MANAGE` | Fiori app service | 3 | 36 | Proper through POST actions, per `docs/sd-creatable-services.md` |
| SD - Sales | `SD_F2499_CUSTOMER_MATERIAL_SRV` | Fiori app service | 7 | 38 | Name and sets read as a business document or posting |
| SD - Sales | `SD_F2583_SLSITMPRPSL_SRV` | Fiori app service | 2 | 4 | Name and sets read as a business document or posting |
| SD - Sales | `SD_F2651_CRT_CREATE_SRV` | Fiori app service | 2 | 0 | The app only reads through it |
| SD - Sales | `SD_SOF` | Fiori app service | 1 | 4 | Proper through POST actions, per `docs/sd-creatable-services.md` |
| SD - Sales | `SD_SOFM_CREDIT_BLOCK_SRV` | Fiori app service | 2 | 7 | Proper through POST actions, per `docs/sd-creatable-services.md` |
| SD - Sales | `UI_MANAGEINHREPAIRS` | Fiori app service | 2 | 11 | Name and sets read as a business document or posting |

### Likely master data or configuration (unproven) (117)

| Module | Service | Type | Sets | POST | Reason |
|---|---|---|---|---|---|
| ATP - Availability | `ATP_ABC_STRATEGY` | Fiori app service | 15 | 22 | Draft-style sets (TP/WD) but not a document |
| ATP - Availability | `ATP_BOP_CUSTOMSORT_SETUP` | Fiori app service | 3 | 8 | Draft-style sets (TP/WD) but not a document |
| ATP - Availability | `ATP_BOP_SEGMENT_SETUP` | Fiori app service | 8 | 15 | Draft-style sets (TP/WD) but not a document |
| ATP - Availability | `ATP_BOP_VARIANT_SETUP` | Fiori app service | 4 | 11 | Draft-style sets (TP/WD) but not a document |
| ATP - Availability | `ATP_CONFIGUREPRODALLOC` | Fiori app service | 1 | 21 | Draft-style sets (TP/WD) but not a document |
| ATP - Availability | `ATP_MANCHARCCATALOG` | Fiori app service | 13 | 56 | Draft-style sets (TP/WD) but not a document |
| ATP - Availability | `ATP_MANPRODALLOCSEQUENCE` | Fiori app service | 1 | 11 | Draft-style sets (TP/WD) but not a document |
| ATP - Availability | `ATP_RESPONSIBILITY_CONFIG` | Fiori app service | 6 | 13 | Draft-style sets (TP/WD) but not a document |
| ATP - Availability | `UI_ATPSELECTOPTIONTOOL` | Fiori app service | 3 | 6 | Draft-style sets (TP/WD) but not a document |
| ATP - Availability | `UI_LOCSUBSTITUTION_MANAGE` | Fiori app service | 2 | 6 | Draft-style sets (TP/WD) but not a document |
| ATP - Availability | `UI_LOCSUBSTN_CTRL_MANAGE` | Fiori app service | 3 | 0 | Draft-style sets (TP/WD) but not a document |
| ATP - Availability | `UI_LOCSUBSTN_EXCLN_MANAGE` | Fiori app service | 2 | 6 | Draft-style sets (TP/WD) but not a document |
| ATP - Availability | `UI_LOCSUBSTN_GRP_MANAGE` | Fiori app service | 2 | 3 | Draft-style sets (TP/WD) but not a document |
| ATP - Availability | `UI_LOCSUBSTN_RSN_MANAGE` | Fiori app service | 2 | 0 | Draft-style sets (TP/WD) but not a document |
| ATP - Availability | `UI_OVD_ACTY_ATTRIB_CONF` | Fiori app service | 8 | 20 | Draft-style sets (TP/WD) but not a document |
| ATP - Availability | `UI_OVD_ALTV_CTRL_CONFIGURE` | Fiori app service | 4 | 10 | Draft-style sets (TP/WD) but not a document |
| ATP - Availability | `UI_OVD_CHARC_COMBN_MNG` | Fiori app service | 2 | 8 | Draft-style sets (TP/WD) but not a document |
| ATP - Availability | `UI_OVD_SUBSTN_CVC_MNG` | Fiori app service | 12 | 30 | Draft-style sets (TP/WD) but not a document |
| ATP - Availability | `UI_PRODSUBSTITUTION_MANAGE` | Fiori app service | 1 | 3 | Draft-style sets (TP/WD) but not a document |
| ATP - Availability | `UI_PRODSUBSTN_CTRL_MANAGE` | Fiori app service | 3 | 0 | Draft-style sets (TP/WD) but not a document |
| ATP - Availability | `UI_PRODSUBSTN_EXCLN_MANAGE` | Fiori app service | 1 | 3 | Draft-style sets (TP/WD) but not a document |
| ATP - Availability | `UI_PRODSUBSTN_GRP_MANAGE` | Fiori app service | 2 | 3 | Draft-style sets (TP/WD) but not a document |
| ATP - Availability | `UI_PRODSUBSTN_RSN_MANAGE` | Fiori app service | 2 | 0 | Draft-style sets (TP/WD) but not a document |
| ATP - Availability | `UI_REV_AVAILY_CHECK_RESULT` | Fiori app service | 2 | 7 | Draft-style sets (TP/WD) but not a document |
| ATP - Availability | `UI_SUPPLYPROTECTION` | Fiori app service | 5 | 17 | Draft-style sets (TP/WD) but not a document |
| CO - Controlling | `FAC_MANAGE_PROFIT_CENTERS_SRV` | Fiori app service | 2 | 14 | Draft-style sets (TP/WD) but not a document |
| CO - Controlling | `FCO_ALLOCATION_TAG_V2_SRV` | Fiori app service | 3 | 6 | Draft-style sets (TP/WD) but not a document |
| CO - Controlling | `FCO_EVENTBASED_POSTING_RULES_SRV` | Fiori app service | 1 | 7 | Draft-style sets (TP/WD) but not a document |
| CO - Controlling | `FCO_MANAGE_ACTIVITY_TYPE_SRV` | Fiori app service | 2 | 12 | Draft-style sets (TP/WD) but not a document |
| CO - Controlling | `FCO_MANAGE_ALLOCATION_SRV` | Fiori app service | 28 | 48 | Draft-style sets (TP/WD) but not a document |
| CO - Controlling | `UI_INTERNALORDER_MANAGE` | Fiori app service | 6 | 15 | Draft-style sets (TP/WD) but not a document |
| CO - Controlling | `UI_INTORDSETTLRULE_MANAGE` | Fiori app service | 2 | 9 | Draft-style sets (TP/WD) but not a document |
| Defense (DFS) | `DFS_ASSGMT_FETOFMPO_SRV` | Fiori app service | 3 | 28 | Draft-style sets (TP/WD) but not a document |
| Defense (DFS) | `DFS_ASSGMT_FETOPROD_SRV` | Fiori app service | 1 | 24 | Draft-style sets (TP/WD) but not a document |
| Defense (DFS) | `DFS_ASSGMT_PLATFORM_SRV` | Fiori app service | 4 | 96 | Draft-style sets (TP/WD) but not a document |
| Defense (DFS) | `DFS_FE_FRCELMNTORGPEACETME_SRV` | Fiori app service | 1 | 13 | Draft-style sets (TP/WD) but not a document |
| Defense (DFS) | `DFS_FE_FRCELMNTORGSTRUC_SRV` | Fiori app service | 2 | 52 | Draft-style sets (TP/WD) but not a document |
| Defense (DFS) | `DFS_FE_FRCELMNTORGWARTME_SRV` | Fiori app service | 2 | 52 | Draft-style sets (TP/WD) but not a document |
| Defense (DFS) | `DFS_FE_FRCELMNTORG_SRV` | Fiori app service | 18 | 196 | Draft-style sets (TP/WD) but not a document |
| Defense (DFS) | `DFS_FE_FRCELMNTPOSPEACETME_SRV` | Fiori app service | 1 | 12 | Draft-style sets (TP/WD) but not a document |
| Defense (DFS) | `DFS_FE_FRCELMNTPOSSTRUC_SRV` | Fiori app service | 1 | 12 | Draft-style sets (TP/WD) but not a document |
| Defense (DFS) | `DFS_FE_FRCELMNTPOSWARTME_SRV` | Fiori app service | 1 | 12 | Draft-style sets (TP/WD) but not a document |
| Defense (DFS) | `DFS_FE_REFFRCELMNTORG_SRV` | Fiori app service | 11 | 171 | Draft-style sets (TP/WD) but not a document |
| Defense (DFS) | `DFS_FMPO_FLXMTPLOBJ_SRV` | Fiori app service | 13 | 59 | Draft-style sets (TP/WD) but not a document |
| Defense (DFS) | `DFS_POS_DEFENSEPOSITION_SRV` | Fiori app service | 23 | 254 | Draft-style sets (TP/WD) but not a document |
| Defense (DFS) | `UI_DFS_RELOCATIONPLANNING` | Fiori app service | 6 | 16 | Draft-style sets (TP/WD) but not a document |
| Defense (DFS) | `UI_DFS_RELOCATIONSTOCKPLNG` | Fiori app service | 2 | 8 | Draft-style sets (TP/WD) but not a document |
| EHS - Health & Safety | `EHFND_SIMPLE_TDEF_SRV` | Fiori app service | 5 | 18 | Draft-style sets (TP/WD) but not a document |
| EHS - Health & Safety | `EHHSS_CIM_TASK_LIST` | Fiori app service | 1 | 14 | Draft-style sets (TP/WD) but not a document |
| EHS - Health & Safety | `EHHSS_HSM_HSI_SRV` | Fiori app service | 11 | 17 | Draft-style sets (TP/WD) but not a document |
| EHS - Health & Safety | `EHHSS_HSM_SI_EQUIP_SRV` | Fiori app service | 17 | 20 | Draft-style sets (TP/WD) but not a document |
| EHS - Health & Safety | `EHHSS_HSM_SI_GNRC_SRV` | Fiori app service | 16 | 19 | Draft-style sets (TP/WD) but not a document |
| EHS - Health & Safety | `EHHSS_HSM_SI_SRV` | Fiori app service | 17 | 20 | Draft-style sets (TP/WD) but not a document |
| EHS - Health & Safety | `EHHSS_IM_INV_TASK_LIST_SRV` | Fiori app service | 1 | 14 | Draft-style sets (TP/WD) but not a document |
| EHS - Health & Safety | `EHHSS_IM_TASK_LIST_SRV` | Fiori app service | 1 | 14 | Draft-style sets (TP/WD) but not a document |
| EHS - Health & Safety | `EHHSS_MY_OPEN_CTRL_IMPLEM_SRV` | Fiori app service | 2 | 15 | Draft-style sets (TP/WD) but not a document |
| EHS - Health & Safety | `EHHSS_RAS_PROFILE` | Fiori app service | 7 | 11 | Draft-style sets (TP/WD) but not a document |
| EHS - Health & Safety | `EHHSS_RAS_TASK_LIST` | Fiori app service | 1 | 14 | Draft-style sets (TP/WD) but not a document |
| EHS - Health & Safety | `EHHSS_RISK_TEMPLATE_SRV` | Fiori app service | 5 | 8 | Draft-style sets (TP/WD) but not a document |
| EHS - Health & Safety | `EHS_CI_CRV_ACTIVATION_SRV` | Fiori app service | 2 | 7 | Draft-style sets (TP/WD) but not a document |
| EHS - Health & Safety | `EHS_FND_CCI_ADDLPRPTY_SRV` | Fiori app service | 2 | 8 | Draft-style sets (TP/WD) but not a document |
| EHS - Health & Safety | `EHS_FND_CCI_CMBND_SRV` | Fiori app service | 4 | 28 | Draft-style sets (TP/WD) but not a document |
| EHS - Health & Safety | `EHS_FND_CCI_WASTECODE_SRV` | Fiori app service | 2 | 6 | Draft-style sets (TP/WD) but not a document |
| EHS - Health & Safety | `EHS_FND_SUBSTANCE_SRV` | Fiori app service | 6 | 14 | Draft-style sets (TP/WD) but not a document |
| EHS - Health & Safety | `EHS_PMA_MKT_INFO_SRV` | Fiori app service | 1 | 25 | Draft-style sets (TP/WD) but not a document |
| FI - Finance | `FAA_MD_MANAGE_SRV` | Fiori app service | 15 | 44 | Draft-style sets (TP/WD) but not a document |
| FI - Finance | `FAC_MANAGE_GLACCOUNT_SRV;v=0002` | Fiori app service | 10 | 13 | Draft-style sets (TP/WD) but not a document |
| FI - Finance | `FAP_BANK_CHAIN_SRV` | Fiori app service | 2 | 5 | Draft-style sets (TP/WD) but not a document |
| FI - Finance | `FAR_MANAGE_COLL_STRATEGIES_SRV` | Fiori app service | 7 | 6 | Draft-style sets (TP/WD) but not a document |
| FI - Finance | `FCLM_BAM_ACCOUNTWD_SRV` | Fiori app service | 5 | 38 | Draft-style sets (TP/WD) but not a document |
| FI - Finance | `FCLM_BRM_BANK_FEE_CONDITION_SRV` | Fiori app service | 2 | 4 | Draft-style sets (TP/WD) but not a document |
| FI - Finance | `FCLM_CASH_CONCN_SRV` | Fiori app service | 3 | 9 | Draft-style sets (TP/WD) but not a document |
| FI - Finance | `FCLM_CASH_CPLMGMT_MDL_SRV` | Fiori app service | 1 | 4 | Draft-style sets (TP/WD) but not a document |
| FI - Finance | `FCLM_CP_PAYMENTDETAIL_SRV` | Fiori app service | 2 | 4 | Draft-style sets (TP/WD) but not a document |
| FI - Finance | `FITAXCN_INVC_BND_SRV` | Fiori app service | 2 | 14 | Draft-style sets (TP/WD) but not a document |
| FI - Finance | `MANAGE_INCOMING_FORMAT_SRV` | Fiori app service | 5 | 36 | Draft-style sets (TP/WD) but not a document |
| FI - Finance | `MANAGE_OUTGOING_FORMAT_SRV` | Fiori app service | 5 | 37 | Draft-style sets (TP/WD) but not a document |
| FI - Finance | `UI_CACREDITWORTHINESS_MNG` | Fiori app service | 2 | 8 | Draft-style sets (TP/WD) but not a document |
| FI - Finance | `UI_IHBACCOUNTTEMPLATETP_02` | Fiori app service | 4 | 5 | Draft-style sets (TP/WD) but not a document |
| FI - Finance | `UI_IHBACCOUNTTP_02` | Fiori app service | 4 | 14 | Draft-style sets (TP/WD) but not a document |
| FI - Finance | `UI_IHBACCTLIMITOBJECTTP` | Fiori app service | 4 | 10 | Draft-style sets (TP/WD) but not a document |
| FI - Finance | `UI_IHBCONDITIONOBJECTTP` | Fiori app service | 4 | 10 | Draft-style sets (TP/WD) but not a document |
| FI - Finance | `UI_JOURNALENTRY_OTA_O2` | Fiori app service | 2 | 27 | Draft-style sets (TP/WD) but not a document |
| FI - Finance | `UI_MANAGEPAYMENTPLAN_O2` | Fiori app service | 3 | 7 | Draft-style sets (TP/WD) but not a document |
| FI - Finance | `UI_SUBSTNVALDNRULE_MANAGE` | Fiori app service | 16 | 14 | Draft-style sets (TP/WD) but not a document |
| LE - Shipping | `UI_SHIPMENTCONTAINERPACKG` | Fiori app service | 7 | 39 | Draft-style sets (TP/WD) but not a document |
| Legal - Trade - Compliance | `LCM_CONTENT_REQUEST` | Fiori app service | 19 | 19 | Draft-style sets (TP/WD) but not a document |
| Legal - Trade - Compliance | `LCM_CONTEXT_MANAGE_SRV` | Fiori app service | 3 | 16 | Draft-style sets (TP/WD) but not a document |
| Legal - Trade - Compliance | `LCM_DOCUMENT_MANAGE` | Fiori app service | 10 | 62 | Draft-style sets (TP/WD) but not a document |
| Legal - Trade - Compliance | `LCM_LEGALTR_MANAGE` | Fiori app service | 17 | 79 | Draft-style sets (TP/WD) but not a document |
| MM - Inventory | `LO_BM_BATCH_SRV` | Fiori app service | 4 | 34 | Draft-style sets (TP/WD) but not a document |
| MM - Inventory | `UI_STOCKREPPROC_O2` | Fiori app service | 1 | 5 | Draft-style sets (TP/WD) but not a document |
| MM - Inventory | `UI_STOCKREPSUBS_O2` | Fiori app service | 2 | 10 | Draft-style sets (TP/WD) but not a document |
| MM - Purchasing | `MMPUR_REL_STRAT_CLASS_SRV` | Fiori app service | 4 | 12 | Draft-style sets (TP/WD) but not a document |
| MM - Purchasing | `MM_PUR_CATALOGITEMS_MNG_SRV` | Fiori app service | 2 | 6 | Draft-style sets (TP/WD) but not a document |
| MM - Purchasing | `MM_PUR_MANAGE_BUS_AUTOMN_RULES_SRV` | Fiori app service | 8 | 12 | Draft-style sets (TP/WD) but not a document |
| MM - Purchasing | `MM_PUR_QA_MAINTAIN` | Fiori app service | 2 | 5 | Draft-style sets (TP/WD) but not a document |
| Master data - MDG | `UI_MODPRODSPEC_MANAGE` | Fiori app service | 1 | 18 | Draft-style sets (TP/WD) but not a document |
| PM - Maintenance | `LO_VCHCLF_GROUP_MAINTAIN_SRV` | Fiori app service | 3 | 7 | Draft-style sets (TP/WD) but not a document |
| PM - Maintenance | `RSH_EAM_ORDER_GANTT_SRV` | Fiori app service | 8 | 59 | Draft-style sets (TP/WD) but not a document |
| PP - Production | `BILLOFMATERIALV2_SRV` | Fiori app service | 5 | 47 | Draft-style sets (TP/WD) but not a document |
| PP - Production | `C_MRPCTRLRBYAOR_SRV` | Fiori app service | 1 | 1 | Draft-style sets (TP/WD) but not a document |
| PP - Production | `C_WORKCNTRGRPBYAOR_SRV` | Fiori app service | 1 | 0 | Draft-style sets (TP/WD) but not a document |
| PP - Production | `LO_VCHCLF_CFE_KEYUSERAPP_SRV` | Fiori app service | 1 | 5 | Draft-style sets (TP/WD) but not a document |
| PP - Production | `LO_VCHCLF_PROFILE_ASSIGN_GROUP_SRV` | Fiori app service | 2 | 4 | Draft-style sets (TP/WD) but not a document |
| PP - Production | `MPEACTIONSETTING_SRV` | Fiori app service | 3 | 5 | Draft-style sets (TP/WD) but not a document |
| PP - Production | `MPE_MANAGE_PRODVER_SRV` | Fiori app service | 2 | 7 | Draft-style sets (TP/WD) but not a document |
| PP - Production | `MPE_QUALIFICATIONS_SRV` | Fiori app service | 2 | 0 | Draft-style sets (TP/WD) but not a document |
| PP - Production | `PLMI_SYNCUNITR2B_MANAGE` | Fiori app service | 1 | 38 | Draft-style sets (TP/WD) but not a document |
| PP - Production | `PP_CFS_CAPEVAL_SRV` | Fiori app service | 4 | 9 | Draft-style sets (TP/WD) but not a document |
| PP - Production | `PP_DD_BUFPOS_SRV` | Fiori app service | 3 | 9 | Draft-style sets (TP/WD) but not a document |
| PP - Production | `PP_DD_STLM_SRV` | Fiori app service | 7 | 15 | Draft-style sets (TP/WD) but not a document |
| PS - Projects | `CA_RSM_TEAM_SRV` | Fiori app service | 7 | 21 | Draft-style sets (TP/WD) but not a document |
| QM - Quality | `QM_QTASK_PROC_SRV` | Fiori app service | 4 | 47 | Draft-style sets (TP/WD) but not a document |
| Retail (RFM) | `UI_RFM_POCNSLDTNRULE` | Fiori app service | 1 | 5 | Draft-style sets (TP/WD) but not a document |
| SD - Sales | `SD_MANAGE_SADVTNPRFL` | Fiori app service | 1 | 0 | Draft-style sets (TP/WD) but not a document |
| SD - Sales | `SD_SALESPLAN` | Fiori app service | 3 | 8 | Draft-style sets (TP/WD) but not a document |

### Unclear from name (152)

| Module | Service | Type | Sets | POST | Reason |
|---|---|---|---|---|---|
| ATP - Availability | `ATP_RELEASE_FOR_DELIVERY` | Fiori app service | 7 | 7 | Needs a metadata and implementation check |
| ATP - Availability | `UI_ALTVDETN_CONFIGURE` | Fiori app service | 6 | 15 | Needs a metadata and implementation check |
| CO - Controlling | `FCO_ACTUAL_COST_RATE_SRV` | Fiori app service | 2 | 0 | Needs a metadata and implementation check |
| CO - Controlling | `FCO_MANAGE_COST_CENTERS_SRV` | Fiori app service | 2 | 10 | Needs a metadata and implementation check |
| CO - Controlling | `FCO_MS_SPEND_SRV` | Fiori app service | 12 | 1 | Needs a metadata and implementation check |
| CO - Controlling | `FCO_MU_SRV` | Fiori app service | 11 | 0 | Needs a metadata and implementation check |
| CO - Controlling | `FCO_PLAN_COST_RATE_SRV` | Fiori app service | 2 | 0 | Needs a metadata and implementation check |
| CO - Controlling | `FCO_PROF_SEGMENT_SRV` | Fiori app service | 1 | 8 | Needs a metadata and implementation check |
| CO - Controlling | `FCO_SERVICE_COST_RATE_SRV` | Fiori app service | 3 | 0 | Needs a metadata and implementation check |
| CO - Controlling | `FCO_STATISTICAL_KEY_FIGURE_V2_SRV` | Fiori app service | 3 | 6 | Needs a metadata and implementation check |
| CO - Controlling | `FML_ESTDCOSTRUN_MANAGE_SRV` | Fiori app service | 1 | 2 | Needs a metadata and implementation check |
| CO - Controlling | `UI_FCO_ACTL_SETTLEMENT_O2` | Fiori app service | 1 | 7 | Needs a metadata and implementation check |
| CO - Controlling | `UI_FCO_OVERHEAD_CALC_O2` | Fiori app service | 1 | 6 | Needs a metadata and implementation check |
| Defense (DFS) | `UI_C_DFS_ALLWNCPLAN` | Fiori app service | 2 | 10 | Needs a metadata and implementation check |
| Defense (DFS) | `UI_C_DFS_ALLWNCREQ` | Fiori app service | 2 | 1 | Needs a metadata and implementation check |
| EHS - Health & Safety | `EHFND_TDEF_MNTF_SRV` | Fiori app service | 2 | 16 | Needs a metadata and implementation check |
| EHS - Health & Safety | `EHFND_TDEF_MOC_SRV` | Fiori app service | 2 | 16 | Needs a metadata and implementation check |
| EHS - Health & Safety | `EHHSS_ASSIGN_RISKS_SRV` | Fiori app service | 2 | 1 | Needs a metadata and implementation check |
| EHS - Health & Safety | `EHHSS_HOURS_WORKED_SRV` | Fiori app service | 2 | 3 | Needs a metadata and implementation check |
| EHS - Health & Safety | `EHHSS_HSM_FSI_TEXT_SRV` | Fiori app service | 2 | 0 | Needs a metadata and implementation check |
| EHS - Health & Safety | `EHHSS_IDENTIFY_RISKS_SRV` | Fiori app service | 6 | 3 | Needs a metadata and implementation check |
| EHS - Health & Safety | `EM_MONITORDATA_SRV` | Fiori app service | 3 | 6 | Needs a metadata and implementation check |
| EWM - Warehouse | `API_WAREHOUSE_RESOURCE` | Released API | 1 | 2 | Needs a metadata and implementation check |
| EWM - Warehouse | `CUSTOMER_RETURNS_SRV` | Fiori app service | 8 | 0 | Needs a metadata and implementation check |
| EWM - Warehouse | `PACK_OUTBDLV_SRV` | Fiori app service | 6 | 9 | Needs a metadata and implementation check |
| EWM - Warehouse | `PICKCART_SRV` | Fiori app service | 5 | 7 | Needs a metadata and implementation check |
| EWM - Warehouse | `PICKLIST_PAPER_SRV` | Fiori app service | 5 | 5 | Needs a metadata and implementation check |
| EWM - Warehouse | `RECORD_INVENTORY_SRV` | Fiori app service | 1 | 4 | Needs a metadata and implementation check |
| EWM - Warehouse | `SIMPLE_INB_DLV_SRV` | Fiori app service | 7 | 9 | Needs a metadata and implementation check |
| EWM - Warehouse | `SIMPLE_INB_PO_SRV` | Fiori app service | 4 | 0 | Needs a metadata and implementation check |
| EWM - Warehouse | `SIMPLE_OUTB_DLV_SRV` | Fiori app service | 4 | 16 | Needs a metadata and implementation check |
| EWM - Warehouse | `SIMPLE_OUTB_TU_SRV` | Fiori app service | 3 | 11 | Needs a metadata and implementation check |
| FI - Finance | `ACCDET` | Fiori app service | 5 | 0 | Needs a metadata and implementation check |
| FI - Finance | `BANKCASHBALANCE_O2` | Fiori app service | 2 | 0 | Needs a metadata and implementation check |
| FI - Finance | `BANKSTATEMENTPROCCONF_O2` | Fiori app service | 2 | 5 | Needs a metadata and implementation check |
| FI - Finance | `EDOC_DCC_SRV` | Fiori app service | 3 | 0 | Needs a metadata and implementation check |
| FI - Finance | `FAC_ACC_DETERMINATION_SRV` | Fiori app service | 43 | 0 | Needs a metadata and implementation check |
| FI - Finance | `FAC_CURRENCY_EXCHANGE_RATE_SRV` | Fiori app service | 1 | 5 | Needs a metadata and implementation check |
| FI - Finance | `FAC_CUSTOM_HIERARCHY_SRV` | Fiori app service | 1 | 0 | Needs a metadata and implementation check |
| FI - Finance | `FAC_FLEXIBLE_HIERARCHY_SRV` | Fiori app service | 7 | 3 | Needs a metadata and implementation check |
| FI - Finance | `FAC_GL_ACCOUNT_BALANCE_SRV` | Fiori app service | 1 | 0 | Needs a metadata and implementation check |
| FI - Finance | `FAC_GRIR_RECONCILIATION_SRV` | Fiori app service | 1 | 0 | Needs a metadata and implementation check |
| FI - Finance | `FAC_MANAGE_POSTING_TMPL_SRV` | Fiori app service | 4 | 3 | Needs a metadata and implementation check |
| FI - Finance | `FAC_RVW_APPRV_ACCRUALS_SRV` | Fiori app service | 2 | 4 | Needs a metadata and implementation check |
| FI - Finance | `FAC_UNIVERSAL_HIERARCHY_SRV` | Fiori app service | 8 | 24 | Needs a metadata and implementation check |
| FI - Finance | `FAP_CHECK_BOOKS_SRV` | Fiori app service | 1 | 4 | Needs a metadata and implementation check |
| FI - Finance | `FAP_OUTGOING_CHECKS_SRV` | Fiori app service | 2 | 4 | Needs a metadata and implementation check |
| FI - Finance | `FAP_PROCESS_FF_PAYMENTS_SRV` | Fiori app service | 3 | 8 | Needs a metadata and implementation check |
| FI - Finance | `FAP_REVISE_PAYMENT_PROPOSAL` | Fiori app service | 5 | 9 | Needs a metadata and implementation check |
| FI - Finance | `FAP_SCHEDULE_PAYMENT_PROPOSAL` | Fiori app service | 10 | 6 | Needs a metadata and implementation check |
| FI - Finance | `FAR_MANAGE_BS_SRV` | Fiori app service | 2 | 12 | Needs a metadata and implementation check |
| FI - Finance | `FAR_MANAGE_PR_SRV` | Fiori app service | 5 | 23 | Needs a metadata and implementation check |
| FI - Finance | `FCLM_BAM_SRV` | Fiori app service | 1 | 0 | Needs a metadata and implementation check |
| FI - Finance | `FCLM_BM_SRV` | Fiori app service | 7 | 1 | Needs a metadata and implementation check |
| FI - Finance | `FCLM_CASH_BANKTRANSFERTEM_SRV` | Fiori app service | 1 | 3 | Needs a metadata and implementation check |
| FI - Finance | `FCLM_CP_TRACK_SRV` | Fiori app service | 3 | 0 | Needs a metadata and implementation check |
| FI - Finance | `FIGL_EXT_RECON_SRV` | Fiori app service | 1 | 0 | Needs a metadata and implementation check |
| FI - Finance | `FIORI_CORR_SRV` | Fiori app service | 13 | 3 | Needs a metadata and implementation check |
| FI - Finance | `FIORI_INBOX_SRV` | Fiori app service | 9 | 0 | Needs a metadata and implementation check |
| FI - Finance | `FIORI_MANAGE_SRV` | Fiori app service | 72 | 17 | Needs a metadata and implementation check |
| FI - Finance | `FIORI_PAYBLOCK_SRV` | Fiori app service | 7 | 0 | Needs a metadata and implementation check |
| FI - Finance | `FIORI_PAYRULE_SRV` | Fiori app service | 12 | 16 | Needs a metadata and implementation check |
| FI - Finance | `FIORI_REPAIR_SRV` | Fiori app service | 65 | 28 | Needs a metadata and implementation check |
| FI - Finance | `FI_CORRESPONDENCE_SRV` | Fiori app service | 5 | 1 | Needs a metadata and implementation check |
| FI - Finance | `FI_CORRESPONDENCE_V2_SRV` | Fiori app service | 8 | 0 | Needs a metadata and implementation check |
| FI - Finance | `FXM_BAL_EXP_SRV` | Fiori app service | 1 | 0 | Needs a metadata and implementation check |
| FI - Finance | `ICA_ASSIGNMENT_SRV` | Fiori app service | 5 | 4 | Needs a metadata and implementation check |
| FI - Finance | `ICA_MATCHING_ITEM_SRV` | Fiori app service | 2 | 0 | Needs a metadata and implementation check |
| FI - Finance | `ICA_RECON_CASE_SRV` | Fiori app service | 1 | 3 | Needs a metadata and implementation check |
| FI - Finance | `J_1BNFE_CONTINGENCY_SRV` | Fiori app service | 1 | 0 | Needs a metadata and implementation check |
| FI - Finance | `O2C_FICA_CORR_DISPLAY_SRV` | Fiori app service | 1 | 2 | Needs a metadata and implementation check |
| FI - Finance | `O2C_FICA_GENTOOLS` | Fiori app service | 2 | 0 | Needs a metadata and implementation check |
| FI - Finance | `UI_BANKPOWEROFATTORNEY_IMP` | Fiori app service | 7 | 16 | Needs a metadata and implementation check |
| FI - Finance | `UI_BANKPOWEROFATTORNEY_MNG` | Fiori app service | 6 | 14 | Needs a metadata and implementation check |
| FI - Finance | `UI_CASHPOOL_MANAGE` | Fiori app service | 3 | 5 | Needs a metadata and implementation check |
| FI - Finance | `UI_COLLECTIONS_EMAIL` | Fiori app service | 2 | 9 | Needs a metadata and implementation check |
| FI - Finance | `UI_COLL_CONTACT_MANAGE` | Fiori app service | 1 | 7 | Needs a metadata and implementation check |
| FI - Finance | `UI_COLL_MD_MANAGE` | Fiori app service | 4 | 7 | Needs a metadata and implementation check |
| FI - Finance | `UI_DISPUTE_PROPOSAL_ASSGMT` | Fiori app service | 1 | 15 | Needs a metadata and implementation check |
| FI - Finance | `UI_FIXEDASSETUSAGEOBJ_MNTN` | Fiori app service | 3 | 9 | Needs a metadata and implementation check |
| FI - Finance | `UI_INVOICEPRIOZNRULE_MAN` | Fiori app service | 4 | 15 | Needs a metadata and implementation check |
| FI - Finance | `UI_PROCESSRECEIVABLES_MAN` | Fiori app service | 4 | 47 | Needs a metadata and implementation check |
| FI - Finance | `UI_RESUBMISSIONS_MANAGE` | Fiori app service | 2 | 7 | Needs a metadata and implementation check |
| FI - Finance | `UI_SUBSTNVALDTNLOGSETTINGS` | Fiori app service | 1 | 0 | Needs a metadata and implementation check |
| HR - Payroll - Travel | `PYC_TEAM_MAINT_SRV` | Fiori app service | 8 | 0 | Needs a metadata and implementation check |
| LE - Shipping | `UI_SHIPMENTCONTAINER` | Fiori app service | 3 | 13 | Needs a metadata and implementation check |
| Legal - Trade - Compliance | `LCM_TASK_MANAGE` | Fiori app service | 2 | 2 | Needs a metadata and implementation check |
| Legal - Trade - Compliance | `SLL_CTRLCL_MANAGE` | Fiori app service | 1 | 0 | Needs a metadata and implementation check |
| MM - Purchasing | `FAC_POAC_RVW_WF_SRV` | Fiori app service | 1 | 1 | Needs a metadata and implementation check |
| MM - Purchasing | `MATPLANTPURSOURCELIST_SRV` | Fiori app service | 2 | 7 | Needs a metadata and implementation check |
| MM - Purchasing | `MMPUR_AUTOMATION_PROCESS_SRV` | Fiori app service | 1 | 2 | Needs a metadata and implementation check |
| MM - Purchasing | `MM_PRC_SEV_CONFIG` | Fiori app service | 3 | 0 | Needs a metadata and implementation check |
| MM - Purchasing | `MM_PUR_INFO_RECORDS_MANAGE_SRV` | Fiori app service | 2 | 4 | Needs a metadata and implementation check |
| MM - Purchasing | `MM_PUR_INFO_RECORD_UPDATE_SRV` | Fiori app service | 2 | 0 | Needs a metadata and implementation check |
| MM - Purchasing | `MM_PUR_OCI_SRV` | Fiori app service | 1 | 0 | Needs a metadata and implementation check |
| MM - Purchasing | `MM_PUR_QTN_COMPARE_SRV` | Fiori app service | 3 | 5 | Needs a metadata and implementation check |
| MM - Purchasing | `MM_PUR_REL_STRATEGY_SRV` | Fiori app service | 6 | 5 | Needs a metadata and implementation check |
| MM - Purchasing | `MM_PUR_REQ_APPROVAL_COMPLETION_SRV` | Fiori app service | 5 | 17 | Needs a metadata and implementation check |
| MM - Purchasing | `UI_SRCGPROJAWDSCEN_MANAGE` | Fiori app service | 1 | 10 | Needs a metadata and implementation check |
| MM - Purchasing | `UI_SUPLRUSRDFNDCRITRA` | Fiori app service | 1 | 7 | Needs a metadata and implementation check |
| MM - Purchasing | `UI_SUPPLIERLIST_MANAGE` | Fiori app service | 6 | 24 | Needs a metadata and implementation check |
| Master data - MDG | `MDC_CUSTMIZING` | Fiori app service | 4 | 2 | Needs a metadata and implementation check |
| Master data - MDG | `MDC_CUSTOM_OBJECT_SRV` | Fiori app service | 2 | 2 | Needs a metadata and implementation check |
| Master data - MDG | `MDC_PROCESS_SRV__1405` | Fiori app service | 3 | 23 | Needs a metadata and implementation check |
| Master data - MDG | `MDC_PROCESS_SRV__147` | Fiori app service | 3 | 23 | Needs a metadata and implementation check |
| Master data - MDG | `MDC_PROCESS_SRV__194` | Fiori app service | 3 | 23 | Needs a metadata and implementation check |
| Master data - MDG | `MDC_PROCESS_SRV__986` | Fiori app service | 3 | 23 | Needs a metadata and implementation check |
| Master data - MDG | `MDC_TRACK_CHANGES_SRV__1405` | Fiori app service | 2 | 1 | Needs a metadata and implementation check |
| Master data - MDG | `MDC_TRACK_CHANGES_SRV__147` | Fiori app service | 2 | 1 | Needs a metadata and implementation check |
| Master data - MDG | `MDC_TRACK_CHANGES_SRV__194` | Fiori app service | 2 | 1 | Needs a metadata and implementation check |
| Master data - MDG | `MD_QC_PRODUCT_SRV` | Fiori app service | 2 | 3 | Needs a metadata and implementation check |
| PM - Maintenance | `DFS_MAINT_NOTIFICATION_SRV` | Fiori app service | 2 | 18 | Needs a metadata and implementation check |
| PM - Maintenance | `DFS_MAINT_ORDANDOPERATION_SRV` | Fiori app service | 4 | 37 | Needs a metadata and implementation check |
| PM - Maintenance | `EAM_OBJPG_MAINTENANCEORDER_SRV` | Fiori app service | 2 | 54 | Needs a metadata and implementation check |
| PM - Maintenance | `EAM_OBJPG_MAINTITEM_SRV` | Fiori app service | 1 | 2 | Needs a metadata and implementation check |
| PM - Maintenance | `EAM_OBJPG_MAINTNOTIFICATION_SRV` | Fiori app service | 2 | 16 | Needs a metadata and implementation check |
| PM - Maintenance | `EAM_OBJPG_MAINTORDANDOPER_SRV` | Fiori app service | 4 | 37 | Needs a metadata and implementation check |
| PM - Maintenance | `FAC_GL_MAINT_POSTING_PERIOD_SRV` | Fiori app service | 3 | 0 | Needs a metadata and implementation check |
| PM - Maintenance | `FAC_MAINT_CHART_OF_ACCOUNTS_SRV` | Fiori app service | 3 | 0 | Needs a metadata and implementation check |
| PM - Maintenance | `ICA_MATCH_METHOD_SRV` | Fiori app service | 1 | 10 | Needs a metadata and implementation check |
| PM - Maintenance | `MMIM_PI_CYC_MAINT_SRV` | Fiori app service | 1 | 1 | Needs a metadata and implementation check |
| PM - Maintenance | `MMPUR_PROC_CAT_MAINT_SRV` | Fiori app service | 2 | 5 | Needs a metadata and implementation check |
| PM - Maintenance | `RSH_EAM_MAINT_ASSET_BOARD_SRV` | Fiori app service | 2 | 18 | Needs a metadata and implementation check |
| PM - Maintenance | `RSH_EAM_RES_ASSIGNMENT_SRV` | Fiori app service | 5 | 5 | Needs a metadata and implementation check |
| PM - Maintenance | `UI_C_DFS_MAINT_PLATFORM` | Fiori app service | 1 | 9 | Needs a metadata and implementation check |
| PP - Production | `FCO_PRODUCTION_COST_ANALYSIS_SRV` | Fiori app service | 5 | 0 | Needs a metadata and implementation check |
| PP - Production | `MPE_BUYOFFCYCLE_SRV` | Fiori app service | 1 | 11 | Needs a metadata and implementation check |
| PP - Production | `MPE_EXEC_RR_SRV` | Fiori app service | 7 | 2 | Needs a metadata and implementation check |
| PP - Production | `MPE_OA_EXECUTION_SRV` | Fiori app service | 7 | 69 | Needs a metadata and implementation check |
| PP - Production | `PLMI_PROCESS_ROUTE` | Fiori app service | 6 | 9 | Needs a metadata and implementation check |
| PP - Production | `PLMI_RECIPE_FINDER` | Fiori app service | 1 | 0 | Needs a metadata and implementation check |
| PP - Production | `PMRP_FLXBLCSTRT_UI_SERVICE` | Fiori app service | 3 | 9 | Needs a metadata and implementation check |
| PP - Production | `PMRP_RECEIPT_SERVICE` | Fiori app service | 1 | 0 | Needs a metadata and implementation check |
| PP - Production | `PPDS_CAPA_UTIL_OBJ_SRV` | Fiori app service | 1 | 5 | Needs a metadata and implementation check |
| PP - Production | `PP_MPE_OPER_MANAGE` | Fiori app service | 1 | 41 | Needs a metadata and implementation check |
| PP - Production | `PP_PROCESS_ORDER_MANAGE_SRV` | Fiori app service | 1 | 5 | Needs a metadata and implementation check |
| PP - Production | `UI_PRODUCTIONVERSION` | Fiori app service | 3 | 16 | Needs a metadata and implementation check |
| PP - Production | `UI_VARCNFCHARCEXCLMAN` | Fiori app service | 1 | 1 | Needs a metadata and implementation check |
| PP - Production | `UI_WORKCENTERCAPLIST_02` | Fiori app service | 3 | 3 | Needs a metadata and implementation check |
| PS - Projects | `CA_RSM_TEAM_ACTION_SRV` | Fiori app service | 1 | 0 | Needs a metadata and implementation check |
| QM - Quality | `QM_FMEA_MNG_SRV` | Fiori app service | 4 | 9 | Needs a metadata and implementation check |
| QM - Quality | `QM_INFOREC_PROC_MANAGE_SRV` | Fiori app service | 2 | 10 | Needs a metadata and implementation check |
| QM - Quality | `QM_INSP_PLAN_SRV` | Fiori app service | 5 | 11 | Needs a metadata and implementation check |
| Retail (RFM) | `UI_RFM_ASSIGN_PROD_TO_DCS` | Fiori app service | 1 | 1 | Needs a metadata and implementation check |
| Retail (RFM) | `UI_RFM_MNG_ASSTMT_MODULES` | Fiori app service | 6 | 10 | Needs a metadata and implementation check |
| Retail (RFM) | `UI_RFM_PROD_ASSGN_EXPL_ASM` | Fiori app service | 1 | 2 | Needs a metadata and implementation check |
| Retail (RFM) | `UI_RFM_SUPPLY_SORTRULE` | Fiori app service | 4 | 6 | Needs a metadata and implementation check |
| Retail (RFM) | `UI_RFM_USR_ASSIGN_EXPL_ASM` | Fiori app service | 1 | 4 | Needs a metadata and implementation check |
| SD - Sales | `SD_F2650_CRT_EDIT_SRV` | Fiori app service | 3 | 2 | Needs a metadata and implementation check |
| SD - Sales | `SD_F2652_CRT_REFUND_SRV` | Fiori app service | 2 | 0 | Needs a metadata and implementation check |
| SD - Sales | `UI_CUSTOMER_CONTACT_MANAGE` | Fiori app service | 2 | 8 | Needs a metadata and implementation check |
| SD - Sales | `UI_RETURNPROCESSING` | Fiori app service | 3 | 34 | Needs a metadata and implementation check |

### Not proper (155)

| Module | Service | Type | Sets | POST | Reason |
|---|---|---|---|---|---|
| Basis - Fiori - Technical | `ANA_QUERY_DESIGNER` | Fiori app service | 1 | 11 | Technical platform service |
| Basis - Fiori - Technical | `APJ_JOB_MANAGEMENT_SRV` | Fiori app service | 8 | 7 | Technical platform service |
| Basis - Fiori - Technical | `APS_CUSTOM_FIELD_MAINTENANCE_SRV` | Fiori app service | 5 | 8 | Technical platform service |
| Basis - Fiori - Technical | `APS_DATA_SOURCE_EXTENSION_SRV` | Fiori app service | 2 | 0 | Technical platform service |
| Basis - Fiori - Technical | `APS_OM_EMAIL_TMPL_SRV` | Fiori app service | 1 | 5 | Technical platform service |
| Basis - Fiori - Technical | `CATALOGSERVICE` | Fiori app service | 1 | 0 | Technical platform service |
| Basis - Fiori - Technical | `CATALOGSERVICE;v=0002` | Fiori app service | 3 | 0 | Technical platform service |
| Basis - Fiori - Technical | `CA_BPF_LAYOUT_METADATA_SRV` | Fiori app service | 2 | 14 | Technical platform service |
| Basis - Fiori - Technical | `CA_SIT2_MST_SRV` | Fiori app service | 19 | 34 | Technical platform service |
| Basis - Fiori - Technical | `CA_SIT_PUWB_SRV` | Fiori app service | 12 | 24 | Technical platform service |
| Basis - Fiori - Technical | `CMD_HPC_NODE_CONTEXT_INFO` | Fiori app service | 1 | 0 | Technical platform service |
| Basis - Fiori - Technical | `CV_ATTACHMENT_SRV` | Fiori app service | 5 | 9 | Technical platform service |
| Basis - Fiori - Technical | `CV_DOCUMENT_MANAGE` | Fiori app service | 7 | 43 | Technical platform service |
| Basis - Fiori - Technical | `ESH_SEARCH_SRV` | Fiori app service | 12 | 0 | Technical platform service |
| Basis - Fiori - Technical | `FDM_PAGE_REPOSITORY_CUST_SRV` | Fiori app service | 2 | 3 | Technical platform service |
| Basis - Fiori - Technical | `FDM_PAGE_REPOSITORY_SRV` | Fiori app service | 2 | 3 | Technical platform service |
| Basis - Fiori - Technical | `FDM_PAGE_RUNTIME_SRV` | Fiori app service | 1 | 0 | Technical platform service |
| Basis - Fiori - Technical | `FDM_SPACE_REPOSITORY_CUST_SRV` | Fiori app service | 1 | 1 | Technical platform service |
| Basis - Fiori - Technical | `INTEROP` | Fiori app service | 12 | 0 | Technical platform service |
| Basis - Fiori - Technical | `ISLM_IS_SRV` | Fiori app service | 3 | 5 | Technical platform service |
| Basis - Fiori - Technical | `ISLM_REPOSITORY_SRV` | Fiori app service | 4 | 3 | Technical platform service |
| Basis - Fiori - Technical | `MIG_MC_ODATA_SRV` | Fiori app service | 44 | 47 | Technical platform service |
| Basis - Fiori - Technical | `PAGE_BUILDER_CONF` | Fiori app service | 11 | 2 | Technical platform service |
| Basis - Fiori - Technical | `PAGE_BUILDER_CUST` | Fiori app service | 11 | 2 | Technical platform service |
| Basis - Fiori - Technical | `PAGE_BUILDER_PERS` | Fiori app service | 11 | 2 | Technical platform service |
| Basis - Fiori - Technical | `SB_MANAGE_SLA` | Fiori app service | 14 | 3 | Technical platform service |
| Basis - Fiori - Technical | `SCENARIO_BUILDER_SRV` | Fiori app service | 7 | 10 | Technical platform service |
| Basis - Fiori - Technical | `SGBT_NTE_CDS_API_D_SRV` | Fiori app service | 2 | 5 | Technical platform service |
| Basis - Fiori - Technical | `SGBT_NTE_CDS_API_SRV` | Fiori app service | 1 | 0 | Technical platform service |
| Basis - Fiori - Technical | `SLC_ACTIVITY_COPILOT_SRV` | Fiori app service | 1 | 0 | Technical platform service |
| Basis - Fiori - Technical | `SRF_REPORTING_TASK` | Fiori app service | 4 | 17 | Technical platform service |
| Basis - Fiori - Technical | `SWF_FLEX_DEF_SRV` | Fiori app service | 1 | 8 | Technical platform service |
| Basis - Fiori - Technical | `SWF_FLEX_TEMPLATE_SRV` | Fiori app service | 1 | 4 | Technical platform service |
| Basis - Fiori - Technical | `TASKPROCESSING;v=0002` | Fiori app service | 6 | 11 | Technical platform service |
| Basis - Fiori - Technical | `TRANSPORT` | Fiori app service | 3 | 0 | Technical platform service |
| Basis - Fiori - Technical | `UI_BSESNAPSHOT_PROCESS` | Fiori app service | 1 | 2 | Technical platform service |
| Basis - Fiori - Technical | `UI_IMPCTMGMTSCENARIOMANAGE` | Fiori app service | 3 | 10 | Technical platform service |
| Basis - Fiori - Technical | `USERDEFAULTS` | Fiori app service | 7 | 6 | Technical platform service |
| CO - Controlling | `FCO_ACTIVITY_TYPE_SRV` | Fiori app service | 2 | 0 | Only helper, return-type or object-page sets |
| CO - Controlling | `FCO_CORE_SRV` | Fiori app service | 7 | 0 | Only helper, return-type or object-page sets |
| CO - Controlling | `FCO_INTERNAL_ORDER_SRV` | Fiori app service | 2 | 0 | Only helper, return-type or object-page sets |
| CO - Controlling | `FCO_RUN_ALLOCATION_SRV` | Fiori app service | 4 | 6 | Only helper, return-type or object-page sets |
| CO - Controlling | `FCO_SKF_PLANDATA_UPLOAD_SRV` | Fiori app service | 1 | 2 | Mass, upload, worklist, monitor or analytic service |
| CO - Controlling | `FML_MATLVCA_DISP_SRV` | Fiori app service | 2 | 2 | Only helper, return-type or object-page sets |
| CO - Controlling | `FML_UPLMATINVPR_SRV` | Fiori app service | 7 | 14 | Only helper, return-type or object-page sets |
| EHS - Health & Safety | `EHFND_LOCATION_ROLES_SRV` | Fiori app service | 1 | 2 | Only helper, return-type or object-page sets |
| EHS - Health & Safety | `EHFND_TASK_CALENDAR_SRV` | Fiori app service | 1 | 1 | Only helper, return-type or object-page sets |
| EHS - Health & Safety | `EHFND_TASK_INSTANCE_SRV` | Fiori app service | 2 | 7 | Only helper, return-type or object-page sets |
| EHS - Health & Safety | `EHHSS_INJ_ILL_LOG_SRV` | Fiori app service | 1 | 0 | Only helper, return-type or object-page sets |
| EHS - Health & Safety | `EHHSS_MANAGE_INCIDENT_SRV` | Fiori app service | 1 | 1 | Only helper, return-type or object-page sets |
| EHS - Health & Safety | `EHHSS_SMR_REP_SRV` | Fiori app service | 1 | 1 | Only helper, return-type or object-page sets |
| EHS - Health & Safety | `EHHSS_SMR_REP_TP_SRV` | Fiori app service | 1 | 6 | Only helper, return-type or object-page sets |
| EHS - Health & Safety | `EHS_EM_IMPORTENVDATA_SRV` | Fiori app service | 1 | 0 | Only helper, return-type or object-page sets |
| EHS - Health & Safety | `EHS_EM_MYDATACOLL_SRV` | Fiori app service | 1 | 6 | Only helper, return-type or object-page sets |
| EHS - Health & Safety | `EHS_MOC_MANACTY_SRV` | Fiori app service | 1 | 0 | Only helper, return-type or object-page sets |
| FI - Finance | `FAC_DSP_DOC_FLW_SRV` | Fiori app service | 1 | 0 | Only helper, return-type or object-page sets |
| FI - Finance | `FAC_GL_OVP_SRV` | Fiori app service | 1 | 0 | Only helper, return-type or object-page sets |
| FI - Finance | `FAC_GL_PPV_SRV` | Fiori app service | 3 | 0 | Mass, upload, worklist, monitor or analytic service |
| FI - Finance | `FAP_APPROVEBANKPAYMENTS_SRV` | Fiori app service | 4 | 7 | Only helper, return-type or object-page sets |
| FI - Finance | `FAP_DISP_PROCESS_FLOW_SRV` | Fiori app service | 4 | 0 | Only helper, return-type or object-page sets |
| FI - Finance | `FAP_MONPAYBATCHS_SRV` | Fiori app service | 3 | 3 | Only helper, return-type or object-page sets |
| FI - Finance | `FAP_VENDOR_LINE_ITEMS_SRV` | Fiori app service | 2 | 2 | Only helper, return-type or object-page sets |
| FI - Finance | `FARR_CONTRACT_OVERVIEW` | Fiori app service | 1 | 8 | Mass, upload, worklist, monitor or analytic service |
| FI - Finance | `FAR_CUSTOMER_LINE_ITEMS` | Fiori app service | 2 | 2 | Only helper, return-type or object-page sets |
| FI - Finance | `FAR_DISP_PROCESS_FLOW_SRV` | Fiori app service | 2 | 0 | Mass, upload, worklist, monitor or analytic service |
| FI - Finance | `FAR_MY_DUNNING_PROPOSAL_SRV` | Fiori app service | 2 | 2 | Only helper, return-type or object-page sets |
| FI - Finance | `FIGL_MANAGE_TAX_ITEMS_SRV` | Fiori app service | 4 | 0 | Only helper, return-type or object-page sets |
| FI - Finance | `FINS_ACDOC_PLAN_IMPORT_SRV` | Fiori app service | 2 | 3 | Mass, upload, worklist, monitor or analytic service |
| FI - Finance | `FINS_ACDOC_PLAN_MANAGE_REVERSL_SRV` | Fiori app service | 1 | 1 | Only helper, return-type or object-page sets |
| FI - Finance | `FINS_TRR_PECRUN_PROJECT_SRV_01` | Fiori app service | 1 | 5 | Only helper, return-type or object-page sets |
| FI - Finance | `FINS_TRR_PECRUN_REALTIME_SRV` | Fiori app service | 2 | 2 | Only helper, return-type or object-page sets |
| FI - Finance | `FINS_TRR_PECRUN_SRVDOC_SRV` | Fiori app service | 1 | 5 | Only helper, return-type or object-page sets |
| FI - Finance | `ICA_MATCHING_DOC_SRV` | Fiori app service | 1 | 3 | Only helper, return-type or object-page sets |
| FI - Finance | `ICA_RECON_CLOSE_SRV` | Fiori app service | 1 | 5 | Only helper, return-type or object-page sets |
| FI - Finance | `IHB_ACC_UPLOAD_SRV` | Fiori app service | 2 | 0 | Mass, upload, worklist, monitor or analytic service |
| FI - Finance | `MAP_FORMAT_DATA_SRV` | Fiori app service | 2 | 0 | Only helper, return-type or object-page sets |
| FI - Finance | `O2C_FICA_RECOKEY_MANAGE_SRV` | Fiori app service | 1 | 3 | Only helper, return-type or object-page sets |
| FI - Finance | `O2C_FICA_WORKLIST` | Fiori app service | 2 | 0 | Mass, upload, worklist, monitor or analytic service |
| FI - Finance | `UDMO_COLLECTION_WORKLIST` | Fiori app service | 3 | 1 | Mass, upload, worklist, monitor or analytic service |
| FI - Finance | `UI_IHBACCOUNTMASSCREATP_02` | Fiori app service | 1 | 7 | Mass, upload, worklist, monitor or analytic service |
| FI - Finance | `UI_SHORTTERMCASHPOS_DISP` | Fiori app service | 1 | 0 | Only helper, return-type or object-page sets |
| FI - Finance | `USERSERVICE` | Fiori app service | 3 | 0 | Only helper, return-type or object-page sets |
| HR - Payroll - Travel | `PYC_ALERT_MANAGER_SRV` | Fiori app service | 1 | 0 | Only helper, return-type or object-page sets |
| HR - Payroll - Travel | `PYC_CONT_003_SRV` | Fiori app service | 1 | 0 | Only helper, return-type or object-page sets |
| HR - Payroll - Travel | `PYC_CONT_PEM_002_SRV` | Fiori app service | 4 | 1 | Only helper, return-type or object-page sets |
| HR - Payroll - Travel | `PYC_PROCESS_MANAGER_SRV` | Fiori app service | 1 | 0 | Only helper, return-type or object-page sets |
| HR - Payroll - Travel | `PYC_TEAM_MANAGER_SRV` | Fiori app service | 1 | 0 | Only helper, return-type or object-page sets |
| HR - Payroll - Travel | `UI_HCMMYREPORTING` | Fiori app service | 1 | 0 | Only helper, return-type or object-page sets |
| MM - Purchasing | `MM_PUR_ANA_SUPLR_SCOREOUTPUT_SRV` | Fiori app service | 3 | 4 | Only helper, return-type or object-page sets |
| MM - Purchasing | `MM_PUR_CNTRLCTRMASS_UPDT_SRV` | Fiori app service | 8 | 0 | Mass, upload, worklist, monitor or analytic service |
| MM - Purchasing | `MM_PUR_CREATE_FOD_FROM_CQTN_SRV` | Fiori app service | 2 | 3 | Only helper, return-type or object-page sets |
| MM - Purchasing | `MM_PUR_CREATE_FOD_FROM_PR_SRV` | Fiori app service | 3 | 4 | Only helper, return-type or object-page sets |
| MM - Purchasing | `MM_PUR_CTRMASS_UPDATE_SRV` | Fiori app service | 2 | 0 | Mass, upload, worklist, monitor or analytic service |
| MM - Purchasing | `MM_PUR_POMASS_UPDATE_SRV` | Fiori app service | 2 | 0 | Mass, upload, worklist, monitor or analytic service |
| MM - Purchasing | `MM_PUR_PRMASS_UPDATE_SRV` | Fiori app service | 1 | 0 | Mass, upload, worklist, monitor or analytic service |
| MM - Purchasing | `MM_PUR_PROCMT_HUB_ITF_MONITOR_SRV` | Fiori app service | 3 | 1 | Only helper, return-type or object-page sets |
| MM - Purchasing | `MM_PUR_PR_PROCESS_SRV` | Fiori app service | 1 | 5 | Only helper, return-type or object-page sets |
| MM - Purchasing | `MM_PUR_SCH_AGMT_MASS_UPDATE_SRV` | Fiori app service | 2 | 0 | Mass, upload, worklist, monitor or analytic service |
| MM - Purchasing | `MM_PUR_SUBCONTRACTING_COCKPIT_SRV` | Fiori app service | 2 | 0 | Mass, upload, worklist, monitor or analytic service |
| MM - Purchasing | `MM_SUPPLIER_INVOICE_LIST_ENH_SRV` | Fiori app service | 1 | 1 | Mass, upload, worklist, monitor or analytic service |
| MM - Purchasing | `MM_SUPPLIER_INVOICE_UPLOAD_SRV` | Fiori app service | 2 | 2 | Only helper, return-type or object-page sets |
| MM - Purchasing | `OCI_ITEM_PROPOSAL_SRV` | Fiori app service | 2 | 1 | Only helper, return-type or object-page sets |
| MM - Purchasing | `PP_MRP_PR_HANDOVER_SRV` | Fiori app service | 1 | 3 | Only helper, return-type or object-page sets |
| Master data - MDG | `MDC_IMPORT_SRV` | Fiori app service | 1 | 6 | Mass, upload, worklist, monitor or analytic service |
| PM - Maintenance | `DFS_MAINT_ORDER_SRV` | Fiori app service | 1 | 53 | Only helper, return-type or object-page sets |
| PM - Maintenance | `DFS_MAINT_TECHNICALOBJECT_SRV` | Fiori app service | 4 | 38 | Only helper, return-type or object-page sets |
| PM - Maintenance | `EAM_OBJPG_TECHNICALOBJECT_SRV` | Fiori app service | 4 | 42 | Only helper, return-type or object-page sets |
| PM - Maintenance | `PP_DD_MASSMAINTPROD_SRV` | Fiori app service | 3 | 2 | Mass, upload, worklist, monitor or analytic service |
| PM - Maintenance | `PP_FCDM_MASS_MAINT` | Fiori app service | 2 | 0 | Mass, upload, worklist, monitor or analytic service |
| PM - Maintenance | `RSH_EAM_ANALYZE_SRV` | Fiori app service | 9 | 56 | Mass, upload, worklist, monitor or analytic service |
| PM - Maintenance | `RSH_EAM_MAINT_SCHED_SIMULATION_SRV` | Fiori app service | 9 | 4 | Mass, upload, worklist, monitor or analytic service |
| PP - Production | `BOMWHEREUSED_SRV` | Fiori app service | 4 | 44 | Mass, upload, worklist, monitor or analytic service |
| PP - Production | `FCO_EB_PRODN_COST_ERROR_SRV` | Fiori app service | 2 | 5 | Only helper, return-type or object-page sets |
| PP - Production | `FCO_WORKCENTER_COST_SRV` | Fiori app service | 2 | 0 | Only helper, return-type or object-page sets |
| PP - Production | `LO_VCHCLF` | Fiori app service | 3 | 31 | Only helper, return-type or object-page sets |
| PP - Production | `LO_VCHCLF_INTEGRATION_LEGACY_SRV` | Fiori app service | 3 | 31 | Only helper, return-type or object-page sets |
| PP - Production | `LO_VCHCLF_SIMULATION_SRV` | Fiori app service | 4 | 38 | Only helper, return-type or object-page sets |
| PP - Production | `MPE_PRODORDER_OBJPG_SRV` | Fiori app service | 3 | 31 | Only helper, return-type or object-page sets |
| PP - Production | `PMRP_SIMULATION_SERVICE` | Fiori app service | 1 | 8 | Mass, upload, worklist, monitor or analytic service |
| PP - Production | `PP_DD_MASSADJBUF_SRV` | Fiori app service | 1 | 0 | Mass, upload, worklist, monitor or analytic service |
| PP - Production | `PP_MNTR_WRKCTR_SRV` | Fiori app service | 2 | 7 | Only helper, return-type or object-page sets |
| PP - Production | `PP_MPE_ORDER_MANAGE` | Fiori app service | 3 | 43 | Only helper, return-type or object-page sets |
| PP - Production | `PP_MRP_COCKPIT_SRV` | Fiori app service | 5 | 6 | Mass, upload, worklist, monitor or analytic service |
| PP - Production | `PP_SCHEDULEPRODUCTION_SRV` | Fiori app service | 2 | 12 | Only helper, return-type or object-page sets |
| PP - Production | `PP_WORKCENTER_GROUP_SRV` | Fiori app service | 1 | 2 | Only helper, return-type or object-page sets |
| PS - Projects | `CPD_MASTERPROJECT_OVERVIEW_SRV` | Fiori app service | 1 | 0 | Mass, upload, worklist, monitor or analytic service |
| QM - Quality | `CMD_QLTY_MANAGE_IMPORTS` | Fiori app service | 1 | 0 | Only helper, return-type or object-page sets |
| QM - Quality | `FCO_EBW_ORDER_INSPECTOR_SRV` | Fiori app service | 4 | 2 | Only helper, return-type or object-page sets |
| QM - Quality | `QM_INSPMETHOD_OBJECTPAGE_SRV` | Fiori app service | 3 | 31 | Only helper, return-type or object-page sets |
| QM - Quality | `QM_INSPSPEC_OBJECTPAGE_SRV` | Fiori app service | 3 | 31 | Only helper, return-type or object-page sets |
| QM - Quality | `SIMDQ_SERVICES_SRV` | Fiori app service | 2 | 0 | Only helper, return-type or object-page sets |
| SD - Sales | `FINS_TRR_PECRUN_SALES_SRV` | Fiori app service | 1 | 5 | Only helper, return-type or object-page sets |
| SD - Sales | `SD_BIL_DOC_LIST_MANAGE_SRV` | Fiori app service | 1 | 1 | Only helper, return-type or object-page sets |
| SD - Sales | `SD_CRT_PROCFLOW_SRV` | Fiori app service | 1 | 5 | Mass, upload, worklist, monitor or analytic service |
| SD - Sales | `SD_F1814_SO_FS_SRV` | Fiori app service | 3 | 31 | Only helper, return-type or object-page sets |
| SD - Sales | `SD_F1871_QUOT_FS_SRV` | Fiori app service | 3 | 31 | Only helper, return-type or object-page sets |
| SD - Sales | `SD_F1873_SO_WL_SRV` | Fiori app service | 1 | 0 | Only helper, return-type or object-page sets |
| SD - Sales | `SD_F2187_CUST360_SRV` | Fiori app service | 1 | 4 | Only helper, return-type or object-page sets |
| SD - Sales | `SD_MCC_CCO_MASS_UPDATE_SRV` | Fiori app service | 2 | 0 | Mass, upload, worklist, monitor or analytic service |
| SD - Sales | `SD_MCC_CMR_MASS_UPDATE_SRV` | Fiori app service | 2 | 0 | Mass, upload, worklist, monitor or analytic service |
| SD - Sales | `SD_MCC_CR_MASS_UPDATE_SRV` | Fiori app service | 2 | 0 | Mass, upload, worklist, monitor or analytic service |
| SD - Sales | `SD_MCC_DMR_MASS_UPDATE_SRV` | Fiori app service | 2 | 0 | Mass, upload, worklist, monitor or analytic service |
| SD - Sales | `SD_MCC_DOC_CAT_AUTH_SRV` | Fiori app service | 1 | 0 | Mass, upload, worklist, monitor or analytic service |
| SD - Sales | `SD_MCC_SCH_MASS_UPDATE_SRV` | Fiori app service | 2 | 0 | Mass, upload, worklist, monitor or analytic service |
| SD - Sales | `SD_MCC_SD_MASS_UPDATE_SRV` | Fiori app service | 2 | 0 | Mass, upload, worklist, monitor or analytic service |
| SD - Sales | `SD_MCC_SOW_MASS_UPDATE_SRV` | Fiori app service | 2 | 0 | Mass, upload, worklist, monitor or analytic service |
| SD - Sales | `SD_MCC_SO_MASS_UPDATE_SRV` | Fiori app service | 2 | 0 | Mass, upload, worklist, monitor or analytic service |
| SD - Sales | `SD_MCC_SQ_MASS_UPDATE_SRV` | Fiori app service | 2 | 0 | Mass, upload, worklist, monitor or analytic service |
| SD - Sales | `SD_SALES_DOC_IMPORT` | Fiori app service | 1 | 1 | Only helper, return-type or object-page sets |
| SD - Sales | `SD_SALES_ORDER_FOC_IMPORT` | Fiori app service | 3 | 3 | Only helper, return-type or object-page sets |
| SD - Sales | `SD_SALES_ORDER_IMPORT` | Fiori app service | 3 | 3 | Only helper, return-type or object-page sets |
| SD - Sales | `SD_SALES_QTN_IMPORT` | Fiori app service | 3 | 3 | Only helper, return-type or object-page sets |
| SD - Sales | `SD_SALES_SA_IMPORT` | Fiori app service | 3 | 3 | Only helper, return-type or object-page sets |
| SD - Sales | `SD_SA_EDIPROCGOPTN_WL` | Fiori app service | 1 | 4 | Mass, upload, worklist, monitor or analytic service |
| SD - Sales | `SD_SA_SOLDTOPARTYDETN_WL` | Fiori app service | 1 | 4 | Mass, upload, worklist, monitor or analytic service |
