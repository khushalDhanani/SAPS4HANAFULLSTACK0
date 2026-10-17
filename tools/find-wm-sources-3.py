#!/usr/bin/env python3
"""Pass 3 (read-only): find the RF screen program, RFC flags of the TR FMs, OData projects,
live WM table samples. Output: docs/wm-discovery/pass3/.  Usage: P='USER:PASS' python3 tools/find-wm-sources-3.py"""
import os, re, base64, urllib.request, urllib.error
H, C = os.environ['S4_DESTINATION_URL'], os.environ.get('S4_CLIENT', '220')
AUTH = 'Basic ' + base64.b64encode(os.environ['P'].encode()).decode()
O = 'docs/wm-discovery/pass3'; os.makedirs(O, exist_ok=True)
op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
jar, tok = {}, ''   # manual cookies: SAP marks them Secure, so a normal jar drops them over http

def req(path, data=None, hdr=None, name=None):
    global tok
    h = {'Authorization': AUTH, 'sap-client': C, 'Accept': '*/*', 'x-csrf-token': tok or 'fetch'}
    if jar: h['Cookie'] = '; '.join(f'{k}={v}' for k, v in jar.items())
    h.update(hdr or {})
    r = urllib.request.Request(H + path, data=data.encode() if data else None, headers=h, method='POST' if data else 'GET')
    try: resp = op.open(r, timeout=120); code = resp.status
    except urllib.error.HTTPError as e: resp = e; code = e.code
    for c in resp.headers.get_all('Set-Cookie') or []:
        k, _, v = c.split(';', 1)[0].partition('='); jar[k.strip()] = v
    t = resp.headers.get('x-csrf-token')
    if t and t.lower() != 'required': tok = t
    body = resp.read().decode('utf-8', 'ignore')
    if name: open(f'{O}/{name}', 'w').write(body)
    msg = '' if code == 200 else ' ' + re.sub(r'\s+', ' ', re.sub(r'<style.*?</style>|<[^>]+>', ' ', body, flags=re.S))[:120]
    print(f'  {code} {name or path[:80]}{msg}')
    return code, body

def search(name, q, typ='', n=500):
    return req(f'/sap/bc/adt/repository/informationsystem/search?operation=quickSearch&maxResults={n}&query={q}' + (f'&objectType={typ}' if typ else ''), name=f'search_{name}.xml')

print('1) session'); req('/sap/bc/adt/discovery', name='_discovery.xml')

print('2) RFC flag + signature of the TR function modules')
for fg, fm in [('z_wm_tr_services', 'z_wm_get_all_tr_headers'), ('z_wm_tr_services', 'z_wm_get_tr_material_list'),
               ('zwm_finishedgoods', 'zwm_to_create_from_tr')]:
    req(f'/sap/bc/adt/functions/groups/{fg}/fmodules/{fm}', hdr={'Accept': 'application/vnd.sap.adt.functions.fmodules.v3+xml, application/xml'}, name=f'fmmeta_{fm}.xml')

print('3) where is the RF screen: module pools, RF-ish names, OData projects')
search('sapmz', 'SAPMZ*', 'PROG/P'); search('saplz', 'SAPLZ*', 'PROG/P')
search('rf_all', '*RF*'); search('lm_z', 'ZLM*'); search('zwm_all', 'ZWM*'); search('z_wm_all', 'Z_WM*')
search('iwsv_z', 'Z*', 'IWSV'); search('iwpr_z', 'Z*', 'IWPR'); search('srvb_z', 'Z*', 'SRVB/SVB')

print('4) tcode details')
for t in ['ZWM_TO', 'ZWM_STOCK', 'ZBIN', 'ZRESERVE', 'ZLT09', 'ZSTOCK', 'ZVGI']:
    req(f'/sap/bc/adt/vit/wb/object_type/trant/object_name/{t}', name=f'tran_{t}.xml')

print('5) live WM data (ADT data preview, needs CSRF)')
SQL = {
 'tstc_Z':      "SELECT tcode, pgmna, dypno FROM tstc WHERE tcode LIKE 'Z%'",
 'tstct_Z':     "SELECT tcode, ttext FROM tstct WHERE sprsl = 'E' AND tcode LIKE 'Z%'",
 'ltbk_W01':    "SELECT tbnum, bwlvs, betyp, benum, rsnum, statu, bdatu FROM ltbk WHERE lgnum = 'W01'",
 'lqua_W01_SU': "SELECT lenum, lgtyp, lgpla, matnr, charg, verme, meins FROM lqua WHERE lgnum = 'W01' AND lenum <> ' '",
 'lein_W01':    "SELECT lenum, lgtyp, lgpla, letyp, statu FROM lein WHERE lgnum = 'W01'",
}
for n, q in SQL.items():
    req('/sap/bc/adt/datapreview/freestyle?rowNumber=200', q, {'Content-Type': 'text/plain', 'Accept': 'application/xml, application/vnd.sap.adt.datapreview.table.v1+xml'}, f'sql_{n}.xml')
print('done ->', O)
