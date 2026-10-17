# Technical Specification & ABAP Implementation: Gateway Service ZWM_RF_TRTO_SRV

## 1. Executive Summary & Architecture

This document provides the authoritative architectural specification and complete ABAP source code for the SAP Gateway OData service **`ZWM_RF_TRTO_SRV`** in SAP S/4HANA (DS4 Client 220).

### 1.1 Architecture & Flow

```text
+-------------------------------------------------------------+
|               SAP Fiori / Mobile RF Screen                  |
|  [TR / ProdOrder Input] -> [Scan SU Barcode] -> [Create TO] |
+-------------------------------------------------------------+
                               |
                               | OData V2 (HTTP / JSON)
                               v
+-------------------------------------------------------------+
|             SAP Gateway Service: ZWM_RF_TRTO_SRV            |
|                     (/sap/opu/odata/sap/)                   |
|                                                             |
|  +-------------------+  +-----------------+  +------------+ |
|  |    TRHeaderSet    |  | StorageUnitSet  |  |  CreateTO  | |
|  |     TRItemSet     |  |   SUQuantSet    |  |  (Action)  | |
|  +-------------------+  +-----------------+  +------------+ |
+-------------------------------------------------------------+
                               |
                               | ABAP OpenSQL & RFC Function Modules
                               v
+-------------------------------------------------------------+
|                 S/4HANA Warehouse Backend                   |
|  * Z_WM_GET_TR_MATERIAL_LIST (LTBK / LTBP + MAKT)           |
|  * Z_WM_GET_SU_DETAILS (LEIN / LQUA Quant Validation)       |
|  * ZWM_TO_CREATE_FROM_TR (L_TO_CREATE_TR + L_TO_CONFIRM)   |
|  * SAP Standard LE-WM Tables: LTBK, LTBP, LEIN, LQUA, LTAK  |
+-------------------------------------------------------------+
```

### 1.2 Entity & Operation Mapping Matrix

| Entity / Function | HTTP Method | Underlying ABAP Call / Source | Screen Target & Business Purpose |
|---|---|---|---|
| `TRHeaderSet(Lgnum,Tbnum)` | `GET` | `Z_WM_GET_TR_MATERIAL_LIST` / `LTBK` | **TR Input**: Validates TR / Production Order / Reservation and retrieves header metadata. |
| `TRHeaderSet(...) -> ToItems` | `GET` (Nav) | `LTBP` joined with `MAKT` | **TR Items**: Feeds table/carousel of items to pick. |
| `TRItemSet` | `GET` | `LTBP` + `MAKT` | **Item Fields**: Material (`Mate`), Description (`Desc`), Batch (`Batc`), Open Qty (`OQty = MENGE - TAMEN`). |
| `StorageUnitSet?$filter=...` | `GET` | `Z_WM_GET_SU_DETAILS` (new FM) | **SU Scan & Check**: Scans SU barcode (`LENUM`), validates quant stock and match against TR; returns validation status & error message. |
| `SUQuantSet` (under SU) | `GET` (Nav) | `LQUA` | **Quant Stock**: Scanned quantity (`SQty = VERME`), Batch (`CHARG`), Storage Bin (`LGPLA`). |
| `CreateTO` | `POST` | `ZWM_TO_CREATE_FROM_TR` | **Create Button**: Executes `L_TO_CREATE_TR` (and optional 1-step `L_TO_CONFIRM`); returns generated TO number (`TANUM`) or error. |

---

## 2. ABAP Data Dictionary (DDIC) Definitions

### 2.1 Structure `ZWM_S_TR_HEADER` (TR Header Entity)

| Field | Component Type | Data Type | Length | Description |
|---|---|---|---|---|
| `LGNUM` | `LGNUM` | CHAR | 3 | Warehouse Number (e.g. `'W01'`) |
| `TBNUM` | `TBNUM` | CHAR | 10 | Transfer Requirement Number (Key) |
| `BWLVS` | `BWLVS` | CHAR | 3 | Movement Type (e.g. `'319'`, `'101'`) |
| `BETYP` | `BETYP` | CHAR | 1 | Requirement Type (`'P'`-ProdOrder, `'D'`-MatDoc, `'R'`-Reservation) |
| `BENUM` | `BENUM` | CHAR | 10 | Requirement Number (Production Order / PO / Doc No) |
| `RSNUM` | `RSNUM` | NUMC | 10 | Reservation Number |
| `BDATU` | `BDATU` | DATS | 8 | Requirement Date |
| `STATU` | `TBSTA` | CHAR | 1 | TR Processing Status (`''`=Open, `'E'`=Closed, `'T'`=Partial) |
| `VLTYP` | `LTAP_VLTYP` | CHAR | 3 | Source Storage Type |
| `VLPLA` | `LTAP_VLPLA` | CHAR | 10 | Source Storage Bin |
| `NLTYP` | `LTAP_NLTYP` | CHAR | 3 | Destination Storage Type |
| `NLPLA` | `LTAP_NLPLA` | CHAR | 10 | Destination Storage Bin |
| `BNAME` | `XUBNAME` | CHAR | 12 | User who created requirement |

### 2.2 Structure `ZWM_S_TR_ITEM` (TR Item Entity)

| Field | Component Type | Data Type | Length | Decimals | Description |
|---|---|---|---|---|---|
| `LGNUM` | `LGNUM` | CHAR | 3 | 0 | Warehouse Number |
| `TBNUM` | `TBNUM` | CHAR | 10 | 0 | Transfer Requirement Number |
| `TBPOS` | `TBPOS` | NUMC | 4 | 0 | Transfer Requirement Item |
| `MATNR` | `MATNR` | CHAR | 40 | 0 | Material Number (`Mate`) |
| `MAKTX` | `MAKTX` | CHAR | 40 | 0 | Material Description (`Desc`) |
| `WERKS` | `WERKS_D` | CHAR | 4 | 0 | Plant |
| `LGORT` | `LGORT_D` | CHAR | 4 | 0 | Storage Location |
| `CHARG` | `CHARG_D` | CHAR | 10 | 0 | Batch Number (`Batc`) |
| `MENGE` | `MENGE_D` | QUAN | 13 | 3 | Requested Quantity |
| `TAMEN` | `TAMEN` | QUAN | 13 | 3 | Quantity Processed |
| `OPEN_QTY` | `MENGE_D` | QUAN | 13 | 3 | Open Quantity (`OQty = MENGE - TAMEN`) |
| `MEINS` | `MEINS` | UNIT | 3 | 0 | Base Unit of Measure |
| `ELIKZ` | `ELIKZ` | CHAR | 1 | 0 | Delivery Completed Indicator |
| `NLTYP` | `LTAP_NLTYP` | CHAR | 3 | 0 | Destination Storage Type |
| `NLPLA` | `LTAP_NLPLA` | CHAR | 10 | 0 | Destination Storage Bin |

### 2.3 Structure `ZWM_S_SU_HEADER` (Storage Unit Header Entity)

| Field | Component Type | Data Type | Length | Description |
|---|---|---|---|---|
| `LGNUM` | `LGNUM` | CHAR | 3 | Warehouse Number |
| `LENUM` | `LENUM` | CHAR | 20 | Storage Unit Number (Barcode scan) |
| `TBNUM` | `TBNUM` | CHAR | 10 | Transfer Requirement Context |
| `LGTYP` | `LGTYP` | CHAR | 3 | Current Storage Type |
| `LGPLA` | `LGPLA` | CHAR | 10 | Current Storage Bin |
| `LETYP` | `LVS_LETYP` | CHAR | 3 | Storage Unit Type (e.g. `'E3'`) |
| `STATU` | `LEIN_STATU` | CHAR | 1 | SU Status |
| `IS_VALID` | `BOOLE_D` | CHAR | 1 | Validation Result (`'X'` or `''`) |
| `ERROR_CODE` | `CHAR20` | CHAR | 20 | Machine-readable error code |
| `ERROR_MESSAGE` | `BAPI_MSG` | CHAR | 220 | Human-readable validation feedback |

### 2.4 Structure `ZWM_S_SU_QUANT` (Storage Unit Quant Entity)

| Field | Component Type | Data Type | Length | Decimals | Description |
|---|---|---|---|---|---|
| `LGNUM` | `LGNUM` | CHAR | 3 | 0 | Warehouse Number |
| `LQNUM` | `LQNUM` | NUMC | 10 | 0 | Quant Number |
| `LENUM` | `LENUM` | CHAR | 20 | 0 | Storage Unit Number |
| `MATNR` | `MATNR` | CHAR | 40 | 0 | Material Number |
| `MAKTX` | `MAKTX` | CHAR | 40 | 0 | Material Description |
| `WERKS` | `WERKS_D` | CHAR | 4 | 0 | Plant |
| `LGORT` | `LGORT_D` | CHAR | 4 | 0 | Storage Location |
| `CHARG` | `CHARG_D` | CHAR | 10 | 0 | Batch Number |
| `VERME` | `LQUA_VERME` | QUAN | 13 | 3 | Available Stock (`SQty = VERME`) |
| `MEINS` | `MEINS` | UNIT | 3 | 0 | Unit of Measure |
| `LGTYP` | `LGTYP` | CHAR | 3 | 0 | Storage Type |
| `LGPLA` | `LGPLA` | CHAR | 10 | 0 | Storage Bin |

### 2.5 Structure `ZWM_S_TO_CONFIRM` (Function Import Result)

| Field | Component Type | Data Type | Length | Description |
|---|---|---|---|---|
| `TANUM` | `TANUM` | NUMC | 10 | Transfer Order Number |
| `SUCCESS` | `BAPI_MTYPE` | CHAR | 1 | Return Status (`'S'`, `'E'`) |
| `MESSAGE` | `BAPI_MSG` | CHAR | 220 | Status Message |
| `CONFIRMED` | `BOOLE_D` | CHAR | 1 | Immediate Confirmation Status (`'X'`, `''`) |

---

## 3. ABAP Source Code: New RFC Function Module `Z_WM_GET_SU_DETAILS`

This function module implements the exact SU validation logic established in custom RF program `SAPMZWM_E_001_F01` (`FORM validate`). It validates a scanned SU against a specific TR, ensuring:
1. The SU exists in `LEIN`.
2. Active quants exist in `LQUA` with positive stock (`VERME > 0`).
3. The material on the SU matches the requested components of the TR (`LTBP`).
4. Calculates available stock and flags any errors.

Place inside Function Group **`Z_WM_TR_SERVICES`**:

```abap
FUNCTION z_wm_get_su_details
  IMPORTING
    VALUE(iv_lgnum) TYPE lgnum DEFAULT 'W01'
    VALUE(iv_lenum) TYPE lenum
    VALUE(iv_tbnum) TYPE ltbk-tbnum OPTIONAL
  EXPORTING
    VALUE(es_su_header) TYPE zwm_s_su_header
    VALUE(et_su_quants) TYPE zwm_tt_su_quant
    VALUE(ev_is_valid)  TYPE boole_d
    VALUE(ev_error_code) TYPE char20
    VALUE(ev_message)   TYPE bapi_msg.

  DATA: lv_lenum TYPE lenum,
        lv_tbnum TYPE ltbk-tbnum,
        lt_ltbp  TYPE TABLE OF ltbp,
        ls_lein  TYPE lein,
        lt_lqua  TYPE TABLE OF lqua,
        ls_quant TYPE zwm_s_su_quant.

  CLEAR: es_su_header, et_su_quants, ev_is_valid, ev_error_code, ev_message.

  " 1. Normalize SU and TR numbers with leading zeros (ALPHA conversion)
  lv_lenum = |{ iv_lenum ALPHA = IN }|.
  IF iv_tbnum IS NOT INITIAL.
    lv_tbnum = |{ iv_tbnum ALPHA = IN }|.
  ENDIF.

  es_su_header-lgnum = iv_lgnum.
  es_su_header-lenum = lv_lenum.
  es_su_header-tbnum = lv_tbnum.

  " 2. Verify Storage Unit existence in LEIN
  SELECT SINGLE *
    FROM lein
    INTO @ls_lein
   WHERE lgnum = @iv_lgnum
     AND lenum = @lv_lenum.

  IF sy-subrc <> 0.
    ev_is_valid    = abap_false.
    ev_error_code  = 'SU_NOT_FOUND'.
    ev_message     = |Storage Unit { lv_lenum ALPHA = OUT } not found in warehouse { iv_lgnum }.|.
    es_su_header-is_valid      = ev_is_valid.
    es_su_header-error_code    = ev_error_code.
    es_su_header-error_message = ev_message.
    RETURN.
  ENDIF.

  es_su_header-lgtyp = ls_lein-lgtyp.
  es_su_header-lgpla = ls_lein-lgpla.
  es_su_header-letyp = ls_lein-letyp.
  es_su_header-statu = ls_lein-statu.

  " 3. Fetch quants for this Storage Unit from LQUA
  SELECT *
    FROM lqua
    INTO TABLE @lt_lqua
   WHERE lgnum = @iv_lgnum
     AND lenum = @lv_lenum
     AND verme > 0.

  IF lt_lqua IS INITIAL.
    ev_is_valid    = abap_false.
    ev_error_code  = 'NO_STOCK'.
    ev_message     = |Storage Unit { lv_lenum ALPHA = OUT } has no available stock (empty or locked).|.
    es_su_header-is_valid      = ev_is_valid.
    es_su_header-error_code    = ev_error_code.
    es_su_header-error_message = ev_message.
    RETURN.
  ENDIF.

  " 4. If TR is provided, validate that SU material matches the TR items
  IF lv_tbnum IS NOT INITIAL.
    SELECT *
      FROM ltbp
      INTO TABLE @lt_ltbp
     WHERE lgnum = @iv_lgnum
       AND tbnum = @lv_tbnum
       AND elikz = ''.

    IF sy-subrc <> 0.
      ev_is_valid    = abap_false.
      ev_error_code  = 'TR_COMPLETED'.
      ev_message     = |Transfer Requirement { lv_tbnum ALPHA = OUT } has no open items.|.
      es_su_header-is_valid      = ev_is_valid.
      es_su_header-error_code    = ev_error_code.
      es_su_header-error_message = ev_message.
      RETURN.
    ENDIF.

    " Check if at least one quant on the SU matches a material on the open TR
    DATA(lv_mat_matched) = abap_false.
    LOOP AT lt_lqua INTO DATA(ls_lqua).
      IF line_exists( lt_ltbp[ matnr = ls_lqua-matnr werks = ls_lqua-werks ] ).
        lv_mat_matched = abap_true.
        EXIT.
      ENDIF.
    ENDLOOP.

    IF lv_mat_matched = abap_false.
      ev_is_valid    = abap_false.
      ev_error_code  = 'MATERIAL_MISMATCH'.
      ev_message     = |Material on SU { lv_lenum ALPHA = OUT } does not match any open component on TR { lv_tbnum ALPHA = OUT }.|.
      es_su_header-is_valid      = ev_is_valid.
      es_su_header-error_code    = ev_error_code.
      es_su_header-error_message = ev_message.
      RETURN.
    ENDIF.
  ENDIF.

  " 5. Populate Quant Entity Set with Material Descriptions from MAKT
  LOOP AT lt_lqua INTO DATA(ls_lq).
    CLEAR ls_quant.
    MOVE-CORRESPONDING ls_lq TO ls_quant.

    SELECT SINGLE maktx
      FROM makt
      INTO @ls_quant-maktx
     WHERE matnr = @ls_lq-matnr
       AND spras = @sy-langu.

    APPEND ls_quant TO et_su_quants.
  ENDLOOP.

  " 6. All checks passed
  ev_is_valid    = abap_true.
  ev_error_code  = 'VALID'.
  ev_message     = |Storage Unit { lv_lenum ALPHA = OUT } verified successfully in bin { ls_lein-lgpla }.|.
  es_su_header-is_valid      = ev_is_valid.
  es_su_header-error_code    = ev_error_code.
  es_su_header-error_message = ev_message.

ENDFUNCTION.
```

---

## 4. SAP Gateway Data Provider Class (`ZCL_ZWM_RF_TRTO_DPC_EXT`)

Below is the complete ABAP implementation for the Gateway service DPC extension class:

```abap
CLASS zcl_zwm_rf_trto_dpc_ext DEFINITION
  PUBLIC
  INHERITING FROM zcl_zwm_rf_trto_dpc
  CREATE PUBLIC .

  PUBLIC SECTION.
  PROTECTED SECTION.
    " EntitySet & Entity implementations
    METHODS trheaderset_get_entity
      REDEFINITION .
    METHODS trheaderset_get_entityset
      REDEFINITION .
    METHODS tritemset_get_entity
      REDEFINITION .
    METHODS tritemset_get_entityset
      REDEFINITION .
    METHODS storageunitset_get_entity
      REDEFINITION .
    METHODS storageunitset_get_entityset
      REDEFINITION .
    METHODS suquantset_get_entityset
      REDEFINITION .

    " Function Import implementation
    METHODS /iwbep/if_mgw_appl_srv_runtime~execute_action
      REDEFINITION .

  PRIVATE SECTION.
ENDCLASS.

CLASS zcl_zwm_rf_trto_dpc_ext IMPLEMENTATION.

* ----------------------------------------------------------------------
* 1. TRHEADERSET_GET_ENTITY: Read single TR Header
* ----------------------------------------------------------------------
  METHOD trheaderset_get_entity.
    DATA: lv_lgnum TYPE lgnum,
          lv_tbnum TYPE ltbk-tbnum,
          ls_hdr   TYPE ltbk.

    io_tech_request_context->get_converted_keys(
      IMPORTING es_key_values = DATA(ls_keys) ).

    lv_lgnum = VALUE #( ls_keys[ name = 'LGNUM' ]-value OPTIONAL ).
    lv_tbnum = VALUE #( ls_keys[ name = 'TBNUM' ]-value OPTIONAL ).

    IF lv_lgnum IS INITIAL. lv_lgnum = 'W01'. ENDIF.
    lv_tbnum = |{ lv_tbnum ALPHA = IN }|.

    SELECT SINGLE *
      FROM ltbk
      INTO @ls_hdr
     WHERE lgnum = @lv_lgnum
       AND tbnum = @lv_tbnum.

    IF sy-subrc <> 0.
      RAISE EXCEPTION TYPE /iwbep/cx_mgw_busi_exception
        EXPORTING
          textid  = /iwbep/cx_mgw_busi_exception=>business_error
          message = |TR { lv_tbnum ALPHA = OUT } not found in warehouse { lv_lgnum }.|.
    ENDIF.

    MOVE-CORRESPONDING ls_hdr TO er_entity.
  ENDMETHOD.

* ----------------------------------------------------------------------
* 2. TRHEADERSET_GET_ENTITYSET: Query TR Headers by TR, ProdOrder, or Date
* ----------------------------------------------------------------------
  METHOD trheaderset_get_entityset.
    DATA: lv_lgnum TYPE lgnum DEFAULT 'W01',
          lv_tbnum TYPE ltbk-tbnum,
          lv_benum TYPE ltbk-benum,
          lt_ltbk  TYPE TABLE OF ltbk.

    DATA(lt_filter) = io_tech_request_context->get_filter( )->get_filter_select_options( ).

    " Extract filters
    READ TABLE lt_filter WITH KEY property = 'LGNUM' INTO DATA(ls_lgnum_flt).
    IF sy-subrc = 0 AND ls_lgnum_flt-select_options IS NOT INITIAL.
      lv_lgnum = ls_lgnum_flt-select_options[ 1 ]-low.
    ENDIF.

    READ TABLE lt_filter WITH KEY property = 'TBNUM' INTO DATA(ls_tbnum_flt).
    IF sy-subrc = 0 AND ls_tbnum_flt-select_options IS NOT INITIAL.
      lv_tbnum = |{ ls_tbnum_flt-select_options[ 1 ]-low ALPHA = IN }|.
    ENDIF.

    READ TABLE lt_filter WITH KEY property = 'BENUM' INTO DATA(ls_benum_flt).
    IF sy-subrc = 0 AND ls_benum_flt-select_options IS NOT INITIAL.
      lv_benum = |{ ls_benum_flt-select_options[ 1 ]-low ALPHA = IN }|.
    ENDIF.

    SELECT *
      FROM ltbk
      INTO TABLE @lt_ltbk
     WHERE lgnum = @lv_lgnum
       AND ( tbnum = @lv_tbnum OR @lv_tbnum IS INITIAL )
       AND ( benum = @lv_benum OR @lv_benum IS INITIAL )
       AND statu <> 'E'
     ORDER BY tbnum DESCENDING.

    LOOP AT lt_ltbk INTO DATA(ls_hdr).
      APPEND INITIAL LINE TO et_entityset ASSIGNING FIELD-SYMBOL(<fs_out>).
      MOVE-CORRESPONDING ls_hdr TO <fs_out>.
    ENDLOOP.
  ENDMETHOD.

* ----------------------------------------------------------------------
* 3. TRITEMSET_GET_ENTITY: Read single TR Item
* ----------------------------------------------------------------------
  METHOD tritemset_get_entity.
    DATA: lv_lgnum TYPE lgnum,
          lv_tbnum TYPE ltbk-tbnum,
          lv_tbpos TYPE ltbp-tbpos,
          ls_item  TYPE ltbp.

    io_tech_request_context->get_converted_keys(
      IMPORTING es_key_values = DATA(ls_keys) ).

    lv_lgnum = VALUE #( ls_keys[ name = 'LGNUM' ]-value OPTIONAL ).
    lv_tbnum = VALUE #( ls_keys[ name = 'TBNUM' ]-value OPTIONAL ).
    lv_tbpos = VALUE #( ls_keys[ name = 'TBPOS' ]-value OPTIONAL ).

    IF lv_lgnum IS INITIAL. lv_lgnum = 'W01'. ENDIF.
    lv_tbnum = |{ lv_tbnum ALPHA = IN }|.

    SELECT SINGLE *
      FROM ltbp
      INTO @ls_item
     WHERE lgnum = @lv_lgnum
       AND tbnum = @lv_tbnum
       AND tbpos = @lv_tbpos.

    IF sy-subrc <> 0.
      RAISE EXCEPTION TYPE /iwbep/cx_mgw_busi_exception
        EXPORTING
          textid  = /iwbep/cx_mgw_busi_exception=>business_error
          message = |Item { lv_tbpos } of TR { lv_tbnum ALPHA = OUT } not found.|.
    ENDIF.

    MOVE-CORRESPONDING ls_item TO er_entity.
    er_entity-open_qty = ls_item-menge - ls_item-tamen.

    SELECT SINGLE maktx FROM makt INTO @er_entity-maktx
     WHERE matnr = @ls_item-matnr AND spras = @sy-langu.
  ENDMETHOD.

* ----------------------------------------------------------------------
* 4. TRITEMSET_GET_ENTITYSET: Read Items for a TR
* ----------------------------------------------------------------------
  METHOD tritemset_get_entityset.
    DATA: lv_lgnum TYPE lgnum DEFAULT 'W01',
          lv_tbnum TYPE ltbk-tbnum,
          lt_ltbp  TYPE TABLE OF ltbp.

    " Support navigation from TRHeaderSet('W01', '0001000663')/ToItems
    DATA(lt_nav_keys) = io_tech_request_context->get_source_keys( ).
    IF lt_nav_keys IS NOT INITIAL.
      lv_lgnum = VALUE #( lt_nav_keys[ name = 'LGNUM' ]-value DEFAULT 'W01' ).
      lv_tbnum = VALUE #( lt_nav_keys[ name = 'TBNUM' ]-value OPTIONAL ).
    ELSE.
      DATA(lt_filter) = io_tech_request_context->get_filter( )->get_filter_select_options( ).
      READ TABLE lt_filter WITH KEY property = 'TBNUM' INTO DATA(ls_tb_flt).
      IF sy-subrc = 0 AND ls_tb_flt-select_options IS NOT INITIAL.
        lv_tbnum = ls_tb_flt-select_options[ 1 ]-low.
      ENDIF.
    ENDIF.

    lv_tbnum = |{ lv_tbnum ALPHA = IN }|.

    SELECT *
      FROM ltbp
      INTO TABLE @lt_ltbp
     WHERE lgnum = @lv_lgnum
       AND tbnum = @lv_tbnum
     ORDER BY tbpos ASCENDING.

    LOOP AT lt_ltbp INTO DATA(ls_item).
      APPEND INITIAL LINE TO et_entityset ASSIGNING FIELD-SYMBOL(<fs_out>).
      MOVE-CORRESPONDING ls_item TO <fs_out>.
      <fs_out>-open_qty = ls_item-menge - ls_item-tamen.

      SELECT SINGLE maktx FROM makt INTO @<fs_out>-maktx
       WHERE matnr = @ls_item-matnr AND spras = @sy-langu.
    ENDLOOP.
  ENDMETHOD.

* ----------------------------------------------------------------------
* 5. STORAGEUNITSET_GET_ENTITY: Read single SU
* ----------------------------------------------------------------------
  METHOD storageunitset_get_entity.
    DATA: lv_lgnum TYPE lgnum,
          lv_lenum TYPE lenum,
          ls_lein  TYPE lein.

    io_tech_request_context->get_converted_keys(
      IMPORTING es_key_values = DATA(ls_keys) ).

    lv_lgnum = VALUE #( ls_keys[ name = 'LGNUM' ]-value OPTIONAL ).
    lv_lenum = VALUE #( ls_keys[ name = 'LENUM' ]-value OPTIONAL ).

    IF lv_lgnum IS INITIAL. lv_lgnum = 'W01'. ENDIF.
    lv_lenum = |{ lv_lenum ALPHA = IN }|.

    CALL FUNCTION 'Z_WM_GET_SU_DETAILS'
      EXPORTING
        iv_lgnum      = lv_lgnum
        iv_lenum      = lv_lenum
      IMPORTING
        es_su_header  = er_entity
        ev_is_valid   = DATA(lv_valid)
        ev_error_code = DATA(lv_code)
        ev_message    = DATA(lv_msg).
  ENDMETHOD.

* ----------------------------------------------------------------------
* 6. STORAGEUNITSET_GET_ENTITYSET: Validate Scanned SU against TR
*    Called via: StorageUnitSet?$filter=Lenum eq '...' and Tbnum eq '...'
* ----------------------------------------------------------------------
  METHOD storageunitset_get_entityset.
    DATA: lv_lgnum TYPE lgnum DEFAULT 'W01',
          lv_lenum TYPE lenum,
          lv_tbnum TYPE ltbk-tbnum,
          ls_su    TYPE zwm_s_su_header.

    DATA(lt_filter) = io_tech_request_context->get_filter( )->get_filter_select_options( ).

    READ TABLE lt_filter WITH KEY property = 'LGNUM' INTO DATA(ls_lg_flt).
    IF sy-subrc = 0 AND ls_lg_flt-select_options IS NOT INITIAL.
      lv_lgnum = ls_lg_flt-select_options[ 1 ]-low.
    ENDIF.

    READ TABLE lt_filter WITH KEY property = 'LENUM' INTO DATA(ls_le_flt).
    IF sy-subrc = 0 AND ls_le_flt-select_options IS NOT INITIAL.
      lv_lenum = |{ ls_le_flt-select_options[ 1 ]-low ALPHA = IN }|.
    ENDIF.

    READ TABLE lt_filter WITH KEY property = 'TBNUM' INTO DATA(ls_tb_flt).
    IF sy-subrc = 0 AND ls_tb_flt-select_options IS NOT INITIAL.
      lv_tbnum = |{ ls_tb_flt-select_options[ 1 ]-low ALPHA = IN }|.
    ENDIF.

    IF lv_lenum IS NOT INITIAL.
      CALL FUNCTION 'Z_WM_GET_SU_DETAILS'
        EXPORTING
          iv_lgnum      = lv_lgnum
          iv_lenum      = lv_lenum
          iv_tbnum      = lv_tbnum
        IMPORTING
          es_su_header  = ls_su.

      APPEND ls_su TO et_entityset.
    ENDIF.
  ENDMETHOD.

* ----------------------------------------------------------------------
* 7. SUQUANTSET_GET_ENTITYSET: Available Quants on SU
* ----------------------------------------------------------------------
  METHOD suquantset_get_entityset.
    DATA: lv_lgnum TYPE lgnum DEFAULT 'W01',
          lv_lenum TYPE lenum,
          lt_quants TYPE zwm_tt_su_quant.

    DATA(lt_nav_keys) = io_tech_request_context->get_source_keys( ).
    IF lt_nav_keys IS NOT INITIAL.
      lv_lgnum = VALUE #( lt_nav_keys[ name = 'LGNUM' ]-value DEFAULT 'W01' ).
      lv_lenum = VALUE #( lt_nav_keys[ name = 'LENUM' ]-value OPTIONAL ).
    ELSE.
      DATA(lt_filter) = io_tech_request_context->get_filter( )->get_filter_select_options( ).
      READ TABLE lt_filter WITH KEY property = 'LENUM' INTO DATA(ls_le_flt).
      IF sy-subrc = 0 AND ls_le_flt-select_options IS NOT INITIAL.
        lv_lenum = ls_le_flt-select_options[ 1 ]-low.
      ENDIF.
    ENDIF.

    lv_lenum = |{ lv_lenum ALPHA = IN }|.

    CALL FUNCTION 'Z_WM_GET_SU_DETAILS'
      EXPORTING
        iv_lgnum     = lv_lgnum
        iv_lenum     = lv_lenum
      IMPORTING
        et_su_quants = et_entityset.
  ENDMETHOD.

* ----------------------------------------------------------------------
* 8. EXECUTE_ACTION: Function Import CreateTO
* ----------------------------------------------------------------------
  METHOD /iwbep/if_mgw_appl_srv_runtime~execute_action.
    DATA: lv_action_name TYPE string,
          lv_lgnum       TYPE lgnum,
          lv_tbnum       TYPE ltbk-tbnum,
          lv_tbpos       TYPE ltbp-tbpos,
          lv_lenum       TYPE lenum,
          lv_qty         TYPE lqua-verme,
          lv_unit        TYPE meins,
          lv_confirm     TYPE char1,
          lt_items       TYPE TABLE OF l03b_trite,
          ls_item        TYPE l03b_trite,
          ls_result      TYPE zwm_s_to_confirm.

    lv_action_name = io_tech_request_context->get_action_name( ).

    IF lv_action_name = 'CreateTO'.
      " Parse input action parameters
      DATA(lt_params) = io_tech_request_context->get_action_parameters( ).

      lv_lgnum   = VALUE #( lt_params[ name = 'Lgnum' ]-value DEFAULT 'W01' ).
      lv_tbnum   = |{ VALUE #( lt_params[ name = 'Tbnum' ]-value OPTIONAL ) ALPHA = IN }|.
      lv_tbpos   = VALUE #( lt_params[ name = 'Tbpos' ]-value OPTIONAL ).
      lv_lenum   = |{ VALUE #( lt_params[ name = 'Lenum' ]-value OPTIONAL ) ALPHA = IN }|.
      lv_qty     = VALUE #( lt_params[ name = 'Qty' ]-value OPTIONAL ).
      lv_unit    = VALUE #( lt_params[ name = 'Unit' ]-value OPTIONAL ).
      lv_confirm = VALUE #( lt_params[ name = 'ConfirmImmediate' ]-value DEFAULT 'X' ).

      " Build item structure for ZWM_TO_CREATE_FROM_TR
      CLEAR ls_item.
      ls_item-tbpos = lv_tbpos.
      ls_item-anfme = lv_qty.
      ls_item-altme = lv_unit.
      ls_item-vlenr = lv_lenum.
      APPEND ls_item TO lt_items.

      " Call the verified RFC function module created by DIPAK
      CALL FUNCTION 'ZWM_TO_CREATE_FROM_TR'
        EXPORTING
          iv_lgnum    = lv_lgnum
          iv_tbnum    = lv_tbnum
          iv_commit   = 'X'
        IMPORTING
          ev_tanum    = ls_result-tanum
          ev_success  = ls_result-success
          ev_message  = ls_result-message
        TABLES
          it_items    = lt_items.

      " If Create succeeded and Immediate Confirmation was requested
      IF ls_result-success = 'S' AND ls_result-tanum IS NOT INITIAL AND lv_confirm = 'X'.
        DATA: lt_conf_tab TYPE TABLE OF l03b_conf_tab,
              ls_conf_tab TYPE l03b_conf_tab.

        ls_conf_tab-tanum = ls_result-tanum.
        ls_conf_tab-tapos = 1.
        ls_conf_tab-squit = 'X'.
        APPEND ls_conf_tab TO lt_conf_tab.

        CALL FUNCTION 'L_TO_CONFIRM'
          EXPORTING
            i_lgnum               = lv_lgnum
            i_tanum               = ls_result-tanum
            i_commit_work         = 'X'
          TABLES
            t_conf_tab            = lt_conf_tab
          EXCEPTIONS
            to_already_confirmed  = 1
            foreign_lock          = 2
            to_not_found          = 3
            OTHERS                = 4.

        IF sy-subrc = 0.
          ls_result-confirmed = abap_true.
          ls_result-message   = |Transfer Order { ls_result-tanum } created and confirmed in 1 step.|.
        ELSE.
          ls_result-confirmed = abap_false.
          ls_result-message   = |Transfer Order { ls_result-tanum } created (confirmation pending: subrc { sy-subrc }).|.
        ENDIF.
      ENDIF.

      copy_data_to_ref(
        EXPORTING is_data = ls_result
        CHANGING  cr_data = er_data ).
    ENDIF.
  ENDMETHOD.

ENDCLASS.
```

---

## 5. SEGW Metadata Definition (`edmx` / Model Definition)

When configuring the project in transaction `SEGW` (Service Builder):

```xml
<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="1.0" xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx">
  <edmx:DataServices m:DataServiceVersion="2.0" xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata">
    <Schema Namespace="ZWM_RF_TRTO_SRV" xml:lang="en" xmlns="http://schemas.microsoft.com/ado/2008/09/edm">

      <EntityType Name="TRHeader">
        <Key>
          <PropertyRef Name="Lgnum" />
          <PropertyRef Name="Tbnum" />
        </Key>
        <Property Name="Lgnum" Type="Edm.String" Nullable="false" MaxLength="3" sap:label="Warehouse Number" />
        <Property Name="Tbnum" Type="Edm.String" Nullable="false" MaxLength="10" sap:label="Transfer Requirement" />
        <Property Name="Bwlvs" Type="Edm.String" MaxLength="3" sap:label="Movement Type" />
        <Property Name="Betyp" Type="Edm.String" MaxLength="1" sap:label="Requirement Type" />
        <Property Name="Benum" Type="Edm.String" MaxLength="10" sap:label="Requirement Number" />
        <Property Name="Rsnum" Type="Edm.String" MaxLength="10" sap:label="Reservation" />
        <Property Name="Bdatu" Type="Edm.DateTime" Precision="0" sap:label="Requirement Date" />
        <Property Name="Statu" Type="Edm.String" MaxLength="1" sap:label="Status" />
        <Property Name="Vltyp" Type="Edm.String" MaxLength="3" sap:label="Source Storage Type" />
        <Property Name="Vlpla" Type="Edm.String" MaxLength="10" sap:label="Source Storage Bin" />
        <Property Name="Nltyp" Type="Edm.String" MaxLength="3" sap:label="Destination Storage Type" />
        <Property Name="Nlpla" Type="Edm.String" MaxLength="10" sap:label="Destination Storage Bin" />
        <NavigationProperty Name="ToItems" Relationship="ZWM_RF_TRTO_SRV.TRHeader_TRItem" FromRole="TRHeader" ToRole="TRItem" />
      </EntityType>

      <EntityType Name="TRItem">
        <Key>
          <PropertyRef Name="Lgnum" />
          <PropertyRef Name="Tbnum" />
          <PropertyRef Name="Tbpos" />
        </Key>
        <Property Name="Lgnum" Type="Edm.String" Nullable="false" MaxLength="3" sap:label="Warehouse Number" />
        <Property Name="Tbnum" Type="Edm.String" Nullable="false" MaxLength="10" sap:label="Transfer Requirement" />
        <Property Name="Tbpos" Type="Edm.String" Nullable="false" MaxLength="4" sap:label="Item Number" />
        <Property Name="Matnr" Type="Edm.String" MaxLength="40" sap:label="Material" />
        <Property Name="Maktx" Type="Edm.String" MaxLength="40" sap:label="Material Description" />
        <Property Name="Werks" Type="Edm.String" MaxLength="4" sap:label="Plant" />
        <Property Name="Lgort" Type="Edm.String" MaxLength="4" sap:label="Storage Location" />
        <Property Name="Charg" Type="Edm.String" MaxLength="10" sap:label="Batch" />
        <Property Name="Menge" Type="Edm.Decimal" Precision="13" Scale="3" sap:label="Required Quantity" />
        <Property Name="Tamen" Type="Edm.Decimal" Precision="13" Scale="3" sap:label="Processed Quantity" />
        <Property Name="OpenQty" Type="Edm.Decimal" Precision="13" Scale="3" sap:label="Open Quantity" />
        <Property Name="Meins" Type="Edm.String" MaxLength="3" sap:label="Unit of Measure" />
        <Property Name="Elikz" Type="Edm.String" MaxLength="1" sap:label="Delivery Completed" />
      </EntityType>

      <EntityType Name="StorageUnit">
        <Key>
          <PropertyRef Name="Lgnum" />
          <PropertyRef Name="Lenum" />
        </Key>
        <Property Name="Lgnum" Type="Edm.String" Nullable="false" MaxLength="3" sap:label="Warehouse Number" />
        <Property Name="Lenum" Type="Edm.String" Nullable="false" MaxLength="20" sap:label="Storage Unit Number" />
        <Property Name="Tbnum" Type="Edm.String" MaxLength="10" sap:label="TR Context" />
        <Property Name="Lgtyp" Type="Edm.String" MaxLength="3" sap:label="Storage Type" />
        <Property Name="Lgpla" Type="Edm.String" MaxLength="10" sap:label="Storage Bin" />
        <Property Name="Letyp" Type="Edm.String" MaxLength="3" sap:label="SU Type" />
        <Property Name="Statu" Type="Edm.String" MaxLength="1" sap:label="SU Status" />
        <Property Name="IsValid" Type="Edm.Boolean" sap:label="Is Valid" />
        <Property Name="ErrorCode" Type="Edm.String" MaxLength="20" sap:label="Error Code" />
        <Property Name="ErrorMessage" Type="Edm.String" MaxLength="220" sap:label="Validation Message" />
        <NavigationProperty Name="ToQuants" Relationship="ZWM_RF_TRTO_SRV.StorageUnit_SUQuant" FromRole="StorageUnit" ToRole="SUQuant" />
      </EntityType>

      <EntityType Name="SUQuant">
        <Key>
          <PropertyRef Name="Lgnum" />
          <PropertyRef Name="Lqnum" />
        </Key>
        <Property Name="Lgnum" Type="Edm.String" Nullable="false" MaxLength="3" sap:label="Warehouse Number" />
        <Property Name="Lqnum" Type="Edm.String" Nullable="false" MaxLength="10" sap:label="Quant" />
        <Property Name="Lenum" Type="Edm.String" MaxLength="20" sap:label="Storage Unit Number" />
        <Property Name="Matnr" Type="Edm.String" MaxLength="40" sap:label="Material" />
        <Property Name="Maktx" Type="Edm.String" MaxLength="40" sap:label="Material Description" />
        <Property Name="Werks" Type="Edm.String" MaxLength="4" sap:label="Plant" />
        <Property Name="Lgort" Type="Edm.String" MaxLength="4" sap:label="Storage Location" />
        <Property Name="Charg" Type="Edm.String" MaxLength="10" sap:label="Batch" />
        <Property Name="Verme" Type="Edm.Decimal" Precision="13" Scale="3" sap:label="Available Quantity" />
        <Property Name="Meins" Type="Edm.String" MaxLength="3" sap:label="Unit of Measure" />
        <Property Name="Lgtyp" Type="Edm.String" MaxLength="3" sap:label="Storage Type" />
        <Property Name="Lgpla" Type="Edm.String" MaxLength="10" sap:label="Storage Bin" />
      </EntityType>

      <ComplexType Name="TOConfirmation">
        <Property Name="Tanum" Type="Edm.String" MaxLength="10" sap:label="Transfer Order" />
        <Property Name="Success" Type="Edm.String" MaxLength="1" sap:label="Status" />
        <Property Name="Message" Type="Edm.String" MaxLength="220" sap:label="Message Text" />
        <Property Name="Confirmed" Type="Edm.Boolean" sap:label="Confirmed in 1-Step" />
      </ComplexType>

      <Association Name="TRHeader_TRItem">
        <End Type="ZWM_RF_TRTO_SRV.TRHeader" Multiplicity="1" Role="TRHeader" />
        <End Type="ZWM_RF_TRTO_SRV.TRItem" Multiplicity="*" Role="TRItem" />
      </Association>

      <Association Name="StorageUnit_SUQuant">
        <End Type="ZWM_RF_TRTO_SRV.StorageUnit" Multiplicity="1" Role="StorageUnit" />
        <End Type="ZWM_RF_TRTO_SRV.SUQuant" Multiplicity="*" Role="SUQuant" />
      </Association>

      <EntityContainer Name="ZWM_RF_TRTO_SRV_Entities" m:IsDefaultEntityContainer="true">
        <EntitySet Name="TRHeaderSet" EntityType="ZWM_RF_TRTO_SRV.TRHeader" />
        <EntitySet Name="TRItemSet" EntityType="ZWM_RF_TRTO_SRV.TRItem" />
        <EntitySet Name="StorageUnitSet" EntityType="ZWM_RF_TRTO_SRV.StorageUnit" />
        <EntitySet Name="SUQuantSet" EntityType="ZWM_RF_TRTO_SRV.SUQuant" />

        <FunctionImport Name="CreateTO" ReturnType="ZWM_RF_TRTO_SRV.TOConfirmation" m:HttpMethod="POST">
          <Parameter Name="Lgnum" Type="Edm.String" Mode="In" MaxLength="3" />
          <Parameter Name="Tbnum" Type="Edm.String" Mode="In" MaxLength="10" />
          <Parameter Name="Tbpos" Type="Edm.String" Mode="In" MaxLength="4" />
          <Parameter Name="Lenum" Type="Edm.String" Mode="In" MaxLength="20" />
          <Parameter Name="Qty" Type="Edm.Decimal" Mode="In" Precision="13" Scale="3" />
          <Parameter Name="Unit" Type="Edm.String" Mode="In" MaxLength="3" />
          <Parameter Name="ConfirmImmediate" Type="Edm.String" Mode="In" MaxLength="1" />
        </FunctionImport>
      </EntityContainer>

    </Schema>
  </edmx:DataServices>
</edmx:Edmx>
```

---

## 6. Registration & Activation in S/4HANA Gateway

To activate this service in SAP S/4HANA (DS4 Client 220):
1. **Transaction `SEGW`**: Create Project `ZWM_RF_TRTO`, paste/generate DDIC artifacts and DPC/MPC classes.
2. **Transaction `/IWFND/MAINT_SERVICE`**:
   - Add Service -> System Alias: `LOCAL` (or `DS4_220`).
   - Technical Service Name: `ZWM_RF_TRTO_SRV`.
   - Technical Model Name: `ZWM_RF_TRTO_MDL`.
   - Package: `Z001` (Transportable) or `$TMP` (Local).
3. **ICF Node Activation**:
   - In `/IWFND/MAINT_SERVICE`, click **ICF Node -> Activate** (`/default_host/sap/opu/odata/sap/zwm_rf_trto_srv`).
4. **Validation Test Call**:
   - `GET /sap/opu/odata/sap/ZWM_RF_TRTO_SRV/$metadata` -> Expected: HTTP 200 OK.
