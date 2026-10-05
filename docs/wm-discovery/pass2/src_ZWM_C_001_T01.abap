*&---------------------------------------------------------------------*
*& Include          ZWM_C_001_T01
*&---------------------------------------------------------------------*

TYPES: BEGIN OF ls_data,
         lenum TYPE lenum,                          " Storage Unit
         bwlvs TYPE bwlvs,                          " Movement Type
         letyp TYPE lvs_letyp,                      " Storage Unit Type
         nltyp TYPE ltap_nltyp,                     " Destination Storage Type
         nlber TYPE ltap_nlber,                     " Destination Storage Section
         nlpla TYPE ltap_nlpla,                     " Destination Storage Bin
       END OF ls_data.

TYPES: BEGIN OF ls_log,
         lenum    TYPE lenum,                       " Storage Unit
         bwlvs    TYPE bwlvs,                       " Movement Type
         letyp    TYPE lvs_letyp,                   " Storage Unit Type
         nltyp    TYPE ltap_nltyp,                  " Destination Storage Type
         nlber    TYPE ltap_nlber,                  " Destination Storage Section
         nlpla    TYPE ltap_nlpla,                  " Destination Storage Bin
         tcode    TYPE bdc_tcode,                   " Transaction Code
         msgtyp   TYPE bdc_mart,                    " Message Type
         msgspra  TYPE bdc_spras,                   " Message Language
         msgid    TYPE bdc_mid,                     " Message ID
         msgnr    TYPE bdc_mnr,                     " Message Number
         msgv1    TYPE bdc_vtext1,                  " Message Variable 1
         msgv2    TYPE bdc_vtext1,                  " Message Variable 2
         msgv3    TYPE bdc_vtext1,                  " Message Variable 3
         msgv4    TYPE bdc_vtext1,                  " Message Variable 4
         env      TYPE bdc_akt,                     " BDC Environment
         fldname  TYPE fnam_____4,                  " Field Name
         msg_text TYPE string,                      " Message Text
       END OF ls_log.

DATA: gt_data TYPE TABLE OF ls_data,
      wa_data TYPE ls_data.

DATA: gt_log TYPE TABLE OF ls_log,
      wa_log TYPE ls_log.

DATA: fname TYPE localfile,
      ename TYPE char4.

DATA : lt_messtab TYPE TABLE OF bdcmsgcoll,
       wa_messtab TYPE bdcmsgcoll.

DATA: lt_bdcdata TYPE TABLE OF bdcdata,
      wa_bdcdata TYPE bdcdata.

" BDC processing mode and update mode
DATA : ctumode LIKE ctu_params-dismode VALUE 'N',      " Processing mode (No display)
       cupdate LIKE ctu_params-updmode VALUE 'A'.      " Update mode (Asynchronous)

" ALV field catalog and layout
DATA : t_fieldcat  TYPE STANDARD TABLE OF slis_fieldcat_alv,     " Table for ALV field catalog
       wa_fieldcat TYPE slis_fieldcat_alv,                       " Work area for ALV field catalog
       wa_layout   TYPE slis_layout_alv.                         " Work area for ALV layout

DATA: msg_text TYPE string.    "Variable for storing Message Text