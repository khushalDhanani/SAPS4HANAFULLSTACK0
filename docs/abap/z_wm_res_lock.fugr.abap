*&---------------------------------------------------------------------*
*& Z_WM_RES_LOCK - proposal, NOT deployed, NOT activated, NOT tested
*&---------------------------------------------------------------------*
*& Purpose: SAP-side lock on a reservation item for the Node process layer
*&          (srv/integration/s4hana/wm). Wraps the generated enqueue FMs of
*&          lock object EMRESB (docs/abap/system-metadata.md section 5 and 21),
*&          which are not remote-enabled themselves (section 16).
*&
*& Parameters below are exactly the ENQUEUE_EMRESB / DEQUEUE_EMRESB
*& interface read from the system on 2026-10-12 (section 21):
*&   MANDT, MODE_RESB (ENQMODE, default 'E'), RSNUM, RSPOS, RSART,
*&   X_RSNUM / X_RSPOS / X_RSART, _COLLECT, _SCOPE, _WAIT,
*&   exceptions FOREIGN_LOCK, SYSTEM_FAILURE (enqueue);
*&   DEQUEUE has _SYNCHRON instead of _WAIT and no exceptions.
*&
*& Lock lifetime: _SCOPE = '1' binds the lock to the RFC session (dialog
*& owner). The Node layer must call LOCK, the step FMs and UNLOCK on ONE
*& connection (RfcClient.session) - a lock taken on one connection is not
*& visible for release on another, and it disappears when the connection
*& closes, which is the intended fail-safe. UNSURE until activated and
*& tested with two parallel sessions.
*&
*& Create in SE80: function group Z_WM_RES_LOCK (package of your choice),
*& FM Z_WM_RES_LOCK, Processing Type "Remote-Enabled Module".
*&---------------------------------------------------------------------*
FUNCTION z_wm_res_lock.
*"----------------------------------------------------------------------
*"*"Local Interface:
*"  IMPORTING
*"     VALUE(IV_RSNUM) TYPE  RSNUM
*"     VALUE(IV_RSPOS) TYPE  RSPOS
*"     VALUE(IV_ACTION) TYPE  CHAR1 DEFAULT 'L'      " L = lock, U = unlock
*"     VALUE(IV_WAIT) TYPE  CHAR1 DEFAULT ' '        " 'X' = wait for a foreign lock (enqueue _WAIT)
*"  EXPORTING
*"     VALUE(EV_SUCCESS) TYPE  CHAR1                 " S = ok, E = error
*"     VALUE(EV_MESSAGE) TYPE  BAPI_MSG
*"     VALUE(EV_LOCK_USER) TYPE  SYUNAME             " holder of a foreign lock, if known (sy-msgv1)
*"----------------------------------------------------------------------
  DATA: lv_rsnum TYPE rsnum,
        lv_rspos TYPE rspos.

  CLEAR: ev_success, ev_message, ev_lock_user.

  lv_rsnum = |{ iv_rsnum ALPHA = IN }|.
  lv_rspos = |{ iv_rspos ALPHA = IN }|.

  IF lv_rsnum IS INITIAL OR lv_rspos IS INITIAL.
    ev_success = 'E'.
    ev_message = 'Reservation number and item are required'.
    RETURN.
  ENDIF.

  CASE iv_action.
    WHEN 'L'.
      CALL FUNCTION 'ENQUEUE_EMRESB'
        EXPORTING
          mode_resb      = 'E'
          rsnum          = lv_rsnum
          rspos          = lv_rspos
          _scope         = '1'
          _wait          = iv_wait
        EXCEPTIONS
          foreign_lock   = 1
          system_failure = 2
          OTHERS         = 3.
      CASE sy-subrc.
        WHEN 0.
          ev_success = 'S'.
          ev_message = |Reservation { lv_rsnum }/{ lv_rspos } locked for this session|.
        WHEN 1.
          ev_success   = 'E'.
          ev_lock_user = sy-msgv1.
          ev_message   = |Reservation { lv_rsnum }/{ lv_rspos } is locked by user { sy-msgv1 }|.
        WHEN OTHERS.
          ev_success = 'E'.
          ev_message = |Enqueue server error ({ sy-subrc }) while locking reservation { lv_rsnum }/{ lv_rspos }|.
      ENDCASE.

    WHEN 'U'.
      CALL FUNCTION 'DEQUEUE_EMRESB'
        EXPORTING
          mode_resb = 'E'
          rsnum     = lv_rsnum
          rspos     = lv_rspos
          _scope    = '1'.
      ev_success = 'S'.
      ev_message = |Reservation { lv_rsnum }/{ lv_rspos } unlocked|.

    WHEN OTHERS.
      ev_success = 'E'.
      ev_message = |Unknown action '{ iv_action }' (use L or U)|.
  ENDCASE.

ENDFUNCTION.
