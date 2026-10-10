*"* use this source file for the definition and implementation of
*"* local helper classes, interface implementations and type
*"* declarations

CLASS lhc_ReservationEntry DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.

    METHODS get_instance_authorizations FOR INSTANCE AUTHORIZATION
      IMPORTING keys REQUEST requested_authorizations FOR ReservationEntry RESULT result.

    METHODS validateMovementType FOR VALIDATE ON SAVE
      IMPORTING keys FOR ReservationEntry~validateMovementType.

    METHODS processReservationAndTR FOR DETERMINE ON SAVE
      IMPORTING keys FOR ReservationEntry~processReservationAndTR.

    METHODS createTOFromTR FOR MODIFY
      IMPORTING keys FOR ACTION ReservationEntry~createTOFromTR RESULT result.

ENDCLASS.

CLASS lhc_ReservationEntry IMPLEMENTATION.

  METHOD get_instance_authorizations.
  ENDMETHOD.

  METHOD validateMovementType.
    " Read entity fields for validation
    READ ENTITIES OF zr_res_entry IN LOCAL MODE
      ENTITY ReservationEntry
      FIELDS ( MovementType )
      WITH CORRESPONDING #( keys )
      RESULT DATA(lt_entries).

    LOOP AT lt_entries INTO DATA(ls_entry).
      CASE ls_entry-MovementType.
        WHEN '201'.
          " Cost Center validation: checked via BAPI parameters or additional fields
        WHEN '241'.
          " Asset validation
        WHEN '311'.
          " Receiving SLoc validation
        WHEN '301'.
          " Receiving Plant validation
        WHEN OTHERS.
          APPEND VALUE #( %tky = ls_entry-%tky ) TO failed-reservationentry.
          APPEND VALUE #( %tky = ls_entry-%tky
                          %msg = new_message_with_text(
                                   severity = if_abap_behv_message=>severity-error
                                   text     = |Invalid movement type { ls_entry-MovementType }. Valid types: 201, 241, 311, 301| )
                        ) TO reported-reservationentry.
      ENDCASE.
    ENDLOOP.
  ENDMETHOD.

  METHOD processReservationAndTR.
    DATA: lo_proc TYPE REF TO zcl_res_process.
    CREATE OBJECT lo_proc.

    READ ENTITIES OF zr_res_entry IN LOCAL MODE
      ENTITY ReservationEntry
      ALL FIELDS WITH CORRESPONDING #( keys )
      RESULT DATA(lt_entries).

    LOOP AT lt_entries INTO DATA(ls_entry).
      " 1. Call ZCL_RES_PROCESS->create_reservation
      " 2. On success, auto-create TR in background via ZCL_RES_PROCESS->create_tr
      " 3. Update status in ZRES_TRACK
    ENDLOOP.
  ENDMETHOD.

  METHOD createTOFromTR.
    DATA: lo_proc TYPE REF TO zcl_res_process.
    CREATE OBJECT lo_proc.

    LOOP AT keys INTO DATA(ls_key).
      " 1. Call ZCL_RES_PROCESS->create_to_from_tr( iv_lgnum, iv_tbnum, iv_tbpos, iv_anfme, ... )
      " 2. If iv_auto_confirm = abap_true, call ZCL_RES_PROCESS->confirm_to( iv_lgnum, lv_tanum )
      " 3. Update status in ZRES_TRACK to '04' (TO_CONFIRMED)
      " 4. Append log to ZRES_LOG
    ENDLOOP.
  ENDMETHOD.

ENDCLASS.
