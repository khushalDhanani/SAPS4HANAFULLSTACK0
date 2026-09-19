#!/usr/bin/env python3
"""Which catalogued services can CREATE data? Reads $metadata of every service that answered 200
in catalog-audit.csv. Read-only (GET $metadata only). Writes catalog-creatable.csv.
  python3 tools/find-creatable.py          PAR=4 to go gentler, LIMIT=50 for a trial run
Creatable = EntitySet not marked sap:creatable="false", excluding value helps / SAP__ technical sets
(they lack the annotation but are never really writable). POST FunctionImports are counted separately.
Metadata says what the service DECLARES; authorisation and backend checks can still reject a POST."""
import base64, csv, os, re, sys, urllib.request, urllib.error, xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAP = '{http://www.sap.com/Protocols/SAPData}'
M = '{http://schemas.microsoft.com/ado/2007/08/dataservices/metadata}'
NOISE = re.compile(r'^(SAP__|VL_|I_.*(VH|ValueHelp))|VH$|ValueHelp|ValHelp|_VH_|ReturnType', re.I)

def analyse(xml_bytes):
    """-> (total sets, creatable business sets, POST function imports)"""
    root = ET.fromstring(xml_bytes)
    sets = [e for e in root.iter() if e.tag.endswith('}EntitySet')]
    cre = [e.get('Name') for e in sets
           if e.get(SAP + 'creatable') != 'false' and not NOISE.search(e.get('Name') or '')]
    fi = [e.get('Name') for e in root.iter() if e.tag.endswith('}FunctionImport')
          and (e.get(M + 'HttpMethod') or '').upper() == 'POST']
    return len(sets), cre, fi

def main():
    env = {}
    for fn in ('.env.local', '.env'):
        p = os.path.join(ROOT, fn)
        if os.path.exists(p):
            for line in open(p):
                line = line.strip()
                if '=' in line and not line.startswith('#'):
                    k, v = line.split('=', 1); env.setdefault(k, v.strip().strip('"').strip("'"))
    host = env['S4_DESTINATION_URL'].rstrip('/')
    hdrs = {'Authorization': 'Basic ' + base64.b64encode(
        ('%s:%s' % (env['S4_USERNAME'], env['S4_PASSWORD'])).encode()).decode(),
        'sap-client': env.get('S4_CLIENT', '220')}
    rows = [r for r in csv.DictReader(open(os.path.join(ROOT, 'catalog-audit.csv'))) if r['status'] == '200']
    rows = rows[:int(os.environ.get('LIMIT', '0')) or None]

    def probe(r):
        try:
            with urllib.request.urlopen(urllib.request.Request(host + r['path'] + '/$metadata', headers=hdrs), timeout=40) as resp:
                n, cre, fi = analyse(resp.read())
            return [r['service'], r['path'], n, len(cre), len(fi), ' '.join(cre), ' '.join(fi)]
        except Exception as e:
            return [r['service'], r['path'], '', '', '', 'ERROR ' + str(e)[:80], '']

    with ThreadPoolExecutor(int(os.environ.get('PAR', '6'))) as ex:
        out = list(ex.map(probe, rows))
    with open(os.path.join(ROOT, 'catalog-creatable.csv'), 'w', newline='') as f:
        w = csv.writer(f); w.writerow(['service', 'path', 'entity_sets', 'creatable_sets', 'post_actions', 'creatable_names', 'post_action_names']); w.writerows(out)
    ok = [o for o in out if o[2] != '']
    print('scanned %d, errors %d' % (len(out), len(out) - len(ok)))
    print('services with >=1 creatable entity set :', sum(1 for o in ok if o[3]))
    print('services with >=1 POST function import :', sum(1 for o in ok if o[4]))
    print('services with either (can write)        :', sum(1 for o in ok if o[3] or o[4]))
    print('read-only services                      :', sum(1 for o in ok if not o[3] and not o[4]))

def demo():  # python3 tools/find-creatable.py --selftest
    n, cre, fi = analyse(open(os.path.join(ROOT, 'srv/external/SD_F2370_INQY_WL_SRV.edmx'), 'rb').read())
    assert n == 35 and cre == [] and fi == [], (n, cre, fi)      # worklist: read-only
    n, cre, fi = analyse(open(os.path.join(ROOT, 'srv/external/LORD_ODATA_ORDER_SRV.edmx'), 'rb').read())
    assert 'HeaderSet' in cre and len(fi) == 4, (cre, fi)        # inquiry creation: writable
    print('selftest ok')

if __name__ == '__main__':
    demo() if '--selftest' in sys.argv else main()
