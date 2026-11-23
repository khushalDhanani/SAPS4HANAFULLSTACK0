*&---------------------------------------------------------------------*
*& Include          ZWM_C_002_T01
*&---------------------------------------------------------------------*
TYPES: BEGIN OF ls_data,
         nlenr(20), "SU
         zsu(20), "Custom SU
       END OF ls_data.

TYPES: BEGIN OF ls_msg,
         slno TYPE int4,
         msg  TYPE string,
       END OF ls_msg.

DATA: gt_excel TYPE STANDARD TABLE OF ls_data.

DATA: gt_data TYPE TABLE OF zmm_t_024,
      wa_data TYPE zmm_t_024.

DATA: fname TYPE localfile,
      ename TYPE char4.

DATA: gv_tanum TYPE tanum.

DATA: gt_message TYPE TABLE OF ls_msg,
      wa_message TYPE ls_msg.