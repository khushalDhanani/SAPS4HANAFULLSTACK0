*&---------------------------------------------------------------------*
*& Report ZRES_PROCESS_TEST
*&---------------------------------------------------------------------*
*& Test Harness for Chunk 2: Reusable Class ZCL_RES_PROCESS
*& Tests each method in isolation and full lifecycle per movement type:
*&   - Movement 201: GI to Cost Center
*&   - Movement 241: GI to Asset
*&   - Movement 311: Transfer SLoc to SLoc (Plant 1120 HS01 -> CS01)
*&   - Movement 301: Transfer Plant to Plant (Plant 1120 -> 1130)
*&---------------------------------------------------------------------*
REPORT zres_process_test.

TABLES: zres_track.

SELECTION-SCREEN BEGIN OF BLOCK b1 WITH FRAME TITLE TEXT-001.
  PARAMETERS: rb_stp1 RADIOBUTTON GROUP grp1 DEFAULT 'X', " 1. Test create_reservation only
              rb_stp2 RADIOBUTTON GROUP grp1,              " 2. Test create_tr only
              rb_stp3 RADIOBUTTON GROUP grp1,              " 3. Test create_to_from_tr only
              rb_stp4 RADIOBUTTON GROUP grp1,              " 4. Test confirm_to only
              rb_stp5 RADIOBUTTON GROUP grp1,              " 5. Test post_migo only
              rb_full RADIOBUTTON GROUP grp1.              " 6. Full end-to-end cycle
SELECTION-SCREEN END OF BLOCK b1.

SELECTION-SCREEN BEGIN OF BLOCK b2 WITH FRAME TITLE TEXT-002.
  PARAMETERS: rb_311 RADIOBUTTON GROUP grp2 DEFAULT 'X',  " Movement 311 (SLoc Transfer)
              rb_201 RADIOBUTTON GROUP grp2,              " Movement 201 (Cost Center)
              rb_241 RADIOBUTTON GROUP grp2,              " Movement 241 (Asset)
              rb_301 RADIOBUTTON GROUP grp2.              " Movement 301 (Plant Transfer)
SELECTION-SCREEN END OF BLOCK b2.

SELECTION-SCREEN BEGIN OF BLOCK b3 WITH FRAME TITLE TEXT-003.
  PARAMETERS: p_werks TYPE werks_d     DEFAULT '1120',
              p_lgort TYPE lgort_d     DEFAULT 'HS01',
              p_matnr TYPE matnr       DEFAULT '000000008000000023',
              p_menge TYPE erfmg       DEFAULT '1.000',
              p_meins TYPE erfme       DEFAULT 'NOS',
              p_lgnum TYPE lgnum       DEFAULT 'W01',
              p_umlgo TYPE umlgo       DEFAULT 'CS01',
              p_umwrk TYPE umwrk       DEFAULT '1130',
              p_kostl TYPE kostl       DEFAULT '1011201301',
              p_anln1 TYPE anln1       DEFAULT '000000400092',
              p_anln2 TYPE anln2       DEFAULT '0000',
              p_test  TYPE xfeld       DEFAULT ' '.
SELECTION-SCREEN END OF BLOCK b3.

SELECTION-SCREEN BEGIN OF BLOCK b4 WITH FRAME TITLE TEXT-004.
  " Input keys for testing isolated steps 2, 3, 4, 5
  PARAMETERS: p_rsnum TYPE rsnum,
              p_rspos TYPE rspos DEFAULT '0001',
              p_tbnum TYPE tbnum,
              p_tanum TYPE tanum.
SELECTION-SCREEN END OF BLOCK b4.

DATA: go_process TYPE REF TO zcl_res_process,
      gv_bwart   TYPE bwart,
      gv_bwlvs   TYPE bwlvs,
      gv_rsnum   TYPE rsnum,
      gv_rspos   TYPE rspos,
      gv_tbnum   TYPE tbnum,
      gv_tbpos   TYPE tbpos,
      gv_tanum   TYPE tanum,
      gv_mblnr   TYPE mblnr,
      gv_mjahr   TYPE mjahr,
      gt_ret     TYPE zcl_res_process=>tt_bapiret2,
      gv_subrc   TYPE sysubrc,
      gs_track   TYPE zres_track.

START-OF-SELECTION.

  CREATE OBJECT go_process.

  " 1. Determine Movement Type
  IF rb_311 = 'X'.
    gv_bwart = '311'. gv_bwlvs = '311'.
  ELSEIF rb_201 = 'X'.
    gv_bwart = '201'. gv_bwlvs = '201'.
  ELSEIF rb_241 = 'X'.
    gv_bwart = '241'. gv_bwlvs = '241'.
  ELSEIF rb_301 = 'X'.
    gv_bwart = '301'. gv_bwlvs = '301'.
  ENDIF.

  WRITE: / '========================================================================',
         / |EXECUTION REPORT: ZCL_RES_PROCESS (Movement { gv_bwart })|,
         / '========================================================================'.

  " ----------------------------------------------------------------------
  " Step 1: create_reservation
  " ----------------------------------------------------------------------
  IF rb_stp1 = 'X' OR rb_full = 'X'.
    WRITE: / '--- Step 1: create_reservation (BAPI_RESERVATION_CREATE1) ---'.

    go_process->create_reservation(
      EXPORTING
        iv_bwart   = gv_bwart
        iv_werks   = p_werks
        iv_lgort   = p_lgort
        iv_matnr   = p_matnr
        iv_menge   = p_menge
        iv_meins   = p_meins
        iv_umlgo   = COND #( WHEN gv_bwart = '311' THEN p_umlgo )
        iv_umwrk   = COND #( WHEN gv_bwart = '301' THEN p_umwrk )
        iv_kostl   = COND #( WHEN gv_bwart = '201' THEN p_kostl )
        iv_anln1   = COND #( WHEN gv_bwart = '241' THEN p_anln1 )
        iv_anln2   = COND #( WHEN gv_bwart = '241' THEN p_anln2 )
        iv_testrun = COND #( WHEN p_test = 'X' THEN 'X' )
      IMPORTING
        ev_rsnum   = gv_rsnum
        ev_rspos   = gv_rspos
        et_return  = gt_ret
        ev_subrc   = gv_subrc ).

    PERFORM display_return TABLES gt_ret.

    IF gv_subrc = 0 AND gv_rsnum IS NOT INITIAL.
      WRITE: / |  [SUCCESS] Reservation created: { gv_rsnum } Item: { gv_rspos }|.

      " Update tracking status
      go_process->update_status(
        EXPORTING
          iv_rsnum     = gv_rsnum
          iv_rspos     = gv_rspos
          iv_move_type = gv_bwart
          iv_lgnum     = p_lgnum
          iv_status    = zcl_res_process=>gc_status_01
          iv_step      = zcl_res_process=>gc_step_mb21
          iv_msgty     = 'S'
          iv_message   = |Reservation { gv_rsnum } created via MB21|
        IMPORTING
          es_track     = gs_track
          ev_subrc     = gv_subrc ).

      WRITE: / |  [TRACKING] Table ZRES_TRACK status: { gs_track-status }|.
    ELSE.
      WRITE: / |  [FAILED] create_reservation returned subrc { gv_subrc }|.
      IF rb_full = 'X'. RETURN. ENDIF.
    ENDIF.
  ELSEIF p_rsnum IS NOT INITIAL.
    gv_rsnum = p_rsnum.
    gv_rspos = p_rspos.
  ENDIF.

  " ----------------------------------------------------------------------
  " Step 2: create_tr
  " ----------------------------------------------------------------------
  IF rb_stp2 = 'X' OR rb_full = 'X'.
    WRITE: / '--- Step 2: create_tr (L_TR_CREATE) ---'.

    IF gv_rsnum IS INITIAL.
      WRITE: / '  [ERROR] Reservation number required to create TR. Provide P_RSNUM.'.
      RETURN.
    ENDIF.

    go_process->create_tr(
      EXPORTING
        iv_lgnum  = p_lgnum
        iv_bwlvs  = gv_bwlvs
        iv_matnr  = p_matnr
        iv_werks  = p_werks
        iv_lgort  = p_lgort
        iv_menga  = p_menge
        iv_altme  = p_meins
        iv_rsnum  = gv_rsnum
        iv_rspos  = gv_rspos
      IMPORTING
        ev_tbnum  = gv_tbnum
        ev_tbpos  = gv_tbpos
        et_return = gt_ret
        ev_subrc  = gv_subrc ).

    PERFORM display_return TABLES gt_ret.

    IF gv_subrc = 0 AND gv_tbnum IS NOT INITIAL.
      WRITE: / |  [SUCCESS] TR created: { gv_tbnum } Item: { gv_tbpos }|.

      go_process->update_status(
        EXPORTING
          iv_rsnum   = gv_rsnum
          iv_rspos   = gv_rspos
          iv_tbnum   = gv_tbnum
          iv_status  = zcl_res_process=>gc_status_02
          iv_step    = zcl_res_process=>gc_step_lb01
          iv_msgty   = 'S'
          iv_message = |Transfer Requirement { gv_tbnum } created via LB01|
        IMPORTING
          es_track   = gs_track
          ev_subrc   = gv_subrc ).

      WRITE: / |  [TRACKING] Table ZRES_TRACK status: { gs_track-status } (TBNUM: { gs_track-tbnum })|.
    ELSE.
      WRITE: / |  [FAILED] create_tr returned subrc { gv_subrc }|.
      IF rb_full = 'X'. RETURN. ENDIF.
    ENDIF.
  ELSEIF p_tbnum IS NOT INITIAL.
    gv_tbnum = p_tbnum.
  ENDIF.

  " ----------------------------------------------------------------------
  " Step 3: create_to_from_tr
  " ----------------------------------------------------------------------
  IF rb_stp3 = 'X' OR rb_full = 'X'.
    WRITE: / '--- Step 3: create_to_from_tr (L_TO_CREATE_TR) ---'.

    IF gv_tbnum IS INITIAL.
      WRITE: / '  [ERROR] TR number required to create TO. Provide P_TBNUM.'.
      RETURN.
    ENDIF.

    go_process->create_to_from_tr(
      EXPORTING
        iv_lgnum  = p_lgnum
        iv_tbnum  = gv_tbnum
        iv_commit = COND #( WHEN p_test = ' ' THEN 'X' ELSE ' ' )
      IMPORTING
        ev_tanum  = gv_tanum
        et_return = gt_ret
        ev_subrc  = gv_subrc ).

    PERFORM display_return TABLES gt_ret.

    IF gv_subrc = 0 AND gv_tanum IS NOT INITIAL.
      WRITE: / |  [SUCCESS] TO created: { gv_tanum }|.

      IF gv_rsnum IS NOT INITIAL.
        go_process->update_status(
          EXPORTING
            iv_rsnum   = gv_rsnum
            iv_rspos   = gv_rspos
            iv_tanum   = gv_tanum
            iv_status  = zcl_res_process=>gc_status_03
            iv_step    = zcl_res_process=>gc_step_lt04
            iv_msgty   = 'S'
            iv_message = |Transfer Order { gv_tanum } created via LT04|
          IMPORTING
            es_track   = gs_track
            ev_subrc   = gv_subrc ).

        WRITE: / |  [TRACKING] Table ZRES_TRACK status: { gs_track-status } (TANUM: { gs_track-tanum })|.
      ENDIF.
    ELSE.
      WRITE: / |  [FAILED] create_to_from_tr returned subrc { gv_subrc }|.
      IF rb_full = 'X'. RETURN. ENDIF.
    ENDIF.
  ELSEIF p_tanum IS NOT INITIAL.
    gv_tanum = p_tanum.
  ENDIF.

  " ----------------------------------------------------------------------
  " Step 4: confirm_to
  " ----------------------------------------------------------------------
  IF rb_stp4 = 'X' OR rb_full = 'X'.
    WRITE: / '--- Step 4: confirm_to (L_TO_CONFIRM) ---'.

    IF gv_tanum IS INITIAL.
      WRITE: / '  [ERROR] TO number required to confirm TO. Provide P_TANUM.'.
      RETURN.
    ENDIF.

    go_process->confirm_to(
      EXPORTING
        iv_lgnum  = p_lgnum
        iv_tanum  = gv_tanum
        iv_squit  = 'X'
        iv_commit = COND #( WHEN p_test = ' ' THEN 'X' ELSE ' ' )
      IMPORTING
        ev_subrc  = gv_subrc
        et_return = gt_ret ).

    PERFORM display_return TABLES gt_ret.

    IF gv_subrc = 0.
      WRITE: / |  [SUCCESS] TO { gv_tanum } confirmed successfully|.

      IF gv_rsnum IS NOT INITIAL.
        go_process->update_status(
          EXPORTING
            iv_rsnum   = gv_rsnum
            iv_rspos   = gv_rspos
            iv_status  = zcl_res_process=>gc_status_04
            iv_step    = zcl_res_process=>gc_step_lt12
            iv_msgty   = 'S'
            iv_message = |Transfer Order { gv_tanum } confirmed via LT12|
          IMPORTING
            es_track   = gs_track
            ev_subrc   = gv_subrc ).

        WRITE: / |  [TRACKING] Table ZRES_TRACK status: { gs_track-status }|.
      ENDIF.
    ELSE.
      WRITE: / |  [FAILED] confirm_to returned subrc { gv_subrc }|.
      IF rb_full = 'X'. RETURN. ENDIF.
    ENDIF.
  ENDIF.

  " ----------------------------------------------------------------------
  " Step 5: post_migo
  " ----------------------------------------------------------------------
  IF rb_stp5 = 'X' OR rb_full = 'X'.
    WRITE: / '--- Step 5: post_migo (BAPI_GOODSMVT_CREATE) ---'.

    IF gv_rsnum IS INITIAL.
      WRITE: / '  [ERROR] Reservation number required to post MIGO. Provide P_RSNUM.'.
      RETURN.
    ENDIF.

    go_process->post_migo(
      EXPORTING
        iv_rsnum   = gv_rsnum
        iv_rspos   = gv_rspos
        iv_bwart   = gv_bwart
        iv_matnr   = p_matnr
        iv_werks   = p_werks
        iv_lgort   = p_lgort
        iv_menge   = p_menge
        iv_meins   = p_meins
        iv_umlgo   = COND #( WHEN gv_bwart = '311' THEN p_umlgo )
        iv_umwrk   = COND #( WHEN gv_bwart = '301' THEN p_umwrk )
        iv_kostl   = COND #( WHEN gv_bwart = '201' THEN p_kostl )
        iv_anln1   = COND #( WHEN gv_bwart = '241' THEN p_anln1 )
        iv_anln2   = COND #( WHEN gv_bwart = '241' THEN p_anln2 )
        iv_testrun = COND #( WHEN p_test = 'X' THEN 'X' )
      IMPORTING
        ev_mblnr   = gv_mblnr
        ev_mjahr   = gv_mjahr
        et_return  = gt_ret
        ev_subrc   = gv_subrc ).

    PERFORM display_return TABLES gt_ret.

    IF gv_subrc = 0 AND gv_mblnr IS NOT INITIAL.
      WRITE: / |  [SUCCESS] Material Document posted: { gv_mblnr }/{ gv_mjahr }|.

      go_process->update_status(
        EXPORTING
          iv_rsnum   = gv_rsnum
          iv_rspos   = gv_rspos
          iv_mblnr   = gv_mblnr
          iv_mjahr   = gv_mjahr
          iv_status  = zcl_res_process=>gc_status_05
          iv_step    = zcl_res_process=>gc_step_migo
          iv_msgty   = 'S'
          iv_message = |Material Document { gv_mblnr } posted via MIGO|
        IMPORTING
          es_track   = gs_track
          ev_subrc   = gv_subrc ).

      WRITE: / |  [TRACKING] Table ZRES_TRACK status: { gs_track-status } (MBLNR: { gs_track-mblnr })|.
    ELSE.
      WRITE: / |  [FAILED] post_migo returned subrc { gv_subrc }|.
    ENDIF.
  ENDIF.

*&---------------------------------------------------------------------*
*& Form display_return
*&---------------------------------------------------------------------*
FORM display_return TABLES pt_ret TYPE zcl_res_process=>tt_bapiret2.
  DATA: ls_ret TYPE bapiret2.
  LOOP AT pt_ret INTO ls_ret.
    WRITE: / |    [{ ls_ret-type }] { ls_ret-id }({ ls_ret-number }): { ls_ret-message }|.
  ENDLOOP.
ENDFORM.
