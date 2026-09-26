*&---------------------------------------------------------------------*
*& Include          ZWM_C_004_F01
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
    MESSAGE 'No Records to Upload' TYPE 'E'.##NO_TEXT
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

  DATA(lt_data) = gt_data[].
  DELETE ADJACENT DUPLICATES FROM gt_data COMPARING doc_no.

  LOOP AT gt_data INTO gs_data.


    goodsmvt_header-doc_date = sy-datum.
    goodsmvt_header-pstng_date = sy-datum.
    goodsmvt_header-header_txt = gs_data-header_txt.


    goodsmvt_code-gm_code = gs_data-gm_code.

    LOOP AT lt_data INTO DATA(ls_data) WHERE doc_no = gs_data-doc_no.

      gs_goodsmvt_item-material = |{ ls_data-material ALPHA = IN }|.
      gs_goodsmvt_item-plant      = ls_data-plant.
      gs_goodsmvt_item-stge_loc   = ls_data-stge_loc.
      gs_goodsmvt_item-move_type  = ls_data-move_type.
      gs_goodsmvt_item-entry_qnt  = ls_data-entry_qnt.
      gs_goodsmvt_item-amount_lc  = ls_data-amount_lc.

      APPEND  gs_goodsmvt_item TO  gt_goodsmvt_item.
      CLEAR :  gs_goodsmvt_item.


      gs_goodsmvt_serialnumber-matdoc_itm = ls_data-item.
      gs_goodsmvt_serialnumber-serialno = ls_data-serialno.
      APPEND gs_goodsmvt_serialnumber TO gt_goodsmvt_serialnumber.
      CLEAR : gs_goodsmvt_serialnumber.

    ENDLOOP.

    CALL FUNCTION 'BAPI_GOODSMVT_CREATE'
      EXPORTING
        goodsmvt_header       = goodsmvt_header
        goodsmvt_code         = goodsmvt_code
      IMPORTING
        goodsmvt_headret      = goodsmvt_headret
        materialdocument      = materialdocument
        matdocumentyear       = matdocumentyear
      TABLES
        goodsmvt_item         = gt_goodsmvt_item
        goodsmvt_serialnumber = gt_goodsmvt_serialnumber
        return                = return.

    IF return IS INITIAL.

      CALL FUNCTION 'BAPI_TRANSACTION_COMMIT'
        EXPORTING
          wait = 'X'.

      it_error_log = VALUE #( BASE it_error_log ( mat_doc = gs_data-doc_no
                                                mblnr = materialdocument
                                                msg = 'S'
                                                ermsg = 'Created Successfully' ) ) ##NO_TEXT.

    ELSE.

      CALL FUNCTION 'BAPI_TRANSACTION_ROLLBACK'.
      it_error_log = VALUE #( BASE it_error_log FOR w IN return ( mat_doc = gs_data-doc_no
                                                                item = w-row
                                                                msg = w-type
                                                                ermsg = w-message  ) ).

    ENDIF.

    REFRESH : gt_goodsmvt_item[],gt_goodsmvt_serialnumber[],return[].
    CLEAR : goodsmvt_headret,materialdocument,matdocumentyear,goodsmvt_header,goodsmvt_code.

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

  TRY.
      cl_salv_table=>factory(
        IMPORTING
          r_salv_table = lo_table
        CHANGING
          t_table      = it_error_log[]
      ).

      lo_table->get_columns( )->set_optimize( abap_true ).
      lo_table->get_functions( )->set_all( ).

      lo_table->get_columns( )->get_column( 'MBLNR' )->set_long_text( 'NO' ) ##NO_TEXT.
      lo_table->get_columns( )->get_column( 'MBLNR' )->set_medium_text( 'NO' ) ##NO_TEXT.
      lo_table->get_columns( )->get_column( 'MBLNR' )->set_short_text( 'NO' ) ##NO_TEXT.

      lo_table->get_columns( )->get_column( 'MSG' )->set_long_text( 'Message ID' ) ##NO_TEXT.
      lo_table->get_columns( )->get_column( 'MSG' )->set_medium_text( 'Messa ID' ) ##NO_TEXT.
      lo_table->get_columns( )->get_column( 'MSG' )->set_short_text( 'Mes ID' ) ##NO_TEXT.

      lo_table->get_columns( )->get_column( 'MAT_DOC' )->set_long_text( 'Material Document' ) ##NO_TEXT.
      lo_table->get_columns( )->get_column( 'MAT_DOC' )->set_medium_text( 'Material Document' ) ##NO_TEXT.
      lo_table->get_columns( )->get_column( 'MAT_DOC' )->set_short_text( 'Mate Docum' ) ##NO_TEXT.

      lo_table->get_columns( )->get_column( 'ITEM' )->set_long_text( 'Item Line' ) ##NO_TEXT.
      lo_table->get_columns( )->get_column( 'ITEM' )->set_medium_text( 'Item Line' ) ##NO_TEXT.
      lo_table->get_columns( )->get_column( 'ITEM' )->set_short_text( 'Item Line' ) ##NO_TEXT.

      lo_table->get_columns( )->get_column( 'ERMSG' )->set_long_text( 'Message' ) ##NO_TEXT.
      lo_table->get_columns( )->get_column( 'ERMSG' )->set_medium_text( 'Message' ) ##NO_TEXT.
      lo_table->get_columns( )->get_column( 'ERMSG' )->set_short_text( 'Message' ) ##NO_TEXT.

      lo_table->display( ).

    CATCH cx_salv_not_found INTO DATA(lx_not_found).
      MESSAGE lx_not_found->get_text( ) TYPE 'E'.

    CATCH cx_salv_msg INTO DATA(lx_salv_msg).
      MESSAGE lx_salv_msg->get_text( ) TYPE 'E'.
  ENDTRY.



ENDFORM.