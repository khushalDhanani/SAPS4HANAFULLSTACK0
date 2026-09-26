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

    REFRESH gt_data[].

    CALL FUNCTION 'TEXT_CONVERT_XLS_TO_SAP'
      EXPORTING
        i_line_header        = 'X'
        i_tab_raw_data       = i_tab
        i_filename           = p_file
      TABLES
        i_tab_converted_data = gt_data
      EXCEPTIONS
        conversion_failed    = 1
        OTHERS               = 2.
    IF sy-subrc <> 0.
* Implement suitable error handling here
    ENDIF.
  ELSE.
    MESSAGE 'Invalid File Type.' TYPE 'E'. "##NO_TEXT
  ENDIF.

  IF gt_data IS INITIAL.
    MESSAGE 'No Records to Upload' TYPE 'E'. "##NO_TEXT
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
  DATA: lv_lenum TYPE lein-lenum,
        i_lgnum  TYPE ltak-lgnum,
        i_bwlvs  TYPE ltak-bwlvs,
        e_tanum  TYPE ltak-tanum.

  DATA: lt_ltap_creat TYPE TABLE OF ltap_creat,
        ls_ltap_creat TYPE ltap_creat.

*& transfer data nd delete duplicate
  DATA(lt_data) = gt_data[].
  DELETE ADJACENT DUPLICATES FROM gt_data COMPARING tanum.

  LOOP AT gt_data INTO wa_data.

    i_lgnum = wa_data-lgnum. "Warehouse number
    i_bwlvs = wa_data-bwart. "Movement Type

    LOOP AT lt_data INTO DATA(ls_data) WHERE tanum = wa_data-tanum.


      CALL FUNCTION 'CONVERSION_EXIT_MATN1_INPUT'
        EXPORTING
          input        = ls_data-matnr
        IMPORTING
          output       = ls_ltap_creat-matnr
        EXCEPTIONS
          length_error = 1
          OTHERS       = 2.
      IF sy-subrc <> 0.
* Implement suitable error handling here
      ENDIF.

      ls_ltap_creat-werks = ls_data-werks.
      ls_ltap_creat-lgort = ls_data-lgort.
      ls_ltap_creat-charg = ls_data-charg.
      ls_ltap_creat-sobkz = ls_data-sobkz.
      ls_ltap_creat-sonum = ls_data-sonum.
      ls_ltap_creat-letyp = ls_data-letyp.
      ls_ltap_creat-anfme = ls_data-menge.
      ls_ltap_creat-altme = ls_data-gewei.
      ls_ltap_creat-squit = ls_data-pquit.
      ls_ltap_creat-vltyp = ls_data-vltyp.
      ls_ltap_creat-vlber = ls_data-vlber.
      ls_ltap_creat-vlpla = ls_data-vlpla.
      ls_ltap_creat-nltyp = ls_data-nltyp.
      ls_ltap_creat-nlber = ls_data-nlber.
      ls_ltap_creat-nlpla = ls_data-nlpla.
      ls_ltap_creat-NLENR = ls_data-NLENR.

      CALL FUNCTION 'CONVERSION_EXIT_LENUM_INPUT'
        EXPORTING
          input           = ls_ltap_creat-NLENR
        IMPORTING
          output          = ls_ltap_creat-NLENR
        EXCEPTIONS
          check_failed    = 1
          not_numeric     = 2
          t344_get_failed = 3
          wrong_length    = 4
          OTHERS          = 5.
      IF sy-subrc <> 0.
* Implement suitable error handling here
      ENDIF.


      APPEND ls_ltap_creat TO lt_ltap_creat.
      CLEAR: ls_ltap_creat,ls_data.
    ENDLOOP.

    CALL FUNCTION 'L_TO_CREATE_MULTIPLE'
      EXPORTING
        i_lgnum                = i_lgnum
        i_bwlvs                = i_bwlvs
        i_commit_work          = 'X'
        i_bname                = sy-uname
        i_kompl                = 'X'
      IMPORTING
        e_tanum                = e_tanum
      TABLES
        t_ltap_creat           = lt_ltap_creat
      EXCEPTIONS
        no_to_created          = 1
        bwlvs_wrong            = 2
        betyp_wrong            = 3
        benum_missing          = 4
        betyp_missing          = 5
        foreign_lock           = 6
        vltyp_wrong            = 7
        vlpla_wrong            = 8
        vltyp_missing          = 9
        nltyp_wrong            = 10
        nlpla_wrong            = 11
        nltyp_missing          = 12
        rltyp_wrong            = 13
        rlpla_wrong            = 14
        rltyp_missing          = 15
        squit_forbidden        = 16
        manual_to_forbidden    = 17
        letyp_wrong            = 18
        vlpla_missing          = 19
        nlpla_missing          = 20
        sobkz_wrong            = 21
        sobkz_missing          = 22
        sonum_missing          = 23
        bestq_wrong            = 24
        lgber_wrong            = 25
        xfeld_wrong            = 26
        date_wrong             = 27
        drukz_wrong            = 28
        ldest_wrong            = 29
        update_without_commit  = 30
        no_authority           = 31
        material_not_found     = 32
        lenum_wrong            = 33
        matnr_missing          = 34
        werks_missing          = 35
        anfme_missing          = 36
        altme_missing          = 37
        lgort_wrong_or_missing = 38
        OTHERS                 = 39.

    IF sy-subrc = 0.
      APPEND VALUE #(
                  tanum =  wa_data-tanum "TO Number
                  msg = |Transfer Order '{ e_tanum }' created successfully.|
                  ) TO gt_message.
    ELSE.
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
                  tanum = wa_data-tanum "TO Number
                  msg = |{ sy-msgid }-{ sy-msgty }-{ sy-msgno }, { msg_text }|
                  ) TO gt_message.
    ENDIF.
    CLEAR: wa_data,e_tanum.
    REFRESH lt_ltap_creat.

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

      lr_col = lr_cols->get_column( 'TANUM' ).
      lr_col->set_long_text( 'TO Number' ).
      lr_col->set_medium_text( 'TO Number' ).
      lr_col->set_short_text( 'TO Number' ).

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