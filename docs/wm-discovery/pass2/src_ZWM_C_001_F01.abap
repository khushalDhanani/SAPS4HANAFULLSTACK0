*&---------------------------------------------------------------------*
*& Include          ZWM_C_001_F01
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
      MESSAGE ID sy-msgid TYPE sy-msgty NUMBER sy-msgno
                 WITH sy-msgv1 sy-msgv2 sy-msgv3 sy-msgv4.
    ENDIF.

  ELSE.
    MESSAGE 'Invalid File Type.' TYPE 'E'.
  ENDIF.

  IF gt_data IS INITIAL.
    MESSAGE 'No Records to Upload' TYPE 'E'.
  ENDIF.

ENDFORM.
*&---------------------------------------------------------------------*
*& Form bdc_data
*&---------------------------------------------------------------------*
*& text
*&---------------------------------------------------------------------*
*& -->  p1        text
*& <--  p2        text
*&---------------------------------------------------------------------*
FORM bdc_data .

  LOOP AT gt_data INTO wa_data.

    PERFORM bdc_dynpro      USING 'SAPML03T' '0173'.
    PERFORM bdc_field       USING 'BDC_CURSOR'
                                  'LEIN-LENUM'.
    PERFORM bdc_field       USING 'BDC_OKCODE'
                                  '/00'.
    PERFORM bdc_field       USING 'LEIN-LENUM'
                                  wa_data-lenum.
    PERFORM bdc_field       USING 'LTAK-BWLVS'
                                  wa_data-bwlvs.
    PERFORM bdc_field       USING 'RL03T-DUNKL'
                                  'H'.
    PERFORM bdc_dynpro      USING 'SAPML03T' '0171'.
    PERFORM bdc_field       USING 'BDC_CURSOR'
                                  '*LTAP-NLPLA'.
    PERFORM bdc_field       USING 'BDC_OKCODE'
                                  '/00'.
    PERFORM bdc_field       USING 'LEIN-LETYP'
                                  wa_data-letyp.
    PERFORM bdc_field       USING '*LTAP-NLTYP'
                                  wa_data-nltyp.
    PERFORM bdc_field       USING '*LTAP-NLBER'
                                  wa_data-nlber.
    PERFORM bdc_field       USING '*LTAP-NLPLA'
                                  wa_data-nlpla.
    PERFORM bdc_dynpro      USING 'SAPML03T' '0171'.
    PERFORM bdc_field       USING 'BDC_CURSOR'
                                  'LEIN-LETYP'.
    PERFORM bdc_field       USING 'BDC_OKCODE'
                                  '=BU'.
    PERFORM bdc_field       USING 'LEIN-LETYP'
                                  wa_data-letyp.
    PERFORM bdc_field       USING '*LTAP-NLTYP'
                                  wa_data-nltyp.
    PERFORM bdc_field       USING '*LTAP-NLBER'
                                  wa_data-nlber.
    PERFORM bdc_field       USING '*LTAP-NLPLA'
                                  wa_data-nlpla.

    REFRESH lt_messtab.
    CALL TRANSACTION 'LT09' USING lt_bdcdata
          MODE ctumode
          UPDATE cupdate
          MESSAGES INTO lt_messtab.

    WAIT UP TO 1 SECONDS.
    REFRESH lt_bdcdata.

    LOOP AT lt_messtab INTO wa_messtab.

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

      MOVE-CORRESPONDING wa_messtab TO wa_log.

      APPEND VALUE #(
      lenum    = wa_data-lenum
      bwlvs    = wa_data-bwlvs
      letyp    = wa_data-letyp
      nltyp    = wa_data-nltyp
      nlber    = wa_data-nlber
      nlpla    = wa_data-nlpla
      tcode    = wa_messtab-tcode
      msgtyp   = wa_messtab-msgtyp
      msg_text = msg_text
      ) TO gt_log.

    ENDLOOP.

  ENDLOOP.

ENDFORM.
*&---------------------------------------------------------------------*
*& Form bdc_dynpro
*&---------------------------------------------------------------------*
*& text
*&---------------------------------------------------------------------*
*&      --> P_
*&      --> P_
*&---------------------------------------------------------------------*
FORM bdc_dynpro  USING program dynpro.
*          VALUE(p_    )
*                          VALUE(p_    ).

  CLEAR wa_bdcdata.
  wa_bdcdata-program  = program.
  wa_bdcdata-dynpro   = dynpro.
  wa_bdcdata-dynbegin = 'X'.
  APPEND wa_bdcdata TO lt_bdcdata.

ENDFORM.
*&---------------------------------------------------------------------*
*& Form bdc_field
*&---------------------------------------------------------------------*
*& text
*&---------------------------------------------------------------------*
*&      --> P_
*&      --> P_
*&---------------------------------------------------------------------*
FORM bdc_field  USING fnam fval.
*       VALUE(p_    )
*                         VALUE(p_    ).

  IF fval IS NOT INITIAL.
    CLEAR wa_bdcdata.
    wa_bdcdata-fnam = fnam.
    wa_bdcdata-fval = fval.
    APPEND wa_bdcdata TO lt_bdcdata.
  ENDIF.

ENDFORM.
*&---------------------------------------------------------------------*
*& Form fieldcat_design
*&---------------------------------------------------------------------*
*& text
*&---------------------------------------------------------------------*
*& -->  p1        text
*& <--  p2        text
*&---------------------------------------------------------------------*
FORM fieldcat_design .

  PERFORM create_fieldcat USING:
              '01' '09' 'TCODE'     'IT_LOG' 'L' 'TCODE',
              '01' '12' 'MSGTYP'    'IT_LOG' 'L' 'MSGTYP',
              '01' '1'  'MSG_TEXT'  'IT_LOG' 'L' 'MESSAGE'.

ENDFORM.
*&---------------------------------------------------------------------*
*& Form create_fieldcat
*&---------------------------------------------------------------------*
*& text
*&---------------------------------------------------------------------*
*&      --> P_
*&      --> P_
*&      --> P_
*&      --> P_
*&      --> P_
*&      --> P_
*&---------------------------------------------------------------------*
FORM create_fieldcat  USING fp_rowpos    TYPE sycurow
                            fp_colpos    TYPE sycucol
                            fp_fldnam    TYPE fieldname
                            fp_tabnam    TYPE tabname
                            fp_justif    TYPE char1
                            fp_seltext   TYPE dd03p-scrtext_l.

*      VALUE(p_    )
*                               VALUE(p_    )
*                               VALUE(p_    )
*                               VALUE(p_    )
*                               VALUE(p_    )
*                               VALUE(p_    ).

  wa_fieldcat-row_pos        =  fp_rowpos.     "Row
  wa_fieldcat-col_pos        =  fp_colpos.     "Column
  wa_fieldcat-fieldname      =  fp_fldnam.     "Field Name
  wa_fieldcat-tabname        =  fp_tabnam.     "Internal Table Name
  wa_fieldcat-just           =  fp_justif.     "Screen Justified
  wa_fieldcat-seltext_l      =  fp_seltext.    "Field Text

  APPEND wa_fieldcat TO t_fieldcat.

  CLEAR wa_fieldcat.

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

  wa_layout-zebra = 'X'.
  wa_layout-colwidth_optimize = 'X'.

  APPEND VALUE #( fieldname = 'LENUM' seltext_l = 'Storage Unit' ) TO t_fieldcat.
  APPEND VALUE #( fieldname = 'BWLVS' seltext_l = 'Movement Type' ) TO t_fieldcat.
  APPEND VALUE #( fieldname = 'LETYP' seltext_l = 'Storage Unit Type' ) TO t_fieldcat.
  APPEND VALUE #( fieldname = 'NLTYP' seltext_l = 'Destination Storage Type' ) TO t_fieldcat.
  APPEND VALUE #( fieldname = 'NLBER' seltext_l = 'Destination Storage Section' ) TO t_fieldcat.
  APPEND VALUE #( fieldname = 'NLPLA' seltext_l = 'Destination Storage Bin' ) TO t_fieldcat.

  CALL FUNCTION 'REUSE_ALV_GRID_DISPLAY'
    EXPORTING
      is_layout     = wa_layout
      it_fieldcat   = t_fieldcat
      i_save        = 'X'
    TABLES
      t_outtab      = gt_log
    EXCEPTIONS
      program_error = 1
      OTHERS        = 2.
  IF sy-subrc <> 0.
* Implement suitable error handling here
  ENDIF.


ENDFORM.