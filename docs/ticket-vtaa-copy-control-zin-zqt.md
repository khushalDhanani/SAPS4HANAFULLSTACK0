# SAP Ticket / Incident Specification

**Subject:** VTAA copy control ZIN -> ZQT does not copy custom port fields (client 220)

---

### Problem
Creating a Sales Quotation with reference to a Sales Inquiry fails at save with `SLS_LORD/009` ("Document is incomplete") — for every inquiry, including ones created manually in `VA11` with all fields maintained.

---

### Evidence (OData trace, inquiry 1000543, client 220, 16.09.2026)
```text
  GET   /ui_salesquotationmanage/.../                200  (CSRF, session opened)
  POST  .../CreateWithRefFromSlsInquiry              201  (SAP ACCEPTED the reference)
  GET   .../SalesQuotationManage(SalesQuotation='')  200  (session valid)
  POST  .../SaveChanges                              400  SLS_LORD/009 Document is incomplete
  POST  .../DiscardChanges                           204
```

The `201` on `CreateWithRefFromSlsInquiry` proves incompletion procedure `Z1` on the **INQUIRY** is satisfied. The failure is at `SaveChanges`, i.e. procedure `Z2` evaluated against the **QUOTATION** draft SAP built by copying from the inquiry.

---

### Root Cause
Copy control `VTAA`, `ZIN` -> `ZQT`, uses standard header data transfer routine `001`.
Routine `001` does **not** copy custom append fields (`ZZ*`). So:
- `VBAK-KVGR2` (Customer Group 2): Standard field, copies correctly.
- `VBAK-ZZPORTOFL` (Port of Loading): **NOT** copied.
- `VBAK-ZZPORTOFD` (Port of Discharge): **NOT** copied.

Incompletion procedure `Z2` marks both ports as blocking on quotations (`ZQT`), so the quotation draft can never be saved. In `VA21` a human fills them on the quotation screen, which is why manual creation appears to work; the OData service `UI_SALESQUOTATIONMANAGE` exposes no property for either field, so no application can supply them.

---

### Requested Change
In copy control `VTAA` (`ZIN` -> `ZQT`), add a data transfer routine (`VOFM`, e.g. `9xx`) or logic in `USEREXIT_MOVE_FIELD_TO_VBAK` (include `MV45AFZZ`) to copy `VBAK-ZZPORTOFL` and `VBAK-ZZPORTOFD` from the source document (`CVBAK`) to the target document (`VBAK`).

#### ABAP Code Snippet (Include `MV45AFZZ` or VOFM Routine)
```abap
" Copy custom port fields from preceding inquiry into quotation header
IF vbak-auart = 'ZQT' AND cvbak-auart = 'ZIN'.
  IF vbak-zzportofl IS INITIAL.
    vbak-zzportofl = cvbak-zzportofl.
  ENDIF.
  IF vbak-zzportofd IS INITIAL.
    vbak-zzportofd = cvbak-zzportofd.
  ENDIF.
ENDIF.
```

---

### How to Confirm First (2-Minute Test)
Proves the diagnosis before any development:
1. Go to transaction `VA21`.
2. Create with reference to Inquiry `1000543`.
3. Change nothing and click **Save**.
4. If SAP displays the incompletion dialog demanding **Port of Loading** / **Port of Discharge**, the copy-control gap is confirmed.

---

### Priority
**High / Blocker.**
This blocks automated quotation creation from inquiries for all API/Fiori channels and creates unnecessary retyping in SAP GUI. It is much smaller than the `LORD_ODATA_ORDER_SRV` extension ([docs/sap-inquiry-service-extension-spec.md](sap-inquiry-service-extension-spec.md)) and should be transported first.
