#!/bin/bash
# Which goods-movement services actually accept a backend POST?
# Parses $metadata: EntitySets not marked sap:creatable="false", and
# FunctionImports with m:HttpMethod="POST".
set -a; . "$(dirname "$0")/.env.local"; set +a
H="${S4_DESTINATION_URL%/}"; C="${S4_CLIENT:-220}"
OUT=$(mktemp -d)

PATHS="
/sap/opu/odata/sap/MMIM_MATDOC_SRV
/sap/opu/odata/sap/MMIM_GR4PO_DL_SRV
/sap/opu/odata/sap/MMIM_GR_CANCELLATION_SRV
/sap/opu/odata/sap/MMIM_STO_SRV
/sap/opu/odata/sap/MM_IM_PHYS_INV_DOC_SRV
/sap/opu/odata/sap/MM_PUR_REQ_CONF_GR_SRV
/sap/opu/odata/sap/MPEGOODSMOVEMENTEXCEPTION_SRV
/sap/opu/odata/sap/JITOUTBGOODSPOSTING_SRV
/sap/opu/odata/sap/UI_RESERVATION_HDR_MNG_V2
/sap/opu/odata/sap/UI_RESERVATION_ITM_MNG_V2
/sap/opu/odata/sap/UI_RESERVATION_OBJPG
/sap/opu/odata/sap/PMRP_RECEIPT_SERVICE
/sap/opu/odata/sap/API_WHSE_PHYSINVENTORYITEM
/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV
/sap/opu/odata/scwm/RECORD_INVENTORY_SRV
"

for p in $PATHS; do
  n=$(basename "$p")
  code=$(curl -s -m 25 -u "$S4_USERNAME:$S4_PASSWORD" -H "sap-client: $C" \
         -w '%{http_code}' -o "$OUT/$n.xml" "$H$p/\$metadata")
  if [ "$code" != "200" ]; then printf "\n=== %-38s HTTP %s\n" "$n" "$code"; continue; fi
  printf "\n=== %-38s HTTP 200\n" "$n"
  python3 - "$OUT/$n.xml" <<'PY'
import sys,re,xml.etree.ElementTree as ET
SAP='{http://www.sap.com/Protocols/SAPData}'; M='{http://schemas.microsoft.com/ado/2007/08/dataservices/metadata}'
try: r=ET.parse(sys.argv[1]).getroot()
except Exception as e: print("   unparseable:",e); sys.exit()
cre=[e.get('Name') for e in r.iter() if e.tag.endswith('EntitySet')
     and e.get(SAP+'creatable') != 'false']
fi=[(e.get('Name'), e.get(M+'HttpMethod')) for e in r.iter() if e.tag.endswith('FunctionImport')
    and (e.get(M+'HttpMethod') or '').upper()=='POST']
print("   creatable EntitySets:", ", ".join(cre) if cre else "NONE")
if fi: print("   POST FunctionImports:", ", ".join(n for n,_ in fi))
PY
done
rm -rf "$OUT"
