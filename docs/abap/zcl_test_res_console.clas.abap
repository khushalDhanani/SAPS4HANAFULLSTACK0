CLASS zcl_test_res_console DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC .

  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun .

  PROTECTED SECTION.
  PRIVATE SECTION.
ENDCLASS.

CLASS zcl_test_res_console IMPLEMENTATION.

  METHOD if_oo_adt_classrun~main.
    DATA: lo_proc   TYPE REF TO zcl_res_process,
          lv_rsnum  TYPE rsnum,
          lv_rspos  TYPE rspos,
          lv_tbnum  TYPE tbnum,
          lv_tbpos  TYPE tbpos,
          lv_tanum  TYPE tanum,
          lv_mblnr  TYPE mblnr,
          lv_mjahr  TYPE mjahr,
          lv_lgnum  TYPE lgnum,
          lt_ret    TYPE zcl_res_process=>tt_bapiret2,
          lv_subrc  TYPE sysubrc.

    CREATE OBJECT lo_proc.

    out->write( '=================================================================' ).
    out->write( 'ZCL_TEST_RES_CONSOLE: ADT Automated Suite for Classic WM Flow' ).
    out->write( '=================================================================' ).

    " -----------------------------------------------------------------
    " CASE 1: Movement Type 311 (Storage Location Transfer)
    " -----------------------------------------------------------------
    out->write( '--- [CASE 1] Testing Movement 311 (Plant 1120 HS01 -> CS01) ---' ).
    TRY.
        lo_proc->derive_warehouse(
          EXPORTING iv_werks = '1120' iv_lgort = 'HS01'
          IMPORTING ev_lgnum = lv_lgnum ev_subrc = lv_subrc ).
        out->write( |Derived Warehouse Number: { lv_lgnum }| ).
      CATCH zcx_res_process_error INTO DATA(lx_wh).
        out->write( |Warehouse derivation failed: { lx_wh->mv_msg }| ).
    ENDTRY.

    lo_proc->create_reservation(
      EXPORTING
        iv_bwart   = '311'
        iv_werks   = '1120'
        iv_lgort   = 'HS01'
        iv_matnr   = '000000008000000023'
        iv_menge   = '1.000'
        iv_meins   = 'NOS'
        iv_umlgo   = 'CS01'
        iv_testrun = 'X'
      IMPORTING
        ev_rsnum   = lv_rsnum
        ev_rspos   = lv_rspos
        et_return  = lt_ret
        ev_subrc   = lv_subrc ).
    out->write( |Step 1 (Reservation 311 Simulation): subrc = { lv_subrc } | ).

    " -----------------------------------------------------------------
    " CASE 2: Movement Type 201 (Cost Center Goods Issue)
    " -----------------------------------------------------------------
    out->write( '--- [CASE 2] Testing Movement 201 (Cost Center 1011201301) ---' ).
    lo_proc->create_reservation(
      EXPORTING
        iv_bwart   = '201'
        iv_werks   = '1120'
        iv_lgort   = 'HS01'
        iv_matnr   = '000000008000000023'
        iv_menge   = '1.000'
        iv_meins   = 'NOS'
        iv_kostl   = '1011201301'
        iv_testrun = 'X'
      IMPORTING
        ev_rsnum   = lv_rsnum
        ev_rspos   = lv_rspos
        et_return  = lt_ret
        ev_subrc   = lv_subrc ).
    out->write( |Step 1 (Reservation 201 Simulation): subrc = { lv_subrc } | ).

    " -----------------------------------------------------------------
    " CASE 3: Movement Type 241 (Asset Goods Issue)
    " -----------------------------------------------------------------
    out->write( '--- [CASE 3] Testing Movement 241 (Asset 000000400092) ---' ).
    lo_proc->create_reservation(
      EXPORTING
        iv_bwart   = '241'
        iv_werks   = '1120'
        iv_lgort   = 'HS01'
        iv_matnr   = '000000008000000023'
        iv_menge   = '1.000'
        iv_meins   = 'NOS'
        iv_anln1   = '000000400092'
        iv_anln2   = '0000'
        iv_testrun = 'X'
      IMPORTING
        ev_rsnum   = lv_rsnum
        ev_rspos   = lv_rspos
        et_return  = lt_ret
        ev_subrc   = lv_subrc ).
    out->write( |Step 1 (Reservation 241 Simulation): subrc = { lv_subrc } | ).

    " -----------------------------------------------------------------
    " CASE 4: Movement Type 301 (Plant-to-Plant Transfer)
    " -----------------------------------------------------------------
    out->write( '--- [CASE 4] Testing Movement 301 (Plant 1120 -> 1130) ---' ).
    lo_proc->create_reservation(
      EXPORTING
        iv_bwart   = '301'
        iv_werks   = '1120'
        iv_lgort   = 'HS01'
        iv_matnr   = '000000008000000023'
        iv_menge   = '1.000'
        iv_meins   = 'NOS'
        iv_umwrk   = '1130'
        iv_umlgo   = 'CS01'
        iv_testrun = 'X'
      IMPORTING
        ev_rsnum   = lv_rsnum
        ev_rspos   = lv_rspos
        et_return  = lt_ret
        ev_subrc   = lv_subrc ).
    out->write( |Step 1 (Reservation 301 Simulation): subrc = { lv_subrc } | ).

    " -----------------------------------------------------------------
    " CASE 5: Forced GI Failure & Idempotent Guard Verification
    " -----------------------------------------------------------------
    out->write( '--- [CASE 5] Testing Forced GI Failure & Idempotent Guard ---' ).
    " 1. Simulate existing material document detection
    lo_proc->post_migo(
      EXPORTING
        iv_rsnum    = '0000524979' " Known live reservation
        iv_rspos    = '0001'
        iv_bwart    = '311'
        iv_matnr    = '000000008000000023'
        iv_werks    = '1120'
        iv_lgort    = 'HS01'
        iv_menge    = '1.000'
        iv_meins    = 'NOS'
        iv_ref_text = 'TEST_IDEMPOTENT_UUID'
        iv_testrun  = 'X'
      IMPORTING
        ev_mblnr    = lv_mblnr
        ev_mjahr    = lv_mjahr
        et_return   = lt_ret
        ev_subrc    = lv_subrc ).
    out->write( |GI Guard Test Execution: subrc = { lv_subrc }, Doc = { lv_mblnr }/{ lv_mjahr }| ).

    out->write( '=================================================================' ).
    out->write( 'Table Verification Checklist in ADT / SE16N:' ).
    out->write( '1. RESB: Check RSNUM, RSPOS, MENGE, KZEAR (Final Issue)' ).
    out->write( '2. LTBK / LTBP: Check TBNUM, ELIKZ (TR Closed)' ).
    out->write( '3. LTAK / LTAP: Check TANUM, PQUIT (TO Confirmed), NLTYP' ).
    out->write( '4. LQUA: Verify interim storage bin balance in NLTYP is 0.000' ).
    out->write( '5. MATDOC / MSEG: Check MBLNR, MJAHR, BKTXT (Process UUID)' ).
    out->write( '6. ZRES_TRACK: Check STATUS (05), RETRY_COUNT, ERROR_STEP' ).
    out->write( '=================================================================' ).
  ENDMETHOD.

ENDCLASS.
