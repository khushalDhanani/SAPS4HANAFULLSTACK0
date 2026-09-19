#!/bin/bash
# Verify every service/entity-set path the code calls actually exists in that
# service's $metadata. Catches renamed or invented entity sets and function imports.
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
set -a
[ -f "$ROOT_DIR/.env.local" ] && . "$ROOT_DIR/.env.local" || { [ -f "$ROOT_DIR/.env" ] && . "$ROOT_DIR/.env"; }
set +a
cd "$ROOT_DIR"
H="${S4_DESTINATION_URL%/}"; C="${S4_CLIENT:-220}"
META=$(mktemp -d)

# Every distinct <service>/<entityset> called from srv/ (comments excluded)
python3 - > "$META/paths.txt" <<'PY'
import re, os
pat = re.compile(r"/sap/opu/odata/(sap|scwm)/([A-Za-z0-9_]+)/([A-Za-z0-9_]+)")
out = set()
for dp, _, fns in os.walk('srv'):
    if 'external' in dp: continue
    for fn in fns:
        if not fn.endswith('.js'): continue
        for line in open(os.path.join(dp, fn), errors='ignore'):
            ls = line.lstrip()
            if ls.startswith('*') or ls.startswith('//'): continue
            for ns, svc, ent in pat.findall(line):
                out.add(f"{ns} {svc} {ent}")
print("\n".join(sorted(out)))
PY

echo "checking $(wc -l < "$META/paths.txt" | tr -d ' ') paths"; echo
CUR=""
while read -r ns svc ent; do
  [ -z "$svc" ] && continue
  f="$META/$svc.xml"
  if [ ! -f "$f" ]; then
    code=$(curl -s -m 60 -u "$S4_USERNAME:$S4_PASSWORD" -H "sap-client: $C" \
           -o "$f" -w '%{http_code}' "$H/sap/opu/odata/$ns/$svc/\$metadata")
    [ "$code" != "200" ] && echo "SERVICE_$code $svc (cannot verify its entity sets)" > "$f.err"
  fi
  if [ -f "$f.err" ]; then
    [ "$CUR" != "$svc" ] && { echo; cat "$f.err"; CUR=$svc; }
    printf "   ?        %s\n" "$ent"; continue
  fi
  [ "$CUR" != "$svc" ] && { echo; echo "$svc"; CUR=$svc; }
  python3 - "$f" "$ent" <<'PY'
import sys, xml.etree.ElementTree as ET
try: root = ET.parse(sys.argv[1]).getroot()
except Exception as e: print(f"   ?        {sys.argv[2]}  (unparseable metadata: {e})"); sys.exit()
name = sys.argv[2]
sets  = {e.get('Name') for e in root.iter() if e.tag.endswith('EntitySet')}
funcs = {e.get('Name') for e in root.iter() if e.tag.endswith('FunctionImport')}
if   name in sets:  print(f"   OK       {name}")
elif name in funcs: print(f"   OK (fn)  {name}")
else:
    near = sorted(n for n in sets | funcs if name.lower()[:6] in (n or '').lower())[:3]
    print(f"   MISSING  {name}" + (f"   did you mean: {', '.join(near)}" if near else ""))
PY
done < "$META/paths.txt"
rm -rf "$META"
