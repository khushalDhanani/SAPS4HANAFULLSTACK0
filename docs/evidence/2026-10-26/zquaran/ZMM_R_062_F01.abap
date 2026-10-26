*&---------------------------------------------------------------------*
*& Include          ZMM_R_062_F01
*&---------------------------------------------------------------------*
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
  INTO TABLE @DATA(gt_mseg) WHERE mblnr = @p_mblnr.
*  FROM mseg INTO TABLE @DATA(gt_mseg) WHERE mblnr = @p_mblnr.
*BREAK STRIPATHY.
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
*  cast( cuobj_bm  AS CHAR( 18 ) ),
  licha
  FROM mch1 INTO TABLE @DATA(gt_mch1) FOR ALL ENTRIES IN @gt_mseg WHERE charg = @gt_mseg-charg AND matnr = @gt_mseg-matnr.


  """ Added by vinay for checking through SU or HU on 28-09-2026
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


  """ Ended by vinay

***    SELECT
***      matnr,
***      charg,
***      vsolm ,
***      werks,
***      tbpos ,
***      tanum,
***      tapos,
***      meins,
***      nlenr
***     FROM ltap INTO TABLE @gt_ltap FOR ALL ENTRIES IN @gt_mseg WHERE matnr = @gt_mseg-matnr
***                                                                       AND charg = @gt_mseg-charg
***                                                                       AND vbeln = @gt_mseg-vbeln_im AND vltyp IN ( '920','902' ).


  SORT gt_ltap BY tanum tapos.

ENDIF.

IF gt_vepo IS NOT INITIAL.

  SELECT
    venum,
    exidv2
    FROM vekp INTO TABLE @DATA(gt_vekp) FOR ALL ENTRIES IN @gt_vepo
                               WHERE venum = @gt_vepo-venum.
ENDIF.


*********************************************************************************Added


CLEAR it_amchl.
it_amchl = VALUE #( FOR ls_mch1 IN gt_mch1 ( objek = |{ ls_mch1-cuobj_bm ALPHA = IN WIDTH = 18 }|
                                             charg = ls_mch1-charg ) ) .


IF it_amchl IS NOT INITIAL.

  SELECT
    objek,
    atinn,
    atwrt,
    date_from
    FROM ausp INTO TABLE @DATA(gt_ausp) FOR ALL ENTRIES IN @it_amchl WHERE objek  = @it_amchl-objek AND ( atinn = '0000000846' OR atinn = '0000000854' ).
  " added by vinay on 30-06-2025

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

  """" ended by vinay

ENDIF.

**************************************************************************************


*LOOP AT gt_MSEG INTO DATA(gs_MSEG).
BREAK sjena.
DATA: lv_total(05)  TYPE c,
      lv_index(05)  TYPE c,
      lv_prev_matnr TYPE ltap-matnr,
      lv_prev_charg TYPE ltap-charg.
DATA : lv_qty TYPE p  DECIMALS 2.

SORT gt_ltap BY  matnr charg.

LOOP AT gt_ltap INTO DATA(gs_ltap) .



  "–– new group? –––––––––––––––––––––––––––––––––––––– Added by vinay on 11-07-2027
  IF gs_ltap-matnr <> lv_prev_matnr
  OR gs_ltap-charg <> lv_prev_charg.

    lv_prev_matnr = gs_ltap-matnr.
    lv_prev_charg = gs_ltap-charg.

    "total lines in this group (one REDUCE only!)
    lv_total = REDUCE i(
                 INIT n = 0
                 FOR wa IN gt_ltap
                 WHERE ( matnr = gs_ltap-matnr
                         AND charg = gs_ltap-charg )
                 NEXT n = n + 1 ).

    lv_index = 1.       "reset index
  ELSE.
    lv_index = lv_index + 1.
  ENDIF.
  CONCATENATE lv_index 'OF' lv_total INTO gs_final-cont SEPARATED BY space.
  CONDENSE : gs_final-cont .


******* Ended by vinay on 11-07-2025



*****  DATA(lv_lines) = REDUCE i( INIT x = 0 FOR wa IN gt_ltap
*****                      WHERE ( matnr = gs_ltap-matnr ) NEXT x = x + 1 ).
*****
*****
*****  IF lv_material NE gs_ltap-matnr.
*****    CLEAR : lv_material , lv_count_f , lv_count_t .
*****    lv_material = gs_ltap-matnr.
*****    lv_count_f = 1.
*****    lv_count_t = lv_lines." + gs_final-cont.
*****    CONDENSE : lv_count_f .", .
*****
******    CONDENSE : lv_count_f , lv_count_t.
*****    CONCATENATE lv_count_f 'OF' lv_count_t INTO gs_final-cont SEPARATED BY space.
*****    CONDENSE : gs_final-cont .
*****  ELSE.
******
*****    lv_material = gs_ltap-matnr.
*****    ADD 1 TO lv_count_f.
*****    lv_count_t = lv_lines." + gs_final-cont.
*****    CONDENSE : lv_count_f .", lv_count_t.
*****    CONCATENATE lv_count_f 'OF' lv_count_t INTO gs_final-cont SEPARATED BY space.
*****    CONDENSE : gs_final-cont .
*****
*****  ENDIF.
  gs_final-vsolm  = gs_ltap-vsolm.
  gs_final-meins  = gs_ltap-meins.
*                  gs_final-lv_text = |{ gs_final-vsolm } { gs_final-meins } |.
  gs_final-lv_text = gs_final-vsolm.
  gs_final-nlenr = gs_ltap-nlenr.

  READ TABLE gt_mseg INTO DATA(gs_mseg) WITH KEY matnr = gs_ltap-matnr charg = gs_ltap-charg.
  IF sy-subrc = 0.
    gs_final-mblnr = gs_mseg-mblnr.
    gs_final-budat_mkpf = gs_mseg-budat_mkpf.

    " Commented By Subhasri
*    gs_final-menge = gs_MSEG-menge.

*----------------------BOC By Subhasri On 21-02-2025---------------------*
    lv_qty = gs_mseg-menge.
    gs_final-qty_r = |{ lv_qty } { gs_mseg-meins }|.
*    gs_final-qty_r = |{ gs_mseg-menge } { gs_mseg-meins }|.
*----------------------EOC By Subhasri---------------------*
    gs_final-hsdat = gs_mseg-hsdat.

  ENDIF.

  READ TABLE gt_makt INTO DATA(gs_makt) WITH KEY matnr = gs_ltap-matnr.
  IF sy-subrc = 0.
    gs_final-maktx  = gs_makt-maktx.
  ENDIF.
*DELETE gt_mch1 index 1.
  READ TABLE gt_mch1 INTO DATA(gs_mch1) WITH KEY charg = gs_ltap-charg .
  IF sy-subrc = 0.
*    gs_final-zzcust_batch  = gs_mch1-zzcust_batch.   " commented by vinay on 23-06-2025
    gs_final-zzcust_batch  = gs_mch1-charg.           " Added by vinay on 23-06-2025
    gs_final-licha  = gs_mch1-licha.
  ENDIF.
*
  READ TABLE gt_lfa1 INTO DATA(gs_lfa1) WITH KEY lifnr = gs_mseg-lifnr.
  IF sy-subrc = 0.
*                    gs_final-name1  = gs_lfa1-name1.
  ENDIF.

  READ TABLE it_but000 INTO DATA(gs_but00) WITH KEY partner = gs_mseg-lifnr.
  IF sy-subrc = 0.
    gs_final-name1  = gs_but00-name_org1.
  ENDIF.


***************************************************************************************Added

  READ TABLE it_amchl INTO DATA(wa_amchl) WITH KEY charg = gs_ltap-charg.

  IF sy-subrc = 0.
    READ TABLE gt_ausp INTO DATA(gs_ausp) WITH KEY objek  = wa_amchl-objek .
    IF sy-subrc = 0.
    ENDIF.
  ENDIF.

  """""""""""""""""""""""' " added by vinay on 30-06-2025
  DATA : lv_name TYPE string.

  READ TABLE gt_ausp1 INTO DATA(wa_ausp1) WITH KEY objek = wa_amchl-objek atinn  = '0000000818'.
  IF sy-subrc = 0 AND wa_ausp1-atwrt IS NOT INITIAL.
    lv_name = wa_ausp1-atwrt.          "start the string
  ENDIF.

  READ TABLE gt_ausp1 INTO wa_ausp1 WITH KEY objek = wa_amchl-objek atinn  = '0000000828'.
  IF sy-subrc = 0 AND wa_ausp1-atwrt IS NOT INITIAL.
    CONCATENATE lv_name wa_ausp1-atwrt INTO lv_name SEPARATED BY space.
  ENDIF.

  gs_final-atwrt = lv_name.
  CONDENSE gs_final-atwrt.

*  .
  gs_final-date_from = VALUE #( gt_ausp3[ objek = wa_amchl-objek atinn = '0000000820' ]-date_from OPTIONAL ).
  gs_final-zdate = 'Retest Date'.
  IF gs_final-date_from IS INITIAL.
    gs_final-date_from = VALUE #( gt_ausp3[ objek = wa_amchl-objek atinn = '9999999400' ]-date_from OPTIONAL ).
    gs_final-zdate = 'Expiry Date'.
  ENDIF.
  """""""""""""" ended by vinay
*******************************************************************************************

  gs_final-text = p_text.

*
  APPEND gs_final TO gt_final.
  CLEAR : gs_final .
*
*
* ENDLOOP.
ENDLOOP.




*  *Process To Call The Adobe Form
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
* Implement suitable error handling here
ENDIF.

CALL FUNCTION 'FP_FUNCTION_MODULE_NAME'
  EXPORTING
    i_name     = 'ZMM_AF_017'
  IMPORTING
    e_funcname = fm_name.


CALL FUNCTION fm_name "'/1BCDWB/SM00000127'
  EXPORTING
    gt_final = gt_final
*   /1BCDWB/DOCPARAMS        =
*   IMPORTING
*   /1BCDWB/FORMOUTPUT       =
*   EXCEPTIONS
*   USAGE_ERROR              = 1
*   SYSTEM_ERROR             = 2
*   INTERNAL_ERROR           = 3
*   OTHERS   = 4
  .
IF sy-subrc <> 0.
* Implement suitable error handling here
ENDIF.


CALL FUNCTION 'FP_JOB_CLOSE'
  EXCEPTIONS
    usage_error    = 1
    system_error   = 2
    internal_error = 3
    OTHERS         = 4.
IF sy-subrc <> 0.
* Implement suitable error handling here
ENDIF.