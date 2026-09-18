#!/bin/bash
# Probe every service in all_catalog_services.json. Writes catalog-audit.csv.
# Uses the service root (small) and retries non-200 against $metadata.
set -a; . "$(dirname "$0")/.env.local"; set +a
cd "$(dirname "$0")"
H="${S4_DESTINATION_URL%/}"; C="${S4_CLIENT:-220}"
PAR=${PAR:-8}          # PAR=4 ./audit-catalog.sh to go gentler on the system
OUT=catalog-audit.csv

python3 -c '
import json,re
for x in json.load(open("srv/external/all_catalog_services.json")):
    print(re.sub(r"^https?://[^/]+","",x["ServiceUrl"]).rstrip("/"), "|", x["TechnicalServiceName"])
' > /tmp/cat_paths.txt

TOTAL=$(wc -l < /tmp/cat_paths.txt)
echo "probing $TOTAL services, $PAR at a time — expect a few minutes"
export H C S4_USERNAME S4_PASSWORD
probe() {
  path=${1%% |*}; name=${1##*| }
  code=$(curl -s -m 20 -u "$S4_USERNAME:$S4_PASSWORD" -H "sap-client: $C" \
         -H 'Accept: application/json' -o /dev/null -w '%{http_code}' "$H$path/")
  if [ "$code" != "200" ]; then
    code=$(curl -s -m 25 -u "$S4_USERNAME:$S4_PASSWORD" -H "sap-client: $C" \
           -o /dev/null -w '%{http_code}' "$H$path/\$metadata")
  fi
  echo "$code,$name,$path"
}
export -f probe

TMP_PROBES=$(mktemp)
tr -d '\r' < /tmp/cat_paths.txt | xargs -P "$PAR" -I{} bash -c 'probe "$@"' _ {} > "$TMP_PROBES"
echo "status,service,path" > "$OUT"
sort -t, -k2,2 "$TMP_PROBES" >> "$OUT"
rm -f "$TMP_PROBES"

echo; echo "=== by status ==="
tail -n +2 "$OUT" | cut -d, -f1 | sort | uniq -c | sort -rn
echo; echo "=== non-200 ==="
tail -n +2 "$OUT" | grep -v '^200,' | sort | head -40
echo; echo "full results: $OUT"
