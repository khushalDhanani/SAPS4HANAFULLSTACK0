FUNCTION zwm_tr_create
  IMPORTING
    VALUE(iv_lgnum) TYPE lgnum
    VALUE(iv_bwlvs) TYPE bwlvs DEFAULT '311'
    VALUE(iv_matnr) TYPE matnr
    VALUE(iv_werks) TYPE werks_d DEFAULT '1120'
    VALUE(iv_lgort) TYPE lgort_d DEFAULT 'CS01'
    VALUE(iv_menga) TYPE menga
    VALUE(iv_altme) TYPE altme DEFAULT 'KG'
    VALUE(iv_rsnum) TYPE rsnum OPTIONAL
    VALUE(iv_rspos) TYPE rspos OPTIONAL
    VALUE(iv_commit) TYPE char1 DEFAULT 'X'
  EXPORTING
    VALUE(ev_tbnum) TYPE ltbk-tbnum
    VALUE(ev_tbpos) TYPE ltbp-tbpos
    VALUE(ev_success) TYPE char1
    VALUE(ev_message) TYPE bapi_msg
  TABLES
    it_items LIKE ltba OPTIONAL
    et_messages LIKE bapiret2 OPTIONAL.

*"----------------------------------------------------------------------
*" Technical Specification & ABAP Implementation:
*" Function Module: ZWM_TR_CREATE (Package Z001, Function Group ZWM_FINISHEDGOODS)
*" Purpose: Remote-enabled wrapper for standard WM Transfer Requirement
*"          creation (L_TR_CREATE) to overcome SAP Note 2295840 RFC Blacklist.
*"----------------------------------------------------------------------

  DATA: lt_ltba   TYPE TABLE OF ltba,
        ls_ltba   TYPE ltba,
        ls_return TYPE bapiret2,
        lv_matnr  TYPE matnr,
        lv_rsnum  TYPE rsnum,
        lv_rspos  TYPE rspos.

  CLEAR: ev_tbnum, ev_tbpos, ev_success, ev_message.
  REFRESH: et_messages[].

  " 1. If explicit IT_ITEMS table passed, use it directly
  IF it_items[] IS NOT INITIAL.
    lt_ltba[] = it_items[].
  ELSE.
    " 2. Format single item from importing parameters
    CLEAR ls_ltba.
    ls_ltba-lgnum = iv_lgnum.
    ls_ltba-bwlvs = iv_bwlvs.

    " Leading zeros for material
    IF iv_matnr IS NOT INITIAL.
      lv_matnr = |{ iv_matnr ALPHA = IN }|.
      ls_ltba-matnr = lv_matnr.
    ENDIF.

    ls_ltba-werks = iv_werks.
    ls_ltba-lgort = iv_lgort.
    ls_ltba-menga = iv_menga.
    ls_ltba-altme = iv_altme.

    " Reservation link
    IF iv_rsnum IS NOT INITIAL.
      lv_rsnum = |{ iv_rsnum ALPHA = IN }|.
      ls_ltba-rsnum = lv_rsnum.
    ENDIF.

    IF iv_rspos IS NOT INITIAL.
      lv_rspos = |{ iv_rspos ALPHA = IN }|.
      ls_ltba-rspos = lv_rspos.
    ELSE.
      ls_ltba-rspos = '0001'.
    ENDIF.

    APPEND ls_ltba TO lt_ltba.
  ENDIF.

  " 3. Call internal SAP Transfer Requirement creation routine (L_TR_CREATE)
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

  IF sy-subrc = 0.
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

  " 4. Error handling
  ev_success = 'E'.
  ev_message = |Failed to create Transfer Requirement in warehouse { iv_lgnum } (sy-subrc = { sy-subrc }).|.

  ls_return-type    = 'E'.
  ls_return-id      = 'L3'.
  ls_return-number  = '999'.
  ls_return-message = ev_message.
  APPEND ls_return TO et_messages.

ENDFUNCTION.
