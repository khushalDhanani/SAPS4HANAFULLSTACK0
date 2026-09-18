#!/bin/bash
# What does SAP really call the 7 fields EwmMapper reads but never receives?
set -a; . "$(dirname "$0")/.env.local"; set +a
H="${S4_DESTINATION_URL%/}"; C="${S4_CLIENT:-220}"
M=$(mktemp -d)

probe() {  # $1=path  $2=label  $3=regex of what we're hunting
  curl -s -m 60 -u "$S4_USERNAME:$S4_PASSWORD" -H "sap-client: $C" -o "$M/m.xml" "$H$1/\$metadata"
  echo "=== $2 — candidates matching /$3/"
  python3 - "$M/m.xml" "$3" <<'PY'
import sys, re, xml.etree.ElementTree as ET
try: root = ET.parse(sys.argv[1]).getroot()
except Exception as e: print("   unreadable:", e); sys.exit()
pat = re.compile(sys.argv[2], re.I)
names = sorted({e.get('Name') for e in root.iter()
                if e.tag.endswith('Property') and e.get('Name') and pat.search(e.get('Name'))})
print("   " + ("\n   ".join(names) if names else "(no match)"))
PY
  echo
}

probe /sap/opu/odata/sap/API_WAREHOUSE_STORAGE_BIN  "STORAGE_BIN: bin type + weight"   "BinType|Weight"
probe /sap/opu/odata/sap/API_WAREHOUSE_ORDER_TASK   "ORDER_TASK: queue + user"         "Queue|User|Processor"
probe /sap/opu/odata/sap/API_WHSE_INBOUND_DELIVERY  "INBOUND: goods receipt status"    "Status"
probe /sap/opu/odata/sap/API_WHSE_OUTB_DLV_ORDER    "OUTBOUND: goods issue status"     "Status"
probe /sap/opu/odata/sap/API_WAREHOUSE_RESOURCE     "RESOURCE: type"                   "Type|Group"
rm -rf "$M"
