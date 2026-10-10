*"* use this source file for your ABAP unit test classes
CLASS ltcl_res_process DEFINITION FINAL FOR TESTING
  DURATION SHORT
  RISK LEVEL HARMLESS.

  PRIVATE SECTION.
    DATA: mo_cut TYPE REF TO zcl_res_process.

    METHODS:
      setup,
      teardown,

      " Unit tests per movement type
      test_res_create_311 FOR TESTING,
      test_res_create_201 FOR TESTING,
      test_res_create_241 FOR TESTING,
      test_res_create_301 FOR TESTING,

      " Isolated step tests
      test_create_tr_isolated FOR TESTING,
      test_create_to_isolated FOR TESTING,
      test_confirm_to_isolated FOR TESTING,
      test_post_migo_isolated FOR TESTING,

      " Tracking table update
      test_update_status_and_log FOR TESTING,

      " Validation & error handling
      test_invalid_inputs FOR TESTING.

ENDCLASS.


CLASS ltcl_res_process IMPLEMENTATION.

  METHOD setup.
    CREATE OBJECT mo_cut.
  ENDMETHOD.

  METHOD teardown.
    CLEAR mo_cut.
  ENDMETHOD.

  METHOD test_res_create_311.
    DATA: lv_rsnum  TYPE rsnum,
          lv_rspos  TYPE rspos,
          lt_return TYPE zcl_res_process=>tt_bapiret2,
          lv_subrc  TYPE sysubrc.

    mo_cut->create_reservation(
      EXPORTING
        iv_bwart   = zcl_res_process=>gc_mvt_311
        iv_werks   = '1120'
        iv_lgort   = 'HS01'
        iv_matnr   = '000000008000000023'
        iv_menge   = '1.000'
        iv_meins   = 'NOS'
        iv_umlgo   = 'CS01'
        iv_testrun = 'X' " Simulation mode
      IMPORTING
        ev_rsnum   = lv_rsnum
        ev_rspos   = lv_rspos
        et_return  = lt_return
        ev_subrc   = lv_subrc ).

    cl_abap_unit_assert=>assert_equals(
      act = lv_subrc
      exp = 0
      msg = 'Reservation 311 simulation should succeed' ).
  ENDMETHOD.

  METHOD test_res_create_201.
    DATA: lv_rsnum  TYPE rsnum,
          lv_rspos  TYPE rspos,
          lt_return TYPE zcl_res_process=>tt_bapiret2,
          lv_subrc  TYPE sysubrc.

    mo_cut->create_reservation(
      EXPORTING
        iv_bwart   = zcl_res_process=>gc_mvt_201
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
        et_return  = lt_return
        ev_subrc   = lv_subrc ).

    cl_abap_unit_assert=>assert_equals(
      act = lv_subrc
      exp = 0
      msg = 'Reservation 201 simulation should succeed' ).
  ENDMETHOD.

  METHOD test_res_create_241.
    DATA: lv_rsnum  TYPE rsnum,
          lv_rspos  TYPE rspos,
          lt_return TYPE zcl_res_process=>tt_bapiret2,
          lv_subrc  TYPE sysubrc.

    mo_cut->create_reservation(
      EXPORTING
        iv_bwart   = zcl_res_process=>gc_mvt_241
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
        et_return  = lt_return
        ev_subrc   = lv_subrc ).

    cl_abap_unit_assert=>assert_equals(
      act = lv_subrc
      exp = 0
      msg = 'Reservation 241 simulation should succeed' ).
  ENDMETHOD.

  METHOD test_res_create_301.
    DATA: lv_rsnum  TYPE rsnum,
          lv_rspos  TYPE rspos,
          lt_return TYPE zcl_res_process=>tt_bapiret2,
          lv_subrc  TYPE sysubrc.

    mo_cut->create_reservation(
      EXPORTING
        iv_bwart   = zcl_res_process=>gc_mvt_301
        iv_werks   = '1120'
        iv_lgort   = 'HS01'
        iv_matnr   = '000000008000000023'
        iv_menge   = '1.000'
        iv_meins   = 'NOS'
        iv_umwrk   = '1130'
        iv_testrun = 'X'
      IMPORTING
        ev_rsnum   = lv_rsnum
        ev_rspos   = lv_rspos
        et_return  = lt_return
        ev_subrc   = lv_subrc ).

    cl_abap_unit_assert=>assert_equals(
      act = lv_subrc
      exp = 0
      msg = 'Reservation 301 simulation should succeed' ).
  ENDMETHOD.

  METHOD test_create_tr_isolated.
    DATA: lv_tbnum  TYPE tbnum,
          lv_tbpos  TYPE tbpos,
          lt_return TYPE zcl_res_process=>tt_bapiret2,
          lv_subrc  TYPE sysubrc.

    " Test using proven live reservation 0000524979
    mo_cut->create_tr(
      EXPORTING
        iv_lgnum  = 'W01'
        iv_bwlvs  = '311'
        iv_matnr  = '000000008000000023'
        iv_werks  = '1120'
        iv_lgort  = 'HS01'
        iv_menga  = '1.000'
        iv_altme  = 'NOS'
        iv_rsnum  = '0000524979'
        iv_rspos  = '0001'
      IMPORTING
        ev_tbnum  = lv_tbnum
        ev_tbpos  = lv_tbpos
        et_return = lt_return
        ev_subrc  = lv_subrc ).

    " In unit test execution, verify return structure is populated
    cl_abap_unit_assert=>assert_not_initial(
      act = lt_return
      msg = 'Return table must be populated' ).
  ENDMETHOD.

  METHOD test_create_to_isolated.
    DATA: lv_tanum  TYPE tanum,
          lt_return TYPE zcl_res_process=>tt_bapiret2,
          lv_subrc  TYPE sysubrc.

    " Test using proven live TR 0001001839
    mo_cut->create_to_from_tr(
      EXPORTING
        iv_lgnum  = 'W01'
        iv_tbnum  = '0001001839'
        iv_commit = ' ' " No commit in unit test
      IMPORTING
        ev_tanum  = lv_tanum
        et_return = lt_return
        ev_subrc  = lv_subrc ).

    cl_abap_unit_assert=>assert_not_initial(
      act = lt_return
      msg = 'Return table must be populated' ).
  ENDMETHOD.

  METHOD test_confirm_to_isolated.
    DATA: lt_return TYPE zcl_res_process=>tt_bapiret2,
          lv_subrc  TYPE sysubrc.

    " Test confirm on TO
    mo_cut->confirm_to(
      EXPORTING
        iv_lgnum  = 'W01'
        iv_tanum  = '0001012966'
        iv_squit  = 'X'
        iv_commit = ' '
      IMPORTING
        ev_subrc  = lv_subrc
        et_return = lt_return ).

    cl_abap_unit_assert=>assert_not_initial(
      act = lt_return
      msg = 'Return messages must be populated' ).
  ENDMETHOD.

  METHOD test_post_migo_isolated.
    DATA: lv_mblnr  TYPE mblnr,
          lv_mjahr  TYPE mjahr,
          lt_return TYPE zcl_res_process=>tt_bapiret2,
          lv_subrc  TYPE sysubrc.

    mo_cut->post_migo(
      EXPORTING
        iv_rsnum   = '0000524979'
        iv_rspos   = '0001'
        iv_bwart   = '311'
        iv_matnr   = '000000008000000023'
        iv_werks   = '1120'
        iv_lgort   = 'HS01'
        iv_menge   = '1.000'
        iv_meins   = 'NOS'
        iv_umlgo   = 'CS01'
        iv_testrun = 'X'
      IMPORTING
        ev_mblnr   = lv_mblnr
        ev_mjahr   = lv_mjahr
        et_return  = lt_return
        ev_subrc   = lv_subrc ).

    cl_abap_unit_assert=>assert_not_initial(
      act = lt_return
      msg = 'Return table must be populated' ).
  ENDMETHOD.

  METHOD test_update_status_and_log.
    DATA: ls_track TYPE zres_track,
          lv_subrc TYPE sysubrc.

    mo_cut->update_status(
      EXPORTING
        iv_rsnum     = '0000999991'
        iv_rspos     = '0001'
        iv_move_type = '311'
        iv_lgnum     = 'W01'
        iv_status    = zcl_res_process=>gc_status_01
        iv_step      = zcl_res_process=>gc_step_mb21
        iv_msgty     = 'S'
        iv_message   = 'Unit test tracking record'
      IMPORTING
        es_track     = ls_track
        ev_subrc     = lv_subrc ).

    cl_abap_unit_assert=>assert_equals(
      act = lv_subrc
      exp = 0
      msg = 'update_status must return 0' ).
    cl_abap_unit_assert=>assert_equals(
      act = ls_track-status
      exp = zcl_res_process=>gc_status_01
      msg = 'Status should be 01' ).
  ENDMETHOD.

  METHOD test_invalid_inputs.
    DATA: ls_track TYPE zres_track,
          lv_subrc TYPE sysubrc.

    " Missing reservation number should fail
    mo_cut->update_status(
      EXPORTING
        iv_rsnum = space
        iv_rspos = '0001'
      IMPORTING
        es_track = ls_track
        ev_subrc = lv_subrc ).

    cl_abap_unit_assert=>assert_differs(
      act = lv_subrc
      exp = 0
      msg = 'update_status must reject empty RSNUM' ).
  ENDMETHOD.

ENDCLASS.
