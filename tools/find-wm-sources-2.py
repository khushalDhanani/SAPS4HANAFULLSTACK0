#!/usr/bin/env python3
"""Pass 2 (read-only): source of the candidate Z objects + WM CDS views, tcode->program map,
and live WM table samples via ADT data preview. Output: docs/wm-discovery/pass2/.
Usage: P='USER:PASS' python3 tools/find-wm-sources-2.py"""
import os, re, base64, urllib.request, urllib.error, http.cookiejar
H, C = os.environ['S4_DESTINATION_URL'], os.environ.get('S4_CLIENT', '220')
user, pw = os.environ['P'].split(':', 1)
O = 'docs/wm-discovery/pass2'; os.makedirs(O, exist_ok=True)
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()),
                                 urllib.request.ProxyHandler({}))
AUTH = 'Basic ' + base64.b64encode(f'{user}:{pw}'.encode()).decode()
tok = ''

def req(path, data=None, hdr=None, name=None):
    global tok
    h = {'Authorization': AUTH, 'sap-client': C, 'Accept': '*/*', 'x-csrf-token': tok or 'fetch'}
    h.update(hdr or {})
    r = urllib.request.Request(H + path, data=data.encode() if data else None, headers=h, method='POST' if data else 'GET')
    try:
        with op.open(r, timeout=120) as resp:
            tok = resp.headers.get('x-csrf-token') or tok
            body, code = resp.read().decode('utf-8', 'ignore'), resp.status
    except urllib.error.HTTPError as e:
        body, code = e.read().decode('utf-8', 'ignore'), e.code
    if name: open(f'{O}/{name}', 'w').write(body)
    print(f'  {code} {name or path[:90]}')
    return code, body

print('1) session'); req('/sap/bc/adt/discovery', name='_discovery.xml')

print('2) tcode -> program, FM lists, live WM samples (data preview)')
SQL = {
 'tstc_Z':      "SELECT tcode, pgmna, dypno FROM tstc WHERE tcode LIKE 'Z%'",
 'tstct_Z':     "SELECT tcode, ttext FROM tstct WHERE sprsl = 'E' AND tcode LIKE 'Z%'",
 'fm_Z':        "SELECT funcname, area FROM enlfdir WHERE area LIKE 'Z%'",
 'ltbk_W01':    "SELECT tbnum, bwlvs, betyp, benum, statu, bdatu FROM ltbk WHERE lgnum = 'W01'",
 'lqua_W01_SU': "SELECT lenum, lgtyp, lgpla, matnr, charg, verme, meins FROM lqua WHERE lgnum = 'W01' AND lenum <> ' '",
 'lein_W01':    "SELECT lenum, lgtyp, lgpla, letyp, statu FROM lein WHERE lgnum = 'W01'",
 't340d_W01':   "SELECT lgnum, lenvw FROM t340d WHERE lgnum = 'W01'",
}
for n, q in SQL.items():
    req('/sap/bc/adt/datapreview/freestyle?rowNumber=300', q,
        {'Content-Type': 'text/plain', 'Accept': 'application/xml, application/vnd.sap.adt.datapreview.table.v1+xml'}, f'sql_{n}.xml')

print('3) where-used (retry)')
UR = '<?xml version="1.0" encoding="UTF-8"?><usagereferences:usageReferenceRequest xmlns:usagereferences="http://www.sap.com/adt/ris/usageReferences"><usagereferences:affectedObjects/></usagereferences:usageReferenceRequest>'
for t in ['lqua', 'lein', 'ltbk', 'ltbp']:
    req(f'/sap/bc/adt/repository/informationsystem/usageReferences?uri=/sap/bc/adt/ddic/tables/{t}', UR,
        {'Content-Type': 'application/vnd.sap.adt.repository.usagereferences.request.v1+xml',
         'Accept': 'application/vnd.sap.adt.repository.usagereferences.result.v1+xml'}, f'whereused_{t}.xml')

print('4) CDS sources')
for v in ['i_wrhsmgmttransferorder', 'i_wrhsmgmttransferorderitem', 'c_wrhsmgmttransferorder']:
    req(f'/sap/bc/adt/ddic/ddl/sources/{v}/source/main', name=f'cds_{v}.txt')

print('5) programs + their includes')
def prog(p, kind='programs'):
    c, s = req(f'/sap/bc/adt/programs/{kind}/{p.lower()}/source/main', name=f'src_{p}.abap')
    if c == 200:
        for inc in set(re.findall(r'^\s*INCLUDE\s+([A-Z0-9_/]+)', s, re.M | re.I)):
            if not inc.upper().startswith(('ZZ', 'LSVIM', 'MS')): prog(inc.upper(), 'includes')
for p in ['ZRFZWM_E_001_AIL', 'ZWM_C_001', 'ZWM_C_002', 'ZWM_C_003', 'ZWM_C_004', 'ZWM_C_005', 'ZPK261']:
    prog(p)

print('6) function groups + function modules')
for fg in ['Z_WM_TR_SERVICES', 'ZWM_FINISHEDGOODS']:
    c, x = req(f'/sap/bc/adt/functions/groups/{fg.lower()}/objectstructure', name=f'fg_{fg}.xml')
    fms = {dict(re.findall(r'adtcore:(\w+)="([^"]*)"', t)).get('name') for t in re.findall(r'<[^>]*adtcore:type="FUGR/FF"[^>]*>', x)}
    fms |= set(re.findall(r'/fmodules/([a-z0-9_]+)', x))
    for fm in sorted(f.upper() for f in fms if f):
        req(f'/sap/bc/adt/functions/groups/{fg.lower()}/fmodules/{fm.lower()}/source/main', name=f'fm_{fm}.abap')
print('done ->', O)
