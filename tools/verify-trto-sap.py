#!/usr/bin/env python3
"""Read-only: settle the open SAP-side facts behind ZWM_RF_TRTO_SRV. Output: docs/wm-discovery/verify/.
Usage: P='USER:PASS' python3 tools/verify-trto-sap.py"""
import os, re, base64, urllib.request, urllib.error
H, O = os.environ['S4_DESTINATION_URL'], 'docs/wm-discovery/verify'
C = os.environ.get('S4_CLIENT', '220')
os.makedirs(O, exist_ok=True)
AUTH = 'Basic ' + base64.b64encode(os.environ['P'].encode()).decode()
op = urllib.request.build_opener(urllib.request.ProxyHandler({}))

def get(name, path):
    r = urllib.request.Request(H + path, headers={'Authorization': AUTH, 'sap-client': C, 'Accept': '*/*'})
    try: resp = op.open(r, timeout=120); code = resp.status
    except urllib.error.HTTPError as e: resp, code = e, e.code
    body = resp.read().decode('utf-8', 'ignore'); open(f'{O}/{name}', 'w').write(body)
    print(f'  {code} {name}')
    return code, body

print('1) Does the new backend exist in SAP yet?')
get('trto_metadata.xml', '/sap/opu/odata/sap/ZWM_RF_TRTO_SRV/$metadata')
get('su_fm.abap', '/sap/bc/adt/functions/groups/z_wm_tr_services/fmodules/z_wm_get_su_details/source/main')
get('to_create_fm.abap', '/sap/bc/adt/functions/groups/zwm_finishedgoods/fmodules/zwm_to_create_from_tr/source/main')

print('2) Signatures the spec relies on')
get('l_to_confirm.abap', '/sap/bc/adt/functions/groups/l03b/fmodules/l_to_confirm/source/main')
get('l_to_create_tr.abap', '/sap/bc/adt/functions/groups/l03b/fmodules/l_to_create_tr/source/main')
get('l03b_trite.txt', '/sap/bc/adt/ddic/structures/l03b_trite/source/main')
get('if_mgw_req_func.abap', '/sap/bc/adt/oo/interfaces/%2fiwbep%2fif_mgw_req_func/source/main')
get('search_conf_tab.xml', '/sap/bc/adt/repository/informationsystem/search?operation=quickSearch&maxResults=20&query=L03B_CONF*')
print('done ->', O)
