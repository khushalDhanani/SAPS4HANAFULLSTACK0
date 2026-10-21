FUNCTION z_wm_to_create_dn
  IMPORTING
    VALUE(iv_lgnum) TYPE lgnum
    VALUE(iv_vbeln) TYPE vbeln_vl
    VALUE(iv_squit) TYPE char1 DEFAULT 'X'
    VALUE(iv_commit) TYPE char1 DEFAULT 'X'
  EXPORTING
    VALUE(ev_tanum) TYPE ltak-tanum
    VALUE(ev_success) TYPE char1
    VALUE(ev_message) TYPE bapi_msg
  TABLES
    et_messages TYPE bapiret2_t OPTIONAL.

* RFC wrapper around L_TO_CREATE_DN (picking Transfer Order for an outbound delivery).
* Why: the kernel rejects the direct external call to L_TO_CREATE_DN ("Incompatible Call Rejected, see note 2295840",
* observed 2026-10-21 on DS4/220 for delivery 0080000134), exactly as for L_TR_CREATE, which Z_WM_TR_CREATE wraps.
* Same contract style as Z_WM_TR_CREATE: scalar parameters, EV_SUCCESS S/E, EV_MESSAGE, ET_MESSAGES.
* IV_SQUIT = 'X' confirms the TO immediately (pick quantity = delivery quantity).

  DATA: lv_vbeln  TYPE vbeln_vl,
        lv_tanum  TYPE ltak-tanum,
        ls_return TYPE bapiret2.

  CLEAR: ev_tanum, ev_success, ev_message, et_messages[].

  CALL FUNCTION 'CONVERSION_EXIT_ALPHA_INPUT'
    EXPORTING
      input  = iv_vbeln
    IMPORTING
      output = lv_vbeln.

  CALL FUNCTION 'L_TO_CREATE_DN'
    EXPORTING
      i_lgnum                    = iv_lgnum
      i_vbeln                    = lv_vbeln
      i_squit                    = iv_squit
      i_commit_work              = iv_commit
    IMPORTING
      e_tanum                    = lv_tanum
    EXCEPTIONS
      foreign_lock               = 1
      dn_completed               = 2
      partial_delivery_forbidden = 3
      xfeld_wrong                = 4
      ldest_wrong                = 5
      drukz_wrong                = 6
      dn_wrong                   = 7
      squit_forbidden            = 8
      no_to_created              = 9
      teilk_wrong                = 10
      update_without_commit      = 11
      no_authority               = 12
      no_picking_allowed         = 13
      dn_hu_not_choosable        = 14
      input_error                = 15
      OTHERS                     = 16.

  DATA(lv_subrc) = sy-subrc.

  IF lv_subrc = 0 AND lv_tanum IS NOT INITIAL.
    ev_tanum   = lv_tanum.
    ev_success = 'S'.
    ev_message = |Transfer Order { ev_tanum } created for delivery { lv_vbeln }{ COND #( WHEN iv_squit = 'X' THEN ' and confirmed' ) }.|.

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

  ev_success = 'E'.
  IF sy-msgid IS NOT INITIAL AND lv_subrc <> 0.
    MESSAGE ID sy-msgid TYPE 'S' NUMBER sy-msgno
      WITH sy-msgv1 sy-msgv2 sy-msgv3 sy-msgv4
      INTO ev_message.
  ELSE.
    ev_message = |Picking Transfer Order for delivery { lv_vbeln } in warehouse { iv_lgnum }| &&
                 | was not created (L_TO_CREATE_DN exception { lv_subrc }: 1 FOREIGN_LOCK,| &&
                 | 2 DN_COMPLETED, 3 PARTIAL_DELIVERY_FORBIDDEN, 7 DN_WRONG,| &&
                 | 9 NO_TO_CREATED, 12 NO_AUTHORITY, 13 NO_PICKING_ALLOWED).|.
  ENDIF.

  ls_return-type    = 'E'.
  ls_return-id      = sy-msgid.
  ls_return-number  = sy-msgno.
  ls_return-message = ev_message.
  APPEND ls_return TO et_messages.

ENDFUNCTION.
