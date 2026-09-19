#!/bin/bash
# Find OData V4 services. The v=2 catalog cannot see these.
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
set -a
[ -f "$ROOT_DIR/.env.local" ] && . "$ROOT_DIR/.env.local" || { [ -f "$ROOT_DIR/.env" ] && . "$ROOT_DIR/.env"; }
set +a
cd "$ROOT_DIR"
H="${S4_DESTINATION_URL%/}"; C="${S4_CLIENT:-220}"
A=(-u "$S4_USERNAME:$S4_PASSWORD" -H "sap-client: $C" -H 'Accept: application/json')

echo "=== 1. V4 catalog service ==="
for cat in \
  "/sap/opu/odata4/iwfnd/catalog/default/iwfnd/catalog/0002/ServiceGroups" \
  "/sap/opu/odata4/iwfnd/catalog/default/iwfnd/catalog/0001/ServiceGroups"; do
  code=$(curl -s -m 30 "${A[@]}" -o /tmp/v4cat.json -w '%{http_code}' "$H$cat?\$top=5")
  echo "  $cat -> HTTP $code"
  [ "$code" = "200" ] && { echo "  FOUND. Full listing:"; \
    curl -s -m 60 "${A[@]}" "$H$cat?\$expand=DefaultSystem(\$expand=Services)&\$top=2000" \
    > /tmp/v4all.json && python3 -c '
import json
d=json.load(open("/tmp/v4all.json")).get("value",[])
out=[]
for g in d:
    for s in (g.get("DefaultSystem") or {}).get("Services",[]):
        out.append((s.get("ServiceId",""), s.get("ServiceUrl","")))
print(f"  {len(out)} V4 services")
for i,u in sorted(set(out)):
    print(f"   {i:52} {u}")' | head -80; break; }
done

echo
echo "=== 2. Material document, likely V4 A2X paths ==="
for p in \
  "/sap/opu/odata4/sap/api_materialdocument/srvd_a2x/sap/materialdocument/0001" \
  "/sap/opu/odata4/sap/api_materialdocument/srvd_a2x/sap/api_materialdocument/0001" \
  "/sap/opu/odata4/sap/api_materialdocument_2/srvd_a2x/sap/materialdocument/0001" \
  "/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV"; do
  printf "  %-72s %s\n" "$p" \
    "$(curl -s -m 25 "${A[@]}" -o /dev/null -w '%{http_code}' "$H$p/\$metadata")"
done
