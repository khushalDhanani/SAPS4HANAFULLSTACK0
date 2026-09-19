#!/bin/bash
# Existence is not reality. This counts ROWS behind every entity set the code reads.
# A service can answer 200 on $metadata and hold nothing - EWM does exactly that.
set -a; . "$(dirname "$0")/.env.local"; set +a
cd "$(dirname "$0")"
H="${S4_DESTINATION_URL%/}"; C="${S4_CLIENT:-220}"
OUT=data-reality.csv

# Entity sets read from code, plus every dashboard/value-help path
python3 - > /tmp/vd_paths.txt <<'PY'
import re, os
pat = re.compile(r"/sap/opu/odata/(?:sap|scwm)/[A-Za-z0-9_]+/([A-Za-z0-9_]+)")
full = re.compile(r"(/sap/opu/odata/(?:sap|scwm)/[A-Za-z0-9_]+/[A-Za-z0-9_]+)")
out = set()
for dp, _, fns in os.walk('srv'):
    if 'external' in dp: continue
    for fn in fns:
        if not fn.endswith('.js'): continue
        for line in open(os.path.join(dp, fn), errors='ignore'):
            ls = line.lstrip()
            if ls.startswith('*') or ls.startswith('//'): continue
            for m in full.findall(line):
                if not m.rstrip('/').endswith(('SERVICE','/X')): out.add(m)
print("\n".join(sorted(out)))
PY

echo "rows,path,note" > "$OUT"
total=$(wc -l < /tmp/vd_paths.txt | tr -d ' ')
echo "counting rows behind $total entity sets..."; echo

while read -r p; do
  [ -z "$p" ] && continue
  body=$(curl -s -m 30 -u "$S4_USERNAME:$S4_PASSWORD" -H "sap-client: $C" "$H$p/\$count")
  if [[ "$body" =~ ^[0-9]+$ ]]; then
    note=""; [ "$body" = "0" ] && note="EMPTY"
    echo "$body,$p,$note" >> "$OUT"
    printf "%8s  %s %s\n" "$body" "$p" "$note"
  else
    # function imports and key-required sets cannot be counted
    code=$(printf '%s' "$body" | grep -o '/IWFND/[A-Z_]*/[0-9]*' | head -1)
    msg=$(printf '%s' "$body" | sed -n 's/.*<message[^>]*>\([^<]*\)<\/message>.*/\1/p' | head -1 | cut -c1-60 | tr ',' ';')
    echo "n/a,$p,${code:-not-countable}: ${msg:-fn import or key required}" >> "$OUT"
    printf "%8s  %s  (%s)\n" "n/a" "$p" "${msg:-fn import or needs key}"
  fi
done < /tmp/vd_paths.txt

echo; echo "=== summary ==="
awk -F, 'NR>1 && $1=="0"' "$OUT" | wc -l | xargs echo "  entity sets with ZERO rows:"
awk -F, 'NR>1 && $1 ~ /^[0-9]+$/ && $1>0' "$OUT" | wc -l | xargs echo "  entity sets with data:    "
awk -F, 'NR>1 && $1=="n/a"' "$OUT" | wc -l | xargs echo "  not countable:            "
echo; echo "=== EMPTY — code reads these, SAP has nothing ==="
awk -F, 'NR>1 && $1=="0" {print "  " $2}' "$OUT"
echo; echo "full detail: $OUT"
