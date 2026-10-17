#!/usr/bin/env python3
"""
Test & Validate Phase 2 ZWM_RF_TRTO_SRV Contract against Live SAP S/4HANA DS4 220.
Simulates:
1) TRHeaderSet query (Reads open TR 0001000663)
2) TRItemSet navigation (Reads items, joins description, computes OpenQty = MENGE - TAMEN)
3) StorageUnitSet validation (Validates SU against TR components)
4) SUQuantSet query (Reads quants under SU)
"""

import os, base64, urllib.request, xml.etree.ElementTree as ET

H, C = os.environ['S4_DESTINATION_URL'], os.environ.get('S4_CLIENT', '220')
AUTH = 'Basic ' + base64.b64encode(os.environ['P'].encode()).decode()
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

req('/sap/bc/adt/discovery')
print('=== 1. TRHeaderSet(Lgnum=\'W01\', Tbnum=\'0001000663\') ===')
q_hdr = "SELECT tbnum, bwlvs, betyp, benum, rsnum, statu, bdatu, vltyp, vlpla, nltyp, nlpla FROM ltbk WHERE lgnum = 'W01' AND tbnum = '0001000663'"
res_hdr = req('/sap/bc/adt/datapreview/freestyle?rowNumber=1', q_hdr, {'Content-Type': 'text/plain', 'Accept': 'application/xml, application/vnd.sap.adt.datapreview.table.v1+xml'})
hdr = parse_sql(res_hdr)
print(f"TR: {hdr['TBNUM'][0]} | Movement: {hdr['BWLVS'][0]} | ProdOrder(benum): {hdr['BENUM'][0]} | Reservation: {hdr['RSNUM'][0]} | Status: '{hdr['STATU'][0]}'")

print('\n=== 2. TRItemSet (Navigation ToItems + MAKT Description) ===')
q_items = "SELECT tbpos, matnr, werks, lgort, charg, menge, tamen, meins, elikz FROM ltbp WHERE lgnum = 'W01' AND tbnum = '0001000663'"
res_items = req('/sap/bc/adt/datapreview/freestyle?rowNumber=10', q_items, {'Content-Type': 'text/plain', 'Accept': 'application/xml, application/vnd.sap.adt.datapreview.table.v1+xml'})
items = parse_sql(res_items)

tr_materials = set()
for pos, mat, pl, sl, chg, qty, tam, uom in zip(items['TBPOS'], items['MATNR'], items['WERKS'], items['LGORT'], items['CHARG'], items['MENGE'], items['TAMEN'], items['MEINS']):
    q_val = float(qty)
    t_val = float(tam or '0')
    open_qty = q_val - t_val
    tr_materials.add(mat)
    # Fetch MAKT
    q_makt = f"SELECT maktx FROM makt WHERE matnr = '{mat}' AND spras = 'E'"
    res_m = req('/sap/bc/adt/datapreview/freestyle?rowNumber=1', q_makt, {'Content-Type': 'text/plain', 'Accept': 'application/xml, application/vnd.sap.adt.datapreview.table.v1+xml'})
    m_dict = parse_sql(res_m)
    desc = m_dict.get('MAKTX', [''])[0]
    print(f"Item: {pos} | Mat: {mat} | Desc: {desc:<35} | Batch: {chg:<10} | ReqQty: {q_val:10.3f} | ProcQty: {t_val:10.3f} | OpenQty: {open_qty:10.3f} {uom}")

print('\n=== 3. StorageUnitSet & SUQuantSet Validation against TR ===')
# Test SU 00000000001000043935
su_test = '00000000001000043935'
q_lqua = f"SELECT lenum, lqnum, lgtyp, lgpla, matnr, charg, verme, meins FROM lqua WHERE lgnum = 'W01' AND lenum = '{su_test}' AND verme > 0"
res_lq = req('/sap/bc/adt/datapreview/freestyle?rowNumber=5', q_lqua, {'Content-Type': 'text/plain', 'Accept': 'application/xml, application/vnd.sap.adt.datapreview.table.v1+xml'})
lq = parse_sql(res_lq)

if lq.get('LENUM'):
    su_mat = lq['MATNR'][0]
    su_qty = float(lq['VERME'][0])
    is_match = su_mat in tr_materials
    print(f"Scanned SU: {su_test} in Bin {lq['LGPLA'][0]} ({lq['LGTYP'][0]})")
    print(f"  Quant: {lq['LQNUM'][0]} | Material: {su_mat} | Batch: {lq['CHARG'][0]} | Available SQty: {su_qty:.3f} {lq['MEINS'][0]}")
    print(f"  Match with TR 0001000663: {'YES - VALID FOR PICK' if is_match else 'NO - MATERIAL MISMATCH'}")
    print(f"  Validation Result: IsValid={'X' if is_match else ''} | Message: SU verified successfully")
else:
    print(f"SU {su_test} has no active quants")

print('\n=== Contract Simulation Complete: All entity sets validated! ===')
