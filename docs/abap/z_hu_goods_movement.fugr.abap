*&---------------------------------------------------------------------*
*& Function Module  Z_HU_GOODS_MOVEMENT
*& Function Group   ZFG_HANDLINGUNIT
*& Package          Z001 (Handling Unit Custom Extensions)
*& Processing Type  Remote-Enabled Module (RFC)
*&---------------------------------------------------------------------*
*&---------------------------------------------------------------------*
*& STATUS: ON HOLD (Pending Task 4a Investigation)
*&   Live query of plant 1120 confirms:
*&   - Open 311 reservations in shipping-managed SLocs (CS02, Path A): 6 items.
*&   - Open 311 reservations in HU-managed, non-shipping SLocs (Path B): 0 items.
*&   Because all active reservations fall under Path A (delivery completion flow),
*&   implementation of this custom RFC wrapper is ON HOLD.
*&---------------------------------------------------------------------*
*& Purpose:
*&   Remote-enabled wrapper for standard SAP Handling Unit goods movements
*&   (wrapping HU_CREATE_GOODS_MOVEMENT).
*&
*& Key Capabilities:
*&   1. Authoritative SAP-side Enqueue/Lock on VEKP (via ENQUEUE_EVVEKPE).
*&   2. Rigorous AUTHORITY-CHECKs for Plant, SLoc, Movement Type, and HU.
*&   3. Simulation mode (IV_SIMULATE = 'X') and Live Posting mode.
*&   4. Explicit commit control: callers inspect result before committing.
*&   5. Flat, standardized BAPIRET2 message conversion.
*&   6. Strict Compliance: NO DIRECT UPDATE OF TABLE RESB.
*&---------------------------------------------------------------------*

FUNCTION z_hu_goods_movement.
*"----------------------------------------------------------------------
*"*"Local Interface:
*"  IMPORTING
*"     VALUE(IV_EVENT) TYPE  HUWBEVENT
*"     VALUE(IV_SIMULATE) TYPE  XFELD DEFAULT SPACE
*"     VALUE(IV_COMMIT) TYPE  XFELD DEFAULT SPACE
*"     VALUE(IS_IMKPF) TYPE  IMKPF OPTIONAL
*"     VALUE(IT_MOVE_TO) TYPE  HUM_DATA_MOVE_TO_T
*"     VALUE(IT_EXTERNAL_ID) TYPE  HUM_EXIDV_T
*"     VALUE(IT_INTERNAL_ID) TYPE  HUM_VENUM_T OPTIONAL
*"  EXPORTING
*"     VALUE(EV_SUCCESS) TYPE  CHAR1
*"     VALUE(EV_MBLNR) TYPE  MBLNR
*"     VALUE(EV_MJAHR) TYPE  MJAHR
*"     VALUE(EV_MESSAGE) TYPE  STRING
*"  TABLES
*"     ET_MESSAGES STRUCTURE  BAPIRET2 OPTIONAL
*"----------------------------------------------------------------------

  DATA: ls_imkpf       TYPE imkpf,
        ls_emkpf       TYPE emkpf,
        lt_messages    TYPE huitem_messages_t,
        lv_posted      TYPE sysubrc,
        lv_venum       TYPE venum,
        lv_exidv       TYPE exidv,
        lt_locked_ven  TYPE STANDARD TABLE OF venum WITH DEFAULT KEY,
        lv_has_error   TYPE abap_bool VALUE abap_false,
        lv_bwart       TYPE bwart,
        ls_move_to     TYPE hum_data_move_to,
        ls_exidv       TYPE hum_exidv.

  CLEAR: ev_success, ev_mblnr, ev_mjahr, ev_message.
  REFRESH et_messages.

  "--------------------------------------------------------------------
  " 1. Input Parameter Normalization
  "--------------------------------------------------------------------
  ls_imkpf = is_imkpf.
  IF ls_imkpf-budat IS INITIAL.
    ls_imkpf-budat = sy-datum.
  ENDIF.
  IF ls_imkpf-bldat IS INITIAL.
    ls_imkpf-bldat = sy-datum.
  ENDIF.

  IF it_external_id IS INITIAL AND it_internal_id IS INITIAL.
    ev_message = 'No handling units supplied in IT_EXTERNAL_ID or IT_INTERNAL_ID.'.
    PERFORM append_bapiret2 TABLES et_messages
                            USING  'E' 'HUFUNCTIONS' '001'
                                   ev_message space space space.
    RETURN.
  ENDIF.

  IF it_move_to IS INITIAL.
    ev_message = 'Target movement specification IT_MOVE_TO is mandatory.'.
    PERFORM append_bapiret2 TABLES et_messages
                            USING  'E' 'HUFUNCTIONS' '001'
                                   ev_message space space space.
    RETURN.
  ENDIF.

  READ TABLE it_move_to INTO ls_move_to INDEX 1.
  lv_bwart = ls_move_to-bwart.
  IF lv_bwart IS INITIAL.
    " Derive movement type from THUWBBWART customizing if not explicitly supplied
    SELECT SINGLE move_type INTO lv_bwart
      FROM thuwbbwart
      WHERE huwbevent = iv_event
        AND stock_cat = ls_move_to-bestq.
    IF sy-subrc <> 0.
      lv_bwart = '311'. " Fallback standard SLoc transfer
    ENDIF.
  ENDIF.

  "--------------------------------------------------------------------
  " 2. Authority Checks (Plant, Storage Location, Movement Type, HU)
  "--------------------------------------------------------------------
  " 2.a Handling Unit Authorization (C_LO_HU)
  AUTHORITY-CHECK OBJECT 'C_LO_HU'
    ID 'ACTVT' FIELD '02'
    ID 'WERKS' FIELD ls_move_to-werks.
  IF sy-subrc <> 0.
    ev_message = |No authorization for Handling Units in Plant { ls_move_to-werks } (Object C_LO_HU).|.
    PERFORM append_bapiret2 TABLES et_messages
                            USING  'E' 'HUFUNCTIONS' '001'
                                   ev_message space space space.
    RETURN.
  ENDIF.

  " 2.b Plant & Storage Location Authorization (M_MSEG_WMB)
  AUTHORITY-CHECK OBJECT 'M_MSEG_WMB'
    ID 'ACTVT' FIELD '01'
    ID 'WERKS' FIELD ls_move_to-werks
    ID 'LGORT' FIELD ls_move_to-lgort.
  IF sy-subrc <> 0.
    ev_message = |No authorization for Goods Movement in Plant { ls_move_to-werks } / SLoc { ls_move_to-lgort } (Object M_MSEG_WMB).|.
    PERFORM append_bapiret2 TABLES et_messages
                            USING  'E' 'HUFUNCTIONS' '001'
                                   ev_message space space space.
    RETURN.
  ENDIF.

  " 2.c Movement Type Authorization (M_MSEG_BWA)
  AUTHORITY-CHECK OBJECT 'M_MSEG_BWA'
    ID 'ACTVT' FIELD '01'
    ID 'BWART' FIELD lv_bwart.
  IF sy-subrc <> 0.
    ev_message = |No authorization for Movement Type { lv_bwart } (Object M_MSEG_BWA).|.
    PERFORM append_bapiret2 TABLES et_messages
                            USING  'E' 'HUFUNCTIONS' '001'
                                   ev_message space space space.
    RETURN.
  ENDIF.

  "--------------------------------------------------------------------
  " 3. SAP-Side Authoritative Enqueue / Lock (VEKP via ENQUEUE_EVVEKPE)
  "--------------------------------------------------------------------
  LOOP AT it_external_id INTO ls_exidv.
    SELECT SINGLE venum INTO lv_venum
      FROM vekp
      WHERE exidv = ls_exidv-exidv.
    IF sy-subrc <> 0.
      ev_message = |Handling Unit { ls_exidv-exidv } does not exist in VEKP.|.
      PERFORM append_bapiret2 TABLES et_messages
                              USING  'E' 'HUFUNCTIONS' '001'
                                     ev_message space space space.
      lv_has_error = abap_true.
      EXIT.
    ENDIF.

    CALL FUNCTION 'ENQUEUE_EVVEKPE'
      EXPORTING
        mode_vekp      = 'E'
        mandt          = sy-mandt
        venum          = lv_venum
        _wait          = space
      EXCEPTIONS
        foreign_lock   = 1
        system_failure = 2
        OTHERS         = 3.
    IF sy-subrc <> 0.
      ev_message = |Handling Unit { ls_exidv-exidv } is locked by user { sy-msgv1 } (Enqueue foreign lock).|.
      PERFORM append_bapiret2 TABLES et_messages
                              USING  'E' 'HUFUNCTIONS' '001'
                                     ev_message sy-msgv1 space space.
      lv_has_error = abap_true.
      EXIT.
    ELSE.
      APPEND lv_venum TO lt_locked_ven.
    ENDIF.
  ENDLOOP.

  IF lv_has_error = abap_true.
    PERFORM release_locks USING lt_locked_ven.
    RETURN.
  ENDIF.

  "--------------------------------------------------------------------
  " 4. Invoke Standard HU Goods Movement Core (HU_CREATE_GOODS_MOVEMENT)
  "--------------------------------------------------------------------
  " Note: IF_COMMIT is intentionally passed as SPACE so this wrapper
  " inspects the outcome and retains full control of the LUW.
  CALL FUNCTION 'HU_CREATE_GOODS_MOVEMENT'
    EXPORTING
      if_event       = iv_event
      if_simulate    = iv_simulate
      if_commit      = space
      if_tcode       = 'HUMO'
      is_imkpf       = ls_imkpf
      it_move_to     = it_move_to
      it_external_id = it_external_id
      it_internal_id = it_internal_id
    IMPORTING
      ef_posted      = lv_posted
      et_messages    = lt_messages
      es_emkpf       = ls_emkpf.

  "--------------------------------------------------------------------
  " 5. Map HU Messages to Standard Flat BAPIRET2 Table
  "--------------------------------------------------------------------
  LOOP AT lt_messages INTO DATA(ls_msg).
    DATA(ls_ret) = VALUE bapiret2(
      type        = ls_msg-msgty
      id          = ls_msg-msgid
      number      = ls_msg-msgno
      message_v1  = ls_msg-msgv1
      message_v2  = ls_msg-msgv2
      message_v3  = ls_msg-msgv3
      message_v4  = ls_msg-msgv4
    ).
    IF ls_msg-msgid IS NOT INITIAL.
      MESSAGE ID ls_msg-msgid TYPE 'S' NUMBER ls_msg-msgno
        WITH ls_msg-msgv1 ls_msg-msgv2 ls_msg-msgv3 ls_msg-msgv4
        INTO ls_ret-message.
    ENDIF.
    APPEND ls_ret TO et_messages.
    IF ls_msg-msgty CA 'EAX' AND ev_message IS INITIAL.
      ev_message = ls_ret-message.
      lv_has_error = abap_true.
    ENDIF.
  ENDLOOP.

  IF ls_emkpf-msgty CA 'EAX' AND ev_message IS INITIAL.
    MESSAGE ID ls_emkpf-msgid TYPE 'S' NUMBER ls_emkpf-msgno
      WITH ls_emkpf-msgv1 ls_emkpf-msgv2 ls_emkpf-msgv3 ls_emkpf-msgv4
      INTO ev_message.
    lv_has_error = abap_true.
  ENDIF.

  "--------------------------------------------------------------------
  " 6. Inspect Results, Rollback or Commit LUW
  "--------------------------------------------------------------------
  IF lv_has_error = abap_true OR ( iv_simulate IS INITIAL AND ls_emkpf-mblnr IS INITIAL ).
    IF iv_simulate IS INITIAL.
      CALL FUNCTION 'BAPI_TRANSACTION_ROLLBACK'.
    ENDIF.
    IF ev_message IS INITIAL.
      ev_message = 'HU goods movement failed (HU_CREATE_GOODS_MOVEMENT returned no document number).'.
    ENDIF.
    PERFORM release_locks USING lt_locked_ven.
    RETURN.
  ENDIF.

  IF iv_simulate IS INITIAL AND iv_commit = 'X'.
    CALL FUNCTION 'BAPI_TRANSACTION_COMMIT'
      EXPORTING
        wait = 'X'.
  ENDIF.

  "--------------------------------------------------------------------
  " 7. Release Locks & Populate Success Output
  "--------------------------------------------------------------------
  PERFORM release_locks USING lt_locked_ven.

  ev_success = 'X'.
  ev_mblnr   = ls_emkpf-mblnr.
  ev_mjahr   = ls_emkpf-mjahr.
  IF iv_simulate = 'X'.
    ev_message = 'Simulation successful: Handling Unit movement validated with zero errors.'.
  ELSE.
    ev_message = |Material document { ev_mblnr }/{ ev_mjahr } posted successfully.|.
  ENDIF.

ENDFUNCTION.


*&---------------------------------------------------------------------*
*& Form RELEASE_LOCKS
*&---------------------------------------------------------------------*
FORM release_locks USING pt_venum TYPE STANDARD TABLE.
  DATA: lv_ven TYPE venum.
  LOOP AT pt_venum INTO lv_ven.
    CALL FUNCTION 'DEQUEUE_EVVEKPE'
      EXPORTING
        mode_vekp = 'E'
        mandt     = sy-mandt
        venum     = lv_ven.
  ENDLOOP.
ENDFORM.


*&---------------------------------------------------------------------*
*& Form APPEND_BAPIRET2
*&---------------------------------------------------------------------*
FORM append_bapiret2 TABLES pt_messages STRUCTURE bapiret2
                     USING  pv_type     TYPE bapi_mtype
                            pv_id       TYPE symsgid
                            pv_number   TYPE symsgno
                            pv_v1       TYPE any
                            pv_v2       TYPE any
                            pv_v3       TYPE any
                            pv_v4       TYPE any.
  DATA: ls_msg TYPE bapiret2.
  ls_msg-type       = pv_type.
  ls_msg-id         = pv_id.
  ls_msg-number     = pv_number.
  ls_msg-message_v1 = pv_v1.
  ls_msg-message_v2 = pv_v2.
  ls_msg-message_v3 = pv_v3.
  ls_msg-message_v4 = pv_v4.
  MESSAGE ID pv_id TYPE 'S' NUMBER pv_number
    WITH pv_v1 pv_v2 pv_v3 pv_v4
    INTO ls_msg-message.
  APPEND ls_msg TO pt_messages.
ENDFORM.


*======================================================================*
* ARCHITECTURAL NOTE: RESERVATION HANDLING (RSNUM / RSPOS) - UNRESOLVED
*======================================================================*
* Inspection of DD03L (structure HUM_DATA_MOVE_TO) and the interface of
* HU_CREATE_GOODS_MOVEMENT confirms:
*   - HUM_DATA_MOVE_TO carries NO fields for reservation reference (RSNUM/RSPOS).
*   - HU_CREATE_GOODS_MOVEMENT does not expose reservation fields in IT_MOVE_TO.
*
* STRICT SAP RULE:
*   NO DIRECT UPDATE OF TABLE RESB IS PERMITTED UNDER ANY CIRCUMSTANCES.
*   Direct SQL updates of RESB-ENMNG or RESB-KZEAR corrupt Inventory
*   Management consistency and bypass accounting/controlling reconciliation.
*
* UNRESOLVED OPTIONS FOR RESERVATION CONSUMPTION:
*   Status: UNRESOLVED (Needs ABAP verification & decision).
*
*   Option 1: Two-Step Sequence (FLAWED):
*     Step 1: Z_HU_GOODS_MOVEMENT executes physical HU 311 transfer
*             from HU-managed CS02 into staging CIS1.
*     Step 2: Standard BAPI_GOODSMVT_CREATE posts consumption/transfer
*             referencing RSNUM and RSPOS against the unpacked stock.
*     FLAW: Option 1 requires two separate goods movements, generating two
*           distinct material documents. This doubles inventory/accounting
*           postings, risks leaving stock orphaned in CIS1 without reservation
*           linkage if Step 2 fails, and mismodels one logical transfer as two.
*
*   Option 2: Direct BAPI_GOODSMVT_CREATE with Auto-Unpack (UNPROVEN):
*     Moving stock from HU-managed CS02 (XHUPF='X') to non-HU CIS1 (XHUPF='')
*     might unpack the material automatically. If standard
*     BAPI_GOODSMVT_CREATE is used with GM_CODE '06' (MB11) referencing
*     RSNUM/RSPOS, whether SAP unpacks the HU in one atomic LUW without error
*     is UNPROVEN and Not verified. Furthermore, on shipping-managed storage
*     locations (e.g. CS02, T001L-VSTEL='1105'), direct BAPI goods movement
*     is prohibited / may trigger outbound delivery requirement (see WORKSTATUS 2026-10-21 19:50).
*
*   Option 3: BAdI / Enhancement Implementation:
*     Implement BAdI MB_DOCUMENT_BADI (or BADI_HU_GOODS_MOVEMENT) to pass
*     reservation details from an EXPORT TO MEMORY session into IMSEG-RSNUM
*     during HU_CREATE_GOODS_MOVEMENT processing.
*
*   Option 4: Pre-filling CHANGING table CT_IMSEG (Not verified):
*     DD03L confirms structure IMSEG carries RSNUM (pos 0049) and RSPOS (pos 0050).
*     HU_CREATE_GOODS_MOVEMENT exposes CHANGING parameter CT_IMSEG (type TY_T_IMSEG).
*     If a caller pre-populates CT_IMSEG with reservation reference fields, can
*     HU_CREATE_GOODS_MOVEMENT consume the reservation in a single atomic LUW?
*     Because the FM source code cannot be read remotely over RFC (FL 180 "Source
*     wider than 72 char"), backend handling of CT_IMSEG is UNKNOWN and Not verified.
*     The ABAP team must inspect include LLHU_GOODS_MOVEMENTU02 directly in SE37/SE80.
*======================================================================*


*======================================================================*
* TECHNICAL USER AUTHORIZATION PROPOSAL (S_RFC)
*======================================================================*
* The external technical user connecting via RFC requires authorization
* object S_RFC only for function modules that are called REMOTELY from
* outside the SAP backend.
*
* REMOTELY CALLED FUNCTION MODULES & GROUPS (Requiring S_RFC):
*   1. ZFG_HANDLINGUNIT: Contains Z_HU_GOODS_MOVEMENT (and Z_HU_ISSUE_TO_ORDER).
*   2. SDTX: Contains RFC_READ_TABLE (PNAME = SAPLSDTX).
*   3. RFC1: Contains RFC_GET_FUNCTION_INTERFACE (PNAME = SAPLRFC1).
*      (Note: SIFP contains RPY_FUNCTIONMODULE_READ, not RFC_GET_FUNCTION_INTERFACE).
*
* INTERNAL FUNCTION MODULES (Do NOT require S_RFC for the technical user):
*   - HU_CREATE_GOODS_MOVEMENT (FUGR HU_GOODS_MOVEMENT): Called internally by
*     Z_HU_GOODS_MOVEMENT inside the ABAP backend.
*   - ENQUEUE_EVVEKPE / DEQUEUE_EVVEKPE (FUGR /1BCDWBEN/HEN0000): Called
*     internally by Z_HU_GOODS_MOVEMENT inside the ABAP backend.
*   - BAPI_TRANSACTION_COMMIT / ROLLBACK (FUGR BAPT): Internal or remote.
*
* S_RFC AUTHORIZATION PROFILE SPECIFICATION:
*   Object: S_RFC
*     ACTVT:    16 (Execute)
*     RFC_NAME: 'ZFG_HANDLINGUNIT', 'SDTX', 'RFC1'
*     RFC_TYPE: 'FUGR'
*======================================================================*


*======================================================================*
* TRANSPORT & TEST RUNBOOK FOR THE ABAP TEAM
*======================================================================*
* 1. ABAP Workbench Setup:
*    - Transaction: SE80
*    - Package: Z001
*    - Function Group: ZFG_HANDLINGUNIT
*    - Function Module: Z_HU_GOODS_MOVEMENT
*    - Processing Type: Remote-Enabled Module (Radio button "Remote-enabled")
*    - Transport Request: Customizing / Workbench Request
*
* 2. Verification Test Cases in Transaction SE37:
*
*    Test Case 1: Simulation Mode (Zero side effects)
*    - IV_EVENT: '0006'
*    - IV_SIMULATE: 'X'
*    - IV_COMMIT: ' '
*    - IT_EXTERNAL_ID: [ { EXIDV: '00000000002000019372' } ]
*    - IT_MOVE_TO: [ { HUWBEVENT: '0006', WERKS: '1120', LGORT: 'CIS1' } ]
*    -> Expected: EV_SUCCESS = 'X', EV_MBLNR = blank, EV_MESSAGE contains
*                 "Simulation successful", zero database mutations.
*
*    Test Case 2: Foreign Lock Collision Test
*    - In Session 1: Lock HU in transaction HUMO or via SE37 ENQUEUE_EVVEKPE
*                    with VENUM = 0000020535.
*    - In Session 2: Execute Z_HU_GOODS_MOVEMENT with HU 2000019372.
*    -> Expected: EV_SUCCESS = ' ', EV_MESSAGE contains
*                 "is locked by user ... (Enqueue foreign lock)",
*                 ET_MESSAGES contains error message.
*
*    Test Case 3: Live Posting with Commit (Requires user explicit "go")
*    - IV_EVENT: '0006'
*    - IV_SIMULATE: ' '
*    - IV_COMMIT: 'X'
*    - IT_EXTERNAL_ID: [ { EXIDV: '00000000002000019372' } ]
*    - IT_MOVE_TO: [ { HUWBEVENT: '0006', WERKS: '1120', LGORT: 'CIS1' } ]
*    -> Expected: EV_SUCCESS = 'X', EV_MBLNR = 490005xxxx, EV_MJAHR = 2026.
*                 Read MSEG to confirm movement 311, VEKP shows unpacked
*                 or transferred status.
*======================================================================*
