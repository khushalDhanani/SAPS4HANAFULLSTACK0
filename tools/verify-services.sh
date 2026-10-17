#!/bin/bash
# Verify every SAP OData service this project calls, by fetching $metadata.
# 200 = live | 500 = registered, no system alias | 404 = not there | 401 = bad creds
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
set -a
[ -f "$ROOT_DIR/.env.local" ] && . "$ROOT_DIR/.env.local" || { [ -f "$ROOT_DIR/.env" ] && . "$ROOT_DIR/.env"; }
set +a
cd "$ROOT_DIR"
H="${S4_DESTINATION_URL%/}"; C="${S4_CLIENT:-220}"

probe() { # $1 = full path after host
  printf "%-46s %s\n" "$2" \
    "$(curl -s -o /dev/null -m 20 -w '%{http_code}' -u "$S4_USERNAME:$S4_PASSWORD" \
        -H "sap-client: $C" "$H$1/\$metadata")"
}

echo "host: $H  client: $C"; echo
echo "--- V2 /sap/opu/odata/sap ---"
for s in C_PURCHASEORDER_FS_SRV MM_PUR_PO_MAINT_V2_SRV FAC_GL_JOURNALENTRY_VER_SRV \
         SD_F2370_INQY_WL_SRV SD_F2369_INQY_FS_SRV LORD_ODATA_ORDER_SRV \
         SD_F1873_SO_WL_SRV ZAPI_GETBUPA_SRV MMIM_GR4PO_DL_SRV MMIM_MATERIAL_DATA_SRV \
         LO_BM_BATCH_SRV UI_RESERVATION_ITM_MNG_V2 C_STOCKQUANTITYVALUEBYTYPE_CDS \
         API_WAREHOUSE API_WAREHOUSE_ORDER_TASK API_WAREHOUSE_RESOURCE \
         API_WAREHOUSE_STORAGE_BIN API_WHSE_INBOUND_DELIVERY API_WHSE_OUTB_DLV_ORDER \
         LE_SHP_OD_LIST_SRV LE_SHP_WHSE_CLERK_OVP_SRV API_MATERIAL_DOCUMENT_SRV; do
  probe "/sap/opu/odata/sap/$s" "$s"
done

echo; echo "--- V2 /sap/opu/odata/scwm ---"
for s in SIMPLE_INB_DLV_SRV PACK_OUTBDLV_SRV PICKCART_SRV PICKLIST_PAPER_SRV WAREHOUSE_KPIS_SRV; do
  probe "/sap/opu/odata/scwm/$s" "scwm/$s"
done

echo; echo "--- V4 ---"
probe "/sap/opu/odata4/sap/zui_gi_order_rsv_o4/srvd/sap/zui_gi_order_rsv_o4/0001" "ZUI_GI_ORDER_RSV_O4 (V4)"
