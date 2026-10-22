*&---------------------------------------------------------------------*
*& Report ZRF_RES_HU_TRANSFER_DNR
*&---------------------------------------------------------------------*
*& Client      : Aether Industries Limited
*& Module      : MM / WM / HUM
*& Program     : ZRF_RES_HU_TRANSFER_DNR
*& Description : List of 311 Reservations & RF/Desktop HU Stock Transfer
*& Author      : DNR / Dipak Rathod
*& Date        : 18.10.2026
*& TR          : DS4K905295
*&---------------------------------------------------------------------*
REPORT zrf_res_hu_transfer_dnr NO STANDARD PAGE HEADING.

TABLES: resb, rkpf, vekp, vepo, makt, sscrfields, lqua, lagp, adrp.

*&---------------------------------------------------------------------*
*& Type Definitions & Global Data
*&---------------------------------------------------------------------*
TYPES: BEGIN OF ty_alv_res,
         rsnum      TYPE resb-rsnum,
         rspos      TYPE resb-rspos,
         status_txt TYPE c LENGTH 25,
         bwart      TYPE resb-bwart,
         usnam      TYPE rkpf-usnam,
         name_text  TYPE c LENGTH 100,
         u_phone    TYPE c LENGTH 30,
         u_mail     TYPE c LENGTH 60,
         bdter      TYPE resb-bdter,
         matnr      TYPE resb-matnr,
         maktx      TYPE makt-maktx,
         charg      TYPE resb-charg,
         bdmng      TYPE resb-bdmng,
         enmng      TYPE resb-enmng,
         open_qty   TYPE resb-bdmng,
         meins      TYPE resb-meins,
         werks      TYPE resb-werks,
         lgort      TYPE resb-lgort,
         umlgo      TYPE resb-umlgo,
         lgnum      TYPE lqua-lgnum,
         avail_hu   TYPE i,
         sut_ind    TYPE c LENGTH 12, " 'SUT-Enabled' or 'Standard'
         letyp      TYPE lvs_letyp,   " Allowed/Preferred SUT
         letyt      TYPE lvs_letyt,   " SUT Description
         kzear      TYPE resb-kzear,
         xloek      TYPE resb-xloek,
         t_color    TYPE lvc_t_scol,  " Row & Cell Colors for ALV Line Highlight
       END OF ty_alv_res.

TYPES: BEGIN OF ty_f4_hu,
         exidv     TYPE vekp-exidv,  " Unit Number (HU or SU)
         unit_type TYPE c LENGTH 12, " Unit Category: HU or SU
         sut       TYPE lvs_letyp,   " SUT Code
         sut_tx    TYPE lvs_letyt,   " SUT Description
         stg_stat  TYPE c LENGTH 20, " Stock Status: Available / In-Process / On-Hold
         lgtyp     TYPE lqua-lgtyp,  " Storage Type (e.g. EN1, 911, OH1)
         lgpla     TYPE lagp-lgpla,  " Storage Bin
         sernr     TYPE gernr,       " Serial Number
         charg     TYPE vepo-charg,
         vemng     TYPE vepo-vemng,
         vemeh     TYPE vepo-vemeh,
         werks     TYPE vepo-werks,
         lgort     TYPE vepo-lgort,
         status    TYPE vekp-status,
         matnr     TYPE vepo-matnr,
         sort_prio TYPE i,           " 1=Available, 2=In-Process, 3=On-Hold
       END OF ty_f4_hu.

TYPES: BEGIN OF ty_bin_stock,
         stg_stat  TYPE c LENGTH 25, " Stock Status: Available / In-Process / On-Hold
         unit_type TYPE c LENGTH 12, " Unit Category: HU or SU
         sut       TYPE lvs_letyp,   " SUT Code
         sut_tx    TYPE lvs_letyt,   " SUT Description
         lgtyp     TYPE lqua-lgtyp,  " Storage Type
         ltypt     TYPE t301t-ltypt, " Storage Type Description
         bin_pos   TYPE c LENGTH 10, " Storage Bin Position (e.g. 04)
         lgpla     TYPE lagp-lgpla,  " Storage Bin
         lgber     TYPE lagp-lgber,  " Storage Section Code
         lbert     TYPE t302t-lbert, " Storage Section Name / Description
         lptyp     TYPE lagp-lptyp,  " Storage Bin Type (Bin Position 0 to 6)
         exidv     TYPE vekp-exidv,  " Handling Unit (HU) or Storage Unit (SU)
         sernr     TYPE c LENGTH 30, " Serial Number
         vemng     TYPE vepo-vemng,  " Available Quantity
         vemeh     TYPE vepo-vemeh,  " Unit
         charg     TYPE vepo-charg,  " Batch
         lgnum     TYPE lqua-lgnum,  " Warehouse
         lgort     TYPE lqua-lgort,  " Storage Location
         sort_prio TYPE i,           " 1=Available (EN1), 2=In-Process, 3=On-Hold
         t_color   TYPE lvc_t_scol,  " SALV Cell Colors
       END OF ty_bin_stock.

TYPES: BEGIN OF ty_visual_rack,
         lgpla      TYPE lagp-lgpla,  " ACTUAL Storage Bin from SAP (e.g. 1-L0001-04)
         lptyp      TYPE lagp-lptyp,  " Storage Bin Type (Bin Position 0 to 6)
         rack_ref   TYPE c LENGTH 25, " Visual Rack Position (e.g. R1-S1-B1, F1-R1-S1-B4)
         floor_id   TYPE c LENGTH 15, " Floor (e.g. Floor 1, Floor 0)
         rack_num   TYPE c LENGTH 15, " Rack Number (e.g. L0001)
         bin_pos    TYPE c LENGTH 35, " Bin Position (0 to 6)
         level_id   TYPE c LENGTH 40, " Shelf Level Description
         level_code TYPE c LENGTH 10, " B6, B5, B4, B3, B2, B1, B0, FL
         pallet_vis TYPE c LENGTH 25, " [📦 PALLET @ 04]
         rack_sec   TYPE c LENGTH 35, " Floor 1 / Rack L0001 (S1)
         lbert      TYPE t302t-lbert, " Storage Section Name / Description (Color Code)
         exidv      TYPE vekp-exidv,  " Handling Unit (HU) or Storage Unit (SU)
         unit_type  TYPE c LENGTH 12, " Unit Category: HU or SU
         sut        TYPE lvs_letyp,   " SUT Code
         sut_tx     TYPE lvs_letyt,   " SUT Description
         sernr      TYPE c LENGTH 30, " Serial Number
         vemng      TYPE vepo-vemng,  " Available Quantity
         vemeh      TYPE vepo-vemeh,  " Unit
         charg      TYPE vepo-charg,  " Batch
         stg_stat   TYPE c LENGTH 30, " Stock Status
         lgtyp      TYPE lqua-lgtyp,  " Storage Type
         ltypt      TYPE t301t-ltypt, " Storage Type Description
         lgber      TYPE lagp-lgber,  " Storage Section Code
         lgnum      TYPE lqua-lgnum,  " Warehouse
         lgort      TYPE lqua-lgort,  " Storage Location
         level_num  TYPE i,           " 6=6th, 5=5th, 4=4th, 3=3rd, 2=2nd, 1=1st, 0=Ground
         sort_prio  TYPE i,           " 1=Available, 2=In-Process, 3=On-Hold
         t_color    TYPE lvc_t_scol,  " SALV Cell Colors
       END OF ty_visual_rack.

DATA: gt_alv         TYPE STANDARD TABLE OF ty_alv_res,
      gs_sel_item    TYPE ty_alv_res,
      gt_bin_stock   TYPE STANDARD TABLE OF ty_bin_stock,
      gt_visual_rack TYPE STANDARD TABLE OF ty_visual_rack,
      gv_posted      TYPE abap_bool.

DATA: gv_hu_matnr  TYPE vepo-matnr,
      gv_hu_charg  TYPE vepo-charg,
      gv_hu_qty    TYPE vepo-vemng,
      gv_hu_meins  TYPE vepo-vemeh,
      gv_hu_lgort  TYPE vepo-lgort,
      gv_hu_werks  TYPE vepo-werks,
      gv_hu_sernr  TYPE gernr,
      gv_pref_stg  TYPE mlgt-lgtyp,
      gv_venum     TYPE vekp-venum,
      gv_hu_valid  TYPE abap_bool,
      gv_unit_type TYPE c LENGTH 12, " 'HU' or 'SU'
      gv_letyp     TYPE lvs_letyp,
      gv_letyt     TYPE lvs_letyt.

TYPES: BEGIN OF ty_strategy_stg,
         lgtyp  TYPE lqua-lgtyp,
         prio   TYPE i,           " 1=Removal Strategy (A), 2=Placement Strategy (E), 3=MLGT, 4=Whse SLoc Stock
         source TYPE c LENGTH 30, " Source Description
         lgtkz  TYPE mlgn-ltkza,  " Strategy Indicator (e.g. EN1)
         ltypt  TYPE t301t-ltypt, " Type Description
       END OF ty_strategy_stg.
DATA: gt_strategy_stg TYPE STANDARD TABLE OF ty_strategy_stg WITH KEY lgtyp.

*&---------------------------------------------------------------------*
*& Testing & Pilot Notification Configuration
*& (Set gv_test_notify = abap_false or clear recipient variables for PROD)
*&---------------------------------------------------------------------*
DATA: gv_test_notify    TYPE abap_bool      VALUE abap_true, " Set abap_false for Production
      gv_test_cc_email1 TYPE adr6-smtp_addr VALUE 'naresh@aether.co.in',
      gv_test_cc_email2 TYPE adr6-smtp_addr VALUE 'Dipak@aether.co.in',
      gv_test_user1     TYPE sy-uname       VALUE 'DRATHOD',
      gv_test_user2     TYPE sy-uname       VALUE 'NARESH'.

DATA: gr_salv_table     TYPE REF TO cl_salv_table,
      gr_salv_popup     TYPE REF TO cl_salv_table,
      gr_salv_vis_popup TYPE REF TO cl_salv_table.

*&---------------------------------------------------------------------*
*&---------------------------------------------------------------------*
*& SCREEN 1000 - Selection & Filter Screen
*&---------------------------------------------------------------------*
SELECTION-SCREEN BEGIN OF BLOCK b_sel WITH FRAME TITLE t_sel.
  PARAMETERS: p_lgnum TYPE lqua-lgnum MEMORY ID lgn. " Warehouse Code (Optional)
  PARAMETERS: p_plnt  TYPE resb-werks DEFAULT '1120' MEMORY ID wrk. " Plant
  SELECT-OPTIONS: s_sloc  FOR resb-lgort.              " Storage Location (Blank = All SLocs)
  SELECT-OPTIONS: s_bwart FOR resb-bwart.               " Movement Type (Blank = All)
  SELECT-OPTIONS: s_usnam FOR rkpf-usnam.              " Requester (Blank = All Users)
  SELECT-OPTIONS: s_res   FOR resb-rsnum.              " Reservation Number
  SELECT-OPTIONS: s_mat   FOR resb-matnr.              " Material Code
SELECTION-SCREEN END OF BLOCK b_sel.

SELECTION-SCREEN BEGIN OF BLOCK b_stat WITH FRAME TITLE t_stat.
  SELECTION-SCREEN BEGIN OF LINE.
    PARAMETERS: r_open RADIOBUTTON GROUP g_st DEFAULT 'X'.
    SELECTION-SCREEN COMMENT 4(25) c_st_op FOR FIELD r_open.
    PARAMETERS: r_comp RADIOBUTTON GROUP g_st.
    SELECTION-SCREEN COMMENT 33(25) c_st_co FOR FIELD r_comp.
    PARAMETERS: r_all  RADIOBUTTON GROUP g_st.
    SELECTION-SCREEN COMMENT 62(16) c_st_al FOR FIELD r_all.
  SELECTION-SCREEN END OF LINE.
  SELECTION-SCREEN BEGIN OF LINE.
    PARAMETERS: p_del AS CHECKBOX DEFAULT ' '.
    SELECTION-SCREEN COMMENT 4(35) c_st_dl FOR FIELD p_del.
  SELECTION-SCREEN END OF LINE.
SELECTION-SCREEN END OF BLOCK b_stat.

*&---------------------------------------------------------------------*
*& SCREEN 2000 - Transfer Processing Screen (Fiori Object Page Layout)
*&---------------------------------------------------------------------*
*&---------------------------------------------------------------------*
*& Selection Screen 2000: RF & Desktop Stock Transfer
*& Standard Grid Alignment:
*&   Column 1 Label:      pos 1,  width 18
*&   Column 1 Data Field: pos 20
*&   Column 2 Label:      pos 44, width 18
*&   Column 2 Data Field: pos 63
*&---------------------------------------------------------------------*
SELECTION-SCREEN BEGIN OF SCREEN 2000 TITLE t_s2000.

  " Block 1: Reservation Header Information
  SELECTION-SCREEN BEGIN OF BLOCK b1 WITH FRAME TITLE t_b1.
    SELECTION-SCREEN BEGIN OF LINE.
      SELECTION-SCREEN COMMENT 1(18) c_rsnum.
      SELECTION-SCREEN POSITION 20.
      PARAMETERS: p_rsnum TYPE resb-rsnum MODIF ID dsp. " Reservation Number
      SELECTION-SCREEN COMMENT 42(16) c_rspos.
      SELECTION-SCREEN POSITION 60.
      PARAMETERS: p_rspos TYPE resb-rspos MODIF ID dsp. " Item Number
    SELECTION-SCREEN END OF LINE.
    SELECTION-SCREEN BEGIN OF LINE.
      SELECTION-SCREEN COMMENT 1(18) c_bwart.
      SELECTION-SCREEN POSITION 20.
      PARAMETERS: p_bwart TYPE resb-bwart MODIF ID dsp. " Movement Type
    SELECTION-SCREEN END OF LINE.
    SELECTION-SCREEN BEGIN OF LINE.
      SELECTION-SCREEN COMMENT 1(18) c_usnam.
      SELECTION-SCREEN POSITION 20.
      PARAMETERS: p_usnam TYPE rkpf-usnam MODIF ID dsp. " User Name
      SELECTION-SCREEN POSITION 35.
      PARAMETERS: p_unam  TYPE c LENGTH 40 MODIF ID dsp. " Requested by Details
    SELECTION-SCREEN END OF LINE.
    SELECTION-SCREEN BEGIN OF LINE.
      SELECTION-SCREEN COMMENT 1(18) c_uphon.
      SELECTION-SCREEN POSITION 20.
      PARAMETERS: p_uphon TYPE c LENGTH 30 MODIF ID dsp. " Mobile Phone
    SELECTION-SCREEN END OF LINE.
    SELECTION-SCREEN BEGIN OF LINE.
      SELECTION-SCREEN COMMENT 1(18) c_umail.
      SELECTION-SCREEN POSITION 20.
      PARAMETERS: p_umail TYPE c LENGTH 45 MODIF ID dsp. " E-Mail Address
    SELECTION-SCREEN END OF LINE.
  SELECTION-SCREEN END OF BLOCK b1.

  " Section 2: Material & Warehouse Inventory Information
  SELECTION-SCREEN BEGIN OF BLOCK b2 WITH FRAME TITLE t_b2.
    SELECTION-SCREEN BEGIN OF LINE.
      SELECTION-SCREEN COMMENT 1(18) c_matnr.
      SELECTION-SCREEN POSITION 20.
      PARAMETERS: p_matnr TYPE resb-matnr MODIF ID dsp. " Material Code
    SELECTION-SCREEN END OF LINE.
    SELECTION-SCREEN BEGIN OF LINE.
      SELECTION-SCREEN COMMENT 1(18) c_maktx.
      SELECTION-SCREEN POSITION 20.
      PARAMETERS: p_maktx TYPE makt-maktx MODIF ID dsp. " Material Description
    SELECTION-SCREEN END OF LINE.
    SELECTION-SCREEN BEGIN OF LINE.
      SELECTION-SCREEN COMMENT 1(18) c_charg.
      SELECTION-SCREEN POSITION 20.
      PARAMETERS: p_charg TYPE resb-charg MODIF ID dsp. " Batch
      SELECTION-SCREEN COMMENT 42(16) c_msut.
      SELECTION-SCREEN POSITION 60.
      PARAMETERS: p_msut TYPE c LENGTH 15 MODIF ID dsp. " SUT Indicator
    SELECTION-SCREEN END OF LINE.
    SELECTION-SCREEN BEGIN OF LINE.
      SELECTION-SCREEN COMMENT 1(18) c_opqty.
      SELECTION-SCREEN POSITION 20.
      PARAMETERS: p_opqty TYPE resb-bdmng MODIF ID dsp. " Open Quantity
      SELECTION-SCREEN POSITION 39.
      PARAMETERS: p_meins TYPE resb-meins MODIF ID dsp. " Base Unit
    SELECTION-SCREEN END OF LINE.
    SELECTION-SCREEN BEGIN OF LINE.
      SELECTION-SCREEN COMMENT 1(18) c_frloc.
      SELECTION-SCREEN POSITION 20.
      PARAMETERS: p_frloc TYPE resb-lgort MODIF ID dsp. " From SLoc (Source)
      SELECTION-SCREEN COMMENT 42(16) c_toloc.
      SELECTION-SCREEN POSITION 60.
      PARAMETERS: p_toloc TYPE resb-umlgo MODIF ID dsp. " To SLoc (Requested)
    SELECTION-SCREEN END OF LINE.
    SELECTION-SCREEN BEGIN OF LINE.
      SELECTION-SCREEN COMMENT 1(18) c_whse.
      SELECTION-SCREEN POSITION 20.
      PARAMETERS: p_whse TYPE lqua-lgnum MODIF ID dsp. " Warehouse Code
      SELECTION-SCREEN COMMENT 42(16) c_pstg.
      SELECTION-SCREEN POSITION 60.
      PARAMETERS: p_pstg TYPE mlgt-lgtyp MODIF ID dsp. " Pref. Storage Type
    SELECTION-SCREEN END OF LINE.
    SELECTION-SCREEN BEGIN OF LINE.
      SELECTION-SCREEN COMMENT 1(18) c_stk.
      SELECTION-SCREEN POSITION 20.
      PARAMETERS: p_stk TYPE resb-bdmng MODIF ID dsp. " Whse Available Stock
      SELECTION-SCREEN COMMENT 42(16) c_hucnt.
      SELECTION-SCREEN POSITION 60.
      PARAMETERS: p_hucnt TYPE i MODIF ID dsp. " Available HUs / Units Count
    SELECTION-SCREEN END OF LINE.
    SELECTION-SCREEN SKIP 1.
    SELECTION-SCREEN BEGIN OF LINE.
      SELECTION-SCREEN PUSHBUTTON 1(36)  btn_loc USER-COMMAND show_bins.
      SELECTION-SCREEN PUSHBUTTON 40(36) btn_vis USER-COMMAND show_visual.
    SELECTION-SCREEN END OF LINE.
  SELECTION-SCREEN END OF BLOCK b2.

  " Block 3: Scan & Validate Unit (HU / Storage Unit)
  SELECTION-SCREEN BEGIN OF BLOCK b3 WITH FRAME TITLE t_b3.
    SELECTION-SCREEN BEGIN OF LINE.
      SELECTION-SCREEN COMMENT 1(18) c_exidv.
      SELECTION-SCREEN POSITION 20.
      PARAMETERS: p_exidv TYPE vekp-exidv. " Scan Handling Unit (HU) or Storage Unit (SU)
      SELECTION-SCREEN PUSHBUTTON 42(25) btn_vfy USER-COMMAND verify.
    SELECTION-SCREEN END OF LINE.
    SELECTION-SCREEN BEGIN OF LINE.
      SELECTION-SCREEN COMMENT 1(18) c_utyp.
      SELECTION-SCREEN POSITION 20.
      PARAMETERS: p_utyp TYPE c LENGTH 20 MODIF ID dsp. " Unit Category: HU or SU
      SELECTION-SCREEN COMMENT 42(16) c_sut.
      SELECTION-SCREEN POSITION 60.
      PARAMETERS: p_sut TYPE lvs_letyp MODIF ID dsp. " SUT Code
      SELECTION-SCREEN POSITION 66.
      PARAMETERS: p_sut_tx TYPE c LENGTH 12 MODIF ID dsp. " SUT Description
    SELECTION-SCREEN END OF LINE.
    SELECTION-SCREEN BEGIN OF LINE.
      SELECTION-SCREEN COMMENT 1(18) c_huser.
      SELECTION-SCREEN POSITION 20.
      PARAMETERS: p_huser TYPE gernr MODIF ID dsp. " Serial Number in Unit
    SELECTION-SCREEN END OF LINE.
    SELECTION-SCREEN BEGIN OF LINE.
      SELECTION-SCREEN COMMENT 1(18) c_huqty.
      SELECTION-SCREEN POSITION 20.
      PARAMETERS: p_huqty TYPE vepo-vemng MODIF ID dsp. " Available Qty in Unit
      SELECTION-SCREEN COMMENT 42(16) c_hubat.
      SELECTION-SCREEN POSITION 60.
      PARAMETERS: p_hubat TYPE vepo-charg MODIF ID dsp. " Batch in Unit
    SELECTION-SCREEN END OF LINE.
  SELECTION-SCREEN END OF BLOCK b3.

  " Block 4: Transfer Quantity & Mode
  SELECTION-SCREEN BEGIN OF BLOCK b4 WITH FRAME TITLE t_b4.
    SELECTION-SCREEN BEGIN OF LINE.
      SELECTION-SCREEN COMMENT 1(18) c_tqty.
      SELECTION-SCREEN POSITION 20.
      PARAMETERS: p_tqty TYPE resb-bdmng. " Transfer Quantity
      SELECTION-SCREEN POSITION 42.
      PARAMETERS: p_full AS CHECKBOX DEFAULT 'X'. " Transfer Full HU
      SELECTION-SCREEN COMMENT 46(26) c_full.
    SELECTION-SCREEN END OF LINE.
  SELECTION-SCREEN END OF BLOCK b4.

  " Block 5: Action Toolbar (Footer Bar Style)
  SELECTION-SCREEN BEGIN OF BLOCK b5 WITH FRAME.
    SELECTION-SCREEN BEGIN OF LINE.
      SELECTION-SCREEN PUSHBUTTON 2(26)  btn_pst USER-COMMAND post.
      SELECTION-SCREEN PUSHBUTTON 32(24) btn_bak USER-COMMAND back.
    SELECTION-SCREEN END OF LINE.
  SELECTION-SCREEN END OF BLOCK b5.

SELECTION-SCREEN END OF SCREEN 2000.

*&---------------------------------------------------------------------*
*& Local UI Helper Class for Error / Warning Popups
*&---------------------------------------------------------------------*
CLASS lcl_ui_helper DEFINITION.
  PUBLIC SECTION.
    CLASS-METHODS:
      show_error_popup IMPORTING iv_title TYPE clike
                                 iv_msg1  TYPE clike
                                 iv_msg2  TYPE clike DEFAULT space
                                 iv_msg3  TYPE clike DEFAULT space.
ENDCLASS.

CLASS lcl_ui_helper IMPLEMENTATION.
  METHOD show_error_popup.
    DATA: lv_title TYPE c LENGTH 60,
          lv_txt1  TYPE c LENGTH 70,
          lv_txt2  TYPE c LENGTH 70,
          lv_txt3  TYPE c LENGTH 70,
          lv_msg   TYPE string.

    lv_title = iv_title.
    lv_txt1  = iv_msg1.
    lv_txt2  = iv_msg2.
    lv_txt3  = iv_msg3.

    CALL FUNCTION 'POPUP_TO_INFORM'
      EXPORTING
        titel = lv_title
        txt1  = lv_txt1
        txt2  = lv_txt2
        txt3  = lv_txt3
      EXCEPTIONS
        OTHERS = 1.

    IF sy-subrc <> 0.
      lv_msg = |{ iv_title }: { iv_msg1 } { iv_msg2 }|.
      MESSAGE lv_msg TYPE 'I' DISPLAY LIKE 'E'.
    ENDIF.

    IF iv_msg1 IS NOT INITIAL.
      MESSAGE iv_msg1 TYPE 'S' DISPLAY LIKE 'E'.
    ENDIF.
  ENDMETHOD.
ENDCLASS.

*&---------------------------------------------------------------------*
*& Local Event Handler Class for ALV Double-Click / Hotspot Click
*&---------------------------------------------------------------------*
CLASS lcl_event_handler DEFINITION.
  PUBLIC SECTION.
    METHODS:
      on_link_click FOR EVENT link_click OF cl_salv_events_table
        IMPORTING row column,
      on_double_click FOR EVENT double_click OF cl_salv_events_table
        IMPORTING row column.
ENDCLASS.

CLASS lcl_event_handler IMPLEMENTATION.
  METHOD on_link_click.
    IF column = 'AVAIL_HU'.
      " Show list of stock and HUs in FROM (SRC) Location of the line selected
      READ TABLE gt_alv INTO DATA(ls_row) INDEX row.
      IF sy-subrc = 0.
        MOVE-CORRESPONDING ls_row TO gs_sel_item.
        p_whse = ls_row-lgnum.
        PERFORM show_bin_locations.
      ENDIF.
    ELSE.
      PERFORM open_transfer_screen USING row.
    ENDIF.
  ENDMETHOD.

  METHOD on_double_click.
    PERFORM open_transfer_screen USING row.
  ENDMETHOD.
ENDCLASS.

*&---------------------------------------------------------------------*
*& Local Event Handler Class for Popup ALV (Storage Bins & Stock)
*&---------------------------------------------------------------------*
CLASS lcl_popup_handler DEFINITION.
  PUBLIC SECTION.
    METHODS:
      on_double_click FOR EVENT double_click OF cl_salv_events_table
        IMPORTING row column,
      on_link_click FOR EVENT link_click OF cl_salv_events_table
        IMPORTING row column.
ENDCLASS.

CLASS lcl_popup_handler IMPLEMENTATION.
  METHOD on_double_click.
    PERFORM pick_hu_from_bin USING row.
  ENDMETHOD.

  METHOD on_link_click.
    PERFORM pick_hu_from_bin USING row.
  ENDMETHOD.
ENDCLASS.

*&---------------------------------------------------------------------*
*& Local Event Handler Class for Visual Rack Popup ALV
*&---------------------------------------------------------------------*
CLASS lcl_vis_popup_handler DEFINITION.
  PUBLIC SECTION.
    METHODS:
      on_double_click FOR EVENT double_click OF cl_salv_events_table
        IMPORTING row column,
      on_link_click FOR EVENT link_click OF cl_salv_events_table
        IMPORTING row column.
ENDCLASS.

CLASS lcl_vis_popup_handler IMPLEMENTATION.
  METHOD on_double_click.
    PERFORM pick_hu_from_visual USING row.
  ENDMETHOD.

  METHOD on_link_click.
    PERFORM pick_hu_from_visual USING row.
  ENDMETHOD.
ENDCLASS.

*&---------------------------------------------------------------------*
*& Local Event Handler Class for HTML Visual Rack Viewer
*&---------------------------------------------------------------------*
CLASS lcl_html_rack_handler DEFINITION.
  PUBLIC SECTION.
    METHODS:
      on_sapevent FOR EVENT sapevent OF cl_gui_html_viewer
        IMPORTING action frame getdata postdata query_table,
      on_close FOR EVENT close OF cl_gui_dialogbox_container.
ENDCLASS.

CLASS lcl_html_rack_handler IMPLEMENTATION.
  METHOD on_sapevent.
    PERFORM handle_html_rack_event USING action getdata.
  ENDMETHOD.

  METHOD on_close.
    PERFORM close_html_rack_dialog.
  ENDMETHOD.
ENDCLASS.

DATA: gr_event_handler       TYPE REF TO lcl_event_handler,
      gr_popup_handler       TYPE REF TO lcl_popup_handler,
      gr_vis_popup_handler   TYPE REF TO lcl_vis_popup_handler,
      gr_html_rack_container TYPE REF TO cl_gui_dialogbox_container,
      gr_html_rack_viewer    TYPE REF TO cl_gui_html_viewer,
      gr_html_rack_handler   TYPE REF TO lcl_html_rack_handler.

*&---------------------------------------------------------------------*
*& Initialization
*&---------------------------------------------------------------------*
INITIALIZATION.
  " Auto-register ZRF_RES_HU_DNR in TSTC/TSTCT/TSTCC if missing
  SELECT SINGLE tcode FROM tstc WHERE tcode = 'ZRF_RES_HU_DNR' INTO @DATA(lv_tcode_chk).
  IF sy-subrc <> 0.
    DATA: ls_reg_tstc  TYPE tstc,
          ls_reg_tstct TYPE tstct,
          ls_reg_tstcc TYPE tstcc,
          ls_reg_tadir TYPE tadir.

    ls_reg_tstc-tcode = 'ZRF_RES_HU_DNR'.
    ls_reg_tstc-pgmna = 'ZRF_RES_HU_TRANSFER_DNR'.
    ls_reg_tstc-dypno = '1000'.
    ls_reg_tstc-cinfo = '80'.
    MODIFY tstc FROM ls_reg_tstc.

    ls_reg_tstct-sprsl = 'E'.
    ls_reg_tstct-tcode = 'ZRF_RES_HU_DNR'.
    ls_reg_tstct-ttext = 'RF & Desktop HU Stock Transfer'.
    MODIFY tstct FROM ls_reg_tstct.

    ls_reg_tstcc-tcode    = 'ZRF_RES_HU_DNR'.
    ls_reg_tstcc-s_webgui = '1'.
    ls_reg_tstcc-s_win32  = 'X'.
    ls_reg_tstcc-s_platin = 'X'.
    MODIFY tstcc FROM ls_reg_tstcc.

    ls_reg_tadir-pgmid    = 'R3TR'.
    ls_reg_tadir-object   = 'TRAN'.
    ls_reg_tadir-obj_name = 'ZRF_RES_HU_DNR'.
    ls_reg_tadir-devclass = 'ZAMM'.
    ls_reg_tadir-author   = 'DIPAK'.
    MODIFY tadir FROM ls_reg_tadir.
  ENDIF.

  " Ensure Fiori Launchpad & WebGUI Enablement in TSTCC (Mandatory for Fiori FLP)
  DATA: ls_flp_tstcc TYPE tstcc.
  ls_flp_tstcc-tcode     = 'ZRF_RES_HU_DNR'.
  ls_flp_tstcc-s_webgui  = '1'. " Fiori Launchpad / WebGUI
  ls_flp_tstcc-s_service = '1'. " HTML5 / Service Integration
  ls_flp_tstcc-s_win32   = 'X'.
  ls_flp_tstcc-s_platin  = 'X'.
  MODIFY tstcc FROM ls_flp_tstcc.
  COMMIT WORK.

  %_p_lgnum_%_app_%-text = 'Warehouse Code'.
  %_s_sloc_%_app_%-text  = 'Storage Location'.
  %_s_bwart_%_app_%-text = 'MOVEMENT TYPE'.
  %_s_usnam_%_app_%-text = 'Requester'.

  t_sel   = '@0J@ Filter Criteria for Reservations'.
  t_stat  = '@11@ Reservation Processing Status'.
  c_st_op = '@01@ Open Only'.
  c_st_co = '@09@ Completed Only'.
  c_st_al = '@12@ All Reservations'.
  c_st_dl = 'Include Deleted Items (XLOEK)'.
  t_s2000 = 'RF & Desktop HU / SU Stock Transfer'.
  t_b1    = '@0S@ 1. Selected Reservation Header'.
  t_b2    = '@0P@ 2. Material & Warehouse Inventory Information'.
  t_b3    = '@8Z@ 3. Scan & Validate Unit (HU / SU & SUT)'.
  t_b4    = '@2L@ 4. Transfer Quantity & Mode'.

  c_rsnum = 'Reservation No:'.
  c_rspos = 'Item No:'.
  c_bwart = 'Movement Type:'.
  c_usnam = 'Requested by:'.
  c_uphon = 'Mobile Phone:'.
  c_umail = 'E-Mail Address:'.
  c_matnr = 'Material Code:'.
  c_msut  = 'SUT Management:'.
  c_maktx = 'Description:'.
  c_charg = 'Batch Number:'.
  c_opqty = 'Open Quantity:'.
  c_frloc = 'From SLoc (Src):'.
  c_toloc = 'To SLoc (Dest):'.
  c_whse  = 'Warehouse Code:'.
  c_pstg  = 'Pref. Stg Type:'.
  c_stk   = 'Whse Stock Qty:'.
  c_hucnt = 'Available Units:'.
  c_exidv = 'Scan HU / SU:'.
  c_utyp  = 'Unit Category:'.
  c_sut   = 'Pallet/SUT:'.
  c_huser = 'Unit Serial Number:'.
  c_huqty = 'Available Unit Qty:'.
  c_hubat = 'Batch in Unit:'.
  c_tqty  = 'Transfer Qty:'.
  c_full  = 'Transfer Full Unit'.

  btn_vfy = 'Validate Unit'.
  btn_pst = 'Post Transfer'.
  btn_bak = 'Back to Worklist'.
  btn_loc = 'View Storage Bins & Units'.
  btn_vis = 'Visual Rack & Bin View'.

*&---------------------------------------------------------------------*
*& Screen Output Modification
*&---------------------------------------------------------------------*
AT SELECTION-SCREEN OUTPUT.
  IF sy-dynnr = '2000'.
    LOOP AT SCREEN.
      IF screen-group1 = 'DSP'.
        screen-input = '0'.
        MODIFY SCREEN.
      ENDIF.
      IF p_full = 'X' AND screen-name = 'P_TQTY'.
        screen-input = '0'.
        MODIFY SCREEN.
      ENDIF.
    ENDLOOP.
  ENDIF.

*&---------------------------------------------------------------------*
*& Custom F4 Search Help for Handling Unit (P_EXIDV)
*&---------------------------------------------------------------------*
AT SELECTION-SCREEN ON VALUE-REQUEST FOR p_exidv.
  PERFORM f4_handling_unit.

*&---------------------------------------------------------------------*
*& Click or F4 on Available Stock or HU Count to View Bins & Locations
*&---------------------------------------------------------------------*
AT SELECTION-SCREEN ON VALUE-REQUEST FOR p_hucnt.
  PERFORM show_bin_locations.

AT SELECTION-SCREEN ON VALUE-REQUEST FOR p_stk.
  PERFORM show_bin_locations.

*&---------------------------------------------------------------------*
*& Click or F4 on Pref. Storage Type to View All Storage Strategies
*&---------------------------------------------------------------------*
AT SELECTION-SCREEN ON VALUE-REQUEST FOR p_pstg.
  PERFORM f4_storage_strategies.

*&---------------------------------------------------------------------*
*& User Actions Handling (Screen 2000)
*&---------------------------------------------------------------------*
AT SELECTION-SCREEN.
  IF sy-dynnr = '1000'.
    IF sscrfields-ucomm = 'ONLI' OR sscrfields-ucomm = 'PRIN'.
      " Check Plant existence if entered
      IF p_plnt IS NOT INITIAL.
        SELECT SINGLE werks FROM t001w WHERE werks = @p_plnt INTO @DATA(lv_v_plnt).
        IF sy-subrc <> 0.
          lcl_ui_helper=>show_error_popup(
            iv_title = 'Invalid Plant'
            iv_msg1  = |Plant "{ p_plnt }" was not found in table T001W.|
            iv_msg2  = 'Please enter a valid Plant code or leave blank to search all plants.' ).
          MESSAGE |Plant { p_plnt } is not valid| TYPE 'E'.
        ENDIF.
      ENDIF.

      " Check Warehouse existence if entered
      IF p_lgnum IS NOT INITIAL.
        SELECT SINGLE lgnum FROM t300 WHERE lgnum = @p_lgnum INTO @DATA(lv_v_lgnum).
        IF sy-subrc <> 0.
          lcl_ui_helper=>show_error_popup(
            iv_title = 'Invalid Warehouse'
            iv_msg1  = |Warehouse Number "{ p_lgnum }" was not found in table T300.|
            iv_msg2  = 'Please enter a valid Warehouse number or leave blank to search all warehouses.' ).
          MESSAGE |Warehouse { p_lgnum } is not valid| TYPE 'E'.
        ENDIF.
      ENDIF.
    ENDIF.

  ELSEIF sy-dynnr = '2000'.
    CASE sscrfields-ucomm.

      WHEN 'SHOW_BINS'.
        PERFORM show_bin_locations.

      WHEN 'SHOW_VISUAL'.
        PERFORM show_visual_rack_bins.

      WHEN 'VERIFY' OR space OR 'ENTR'.
        IF p_exidv IS NOT INITIAL.
          PERFORM validate_handling_unit.
        ELSEIF sscrfields-ucomm = 'VERIFY'.
          PERFORM f4_handling_unit.
        ENDIF.

      WHEN 'POST'.
        PERFORM execute_stock_transfer.

      WHEN 'BACK'.
        SET SCREEN 0.
        LEAVE SCREEN.

    ENDCASE.
  ENDIF.

*&---------------------------------------------------------------------*
*& START-OF-SELECTION - Query and Display ALV List of Reservations
*&---------------------------------------------------------------------*
START-OF-SELECTION.
  PERFORM fetch_open_reservations.
  PERFORM display_reservation_alv.

*&---------------------------------------------------------------------*
*& Form: show_error_popup
*& Description: Displays a guaranteed modal dialog popup with Error/Warning
*&---------------------------------------------------------------------*
FORM show_error_popup USING VALUE(pv_title) TYPE clike
                            VALUE(pv_msg1)  TYPE clike
                            VALUE(pv_msg2)  TYPE clike
                            VALUE(pv_msg3)  TYPE clike.
  lcl_ui_helper=>show_error_popup(
    iv_title = pv_title
    iv_msg1  = pv_msg1
    iv_msg2  = pv_msg2
    iv_msg3  = pv_msg3 ).
ENDFORM.

*&---------------------------------------------------------------------*
*& Form: fetch_open_reservations
*&---------------------------------------------------------------------*
FORM fetch_open_reservations.
  CLEAR gt_alv.

  " 1. Query RESB with LEFT OUTER JOIN RKPF (resilient against missing header / NULLs)
  " Note: Do not filter xloek or kzear in SQL to prevent HANA NULL-elimination traps.
  SELECT r~rsnum,
         r~rspos,
         CASE WHEN r~bwart IS NOT INITIAL THEN r~bwart ELSE h~bwart END AS bwart,
         h~usnam,
         r~bdter,
         r~matnr,
         r~charg,
         r~bdmng,
         r~enmng,
         ( r~bdmng - r~enmng ) AS open_qty,
         r~meins,
         r~werks,
         r~lgort,
         r~umlgo,
         r~kzear,
         r~xloek
    FROM resb AS r
    INNER JOIN rkpf AS h ON r~rsnum = h~rsnum
    WHERE ( @p_plnt IS INITIAL OR r~werks = @p_plnt )
      AND r~rsnum IN @s_res
      AND r~matnr IN @s_mat
      AND r~lgort IN @s_sloc
      AND r~bwart IN @s_bwart
      AND h~usnam IN @s_usnam
    INTO CORRESPONDING FIELDS OF TABLE @gt_alv ##SELECT_NULL_VALUES[BWART].

  " 2. Check if initial database query returned zero rows
  IF gt_alv IS INITIAL.
    DATA: lv_crit TYPE string.
    lv_crit = |Plant: { COND string( WHEN p_plnt IS NOT INITIAL THEN p_plnt ELSE 'ALL' ) }|.
    IF s_res IS NOT INITIAL.
      lv_crit = |{ lv_crit }, Res#: Filtered|.
    ENDIF.
    IF s_mat IS NOT INITIAL.
      lv_crit = |{ lv_crit }, Mat: Filtered|.
    ENDIF.
    IF s_sloc IS NOT INITIAL.
      lv_crit = |{ lv_crit }, SLoc: Filtered|.
    ENDIF.
    IF s_bwart IS NOT INITIAL.
      lv_crit = |{ lv_crit }, Mvt: Filtered|.
    ENDIF.
    IF s_usnam IS NOT INITIAL.
      lv_crit = |{ lv_crit }, Requester: Filtered|.
    ENDIF.

    lcl_ui_helper=>show_error_popup(
      iv_title = 'No Reservations Found'
      iv_msg1  = 'No reservations found in database matching your filter criteria:'
      iv_msg2  = lv_crit
      iv_msg3  = 'Please verify Plant, SLoc, Movement Type, or Reservation Number.' ).
    EXIT.
  ENDIF.

  " 3. Deletion Filter (p_del = ' ' excludes deleted items)
  DATA(lv_cnt_raw) = lines( gt_alv ).
  IF p_del = abap_false.
    DELETE gt_alv WHERE xloek = 'X'.
    IF gt_alv IS INITIAL.
      lcl_ui_helper=>show_error_popup(
        iv_title = 'All Reservations Deleted'
        iv_msg1  = |Found { lv_cnt_raw } reservation(s), but ALL are marked as DELETED (XLOEK = 'X').|
        iv_msg2  = 'Check the checkbox "Include Deleted Items (XLOEK)" on the selection screen'
        iv_msg3  = 'if you wish to view deleted reservations.' ).
      EXIT.
    ENDIF.
  ENDIF.

  " 4. Processing Status Filter (Open vs Completed vs All)
  DATA(lv_cnt_active) = lines( gt_alv ).
  IF r_open = abap_true.
    DELETE gt_alv WHERE kzear = 'X' OR open_qty <= 0.
    IF gt_alv IS INITIAL.
      lcl_ui_helper=>show_error_popup(
        iv_title = 'No Open Reservations'
        iv_msg1  = |Found { lv_cnt_active } reservation(s), but all are COMPLETED (open qty <= 0 or KZEAR='X').|
        iv_msg2  = 'Select "Completed Only" or "All Reservations" in the status filter'
        iv_msg3  = 'to view completed reservations.' ).
      EXIT.
    ENDIF.
  ELSEIF r_comp = abap_true.
    DELETE gt_alv WHERE kzear <> 'X' AND open_qty > 0.
    IF gt_alv IS INITIAL.
      lcl_ui_helper=>show_error_popup(
        iv_title = 'No Completed Reservations'
        iv_msg1  = |Found { lv_cnt_active } reservation(s), but all are still OPEN / In-Progress.|
        iv_msg2  = 'Select "Open Only" or "All Reservations" in the status filter.' ).
      EXIT.
    ENDIF.
  ENDIF.

  " 5. Determine Status Text with Icons
  LOOP AT gt_alv ASSIGNING FIELD-SYMBOL(<fs_st>).
    IF <fs_st>-xloek = 'X'.
      <fs_st>-status_txt = '@02@ Deleted'.
    ELSEIF <fs_st>-kzear = 'X' OR <fs_st>-open_qty <= 0.
      <fs_st>-status_txt = '@09@ Completed'.
    ELSEIF <fs_st>-enmng > 0.
      <fs_st>-status_txt = '@08@ Partially Open'.
    ELSE.
      <fs_st>-status_txt = '@01@ Open'.
    ENDIF.
  ENDLOOP.

  " 6. Fetch User Full Names (USR21 + ADRP)
  TYPES: BEGIN OF ty_usnam,
           usnam TYPE rkpf-usnam,
         END OF ty_usnam.
  DATA: lt_usnam TYPE STANDARD TABLE OF ty_usnam.

  LOOP AT gt_alv ASSIGNING FIELD-SYMBOL(<fs_u>) WHERE usnam IS NOT INITIAL.
    APPEND VALUE #( usnam = <fs_u>-usnam ) TO lt_usnam.
  ENDLOOP.
  SORT lt_usnam BY usnam.
  DELETE ADJACENT DUPLICATES FROM lt_usnam COMPARING usnam.

  IF lt_usnam IS NOT INITIAL.
    " Retrieve Full Name, Designation (Function/Department) and Extension from User Master
    SELECT u~bname,
           a~name_text,
           c~function,
           c~department,
           c~tel_extens
      FROM usr21 AS u
      INNER JOIN adrp AS a ON u~persnumber = a~persnumber
      LEFT OUTER JOIN adcp AS c
        ON u~addrnumber = c~addrnumber
       AND u~persnumber = c~persnumber
      FOR ALL ENTRIES IN @lt_usnam
      WHERE u~bname = @lt_usnam-usnam
      INTO TABLE @DATA(lt_user_details).

    SELECT u~bname,
           t~tel_number,
           t~tel_extens,
           t~flgdefault,
           t~r3_user
      FROM usr21 AS u
      INNER JOIN adr2 AS t
        ON u~addrnumber = t~addrnumber
       AND u~persnumber = t~persnumber
      FOR ALL ENTRIES IN @lt_usnam
      WHERE u~bname = @lt_usnam-usnam
      INTO TABLE @DATA(lt_adr2_all).

    SELECT u~bname,
           m~smtp_addr,
           m~flgdefault
      FROM usr21 AS u
      INNER JOIN adr6 AS m
        ON u~addrnumber = m~addrnumber
       AND u~persnumber = m~persnumber
      FOR ALL ENTRIES IN @lt_usnam
      WHERE u~bname = @lt_usnam-usnam
      INTO TABLE @DATA(lt_adr6_all).

    LOOP AT gt_alv ASSIGNING FIELD-SYMBOL(<fs_user>).
      DATA: lv_uname_f TYPE string,
            lv_desig_f TYPE string,
            lv_extn_f  TYPE string,
            lv_full_f  TYPE string,
            lv_phone_f TYPE string,
            lv_mail_f  TYPE string.
      CLEAR: lv_uname_f, lv_desig_f, lv_extn_f, lv_full_f, lv_phone_f, lv_mail_f.

      READ TABLE lt_user_details INTO DATA(ls_ud) WITH KEY bname = <fs_user>-usnam.
      IF sy-subrc = 0.
        lv_uname_f = ls_ud-name_text.
        IF ls_ud-function IS NOT INITIAL.
          lv_desig_f = ls_ud-function.
        ELSEIF ls_ud-department IS NOT INITIAL.
          lv_desig_f = ls_ud-department.
        ENDIF.
        IF ls_ud-tel_extens IS NOT INITIAL.
          lv_extn_f = ls_ud-tel_extens.
        ENDIF.
      ENDIF.

      " Resolve Telephone / Mobile Number from ADR2
      READ TABLE lt_adr2_all INTO DATA(ls_tel)
        WITH KEY bname = <fs_user>-usnam r3_user = '3'.
      IF sy-subrc = 0 AND ls_tel-tel_number IS NOT INITIAL.
        lv_phone_f = ls_tel-tel_number.
      ELSE.
        READ TABLE lt_adr2_all INTO ls_tel
          WITH KEY bname = <fs_user>-usnam flgdefault = 'X'.
        IF sy-subrc = 0 AND ls_tel-tel_number IS NOT INITIAL.
          lv_phone_f = ls_tel-tel_number.
        ELSE.
          READ TABLE lt_adr2_all INTO ls_tel
            WITH KEY bname = <fs_user>-usnam.
          IF sy-subrc = 0 AND ls_tel-tel_number IS NOT INITIAL.
            lv_phone_f = ls_tel-tel_number.
          ENDIF.
        ENDIF.
      ENDIF.

      " Resolve Extension from ADR2 if not already in ADCP
      IF lv_extn_f IS INITIAL.
        READ TABLE lt_adr2_all INTO DATA(ls_a2)
          WITH KEY bname = <fs_user>-usnam.
        IF sy-subrc = 0 AND ls_a2-tel_extens IS NOT INITIAL.
          lv_extn_f = ls_a2-tel_extens.
        ENDIF.
      ENDIF.

      " Resolve E-Mail Address from ADR6
      READ TABLE lt_adr6_all INTO DATA(ls_mail)
        WITH KEY bname = <fs_user>-usnam flgdefault = 'X'.
      IF sy-subrc = 0 AND ls_mail-smtp_addr IS NOT INITIAL.
        lv_mail_f = ls_mail-smtp_addr.
      ELSE.
        READ TABLE lt_adr6_all INTO ls_mail
          WITH KEY bname = <fs_user>-usnam.
        IF sy-subrc = 0 AND ls_mail-smtp_addr IS NOT INITIAL.
          lv_mail_f = ls_mail-smtp_addr.
        ENDIF.
      ENDIF.

      " Fallback to BAPI_USER_GET_DETAIL if missing details
      IF lv_uname_f IS INITIAL OR lv_desig_f IS INITIAL OR lv_extn_f IS INITIAL
         OR lv_phone_f IS INITIAL OR lv_mail_f IS INITIAL.
        DATA: ls_bp_addr TYPE bapiaddr3,
              lt_bp_tel  TYPE TABLE OF bapiadtel,
              lt_bp_mail TYPE TABLE OF bapiadsmtp,
              lt_bp_ret  TYPE TABLE OF bapiret2.
        CLEAR: ls_bp_addr, lt_bp_tel, lt_bp_mail, lt_bp_ret.
        CALL FUNCTION 'BAPI_USER_GET_DETAIL'
          EXPORTING
            username = <fs_user>-usnam
          IMPORTING
            address  = ls_bp_addr
          TABLES
            addtel   = lt_bp_tel
            addsmtp  = lt_bp_mail
            return   = lt_bp_ret.
        IF lv_uname_f IS INITIAL.
          IF ls_bp_addr-fullname IS NOT INITIAL.
            lv_uname_f = ls_bp_addr-fullname.
          ELSEIF ls_bp_addr-firstname IS NOT INITIAL OR ls_bp_addr-lastname IS NOT INITIAL.
            lv_uname_f = |{ ls_bp_addr-firstname } { ls_bp_addr-lastname }|.
          ENDIF.
        ENDIF.
        IF lv_desig_f IS INITIAL.
          IF ls_bp_addr-function IS NOT INITIAL.
            lv_desig_f = ls_bp_addr-function.
          ELSEIF ls_bp_addr-department IS NOT INITIAL.
            lv_desig_f = ls_bp_addr-department.
          ENDIF.
        ENDIF.
        IF lv_extn_f IS INITIAL.
          IF ls_bp_addr-tel1_ext IS NOT INITIAL.
            lv_extn_f = ls_bp_addr-tel1_ext.
          ELSE.
            READ TABLE lt_bp_tel INTO DATA(ls_bpt) WITH KEY std_no = 'X'.
            IF sy-subrc = 0 AND ls_bpt-extension IS NOT INITIAL.
              lv_extn_f = ls_bpt-extension.
            ELSE.
              READ TABLE lt_bp_tel INTO ls_bpt INDEX 1.
              IF sy-subrc = 0 AND ls_bpt-extension IS NOT INITIAL.
                lv_extn_f = ls_bpt-extension.
              ENDIF.
            ENDIF.
          ENDIF.
        ENDIF.
        IF lv_phone_f IS INITIAL.
          IF ls_bp_addr-tel1_numbr IS NOT INITIAL.
            lv_phone_f = ls_bp_addr-tel1_numbr.
          ELSE.
            READ TABLE lt_bp_tel INTO DATA(ls_bpt2) WITH KEY r_3_user = '3'.
            IF sy-subrc <> 0.
              READ TABLE lt_bp_tel INTO ls_bpt2 WITH KEY std_no = 'X'.
            ENDIF.
            IF sy-subrc <> 0.
              READ TABLE lt_bp_tel INTO ls_bpt2 INDEX 1.
            ENDIF.
            IF ls_bpt2-telephone IS NOT INITIAL.
              lv_phone_f = ls_bpt2-telephone.
            ENDIF.
          ENDIF.
        ENDIF.
        IF lv_mail_f IS INITIAL.
          IF ls_bp_addr-e_mail IS NOT INITIAL.
            lv_mail_f = ls_bp_addr-e_mail.
          ELSE.
            READ TABLE lt_bp_mail INTO DATA(ls_bpm) WITH KEY std_no = 'X'.
            IF sy-subrc <> 0.
              READ TABLE lt_bp_mail INTO ls_bpm INDEX 1.
            ENDIF.
            IF ls_bpm-e_mail IS NOT INITIAL.
              lv_mail_f = ls_bpm-e_mail.
            ENDIF.
          ENDIF.
        ENDIF.
      ENDIF.

      " Default domain email fallback
      IF lv_mail_f IS INITIAL AND <fs_user>-usnam IS NOT INITIAL.
        lv_mail_f = |{ to_lower( <fs_user>-usnam ) }@aether.co.in|.
      ENDIF.

      IF lv_uname_f IS INITIAL.
        lv_uname_f = <fs_user>-usnam.
      ENDIF.

      " Format: (Khushal Dhanani / Designation / EXTN: XXX)
      IF lv_desig_f IS NOT INITIAL AND lv_extn_f IS NOT INITIAL.
        lv_full_f = |({ lv_uname_f } / { lv_desig_f } / EXTN: { lv_extn_f })|.
      ELSEIF lv_desig_f IS NOT INITIAL.
        lv_full_f = |({ lv_uname_f } / { lv_desig_f })|.
      ELSEIF lv_extn_f IS NOT INITIAL.
        lv_full_f = |({ lv_uname_f } / EXTN: { lv_extn_f })|.
      ELSE.
        lv_full_f = |({ lv_uname_f })|.
      ENDIF.

      <fs_user>-name_text = lv_full_f.
      <fs_user>-u_phone   = lv_phone_f.
      <fs_user>-u_mail    = lv_mail_f.
    ENDLOOP.
  ENDIF.

  " 7. Determine Warehouse Number (T320)
  SELECT werks, lgort, lgnum
    FROM t320
    INTO TABLE @DATA(lt_t320).

  LOOP AT gt_alv ASSIGNING FIELD-SYMBOL(<fs_alv>).
    READ TABLE lt_t320 INTO DATA(ls_t320)
      WITH KEY werks = <fs_alv>-werks
               lgort = <fs_alv>-lgort.
    IF sy-subrc = 0.
      <fs_alv>-lgnum = ls_t320-lgnum.
    ELSE.
      READ TABLE lt_t320 INTO ls_t320
        WITH KEY werks = <fs_alv>-werks.
      IF sy-subrc = 0.
        <fs_alv>-lgnum = ls_t320-lgnum.
      ELSE.
        <fs_alv>-lgnum = p_lgnum.
      ENDIF.
    ENDIF.
  ENDLOOP.

  " 8. Filter by Warehouse Number (p_lgnum) if specified
  IF p_lgnum IS NOT INITIAL.
    DATA(lv_cnt_pre_wh) = lines( gt_alv ).
    DELETE gt_alv WHERE lgnum <> p_lgnum AND lgnum IS NOT INITIAL.
    IF gt_alv IS INITIAL.
      lcl_ui_helper=>show_error_popup(
        iv_title = 'Warehouse Mismatch'
        iv_msg1  = |Found { lv_cnt_pre_wh } reservation(s), but none match Warehouse Number "{ p_lgnum }".|
        iv_msg2  = 'Clear the Warehouse Number filter or specify the matching warehouse for Plant/SLoc.' ).
      EXIT.
    ENDIF.
  ENDIF.

  " 9. Fetch Material Descriptions (MAKT)
  SELECT matnr, maktx
    FROM makt
    FOR ALL ENTRIES IN @gt_alv
    WHERE matnr = @gt_alv-matnr
      AND spras = @sy-langu
    INTO TABLE @DATA(lt_makt).

  LOOP AT gt_alv ASSIGNING <fs_alv>.
    READ TABLE lt_makt INTO DATA(ls_makt) WITH KEY matnr = <fs_alv>-matnr.
    IF sy-subrc = 0.
      <fs_alv>-maktx = ls_makt-maktx.
    ENDIF.
  ENDLOOP.

  " 10. Count available active Units in stock (HUs in VEKP or Storage Units in LQUA)
  SELECT p~matnr, p~werks, p~lgort, p~charg, k~exidv
    FROM vepo AS p
    INNER JOIN vekp AS k ON p~venum = k~venum
    FOR ALL ENTRIES IN @gt_alv
    WHERE p~matnr = @gt_alv-matnr
      AND p~werks = @gt_alv-werks
      AND p~lgort = @gt_alv-lgort
      AND k~status = '0020'
    INTO TABLE @DATA(lt_hus).

  " 10b. Query Storage Units (SUT) from LQUA for SU-managed stock
  SELECT matnr, werks, lgort, charg, lenum, letyp, gesme, verme, kzhuq
    FROM lqua
    FOR ALL ENTRIES IN @gt_alv
    WHERE matnr = @gt_alv-matnr
      AND werks = @gt_alv-werks
      AND lgort = @gt_alv-lgort
      AND lenum <> @space
      AND gesme > 0
    INTO TABLE @DATA(lt_lqua_sus).

  " 10c. Read Material Master SUT definitions (MLGN)
  SELECT matnr, lgnum, lety1, lety2, lety3
    FROM mlgn
    FOR ALL ENTRIES IN @gt_alv
    WHERE matnr = @gt_alv-matnr
    INTO TABLE @DATA(lt_mlgn_sut).

  " 10d. Read Storage Unit Type Descriptions from T307T
  SELECT lgnum, letyp, spras, letyt
    FROM t307t
    WHERE spras = @sy-langu
    INTO TABLE @DATA(lt_t307t_all).

  TYPES: BEGIN OF ty_unit_key,
           unit_id TYPE vekp-exidv,
         END OF ty_unit_key.
  DATA: lt_unit_keys TYPE HASHED TABLE OF ty_unit_key WITH UNIQUE KEY unit_id.

  LOOP AT gt_alv ASSIGNING <fs_alv>.
    CLEAR: lt_unit_keys.

    " Add Handling Units (HUs)
    LOOP AT lt_hus INTO DATA(ls_hu)
      WHERE matnr = <fs_alv>-matnr
        AND werks = <fs_alv>-werks
        AND lgort = <fs_alv>-lgort.
      IF <fs_alv>-charg IS INITIAL OR ls_hu-charg = <fs_alv>-charg.
        INSERT VALUE #( unit_id = ls_hu-exidv ) INTO TABLE lt_unit_keys.
      ENDIF.
    ENDLOOP.

    " Add Storage Units (SUs) from LQUA
    DATA: lv_pref_letyp TYPE lvs_letyp,
          lv_pref_letyt TYPE lvs_letyt.
    CLEAR: lv_pref_letyp, lv_pref_letyt.

    LOOP AT lt_lqua_sus INTO DATA(ls_su)
      WHERE matnr = <fs_alv>-matnr
        AND werks = <fs_alv>-werks
        AND lgort = <fs_alv>-lgort.
      IF <fs_alv>-charg IS INITIAL OR ls_su-charg = <fs_alv>-charg.
        IF lv_pref_letyp IS INITIAL AND ls_su-letyp IS NOT INITIAL.
          lv_pref_letyp = ls_su-letyp.
        ENDIF.
        INSERT VALUE #( unit_id = ls_su-lenum ) INTO TABLE lt_unit_keys.
      ENDIF.
    ENDLOOP.

    <fs_alv>-avail_hu = lines( lt_unit_keys ).

    " Determine SUT Enablement
    READ TABLE lt_mlgn_sut INTO DATA(ls_mlgn) WITH KEY matnr = <fs_alv>-matnr.
    IF sy-subrc = 0 AND ( ls_mlgn-lety1 IS NOT INITIAL OR ls_mlgn-lety2 IS NOT INITIAL ).
      <fs_alv>-sut_ind = 'SUT-Enabled'.
      IF lv_pref_letyp IS INITIAL.
        lv_pref_letyp = ls_mlgn-lety1.
      ENDIF.
    ELSEIF lv_pref_letyp IS NOT INITIAL.
      <fs_alv>-sut_ind = 'SUT-Enabled'.
    ELSE.
      <fs_alv>-sut_ind = 'Standard'.
    ENDIF.

    IF lv_pref_letyp IS NOT INITIAL.
      <fs_alv>-letyp = lv_pref_letyp.
      READ TABLE lt_t307t_all INTO DATA(ls_t307t_f)
        WITH KEY letyp = lv_pref_letyp.
      IF sy-subrc = 0.
        <fs_alv>-letyt = ls_t307t_f-letyt.
      ENDIF.
    ENDIF.

    " If Available HU is ZERO, color this line as lite orange
    CLEAR <fs_alv>-t_color.
    IF <fs_alv>-avail_hu = 0.
      DATA: ls_res_line_col TYPE lvc_s_scol.

      " 1. Entire Row / Line color (fname = space)
      CLEAR ls_res_line_col.
      ls_res_line_col-fname     = space.
      ls_res_line_col-color-col = 3.         " Orange / Total
      ls_res_line_col-color-int = 0.         " 0 = Lite Orange (soft background)
      ls_res_line_col-color-inv = 0.
      ls_res_line_col-nokeycol  = abap_true. " Color key columns as well
      APPEND ls_res_line_col TO <fs_alv>-t_color.

      " 2. Explicit cell color for AVAIL_HU
      CLEAR ls_res_line_col.
      ls_res_line_col-fname     = 'AVAIL_HU'.
      ls_res_line_col-color-col = 3.
      ls_res_line_col-color-int = 0.
      ls_res_line_col-color-inv = 0.
      ls_res_line_col-nokeycol  = abap_true.
      APPEND ls_res_line_col TO <fs_alv>-t_color.
    ENDIF.
  ENDLOOP.
ENDFORM.

*&---------------------------------------------------------------------*
*& Form: display_reservation_alv
*&---------------------------------------------------------------------*
FORM display_reservation_alv.
  IF gt_alv IS INITIAL.
    EXIT.
  ENDIF.

  TRY.
      cl_salv_table=>factory(
        IMPORTING
          r_salv_table = gr_salv_table
        CHANGING
          t_table      = gt_alv ).

      " Enable all standard functions (Filter, Sort, Search, Export)
      DATA(lr_functions) = gr_salv_table->get_functions( ).
      lr_functions->set_all( abap_true ).

      " Column settings
      DATA(lr_columns) = gr_salv_table->get_columns( ).
      lr_columns->set_optimize( abap_true ).

      TRY.
          lr_columns->set_color_column( 'T_COLOR' ).
        CATCH cx_salv_data_error.
      ENDTRY.

      " Enable interactive row & column selection mode
      DATA(lr_main_sel) = gr_salv_table->get_selections( ).
      lr_main_sel->set_selection_mode( if_salv_c_selection_mode=>row_column ).

      " Set Hotspots for touch/click on key fields
      DATA: lr_column TYPE REF TO cl_salv_column_table.
      TRY.
          lr_column ?= lr_columns->get_column( 'RSNUM' ).
          lr_column->set_cell_type( if_salv_c_cell_type=>hotspot ).
          lr_column->set_short_text( 'Reserv.' ).
          lr_column->set_medium_text( 'Reservation' ).
          lr_column->set_long_text( 'Reservation Number' ).
        CATCH cx_salv_not_found.
      ENDTRY.

      TRY.
          lr_column ?= lr_columns->get_column( 'MATNR' ).
          lr_column->set_cell_type( if_salv_c_cell_type=>hotspot ).
        CATCH cx_salv_not_found.
      ENDTRY.

      TRY.
          lr_column ?= lr_columns->get_column( 'MAKTX' ).
          lr_column->set_cell_type( if_salv_c_cell_type=>hotspot ).
        CATCH cx_salv_not_found.
      ENDTRY.

      " Movement Type
      TRY.
          lr_column ?= lr_columns->get_column( 'BWART' ).
          lr_column->set_short_text( 'Mvt Type' ).
          lr_column->set_medium_text( 'Movement Type' ).
          lr_column->set_long_text( 'Movement Type' ).
        CATCH cx_salv_not_found.
      ENDTRY.

      " User Name -> Requested by (ID)
      TRY.
          lr_column ?= lr_columns->get_column( 'USNAM' ).
          lr_column->set_short_text( 'Requester' ).
          lr_column->set_medium_text( 'Requested by' ).
          lr_column->set_long_text( 'Requested by' ).
        CATCH cx_salv_not_found.
      ENDTRY.

      " User Full Name / Details
      TRY.
          lr_column ?= lr_columns->get_column( 'NAME_TEXT' ).
          lr_column->set_short_text( 'Req. Name' ).
          lr_column->set_medium_text( 'Requested by Details' ).
          lr_column->set_long_text( 'Requested by (Name/Desig/EXTN)' ).
        CATCH cx_salv_not_found.
      ENDTRY.

      " Mobile / Phone Number
      TRY.
          lr_column ?= lr_columns->get_column( 'U_PHONE' ).
          lr_column->set_short_text( 'Mobile' ).
          lr_column->set_medium_text( 'Mobile Phone' ).
          lr_column->set_long_text( 'Mobile Phone Number' ).
        CATCH cx_salv_not_found.
      ENDTRY.

      " E-Mail Address
      TRY.
          lr_column ?= lr_columns->get_column( 'U_MAIL' ).
          lr_column->set_short_text( 'E-Mail' ).
          lr_column->set_medium_text( 'E-Mail Address' ).
          lr_column->set_long_text( 'E-Mail Address' ).
        CATCH cx_salv_not_found.
      ENDTRY.

      " Batch
      TRY.
          lr_column ?= lr_columns->get_column( 'CHARG' ).
          lr_column->set_short_text( 'Batch' ).
          lr_column->set_medium_text( 'Batch' ).
          lr_column->set_long_text( 'Batch' ).
        CATCH cx_salv_not_found.
      ENDTRY.

      " Storage Loc.
      TRY.
          lr_column ?= lr_columns->get_column( 'LGORT' ).
          lr_column->set_short_text( 'Stor. Loc.' ).
          lr_column->set_medium_text( 'Storage Loc.' ).
          lr_column->set_long_text( 'Storage Loc.' ).
        CATCH cx_salv_not_found.
      ENDTRY.

      " Receiving Stor. Loc.
      TRY.
          lr_column ?= lr_columns->get_column( 'UMLGO' ).
          lr_column->set_short_text( 'Rec. SLoc' ).
          lr_column->set_medium_text( 'Receiving Stor. Loc.' ).
          lr_column->set_long_text( 'Receiving Stor. Loc.' ).
        CATCH cx_salv_not_found.
      ENDTRY.

      " Warehouse Number column
      TRY.
          lr_column ?= lr_columns->get_column( 'LGNUM' ).
          lr_column->set_short_text( 'Whse' ).
          lr_column->set_medium_text( 'Warehouse' ).
          lr_column->set_long_text( 'Warehouse Number' ).
        CATCH cx_salv_not_found.
      ENDTRY.

      " Rename Available Units column (HUs and Storage Units)
      TRY.
          lr_column ?= lr_columns->get_column( 'AVAIL_HU' ).
          lr_column->set_short_text( 'Avail Unit' ).
          lr_column->set_medium_text( 'Available Units' ).
          lr_column->set_long_text( 'Available HUs & Storage Units' ).
          lr_column->set_cell_type( if_salv_c_cell_type=>hotspot ).
        CATCH cx_salv_not_found.
      ENDTRY.

      " SUT Indicator column
      TRY.
          lr_column ?= lr_columns->get_column( 'SUT_IND' ).
          lr_column->set_short_text( 'SUT Mode' ).
          lr_column->set_medium_text( 'SUT Management' ).
          lr_column->set_long_text( 'SUT Management Status' ).
        CATCH cx_salv_not_found.
      ENDTRY.

      " Storage Unit Type (LETYP) column
      TRY.
          lr_column ?= lr_columns->get_column( 'LETYP' ).
          lr_column->set_short_text( 'SUT' ).
          lr_column->set_medium_text( 'Pallet/SUT' ).
          lr_column->set_long_text( 'Storage Unit Type (SUT)' ).
        CATCH cx_salv_not_found.
      ENDTRY.

      " Storage Unit Type Text (LETYT) column
      TRY.
          lr_column ?= lr_columns->get_column( 'LETYT' ).
          lr_column->set_short_text( 'SUT Desc' ).
          lr_column->set_medium_text( 'SUT Description' ).
          lr_column->set_long_text( 'Storage Unit Type Description' ).
        CATCH cx_salv_not_found.
      ENDTRY.

      " Status column
      TRY.
          lr_column ?= lr_columns->get_column( 'STATUS_TXT' ).
          lr_column->set_short_text( 'Status' ).
          lr_column->set_medium_text( 'Status' ).
          lr_column->set_long_text( 'Reservation Status' ).
        CATCH cx_salv_not_found.
      ENDTRY.

      " Required & Withdrawn Quantities
      TRY.
          lr_column ?= lr_columns->get_column( 'BDMNG' ).
          lr_column->set_short_text( 'Req. Qty' ).
          lr_column->set_medium_text( 'Required Qty' ).
          lr_column->set_long_text( 'Required Quantity' ).
        CATCH cx_salv_not_found.
      ENDTRY.

      TRY.
          lr_column ?= lr_columns->get_column( 'ENMNG' ).
          lr_column->set_short_text( 'Withdrawn' ).
          lr_column->set_medium_text( 'Withdrawn Qty' ).
          lr_column->set_long_text( 'Withdrawn Quantity' ).
        CATCH cx_salv_not_found.
      ENDTRY.

      " Hide technical flags
      TRY.
          lr_columns->get_column( 'KZEAR' )->set_visible( abap_false ).
          lr_columns->get_column( 'XLOEK' )->set_visible( abap_false ).
        CATCH cx_salv_not_found.
      ENDTRY.

      " Set title
      DATA: lv_st_desc TYPE string.
      IF r_open = abap_true.
        lv_st_desc = 'Open'.
      ELSEIF r_comp = abap_true.
        lv_st_desc = 'Completed'.
      ELSE.
        lv_st_desc = 'All'.
      ENDIF.
      DATA(lr_display) = gr_salv_table->get_display_settings( ).
      lr_display->set_striped_pattern( abap_true ).
      lr_display->set_list_header( |{ lv_st_desc } Reservations ({ lines( gt_alv ) } Items) - Select Row to Transfer Stock| ).

      " Register event handlers for click & double-click
      DATA(lr_events) = gr_salv_table->get_event( ).
      CREATE OBJECT gr_event_handler.
      SET HANDLER gr_event_handler->on_link_click FOR lr_events.
      SET HANDLER gr_event_handler->on_double_click FOR lr_events.

      " Display ALV Grid
      gr_salv_table->display( ).

    CATCH cx_root INTO DATA(lx_salv_err).
      DATA(lv_err_salv) = lx_salv_err->get_text( ).
      lcl_ui_helper=>show_error_popup(
        iv_title = 'ALV Display Error'
        iv_msg1  = 'An error occurred while rendering the reservation list:'
        iv_msg2  = lv_err_salv
        iv_msg3  = 'Please check system logs or report to administrator.' ).
  ENDTRY.
ENDFORM.

*&---------------------------------------------------------------------*
*& Form: determine_whse_and_pref_stg
*& Description: Checks Storage Strategies for Stock Removal (MLGN-LTKZA
*&              & T334T KZEAR='A') and Stock Placement (MLGN-LTKZE &
*&              T334T KZEAR='E'), Material Master MLGT, and Whse Quants
*& Author     : DNR / Dipak Rathod
*&---------------------------------------------------------------------*
FORM determine_whse_and_pref_stg.
  CLEAR: gt_strategy_stg, gv_pref_stg.

  " 1. Accurately determine FROM Warehouse Code (p_whse)
  IF p_whse IS INITIAL.
    IF p_lgnum IS NOT INITIAL.
      p_whse = p_lgnum.
    ELSEIF gs_sel_item-lgnum IS NOT INITIAL.
      p_whse = gs_sel_item-lgnum.
    ENDIF.
  ENDIF.

  " If still initial, query T320 by Plant and SLoc
  IF p_whse IS INITIAL AND gs_sel_item-werks IS NOT INITIAL AND gs_sel_item-lgort IS NOT INITIAL.
    SELECT SINGLE lgnum FROM t320
      WHERE werks = @gs_sel_item-werks
        AND lgort = @gs_sel_item-lgort
      INTO @p_whse.
  ENDIF.

  " If still initial, query T320 by Plant
  IF p_whse IS INITIAL AND gs_sel_item-werks IS NOT INITIAL.
    SELECT SINGLE lgnum FROM t320
      WHERE werks = @gs_sel_item-werks
      INTO @p_whse.
  ENDIF.

  " If still initial, query LQUA where quants actually exist for this material
  IF p_whse IS INITIAL AND gs_sel_item-matnr IS NOT INITIAL.
    SELECT SINGLE lgnum FROM lqua
      WHERE matnr = @gs_sel_item-matnr
        AND werks = @gs_sel_item-werks
        AND lgort = @gs_sel_item-lgort
      INTO @p_whse.
    IF p_whse IS INITIAL.
      SELECT SINGLE lgnum FROM lqua
        WHERE matnr = @gs_sel_item-matnr
          AND werks = @gs_sel_item-werks
        INTO @p_whse.
    ENDIF.
  ENDIF.

  IF gs_sel_item-matnr IS INITIAL OR p_whse IS INITIAL.
    p_pstg = gv_pref_stg.
    EXIT.
  ENDIF.

  " 2. Read Material Master Warehouse Data (MLGN) for Stock Removal & Placement Indicators
  DATA: lv_ltkza TYPE mlgn-ltkza,
        lv_ltkze TYPE mlgn-ltkze.
  CLEAR: lv_ltkza, lv_ltkze.

  SELECT SINGLE ltkza, ltkze
    FROM mlgn
    WHERE matnr = @gs_sel_item-matnr
      AND lgnum = @p_whse
    INTO ( @lv_ltkza, @lv_ltkze ).

  " 3. Check Storage Strategy for STOCK REMOVAL (T334T KZEAR = 'A')
  " Auslagerung / Stock Removal sequence defines where to pick from
  IF lv_ltkza IS NOT INITIAL.
    SELECT lgty0, lgty1, lgty2, lgty3, lgty4, lgty5
      FROM t334t
      WHERE lgnum = @p_whse
        AND kzear = 'A'
        AND lgtkz = @lv_ltkza
      INTO TABLE @DATA(lt_t334t_rem).
    LOOP AT lt_t334t_rem INTO DATA(ls_rem).
      PERFORM append_strategy_stg USING ls_rem-lgty0 1 'Stock Removal Strategy (A)' lv_ltkza.
      PERFORM append_strategy_stg USING ls_rem-lgty1 1 'Stock Removal Strategy (A)' lv_ltkza.
      PERFORM append_strategy_stg USING ls_rem-lgty2 1 'Stock Removal Strategy (A)' lv_ltkza.
      PERFORM append_strategy_stg USING ls_rem-lgty3 1 'Stock Removal Strategy (A)' lv_ltkza.
      PERFORM append_strategy_stg USING ls_rem-lgty4 1 'Stock Removal Strategy (A)' lv_ltkza.
      PERFORM append_strategy_stg USING ls_rem-lgty5 1 'Stock Removal Strategy (A)' lv_ltkza.
    ENDLOOP.
  ENDIF.

  " Fallback generic removal strategy if no specific indicator
  IF gt_strategy_stg IS INITIAL.
    SELECT lgty0, lgty1, lgty2, lgty3, lgty4, lgty5
      FROM t334t
      WHERE lgnum = @p_whse
        AND kzear = 'A'
        AND lgtkz = @space
      INTO TABLE @DATA(lt_t334t_rem_gen).
    LOOP AT lt_t334t_rem_gen INTO DATA(ls_rem_g).
      PERFORM append_strategy_stg USING ls_rem_g-lgty0 1 'Stock Removal Strategy (A)' space.
      PERFORM append_strategy_stg USING ls_rem_g-lgty1 1 'Stock Removal Strategy (A)' space.
      PERFORM append_strategy_stg USING ls_rem_g-lgty2 1 'Stock Removal Strategy (A)' space.
    ENDLOOP.
  ENDIF.

  " 4. Check Storage Strategy for STOCK PLACEMENT (T334T KZEAR = 'E')
  " Einlagerung / Stock Placement sequence
  IF lv_ltkze IS NOT INITIAL.
    SELECT lgty0, lgty1, lgty2, lgty3, lgty4, lgty5
      FROM t334t
      WHERE lgnum = @p_whse
        AND kzear = 'E'
        AND lgtkz = @lv_ltkze
      INTO TABLE @DATA(lt_t334t_pla).
    LOOP AT lt_t334t_pla INTO DATA(ls_pla).
      PERFORM append_strategy_stg USING ls_pla-lgty0 2 'Stock Placement Strategy (E)' lv_ltkze.
      PERFORM append_strategy_stg USING ls_pla-lgty1 2 'Stock Placement Strategy (E)' lv_ltkze.
      PERFORM append_strategy_stg USING ls_pla-lgty2 2 'Stock Placement Strategy (E)' lv_ltkze.
      PERFORM append_strategy_stg USING ls_pla-lgty3 2 'Stock Placement Strategy (E)' lv_ltkze.
      PERFORM append_strategy_stg USING ls_pla-lgty4 2 'Stock Placement Strategy (E)' lv_ltkze.
      PERFORM append_strategy_stg USING ls_pla-lgty5 2 'Stock Placement Strategy (E)' lv_ltkze.
    ENDLOOP.
  ENDIF.

  " 5. Check Material Master Storage Types (MLGT)
  SELECT lgtyp
    FROM mlgt
    WHERE matnr = @gs_sel_item-matnr
      AND lgnum = @p_whse
    INTO TABLE @DATA(lt_mlgt_list).
  LOOP AT lt_mlgt_list INTO DATA(ls_mlgt_it).
    PERFORM append_strategy_stg USING ls_mlgt_it-lgtyp 3 'Material Master (MLGT)' space.
  ENDLOOP.

  " 6. Check Active Warehouse Quants in FROM SLoc (LQUA)
  IF gs_sel_item-lgort IS NOT INITIAL.
    SELECT DISTINCT lgtyp
      FROM lqua
      WHERE matnr = @gs_sel_item-matnr
        AND lgnum = @p_whse
        AND lgort = @gs_sel_item-lgort
        AND gesme > 0
        AND lgtyp NOT LIKE '9%'
        AND lgtyp <> 'OH1'
      INTO TABLE @DATA(lt_lqua_act).
    LOOP AT lt_lqua_act INTO DATA(ls_lq_act).
      PERFORM append_strategy_stg USING ls_lq_act-lgtyp 4 'Whse SLoc Stock' space.
    ENDLOOP.
  ENDIF.

  " 7. Determine Primary Preferred Storage Type (gv_pref_stg)
  SORT gt_strategy_stg BY prio ASCENDING.
  IF gt_strategy_stg IS NOT INITIAL.
    READ TABLE gt_strategy_stg INTO DATA(ls_pref) INDEX 1.
    IF sy-subrc = 0.
      gv_pref_stg = ls_pref-lgtyp.
    ENDIF.
  ENDIF.

  " Fallbacks if still initial
  IF gv_pref_stg IS INITIAL.
    SELECT SINGLE lgtyp FROM mlgt
      WHERE matnr = @gs_sel_item-matnr
        AND lgnum = @p_whse
      INTO @gv_pref_stg.
  ENDIF.
  IF gv_pref_stg IS INITIAL.
    SELECT lgtyp FROM lqua
      WHERE matnr = @gs_sel_item-matnr
        AND lgnum = @p_whse
        AND gesme > 0
        AND lgtyp NOT LIKE '9%'
        AND lgtyp <> 'OH1'
      ORDER BY gesme DESCENDING
      INTO @gv_pref_stg
      UP TO 1 ROWS.
    ENDSELECT.
  ENDIF.

  " Keep p_pstg in sync with determined gv_pref_stg
  p_pstg = gv_pref_stg.
ENDFORM.

*&---------------------------------------------------------------------*
*& Form: append_strategy_stg
*& Author     : DNR / Dipak Rathod
*&---------------------------------------------------------------------*
FORM append_strategy_stg USING iv_lgtyp TYPE lqua-lgtyp
                               iv_prio  TYPE i
                               iv_src   TYPE c
                               iv_lgtkz TYPE mlgn-ltkza.
  IF iv_lgtyp IS INITIAL OR iv_lgtyp = '***'.
    EXIT.
  ENDIF.
  READ TABLE gt_strategy_stg WITH KEY lgtyp = iv_lgtyp TRANSPORTING NO FIELDS.
  IF sy-subrc <> 0.
    DATA: ls_stg TYPE ty_strategy_stg.
    CLEAR ls_stg.
    ls_stg-lgtyp  = iv_lgtyp.
    ls_stg-prio   = iv_prio.
    ls_stg-source = iv_src.
    ls_stg-lgtkz  = iv_lgtkz.
    SELECT SINGLE ltypt FROM t301t
      WHERE lgnum = @p_whse
        AND lgtyp = @iv_lgtyp
        AND ( spras = @sy-langu OR spras = 'E' )
      INTO @ls_stg-ltypt.
    APPEND ls_stg TO gt_strategy_stg.
  ENDIF.
ENDFORM.

*&---------------------------------------------------------------------*
*& Form: open_transfer_screen
*&---------------------------------------------------------------------*
FORM open_transfer_screen USING iv_row TYPE i.
  READ TABLE gt_alv INTO DATA(ls_row) INDEX iv_row.
  IF sy-subrc <> 0.
    EXIT.
  ENDIF.

  " Populate Transfer Screen 2000 fields
  CLEAR: gs_sel_item, p_exidv, p_huqty, p_hubat, p_tqty, p_huser, gv_hu_sernr,
         p_utyp, p_sut, p_sut_tx, gv_unit_type, gv_letyp, gv_letyt.
  MOVE-CORRESPONDING ls_row TO gs_sel_item.

  p_rsnum = ls_row-rsnum.
  p_rspos = ls_row-rspos.
  p_bwart = ls_row-bwart.
  p_usnam = ls_row-usnam.
  p_unam  = ls_row-name_text.
  p_uphon = ls_row-u_phone.
  p_umail = ls_row-u_mail.
  p_matnr = ls_row-matnr.
  p_maktx = ls_row-maktx.
  p_charg = ls_row-charg.
  p_opqty = ls_row-open_qty.
  p_meins = ls_row-meins.
  p_frloc = ls_row-lgort.
  p_toloc = ls_row-umlgo.
  IF ls_row-sut_ind = 'SUT-Enabled' AND ls_row-letyp IS NOT INITIAL.
    p_msut = |SUT: { ls_row-letyp } ({ ls_row-letyt })|.
  ELSEIF ls_row-sut_ind IS NOT INITIAL.
    p_msut = ls_row-sut_ind.
  ELSE.
    p_msut = 'Standard Item'.
  ENDIF.

  p_full  = 'X'.
  p_tqty  = p_opqty.

  " Accurately determine FROM Warehouse Code (p_whse) & Preferred Storage Type (gv_pref_stg)
  PERFORM determine_whse_and_pref_stg.

  " 2. Calculate Available Stock and HUs count in FROM (SRC) Location
  IF gs_sel_item-lgort IS NOT INITIAL AND gs_sel_item-charg IS NOT INITIAL.
    SELECT k~exidv, p~vemng
      FROM vepo AS p
      INNER JOIN vekp AS k ON p~venum = k~venum
      WHERE p~matnr = @gs_sel_item-matnr
        AND p~werks = @gs_sel_item-werks
        AND p~lgort = @gs_sel_item-lgort
        AND p~charg = @gs_sel_item-charg
        AND k~status = '0020'
      INTO TABLE @DATA(lt_hu_stk).
  ELSEIF gs_sel_item-lgort IS NOT INITIAL.
    SELECT k~exidv, p~vemng
      FROM vepo AS p
      INNER JOIN vekp AS k ON p~venum = k~venum
      WHERE p~matnr = @gs_sel_item-matnr
        AND p~werks = @gs_sel_item-werks
        AND p~lgort = @gs_sel_item-lgort
        AND k~status = '0020'
      INTO TABLE @lt_hu_stk.
  ELSE.
    SELECT k~exidv, p~vemng
      FROM vepo AS p
      INNER JOIN vekp AS k ON p~venum = k~venum
      WHERE p~matnr = @gs_sel_item-matnr
        AND p~werks = @gs_sel_item-werks
        AND k~status = '0020'
      INTO TABLE @lt_hu_stk.
  ENDIF.

  IF lt_hu_stk IS INITIAL.
    SELECT k~exidv, p~vemng
      FROM vepo AS p
      INNER JOIN vekp AS k ON p~venum = k~venum
      WHERE p~matnr = @gs_sel_item-matnr
        AND p~werks = @gs_sel_item-werks
        AND ( @gs_sel_item-lgort IS INITIAL OR p~lgort = @gs_sel_item-lgort )
        AND k~status <> '0050'
        AND k~status <> '0060'
      INTO TABLE @lt_hu_stk.
  ENDIF.

  " Query LQUA to match quants by LENUM
  IF p_whse IS NOT INITIAL AND gs_sel_item-lgort IS NOT INITIAL.
    SELECT lgnum, lgtyp, lgpla, lenum, gesme
      FROM lqua
      WHERE matnr = @gs_sel_item-matnr
        AND lgnum = @p_whse
        AND lgort = @gs_sel_item-lgort
      INTO TABLE @DATA(lt_lqua_chk).
  ELSEIF gs_sel_item-lgort IS NOT INITIAL.
    SELECT lgnum, lgtyp, lgpla, lenum, gesme
      FROM lqua
      WHERE matnr = @gs_sel_item-matnr
        AND lgort = @gs_sel_item-lgort
      INTO TABLE @lt_lqua_chk.
  ELSE.
    SELECT lgnum, lgtyp, lgpla, lenum, gesme
      FROM lqua
      WHERE matnr = @gs_sel_item-matnr
        AND ( @p_whse IS INITIAL OR lgnum = @p_whse )
      INTO TABLE @lt_lqua_chk.
  ENDIF.

  DATA: lv_pref_stk TYPE resb-bdmng,
        lv_pref_cnt TYPE i,
        lv_rest_stk TYPE resb-bdmng,
        lv_rest_cnt TYPE i.
  TYPES: BEGIN OF ty_counted_su,
           lenum TYPE lqua-lenum,
         END OF ty_counted_su.
  DATA: lt_counted_su TYPE HASHED TABLE OF ty_counted_su WITH UNIQUE KEY lenum.
  CLEAR: lv_pref_stk, lv_pref_cnt, lv_rest_stk, lv_rest_cnt, lt_counted_su.

  LOOP AT lt_hu_stk INTO DATA(ls_hs).
    DATA: lv_lenum_pad TYPE lqua-lenum.
    CALL FUNCTION 'CONVERSION_EXIT_ALPHA_INPUT'
      EXPORTING input  = ls_hs-exidv
      IMPORTING output = lv_lenum_pad.

    INSERT VALUE #( lenum = lv_lenum_pad ) INTO TABLE lt_counted_su.
    INSERT VALUE #( lenum = ls_hs-exidv ) INTO TABLE lt_counted_su.

    READ TABLE lt_lqua_chk INTO DATA(ls_lq_c)
      WITH KEY lenum = lv_lenum_pad.
    IF sy-subrc <> 0.
      READ TABLE lt_lqua_chk INTO ls_lq_c
        WITH KEY lenum = ls_hs-exidv.
    ENDIF.

    IF sy-subrc = 0.
      IF ls_lq_c-lgtyp = gv_pref_stg.
        lv_pref_stk = lv_pref_stk + ls_hs-vemng.
        lv_pref_cnt = lv_pref_cnt + 1.
      ELSEIF ls_lq_c-lgtyp <> 'OH1' AND NOT ( ls_lq_c-lgpla CS 'HOLD' OR ls_lq_c-lgpla CS 'BLOCK' ).
        lv_rest_stk = lv_rest_stk + ls_hs-vemng.
        lv_rest_cnt = lv_rest_cnt + 1.
      ENDIF.
    ELSE.
      lv_rest_stk = lv_rest_stk + ls_hs-vemng.
      lv_rest_cnt = lv_rest_cnt + 1.
    ENDIF.
  ENDLOOP.

  " Also include Storage Units (SUs) from LQUA not managed in VEKP
  LOOP AT lt_lqua_chk INTO DATA(ls_lq_su) WHERE lenum IS NOT INITIAL AND gesme > 0.
    READ TABLE lt_counted_su WITH KEY lenum = ls_lq_su-lenum TRANSPORTING NO FIELDS.
    IF sy-subrc <> 0.
      INSERT VALUE #( lenum = ls_lq_su-lenum ) INTO TABLE lt_counted_su.
      IF ls_lq_su-lgtyp = gv_pref_stg.
        lv_pref_stk = lv_pref_stk + ls_lq_su-gesme.
        lv_pref_cnt = lv_pref_cnt + 1.
      ELSEIF ls_lq_su-lgtyp <> 'OH1' AND NOT ( ls_lq_su-lgpla CS 'HOLD' OR ls_lq_su-lgpla CS 'BLOCK' ).
        lv_rest_stk = lv_rest_stk + ls_lq_su-gesme.
        lv_rest_cnt = lv_rest_cnt + 1.
      ENDIF.
    ENDIF.
  ENDLOOP.

  " Calculate Total Available Warehouse Stock & Units in FROM Location
  p_stk   = lv_pref_stk + lv_rest_stk.
  p_hucnt = lv_pref_cnt + lv_rest_cnt.

  " Launch Transfer Screen 2000
  CALL SELECTION-SCREEN 2000.

  " If posting occurred, refresh reservation list
  IF gv_posted = abap_true.
    CLEAR gv_posted.
    PERFORM fetch_open_reservations.
    IF gr_salv_table IS BOUND.
      gr_salv_table->refresh( ).
    ENDIF.
  ENDIF.
ENDFORM.

*&---------------------------------------------------------------------*
*& Form: show_bin_locations
*& Description: Displays Storage Bins, Sections, Stock & Serials
*&---------------------------------------------------------------------*
FORM show_bin_locations.
  " Synchronize material context if user clicked directly from screen 2000
  IF gs_sel_item-matnr IS INITIAL AND p_matnr IS NOT INITIAL.
    gs_sel_item-matnr = p_matnr.
    gs_sel_item-lgort = p_frloc.
    gs_sel_item-charg = p_charg.
    gs_sel_item-werks = p_plnt.
    gs_sel_item-meins = p_meins.
  ENDIF.
  IF gs_sel_item-matnr IS INITIAL AND gt_alv IS NOT INITIAL.
    READ TABLE gt_alv INTO gs_sel_item INDEX 1.
  ENDIF.

  " Ensure accurate determination of FROM Warehouse Code & Preferred Storage Type
  PERFORM determine_whse_and_pref_stg.

  PERFORM fetch_bin_stock_data.
  IF gt_bin_stock IS INITIAL.
    lcl_ui_helper=>show_error_popup(
      iv_title = 'No Preferred Storage Stock'
      iv_msg1  = |No active Stock or Units found for Material { gs_sel_item-matnr ALPHA = OUT }.|
      iv_msg2  = |Whse: { p_whse } \| SLoc: { gs_sel_item-lgort } \| Pref Stg: { gv_pref_stg }| ).
    EXIT.
  ENDIF.
  PERFORM display_bin_stock_popup.
ENDFORM.

*&---------------------------------------------------------------------*
*& Form: show_visual_rack_bins
*& Description: Visual Warehouse Pallet Rack & Bins Map
*&              (Ground = B1/01, Middle = B2/02, Top = B3/03)
*&---------------------------------------------------------------------*
FORM show_visual_rack_bins.
  " Synchronize material context if user clicked directly from screen 2000
  IF p_matnr IS NOT INITIAL.
    gs_sel_item-matnr = p_matnr.
    gs_sel_item-maktx = p_maktx.
    gs_sel_item-lgort = p_frloc.
    gs_sel_item-charg = p_charg.
    gs_sel_item-werks = p_plnt.
    gs_sel_item-meins = p_meins.
  ENDIF.
  IF gs_sel_item-matnr IS INITIAL AND gt_alv IS NOT INITIAL.
    READ TABLE gt_alv INTO gs_sel_item INDEX 1.
  ENDIF.

  " Ensure accurate determination of FROM Warehouse Code & Preferred Storage Type
  PERFORM determine_whse_and_pref_stg.

  PERFORM fetch_bin_stock_data.
  IF gt_bin_stock IS INITIAL.
    lcl_ui_helper=>show_error_popup(
      iv_title = 'No Preferred Storage Stock'
      iv_msg1  = |No active Stock or Units found for Material { gs_sel_item-matnr ALPHA = OUT }.|
      iv_msg2  = |Whse: { p_whse } \| SLoc: { gs_sel_item-lgort } \| Pref Stg: { gv_pref_stg }| ).
    EXIT.
  ENDIF.
  PERFORM display_visual_rack_popup.
ENDFORM.

*&---------------------------------------------------------------------*
*& Form: fetch_bin_stock_data
*& Description: Shared query for Active Stock, HUs, Bins, and Serials
*&---------------------------------------------------------------------*
FORM fetch_bin_stock_data.
  CLEAR gt_bin_stock.

  " Synchronize material context if user clicked directly from screen 2000
  IF gs_sel_item-matnr IS INITIAL AND p_matnr IS NOT INITIAL.
    gs_sel_item-matnr = p_matnr.
    gs_sel_item-lgort = p_frloc.
    gs_sel_item-charg = p_charg.
    gs_sel_item-werks = p_plnt.
    gs_sel_item-meins = p_meins.
  ENDIF.
  IF gs_sel_item-matnr IS INITIAL AND gt_alv IS NOT INITIAL.
    READ TABLE gt_alv INTO gs_sel_item INDEX 1.
  ENDIF.
  IF gs_sel_item-matnr IS INITIAL.
    " Fallback default material if none selected yet
    gs_sel_item-matnr = '000000008000009754'.
    gs_sel_item-werks = '1120'.
    gs_sel_item-lgort = 'CS02'.
    gs_sel_item-meins = 'NOS'.
  ENDIF.

  " 0. Accurately determine FROM Warehouse Code (p_whse) & Preferred Storage Type (gv_pref_stg)
  PERFORM determine_whse_and_pref_stg.

  " 1. Read Active In-Stock Handling Units in FROM (SRC) Location
  IF gs_sel_item-lgort IS NOT INITIAL AND gs_sel_item-charg IS NOT INITIAL.
    SELECT k~exidv, p~charg, p~vemng, p~vemeh, p~werks, p~lgort
      FROM vepo AS p
      INNER JOIN vekp AS k ON p~venum = k~venum
      WHERE p~matnr = @gs_sel_item-matnr
        AND p~werks = @gs_sel_item-werks
        AND p~lgort = @gs_sel_item-lgort
        AND p~charg = @gs_sel_item-charg
        AND k~status = '0020'
      INTO TABLE @DATA(lt_hus_loc).
  ELSEIF gs_sel_item-lgort IS NOT INITIAL.
    SELECT k~exidv, p~charg, p~vemng, p~vemeh, p~werks, p~lgort
      FROM vepo AS p
      INNER JOIN vekp AS k ON p~venum = k~venum
      WHERE p~matnr = @gs_sel_item-matnr
        AND p~werks = @gs_sel_item-werks
        AND p~lgort = @gs_sel_item-lgort
        AND k~status = '0020'
      INTO TABLE @lt_hus_loc.
  ELSE.
    SELECT k~exidv, p~charg, p~vemng, p~vemeh, p~werks, p~lgort
      FROM vepo AS p
      INNER JOIN vekp AS k ON p~venum = k~venum
      WHERE p~matnr = @gs_sel_item-matnr
        AND p~werks = @gs_sel_item-werks
        AND k~status = '0020'
      INTO TABLE @lt_hus_loc.
  ENDIF.

  IF lt_hus_loc IS INITIAL.
    SELECT k~exidv, p~charg, p~vemng, p~vemeh, p~werks, p~lgort
      FROM vepo AS p
      INNER JOIN vekp AS k ON p~venum = k~venum
      WHERE p~matnr = @gs_sel_item-matnr
        AND p~werks = @gs_sel_item-werks
        AND ( @gs_sel_item-lgort IS INITIAL OR p~lgort = @gs_sel_item-lgort )
        AND k~status <> '0050'
        AND k~status <> '0060'
      INTO TABLE @lt_hus_loc.
  ENDIF.

  " 2. Read Serial Numbers assigned to HUs from SER06 & OBJK
  IF lt_hus_loc IS NOT INITIAL.
    SELECT s~exidv, o~sernr
      FROM ser06 AS s
      INNER JOIN objk AS o ON s~obknr = o~obknr
      FOR ALL ENTRIES IN @lt_hus_loc
      WHERE s~exidv = @lt_hus_loc-exidv
      INTO TABLE @DATA(lt_hu_sernr).
    SORT lt_hu_sernr BY exidv.
  ENDIF.

  " 3. Read Warehouse Quants & Bins from LQUA for FROM Warehouse & SLoc
  IF p_whse IS NOT INITIAL AND gs_sel_item-lgort IS NOT INITIAL.
    SELECT lgnum, lgtyp, lgpla, lgort, lenum, charg, gesme, meins, letyp, kzhuq
      FROM lqua
      WHERE matnr = @gs_sel_item-matnr
        AND lgnum = @p_whse
        AND lgort = @gs_sel_item-lgort
        AND gesme > 0
      INTO TABLE @DATA(lt_lqua_loc).
  ELSEIF gs_sel_item-lgort IS NOT INITIAL.
    SELECT lgnum, lgtyp, lgpla, lgort, lenum, charg, gesme, meins, letyp, kzhuq
      FROM lqua
      WHERE matnr = @gs_sel_item-matnr
        AND lgort = @gs_sel_item-lgort
        AND gesme > 0
      INTO TABLE @lt_lqua_loc.
  ELSE.
    SELECT lgnum, lgtyp, lgpla, lgort, lenum, charg, gesme, meins, letyp, kzhuq
      FROM lqua
      WHERE matnr = @gs_sel_item-matnr
        AND ( @p_whse IS INITIAL OR lgnum = @p_whse )
        AND gesme > 0
      INTO TABLE @lt_lqua_loc.
  ENDIF.

  " 4. Read Storage Bin Sections and Types from LAGP
  IF p_whse IS NOT INITIAL.
    SELECT lgnum, lgtyp, lgpla, lgber, lptyp
      FROM lagp
      WHERE lgnum = @p_whse
      INTO TABLE @DATA(lt_lagp_loc).
  ELSE.
    SELECT lgnum, lgtyp, lgpla, lgber, lptyp
      FROM lagp
      INTO TABLE @lt_lagp_loc.
  ENDIF.

  " 4b. Read Storage Section Descriptions from T302T
  SELECT lgnum, lgtyp, lgber, spras, lbert
    FROM t302t
    WHERE lgnum = @p_whse
    INTO TABLE @DATA(lt_t302t).
  IF lt_t302t IS INITIAL.
    SELECT lgnum, lgtyp, lgber, spras, lbert
      FROM t302t
      INTO TABLE @lt_t302t.
  ENDIF.

  " 4c. Read Storage Type Descriptions from T301T
  SELECT lgnum, lgtyp, spras, ltypt
    FROM t301t
    WHERE spras = @sy-langu OR spras = 'E'
    INTO TABLE @DATA(lt_t301t).

  " 4d. Read Storage Unit Type Descriptions from T307T
  SELECT lgnum, letyp, spras, letyt
    FROM t307t
    WHERE spras = @sy-langu OR spras = 'E'
    INTO TABLE @DATA(lt_t307t_bs).

  " 5. Build Bin Stock Records
  DATA: lt_added_units TYPE STANDARD TABLE OF vekp-exidv.
  CLEAR: lt_added_units.

  LOOP AT lt_hus_loc INTO DATA(ls_h).
    DATA: ls_entry TYPE ty_bin_stock.
    CLEAR ls_entry.

    ls_entry-unit_type = 'HU'.
    ls_entry-exidv     = ls_h-exidv.
    ls_entry-charg     = ls_h-charg.
    ls_entry-vemng     = ls_h-vemng.
    ls_entry-vemeh     = ls_h-vemeh.
    ls_entry-lgort     = ls_h-lgort.
    APPEND ls_h-exidv TO lt_added_units.

    " Match Serial Number
    READ TABLE lt_hu_sernr INTO DATA(ls_ser)
      WITH KEY exidv = ls_h-exidv
      BINARY SEARCH.
    IF sy-subrc = 0.
      ls_entry-sernr = ls_ser-sernr.
    ELSE.
      ls_entry-sernr = 'N/A'.
    ENDIF.

    " Match LQUA by LENUM (check padded and raw)
    DATA: lv_lenum_find TYPE lqua-lenum.
    CALL FUNCTION 'CONVERSION_EXIT_ALPHA_INPUT'
      EXPORTING input  = ls_h-exidv
      IMPORTING output = lv_lenum_find.
    APPEND lv_lenum_find TO lt_added_units.

    READ TABLE lt_lqua_loc INTO DATA(ls_lq)
      WITH KEY lenum = lv_lenum_find.
    IF sy-subrc <> 0.
      READ TABLE lt_lqua_loc INTO ls_lq
        WITH KEY lenum = ls_h-exidv.
    ENDIF.

    IF sy-subrc = 0.
      ls_entry-lgnum = ls_lq-lgnum.
      ls_entry-lgtyp = ls_lq-lgtyp.
      ls_entry-lgpla = ls_lq-lgpla.
      ls_entry-sut   = ls_lq-letyp.
      IF ls_lq-lgort IS NOT INITIAL.
        ls_entry-lgort = ls_lq-lgort.
      ENDIF.
    ELSE.
      " If HU has no quant in Pref Stg Type, check if quant exists in another stg type in p_whse
      SELECT SINGLE lgnum, lgtyp, lgpla, letyp, lgort
        FROM lqua
        WHERE matnr = @gs_sel_item-matnr
          AND ( @p_whse IS INITIAL OR lgnum = @p_whse )
          AND ( lenum = @lv_lenum_find OR lenum = @ls_h-exidv )
        INTO ( @ls_entry-lgnum, @ls_entry-lgtyp, @ls_entry-lgpla, @ls_entry-sut, @DATA(lv_lq_lgort) ).
      IF sy-subrc = 0.
        IF lv_lq_lgort IS NOT INITIAL.
          ls_entry-lgort = lv_lq_lgort.
        ENDIF.
      ELSE.
        ls_entry-lgpla = |FLOOR / { ls_h-lgort }|.
        ls_entry-lgtyp = 'STG'.
        ls_entry-lgnum = p_whse.
      ENDIF.
    ENDIF.

    " Match SUT Description from T307T
    IF ls_entry-sut IS NOT INITIAL.
      READ TABLE lt_t307t_bs INTO DATA(ls_t307_bs)
        WITH KEY letyp = ls_entry-sut.
      IF sy-subrc = 0.
        ls_entry-sut_tx = ls_t307_bs-letyt.
      ENDIF.
    ENDIF.

    " Match Storage Section & Bin Type from LAGP
    READ TABLE lt_lagp_loc INTO DATA(ls_lp)
      WITH KEY lgnum = ls_entry-lgnum
               lgtyp = ls_entry-lgtyp
               lgpla = ls_entry-lgpla.
    IF sy-subrc <> 0.
      READ TABLE lt_lagp_loc INTO ls_lp
        WITH KEY lgnum = ls_entry-lgnum
                 lgpla = ls_entry-lgpla.
    ENDIF.
    IF sy-subrc <> 0.
      READ TABLE lt_lagp_loc INTO ls_lp
        WITH KEY lgpla = ls_entry-lgpla.
    ENDIF.

    IF sy-subrc = 0.
      IF ls_lp-lgber IS NOT INITIAL.
        ls_entry-lgber = ls_lp-lgber.
      ENDIF.
      ls_entry-lptyp = ls_lp-lptyp.
    ELSE.
      " Infer from bin position if LAGP entry is missing
      " Format: X-XXXX-XX (00=Ground, 01=1st, 02=2nd, 03=3rd, 04=4th)
      DATA(lv_b_raw) = condense( ls_entry-lgpla ).
      DATA: lv_last2_infer TYPE c LENGTH 2.
      IF lv_b_raw CS '-'.
        SPLIT lv_b_raw AT '-' INTO DATA(lv_f_raw) DATA(lv_r_raw) DATA(lv_p_raw).
        IF lv_p_raw IS INITIAL.
          lv_p_raw = lv_r_raw.
        ENDIF.
        DATA(lv_p_len) = strlen( lv_p_raw ).
        IF lv_p_len >= 2.
          DATA(lv_p_off) = lv_p_len - 2.
          lv_last2_infer = lv_p_raw+lv_p_off(2).
        ELSE.
          lv_last2_infer = lv_p_raw.
        ENDIF.
      ELSE.
        DATA(lv_b_len) = strlen( lv_b_raw ).
        IF lv_b_len >= 2.
          DATA(lv_b_pos) = lv_b_len - 2.
          lv_last2_infer = lv_b_raw+lv_b_pos(2).
        ELSE.
          lv_last2_infer = lv_b_raw.
        ENDIF.
      ENDIF.
      TRANSLATE lv_last2_infer TO UPPER CASE.

      IF lv_last2_infer = '00' OR lv_last2_infer = 'B0'.
        ls_entry-lgber = '001'. " Level 0 (Ground / Fast-Moving)
      ELSEIF lv_last2_infer = '01' OR lv_last2_infer = 'B1'.
        ls_entry-lgber = 'IT1'. " Level 1 (First Bin / Blue)
      ELSEIF lv_last2_infer = '02' OR lv_last2_infer = 'B2'.
        ls_entry-lgber = 'IT2'. " Level 2 (2nd Bin / Pink Hazard)
      ELSEIF lv_last2_infer = '03' OR lv_last2_infer = 'B3'.
        ls_entry-lgber = 'IT3'. " Level 3 (Third Bin / Orange)
      ELSEIF lv_last2_infer = '04' OR lv_last2_infer = 'B4'.
        ls_entry-lgber = 'IT1'. " Level 4 (Blue Section)
      ELSE.
        ls_entry-lgber = '001'. " General / Fast-moving
      ENDIF.
    ENDIF.

    " Determine Storage Bin Position
    IF ls_entry-lptyp IS NOT INITIAL.
      ls_entry-bin_pos = ls_entry-lptyp.
    ELSE.
      DATA(lv_b_raw_pos) = condense( ls_entry-lgpla ).
      IF lv_b_raw_pos CS '-'.
        SPLIT lv_b_raw_pos AT '-' INTO DATA(lv_f_d) DATA(lv_r_d) DATA(lv_p_d).
        IF lv_p_d IS NOT INITIAL.
          ls_entry-bin_pos = lv_p_d.
        ELSE.
          ls_entry-bin_pos = lv_r_d.
        ENDIF.
      ELSE.
        DATA(lv_p_len2) = strlen( lv_b_raw_pos ).
        IF lv_p_len2 >= 2.
          DATA(lv_off2) = lv_p_len2 - 2.
          ls_entry-bin_pos = lv_b_raw_pos+lv_off2(2).
        ELSE.
          ls_entry-bin_pos = lv_b_raw_pos.
        ENDIF.
      ENDIF.
    ENDIF.

    " Determine Storage Type Description from T301T
    READ TABLE lt_t301t INTO DATA(ls_t301t)
      WITH KEY lgnum = ls_entry-lgnum
               lgtyp = ls_entry-lgtyp
               spras = sy-langu.
    IF sy-subrc <> 0.
      READ TABLE lt_t301t INTO ls_t301t
        WITH KEY lgnum = ls_entry-lgnum
                 lgtyp = ls_entry-lgtyp
                 spras = 'E'.
    ENDIF.
    IF sy-subrc <> 0.
      READ TABLE lt_t301t INTO ls_t301t
        WITH KEY lgtyp = ls_entry-lgtyp
                 spras = 'E'.
    ENDIF.
    IF sy-subrc = 0.
      ls_entry-ltypt = ls_t301t-ltypt.
    ELSE.
      IF ls_entry-lgtyp = 'EN1'.
        ls_entry-ltypt = 'Hazardous Materials Whse'.
      ELSEIF ls_entry-lgtyp = '001'.
        ls_entry-ltypt = 'High Rack Storage'.
      ELSEIF ls_entry-lgtyp = '006'.
        ls_entry-ltypt = 'Hazardous Materials Whse'.
      ELSE.
        ls_entry-ltypt = |Storage Type { ls_entry-lgtyp }|.
      ENDIF.
    ENDIF.

    IF ls_entry-lgpla CS '1-L0001-04' OR ls_entry-bin_pos = '04'.
      ls_entry-lgber = 'IT1'.
      ls_entry-lbert = 'Blue'.
    ENDIF.

    " Match Storage Section Description from T302T
    CLEAR ls_entry-lbert.
    READ TABLE lt_t302t INTO DATA(ls_t302t)
      WITH KEY lgnum = ls_entry-lgnum
               lgtyp = ls_entry-lgtyp
               lgber = ls_entry-lgber
               spras = sy-langu.
    IF sy-subrc <> 0.
      READ TABLE lt_t302t INTO ls_t302t
        WITH KEY lgnum = ls_entry-lgnum
                 lgtyp = ls_entry-lgtyp
                 lgber = ls_entry-lgber
                 spras = 'E'.
    ENDIF.
    IF sy-subrc <> 0.
      READ TABLE lt_t302t INTO ls_t302t
        WITH KEY lgnum = ls_entry-lgnum
                 lgber = ls_entry-lgber
                 spras = 'E'.
    ENDIF.
    IF sy-subrc <> 0.
      READ TABLE lt_t302t INTO ls_t302t
        WITH KEY lgber = ls_entry-lgber
                 spras = 'E'.
    ENDIF.
    IF sy-subrc <> 0.
      READ TABLE lt_t302t INTO ls_t302t
        WITH KEY lgber = ls_entry-lgber.
    ENDIF.

    IF sy-subrc = 0 AND ls_t302t-lbert IS NOT INITIAL.
      ls_entry-lbert = ls_t302t-lbert.
    ELSE.
      CASE ls_entry-lgber.
        WHEN 'IT1'. ls_entry-lbert = 'Blue'.
        WHEN 'IT2'. ls_entry-lbert = 'Red'.
        WHEN 'IT3'. ls_entry-lbert = 'Orange'.
        WHEN '001'. ls_entry-lbert = 'Fast-moving items'.
        WHEN '002'. ls_entry-lbert = 'Slow-moving items'.
        WHEN '003'. ls_entry-lbert = 'Total section'.
        WHEN OTHERS. ls_entry-lbert = |Section { ls_entry-lgber }|.
      ENDCASE.
    ENDIF.

    " Determine Color based on Storage Section Description & Code
    DATA: lv_c_col TYPE i,
          lv_c_int TYPE i.
    CLEAR: lv_c_col, lv_c_int.
    PERFORM get_storage_section_color USING ls_entry-lgber ls_entry-lbert CHANGING lv_c_col lv_c_int.

    CLEAR ls_entry-t_color.
    DATA: ls_cell_col TYPE lvc_s_scol.

    " Background of Storage Bin Number (LGPLA) as per Storage Section Description
    CLEAR ls_cell_col.
    ls_cell_col-fname     = 'LGPLA'.
    ls_cell_col-color-col = lv_c_col.
    ls_cell_col-color-int = lv_c_int.
    ls_cell_col-color-inv = 0.
    ls_cell_col-nokeycol  = abap_true.
    APPEND ls_cell_col TO ls_entry-t_color.

    " Background of Stock Quantity (VEMNG) as per Storage Section Description
    CLEAR ls_cell_col.
    ls_cell_col-fname     = 'VEMNG'.
    ls_cell_col-color-col = lv_c_col.
    ls_cell_col-color-int = lv_c_int.
    ls_cell_col-color-inv = 0.
    ls_cell_col-nokeycol  = abap_true.
    APPEND ls_cell_col TO ls_entry-t_color.

    " Background of Storage Section Description (LBERT)
    CLEAR ls_cell_col.
    ls_cell_col-fname     = 'LBERT'.
    ls_cell_col-color-col = lv_c_col.
    ls_cell_col-color-int = lv_c_int.
    ls_cell_col-color-inv = 0.
    ls_cell_col-nokeycol  = abap_true.
    APPEND ls_cell_col TO ls_entry-t_color.

    " Background of Storage Section Code (LGBER)
    CLEAR ls_cell_col.
    ls_cell_col-fname     = 'LGBER'.
    ls_cell_col-color-col = lv_c_col.
    ls_cell_col-color-int = lv_c_int.
    ls_cell_col-color-inv = 0.
    ls_cell_col-nokeycol  = abap_true.
    APPEND ls_cell_col TO ls_entry-t_color.

    " Categorize Stock Status & Priority:
    " If matched with Material Master Storage Type (e.g. EN1) -> Available (Priority 1)
    " If OH1 or Bin contains HOLD / BLOCK -> On-Hold (Priority 3)
    " If interim (911, 902, 9*) or others -> In-Process (Priority 2)
    IF ls_entry-lgtyp = gv_pref_stg.
      ls_entry-stg_stat  = |@01@ Primary Strategy ({ gv_pref_stg })|.
      ls_entry-sort_prio = 1.
    ELSEIF ls_entry-lgtyp = 'OH1' OR ls_entry-lgpla CS 'HOLD' OR ls_entry-lgpla CS 'BLOCK'.
      ls_entry-stg_stat  = '@02@ On-Hold'.
      ls_entry-sort_prio = 4.
    ELSEIF ls_entry-lgtyp CP '9*' OR ls_entry-lgtyp = '911' OR ls_entry-lgtyp = '902'.
      ls_entry-stg_stat  = |@08@ In-Process ({ ls_entry-lgtyp })|.
      ls_entry-sort_prio = 3.
    ELSE.
      READ TABLE gt_strategy_stg WITH KEY lgtyp = ls_entry-lgtyp TRANSPORTING NO FIELDS.
      IF sy-subrc = 0.
        ls_entry-stg_stat  = |@01@ Strategy ({ ls_entry-lgtyp })|.
        ls_entry-sort_prio = 2.
      ELSE.
        ls_entry-stg_stat  = |@01@ Available ({ ls_entry-lgtyp })|.
        ls_entry-sort_prio = 2.
      ENDIF.
    ENDIF.

    " If Available Stock Qty is Zero or No HU, highlight line in light orange
    IF ls_entry-vemng <= 0 OR ls_entry-exidv IS INITIAL.
      CLEAR ls_cell_col.
      ls_cell_col-fname     = ''. " Entire row
      ls_cell_col-color-col = 3.  " Orange
      ls_cell_col-color-int = 1.  " Intensified (Light Orange)
      ls_cell_col-color-inv = 0.
      ls_cell_col-nokeycol  = abap_true.
      APPEND ls_cell_col TO ls_entry-t_color.
    ENDIF.

    APPEND ls_entry TO gt_bin_stock.
  ENDLOOP.

  " 5b. Add Storage Units (SUs) from LQUA not already processed as HUs
  LOOP AT lt_lqua_loc INTO DATA(ls_lq_su_bin) WHERE lenum IS NOT INITIAL AND gesme > 0.
    DATA: lv_su_key TYPE vekp-exidv.
    lv_su_key = ls_lq_su_bin-lenum.
    READ TABLE lt_added_units WITH KEY table_line = lv_su_key TRANSPORTING NO FIELDS.
    IF sy-subrc <> 0.
      APPEND lv_su_key TO lt_added_units.
      CLEAR ls_entry.

      ls_entry-unit_type = 'SU'.
      ls_entry-exidv     = ls_lq_su_bin-lenum.
      ls_entry-charg     = ls_lq_su_bin-charg.
      ls_entry-vemng     = ls_lq_su_bin-gesme.
      ls_entry-vemeh     = ls_lq_su_bin-meins.
      ls_entry-lgnum     = ls_lq_su_bin-lgnum.
      ls_entry-lgtyp     = ls_lq_su_bin-lgtyp.
      ls_entry-lgpla     = ls_lq_su_bin-lgpla.
      ls_entry-lgort     = ls_lq_su_bin-lgort.
      ls_entry-sut       = ls_lq_su_bin-letyp.
      ls_entry-sernr     = 'N/A'.

      IF ls_entry-sut IS NOT INITIAL.
        READ TABLE lt_t307t_bs INTO ls_t307_bs WITH KEY letyp = ls_entry-sut.
        IF sy-subrc = 0.
          ls_entry-sut_tx = ls_t307_bs-letyt.
        ENDIF.
      ENDIF.

      " Match Storage Section & Bin Type from LAGP
      READ TABLE lt_lagp_loc INTO ls_lp
        WITH KEY lgnum = ls_entry-lgnum
                 lgtyp = ls_entry-lgtyp
                 lgpla = ls_entry-lgpla.
      IF sy-subrc <> 0.
        READ TABLE lt_lagp_loc INTO ls_lp
          WITH KEY lgnum = ls_entry-lgnum
                   lgpla = ls_entry-lgpla.
      ENDIF.
      IF sy-subrc <> 0.
        READ TABLE lt_lagp_loc INTO ls_lp
          WITH KEY lgpla = ls_entry-lgpla.
      ENDIF.

      IF sy-subrc = 0.
        IF ls_lp-lgber IS NOT INITIAL.
          ls_entry-lgber = ls_lp-lgber.
        ENDIF.
        ls_entry-lptyp = ls_lp-lptyp.
      ELSE.
        ls_entry-lgber = '001'.
      ENDIF.

      IF ls_entry-lptyp IS NOT INITIAL.
        ls_entry-bin_pos = ls_entry-lptyp.
      ELSE.
        DATA(lv_b_raw_su) = condense( ls_entry-lgpla ).
        IF lv_b_raw_su CS '-'.
          SPLIT lv_b_raw_su AT '-' INTO DATA(lv_f_su) DATA(lv_r_su) DATA(lv_p_su).
          IF lv_p_su IS NOT INITIAL.
            ls_entry-bin_pos = lv_p_su.
          ELSE.
            ls_entry-bin_pos = lv_r_su.
          ENDIF.
        ELSE.
          ls_entry-bin_pos = lv_b_raw_su.
        ENDIF.
      ENDIF.

      READ TABLE lt_t301t INTO ls_t301t
        WITH KEY lgnum = ls_entry-lgnum
                 lgtyp = ls_entry-lgtyp
                 spras = sy-langu.
      IF sy-subrc <> 0.
        READ TABLE lt_t301t INTO ls_t301t
          WITH KEY lgtyp = ls_entry-lgtyp
                   spras = 'E'.
      ENDIF.
      IF sy-subrc = 0.
        ls_entry-ltypt = ls_t301t-ltypt.
      ELSE.
        ls_entry-ltypt = |Storage Type { ls_entry-lgtyp }|.
      ENDIF.

      READ TABLE lt_t302t INTO ls_t302t
        WITH KEY lgnum = ls_entry-lgnum
                 lgtyp = ls_entry-lgtyp
                 lgber = ls_entry-lgber
                 spras = sy-langu.
      IF sy-subrc <> 0.
        READ TABLE lt_t302t INTO ls_t302t
          WITH KEY lgber = ls_entry-lgber.
      ENDIF.
      IF sy-subrc = 0 AND ls_t302t-lbert IS NOT INITIAL.
        ls_entry-lbert = ls_t302t-lbert.
      ELSE.
        ls_entry-lbert = |Section { ls_entry-lgber }|.
      ENDIF.

      CLEAR: lv_c_col, lv_c_int.
      PERFORM get_storage_section_color USING ls_entry-lgber ls_entry-lbert CHANGING lv_c_col lv_c_int.

      CLEAR ls_entry-t_color.
      CLEAR ls_cell_col.
      ls_cell_col-fname     = 'LGPLA'.
      ls_cell_col-color-col = lv_c_col.
      ls_cell_col-color-int = lv_c_int.
      ls_cell_col-nokeycol  = abap_true.
      APPEND ls_cell_col TO ls_entry-t_color.

      CLEAR ls_cell_col.
      ls_cell_col-fname     = 'VEMNG'.
      ls_cell_col-color-col = lv_c_col.
      ls_cell_col-color-int = lv_c_int.
      ls_cell_col-nokeycol  = abap_true.
      APPEND ls_cell_col TO ls_entry-t_color.

      IF ls_entry-lgtyp = gv_pref_stg.
        ls_entry-stg_stat  = |@01@ Primary Strategy ({ gv_pref_stg })|.
        ls_entry-sort_prio = 1.
      ELSEIF ls_entry-lgtyp = 'OH1' OR ls_entry-lgpla CS 'HOLD' OR ls_entry-lgpla CS 'BLOCK'.
        ls_entry-stg_stat  = '@02@ On-Hold'.
        ls_entry-sort_prio = 4.
      ELSEIF ls_entry-lgtyp CP '9*' OR ls_entry-lgtyp = '911' OR ls_entry-lgtyp = '902'.
        ls_entry-stg_stat  = |@08@ In-Process ({ ls_entry-lgtyp })|.
        ls_entry-sort_prio = 3.
      ELSE.
        READ TABLE gt_strategy_stg WITH KEY lgtyp = ls_entry-lgtyp TRANSPORTING NO FIELDS.
        IF sy-subrc = 0.
          ls_entry-stg_stat  = |@01@ Strategy ({ ls_entry-lgtyp })|.
          ls_entry-sort_prio = 2.
        ELSE.
          ls_entry-stg_stat  = |@01@ Available ({ ls_entry-lgtyp })|.
          ls_entry-sort_prio = 2.
        ENDIF.
      ENDIF.

      APPEND ls_entry TO gt_bin_stock.
    ENDIF.
  ENDLOOP.

  " Filter to FROM Warehouse Code and Storage Location
  IF p_whse IS NOT INITIAL.
    DELETE gt_bin_stock WHERE lgnum <> p_whse.
  ENDIF.
  IF gs_sel_item-lgort IS NOT INITIAL.
    DELETE gt_bin_stock WHERE lgort <> gs_sel_item-lgort.
  ENDIF.

  IF gt_bin_stock IS INITIAL.
    IF gs_sel_item-lgort IS NOT INITIAL.
      MESSAGE |No active Stock or Units found in Whse { p_whse }, SLoc { gs_sel_item-lgort }| TYPE 'S' DISPLAY LIKE 'W'.
    ELSE.
      MESSAGE |No active Warehouse Bins or Stock found for Material { gs_sel_item-matnr }| TYPE 'S' DISPLAY LIKE 'W'.
    ENDIF.
    EXIT.
  ENDIF.

  SORT gt_bin_stock BY sort_prio ASCENDING lgtyp ASCENDING lgpla ASCENDING exidv ASCENDING.
ENDFORM.

*&---------------------------------------------------------------------*
*& Form: display_bin_stock_popup
*& Description: Displays Storage Bins, Sections, Stock & Serials ALV
*&---------------------------------------------------------------------*
FORM display_bin_stock_popup.
  TRY.
      cl_salv_table=>factory(
        IMPORTING
          r_salv_table = gr_salv_popup
        CHANGING
          t_table      = gt_bin_stock ).

      " Calculate dynamic responsive popup dimensions (90% width & 90% height)
      DATA: lv_term_cols TYPE i,
            lv_term_rows TYPE i,
            lv_pop_scol  TYPE i,
            lv_pop_ecol  TYPE i,
            lv_pop_srow  TYPE i,
            lv_pop_erow  TYPE i,
            lv_pop_w     TYPE i,
            lv_pop_h     TYPE i.

      lv_term_cols = sy-scols.
      lv_term_rows = sy-srows.

      " Fallback safety if kernel or WebGUI returns 0 or initial
      IF lv_term_cols < 40.
        lv_term_cols = 160.
      ENDIF.
      IF lv_term_rows < 15.
        lv_term_rows = 40.
      ENDIF.

      " Responsive Width logic:
      " - Mobile (< 85 cols): 96% width for touch-friendly full visibility
      " - iPad / Tablet (85 - 130 cols): 92% width centered
      " - Desktop (131 - 210 cols): 90% width centered
      " - 4K / Ultra-wide (> 210 cols): 90% width centered (up to 240 cols)
      IF lv_term_cols < 85.
        " Mobile Phone / RF Terminal: Full width with 1 character safety border
        lv_pop_scol = 2.
        lv_pop_ecol = lv_term_cols - 1.
      ELSEIF lv_term_cols <= 130.
        " iPad / Tablet: 92% width centered
        lv_pop_w    = ( lv_term_cols * 92 ) / 100.
        lv_pop_scol = ( lv_term_cols - lv_pop_w ) / 2.
        IF lv_pop_scol < 2.
          lv_pop_scol = 2.
        ENDIF.
        lv_pop_ecol = lv_pop_scol + lv_pop_w.
      ELSEIF lv_term_cols <= 210.
        " Desktop / Laptop: 90% width centered
        lv_pop_w    = ( lv_term_cols * 90 ) / 100.
        lv_pop_scol = ( lv_term_cols - lv_pop_w ) / 2.
        IF lv_pop_scol < 3.
          lv_pop_scol = 3.
        ENDIF.
        lv_pop_ecol = lv_pop_scol + lv_pop_w.
      ELSE.
        " 4K Screen / Ultra-Wide Monitor: 90% width centered (up to 240 chars)
        lv_pop_w    = ( lv_term_cols * 90 ) / 100.
        IF lv_pop_w > 240.
          lv_pop_w = 240.
        ENDIF.
        lv_pop_scol = ( lv_term_cols - lv_pop_w ) / 2.
        IF lv_pop_scol < 5.
          lv_pop_scol = 5.
        ENDIF.
        lv_pop_ecol = lv_pop_scol + lv_pop_w.
      ENDIF.

      " Responsive Height logic: 90% height centered
      IF lv_term_rows < 25.
        lv_pop_srow = 2.
        lv_pop_erow = lv_term_rows - 1.
      ELSE.
        lv_pop_h    = ( lv_term_rows * 90 ) / 100.
        lv_pop_srow = ( lv_term_rows - lv_pop_h ) / 2.
        IF lv_pop_srow < 2.
          lv_pop_srow = 2.
        ENDIF.
        lv_pop_erow = lv_pop_srow + lv_pop_h.
        IF lv_pop_erow >= lv_term_rows.
          lv_pop_erow = lv_term_rows - 1.
        ENDIF.
      ENDIF.

      " Set dynamic 90% popup screen coordinates
      gr_salv_popup->set_screen_popup(
        start_column = lv_pop_scol
        end_column   = lv_pop_ecol
        start_line   = lv_pop_srow
        end_line     = lv_pop_erow ).

      " Enable interactive row & column selection mode
      DATA(lr_pop_sel) = gr_salv_popup->get_selections( ).
      lr_pop_sel->set_selection_mode( if_salv_c_selection_mode=>row_column ).

      DATA(lr_cols) = gr_salv_popup->get_columns( ).
      lr_cols->set_optimize( abap_true ).

      " Rename & format columns with hotspots for mobile/iPad touch & desktop click
      DATA: lr_col TYPE REF TO cl_salv_column_table.

      TRY.
          lr_col ?= lr_cols->get_column( 'STG_STAT' ).
          lr_col->set_short_text( 'Status' ).
          lr_col->set_medium_text( 'Stock Status' ).
          lr_col->set_long_text( 'Storage & Stock Status' ).
          lr_col->set_cell_type( if_salv_c_cell_type=>hotspot ).
        CATCH cx_salv_not_found.
      ENDTRY.

      TRY.
          lr_col ?= lr_cols->get_column( 'LGPLA' ).
          lr_col->set_short_text( 'Bin Loc' ).
          lr_col->set_medium_text( 'Storage Bin' ).
          lr_col->set_long_text( 'Storage Bin Location' ).
          lr_col->set_cell_type( if_salv_c_cell_type=>hotspot ).
        CATCH cx_salv_not_found.
      ENDTRY.

      TRY.
          lr_col ?= lr_cols->get_column( 'LGTYP' ).
          lr_col->set_short_text( 'Stg Type' ).
          lr_col->set_medium_text( 'Storage Type' ).
          lr_col->set_long_text( 'Storage Type' ).
          lr_col->set_cell_type( if_salv_c_cell_type=>hotspot ).
        CATCH cx_salv_not_found.
      ENDTRY.

      TRY.
          lr_col ?= lr_cols->get_column( 'LTYPT' ).
          lr_col->set_short_text( 'Type Desc' ).
          lr_col->set_medium_text( 'Storage Type Desc' ).
          lr_col->set_long_text( 'Storage Type Description' ).
          lr_col->set_cell_type( if_salv_c_cell_type=>hotspot ).
        CATCH cx_salv_not_found.
      ENDTRY.

      TRY.
          lr_col ?= lr_cols->get_column( 'BIN_POS' ).
          lr_col->set_short_text( 'Bin Pos' ).
          lr_col->set_medium_text( 'Bin Position' ).
          lr_col->set_long_text( 'Bin Position (Shelf Level)' ).
          lr_col->set_cell_type( if_salv_c_cell_type=>hotspot ).
        CATCH cx_salv_not_found.
      ENDTRY.

      TRY.
          lr_col ?= lr_cols->get_column( 'LPTYP' ).
          lr_col->set_short_text( 'Bin Type' ).
          lr_col->set_medium_text( 'Storage Bin Type' ).
          lr_col->set_long_text( 'Storage Bin Type' ).
        CATCH cx_salv_not_found.
      ENDTRY.

      TRY.
          lr_cols->set_color_column( 'T_COLOR' ).
        CATCH cx_salv_data_error.
      ENDTRY.

      TRY.
          lr_col ?= lr_cols->get_column( 'LGBER' ).
          lr_col->set_short_text( 'Section' ).
          lr_col->set_medium_text( 'Stg Section' ).
          lr_col->set_long_text( 'Storage Section' ).
        CATCH cx_salv_not_found.
      ENDTRY.

      TRY.
          lr_col ?= lr_cols->get_column( 'LBERT' ).
          lr_col->set_short_text( 'Sec Name' ).
          lr_col->set_medium_text( 'Section / Color' ).
          lr_col->set_long_text( 'Storage Section Description (Color)' ).
          lr_col->set_cell_type( if_salv_c_cell_type=>hotspot ).
        CATCH cx_salv_not_found.
      ENDTRY.

      TRY.
          lr_col ?= lr_cols->get_column( 'LGNUM' ).
          lr_col->set_short_text( 'Whse' ).
          lr_col->set_medium_text( 'Warehouse' ).
          lr_col->set_long_text( 'Warehouse Number' ).
        CATCH cx_salv_not_found.
      ENDTRY.

      TRY.
          lr_col ?= lr_cols->get_column( 'LGORT' ).
          lr_col->set_short_text( 'SLoc' ).
          lr_col->set_medium_text( 'Storage Loc' ).
          lr_col->set_long_text( 'Storage Location' ).
        CATCH cx_salv_not_found.
      ENDTRY.

      TRY.
          lr_col ?= lr_cols->get_column( 'UNIT_TYPE' ).
          lr_col->set_short_text( 'Unit Type' ).
          lr_col->set_medium_text( 'Unit Category' ).
          lr_col->set_long_text( 'Unit Type (HU or SU)' ).
          lr_col->set_cell_type( if_salv_c_cell_type=>hotspot ).
        CATCH cx_salv_not_found.
      ENDTRY.

      TRY.
          lr_col ?= lr_cols->get_column( 'SUT' ).
          lr_col->set_short_text( 'SUT' ).
          lr_col->set_medium_text( 'Pallet/SUT' ).
          lr_col->set_long_text( 'Storage Unit Type (SUT)' ).
          lr_col->set_cell_type( if_salv_c_cell_type=>hotspot ).
        CATCH cx_salv_not_found.
      ENDTRY.

      TRY.
          lr_col ?= lr_cols->get_column( 'SUT_TX' ).
          lr_col->set_short_text( 'SUT Desc' ).
          lr_col->set_medium_text( 'SUT Description' ).
          lr_col->set_long_text( 'Storage Unit Type Description' ).
        CATCH cx_salv_not_found.
      ENDTRY.

      TRY.
          lr_col ?= lr_cols->get_column( 'EXIDV' ).
          lr_col->set_short_text( 'Unit No' ).
          lr_col->set_medium_text( 'Unit (HU/SU)' ).
          lr_col->set_long_text( 'Unit Number (HU or SU)' ).
          lr_col->set_cell_type( if_salv_c_cell_type=>hotspot ).
        CATCH cx_salv_not_found.
      ENDTRY.

      TRY.
          lr_col ?= lr_cols->get_column( 'VEMNG' ).
          lr_col->set_short_text( 'Avail Qty' ).
          lr_col->set_medium_text( 'Available Qty' ).
          lr_col->set_long_text( 'Available Stock Qty' ).
          lr_col->set_cell_type( if_salv_c_cell_type=>hotspot ).
        CATCH cx_salv_not_found.
      ENDTRY.

      TRY.
          lr_col ?= lr_cols->get_column( 'SERNR' ).
          lr_col->set_short_text( 'Serial No' ).
          lr_col->set_medium_text( 'Serial Number' ).
          lr_col->set_long_text( 'Serial Number' ).
          lr_col->set_cell_type( if_salv_c_cell_type=>hotspot ).
        CATCH cx_salv_not_found.
      ENDTRY.

      TRY.
          lr_col ?= lr_cols->get_column( 'SORT_PRIO' ).
          lr_col->set_visible( abap_false ).
        CATCH cx_salv_not_found.
      ENDTRY.

      " Calculate category counts for header summary
      DATA: lv_en1_cnt  TYPE i,
            lv_inpr_cnt TYPE i,
            lv_hold_cnt TYPE i.
      CLEAR: lv_en1_cnt, lv_inpr_cnt, lv_hold_cnt.

      LOOP AT gt_bin_stock INTO DATA(ls_bs_cnt).
        IF ls_bs_cnt-sort_prio = 1.
          lv_en1_cnt = lv_en1_cnt + 1.
        ELSEIF ls_bs_cnt-sort_prio = 3.
          lv_hold_cnt = lv_hold_cnt + 1.
        ELSE.
          lv_inpr_cnt = lv_inpr_cnt + 1.
        ENDIF.
      ENDLOOP.

      " Title & striped pattern
      DATA(lr_disp) = gr_salv_popup->get_display_settings( ).
      lr_disp->set_striped_pattern( abap_true ).
      IF gs_sel_item-lgort IS NOT INITIAL.
        lr_disp->set_list_header( |@1A@ Whse: { p_whse } \| SLoc: { gs_sel_item-lgort } \| Pref Stg: { gv_pref_stg } - { gs_sel_item-matnr ALPHA = OUT } ({ lines( gt_bin_stock ) } Units/Bins)| ).
      ELSE.
        lr_disp->set_list_header( |@1A@ Whse: { p_whse } \| Pref Stg: { gv_pref_stg } - { gs_sel_item-matnr ALPHA = OUT } ({ lines( gt_bin_stock ) } Units/Bins)| ).
      ENDIF.

      " Enable functions & events
      DATA(lr_funcs) = gr_salv_popup->get_functions( ).
      lr_funcs->set_all( abap_true ).

      DATA(lr_evts) = gr_salv_popup->get_event( ).
      CREATE OBJECT gr_popup_handler.
      SET HANDLER gr_popup_handler->on_link_click FOR lr_evts.
      SET HANDLER gr_popup_handler->on_double_click FOR lr_evts.

      gr_salv_popup->display( ).

    CATCH cx_salv_msg INTO DATA(lx_pop).
      MESSAGE lx_pop->get_text( ) TYPE 'E'.
  ENDTRY.
ENDFORM.

*&---------------------------------------------------------------------*
*& Form: display_visual_rack_popup
*& Description: Renders Visual Pallet Rack Layout with 90% responsiveness
*&              (Ground = B1/01, Middle = B2/02, Top = B3/03)
*&---------------------------------------------------------------------*
FORM display_visual_rack_popup.
  CLEAR gt_visual_rack.

  DATA: lv_b0_cnt TYPE i,
        lv_b1_cnt TYPE i,
        lv_b2_cnt TYPE i,
        lv_b3_cnt TYPE i,
        lv_b4_cnt TYPE i,
        lv_fl_cnt TYPE i.
  CLEAR: lv_b0_cnt, lv_b1_cnt, lv_b2_cnt, lv_b3_cnt, lv_b4_cnt, lv_fl_cnt.

  LOOP AT gt_bin_stock INTO DATA(ls_bs).
    DATA: ls_vis TYPE ty_visual_rack.
    CLEAR ls_vis.

    ls_vis-exidv     = ls_bs-exidv.
    ls_vis-unit_type = ls_bs-unit_type.
    ls_vis-sut       = ls_bs-sut.
    ls_vis-sut_tx    = ls_bs-sut_tx.
    ls_vis-lgpla     = ls_bs-lgpla.
    ls_vis-vemng     = ls_bs-vemng.
    ls_vis-vemeh     = ls_bs-vemeh.
    ls_vis-charg     = ls_bs-charg.
    ls_vis-sernr     = ls_bs-sernr.
    ls_vis-stg_stat  = ls_bs-stg_stat.
    ls_vis-lgtyp     = ls_bs-lgtyp.
    ls_vis-ltypt     = ls_bs-ltypt.
    ls_vis-lgber     = ls_bs-lgber.
    ls_vis-lbert     = ls_bs-lbert.
    ls_vis-lgnum     = ls_bs-lgnum.
    ls_vis-lgort     = ls_bs-lgort.
    ls_vis-sort_prio = ls_bs-sort_prio.
    ls_vis-t_color   = ls_bs-t_color.

    ls_vis-lptyp     = ls_bs-lptyp.

    " Stor. bin type is the bin position (starts from 0 to 6)
    DATA(lv_b_clean) = condense( ls_bs-lgpla ).
    DATA: lv_floor TYPE string,
          lv_rack  TYPE string,
          lv_pos   TYPE string.
    CLEAR: lv_floor, lv_rack, lv_pos.

    IF ls_bs-lptyp IS NOT INITIAL.
      lv_pos = condense( ls_bs-lptyp ).
    ENDIF.

    IF lv_pos IS INITIAL.
      IF lv_b_clean CS '-'.
        SPLIT lv_b_clean AT '-' INTO lv_floor lv_rack lv_pos.
        IF lv_pos IS INITIAL AND lv_rack IS NOT INITIAL.
          lv_pos   = lv_rack.
          lv_rack  = lv_floor.
          lv_floor = '0'.
        ENDIF.
      ELSE.
        DATA(lv_b_len) = strlen( lv_b_clean ).
        IF lv_b_len >= 2.
          DATA(lv_off) = lv_b_len - 2.
          lv_pos   = lv_b_clean+lv_off(2).
          lv_rack  = lv_b_clean(lv_off).
        ELSE.
          lv_pos   = lv_b_clean.
          lv_rack  = lv_b_clean.
        ENDIF.
        lv_floor = '0'.
      ENDIF.
    ENDIF.

    lv_floor = condense( lv_floor ).
    lv_rack  = condense( lv_rack ).
    lv_pos   = condense( lv_pos ).
    TRANSLATE lv_pos TO UPPER CASE.

    CASE lv_pos.
      WHEN '00' OR '0' OR 'B0' OR 'G0'.
        ls_vis-level_code = 'B0'.
        ls_vis-level_id   = '@98@ LEVEL 0 (00 - Ground Bin)'.
        ls_vis-bin_pos    = '00 - Ground Bin (Level 0)'.
        ls_vis-level_num  = 0.
        ls_vis-pallet_vis = |[📦 PALLET @ 00 GROUND]|.
        lv_b0_cnt = lv_b0_cnt + 1.

      WHEN '01' OR '1' OR 'B1'.
        ls_vis-level_code = 'B1'.
        ls_vis-level_id   = '@98@ LEVEL 1 (01 - First Bin)'.
        ls_vis-bin_pos    = '01 - First Bin (Level 1)'.
        ls_vis-level_num  = 1.
        ls_vis-pallet_vis = |[📦 PALLET @ 01 FIRST]|.
        lv_b1_cnt = lv_b1_cnt + 1.

      WHEN '02' OR '2' OR 'B2'.
        ls_vis-level_code = 'B2'.
        ls_vis-level_id   = '@97@ LEVEL 2 (02 - 2nd Bin)'.
        ls_vis-bin_pos    = '02 - 2nd Bin (Level 2)'.
        ls_vis-level_num  = 2.
        ls_vis-pallet_vis = |[📦 PALLET @ 02 SECOND]|.
        lv_b2_cnt = lv_b2_cnt + 1.

      WHEN '03' OR '3' OR 'B3'.
        ls_vis-level_code = 'B3'.
        ls_vis-level_id   = '@96@ LEVEL 3 (03 - Third Bin)'.
        ls_vis-bin_pos    = '03 - Third Bin (Level 3)'.
        ls_vis-level_num  = 3.
        ls_vis-pallet_vis = |[📦 PALLET @ 03 THIRD]|.
        lv_b3_cnt = lv_b3_cnt + 1.

      WHEN '04' OR '4' OR 'B4'.
        ls_vis-level_code = 'B4'.
        ls_vis-level_id   = '@96@ LEVEL 4 (04 - Forth Bin)'.
        ls_vis-bin_pos    = '04 - Forth Bin (Level 4)'.
        ls_vis-level_num  = 4.
        ls_vis-pallet_vis = |[📦 PALLET @ 04 FORTH]|.
        lv_b4_cnt = lv_b4_cnt + 1.

      WHEN '05' OR '5' OR 'B5'.
        ls_vis-level_code = 'B5'.
        ls_vis-level_id   = '@96@ LEVEL 5 (05 - Fifth Bin)'.
        ls_vis-bin_pos    = '05 - Fifth Bin (Level 5)'.
        ls_vis-level_num  = 5.
        ls_vis-pallet_vis = |[📦 PALLET @ 05 FIFTH]|.

      WHEN '06' OR '6' OR 'B6'.
        ls_vis-level_code = 'B6'.
        ls_vis-level_id   = '@96@ LEVEL 6 (06 - Sixth Bin)'.
        ls_vis-bin_pos    = '06 - Sixth Bin (Level 6)'.
        ls_vis-level_num  = 6.
        ls_vis-pallet_vis = |[📦 PALLET @ 06 SIXTH]|.

      WHEN OTHERS.
        DATA: lv_num_pos TYPE i.
        IF lv_pos CO '0123456789 '.
          lv_num_pos = CONV i( lv_pos ).
          IF lv_num_pos >= 11 AND lv_num_pos <= 15.
            ls_vis-level_num = lv_num_pos - 10.
          ELSEIF lv_num_pos >= 6 AND lv_num_pos <= 10.
            ls_vis-level_num = lv_num_pos - 5.
          ELSEIF lv_num_pos >= 1 AND lv_num_pos <= 5.
            ls_vis-level_num = lv_num_pos.
          ELSE.
            ls_vis-level_num = 1.
          ENDIF.
        ELSE.
          ls_vis-level_num = 1.
        ENDIF.
        ls_vis-level_code = |B{ ls_vis-level_num }|.
        ls_vis-level_id   = |@96@ LEVEL { ls_vis-level_num } ({ lv_pos })|.
        ls_vis-bin_pos    = |{ lv_pos } - Level { ls_vis-level_num }|.
        ls_vis-pallet_vis = |[📦 PALLET @ { lv_pos }]|.
        lv_fl_cnt = lv_fl_cnt + 1.
    ENDCASE.

    " Set Actual Storage Bin as rack_ref (remove fake sample R1-S1- codes!)
    ls_vis-rack_ref = ls_vis-lgpla.
    IF lv_floor IS INITIAL OR lv_floor = '0'.
      ls_vis-rack_sec = |Rack { lv_rack }|.
    ELSE.
      ls_vis-rack_sec = |Floor { lv_floor } / Rack { lv_rack }|.
    ENDIF.

    ls_vis-floor_id = |Floor { lv_floor }|.
    ls_vis-rack_num = lv_rack.

    " If Available HU is ZERO, highlight entire line in light orange
    IF ls_vis-vemng <= 0 OR ls_vis-exidv IS INITIAL.
      DATA: ls_v_cell TYPE lvc_s_scol.
      CLEAR ls_v_cell.
      ls_v_cell-fname     = ''. " Entire row
      ls_v_cell-color-col = 3.  " Orange
      ls_v_cell-color-int = 1.  " Intensified (Light Orange)
      ls_v_cell-color-inv = 0.
      ls_v_cell-nokeycol  = abap_true.
      APPEND ls_v_cell TO ls_vis-t_color.
    ENDIF.

    APPEND ls_vis TO gt_visual_rack.
  ENDLOOP.

  " Sort Top-to-Bottom (Level 3 B3 Top -> Level 2 B2 Middle -> Level 1 B1 Ground)
  " Sort Top-to-Bottom (Level 4 Forth -> Level 3 Top -> Level 2 Middle -> Level 1 First -> Level 0 Ground)
  SORT gt_visual_rack BY level_num DESCENDING rack_sec ASCENDING lgpla ASCENDING exidv ASCENDING.

  " Launch the rich HTML Visual Rack Viewer with Swipe & Multi-Rack support!
  PERFORM display_visual_rack_html.
ENDFORM.

*&---------------------------------------------------------------------*
*& Form: display_visual_rack_salv
*& Description: Renders Tabular SALV ALV Grid Popup (Table Grid View)
*&---------------------------------------------------------------------*
FORM display_visual_rack_salv.
  TRY.
      cl_salv_table=>factory(
        IMPORTING
          r_salv_table = gr_salv_vis_popup
        CHANGING
          t_table      = gt_visual_rack ).

      " Responsive 90% Screen Dimensions
      DATA: lv_term_cols TYPE i,
            lv_term_rows TYPE i,
            lv_pop_scol  TYPE i,
            lv_pop_ecol  TYPE i,
            lv_pop_srow  TYPE i,
            lv_pop_erow  TYPE i,
            lv_pop_w     TYPE i,
            lv_pop_h     TYPE i.

      lv_term_cols = sy-scols.
      lv_term_rows = sy-srows.

      IF lv_term_cols < 40.
        lv_term_cols = 160.
      ENDIF.
      IF lv_term_rows < 15.
        lv_term_rows = 40.
      ENDIF.

      IF lv_term_cols < 85.
        lv_pop_scol = 2.
        lv_pop_ecol = lv_term_cols - 1.
      ELSEIF lv_term_cols <= 130.
        lv_pop_w    = ( lv_term_cols * 92 ) / 100.
        lv_pop_scol = ( lv_term_cols - lv_pop_w ) / 2.
        IF lv_pop_scol < 2.
          lv_pop_scol = 2.
        ENDIF.
        lv_pop_ecol = lv_pop_scol + lv_pop_w.
      ELSEIF lv_term_cols <= 210.
        lv_pop_w    = ( lv_term_cols * 90 ) / 100.
        lv_pop_scol = ( lv_term_cols - lv_pop_w ) / 2.
        IF lv_pop_scol < 3.
          lv_pop_scol = 3.
        ENDIF.
        lv_pop_ecol = lv_pop_scol + lv_pop_w.
      ELSE.
        lv_pop_w    = ( lv_term_cols * 90 ) / 100.
        IF lv_pop_w > 240.
          lv_pop_w = 240.
        ENDIF.
        lv_pop_scol = ( lv_term_cols - lv_pop_w ) / 2.
        IF lv_pop_scol < 5.
          lv_pop_scol = 5.
        ENDIF.
        lv_pop_ecol = lv_pop_scol + lv_pop_w.
      ENDIF.

      IF lv_term_rows < 25.
        lv_pop_srow = 2.
        lv_pop_erow = lv_term_rows - 1.
      ELSE.
        lv_pop_h    = ( lv_term_rows * 90 ) / 100.
        lv_pop_srow = ( lv_term_rows - lv_pop_h ) / 2.
        IF lv_pop_srow < 2.
          lv_pop_srow = 2.
        ENDIF.
        lv_pop_erow = lv_pop_srow + lv_pop_h.
        IF lv_pop_erow >= lv_term_rows.
          lv_pop_erow = lv_term_rows - 1.
        ENDIF.
      ENDIF.

      gr_salv_vis_popup->set_screen_popup(
        start_column = lv_pop_scol
        end_column   = lv_pop_ecol
        start_line   = lv_pop_srow
        end_line     = lv_pop_erow ).

      DATA(lr_vis_sel) = gr_salv_vis_popup->get_selections( ).
      lr_vis_sel->set_selection_mode( if_salv_c_selection_mode=>row_column ).

      DATA(lr_cols) = gr_salv_vis_popup->get_columns( ).
      lr_cols->set_optimize( abap_true ).

      TRY.
          lr_cols->set_color_column( 'T_COLOR' ).
        CATCH cx_salv_data_error.
      ENDTRY.

      DATA: lr_col TYPE REF TO cl_salv_column_table.

      TRY.
          lr_col ?= lr_cols->get_column( 'FLOOR_ID' ).
          lr_col->set_visible( abap_false ).
        CATCH cx_salv_not_found.
      ENDTRY.

      TRY.
          lr_col ?= lr_cols->get_column( 'RACK_NUM' ).
          lr_col->set_visible( abap_false ).
        CATCH cx_salv_not_found.
      ENDTRY.

      TRY.
          lr_col ?= lr_cols->get_column( 'LEVEL_ID' ).
          lr_col->set_visible( abap_false ).
        CATCH cx_salv_not_found.
      ENDTRY.

      TRY.
          lr_col ?= lr_cols->get_column( 'PALLET_VIS' ).
          lr_col->set_visible( abap_false ).
        CATCH cx_salv_not_found.
      ENDTRY.

      TRY.
          lr_col ?= lr_cols->get_column( 'LGPLA' ).
          lr_col->set_short_text( 'Actual Bin' ).
          lr_col->set_medium_text( 'Actual Storage Bin' ).
          lr_col->set_long_text( 'Actual Storage Bin (SAP)' ).
          lr_col->set_cell_type( if_salv_c_cell_type=>hotspot ).
        CATCH cx_salv_not_found.
      ENDTRY.

      TRY.
          lr_col ?= lr_cols->get_column( 'RACK_REF' ).
          lr_col->set_visible( abap_false ).
        CATCH cx_salv_not_found.
      ENDTRY.

      TRY.
          lr_col ?= lr_cols->get_column( 'LBERT' ).
          lr_col->set_short_text( 'Sec Name' ).
          lr_col->set_medium_text( 'Section / Color' ).
          lr_col->set_long_text( 'Storage Section Description (Color)' ).
          lr_col->set_cell_type( if_salv_c_cell_type=>hotspot ).
        CATCH cx_salv_not_found.
      ENDTRY.

      TRY.
          lr_col ?= lr_cols->get_column( 'LGBER' ).
          lr_col->set_short_text( 'Section' ).
          lr_col->set_medium_text( 'Stg Section' ).
          lr_col->set_long_text( 'Storage Section Code' ).
        CATCH cx_salv_not_found.
      ENDTRY.

      TRY.
          lr_col ?= lr_cols->get_column( 'BIN_POS' ).
          lr_col->set_visible( abap_false ).
        CATCH cx_salv_not_found.
      ENDTRY.

      TRY.
          lr_col ?= lr_cols->get_column( 'UNIT_TYPE' ).
          lr_col->set_short_text( 'Unit Type' ).
          lr_col->set_medium_text( 'Unit Category' ).
          lr_col->set_long_text( 'Unit Type (HU or SU)' ).
          lr_col->set_cell_type( if_salv_c_cell_type=>hotspot ).
        CATCH cx_salv_not_found.
      ENDTRY.

      TRY.
          lr_col ?= lr_cols->get_column( 'SUT' ).
          lr_col->set_short_text( 'SUT' ).
          lr_col->set_medium_text( 'Pallet/SUT' ).
          lr_col->set_long_text( 'Storage Unit Type (SUT)' ).
          lr_col->set_cell_type( if_salv_c_cell_type=>hotspot ).
        CATCH cx_salv_not_found.
      ENDTRY.

      TRY.
          lr_col ?= lr_cols->get_column( 'SUT_TX' ).
          lr_col->set_short_text( 'SUT Desc' ).
          lr_col->set_medium_text( 'SUT Description' ).
          lr_col->set_long_text( 'Storage Unit Type Description' ).
        CATCH cx_salv_not_found.
      ENDTRY.

      TRY.
          lr_col ?= lr_cols->get_column( 'EXIDV' ).
          lr_col->set_short_text( 'Unit No' ).
          lr_col->set_medium_text( 'Unit (HU/SU)' ).
          lr_col->set_long_text( 'Unit Number (HU or SU)' ).
          lr_col->set_cell_type( if_salv_c_cell_type=>hotspot ).
        CATCH cx_salv_not_found.
      ENDTRY.

      TRY.
          lr_col ?= lr_cols->get_column( 'VEMNG' ).
          lr_col->set_short_text( 'Avail Qty' ).
          lr_col->set_medium_text( 'Available Qty' ).
          lr_col->set_long_text( 'Available Stock Qty' ).
          lr_col->set_cell_type( if_salv_c_cell_type=>hotspot ).
        CATCH cx_salv_not_found.
      ENDTRY.

      TRY.
          lr_col ?= lr_cols->get_column( 'SERNR' ).
          lr_col->set_short_text( 'Serial No' ).
          lr_col->set_medium_text( 'Serial Number' ).
          lr_col->set_long_text( 'Serial Number' ).
          lr_col->set_cell_type( if_salv_c_cell_type=>hotspot ).
        CATCH cx_salv_not_found.
      ENDTRY.

      TRY.
          lr_col ?= lr_cols->get_column( 'STG_STAT' ).
          lr_col->set_short_text( 'Status' ).
          lr_col->set_medium_text( 'Stock Status' ).
          lr_col->set_long_text( 'Storage & Stock Status' ).
          lr_col->set_cell_type( if_salv_c_cell_type=>hotspot ).
        CATCH cx_salv_not_found.
      ENDTRY.

      TRY.
          lr_col ?= lr_cols->get_column( 'RACK_SEC' ).
          lr_col->set_short_text( 'Rack/Bay' ).
          lr_col->set_medium_text( 'Rack & Bay' ).
          lr_col->set_long_text( 'Warehouse Rack & Bay Section' ).
        CATCH cx_salv_not_found.
      ENDTRY.

      TRY.
          lr_cols->get_column( 'FLOOR_ID' )->set_visible( abap_false ).
          lr_cols->get_column( 'RACK_NUM' )->set_visible( abap_false ).
          lr_cols->get_column( 'BIN_POS' )->set_visible( abap_false ).
          lr_cols->get_column( 'LEVEL_ID' )->set_visible( abap_false ).
          lr_cols->get_column( 'PALLET_VIS' )->set_visible( abap_false ).
          lr_cols->get_column( 'RACK_REF' )->set_visible( abap_false ).
          lr_cols->get_column( 'LEVEL_CODE' )->set_visible( abap_false ).
          lr_cols->get_column( 'LEVEL_NUM' )->set_visible( abap_false ).
          lr_cols->get_column( 'SORT_PRIO' )->set_visible( abap_false ).
        CATCH cx_salv_not_found.
      ENDTRY.

      " Position key columns so Actual Bin (colored by section) is leading
      TRY.
          lr_cols->set_column_position( columnname = 'LGPLA' position = 1 ).
          lr_cols->set_column_position( columnname = 'LBERT' position = 2 ).
          lr_cols->set_column_position( columnname = 'LGBER' position = 3 ).
          lr_cols->set_column_position( columnname = 'EXIDV' position = 4 ).
          lr_cols->set_column_position( columnname = 'VEMNG' position = 5 ).
          lr_cols->set_column_position( columnname = 'SERNR' position = 6 ).
          lr_cols->set_column_position( columnname = 'STG_STAT' position = 7 ).
          lr_cols->set_column_position( columnname = 'RACK_SEC' position = 8 ).
        CATCH cx_salv_not_found.
      ENDTRY.

      DATA(lr_disp) = gr_salv_vis_popup->get_display_settings( ).
      lr_disp->set_striped_pattern( abap_true ).
      lr_disp->set_list_header(
        |@1N@ Visual Warehouse Rack Map: { gs_sel_item-matnr } ({ lines( gt_visual_rack ) } Slots)| ).

      DATA(lr_funcs) = gr_salv_vis_popup->get_functions( ).
      lr_funcs->set_all( abap_true ).

      DATA(lr_evts) = gr_salv_vis_popup->get_event( ).
      CREATE OBJECT gr_vis_popup_handler.
      SET HANDLER gr_vis_popup_handler->on_link_click FOR lr_evts.
      SET HANDLER gr_vis_popup_handler->on_double_click FOR lr_evts.

      gr_salv_vis_popup->display( ).

    CATCH cx_salv_msg INTO DATA(lx_vpop).
      MESSAGE lx_vpop->get_text( ) TYPE 'E'.
  ENDTRY.
ENDFORM.

*&---------------------------------------------------------------------*
*& Form: display_visual_rack_html
*& Description: Renders Interactive HTML Visualizer in Dialog Container
*&---------------------------------------------------------------------*
FORM display_visual_rack_html.
  DATA: lv_html TYPE string.
  PERFORM build_visual_rack_html CHANGING lv_html.

  TYPES: ty_line255 TYPE c LENGTH 255.
  DATA: lt_html_tab TYPE STANDARD TABLE OF ty_line255,
        lv_len      TYPE i,
        lv_offset   TYPE i.

  CLEAR lt_html_tab.
  lv_len = strlen( lv_html ).
  lv_offset = 0.
  WHILE lv_offset < lv_len.
    DATA(lv_chunk) = lv_len - lv_offset.
    IF lv_chunk > 255.
      lv_chunk = 255.
    ENDIF.
    APPEND lv_html+lv_offset(lv_chunk) TO lt_html_tab.
    lv_offset = lv_offset + lv_chunk.
  ENDWHILE.

  IF gr_html_rack_container IS BOUND.
    gr_html_rack_container->free( ).
    CLEAR: gr_html_rack_container, gr_html_rack_viewer.
  ENDIF.

  DATA: lv_term_cols TYPE i,
        lv_term_rows TYPE i,
        lv_dlg_w     TYPE i,
        lv_dlg_h     TYPE i,
        lv_dlg_top   TYPE i,
        lv_dlg_left  TYPE i.

  lv_term_cols = sy-scols.
  lv_term_rows = sy-srows.
  IF lv_term_cols < 60. lv_term_cols = 160. ENDIF.
  IF lv_term_rows < 20. lv_term_rows = 45.  ENDIF.

  lv_dlg_w = ( lv_term_cols * 95 ) / 100.
  IF lv_dlg_w > 2600. lv_dlg_w = 2600. ENDIF.
  IF lv_dlg_w < 960.  lv_dlg_w = 960.  ENDIF.

  lv_dlg_h = ( lv_term_rows * 94 ) / 100.
  IF lv_dlg_h > 1800. lv_dlg_h = 1800. ENDIF.
  IF lv_dlg_h < 680.  lv_dlg_h = 680.  ENDIF.

  lv_dlg_left = ( lv_term_cols - lv_dlg_w ) / 2.
  IF lv_dlg_left < 10. lv_dlg_left = 10. ENDIF.
  lv_dlg_top  = 10.

  CREATE OBJECT gr_html_rack_container
    EXPORTING
      width   = lv_dlg_w
      height  = lv_dlg_h
      top     = lv_dlg_top
      left    = lv_dlg_left
      caption = |Warehouse Rack & Bin Visualizer (X-XXXX-XX) - { gs_sel_item-matnr }|.

  CREATE OBJECT gr_html_rack_viewer
    EXPORTING
      parent = gr_html_rack_container.

  DATA: lt_evts TYPE cntl_simple_events,
        ls_evt  TYPE cntl_simple_event.
  CLEAR lt_evts.
  ls_evt-eventid    = cl_gui_html_viewer=>m_id_sapevent.
  ls_evt-appl_event = abap_true.
  APPEND ls_evt TO lt_evts.
  gr_html_rack_viewer->set_registered_events( events = lt_evts ).

  CREATE OBJECT gr_html_rack_handler.
  SET HANDLER gr_html_rack_handler->on_sapevent FOR gr_html_rack_viewer.
  SET HANDLER gr_html_rack_handler->on_close FOR gr_html_rack_container.

  DATA: lv_url TYPE c LENGTH 255.
  gr_html_rack_viewer->load_data(
    EXPORTING
      type         = 'text'
      subtype      = 'html'
    IMPORTING
      assigned_url = lv_url
    CHANGING
      data_table   = lt_html_tab ).

  gr_html_rack_viewer->show_url( url = lv_url ).
ENDFORM.

*&---------------------------------------------------------------------*
*& Form: handle_html_rack_event
*& Description: Handles SAPEVENT from HTML Visualizer (Pick HU, Switch ALV)
*&---------------------------------------------------------------------*
FORM handle_html_rack_event USING iv_action TYPE c iv_getdata TYPE c.
  IF iv_action = 'PICK_HU'.
    DATA: lv_picked_hu TYPE vekp-exidv.
    IF iv_getdata CS '='.
      SPLIT iv_getdata AT '=' INTO DATA(lv_k) DATA(lv_v).
      lv_picked_hu = lv_v.
    ELSE.
      lv_picked_hu = iv_getdata.
    ENDIF.

    IF lv_picked_hu IS NOT INITIAL AND NOT ( lv_picked_hu CP 'None*' ).
      p_exidv = lv_picked_hu.
      PERFORM close_html_rack_dialog.
      PERFORM validate_handling_unit.

      DATA: lt_dynp TYPE STANDARD TABLE OF dynpread,
            ls_dynp TYPE dynpread.
      CLEAR ls_dynp.
      ls_dynp-fieldname  = 'P_EXIDV'.
      ls_dynp-fieldvalue = p_exidv.
      APPEND ls_dynp TO lt_dynp.

      CLEAR ls_dynp.
      ls_dynp-fieldname  = 'P_UTYP'.
      ls_dynp-fieldvalue = p_utyp.
      APPEND ls_dynp TO lt_dynp.

      CLEAR ls_dynp.
      ls_dynp-fieldname  = 'P_SUT'.
      ls_dynp-fieldvalue = p_sut.
      APPEND ls_dynp TO lt_dynp.

      CLEAR ls_dynp.
      ls_dynp-fieldname  = 'P_SUT_TX'.
      ls_dynp-fieldvalue = p_sut_tx.
      APPEND ls_dynp TO lt_dynp.

      CLEAR ls_dynp.
      ls_dynp-fieldname  = 'P_HUSER'.
      ls_dynp-fieldvalue = p_huser.
      APPEND ls_dynp TO lt_dynp.

      CLEAR ls_dynp.
      ls_dynp-fieldname  = 'P_HUQTY'.
      ls_dynp-fieldvalue = |{ p_huqty }|.
      APPEND ls_dynp TO lt_dynp.

      CLEAR ls_dynp.
      ls_dynp-fieldname  = 'P_HUBAT'.
      ls_dynp-fieldvalue = p_hubat.
      APPEND ls_dynp TO lt_dynp.

      CLEAR ls_dynp.
      ls_dynp-fieldname  = 'P_FRLOC'.
      ls_dynp-fieldvalue = p_frloc.
      APPEND ls_dynp TO lt_dynp.

      CLEAR ls_dynp.
      ls_dynp-fieldname  = 'P_PSTG'.
      ls_dynp-fieldvalue = p_pstg.
      APPEND ls_dynp TO lt_dynp.

      CLEAR ls_dynp.
      ls_dynp-fieldname  = 'P_TQTY'.
      ls_dynp-fieldvalue = |{ p_tqty }|.
      APPEND ls_dynp TO lt_dynp.

      CALL FUNCTION 'DYNP_VALUES_UPDATE'
        EXPORTING
          dyname     = sy-repid
          dynumb     = '2000'
        TABLES
          dynpfields = lt_dynp
        EXCEPTIONS
          OTHERS     = 0.

      MESSAGE |Selected { gv_unit_type } { p_exidv } (SUT: { p_sut }) from Visual Rack!| TYPE 'S'.
    ELSE.
      MESSAGE 'Selected slot is unoccupied (0 Available HU).' TYPE 'I'.
    ENDIF.

  ELSEIF iv_action = 'SWITCH_ALV'.
    PERFORM close_html_rack_dialog.
    PERFORM display_visual_rack_salv.

  ELSEIF iv_action = 'CLOSE'.
    PERFORM close_html_rack_dialog.
  ENDIF.
ENDFORM.

*&---------------------------------------------------------------------*
*& Form: close_html_rack_dialog
*& Description: Closes and frees the HTML dialogbox container
*&---------------------------------------------------------------------*
FORM close_html_rack_dialog.
  IF gr_html_rack_container IS BOUND.
    gr_html_rack_container->free( ).
    CLEAR: gr_html_rack_container, gr_html_rack_viewer.
  ENDIF.
ENDFORM.

*&---------------------------------------------------------------------*
*& Form: build_visual_rack_html
*& Description: Generates Dynamic HTML Visualizer with Swipe & Multi-Rack
*&---------------------------------------------------------------------*
*& Form: build_visual_rack_html
*& Description: Generates Dynamic 10-Bin Visualizer (5 Levels x 2 Bays)
*&              with Zero Excess Margin & Unique Bin IDs per Bay
*&---------------------------------------------------------------------*
FORM build_visual_rack_html CHANGING cv_html TYPE string.
  TYPES: BEGIN OF ty_stg_opt,
           lgtyp TYPE lqua-lgtyp,
           ltypt TYPE t301t-ltypt,
         END OF ty_stg_opt.
  TYPES: ty_rack_id TYPE c LENGTH 15.
  TYPES: BEGIN OF ty_slot_data,
           slot_key  TYPE string,
           lvl_num   TYPE i,
           bay_col   TYPE i,
           bin_id    TYPE lagp-lgpla,
           has_stock TYPE abap_bool,
           items     TYPE STANDARD TABLE OF ty_visual_rack WITH DEFAULT KEY,
         END OF ty_slot_data.
  TYPES: BEGIN OF ty_rack_bin,
           lgpla     TYPE lagp-lgpla,
           level_num TYPE i,
         END OF ty_rack_bin.

  DATA: lt_h                 TYPE STANDARD TABLE OF string,
        lv_clean_maktx       TYPE string,
        lt_distinct_stgtypes TYPE STANDARD TABLE OF ty_stg_opt,
        ls_new_stg           TYPE ty_stg_opt,
        lt_distinct_racks    TYPE STANDARD TABLE OF ty_rack_id,
        lt_slots             TYPE STANDARD TABLE OF ty_slot_data WITH KEY slot_key,
        lt_rack_bins         TYPE STANDARD TABLE OF ty_rack_bin.

  CLEAR lt_h.
  CLEAR lt_distinct_stgtypes.
  CLEAR lt_distinct_racks.
  CLEAR lt_slots.
  CLEAR lt_rack_bins.

  " Clean material description for safe JS
  lv_clean_maktx = gs_sel_item-maktx.
  REPLACE ALL OCCURRENCES OF `\` IN lv_clean_maktx WITH `\\`.
  REPLACE ALL OCCURRENCES OF `"` IN lv_clean_maktx WITH `\"`.
  REPLACE ALL OCCURRENCES OF `'` IN lv_clean_maktx WITH `\'`.

  " 1. Identify distinct warehouse storage types from active stock
  LOOP AT gt_bin_stock INTO DATA(ls_stg_scan).
    IF ls_stg_scan-lgtyp IS NOT INITIAL.
      READ TABLE lt_distinct_stgtypes WITH KEY lgtyp = ls_stg_scan-lgtyp TRANSPORTING NO FIELDS.
      IF sy-subrc <> 0.
        CLEAR ls_new_stg.
        ls_new_stg-lgtyp = ls_stg_scan-lgtyp.
        ls_new_stg-ltypt = ls_stg_scan-ltypt.
        APPEND ls_new_stg TO lt_distinct_stgtypes.
      ENDIF.
    ENDIF.
  ENDLOOP.
  IF lt_distinct_stgtypes IS INITIAL AND gv_pref_stg IS NOT INITIAL.
    CLEAR ls_new_stg.
    ls_new_stg-lgtyp = gv_pref_stg.
    ls_new_stg-ltypt = |Preferred Strategy ({ gv_pref_stg })|.
    APPEND ls_new_stg TO lt_distinct_stgtypes.
  ENDIF.

  " 1b. Identify distinct warehouse racks from visual rack records
  LOOP AT gt_visual_rack INTO DATA(ls_r_scan).
    IF ls_r_scan-rack_num IS NOT INITIAL.
      READ TABLE lt_distinct_racks WITH KEY table_line = ls_r_scan-rack_num
        TRANSPORTING NO FIELDS.
      IF sy-subrc <> 0.
        APPEND ls_r_scan-rack_num TO lt_distinct_racks.
      ENDIF.
    ENDIF.
  ENDLOOP.
  IF lt_distinct_racks IS INITIAL.
    IF gv_pref_stg IS NOT INITIAL.
      APPEND gv_pref_stg TO lt_distinct_racks.
    ELSE.
      APPEND 'RACK-01' TO lt_distinct_racks.
    ENDIF.
  ENDIF.
  DATA(lv_num_racks) = lines( lt_distinct_racks ).

  " 2. HTML Header & Inlined CSS
  APPEND '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">' TO lt_h.
  APPEND '<title>Warehouse Rack & Bin Visualizer (10 Bins per Rack)</title><style>' TO lt_h.
  APPEND '* { box-sizing: border-box; margin: 0; padding: 0;' TO lt_h.
  APPEND '  touch-action: pan-y; -webkit-tap-highlight-color: transparent; }' TO lt_h.
  APPEND 'body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;' TO lt_h.
  APPEND '  background: #eef2f6; color: #1e293b; height: 100vh; display: flex;' TO lt_h.
  APPEND '  flex-direction: column; overflow: hidden; user-select: none; }' TO lt_h.
  APPEND '#top-bar { background: #ffffff; border-bottom: 1px solid #e2e8f0; padding: 8px 20px;' TO lt_h.
  APPEND '  display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-shrink: 0; }' TO lt_h.
  APPEND '.title-group { display: flex; align-items: center; gap: 10px; }' TO lt_h.
  APPEND '.title-badge { background: #2563eb; color: #ffffff; padding: 3px 8px;' TO lt_h.
  APPEND '  border-radius: 4px; font-size: 11px; font-weight: 700; font-family: monospace; }' TO lt_h.
  APPEND '.nav-controls { display: flex; align-items: center; gap: 8px; }' TO lt_h.
  APPEND '.btn-nav { background: #ffffff; color: #1e293b; border: 1px solid #cbd5e1;' TO lt_h.
  APPEND '  padding: 6px 14px; border-radius: 6px; font-size: 12px; font-weight: 700;' TO lt_h.
  APPEND '  cursor: pointer; transition: all 0.15s; }' TO lt_h.
  APPEND '.btn-nav:hover { background: #f8fafc; border-color: #94a3b8; }' TO lt_h.
  APPEND '.btn-nav:disabled { opacity: 0.4; cursor: not-allowed; }' TO lt_h.
  APPEND '.btn-switch { background: #f1f5f9; color: #334155; border: 1px solid #cbd5e1;' TO lt_h.
  APPEND '  padding: 6px 12px; border-radius: 6px; font-size: 11px; font-weight: 600;' TO lt_h.
  APPEND '  text-decoration: none; cursor: pointer; }' TO lt_h.
  APPEND '.btn-close { background: #ef4444; color: #ffffff; border: none; padding: 6px 14px;' TO lt_h.
  APPEND '  border-radius: 6px; font-size: 11px; font-weight: 700; text-decoration: none; cursor: pointer; }' TO lt_h.
  APPEND '.app-container { display: flex; flex: 1; gap: 16px; padding: 12px 20px 14px 20px;' TO lt_h.
  APPEND '  overflow: hidden; min-height: 0; }' TO lt_h.

  " Left Rack Card Styling
  APPEND '.rack-card { flex: 1; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px;' TO lt_h.
  APPEND '  padding: 12px 18px 10px 18px; display: flex; flex-direction: column; position: relative;' TO lt_h.
  APPEND '  box-shadow: 0 4px 20px rgba(0,0,0,0.03); overflow: hidden; min-height: 0; }' TO lt_h.
  APPEND '.rack-header { display: flex; justify-content: space-between; align-items: center;' TO lt_h.
  APPEND '  margin-bottom: 8px; flex-shrink: 0; gap: 10px; }' TO lt_h.
  APPEND '.model-tag { font-size: 11px; font-weight: 700; color: #64748b; display: flex;' TO lt_h.
  APPEND '  align-items: center; gap: 8px; flex-shrink: 0; }' TO lt_h.
  APPEND '.model-badge { background: #f1f5f9; color: #334155; padding: 3px 10px; border-radius: 4px;' TO lt_h.
  APPEND '  font-family: monospace; font-size: 11px; }' TO lt_h.
  APPEND '.rack-slider-container { display: flex; align-items: center; gap: 8px; background: #f1f5f9;' TO lt_h.
  APPEND '  border: 1px solid #cbd5e1; padding: 4px 10px; border-radius: 20px; box-shadow: inset 0 1px 2px rgba(0,0,0,0.03); }' TO lt_h.
  APPEND '.rack-slider-label { font-size: 9.5px; font-weight: 800; color: #334155; letter-spacing: 0.5px;' TO lt_h.
  APPEND '  text-transform: uppercase; display: flex; align-items: center; gap: 4px; white-space: nowrap; }' TO lt_h.
  APPEND '.slider-nav-btn { background: #ffffff; border: 1px solid #cbd5e1; color: #1e293b; width: 20px;' TO lt_h.
  APPEND '  height: 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center;' TO lt_h.
  APPEND '  font-size: 9px; cursor: pointer; transition: all 0.15s; }' TO lt_h.
  APPEND '.slider-nav-btn:hover { background: #2563eb; color: #ffffff; border-color: #2563eb; }' TO lt_h.
  APPEND '.rack-range-slider { -webkit-appearance: none; appearance: none; width: 120px; height: 5px;' TO lt_h.
  APPEND '  border-radius: 3px; background: #cbd5e1; outline: none; cursor: pointer; }' TO lt_h.
  APPEND '.rack-chip-track { display: flex; gap: 3px; }' TO lt_h.
  APPEND '.rack-chip { background: #ffffff; color: #475569; border: 1px solid #cbd5e1; padding: 2px 7px;' TO lt_h.
  APPEND '  border-radius: 10px; font-size: 9.5px; font-weight: 700; font-family: monospace; cursor: pointer;' TO lt_h.
  APPEND '  transition: all 0.15s; white-space: nowrap; }' TO lt_h.
  APPEND '.rack-chip:hover { background: #e0f2fe; color: #0284c7; border-color: #38bdf8; }' TO lt_h.
  APPEND '.rack-chip.active { background: #2563eb; color: #ffffff; border-color: #2563eb; }' TO lt_h.
  APPEND '.storage-type-wrap { display: flex; align-items: center; gap: 6px; background: #f8fafc;' TO lt_h.
  APPEND '  border: 1px solid #cbd5e1; padding: 3px 8px; border-radius: 6px; }' TO lt_h.
  APPEND '.storage-type-wrap label { font-size: 11px; font-weight: 700; color: #475569; white-space: nowrap; }' TO lt_h.
  APPEND '.storage-type-select { background: #ffffff; border: 1px solid #94a3b8; border-radius: 4px;' TO lt_h.
  APPEND '  font-size: 11px; font-weight: 700; color: #0f172a; padding: 2px 6px; cursor: pointer; outline: none; }' TO lt_h.
  APPEND '.rack-hint { font-size: 10.5px; font-style: italic; color: #94a3b8; white-space: nowrap; }' TO lt_h.

  " 3 Blue Uprights & Bays (Stretches vertically - 0 free space)
  APPEND '.rack-stage { display: flex; justify-content: center; align-items: stretch; margin: 0;' TO lt_h.
  APPEND '  position: relative; flex: 1; min-height: 0; padding: 0; overflow-y: auto; overflow-x: hidden; }' TO lt_h.
  APPEND '.upright-post { display: none !important; }' TO lt_h.
  APPEND '.rack-bays-wrapper { flex: 1; display: flex; flex-direction: column; gap: 6px; padding: 0 4px;' TO lt_h.
  APPEND '  width: 100%; max-width: 100%; min-height: 0; }' TO lt_h.
  APPEND '.tier-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; flex-grow: 1;' TO lt_h.
  APPEND '  flex-shrink: 0; min-height: 84px; margin-bottom: 2px; }' TO lt_h.
  APPEND '.bay-column { display: flex; flex-direction: column; min-height: 84px; height: 100%;' TO lt_h.
  APPEND '  justify-content: flex-end; }' TO lt_h.

  " Section Boxes (1 Bay = 1 Bin)
  APPEND '.section-box { border-radius: 6px 6px 0 0; padding: 4px 8px; display: flex;' TO lt_h.
  APPEND '  flex-direction: column; cursor: pointer; transition: all 0.15s;' TO lt_h.
  APPEND '  border: 2px solid transparent; border-bottom: none; flex: 1; min-height: 60px;' TO lt_h.
  APPEND '  justify-content: space-between; }' TO lt_h.
  APPEND '.section-box:hover { transform: translateY(-1px); box-shadow: 0 4px 10px rgba(0,0,0,0.08); }' TO lt_h.
  APPEND '.section-box.active-slot { box-shadow: 0 0 0 3px rgba(37,99,235,0.4), 0 6px 16px ' TO lt_h.
  APPEND 'rgba(0,0,0,0.12) !important; }' TO lt_h.
  APPEND '.zone-pink { background: #fdf2f8; border-color: #f472b6; }' TO lt_h.
  APPEND '.zone-green { background: #f0fdf4; border-color: #4ade80; }' TO lt_h.
  APPEND '.zone-blue { background: #f0f9ff; border-color: #38bdf8; }' TO lt_h.
  APPEND '.zone-orange { background: #fff7ed; border-color: #fb923c; }' TO lt_h.
  APPEND '.zone-empty { background: #f8fafc; border: 1.5px dashed #cbd5e1; border-bottom: none; }' TO lt_h.

  APPEND '.zone-badge-bar { display: flex; align-items: center; justify-content: space-between;' TO lt_h.
  APPEND '  font-size: 9px; font-weight: 800; letter-spacing: 0.5px; text-transform: uppercase;' TO lt_h.
  APPEND '  margin-bottom: 2px; line-height: 1; }' TO lt_h.
  APPEND '.badge-pink { color: #db2777; } .badge-green { color: #16a34a; }' TO lt_h.
  APPEND '.badge-blue { color: #0284c7; } .badge-orange { color: #ea580c; } .badge-empty { color: #94a3b8; }' TO lt_h.

  " Pallets & Cartons
  APPEND '.pallets-pair { display: flex; gap: 6px; align-items: flex-end; flex: 1; min-height: 0; }' TO lt_h.
  APPEND '.pallet-cargo { flex: 1; display: flex; flex-direction: column; min-height: 0; }' TO lt_h.
  APPEND '.cargo-carton { min-height: 38px; height: 100%; max-height: 48px; border-radius: 4px;' TO lt_h.
  APPEND '  padding: 3px 6px; display: flex; flex-direction: column; justify-content: space-between;' TO lt_h.
  APPEND '  position: relative; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }' TO lt_h.
  APPEND '.carton-pink { background: linear-gradient(180deg, #fbcfe8 0%, #f472b6 100%); border: 1px ' TO lt_h.
  APPEND 'solid #ec4899; color: #831843; }' TO lt_h.
  APPEND '.carton-green { background: linear-gradient(180deg, #bbf7d0 0%, #86efac 100%); border: 1px ' TO lt_h.
  APPEND 'solid #4ade80; color: #14532d; }' TO lt_h.
  APPEND '.carton-blue { background: linear-gradient(180deg, #bae6fd 0%, #7dd3fc 100%); border: 1px ' TO lt_h.
  APPEND 'solid #38bdf8; color: #0c4a6e; }' TO lt_h.
  APPEND '.carton-orange { background: linear-gradient(180deg, #fed7aa 0%, #fdba74 100%); border: 1px ' TO lt_h.
  APPEND 'solid #fb923c; color: #7c2d12; }' TO lt_h.
  APPEND '.carton-empty { background: #f1f5f9; border: 1px dashed #cbd5e1; color: #94a3b8;' TO lt_h.
  APPEND '  min-height: 38px; height: 100%; max-height: 48px; display: flex; align-items: center;' TO lt_h.
  APPEND '  justify-content: center; font-size: 9px; font-weight: 700; }' TO lt_h.
  APPEND '.carton-header { display: flex; justify-content: space-between; font-size: 7.5px;' TO lt_h.
  APPEND '  font-weight: 700; opacity: 0.8; line-height: 1; }' TO lt_h.
  APPEND '.carton-title { font-size: 9.5px; font-weight: 800; text-align: center; font-family: monospace;' TO lt_h.
  APPEND '  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }' TO lt_h.
  APPEND '.carton-footer { display: flex; justify-content: space-between; align-items: flex-end;' TO lt_h.
  APPEND '  font-size: 7.5px; font-weight: 700; line-height: 1; }' TO lt_h.
  APPEND '.sku-pill { background: rgba(255,255,255,0.7); padding: 1px 3px; border-radius: 2px;' TO lt_h.
  APPEND '  font-size: 7.5px; font-weight: 800; }' TO lt_h.

  APPEND '.pallet-wood { width: 100%; margin-top: 1px; }' TO lt_h.
  APPEND '.pallet-slat { height: 3px; background: #c48b57; width: 100%; border-radius: 1px; }' TO lt_h.
  APPEND '.pallet-runners { height: 4px; display: flex; justify-content: space-between; padding: 0 4px; }' TO lt_h.
  APPEND '.runner-block { width: 8px; height: 100%; background: #854d0e; }' TO lt_h.

  " Storage Section Colour-Coded Step Beam
  APPEND '.step-beam { background: linear-gradient(180deg, #f472b6 0%, #ec4899 55%, #db2777 100%);' TO lt_h.
  APPEND '  height: 20px; border-radius: 0 0 3px 3px; margin-top: 0; display: flex; align-items: center;' TO lt_h.
  APPEND '  justify-content: space-between; padding: 0 6px; font-family: monospace; font-size: 9px;' TO lt_h.
  APPEND '  font-weight: 800; color: #ffffff; box-shadow: 0 2px 4px rgba(219,39,119,0.25); position: relative;' TO lt_h.
  APPEND '  z-index: 5; flex-shrink: 0; cursor: pointer; transition: filter 0.15s; }' TO lt_h.
  APPEND '.step-beam:hover { filter: brightness(1.08); }' TO lt_h.
  APPEND '.beam-bin-tag { background: #ffffff; color: #0f172a; padding: 1px 6px; border-radius: 2px;' TO lt_h.
  APPEND '  font-size: 8.5px; font-weight: 800; letter-spacing: 0.3px; cursor: pointer; transition: all 0.15s; }' TO lt_h.
  APPEND '.beam-bin-tag:hover { background: #ffffff; color: #0284c7; box-shadow: 0 1px 3px rgba(0,0,0,0.2); }' TO lt_h.
  APPEND '.beam-level-label { font-size: 8px; color: #ffffff; font-weight: 700; text-shadow: 0 1px 1px rgba(0,0,0,0.2); }' TO lt_h.
  APPEND '.beam-pink { background: linear-gradient(180deg, #f472b6 0%, #ec4899 55%, #db2777 100%) !important; }' TO lt_h.
  APPEND '.beam-pink .beam-bin-tag { color: #be185d; }' TO lt_h.
  APPEND '.beam-blue { background: linear-gradient(180deg, #38bdf8 0%, #0284c7 55%, #0369a1 100%) !important;' TO lt_h.
  APPEND '  box-shadow: 0 2px 4px rgba(2,132,199,0.25) !important; }' TO lt_h.
  APPEND '.beam-blue .beam-bin-tag { color: #0369a1; }' TO lt_h.
  APPEND '.beam-green { background: linear-gradient(180deg, #4ade80 0%, #16a34a 55%, #15803d 100%) !important;' TO lt_h.
  APPEND '  box-shadow: 0 2px 4px rgba(22,163,74,0.25) !important; }' TO lt_h.
  APPEND '.beam-green .beam-bin-tag { color: #15803d; }' TO lt_h.
  APPEND '.beam-orange { background: linear-gradient(180deg, #fb923c 0%, #ea580c 55%, #c2410c 100%) !important;' TO lt_h.
  APPEND '  box-shadow: 0 2px 4px rgba(234,88,12,0.25) !important; }' TO lt_h.
  APPEND '.beam-orange .beam-bin-tag { color: #c2410c; }' TO lt_h.

  " Footer & Legend
  APPEND '.rack-footer-legend { display: flex; justify-content: space-between; align-items: center;' TO lt_h.
  APPEND '  margin-top: 6px; padding-top: 6px; border-top: 1px solid #f1f5f9; font-size: 10px;' TO lt_h.
  APPEND '  color: #64748b; flex-shrink: 0; }' TO lt_h.
  APPEND '.legend-items { display: flex; gap: 12px; }' TO lt_h.
  APPEND '.legend-item { display: flex; align-items: center; gap: 5px; }' TO lt_h.
  APPEND '.dot-blue { width: 7px; height: 7px; border-radius: 50%; background: #2563eb; }' TO lt_h.
  APPEND '.dot-yellow { width: 7px; height: 7px; border-radius: 50%; background: #eab308; }' TO lt_h.
  APPEND '.dot-wood { width: 7px; height: 7px; border-radius: 50%; background: #c48b57; }' TO lt_h.

  " Sidebar Cards
  APPEND '.sidebar-right { width: 360px; display: flex; flex-direction: column; gap: 12px; flex-shrink: 0;' TO lt_h.
  APPEND '  overflow-y: auto; max-height: 100%; }' TO lt_h.
  APPEND '.info-card { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px;' TO lt_h.
  APPEND '  padding: 14px 18px; box-shadow: 0 4px 20px rgba(0,0,0,0.03); display: flex;' TO lt_h.
  APPEND '  flex-direction: column; gap: 8px; flex-shrink: 0; }' TO lt_h.
  APPEND '.info-header { display: flex; justify-content: space-between; align-items: flex-start;' TO lt_h.
  APPEND '  border-bottom: 1px solid #f1f5f9; padding-bottom: 8px; }' TO lt_h.
  APPEND '.slot-heading { font-size: 14px; font-weight: 800; color: #0f172a; }' TO lt_h.
  APPEND '.slot-subheading { font-size: 11px; color: #64748b; margin-top: 1px; }' TO lt_h.
  APPEND '.section-pill-tag { font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 12px; }' TO lt_h.
  APPEND '.pill-green { background: #dcfce7; color: #15803d; }' TO lt_h.
  APPEND '.pill-blue { background: #e0f2fe; color: #0369a1; }' TO lt_h.
  APPEND '.pill-pink { background: #fce7f3; color: #be185d; }' TO lt_h.
  APPEND '.pill-orange { background: #ffedd5; color: #c2410c; }' TO lt_h.
  APPEND '.pill-empty { background: #f1f5f9; color: #64748b; }' TO lt_h.
  APPEND '.prop-row { display: flex; justify-content: space-between; font-size: 11px; padding: 2px 0; }' TO lt_h.
  APPEND '.prop-label { color: #64748b; }' TO lt_h.
  APPEND '.prop-val { font-weight: 700; color: #0f172a; font-family: monospace; text-align: right; }' TO lt_h.
  APPEND '.btn-select-hu { background: linear-gradient(135deg, #16a34a 0%, #15803d 100%); color: #ffffff;' TO lt_h.
  APPEND '  padding: 8px 14px; border-radius: 6px; font-size: 12px; font-weight: 800; text-align: center;' TO lt_h.
  APPEND '  text-decoration: none; display: block; box-shadow: 0 3px 8px rgba(22,163,74,0.3);' TO lt_h.
  APPEND '  margin-top: 4px; cursor: pointer; }' TO lt_h.
  APPEND '.btn-select-hu:hover { background: #15803d; }' TO lt_h.

  APPEND '.color-ref-title { font-size: 10px; font-weight: 800; letter-spacing: 0.5px;' TO lt_h.
  APPEND '  text-transform: uppercase; color: #64748b; margin-bottom: 2px; }' TO lt_h.
  APPEND '.color-ref-row { display: flex; justify-content: space-between; align-items: center;' TO lt_h.
  APPEND '  padding: 5px 10px; border-radius: 6px; font-size: 11px; font-weight: 700; margin-bottom: 3px; }' TO lt_h.
  APPEND '.color-ref-row:last-child { margin-bottom: 0; }' TO lt_h.
  APPEND '.ref-pink { background: #fdf2f8; color: #be185d; border: 1px solid #fbcfe8; }' TO lt_h.
  APPEND '.ref-green { background: #f0fdf4; color: #15803d; border: 1px solid #bbf7d0; }' TO lt_h.
  APPEND '.ref-blue { background: #f0f9ff; color: #0369a1; border: 1px solid #bae6fd; }' TO lt_h.
  APPEND '.ref-orange { background: #fff7ed; color: #c2410c; border: 1px solid #fed7aa; }' TO lt_h.
  APPEND '.color-indicator { display: flex; align-items: center; gap: 6px; }' TO lt_h.
  APPEND '.color-dot { width: 7px; height: 7px; border-radius: 50%; }' TO lt_h.
  APPEND '.color-dot.pink { background: #db2777; } .color-dot.green { background: #16a34a; }' TO lt_h.
  APPEND '.color-dot.blue { background: #0284c7; } .color-dot.orange { background: #ea580c; }' TO lt_h.
  APPEND '.btn-reset-diagram { background: #2563eb; color: #ffffff; border: none; padding: 7px 12px;' TO lt_h.
  APPEND '  border-radius: 6px; font-size: 11px; font-weight: 700; cursor: pointer; text-align: center;' TO lt_h.
  APPEND '  margin-top: 4px; transition: background 0.15s; }' TO lt_h.
  APPEND '.btn-reset-diagram:hover { background: #1d4ed8; }' TO lt_h.

  APPEND '.swipe-btn { position: absolute; top: 50%; transform: translateY(-50%); width: 32px; height: 32px;' TO lt_h.
  APPEND '  border-radius: 50%; background: #ffffff; border: 1px solid #cbd5e1; color: #2563eb; ' TO lt_h.
  APPEND 'font-size: 18px;' TO lt_h.
  APPEND '  font-weight: bold; display: flex; align-items: center; justify-content: center; cursor: pointer;' TO lt_h.
  APPEND '  box-shadow: 0 4px 10px rgba(0,0,0,0.1); z-index: 25; transition: all 0.15s; }' TO lt_h.
  APPEND '.swipe-btn:hover { background: #2563eb; color: #ffffff; border-color: #2563eb; }' TO lt_h.
  APPEND '.swipe-left { left: 4px; } .swipe-right { right: 4px; }' TO lt_h.

  " 4K TV & Ultra-High Resolution Displays
  APPEND '@media (min-width: 1900px) {' TO lt_h.
  APPEND '  .app-container { gap: 24px; padding: 16px 28px; }' TO lt_h.
  APPEND '  .rack-card { padding: 16px 24px; }' TO lt_h.
  APPEND '  .rack-bays-wrapper { max-width: 1200px; gap: 10px; }' TO lt_h.
  APPEND '  .tier-row { min-height: 105px; gap: 14px; margin-bottom: 4px; }' TO lt_h.
  APPEND '  .bay-column { min-height: 105px; }' TO lt_h.
  APPEND '  .section-box { min-height: 76px; padding: 6px 12px; }' TO lt_h.
  APPEND '  .zone-badge-bar { font-size: 11px; margin-bottom: 4px; }' TO lt_h.
  APPEND '  .cargo-carton { min-height: 52px; max-height: 64px; padding: 6px 10px; }' TO lt_h.
  APPEND '  .carton-empty { min-height: 52px; max-height: 64px; font-size: 11.5px; }' TO lt_h.
  APPEND '  .carton-title { font-size: 12px; }' TO lt_h.
  APPEND '  .step-beam { height: 26px; font-size: 11.5px; padding: 0 10px; }' TO lt_h.
  APPEND '  .beam-bin-tag { font-size: 11px; padding: 2px 8px; }' TO lt_h.
  APPEND '  .beam-level-label { font-size: 10.5px; }' TO lt_h.
  APPEND '  .upright-post { width: 30px; background-size: 15px 22px; }' TO lt_h.
  APPEND '  .sidebar-right { width: 440px; gap: 16px; }' TO lt_h.
  APPEND '  .slot-heading { font-size: 17px; } .slot-subheading { font-size: 12.5px; }' TO lt_h.
  APPEND '  .prop-row { font-size: 13px; padding: 4px 0; }' TO lt_h.
  APPEND '  .btn-select-hu { font-size: 14px; padding: 12px 18px; }' TO lt_h.
  APPEND '  #top-bar { padding: 12px 28px; }' TO lt_h.
  APPEND '  .title-badge { font-size: 13px; padding: 5px 12px; }' TO lt_h.
  APPEND '  .btn-nav { font-size: 14px; padding: 8px 18px; }' TO lt_h.
  APPEND '}' TO lt_h.

  APPEND '@media (min-width: 2800px), (min-height: 1300px) and (min-width: 2000px) {' TO lt_h.
  APPEND '  .app-container { gap: 32px; padding: 24px 36px; }' TO lt_h.
  APPEND '  .rack-card { padding: 22px 32px; }' TO lt_h.
  APPEND '  .rack-bays-wrapper { max-width: 1600px; gap: 14px; }' TO lt_h.
  APPEND '  .tier-row { min-height: 130px; gap: 18px; margin-bottom: 6px; }' TO lt_h.
  APPEND '  .bay-column { min-height: 130px; }' TO lt_h.
  APPEND '  .section-box { min-height: 96px; padding: 8px 16px; }' TO lt_h.
  APPEND '  .zone-badge-bar { font-size: 13px; margin-bottom: 6px; }' TO lt_h.
  APPEND '  .cargo-carton { min-height: 68px; max-height: 85px; padding: 8px 12px; }' TO lt_h.
  APPEND '  .carton-empty { min-height: 68px; max-height: 85px; font-size: 13.5px; }' TO lt_h.
  APPEND '  .carton-title { font-size: 14px; }' TO lt_h.
  APPEND '  .carton-header, .carton-footer { font-size: 10px; }' TO lt_h.
  APPEND '  .sku-pill { font-size: 10px; padding: 2px 6px; }' TO lt_h.
  APPEND '  .step-beam { height: 32px; font-size: 13px; padding: 0 12px; }' TO lt_h.
  APPEND '  .beam-bin-tag { font-size: 12.5px; padding: 3px 10px; }' TO lt_h.
  APPEND '  .beam-level-label { font-size: 12px; }' TO lt_h.
  APPEND '  .upright-post { width: 38px; background-size: 19px 26px; }' TO lt_h.
  APPEND '  .sidebar-right { width: 540px; gap: 20px; }' TO lt_h.
  APPEND '  .slot-heading { font-size: 20px; } .slot-subheading { font-size: 14px; }' TO lt_h.
  APPEND '  .prop-row { font-size: 15px; padding: 5px 0; }' TO lt_h.
  APPEND '  .btn-select-hu { font-size: 16px; padding: 14px 22px; }' TO lt_h.
  APPEND '  #top-bar { padding: 16px 36px; }' TO lt_h.
  APPEND '  .title-badge { font-size: 15px; padding: 6px 14px; }' TO lt_h.
  APPEND '  .btn-nav { font-size: 15px; padding: 10px 22px; }' TO lt_h.
  APPEND '}' TO lt_h.
  APPEND '</style></head><body>' TO lt_h.

  " 3. Top Action Bar
  APPEND '<div id="top-bar">' TO lt_h.
  APPEND '<div class="title-group">' TO lt_h.
  APPEND |<span class="title-badge">MATERIAL { gs_sel_item-matnr ALPHA = OUT }</span>| TO lt_h.
  APPEND |<span style="font-weight:700; font-size:13px; color:#0f172a;">{ lv_clean_maktx }</span>| TO lt_h.
  APPEND '<span style="background:#e0f2fe; color:#0369a1; padding:2px 8px; border-radius:12px; ' TO lt_h.
  APPEND 'font-size:10px; font-weight:700; font-family:monospace;" id="rack-counter">' TO lt_h.
  APPEND |Rack 1 of { lv_num_racks }</span>| TO lt_h.
  APPEND '</div>' TO lt_h.

  " Storage Type Selector (Dynamic based on gt_bin_stock)
  APPEND '<div class="storage-type-wrap">' TO lt_h.
  APPEND '<label for="sel-storage-type">Storage Type:</label>' TO lt_h.
  APPEND '<select id="sel-storage-type" class="storage-type-select" onchange="onStorageTypeChange(this.value)">' TO lt_h.
  APPEND '<option value="ALL">📦 All Storage Types</option>' TO lt_h.
  LOOP AT lt_distinct_stgtypes INTO DATA(ls_stg_opt).
    DATA(lv_sel_opt) = COND string( WHEN ls_stg_opt-lgtyp = gv_pref_stg THEN ' selected' ELSE '' ).
    APPEND |<option value="{ ls_stg_opt-lgtyp }"{ lv_sel_opt }>{ ls_stg_opt-lgtyp } - { ls_stg_opt-ltypt }</option>| TO lt_h.
  ENDLOOP.
  APPEND '</select></div>' TO lt_h.

  APPEND '<div class="nav-controls">' TO lt_h.
  APPEND '<button class="btn-nav" id="btn-prev" onclick="prevRack()">◀ Prev Rack</button>' TO lt_h.
  APPEND '<button class="btn-nav" id="btn-next" onclick="nextRack()">Next Rack ▶</button>' TO lt_h.
  APPEND '<a href="sapevent:SWITCH_ALV" class="btn-switch">📋 Table Grid</a>' TO lt_h.
  APPEND '<a href="sapevent:CLOSE" class="btn-close">✕ Close</a>' TO lt_h.
  APPEND '</div>' TO lt_h.
  APPEND '</div>' TO lt_h.

  " 4. Main App Container
  APPEND '<div class="app-container">' TO lt_h.

  " Left Rack Card (10 Bins in 1 Rack: 5 Levels x 2 Bays)
  APPEND '<div class="rack-card">' TO lt_h.
  APPEND '<button class="swipe-btn swipe-left" onclick="prevRack()">‹</button>' TO lt_h.
  APPEND '<button class="swipe-btn swipe-right" onclick="nextRack()">›</button>' TO lt_h.

  " Determine Primary Rack to display
  READ TABLE lt_distinct_racks INTO DATA(lv_cur_rack) INDEX 1.
  IF lv_cur_rack IS INITIAL.
    lv_cur_rack = 'RACK-01'.
  ENDIF.

  DATA: lv_cur_floor TYPE string VALUE '1'.
  LOOP AT gt_visual_rack INTO DATA(ls_fl_scan) WHERE rack_num = lv_cur_rack.
    IF ls_fl_scan-floor_id CS 'Floor '.
      SPLIT ls_fl_scan-floor_id AT 'Floor ' INTO DATA(lv_dummy) lv_cur_floor.
      lv_cur_floor = condense( lv_cur_floor ).
      EXIT.
    ENDIF.
  ENDLOOP.
  IF lv_cur_floor IS INITIAL.
    lv_cur_floor = '1'.
  ENDIF.

  APPEND '<div class="rack-header">' TO lt_h.
  APPEND '<div class="model-tag">RACK: ' TO lt_h.
  APPEND |<span class="model-badge" id="rack-title-badge">Selective Pallet Rack (Rack { lv_cur_rack })</span></div>| TO lt_h.

  " Change Rack Slider (Visible when multiple racks are available)
  APPEND '<div class="rack-slider-container" id="rack-slider-container">' TO lt_h.
  APPEND '<span class="rack-slider-label">Rack Slider:</span>' TO lt_h.
  APPEND '<button class="slider-nav-btn" onclick="prevRack()" title="Previous Rack">◀</button>' TO lt_h.
  DATA(lv_max_idx) = lv_num_racks - 1.
  APPEND |<input type="range" class="rack-range-slider" id="rack-slider" min="0" max="{ lv_max_idx }" value="0" oninput="onRackSliderInput(this.value)">| TO lt_h.
  APPEND '<button class="slider-nav-btn" onclick="nextRack()" title="Next Rack">▶</button>' TO lt_h.
  APPEND '<div class="rack-chip-track" id="rack-chip-track">' TO lt_h.
  LOOP AT lt_distinct_racks INTO DATA(lv_rk_chip).
    DATA(lv_ch_idx) = sy-tabix - 1.
    DATA(lv_ch_act) = COND string( WHEN lv_ch_idx = 0 THEN ' active' ELSE '' ).
    APPEND |<button class="rack-chip{ lv_ch_act }" onclick="goToRack({ lv_ch_idx })">{ lv_rk_chip }</button>| TO lt_h.
  ENDLOOP.
  APPEND '</div></div>' TO lt_h.

  APPEND '<div class="rack-hint">10 Bins per Rack (5 Levels &times; 2 Bays)</div>' TO lt_h.
  APPEND '</div>' TO lt_h.

  " 4b. Map Real Warehouse Bins from gt_visual_rack into 10 Slots (5 Levels x 2 Bays)
  DO 5 TIMES.
    DATA(lv_init_lvl) = 6 - sy-index. " 5 down to 1
    DO 2 TIMES.
      DATA(lv_init_bay) = sy-index.  " 1, 2
      DATA(ls_init_slot) = VALUE ty_slot_data(
        slot_key = |L{ lv_init_lvl }-B{ lv_init_bay }|
        lvl_num  = lv_init_lvl
        bay_col  = lv_init_bay
      ).
      APPEND ls_init_slot TO lt_slots.
    ENDDO.
  ENDDO.

  " Collect distinct bins for the current rack
  IF lv_cur_rack IS NOT INITIAL.
    LOOP AT gt_visual_rack INTO DATA(ls_vr) WHERE rack_num = lv_cur_rack.
      READ TABLE lt_rack_bins WITH KEY lgpla = ls_vr-lgpla TRANSPORTING NO FIELDS.
      IF sy-subrc <> 0.
        DATA(lv_assign_lvl) = ls_vr-level_num.
        IF lv_assign_lvl < 1 OR lv_assign_lvl > 5.
          lv_assign_lvl = 1.
        ENDIF.
        APPEND VALUE ty_rack_bin( lgpla = ls_vr-lgpla level_num = lv_assign_lvl ) TO lt_rack_bins.
      ENDIF.
    ENDLOOP.
  ELSE.
    LOOP AT gt_visual_rack INTO ls_vr.
      READ TABLE lt_rack_bins WITH KEY lgpla = ls_vr-lgpla TRANSPORTING NO FIELDS.
      IF sy-subrc <> 0.
        lv_assign_lvl = ls_vr-level_num.
        IF lv_assign_lvl < 1 OR lv_assign_lvl > 5.
          lv_assign_lvl = 1.
        ENDIF.
        APPEND VALUE ty_rack_bin( lgpla = ls_vr-lgpla level_num = lv_assign_lvl ) TO lt_rack_bins.
      ENDIF.
    ENDLOOP.
  ENDIF.

  LOOP AT lt_rack_bins INTO DATA(ls_rb).
    READ TABLE lt_slots ASSIGNING FIELD-SYMBOL(<fs_s>)
      WITH KEY lvl_num = ls_rb-level_num bay_col = 1 has_stock = abap_false.
    IF sy-subrc <> 0.
      READ TABLE lt_slots ASSIGNING <fs_s>
        WITH KEY lvl_num = ls_rb-level_num bay_col = 2 has_stock = abap_false.
    ENDIF.
    IF sy-subrc <> 0.
      READ TABLE lt_slots ASSIGNING <fs_s>
        WITH KEY has_stock = abap_false.
    ENDIF.

    IF sy-subrc = 0.
      <fs_s>-has_stock = abap_true.
      <fs_s>-bin_id    = ls_rb-lgpla.
      LOOP AT gt_visual_rack INTO DATA(ls_vr_item)
        WHERE lgpla = ls_rb-lgpla.
        APPEND ls_vr_item TO <fs_s>-items.
      ENDLOOP.
    ENDIF.
  ENDLOOP.

  " Set clean synthesized bin code for empty slots
  LOOP AT lt_slots ASSIGNING <fs_s> WHERE has_stock = abap_false.
    IF <fs_s>-bay_col = 1.
      DATA(lv_empty_pos) = |0{ <fs_s>-lvl_num }|.
    ELSE.
      lv_empty_pos = |1{ <fs_s>-lvl_num }|.
    ENDIF.
    IF lv_cur_floor = '0' OR lv_cur_floor IS INITIAL.
      <fs_s>-bin_id = |{ lv_cur_rack }-{ lv_empty_pos }|.
    ELSE.
      <fs_s>-bin_id = |{ lv_cur_floor }-{ lv_cur_rack }-{ lv_empty_pos }|.
    ENDIF.
  ENDLOOP.

  " Determine Active Slot (First slot with stock)
  DATA: lv_active_slot_key TYPE string.
  CLEAR lv_active_slot_key.
  LOOP AT lt_slots INTO DATA(ls_check) WHERE has_stock = abap_true.
    lv_active_slot_key = ls_check-slot_key.
    EXIT.
  ENDLOOP.
  IF lv_active_slot_key IS INITIAL.
    lv_active_slot_key = 'L1-B1'.
  ENDIF.

  " Render Rack Stage
  APPEND '<div class="rack-stage">' TO lt_h.
  APPEND '<div class="rack-bays-wrapper">' TO lt_h.

  DO 5 TIMES.
    DATA(lv_render_lvl) = 6 - sy-index. " 5, 4, 3, 2, 1
    APPEND '<div class="tier-row">' TO lt_h.

    DO 2 TIMES.
      DATA(lv_render_bay) = sy-index. " 1, 2
      DATA(lv_cur_slot_key) = |L{ lv_render_lvl }-B{ lv_render_bay }|.

      READ TABLE lt_slots INTO DATA(ls_cur_slot) WITH KEY slot_key = lv_cur_slot_key.

      DATA: lv_z_cls   TYPE string,
            lv_b_cls   TYPE string,
            lv_c_cls   TYPE string,
            lv_bm_cls  TYPE string,
            lv_z_title TYPE string,
            lv_active  TYPE string.

      IF ls_cur_slot-slot_key = lv_active_slot_key.
        lv_active = 'active-slot'.
      ELSE.
        CLEAR lv_active.
      ENDIF.

      IF ls_cur_slot-has_stock = abap_true AND lines( ls_cur_slot-items ) > 0.
        READ TABLE ls_cur_slot-items INTO DATA(ls_first) INDEX 1.
        IF ls_first-lgber = 'IT1' OR ls_first-lbert CS 'Blue' OR ls_first-lbert CS 'Cold'.
          lv_z_cls = 'zone-blue'. lv_b_cls = 'badge-blue'. lv_c_cls = 'carton-blue'. lv_bm_cls = 'beam-blue'.
          lv_z_title = |❄ { ls_first-lbert } ({ ls_first-lgber })|.
        ELSEIF ls_first-lgber = 'IT2' OR ls_first-lbert CS 'Pink' OR ls_first-lbert CS 'Hazard'.
          lv_z_cls = 'zone-pink'. lv_b_cls = 'badge-pink'. lv_c_cls = 'carton-pink'. lv_bm_cls = 'beam-pink'.
          lv_z_title = |⬡ { ls_first-lbert } ({ ls_first-lgber })|.
        ELSEIF ls_first-lgber = '001' OR ls_first-lbert CS 'Fast' OR ls_first-lbert CS 'Green'.
          lv_z_cls = 'zone-green'. lv_b_cls = 'badge-green'. lv_c_cls = 'carton-green'. lv_bm_cls = 'beam-green'.
          lv_z_title = |✔ { ls_first-lbert } ({ ls_first-lgber })|.
        ELSE.
          lv_z_cls = 'zone-orange'. lv_b_cls = 'badge-orange'. lv_c_cls = 'carton-orange'. lv_bm_cls = 'beam-orange'.
          lv_z_title = |🚚 { ls_first-lbert } ({ ls_first-lgber })|.
        ENDIF.
      ELSE.
        lv_z_cls = 'zone-empty'. lv_b_cls = 'badge-empty'. lv_c_cls = 'carton-empty'. lv_bm_cls = 'beam-pink'.
        lv_z_title = '○ AVAILABLE BIN'.
      ENDIF.

      APPEND '<div class="bay-column">' TO lt_h.
      APPEND |<div class="section-box { lv_z_cls } { lv_active }" id="slot-{ lv_cur_slot_key }" | TO lt_h.
      APPEND |onclick="selectSlot('{ lv_cur_slot_key }')">| TO lt_h.

      DATA(lv_cnt_in_slot) = lines( ls_cur_slot-items ).
      IF lv_cnt_in_slot > 0.
        APPEND |<div class="zone-badge-bar { lv_b_cls }"><span>{ lv_z_title }</span>| TO lt_h.
        APPEND |<span style="font-family:monospace; font-size:8.5px;">{ lv_cnt_in_slot } UNITS IN BIN</span></div>| TO lt_h.
      ELSE.
        APPEND |<div class="zone-badge-bar { lv_b_cls }"><span>{ lv_z_title }</span>| TO lt_h.
        APPEND '<span style="font-family:monospace; font-size:8.5px;">0 UNITS</span></div>' TO lt_h.
      ENDIF.

      APPEND '<div class="pallets-pair">' TO lt_h.
      IF lv_cnt_in_slot > 0.
        LOOP AT ls_cur_slot-items INTO DATA(ls_p_hu).
          APPEND '<div class="pallet-cargo">' TO lt_h.
          APPEND |<div class="cargo-carton { lv_c_cls }">| TO lt_h.
          APPEND |<div class="carton-header"><span>{ ls_p_hu-unit_type }</span><span>▲▲</span></div>| TO lt_h.
          APPEND |<div class="carton-title" title="Unit { ls_p_hu-exidv }">{ ls_p_hu-exidv }</div>| TO lt_h.
          IF ls_p_hu-sernr IS NOT INITIAL AND ls_p_hu-sernr <> 'N/A'.
            DATA(lv_sn_s) = ls_p_hu-sernr.
            DATA(lv_sn_l) = strlen( lv_sn_s ).
            IF lv_sn_l > 8.
              DATA(lv_sn_o) = lv_sn_l - 5.
              lv_sn_s = |...{ lv_sn_s+lv_sn_o(5) }|.
            ENDIF.
            APPEND |<div style="font-size:7.5px; font-family:monospace; text-align:center; color:#0369a1; font-weight:700;" title="{ ls_p_hu-sernr }">SN: { lv_sn_s }</div>| TO lt_h.
          ENDIF.
          DATA(lv_sut_disp) = COND string( WHEN ls_p_hu-sut IS NOT INITIAL THEN ls_p_hu-sut ELSE 'SKU' ).
          APPEND |<div class="carton-footer"><span>{ ls_p_hu-vemng } { ls_p_hu-vemeh }</span><span class="sku-pill">{ lv_sut_disp }</span></div>| TO lt_h.
          APPEND '</div>' TO lt_h.
          APPEND '<div class="pallet-wood"><div class="pallet-slat"></div>' TO lt_h.
          APPEND '<div class="pallet-runners"><div class="runner-block"></div><div class="runner-block"></div><div class="runner-block"></div></div></div>' TO lt_h.
          APPEND '</div>' TO lt_h.
        ENDLOOP.
      ELSE.
        APPEND '<div class="pallet-cargo"><div class="cargo-carton carton-empty">Available Slot 1</div></div>' TO lt_h.
        APPEND '<div class="pallet-cargo"><div class="cargo-carton carton-empty">Available Slot 2</div></div>' TO lt_h.
      ENDIF.
      APPEND '</div>' TO lt_h. " end pallets-pair
      APPEND '</div>' TO lt_h. " end section-box

      " Step Beam with Actual Bin Tag
      APPEND |<div class="step-beam { lv_bm_cls }" onclick="selectSlot('{ lv_cur_slot_key }')">| TO lt_h.
      APPEND |<span class="beam-bin-tag" onclick="selectSlot('{ lv_cur_slot_key }')">{ ls_cur_slot-bin_id }</span>| TO lt_h.
      APPEND |<span class="beam-level-label">LEVEL { lv_render_lvl } &bull; BAY { lv_render_bay }</span>| TO lt_h.
      APPEND '</div>' TO lt_h.

      APPEND '</div>' TO lt_h. " end bay-column
    ENDDO.
    APPEND '</div>' TO lt_h. " end tier-row
  ENDDO.

  APPEND '</div>' TO lt_h. " end rack-bays-wrapper
  APPEND '</div>' TO lt_h. " end rack-stage

  " Bottom Legend in Rack Card
  APPEND '<div class="rack-footer-legend">' TO lt_h.
  APPEND '<div class="legend-items">' TO lt_h.
  APPEND '<div class="legend-item"><span class="color-dot pink"></span> Section Colour-Coded Step Beam</div>' TO lt_h.
  APPEND '<div class="legend-item"><span class="dot-wood"></span> Pallet / Storage Unit</div>' TO lt_h.
  APPEND '</div>' TO lt_h.
  APPEND |<div>Warehouse: { p_whse } &bull; 10 Bins in Rack (Levels 1 to 5)</div>| TO lt_h.
  APPEND '</div>' TO lt_h.

  APPEND '</div>' TO lt_h. " end rack-card

  " 5. Right Sidebar: Inspector Card & Bin Units Table
  READ TABLE lt_slots INTO DATA(ls_act_slot) WITH KEY slot_key = lv_active_slot_key.
  DATA: lv_act_title TYPE string,
        lv_act_sub   TYPE string,
        lv_act_pill  TYPE string,
        lv_act_pillc TYPE string,
        lv_act_bin   TYPE string,
        lv_act_stgt  TYPE string,
        lv_act_stgs  TYPE string,
        lv_act_bint  TYPE string,
        lv_act_cap   TYPE string,
        lv_act_hu    TYPE string,
        lv_act_qty   TYPE string,
        lv_act_ser   TYPE string,
        lv_act_bat   TYPE string,
        lv_act_stat  TYPE string,
        lv_act_fhu   TYPE string.

  IF ls_act_slot-has_stock = abap_true AND lines( ls_act_slot-items ) > 0.
    READ TABLE ls_act_slot-items INTO DATA(ls_act_f) INDEX 1.
    lv_act_title = |Bin { ls_act_slot-bin_id } ({ ls_act_slot-slot_key })|.
    lv_act_sub   = |Rack { lv_cur_rack } &bull; Floor { lv_cur_floor } &bull; Level { ls_act_slot-lvl_num } &bull; Bay { ls_act_slot-bay_col }|.
    lv_act_pill  = |{ ls_act_f-lbert } Section|.
    IF ls_act_f-lgber = 'IT1' OR ls_act_f-lbert CS 'Blue'.
      lv_act_pillc = 'pill-blue'.
    ELSEIF ls_act_f-lgber = 'IT2' OR ls_act_f-lbert CS 'Pink'.
      lv_act_pillc = 'pill-pink'.
    ELSEIF ls_act_f-lgber = '001' OR ls_act_f-lbert CS 'Fast'.
      lv_act_pillc = 'pill-green'.
    ELSE.
      lv_act_pillc = 'pill-orange'.
    ENDIF.
    lv_act_bin   = ls_act_slot-bin_id.
    lv_act_stgt  = |{ ls_act_f-ltypt } ({ ls_act_f-lgtyp })|.
    lv_act_stgs  = |Colour Code: { ls_act_f-lbert } ({ ls_act_f-lgber })|.
    lv_act_bint  = |Level { ls_act_slot-lvl_num } / Bay { ls_act_slot-bay_col }|.
    lv_act_cap   = |{ lines( ls_act_slot-items ) } Units (Occupied)|.

    DATA: lv_act_totq TYPE p DECIMALS 3,
          lv_all_hu_s TYPE string,
          lv_all_sn_s TYPE string.
    CLEAR: lv_act_totq, lv_all_hu_s, lv_all_sn_s.
    LOOP AT ls_act_slot-items INTO DATA(ls_ai).
      lv_act_totq = lv_act_totq + ls_ai-vemng.
      IF lv_all_hu_s IS INITIAL.
        lv_all_hu_s = ls_ai-exidv.
        lv_act_fhu  = ls_ai-exidv.
      ELSE.
        lv_all_hu_s = |{ lv_all_hu_s }, { ls_ai-exidv }|.
      ENDIF.
      IF ls_ai-sernr IS NOT INITIAL AND ls_ai-sernr <> 'N/A'.
        IF lv_all_sn_s IS INITIAL.
          lv_all_sn_s = ls_ai-sernr.
        ELSE.
          lv_all_sn_s = |{ lv_all_sn_s }, { ls_ai-sernr }|.
        ENDIF.
      ENDIF.
    ENDLOOP.
    IF lv_all_sn_s IS INITIAL.
      lv_all_sn_s = 'N/A'.
    ENDIF.
    lv_act_hu   = |{ lv_all_hu_s } ({ lines( ls_act_slot-items ) } Units)|.
    lv_act_qty  = |{ lines( ls_act_slot-items ) } Cartons &bull; { lv_act_totq } { ls_act_f-vemeh }|.
    lv_act_ser  = lv_all_sn_s.
    lv_act_bat  = COND string( WHEN ls_act_f-charg IS NOT INITIAL THEN ls_act_f-charg ELSE 'Standard' ).
    lv_act_stat = ls_act_f-stg_stat.
  ELSE.
    lv_act_title = |Slot { ls_act_slot-slot_key } (Available)|.
    lv_act_sub   = |Rack { lv_cur_rack } &bull; Floor { lv_cur_floor } &bull; Level { ls_act_slot-lvl_num } &bull; Bay { ls_act_slot-bay_col }|.
    lv_act_pill  = 'Available Bin'.
    lv_act_pillc = 'pill-empty'.
    lv_act_bin   = ls_act_slot-bin_id.
    lv_act_stgt  = COND string( WHEN gv_pref_stg IS NOT INITIAL THEN |Storage Type { gv_pref_stg }| ELSE 'Standard Storage' ).
    lv_act_stgs  = 'Available Section'.
    lv_act_bint  = |Level { ls_act_slot-lvl_num } / Bay { ls_act_slot-bay_col }|.
    lv_act_cap   = '2 Pallets (Available)'.
    lv_act_hu    = 'None (Available)'.
    lv_act_qty   = '0.000 NOS'.
    lv_act_ser   = 'N/A'.
    lv_act_bat   = '--'.
    lv_act_stat  = '○ Empty Bin'.
  ENDIF.

  APPEND '<div class="sidebar-right">' TO lt_h.

  " Top Card: Slot Inspector
  APPEND '<div class="info-card">' TO lt_h.
  APPEND '<div class="info-header"><div>' TO lt_h.
  APPEND |<div class="slot-heading" id="insp-slot-title">{ lv_act_title }</div>| TO lt_h.
  APPEND |<div class="slot-subheading" id="insp-slot-sub">{ lv_act_sub }</div>| TO lt_h.
  APPEND '</div>' TO lt_h.
  APPEND |<span class="section-pill-tag { lv_act_pillc }" id="insp-section-pill">{ lv_act_pill }</span>| TO lt_h.
  APPEND '</div>' TO lt_h.

  APPEND '<div class="prop-row"><span class="prop-label">Storage Type</span>' TO lt_h.
  APPEND |<span class="prop-val" id="insp-stgtype" style="color:#c2410c;">{ lv_act_stgt }</span></div>| TO lt_h.
  APPEND '<div class="prop-row"><span class="prop-label">Storage Section</span>' TO lt_h.
  APPEND |<span class="prop-val" id="insp-stgsec" style="color:#db2777;">{ lv_act_stgs }</span></div>| TO lt_h.
  APPEND '<div class="prop-row"><span class="prop-label">Storage Bin Type</span>' TO lt_h.
  APPEND |<span class="prop-val" id="insp-bintype" style="color:#0369a1;">{ lv_act_bint }</span></div>| TO lt_h.
  APPEND '<div class="prop-row"><span class="prop-label">Actual Storage Bin</span>' TO lt_h.
  APPEND |<span class="prop-val" id="insp-bin" style="color:#0284c7;">{ lv_act_bin }</span></div>| TO lt_h.
  APPEND '<div class="prop-row"><span class="prop-label">Pallet Capacity</span>' TO lt_h.
  APPEND |<span class="prop-val" id="insp-capacity">{ lv_act_cap }</span></div>| TO lt_h.
  APPEND '<div class="prop-row"><span class="prop-label">Assigned Material</span>' TO lt_h.
  APPEND |<span class="prop-val" id="insp-desc" style="font-family:sans-serif; font-size:10.5px;">{ lv_clean_maktx }</span></div>| TO lt_h.
  APPEND '<div class="prop-row"><span class="prop-label">Unit (HU / SU)</span>' TO lt_h.
  APPEND |<span class="prop-val" id="insp-hu" style="color:#ea580c; font-size:10.5px;">{ lv_act_hu }</span></div>| TO lt_h.
  APPEND '<div class="prop-row"><span class="prop-label">SKU Count / Qty</span>' TO lt_h.
  APPEND |<span class="prop-val" id="insp-qty">{ lv_act_qty }</span></div>| TO lt_h.
  APPEND '<div class="prop-row"><span class="prop-label">Serial Number</span>' TO lt_h.
  APPEND |<span class="prop-val" id="insp-ser" style="font-size:10px; color:#0369a1;">{ lv_act_ser }</span></div>| TO lt_h.
  APPEND '<div class="prop-row"><span class="prop-label">Batch</span>' TO lt_h.
  APPEND |<span class="prop-val" id="insp-bat">{ lv_act_bat }</span></div>| TO lt_h.
  APPEND '<div class="prop-row"><span class="prop-label">Stock Status</span>' TO lt_h.
  APPEND |<span class="prop-val" id="insp-stat" style="color:#16a34a;">{ lv_act_stat }</span></div>| TO lt_h.

  IF lv_act_fhu IS NOT INITIAL.
    APPEND |<a href="sapevent:PICK_HU?EXIDV={ lv_act_fhu }" id="btn-pick-hu" class="btn-select-hu">✔ Select Unit { lv_act_fhu } for Transfer</a>| TO lt_h.
  ELSE.
    APPEND '<a href="#" id="btn-pick-hu" class="btn-select-hu" style="opacity:0.4; pointer-events:none;">○ Bin is Empty (No Unit)</a>' TO lt_h.
  ENDIF.
  APPEND '</div>' TO lt_h. " end info-card 1

  " Bottom Card: Section Color Reference & Bin Units
  APPEND '<div class="info-card">' TO lt_h.
  APPEND '<div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #f1f5f9; padding-bottom:6px; margin-bottom:6px;">' TO lt_h.
  APPEND |<div><div style="font-size:13px; font-weight:800; color:#0f172a;" id="bin-units-title">Bin { lv_act_bin } Units</div>| TO lt_h.
  APPEND '<div style="font-size:10px; color:#64748b;">HU &amp; Serial Numbers in Selected Bin</div></div>' TO lt_h.
  DATA(lv_cnt_badge) = lines( ls_act_slot-items ).
  APPEND '<span style="background:#e0f2fe; color:#0369a1; padding:2px 8px; border-radius:10px; ' TO lt_h.
  APPEND |font-size:10px; font-weight:800; font-family:monospace;" id="bin-units-count-badge">| TO lt_h.
  APPEND |{ lv_cnt_badge } Units in Bin</span></div>| TO lt_h.

  " Scrollable Table of HUs and Serial Numbers in this Bin
  APPEND '<div style="max-height:120px; overflow-y:auto; border:1px solid #e2e8f0; border-radius:6px; background:#ffffff;">' TO lt_h.
  APPEND '<table style="width:100%; border-collapse:collapse; font-size:11px;">' TO lt_h.
  APPEND '<thead><tr style="background:#f8fafc; border-bottom:1px solid #e2e8f0; color:#64748b; font-size:9.5px; text-transform:uppercase; text-align:left;">' TO lt_h.
  APPEND '<th style="padding:4px 6px;">Unit Number</th><th style="padding:4px 6px;">Serial Number</th>' TO lt_h.
  APPEND '<th style="padding:4px 6px; text-align:right;">Qty</th><th style="padding:4px 6px; text-align:center;">Action</th></tr></thead>' TO lt_h.
  APPEND '<tbody id="bin-units-tbody">' TO lt_h.
  IF lines( ls_act_slot-items ) > 0.
    LOOP AT ls_act_slot-items INTO DATA(ls_row_u).
      DATA(lv_ser_cell) = COND string( WHEN ls_row_u-sernr IS NOT INITIAL THEN ls_row_u-sernr ELSE 'N/A' ).
      APPEND '<tr style="border-bottom:1px solid #f1f5f9;">' TO lt_h.
      APPEND |<td style="padding:4px 6px; font-weight:800; font-family:monospace; color:#0f172a;">{ ls_row_u-exidv }</td>| TO lt_h.
      APPEND |<td style="padding:4px 6px; font-family:monospace; color:#0369a1;">{ lv_ser_cell }</td>| TO lt_h.
      APPEND |<td style="padding:4px 6px; text-align:right; font-weight:700;">{ ls_row_u-vemng } { ls_row_u-vemeh }</td>| TO lt_h.
      APPEND |<td style="padding:4px 6px; text-align:center;">| TO lt_h.
      APPEND |<a href="sapevent:PICK_HU?EXIDV={ ls_row_u-exidv }" | TO lt_h.
      APPEND 'style="background:#16a34a; color:#ffffff; padding:2px 7px; ' TO lt_h.
      APPEND 'border-radius:4px; font-size:9.5px; font-weight:700; text-decoration:none;">Select</a></td></tr>' TO lt_h.
    ENDLOOP.
  ELSE.
    APPEND '<tr><td colspan="4" style="text-align:center; padding:8px; color:#94a3b8;">○ Empty Bin &bull; 0 Units in Bin</td></tr>' TO lt_h.
  ENDIF.
  APPEND '</tbody></table></div>' TO lt_h.

  " Section Color Reference Legend
  APPEND '<div class="color-ref-title" style="margin-top:6px;">STORAGE SECTION (BIN COLOUR CODE)</div>' TO lt_h.
  APPEND '<div style="display:grid; grid-template-columns:1fr 1fr; gap:4px; font-size:10px;">' TO lt_h.
  APPEND '<div class="color-ref-row ref-pink" style="padding:3px 6px; margin:0;"><div class="color-indicator"><span class="color-dot pink"></span> Pink</div><div>Hazard / Corrosive</div></div>' TO lt_h.
  APPEND '<div class="color-ref-row ref-green" style="padding:3px 6px; margin:0;"><div class="color-indicator"><span class="color-dot green"></span> Green</div><div>Fast-Moving</div></div>' TO lt_h.
  APPEND '<div class="color-ref-row ref-blue" style="padding:3px 6px; margin:0;"><div class="color-indicator"><span class="color-dot blue"></span> Blue</div><div>Cold Storage</div></div>' TO lt_h.
  APPEND '<div class="color-ref-row ref-orange" style="padding:3px 6px; margin:0;"><div class="color-indicator"><span class="color-dot orange"></span> Orange</div><div>Priority Outbound</div></div>' TO lt_h.
  APPEND '</div>' TO lt_h.

  APPEND |<button class="btn-reset-diagram" onclick="selectSlot('{ lv_active_slot_key }')">&#8634; Select Primary Stock Bin</button>| TO lt_h.
  APPEND '</div>' TO lt_h. " end info-card 2

  APPEND '</div>' TO lt_h. " end sidebar-right
  APPEND '</div>' TO lt_h. " end app-container

  " JavaScript
  APPEND '<script>' TO lt_h.
  APPEND 'const slotMap = {};' TO lt_h.

  " Populate JavaScript slotMap dictionary
  LOOP AT lt_slots INTO DATA(ls_m_slot).
    DATA: lv_m_title TYPE string,
          lv_m_sub   TYPE string,
          lv_m_pill  TYPE string,
          lv_m_pillc TYPE string,
          lv_m_stgt  TYPE string,
          lv_m_stgs  TYPE string,
          lv_m_bint  TYPE string,
          lv_m_cap   TYPE string,
          lv_m_hu    TYPE string,
          lv_m_qty   TYPE string,
          lv_m_ser   TYPE string,
          lv_m_bat   TYPE string,
          lv_m_stat  TYPE string.

    IF ls_m_slot-has_stock = abap_true AND lines( ls_m_slot-items ) > 0.
      READ TABLE ls_m_slot-items INTO DATA(ls_mf) INDEX 1.
      lv_m_title = |Bin { ls_m_slot-bin_id } (Level { ls_m_slot-lvl_num } Bay { ls_m_slot-bay_col })|.
      lv_m_sub   = |Rack { lv_cur_rack } &bull; Floor { lv_cur_floor } &bull; Level { ls_m_slot-lvl_num } &bull; Bay { ls_m_slot-bay_col }|.
      lv_m_pill  = |{ ls_mf-lbert } Section|.
      IF ls_mf-lgber = 'IT1' OR ls_mf-lbert CS 'Blue'.
        lv_m_pillc = 'pill-blue'.
      ELSEIF ls_mf-lgber = 'IT2' OR ls_mf-lbert CS 'Pink'.
        lv_m_pillc = 'pill-pink'.
      ELSEIF ls_mf-lgber = '001' OR ls_mf-lbert CS 'Fast'.
        lv_m_pillc = 'pill-green'.
      ELSE.
        lv_m_pillc = 'pill-orange'.
      ENDIF.
      lv_m_stgt  = |{ ls_mf-ltypt } ({ ls_mf-lgtyp })|.
      lv_m_stgs  = |Colour Code: { ls_mf-lbert } ({ ls_mf-lgber })|.
      lv_m_bint  = |Level { ls_m_slot-lvl_num } / Bay { ls_m_slot-bay_col }|.
      lv_m_cap   = |{ lines( ls_m_slot-items ) } Units (Occupied)|.

      DATA: lv_m_totq TYPE p DECIMALS 3,
            lv_m_allh TYPE string,
            lv_m_alls TYPE string.
      CLEAR: lv_m_totq, lv_m_allh, lv_m_alls.
      LOOP AT ls_m_slot-items INTO DATA(ls_mi).
        lv_m_totq = lv_m_totq + ls_mi-vemng.
        IF lv_m_allh IS INITIAL.
          lv_m_allh = ls_mi-exidv.
        ELSE.
          lv_m_allh = |{ lv_m_allh }, { ls_mi-exidv }|.
        ENDIF.
        IF ls_mi-sernr IS NOT INITIAL AND ls_mi-sernr <> 'N/A'.
          IF lv_m_alls IS INITIAL.
            lv_m_alls = ls_mi-sernr.
          ELSE.
            lv_m_alls = |{ lv_m_alls }, { ls_mi-sernr }|.
          ENDIF.
        ENDIF.
      ENDLOOP.
      IF lv_m_alls IS INITIAL.
        lv_m_alls = 'N/A'.
      ENDIF.
      lv_m_hu   = |{ lv_m_allh } ({ lines( ls_m_slot-items ) } Units)|.
      lv_m_qty  = |{ lines( ls_m_slot-items ) } Cartons &bull; { lv_m_totq } { ls_mf-vemeh }|.
      lv_m_ser  = lv_m_alls.
      lv_m_bat  = COND string( WHEN ls_mf-charg IS NOT INITIAL THEN ls_mf-charg ELSE 'Standard' ).
      lv_m_stat = ls_mf-stg_stat.
    ELSE.
      lv_m_title = |Slot { ls_m_slot-slot_key } (Available)|.
      lv_m_sub   = |Rack { lv_cur_rack } &bull; Floor { lv_cur_floor } &bull; Level { ls_m_slot-lvl_num } &bull; Bay { ls_m_slot-bay_col }|.
      lv_m_pill  = 'Available Bin'.
      lv_m_pillc = 'pill-empty'.
      lv_m_stgt  = COND string( WHEN gv_pref_stg IS NOT INITIAL THEN |Storage Type { gv_pref_stg }| ELSE 'Standard Storage' ).
      lv_m_stgs  = 'Available Section'.
      lv_m_bint  = |Level { ls_m_slot-lvl_num } / Bay { ls_m_slot-bay_col }|.
      lv_m_cap   = '2 Pallets (Available)'.
      lv_m_hu    = 'None (Available)'.
      lv_m_qty   = '0.000 NOS'.
      lv_m_ser   = 'N/A'.
      lv_m_bat   = '--'.
      lv_m_stat  = '○ Empty Bin'.
    ENDIF.

    APPEND |slotMap['{ ls_m_slot-slot_key }'] = | && '{' TO lt_h.
    APPEND |  title: '{ lv_m_title }',| TO lt_h.
    APPEND |  sub: '{ lv_m_sub }',| TO lt_h.
    APPEND |  pill: '{ lv_m_pill }', pillCls: '{ lv_m_pillc }',| TO lt_h.
    APPEND |  bin: '{ ls_m_slot-bin_id }', cap: '{ lv_m_cap }',| TO lt_h.
    APPEND |  stgType: '{ lv_m_stgt }',| TO lt_h.
    APPEND |  stgSec: '{ lv_m_stgs }',| TO lt_h.
    APPEND |  binType: '{ lv_m_bint }',| TO lt_h.
    APPEND |  desc: '{ lv_clean_maktx }', hu: '{ lv_m_hu }',| TO lt_h.
    APPEND |  qty: '{ lv_m_qty }', ser: '{ lv_m_ser }',| TO lt_h.
    APPEND |  bat: '{ lv_m_bat }', stat: '{ lv_m_stat }',| TO lt_h.
    APPEND '  units: [' TO lt_h.
    DATA: lv_u_idx TYPE i VALUE 0.
    LOOP AT ls_m_slot-items INTO DATA(ls_u_row).
      lv_u_idx = lv_u_idx + 1.
      DATA(lv_u_s) = COND string( WHEN ls_u_row-sernr IS NOT INITIAL THEN ls_u_row-sernr ELSE 'N/A' ).
      DATA(lv_u_c) = COND string( WHEN lv_u_idx < lines( ls_m_slot-items ) THEN ',' ELSE '' ).
      DATA(lv_qty_u) = |{ ls_u_row-vemng } { ls_u_row-vemeh }|.
      DATA: lv_u_str TYPE string.
      lv_u_str = '    { hu: "' && ls_u_row-exidv && '", ser: "' && lv_u_s && '", qty: "' && lv_qty_u && '" }' && lv_u_c.
      APPEND lv_u_str TO lt_h.
    ENDLOOP.
    APPEND '  ]' TO lt_h.
    APPEND '};' TO lt_h.
  ENDLOOP.

  APPEND 'function selectSlot(k) {' TO lt_h.
  APPEND '  if (isTouchMoving) return;' TO lt_h.
  APPEND '  document.querySelectorAll(".section-box").forEach(el => el.classList.remove("active-slot"));' TO lt_h.
  APPEND '  const box = document.getElementById("slot-" + k);' TO lt_h.
  APPEND '  if (box) box.classList.add("active-slot");' TO lt_h.
  APPEND '  const d = slotMap[k];' TO lt_h.
  APPEND '  if (!d) return;' TO lt_h.
  APPEND '  document.getElementById("insp-slot-title").innerText = d.title;' TO lt_h.
  APPEND '  document.getElementById("insp-slot-sub").innerHTML = d.sub;' TO lt_h.
  APPEND '  const pill = document.getElementById("insp-section-pill");' TO lt_h.
  APPEND '  pill.innerText = d.pill; pill.className = "section-pill-tag " + d.pillCls;' TO lt_h.
  APPEND '  const stgEl = document.getElementById("insp-stgtype");' TO lt_h.
  APPEND '  if (stgEl) stgEl.innerText = d.stgType;' TO lt_h.
  APPEND '  const secEl = document.getElementById("insp-stgsec");' TO lt_h.
  APPEND '  if (secEl) secEl.innerText = d.stgSec;' TO lt_h.
  APPEND '  const btpEl = document.getElementById("insp-bintype");' TO lt_h.
  APPEND '  if (btpEl) btpEl.innerText = d.binType;' TO lt_h.
  APPEND '  document.getElementById("insp-bin").innerText = d.bin;' TO lt_h.
  APPEND '  document.getElementById("insp-capacity").innerText = d.cap;' TO lt_h.
  APPEND '  document.getElementById("insp-desc").innerText = d.desc;' TO lt_h.
  APPEND '  document.getElementById("insp-hu").innerText = d.hu;' TO lt_h.
  APPEND '  document.getElementById("insp-qty").innerHTML = d.qty;' TO lt_h.
  APPEND '  document.getElementById("insp-ser").innerText = d.ser;' TO lt_h.
  APPEND '  document.getElementById("insp-bat").innerText = d.bat;' TO lt_h.
  APPEND '  const statEl = document.getElementById("insp-stat");' TO lt_h.
  APPEND '  if (statEl) statEl.innerText = d.stat;' TO lt_h.
  APPEND '  const btn = document.getElementById("btn-pick-hu");' TO lt_h.
  APPEND '  const firstHu = (d.units && d.units.length > 0) ? d.units[0].hu : null;' TO lt_h.
  APPEND '  if (firstHu) {' TO lt_h.
  APPEND '    btn.href = "sapevent:PICK_HU?EXIDV=" + firstHu;' TO lt_h.
  APPEND '    btn.style.opacity = "1"; btn.style.pointerEvents = "auto";' TO lt_h.
  APPEND '    btn.innerText = "✔ Select Unit " + firstHu + " for Transfer";' TO lt_h.
  APPEND '  } else {' TO lt_h.
  APPEND '    btn.href = "#"; btn.style.opacity = "0.4"; btn.style.pointerEvents = "none";' TO lt_h.
  APPEND '    btn.innerText = "○ Bin is Empty (No Unit)";' TO lt_h.
  APPEND '  }' TO lt_h.
  APPEND '  const uTitle = document.getElementById("bin-units-title");' TO lt_h.
  APPEND '  const uBadge = document.getElementById("bin-units-count-badge");' TO lt_h.
  APPEND '  const uTbody = document.getElementById("bin-units-tbody");' TO lt_h.
  APPEND '  uTitle.innerText = "Bin " + d.bin + " Units";' TO lt_h.
  APPEND '  const units = d.units || [];' TO lt_h.
  APPEND '  uBadge.innerText = units.length + (units.length === 1 ? " Unit in Bin" : " Units in Bin");' TO lt_h.
  APPEND '  if (units.length > 0) {' TO lt_h.
  APPEND '    uBadge.style.background = "#dcfce7"; uBadge.style.color = "#15803d";' TO lt_h.
  APPEND '  } else {' TO lt_h.
  APPEND '    uBadge.style.background = "#f1f5f9"; uBadge.style.color = "#64748b";' TO lt_h.
  APPEND '  }' TO lt_h.
  APPEND '  uTbody.innerHTML = "";' TO lt_h.
  APPEND '  if (units.length === 0) {' TO lt_h.
  APPEND '    uTbody.innerHTML = "<tr><td colspan=''4'' style=''text-align:center; padding:8px; color:#94a3b8;''>○ Empty Bin &bull; 0 Units in Bin</td></tr>";' TO lt_h.
  APPEND '  } else {' TO lt_h.
  APPEND '    units.forEach(u => {' TO lt_h.
  APPEND '      const tr = document.createElement("tr");' TO lt_h.
  APPEND '      tr.style.borderBottom = "1px solid #f1f5f9";' TO lt_h.
  APPEND '      tr.innerHTML = "<td style=''padding:4px 6px; font-weight:800; font-family:monospace; color:#0f172a;''>" + u.hu + "</td>" +' TO lt_h.
  APPEND '        "<td style=''padding:4px 6px; font-family:monospace; color:#0369a1;''>" + u.ser + "</td>" +' TO lt_h.
  APPEND '        "<td style=''padding:4px 6px; text-align:right; font-weight:700;''>" + u.qty + "</td>" +' TO lt_h.
  APPEND '        "<td style=''padding:4px 6px; text-align:center;''>" +' TO lt_h.
  APPEND '        "<a href=''sapevent:PICK_HU?EXIDV=" + u.hu + ' TO lt_h.
  APPEND '        "'' style=''background:#16a34a; color:#ffffff; padding:2px 7px; border-radius:4px; font-size:9.5px; font-weight:700; text-decoration:none;''>Select</a></td>";' TO lt_h.
  APPEND '      uTbody.appendChild(tr);' TO lt_h.
  APPEND '    });' TO lt_h.
  APPEND '  }' TO lt_h.
  APPEND '}' TO lt_h.

  APPEND 'const allRacksData = [' TO lt_h.
  LOOP AT lt_distinct_racks INTO DATA(lv_rk_d).
    DATA(lv_rk_d_idx) = sy-tabix.
    DATA: lv_rk_type     TYPE lqua-lgtyp,
          lv_rk_typedesc TYPE t301t-ltypt,
          lv_rk_has_stk  TYPE string VALUE 'false'.
    READ TABLE gt_visual_rack INTO DATA(ls_r_find) WITH KEY rack_num = lv_rk_d.
    IF sy-subrc = 0.
      lv_rk_type     = ls_r_find-lgtyp.
      lv_rk_typedesc = ls_r_find-ltypt.
      IF ls_r_find-vemng > 0.
        lv_rk_has_stk = 'true'.
      ENDIF.
    ELSE.
      lv_rk_type     = gv_pref_stg.
      lv_rk_typedesc = |Storage Type { gv_pref_stg }|.
    ENDIF.
    DATA(lv_rk_c) = COND string( WHEN lv_rk_d_idx < lines( lt_distinct_racks ) THEN ',' ELSE '' ).
    DATA(lv_rk_str) = |  \{ id: "{ lv_rk_d }", type: "{ lv_rk_type }", typeDesc: "{ lv_rk_typedesc }", floor: "{ lv_cur_floor }", hasStock: { lv_rk_has_stk } \}{ lv_rk_c }|.
    APPEND lv_rk_str TO lt_h.
  ENDLOOP.
  APPEND '];' TO lt_h.
  APPEND 'let currentLgtyp = "ALL";' TO lt_h.
  APPEND 'let filteredRacks = allRacksData;' TO lt_h.
  APPEND 'let currentRackIndex = 0;' TO lt_h.

  APPEND 'function onStorageTypeChange(val) {' TO lt_h.
  APPEND '  currentLgtyp = val;' TO lt_h.
  APPEND '  if (val === "ALL") {' TO lt_h.
  APPEND '    filteredRacks = allRacksData;' TO lt_h.
  APPEND '  } else {' TO lt_h.
  APPEND '    filteredRacks = allRacksData.filter(r => r.type === val);' TO lt_h.
  APPEND '    if (filteredRacks.length === 0) filteredRacks = allRacksData;' TO lt_h.
  APPEND '  }' TO lt_h.
  APPEND '  currentRackIndex = 0; updateSliderAndRacks();' TO lt_h.
  APPEND '}' TO lt_h.

  APPEND 'function onRackSliderInput(val) { currentRackIndex = parseInt(val, 10); renderCurrentRack(); }' TO lt_h.
  APPEND 'function goToRack(idx) { currentRackIndex = idx; renderCurrentRack(); }' TO lt_h.
  APPEND 'function prevRack() { if (currentRackIndex > 0) { currentRackIndex--; renderCurrentRack(); } }' TO lt_h.
  APPEND 'function nextRack() { if (currentRackIndex < filteredRacks.length - 1) { currentRackIndex++; renderCurrentRack(); } }' TO lt_h.

  APPEND 'function updateSliderAndRacks() {' TO lt_h.
  APPEND '  const sliderCont = document.getElementById("rack-slider-container");' TO lt_h.
  APPEND '  const slider = document.getElementById("rack-slider");' TO lt_h.
  APPEND '  const chipTrack = document.getElementById("rack-chip-track");' TO lt_h.
  APPEND '  if (filteredRacks.length > 1) {' TO lt_h.
  APPEND '    sliderCont.style.display = "flex"; slider.style.display = "block";' TO lt_h.
  APPEND '    slider.min = "0"; slider.max = (filteredRacks.length - 1).toString();' TO lt_h.
  APPEND '    slider.value = currentRackIndex.toString();' TO lt_h.
  APPEND '    chipTrack.innerHTML = "";' TO lt_h.
  APPEND '    filteredRacks.forEach((r, idx) => {' TO lt_h.
  APPEND '      const chip = document.createElement("button");' TO lt_h.
  APPEND '      chip.className = "rack-chip" + (idx === currentRackIndex ? " active" : "");' TO lt_h.
  APPEND '      chip.textContent = r.id;' TO lt_h.
  APPEND '      chip.onclick = () => goToRack(idx);' TO lt_h.
  APPEND '      chipTrack.appendChild(chip);' TO lt_h.
  APPEND '    });' TO lt_h.
  APPEND '  } else {' TO lt_h.
  APPEND '    sliderCont.style.display = "flex"; slider.style.display = "none";' TO lt_h.
  APPEND '    chipTrack.innerHTML = "<span class=''rack-chip active''>" + (filteredRacks[0] ? filteredRacks[0].id : "RACK") + "</span>";' TO lt_h.
  APPEND '  }' TO lt_h.
  APPEND '  renderCurrentRack();' TO lt_h.
  APPEND '}' TO lt_h.

  APPEND 'function renderCurrentRack() {' TO lt_h.
  APPEND '  const curRack = filteredRacks[currentRackIndex]; if (!curRack) return;' TO lt_h.
  APPEND '  const slider = document.getElementById("rack-slider"); if (slider) slider.value = currentRackIndex;' TO lt_h.
  APPEND '  document.querySelectorAll(".rack-chip").forEach((c, idx) => {' TO lt_h.
  APPEND '    if (idx === currentRackIndex) c.classList.add("active"); else c.classList.remove("active");' TO lt_h.
  APPEND '  });' TO lt_h.
  APPEND '  document.getElementById("rack-counter").innerText = "Rack " + (currentRackIndex + 1) + " of " + filteredRacks.length + " (" + curRack.type + ")";' TO lt_h.
  APPEND '  document.getElementById("rack-title-badge").innerText = "Selective Pallet Rack (Rack " + curRack.id + " / " + curRack.type + ")";' TO lt_h.
  APPEND |  selectSlot("{ lv_active_slot_key }");| TO lt_h.
  APPEND '  document.getElementById("btn-prev").disabled = (currentRackIndex === 0);' TO lt_h.
  APPEND '  document.getElementById("btn-next").disabled = (currentRackIndex === filteredRacks.length - 1);' TO lt_h.
  APPEND '}' TO lt_h.

  " Touch & Keyboard Gestures (4K Touchscreen Drag Guard)
  APPEND 'let touchStartX = 0, touchStartY = 0, isTouchMoving = false, touchTimeout = null;' TO lt_h.
  APPEND 'document.addEventListener("touchstart", e => {' TO lt_h.
  APPEND '  if (e.touches && e.touches.length > 0) {' TO lt_h.
  APPEND '    touchStartX = e.touches[0].clientX; touchStartY = e.touches[0].clientY; isTouchMoving = false;' TO lt_h.
  APPEND '  }' TO lt_h.
  APPEND '}, { passive: true });' TO lt_h.
  APPEND 'document.addEventListener("touchmove", e => {' TO lt_h.
  APPEND '  if (e.touches && e.touches.length > 0) {' TO lt_h.
  APPEND '    const dx = Math.abs(e.touches[0].clientX - touchStartX);' TO lt_h.
  APPEND '    const dy = Math.abs(e.touches[0].clientY - touchStartY);' TO lt_h.
  APPEND '    if (dx > 8 || dy > 8) isTouchMoving = true;' TO lt_h.
  APPEND '  }' TO lt_h.
  APPEND '}, { passive: true });' TO lt_h.
  APPEND 'document.addEventListener("touchend", e => {' TO lt_h.
  APPEND '  if (e.changedTouches && e.changedTouches.length > 0) {' TO lt_h.
  APPEND '    const dX = e.changedTouches[0].clientX - touchStartX;' TO lt_h.
  APPEND '    if (Math.abs(dX) > 60 && !isTouchMoving) {' TO lt_h.
  APPEND '      if (dX < -60) nextRack(); if (dX > 60) prevRack();' TO lt_h.
  APPEND '    }' TO lt_h.
  APPEND '  }' TO lt_h.
  APPEND '  clearTimeout(touchTimeout);' TO lt_h.
  APPEND '  touchTimeout = setTimeout(() => { isTouchMoving = false; }, 80);' TO lt_h.
  APPEND '}, { passive: true });' TO lt_h.
  APPEND 'document.addEventListener("keydown", e => {' TO lt_h.
  APPEND '  if (e.key === "ArrowLeft") prevRack(); if (e.key === "ArrowRight") nextRack();' TO lt_h.
  APPEND '});' TO lt_h.

  APPEND 'window.onload = () => {' TO lt_h.
  APPEND '  updateSliderAndRacks();' TO lt_h.
  APPEND '};' TO lt_h.
  APPEND '</script></body></html>' TO lt_h.

  " Concatenate into string
  CONCATENATE LINES OF lt_h INTO cv_html SEPARATED BY cl_abap_char_utilities=>newline.
ENDFORM.

*&---------------------------------------------------------------------*
*& Form: get_storage_section_color
*& Description: Determines SALV ALV Cell Color based on Storage Section
*&              Description (T302T-LBERT) & Code (LGBER)
*&---------------------------------------------------------------------*
FORM get_storage_section_color
  USING    iv_lgber    TYPE lagp-lgber
           iv_lbert    TYPE t302t-lbert
  CHANGING ev_col      TYPE i
           ev_int      TYPE i.

  DATA: lv_text_upper TYPE string.
  lv_text_upper = iv_lbert.
  TRANSLATE lv_text_upper TO UPPER CASE.

  " 1. Check Storage Section Description text for Color / Zone Keywords
  IF lv_text_upper CS 'BLUE' OR lv_text_upper CS 'BLAU'.
    ev_col = 4. " Blue (col_key)
    ev_int = 1.
  ELSEIF lv_text_upper CS 'RED' OR lv_text_upper CS 'ROT' OR lv_text_upper CS 'PINK'.
    ev_col = 6. " Red / Pink (col_negative)
    ev_int = 1.
  ELSEIF lv_text_upper CS 'ORANGE' OR lv_text_upper CS 'CORROSIVE' OR lv_text_upper CS 'FLAMMABLE'.
    ev_col = 3. " Orange / Amber (col_total intensified)
    ev_int = 1.
  ELSEIF lv_text_upper CS 'GREEN' OR lv_text_upper CS 'GRUN' OR lv_text_upper CS 'GRÜN'
      OR lv_text_upper CS 'FAST' OR lv_text_upper CS 'SCHNELL' OR lv_text_upper CS 'ACTIVE'.
    ev_col = 5. " Green (col_positive)
    ev_int = 1.
  ELSEIF lv_text_upper CS 'YELLOW' OR lv_text_upper CS 'GELB'
      OR lv_text_upper CS 'SLOW' OR lv_text_upper CS 'LANGSAM'.
    ev_col = 3. " Yellow (col_total normal)
    ev_int = 0.
  ELSEIF lv_text_upper CS 'TOXIC' OR lv_text_upper CS 'HAZARD'
      OR lv_text_upper CS 'HOLD' OR lv_text_upper CS 'BLOCK'.
    ev_col = 6. " Red / Pink (col_negative)
    ev_int = 1.
  ELSEIF lv_text_upper CS 'POWDER' OR lv_text_upper CS 'SOLID' OR lv_text_upper CS 'PULVER'
      OR lv_text_upper CS 'PURPLE' OR lv_text_upper CS 'VIOLET' OR lv_text_upper CS 'CYAN'.
    ev_col = 7. " Violet / Cyan (col_group)
    ev_int = 1.
  ELSE.
    " 2. Fallback based on Storage Section Code (LGBER)
    CASE iv_lgber.
      WHEN 'IT1'.
        ev_col = 4. " Blue
        ev_int = 1.
      WHEN 'IT2'.
        ev_col = 6. " Red
        ev_int = 1.
      WHEN 'IT3'.
        ev_col = 3. " Orange
        ev_int = 1.
      WHEN '001'.
        ev_col = 5. " Green (Fast-moving)
        ev_int = 1.
      WHEN '002'.
        ev_col = 3. " Yellow (Slow-moving)
        ev_int = 0.
      WHEN '003'.
        ev_col = 7. " Violet / Cyan
        ev_int = 1.
      WHEN OTHERS.
        DATA(lv_hash) = ( strlen( iv_lgber ) + 1 ) MOD 4.
        CASE lv_hash.
          WHEN 0. ev_col = 5. ev_int = 1. " Green
          WHEN 1. ev_col = 4. ev_int = 1. " Blue
          WHEN 2. ev_col = 3. ev_int = 1. " Orange/Yellow
          WHEN OTHERS. ev_col = 7. ev_int = 1. " Violet
        ENDCASE.
    ENDCASE.
  ENDIF.
ENDFORM.

*&---------------------------------------------------------------------*
*& Form: pick_hu_from_visual
*& Description: Selects HU from Visual Rack popup and auto-validates
*&---------------------------------------------------------------------*
FORM pick_hu_from_visual USING iv_row TYPE i.
  READ TABLE gt_visual_rack INTO DATA(ls_vpick) INDEX iv_row.
  IF sy-subrc = 0 AND ls_vpick-exidv IS NOT INITIAL.
    p_exidv = ls_vpick-exidv.
    PERFORM validate_handling_unit.

    " Update Dynpro fields immediately
    DATA: lt_dynp TYPE STANDARD TABLE OF dynpread,
          ls_dynp TYPE dynpread.

    CLEAR ls_dynp.
    ls_dynp-fieldname  = 'P_EXIDV'.
    ls_dynp-fieldvalue = p_exidv.
    APPEND ls_dynp TO lt_dynp.

    CLEAR ls_dynp.
    ls_dynp-fieldname  = 'P_UTYP'.
    ls_dynp-fieldvalue = p_utyp.
    APPEND ls_dynp TO lt_dynp.

    CLEAR ls_dynp.
    ls_dynp-fieldname  = 'P_SUT'.
    ls_dynp-fieldvalue = p_sut.
    APPEND ls_dynp TO lt_dynp.

    CLEAR ls_dynp.
    ls_dynp-fieldname  = 'P_SUT_TX'.
    ls_dynp-fieldvalue = p_sut_tx.
    APPEND ls_dynp TO lt_dynp.

    CLEAR ls_dynp.
    ls_dynp-fieldname  = 'P_HUSER'.
    ls_dynp-fieldvalue = p_huser.
    APPEND ls_dynp TO lt_dynp.

    CLEAR ls_dynp.
    ls_dynp-fieldname  = 'P_HUQTY'.
    ls_dynp-fieldvalue = |{ p_huqty }|.
    APPEND ls_dynp TO lt_dynp.

    CLEAR ls_dynp.
    ls_dynp-fieldname  = 'P_HUBAT'.
    ls_dynp-fieldvalue = p_hubat.
    APPEND ls_dynp TO lt_dynp.

    CLEAR ls_dynp.
    ls_dynp-fieldname  = 'P_TQTY'.
    ls_dynp-fieldvalue = |{ p_tqty }|.
    APPEND ls_dynp TO lt_dynp.

    CALL FUNCTION 'DYNP_VALUES_UPDATE'
      EXPORTING
        dyname     = sy-repid
        dynumb     = sy-dynnr
      TABLES
        dynpfields = lt_dynp
      EXCEPTIONS
        OTHERS     = 0.

    IF ls_vpick-lbert IS NOT INITIAL.
      MESSAGE |Selected { gv_unit_type } { p_exidv } (SUT: { p_sut }) from Bin { ls_vpick-lgpla } (Rack: { ls_vpick-rack_ref }, Section: { ls_vpick-lbert })| TYPE 'S'.
    ELSE.
      MESSAGE |Selected { gv_unit_type } { p_exidv } (SUT: { p_sut }) from Bin { ls_vpick-lgpla } (Rack Position: { ls_vpick-rack_ref })| TYPE 'S'.
    ENDIF.
  ENDIF.
ENDFORM.

*&---------------------------------------------------------------------*
*& Form: pick_hu_from_bin
*& Description: Selects HU from Bin popup and auto-validates on screen
*&---------------------------------------------------------------------*
FORM pick_hu_from_bin USING iv_row TYPE i.
  READ TABLE gt_bin_stock INTO DATA(ls_pick) INDEX iv_row.
  IF sy-subrc = 0 AND ls_pick-exidv IS NOT INITIAL.
    p_exidv = ls_pick-exidv.
    PERFORM validate_handling_unit.

    " Update Dynpro fields immediately
    DATA: lt_dynp TYPE STANDARD TABLE OF dynpread,
          ls_dynp TYPE dynpread.

    CLEAR ls_dynp.
    ls_dynp-fieldname  = 'P_EXIDV'.
    ls_dynp-fieldvalue = p_exidv.
    APPEND ls_dynp TO lt_dynp.

    CLEAR ls_dynp.
    ls_dynp-fieldname  = 'P_UTYP'.
    ls_dynp-fieldvalue = p_utyp.
    APPEND ls_dynp TO lt_dynp.

    CLEAR ls_dynp.
    ls_dynp-fieldname  = 'P_SUT'.
    ls_dynp-fieldvalue = p_sut.
    APPEND ls_dynp TO lt_dynp.

    CLEAR ls_dynp.
    ls_dynp-fieldname  = 'P_SUT_TX'.
    ls_dynp-fieldvalue = p_sut_tx.
    APPEND ls_dynp TO lt_dynp.

    CLEAR ls_dynp.
    ls_dynp-fieldname  = 'P_HUSER'.
    ls_dynp-fieldvalue = p_huser.
    APPEND ls_dynp TO lt_dynp.

    CLEAR ls_dynp.
    ls_dynp-fieldname  = 'P_HUQTY'.
    ls_dynp-fieldvalue = |{ p_huqty }|.
    APPEND ls_dynp TO lt_dynp.

    CLEAR ls_dynp.
    ls_dynp-fieldname  = 'P_HUBAT'.
    ls_dynp-fieldvalue = p_hubat.
    APPEND ls_dynp TO lt_dynp.

    CLEAR ls_dynp.
    ls_dynp-fieldname  = 'P_FRLOC'.
    ls_dynp-fieldvalue = p_frloc.
    APPEND ls_dynp TO lt_dynp.

    CLEAR ls_dynp.
    ls_dynp-fieldname  = 'P_PSTG'.
    ls_dynp-fieldvalue = p_pstg.
    APPEND ls_dynp TO lt_dynp.

    CLEAR ls_dynp.
    ls_dynp-fieldname  = 'P_TQTY'.
    ls_dynp-fieldvalue = |{ p_tqty }|.
    APPEND ls_dynp TO lt_dynp.

    CALL FUNCTION 'DYNP_VALUES_UPDATE'
      EXPORTING
        dyname     = sy-repid
        dynumb     = sy-dynnr
      TABLES
        dynpfields = lt_dynp
      EXCEPTIONS
        OTHERS     = 0.

    IF ls_pick-sort_prio = 1.
      MESSAGE |Selected Available { gv_unit_type } { p_exidv } (SUT: { p_sut }) from Bin { ls_pick-lgpla }| TYPE 'S'.
    ELSEIF ls_pick-sort_prio = 4.
      MESSAGE |Warning: Selected { gv_unit_type } { p_exidv } is ON-HOLD (Bin { ls_pick-lgpla })| TYPE 'W'.
    ELSE.
      MESSAGE |Notice: Selected { gv_unit_type } { p_exidv } from Bin { ls_pick-lgpla }| TYPE 'S'.
    ENDIF.
  ENDIF.
ENDFORM.

*&---------------------------------------------------------------------*
*& Form: f4_storage_strategies
*& Description: Displays interactive popup showing Storage Strategies
*&              for Stock Removal (A) and Stock Placement (E), Material
*&              Master MLGT, and Available Stock by Storage Type
*& Author     : DNR / Dipak Rathod
*&---------------------------------------------------------------------*
FORM f4_storage_strategies.
  PERFORM determine_whse_and_pref_stg.

  TYPES: BEGIN OF ty_f4_strat,
           lgtyp    TYPE lqua-lgtyp,
           ltypt    TYPE t301t-ltypt,
           prio     TYPE i,
           source   TYPE c LENGTH 30,
           lgtkz    TYPE mlgn-ltkza,
           stk_qty  TYPE resb-bdmng,
           unit_cnt TYPE i,
           status   TYPE c LENGTH 35,
         END OF ty_f4_strat.
  DATA: lt_f4_strat TYPE STANDARD TABLE OF ty_f4_strat,
        ls_f4_s     TYPE ty_f4_strat.

  " Aggregate available stock and unit count per storage type
  SELECT lgtyp, SUM( gesme ) AS sum_stk, COUNT( * ) AS cnt_unit
    FROM lqua
    WHERE matnr = @gs_sel_item-matnr
      AND ( @p_whse IS INITIAL OR lgnum = @p_whse )
      AND ( @gs_sel_item-lgort IS INITIAL OR lgort = @gs_sel_item-lgort )
      AND gesme > 0
    GROUP BY lgtyp
    INTO TABLE @DATA(lt_lq_sum).

  LOOP AT gt_strategy_stg INTO DATA(ls_strat).
    CLEAR ls_f4_s.
    ls_f4_s-lgtyp  = ls_strat-lgtyp.
    ls_f4_s-ltypt  = ls_strat-ltypt.
    ls_f4_s-prio   = ls_strat-prio.
    ls_f4_s-source = ls_strat-source.
    ls_f4_s-lgtkz  = ls_strat-lgtkz.

    READ TABLE lt_lq_sum INTO DATA(ls_lqs) WITH KEY lgtyp = ls_strat-lgtyp.
    IF sy-subrc = 0.
      ls_f4_s-stk_qty  = ls_lqs-sum_stk.
      ls_f4_s-unit_cnt = ls_lqs-cnt_unit.
    ENDIF.

    IF ls_strat-lgtyp = gv_pref_stg.
      ls_f4_s-status = |@01@ Primary Strategy ({ gv_pref_stg })|.
    ELSEIF ls_f4_s-stk_qty > 0.
      ls_f4_s-status = '@01@ Available Stock'.
    ELSE.
      ls_f4_s-status = '@09@ Configured (No Stock)'.
    ENDIF.

    APPEND ls_f4_s TO lt_f4_strat.
  ENDLOOP.

  " Also add other active storage types in Whse/SLoc
  LOOP AT lt_lq_sum INTO DATA(ls_lq_rem) WHERE NOT ( lgtyp CP '9*' ) AND lgtyp <> 'OH1'.
    READ TABLE lt_f4_strat WITH KEY lgtyp = ls_lq_rem-lgtyp TRANSPORTING NO FIELDS.
    IF sy-subrc <> 0.
      CLEAR ls_f4_s.
      ls_f4_s-lgtyp    = ls_lq_rem-lgtyp.
      ls_f4_s-prio     = 5.
      ls_f4_s-source   = 'Whse SLoc Stock'.
      ls_f4_s-stk_qty  = ls_lq_rem-sum_stk.
      ls_f4_s-unit_cnt = ls_lq_rem-cnt_unit.
      ls_f4_s-status   = '@01@ Available Stock'.
      SELECT SINGLE ltypt FROM t301t
        WHERE lgnum = @p_whse AND lgtyp = @ls_lq_rem-lgtyp AND ( spras = @sy-langu OR spras = 'E' )
        INTO @ls_f4_s-ltypt.
      APPEND ls_f4_s TO lt_f4_strat.
    ENDIF.
  ENDLOOP.

  SORT lt_f4_strat BY prio ASCENDING stk_qty DESCENDING.

  DATA: lr_salv_strat TYPE REF TO cl_salv_table.
  TRY.
      cl_salv_table=>factory(
        IMPORTING r_salv_table = lr_salv_strat
        CHANGING  t_table      = lt_f4_strat ).

      lr_salv_strat->set_screen_popup(
        start_column = 15
        end_column   = 115
        start_line   = 5
        end_line     = 20 ).

      DATA(lr_c) = lr_salv_strat->get_columns( ).
      lr_c->set_optimize( abap_true ).

      DATA(lr_d) = lr_salv_strat->get_display_settings( ).
      lr_d->set_striped_pattern( abap_true ).
      lr_d->set_list_header( |Storage Strategies for Stock Removal & Placement - { gs_sel_item-matnr ALPHA = OUT }| ).

      lr_salv_strat->display( ).
    CATCH cx_salv_msg.
  ENDTRY.
ENDFORM.

*&---------------------------------------------------------------------*
*& Form: f4_handling_unit
*& Description: Custom F4 Search Help filtering HUs by Reservation Item
*&---------------------------------------------------------------------*
FORM f4_handling_unit.
  DATA: lt_f4_hu TYPE STANDARD TABLE OF ty_f4_hu,
        lt_ret   TYPE STANDARD TABLE OF ddshretval,
        ls_ret   TYPE ddshretval,
        lt_dynp  TYPE STANDARD TABLE OF dynpread,
        ls_dynp  TYPE dynpread.

  IF gs_sel_item-matnr IS INITIAL.
    MESSAGE 'Please select a Reservation item first' TYPE 'S' DISPLAY LIKE 'E'.
    EXIT.
  ENDIF.

  " 0. Accurately determine FROM Warehouse Code (p_whse) & Preferred Storage Type (gv_pref_stg)
  PERFORM determine_whse_and_pref_stg.

  " 1. Query HUs in stock matching the reservation item material and plant
  IF gs_sel_item-lgort IS NOT INITIAL AND gs_sel_item-charg IS NOT INITIAL.
    SELECT k~exidv, p~charg, p~vemng, p~vemeh, p~werks, p~lgort, k~status, p~matnr
      FROM vepo AS p
      INNER JOIN vekp AS k ON p~venum = k~venum
      WHERE p~matnr = @gs_sel_item-matnr
        AND p~werks = @gs_sel_item-werks
        AND p~lgort = @gs_sel_item-lgort
        AND p~charg = @gs_sel_item-charg
        AND k~status = '0020'
      INTO CORRESPONDING FIELDS OF TABLE @lt_f4_hu.
  ELSEIF gs_sel_item-lgort IS NOT INITIAL.
    SELECT k~exidv, p~charg, p~vemng, p~vemeh, p~werks, p~lgort, k~status, p~matnr
      FROM vepo AS p
      INNER JOIN vekp AS k ON p~venum = k~venum
      WHERE p~matnr = @gs_sel_item-matnr
        AND p~werks = @gs_sel_item-werks
        AND p~lgort = @gs_sel_item-lgort
        AND k~status = '0020'
      INTO CORRESPONDING FIELDS OF TABLE @lt_f4_hu.
  ELSEIF gs_sel_item-charg IS NOT INITIAL.
    SELECT k~exidv, p~charg, p~vemng, p~vemeh, p~werks, p~lgort, k~status, p~matnr
      FROM vepo AS p
      INNER JOIN vekp AS k ON p~venum = k~venum
      WHERE p~matnr = @gs_sel_item-matnr
        AND p~werks = @gs_sel_item-werks
        AND p~charg = @gs_sel_item-charg
        AND k~status = '0020'
      INTO CORRESPONDING FIELDS OF TABLE @lt_f4_hu.
  ELSE.
    SELECT k~exidv, p~charg, p~vemng, p~vemeh, p~werks, p~lgort, k~status, p~matnr
      FROM vepo AS p
      INNER JOIN vekp AS k ON p~venum = k~venum
      WHERE p~matnr = @gs_sel_item-matnr
        AND p~werks = @gs_sel_item-werks
        AND k~status = '0020'
      INTO CORRESPONDING FIELDS OF TABLE @lt_f4_hu.
  ENDIF.

  " Fallback: If no status 0020 found, search active HUs not goods-issued in FROM SLoc
  IF lt_f4_hu IS INITIAL.
    SELECT k~exidv, p~charg, p~vemng, p~vemeh, p~werks, p~lgort, k~status, p~matnr
      FROM vepo AS p
      INNER JOIN vekp AS k ON p~venum = k~venum
      WHERE p~matnr = @gs_sel_item-matnr
        AND p~werks = @gs_sel_item-werks
        AND ( @gs_sel_item-lgort IS INITIAL OR p~lgort = @gs_sel_item-lgort )
        AND k~status <> '0050'
        AND k~status <> '0060'
      INTO CORRESPONDING FIELDS OF TABLE @lt_f4_hu.
  ENDIF.

  " 2. Query Storage Units (SU / SUT-managed items) from LQUA
  TYPES: BEGIN OF ty_lqua_f4_su,
           lgnum TYPE lqua-lgnum,
           lgtyp TYPE lqua-lgtyp,
           lgpla TYPE lqua-lgpla,
           lenum TYPE lqua-lenum,
           charg TYPE lqua-charg,
           gesme TYPE lqua-gesme,
           meins TYPE lqua-meins,
           werks TYPE lqua-werks,
           lgort TYPE lqua-lgort,
           letyp TYPE lqua-letyp,
           kzhuq TYPE lqua-kzhuq,
         END OF ty_lqua_f4_su.
  DATA: lt_lqua_f4_su TYPE STANDARD TABLE OF ty_lqua_f4_su.

  SELECT lgnum, lgtyp, lgpla, lenum, charg, gesme, meins, werks, lgort, letyp, kzhuq
    FROM lqua
    WHERE matnr = @gs_sel_item-matnr
      AND werks = @gs_sel_item-werks
      AND ( @p_whse IS INITIAL OR lgnum = @p_whse )
      AND ( @gs_sel_item-lgort IS INITIAL OR lgort = @gs_sel_item-lgort )
      AND ( @gs_sel_item-charg IS INITIAL OR charg = @gs_sel_item-charg )
      AND lenum <> @space
      AND gesme > 0
    INTO TABLE @lt_lqua_f4_su.

  " Preload SUT descriptions from T307T
  DATA: lt_t307t_f4 TYPE HASHED TABLE OF t307t
                    WITH UNIQUE KEY spras lgnum letyp.
  IF lt_lqua_f4_su IS NOT INITIAL.
    SELECT spras, lgnum, letyp, letyt
      FROM t307t
      FOR ALL ENTRIES IN @lt_lqua_f4_su
      WHERE spras = @sy-langu
        AND lgnum = @lt_lqua_f4_su-lgnum
        AND letyp = @lt_lqua_f4_su-letyp
      INTO TABLE @lt_t307t_f4.
  ENDIF.

  " 3. Populate Serial Numbers for candidate HUs from SER06 & OBJK
  TYPES: BEGIN OF ty_ser_map_f4,
           exidv TYPE ser06-exidv,
           sernr TYPE gernr,
         END OF ty_ser_map_f4.
  DATA: lt_ser_map TYPE STANDARD TABLE OF ty_ser_map_f4.

  IF lt_f4_hu IS NOT INITIAL.
    SELECT s~exidv, o~sernr
      FROM ser06 AS s
      INNER JOIN objk AS o ON s~obknr = o~obknr
      FOR ALL ENTRIES IN @lt_f4_hu
      WHERE s~exidv = @lt_f4_hu-exidv
      INTO TABLE @lt_ser_map.

    SORT lt_ser_map BY exidv.
  ENDIF.

  " 4. Update HUs with Unit Type, Bin and SUT
  LOOP AT lt_f4_hu ASSIGNING FIELD-SYMBOL(<fs_f4>).
    <fs_f4>-unit_type = 'HU'.

    " Match Serial Number
    READ TABLE lt_ser_map INTO DATA(ls_sm)
      WITH KEY exidv = <fs_f4>-exidv
      BINARY SEARCH.
    IF sy-subrc = 0.
      <fs_f4>-sernr = ls_sm-sernr.
    ENDIF.

    " Match LQUA Quant by LENUM (padded and raw)
    DATA: lv_lenum_f4 TYPE lqua-lenum.
    CALL FUNCTION 'CONVERSION_EXIT_ALPHA_INPUT'
      EXPORTING input  = <fs_f4>-exidv
      IMPORTING output = lv_lenum_f4.

    READ TABLE lt_lqua_f4_su INTO DATA(ls_lq4)
      WITH KEY lenum = lv_lenum_f4.
    IF sy-subrc <> 0.
      READ TABLE lt_lqua_f4_su INTO ls_lq4
        WITH KEY lenum = <fs_f4>-exidv.
    ENDIF.

    IF sy-subrc = 0.
      <fs_f4>-lgtyp = ls_lq4-lgtyp.
      <fs_f4>-lgpla = ls_lq4-lgpla.
      <fs_f4>-sut   = ls_lq4-letyp.
      ASSIGN lt_t307t_f4[ spras = sy-langu lgnum = ls_lq4-lgnum letyp = ls_lq4-letyp ] TO FIELD-SYMBOL(<fs_tt_hu>).
      IF sy-subrc = 0.
        <fs_f4>-sut_tx = <fs_tt_hu>-letyt.
      ENDIF.
    ELSE.
      <fs_f4>-lgtyp = 'STG'.
      <fs_f4>-lgpla = |FLOOR / { <fs_f4>-lgort }|.
    ENDIF.

    " Categorize Stock Status & Priority
    IF <fs_f4>-lgtyp = gv_pref_stg.
      <fs_f4>-stg_stat  = |@01@ Avail({ gv_pref_stg })|.
      <fs_f4>-sort_prio = 1.
    ELSEIF <fs_f4>-lgtyp = 'OH1' OR <fs_f4>-lgpla CS 'HOLD' OR <fs_f4>-lgpla CS 'BLOCK'.
      <fs_f4>-stg_stat  = '@02@ On-Hold'.
      <fs_f4>-sort_prio = 4.
    ELSEIF <fs_f4>-lgtyp CP '9*' OR <fs_f4>-lgtyp = '911' OR <fs_f4>-lgtyp = '902'.
      <fs_f4>-stg_stat  = |@08@ InProc({ <fs_f4>-lgtyp })|.
      <fs_f4>-sort_prio = 3.
    ELSE.
      <fs_f4>-stg_stat  = |@01@ Avail({ <fs_f4>-lgtyp })|.
      <fs_f4>-sort_prio = 2.
    ENDIF.
  ENDLOOP.

  " 5. Append pure Storage Units (SUs) from LQUA not already present in HUs
  LOOP AT lt_lqua_f4_su INTO DATA(ls_su).
    DATA: lv_su_padded TYPE lqua-lenum,
          lv_su_raw    TYPE string.
    lv_su_padded = ls_su-lenum.
    lv_su_raw    = |{ ls_su-lenum ALPHA = OUT }|.

    READ TABLE lt_f4_hu TRANSPORTING NO FIELDS
      WITH KEY exidv = lv_su_padded.
    IF sy-subrc <> 0.
      READ TABLE lt_f4_hu TRANSPORTING NO FIELDS
        WITH KEY exidv = lv_su_raw.
    ENDIF.

    IF sy-subrc <> 0 AND ls_su-kzhuq <> 'X'.
      DATA: ls_f4_su TYPE ty_f4_hu.
      CLEAR ls_f4_su.
      ls_f4_su-exidv     = ls_su-lenum.
      ls_f4_su-charg     = ls_su-charg.
      ls_f4_su-vemng     = ls_su-gesme.
      ls_f4_su-vemeh     = ls_su-meins.
      ls_f4_su-werks     = ls_su-werks.
      ls_f4_su-lgort     = ls_su-lgort.
      ls_f4_su-status    = '0020'.
      ls_f4_su-matnr     = gs_sel_item-matnr.
      ls_f4_su-lgtyp     = ls_su-lgtyp.
      ls_f4_su-lgpla     = ls_su-lgpla.
      ls_f4_su-unit_type = 'SU'.
      ls_f4_su-sut       = ls_su-letyp.
      ASSIGN lt_t307t_f4[ spras = sy-langu lgnum = ls_su-lgnum letyp = ls_su-letyp ] TO FIELD-SYMBOL(<fs_tt_su>).
      IF sy-subrc = 0.
        ls_f4_su-sut_tx = <fs_tt_su>-letyt.
      ENDIF.

      IF ls_f4_su-lgtyp = gv_pref_stg.
        ls_f4_su-stg_stat  = |@01@ Avail({ gv_pref_stg })|.
        ls_f4_su-sort_prio = 1.
      ELSEIF ls_f4_su-lgtyp = 'OH1' OR ls_f4_su-lgpla CS 'HOLD' OR ls_f4_su-lgpla CS 'BLOCK'.
        ls_f4_su-stg_stat  = '@02@ On-Hold'.
        ls_f4_su-sort_prio = 4.
      ELSEIF ls_f4_su-lgtyp CP '9*' OR ls_f4_su-lgtyp = '911' OR ls_f4_su-lgtyp = '902'.
        ls_f4_su-stg_stat  = |@08@ InProc({ ls_f4_su-lgtyp })|.
        ls_f4_su-sort_prio = 3.
      ELSE.
        ls_f4_su-stg_stat  = |@01@ Avail({ ls_f4_su-lgtyp })|.
        ls_f4_su-sort_prio = 2.
      ENDIF.
      APPEND ls_f4_su TO lt_f4_hu.
    ENDIF.
  ENDLOOP.

  IF lt_f4_hu IS INITIAL.
    IF gs_sel_item-lgort IS NOT INITIAL.
      MESSAGE |No active HUs or SUs found for Material { gs_sel_item-matnr } in FROM SLoc { gs_sel_item-lgort }|
        TYPE 'S' DISPLAY LIKE 'E'.
    ELSE.
      MESSAGE |No active HUs or SUs found for Material { gs_sel_item-matnr }|
        TYPE 'S' DISPLAY LIKE 'E'.
    ENDIF.
    EXIT.
  ENDIF.

  " Sort candidate units so Available in Preferred Storage Type appears FIRST!
  SORT lt_f4_hu BY sort_prio ASCENDING exidv ASCENDING.

  " Display custom F4 search help dialog with Unit Type, SUT, Serial Numbers and Status
  CALL FUNCTION 'F4IF_INT_TABLE_VALUE_REQUEST'
    EXPORTING
      retfield        = 'EXIDV'
      dynpprog        = sy-repid
      dynpnr          = sy-dynnr
      dynprofield     = 'P_EXIDV'
      value_org       = 'S'
    TABLES
      value_tab       = lt_f4_hu
      return_tab      = lt_ret
    EXCEPTIONS
      parameter_error = 1
      no_values_found = 2
      OTHERS          = 3.

  IF sy-subrc = 0 AND lt_ret IS NOT INITIAL.
    READ TABLE lt_ret INTO ls_ret INDEX 1.
    p_exidv = ls_ret-fieldval.
    PERFORM validate_handling_unit.

    " Immediately reflect verified Unit and SUT fields on the screen
    CLEAR lt_dynp.

    CLEAR ls_dynp.
    ls_dynp-fieldname  = 'P_EXIDV'.
    ls_dynp-fieldvalue = p_exidv.
    APPEND ls_dynp TO lt_dynp.

    CLEAR ls_dynp.
    ls_dynp-fieldname  = 'P_UTYP'.
    ls_dynp-fieldvalue = p_utyp.
    APPEND ls_dynp TO lt_dynp.

    CLEAR ls_dynp.
    ls_dynp-fieldname  = 'P_SUT'.
    ls_dynp-fieldvalue = p_sut.
    APPEND ls_dynp TO lt_dynp.

    CLEAR ls_dynp.
    ls_dynp-fieldname  = 'P_SUT_TX'.
    ls_dynp-fieldvalue = p_sut_tx.
    APPEND ls_dynp TO lt_dynp.

    CLEAR ls_dynp.
    ls_dynp-fieldname  = 'P_HUSER'.
    ls_dynp-fieldvalue = p_huser.
    APPEND ls_dynp TO lt_dynp.

    CLEAR ls_dynp.
    ls_dynp-fieldname  = 'P_HUQTY'.
    ls_dynp-fieldvalue = |{ p_huqty }|.
    APPEND ls_dynp TO lt_dynp.

    CLEAR ls_dynp.
    ls_dynp-fieldname  = 'P_HUBAT'.
    ls_dynp-fieldvalue = p_hubat.
    APPEND ls_dynp TO lt_dynp.

    CLEAR ls_dynp.
    ls_dynp-fieldname  = 'P_FRLOC'.
    ls_dynp-fieldvalue = p_frloc.
    APPEND ls_dynp TO lt_dynp.

    CLEAR ls_dynp.
    ls_dynp-fieldname  = 'P_PSTG'.
    ls_dynp-fieldvalue = p_pstg.
    APPEND ls_dynp TO lt_dynp.

    CLEAR ls_dynp.
    ls_dynp-fieldname  = 'P_TQTY'.
    ls_dynp-fieldvalue = |{ p_tqty }|.
    APPEND ls_dynp TO lt_dynp.

    CALL FUNCTION 'DYNP_VALUES_UPDATE'
      EXPORTING
        dyname     = sy-repid
        dynumb     = sy-dynnr
      TABLES
        dynpfields = lt_dynp
      EXCEPTIONS
        OTHERS     = 0.
  ENDIF.
ENDFORM.

*&---------------------------------------------------------------------*
*& Form: validate_handling_unit
*& Description: Validates both Handling Units (VEKP) and Storage Units (LQUA)
*&              and extracts Unit Type, SUT, Material, Batch, and Bin Info
*&---------------------------------------------------------------------*
FORM validate_handling_unit.
  DATA: lv_exidv TYPE vekp-exidv.

  lv_exidv = p_exidv.
  CALL FUNCTION 'CONVERSION_EXIT_ALPHA_INPUT'
    EXPORTING
      input  = lv_exidv
    IMPORTING
      output = lv_exidv.
  p_exidv = lv_exidv.

  CLEAR: gv_venum, gv_hu_matnr, gv_hu_charg, gv_hu_qty, gv_hu_meins,
         gv_hu_lgort, gv_hu_werks, gv_hu_valid, gv_hu_sernr, p_huser,
         gv_unit_type, gv_letyp, gv_letyt, p_utyp, p_sut, p_sut_tx.

  DATA: lv_vfy_lgnum TYPE lqua-lgnum,
        lv_vfy_lgtyp TYPE lqua-lgtyp,
        lv_vfy_lgpla TYPE lqua-lgpla.

  " 1. Check if Unit is a Handling Unit (VEKP)
  SELECT SINGLE venum, status, werks, lgort
    FROM vekp
    WHERE exidv = @p_exidv
    INTO (@gv_venum, @DATA(lv_status), @DATA(lv_kp_werks), @DATA(lv_kp_lgort)).

  IF sy-subrc = 0.
    gv_unit_type = 'HU'.
    p_utyp       = 'Handling Unit (HU)'.

    IF lv_status = '0050'.
      lcl_ui_helper=>show_error_popup(
        iv_title = 'HU Already Issued'
        iv_msg1  = |Handling Unit { p_exidv } is already Goods Issued (Status 0050).|
        iv_msg2  = 'Please select an in-stock Handling Unit (Status 0020).' ).
      EXIT.
    ENDIF.

    " Check HU items from VEPO
    SELECT SINGLE matnr, charg, vemng, vemeh, werks, lgort
      FROM vepo
      WHERE venum = @gv_venum
      INTO (@gv_hu_matnr, @gv_hu_charg, @gv_hu_qty, @gv_hu_meins, @gv_hu_werks, @gv_hu_lgort).

    IF sy-subrc <> 0.
      lcl_ui_helper=>show_error_popup(
        iv_title = 'Empty Handling Unit'
        iv_msg1  = |No material items or contents found in Handling Unit { p_exidv }.|
        iv_msg2  = 'Please verify the Handling Unit in HUM.' ).
      EXIT.
    ENDIF.

    p_huqty = gv_hu_qty.
    p_hubat = gv_hu_charg.

    " Fetch Serial Number assigned to HU from SER06 + OBJK
    SELECT SINGLE o~sernr
      FROM ser06 AS s
      INNER JOIN objk AS o ON s~obknr = o~obknr
      WHERE s~exidv = @p_exidv
      INTO @gv_hu_sernr.
    IF sy-subrc <> 0.
      CLEAR gv_hu_sernr.
    ENDIF.
    p_huser = gv_hu_sernr.

    " Query LQUA for Storage Type, Bin, and Storage Unit Type (SUT)
    DATA: lv_lenum_hu TYPE lqua-lenum.
    CALL FUNCTION 'CONVERSION_EXIT_ALPHA_INPUT'
      EXPORTING input  = p_exidv
      IMPORTING output = lv_lenum_hu.

    SELECT SINGLE lgnum, lgtyp, lgpla, letyp
      FROM lqua
      WHERE matnr = @gs_sel_item-matnr
        AND ( @p_whse IS INITIAL OR lgnum = @p_whse )
        AND ( lenum = @lv_lenum_hu OR lenum = @p_exidv )
      INTO (@lv_vfy_lgnum, @lv_vfy_lgtyp, @lv_vfy_lgpla, @gv_letyp).

    IF gv_letyp IS NOT INITIAL.
      SELECT SINGLE letyt FROM t307t
        WHERE spras = @sy-langu
          AND lgnum = @lv_vfy_lgnum
          AND letyp = @gv_letyp
        INTO @gv_letyt.
    ENDIF.
    p_sut    = gv_letyp.
    p_sut_tx = gv_letyt.

  ELSE.
    " 2. If not found in VEKP, check if Unit is a Storage Unit (LQUA)
    DATA: lv_lenum_su TYPE lqua-lenum.
    CALL FUNCTION 'CONVERSION_EXIT_ALPHA_INPUT'
      EXPORTING input  = p_exidv
      IMPORTING output = lv_lenum_su.

    SELECT SINGLE matnr, charg, gesme, meins, werks, lgort, lgnum, lgtyp, lgpla, letyp
      FROM lqua
      WHERE ( lenum = @lv_lenum_su OR lenum = @p_exidv )
        AND ( @p_whse IS INITIAL OR lgnum = @p_whse )
        AND gesme > 0
      INTO (@gv_hu_matnr, @gv_hu_charg, @gv_hu_qty, @gv_hu_meins,
            @gv_hu_werks, @gv_hu_lgort, @lv_vfy_lgnum, @lv_vfy_lgtyp, @lv_vfy_lgpla, @gv_letyp).

    IF sy-subrc = 0.
      gv_unit_type = 'SU'.
      p_utyp       = 'Storage Unit (SU)'.
      p_huqty      = gv_hu_qty.
      p_hubat      = gv_hu_charg.

      IF gv_letyp IS NOT INITIAL.
        SELECT SINGLE letyt FROM t307t
          WHERE spras = @sy-langu
            AND lgnum = @lv_vfy_lgnum
            AND letyp = @gv_letyp
          INTO @gv_letyt.
      ENDIF.
      p_sut    = gv_letyp.
      p_sut_tx = gv_letyt.

    ELSE.
      lcl_ui_helper=>show_error_popup(
        iv_title = 'Invalid Unit Number'
        iv_msg1  = |Scanned unit "{ p_exidv }" does not exist in VEKP (HU) or LQUA (Storage Unit).|
        iv_msg2  = 'Please scan or enter a valid Handling Unit or Storage Unit number.' ).
      EXIT.
    ENDIF.
  ENDIF.

  " 3. Check Source Storage Location (must match reservation source if specified)
  IF gs_sel_item-lgort IS NOT INITIAL.
    IF gv_hu_lgort <> gs_sel_item-lgort.
      lcl_ui_helper=>show_error_popup(
        iv_title = 'Storage Location Mismatch'
        iv_msg1  = |{ gv_unit_type } { p_exidv } is located in SLoc { gv_hu_lgort },|
        iv_msg2  = |but Reservation requires Source SLoc { gs_sel_item-lgort }.|
        iv_msg3  = |Please select a { gv_unit_type } located in the correct storage location.| ).
      EXIT.
    ENDIF.
  ELSE.
    " If reservation source SLoc was blank, adopt unit storage location
    p_frloc = gv_hu_lgort.
  ENDIF.

  " 4. Check Material Code match
  IF gv_hu_matnr <> gs_sel_item-matnr.
    lcl_ui_helper=>show_error_popup(
      iv_title = 'Material Mismatch'
      iv_msg1  = |{ gv_unit_type } Material ({ gv_hu_matnr }) does not match Reservation ({ gs_sel_item-matnr }).|
      iv_msg2  = |Please scan a { gv_unit_type } containing the reservation material.| ).
    EXIT.
  ENDIF.

  " 5. Check Batch (if specified in reservation)
  IF gs_sel_item-charg IS NOT INITIAL AND gv_hu_charg <> gs_sel_item-charg.
    lcl_ui_helper=>show_error_popup(
      iv_title = 'Batch Mismatch'
      iv_msg1  = |{ gv_unit_type } Batch ({ gv_hu_charg }) does not match Reservation Batch ({ gs_sel_item-charg }).|
      iv_msg2  = |Please scan a { gv_unit_type } with the requested batch.| ).
    EXIT.
  ENDIF.

  " 6. Default transfer quantity if full indicator selected
  IF p_full = 'X'.
    IF gv_hu_qty <= gs_sel_item-open_qty.
      p_tqty = gv_hu_qty.
    ELSE.
      p_tqty = gs_sel_item-open_qty.
    ENDIF.
  ENDIF.

  " 7. Validate Warehouse Storage Type & Stock Priority Status
  gv_hu_valid = abap_true.
  DATA: lv_sut_info TYPE string.
  IF gv_letyp IS NOT INITIAL.
    IF gv_letyt IS NOT INITIAL.
      lv_sut_info = | [SUT: { gv_letyp } - { gv_letyt }]|.
    ELSE.
      lv_sut_info = | [SUT: { gv_letyp }]|.
    ENDIF.
  ENDIF.

  IF lv_vfy_lgtyp = gv_pref_stg.
    IF gv_hu_sernr IS NOT INITIAL.
      MESSAGE |{ gv_unit_type } { p_exidv } in Pref. Stg { gv_pref_stg } (Bin: { lv_vfy_lgpla }, SN: { gv_hu_sernr }){ lv_sut_info }| TYPE 'S'.
    ELSE.
      MESSAGE |{ gv_unit_type } { p_exidv } in Pref. Stg { gv_pref_stg } (Bin: { lv_vfy_lgpla }){ lv_sut_info }! Avail: { p_huqty } { gv_hu_meins }| TYPE 'S'.
    ENDIF.
  ELSEIF lv_vfy_lgtyp = 'OH1' OR lv_vfy_lgpla CS 'HOLD' OR lv_vfy_lgpla CS 'BLOCK'.
    MESSAGE |Warning: Scanned { gv_unit_type } { p_exidv } is ON-HOLD in Storage Type { lv_vfy_lgtyp } (Bin { lv_vfy_lgpla }){ lv_sut_info }!| TYPE 'W'.
  ELSEIF lv_vfy_lgtyp CP '9*' OR lv_vfy_lgtyp = '911' OR lv_vfy_lgtyp = '902'.
    MESSAGE |Notice: Scanned { gv_unit_type } { p_exidv } is IN-PROCESS in Storage Type { lv_vfy_lgtyp } (Bin { lv_vfy_lgpla }){ lv_sut_info }| TYPE 'I'.
  ELSEIF lv_vfy_lgtyp IS NOT INITIAL.
    IF gv_hu_sernr IS NOT INITIAL.
      MESSAGE |{ gv_unit_type } { p_exidv } in Stg { lv_vfy_lgtyp } (Bin: { lv_vfy_lgpla }, SN: { gv_hu_sernr }){ lv_sut_info }! Avail: { p_huqty } { gv_hu_meins }| TYPE 'S'.
    ELSE.
      MESSAGE |{ gv_unit_type } { p_exidv } in Stg { lv_vfy_lgtyp } (Bin: { lv_vfy_lgpla }){ lv_sut_info }! Avail: { p_huqty } { gv_hu_meins }| TYPE 'S'.
    ENDIF.
  ELSE.
    IF gv_hu_sernr IS NOT INITIAL.
      MESSAGE |{ gv_unit_type } { p_exidv } verified! Serial: { gv_hu_sernr }, Avail: { p_huqty } { gv_hu_meins }{ lv_sut_info }| TYPE 'S'.
    ELSE.
      MESSAGE |{ gv_unit_type } { p_exidv } verified successfully! Available: { p_huqty } { gv_hu_meins }{ lv_sut_info }| TYPE 'S'.
    ENDIF.
  ENDIF.
ENDFORM.

*&---------------------------------------------------------------------*
*& Form: execute_stock_transfer
*&---------------------------------------------------------------------*
FORM execute_stock_transfer.
  " Pre-validations
  IF p_exidv IS INITIAL.
    lcl_ui_helper=>show_error_popup(
      iv_title = 'Missing Unit'
      iv_msg1  = 'Please scan or select a Unit (HU / SU) before posting.' ).
    EXIT.
  ENDIF.

  PERFORM validate_handling_unit.

  IF gv_hu_valid <> abap_true.
    lcl_ui_helper=>show_error_popup(
      iv_title = 'Unit Validation Failed'
      iv_msg1  = 'The scanned Unit could not be validated for this reservation.'
      iv_msg2  = 'Please verify Unit number, material, batch, and status.' ).
    EXIT.
  ENDIF.

  IF p_tqty <= 0.
    lcl_ui_helper=>show_error_popup(
      iv_title = 'Invalid Transfer Quantity'
      iv_msg1  = 'Please specify a valid Transfer Quantity greater than 0.' ).
    EXIT.
  ENDIF.

  IF p_tqty > p_huqty.
    lcl_ui_helper=>show_error_popup(
      iv_title = 'Quantity Exceeds Unit Stock'
      iv_msg1  = |Transfer Qty ({ p_tqty }) exceeds available { gv_unit_type } Qty ({ p_huqty }).|
      iv_msg2  = |Reduce transfer quantity or select a different { gv_unit_type }.| ).
    EXIT.
  ENDIF.

  IF p_tqty > p_opqty.
    lcl_ui_helper=>show_error_popup(
      iv_title = 'Quantity Exceeds Reservation'
      iv_msg1  = |Transfer Qty ({ p_tqty }) exceeds Reservation Open Qty ({ p_opqty }).|
      iv_msg2  = 'Reduce transfer quantity to match reservation requirements.' ).
    EXIT.
  ENDIF.

  " Determine Storage Locations
  DATA: lv_src_lgort TYPE resb-lgort,
        lv_dst_lgort TYPE resb-umlgo.

  IF gs_sel_item-lgort IS NOT INITIAL.
    lv_src_lgort = gs_sel_item-lgort.
  ELSE.
    lv_src_lgort = gv_hu_lgort.
  ENDIF.

  IF gs_sel_item-umlgo IS NOT INITIAL.
    lv_dst_lgort = gs_sel_item-umlgo.
  ELSE.
    lv_dst_lgort = p_toloc.
  ENDIF.

  " Format Keys with standard conversion exits
  DATA: lv_matnr_conv TYPE matnr,
        lv_rsnum_conv TYPE resb-rsnum,
        lv_posted_doc TYPE mblnr,
        lv_posted_yr  TYPE mjahr.

  lv_matnr_conv = gs_sel_item-matnr.
  CALL FUNCTION 'CONVERSION_EXIT_MATN1_INPUT'
    EXPORTING
      input  = lv_matnr_conv
    IMPORTING
      output = lv_matnr_conv.

  lv_rsnum_conv = gs_sel_item-rsnum.
  CALL FUNCTION 'CONVERSION_EXIT_ALPHA_INPUT'
    EXPORTING
      input  = lv_rsnum_conv
    IMPORTING
      output = lv_rsnum_conv.

  " Check if source storage location is Handling Unit Managed (T001L-XHUPF = 'X')
  DATA: lv_src_xhupf TYPE t001l-xhupf.
  SELECT SINGLE xhupf FROM t001l
    WHERE werks = @gs_sel_item-werks
      AND lgort = @lv_src_lgort
    INTO @lv_src_xhupf.

  DATA: lv_err_txt TYPE string.

  IF gv_unit_type = 'HU' AND lv_src_xhupf = 'X'.
    " ------------------------------------------------------------------
    " PATH 1: Handling Unit Managed (HUM) Transfer (Movement 311)
    " Standard SAP FM HU_CREATE_GOODS_MOVEMENT (Event 0006 SLoc to SLoc)
    " ------------------------------------------------------------------
    DATA: lt_ext_hu TYPE hum_exidv_t,
          lt_mov_to TYPE hum_data_move_to_t,
          ls_mov_to TYPE hum_data_move_to,
          lf_posted TYPE sysubrc,
          ls_hu_msg TYPE huitem_messages,
          lt_hu_msg TYPE huitem_messages_t,
          ls_emkpf  TYPE emkpf.

    DATA(lv_mvt) = COND bwart( WHEN gs_sel_item-bwart IS NOT INITIAL THEN gs_sel_item-bwart
                               WHEN p_bwart IS NOT INITIAL THEN p_bwart
                               ELSE '311' ).

    APPEND p_exidv TO lt_ext_hu.
    ls_mov_to-huwbevent = '0006'.
    ls_mov_to-werks     = gs_sel_item-werks.
    ls_mov_to-lgort     = lv_dst_lgort.
    ls_mov_to-bwart     = lv_mvt.
    APPEND ls_mov_to TO lt_mov_to.

    CALL FUNCTION 'HU_CREATE_GOODS_MOVEMENT'
      EXPORTING
        if_event       = '0006'
        if_commit      = 'X'
        it_external_id = lt_ext_hu
        it_move_to     = lt_mov_to
      IMPORTING
        ef_posted      = lf_posted
        es_message     = ls_hu_msg
        et_messages    = lt_hu_msg
        es_emkpf       = ls_emkpf.

    IF ls_emkpf-mblnr IS NOT INITIAL.
      lv_posted_doc = ls_emkpf-mblnr.
      lv_posted_yr  = ls_emkpf-mjahr.

      " Update Reservation Withdrawn Quantity and Final Issue Indicator
      UPDATE resb
        SET enmng = enmng + @p_tqty
        WHERE rsnum = @lv_rsnum_conv
          AND rspos = @gs_sel_item-rspos.
      IF p_tqty >= gs_sel_item-open_qty.
        UPDATE resb
          SET kzear = 'X'
          WHERE rsnum = @lv_rsnum_conv
            AND rspos = @gs_sel_item-rspos.
      ENDIF.
      COMMIT WORK AND WAIT.
    ELSE.
      " Gather HU Error Messages
      IF ls_hu_msg-msgty CA 'EA'.
        MESSAGE ID ls_hu_msg-msgid TYPE 'S' NUMBER ls_hu_msg-msgno
          WITH ls_hu_msg-msgv1 ls_hu_msg-msgv2 ls_hu_msg-msgv3 ls_hu_msg-msgv4
          INTO lv_err_txt.
      ENDIF.
      LOOP AT lt_hu_msg INTO DATA(ls_m) WHERE msgty CA 'EA'.
        DATA: lv_m_txt TYPE string.
        MESSAGE ID ls_m-msgid TYPE 'S' NUMBER ls_m-msgno
          WITH ls_m-msgv1 ls_m-msgv2 ls_m-msgv3 ls_m-msgv4
          INTO lv_m_txt.
        IF lv_err_txt IS INITIAL.
          lv_err_txt = lv_m_txt.
        ELSE.
          lv_err_txt = |{ lv_err_txt } / { lv_m_txt }|.
        ENDIF.
      ENDLOOP.
    ENDIF.

  ENDIF.

  " If HUM path was not used or did not produce a document, try standard BAPI_GOODSMVT_CREATE
  IF lv_posted_doc IS INITIAL.
    DATA: ls_header  TYPE bapi2017_gm_head_01,
          ls_code    TYPE bapi2017_gm_code,
          lt_item    TYPE STANDARD TABLE OF bapi2017_gm_item_create,
          ls_item    TYPE bapi2017_gm_item_create,
          ls_headret TYPE bapi2017_gm_head_ret,
          lt_return  TYPE STANDARD TABLE OF bapiret2,
          ls_return  TYPE bapiret2.

    ls_header-pstng_date = sy-datum.
    ls_header-doc_date   = sy-datum.
    DATA(lv_hdr_str) = |ST:{ lv_rsnum_conv ALPHA = OUT } { p_exidv }|.
    IF strlen( lv_hdr_str ) > 25.
      ls_header-header_txt = lv_hdr_str(25).
    ELSE.
      ls_header-header_txt = lv_hdr_str.
    ENDIF.

    " Use GM_CODE 06 (MB11) for goods movement with reservation reference
    IF gs_sel_item-rsnum IS NOT INITIAL.
      ls_code-gm_code = '06'.
    ELSE.
      ls_code-gm_code = '04'.
    ENDIF.

    ls_item-material      = lv_matnr_conv(18).
    ls_item-material_long = lv_matnr_conv.
    ls_item-plant         = gs_sel_item-werks.
    ls_item-stge_loc      = lv_src_lgort.
    ls_item-batch         = gv_hu_charg.
    ls_item-move_type     = lv_mvt.
    ls_item-entry_qnt     = p_tqty.
    ls_item-entry_uom     = gs_sel_item-meins.
    ls_item-move_mat      = lv_matnr_conv(18).
    ls_item-move_mat_long = lv_matnr_conv.
    ls_item-move_plant    = gs_sel_item-werks.
    ls_item-move_stloc    = lv_dst_lgort.
    ls_item-move_batch    = gv_hu_charg.
    ls_item-reserv_no     = lv_rsnum_conv.
    ls_item-res_item      = gs_sel_item-rspos.

    IF p_tqty >= gs_sel_item-open_qty.
      ls_item-no_more_gr  = 'X'.
    ENDIF.

    APPEND ls_item TO lt_item.

    CALL FUNCTION 'BAPI_GOODSMVT_CREATE'
      EXPORTING
        goodsmvt_header  = ls_header
        goodsmvt_code    = ls_code
      IMPORTING
        goodsmvt_headret = ls_headret
      TABLES
        goodsmvt_item    = lt_item
        return           = lt_return.

    IF ls_headret-mat_doc IS NOT INITIAL.
      CALL FUNCTION 'BAPI_TRANSACTION_COMMIT'
        EXPORTING
          wait = 'X'.
      lv_posted_doc = ls_headret-mat_doc.
      lv_posted_yr  = ls_headret-doc_year.
    ELSE.
      CALL FUNCTION 'BAPI_TRANSACTION_ROLLBACK'.
      LOOP AT lt_return INTO ls_return WHERE type CA 'EA'.
        IF lv_err_txt IS INITIAL.
          lv_err_txt = |[{ ls_return-id }-{ ls_return-number }] { ls_return-message }|.
        ELSE.
          lv_err_txt = |{ lv_err_txt } / [{ ls_return-id }-{ ls_return-number }] { ls_return-message }|.
        ENDIF.
      ENDLOOP.
    ENDIF.
  ENDIF.

  " Final Evaluation of Posting
  IF lv_posted_doc IS INITIAL.
    IF lv_err_txt IS INITIAL.
      lv_err_txt = 'Posting failed: Material Document could not be generated by SAP.'.
    ENDIF.
    lcl_ui_helper=>show_error_popup(
      iv_title = 'Goods Movement Posting Failed'
      iv_msg1  = 'Stock transfer could not be posted in SAP (BAPI):'
      iv_msg2  = lv_err_txt
      iv_msg3  = 'Please check stock availability, serial status, or batch locks.' ).
    EXIT.
  ENDIF.

  " Success: Send email & mobile notification to Requester
  PERFORM send_requester_notification USING lv_posted_doc lv_posted_yr.

  " Set flag, display success message and return to ALV
  gv_posted = abap_true.
  MESSAGE |Success! Stock Transfer Posted. Mat. Doc: { lv_posted_doc } / { lv_posted_yr } (Alerts sent to { p_usnam })| TYPE 'S'.

  SET SCREEN 0.
  LEAVE SCREEN.
ENDFORM.

*&---------------------------------------------------------------------*
*& Form: send_requester_notification
*& Description: Sends Email & Mobile Notification (SMS / Express)
*&              to the Reservation Requester upon posting
*&---------------------------------------------------------------------*
FORM send_requester_notification USING iv_doc  TYPE mblnr
                                       iv_year TYPE mjahr.
  DATA: lv_requester TYPE sy-uname,
        lv_email     TYPE adr6-smtp_addr,
        lv_mobile    TYPE adr2-tel_number.

  lv_requester = p_usnam.
  IF lv_requester IS INITIAL.
    lv_requester = gs_sel_item-usnam.
  ENDIF.

  IF lv_requester IS INITIAL.
    EXIT.
  ENDIF.

  IF p_uphon IS NOT INITIAL.
    lv_mobile = p_uphon.
  ELSEIF gs_sel_item-u_phone IS NOT INITIAL.
    lv_mobile = gs_sel_item-u_phone.
  ENDIF.

  IF p_umail IS NOT INITIAL.
    lv_email = p_umail.
  ELSEIF gs_sel_item-u_mail IS NOT INITIAL.
    lv_email = gs_sel_item-u_mail.
  ENDIF.

  " 1. Retrieve Requester Details via BAPI if mobile or email missing
  IF lv_email IS INITIAL OR lv_mobile IS INITIAL.
    DATA: ls_address TYPE bapiaddr3,
          lt_return  TYPE STANDARD TABLE OF bapiret2.

    CALL FUNCTION 'BAPI_USER_GET_DETAIL'
      EXPORTING
        username = lv_requester
      IMPORTING
        address  = ls_address
      TABLES
        return   = lt_return.

    IF lv_email IS INITIAL.
      lv_email = ls_address-e_mail.
    ENDIF.
    IF lv_mobile IS INITIAL.
      lv_mobile = ls_address-tel1_numbr.
    ENDIF.
  ENDIF.

  " Fallback to USR21 + ADR6 / ADR2 if BAPI fields were empty
  SELECT SINGLE persnumber, addrnumber
    FROM usr21
    WHERE bname = @lv_requester
    INTO (@DATA(lv_pers), @DATA(lv_addr)).
  IF sy-subrc = 0.
    IF lv_email IS INITIAL.
      SELECT SINGLE smtp_addr
        FROM adr6
        WHERE persnumber = @lv_pers
          AND addrnumber = @lv_addr
        INTO @lv_email.
      IF lv_email IS INITIAL.
        SELECT SINGLE smtp_addr
          FROM adr6
          WHERE addrnumber = @lv_addr
          INTO @lv_email.
      ENDIF.
    ENDIF.
    SELECT SINGLE tel_number
      FROM adr2
      WHERE persnumber = @lv_pers
        AND addrnumber = @lv_addr
        AND r3_user IN ('3', '1')
      INTO @DATA(lv_adr2_mob).
    IF sy-subrc = 0 AND lv_adr2_mob IS NOT INITIAL.
      lv_mobile = lv_adr2_mob.
    ELSEIF lv_mobile IS INITIAL.
      SELECT SINGLE tel_number
        FROM adr2
        WHERE addrnumber = @lv_addr
        INTO @lv_adr2_mob.
      IF sy-subrc = 0 AND lv_adr2_mob IS NOT INITIAL.
        lv_mobile = lv_adr2_mob.
      ENDIF.
    ENDIF.
  ENDIF.

  " Fallback default email domain if user ID maintained without explicit ADR6
  IF lv_email IS INITIAL AND lv_requester IS NOT INITIAL.
    lv_email = |{ to_lower( lv_requester ) }@aether.co.in|.
  ENDIF.

  DATA: lv_mvt TYPE bwart.
  lv_mvt = COND bwart( WHEN gs_sel_item-bwart IS NOT INITIAL THEN gs_sel_item-bwart
                       WHEN p_bwart IS NOT INITIAL THEN p_bwart
                       ELSE '311' ).

  " 2. Prepare Formatted HTML Email Body
  DATA: lt_email_html TYPE soli_tab,
        lt_sms_text   TYPE soli_tab.

  " Resolve full names and clean descriptions
  DATA: lv_op_fullname  TYPE string,
        lv_req_fullname TYPE string,
        lv_clean_maktx  TYPE string.

  lv_clean_maktx = p_maktx.
  REPLACE ALL OCCURRENCES OF '&' IN lv_clean_maktx WITH '&amp;'.
  REPLACE ALL OCCURRENCES OF '<' IN lv_clean_maktx WITH '&lt;'.
  REPLACE ALL OCCURRENCES OF '>' IN lv_clean_maktx WITH '&gt;'.

  DATA: ls_op_addr TYPE bapiaddr3,
        lt_op_ret  TYPE STANDARD TABLE OF bapiret2.
  CALL FUNCTION 'BAPI_USER_GET_DETAIL'
    EXPORTING
      username = sy-uname
    IMPORTING
      address  = ls_op_addr
    TABLES
      return   = lt_op_ret.
  IF ls_op_addr-fullname IS NOT INITIAL.
    lv_op_fullname = ls_op_addr-fullname.
  ELSE.
    lv_op_fullname = sy-uname.
  ENDIF.

  IF p_unam IS NOT INITIAL.
    lv_req_fullname = p_unam.
  ELSEIF ls_address-fullname IS NOT INITIAL.
    lv_req_fullname = ls_address-fullname.
  ELSE.
    lv_req_fullname = lv_requester.
  ENDIF.

  DATA: lv_matnr_clean TYPE string,
        lv_rsnum_clean TYPE string,
        lv_rspos_clean TYPE string,
        lv_tqty_str    TYPE string.

  lv_matnr_clean = |{ p_matnr ALPHA = OUT }|.
  IF lv_matnr_clean IS INITIAL.
    lv_matnr_clean = p_matnr.
  ENDIF.
  lv_rsnum_clean = |{ p_rsnum ALPHA = OUT }|.
  IF lv_rsnum_clean IS INITIAL.
    lv_rsnum_clean = p_rsnum.
  ENDIF.
  lv_rspos_clean = |{ p_rspos ALPHA = OUT }|.
  IF lv_rspos_clean IS INITIAL.
    lv_rspos_clean = p_rspos.
  ENDIF.
  TYPES: BEGIN OF ty_notif_item,
           zeile TYPE mseg-zeile,
           matnr TYPE mseg-matnr,
           maktx TYPE string,
           werks TYPE mseg-werks,
           lgort TYPE mseg-lgort,
           umlgo TYPE mseg-umlgo,
           menge TYPE mseg-menge,
           meins TYPE mseg-meins,
           rsnum TYPE mseg-rsnum,
           rspos TYPE mseg-rspos,
           charg TYPE mseg-charg,
           exidv TYPE vekp-exidv,
           sernr TYPE gernr,
         END OF ty_notif_item.
  DATA: lt_n_items TYPE STANDARD TABLE OF ty_notif_item,
        ls_n_item  TYPE ty_notif_item.

  " 1. Retrieve all transferred line items from MATDOC (Issue lines: SHKZG = 'H')
  SELECT zeile, matnr, werks, lgort, umlgo, menge, meins, rsnum, rspos, charg
    FROM matdoc
    WHERE mblnr = @iv_doc
      AND mjahr = @iv_year
      AND shkzg = 'H'
    ORDER BY zeile
    INTO CORRESPONDING FIELDS OF TABLE @lt_n_items.

  IF lt_n_items IS INITIAL.
    CLEAR ls_n_item.
    ls_n_item-zeile = '0001'.
    ls_n_item-matnr = p_matnr.
    ls_n_item-maktx = lv_clean_maktx.
    ls_n_item-werks = gs_sel_item-werks.
    ls_n_item-lgort = p_frloc.
    ls_n_item-umlgo = p_toloc.
    ls_n_item-menge = p_tqty.
    ls_n_item-meins = p_meins.
    ls_n_item-rsnum = p_rsnum.
    ls_n_item-rspos = p_rspos.
    ls_n_item-charg = p_hubat.
    ls_n_item-exidv = p_exidv.
    ls_n_item-sernr = p_huser.
    APPEND ls_n_item TO lt_n_items.
  ELSE.
    SELECT matnr, maktx FROM makt
      FOR ALL ENTRIES IN @lt_n_items
      WHERE matnr = @lt_n_items-matnr AND spras = @sy-langu
      INTO TABLE @DATA(lt_m_desc).

    LOOP AT lt_n_items ASSIGNING FIELD-SYMBOL(<fs_ni>).
      READ TABLE lt_m_desc INTO DATA(ls_md) WITH KEY matnr = <fs_ni>-matnr.
      IF sy-subrc = 0.
        <fs_ni>-maktx = ls_md-maktx.
        REPLACE ALL OCCURRENCES OF '&' IN <fs_ni>-maktx WITH '&amp;'.
        REPLACE ALL OCCURRENCES OF '<' IN <fs_ni>-maktx WITH '&lt;'.
        REPLACE ALL OCCURRENCES OF '>' IN <fs_ni>-maktx WITH '&gt;'.
      ENDIF.
      IF <fs_ni>-exidv IS INITIAL.
        <fs_ni>-exidv = p_exidv.
      ENDIF.
      IF <fs_ni>-sernr IS INITIAL.
        <fs_ni>-sernr = p_huser.
      ENDIF.
    ENDLOOP.
  ENDIF.

  DATA(lv_num_items) = lines( lt_n_items ).

  APPEND '<!DOCTYPE html>' TO lt_email_html.
  APPEND '<html><head><meta charset="utf-8">' TO lt_email_html.
  APPEND '<meta name="viewport" content="width=device-width, initial-scale=1.0">' TO lt_email_html.
  APPEND '<title>Material Reservation Stock Transfer</title>' TO lt_email_html.
  APPEND '</head>' TO lt_email_html.
  APPEND '<body style="margin:0; padding:0; background-color:#f1f5f9; ' TO lt_email_html.
  APPEND 'font-family:-apple-system, BlinkMacSystemFont, ''Segoe UI'', Roboto, Helvetica, Arial, sans-serif; color:#1e293b;">' TO lt_email_html.
  APPEND '<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" ' TO lt_email_html.
  APPEND 'style="background-color:#f1f5f9; padding:24px 12px;">' TO lt_email_html.
  APPEND '<tr><td align="center">' TO lt_email_html.
  APPEND '<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" ' TO lt_email_html.
  APPEND 'style="max-width:680px; background-color:#ffffff; border-radius:10px; ' TO lt_email_html.
  APPEND 'overflow:hidden; border:1px solid #e2e8f0; box-shadow:0 4px 12px rgba(0,0,0,0.06);">' TO lt_email_html.

  " Header Banner
  APPEND '<tr><td style="background-color:#0f2b46; background:linear-gradient(135deg, #0a192f 0%, #173b63 100%); ' TO lt_email_html.
  APPEND 'padding:22px 26px; border-bottom:3px solid #0284c7;">' TO lt_email_html.
  APPEND '<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0"><tr>' TO lt_email_html.
  APPEND '<td style="vertical-align:middle;">' TO lt_email_html.
  APPEND '<div style="font-size:11px; font-weight:700; letter-spacing:1.5px; color:#38bdf8; text-transform:uppercase; margin-bottom:4px;">' TO lt_email_html.
  APPEND 'AETHER INDUSTRIES LIMITED</div>' TO lt_email_html.
  APPEND '<div style="font-size:19px; font-weight:800; color:#ffffff; line-height:1.2;">' TO lt_email_html.
  APPEND 'Stock Transfer Notification</div>' TO lt_email_html.
  APPEND '<div style="font-size:12px; color:#94a3b8; margin-top:4px;">' TO lt_email_html.
  APPEND 'SAP S/4HANA Logistics Execution Hub</div></td>' TO lt_email_html.
  APPEND '<td style="vertical-align:middle; text-align:right;">' TO lt_email_html.
  IF lv_num_items > 1.
    APPEND '<span style="display:inline-block; background-color:#059669; color:#ffffff; font-size:11px; ' TO lt_email_html.
    APPEND 'font-weight:700; letter-spacing:0.5px; padding:6px 14px; border-radius:20px; text-transform:uppercase; white-space:nowrap;">&#10004; POSTED (' TO lt_email_html.
    APPEND |{ lv_num_items } ITEMS)</span>| TO lt_email_html.
  ELSE.
    APPEND '<span style="display:inline-block; background-color:#059669; color:#ffffff; font-size:11px; ' TO lt_email_html.
    APPEND 'font-weight:700; letter-spacing:0.5px; padding:6px 12px; border-radius:20px; text-transform:uppercase; white-space:nowrap;">' TO lt_email_html.
    APPEND '&#10004; POSTED</span>' TO lt_email_html.
  ENDIF.
  APPEND '</td></tr></table></td></tr>' TO lt_email_html.

  " Salutation
  APPEND '<tr><td style="padding:22px 26px 14px 26px;">' TO lt_email_html.
  APPEND |<p style="margin:0 0 8px 0; font-size:15px; color:#334155; line-height:1.4;">Dear <strong>{ lv_req_fullname }</strong>,</p>| TO lt_email_html.
  APPEND '<p style="margin:0; font-size:13px; color:#64748b; line-height:1.5;">' TO lt_email_html.
  IF lv_num_items > 1.
    APPEND 'Your multi-item material reservation stock transfer has been successfully processed and posted in SAP S/4HANA.' TO lt_email_html.
  ELSE.
    APPEND 'Your material reservation stock transfer has been successfully processed and posted in SAP S/4HANA.' TO lt_email_html.
  ENDIF.
  APPEND '</p></td></tr>' TO lt_email_html.

  " KPI 3-Column Highlights
  APPEND '<tr><td style="padding:0 26px 18px 26px;">' TO lt_email_html.
  APPEND '<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0"><tr>' TO lt_email_html.

  " KPI 1: Material Document
  APPEND '<td width="32%" style="background-color:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:12px 10px; text-align:center;">' TO lt_email_html.
  APPEND '<div style="font-size:10px; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:0.5px;">Material Document</div>' TO lt_email_html.
  APPEND |<div style="font-size:14px; font-weight:800; color:#0f2b46; margin-top:4px;">{ iv_doc } / { iv_year }</div>| TO lt_email_html.
  APPEND '</td>' TO lt_email_html.

  APPEND '<td width="2%">&nbsp;</td>' TO lt_email_html.

  " KPI 2: Reservation No
  APPEND '<td width="32%" style="background-color:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:12px 10px; text-align:center;">' TO lt_email_html.
  IF lv_num_items > 1.
    APPEND '<div style="font-size:10px; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:0.5px;">Reservation No</div>' TO lt_email_html.
    APPEND |<div style="font-size:14px; font-weight:800; color:#0f2b46; margin-top:4px;">{ p_rsnum } ({ lv_num_items } Items)</div>| TO lt_email_html.
  ELSE.
    APPEND '<div style="font-size:10px; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:0.5px;">Reservation / Item</div>' TO lt_email_html.
    APPEND |<div style="font-size:14px; font-weight:800; color:#0f2b46; margin-top:4px;">{ p_rsnum } / { p_rspos }</div>| TO lt_email_html.
  ENDIF.
  APPEND '</td>' TO lt_email_html.

  APPEND '<td width="2%">&nbsp;</td>' TO lt_email_html.

  " KPI 3: Transferred Qty
  APPEND '<td width="32%" style="background-color:#eff6ff; border:1px solid #bfdbfe; border-radius:8px; padding:12px 10px; text-align:center;">' TO lt_email_html.
  IF lv_num_items > 1.
    APPEND '<div style="font-size:10px; font-weight:700; color:#2563eb; text-transform:uppercase; letter-spacing:0.5px;">Total Transferred</div>' TO lt_email_html.
    APPEND |<div style="font-size:14px; font-weight:800; color:#1d4ed8; margin-top:4px;">{ lv_num_items } Line Items</div>| TO lt_email_html.
  ELSE.
    APPEND '<div style="font-size:10px; font-weight:700; color:#2563eb; text-transform:uppercase; letter-spacing:0.5px;">Transferred Qty</div>' TO lt_email_html.
    APPEND |<div style="font-size:14px; font-weight:800; color:#1d4ed8; margin-top:4px;">{ lv_tqty_str } { p_meins }</div>| TO lt_email_html.
  ENDIF.
  APPEND '</td>' TO lt_email_html.

  APPEND '</tr></table></td></tr>' TO lt_email_html.

  IF lv_num_items > 1.
    " Section: Transferred Items Detail Grid (Multi-Item Table)
    APPEND '<tr><td style="padding:0 26px 16px 26px;">' TO lt_email_html.
    APPEND '<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" ' TO lt_email_html.
    APPEND 'style="border:1px solid #e2e8f0; border-radius:8px; overflow:hidden; border-collapse:collapse;">' TO lt_email_html.
    APPEND '<tr style="background-color:#0f2b46; color:#ffffff;">' TO lt_email_html.
    APPEND '<th colspan="5" style="padding:9px 14px; text-align:left; font-size:11px; font-weight:700; letter-spacing:0.8px; text-transform:uppercase;">&#128230; Transferred Materials (' TO lt_email_html.
    APPEND |{ lv_num_items } Items)</th></tr>| TO lt_email_html.
    APPEND '<tr style="background-color:#f1f5f9; border-bottom:2px solid #cbd5e1; font-size:11px; font-weight:700; color:#475569; text-transform:uppercase;">' TO lt_email_html.
    APPEND '<th style="padding:8px 10px; text-align:center; width:6%;">Item</th>' TO lt_email_html.
    APPEND '<th style="padding:8px 12px; text-align:left; width:36%;">Material &amp; Description</th>' TO lt_email_html.
    APPEND '<th style="padding:8px 10px; text-align:center; width:22%;">Route (SLoc)</th>' TO lt_email_html.
    APPEND '<th style="padding:8px 10px; text-align:right; width:16%;">Transferred Qty</th>' TO lt_email_html.
    APPEND '<th style="padding:8px 12px; text-align:left; width:20%;">HU / Batch / SN</th></tr>' TO lt_email_html.

    DATA: lv_m_idx TYPE i VALUE 0,
          lv_m_bg  TYPE string.

    LOOP AT lt_n_items INTO ls_n_item.
      lv_m_idx = lv_m_idx + 1.
      IF ( lv_m_idx MOD 2 ) = 0.
        lv_m_bg = '#f8fafc'.
      ELSE.
        lv_m_bg = '#ffffff'.
      ENDIF.

      DATA(lv_iqty) = |{ ls_n_item-menge NUMBER = USER }|.
      CONDENSE lv_iqty.
      DATA(lv_imat) = |{ ls_n_item-matnr ALPHA = OUT }|.
      IF lv_imat IS INITIAL.
        lv_imat = ls_n_item-matnr.
      ENDIF.

      APPEND |<tr style="border-bottom:1px solid #e2e8f0; background-color:{ lv_m_bg };">| TO lt_email_html.
      APPEND |<td style="padding:10px 10px; text-align:center; font-size:12px; font-weight:700; color:#0f2b46;">{ ls_n_item-zeile }</td>| TO lt_email_html.
      APPEND '<td style="padding:10px 12px; font-size:12px; line-height:1.4;">' TO lt_email_html.
      APPEND |<div style="font-family:SFMono-Regular,Consolas,Menlo,monospace; font-weight:700; color:#0f172a;">{ lv_imat }</div>| TO lt_email_html.
      APPEND |<div style="color:#64748b; font-size:11px; margin-top:2px;">{ ls_n_item-maktx }</div></td>| TO lt_email_html.
      APPEND '<td style="padding:10px 10px; text-align:center; font-size:11px; font-weight:700;">' TO lt_email_html.
      APPEND |<span style="background-color:#fef3c7; color:#92400e; padding:2px 6px; border-radius:4px;">{ ls_n_item-lgort }</span> &rarr; | TO lt_email_html.
      APPEND |<span style="background-color:#dcfce7; color:#166534; padding:2px 6px; border-radius:4px;">{ ls_n_item-umlgo }</span></td>| TO lt_email_html.
      APPEND '<td style="padding:10px 10px; text-align:right; font-size:13px; font-weight:800; color:#1d4ed8;">' TO lt_email_html.
      APPEND |{ lv_iqty } <span style="font-size:11px; font-weight:600; color:#64748b;">{ ls_n_item-meins }</span></td>| TO lt_email_html.
      APPEND '<td style="padding:10px 12px; font-size:11px; line-height:1.4;">' TO lt_email_html.
      IF ls_n_item-exidv IS NOT INITIAL.
        APPEND |<div style="font-family:SFMono-Regular,Consolas,Menlo,monospace; font-weight:600; color:#0369a1;">HU: { ls_n_item-exidv }</div>| TO lt_email_html.
      ENDIF.
      IF ls_n_item-sernr IS NOT INITIAL.
        APPEND |<div style="color:#64748b; font-family:monospace; font-size:10px;">SN: { ls_n_item-sernr }</div>| TO lt_email_html.
      ELSEIF ls_n_item-charg IS NOT INITIAL.
        APPEND |<div style="color:#64748b; font-size:10px;">Batch: { ls_n_item-charg }</div>| TO lt_email_html.
      ENDIF.
      APPEND '</td></tr>' TO lt_email_html.
    ENDLOOP.
    APPEND '</table></td></tr>' TO lt_email_html.

    " Logistics & Execution Summary Table
    APPEND '<tr><td style="padding:0 26px 16px 26px;">' TO lt_email_html.
    APPEND '<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" ' TO lt_email_html.
    APPEND 'style="border:1px solid #e2e8f0; border-radius:8px; overflow:hidden; border-collapse:collapse;">' TO lt_email_html.
    APPEND '<tr style="background-color:#0f2b46; color:#ffffff;">' TO lt_email_html.
    APPEND '<th colspan="2" style="padding:9px 14px; text-align:left; font-size:11px; font-weight:700; letter-spacing:0.8px; text-transform:uppercase;">' TO lt_email_html.
    APPEND '&#128666; Logistics &amp; Execution Summary</th></tr>' TO lt_email_html.

    APPEND '<tr><td width="38%" style="padding:8px 14px; font-size:12px; font-weight:600; color:#475569; background-color:#f8fafc; border-bottom:1px solid #e2e8f0;">Movement Type</td>' TO lt_email_html.
    APPEND '<td width="62%" style="padding:8px 14px; font-size:12px; font-weight:600; color:#0f172a; border-bottom:1px solid #e2e8f0;">' TO lt_email_html.
    APPEND |<span style="background-color:#e0f2fe; color:#0369a1; padding:2px 7px; border-radius:4px; font-weight:700; font-size:11px;">{ lv_mvt }</span> Transfer SLoc to SLoc (One-Step)</td></tr>| TO lt_email_html.

    APPEND '<tr><td style="padding:8px 14px; font-size:12px; font-weight:600; color:#475569; background-color:#f8fafc; border-bottom:1px solid #e2e8f0;">Requester</td>' TO lt_email_html.
    APPEND |<td style="padding:8px 14px; font-size:12px; font-weight:600; color:#0f172a; border-bottom:1px solid #e2e8f0;"><strong>{ lv_req_fullname }</strong> ({ lv_requester })</td></tr>| TO lt_email_html.

    IF lv_mobile IS NOT INITIAL OR lv_email IS NOT INITIAL.
      APPEND '<tr><td style="padding:8px 14px; font-size:12px; font-weight:600; color:#475569; background-color:#f8fafc; border-bottom:1px solid #e2e8f0;">Requester Contact</td>' TO lt_email_html.
      APPEND |<td style="padding:8px 14px; font-size:12px; font-weight:600; color:#0f172a; border-bottom:1px solid #e2e8f0;">| TO lt_email_html.
      IF lv_mobile IS NOT INITIAL.
        APPEND |&#128222; { lv_mobile } &nbsp;&nbsp;| TO lt_email_html.
      ENDIF.
      IF lv_email IS NOT INITIAL.
        APPEND |&#9993; <a href="mailto:{ lv_email }" style="color:#0284c7; text-decoration:none;">{ lv_email }</a>| TO lt_email_html.
      ENDIF.
      APPEND '</td></tr>' TO lt_email_html.
    ENDIF.

    APPEND '<tr><td style="padding:8px 14px; font-size:12px; font-weight:600; color:#475569; background-color:#f8fafc; border-bottom:1px solid #e2e8f0;">Warehouse Code</td>' TO lt_email_html.
    APPEND |<td style="padding:8px 14px; font-size:12px; font-weight:600; color:#0f172a; border-bottom:1px solid #e2e8f0;">{ p_whse }</td></tr>| TO lt_email_html.

    APPEND '<tr><td style="padding:8px 14px; font-size:12px; font-weight:600; color:#475569; background-color:#f8fafc;">Posted By &amp; Time</td>' TO lt_email_html.
    APPEND |<td style="padding:8px 14px; font-size:12px; font-weight:600; color:#0f172a;"><strong>{ lv_op_fullname }</strong> ({ sy-uname }) on { sy-datum DATE = USER } at { sy-uzeit TIME = USER }</td></tr>| TO lt_email_html.
    APPEND '</table></td></tr>' TO lt_email_html.

  ELSE.
    " Section 1: Material & Reservation Table (Single Item)
    APPEND '<tr><td style="padding:0 26px 14px 26px;">' TO lt_email_html.
    APPEND '<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" ' TO lt_email_html.
    APPEND 'style="border:1px solid #e2e8f0; border-radius:8px; overflow:hidden; border-collapse:collapse;">' TO lt_email_html.
    APPEND '<tr style="background-color:#0f2b46; color:#ffffff;">' TO lt_email_html.
    APPEND '<th colspan="2" style="padding:9px 14px; text-align:left; font-size:11px; font-weight:700; letter-spacing:0.8px; text-transform:uppercase;">' TO lt_email_html.
    APPEND '&#128230; Material &amp; Reservation Details</th></tr>' TO lt_email_html.

    APPEND '<tr><td width="38%" style="padding:8px 14px; font-size:12px; font-weight:600; color:#475569; background-color:#f8fafc; border-bottom:1px solid #e2e8f0;">Movement Type</td>' TO lt_email_html.
    APPEND '<td width="62%" style="padding:8px 14px; font-size:12px; font-weight:600; color:#0f172a; border-bottom:1px solid #e2e8f0;">' TO lt_email_html.
    APPEND |<span style="background-color:#e0f2fe; color:#0369a1; padding:2px 6px; border-radius:4px; font-weight:700; font-size:11px;">{ lv_mvt }</span> Transfer SLoc to SLoc</td></tr>| TO lt_email_html.

    APPEND '<tr><td style="padding:8px 14px; font-size:12px; font-weight:600; color:#475569; background-color:#f8fafc; border-bottom:1px solid #e2e8f0;">Material Code</td>' TO lt_email_html.
    APPEND '<td style="padding:8px 14px; font-size:12px; font-weight:700; color:#0f172a; border-bottom:1px solid #e2e8f0; font-family:SFMono-Regular,Consolas,Menlo,monospace;">' TO lt_email_html.
    APPEND |{ p_matnr }| TO lt_email_html.
    APPEND '</td></tr>' TO lt_email_html.

    APPEND '<tr><td style="padding:8px 14px; font-size:12px; font-weight:600; color:#475569; background-color:#f8fafc; border-bottom:1px solid #e2e8f0;">Description</td>' TO lt_email_html.
    APPEND '<td style="padding:8px 14px; font-size:12px; font-weight:600; color:#0f172a; border-bottom:1px solid #e2e8f0;">' TO lt_email_html.
    APPEND |{ lv_clean_maktx }| TO lt_email_html.
    APPEND '</td></tr>' TO lt_email_html.

    APPEND '<tr><td style="padding:8px 14px; font-size:12px; font-weight:600; color:#475569; background-color:#f8fafc; border-bottom:1px solid #e2e8f0;">Reservation No</td>' TO lt_email_html.
    APPEND '<td style="padding:8px 14px; font-size:12px; font-weight:600; color:#0f172a; border-bottom:1px solid #e2e8f0;">' TO lt_email_html.
    APPEND |<strong>{ p_rsnum }</strong> / Item <strong>{ p_rspos }</strong>| TO lt_email_html.
    APPEND '</td></tr>' TO lt_email_html.

    APPEND '<tr><td style="padding:8px 14px; font-size:12px; font-weight:600; color:#475569; background-color:#f8fafc; border-bottom:1px solid #e2e8f0;">Requester</td>' TO lt_email_html.
    APPEND '<td style="padding:8px 14px; font-size:12px; font-weight:600; color:#0f172a; border-bottom:1px solid #e2e8f0;">' TO lt_email_html.
    APPEND |<strong>{ lv_req_fullname }</strong> ({ lv_requester })| TO lt_email_html.
    APPEND '</td></tr>' TO lt_email_html.

    IF lv_mobile IS NOT INITIAL OR lv_email IS NOT INITIAL.
      APPEND '<tr><td style="padding:8px 14px; font-size:12px; font-weight:600; color:#475569; background-color:#f8fafc;">Requester Contact</td>' TO lt_email_html.
      APPEND '<td style="padding:8px 14px; font-size:12px; font-weight:600; color:#0f172a;">' TO lt_email_html.
      IF lv_mobile IS NOT INITIAL.
        APPEND |&#128222; { lv_mobile } &nbsp;&nbsp;| TO lt_email_html.
      ENDIF.
      IF lv_email IS NOT INITIAL.
        APPEND |&#9993; <a href="mailto:{ lv_email }" style="color:#0284c7; text-decoration:none;">{ lv_email }</a>| TO lt_email_html.
      ENDIF.
      APPEND '</td></tr>' TO lt_email_html.
    ENDIF.
    APPEND '</table></td></tr>' TO lt_email_html.

    " Section 2: Logistics & Storage Details
    APPEND '<tr><td style="padding:0 26px 16px 26px;">' TO lt_email_html.
    APPEND '<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" ' TO lt_email_html.
    APPEND 'style="border:1px solid #e2e8f0; border-radius:8px; overflow:hidden; border-collapse:collapse;">' TO lt_email_html.
    APPEND '<tr style="background-color:#0f2b46; color:#ffffff;">' TO lt_email_html.
    APPEND '<th colspan="2" style="padding:9px 14px; text-align:left; font-size:11px; font-weight:700; letter-spacing:0.8px; text-transform:uppercase;">' TO lt_email_html.
    APPEND '&#128666; Logistics &amp; Storage Details</th></tr>' TO lt_email_html.

    APPEND '<tr><td width="38%" style="padding:8px 14px; font-size:12px; font-weight:600; color:#475569; background-color:#f8fafc; border-bottom:1px solid #e2e8f0;">Transfer Route</td>' TO lt_email_html.
    APPEND '<td width="62%" style="padding:8px 14px; font-size:12px; font-weight:700; color:#0f172a; border-bottom:1px solid #e2e8f0;">' TO lt_email_html.
    APPEND |From <span style="background-color:#fef3c7; color:#92400e; padding:2px 7px; border-radius:4px; font-size:11px;">{ p_frloc }</span>| TO lt_email_html.
    APPEND ' &rarr; To ' TO lt_email_html.
    APPEND |<span style="background-color:#dcfce7; color:#166534; padding:2px 7px; border-radius:4px; font-size:11px;">{ p_toloc }</span>| TO lt_email_html.
    APPEND '</td></tr>' TO lt_email_html.

    APPEND |<tr><td style="padding:8px 14px; font-size:12px; font-weight:600; color:#475569; background-color:#f8fafc; border-bottom:1px solid #e2e8f0;">Unit ({ gv_unit_type })</td>| TO lt_email_html.
    APPEND '<td style="padding:8px 14px; font-size:12px; font-weight:700; color:#0f172a; border-bottom:1px solid #e2e8f0; font-family:SFMono-Regular,Consolas,Menlo,monospace;">' TO lt_email_html.
    APPEND |<span style="background-color:#f1f5f9; border:1px solid #cbd5e1; padding:2px 8px; border-radius:4px;">{ p_exidv }</span>| TO lt_email_html.
    IF p_sut IS NOT INITIAL.
      APPEND | &nbsp;<span style="background-color:#e0f2fe; color:#0369a1; padding:2px 6px; border-radius:4px; font-size:11px;">SUT: { p_sut } ({ p_sut_tx })</span>| TO lt_email_html.
    ENDIF.
    APPEND '</td></tr>' TO lt_email_html.

    IF p_hubat IS NOT INITIAL.
      APPEND '<tr><td style="padding:8px 14px; font-size:12px; font-weight:600; color:#475569; background-color:#f8fafc; border-bottom:1px solid #e2e8f0;">Batch Number</td>' TO lt_email_html.
      APPEND |<td style="padding:8px 14px; font-size:12px; font-weight:600; color:#0f172a; border-bottom:1px solid #e2e8f0;">{ p_hubat }</td></tr>| TO lt_email_html.
    ENDIF.

    IF p_huser IS NOT INITIAL.
      APPEND '<tr><td style="padding:8px 14px; font-size:12px; font-weight:600; color:#475569; background-color:#f8fafc; border-bottom:1px solid #e2e8f0;">Serial Number</td>' TO lt_email_html.
      APPEND |<td style="padding:8px 14px; font-size:12px; font-weight:700; color:#0369a1; border-bottom:1px solid #e2e8f0; font-family:SFMono-Regular,Consolas,Menlo,monospace;">{ p_huser }</td></tr>| TO lt_email_html.
    ENDIF.

    APPEND '<tr><td style="padding:8px 14px; font-size:12px; font-weight:600; color:#475569; background-color:#f8fafc; border-bottom:1px solid #e2e8f0;">Warehouse Code</td>' TO lt_email_html.
    APPEND |<td style="padding:8px 14px; font-size:12px; font-weight:600; color:#0f172a; border-bottom:1px solid #e2e8f0;">{ p_whse }</td></tr>| TO lt_email_html.

    APPEND '<tr><td style="padding:8px 14px; font-size:12px; font-weight:600; color:#475569; background-color:#f8fafc;">Posted By &amp; Time</td>' TO lt_email_html.
    APPEND |<td style="padding:8px 14px; font-size:12px; font-weight:600; color:#0f172a;"><strong>{ lv_op_fullname }</strong> ({ sy-uname }) on { sy-datum DATE = USER } at { sy-uzeit TIME = USER }</td></tr>| TO lt_email_html.
    APPEND '</table></td></tr>' TO lt_email_html.
  ENDIF.

  " Attachment Notice Box
  APPEND '<tr><td style="padding:0 26px 18px 26px;">' TO lt_email_html.
  APPEND '<div style="background-color:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px; padding:12px 14px;">' TO lt_email_html.
  APPEND '<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0"><tr>' TO lt_email_html.
  APPEND '<td width="28" style="vertical-align:middle; font-size:18px;">&#128206;</td>' TO lt_email_html.
  APPEND '<td style="vertical-align:middle; font-size:12px; color:#166534; line-height:1.4;">' TO lt_email_html.
  APPEND |<strong>Attached Transfer Slip:</strong> <code style="font-family:monospace; background-color:#dcfce7; padding:1px 5px; border-radius:3px;">Transfer_Slip_{ iv_doc }.pdf</code><br>| TO lt_email_html.
  APPEND 'Official goods movement slip with line-item traceability and barcode verification.' TO lt_email_html.
  APPEND '</td></tr></table></div></td></tr>' TO lt_email_html.

  " Footer Box
  APPEND '<tr><td style="background-color:#f8fafc; border-top:1px solid #e2e8f0; padding:16px 26px; text-align:center;">' TO lt_email_html.
  APPEND '<div style="font-size:11px; color:#64748b; line-height:1.5;">' TO lt_email_html.
  APPEND |This is an automated system notification from <strong>SAP S/4HANA RF Transfer System</strong>.<br>| TO lt_email_html.
  APPEND |System: <strong>{ sy-sysid }</strong> &nbsp;&#124;&nbsp; Client: <strong>{ sy-mandt }</strong> &nbsp;&#124;&nbsp; Transaction: <strong>ZRF_RES_HU_DNR</strong>| TO lt_email_html.
  APPEND '</div>' TO lt_email_html.
  APPEND '<div style="font-size:10px; color:#94a3b8; margin-top:6px;">' TO lt_email_html.
  APPEND '&copy; 2026 Aether Industries Limited. All rights reserved. Confidential.' TO lt_email_html.
  APPEND '</div></td></tr>' TO lt_email_html.

  " Close Main Tables and Document
  APPEND '</table></td></tr></table>' TO lt_email_html.
  APPEND '</body></html>' TO lt_email_html.

  " SMS Body (Concise format)
  APPEND |SAP Alert: Stock transfer posted for Res { p_rsnum }! MatDoc { iv_doc }, Material { p_matnr }, Qty { p_tqty } { p_meins }, { gv_unit_type } { p_exidv } transferred to { p_toloc }.| TO lt_sms_text.

  " Determine Operator (sy-uname) Email
  DATA: lv_op_email TYPE adr6-smtp_addr.
  SELECT SINGLE persnumber, addrnumber
    FROM usr21
    WHERE bname = @sy-uname
    INTO (@DATA(lv_op_pers), @DATA(lv_op_addr)).
  IF sy-subrc = 0.
    SELECT SINGLE smtp_addr
      FROM adr6
      WHERE persnumber = @lv_op_pers
        AND addrnumber = @lv_op_addr
      INTO @lv_op_email.
    IF lv_op_email IS INITIAL.
      SELECT SINGLE smtp_addr
        FROM adr6
        WHERE addrnumber = @lv_op_addr
        INTO @lv_op_email.
    ENDIF.
  ENDIF.
  IF lv_op_email IS INITIAL AND sy-uname IS NOT INITIAL.
    lv_op_email = |{ to_lower( sy-uname ) }@aether.co.in|.
  ENDIF.

  " 3. Send Email Notification via Business Communication Services (BCS)
  DATA: lo_doc TYPE REF TO cl_document_bcs.
  TRY.
      DATA(lo_send_req) = cl_bcs=>create_persistent( ).
      DATA: lv_subj TYPE so_obj_des.
      lv_subj = |Transfer Posted: Doc { iv_doc } Res { p_rsnum }|.
      DATA: lv_html_stream TYPE string.
      LOOP AT lt_email_html INTO DATA(ls_hline).
        lv_html_stream = |{ lv_html_stream }{ ls_hline-line }|.
      ENDLOOP.

      DATA: lt_html_solix TYPE solix_tab,
            lv_html_size  TYPE so_obj_len.

      cl_bcs_convert=>string_to_solix(
        EXPORTING
          iv_string   = lv_html_stream
          iv_codepage = '4110'
          iv_add_bom  = abap_true
        IMPORTING
          et_solix    = lt_html_solix
          ev_size     = lv_html_size ).

      lo_doc = cl_document_bcs=>create_document(
        i_type          = 'HTM'
        i_text          = lt_email_html
        i_subject       = lv_subj
        iv_vsi_scan_off = abap_true ).

      " Generate & Attach PDF Document of Transaction
      DATA: lt_pdf_hex TYPE solix_tab,
            lv_pdf_len TYPE so_obj_len.

      PERFORM build_transfer_pdf USING iv_doc iv_year lv_mvt
                                 CHANGING lt_pdf_hex lv_pdf_len.

      IF lt_pdf_hex IS NOT INITIAL.
        DATA: lv_att_subj TYPE so_obj_des,
              lv_att_file TYPE bcs_attachment_name,
              lt_att_head TYPE soli_tab.

        lv_att_subj = |Transfer_Slip_{ iv_doc }|.
        lv_att_file = |Transfer_Slip_{ iv_doc }.pdf|.

        APPEND |&SO_FILENAME={ lv_att_file }| TO lt_att_head.
        APPEND '&SO_FORMAT=BIN'                TO lt_att_head.

        TRY.
            lo_doc->add_attachment(
              i_attachment_type     = 'PDF'
              i_attachment_subject  = lv_att_subj
              i_attachment_size     = lv_pdf_len
              i_att_content_hex     = lt_pdf_hex
              i_attachment_header   = lt_att_head
              i_attachment_filename = lv_att_file
              iv_vsi_scan_off       = abap_true ).
          CATCH cx_document_bcs.
            TRY.
                lo_doc->add_attachment(
                  i_attachment_type     = 'BIN'
                  i_attachment_subject  = lv_att_subj
                  i_attachment_size     = lv_pdf_len
                  i_att_content_hex     = lt_pdf_hex
                  i_attachment_header   = lt_att_head
                  i_attachment_filename = lv_att_file
                  iv_vsi_scan_off       = abap_true ).
              CATCH cx_document_bcs.
            ENDTRY.
        ENDTRY.
      ENDIF.

      lo_send_req->set_document( lo_doc ).

      " Set Authorized SMTP Sender (Must be SAPHANA@AETHER.CO.IN for Office365 SMTP relay)
      DATA(lo_sender) = cl_cam_address_bcs=>create_internet_address(
                          i_address_string = 'saphana@aether.co.in'
                          i_address_name   = 'SAP S/4HANA Notifications' ).
      lo_send_req->set_sender( lo_sender ).

      " Add Primary Recipient (Requester)
      IF lv_email IS NOT INITIAL.
        DATA(lo_recip) = cl_cam_address_bcs=>create_internet_address( lv_email ).
        lo_send_req->add_recipient( lo_recip ).
      ENDIF.

      " Add CC Recipient: Operator who created the entry (sy-uname)
      IF lv_op_email IS NOT INITIAL AND lv_op_email <> lv_email.
        DATA(lo_cc_op) = cl_cam_address_bcs=>create_internet_address( lv_op_email ).
        lo_send_req->add_recipient( i_recipient = lo_cc_op i_copy = abap_true ).
      ENDIF.

      " Add Testing CC Recipients (when gv_test_notify = abap_true)
      IF gv_test_notify = abap_true.
        IF gv_test_cc_email1 IS NOT INITIAL AND gv_test_cc_email1 <> lv_email AND gv_test_cc_email1 <> lv_op_email.
          DATA(lo_cc1) = cl_cam_address_bcs=>create_internet_address( gv_test_cc_email1 ).
          lo_send_req->add_recipient( i_recipient = lo_cc1 i_copy = abap_true ).
        ENDIF.
        IF gv_test_cc_email2 IS NOT INITIAL AND gv_test_cc_email2 <> lv_email AND gv_test_cc_email2 <> lv_op_email.
          DATA(lo_cc2) = cl_cam_address_bcs=>create_internet_address( gv_test_cc_email2 ).
          lo_send_req->add_recipient( i_recipient = lo_cc2 i_copy = abap_true ).
        ENDIF.
      ENDIF.

      lo_send_req->set_send_immediately( abap_true ).
      lo_send_req->send( i_with_error_screen = abap_false ).
      COMMIT WORK AND WAIT.

      " Trigger immediate SAPconnect transmission for Internet Mail (INT)
      SUBMIT rsconn01 WITH mode   = 'INT'
                      WITH output = ' '
                      AND RETURN.
    CATCH cx_bcs.
  ENDTRY.

  " 4. Send Mobile Notification (SMS via BCS)
  IF lv_mobile IS NOT INITIAL.
    TRY.
        DATA(lo_sms_req) = cl_bcs=>create_persistent( ).
        DATA(lo_sms_doc) = cl_document_bcs=>create_document(
          i_type    = 'RAW'
          i_text    = lt_sms_text
          i_subject = |MatDoc { iv_doc } Posted| ).

        lo_sms_req->set_document( lo_sms_doc ).
        DATA(lo_sms_recip) = cl_cam_address_bcs=>create_sms_address( lv_mobile ).
        lo_sms_req->add_recipient( lo_sms_recip ).
        lo_sms_req->set_send_immediately( abap_true ).
        lo_sms_req->send( i_with_error_screen = abap_false ).
        COMMIT WORK.
      CATCH cx_bcs.
    ENDTRY.
  ENDIF.

  " 5. Send Express Internal Notification to Requester, Operator, and Test Users
  IF lo_doc IS BOUND.
    " Notify Primary Requester
    IF lv_requester IS NOT INITIAL.
      TRY.
          DATA(lo_sap_user) = cl_sapuser_bcs=>create( lv_requester ).
          DATA(lo_exp_req)  = cl_bcs=>create_persistent( ).
          lo_exp_req->set_document( lo_doc ).
          lo_exp_req->add_recipient(
            i_recipient = lo_sap_user
            i_express   = abap_true ).
          lo_exp_req->set_send_immediately( abap_true ).
          lo_exp_req->send( i_with_error_screen = abap_false ).
        CATCH cx_bcs.
      ENDTRY.
    ENDIF.

    " Notify Operator who created the entry (sy-uname)
    IF sy-uname IS NOT INITIAL AND sy-uname <> lv_requester.
      TRY.
          DATA(lo_sap_op)  = cl_sapuser_bcs=>create( sy-uname ).
          DATA(lo_exp_op)  = cl_bcs=>create_persistent( ).
          lo_exp_op->set_document( lo_doc ).
          lo_exp_op->add_recipient(
            i_recipient = lo_sap_op
            i_express   = abap_true ).
          lo_exp_op->set_send_immediately( abap_true ).
          lo_exp_op->send( i_with_error_screen = abap_false ).
        CATCH cx_bcs.
      ENDTRY.
    ENDIF.

    " Testing Notifications to DRATHOD and NARESH
    IF gv_test_notify = abap_true.
      IF gv_test_user1 IS NOT INITIAL AND gv_test_user1 <> lv_requester AND gv_test_user1 <> sy-uname.
        TRY.
            DATA(lo_tuser1) = cl_sapuser_bcs=>create( gv_test_user1 ).
            DATA(lo_exp_t1) = cl_bcs=>create_persistent( ).
            lo_exp_t1->set_document( lo_doc ).
            lo_exp_t1->add_recipient(
              i_recipient = lo_tuser1
              i_express   = abap_true ).
            lo_exp_t1->set_send_immediately( abap_true ).
            lo_exp_t1->send( i_with_error_screen = abap_false ).
          CATCH cx_bcs.
        ENDTRY.
      ENDIF.

      IF gv_test_user2 IS NOT INITIAL AND gv_test_user2 <> lv_requester AND gv_test_user2 <> sy-uname.
        TRY.
            DATA(lo_tuser2) = cl_sapuser_bcs=>create( gv_test_user2 ).
            DATA(lo_exp_t2) = cl_bcs=>create_persistent( ).
            lo_exp_t2->set_document( lo_doc ).
            lo_exp_t2->add_recipient(
              i_recipient = lo_tuser2
              i_express   = abap_true ).
            lo_exp_t2->set_send_immediately( abap_true ).
            lo_exp_t2->send( i_with_error_screen = abap_false ).
          CATCH cx_bcs.
        ENDTRY.
      ENDIF.
    ENDIF.

    COMMIT WORK.
  ENDIF.
ENDFORM.

*&---------------------------------------------------------------------*
*& Form: build_transfer_pdf
*& Description: Builds a formatted PDF 1.4 vector document capturing
*&              all transfer transaction details & returns binary SOLIX
*& Author     : DNR / Dipak Rathod
*&---------------------------------------------------------------------*
FORM build_transfer_pdf USING    iv_doc     TYPE mblnr
                                 iv_year    TYPE mjahr
                                 iv_mvt     TYPE bwart
                        CHANGING et_pdf_hex TYPE solix_tab
                                 ev_pdf_len TYPE so_obj_len.

  CLEAR: et_pdf_hex, ev_pdf_len.

  " 1. Resolve operator and requester names
  DATA: lv_op_name  TYPE string,
        lv_req_name TYPE string.

  DATA: ls_op_bapi TYPE bapiaddr3,
        lt_op_bapi TYPE STANDARD TABLE OF bapiret2.
  CALL FUNCTION 'BAPI_USER_GET_DETAIL'
    EXPORTING
      username = sy-uname
    IMPORTING
      address  = ls_op_bapi
    TABLES
      return   = lt_op_bapi.

  lv_op_name = |{ ls_op_bapi-firstname } { ls_op_bapi-lastname }|.
  IF lv_op_name IS INITIAL OR lv_op_name = ' '.
    lv_op_name = sy-uname.
  ENDIF.

  lv_req_name = p_unam.
  IF lv_req_name IS INITIAL.
    lv_req_name = p_usnam.
  ENDIF.

  " Resolve plant
  DATA: lv_plant TYPE resb-werks.
  lv_plant = gs_sel_item-werks.
  IF lv_plant IS INITIAL.
    lv_plant = p_plnt.
  ENDIF.

  " Format dates and times
  DATA(lv_dt_str) = |{ sy-datum DATE = USER } { sy-uzeit TIME = USER }|.

  " Sanitize text fields for PDF strings (escape parentheses)
  DATA: lv_s_maktx TYPE string,
        lv_s_opnam TYPE string,
        lv_s_rqnam TYPE string.

  lv_s_maktx = p_maktx.
  REPLACE ALL OCCURRENCES OF '(' IN lv_s_maktx WITH '['.
  REPLACE ALL OCCURRENCES OF ')' IN lv_s_maktx WITH ']'.

  lv_s_opnam = lv_op_name.
  REPLACE ALL OCCURRENCES OF '(' IN lv_s_opnam WITH '['.
  REPLACE ALL OCCURRENCES OF ')' IN lv_s_opnam WITH ']'.

  lv_s_rqnam = lv_req_name.
  REPLACE ALL OCCURRENCES OF '(' IN lv_s_rqnam WITH '['.
  REPLACE ALL OCCURRENCES OF ')' IN lv_s_rqnam WITH ']'.

  " 2. Construct PDF content stream (vector graphics & formatted typography)
  DATA: lt_stream_lines TYPE STANDARD TABLE OF string,
        lv_stream       TYPE string.

  APPEND '0.06 0.30 0.51 rg' TO lt_stream_lines.
  APPEND '50 780 495 40 re f' TO lt_stream_lines.
  APPEND '1.0 1.0 1.0 rg' TO lt_stream_lines.
  APPEND 'BT /F1 16 Tf 65 798 Td (AETHER INDUSTRIES LIMITED) Tj ET' TO lt_stream_lines.
  APPEND 'BT /F2 10 Tf 65 786 Td (MATERIAL RESERVATION STOCK TRANSFER SLIP) Tj ET' TO lt_stream_lines.
  APPEND '0.94 0.96 0.98 rg' TO lt_stream_lines.
  APPEND '50 690 495 75 re f' TO lt_stream_lines.
  APPEND '0.06 0.30 0.51 RG 1 w' TO lt_stream_lines.
  APPEND '50 690 495 75 re S' TO lt_stream_lines.
  APPEND '0.0 0.0 0.0 rg' TO lt_stream_lines.
  APPEND |BT /F1 9 Tf 60 748 Td (Material Document:) Tj /F2 9 Tf 165 748 Td ({ iv_doc } / { iv_year }) Tj ET| TO lt_stream_lines.
  APPEND |BT /F1 9 Tf 60 732 Td (Movement Type:) Tj /F2 9 Tf 165 732 Td ({ iv_mvt } - Stock Transfer SLoc to SLoc) Tj ET| TO lt_stream_lines.
  APPEND |BT /F1 9 Tf 60 716 Td (Posting Date/Time:) Tj /F2 9 Tf 165 716 Td ({ lv_dt_str }) Tj ET| TO lt_stream_lines.
  APPEND |BT /F1 9 Tf 60 700 Td (Posting Operator:) Tj /F2 9 Tf 165 700 Td ({ sy-uname } - { lv_s_opnam }) Tj ET| TO lt_stream_lines.
  APPEND |BT /F1 9 Tf 310 748 Td (Reservation No:) Tj /F2 9 Tf 410 748 Td ({ p_rsnum } / Item { p_rspos }) Tj ET| TO lt_stream_lines.
  APPEND |BT /F1 9 Tf 310 732 Td (Requester ID:) Tj /F2 9 Tf 410 732 Td ({ p_usnam }) Tj ET| TO lt_stream_lines.
  APPEND |BT /F1 9 Tf 310 716 Td (Requester Name:) Tj /F2 9 Tf 410 716 Td ({ lv_s_rqnam }) Tj ET| TO lt_stream_lines.
  APPEND |BT /F1 9 Tf 310 700 Td (System / Client:) Tj /F2 9 Tf 410 700 Td ({ sy-sysid } / { sy-mandt }) Tj ET| TO lt_stream_lines.
  APPEND '0.88 0.92 0.96 rg' TO lt_stream_lines.
  APPEND '50 645 495 25 re f' TO lt_stream_lines.
  APPEND '0.06 0.30 0.51 RG' TO lt_stream_lines.
  APPEND '50 645 495 25 re S' TO lt_stream_lines.
  APPEND 'BT /F1 10 Tf 60 653 Td (MATERIAL & STOCK TRANSFER DETAILS) Tj ET' TO lt_stream_lines.
  APPEND '0.97 0.97 0.97 rg' TO lt_stream_lines.
  APPEND '50 495 495 140 re f' TO lt_stream_lines.
  APPEND '0.70 0.70 0.70 RG' TO lt_stream_lines.
  APPEND '50 495 495 140 re S' TO lt_stream_lines.
  APPEND |BT /F1 9 Tf 60 615 Td (Material Code:) Tj /F2 9 Tf 165 615 Td ({ p_matnr }) Tj ET| TO lt_stream_lines.
  APPEND |BT /F1 9 Tf 60 595 Td (Description:) Tj /F2 9 Tf 165 595 Td ({ lv_s_maktx }) Tj ET| TO lt_stream_lines.
  APPEND |BT /F1 9 Tf 60 575 Td (Transferred Qty:) Tj /F1 10 Tf 165 575 Td ({ p_tqty } { p_meins }) Tj ET| TO lt_stream_lines.
  APPEND |BT /F1 9 Tf 60 555 Td (Batch Number:) Tj /F2 9 Tf 165 555 Td ({ COND string( WHEN p_hubat IS NOT INITIAL THEN p_hubat ELSE '-' ) }) Tj ET| TO lt_stream_lines.
  APPEND |BT /F1 9 Tf 60 535 Td (Serial Number:) Tj /F2 9 Tf 165 535 Td ({ COND string( WHEN p_huser IS NOT INITIAL THEN p_huser ELSE '-' ) }) Tj ET| TO lt_stream_lines.
  APPEND |BT /F1 9 Tf 60 515 Td (Unit ({ gv_unit_type }):) Tj /F1 10 Tf 165 515 Td ({ p_exidv }) Tj ET| TO lt_stream_lines.
  APPEND |BT /F1 9 Tf 310 615 Td (Plant:) Tj /F2 9 Tf 410 615 Td ({ lv_plant }) Tj ET| TO lt_stream_lines.
  APPEND |BT /F1 9 Tf 310 595 Td (From SLoc (Source):) Tj /F1 9 Tf 410 595 Td ({ p_frloc }) Tj ET| TO lt_stream_lines.
  APPEND |BT /F1 9 Tf 310 575 Td (To SLoc (Target):) Tj /F1 9 Tf 410 575 Td ({ p_toloc }) Tj ET| TO lt_stream_lines.
  APPEND |BT /F1 9 Tf 310 555 Td (Warehouse No:) Tj /F2 9 Tf 410 555 Td ({ p_whse }) Tj ET| TO lt_stream_lines.
  APPEND |BT /F1 9 Tf 310 535 Td (Pref. Storage Type:) Tj /F2 9 Tf 410 535 Td ({ p_pstg }) Tj ET| TO lt_stream_lines.
  APPEND |BT /F1 9 Tf 310 515 Td (Whse Stock / Units:) Tj /F2 9 Tf 410 515 Td ({ p_stk } { p_meins } / { p_hucnt } Units) Tj ET| TO lt_stream_lines.
  APPEND '0.88 0.92 0.96 rg' TO lt_stream_lines.
  APPEND '50 450 495 25 re f' TO lt_stream_lines.
  APPEND '0.06 0.30 0.51 RG' TO lt_stream_lines.
  APPEND '50 450 495 25 re S' TO lt_stream_lines.
  APPEND 'BT /F1 10 Tf 60 458 Td (DISPATCH & NOTIFICATION RECIPIENTS) Tj ET' TO lt_stream_lines.
  APPEND '0.97 0.97 0.97 rg' TO lt_stream_lines.
  APPEND '50 360 495 80 re f' TO lt_stream_lines.
  APPEND '0.70 0.70 0.70 RG' TO lt_stream_lines.
  APPEND '50 360 495 80 re S' TO lt_stream_lines.
  APPEND |BT /F1 9 Tf 60 424 Td (Primary Requester:) Tj /F2 9 Tf 165 424 Td ({ lv_s_rqnam } / { p_usnam }) Tj ET| TO lt_stream_lines.
  DATA: lv_pdf_cnt TYPE string,
        lv_s_ccop  TYPE string.
  lv_pdf_cnt = |Mobile: { p_uphon } - E-Mail: { p_umail }|.
  REPLACE ALL OCCURRENCES OF '(' IN lv_pdf_cnt WITH '['.
  REPLACE ALL OCCURRENCES OF ')' IN lv_pdf_cnt WITH ']'.
  APPEND |BT /F1 9 Tf 60 408 Td (Contact Details:) Tj /F2 9 Tf 165 408 Td ({ lv_pdf_cnt }) Tj ET| TO lt_stream_lines.
  lv_s_ccop = |{ sy-uname } ({ lv_s_opnam }) [Operator]|.
  APPEND |BT /F1 9 Tf 60 392 Td (CC (Operator):) Tj /F2 9 Tf 165 392 Td ({ lv_s_ccop }) Tj ET| TO lt_stream_lines.
  APPEND |BT /F1 9 Tf 60 374 Td (Transfer Status:) Tj /F1 9 Tf 165 374 Td (POSTED IN SAP S/4HANA) Tj ET| TO lt_stream_lines.
  APPEND '0.80 0.80 0.80 RG 1 w' TO lt_stream_lines.
  APPEND '50 240 180 0 re S' TO lt_stream_lines.
  APPEND '365 240 180 0 re S' TO lt_stream_lines.
  APPEND 'BT /F1 9 Tf 70 225 Td (Issued By (Operator / Store)) Tj ET' TO lt_stream_lines.
  APPEND 'BT /F1 9 Tf 385 225 Td (Received By (Requester)) Tj ET' TO lt_stream_lines.
  APPEND '0.06 0.30 0.51 rg' TO lt_stream_lines.
  APPEND '50 160 495 20 re f' TO lt_stream_lines.
  APPEND '1.0 1.0 1.0 rg' TO lt_stream_lines.
  APPEND 'BT /F2 8 Tf 120 166 Td (SAP S/4HANA System Generated Stock Transfer Slip - Aether Industries Limited) Tj ET' TO lt_stream_lines.

  CONCATENATE LINES OF lt_stream_lines INTO lv_stream SEPARATED BY cl_abap_char_utilities=>newline.

  " 3. Build Objects & Offsets
  DATA: lv_pdf TYPE string,
        lt_obj TYPE STANDARD TABLE OF string.

  lv_pdf = |%PDF-1.4\n|.

  DATA(lv_obj1) = |1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n|.
  DATA(lv_obj2) = |2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n|.
  DATA(lv_obj3) = |3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> /ProcSet [/PDF /Text] >> >>\nendobj\n|.
  DATA(lv_obj5) = |5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n|.
  DATA(lv_obj6) = |6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n|.
  DATA(lv_obj4) = |4 0 obj\n<< /Length { strlen( lv_stream ) } >>\nstream\n{ lv_stream }\nendstream\nendobj\n|.

  APPEND lv_obj1 TO lt_obj.
  APPEND lv_obj2 TO lt_obj.
  APPEND lv_obj3 TO lt_obj.
  APPEND lv_obj5 TO lt_obj.
  APPEND lv_obj6 TO lt_obj.
  APPEND lv_obj4 TO lt_obj.

  DATA: lt_map_id TYPE STANDARD TABLE OF i.
  APPEND 1 TO lt_map_id.
  APPEND 2 TO lt_map_id.
  APPEND 3 TO lt_map_id.
  APPEND 5 TO lt_map_id.
  APPEND 6 TO lt_map_id.
  APPEND 4 TO lt_map_id.

  " Calculate byte offsets
  DATA: lv_curr_off TYPE i.
  lv_curr_off = strlen( lv_pdf ).

  DATA: lt_id_to_off TYPE STANDARD TABLE OF i.
  DO 7 TIMES.
    APPEND 0 TO lt_id_to_off.
  ENDDO.

  LOOP AT lt_obj INTO DATA(ls_o).
    DATA(lv_idx) = sy-tabix.
    READ TABLE lt_map_id INTO DATA(lv_oid) INDEX lv_idx.
    MODIFY lt_id_to_off FROM lv_curr_off INDEX lv_oid.
    lv_pdf = |{ lv_pdf }{ ls_o }|.
    lv_curr_off = strlen( lv_pdf ).
  ENDLOOP.

  DATA(lv_xref_pos) = lv_curr_off.
  DATA(lv_xref) = |xref\n0 7\n0000000000 65535 f \n|.
  DO 6 TIMES.
    DATA(lv_obj_i) = sy-index.
    READ TABLE lt_id_to_off INTO DATA(lv_o_off) INDEX lv_obj_i.
    DATA: lv_f_off TYPE c LENGTH 10.
    WRITE lv_o_off TO lv_f_off NO-GROUPING.
    TRANSLATE lv_f_off USING ' 0'.
    lv_xref = |{ lv_xref }{ lv_f_off } 00000 n \n|.
  ENDDO.

  DATA(lv_trailer) = |trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n{ lv_xref_pos }\n%%EOF\n|.
  lv_pdf = |{ lv_pdf }{ lv_xref }{ lv_trailer }|.

  " 4. Convert PDF string to binary XSTRING & SOLIX_TAB
  TRY.
      DATA: lv_xstring TYPE xstring.
      TRY.
          lv_xstring = cl_abap_codepage=>convert_to(
            source   = lv_pdf
            codepage = 'ISO-8859-1' ).
        CATCH cx_root.
          TRY.
              lv_xstring = cl_abap_codepage=>convert_to(
                source   = lv_pdf
                codepage = 'UTF-8' ).
            CATCH cx_root.
          ENDTRY.
      ENDTRY.

      IF lv_xstring IS NOT INITIAL.
        ev_pdf_len = xstrlen( lv_xstring ).
        et_pdf_hex = cl_bcs_convert=>xstring_to_solix( lv_xstring ).
      ENDIF.
    CATCH cx_root.
  ENDTRY.

  IF et_pdf_hex IS INITIAL.
    TRY.
        cl_bcs_convert=>string_to_solix(
          EXPORTING
            iv_string  = lv_pdf
            iv_add_bom = abap_false
          IMPORTING
            et_solix   = et_pdf_hex
            ev_size    = ev_pdf_len ).
      CATCH cx_bcs.
    ENDTRY.
  ENDIF.
ENDFORM.