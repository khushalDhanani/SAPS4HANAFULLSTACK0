FUNCTION z_wm_get_all_tr_headers
  IMPORTING
    VALUE(iv_lgnum) TYPE lgnum OPTIONAL
    VALUE(iv_betyp) TYPE ltbk-betyp OPTIONAL
    VALUE(iv_from_date) TYPE datum OPTIONAL
    VALUE(iv_to_date) TYPE datum OPTIONAL
    VALUE(iv_max_rows) TYPE int4 OPTIONAL
  EXPORTING
    VALUE(et_tr_headers) TYPE ztt_ltbk.




  CLEAR et_tr_headers.

  IF iv_max_rows <= 0.
    iv_max_rows = 500.
  ENDIF.

  SELECT * FROM ltbk
    WHERE ( lgnum = @iv_lgnum OR @iv_lgnum IS INITIAL )
      AND ( betyp = @iv_betyp OR @iv_betyp IS INITIAL )
      AND ( bdatu >= @iv_from_date OR @iv_from_date IS INITIAL )
      AND ( bdatu <= @iv_to_date   OR @iv_to_date IS INITIAL )
    ORDER BY tbnum DESCENDING
    INTO TABLE @et_tr_headers
    UP TO @iv_max_rows ROWS.

ENDFUNCTION.