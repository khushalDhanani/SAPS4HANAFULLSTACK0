# Technical Specification & ABAP Source Code: Goods Issue Against Order/Reservation (LE-WM)

## 1. Overview & Architecture

- **Business Process**: Goods Issue (Movement Type 261) against Production Orders (`AUFNR`) and Reservations (`RSNUM`) in classic Logistics Execution Warehouse Management (LE-WM).
- **Core Principle**: "One backend, two front ends". Single source of truth for business logic implemented in ABAP Function Group `ZWM_GI`.
- **Frontends**:
  1. **Zebra RF Device (ITSmobile / Dynpro)**: Calls function modules directly from PBO/PAI logic.
  2. **SAP Fiori / Mobile Web App**: Consumes RAP OData V4 service (`ZUI_GI_ORDER_RSV_O4`) / CAP middleware, whose implementation executes the same function modules.

---

## 2. ABAP Data Dictionary (DDIC) Definitions

### 2.1 Structure `ZWM_GI_ITEM`
Line structure representing open reservation components.

| Field | Data Element | Data Type | Length | Decimals | Description |
|---|---|---|---|---|---|
| `RESERV_NO` | `RSNUM` | NUMC | 10 | 0 | Number of reservation/dependent requirements |
| `RESERV_ITEM` | `RSPOS` | NUMC | 4 | 0 | Item number of reservation/dependent requirements |
| `ORDER_NO` | `AUFNR` | CHAR | 12 | 0 | Order Number (from `RESB-AUFNR`) |
| `MATERIAL` | `MATNR` | CHAR | 40 | 0 | Material Number |
| `MATERIAL_DESC` | `MAKTX` | CHAR | 40 | 0 | Material Description (from `MAKT-MAKTX`) |
| `PLANT` | `WERKS_D` | CHAR | 4 | 0 | Plant |
| `STGE_LOC` | `LGORT_D` | CHAR | 4 | 0 | Storage Location |
| `BIN` | `LGPLA` | CHAR | 10 | 0 | Storage Bin (from `MLGN`/`LAGP`) |
| `BATCH` | `CHARG_D` | CHAR | 10 | 0 | Batch Number |
| `UOM` | `MEINS` | UNIT | 3 | 0 | Base Unit of Measure |
| `REQUIRED_QTY` | `MENGE_D` | QUAN | 13 | 3 | Required Quantity (`RESB-BDMNG`) |
| `WITHDRAWN_QTY` | `MENGE_D` | QUAN | 13 | 3 | Quantity Withdrawn (`RESB-ENMNG`) |
| `OPEN_QTY` | `MENGE_D` | QUAN | 13 | 3 | Open Quantity (`BDMNG - ENMNG`) |
| `PACKAGING_UNITS` | `ZWM_GI_UOM_T` | Table | - | - | Alternative packaging units from `MARM` |
| `EXPIRY_DATE` | `VFDAT` | DATS | 8 | 0 | Shelf Life Expiration Date (from `MCHA`/`MCH1-VFDAT`) |
| `BATCH_STATUS_STATE` | `CHAR` | CHAR | 10 | 0 | ValueState for UI (`Success`, `Warning`, `Error`) |
| `BATCH_STATUS_TEXT` | `CHAR` | CHAR | 20 | 0 | Status Text (`VALID`, `EXPIRING SOON`, `EXPIRED`) |

Table Type: `ZWM_GI_ITEM_T` (Line type `ZWM_GI_ITEM`).

### 2.2 Structure `ZWM_GI_UOM`
Alternative packaging unit of measure from `MARM`.

| Field | Data Element | Data Type | Length | Decimals | Description |
|---|---|---|---|---|---|
| `MATNR` | `MATNR` | CHAR | 40 | 0 | Material Number |
| `MEINH` | `LRMBL` | UNIT | 3 | 0 | Alternative Unit of Measure |
| `MEINH_TXT` | `MSEHT` | CHAR | 40 | 0 | Unit Description (e.g. 'Drum (50 KG)', 'Bag (25 KG)') |
| `UMREZ` | `UMREZ` | INT4 | 10 | 0 | Numerator for conversion to base UoM |
| `UMREN` | `UMREN` | INT4 | 10 | 0 | Denominator for conversion to base UoM |
| `FACTOR_TO_BASE` | `MENGE_D` | QUAN | 13 | 3 | Calculated Factor to Base UoM |
| `EAN11` | `EAN11` | CHAR | 18 | 0 | International Article Number / Container Barcode |

Table Type: `ZWM_GI_UOM_T` (Line type `ZWM_GI_UOM`).

### 2.3 Structure `ZWM_GI_SUBMIT_ITEM`
Line structure for batch submission from mobile or RF screen, including short pick difference fields.

| Field | Data Element | Data Type | Length | Decimals | Description |
|---|---|---|---|---|---|
| `RESERV_ITEM` | `RSPOS` | NUMC | 4 | 0 | Reservation Item |
| `MATERIAL` | `MATNR` | CHAR | 40 | 0 | Material Number |
| `ISSUE_QTY` | `MENGE_D` | QUAN | 13 | 3 | Total Accumulated Issue Quantity |
| `BATCH` | `CHARG_D` | CHAR | 10 | 0 | Batch Number (optional) |
| `DIFF_QTY` | `MENGE_D` | QUAN | 13 | 3 | Difference Quantity (Short Pick) |
| `DIFF_REASON` | `GRUND` | NUMC | 4 | 0 | Difference Reason Code (`01`-Shortage, `02`-Damage) |
| `DIFF_LGTYP` | `LGTYP` | CHAR | 3 | 0 | Difference Storage Type (Default `'999'`) |
| `FINAL_ISSUE` | `KZEAR` | CHAR | 1 | 0 | Final Issue Indicator (`'X'` closes reservation item) |

Table Type: `ZWM_GI_SUBMIT_ITEM_T` (Line type `ZWM_GI_SUBMIT_ITEM`).

### 2.4 Structure `ZWM_GI_SUBMIT_RESULT`
Line structure reporting status for each processed component.

| Field | Data Element | Data Type | Length | Decimals | Description |
|---|---|---|---|---|---|
| `RESERV_ITEM` | `RSPOS` | NUMC | 4 | 0 | Reservation Item Number |
| `MATDOC` | `MBLNR` | CHAR | 10 | 0 | Material Document Number |
| `MATDOC_YEAR` | `MJAHR` | NUMC | 4 | 0 | Material Document Year |
| `TO_NUMBER` | `TANUM` | NUMC | 10 | 0 | Transfer Order Number |
| `DIFF_CLEARED` | `XFELD` | CHAR | 1 | 0 | Difference Cleared to Storage Type 999 (`'X'`) |
| `DIFF_QTY` | `MENGE_D` | QUAN | 13 | 3 | Cleared Difference Quantity |
| `MESSAGE` | `BAPI_MSG` | CHAR | 220 | 0 | Return / Status Message |

Table Type: `ZWM_GI_SUBMIT_RESULT_T` (Line type `ZWM_GI_SUBMIT_RESULT`).

### 2.5 Structure `ZWM_GI_BATCH`
Structure representing available plant batches with Shelf Life Expiration Date (SLED) and bin stock.

| Field | Data Element | Data Type | Length | Decimals | Description |
|---|---|---|---|---|---|
| `MATERIAL` | `MATNR` | CHAR | 40 | 0 | Material Number |
| `PLANT` | `WERKS_D` | CHAR | 4 | 0 | Plant |
| `BATCH` | `CHARG_D` | CHAR | 10 | 0 | Batch Number |
| `EXPIRY_DATE` | `VFDAT` | DATS | 8 | 0 | Shelf Life Expiration Date (`MCHA-VFDAT`) |
| `MANUFACT_DATE` | `HSDAT` | DATS | 8 | 0 | Date of Manufacture (`MCHA-HSDAT`) |
| `AVAILABLE_STOCK` | `MENGE_D` | QUAN | 13 | 3 | Available Unrestricted Stock (`MCHB-CLABS`) |
| `UOM` | `MEINS` | UNIT | 3 | 0 | Base Unit of Measure |
| `STORAGE_BIN` | `LGPLA` | CHAR | 10 | 0 | Storage Bin from WM quant (`LQUA-LGPLA`) |
| `STATUS_STATE` | `CHAR` | CHAR | 10 | 0 | SLED Status State (`Success`, `Warning`, `Error`) |
| `STATUS_TEXT` | `CHAR` | CHAR | 20 | 0 | SLED Status Text (`VALID`, `EXPIRING SOON`, `EXPIRED`) |
| `DAYS_TO_EXPIRY` | `INT4` | INT4 | 10 | 0 | Days Remaining Until Expiry (`VFDAT - sy-datum`) |

Table Type: `ZWM_GI_BATCH_T` (Line type `ZWM_GI_BATCH`).

---

## 3. Function Group `ZWM_GI`

### 3.1 Function Module `Z_WM_GI_GET_OPEN_ITEMS`

```abap
FUNCTION z_wm_gi_get_open_items.
*"----------------------------------------------------------------------
*"*"Local Interface:
*"  IMPORTING
*"     VALUE(iv_order_no)   TYPE aufnr OPTIONAL
*"     VALUE(iv_reserv_no)  TYPE rsnum OPTIONAL
*"  EXPORTING
*"     VALUE(et_items)      TYPE zwm_gi_item_t
*"  EXCEPTIONS
*"      not_found
*"      invalid_input
*"----------------------------------------------------------------------
  DATA: lv_rsnum TYPE rsnum,
        lv_aufnr TYPE aufnr.

  CLEAR: et_items.

  " 1. Disambiguation: validate input parameters
  IF iv_order_no IS INITIAL AND iv_reserv_no IS INITIAL.
    RAISE invalid_input.
  ENDIF.

  IF iv_order_no IS NOT INITIAL.
    " Leading zeros conversion for order number
    CALL FUNCTION 'CONVERSION_EXIT_ALPHA_INPUT'
      EXPORTING
        input  = iv_order_no
      IMPORTING
        output = lv_aufnr.

    " Resolve Order Number to Reservation Number via AFKO
    SELECT SINGLE rsnum
      FROM afko
      WHERE aufnr = @lv_aufnr
      INTO @lv_rsnum.

    IF sy-subrc <> 0 OR lv_rsnum IS INITIAL.
      " Check AUFK / RESB directly
      SELECT SINGLE rsnum
        FROM resb
        WHERE aufnr = @lv_aufnr
        INTO @lv_rsnum.

      IF sy-subrc <> 0.
        RAISE not_found.
      ENDIF.
    ENDIF.
  ELSE.
    " Reservation number supplied directly
    CALL FUNCTION 'CONVERSION_EXIT_ALPHA_INPUT'
      EXPORTING
        input  = iv_reserv_no
      IMPORTING
        output = lv_rsnum.
  ENDIF.

  " 2. Query RESB for open requirements
  SELECT rsnum,
         rspos,
         aufnr,
         matnr,
         werks,
         lgort,
         charg,
         meins,
         bdmng,
         enmng
    FROM resb
    WHERE rsnum = @lv_rsnum
      AND xloek = @space     " Not deleted
      AND kzear = @space     " Final issue indicator not set
      AND bdmng > enmng      " Open quantity remaining
    ORDER BY rspos
    INTO TABLE @DATA(lt_resb).

  IF lt_resb IS INITIAL.
    RAISE not_found.
  ENDIF.

  " 3. Enrich items with descriptions and warehouse storage bins
  LOOP AT lt_resb ASSIGNING FIELD-SYMBOL(<ls_resb>).
    APPEND INITIAL LINE TO et_items ASSIGNING FIELD-SYMBOL(<ls_item>).
    <ls_item>-reserv_no     = <ls_resb>-rsnum.
    <ls_item>-reserv_item   = <ls_resb>-rspos.
    <ls_item>-order_no      = <ls_resb>-aufnr.
    <ls_item>-material      = <ls_resb>-matnr.
    <ls_item>-plant         = <ls_resb>-werks.
    <ls_item>-stge_loc      = <ls_resb>-lgort.
    <ls_item>-batch         = <ls_resb>-charg.
    <ls_item>-uom           = <ls_resb>-meins.
    <ls_item>-required_qty  = <ls_resb>-bdmng.
    <ls_item>-withdrawn_qty = <ls_resb>-enmng.
    <ls_item>-open_qty      = <ls_resb>-bdmng - <ls_resb>-enmng.

    " Material Description lookup
    SELECT SINGLE maktx
      FROM makt
      WHERE matnr = @<ls_resb>-matnr
        AND spras = @sy-langu
      INTO @<ls_item>-material_desc.

    IF sy-subrc <> 0.
      SELECT SINGLE maktx
        FROM makt
        WHERE matnr = @<ls_resb>-matnr
        INTO @<ls_item>-material_desc.
    ENDIF.

    " Storage Bin determination (LE-WM master data read from MLGN)
    SELECT SINGLE lgpla
      FROM mlgn
      WHERE matnr = @<ls_resb>-matnr
        AND lvorm = @space
      INTO @<ls_item>-bin.

    " 4. Packaging Units determination from MARM (Alternative Units of Measure)
    SELECT matnr,
           meinh,
           umrez,
           umren,
           ean11
      FROM marm
      WHERE matnr = @<ls_resb>-matnr
        AND meinh <> @<ls_resb>-meins
      INTO TABLE @DATA(lt_marm).

    LOOP AT lt_marm ASSIGNING FIELD-SYMBOL(<ls_marm>).
      APPEND INITIAL LINE TO <ls_item>-packaging_units ASSIGNING FIELD-SYMBOL(<ls_uom>).
      <ls_uom>-matnr          = <ls_marm>-matnr.
      <ls_uom>-meinh          = <ls_marm>-meinh.
      <ls_uom>-umrez          = <ls_marm>-umrez.
      <ls_uom>-umren          = <ls_marm>-umren.
      <ls_uom>-factor_to_base = <ls_marm>-umrez / <ls_marm>-umren.
      <ls_uom>-ean11          = <ls_marm>-ean11.

      " Resolve UoM description
      SELECT SINGLE mseht
        FROM t006a
        WHERE msehi = @<ls_marm>-meinh
          AND spras = @sy-langu
        INTO @<ls_uom>-meinh_txt.
      IF sy-subrc <> 0.
        <ls_uom>-meinh_txt = |{ <ls_marm>-meinh } ({ <ls_uom>-factor_to_base } { <ls_resb>-meins })|.
      ENDIF.
    ENDLOOP.

    " 5. Batch & SLED (Shelf Life Expiration Date) Determination
    IF <ls_item>-batch IS NOT INITIAL.
      SELECT SINGLE vfdat
        FROM mcha
        WHERE matnr = @<ls_resb>-matnr
          AND werks = @<ls_resb>-werks
          AND charg = @<ls_item>-batch
        INTO @<ls_item>-expiry_date.

      IF sy-subrc <> 0.
        SELECT SINGLE vfdat
          FROM mch1
          WHERE matnr = @<ls_resb>-matnr
            AND charg = @<ls_item>-batch
          INTO @<ls_item>-expiry_date.
      ENDIF.

      IF <ls_item>-expiry_date IS NOT INITIAL.
        DATA(lv_item_days) = <ls_item>-expiry_date - sy-datum.
        IF lv_item_days < 0.
          <ls_item>-batch_status_state = 'Error'.
          <ls_item>-batch_status_text  = 'EXPIRED'.
        ELSEIF lv_item_days <= 30.
          <ls_item>-batch_status_state = 'Warning'.
          <ls_item>-batch_status_text  = 'EXPIRING SOON'.
        ELSE.
          <ls_item>-batch_status_state = 'Success'.
          <ls_item>-batch_status_text  = 'VALID'.
        ENDIF.
      ENDIF.
    ENDIF.
  ENDLOOP.

ENDFUNCTION.
```

---

### 3.2 Function Module `Z_WM_GI_POST_AGAINST_ORDER`

```abap
FUNCTION z_wm_gi_post_against_order.
*"----------------------------------------------------------------------
*"*"Local Interface:
*"  IMPORTING
*"     VALUE(iv_reserv_no)   TYPE rsnum
*"     VALUE(iv_reserv_item) TYPE rspos
*"     VALUE(iv_material)    TYPE matnr
*"     VALUE(iv_issue_qty)   TYPE menge_d
*"     VALUE(iv_uom)         TYPE meins OPTIONAL
*"     VALUE(iv_batch)       TYPE charg_d OPTIONAL
*"     VALUE(iv_diff_qty)    TYPE menge_d OPTIONAL
*"     VALUE(iv_diff_reason) TYPE grund OPTIONAL
*"     VALUE(iv_diff_lgtyp)  TYPE lgtyp OPTIONAL DEFAULT '999'
*"     VALUE(iv_final_issue) TYPE kzear OPTIONAL
*"  EXPORTING
*"     VALUE(ev_matdoc)      TYPE mblnr
*"     VALUE(ev_matdoc_year) TYPE mjahr
*"     VALUE(ev_to_number)   TYPE tanum
*"     VALUE(ev_diff_cleared) TYPE abap_bool
*"     VALUE(et_return)      TYPE bapiret2_t
*"  EXCEPTIONS
*"      no_open_quantity
*"      invalid_reservation
*"      posting_error
*"      wm_to_error
*"----------------------------------------------------------------------
  DATA: ls_header   TYPE bapi2017_gm_head_01,
        ls_code     TYPE bapi2017_gm_code,
        lt_item     TYPE STANDARD TABLE OF bapi2017_gm_item_create,
        ls_item     TYPE bapi2017_gm_item_create,
        lt_return   TYPE STANDARD TABLE OF bapiret2,
        lv_mblnr    TYPE mblnr,
        lv_mjahr    TYPE mjahr,
        lv_tbnum    TYPE tbnum,
        lv_lgnum    TYPE lgnum,
        lt_trite    TYPE STANDARD TABLE OF lptri,
        ls_trite    TYPE lptri,
        lv_tanum    TYPE tanum,
        lt_conf     TYPE STANDARD TABLE OF lptci,
        ls_conf     TYPE lptci.

  CLEAR: ev_matdoc, ev_matdoc_year, ev_to_number, ev_diff_cleared, et_return.

  " 1. Re-check open quantity in database (Never trust cached screen state)
  SELECT SINGLE rsnum, rspos, matnr, werks, lgort, charg, meins, bdmng, enmng
    FROM resb
    WHERE rsnum = @iv_reserv_no
      AND rspos = @iv_reserv_item
      AND xloek = @space
    INTO @DATA(ls_resb).

  IF sy-subrc <> 0.
    RAISE invalid_reservation.
  ENDIF.

  DATA(lv_open_qty) = ls_resb-bdmng - ls_resb-enmng.
  IF lv_open_qty < iv_issue_qty OR iv_issue_qty <= 0.
    RAISE no_open_quantity.
  ENDIF.

  " 2. SLED Hard-Stop Validation: Verify batch is not expired
  DATA(lv_post_batch) = COND #( WHEN iv_batch IS NOT INITIAL THEN iv_batch ELSE ls_resb-charg ).
  IF lv_post_batch IS NOT INITIAL.
    SELECT SINGLE vfdat
      FROM mcha
      WHERE matnr = @ls_resb-matnr
        AND werks = @ls_resb-werks
        AND charg = @lv_post_batch
      INTO @DATA(lv_vfdat).

    IF sy-subrc <> 0.
      SELECT SINGLE vfdat
        FROM mch1
        WHERE matnr = @ls_resb-matnr
          AND charg = @lv_post_batch
        INTO @lv_vfdat.
    ENDIF.

    IF lv_vfdat IS NOT INITIAL AND lv_vfdat < sy-datum.
      APPEND VALUE #( type = 'E' id = 'M7' number = '667'
                      message = |Batch { lv_post_batch } has expired on { lv_vfdat DATE = USER }. Goods issue is blocked.| ) TO et_return.
      RAISE posting_error.
    ENDIF.
  ENDIF.

  " 3. Post Movement Type 261 via BAPI_GOODSMVT_CREATE
  ls_header-pstng_date = sy-datum.
  ls_header-doc_date   = sy-datum.
  ls_header-pr_uname   = sy-uname.
  ls_code-gm_code      = '03'. " MB1A - Goods Issue

  ls_item-material   = ls_resb-matnr.
  ls_item-plant      = ls_resb-werks.
  ls_item-stge_loc   = ls_resb-lgort.
  ls_item-move_type  = '261'.
  ls_item-entry_qnt  = iv_issue_qty.
  ls_item-entry_uom  = COND #( WHEN iv_uom IS NOT INITIAL THEN iv_uom ELSE ls_resb-meins ).
  ls_item-reserv_no  = iv_reserv_no.
  ls_item-res_item   = iv_reserv_item.
  ls_item-batch      = COND #( WHEN iv_batch IS NOT INITIAL THEN iv_batch ELSE ls_resb-charg ).
  " If final issue indicator set or complete short pick closeout
  IF iv_final_issue = 'X'.
    ls_item-no_more_gr = 'X'.
  ENDIF.
  APPEND ls_item TO lt_item.

  CALL FUNCTION 'BAPI_GOODSMVT_CREATE'
    EXPORTING
      goodsmvt_header  = ls_header
      goodsmvt_code    = ls_code
    IMPORTING
      materialdocument = lv_mblnr
      matdocumentyear  = lv_mjahr
    TABLES
      goodsmvt_item    = lt_item
      return           = lt_return.

  " Check BAPI outcome
  IF lv_mblnr IS INITIAL OR line_exists( lt_return[ type = 'E' ] ) OR line_exists( lt_return[ type = 'A' ] ).
    APPEND LINES OF lt_return TO et_return.
    CALL FUNCTION 'BAPI_TRANSACTION_ROLLBACK'.
    RAISE posting_error.
  ENDIF.

  ev_matdoc      = lv_mblnr.
  ev_matdoc_year = lv_mjahr.

  " 3. Read Auto-Created Transfer Requirement (TR)
  " Standard update logic creates a TR when storage location is WM-managed
  SELECT SINGLE tbnum, lgnum
    FROM ltbk
    WHERE mblnr = @lv_mblnr
      AND mjahr = @lv_mjahr
    INTO ( @lv_tbnum, @lv_lgnum ).

  " 4. Check if Immediate TO creation is already active on WM movement type (T321)
  IF lv_tbnum IS NOT INITIAL.
    " Check if TO already exists for this TR
    SELECT SINGLE tanum
      FROM ltap
      WHERE lgnum = @lv_lgnum
        AND tbnum = @lv_tbnum
      INTO @lv_tanum.

    IF sy-subrc <> 0 OR lv_tanum IS INITIAL.
      " TO was not auto-created: create it via L_TO_CREATE_TR
      CLEAR ls_trite.
      ls_trite-tbpos = '0001'.
      ls_trite-anfme = iv_issue_qty.
      ls_trite-altme = ls_item-entry_uom.
      APPEND ls_trite TO lt_trite.

      CALL FUNCTION 'L_TO_CREATE_TR'
        EXPORTING
          i_lgnum       = lv_lgnum
          i_tbnum       = lv_tbnum
          i_commit_work = space
        IMPORTING
          e_tanum       = lv_tanum
        TABLES
          t_trite       = lt_trite
        EXCEPTIONS
          no_to_created = 1
          error_message = 2
          OTHERS        = 3.

      IF sy-subrc <> 0 OR lv_tanum IS INITIAL.
        " Compensating Rollback: Cancel material document to prevent IM/WM drift
        CALL FUNCTION 'BAPI_GOODSMVT_CANCEL'
          EXPORTING
            materialdocument = lv_mblnr
            matdocumentyear  = lv_mjahr
          TABLES
            return           = lt_return.

        CALL FUNCTION 'BAPI_TRANSACTION_ROLLBACK'.
        CLEAR: ev_matdoc, ev_matdoc_year, ev_to_number.
        APPEND LINES OF lt_return TO et_return.
        RAISE wm_to_error.
      ENDIF.
    ENDIF.

    ev_to_number = lv_tanum.

    " 5. Confirm Transfer Order (Standard confirmation OR Difference Confirmation)
    IF iv_diff_qty > 0.
      " Short pick difference handling: confirm difference into storage type 999 (DIFF-CLEAR)
      CLEAR ls_conf.
      ls_conf-tanum = lv_tanum.
      ls_conf-tapos = '0001'.
      ls_conf-sista = 'X'.
      ls_conf-rdifm = iv_diff_qty.
      ls_conf-altme = ls_item-entry_uom.
      ls_conf-dityp = COND #( WHEN iv_diff_lgtyp IS NOT INITIAL THEN iv_diff_lgtyp ELSE '999' ).
      ls_conf-dipla = 'DIFF-CLEAR'.
      ls_conf-rsrsn = iv_diff_reason.
      APPEND ls_conf TO lt_conf.

      CALL FUNCTION 'L_TO_CONFIRM'
        EXPORTING
          i_lgnum               = lv_lgnum
          i_tanum               = lv_tanum
          i_commit_work         = space
        TABLES
          t_ltap_conf           = lt_conf
        EXCEPTIONS
          to_already_confirmed  = 0
          error_message         = 2
          OTHERS                = 3.

      IF sy-subrc = 0.
        ev_diff_cleared = abap_true.
      ENDIF.
    ELSE.
      CALL FUNCTION 'L_TO_CONFIRM'
        EXPORTING
          i_lgnum               = lv_lgnum
          i_tanum               = lv_tanum
          i_commit_work         = space
        EXCEPTIONS
          to_already_confirmed  = 0 " Safe to continue
          error_message         = 2
          OTHERS                = 3.
    ENDIF.

    IF sy-subrc <> 0.
      " Compensating Rollback
      CALL FUNCTION 'BAPI_GOODSMVT_CANCEL'
        EXPORTING
          materialdocument = lv_mblnr
          matdocumentyear  = lv_mjahr
        TABLES
          return           = lt_return.

      CALL FUNCTION 'BAPI_TRANSACTION_ROLLBACK'.
      CLEAR: ev_matdoc, ev_matdoc_year, ev_to_number, ev_diff_cleared.
      APPEND LINES OF lt_return TO et_return.
      RAISE wm_to_error.
    ENDIF.
  ENDIF.

  APPEND LINES OF lt_return TO et_return.

ENDFUNCTION.
```

---

### 3.3 Function Module `Z_WM_GI_SUBMIT_REQUEST`

```abap
FUNCTION z_wm_gi_submit_request.
*"----------------------------------------------------------------------
*"*"Local Interface:
*"  IMPORTING
*"     VALUE(iv_reserv_no)  TYPE rsnum OPTIONAL
*"     VALUE(iv_order_no)   TYPE aufnr OPTIONAL
*"     VALUE(it_items)      TYPE zwm_gi_submit_item_t
*"  EXPORTING
*"     VALUE(ev_all_posted) TYPE abap_bool
*"     VALUE(et_results)    TYPE zwm_gi_submit_result_t
*"     VALUE(et_return)     TYPE bapiret2_t
*"----------------------------------------------------------------------
  TYPES: BEGIN OF ty_posted_doc,
           mblnr TYPE mblnr,
           mjahr TYPE mjahr,
         END OF ty_posted_doc.

  DATA: lt_posted_docs TYPE STANDARD TABLE OF ty_posted_doc,
        ls_posted_doc  TYPE ty_posted_doc,
        lv_has_error   TYPE abap_bool VALUE abap_false,
        lt_cancel_ret  TYPE STANDARD TABLE OF bapiret2,
        lv_rsnum       TYPE rsnum.

  CLEAR: ev_all_posted, et_results, et_return.
  ev_all_posted = abap_true.

  " Resolve reservation number if order number was passed
  IF iv_reserv_no IS NOT INITIAL.
    lv_rsnum = iv_reserv_no.
  ELSEIF iv_order_no IS NOT INITIAL.
    SELECT SINGLE rsnum FROM afko WHERE aufnr = @iv_order_no INTO @lv_rsnum.
    IF sy-subrc <> 0.
      SELECT SINGLE rsnum FROM resb WHERE aufnr = @iv_order_no INTO @lv_rsnum.
    ENDIF.
  ENDIF.

  IF lv_rsnum IS INITIAL.
    ev_all_posted = abap_false.
    APPEND VALUE #( type = 'E' id = 'M7' number = '001'
                    message = 'Unable to resolve Order or Reservation number.' ) TO et_return.
    RETURN.
  ENDIF.

  " Execute all lines in a single LUW (no COMMIT WORK between lines)
  LOOP AT it_items ASSIGNING FIELD-SYMBOL(<ls_item>).
    DATA(ls_result) = VALUE zwm_gi_submit_result(
      reserv_item = <ls_item>-reserv_item
    ).

    CALL FUNCTION 'Z_WM_GI_POST_AGAINST_ORDER'
      EXPORTING
        iv_reserv_no        = lv_rsnum
        iv_reserv_item      = <ls_item>-reserv_item
        iv_material         = <ls_item>-material
        iv_issue_qty        = <ls_item>-issue_qty
        iv_batch            = <ls_item>-batch
        iv_diff_qty         = <ls_item>-diff_qty
        iv_diff_reason      = <ls_item>-diff_reason
        iv_diff_lgtyp       = <ls_item>-diff_lgtyp
        iv_final_issue      = <ls_item>-final_issue
      IMPORTING
        ev_matdoc           = ls_result-matdoc
        ev_matdoc_year      = ls_result-matdoc_year
        ev_to_number        = ls_result-to_number
        ev_diff_cleared     = ls_result-diff_cleared
      TABLES
        et_return           = et_return
      EXCEPTIONS
        no_open_quantity    = 1
        invalid_reservation = 2
        posting_error       = 3
        wm_to_error         = 4
        OTHERS              = 5.

    IF sy-subrc = 0 AND ls_result-matdoc IS NOT INITIAL.
      ls_result-diff_qty = <ls_item>-diff_qty.
      ls_result-message = |Posted successfully. MatDoc: { ls_result-matdoc }, TO: { ls_result-to_number }.|.
      APPEND VALUE #( mblnr = ls_result-matdoc mjahr = ls_result-matdoc_year ) TO lt_posted_docs.
    ELSE.
      lv_has_error = abap_true.
      ls_result-message = |Failed to post item { <ls_item>-reserv_item }. Error code: { sy-subrc }.|.
      APPEND ls_result TO et_results.
      EXIT.
    ENDIF.

    APPEND ls_result TO et_results.
  ENDLOOP.

  " If any line failed, rollback all previously posted documents
  IF lv_has_error = abap_true.
    ev_all_posted = abap_false.

    LOOP AT lt_posted_docs INTO ls_posted_doc.
      CALL FUNCTION 'BAPI_GOODSMVT_CANCEL'
        EXPORTING
          materialdocument = ls_posted_doc-mblnr
          matdocumentyear  = ls_posted_doc-mjahr
        TABLES
          return           = lt_cancel_ret.
      APPEND LINES OF lt_cancel_ret TO et_return.
    ENDLOOP.

    CALL FUNCTION 'BAPI_TRANSACTION_ROLLBACK'.
  ELSE.
    " All lines posted successfully: single commit
    CALL FUNCTION 'BAPI_TRANSACTION_COMMIT'
      EXPORTING
        wait = abap_true.
  ENDIF.

ENDFUNCTION.
```

---

### 3.4 Function Module `Z_WM_GI_GET_BATCHES`

```abap
FUNCTION z_wm_gi_get_batches.
*"----------------------------------------------------------------------
*"*"Local Interface:
*"  IMPORTING
*"     VALUE(iv_material)   TYPE matnr
*"     VALUE(iv_plant)      TYPE werks_d
*"     VALUE(iv_stge_loc)   TYPE lgort_d OPTIONAL
*"  EXPORTING
*"     VALUE(et_batches)    TYPE zwm_gi_batch_t
*"  EXCEPTIONS
*"      no_batches_found
*"----------------------------------------------------------------------
  DATA: lv_matnr TYPE matnr,
        lv_werks TYPE werks_d.

  CLEAR: et_batches.

  CALL FUNCTION 'CONVERSION_EXIT_MATN1_INPUT'
    EXPORTING
      input  = iv_material
    IMPORTING
      output = lv_matnr.

  lv_werks = iv_plant.

  " 1. Query Batch Master (MCHA) joined with Batch Stocks (MCHB)
  SELECT a~matnr,
         a~werks,
         a~charg,
         a~vfdat,
         a~hsdat,
         b~clabs,
         b~lgort,
         c~meins
    FROM mcha AS a
    INNER JOIN mchb AS b
      ON  b~matnr = a~matnr
      AND b~werks = a~werks
      AND b~charg = a~charg
    INNER JOIN mara AS c
      ON  c~matnr = a~matnr
    WHERE a~matnr = @lv_matnr
      AND a~werks = @lv_werks
      AND ( @iv_stge_loc IS INITIAL OR b~lgort = @iv_stge_loc )
      AND b~clabs > 0
    INTO TABLE @DATA(lt_batches).

  IF lt_batches IS INITIAL.
    RAISE no_batches_found.
  ENDIF.

  " 2. Calculate SLED Days and Determine Status Classification
  LOOP AT lt_batches ASSIGNING FIELD-SYMBOL(<ls_b>).
    APPEND INITIAL LINE TO et_batches ASSIGNING FIELD-SYMBOL(<ls_out>).
    <ls_out>-material        = <ls_b>-matnr.
    <ls_out>-plant           = <ls_b>-werks.
    <ls_out>-batch           = <ls_b>-charg.
    <ls_out>-expiry_date     = <ls_b>-vfdat.
    <ls_out>-manufact_date   = <ls_b>-hsdat.
    <ls_out>-available_stock = <ls_b>-clabs.
    <ls_out>-uom             = <ls_b>-meins.

    " Lookup Storage Bin from WM quant (LQUA)
    SELECT SINGLE lgpla
      FROM lqua
      WHERE matnr = @<ls_b>-matnr
        AND werks = @<ls_b>-werks
        AND charg = @<ls_b>-charg
        AND verme > 0
      INTO @<ls_out>-storage_bin.

    IF <ls_out>-storage_bin IS INITIAL.
      SELECT SINGLE lgpla FROM mlgn WHERE matnr = @<ls_b>-matnr INTO @<ls_out>-storage_bin.
    ENDIF.

    " SLED Calculation: Days to Expiry against sy-datum
    IF <ls_b>-vfdat IS NOT INITIAL.
      <ls_out>-days_to_expiry = <ls_b>-vfdat - sy-datum.
      IF <ls_out>-days_to_expiry < 0.
        <ls_out>-status_state = 'Error'.
        <ls_out>-status_text  = 'EXPIRED'.
      ELSEIF <ls_out>-days_to_expiry <= 30.
        <ls_out>-status_state = 'Warning'.
        <ls_out>-status_text  = 'EXPIRING SOON'.
      ELSE.
        <ls_out>-status_state = 'Success'.
        <ls_out>-status_text  = 'VALID'.
      ENDIF.
    ELSE.
      <ls_out>-status_state   = 'None'.
      <ls_out>-status_text    = 'NO SLED'.
      <ls_out>-days_to_expiry = 9999.
    ENDIF.
  ENDLOOP.

  " 3. FEFO Sort (First Expired, First Out): nearest expiry date first
  SORT et_batches BY expiry_date ASCENDING available_stock DESCENDING.

ENDFUNCTION.
```

---

## 4. RAP & CDS OData V4 Service

### 4.1 CDS View `ZI_GI_ITEM`

```abap
@AccessControl.authorizationCheck: #CHECK
@EndUserText.label: 'Goods Issue Open Items'
define root view entity ZI_GI_ITEM
  as select from resb
  association [0..1] to makt on makt.matnr = resb.matnr and makt.spras = $session.system_language
  association [0..1] to mcha on mcha.matnr = resb.matnr and mcha.werks = resb.werks and mcha.charg = resb.charg
{
  key rsnum             as ReservationNo,
  key rspos             as ReservationItem,
      aufnr             as OrderNo,
      matnr             as Material,
      makt.maktx        as MaterialDesc,
      werks             as Plant,
      lgort             as StorageLocation,
      charg             as Batch,
      mcha.vfdat        as ExpiryDate,
      meins             as Unit,
      bdmng             as RequiredQty,
      enmng             as WithdrawnQty,
      ( bdmng - enmng ) as OpenQty
}
where bdmng > enmng
  and xloek = ''
  and kzear = ''
```

### 4.2 CDS View `ZI_GI_BATCH`

```abap
@AccessControl.authorizationCheck: #CHECK
@EndUserText.label: 'Material Batches with SLED'
define view entity ZI_GI_BATCH
  as select from mcha
  inner join mchb on mchb.matnr = mcha.matnr and mchb.werks = mcha.werks and mchb.charg = mcha.charg
{
  key mcha.matnr   as Material,
  key mcha.werks   as Plant,
  key mcha.charg   as Batch,
      mcha.vfdat   as ExpiryDate,
      mcha.hsdat   as ManufactDate,
      mchb.clabs   as AvailableStock,
      mchb.lgort   as StorageLocation
}
```

### 4.3 Service Definition `ZUI_GI_ORDER_RSV_O4`

```abap
@EndUserText.label: 'Goods Issue against Order / Reservation OData V4'
define service ZUI_GI_ORDER_RSV_O4 {
  expose ZI_GI_ITEM  as GIItem;
  expose ZI_GI_BATCH as MaterialBatch;
}
```

### 4.4 Behavior Definition `ZI_GI_ITEM`

```abap
unmanaged implementation in class zbp_i_gi_item unique;
strict ( 2 );

define behavior for ZI_GI_ITEM alias GIItem
{
  // Bound action for single-item immediate issue
  action postGoodsIssue parameter ZA_GI_POST result [1] $self;

  // Unbound batch action for full request submission
  static action submitRequest parameter ZA_GI_SUBMIT_PARAM result [1] ZA_GI_SUBMIT_RESULT;
}
```

---

## 5. ITSmobile / Dynpro Screen Flow (Zebra RF Handhelds)

- **Screen 100 (Header & Selection)**:
  - Input field: `GS_SCREEN-SCAN_INPUT` (Barcode scanner input for Order or Reservation).
  - PBO: Sets cursor on scan input field.
  - PAI on `ENTER`: Calls `Z_WM_GI_GET_OPEN_ITEMS`.
    - If items returned: populates Table Control `TC_ITEMS` and transitions to Screen 200.
    - If error: displays message in status bar (`sy-msgty = 'E'`).
- **Screen 200 (Item Processing & Tallying)**:
  - Displays selected component, required qty, open qty, storage bin.
  - Input field: `GS_SCREEN-BARCODE_SCAN` (Material or packaging scan).
  - PAI on scan: verifies material match, increments tallied quantity.
  - Function Code `POST`: calls `Z_WM_GI_POST_AGAINST_ORDER` or `Z_WM_GI_SUBMIT_REQUEST`.
  - On success: plays success tone (`SET PROPERTY OF ...` or ITSmobile HTML audio element) and clears inputs.

---

## 6. Required Security & Authorization Objects

| Object | Field | Values | Purpose |
|---|---|---|---|
| `M_MSEG_WMB` | `ACTVT`, `BWART`, `WERKS` | `01` (Create), `261`, Plant ID | Authorizes goods issue movement 261 |
| `L_TCODE` | `TCD` | `LT01`, `LT12` | Authorizes Transfer Order creation and confirmation |
| `M_MATE_STA` | `ACTVT`, `STATM` | `03` (Display), `E`, `L` | Allows reading material master views |
