# SAP change request: extend `LORD_ODATA_ORDER_SRV` for quotation-ready inquiries

> **Status (2026-09-22):** the application-side quotation feature (`SalesInquiryToCreateSalesInquiry`) has been removed from this repository. This document stays as the SAP-side change request only; nothing in the app depends on it.

**System:** DS4, client 220 (DEV) · **Owner:** SD development · **Requested by:** SAPS4HANAFULLSTACK application team

## Problem

The application creates Sales Inquiries (type `ZIN`) through the OData service `LORD_ODATA_ORDER_SRV`
(`HeaderSet` → `ItemSet` → `PriceCondSet`). SAP's incompletion procedures for `ZIN` require values that
this service cannot carry, so every inquiry created by the application is *incomplete* and SAP refuses
to reference it from a quotation:

```
SLS_LORD/166  Reference doc. <inquiry> is incomplete and cannot be referenced
```

Evidence (read from DS4 on 2026-09-14): inquiries 1000537, 1000538, 1000539, 1000540 all show the same
incompletion log entries; inquiry 1000520 (created in SAP GUI with these fields filled) converted to
quotation 2000435 without any problem.

## Fields SAP requires (incompletion procedures Z1 / Z2, partner determination TA)

| SAP field | Description | Data element | Length | Present in `LORD_ODATA_ORDER_SRV`? |
|---|---|---|---|---|
| `VBAK-KVGR2` | Customer Group 2 (values from `TVV2`, e.g. `SEA` = By Sea) | `KVGR2` | CHAR 3 | **No** |
| `VBAK-ZZPORTOFL` | Port of Loading (custom) | `ZPOL` | CHAR 50 | **No** |
| `VBAK-ZZPORTOFD` | Port of Discharge (custom) | `ZPDI` | CHAR 50 | **No** |
| `VBPA-PARNR`, partner function `ZP` | Contact person of the sold-to party (`KNVK`) | `PARNR` | NUMC 10 | **No** (`HeaderPartnerSet` exposes `CustomerID` only, and is not creatable) |
| `VBAK-BNDDT` | Binding Period Validity End Date (inquiry "Valid To") | `BNDDT` | DATS 8 | **No** |
| `VBAP-WERKS` | Plant | `WERKS_EXT` | CHAR 4 | Yes (`ItemSet.Plant`); please confirm it is honoured on create |

## Requested change

Extend the **`Header`** entity of `LORD_ODATA_ORDER_SRV` (project `LORD_ODATA_ORDER`, or a Z redefinition
if the standard project must stay untouched) with five creatable and readable properties. **The property names below
are what the application already sends; please use them exactly.**

| Property (exact name) | Type | Maps to |
|---|---|---|
| `CustomerGroup2` | `Edm.String`, MaxLength 3 | `VBAK-KVGR2` |
| `PortOfLoading` | `Edm.String`, MaxLength 50 | `VBAK-ZZPORTOFL` |
| `PortOfDischarge` | `Edm.String`, MaxLength 50 | `VBAK-ZZPORTOFD` |
| `ContactPerson` | `Edm.String`, MaxLength 10 | header partner `ZP` → `VBPA-PARNR` (ALPHA-padded) |
| `BindingPeriodValidityEndDate` | `Edm.DateTime` | `VBAK-BNDDT` |

Behaviour:

1. `POST HeaderSet` with these properties must set the values on the created inquiry (Lean Order API
   `LORD_SET_..` / header structure and partner table), so that the inquiry saves **complete** when all
   five values are supplied.
2. Confirm that `POST HeaderSet('…')/ItemSet` honours `Plant`; if not, please make it creatable.
3. No defaults: if a property is not sent, leave the field empty (the application never invents values).
4. Optional but valuable: a read-only value-help entity set for `TVV2T` (Customer Group 2) and one for
   the sold-to party's contact persons (`KNVK`: `PARNR`, `NAME1`, `NAMEV`) so the UI can offer choices.
5. **MANDATORY REQUIREMENT: Fields must be READABLE as well as CREATABLE.**
   The properties (`CustomerGroup2`, `PortOfLoading`, `PortOfDischarge`, `ContactPerson`, `BindingPeriodValidityEndDate`)
   must also be exposed for **READ/GET** on the `Header` entity of `LORD_ODATA_ORDER_SRV` (and, if SAP prefers,
   on the `C_Inquiryfs` factsheet entity in `SD_F2369_INQY_FS_SRV`).
   If the properties are only creatable on POST `HeaderSet` but omitted from GET/read responses, the application
   can never read them back or verify document completeness post-transport, leaving the field-level incompletion
   pre-flight blind and forcing it to rely strictly on aggregate `SD_F2430_INCOMP_SRV`.

## How the application uses it (no redeployment needed)

The application reads the service's `$metadata` once per process and sends each of the four values
**only when the property exists**. Until the extension is transported to client 220 it keeps working
with the standard fields, marks the four values as *not yet supported* in the Create Inquiry screen and
tells users to maintain them in VA22. After the transport it automatically requires and transmits them.

Verification after transport:

```
GET /sap/opu/odata/sap/LORD_ODATA_ORDER_SRV/$metadata?sap-client=220
```
must list the four properties on `EntityType Name="Header"`. Then in the application:
`GET /odata/v4/sales-inquiry/getInquiryCreationCapabilities()` returns `true` for all five fields.

## Related SAP-side items (not application defects)

- Transaction VA22 rejects user `KHUSHAL` with the custom message `ZSDM001/019`
  ("&1 Inquiry does not belongs to &2"). The user has no personnel number linked (infotype 0105), so
  it is never the inquiry's employee responsible (partner `ZE`). Please advise whether developers in
  DEV should be linked to a personnel number or exempted from this check.
- The quotation service `API_SALES_QUOTATION_SRV` (catalog ID `ZAPI_SALES_QUOTATION_SRV_0001`) is
  registered without a System Alias. Assigning alias `S4SD` (client 220 — **not** `LOCAL`, which points
  to client 110) would allow single-request quotation creation without the stateful-session issues
  observed with `UI_SALESQUOTATIONMANAGE`.
- **Copy control `VTAA` (`ZIN` → `ZQT`) missing data transfer routine for custom `ZZ*` append fields**:
  Quotation creation with reference to an inquiry (`CreateWithRefFromSlsInquiry`) creates a quotation draft,
  but during `SaveChanges` SAP rejects with `SLS_LORD/009 Document is incomplete`.
  **Root cause**: Standard data transfer routine `001` in copy control `VTAA` (`ZIN` → `ZQT`) does NOT copy
  `ZZ*` append fields (`VBAK-ZZPORTOFL` and `VBAK-ZZPORTOFD`) from the reference inquiry to the quotation header.
  Because incompletion procedure `Z2` on `ZQT` requires both port fields, every quotation created by reference
  is incomplete upon creation.
  **Required SAP-side solution**:
  In transaction `VTAA` (`ZIN` → `ZQT`), assign a custom data transfer routine (VOFM Data Transfer, e.g. `9xx`)
  or add logic in `USEREXIT_MOVE_FIELD_TO_VBAK` (include `MV45AFZZ`):
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
  Without this routine/exit, no quotation created with reference to an inquiry can ever satisfy incompletion procedure `Z2`.
