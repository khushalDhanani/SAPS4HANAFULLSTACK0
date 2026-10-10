CLASS lhc_ReservationEntry DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.

    METHODS get_instance_authorizations FOR INSTANCE AUTHORIZATION
      IMPORTING keys REQUEST requested_authorizations FOR ReservationEntry RESULT result.

    METHODS get_instance_features FOR INSTANCE FEATURES
      IMPORTING keys REQUEST requested_features FOR ReservationEntry RESULT result.

    METHODS validateMovementData FOR VALIDATE ON SAVE
      IMPORTING keys FOR ReservationEntry~validateMovementData.

    METHODS createTR FOR MODIFY
      IMPORTING keys FOR ACTION ReservationEntry~createTR RESULT result.

    METHODS createTOFromTR FOR MODIFY
      IMPORTING keys FOR ACTION ReservationEntry~createTOFromTR RESULT result.

    METHODS confirmTO FOR MODIFY
      IMPORTING keys FOR ACTION ReservationEntry~confirmTO RESULT result.

    METHODS postMigo FOR MODIFY
      IMPORTING keys FOR ACTION ReservationEntry~postMigo RESULT result.

    METHODS retryStep FOR MODIFY
      IMPORTING keys FOR ACTION ReservationEntry~retryStep RESULT result.

    METHODS refreshStatus FOR MODIFY
      IMPORTING keys FOR ACTION ReservationEntry~refreshStatus RESULT result.

    " Helper to trigger background execution (Issue 1: No COMMIT inside RAP)
    METHODS start_background_job
      IMPORTING
        !iv_rsnum  TYPE rsnum
        !iv_rspos  TYPE rspos
        !iv_step   TYPE char10
      RETURNING
        VALUE(rv_started) TYPE abap_bool.

ENDCLASS.

CLASS lhc_ReservationEntry IMPLEMENTATION.

  METHOD get_instance_authorizations.
  ENDMETHOD.

  METHOD get_instance_features.
    " Control enable/disable of action buttons based on Status
    READ ENTITIES OF zr_res_entry IN LOCAL MODE
      ENTITY ReservationEntry
      FIELDS ( Status ErrorStep )
      WITH CORRESPONDING #( keys )
      RESULT DATA(lt_entries).

    result = VALUE #( FOR ls_entry IN lt_entries
      ( %tky = ls_entry-%tky
        %action-createTR     = COND #( WHEN ls_entry-Status = '01' OR ls_entry-Status = '11' THEN if_abap_behv=>fc-o-enabled ELSE if_abap_behv=>fc-o-disabled )
        %action-createTOFromTR = COND #( WHEN ls_entry-Status = '02' OR ls_entry-Status = '12' THEN if_abap_behv=>fc-o-enabled ELSE if_abap_behv=>fc-o-disabled )
        %action-confirmTO    = COND #( WHEN ls_entry-Status = '03' OR ls_entry-Status = '13' THEN if_abap_behv=>fc-o-enabled ELSE if_abap_behv=>fc-o-disabled )
        %action-postMigo     = COND #( WHEN ls_entry-Status = '04' OR ls_entry-Status = '90' THEN if_abap_behv=>fc-o-enabled ELSE if_abap_behv=>fc-o-disabled )
        %action-retryStep    = COND #( WHEN ls_entry-Status IN VALUE #( ( '11' ) ( '12' ) ( '13' ) ( '90' ) ) THEN if_abap_behv=>fc-o-enabled ELSE if_abap_behv=>fc-o-disabled )
        %action-refreshStatus = if_abap_behv=>fc-o-enabled
      ) ).
  ENDMETHOD.

  METHOD validateMovementData.
    READ ENTITIES OF zr_res_entry IN LOCAL MODE
      ENTITY ReservationEntry
      FIELDS ( MovementType Plant StorageLocation CostCenter AssetNumber )
      WITH CORRESPONDING #( keys )
      RESULT DATA(lt_entries).

    LOOP AT lt_entries INTO DATA(ls_entry).
      " Check Movement Type relevance
      CASE ls_entry-MovementType.
        WHEN '201'.
          IF ls_entry-CostCenter IS INITIAL.
            APPEND VALUE #( %tky = ls_entry-%tky ) TO failed-reservationentry.
            APPEND VALUE #( %tky = ls_entry-%tky
                            %msg = new_message_with_text(
                                     severity = if_abap_behv_message=>severity-error
                                     text     = 'Cost Center is mandatory for movement 201' )
                          ) TO reported-reservationentry.
          ENDIF.
        WHEN '241'.
          IF ls_entry-AssetNumber IS INITIAL.
            APPEND VALUE #( %tky = ls_entry-%tky ) TO failed-reservationentry.
            APPEND VALUE #( %tky = ls_entry-%tky
                            %msg = new_message_with_text(
                                     severity = if_abap_behv_message=>severity-error
                                     text     = 'Asset Number is mandatory for movement 241' )
                          ) TO reported-reservationentry.
          ENDIF.
        WHEN '311' OR '301'.
          " Checked by value helps
        WHEN OTHERS.
          APPEND VALUE #( %tky = ls_entry-%tky ) TO failed-reservationentry.
          APPEND VALUE #( %tky = ls_entry-%tky
                          %msg = new_message_with_text(
                                   severity = if_abap_behv_message=>severity-error
                                   text     = |Movement type { ls_entry-MovementType } not supported. Allowed: 201, 241, 311, 301| )
                        ) TO reported-reservationentry.
      ENDCASE.
    ENDLOOP.
  ENDMETHOD.

  METHOD createTR.
    " Issue 1: Do not execute BAPI/COMMIT inside RAP action. Delegate to bgPF.
    LOOP AT keys INTO DATA(ls_key).
      start_background_job( iv_rsnum = ls_key-ReservationNo iv_rspos = ls_key-ReservationItem iv_step = 'LB01' ).
    ENDLOOP.

    READ ENTITIES OF zr_res_entry IN LOCAL MODE
      ENTITY ReservationEntry
      ALL FIELDS WITH CORRESPONDING #( keys )
      RESULT DATA(lt_result).

    result = VALUE #( FOR ls_res IN lt_result ( %tky = ls_res-%tky %param = ls_res ) ).
  ENDMETHOD.

  METHOD createTOFromTR.
    LOOP AT keys INTO DATA(ls_key).
      start_background_job( iv_rsnum = ls_key-ReservationNo iv_rspos = ls_key-ReservationItem iv_step = 'LT04' ).
    ENDLOOP.

    READ ENTITIES OF zr_res_entry IN LOCAL MODE
      ENTITY ReservationEntry
      ALL FIELDS WITH CORRESPONDING #( keys )
      RESULT DATA(lt_result).

    result = VALUE #( FOR ls_res IN lt_result ( %tky = ls_res-%tky %param = ls_res ) ).
  ENDMETHOD.

  METHOD confirmTO.
    LOOP AT keys INTO DATA(ls_key).
      start_background_job( iv_rsnum = ls_key-ReservationNo iv_rspos = ls_key-ReservationItem iv_step = 'LT12' ).
    ENDLOOP.

    READ ENTITIES OF zr_res_entry IN LOCAL MODE
      ENTITY ReservationEntry
      ALL FIELDS WITH CORRESPONDING #( keys )
      RESULT DATA(lt_result).

    result = VALUE #( FOR ls_res IN lt_result ( %tky = ls_res-%tky %param = ls_res ) ).
  ENDMETHOD.

  METHOD postMigo.
    LOOP AT keys INTO DATA(ls_key).
      start_background_job( iv_rsnum = ls_key-ReservationNo iv_rspos = ls_key-ReservationItem iv_step = 'MIGO' ).
    ENDLOOP.

    READ ENTITIES OF zr_res_entry IN LOCAL MODE
      ENTITY ReservationEntry
      ALL FIELDS WITH CORRESPONDING #( keys )
      RESULT DATA(lt_result).

    result = VALUE #( FOR ls_res IN lt_result ( %tky = ls_res-%tky %param = ls_res ) ).
  ENDMETHOD.

  METHOD retryStep.
    READ ENTITIES OF zr_res_entry IN LOCAL MODE
      ENTITY ReservationEntry
      FIELDS ( Status ErrorStep )
      WITH CORRESPONDING #( keys )
      RESULT DATA(lt_entries).

    LOOP AT lt_entries INTO DATA(ls_entry).
      DATA(lv_target_step) = COND char10(
        WHEN ls_entry-Status = '11' OR ls_entry-ErrorStep = 'LB01' THEN 'LB01'
        WHEN ls_entry-Status = '12' OR ls_entry-ErrorStep = 'LT04' THEN 'LT04'
        WHEN ls_entry-Status = '13' OR ls_entry-ErrorStep = 'LT12' THEN 'LT12'
        WHEN ls_entry-Status = '90' OR ls_entry-ErrorStep = 'MIGO' THEN 'MIGO'
        ELSE 'RETRY_AUTO' ).

      start_background_job( iv_rsnum = ls_entry-ReservationNo iv_rspos = ls_entry-ReservationItem iv_step = lv_target_step ).
    ENDLOOP.

    READ ENTITIES OF zr_res_entry IN LOCAL MODE
      ENTITY ReservationEntry
      ALL FIELDS WITH CORRESPONDING #( keys )
      RESULT DATA(lt_result).

    result = VALUE #( FOR ls_res IN lt_result ( %tky = ls_res-%tky %param = ls_res ) ).
  ENDMETHOD.

  METHOD refreshStatus.
    " Issue 8: Explicit refresh action on demand from UI
    READ ENTITIES OF zr_res_entry IN LOCAL MODE
      ENTITY ReservationEntry
      ALL FIELDS WITH CORRESPONDING #( keys )
      RESULT DATA(lt_result).

    result = VALUE #( FOR ls_res IN lt_result ( %tky = ls_res-%tky %param = ls_res ) ).
  ENDMETHOD.

  METHOD start_background_job.
    " Pattern 1: Modern S/4HANA Background Processing Framework (bgPF) [REVIEW IN ADT]
    " In modern releases:
    " TRY.
    "   DATA(lo_operation) = cl_bgpf_operation_factory=>create_operation( ... ).
    "   lo_operation->execute( ).
    " CATCH cx_bgpf_error.
    " ENDTRY.

    " Pattern 2: Universally available asynchronous background execution without blocking RAP
    CALL FUNCTION 'Z_RUN_RES_PROCESS_STEP' IN BACKGROUND TASK
      ASYNCHRONOUS - LOCAL
      EXPORTING
        iv_rsnum = iv_rsnum
        iv_rspos = iv_rspos
        iv_step  = iv_step
      EXCEPTIONS
        OTHERS   = 1.

    rv_started = COND #( WHEN sy-subrc = 0 THEN abap_true ELSE abap_false ).
  ENDMETHOD.

ENDCLASS.
