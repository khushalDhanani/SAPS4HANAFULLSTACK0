CLASS zcl_res_process DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC .

  PUBLIC SECTION.

    TYPES:
      tt_bapiret2 TYPE STANDARD TABLE OF bapiret2 WITH DEFAULT KEY .

    CONSTANTS:
      gc_mvt_201   TYPE bwart VALUE '201',
      gc_mvt_241   TYPE bwart VALUE '241',
      gc_mvt_311   TYPE bwart VALUE '311',
      gc_mvt_301   TYPE bwart VALUE '301',

      gc_step_mb21 TYPE char10 VALUE 'MB21',
      gc_step_lb01 TYPE char10 VALUE 'LB01',
      gc_step_lt04 TYPE char10 VALUE 'LT04',
      gc_step_lt12 TYPE char10 VALUE 'LT12',
      gc_step_migo TYPE char10 VALUE 'MIGO',

      gc_status_01 TYPE zres_status VALUE '01', " Reservation Created
      gc_status_02 TYPE zres_status VALUE '02', " TR Created
      gc_status_03 TYPE zres_status VALUE '03', " TO Created
      gc_status_04 TYPE zres_status VALUE '04', " TO Confirmed
      gc_status_05 TYPE zres_status VALUE '05', " Goods Issue Posted
      gc_status_99 TYPE zres_status VALUE '99'. " Error / Exception

    "! Step 1: Create Reservation via BAPI_RESERVATION_CREATE1 (MB21)
    METHODS create_reservation
      IMPORTING
        !iv_bwart    TYPE bwart
        !iv_werks    TYPE werks_d
        !iv_lgort    TYPE lgort_d
        !iv_matnr    TYPE matnr
        !iv_menge    TYPE erfmg
        !iv_meins    TYPE erfme
        !iv_res_date TYPE d DEFAULT sy-datum
        !iv_umwrk    TYPE umwrk OPTIONAL
        !iv_umlgo    TYPE umlgo OPTIONAL
        !iv_kostl    TYPE kostl OPTIONAL
        !iv_anln1    TYPE anln1 OPTIONAL
        !iv_anln2    TYPE anln2 OPTIONAL
        !iv_testrun  TYPE bapi2093_test OPTIONAL
      EXPORTING
        !ev_rsnum    TYPE rsnum
        !ev_rspos    TYPE rspos
        !et_return   TYPE tt_bapiret2
        !ev_subrc    TYPE sysubrc .

    "! Step 2: Create Transfer Requirement via L_TR_CREATE (LB01)
    METHODS create_tr
      IMPORTING
        !iv_lgnum    TYPE lgnum
        !iv_bwlvs    TYPE bwlvs
        !iv_matnr    TYPE matnr
        !iv_werks    TYPE werks_d
        !iv_lgort    TYPE lgort_d
        !iv_menga    TYPE ltbp_menga
        !iv_altme    TYPE lrmei
        !iv_rsnum    TYPE rsnum
        !iv_rspos    TYPE rspos DEFAULT '0001'
      EXPORTING
        !ev_tbnum    TYPE tbnum
        !ev_tbpos    TYPE tbpos
        !et_return   TYPE tt_bapiret2
        !ev_subrc    TYPE sysubrc .

    "! Step 3: Create Transfer Order from TR via L_TO_CREATE_TR (LT04)
    METHODS create_to_from_tr
      IMPORTING
        !iv_lgnum   TYPE lgnum
        !iv_tbnum   TYPE tbnum
        !iv_commit  TYPE rl03b DEFAULT 'X'
      EXPORTING
        !ev_tanum   TYPE tanum
        !et_return  TYPE tt_bapiret2
        !ev_subrc   TYPE sysubrc .

    "! Step 4: Confirm Transfer Order via L_TO_CONFIRM (LT12)
    METHODS confirm_to
      IMPORTING
        !iv_lgnum  TYPE lgnum
        !iv_tanum  TYPE tanum
        !iv_squit  TYPE rl03t DEFAULT 'X'
        !iv_commit TYPE rl03b DEFAULT 'X'
      EXPORTING
        !ev_subrc  TYPE sysubrc
        !et_return TYPE tt_bapiret2 .

    "! Step 5: Post Goods Issue via BAPI_GOODSMVT_CREATE (MIGO)
    METHODS post_migo
      IMPORTING
        !iv_rsnum   TYPE rsnum
        !iv_rspos   TYPE rspos DEFAULT '0001'
        !iv_bwart   TYPE bwart
        !iv_matnr   TYPE matnr
        !iv_werks   TYPE werks_d
        !iv_lgort   TYPE lgort_d
        !iv_menge   TYPE erfmg
        !iv_meins   TYPE erfme
        !iv_umwrk   TYPE umwrk OPTIONAL
        !iv_umlgo   TYPE umlgo OPTIONAL
        !iv_kostl   TYPE kostl OPTIONAL
        !iv_anln1   TYPE anln1 OPTIONAL
        !iv_anln2   TYPE anln2 OPTIONAL
        !iv_testrun TYPE bapi2017_gm_gen OPTIONAL
      EXPORTING
        !ev_mblnr   TYPE mblnr
        !ev_mjahr   TYPE mjahr
        !et_return  TYPE tt_bapiret2
        !ev_subrc   TYPE sysubrc .

    "! Step 6: Update Tracking and Log in ZRES_TRACK & ZRES_LOG
    METHODS update_status
      IMPORTING
        !iv_rsnum     TYPE rsnum
        !iv_rspos     TYPE rspos DEFAULT '0001'
        !iv_move_type TYPE bwart OPTIONAL
        !iv_lgnum     TYPE lgnum OPTIONAL
        !iv_tbnum     TYPE tbnum OPTIONAL
        !iv_tanum     TYPE tanum OPTIONAL
        !iv_mblnr     TYPE mblnr OPTIONAL
        !iv_mjahr     TYPE mjahr OPTIONAL
        !iv_status    TYPE zres_status OPTIONAL
        !iv_err_msg   TYPE bapi_msg OPTIONAL
        !iv_step      TYPE char10 OPTIONAL
        !iv_msgty     TYPE bapi_mtype OPTIONAL
        !iv_msgid     TYPE symsgid OPTIONAL
        !iv_msgno     TYPE symsgno OPTIONAL
        !iv_message   TYPE bapi_msg OPTIONAL
      EXPORTING
        !es_track     TYPE zres_track
        !ev_subrc     TYPE sysubrc .

  PROTECTED SECTION.
  PRIVATE SECTION.

    METHODS add_bapiret2
      IMPORTING
        !iv_type    TYPE bapi_mtype
        !iv_id      TYPE symsgid
        !iv_number  TYPE symsgno
        !iv_message TYPE bapi_msg OPTIONAL
        !iv_v1      TYPE symsgv OPTIONAL
        !iv_v2      TYPE symsgv OPTIONAL
      CHANGING
        !ct_return  TYPE tt_bapiret2 .

ENDCLASS.



CLASS zcl_res_process IMPLEMENTATION.

  METHOD create_reservation.
    DATA: ls_head  TYPE bapi2093_res_head,
          lt_items TYPE STANDARD TABLE OF bapi2093_res_item,
          ls_item  TYPE bapi2093_res_item,
          lt_ret   TYPE STANDARD TABLE OF bapiret2,
          lv_res   TYPE bapi2093_res_key.

    CLEAR: ev_rsnum, ev_rspos, et_return, ev_subrc.

    " 1. Build Header
    ls_head-res_date   = iv_res_date.
    ls_head-move_type  = iv_bwart.
    ls_head-move_plant = iv_umwrk.
    ls_head-move_stloc = iv_umlgo.
    ls_head-costcenter = iv_kostl.
    ls_head-asset_no   = iv_anln1.
    ls_head-sub_number = iv_anln2.

    " 2. Build Item
    CLEAR ls_item.
    ls_item-material  = iv_matnr.
    ls_item-plant     = iv_werks.
    ls_item-stge_loc  = iv_lgort.
    ls_item-entry_qnt = iv_menge.
    ls_item-entry_uom = iv_meins.
    ls_item-movement  = 'X'.
    APPEND ls_item TO lt_items.

    " 3. Call BAPI
    CALL FUNCTION 'BAPI_RESERVATION_CREATE1'
      EXPORTING
        reservationheader = ls_head
        testrun           = iv_testrun
      IMPORTING
        reservation       = lv_res
      TABLES
        reservationitems  = lt_items
        return            = lt_ret.

    et_return = lt_ret.

    LOOP AT lt_ret TRANSPORTING NO FIELDS WHERE type CA 'EA'.
      ev_subrc = 4.
      EXIT.
    ENDLOOP.

    IF ev_subrc = 0 AND lv_res IS NOT INITIAL.
      ev_rsnum = lv_res.
      ev_rspos = '0001'.
      IF iv_testrun IS INITIAL.
        CALL FUNCTION 'BAPI_TRANSACTION_COMMIT'
          EXPORTING
            wait = 'X'.
      ENDIF.
    ELSEIF ev_subrc <> 0 AND iv_testrun IS INITIAL.
      CALL FUNCTION 'BAPI_TRANSACTION_ROLLBACK'.
    ENDIF.

  ENDMETHOD.


  METHOD create_tr.
    DATA: lt_ltba TYPE STANDARD TABLE OF ltba,
          ls_ltba TYPE ltba.

    CLEAR: ev_tbnum, ev_tbpos, et_return, ev_subrc.

    ls_ltba-lgnum = iv_lgnum.
    ls_ltba-bwlvs = iv_bwlvs.
    ls_ltba-matnr = iv_matnr.
    ls_ltba-werks = iv_werks.
    ls_ltba-lgort = iv_lgort.
    ls_ltba-menga = iv_menga.
    ls_ltba-altme = iv_altme.
    ls_ltba-rsnum = iv_rsnum.
    ls_ltba-rspos = iv_rspos.
    APPEND ls_ltba TO lt_ltba.

    CALL FUNCTION 'L_TR_CREATE'
      EXPORTING
        i_commit_work          = 'X'
        i_save_only_all        = 'X'
        i_single_item          = 'X'
      TABLES
        t_ltba                 = lt_ltba
      EXCEPTIONS
        item_error             = 1
        item_without_number    = 2
        no_entry_in_int_table  = 3
        no_update_item_error   = 4
        OTHERS                 = 5.

    IF sy-subrc <> 0.
      ev_subrc = sy-subrc.
      add_bapiret2(
        EXPORTING
          iv_type    = 'E'
          iv_id      = 'L3'
          iv_number  = '100'
          iv_message = |Error creating Transfer Requirement: exception { sy-subrc }|
        CHANGING
          ct_return  = et_return ).
      RETURN.
    ENDIF.

    READ TABLE lt_ltba INTO ls_ltba INDEX 1.
    IF sy-subrc = 0 AND ls_ltba-tbnum IS NOT INITIAL.
      ev_tbnum = ls_ltba-tbnum.
      ev_tbpos = ls_ltba-tbpos.
      ev_subrc = 0.
      add_bapiret2(
        EXPORTING
          iv_type    = 'S'
          iv_id      = 'L3'
          iv_number  = '101'
          iv_message = |Transfer Requirement { ev_tbnum } item { ev_tbpos } created|
        CHANGING
          ct_return  = et_return ).
    ELSE.
      ev_subrc = 4.
      add_bapiret2(
        EXPORTING
          iv_type    = 'E'
          iv_id      = 'L3'
          iv_number  = '102'
          iv_message = 'L_TR_CREATE executed but no TBNUM returned'
        CHANGING
          ct_return  = et_return ).
    ENDIF.

  ENDMETHOD.


  METHOD create_to_from_tr.
    DATA: lt_ltap_vb TYPE STANDARD TABLE OF ltap_vb,
          lt_msg     TYPE STANDARD TABLE OF wmgrp_msg,
          lv_tanum   TYPE tanum.

    CLEAR: ev_tanum, et_return, ev_subrc.

    CALL FUNCTION 'L_TO_CREATE_TR'
      EXPORTING
        i_lgnum                        = iv_lgnum
        i_tbnum                        = iv_tbnum
        i_commit_work                  = iv_commit
        i_bname                        = sy-uname
      IMPORTING
        e_tanum                        = lv_tanum
      TABLES
        t_ltap_vb                      = lt_ltap_vb
        t_wmgrp_msg                    = lt_msg
      EXCEPTIONS
        foreign_lock                   = 1
        qm_relevant                    = 2
        tr_completed                   = 3
        xfeld_wrong                    = 4
        ldest_wrong                    = 5
        drukz_wrong                    = 6
        tr_wrong                       = 7
        squit_forbidden                = 8
        no_to_created                  = 9
        update_without_commit          = 10
        no_authority                   = 11
        preallocated_stock             = 12
        partial_transfer_req_forbidden = 13
        input_error                    = 14
        OTHERS                         = 15.

    IF sy-subrc <> 0.
      ev_subrc = sy-subrc.
      add_bapiret2(
        EXPORTING
          iv_type    = 'E'
          iv_id      = 'L3'
          iv_number  = '110'
          iv_message = |Error creating Transfer Order from TR { iv_tbnum }: exception { sy-subrc }|
        CHANGING
          ct_return  = et_return ).
      RETURN.
    ENDIF.

    ev_tanum = lv_tanum.
    ev_subrc = 0.
    add_bapiret2(
      EXPORTING
        iv_type    = 'S'
        iv_id      = 'L3'
        iv_number  = '111'
        iv_message = |Transfer Order { ev_tanum } created from TR { iv_tbnum }|
      CHANGING
        ct_return  = et_return ).

  ENDMETHOD.


  METHOD confirm_to.
    DATA: lt_conf TYPE STANDARD TABLE OF ltap_conf.

    CLEAR: ev_subrc, et_return.

    CALL FUNCTION 'L_TO_CONFIRM'
      EXPORTING
        i_lgnum                        = iv_lgnum
        i_tanum                        = iv_tanum
        i_squit                        = iv_squit
        i_commit_work                  = iv_commit
      TABLES
        t_ltap_conf                    = lt_conf
      EXCEPTIONS
        to_confirmed                   = 1
        to_doesnt_exist                = 2
        item_confirmed                 = 3
        item_subsystem                 = 4
        item_doesnt_exist              = 5
        item_without_zero_stock_check  = 6
        item_with_zero_stock_check     = 7
        one_item_with_zero_stock_check = 8
        item_su_bulk_storage           = 9
        item_no_su_bulk_storage        = 10
        one_item_su_bulk_storage       = 11
        foreign_lock                   = 12
        squit_or_quantities            = 13
        vquit_or_quantities            = 14
        bquit_or_quantities            = 15
        quantity_wrong                 = 16
        double_lines                   = 17
        kzdif_wrong                    = 18
        no_difference                  = 19
        no_negative_quantities         = 20
        wrong_zero_stock_check         = 21
        su_not_found                   = 22
        no_stock_on_su                 = 23
        su_wrong                       = 24
        too_many_su                    = 25
        nothing_to_do                  = 26
        no_unit_of_measure             = 27
        xfeld_wrong                    = 28
        update_without_commit          = 29
        no_authority                   = 30
        lqnum_missing                  = 31
        charg_missing                  = 32
        no_sobkz                       = 33
        no_charg                       = 34
        nlpla_wrong                    = 35
        two_step_confirmation_required = 36
        two_step_conf_not_allowed      = 37
        pick_confirmation_missing      = 38
        quknz_wrong                    = 39
        hu_data_wrong                  = 40
        hu_data_missing                = 41
        hu_not_found                   = 42
        no_hu_data_required            = 43
        not_enough_stock_in_hu         = 44
        serial_number_data_wrong       = 45
        serial_numbers_not_required    = 46
        serial_number_not_available    = 47
        serial_number_data_missing     = 48
        to_item_split_not_allowed      = 49
        input_wrong                    = 50
        picking_of_hu_not_possible     = 51
        OTHERS                         = 52.

    IF sy-subrc <> 0.
      ev_subrc = sy-subrc.
      add_bapiret2(
        EXPORTING
          iv_type    = 'E'
          iv_id      = 'L3'
          iv_number  = '120'
          iv_message = |Error confirming Transfer Order { iv_tanum }: exception { sy-subrc }|
        CHANGING
          ct_return  = et_return ).
      RETURN.
    ENDIF.

    ev_subrc = 0.
    add_bapiret2(
      EXPORTING
        iv_type    = 'S'
        iv_id      = 'L3'
        iv_number  = '121'
        iv_message = |Transfer Order { iv_tanum } confirmed successfully|
      CHANGING
        ct_return  = et_return ).

  ENDMETHOD.


  METHOD post_migo.
    DATA: ls_head    TYPE bapi2017_gm_head_01,
          ls_code    TYPE bapi2017_gm_code,
          lt_items   TYPE STANDARD TABLE OF bapi2017_gm_item_create,
          ls_item    TYPE bapi2017_gm_item_create,
          ls_headret TYPE bapi2017_gm_head_ret,
          lt_ret     TYPE STANDARD TABLE OF bapiret2.

    CLEAR: ev_mblnr, ev_mjahr, et_return, ev_subrc.

    " Map GM_CODE: 03 for GI 201/241, 04 for Transfer 311/301, 06 for universal reservation fallback
    CASE iv_bwart.
      WHEN '201' OR '241'.
        ls_code-gm_code = '03'.
      WHEN '311' OR '301'.
        ls_code-gm_code = '04'.
      WHEN OTHERS.
        ls_code-gm_code = '06'.
    ENDCASE.

    ls_head-pstng_date = sy-datum.
    ls_head-doc_date   = sy-datum.
    ls_head-ref_doc_no = |RES { iv_rsnum }|.

    CLEAR ls_item.
    ls_item-material   = iv_matnr.
    ls_item-plant      = iv_werks.
    ls_item-stge_loc   = iv_lgort.
    ls_item-move_type  = iv_bwart.
    ls_item-entry_qnt  = iv_menge.
    ls_item-entry_uom  = iv_meins.
    ls_item-reserv_no  = iv_rsnum.
    ls_item-res_item   = iv_rspos.
    ls_item-no_more_gr = 'X'. " Close reservation item (RESB-KZEAR = 'X')

    IF iv_umwrk IS NOT INITIAL.
      ls_item-move_plant = iv_umwrk.
    ENDIF.
    IF iv_umlgo IS NOT INITIAL.
      ls_item-move_stloc = iv_umlgo.
    ENDIF.
    IF iv_kostl IS NOT INITIAL.
      ls_item-costcenter = iv_kostl.
    ENDIF.
    IF iv_anln1 IS NOT INITIAL.
      ls_item-asset_no   = iv_anln1.
      ls_item-sub_number = iv_anln2.
    ENDIF.

    APPEND ls_item TO lt_items.

    CALL FUNCTION 'BAPI_GOODSMVT_CREATE'
      EXPORTING
        goodsmvt_header  = ls_head
        goodsmvt_code    = ls_code
        testrun          = iv_testrun
      IMPORTING
        goodsmvt_headret = ls_headret
      TABLES
        goodsmvt_item    = lt_items
        return           = lt_ret.

    et_return = lt_ret.

    LOOP AT lt_ret TRANSPORTING NO FIELDS WHERE type CA 'EA'.
      ev_subrc = 4.
      EXIT.
    ENDLOOP.

    IF ev_subrc = 0 AND ls_headret-mat_doc IS NOT INITIAL.
      ev_mblnr = ls_headret-mat_doc.
      ev_mjahr = ls_headret-doc_year.
      IF iv_testrun IS INITIAL.
        CALL FUNCTION 'BAPI_TRANSACTION_COMMIT'
          EXPORTING
            wait = 'X'.
      ENDIF.
    ELSEIF ev_subrc <> 0 AND iv_testrun IS INITIAL.
      CALL FUNCTION 'BAPI_TRANSACTION_ROLLBACK'.
    ENDIF.

  ENDMETHOD.


  METHOD update_status.
    DATA: ls_track TYPE zres_track,
          ls_log   TYPE zres_log.

    CLEAR: es_track, ev_subrc.

    IF iv_rsnum IS INITIAL.
      ev_subrc = 4.
      RETURN.
    ENDIF.

    " 1. Read existing record or initialize
    SELECT SINGLE * FROM zres_track
      WHERE rsnum = @iv_rsnum
        AND rspos = @iv_rspos
      INTO @ls_track.

    IF sy-subrc <> 0.
      ls_track-mandt      = sy-mandt.
      ls_track-rsnum      = iv_rsnum.
      ls_track-rspos      = iv_rspos.
      ls_track-created_by = sy-uname.
      ls_track-created_on = sy-datum.
      ls_track-created_at = sy-uzeit.
    ENDIF.

    " 2. Apply optional updates
    IF iv_move_type IS NOT INITIAL. ls_track-move_type = iv_move_type. ENDIF.
    IF iv_lgnum     IS NOT INITIAL. ls_track-lgnum     = iv_lgnum.     ENDIF.
    IF iv_tbnum     IS NOT INITIAL. ls_track-tbnum     = iv_tbnum.     ENDIF.
    IF iv_tanum     IS NOT INITIAL. ls_track-tanum     = iv_tanum.     ENDIF.
    IF iv_mblnr     IS NOT INITIAL. ls_track-mblnr     = iv_mblnr.     ENDIF.
    IF iv_mjahr     IS NOT INITIAL. ls_track-mjahr     = iv_mjahr.     ENDIF.
    IF iv_status    IS NOT INITIAL. ls_track-status    = iv_status.    ENDIF.
    IF iv_err_msg   IS NOT INITIAL. ls_track-err_msg   = iv_err_msg.   ENDIF.

    ls_track-changed_by = sy-uname.
    ls_track-changed_on = sy-datum.
    ls_track-changed_at = sy-uzeit.

    MODIFY zres_track FROM ls_track.
    IF sy-subrc = 0.
      es_track = ls_track.
      ev_subrc = 0.
    ELSE.
      ev_subrc = sy-subrc.
      RETURN.
    ENDIF.

    " 3. Record step-wise log in ZRES_LOG if step is provided
    IF iv_step IS NOT INITIAL.
      CLEAR ls_log.
      ls_log-mandt   = sy-mandt.
      TRY.
          ls_log-log_id = cl_system_uuid=>create_uuid_c32_static( ).
        CATCH cx_uuid_error.
          ls_log-log_id = |{ sy-datum }{ sy-uzeit }{ sy-tabix }|.
      ENDTRY.
      ls_log-rsnum      = iv_rsnum.
      ls_log-rspos      = iv_rspos.
      ls_log-step       = iv_step.
      ls_log-status     = COND #( WHEN iv_status IS NOT INITIAL THEN iv_status ELSE ls_track-status ).
      ls_log-msgty      = COND #( WHEN iv_msgty IS NOT INITIAL THEN iv_msgty ELSE 'I' ).
      ls_log-msgid      = iv_msgid.
      ls_log-msgno      = iv_msgno.
      ls_log-message    = iv_message.
      ls_log-created_by = sy-uname.
      ls_log-created_on = sy-datum.
      ls_log-created_at = sy-uzeit.

      MODIFY zres_log FROM ls_log.
    ENDIF.

  ENDMETHOD.


  METHOD add_bapiret2.
    DATA: ls_ret TYPE bapiret2.

    ls_ret-type       = iv_type.
    ls_ret-id         = iv_id.
    ls_ret-number     = iv_number.
    ls_ret-message    = iv_message.
    ls_ret-message_v1 = iv_v1.
    ls_ret-message_v2 = iv_v2.
    APPEND ls_ret TO ct_return.
  ENDMETHOD.

ENDCLASS.
