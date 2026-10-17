#!/bin/bash
# Read the ERROR BODY of every service that returned 500, and group by SAP error
# code. A status code alone does not identify the fault - proven twice today.
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
set -a
[ -f "$ROOT_DIR/.env.local" ] && . "$ROOT_DIR/.env.local" || { [ -f "$ROOT_DIR/.env" ] && . "$ROOT_DIR/.env"; }
set +a
cd "$ROOT_DIR"
H="${S4_DESTINATION_URL%/}"; C="${S4_CLIENT:-220}"
OUT=catalog-500-classified.csv

echo "code,service,path,message" > "$OUT"
total=$(grep -c '^500,' catalog-audit.csv)
echo "reading $total error bodies..."

grep '^500,' catalog-audit.csv | while IFS=, read -r _ svc path; do
  body=$(curl -s -m 25 -u "$S4_USERNAME:$S4_PASSWORD" -H "sap-client: $C" "$H$path/\$metadata")
  code=$(printf '%s' "$body" | grep -o '/IWFND/[A-Z_]*/[0-9]*' | head -1)
  msg=$(printf '%s' "$body" | sed -n 's/.*<message[^>]*>\([^<]*\)<\/message>.*/\1/p' | head -1 | tr ',' ';')
  echo "${code:-NO_CODE},$svc,$path,${msg:-<no message>}" >> "$OUT"
done

echo; echo "=== by SAP error code ==="
tail -n +2 "$OUT" | cut -d, -f1 | sort | uniq -c | sort -rn
echo; echo "=== anything that is NOT the common alias fault ==="
tail -n +2 "$OUT" | grep -v '^/IWFND/CM_COS/064,' | cut -d, -f1,2,4 | column -t -s, 2>/dev/null \
  || tail -n +2 "$OUT" | grep -v '^/IWFND/CM_COS/064,'
echo; echo "full detail: $OUT"
