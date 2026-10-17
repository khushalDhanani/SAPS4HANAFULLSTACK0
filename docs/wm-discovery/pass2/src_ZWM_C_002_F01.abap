*&---------------------------------------------------------------------*
*& Include          ZWM_C_002_F01
*&---------------------------------------------------------------------*
*&---------------------------------------------------------------------*
*& Form get_filename
*&---------------------------------------------------------------------*
*& text
*&---------------------------------------------------------------------*
*&      <-- P_FILE
*&---------------------------------------------------------------------*
FORM get_filename  CHANGING p_p_file.

  DATA: lv_window_title TYPE string,
        li_filetable    TYPE filetable,
        lv_return_code  TYPE i.

  CALL METHOD cl_gui_frontend_services=>file_open_dialog
    EXPORTING
      window_title            = lv_window_title
    CHANGING
      file_table              = li_filetable
      rc                      = lv_return_code
    EXCEPTIONS
      file_open_dialog_failed = 1
      cntl_error              = 2
      error_no_gui            = 3
      not_supported_by_gui    = 4
      OTHERS                  = 5.
  IF sy-subrc <> 0.
    MESSAGE ID sy-msgid TYPE sy-msgty NUMBER sy-msgno
            WITH sy-msgv1 sy-msgv2 sy-msgv3 sy-msgv4.
  ENDIF.

  DATA(lx_filetable) = VALUE #( li_filetable[ 1 ] OPTIONAL ).
  p_file = lx_filetable-filename.

  SPLIT p_file AT '.' INTO fname ename.
  SET LOCALE LANGUAGE sy-langu.
  TRANSLATE ename TO UPPER CASE.

ENDFORM.
*&---------------------------------------------------------------------*
*& Form get_data
*&---------------------------------------------------------------------*
*& text
*&---------------------------------------------------------------------*
*& -->  p1        text
*& <--  p2        text
*&---------------------------------------------------------------------*
FORM get_data .

  DATA i_tab TYPE truxs_t_text_data.

  IF ename EQ 'XLSX' OR ename EQ 'XLS'.

    REFRESH gt_excel[].

    CALL FUNCTION 'TEXT_CONVERT_XLS_TO_SAP'
      EXPORTING
*        i_line_header        =
        i_tab_raw_data       = i_tab
        i_filename           = p_file
      TABLES
        i_tab_converted_data = gt_excel[]
      EXCEPTIONS
        conversion_failed    = 1
        OTHERS               = 2.
    DELETE gt_excel FROM 1 TO 2.
    IF sy-subrc <> 0.
      MESSAGE ID sy-msgid TYPE sy-msgty NUMBER sy-msgno
                  WITH sy-msgv1 sy-msgv2 sy-msgv3 sy-msgv4.
    ENDIF.

  ELSE.
    MESSAGE 'Invalid File Type.' TYPE 'E'.
  ENDIF.

  IF gt_excel IS INITIAL.
    MESSAGE 'No Records to Upload' TYPE 'S' DISPLAY LIKE 'E'.
  ELSE.
    MOVE-CORRESPONDING gt_excel TO gt_data.
  ENDIF.

ENDFORM.
*&---------------------------------------------------------------------*
*& Form upload_data
*&---------------------------------------------------------------------*
*& text
*&---------------------------------------------------------------------*
*& -->  p1        text
*& <--  p2        text
*&---------------------------------------------------------------------*
FORM upload_data .
  DATA i TYPE int4 VALUE 0.
  DATA lv_lenum TYPE lein-lenum.

  LOOP AT gt_data INTO wa_data.

    lv_lenum = |{ wa_data-lenum ALPHA = IN }|.
    i = i + 1.

    CALL FUNCTION 'L_TO_CREATE_MOVE_SU'
      EXPORTING
        i_lenum               = lv_lenum
        i_bwlvs               = wa_data-bwlvs
*       I_LZNUM               = ' '
        i_nltyp               = wa_data-nltyp
        i_nlber               = wa_data-nlber
        i_nlpla               = wa_data-nlpla
*       I_NPPOS               = ' '
*       I_SQUIT               = ' '
        i_letyp               = wa_data-letyp
*       I_NIDRU               = ' '
*       I_DRUKZ               = ' '
*       I_LDEST               = ' '
*       I_UPDATE_TASK         = ' '
        i_commit_work         = 'X'
*       I_BNAME               = SY-UNAME
*       I_SOLEX               = 0
*       I_PERNR               = 0
*       I_BETYP               = ' '
*       I_BENUM               = ' '
      IMPORTING
        e_tanum               = gv_tanum
*       E_NLTYP               =
*       E_NLBER               =
*       E_NLPLA               =
*       E_NPPOS               =
*   TABLES
*       T_LTAP_MOVE_SU        =
*       T_LTAK                =
*       T_LTAP_VB             =
      EXCEPTIONS
        not_confirmed_to      = 1
        foreign_lock          = 2
        bwlvs_wrong           = 3
        betyp_wrong           = 4
        nltyp_wrong           = 5
        nlpla_wrong           = 6
        nltyp_missing         = 7
        nlpla_missing         = 8
        squit_forbidden       = 9
        lgber_wrong           = 10
        xfeld_wrong           = 11
        drukz_wrong           = 12
        ldest_wrong           = 13
        no_stock_on_su        = 14
        su_not_found          = 15
        update_without_commit = 16
        no_authority          = 17
        benum_required        = 18
        ltap_move_su_wrong    = 19
        lenum_wrong           = 20
        OTHERS                = 21.
    IF sy-subrc = 0.
      APPEND VALUE #(
                  slno = i + 1
                  msg = |Transfer Order '{ gv_tanum }' created successfully.|
                  ) TO gt_message.
    ELSE.
*      MESSAGE ID sy-msgid TYPE sy-msgty NUMBER sy-msgno
*                WITH sy-msgv1 sy-msgv2 sy-msgv3 sy-msgv4.
      DATA msg_text TYPE string.
      CALL FUNCTION 'FORMAT_MESSAGE'
        EXPORTING
          id        = sy-msgid
          lang      = sy-langu
          no        = sy-msgno
          v1        = sy-msgv1
          v2        = sy-msgv2
          v3        = sy-msgv3
          v4        = sy-msgv4
        IMPORTING
          msg       = msg_text
        EXCEPTIONS
          not_found = 1
          OTHERS    = 2.
      IF sy-subrc <> 0.
* Implement suitable error handling here
      ENDIF.

      APPEND VALUE #(
                  slno = i
                  msg = |{ sy-msgid }-{ sy-msgty }-{ sy-msgno }, { msg_text }|
                  ) TO gt_message.
    ENDIF.

  ENDLOOP.

ENDFORM.
*&---------------------------------------------------------------------*
*& Form display_data
*&---------------------------------------------------------------------*
*& text
*&---------------------------------------------------------------------*
*& -->  p1        text
*& <--  p2        text
*&---------------------------------------------------------------------*
FORM display_data .

  DATA: lr_alv       TYPE REF TO cl_salv_table,
        lr_display   TYPE REF TO cl_salv_display_settings,
        lr_functions TYPE REF TO cl_salv_functions,
        lr_cols      TYPE REF TO cl_salv_columns,
        lr_col       TYPE REF TO cl_salv_column.

  TRY.
      CALL METHOD cl_salv_table=>factory
        EXPORTING
          list_display = if_salv_c_bool_sap=>false
        IMPORTING
          r_salv_table = lr_alv
        CHANGING
          t_table      = gt_message[].
      lr_display = lr_alv->get_display_settings( ).
      lr_display->set_striped_pattern( cl_salv_display_settings=>true ).
      lr_functions = lr_alv->get_functions( ).
      lr_functions->set_all( abap_true ).
      lr_cols = lr_alv->get_columns( ).
      lr_cols->set_optimize( abap_true ).

      lr_col = lr_cols->get_column( 'SLNO' ).
      lr_col->set_long_text( 'SlNo' ).
      lr_col->set_medium_text( 'SlNo' ).
      lr_col->set_short_text( 'SlNo' ).

      lr_col = lr_cols->get_column( 'MSG' ).
      lr_col->set_long_text( 'Message' ).
      lr_col->set_medium_text( 'Message' ).
      lr_col->set_short_text( 'Message' ).

    CATCH cx_salv_msg.
    CATCH cx_salv_not_found.
  ENDTRY.
*  cl_demo_output=>display( gt_message ).
  lr_alv->display( ).
ENDFORM.