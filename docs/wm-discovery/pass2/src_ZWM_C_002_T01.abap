*&---------------------------------------------------------------------*
*& Include          ZWM_C_002_T01
*&---------------------------------------------------------------------*
TYPES: BEGIN OF ls_excel,
         lenum(20) TYPE c,                          " Storage Unit
         bwlvs(3)  TYPE c,                          " Movement Type
         letyp(3)  TYPE c,                      " Storage Unit Type
         nltyp(3)  TYPE c,                     " Destination Storage Type
         nlber(3)  TYPE c,                     " Destination Storage Section
         nlpla(10) TYPE c,                     " Destination Storage Bin
       END OF ls_excel,

       BEGIN OF ls_data,
         lenum TYPE lenum,                          " Storage Unit
         bwlvs TYPE bwlvs,                          " Movement Type
         letyp TYPE lvs_letyp,                      " Storage Unit Type
         nltyp TYPE ltap_nltyp,                     " Destination Storage Type
         nlber TYPE ltap_nlber,                     " Destination Storage Section
         nlpla TYPE ltap_nlpla,                     " Destination Storage Bin
       END OF ls_data.

TYPES: BEGIN OF ls_msg,
         slno TYPE int4,
         msg  TYPE string,
       END OF ls_msg.

DATA: gt_excel TYPE TABLE OF ls_excel,
      gt_data  TYPE TABLE OF ls_data,
      wa_data  TYPE ls_data.

DATA: fname TYPE localfile,
      ename TYPE char4.

DATA: gv_tanum TYPE tanum.

DATA: gt_message TYPE TABLE OF ls_msg,
      wa_message TYPE ls_msg.