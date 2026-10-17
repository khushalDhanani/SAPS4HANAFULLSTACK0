#!/usr/bin/env python3
"""Which live services expose Incoterms, and are they writable on a sales order?
Reads $metadata (GET only) of every service that answered 200 in catalog-audit.csv and reports every
property whose name contains 'incoterm', with its entity type and property-level creatable/updatable flags.
Writes incoterms-capability-scan.csv (gitignored, regenerable). Read-only; no secrets printed.
  python3 tools/scan-incoterms.py            PAR=12 by default
Property-level flags default to 'yes' when unannotated and are indicative only: the authoritative write
signal is the ENTITY SET's sap:creatable/sap:updatable. On this system (2026-10-08) the only sales-order
entities carrying Incoterms (API_SALES_ORDER_SRV A_SalesOrder; SD_MCC_SO_MASS_UPDATE_SRV SlsOrder/SlsOrdItem)
are respectively unroutable (no system alias) and updatable=false. See
docs/incoterms-create-post-alias-runbook.md and WORKSTATUS.md Unresolved Issue 11."""
import base64, csv, os, urllib.request, urllib.error, xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAP = '{http://www.sap.com/Protocols/SAPData}'

def load_env():
    env = {}
    for fn in ('.env.local', '.env'):
        p = os.path.join(ROOT, fn)
        if os.path.exists(p):
            for line in open(p):
                line = line.strip()
                if '=' in line and not line.startswith('#'):
                    k, v = line.split('=', 1); env.setdefault(k, v.strip().strip('"').strip("'"))
    return env

def main():
    env = load_env()
    host = env['S4_DESTINATION_URL'].rstrip('/')
    hdrs = {'Authorization': 'Basic ' + base64.b64encode(
        ('%s:%s' % (env['S4_USERNAME'], env['S4_PASSWORD'])).encode()).decode(),
        'sap-client': env.get('S4_CLIENT', '220'), 'Accept': 'application/xml'}
    rows = [r for r in csv.DictReader(open(os.path.join(ROOT, 'catalog-audit.csv'))) if r['status'] == '200']

    def scan(r):
        try:
            with urllib.request.urlopen(urllib.request.Request(host + r['path'] + '/$metadata', headers=hdrs), timeout=20) as resp:
                root = ET.fromstring(resp.read())
        except Exception as e:
            return ('ERR', r['service'], r['path'], str(e)[:60], [])
        hits = []
        for etype in root.iter():
            if not etype.tag.endswith('}EntityType'):
                continue
            ename = etype.get('Name')
            for p in etype:
                if p.tag.endswith('}Property') and 'incoterm' in (p.get('Name') or '').lower():
                    hits.append((ename, p.get('Name'),
                                 p.get(SAP + 'creatable', 'yes(default)'),
                                 p.get(SAP + 'updatable', 'yes(default)'),
                                 p.get(SAP + 'label', '')))
        return ('OK', r['service'], r['path'], '', hits)

    with ThreadPoolExecutor(int(os.environ.get('PAR', '12'))) as ex:
        results = list(ex.map(scan, rows))

    ok = [x for x in results if x[0] == 'OK']
    withinco = [x for x in ok if x[4]]
    out = os.path.join(ROOT, 'incoterms-capability-scan.csv')
    with open(out, 'w', newline='') as f:
        w = csv.writer(f); w.writerow(['service', 'path', 'entity', 'property', 'creatable', 'updatable', 'label'])
        for _, svc, path, _, hits in withinco:
            for (ename, pname, cre, upd, lbl) in hits:
                w.writerow([svc, path, ename, pname, cre, upd, lbl])
    print('scanned=%d ok=%d errors=%d services_with_incoterms=%d -> %s'
          % (len(results), len(ok), len(results) - len(ok), len(withinco), out))

if __name__ == '__main__':
    main()
