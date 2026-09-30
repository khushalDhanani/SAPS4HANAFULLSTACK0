#!/bin/bash
# Read-only discovery for the TR/SU RF screen. Writes raw results to docs/wm-discovery/.
# Usage: P='USER:PASS' bash tools/find-wm-sources.sh   (or omit P to use .env.local)
cd "$(dirname "$0")/.."
set -a; [ -f ./.env.local ] && . ./.env.local; set +a
[ -z "$P" ] && P="$S4_USERNAME:$S4_PASSWORD"
H="${S4_DESTINATION_URL}"; C="${S4_CLIENT:-220}"
O=docs/wm-discovery; mkdir -p "$O"; J=$(mktemp)
g(){ curl -s -m 120 -u "$P" -H "sap-client: $C" -b "$J" -c "$J" "$@"; }
s(){ g -o "$O/$1.xml" -w "  %{http_code} $1\n" "$H/sap/bc/adt/repository/informationsystem/search?operation=quickSearch&maxResults=$3&query=$2${4:+&objectType=$4}"; }

echo "1) logon + ADT"
g -o /dev/null -w "  %{http_code} odata catalog\n" "$H/sap/opu/odata/IWFND/CATALOGSERVICE;v=2/ServiceCollection?\$top=1"
T=$(g -D - -o "$O/adt_discovery.xml" -H "x-csrf-token: fetch" "$H/sap/bc/adt/discovery" | tr -d '\r' | awk -F': ' 'tolower($1)=="x-csrf-token"{print $2}')
echo "  ADT csrf token: ${T:+yes}${T:-NO (no ADT access - send me this line)}"

echo "2) custom objects (the existing RF screen lives here)"
s tran_Z 'Z*' 2000 TRAN/T
s prog_Z 'Z*' 3000 PROG/P
s fugr_Z 'Z*' 2000 FUGR/F
s srv_ZUI_GI 'ZUI_GI*' 50

echo "3) CDS views on WM"
for q in WRHSMGMT WHSEMGMT WRHS WHSE QUANT TRANSFREQ TRANSFERREQ STORAGEUNIT STORUNIT; do s "cds_$q" "*$q*" 300 DDLS/DF; done

echo "4) where-used of WM tables"
for t in lqua lein ltbk ltbp ltak ltap; do
  g -X POST -H "x-csrf-token: $T" \
    -H "Content-Type: application/vnd.sap.adt.repository.usagereferences.request.v1+xml" \
    -H "Accept: application/vnd.sap.adt.repository.usagereferences.result.v1+xml" \
    --data '<?xml version="1.0" encoding="UTF-8"?><usagereferences:usageReferenceRequest xmlns:usagereferences="http://www.sap.com/adt/ris/usageReferences"><usagereferences:affectedObjects/></usagereferences:usageReferenceRequest>' \
    -o "$O/whereused_$t.xml" -w "  %{http_code} where-used $t\n" \
    "$H/sap/bc/adt/repository/informationsystem/usageReferences?uri=/sap/bc/adt/ddic/tables/$t"
done

echo "5) other routes"
g -o /dev/null -w "  %{http_code} SOAP-RFC /sap/bc/soap/rfc\n" "$H/sap/bc/soap/rfc"
g -o "$O/gi_v4_metadata.xml" -w "  %{http_code} ZUI_GI_ORDER_RSV_O4\n" "$H/sap/opu/odata4/sap/zui_gi_order_rsv_o4/srvd/sap/zui_gi_order_rsv_o4/0001/\$metadata"
rm -f "$J"; echo "done -> $O"; ls -la "$O" | awk '{print $5, $9}'
