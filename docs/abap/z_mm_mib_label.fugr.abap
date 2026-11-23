*&---------------------------------------------------------------------*
*& Function Group   ZMM_MIB_LABEL         (PROPOSED name)
*& Package          ZAMM (package of transaction ZMIB)
*& Function Modules Z_MM_MIB_LABEL_DATA   (normal)
*&                  Z_MM_MIB_LABEL_PDF    (Remote-Enabled Module (RFC))
*&---------------------------------------------------------------------*
*& STATUS: PROPOSAL FOR REVIEW — not activated, not transported, never
*&   executed. Activation and live rendering proof require user written go.
*&
*& Purpose:
*&   Remote-enabled PDF variant of transaction ZMIB (report ZMM_R_067):
*&   extracts Transfer Order item details, production order batch, and
*&   renders Adobe form ZMM_AF_021 directly to binary PDF (XSTRING)
*&   without user dialog or spool/printer side effects.
*&
*& Dictionary / Form Artifacts:
*&   - Form: ZMM_AF_021 (Interface: ZMM_FI_021)
*&   - Table Type: ZMM_TT_025
*&   - Line Structure: ZMM_S_012
*&---------------------------------------------------------------------*

FUNCTION z_mm_mib_label_data.
*"----------------------------------------------------------------------
*"  IMPORTING
*"     VALUE(IV_LGNUM)  TYPE LTAP-LGNUM
*"     VALUE(IV_TANUM)  TYPE LTAP-TANUM
*"     VALUE(IV_BNAME)  TYPE USR21-BNAME OPTIONAL
*"     VALUE(IV_BNAME1) TYPE USR21-BNAME OPTIONAL
*"  EXPORTING
*"     VALUE(ET_FINAL)  TYPE ZMM_TT_025
*"----------------------------------------------------------------------
* Port of ZMM_R_067_F01 data extraction logic.
* Selects TO header and items, looks up batch from AFPO, and assembles
* ZMM_TT_025 rows.

  DATA: gs_final TYPE zmm_s_012,
        lv_aufnr TYPE afko-aufnr,
        lv_charg TYPE afpo-charg.

  CLEAR et_final.

  SELECT FROM ltak
    INNER JOIN ltap ON ltak~tanum = ltap~tanum AND ltak~lgnum = ltap~lgnum
    LEFT JOIN makt ON ltap~matnr = makt~matnr AND makt~spras = @sy-langu
    FIELDS
      ltak~tbnum,
      ltak~bdatu,
      ltak~benum,
      ltap~tanum,
      ltap~charg,
      ltap~matnr,
      ltap~nista,
      ltap~meins,
      ltap~vlenr,
      makt~maktx
    WHERE ltak~lgnum = @iv_lgnum AND ltak~tanum = @iv_tanum
    INTO TABLE @DATA(it_ltak).

  IF it_ltak IS INITIAL.
    RETURN.
  ENDIF.

  lv_aufnr = |{ CONV aufnr( VALUE #( it_ltak[ 1 ]-benum OPTIONAL ) ) ALPHA = IN }|.
  IF lv_aufnr IS NOT INITIAL.
    SELECT SINGLE FROM afpo FIELDS charg WHERE aufnr = @lv_aufnr INTO @lv_charg.
  ENDIF.

  LOOP AT it_ltak INTO DATA(ls_ltak).
    gs_final-matnr     = ls_ltak-matnr.
    gs_final-maktx     = ls_ltak-maktx.
    gs_final-charg     = COND #( WHEN lv_charg IS NOT INITIAL THEN lv_charg ELSE ls_ltak-charg ).
    gs_final-bdatu     = ls_ltak-bdatu.
    gs_final-benum     = ls_ltak-tanum.
    gs_final-tbnum     = ls_ltak-tbnum.
    gs_final-lv_text   = |{ ls_ltak-nista } { ls_ltak-meins }|.
    gs_final-vlenr     = ls_ltak-vlenr.
    gs_final-weight_by = iv_bname.
    gs_final-chck_by   = iv_bname1.

    APPEND gs_final TO et_final.
    CLEAR gs_final.
  ENDLOOP.

ENDFUNCTION.


FUNCTION z_mm_mib_label_pdf.
*"----------------------------------------------------------------------
*"  IMPORTING
*"     VALUE(IV_LGNUM)       TYPE LTAP-LGNUM
*"     VALUE(IV_TANUM)       TYPE LTAP-TANUM
*"     VALUE(IV_BNAME)       TYPE USR21-BNAME OPTIONAL
*"     VALUE(IV_BNAME1)      TYPE USR21-BNAME OPTIONAL
*"  EXPORTING
*"     VALUE(EV_RESULT)      TYPE CHAR20
*"     VALUE(EV_MESSAGE)     TYPE STRING
*"     VALUE(EV_LABEL_COUNT) TYPE I
*"     VALUE(EV_PDF)         TYPE XSTRING
*"----------------------------------------------------------------------
* Remote-enabled PDF rendering wrapper for transaction ZMIB / form ZMM_AF_021.
* Executes with NODIALOG and GETPDF to return pure binary PDF in EV_PDF.

  DATA: lt_final        TYPE zmm_tt_025,
        fm_name         TYPE rs38l_fnam,
        fp_docparams    TYPE sfpdocparams,
        fp_outputparams TYPE sfpoutputparams,
        fp_formoutput   TYPE fpformoutput.

  CLEAR: ev_result, ev_message, ev_label_count, ev_pdf.

  IF iv_lgnum IS INITIAL OR iv_tanum IS INITIAL.
    ev_result  = 'INVALID_INPUT'.
    ev_message = 'Warehouse Number and Transfer Order Number are mandatory.'.
    RETURN.
  ENDIF.

  " Step 1: Collect sticker data
  CALL FUNCTION 'Z_MM_MIB_LABEL_DATA'
    EXPORTING
      iv_lgnum  = iv_lgnum
      iv_tanum  = iv_tanum
      iv_bname  = iv_bname
      iv_bname1 = iv_bname1
    IMPORTING
      et_final  = lt_final.

  ev_label_count = lines( lt_final ).
  IF lt_final IS INITIAL.
    ev_result  = 'NOT_FOUND'.
    ev_message = |No Transfer Order items found for TO { iv_tanum } in warehouse { iv_lgnum }.|.
    RETURN.
  ENDIF.

  " Step 2: Resolve Adobe Form function module
  CALL FUNCTION 'FP_FUNCTION_MODULE_NAME'
    EXPORTING
      i_name     = 'ZMM_AF_021'
    IMPORTING
      e_funcname = fm_name
    EXCEPTIONS
      OTHERS     = 1.

  IF sy-subrc <> 0 OR fm_name IS INITIAL.
    ev_result  = 'FORM_ERROR'.
    ev_message = 'Adobe form ZMM_AF_021 is not active or could not be found.'.
    RETURN.
  ENDIF.

  " Step 3: Open Form Job with pure PDF capture (no spool, no dialog)
  fp_outputparams-nodialog = 'X'.
  fp_outputparams-getpdf   = 'X'.
  fp_outputparams-noprint  = 'X'.

  CALL FUNCTION 'FP_JOB_OPEN'
    CHANGING
      ie_outputparams = fp_outputparams
    EXCEPTIONS
      cancel          = 1
      usage_error     = 2
      system_error    = 3
      internal_error  = 4
      OTHERS          = 5.

  IF sy-subrc <> 0.
    ev_result  = 'FORM_ERROR'.
    ev_message = |FP_JOB_OPEN failed with return code { sy-subrc }.|.
    RETURN.
  ENDIF.

  " Step 4: Call Generated Form Function
  CALL FUNCTION fm_name
    EXPORTING
      /1bcdwb/docparams  = fp_docparams
      gt_final           = lt_final
    IMPORTING
      /1bcdwb/formoutput = fp_formoutput
    EXCEPTIONS
      usage_error        = 1
      system_error       = 2
      internal_error     = 3
      OTHERS             = 4.

  DATA(lv_call_subrc) = sy-subrc.

  " Step 5: Always close job
  CALL FUNCTION 'FP_JOB_CLOSE'
    EXCEPTIONS
      OTHERS = 1.

  IF lv_call_subrc <> 0.
    ev_result  = 'FORM_ERROR'.
    ev_message = |Adobe Form execution failed with code { lv_call_subrc }.|.
    RETURN.
  ENDIF.

  IF fp_formoutput-pdf IS INITIAL.
    ev_result  = 'EMPTY_PDF'.
    ev_message = 'Adobe Form executed successfully but returned empty PDF content.'.
    RETURN.
  ENDIF.

  ev_result  = 'OK'.
  ev_message = 'Success'.
  ev_pdf     = fp_formoutput-pdf.

ENDFUNCTION.
