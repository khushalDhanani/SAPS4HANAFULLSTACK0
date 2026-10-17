*&---------------------------------------------------------------------*
*& Include SAPMZWM_E_001_TOP                        - Module Pool      SAPMZWM_E_001
*&---------------------------------------------------------------------*
PROGRAM sapmzwm_e_001 MESSAGE-ID zwmm001.

TYPES:
  BEGIN OF ty_final,
    lgnum  TYPE ltbk-lgnum,
    bwlvs  TYPE ltbk-bwlvs,
    trart  TYPE ltbk-trart,
    tbnum  TYPE ltbk-tbnum,
    betyp  TYPE ltbk-betyp,
    benum  TYPE ltbk-benum,
    rsnum  TYPE ltbk-rsnum,
    bdart  TYPE ltbk-bdart,
    vltyp  TYPE ltbk-vltyp,
    vlber  TYPE ltbk-vltyp,
    vlpla  TYPE ltbk-vltyp,

    matnr  TYPE ltbp-matnr,
    werks  TYPE ltbp-werks,
    lgort  TYPE ltbp-lgort,
    anfme  TYPE ltbp-menga,
    altme  TYPE ltbp-altme,

    matnr1 TYPE ltbp-matnr,
    werks1 TYPE ltbp-werks,
    charg  TYPE ltbp-charg,
    meins  TYPE ltbp-meins,
  END OF ty_final,

  BEGIN OF ty_ltbk,
    lgnum TYPE ltbk-lgnum,
    bwlvs TYPE ltbk-bwlvs,
    trart TYPE ltbk-trart,
    tbnum TYPE ltbk-tbnum,
    betyp TYPE ltbk-betyp,
    benum TYPE ltbk-benum,
    rsnum TYPE ltbk-rsnum,
    bdart TYPE ltbk-bdart,
    vltyp TYPE ltbk-vltyp,
*    vlber TYPE ltbk-vltyp,
    vlpla TYPE ltbk-vltyp,
    nltyp type ltbk-nltyp,
    nlpla type ltbk-nlpla,
  END OF ty_ltbk,

  BEGIN OF ty_ltbp,
    tbnum TYPE ltbp-tbnum,
    tbpos TYPE ltbp-tbpos,
    matnr TYPE ltbp-matnr,
    werks TYPE ltbp-werks,
    lgort TYPE ltbp-lgort,
    menge TYPE ltbp-menge,
    menga TYPE ltbp-menga,
    charg TYPE ltbp-charg,
  END OF ty_ltbp,

  " Comment by lipsa
*  BEGIN OF ty_su,
*    su    TYPE lenum,
*    verme TYPE lqua-verme,
*    meins TYPE lqua-meins,
*    matnr TYPE matnr,
*    maktx TYPE maktx,
**    charg TYPE charg_d,
*    charg TYPE lqua-charg,
*    werks TYPE werks_d,
*    lgort TYPE lgort_d,
*  END OF ty_su.
************************
  " Add by lipsa
  BEGIN OF ty_su,
    tbpos TYPE ltbp-tbpos,
    verme TYPE lqua-verme,
    meins TYPE lqua-meins,
    matnr TYPE matnr,
    maktx TYPE maktx,
    charg TYPE lqua-charg,
    werks TYPE werks_d,
    lgort TYPE lgort_d,
    nltyp TYPE ltbk-nltyp,
    nlpla TYPE ltbk-nlpla,
    vltyp TYPE lqua-lgtyp,
    vlpla TYPE lqua-lgpla,
    su    TYPE lqua-lenum,
  END OF ty_su.
*************************

DATA:
  gv_icon_9999(132),
  gv_text(100),
  gv_icon_name(30),
  ok_code_9999      TYPE sy-ucomm,
  ok_code_9001      TYPE sy-ucomm,
  gv_tr             TYPE ltbk-benum,
  gv_su             TYPE lqua-lenum,
  gv_tanum          TYPE ltak-tanum,
  gv_open_qty       TYPE lqua-verme,
  gv_scan_qty       TYPE lqua-verme.

DATA:
  gs_mess TYPE zwm_s_001,
  gt_hdr  TYPE TABLE OF ty_final,
  gt_ltbp TYPE TABLE OF ty_ltbp,
  gs_ltbp type ty_ltbp,
  gs_hdr  TYPE ty_ltbk,
  gs_su   TYPE ty_su,
  gt_su   TYPE TABLE OF ty_su.

CONSTANTS:
  c_e(20)      VALUE 'Error',
  c_w(20)      VALUE 'Warning',
  c_s(20)      VALUE 'Success',
  fcode_back   LIKE sy-ucomm    VALUE 'BACK',
  fcode_canc   LIKE sy-ucomm    VALUE 'CANC',
  fcode_exit   LIKE sy-ucomm    VALUE 'EXIT',
  fcode_clear  LIKE sy-ucomm    VALUE 'CLR',
  fcode_create LIKE sy-ucomm    VALUE 'CREATE',
  fcode_enter  LIKE sy-ucomm    VALUE 'ENTER',
  fcode_save   LIKE sy-ucomm    VALUE 'SAVE'.