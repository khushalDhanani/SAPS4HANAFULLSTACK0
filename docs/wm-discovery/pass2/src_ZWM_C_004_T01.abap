*&---------------------------------------------------------------------*
*& Include          ZWM_C_004_T01
*&---------------------------------------------------------------------*

TYPES : BEGIN OF ty_data,
          doc_no(04)        TYPE c,        " MIGO Document No.
          item(04)          TYPE c,        " MIGO Item
          doc_date(08)      TYPE c,        " DOCUMENT DATE
          pstng_date(08)    TYPE c,        " POSTING DATE
          material_slip(25) TYPE c,        " Material Slip
          header_txt(25)    TYPE c,        " Document Header Text
          gm_code(02)       TYPE c,        " Goods Movement Code
          move_type(03)     TYPE c,        " Movement Type
          material(18)      TYPE c,        " MATERIAL
          plant(04)         TYPE c,        " PLANT
          stge_loc(04)      TYPE c,        " Storage Location
          entry_qnt(13)     TYPE c,        " Quantity in unit of entry
          amount_lc(23)     TYPE c,        " Amount in LC
          unit(03)          TYPE c,        " UNIT
          serialno(18)      TYPE c,        " Serial Number
        END OF ty_data,

        BEGIN OF ty_error_log,
          mat_doc(04) TYPE c,
          item(04)    TYPE c,
          mblnr       TYPE mblnr,
          msg         TYPE char1,
          ermsg       TYPE char255,
        END OF ty_error_log.

DATA : gt_data                  TYPE TABLE OF ty_data,
       gs_data                  TYPE ty_data,

       it_error_log             TYPE TABLE OF ty_error_log,                    " Internal table for error logs
       wa_error_log             TYPE ty_error_log ##NEEDED,

       lo_table                 TYPE REF TO cl_salv_table,                     " for factory method
       lr_display               TYPE REF TO cl_salv_display_settings,
       lr_functions             TYPE REF TO cl_salv_functions,
       lr_cols                  TYPE REF TO cl_salv_columns,
       lr_col                   TYPE REF TO cl_salv_column,

       fname                    TYPE localfile,
       ename                    TYPE char4,

       goodsmvt_header          TYPE  bapi2017_gm_head_01,                      "Material Document Header Data
       goodsmvt_code            TYPE  bapi2017_gm_code,                         " Assign Code to Transaction for Goods Movement
       gt_goodsmvt_item         TYPE TABLE OF bapi2017_gm_item_create,          " Material Document Items
       gs_goodsmvt_item         TYPE  bapi2017_gm_item_create,
       gt_goodsmvt_serialnumber TYPE TABLE OF  bapi2017_gm_serialnumber,        " Serial Number
       gs_goodsmvt_serialnumber TYPE  bapi2017_gm_serialnumber,
       return                   TYPE TABLE OF bapiret2,                         " Return Messages
       goodsmvt_headret         TYPE   bapi2017_gm_head_ret,
       materialdocument         TYPE mblnr,
       matdocumentyear          TYPE mjahr.