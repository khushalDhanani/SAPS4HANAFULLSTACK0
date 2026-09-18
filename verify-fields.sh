#!/bin/bash
# Find SAP field names used in code that exist in NO entity set of the services
# this project calls. Catches the "Material vs Product" class of bug.
set -a; . "$(dirname "$0")/.env.local"; set +a
cd "$(dirname "$0")"
H="${S4_DESTINATION_URL%/}"; C="${S4_CLIENT:-220}"
M=$(mktemp -d)

# Services actually called from srv/
python3 - > "$M/svcs.txt" <<'PY'
import re, os, json
# Bare service paths too (trailing slash optional) - not just /service/EntitySet,
# or services referenced only as a constant are missed and their fields misreported.
pat = re.compile(r"/sap/opu/odata/(sap|scwm)/([A-Za-z0-9_]+)")
out = set()
for dp, _, fns in os.walk('srv'):
    if 'external' in dp: continue
    for fn in fns:
        if not fn.endswith('.js'): continue
        for line in open(os.path.join(dp, fn), errors='ignore'):
            ls = line.lstrip()
            if ls.startswith('*') or ls.startswith('//'): continue
            for ns, svc in pat.findall(line):
                if svc.upper() not in ('SERVICE', 'X'): out.add(f"{ns} {svc}")
# Plus anything declared in cds.requires - consumed via cds.connect.to, no literal path
for k, v in json.load(open('package.json'))['cds']['requires'].items():
    if isinstance(v, dict) and str(v.get('kind','')).startswith('odata'):
        out.add(f"sap {k}")
print("\n".join(sorted(out)))
PY

echo "fetching metadata for $(wc -l < "$M/svcs.txt" | tr -d ' ') services..."
while read -r ns svc; do
  [ -z "$svc" ] && continue
  curl -s -m 60 -u "$S4_USERNAME:$S4_PASSWORD" -H "sap-client: $C" \
       -o "$M/$svc.xml" -w "  %{http_code} $svc\n" "$H/sap/opu/odata/$ns/$svc/\$metadata"
done < "$M/svcs.txt"

echo
python3 - "$M" <<'PY'
import sys, os, re, glob, collections, xml.etree.ElementTree as ET

# Every property / entity-set / function name SAP actually exposes
known = set()
for f in glob.glob(os.path.join(sys.argv[1], '*.xml')):
    try: root = ET.parse(f).getroot()
    except Exception: continue
    for e in root.iter():
        t = e.tag
        if t.endswith(('Property','NavigationProperty','EntitySet','EntityType',
                       'FunctionImport','Parameter','ComplexType')):
            if e.get('Name'): known.add(e.get('Name'))
print(f"{len(known)} distinct names exposed by SAP\n")

# Only names READ OFF an object that holds an SAP response. A broad scan of every
# capitalised identifier drowns real defects in class names, env vars and constants.
READ = re.compile(r"\b(?:src|raw|r|d|res|resp|row|item|hdr|header|rec|entry|doc|fsDoc|"
                  r"partner|shipTo|contact|salesEmp|batch|stock|resv|sap\w*|s4\w*|v2Res|v4Res)"
                  r"\.([A-Z][A-Za-z0-9_]{4,44})\b")
# `x.Foo = ...` writes to OUR dto, it is not a read from SAP. `==`/`===` stays a read.
ASSIGN = re.compile(r"\.([A-Z][A-Za-z0-9_]{4,44})\s*=(?!=)")

unknown = collections.defaultdict(set)
for dp, _, fns in os.walk('srv'):
    if 'external' in dp: continue
    for fn in fns:
        if not fn.endswith('.js'): continue
        p = os.path.join(dp, fn)
        for i, line in enumerate(open(p, errors='ignore'), 1):
            ls = line.lstrip()
            if ls.startswith('*') or ls.startswith('//'): continue
            written = set(ASSIGN.findall(line))
            reads = [nm for nm in READ.findall(line) if nm not in written]
            # A `a.Foo || a.Bar` chain resolves as long as ONE name is real. Only a line
            # where NO read resolves is a silent-default bug. (Line-granular: these
            # chains are written one property per line in this codebase.)
            if any(nm in known for nm in reads): continue
            for nm in reads:
                if nm in known: continue
                unknown[nm].add(f"{os.path.basename(p)}:{i}")

print(f"{len(unknown)} reads with NO valid field anywhere in their fallback chain:\n")
for nm, locs in sorted(unknown.items(), key=lambda kv: (-len(kv[1]), kv[0])):
    print(f"  {nm:44} {len(locs):3}x  {sorted(locs)[0]}")
PY
rm -rf "$M"
