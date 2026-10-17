FUNCTION z_wm_get_tr_material_list
  IMPORTING
    VALUE(iv_prod_order) TYPE aufnr OPTIONAL
    VALUE(iv_reservation) TYPE rsnum OPTIONAL
    VALUE(iv_tr_number) TYPE tbnum OPTIONAL
    VALUE(iv_lgnum) TYPE lgnum OPTIONAL
  EXPORTING
    VALUE(et_tr_header) TYPE ztt_ltbk
    VALUE(et_tr_items) TYPE ztt_ltbp.




  DATA: lv_benum TYPE ltbk-benum,
        lv_tbnum TYPE ltbk-tbnum.

  CLEAR: et_tr_header, et_tr_items.

  " ------------------------------------------------------------------
  " Priority 1: Direct Transfer Requirement (TR) Number Lookup
  " ------------------------------------------------------------------
  IF iv_tr_number IS NOT INITIAL AND iv_tr_number CN '0 '.
    lv_tbnum = |{ iv_tr_number ALPHA = IN }|.

    SELECT * FROM ltbk
      WHERE tbnum = @lv_tbnum
        AND ( lgnum = @iv_lgnum OR @iv_lgnum = '' )
      INTO TABLE @et_tr_header.

  " ------------------------------------------------------------------
  " Priority 2: Production Order Lookup (LTBK-BETYP = 'P')
  " ------------------------------------------------------------------
  ELSEIF iv_prod_order IS NOT INITIAL AND iv_prod_order CN '0 '.
    lv_benum = |{ iv_prod_order ALPHA = IN }|.

    SELECT * FROM ltbk
      WHERE betyp = 'P'
        AND benum = @lv_benum
        AND ( lgnum = @iv_lgnum OR @iv_lgnum = '' )
      INTO TABLE @et_tr_header.

  " ------------------------------------------------------------------
  " Priority 3: Reservation Number Lookup (LTBK-BETYP = 'R')
  " ------------------------------------------------------------------
  ELSEIF iv_reservation IS NOT INITIAL AND iv_reservation CN '0 '.
    lv_benum = |{ iv_reservation ALPHA = IN }|.

    SELECT * FROM ltbk
      WHERE betyp = 'R'
        AND benum = @lv_benum
        AND ( lgnum = @iv_lgnum OR @iv_lgnum = '' )
      INTO TABLE @et_tr_header.
  ENDIF.

  " ------------------------------------------------------------------
  " Step 4: Fetch Line Items for All Matching Headers
  " ------------------------------------------------------------------
  IF et_tr_header IS NOT INITIAL.
    SELECT * FROM ltbp
      FOR ALL ENTRIES IN @et_tr_header
      WHERE lgnum = @et_tr_header-lgnum
        AND tbnum = @et_tr_header-tbnum
      INTO TABLE @et_tr_items.
  ENDIF.

ENDFUNCTION.