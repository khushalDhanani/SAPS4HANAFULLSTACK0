CLASS zcl_res_process_bgpf DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC .

  PUBLIC SECTION.

    INTERFACES if_bgmc_op_single_tx_uncontr .

    TYPES ty_process_id TYPE sysuuid_x16 .

    METHODS constructor
      IMPORTING
        !iv_process_id TYPE ty_process_id
        !iv_step       TYPE char10 .

  PROTECTED SECTION.
  PRIVATE SECTION.

    DATA mv_process_id TYPE ty_process_id .
    DATA mv_step       TYPE char10 .

ENDCLASS.



CLASS zcl_res_process_bgpf IMPLEMENTATION.

  METHOD constructor.
    me->mv_process_id = iv_process_id.
    me->mv_step       = iv_step.
  ENDMETHOD.

  METHOD if_bgmc_op_single_tx_uncontr~execute.
    DATA: lo_proc   TYPE REF TO zcl_res_process,
          ls_track  TYPE zres_track,
          lt_return TYPE zcl_res_process=>tt_bapiret2,
          lv_subrc  TYPE sysubrc,
          lv_tbnum  TYPE tbnum,
          lv_tbpos  TYPE tbpos,
          lv_tanum  TYPE tanum,
          lv_mblnr  TYPE mblnr,
          lv_mjahr  TYPE mjahr.

    CREATE OBJECT lo_proc.

    SELECT SINGLE * FROM zres_track
      WHERE process_id = @me->mv_process_id
      INTO @ls_track.

    IF sy-subrc <> 0.
      RETURN.
    ENDIF.

    CASE me->mv_step.
      WHEN 'LB01'. " Create Transfer Requirement
        lo_proc->create_tr(
          EXPORTING
            iv_lgnum  = ls_track-lgnum
            iv_bwlvs  = '311' " or mapped WM movement
            iv_matnr  = ls_track-matnr
            iv_werks  = ls_track-werks
            iv_lgort  = ls_track-lgort
            iv_menga  = ls_track-menge
            iv_altme  = ls_track-meins
            iv_rsnum  = ls_track-rsnum
            iv_rspos  = ls_track-rspos
          IMPORTING
            ev_tbnum  = lv_tbnum
            ev_tbpos  = lv_tbpos
            et_return = lt_return
            ev_subrc  = lv_subrc ).

        IF lv_subrc = 0.
          lo_proc->update_status(
            iv_rsnum      = ls_track-rsnum
            iv_rspos      = ls_track-rspos
            iv_process_id = ls_track-process_id
            iv_tbnum      = lv_tbnum
            iv_status     = zcl_res_process=>gc_status_02
            iv_step       = 'LB01'
            iv_message    = |TR { lv_tbnum } created| ).
        ELSE.
          lo_proc->update_status(
            iv_rsnum      = ls_track-rsnum
            iv_rspos      = ls_track-rspos
            iv_process_id = ls_track-process_id
            iv_status     = zcl_res_process=>gc_status_11
            iv_error_step = 'LB01'
            iv_err_msg    = VALUE #( lt_return[ 1 ]-message DEFAULT 'TR creation failed' )
            iv_step       = 'LB01'
            iv_msgty      = 'E' ).
        ENDIF.

      WHEN 'LT04'. " Create Transfer Order
        lo_proc->create_to_from_tr(
          EXPORTING
            iv_lgnum  = ls_track-lgnum
            iv_tbnum  = ls_track-tbnum
          IMPORTING
            ev_tanum  = lv_tanum
            et_return = lt_return
            ev_subrc  = lv_subrc ).

        IF lv_subrc = 0.
          lo_proc->update_status(
            iv_rsnum      = ls_track-rsnum
            iv_rspos      = ls_track-rspos
            iv_process_id = ls_track-process_id
            iv_tanum      = lv_tanum
            iv_status     = zcl_res_process=>gc_status_03
            iv_step       = 'LT04'
            iv_message    = |TO { lv_tanum } created| ).
        ELSE.
          lo_proc->update_status(
            iv_rsnum      = ls_track-rsnum
            iv_rspos      = ls_track-rspos
            iv_process_id = ls_track-process_id
            iv_status     = zcl_res_process=>gc_status_12
            iv_error_step = 'LT04'
            iv_err_msg    = VALUE #( lt_return[ 1 ]-message DEFAULT 'TO creation failed' )
            iv_step       = 'LT04'
            iv_msgty      = 'E' ).
        ENDIF.

      WHEN 'LT12'. " Confirm Transfer Order
        lo_proc->confirm_to(
          EXPORTING
            iv_lgnum  = ls_track-lgnum
            iv_tanum  = ls_track-tanum
          IMPORTING
            ev_subrc  = lv_subrc
            et_return = lt_return ).

        IF lv_subrc = 0.
          lo_proc->update_status(
            iv_rsnum      = ls_track-rsnum
            iv_rspos      = ls_track-rspos
            iv_process_id = ls_track-process_id
            iv_conf_menge = ls_track-menge
            iv_status     = zcl_res_process=>gc_status_04
            iv_step       = 'LT12'
            iv_message    = |TO { ls_track-tanum } confirmed| ).
        ELSE.
          lo_proc->update_status(
            iv_rsnum      = ls_track-rsnum
            iv_rspos      = ls_track-rspos
            iv_process_id = ls_track-process_id
            iv_status     = zcl_res_process=>gc_status_13
            iv_error_step = 'LT12'
            iv_err_msg    = VALUE #( lt_return[ 1 ]-message DEFAULT 'TO confirmation failed' )
            iv_step       = 'LT12'
            iv_msgty      = 'E' ).
        ENDIF.

      WHEN 'MIGO'. " Post Goods Movement
        lo_proc->post_migo(
          EXPORTING
            iv_rsnum        = ls_track-rsnum
            iv_rspos        = ls_track-rspos
            iv_bwart        = ls_track-move_type
            iv_matnr        = ls_track-matnr
            iv_werks        = ls_track-werks
            iv_lgort        = ls_track-lgort
            iv_menge        = COND #( WHEN ls_track-conf_menge IS NOT INITIAL THEN ls_track-conf_menge ELSE ls_track-menge )
            iv_meins        = ls_track-meins
            iv_ref_text     = ls_track-ref_text
            iv_complete_res = ls_track-complete_res
          IMPORTING
            ev_mblnr        = lv_mblnr
            ev_mjahr        = lv_mjahr
            et_return       = lt_return
            ev_subrc        = lv_subrc ).

        IF lv_subrc = 0.
          lo_proc->update_status(
            iv_rsnum      = ls_track-rsnum
            iv_rspos      = ls_track-rspos
            iv_process_id = ls_track-process_id
            iv_mblnr      = lv_mblnr
            iv_mjahr      = lv_mjahr
            iv_status     = zcl_res_process=>gc_status_05
            iv_step       = 'MIGO'
            iv_message    = |Material doc { lv_mblnr }/{ lv_mjahr } posted| ).
        ELSE.
          lo_proc->update_status(
            iv_rsnum      = ls_track-rsnum
            iv_rspos      = ls_track-rspos
            iv_process_id = ls_track-process_id
            iv_status     = zcl_res_process=>gc_status_90
            iv_error_step = 'MIGO'
            iv_err_msg    = VALUE #( lt_return[ 1 ]-message DEFAULT 'Goods movement failed' )
            iv_step       = 'MIGO'
            iv_msgty      = 'E' ).
        ENDIF.
    ENDCASE.
  ENDMETHOD.

ENDCLASS.
