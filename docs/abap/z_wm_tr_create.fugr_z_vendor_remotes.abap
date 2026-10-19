FUNCTION z_wm_tr_create
  IMPORTING
    VALUE(iv_lgnum) TYPE lgnum
    VALUE(iv_bwlvs) TYPE bwlvs DEFAULT '311'
    VALUE(iv_matnr) TYPE matnr
    VALUE(iv_werks) TYPE werks_d DEFAULT '1120'
    VALUE(iv_lgort) TYPE lgort_d DEFAULT 'CS01'
    VALUE(iv_menga) TYPE ltbp_menga
    VALUE(iv_altme) TYPE lrmei DEFAULT 'KG'
    VALUE(iv_rsnum) TYPE rsnum OPTIONAL
    VALUE(iv_rspos) TYPE rspos OPTIONAL
    VALUE(iv_commit) TYPE char1 DEFAULT 'X'
    VALUE(iv_betyp) TYPE ltbk-betyp OPTIONAL
    VALUE(iv_benum) TYPE ltbk-benum OPTIONAL
  EXPORTING
    VALUE(ev_tbnum) TYPE ltbk-tbnum
    VALUE(ev_tbpos) TYPE ltbp-tbpos
    VALUE(ev_success) TYPE char1
    VALUE(ev_message) TYPE bapi_msg
  TABLES
    et_messages TYPE bapiret2_t OPTIONAL.



  DATA: lt_ltba   TYPE TABLE OF ltba,
        ls_ltba   TYPE ltba,
        ls_return TYPE bapiret2.

  CLEAR: ev_tbnum, ev_tbpos, ev_success, ev_message, et_messages[].

  " 1. Format single item from importing parameters
  CLEAR ls_ltba.
  ls_ltba-lgnum = iv_lgnum.
  ls_ltba-bwlvs = iv_bwlvs.

  CALL FUNCTION 'CONVERSION_EXIT_MATN1_INPUT'
    EXPORTING
      input  = iv_matnr
    IMPORTING
      output = ls_ltba-matnr
    EXCEPTIONS
      OTHERS = 1.
  IF sy-subrc <> 0.
    ls_ltba-matnr = iv_matnr.
  ENDIF.

  ls_ltba-werks = iv_werks.
  ls_ltba-lgort = iv_lgort.
  ls_ltba-menga = iv_menga.
  ls_ltba-altme = iv_altme.

  " Requirement type / number for dynamic-coordinate WM movements (T333 NKDYN):
  " 201 -> K + cost centre, 241 -> A + asset, 261 -> F + order. BENUM is CHAR10, no conversion exit.
  IF iv_betyp IS NOT INITIAL.
    ls_ltba-betyp = iv_betyp.
  ENDIF.
  IF iv_benum IS NOT INITIAL.
    ls_ltba-benum = iv_benum.
  ENDIF.

  IF iv_rsnum IS NOT INITIAL.
    CALL FUNCTION 'CONVERSION_EXIT_ALPHA_INPUT'
      EXPORTING
        input  = iv_rsnum
      IMPORTING
        output = ls_ltba-rsnum.
  ENDIF.

  IF iv_rspos IS NOT INITIAL.
    CALL FUNCTION 'CONVERSION_EXIT_ALPHA_INPUT'
      EXPORTING
        input  = iv_rspos
      IMPORTING
        output = ls_ltba-rspos.
  ELSE.
    ls_ltba-rspos = '0001'.
  ENDIF.

  APPEND ls_ltba TO lt_ltba.

  " 2. Call standard SAP Transfer Requirement creation routine (L_TR_CREATE)
  CALL FUNCTION 'L_TR_CREATE'
    EXPORTING
      i_commit_work         = iv_commit
      i_save_only_all       = 'X'
      i_single_item         = 'X'
    TABLES
      t_ltba                = lt_ltba
    EXCEPTIONS
      item_error            = 1
      item_without_number   = 2
      no_entry_in_int_table = 3
      no_update_item_error  = 4
      OTHERS                = 5.

  DATA(lv_subrc) = sy-subrc.

  IF lv_subrc = 0.
    READ TABLE lt_ltba INTO ls_ltba INDEX 1.
    IF sy-subrc = 0 AND ls_ltba-tbnum IS NOT INITIAL.
      ev_tbnum   = ls_ltba-tbnum.
      ev_tbpos   = ls_ltba-tbpos.
      ev_success = 'S'.
      ev_message = |Transfer Requirement { ev_tbnum } created successfully.|.

      ls_return-type    = 'S'.
      ls_return-id      = 'L3'.
      ls_return-number  = '001'.
      ls_return-message = ev_message.
      APPEND ls_return TO et_messages.

      IF iv_commit = 'X'.
        COMMIT WORK AND WAIT.
      ENDIF.
      RETURN.
    ENDIF.
  ENDIF.

  " 3. Error handling
  ev_success = 'E'.
  IF sy-msgid IS NOT INITIAL.
    MESSAGE ID sy-msgid TYPE 'S' NUMBER sy-msgno
      WITH sy-msgv1 sy-msgv2 sy-msgv3 sy-msgv4
      INTO ev_message.
  ELSE.
    ev_message = |Failed to create Transfer Requirement in warehouse { iv_lgnum } (L_TR_CREATE exception { lv_subrc }: 1 ITEM_ERROR, 2 ITEM_WITHOUT_NUMBER, 3 NO_ENTRY_IN_INT_TABLE, 4 NO_UPDATE_ITEM_ERROR).|.
  ENDIF.

  ls_return-type    = 'E'.
  ls_return-id      = sy-msgid.
  ls_return-number  = sy-msgno.
  ls_return-message = ev_message.
  APPEND ls_return TO et_messages.

ENDFUNCTION.