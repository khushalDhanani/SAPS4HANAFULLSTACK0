*&---------------------------------------------------------------------*
*& Function Group   ZWM_POST_ATTEMPT      (PROPOSED name, free on 2026-11-03)
*& Package          ZAMM (user's choice; transport request pending)
*& Function Modules Z_WM_ATTEMPT_CLAIM, Z_WM_ATTEMPT_SET_STATUS,
*&                  Z_WM_ATTEMPT_READ     (all Remote-Enabled Module (RFC))
*&---------------------------------------------------------------------*
*& STATUS: PROPOSAL FOR REVIEW. Not created, not activated, not transported,
*&   never executed. Table: docs/abap/zwm_post_attempt.tabl.ddl.
*&
*& Purpose: durable double-post guard for the CAP layer, replacing the
*&   application table GoodsIssuePostingAttempt. A claim is committed before
*&   the goods movement is sent, so it survives a crash, and the primary key
*&   lets only one of two parallel claims win (UNSURE until proven with two
*&   parallel sessions, see the migration document).
*&
*& Each call commits. Call it on its OWN connection (RfcClient.call), never
*&   inside the session() of a posting: COMMIT WORK here would also commit
*&   that LUW.
*& Lost answer: if the claim commits and its answer is lost, a retry gets
*&   EV_CREATED = ' ' and the row stays `sending` until the recheck resolves
*&   it. That blocks the posting, which is the safe side.
*& Authorization: no business check in these modules. Restrict with S_RFC on
*&   this function group; the role is for Basis to define (Not verified).
*&---------------------------------------------------------------------*

FUNCTION z_wm_attempt_claim.
*"----------------------------------------------------------------------
*"  IMPORTING
*"     VALUE(IS_ATTEMPT) TYPE ZWM_POST_ATTEMPT
*"  EXPORTING
*"     VALUE(EV_CREATED) TYPE CHAR1
*"     VALUE(ES_ATTEMPT) TYPE ZWM_POST_ATTEMPT
*"     VALUE(EV_SUCCESS) TYPE CHAR1
*"     VALUE(EV_MESSAGE) TYPE BAPI_MSG
*"----------------------------------------------------------------------
  DATA ls_attempt TYPE zwm_post_attempt.

  CLEAR: ev_created, es_attempt, ev_success, ev_message.

  IF is_attempt-reference_document IS INITIAL.
    ev_success = 'E'.
    ev_message = 'Reference document is required'.
    RETURN.
  ENDIF.

  ls_attempt = is_attempt.
  ls_attempt-mandt  = sy-mandt.
  ls_attempt-status = 'sending'.
  CLEAR: ls_attempt-resolved_at, ls_attempt-material_document,
         ls_attempt-material_doc_year, ls_attempt-delivery_number,
         ls_attempt-last_error.
  GET TIME STAMP FIELD ls_attempt-created_at.

  INSERT zwm_post_attempt FROM ls_attempt.
  IF sy-subrc = 0.
    COMMIT WORK.
    ev_created = 'X'.
    es_attempt = ls_attempt.
    ev_success = 'S'.
    RETURN.
  ENDIF.

  " Duplicate key: the reference is already claimed. The caller compares the request hash.
  SELECT SINGLE * FROM zwm_post_attempt
    WHERE reference_document = @is_attempt-reference_document
    INTO @es_attempt.
  IF sy-subrc = 0.
    ev_success = 'S'.
  ELSE.
    ev_success = 'E'.
    ev_message = 'Claim failed and no attempt exists for this reference'.
  ENDIF.
ENDFUNCTION.


FUNCTION z_wm_attempt_set_status.
*"----------------------------------------------------------------------
*"  IMPORTING
*"     VALUE(IV_REFERENCE) TYPE ZWM_POST_ATTEMPT-REFERENCE_DOCUMENT
*"     VALUE(IV_STATUS) TYPE ZWM_POST_ATTEMPT-STATUS
*"     VALUE(IV_MATERIAL_DOCUMENT) TYPE ZWM_POST_ATTEMPT-MATERIAL_DOCUMENT OPTIONAL
*"     VALUE(IV_MATERIAL_DOC_YEAR) TYPE ZWM_POST_ATTEMPT-MATERIAL_DOC_YEAR OPTIONAL
*"     VALUE(IV_DELIVERY_NUMBER) TYPE ZWM_POST_ATTEMPT-DELIVERY_NUMBER OPTIONAL
*"     VALUE(IV_LAST_ERROR) TYPE ZWM_POST_ATTEMPT-LAST_ERROR OPTIONAL
*"  EXPORTING
*"     VALUE(EV_SUCCESS) TYPE CHAR1
*"     VALUE(EV_MESSAGE) TYPE BAPI_MSG
*"----------------------------------------------------------------------
  DATA: ls_attempt     TYPE zwm_post_attempt,
        lv_resolved_at TYPE timestampl.

  CLEAR: ev_success, ev_message.

  CASE iv_status.
    WHEN 'posted' OR 'rejected' OR 'not_posted' OR 'needs-attention' OR 'delivery_created'.
      GET TIME STAMP FIELD lv_resolved_at.
    WHEN 'sending' OR 'unconfirmed' OR 'queued'.
      " Not final: resolved_at stays empty.
    WHEN OTHERS.
      ev_success = 'E'.
      ev_message = |Unknown attempt status { iv_status }|.
      RETURN.
  ENDCASE.

  " Row lock until the commit below: two parallel updates must not overwrite each other's fields.
  SELECT SINGLE FOR UPDATE * FROM zwm_post_attempt
    WHERE reference_document = @iv_reference
    INTO @ls_attempt.
  IF sy-subrc <> 0.
    ev_success = 'E'.
    ev_message = |No attempt exists for reference { iv_reference }|.
    RETURN.
  ENDIF.

  ls_attempt-status      = iv_status.
  ls_attempt-resolved_at = lv_resolved_at.
  " Only the fields the caller sent change, and an empty value clears a field.
  IF iv_material_document IS SUPPLIED.
    ls_attempt-material_document = iv_material_document.
  ENDIF.
  IF iv_material_doc_year IS SUPPLIED.
    ls_attempt-material_doc_year = iv_material_doc_year.
  ENDIF.
  IF iv_delivery_number IS SUPPLIED.
    ls_attempt-delivery_number = iv_delivery_number.
  ENDIF.
  IF iv_last_error IS SUPPLIED.
    ls_attempt-last_error = iv_last_error.
  ENDIF.

  UPDATE zwm_post_attempt FROM ls_attempt.
  IF sy-subrc = 0.
    COMMIT WORK.
    ev_success = 'S'.
  ELSE.
    ROLLBACK WORK.
    ev_success = 'E'.
    ev_message = |Attempt { iv_reference } could not be updated|.
  ENDIF.
ENDFUNCTION.


FUNCTION z_wm_attempt_read.
*"----------------------------------------------------------------------
*"  IMPORTING
*"     VALUE(IV_REFERENCE) TYPE ZWM_POST_ATTEMPT-REFERENCE_DOCUMENT OPTIONAL
*"     VALUE(IV_REQUEST_HASH) TYPE ZWM_POST_ATTEMPT-REQUEST_HASH OPTIONAL
*"     VALUE(IV_OPEN_ONLY) TYPE CHAR1 OPTIONAL
*"  EXPORTING
*"     VALUE(EV_SUCCESS) TYPE CHAR1
*"     VALUE(EV_MESSAGE) TYPE BAPI_MSG
*"  TABLES
*"     ET_ATTEMPTS STRUCTURE ZWM_POST_ATTEMPT
*"----------------------------------------------------------------------
  CLEAR: ev_success, ev_message.
  CLEAR et_attempts[].

  " shortcut: no secondary index on status or hash, add one if this table grows past a few thousand rows.
  IF iv_reference IS NOT INITIAL AND iv_request_hash IS INITIAL AND iv_open_only IS INITIAL.
    SELECT * FROM zwm_post_attempt
      WHERE reference_document = @iv_reference
      INTO TABLE @et_attempts.
  ELSEIF iv_request_hash IS NOT INITIAL AND iv_reference IS INITIAL AND iv_open_only IS INITIAL.
    SELECT * FROM zwm_post_attempt
      WHERE request_hash = @iv_request_hash
      INTO TABLE @et_attempts.
  ELSEIF iv_open_only = 'X' AND iv_reference IS INITIAL AND iv_request_hash IS INITIAL.
    SELECT * FROM zwm_post_attempt
      WHERE status IN ( 'sending', 'unconfirmed' )
      INTO TABLE @et_attempts.
  ELSE.
    ev_success = 'E'.
    ev_message = 'Pass exactly one of reference, request hash or open only'.
    RETURN.
  ENDIF.
  ev_success = 'S'.
ENDFUNCTION.
