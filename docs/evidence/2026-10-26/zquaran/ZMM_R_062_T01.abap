*&---------------------------------------------------------------------*
*& Include          ZMM_R_062_T01
*&---------------------------------------------------------------------*

TABLES: ausp, mch1, qave.

DATA: gt_final    TYPE zmm_tt_026,
      gs_final    TYPE zmm_s_013,
      lv_material TYPE matnr,
      lv_count_f  TYPE char5,
      lv_count_t  TYPE char5.

*DELETE gt_mch1 WHERE zzcust_batch = ' '.
TYPES: BEGIN OF ty_amchl,
         objek TYPE cuobn,
         charg TYPE charg_d,
       END OF ty_amchl.

DATA: it_amchl TYPE TABLE OF ty_amchl.

DATA: fm_name TYPE rs38l_fnam.
DATA: formname TYPE fpname.
DATA: fp_docparams    TYPE sfpdocparams,    " Structure  SFPDOCPARAMS Short Description  Form Parameters for Form Processing
      fp_outputparams TYPE sfpoutputparams. " Structure  SFPOUTPUTPARAMS Short Description  Form Processing Output Parameter