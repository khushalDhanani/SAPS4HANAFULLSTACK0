# HU goods movement over RFC — wrapper spec for `HU_CREATE_GOODS_MOVEMENT`

> **Status**: proposal for the ABAP team (function group `ZFG_HANDLINGUNIT`, package Z001) — 6 Oct 2026
> **Why**: packing material into a handling unit that sits in an **HU-managed** storage location is a goods movement
> (HU event `0001` = movement type 311), not a packing edit. On DS4/220 there is no remote-enabled way to post it:
> `HU_CREATE_GOODS_MOVEMENT` is not RFC-enabled, SAP's RFC shell `HU_CREATE_GOODSMVT_RFC` is empty (its only call is
> commented out), `API_HANDLING_UNIT` is read-only, and `API_MATERIAL_DOCUMENT_SRV` ignores `HandlingUnitExternalID`
> on create (`CL_MATERIAL_DOCUMENT_API=>MAP_ITEM_INPUT` never maps it; the BAPI core then asserts on an HU-managed
> target → `ASSERTION_FAILED`, proven 6 Oct 2026 15:34). See `WORKSTATUS.md` entries 16:40 and 18:10.

## 1. Function module to create

`Z_HU_GOODS_MOVEMENT` — **remote-enabled**, in `ZFG_HANDLINGUNIT`. It is SAP's own template from
`HU_CREATE_GOODSMVT_RFC` (include `LIUID_AIIU01`, lines 22–36) made real, plus explicit commit handling and
flat message output in the style of `Z_HU_ISSUE_TO_ORDER`.

```abap
FUNCTION z_hu_goods_movement.
*"  IMPORTING
*"     VALUE(IV_EVENT)       TYPE HUWBEVENT            " e.g. '0001' pack non-HU SLoc -> HU SLoc (311), '0006' SLoc -> SLoc
*"     VALUE(IV_SIMULATE)    TYPE XFELD DEFAULT SPACE  " 'X' = check only, nothing posted
*"     VALUE(IV_COMMIT)      TYPE XFELD DEFAULT SPACE  " 'X' = BAPI_TRANSACTION_COMMIT WAIT after a successful post
*"     VALUE(IS_IMKPF)       TYPE IMKPF OPTIONAL        " BLDAT/BUDAT/BKTXT/XBLNR; defaults to today
*"     VALUE(IT_MOVE_TO)     TYPE HUM_DATA_MOVE_TO_T    " one row per HU: HUWBEVENT, WERKS, LGORT (target), optional BWART/GRUND/...
*"     VALUE(IT_EXTERNAL_ID) TYPE HUM_EXIDV_T           " HUs by external id (20-char, leading zeros)
*"  EXPORTING
*"     VALUE(EV_SUCCESS)     TYPE CHAR1
*"     VALUE(EV_MBLNR)       TYPE MBLNR
*"     VALUE(EV_MJAHR)       TYPE MJAHR
*"     VALUE(EV_MESSAGE)     TYPE STRING
*"  TABLES
*"     ET_MESSAGES           STRUCTURE BAPIRET2 OPTIONAL

  DATA: ls_imkpf    TYPE imkpf,
        ls_emkpf    TYPE emkpf,
        lt_messages TYPE huitem_messages_t,
        lv_posted   TYPE sysubrc.

  CLEAR: ev_success, ev_mblnr, ev_mjahr, ev_message. REFRESH et_messages.

  ls_imkpf = is_imkpf.
  IF ls_imkpf-budat IS INITIAL. ls_imkpf-budat = sy-datum. ENDIF.
  IF ls_imkpf-bldat IS INITIAL. ls_imkpf-bldat = sy-datum. ENDIF.

  CALL FUNCTION 'HU_CREATE_GOODS_MOVEMENT'
    EXPORTING
      if_event       = iv_event
      if_simulate    = iv_simulate
      if_commit      = space              " commit is done here, explicitly, so the caller sees the result first
      if_tcode       = 'HUMO'
      is_imkpf       = ls_imkpf
      it_move_to     = it_move_to
      it_external_id = it_external_id
    IMPORTING
      ef_posted      = lv_posted
      et_messages    = lt_messages
      es_emkpf       = ls_emkpf.

  " flatten HU messages (HUITEM_MESSAGES: MSGID/MSGTY/MSGNO/MSGV1-4 per HU/item) into BAPIRET2 with text
  LOOP AT lt_messages INTO DATA(ls_msg).
    DATA(ls_ret) = VALUE bapiret2( type = ls_msg-msgty id = ls_msg-msgid number = ls_msg-msgno
                                    message_v1 = ls_msg-msgv1 message_v2 = ls_msg-msgv2
                                    message_v3 = ls_msg-msgv3 message_v4 = ls_msg-msgv4 ).
    IF ls_msg-msgid IS NOT INITIAL.
      MESSAGE ID ls_msg-msgid TYPE 'S' NUMBER ls_msg-msgno
        WITH ls_msg-msgv1 ls_msg-msgv2 ls_msg-msgv3 ls_msg-msgv4 INTO ls_ret-message.
    ENDIF.
    APPEND ls_ret TO et_messages.
    IF ls_msg-msgty CA 'EAX' AND ev_message IS INITIAL. ev_message = ls_ret-message. ENDIF.
  ENDLOOP.
  IF ls_emkpf-msgty CA 'EAX' AND ev_message IS INITIAL.
    MESSAGE ID ls_emkpf-msgid TYPE 'S' NUMBER ls_emkpf-msgno
      WITH ls_emkpf-msgv1 ls_emkpf-msgv2 ls_emkpf-msgv3 ls_emkpf-msgv4 INTO ev_message.
  ENDIF.

  IF ev_message IS NOT INITIAL OR ( iv_simulate IS INITIAL AND ls_emkpf-mblnr IS INITIAL ).
    IF iv_simulate IS INITIAL. CALL FUNCTION 'BAPI_TRANSACTION_ROLLBACK'. ENDIF.
    IF ev_message IS INITIAL. ev_message = 'HU goods movement failed (HU_CREATE_GOODS_MOVEMENT returned no document).'. ENDIF.
    RETURN.
  ENDIF.

  IF iv_simulate IS INITIAL AND iv_commit = 'X'.
    CALL FUNCTION 'BAPI_TRANSACTION_COMMIT' EXPORTING wait = 'X'.
  ENDIF.

  ev_success = 'X'.
  ev_mblnr   = ls_emkpf-mblnr.
  ev_mjahr   = ls_emkpf-mjahr.
  ev_message = COND #( WHEN iv_simulate = 'X' THEN 'Simulation OK'
                       ELSE |Material document { ev_mblnr }/{ ev_mjahr } posted| ).
ENDFUNCTION.
```

Optional second module, same shape: `Z_HU_CANCEL_GOODS_MOVEMENT` wrapping `HU_CANCEL_GOODS_MOVEMENT`
(reversal of an HU goods movement by material document), so a proof can be undone without the GUI.

Notes for the implementer
- Keep the module **remote-enabled** and in `ZFG_HANDLINGUNIT` next to `Z_HU_ISSUE_TO_ORDER`.
- `IF_TCODE 'HUMO'` is what SAP's own template uses; it drives the HU event's authorization/MIGO settings.
- Do not pass `IF_COMMIT` to the standard FM; commit from the wrapper only after inspecting the result (above).
- The `HUM_DATA_MOVE_TO` row needs at least `HUWBEVENT`, `WERKS`, `LGORT` (target). Movement type is derived from
  `THUWBBWART` (event 0001 → 311; Q/S/R stock → 323/325/455). Customizing exists in client 220.
- Authorization: the RFC user already holds `C_LO_HU` (ACTVT *, WERKS *) and `S_RFC *`; the HU events additionally
  check the movement type (`M_MSEG_BWA`) — verify with the simulate run.

## 2. First test, from this repo (after transport to client 220)

Test HU **2000020252** already exists: 1 NOS of 2000000255 packed in 1120/HU01 (not HU-managed, not WM).
Target: 1120/RJ01 (HU-managed, not WM-managed).

1. `IV_SIMULATE = 'X'`, `IV_EVENT = '0001'`, `IT_MOVE_TO = [{ HUWBEVENT '0001', WERKS '1120', LGORT 'RJ01' }]`,
   `IT_EXTERNAL_ID = [{ EXIDV '00000000002000020252' }]` → expect `EV_SUCCESS = 'X'`, no document, no change.
2. Same without simulate, `IV_COMMIT = 'X'` (user's go) → expect `EV_MBLNR/EV_MJAHR`; read back MSEG (311, 1 NOS,
   HU01 → RJ01), MARD HU01 0 / RJ01 1, VEKP `LGORT = 'RJ01'`, OData `detail()` shows the HU in RJ01.
3. Reverse with `Z_HU_CANCEL_GOODS_MOVEMENT` (or HUMO in the GUI) → MSEG 312, stock and VEKP back in HU01.
4. Unpack + delete the test HU with the existing adapter actions.

## 3. Our side once the wrapper exists

- `RfcClient.session`: `Z_HU_GOODS_MOVEMENT` (simulate) → on success `Z_HU_GOODS_MOVEMENT` (post, `IV_COMMIT 'X'`)
  → read back VEKP/VEPO/MSEG; same `_bapi`-style error mapping as the HU adapter (TYPE E/A → 422).
- CAP action `move(handlingUnitExternalID, plant, storageLocation, event)` on `HandlingUnitService`
  (roles WarehouseClerk/WarehouseManager/Admin); UI: "Move HU" button on the detail page with a storage-location
  value help (F4 from `valueHelp('storagelocation')`), confirmation showing source → target and the event text.
- Proof scripts: `tools/test-hu-bapi-cycle.js` already has `move`/`cancel` commands for the OData attempt; switch
  them to the wrapper once it is available.
