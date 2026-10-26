*&---------------------------------------------------------------------*
*& Function Group   ZMM_QUAR_LABEL        (PROPOSED name — not created)
*& Package          ZAMM (package of transaction ZQUARAN; confirm)
*& Function Modules Z_MM_QUAR_LABEL_DATA  (normal)
*&                  Z_MM_QUAR_LABEL_PDF   (Remote-Enabled Module (RFC))
*&---------------------------------------------------------------------*
*& STATUS: PROPOSAL FOR REVIEW — not activated, not transported, never
*&   executed. Activation, and proof that Z_MM_QUAR_LABEL_PDF returns the
*&   approved PDF without spool/printer side effects, are separate gates
*&   (docs/zquaran-pdf-wrapper.md §6). Dictionary names used below were
*&   confirmed READ-ONLY on 26 Oct 2026 (dictionary-sfp-fpformoutput-tactz.json);
*&   rendering side effects (spool / output records) remain to be proven.
*&
*& Purpose:
*&   Remote-enabled PDF variant of transaction ZQUARAN (report ZMM_R_062):
*&   same label rows, same Adobe form ZMM_AF_017, but keyed by material
*&   document AND year, and returning the PDF instead of printing.
*&
*& Evidence (docs/evidence/2026-10-26/zquaran/):
*&   - ZMM_R_062_F01.abap  label-row assembly ported 1:1 below, with the
*&     year predicate added and the BREAK statements removed.
*&   - generated-form-contract.json  ZMM_AF_017 -> /1BCDWB/SM00000137:
*&     IMPORTING GT_FINAL TYPE ZMM_TT_026, /1BCDWB/DOCPARAMS TYPE
*&     SFPDOCPARAMS (optional); EXPORTING /1BCDWB/FORMOUTPUT TYPE
*&     FPFORMOUTPUT; EXCEPTIONS USAGE_ERROR, SYSTEM_ERROR, INTERNAL_ERROR.
*&   - fp-function-source.abap  FP_FUNCTION_MODULE_NAME raises
*&     CX_FP_API_REPOSITORY / _USAGE / _INTERNAL.
*&   - ../261-auth-objects.raw.json  M_MSEG_WMB fields ACTVT, WERKS.
*&   - dictionary-sfp-fpformoutput-tactz.json  SFPOUTPUTPARAMS-NODIALOG/GETPDF
*&     (CHAR1), FPFORMOUTPUT-PDF (RSTR), TACTZ M_MSEG_WMB activities include 03.
*&---------------------------------------------------------------------*

FUNCTION z_mm_quar_label_data.
*"----------------------------------------------------------------------
*"  IMPORTING
*"     VALUE(IV_MBLNR) TYPE MBLNR
*"     VALUE(IV_MJAHR) TYPE MJAHR
*"     VALUE(IV_TEXT)  TYPE CHAR50 OPTIONAL
*"  EXPORTING
*"     VALUE(ET_FINAL) TYPE ZMM_TT_026
*"----------------------------------------------------------------------
* Port of ZMM_R_062_F01 (data part, up to the form call). Changes versus
* the report: P_MBLNR/P_TEXT -> IV_MBLNR/IV_TEXT, GT_FINAL -> ET_FINAL,
* MSEG read restricted to IV_MJAHR (the report reads by MBLNR only, so a
* number reused across years mixes documents), BREAK statements removed.
* Recommended follow-up (separately authorized): let ZMM_R_062 call this
* function so the label rows exist in one place only.

  TYPES: BEGIN OF ty_amchl,
           objek TYPE cuobn,
           charg TYPE charg_d,
         END OF ty_amchl.

  DATA: gs_final      TYPE zmm_s_013,
        it_amchl      TYPE TABLE OF ty_amchl,
        lv_total(05)  TYPE c,
        lv_index(05)  TYPE c,
        lv_prev_matnr TYPE ltap-matnr,
        lv_prev_charg TYPE ltap-charg,
        lv_qty        TYPE p DECIMALS 2,
        lv_name       TYPE string.

  CLEAR et_final.

  SELECT
  a~mblnr ,
  a~mjahr ,
  a~zeile ,
  a~bwart ,
  a~matnr ,
  a~menge ,
  a~vbeln_im ,
  a~meins ,
  a~budat_mkpf ,
  a~lgort,
  a~charg,
  a~rsnum,
  a~lifnr,
  a~hsdat,
  b~lifnr AS lifnr1,
  b~name1
    FROM mseg AS a LEFT JOIN lfa1 AS b ON a~lifnr EQ b~lifnr
    INTO TABLE @DATA(gt_mseg) WHERE mblnr = @iv_mblnr
                                AND mjahr = @iv_mjahr.

  IF gt_mseg IS NOT INITIAL.

    SELECT
    matnr ,
    maktx
    FROM makt INTO TABLE @DATA(gt_makt) FOR ALL ENTRIES IN @gt_mseg
                                       WHERE matnr = @gt_mseg-matnr AND spras = @sy-langu.
    SELECT
     lifnr ,
     name1
     FROM lfa1 INTO TABLE @DATA(gt_lfa1) FOR ALL ENTRIES IN @gt_mseg WHERE lifnr = @gt_mseg-lifnr.

    SELECT FROM but000
      FIELDS name_org1,
      partner FOR ALL ENTRIES IN @gt_mseg WHERE partner = @gt_mseg-lifnr INTO TABLE @DATA(it_but000).

    SELECT
    vbeln,
    venum,
    vemng,
    charg
    FROM vepo INTO TABLE @DATA(gt_vepo) FOR ALL ENTRIES IN @gt_mseg
                                   WHERE charg = @gt_mseg-charg.

    SELECT
    matnr,
    charg,
    zzcust_batch,
    cuobj_bm,
    licha
    FROM mch1 INTO TABLE @DATA(gt_mch1) FOR ALL ENTRIES IN @gt_mseg WHERE charg = @gt_mseg-charg AND matnr = @gt_mseg-matnr.

    " SU / HU check (report: added 28-09-2026). LTAP is matched by document
    " number (WENUM) or inbound delivery, exactly as in the report.
    DATA(lv_vbeln) = VALUE #( gt_mseg[ 1 ]-vbeln_im OPTIONAL ).
    IF lv_vbeln IS INITIAL.
      SELECT
        matnr,
        charg,
        vsolm ,
        werks,
        tbpos ,
        tanum,
        tapos,
        meins,
        nlenr
       FROM ltap INTO TABLE @DATA(gt_ltap)
        FOR ALL ENTRIES IN @gt_mseg WHERE matnr = @gt_mseg-matnr
                                      AND charg = @gt_mseg-charg
                                      AND wenum = @gt_mseg-mblnr
                                      AND vltyp IN ( '920','902' ).
    ELSE.
      SELECT
        matnr,
        charg,
        vsolm ,
        werks,
        tbpos ,
        tanum,
        tapos,
        meins,
        nlenr
       FROM ltap INTO TABLE @gt_ltap
        FOR ALL ENTRIES IN @gt_mseg WHERE matnr = @gt_mseg-matnr
                                      AND charg = @gt_mseg-charg
                                      AND vbeln = @gt_mseg-vbeln_im
                                      AND vltyp IN ( '920','902' ).
    ENDIF.

    SORT gt_ltap BY tanum tapos.
  ENDIF.

  IF gt_vepo IS NOT INITIAL.
    SELECT
      venum,
      exidv2
      FROM vekp INTO TABLE @DATA(gt_vekp) FOR ALL ENTRIES IN @gt_vepo
                                 WHERE venum = @gt_vepo-venum.
  ENDIF.

  it_amchl = VALUE #( FOR ls_mch1 IN gt_mch1 ( objek = |{ ls_mch1-cuobj_bm ALPHA = IN WIDTH = 18 }|
                                               charg = ls_mch1-charg ) ).

  IF it_amchl IS NOT INITIAL.
    SELECT
      objek,
      atinn,
      atwrt,
      date_from
      FROM ausp INTO TABLE @DATA(gt_ausp) FOR ALL ENTRIES IN @it_amchl WHERE objek  = @it_amchl-objek AND ( atinn = '0000000846' OR atinn = '0000000854' ).

    SELECT
      objek,
      atinn,
      atwrt,
      date_from
      FROM ausp INTO TABLE @DATA(gt_ausp1) FOR ALL ENTRIES IN @it_amchl WHERE objek  = @it_amchl-objek AND atinn IN ( '0000000818' , '0000000828' ).
    SORT gt_ausp1 BY objek DESCENDING.

    SELECT
       objek,
       atinn,
       atwrt,
       date_from
       FROM ausp INTO TABLE @DATA(gt_ausp3) FOR ALL ENTRIES IN @it_amchl WHERE objek  = @it_amchl-objek AND ( atinn = '0000000820' OR atinn = '9999999400' ).
  ENDIF.

  SORT gt_ltap BY matnr charg.

  LOOP AT gt_ltap INTO DATA(gs_ltap).
    " "n OF m" counter per material/batch group
    IF gs_ltap-matnr <> lv_prev_matnr
    OR gs_ltap-charg <> lv_prev_charg.
      lv_prev_matnr = gs_ltap-matnr.
      lv_prev_charg = gs_ltap-charg.
      lv_total = REDUCE i(
                   INIT n = 0
                   FOR wa IN gt_ltap
                   WHERE ( matnr = gs_ltap-matnr
                           AND charg = gs_ltap-charg )
                   NEXT n = n + 1 ).
      lv_index = 1.
    ELSE.
      lv_index = lv_index + 1.
    ENDIF.
    CONCATENATE lv_index 'OF' lv_total INTO gs_final-cont SEPARATED BY space.
    CONDENSE : gs_final-cont .

    gs_final-vsolm  = gs_ltap-vsolm.
    gs_final-meins  = gs_ltap-meins.
    gs_final-lv_text = gs_final-vsolm.
    gs_final-nlenr = gs_ltap-nlenr.

    READ TABLE gt_mseg INTO DATA(gs_mseg) WITH KEY matnr = gs_ltap-matnr charg = gs_ltap-charg.
    IF sy-subrc = 0.
      gs_final-mblnr = gs_mseg-mblnr.
      gs_final-budat_mkpf = gs_mseg-budat_mkpf.
      lv_qty = gs_mseg-menge.
      gs_final-qty_r = |{ lv_qty } { gs_mseg-meins }|.
      gs_final-hsdat = gs_mseg-hsdat.
    ENDIF.

    READ TABLE gt_makt INTO DATA(gs_makt) WITH KEY matnr = gs_ltap-matnr.
    IF sy-subrc = 0.
      gs_final-maktx  = gs_makt-maktx.
    ENDIF.

    READ TABLE gt_mch1 INTO DATA(gs_mch1) WITH KEY charg = gs_ltap-charg .
    IF sy-subrc = 0.
      gs_final-zzcust_batch  = gs_mch1-charg.
      gs_final-licha  = gs_mch1-licha.
    ENDIF.

    READ TABLE it_but000 INTO DATA(gs_but00) WITH KEY partner = gs_mseg-lifnr.
    IF sy-subrc = 0.
      gs_final-name1  = gs_but00-name_org1.
    ENDIF.

    READ TABLE it_amchl INTO DATA(wa_amchl) WITH KEY charg = gs_ltap-charg.

    CLEAR lv_name.
    READ TABLE gt_ausp1 INTO DATA(wa_ausp1) WITH KEY objek = wa_amchl-objek atinn  = '0000000818'.
    IF sy-subrc = 0 AND wa_ausp1-atwrt IS NOT INITIAL.
      lv_name = wa_ausp1-atwrt.
    ENDIF.
    READ TABLE gt_ausp1 INTO wa_ausp1 WITH KEY objek = wa_amchl-objek atinn  = '0000000828'.
    IF sy-subrc = 0 AND wa_ausp1-atwrt IS NOT INITIAL.
      CONCATENATE lv_name wa_ausp1-atwrt INTO lv_name SEPARATED BY space.
    ENDIF.
    gs_final-atwrt = lv_name.
    CONDENSE gs_final-atwrt.

    gs_final-date_from = VALUE #( gt_ausp3[ objek = wa_amchl-objek atinn = '0000000820' ]-date_from OPTIONAL ).
    gs_final-zdate = 'Retest Date'.
    IF gs_final-date_from IS INITIAL.
      gs_final-date_from = VALUE #( gt_ausp3[ objek = wa_amchl-objek atinn = '9999999400' ]-date_from OPTIONAL ).
      gs_final-zdate = 'Expiry Date'.
    ENDIF.

    gs_final-text = iv_text.

    APPEND gs_final TO et_final.
    CLEAR : gs_final .
  ENDLOOP.

ENDFUNCTION.


FUNCTION z_mm_quar_label_pdf.
*"----------------------------------------------------------------------
*"  IMPORTING
*"     VALUE(IV_MBLNR)       TYPE MBLNR
*"     VALUE(IV_MJAHR)       TYPE MJAHR
*"     VALUE(IV_TEXT)        TYPE CHAR50 OPTIONAL
*"  EXPORTING
*"     VALUE(EV_RESULT)      TYPE CHAR20   " OK | INVALID_INPUT | NOT_FOUND | NOT_AUTHORIZED | NO_LABEL_ROWS | FORM_ERROR | EMPTY_PDF
*"     VALUE(EV_MESSAGE)     TYPE STRING
*"     VALUE(EV_PDF)         TYPE XSTRING
*"     VALUE(EV_LABEL_COUNT) TYPE I
*"----------------------------------------------------------------------
* Read-only apart from Adobe rendering: no database update, no COMMIT,
* no printer dispatch (no DEST / no device). End-user role and plant
* authorization is enforced by CAP before this is called (agreed:
* WarehouseClerk / WarehouseManager / Admin; non-admins only their
* plants). The AUTHORITY-CHECK below additionally binds the RFC user.

  DATA: lt_final        TYPE zmm_tt_026,
        lt_plants       TYPE STANDARD TABLE OF werks_d WITH EMPTY KEY,
        lv_fm_name      TYPE rs38l_fnam,
        ls_outputparams TYPE sfpoutputparams,
        ls_docparams    TYPE sfpdocparams,
        ls_formoutput   TYPE fpformoutput,
        lv_form_rc      TYPE sy-subrc.

  CLEAR: ev_message, ev_pdf, ev_label_count.
  ev_result = 'FORM_ERROR'.

  IF iv_mblnr IS INITIAL OR iv_mjahr IS INITIAL.
    ev_result  = 'INVALID_INPUT'.
    ev_message = 'Material document number and year are required.'.
    RETURN.
  ENDIF.

  " Plants of the document. MATDOC fields MBLNR/MJAHR/WERKS are read live
  " by the CAP adapter (srv/integration/s4hana/wm/TrToAdapter.js:1458).
  SELECT DISTINCT werks FROM matdoc
    WHERE mblnr = @iv_mblnr AND mjahr = @iv_mjahr
    INTO TABLE @lt_plants.
  IF lt_plants IS INITIAL.
    ev_result  = 'NOT_FOUND'.
    ev_message = |Material document { iv_mblnr }/{ iv_mjahr } not found.|.
    RETURN.
  ENDIF.

  LOOP AT lt_plants INTO DATA(lv_werks).
    " ACTVT '03' (display): permitted for M_MSEG_WMB per TACTZ (01,02,03,04,06,69,F4).
    AUTHORITY-CHECK OBJECT 'M_MSEG_WMB'
      ID 'ACTVT' FIELD '03'
      ID 'WERKS' FIELD lv_werks.
    IF sy-subrc <> 0.
      ev_result  = 'NOT_AUTHORIZED'.
      ev_message = |No display authorization for plant { lv_werks } (M_MSEG_WMB).|.
      RETURN.
    ENDIF.
  ENDLOOP.

  CALL FUNCTION 'Z_MM_QUAR_LABEL_DATA'
    EXPORTING
      iv_mblnr = iv_mblnr
      iv_mjahr = iv_mjahr
      iv_text  = iv_text
    IMPORTING
      et_final = lt_final.
  IF lt_final IS INITIAL.
    " Same eligibility as ZMM_R_062: rows come from LTAP in storage types 920/902.
    ev_result  = 'NO_LABEL_ROWS'.
    ev_message = |No quarantine label rows for material document { iv_mblnr }/{ iv_mjahr }.|.
    RETURN.
  ENDIF.

  TRY.
      CALL FUNCTION 'FP_FUNCTION_MODULE_NAME'
        EXPORTING
          i_name     = 'ZMM_AF_017'
        IMPORTING
          e_funcname = lv_fm_name.
    CATCH cx_fp_api_repository cx_fp_api_usage cx_fp_api_internal INTO DATA(lx_fp).
      ev_message = lx_fp->get_text( ).
      RETURN.
  ENDTRY.

  " No dialog, return the PDF; no DEVICE/DEST is set, so nothing is sent to a
  " printer. Whether ADS still writes a spool/output record: prove in the proof run.
  ls_outputparams-nodialog = abap_true.
  ls_outputparams-getpdf   = abap_true.

  CALL FUNCTION 'FP_JOB_OPEN'
    CHANGING
      ie_outputparams = ls_outputparams
    EXCEPTIONS
      cancel          = 1
      usage_error     = 2
      system_error    = 3
      internal_error  = 4
      OTHERS          = 5.
  IF sy-subrc <> 0.
    ev_message = |Form job could not be opened (FP_JOB_OPEN rc { sy-subrc }).|.
    RETURN.
  ENDIF.

  CALL FUNCTION lv_fm_name
    EXPORTING
      /1bcdwb/docparams  = ls_docparams
      gt_final           = lt_final
    IMPORTING
      /1bcdwb/formoutput = ls_formoutput
    EXCEPTIONS
      usage_error        = 1
      system_error       = 2
      internal_error     = 3
      OTHERS             = 4.
  lv_form_rc = sy-subrc.

  " Always close the job that was opened, also after a rendering error.
  CALL FUNCTION 'FP_JOB_CLOSE'
    EXCEPTIONS
      usage_error    = 1
      system_error   = 2
      internal_error = 3
      OTHERS         = 4.

  IF lv_form_rc <> 0.
    ev_message = |Form ZMM_AF_017 could not be rendered (rc { lv_form_rc }).|.
    RETURN.
  ENDIF.

  " FPFORMOUTPUT-PDF is RSTR (raw string), returned as XSTRING.
  IF ls_formoutput-pdf IS INITIAL.
    ev_result  = 'EMPTY_PDF'.
    ev_message = 'Form ZMM_AF_017 returned no PDF content.'.
    RETURN.
  ENDIF.

  ev_pdf         = ls_formoutput-pdf.
  ev_label_count = lines( lt_final ).
  ev_result      = 'OK'.

ENDFUNCTION.
