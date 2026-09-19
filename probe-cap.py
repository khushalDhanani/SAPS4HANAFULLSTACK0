import json, base64, csv, sys, time
import urllib.request, urllib.error

BASE = "http://localhost:4004"
AUTH = "Basic " + base64.b64encode(b"khushal:x").decode()
SERVICES = ["/odata/v4/purchase-order","/odata/v4/journal-entry","/odata/v4/sales-inquiry",
            "/odata/v4/warehouse-management","/odata/v4/goods-issue","/odata/v4/goods-receipt"]
FUNCS = {
 "/odata/v4/purchase-order": ["getDashboardMetrics()"],
 "/odata/v4/sales-inquiry": ["getSalesInquiryDefaults()","getInquiryCreationCapabilities()","getSalesOrderMetrics()"],
 "/odata/v4/goods-issue": ["getQueueSummary()"],
}

def get(url, timeout=45):
    req = urllib.request.Request(url, headers={"Authorization": AUTH, "Accept":"application/json"})
    t0=time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8","replace"), time.time()-t0
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8","replace"), time.time()-t0
    except Exception as e:
        return 0, "CLIENT_ERROR: %s" % e, time.time()-t0

def errmsg(body):
    try:
        j = json.loads(body)
        m = j.get("error",{}).get("message")
        if isinstance(m,dict): m = m.get("value")
        if m: return str(m)[:180].replace("\n"," ")
    except Exception: pass
    return body[:180].replace("\n"," ")

rows=[]
for svc in SERVICES:
    st, body, _ = get(BASE+svc+"/")
    if st != 200:
        rows.append([svc,"(service document)",st,"","",errmsg(body)]); continue
    try:
        sets = [v["name"] for v in json.loads(body).get("value",[]) if v.get("kind","EntitySet")=="EntitySet"]
    except Exception:
        sets = []
    for name in sets:
        st, body, dt = get("%s%s/%s?$top=3&$count=true" % (BASE,svc,name))
        n=""; total=""; note=""
        if st==200:
            try:
                j=json.loads(body); n=len(j.get("value",[])); total=j.get("@odata.count","")
                if n==0: note="EMPTY - 0 rows"
                else:
                    first=j["value"][0]
                    filled=[k for k,v in first.items() if v not in (None,"","0",0) and not k.startswith("@")]
                    note="sample keys with values: " + ",".join(filled[:8])
            except Exception as e: note="unparseable: %s"%e
        else:
            note=errmsg(body)
        rows.append([svc,name,st,n,total,note])
        print("%-34s %-28s %3s rows=%-4s total=%-8s %s" % (svc,name,st,n,total,note[:90]), flush=True)
    for fn in FUNCS.get(svc,[]):
        st, body, dt = get("%s%s/%s" % (BASE,svc,fn))
        note = (body[:170].replace("\n"," ") if st==200 else errmsg(body))
        rows.append([svc,fn,st,"","",note])
        print("%-34s %-28s %3s %s" % (svc,fn,st,note[:110]), flush=True)

with open("/tmp/cap-reality.csv","w",newline="") as f:
    w=csv.writer(f); w.writerow(["service","endpoint","http","rows_returned","total_count","note"]); w.writerows(rows)
print("\nDONE", len(rows), "endpoints -> /tmp/cap-reality.csv")
