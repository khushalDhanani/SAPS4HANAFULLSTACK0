# SAP Authorization Ticket / Request Specification

**Subject:** Grant `S_SERVICE` authorization for `API_MATERIAL_DOCUMENT_SRV` on `S4HANA_DEV` (Client 220)

---

### Request Summary
Requesting authorization for user **`KHUSHAL`** to execute OData service **`API_MATERIAL_DOCUMENT_SRV`** (Version 0001) on **`S4HANA_DEV`**, Client **`220`** (Host: `172.27.100.32:8000`).

---

### Problem & Diagnostic Evidence
During full-service verification against client 220 on **18-Sep-2026** (probing 27 total application OData services), `API_MATERIAL_DOCUMENT_SRV` returned **HTTP 403 Forbidden**:

```text
GET /sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV/$metadata  --> HTTP 403 Forbidden
```

- **Service Status:** The service is active and registered on the SAP Gateway.
- **Catalog Visibility:** The service is omitted from `/sap/opu/odata/IWFND/CATALOGSERVICE;v=2/ServiceCollection` for user `KHUSHAL`. In SAP Gateway, catalog filtering suppresses services for which the caller lacks `S_SERVICE` authorization.
- **System Health:** 25 out of 27 application services returned **HTTP 200 OK**, confirming network connectivity, basic authentication, and system alias mapping are healthy.

---

### Business Impact
- **Goods Issue Posting Blocked:** In Warehouse Management / Inventory Management, Goods Issue movement type **261** (consumption for reservation/production order) cannot be posted to SAP.
- **Dual-Posting Architecture:**
  - **Tier 1 (Custom RAP):** `ZUI_GI_ORDER_RSV_O4` returns **HTTP 404 Not Found** (unpublished in `/IWFND/V4_ADMIN` on this system).
  - **Tier 2 (Standard S/4HANA Fallback):** `API_MATERIAL_DOCUMENT_SRV` (`POST /A_MaterialDocumentHeader`) fails with **HTTP 403 Forbidden**.
- **Alternative Services:** `ZMMIM_MATDOC_SRV` is restricted to MBND_CLOUD Stock Transfers and returns **HTTP 501** (`Method 'MATDOCHEADERS_CREATE_ENTITY' not implemented`) for movement type 261.
- **Benefit of this Request:** Authorizing `API_MATERIAL_DOCUMENT_SRV` immediately unblocks Goods Issue 261 postings without waiting for custom RAP publishing.

---

### Requested Security / PFCG Role Update

#### 1. Authorization Object `S_SERVICE` (Gateway Service Check)
Add the OData V2 service to the user's role via **PFCG** (Menu -> Insert Transaction/Service -> Authorization Default -> `TADIR Service` / `IWSV`):

| Field | Value / Setting | Description |
|---|---|---|
| **`SRV_TYPE`** | `SV` | Gateway Service (IWSV) |
| **`SRV_NAME`** | `0001_API_MATERIAL_DOCUMENT_SRV` *(or PFCG Hash value)* | Standard Material Document OData Service |

*(Technical TADIR Key: `R3TR IWSV API_MATERIAL_DOCUMENT_SRV 0001`)*

#### 2. Inventory Management Authorization Objects (Movement 261)
Ensure the assigned role contains the corresponding business authorizations for posting material documents:

| Authorization Object | Field | Target Value | Description |
|---|---|---|---|
| **`M_MSEG_BWA`** | `BWART` | `261` | Movement type: GI for order/reservation |
| | `ACTVT` | `01` | Create |
| **`M_MSEG_WMB`** | `WERKS` | `*` *(or authorized plants, e.g., `1010`, `1710`)* | Plant authorization |
| | `LGORT` | `*` *(or authorized storage locations)* | Storage location authorization |
| | `ACTVT` | `01` | Create |
| **`M_MATE_STA`** | `ACTVT` | `03` | Display material master data |

---

### Steps to Validate After Granting

1. **Gateway Metadata Probe (Command Line):**
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" -u "KHUSHAL:<password>" \
     -H "sap-client: 220" \
     "http://172.27.100.32:8000/sap/opu/odata/sap/API_MATERIAL_DOCUMENT_SRV/\$metadata"
   ```
   **Expected Result:** `200` (Previously `403`).

2. **Automated Suite Check:**
   ```bash
   ./verify-services.sh
   ```
   `API_MATERIAL_DOCUMENT_SRV` will report `200` instead of `403`.

3. **Goods Issue Integration Test:**
   ```bash
   npx jest test/unit/wm/goodsIssueService.test.js
   ```

---

### Priority
**High / Blocker for Goods Issue Execution.**
Unblocks warehouse stock movements and eliminates the runtime failure on Goods Issue posting.
