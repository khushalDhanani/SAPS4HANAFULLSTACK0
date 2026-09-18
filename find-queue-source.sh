#!/bin/bash
# Which registered EWM service exposes warehouse-order queue, assigned user,
# bin max weight, or resource type? Searches candidates from the live catalog.
set -a; . "$(dirname "$0")/.env.local"; set +a
cd "$(dirname "$0")"
H="${S4_DESTINATION_URL%/}"; C="${S4_CLIENT:-220}"
M=$(mktemp -d)

# EWM / warehouse candidates straight from the catalog
python3 - > "$M/cand.txt" <<'PY'
import json, re
seen=set()
for x in json.load(open('srv/external/all_catalog_services.json')):
    blob = x['TechnicalServiceName'] + ' ' + x.get('Description','')
    if re.search(r'EWM|WAREHOUSE|WHSE|SCWM|RESOURCE|STORAGE', blob, re.I):
        p = re.sub(r'^https?://[^/]+', '', x['ServiceUrl']).rstrip('/')
        if p not in seen: seen.add(p); print(p)
PY
echo "probing $(wc -l < "$M/cand.txt" | tr -d ' ') warehouse services"; echo

while read -r path; do
  [ -z "$path" ] && continue
  code=$(curl -s -m 45 -u "$S4_USERNAME:$S4_PASSWORD" -H "sap-client: $C" \
         -o "$M/m.xml" -w '%{http_code}' "$H$path/\$metadata")
  [ "$code" != "200" ] && continue
  python3 - "$M/m.xml" "$path" <<'PY'
import sys, re, xml.etree.ElementTree as ET
WANT = {'queue': r'Queue',
        'user':  r'AssignedUser|ProcessorUser|WarehouseOrderUser|ResourceUser',
        'weight':r'MaxWeight|MaximumWeight|WeightCapacity|WeightLimit',
        'rtype': r'ResourceType|ResourceGroup|EWMResourceType'}
try: root = ET.parse(sys.argv[1]).getroot()
except Exception: sys.exit()
props = {e.get('Name') for e in root.iter() if e.tag.endswith('Property') and e.get('Name')}
found = {k: sorted(n for n in props if re.search(v, n, re.I)) for k, v in WANT.items()}
found = {k: v for k, v in found.items() if v}
if found:
    print(sys.argv[2])
    for k, v in found.items(): print(f"   {k:7} {', '.join(v[:6])}")
PY
done < "$M/cand.txt"
rm -rf "$M"
