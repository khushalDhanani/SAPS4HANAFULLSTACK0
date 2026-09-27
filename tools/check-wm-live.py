#!/usr/bin/env python3
import os, base64, urllib.request, xml.etree.ElementTree as ET

for line in open('.env.local'):
    if line.startswith('S4_USERNAME=') or line.startswith('S4_PASSWORD='):
        k, v = line.strip().split('=', 1)
        os.environ[k] = v.strip(' "\'')

P = f"{os.environ.get('S4_USERNAME')}:{os.environ.get('S4_PASSWORD')}"
H, C = 'http://172.27.100.32:8000', '220'
AUTH = 'Basic ' + base64.b64encode(P.encode()).decode()
op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
jar, tok = {}, ''

def req(path, data=None, hdr=None):
    global tok
    h = {'Authorization': AUTH, 'sap-client': C, 'Accept': '*/*', 'x-csrf-token': tok or 'fetch'}
    if jar: h['Cookie'] = '; '.join(f'{k}={v}' for k, v in jar.items())
    h.update(hdr or {})
    r = urllib.request.Request(H + path, data=data.encode() if data else None, headers=h, method='POST' if data else 'GET')
    resp = op.open(r, timeout=60)
    for c in resp.headers.get_all('Set-Cookie') or []:
        k, _, v = c.split(';', 1)[0].partition('='); jar[k.strip()] = v
    t = resp.headers.get('x-csrf-token')
    if t and t.lower() != 'required': tok = t
    return resp.read().decode('utf-8', 'ignore')

def parse_sql(xml_str):
    tree = ET.fromstring(xml_str)
    cols = {}
    for col in tree.findall('{http://www.sap.com/adt/dataPreview}columns'):
        meta = col.find('{http://www.sap.com/adt/dataPreview}metadata')
        name = meta.attrib.get('{http://www.sap.com/adt/dataPreview}name')
        dataset = col.find('{http://www.sap.com/adt/dataPreview}dataSet')
        cols[name] = [(d.text or '').strip() for d in dataset.findall('{http://www.sap.com/adt/dataPreview}data')]
    return cols

ADT_PREVIEW_HDR = {'Content-Type': 'text/plain', 'Accept': 'application/xml, application/vnd.sap.adt.datapreview.table.v1+xml'}

req('/sap/bc/adt/discovery')

# 1. Open TRs
sql = "SELECT tbnum, bwlvs, benum, statu, bdatu FROM ltbk WHERE lgnum = 'W01' AND statu = ' '"
res = req('/sap/bc/adt/datapreview/freestyle?rowNumber=10', sql, ADT_PREVIEW_HDR)
trs = parse_sql(res)
print("=== Open TRs in W01 (LTBK statu = initial) ===")
for tb, bw, be, st, bd in zip(trs.get('TBNUM', []), trs.get('BWLVS', []), trs.get('BENUM', []), trs.get('STATU', []), trs.get('BDATU', [])):
    print(f"  TR: {tb} | Mvt: {bw} | Order/Doc: {be} | Status: '{st}' | Date: {bd}")

# 2. Existing Transfer Orders in LTAK
sql_to = "SELECT tanum, bdatu, bzeit, bname, bwlvs, tbnum FROM ltak WHERE lgnum = 'W01'"
res_to = req('/sap/bc/adt/datapreview/freestyle?rowNumber=10', sql_to, ADT_PREVIEW_HDR)
tos = parse_sql(res_to)
print("\n=== Recent Transfer Orders in W01 (LTAK) ===")
for ta, bd, bz, bn, bw, tb in zip(tos.get('TANUM', []), tos.get('BDATU', []), tos.get('BZEIT', []), tos.get('BNAME', []), tos.get('BWLVS', []), tos.get('TBNUM', [])):
    print(f"  TO: {ta} | Date: {bd} {bz} | User: {bn} | Mvt: {bw} | TR: {tb}")

# 3. Quants in LQUA
sql_lq = "SELECT lenum, lgtyp, lgpla, matnr, verme, meins FROM lqua WHERE lgnum = 'W01' AND verme > 0"
res_lq = req('/sap/bc/adt/datapreview/freestyle?rowNumber=5', sql_lq, ADT_PREVIEW_HDR)
lqs = parse_sql(res_lq)
print("\n=== Sample Quants in W01 (LQUA / LX02) ===")
for le, lt, lp, ma, ve, me in zip(lqs.get('LENUM', []), lqs.get('LGTYP', []), lqs.get('LGPLA', []), lqs.get('MATNR', []), lqs.get('VERME', []), lqs.get('MEINS', [])):
    print(f"  SU: {le} | Type: {lt} | Bin: {lp} | Material: {ma} | Available: {ve} {me}")
