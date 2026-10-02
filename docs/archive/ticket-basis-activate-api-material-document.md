# Basis Gateway Service Activation Request: API_MATERIAL_DOCUMENT_SRV

**Ticket ID:** BASIS-REQ-20260929-01  
**Priority:** P1 — High / Blocker (Warehouse Management Goods Movements)  
**System:** SAP S/4HANA Development (`DS4`)  
**Client:** `220`  
**Host / Port:** `<S4_HOST>:8000`  
**System Alias:** `DS4_220` (and `LOCAL`)  
**Requested By:** SAP S/4HANA Full-Stack Engineering Team / Dipak Rathod, CIO  
**Date:** 29 September 2026  

---

## 1. Action Required from Basis

Please register and activate standard SAP OData V2 service **`API_MATERIAL_DOCUMENT_SRV`** in SAP Gateway for Client `220`.

### Step-by-Step Procedure in SAP Gateway:
1. Log into SAP GUI on system **`DS4`**, client **`220`**.
2. Run transaction **`/IWFND/MAINT_SERVICE`**.
3. Click **Add Service** button (`Ctrl+F7`).
4. Enter System Alias: **`DS4_220`** (or `LOCAL`).
5. Enter Technical Service Name: **`API_MATERIAL_DOCUMENT_SRV`**.
6. Click **Get Services**.
7. Select service `API_MATERIAL_DOCUMENT_SRV` (Version `0001`).
8. Click **Add Selected Services**.
9. In the dialog:
   - Assign Package (e.g., local `$TMP` or application package).
   - Set ICF Node: `Standard`.
   - Confirm and save.
10. Return to `/IWFND/MAINT_SERVICE`, locate `API_MATERIAL_DOCUMENT_SRV`, and verify:
    - ICF Node status is **Green (Active)**.
    - System Alias **`DS4_220`** (or `LOCAL`) is assigned to the service.
11. Test Service: Click **Gateway Client** (`/IWFND/GW_CLIENT`) and execute `GET` on:
    `/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV/$metadata` -> Confirm HTTP 200 OK.

---

## 2. Current Failure & Error Body

Every goods movement posting attempt currently fails at the SAP Gateway layer before reaching backend application logic.

### Live Gateway Error:
```text
HTTP/1.1 403 Forbidden
Content-Type: application/xml

<error xmlns="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata">
  <code>/IWFND/MED/170</code>
  <message xml:lang="en">No service found for namespace '', name 'API_MATERIAL_DOCUMENT_SRV', version '0001'</message>
</error>
```

- **Error Code:** `/IWFND/MED/170`
- **Gateway Log Transaction ID:** Visible in `/IWFND/ERROR_LOG` (e.g., `E6A502D9234E0220E006AA12E6AD9423`)
- **Diagnosis:** The service is a standard SAP S/4HANA A2X API (`API_MATERIAL_DOCUMENT_SRV`) provided by SAP for Material Document creation (`A_MaterialDocumentHeader`). It is implemented in backend package `MMIM_ODATA_MATERIAL_DOCUMENT` but has not been published in `/IWFND/MAINT_SERVICE` on this hub for client `220`.

---

## 3. Scope of Business Features Blocked

This single service is the **sole technical dependency** blocking synchronous live material document posting across all Warehouse Management Goods Issue & Transfer modules. 

Currently, all the following features are forced into the asynchronous Outbox Dispatch Queue (internal queue UUID) because SAP Gateway rejects the HTTP POST:

| # | Movement Type | Description | Workflow Status | Blocked Operation |
|---|---|---|---|---|
| 1 | **Movement 201 Planned** | Goods Issue to Cost Center via Reservation | Complete & Tested | POST `/A_MaterialDocumentHeader` |
| 2 | **Movement 201 Unplanned** | Direct Goods Issue to Cost Center (No Reservation) | Complete & Tested | POST `/A_MaterialDocumentHeader` |
| 3 | **Movement 261 Planned** | Goods Issue to Manufacturing Order via Reservation | Complete & Tested | POST `/A_MaterialDocumentHeader` (Tier 2 fallback) |
| 4 | **Movement 261 Unplanned** | Direct Goods Issue to Order (No Reservation) | Complete & Tested | POST `/A_MaterialDocumentHeader` |
| 5 | **Movement 301** | Plant-to-Plant Stock Transfer | Model/Controller Ready | POST `/A_MaterialDocumentHeader` |
| 6 | **Movement 311** | Storage Location to Storage Location Stock Transfer | Model/Controller Ready | POST `/A_MaterialDocumentHeader` |

---

## 4. Post-Activation Verification (Consolidated Test Plan)

Once Basis confirms activation of `API_MATERIAL_DOCUMENT_SRV` with System Alias `DS4_220`, the development team will execute a single consolidated verification pass across the 3 pre-validated payloads:

1. **Movement 201 (Cost Center):**
   - Cost Center: `1011202902`, Plant: `1130`, SLoc: `CS01`, Material: `1000000980`, Qty: `1`
2. **Movement 261 Planned (Reservation):**
   - Reservation: `518660`, Item: `0001`, Order: `1011`, Material: `8000009753`, Plant: `1120`, SLoc: `HS01`, Qty: `1 NOS`
3. **Movement 261 Unplanned (Direct Order):**
   - Order: `2000611`, Material: `8500000035`, Plant: `1120`, SLoc: `CS01`, Qty: `1 KG`

The resulting SAP Material Document numbers will be confirmed directly in `MATDOC` / `MB03`.
