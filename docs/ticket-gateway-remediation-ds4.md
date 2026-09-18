# Gateway Service Remediation Request — DS4 client 220

**Raised by:** Dipak Rathod, CIO — Aether Industries Limited
**Date:** 18 September 2026
**System:** DS4, client 220 (`172.27.100.32:8000`)
**Evidence:** `catalog-audit.csv` — all 1345 catalogued services probed live on 18-Sep-2026

---

## Summary

A full probe of the Gateway service catalog found **three distinct configuration states**. Two of them block active development work.

| State | Count | Symptom | Action required |
|---|---|---|---|
| Registered with system alias | 1219 | HTTP 200 | None — healthy |
| Registered **without** system alias | 83 | HTTP 500 `/IWFND/CM_COS/064` | **Item 1** — assign alias |
| Not registered at all | 1 known | HTTP 403 `/IWFND/MED/170` | **Item 2** — register service |
| Request timeout (large `$metadata`) | 40 | No response in 20s | None — confirmed healthy on retry |
| Not resolvable | 3 | HTTP 404 | Low priority — SuccessFactors payroll only |

---

## Item 1 — Assign system aliases (83 services)

**Transaction:** `/IWFND/MAINT_SERVICE` → select service → assign System Alias

These services are registered on the hub but have no backend system alias, so every call fails with
`/IWFND/CM_COS/064 "No System Alias found"`. This is a single class of fault with a single class of fix.

### Business-critical subset (29) — please prioritise

| Service | Path |
|---|---|
| `API_SALES_ORDER_SRV` | `/sap/opu/odata/sap/API_SALES_ORDER_SRV` |
| `API_SALES_QUOTATION_SRV` | `/sap/opu/odata/sap/API_SALES_QUOTATION_SRV` |
| `LE_SHP_DELIVERY_PICK` | `/sap/opu/odata/sap/LE_SHP_DELIVERY_PICK` |
| `LE_SHP_INBOUND_DELIVERY_OBJPG_SRV` | `/sap/opu/odata/sap/LE_SHP_INBOUND_DELIVERY_OBJPG_SRV` |
| `LE_SHP_OD_CREATE_SRV` | `/sap/opu/odata/sap/LE_SHP_OD_CREATE_SRV` |
| `LE_SHP_OD_LOGS_SRV` | `/sap/opu/odata/sap/LE_SHP_OD_LOGS_SRV` |
| `LE_SHP_OUTBOUND_DELIVERY_FS` | `/sap/opu/odata/sap/LE_SHP_OUTBOUND_DELIVERY_FS` |
| `MM_PUR_REQUIREMENT_TRACKING_SRV` | `/sap/opu/odata/sap/MM_PUR_REQUIREMENT_TRACKING_SRV` |
| `MM_SUPPLIER_INVOICE_MANAGE` | `/sap/opu/odata/sap/MM_SUPPLIER_INVOICE_MANAGE` |
| `SD_CUSTRET_WORKFLOW_SRV` | `/sap/opu/odata/sap/SD_CUSTRET_WORKFLOW_SRV` |
| `SD_DEBITMEMOREQ_WORKFLOW_SRV` | `/sap/opu/odata/sap/SD_DEBITMEMOREQ_WORKFLOW_SRV` |
| `SD_F3014_CMR_WORKFLOW_SRV` | `/sap/opu/odata/sap/SD_F3014_CMR_WORKFLOW_SRV` |
| `SD_SLSORDWTHOUTCHRG_WORKFLOW_SRV` | `/sap/opu/odata/sap/SD_SLSORDWTHOUTCHRG_WORKFLOW_SRV` |
| `UI_SRCGPROJNEGTTN_MANAGE` | `/sap/opu/odata/sap/UI_SRCGPROJNEGTTN_MANAGE` |
| `UI_SRCGPROJQTN_MANAGE` | `/sap/opu/odata/sap/UI_SRCGPROJQTN_MANAGE` |
| `ZANA_PAI_PS_SRV` | `/sap/opu/odata/sap/ANA_PAI_PS_SRV` |
| `ZANA_PAI_REPOSITORY_SRV` | `/sap/opu/odata/sap/ANA_PAI_REPOSITORY_SRV` |
| `ZCREATE_SO_SRV` | `/sap/opu/odata/sap/ZCREATE_SO_SRV` |
| `ZEASY_ACCESS_MENU` | `/sap/opu/odata/ui2/EASY_ACCESS_MENU` |
| `ZFARP_MANAGE_INTEREST_RUNS_SRV` | `/sap/opu/odata/sap/FARP_MANAGE_INTEREST_RUNS_SRV` |
| `ZFARR_CONFLICTED_CONTRACT_WL_SRV` | `/sap/opu/odata/sap/FARR_CONFLICTED_CONTRACT_WL_SRV` |
| `ZFIN_RE_LOG_DETAIL_SRV` | `/sap/opu/odata/sap/FIN_RE_LOG_DETAIL_SRV` |
| `ZSD_CDS_050_Q_CDS` | `/sap/opu/odata/sap/ZSD_CDS_050_Q_CDS` |
| `ZTARGET_TV_CDS` | `/sap/opu/odata/sap/ZTARGET_TV_CDS` |
| `ZUI_ENGINEERING_REDLINE` | `/sap/opu/odata/sap/UI_ENGINEERING_REDLINE` |
| `ZUSER_MENU` | `/sap/opu/odata/ui2/USER_MENU` |
| `ZVKR_PO_SRV` | `/sap/opu/odata/sap/ZVKR_PO_SRV` |
| `ZZSALES1_SRV` | `/sap/opu/odata/sap/ZZSALES1_SRV` |
| `ZZSALES_SRV` | `/sap/opu/odata/sap/ZZSALES_SRV` |

`ZCREATE_SO_SRV`, `ZZSALES_SRV`, `ZZSALES1_SRV`, `ZVKR_PO_SRV`, `ZUSER_MENU`, `ZEASY_ACCESS_MENU`,
`ZUI_ENGINEERING_REDLINE` and `ZFIN_RE_LOG_DETAIL_SRV` are **AIL's own developments** currently
non-functional on this system. These may represent work that was delivered and silently never worked.

### Remainder (54) — SAP demo, framework and unused modules

Lower priority. Listed for completeness; assign aliases if it is no more effort than doing the subset above.

| Service | Path |
|---|---|
| `/BDTS/COMMAND_SRV` | `/sap/opu/odata/bdts/COMMAND_SRV` |
| `/BDTS/INSTALLED_SAP_NOTE_SRV` | `/sap/opu/odata/bdts/INSTALLED_SAP_NOTE_SRV` |
| `/BDTS/PRESEL_TAB_DATA_SRV` | `/sap/opu/odata/bdts/PRESEL_TAB_DATA_SRV` |
| `/BDTS/PRESEL_TAB_READ_NAME_SRV` | `/sap/opu/odata/bdts/PRESEL_TAB_READ_NAME_SRV` |
| `/BDTS/PRESEL_TASK_IS_CREATED_SRV` | `/sap/opu/odata/bdts/PRESEL_TASK_IS_CREATED_SRV` |
| `/BDTS/PRESEL_TASK_PORTION_SRV` | `/sap/opu/odata/bdts/PRESEL_TASK_PORTION_SRV` |
| `/BDTS/PRESEL_TASK_READ_STATUS_SRV` | `/sap/opu/odata/bdts/PRESEL_TASK_READ_STATUS_SRV` |
| `/BDTS/SOFTWARE_COMPONENT_SRV` | `/sap/opu/odata/bdts/SOFTWARE_COMPONENT_SRV` |
| `/BDTS/TABLE_FIELD_STRUCTUR_SRV` | `/sap/opu/odata/bdts/TABLE_FIELD_STRUCTUR_SRV` |
| `/IWBEP/BATCH_AT_ONCE_TEST` | `/sap/opu/odata/iwbep/BATCH_AT_ONCE_TEST` |
| `/IWBEP/MESSAGE_TEXT` | `/sap/opu/odata/iwbep/MESSAGE_TEXT` |
| `/IWBEP/TEA_TEST_COMP_APP` | `/sap/opu/odata/iwbep/TEA_TEST_COMP_APP` |
| `/IWBEP/TEA_TEST_REUSE_APP` | `/sap/opu/odata/iwbep/TEA_TEST_REUSE_APP` |
| `/IWFND/GWDEMO_SP2` | `/sap/opu/odata/iwbep/GWDEMO_SP2` |
| `/IWFND/SG_MGW_NOTIF_STORE` | `/sap/opu/odata/iwfnd/NOTIFICATIONSTORE` |
| `/IWFND/SUBSCRIPTIONMANAGEMENT` | `/sap/opu/odata/iwbep/SUBSCRIPTIONMANAGEMENT;v=0002` |
| `/IWFND/USAGEEXTRACTOR` | `/sap/opu/odata/iwfnd/USAGEEXTRACTOR` |
| `/IWPGW/TASKPROCESSING` | `/sap/opu/odata/iwpgw/TASKPROCESSING` |
| `/SCWM/USER_DEFAULTPARAMETER_SRV` | `/sap/opu/odata/scwm/USER_DEFAULTPARAMETER_SRV` |
| `/SOMO/MA_ODATA_SRV` | `/sap/opu/odata/somo/MA_ODATA_SRV` |
| `ADT_SRV` | `/sap/opu/odata/sap/ADT_SRV` |
| `BSANLY_APF_RUNTIME_SRV` | `/sap/opu/odata/sap/BSANLY_APF_RUNTIME_SRV` |
| `C_BILLGPROCDOCWORKFLOWVH_CDS` | `/sap/opu/odata/sap/C_BILLGPROCDOCWORKFLOWVH_CDS` |
| `C_LQDYFORECASTOVERVIEW_CDS` | `/sap/opu/odata/sap/C_LQDYFORECASTOVERVIEW_CDS` |
| `C_MAINTOBJBREAKDOWNQUERY_CDS` | `/sap/opu/odata/sap/C_MAINTOBJBREAKDOWNQUERY_CDS` |
| `EAM_BACKLOG_MANAGE` | `/sap/opu/odata/sap/EAM_BACKLOG_MANAGE` |
| `EAM_OBJPG_PURCH_SRV` | `/sap/opu/odata/sap/EAM_OBJPG_PURCH_SRV` |
| `EAM_ORDER_ACTUALCOST_MONITOR` | `/sap/opu/odata/sap/EAM_ORDER_ACTUALCOST_MONITOR` |
| `EAM_ORD_MASS_CONFIRMATION_SRV` | `/sap/opu/odata/sap/EAM_ORD_MASS_CONFIRMATION_SRV` |
| `EAM_PLNGBUCKET_MANAGE` | `/sap/opu/odata/sap/EAM_PLNGBUCKET_MANAGE` |
| `GFD_CONFIG_SRV` | `/sap/opu/odata/sap/GFD_CONFIG_SRV` |
| `HRSFEC_ECP_INFO_SRV` | `/sap/opu/odata/sap/HRSFEC_ECP_INFO_SRV` |
| `HRSFEC_INFOTYPE_SRV` | `/sap/opu/odata/sap/HRSFEC_INFOTYPE_SRV` |
| `HRSFEC_PAYCTRL_REC_SRV` | `/sap/opu/odata/sap/HRSFEC_PAYCTRL_REC_SRV` |
| `HRSFEC_PAY_OVERVIEW_SRV` | `/sap/opu/odata/sap/HRSFEC_PAY_OVERVIEW_SRV` |
| `PIQ_LPD_ADVISOR_SRV` | `/sap/opu/odata/sap/PIQ_LPD_ADVISOR_SRV` |
| `PIQ_LPD_DEG_REQ_SRV` | `/sap/opu/odata/sap/PIQ_LPD_DEG_REQ_SRV` |
| `PIQ_REQUEST_SRV` | `/sap/opu/odata/sap/PIQ_REQUEST_SRV` |
| `PYC_CFG_SRV` | `/sap/opu/odata/sap/PYC_CFG_SRV` |
| `PYC_CFG_VR_SRV` | `/sap/opu/odata/sap/PYC_CFG_VR_SRV` |
| `PYC_CONT_SRV` | `/sap/opu/odata/sap/PYC_CONT_SRV` |
| `PYC_KPI_CONFIG_1_SRV` | `/sap/opu/odata/sap/PYC_KPI_CONFIG_1_SRV` |
| `PYD_CONT_SRV` | `/sap/opu/odata/sap/PYD_CONT_SRV` |
| `PYD_FRW_SRV` | `/sap/opu/odata/sap/PYD_FRW_SRV` |
| `SAP_BW_INA_SRV` | `/sap/opu/odata/sap/SAP_BW_INA_SRV` |
| `SBLE_BADI_CTX_REGISTRY_SRV` | `/sap/opu/odata/sap/SBLE_BADI_CTX_REGISTRY_SRV` |
| `SLL_PROD_CMDTYCD_CLASSIFY` | `/sap/opu/odata/sap/SLL_PROD_CMDTYCD_CLASSIFY` |
| `SLL_PROD_CMDTYCD_RECLASSIFY` | `/sap/opu/odata/sap/SLL_PROD_CMDTYCD_RECLASSIFY` |
| `SLL_PROD_LEGCTRL_CLASSIFY` | `/sap/opu/odata/sap/SLL_PROD_LEGCTRL_CLASSIFY` |
| `SR_APS_FLP_SETTINGS_ODATA_SRV` | `/sap/opu/odata/sap/SR_APS_FLP_SETTINGS_ODATA_SRV` |
| `SSB_UIAD_DESIGNTIME_SRV` | `/sap/opu/odata/sap/SSB_UIAD_DESIGNTIME_SRV` |
| `TSW_MYEVENTS_SRV` | `/sap/opu/odata/sap/TSW_MYEVENTS_SRV` |
| `TSW_MYNOMINATIONS_SRV_01` | `/sap/opu/odata/sap/TSW_MYNOMINATIONS_SRV_01` |
| `TSW_REGIONAL_INVENTORY_SRV_01` | `/sap/opu/odata/sap/TSW_REGIONAL_INVENTORY_SRV_01` |

---

## Item 2 — Register `API_MATERIAL_DOCUMENT_SRV`

**Transaction:** `/IWFND/MAINT_SERVICE` → Add Service → System Alias `LOCAL` →
Technical Service Name `API_MATERIAL_DOCUMENT_SRV` → Get Services → Add Selected Services

**Evidence:** a live POST to `/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV/A_MaterialDocumentHeader` returns:

```
HTTP 403
/IWFND/MED/170 — "No service found for namespace '', name 'API_MATERIAL_DOCUMENT_SRV', version '0001'"
```

Gateway transaction ID `E6A502D9234E0220E006AA12E6AD9423`, timestamp `20260918105510` — visible in `/IWFND/ERROR_LOG`.

The service is also absent from the service catalog entirely, consistent with it never having been registered.

**If "Get Services" returns no rows**, the service is not available in the backend on this release —
please confirm, as that closes the question and we will pursue the OData V4 route instead.

---

## Item 3 — Confirm and publish `ZUI_GI_ORDER_RSV_O4`

**Transaction:** `/IWFND/V4_ADMIN` → Publish Service Groups → search `ZUI_GI_ORDER_RSV_O4`

Custom RAP OData V4 service. `$metadata` returns HTTP 404. Please confirm whether the service group
exists and is unpublished, or was never created.

Related question: **is OData V4 configured on this hub at all?** The V4 catalog service
(`/sap/opu/odata4/iwfnd/catalog/default/iwfnd/catalog/0002/ServiceGroups`) also returns 404, so we
have been unable to enumerate any V4 service on DS4. If V4 is not active, that single fact explains
both results.

---

## Business impact

Goods issue movement 261 cannot be posted from the warehouse application. Both available paths are blocked —
Item 2 (standard service) and Item 3 (custom RAP service). **Either one alone unblocks it.**

All application-side prerequisites are verified and ready:

- Reservation 18025 item 1, material 1000000204 (Para Chloro Phenol), plant 1120 / SLOC CS01
- `GoodsMovementIsAllowed = true`, movement type 261 on the reservation item
- 479,766 KG unrestricted stock (type 01) available
- No alternative service can substitute: 15 candidate services were checked for a creatable
  material-document entity set; none has one. `ZMMIM_MATDOC_SRV` is registered but returns
  HTTP 501 for `MATDOCHEADERS_CREATE_ENTITY` and is restricted to MBND_CLOUD stock transfers.

Item 1 additionally restores sales order, sales quotation, delivery creation, supplier invoice and
sourcing-project functionality, plus the eight AIL custom services listed above.

---

## Follow-up check after Item 2

Once the service is registered, a separate authorisation check may be required for user `KHUSHAL`:
`S_SERVICE` for the service, and `M_MSEG_BWA` for movement type 261. This cannot be tested until
the service exists.

---

*Internal Document / Confidential*
