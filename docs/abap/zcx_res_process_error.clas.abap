CLASS zcx_res_process_error DEFINITION
  PUBLIC
  INHERITING FROM cx_static_check
  FINAL
  CREATE PUBLIC .

  PUBLIC SECTION.

    INTERFACES if_t100_message .
    INTERFACES if_t100_dyn_msg .

    TYPES tt_bapiret2 TYPE STANDARD TABLE OF bapiret2 WITH DEFAULT KEY.

    CONSTANTS:
      BEGIN OF not_wm_managed,
        msgid TYPE symsgid VALUE 'ZWM_RES',
        msgno TYPE symsgno VALUE '001',
        attr1 TYPE scx_attrname VALUE 'MV_WERKS',
        attr2 TYPE scx_attrname VALUE 'MV_LGORT',
        attr3 TYPE scx_attrname VALUE '',
        attr4 TYPE scx_attrname VALUE '',
      END OF not_wm_managed,

      BEGIN OF general_error,
        msgid TYPE symsgid VALUE 'ZWM_RES',
        msgno TYPE symsgno VALUE '002',
        attr1 TYPE scx_attrname VALUE 'MV_MSG',
        attr2 TYPE scx_attrname VALUE '',
        attr3 TYPE scx_attrname VALUE '',
        attr4 TYPE scx_attrname VALUE '',
      END OF general_error,

      BEGIN OF lock_failed,
        msgid TYPE symsgid VALUE 'ZWM_RES',
        msgno TYPE symsgno VALUE '003',
        attr1 TYPE scx_attrname VALUE 'MV_MSG',
        attr2 TYPE scx_attrname VALUE '',
        attr3 TYPE scx_attrname VALUE '',
        attr4 TYPE scx_attrname VALUE '',
      END OF lock_failed.

    DATA mv_werks    TYPE werks_d .
    DATA mv_lgort    TYPE lgort_d .
    DATA mv_msg      TYPE string .
    DATA mt_bapiret2 TYPE tt_bapiret2 .

    METHODS constructor
      IMPORTING
        !textid      LIKE if_t100_message=>t100key OPTIONAL
        !previous    LIKE previous OPTIONAL
        !mv_werks    TYPE werks_d OPTIONAL
        !mv_lgort    TYPE lgort_d OPTIONAL
        !mv_msg      TYPE string OPTIONAL
        !mt_bapiret2 TYPE tt_bapiret2 OPTIONAL .

  PROTECTED SECTION.
  PRIVATE SECTION.
ENDCLASS.

CLASS zcx_res_process_error IMPLEMENTATION.

  METHOD constructor ##ADT_SUPPRESS_GENERATION.
    CALL METHOD super->constructor
      EXPORTING
        previous = previous.
    me->mv_werks    = mv_werks.
    me->mv_lgort    = mv_lgort.
    me->mv_msg      = mv_msg.
    me->mt_bapiret2 = mt_bapiret2.
    CLEAR me->textid.
    IF textid IS INITIAL.
      if_t100_message~t100key = if_t100_message=>default_textid.
    ELSE.
      if_t100_message~t100key = textid.
    ENDIF.
  ENDMETHOD.

ENDCLASS.
