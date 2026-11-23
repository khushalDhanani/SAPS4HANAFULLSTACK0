FUNCTION zwm_to_create_from_tr
  IMPORTING
    VALUE(iv_lgnum) TYPE lgnum
    VALUE(iv_tbnum) TYPE ltbk-tbnum
    VALUE(iv_commit) TYPE char1 DEFAULT 'X'
  EXPORTING
    VALUE(ev_tanum) TYPE ltak-tanum
    VALUE(ev_success) TYPE char1
    VALUE(ev_message) TYPE bapi_msg
  TABLES
    it_items LIKE l03b_trite OPTIONAL
    et_messages LIKE bapiret2 OPTIONAL.




DATA: ls_hdr      TYPE ltbk,
        lt_trite    TYPE TABLE OF l03b_trite,
        ls_trite    TYPE l03b_trite,
        lt_ltak     TYPE TABLE OF ltak_vb,
        lt_ltap_vb  TYPE TABLE OF ltap_vb,
        lv_tbnum    TYPE ltbk-tbnum,
        ls_return   TYPE bapiret2.

  CLEAR: ev_tanum, ev_success, ev_message, et_messages[].

  " 1. Format TR Number with leading zeros
  lv_tbnum = |{ iv_tbnum ALPHA = IN }|.

  " 2. Fetch TR Header details from LTBK
  SELECT SINGLE *
    FROM ltbk
    INTO ls_hdr
   WHERE lgnum = iv_lgnum
     AND tbnum = lv_tbnum.

  IF sy-subrc <> 0.
    ev_success = 'E'.
    ev_message = |Transfer Requirement { lv_tbnum } not found in warehouse { iv_lgnum }.|.

    ls_return-type       = 'E'.
    ls_return-id         = 'L3'.
    ls_return-number     = '000'.
    ls_return-message    = ev_message.
    APPEND ls_return TO et_messages.
    RETURN.
  ENDIF.

  " 3. Map scanned items to internal table
  LOOP AT it_items INTO DATA(ls_item).
    CLEAR ls_trite.
    MOVE-CORRESPONDING ls_item TO ls_trite.

    " Use Destination bin/type from TR Header if not provided in item
    IF ls_trite-nltyp IS INITIAL.
      ls_trite-nltyp = ls_hdr-nltyp.
    ENDIF.
    IF ls_trite-nlpla IS INITIAL.
      ls_trite-nlpla = ls_hdr-nlpla.
    ENDIF.

    " Ensure Storage Unit (SU) barcode has leading zeros if provided
    IF ls_trite-vlenr IS NOT INITIAL.
      ls_trite-vlenr = |{ ls_trite-vlenr ALPHA = IN }|.
    ENDIF.

    APPEND ls_trite TO lt_trite.
  ENDLOOP.

  " 4. Call standard SAP TO creation routine
  CALL FUNCTION 'L_TO_CREATE_TR'
    EXPORTING
      i_lgnum                        = ls_hdr-lgnum
      i_tbnum                        = ls_hdr-tbnum
      i_commit_work                  = iv_commit
      i_bname                        = sy-uname
      i_rsnum                        = ls_hdr-rsnum
      it_trite                       = lt_trite
    IMPORTING
      e_tanum                        = ev_tanum
    TABLES
      t_ltak                         = lt_ltak
      t_ltap_vb                      = lt_ltap_vb
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

  IF sy-subrc = 0 AND ev_tanum IS NOT INITIAL.
    ev_success = 'S'.
    ev_message = |Transfer Order { ev_tanum } created successfully.|.

    ls_return-type    = 'S'.
    ls_return-message = ev_message.
    APPEND ls_return TO et_messages.

    IF iv_commit = 'X'.
      COMMIT WORK AND WAIT.
    ENDIF.
  ELSE.
    ev_success = 'E'.

    IF sy-msgid IS NOT INITIAL.
      MESSAGE ID sy-msgid TYPE 'S' NUMBER sy-msgno
        WITH sy-msgv1 sy-msgv2 sy-msgv3 sy-msgv4
        INTO ev_message.
   ELSE.
      CASE sy-subrc.
        WHEN 1.
          ev_message = 'TR or Warehouse is currently locked by another user (foreign_lock).'.
        WHEN 2.
          ev_message = 'Material is QM relevant.'.
        WHEN 3.
          ev_message = 'Transfer Requirement is already completed.'.
        WHEN 7.
          ev_message = 'Transfer Requirement is incorrect or invalid.'.
        WHEN 9.
          ev_message = 'No Transfer Order created. Check available stock and bin assignment.'.
        WHEN 11.
          ev_message = 'No authorization to create Transfer Order.'.
        WHEN 14.
          ev_message = 'Input error in item quantities or bins.'.
        WHEN OTHERS.
          ev_message = |Failed to create Transfer Order. Subrc error code: { sy-subrc }.|.
      ENDCASE.
    ENDIF.

    ls_return-type    = 'E'.
    ls_return-message = ev_message.
    APPEND ls_return TO et_messages.
  ENDIF.



ENDFUNCTION.