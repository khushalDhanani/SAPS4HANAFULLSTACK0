import json, base64, urllib.request, urllib.error, urllib.parse
BASE="http://localhost:4004"; AUTH="Basic "+base64.b64encode(b"khushal:x").decode()
def get(u,t=60):
    r=urllib.request.Request(u,headers={"Authorization":AUTH,"Accept":"application/json"})
    try:
        with urllib.request.urlopen(r,timeout=t) as x: return x.status,json.loads(x.read().decode("utf-8","replace"))
    except urllib.error.HTTPError as e:
        try: b=json.loads(e.read().decode("utf-8","replace"))
        except Exception: b={}
        return e.code,b
    except Exception as e: return 0,{"err":str(e)}
def msg(b):
    m=b.get("error",{}).get("message")
    return (m.get("value") if isinstance(m,dict) else m) or str(b)[:120]
def q(p): return urllib.parse.quote(str(p),safe="")

print("--- GOODS ISSUE: real reservation drill-down ---")
s,b=get(BASE+"/odata/v4/goods-issue/OpenReservations?$top=3")
res=b.get("value",[])
print("OpenReservations rows:",len(res))
for r in res[:2]:
    rn=r["ReservationNo"]
    print("  reservation",rn,"plant",r.get("Plant"),"mvt",r.get("MovementType"),"items",r.get("ItemCount"))
    s2,b2=get(BASE+"/odata/v4/goods-issue/GIItems?$filter=ReservationNo%20eq%20'"+rn+"'")
    items=b2.get("value",[])
    print("   GIItems http",s2,"rows",len(items), "" if s2==200 else msg(b2))
    if items:
        it=items[0]
        print("    item",it.get("ReservationItem"),it.get("Material"),"| desc",str(it.get("MaterialDesc"))[:38],
              "| sloc",it.get("StorageLocation"),"| bin",it.get("StorageBin"),"| batch",it.get("Batch"),
              "| req",it.get("RequiredQty"),it.get("Unit"),"| open",it.get("OpenQty"),"| pkgunits",len(it.get("PackagingUnits") or []))
        mat=it.get("Material"); pl=it.get("Plant")
        s3,b3=get(BASE+"/odata/v4/goods-issue/MaterialBatches?$filter=Material%20eq%20'"+q(mat)+"'%20and%20Plant%20eq%20'"+q(pl)+"'")
        bt=b3.get("value",[])
        print("    MaterialBatches http",s3,"rows",len(bt),"" if s3==200 else msg(b3))
        if bt: print("     batch",bt[0].get("Batch"),"stock",bt[0].get("AvailableStock"),bt[0].get("Unit"),"exp",bt[0].get("ExpiryDate"),"status",bt[0].get("StatusText"))
        s4,b4=get(BASE+"/odata/v4/goods-issue/resolveIdentifier(barcode='"+rn+"')")
        print("    resolveIdentifier http",s4, ("res="+str(b4.get("ReservationNo"))+" items="+str(len(b4.get("Items") or []))+" batches="+str(len(b4.get("AvailableBatches") or []))+" stock="+str(b4.get("AvailableStock"))) if s4==200 else msg(b4))

print("\n--- GOODS RECEIPT: real storage unit drill-down ---")
s,b=get(BASE+"/odata/v4/goods-receipt/OpenInboundDeliveries?$top=2")
for d in b.get("value",[])[:2]:
    su=d.get("StorageUnit")
    print("  SU",su,"dlv",d.get("DeliveryDocument"),"PO",d.get("PurchaseOrder"),"mat",d.get("Material"),"plant",d.get("Plant"),"supp",str(d.get("SupplierName"))[:25])
    s2,b2=get(BASE+"/odata/v4/goods-receipt/getStorageUnitDetails(StorageUnit='"+q(su)+"')")
    print("   getStorageUnitDetails http",s2, ("mat="+str(b2.get("Material"))+" qty="+str(b2.get("Quantity"))+str(b2.get("Unit"))+" batch="+str(b2.get("Batch"))+" bin="+str(b2.get("WarehouseStorageBin"))+" sloc="+str(b2.get("StorageLocation"))+" exp="+str(b2.get("ExpiryDate"))) if s2==200 else msg(b2))
    mat=d.get("Material")
    s3,b3=get(BASE+"/odata/v4/goods-receipt/MaterialStorageLocations?$filter=Material%20eq%20'"+q(mat)+"'")
    print("   MaterialStorageLocations http",s3,"rows",len(b3.get("value",[])), "" if s3==200 else msg(b3))
    s4,b4=get(BASE+"/odata/v4/goods-receipt/MaterialBatches?$filter=Material%20eq%20'"+q(mat)+"'")
    print("   MaterialBatches http",s4,"rows",len(b4.get("value",[])), "" if s4==200 else msg(b4))

print("\n--- EWM: every warehouse, real filter ---")
s,b=get(BASE+"/odata/v4/warehouse-management/Warehouses")
whs=[w["Warehouse"] for w in b.get("value",[])]
ewm=[w["Warehouse"] for w in b.get("value",[]) if w.get("IsEwm")]
print("warehouses:",len(whs),whs)
print("flagged IsEwm:",ewm)
tot={"StorageTypes":0,"WarehouseProcessTypes":0,"StorageBins":0,"WarehouseOrders":0,"WarehouseTasks":0,"InboundDeliveries":0,"OutboundDeliveries":0,"WarehouseResources":0}
errs={}
for w in whs:
    for e in list(tot):
        s2,b2=get(BASE+"/odata/v4/warehouse-management/"+e+"?$filter=Warehouse%20eq%20'"+q(w)+"'&$top=1")
        if s2==200: tot[e]+=len(b2.get("value",[]))
        else: errs.setdefault(e,set()).add(str(s2)+": "+str(msg(b2))[:70])
for e,v in tot.items(): print("  %-22s warehouses returning any row: %d of %d" % (e,v,len(whs)))
for e,v in errs.items(): print("  ERR %-20s %s" % (e,list(v)[:2]))
s,b=get(BASE+"/odata/v4/warehouse-management/WarehouseKPIs?$filter=Warehouse%20eq%20'"+q(whs[0])+"'")
print("  WarehouseKPIs(",whs[0],") http",s,json.dumps(b.get("value",b))[:200])

print("\n--- defaults functions with real keys ---")
s,b=get(BASE+"/odata/v4/purchase-order/SupplierVH?$top=1")
sup=(b.get("value") or [{}])[0]
s2,b2=get(BASE+"/odata/v4/purchase-order/getSupplierDefaults(Supplier='"+q(sup.get("Supplier"))+"',CompanyCode='1000',PurchasingOrganization='1000')")
print("  getSupplierDefaults(",sup.get("Supplier"),") http",s2,json.dumps(b2)[:260])
s3,b3=get(BASE+"/odata/v4/sales-inquiry/CustomerVH?$top=1")
cus=(b3.get("value") or [{}])[0]
s4,b4=get(BASE+"/odata/v4/sales-inquiry/getCustomerDefaults(Customer='"+q(cus.get("Customer"))+"',SalesOrganization='1000',DistributionChannel='10',Division='52')")
print("  getCustomerDefaults(",cus.get("Customer"),") http",s4,json.dumps(b4)[:300])
s5,b5=get(BASE+"/odata/v4/sales-inquiry/getInquiryCreationCapabilities()")
print("  getInquiryCreationCapabilities http",s5,json.dumps(b5)[:300])
s6,b6=get(BASE+"/odata/v4/purchase-order/PurchaseOrders?$top=1&$expand=to_PurchaseOrderItem")
po=(b6.get("value") or [{}])[0]
print("  PurchaseOrders+items http",s6,"PO",po.get("PurchaseOrder"),"supplier",str(po.get("SupplierName"))[:22],"net",po.get("PurchaseOrderNetAmount"),po.get("DocumentCurrency"),"items",len(po.get("to_PurchaseOrderItem") or []))
s7,b7=get(BASE+"/odata/v4/sales-inquiry/SalesInquiries?$top=1&$expand=to_Items")
si=(b7.get("value") or [{}])[0]
print("  SalesInquiries+items http",s7,"INQ",si.get("SalesInquiry"),"cust",si.get("SoldToParty"),"net",si.get("TotalNetAmount"),si.get("TransactionCurrency"),"items",len(si.get("to_Items") or []))
print("\nDONE2")
