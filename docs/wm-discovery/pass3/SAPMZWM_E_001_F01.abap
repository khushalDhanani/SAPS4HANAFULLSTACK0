*&---------------------------------------------------------------------*
*& Include          SAPMZWM_E_001_F01
*&---------------------------------------------------------------------*
*&---------------------------------------------------------------------*
*& Form get_Tr_deatils
*&---------------------------------------------------------------------*
*& text
*&---------------------------------------------------------------------*
*& -->  p1        text
*& <--  p2        text
*&---------------------------------------------------------------------*
FORM get_tr_details.

  IF gv_tr IS NOT INITIAL AND gt_ltbp IS INITIAL.
    gv_tr = |{ gv_tr ALPHA = IN }|.
    SELECT SINGLE
      lgnum,
      bwlvs,
      trart,
      tbnum,
      betyp,
      benum,
      rsnum,
      bdart,
      vltyp,
      vlpla,
      nltyp,
      nlpla
      FROM ltbk INTO @gs_hdr WHERE benum = @gv_tr AND bwlvs = '319'.

    IF sy-subrc IS NOT INITIAL.
      gs_mess-error = c_e.
      gs_mess-mess1 = gv_tr.
      gs_mess-mess2 = 'Invalid TR'.
      CLEAR : gv_tr.
      CALL SCREEN '9999'.
    ELSE.
      SELECT
        tbnum,
        tbpos,
        matnr,
        werks,
        lgort,
        menge,
        menga,
        charg
        FROM ltbp INTO TABLE @gt_ltbp WHERE lgnum = @gs_hdr-lgnum AND tbnum = @gs_hdr-tbnum.
    ENDIF.
  ENDIF.

ENDFORM.
*&---------------------------------------------------------------------*
*& Form clear_all
*&---------------------------------------------------------------------*
*& text
*&---------------------------------------------------------------------*
*& -->  p1        text
*& <--  p2        text
*&---------------------------------------------------------------------*
FORM clear_all .
  CLEAR : gv_tr, gs_mess, gs_hdr, gs_su, gt_su, gv_tanum.
ENDFORM.
*&---------------------------------------------------------------------*
*& Form create_to
*&---------------------------------------------------------------------*
*& text
*&---------------------------------------------------------------------*
*& -->  p1        text
*& <--  p2        text
*&---------------------------------------------------------------------*
FORM create_to.

  DATA:
    ls_ltap_creat TYPE ltap_creat,
    lt_ltap_creat TYPE TABLE OF ltap_creat,
    ls_ltak       TYPE ltak_vb,
    lt_ltak       TYPE TABLE OF ltak_vb,
    ls_ltap_vb    TYPE ltap_vb,
    lt_ltap_vb    TYPE TABLE OF ltap_vb,
    ls_ltap_in    TYPE l03b_trite,
    lt_ltap_in    TYPE  TABLE OF l03b_trite.

  IF gv_tanum IS NOT INITIAL.
    RETURN.
  ENDIF.
  CLEAR :lt_ltak,ls_ltak,lt_ltap_creat,lt_ltap_vb.
  IF gv_tr IS NOT INITIAL AND gt_su IS NOT INITIAL.

    "For Bin-22.08.2024
    SELECT SINGLE lgpla FROM lagp INTO @DATA(lv_bin)
    WHERE lgpla = @gs_hdr-benum AND lgtyp = '100' AND lgnum = @gs_hdr-lgnum.
    "For Bin-22.08.2024

*** Header
    MOVE-CORRESPONDING gs_hdr TO ls_ltak.
    APPEND ls_ltak TO lt_ltak.

    " Comment by lipsa 07.01.2026
*    LOOP AT gt_su INTO DATA(ls_su).
*      ls_ltap_creat-matnr = ls_su-matnr.
*      ls_ltap_creat-werks = ls_su-werks.
*      ls_ltap_creat-lgort = ls_su-lgort.
*      ls_ltap_creat-anfme = ls_su-verme.
*      ls_ltap_creat-altme = ls_su-meins.
*      ls_ltap_creat-vlenr = ls_su-su.
*
*      "Start of changes by Abinash for Destination Bin-22.08.2024
*      ls_ltap_creat-nltyp = '100'.
*      ls_ltap_creat-nlber = '001'.
*      ls_ltap_creat-nlpla = ls_ltak-benum.
    "End of changes by Abinash for Destination Bin-22.08.2024

*      APPEND ls_ltap_creat TO lt_ltap_creat.
*      CLEAR : ls_ltap_creat.

*    ENDLOOP.
****************************
    " Add by lipsa 09.01.2026
    LOOP AT gt_su INTO DATA(ls_su).
      "Quantity & UOM
      ls_ltap_in-tbpos = ls_su-tbpos.
      ls_ltap_in-anfme = ls_su-verme.      "ANFME
      ls_ltap_in-altme = ls_su-meins.      "ALT

      "Batch
      ls_ltap_in-charg = ls_su-charg.      "CHARG

      "Destination (NL*)
      ls_ltap_in-nltyp = gs_hdr-nltyp.            "NLT
      ls_ltap_in-nlpla = gs_hdr-nlpla.    "NLPLA

      "Source (VL*)
      ls_ltap_in-vltyp = ls_su-vltyp.           "VLT
      ls_ltap_in-vlpla = ls_su-vlpla.    "VLPLA
      ls_ltap_in-vlenr = ls_su-su.         "VLENR

      APPEND ls_ltap_in TO lt_ltap_in.
      CLEAR ls_ltap_in.
    ENDLOOP.
*****************************

    "Start of changes by Abinash for Storage Bin creation-22.08.2024
    BREAK amishra.
    IF lv_bin IS INITIAL.
      DATA: ls_xlagp TYPE lagp.
      ls_xlagp-lgnum = ls_ltak-lgnum.
      ls_xlagp-lgtyp = '100'.
      ls_xlagp-lgber = '001'.
      ls_xlagp-lgpla = ls_ltak-benum.

      CALL FUNCTION 'L_LAGP_HINZUFUEGEN'
        EXPORTING
          xlagp = ls_xlagp.
    ENDIF.

    " Comment by lipsa 01.07.2026
    "End of changes by Abinash for Storage Bin creation-22.08.2024

**    CALL FUNCTION 'L_TO_CREATE_MULTIPLE'
**      EXPORTING
**        i_lgnum                = gs_hdr-lgnum                " Warehouse number
**        i_bwlvs                = '999'                       " Movement Type
**        i_betyp                = 'A'                         " Requirement Type
**        i_benum                = gs_hdr-benum                " Requirement Number
**        i_commit_work          = 'X'                         " Processing with COMMIT WORK
**        i_bname                = sy-uname                    " User Name
**        i_kompl                = 'X'                         " Only create TO if requested quantity is supplied in full
**        I_AUSFB                = 'X'
**      IMPORTING
**        e_tanum                = gv_tanum                    " Transfer Order Number
**      TABLES
**        t_ltap_creat           = lt_ltap_creat               " Structure for Creating Multi-Item Transfer Orders
**        t_ltak                 = lt_ltak                     " Transmission structure LTAD + LTAK1 for update task
**        t_ltap_vb              = lt_ltap_vb                  " Transmission structure LTAP + LTAP1 for update task
**      EXCEPTIONS
**        no_to_created          = 1                           " DE-EN-LANG-SWITCH-NO-TRANSLATION
**        bwlvs_wrong            = 2                           " DE-EN-LANG-SWITCH-NO-TRANSLATION
**        betyp_wrong            = 3                           " DE-EN-LANG-SWITCH-NO-TRANSLATION
**        benum_missing          = 4                           " DE-EN-LANG-SWITCH-NO-TRANSLATION
**        betyp_missing          = 5                           " DE-EN-LANG-SWITCH-NO-TRANSLATION
**        foreign_lock           = 6                           " DE-EN-LANG-SWITCH-NO-TRANSLATION
**        vltyp_wrong            = 7                           " Source storage type contradicts movement type
**        vlpla_wrong            = 8                           " Source storage bin contradicts movement type
**        vltyp_missing          = 9                           " DE-EN-LANG-SWITCH-NO-TRANSLATION
**        nltyp_wrong            = 10                          " Destination storage type contradicts movement type
**        nlpla_wrong            = 11                          " Destination storage bin contradicts movement type
**        nltyp_missing          = 12                          " DE-EN-LANG-SWITCH-NO-TRANSLATION
**        rltyp_wrong            = 13                          " Return storage type contradicts movement type
**        rlpla_wrong            = 14                          " Return storage bin contradicts movement type
**        rltyp_missing          = 15                          " DE-EN-LANG-SWITCH-NO-TRANSLATION
**        squit_forbidden        = 16                          " DE-EN-LANG-SWITCH-NO-TRANSLATION
**        manual_to_forbidden    = 17                          " DE-EN-LANG-SWITCH-NO-TRANSLATION
**        letyp_wrong            = 18                          " DE-EN-LANG-SWITCH-NO-TRANSLATION
**        vlpla_missing          = 19                          " DE-EN-LANG-SWITCH-NO-TRANSLATION
**        nlpla_missing          = 20                          " DE-EN-LANG-SWITCH-NO-TRANSLATION
**        sobkz_wrong            = 21                          " DE-EN-LANG-SWITCH-NO-TRANSLATION
**        sobkz_missing          = 22                          " DE-EN-LANG-SWITCH-NO-TRANSLATION
**        sonum_missing          = 23                          " DE-EN-LANG-SWITCH-NO-TRANSLATION
**        bestq_wrong            = 24                          " DE-EN-LANG-SWITCH-NO-TRANSLATION
**        lgber_wrong            = 25                          " DE-EN-LANG-SWITCH-NO-TRANSLATION
**        xfeld_wrong            = 26                          " DE-EN-LANG-SWITCH-NO-TRANSLATION
**        date_wrong             = 27                          " Incorrect Date Entry
**        drukz_wrong            = 28                          " DE-EN-LANG-SWITCH-NO-TRANSLATION
**        ldest_wrong            = 29                          " Printer does not exist
**        update_without_commit  = 30                          " DE-EN-LANG-SWITCH-NO-TRANSLATION
**        no_authority           = 31                          " No Authorization
**        material_not_found     = 32                          " DE-EN-LANG-SWITCH-NO-TRANSLATION
**        lenum_wrong            = 33                          " DE-EN-LANG-SWITCH-NO-TRANSLATION
**        matnr_missing          = 34                          " DE-EN-LANG-SWITCH-NO-TRANSLATION
**        werks_missing          = 35                          " Plant missing
**        anfme_missing          = 36                          " DE-EN-LANG-SWITCH-NO-TRANSLATION
**        altme_missing          = 37                          " Unit of measure missing
**        lgort_wrong_or_missing = 38
**        OTHERS                 = 39.
**********************************************
    " Add by lipsa 01.07.2026
    CALL FUNCTION 'L_TO_CREATE_TR'
      EXPORTING
        i_lgnum                        = gs_hdr-lgnum
        i_tbnum                        = gs_hdr-tbnum
*       I_REFNR                        = ' '
*       I_SQUIT                        = ' '
*       I_NIDRU                        = ' '
*       I_DRUKZ                        = ' '
*       I_LDEST                        = ' '
*       I_TBELI                        = ' '
*       I_NOSPL                        = ' '
*       I_UPDATE_TASK                  = ' '
        i_commit_work                  = 'X'
        i_bname                        = sy-uname
*       I_TEILK                        = ' '
*       I_SOLEX                        = 0
*       I_PERNR                        = 0
        i_rsnum                        = gs_hdr-rsnum
*       I_LDEST_LANG                   = ' '
        it_trite                       = lt_ltap_in
      IMPORTING
        e_tanum                        = gv_tanum
*       E_TEILK                        =
      TABLES
        t_ltak                         = lt_ltak
        t_ltap_vb                      = lt_ltap_vb
*       T_WMGRP_MSG                    =
      EXCEPTIONS
        foreign_lock                   = 1
        qm_relevant                    = 2
        tr_completed                   = 3
        xfeld_wrong                    = 4
        ldest_wrong                    = 5
        drukz_wrong                    = 6
        tr_wrong                       = 7
        squit_forbidden                = 8
        no_to_created                  = 9
        update_without_commit          = 10
        no_authority                   = 11
        preallocated_stock             = 12
        partial_transfer_req_forbidden = 13
        input_error                    = 14
        OTHERS                         = 15.
    IF sy-subrc <> 0.
      MESSAGE ID sy-msgid TYPE sy-msgty NUMBER sy-msgno
        WITH sy-msgv1 sy-msgv2 sy-msgv3 sy-msgv4.
    ELSEIF gv_tanum IS NOT INITIAL.
      gs_mess-error = c_s.
      gs_mess-mess1 = gv_tanum.
      gs_mess-mess2 = 'Successfully '.
      gs_mess-mess2 = 'Created'.
      CALL SCREEN '9999'.
      PERFORM clear_all.
      RETURN.
    ENDIF.
  ENDIF.

ENDFORM.
*&---------------------------------------------------------------------*
*& Form validate
*&---------------------------------------------------------------------*
*& text
*&---------------------------------------------------------------------*
*& -->  p1        text
*& <--  p2        text
*&---------------------------------------------------------------------*
FORM validate .
  DATA: lv_bal_qty TYPE lqua-verme.
  CLEAR : lv_bal_qty , gv_scan_qty.
  IF gv_tr IS NOT INITIAL AND gv_su IS NOT INITIAL.
    gv_su = |{ gv_su ALPHA = IN }|.
*** Duplicate Scan
    IF line_exists( gt_su[ su = gv_su ] ).
      gs_mess-error = c_e.
      gs_mess-mess1 = gv_su.
      gs_mess-mess2 = 'SU Already Scanned'.
      CLEAR : gv_su.
      CALL SCREEN '9999'.
      RETURN.
    ENDIF.
    SELECT
      lgnum,
      lqnum,
      matnr,
      werks,
      charg,
      verme,
      meins,
      lgort,
      lgtyp,
      lgpla,
      lenum
      INTO @DATA(ls_lqua)
      FROM lqua
      FOR ALL ENTRIES IN @gt_ltbp
      WHERE lgnum = @gs_hdr-lgnum AND lenum = @gv_su AND matnr = @gt_ltbp-matnr AND werks = @gt_ltbp-werks.
*      AND charg = @gt_ltbp-charg.
    ENDSELECT.
    IF sy-subrc IS NOT INITIAL.
***     Invalid SU
      gs_mess-error = c_e.
      gs_mess-mess1 = gv_su.
      gs_mess-mess2 = 'Invalid SU'.
      CLEAR : gv_su.
      CALL SCREEN '9999'.
      RETURN.
    ELSEIF ls_lqua-verme LE 0.
      gs_mess-error = c_e.
      gs_mess-mess1 = gv_su.
      gs_mess-mess2 = 'No Stock'.
      CLEAR : gv_su.
      CALL SCREEN '9999'.
      RETURN.
    ELSE.
***   Validate Qty
*      SELECT SUM( verme ) FROM @gt_su AS su WHERE matnr = @ls_lqua-matnr AND werks = @ls_lqua-werks
*      AND charg = @ls_lqua-charg INTO @DATA(lv_qty).

      SELECT SUM( verme ) FROM @gt_su AS su WHERE matnr = @ls_lqua-matnr AND werks = @ls_lqua-werks INTO @DATA(lv_qty).        " Batch Not Considering
      DATA(lv_tr_qty) = VALUE #( gt_ltbp[ matnr = ls_lqua-matnr werks = ls_lqua-werks ]-menge OPTIONAL ).
      IF lv_tr_qty LT lv_qty.
        gs_mess-error = c_e.
        gs_mess-mess1 = gv_su.
        gs_mess-mess2 = 'Qty Exceeding'.
        CLEAR : gv_su.
        CALL SCREEN '9999'.
        RETURN.
      ELSEIF lv_tr_qty < ( lv_qty + ls_lqua-verme ).
        lv_bal_qty = lv_tr_qty - lv_qty.
      ENDIF.
    ENDIF.

***   Add to item
  READ TABLE gt_ltbp INTO gs_ltbp
  WITH KEY
    tbnum = gs_hdr-tbnum
    matnr = ls_lqua-matnr.

    IF lv_bal_qty IS NOT INITIAL.
      APPEND VALUE #( matnr = ls_lqua-matnr werks = ls_lqua-werks meins = ls_lqua-meins
                      charg = ls_lqua-charg verme = lv_bal_qty su = gv_su  lgort = ls_lqua-lgort
                      tbpos = gs_ltbp-tbpos vltyp = ls_lqua-lgtyp vlpla = ls_lqua-lgpla ) TO gt_su.
      gv_scan_qty = lv_bal_qty.
      gv_open_qty = 0.
    ELSE.

      APPEND VALUE #( matnr = ls_lqua-matnr werks = ls_lqua-werks meins = ls_lqua-meins
                      charg = ls_lqua-charg verme = ls_lqua-verme su = gv_su  lgort = ls_lqua-lgort
                      vltyp = ls_lqua-lgtyp vlpla = ls_lqua-lgpla
                      tbpos = gs_ltbp-tbpos ) TO gt_su.

      gv_open_qty = COND #( WHEN lv_tr_qty - ( lv_qty + ls_lqua-verme ) > 0
                            THEN lv_tr_qty - ( lv_qty + ls_lqua-verme ) ELSE 0 ).
      gv_scan_qty = ls_lqua-verme.
    ENDIF.

    CLEAR:gv_su.
    gs_su-matnr = ls_lqua-matnr.
    gs_su-charg = ls_lqua-charg.
    SELECT SINGLE maktx INTO @gs_su-maktx FROM makt WHERE matnr = @ls_lqua-matnr.
  ENDIF.
ENDFORM.