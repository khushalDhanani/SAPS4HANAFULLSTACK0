#!/usr/bin/env python3
"""Evidence-only search: which service can CREATE a Sales Quotation (default) or any other SD object? GET requests only.
Override with env: PATTERN (regex matched against metadata text/names), OUT (output dir), DIRECT (comma-separated name=path probes).
  e.g. PATTERN='sales.?contract|slscontr' OUT=docs/contract-metadata DIRECT='API_SALES_CONTRACT_SRV=/sap/opu/odata/sap/API_SALES_CONTRACT_SRV' python3 tools/verify-quotation-services.py
Fetches $metadata of every live V2 service + every V4 service in the V4 catalog, keeps any whose
metadata names a quotation entity/action, saves that metadata to docs/quotation-metadata/ and
writes docs/quotation-metadata/REPORT.txt. Nothing is inferred from service names."""
import base64, csv, json, os, re, urllib.request, urllib.error, xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, os.environ.get('OUT', 'docs/quotation-metadata')); os.makedirs(OUT, exist_ok=True)
SAP = '{http://www.sap.com/Protocols/SAPData}'; M = '{http://schemas.microsoft.com/ado/2007/08/dataservices/metadata}'
Q = re.compile(os.environ.get('PATTERN', r'quot|qtan|slsqtn'), re.I)
env = {}
for fn in ('.env.local', '.env'):
    p = os.path.join(ROOT, fn)
    if os.path.exists(p):
        for l in open(p):
            l = l.strip()
            if '=' in l and not l.startswith('#'):
                k, v = l.split('=', 1); env.setdefault(k, v.strip().strip('"').strip("'"))
HOST = env['S4_DESTINATION_URL'].rstrip('/')
HDRS = {'Authorization': 'Basic ' + base64.b64encode(('%s:%s' % (env['S4_USERNAME'], env['S4_PASSWORD'])).encode()).decode(),
        'sap-client': env.get('S4_CLIENT', '220')}

def get(path, accept=None, timeout=45):
    h = dict(HDRS); 
    if accept: h['Accept'] = accept
    try:
        with urllib.request.urlopen(urllib.request.Request(HOST + path, headers=h), timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except Exception as e:
        return 0, str(e).encode()

def local(tag): return tag.rsplit('}', 1)[-1]

def analyse(body):
    """Facts read from the metadata document itself."""
    root = ET.fromstring(body); f = []
    for e in root.iter():
        t, n = local(e.tag), e.get('Name') or ''
        if t == 'EntitySet' and Q.search(n + ' ' + (e.get('EntityType') or '')):
            f.append('EntitySet %s  type=%s  sap:creatable=%s' % (n, e.get('EntityType'), e.get(SAP + 'creatable', '(not stated => default true)')))
        elif t == 'FunctionImport' and Q.search(n + ' ' + (e.get('ReturnType') or '')):
            f.append('FunctionImport %s  method=%s  returns=%s' % (n, e.get(M + 'HttpMethod', 'GET'), e.get('ReturnType')))
        elif t == 'Action' and Q.search(n + ' ' + ' '.join((c.get('Type') or '') for c in e)):   # V4
            ps = ', '.join('%s:%s' % (c.get('Name'), c.get('Type')) for c in e if local(c.tag) == 'Parameter')
            f.append('V4 Action %s (%s) bound=%s' % (n, ps, e.get('IsBound', 'false')))
    # V4 Capabilities.InsertRestrictions
    for a in root.iter():
        if local(a.tag) == 'Annotations' and Q.search(a.get('Target') or ''):
            for x in a.iter():
                if local(x.tag) == 'Annotation' and 'InsertRestrictions' in (x.get('Term') or ''):
                    pv = [p.get('Bool') for p in x.iter() if local(p.tag) == 'PropertyValue' and p.get('Property') == 'Insertable']
                    f.append('V4 InsertRestrictions on %s Insertable=%s' % (a.get('Target'), pv[0] if pv else '(path/unspecified)'))
    return f

def probe(item):
    name, path = item
    st, body = get(path + '/$metadata', 'application/xml')
    if st != 200: return name, path, st, [], body[:300]
    if not Q.search(body.decode('utf-8', 'replace')): return name, path, st, None, b''
    open(os.path.join(OUT, re.sub(r'\W+', '_', name) + '.xml'), 'wb').write(body)
    try: return name, path, st, analyse(body), b''
    except Exception as e: return name, path, st, ['unparseable: %s' % e], b''

items = [(r['service'], r['path']) for r in csv.DictReader(open(os.path.join(ROOT, 'catalog-audit.csv'))) if r['status'] == '200']
DIRECT = os.environ.get('DIRECT')
if DIRECT:
    for d in DIRECT.split(','):
        n, _, u = d.partition('='); items.append((n.strip() + '(direct)', u.strip()))
else:
    items.append(('API_SALES_QUOTATION_SRV(direct)', '/sap/opu/odata/sap/API_SALES_QUOTATION_SRV'))
v4note = ''
for cat in ('config/default/iwfnd/catalog/0002', 'config/default/iwfnd/catalog/0001', 'catalog/default/iwfnd/catalog/0002'):
    st, body = get('/sap/opu/odata4/iwfnd/%s/ServiceGroups?$expand=DefaultSystem($expand=Services)&$top=5000' % cat, 'application/json', 90)
    if st == 200:
        n0 = len(items)
        for g in json.loads(body).get('value', []):
            for s in (g.get('DefaultSystem') or {}).get('Services', []):
                u = re.sub(r'^https?://[^/]+', '', s.get('ServiceUrl', '')).rstrip('/')
                if u: items.append(('V4:' + s.get('ServiceId', ''), u))
        v4note = 'V4 catalog %s: HTTP 200, %d V4 services listed' % (cat, len(items) - n0); break
    v4note += 'V4 catalog %s: HTTP %s  ' % (cat, st)
if not DIRECT:
    items.append(('V4:ui_salesquotationmanage(direct)', '/sap/opu/odata4/sap/ui_salesquotationmanage/srvd/sap/ui_salesquotationmanage/0001'))
    items.append(('V4:api_salesquotation(direct)', '/sap/opu/odata4/sap/api_salesquotation/srvd_a2x/sap/salesquotation/0001'))
items = list(dict.fromkeys(items))
with ThreadPoolExecutor(int(os.environ.get('PAR', '5'))) as ex: res = list(ex.map(probe, items))
hits = [r for r in res if r[3]]; fails = [r for r in res if r[2] != 200]
with open(os.path.join(OUT, 'REPORT.txt'), 'w') as f:
    f.write('pattern: %s\n%s\nmetadata fetched: %d  | HTTP!=200: %d | metadata naming a matching object: %d\n\n' % (Q.pattern, v4note, len(res), len(fails), len(hits)))
    for n, p, st, facts, _ in sorted(hits):
        f.write('== %s\n   %s\n' % (n, p)); [f.write('   - %s\n' % x) for x in facts]; f.write('\n')
    f.write('\n== NON-200 for pattern-named or direct-probed services\n')
    for n, p, st, _, b in fails:
        if Q.search(n + p) or '(direct)' in n: f.write('   HTTP %s %s %s\n      %s\n' % (st, n, p, b.decode('utf-8', 'replace').replace('\n', ' ')[:250]))
print(open(os.path.join(OUT, 'REPORT.txt')).read()[:300]); print('DONE')
