*&---------------------------------------------------------------------*
*& Include          ZWM_C_002_T01
*&---------------------------------------------------------------------*
TYPES: BEGIN OF ls_data,
         tanum(10), "TO Number
         tapos(4), "TO Item
         lgnum(3), "Warehouse
         bwart(4), "Movement Type
         matnr(40), "Material
         werks(4), "Plant
         lgort(4), "Storage Location
         charg(10), "Batch
         sobkz(1), "Special Stock
         sonum(16), "Special Stock Number
         letyp(3), "SU Type
         menge(15), "Qty
         gewei(3), "Unit
         pquit(1), "Auto TO confirm
         vltyp(3), "Source Storage Type
         vlber(3), "Source Storage Section
         vlpla(10), "Source Storage Bin
         nltyp(3), "Destination Storage Type
         nlber(3), "Destination Storage Section
         nlpla(10), "Destination Storage Bin
         nlenr(20), "Storage Unit
       END OF ls_data.

TYPES: BEGIN OF ls_msg,
         tanum(10), "TO Number
         msg  TYPE string,
       END OF ls_msg.

DATA: gt_data TYPE TABLE OF ls_data,
      wa_data TYPE ls_data.

DATA: fname TYPE localfile,
      ename TYPE char4.

DATA: gv_tanum TYPE tanum.

DATA: gt_message TYPE TABLE OF ls_msg,
      wa_message TYPE ls_msg.