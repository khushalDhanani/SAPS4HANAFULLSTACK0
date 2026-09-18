#!/bin/bash
# Re-pull the Gateway service catalog. Verifies before overwriting the baseline.
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ./.env.local; set +a
H="${S4_DESTINATION_URL%/}"; C="${S4_CLIENT:-220}"
DEST=srv/external/all_catalog_services.json
TMP=$(mktemp)

# $top=5000 because Gateway pages the collection by default
CODE=$(curl -s -m 120 -u "$S4_USERNAME:$S4_PASSWORD" -H "sap-client: $C" \
       -w '%{http_code}' -o "$TMP" \
       "$H/sap/opu/odata/IWFND/CATALOGSERVICE;v=2/ServiceCollection?\$format=json&\$top=5000")

if [ "$CODE" != "200" ]; then
  echo "HTTP $CODE — not overwriting. First bytes:"; head -c 300 "$TMP"; echo; rm -f "$TMP"; exit 1
fi

NEW=$(python3 -c '
import sys,json
d=json.load(open(sys.argv[1]))["d"]["results"]
json.dump(d,open(sys.argv[2],"w"),indent=1); print(len(d))' "$TMP" "$TMP.json")

OLD=$(python3 -c 'import json,sys;print(len(json.load(open(sys.argv[1]))))' "$DEST" 2>/dev/null || echo 0)
echo "old: $OLD services   new: $NEW services"

if [ "$NEW" -lt "$OLD" ]; then
  echo "WARNING: new dump is SMALLER. Gateway paging, or narrower authorizations."
  read -p "overwrite anyway? [y/N] " a; [ "$a" = y ] || { rm -f "$TMP" "$TMP.json"; exit 1; }
fi

cp "$DEST" "$DEST.$(date +%Y%m%d-%H%M).bak" 2>/dev/null && echo "backed up"
mv "$TMP.json" "$DEST"; rm -f "$TMP"
echo "updated $DEST"
