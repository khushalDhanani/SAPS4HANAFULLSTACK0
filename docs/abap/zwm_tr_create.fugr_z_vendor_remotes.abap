FUNCTION zwm_tr_create
  IMPORTING
    VALUE(iv_lgnum) TYPE lgnum
    VALUE(iv_bwlvs) TYPE bwlvs DEFAULT '311'
    VALUE(iv_matnr) TYPE matnr
    VALUE(iv_werks) TYPE werks_d DEFAULT '1120'
    VALUE(iv_lgort) TYPE lgort_d DEFAULT 'CS01'
    VALUE(iv_menga) TYPE ltbp_menga
    VALUE(iv_altme) TYPE lrmei DEFAULT 'KG'
    VALUE(iv_rsnum) TYPE rsnum OPTIONAL
    VALUE(iv_rspos) TYPE rspos OPTIONAL
    VALUE(iv_commit) TYPE char1 DEFAULT 'X'
    VALUE(iv_betyp) TYPE ltbk-betyp OPTIONAL
    VALUE(iv_benum) TYPE ltbk-benum OPTIONAL
  EXPORTING
    VALUE(ev_tbnum) TYPE ltbk-tbnum
    VALUE(ev_tbpos) TYPE ltbp-tbpos
    VALUE(ev_success) TYPE char1
    VALUE(ev_message) TYPE bapi_msg
  TABLES
    et_messages TYPE bapiret2_t OPTIONAL.



  CALL FUNCTION 'Z_WM_TR_CREATE'
    EXPORTING
      iv_lgnum    = iv_lgnum
      iv_bwlvs    = iv_bwlvs
      iv_matnr    = iv_matnr
      iv_werks    = iv_werks
      iv_lgort    = iv_lgort
      iv_menga    = iv_menga
      iv_altme    = iv_altme
      iv_rsnum    = iv_rsnum
      iv_rspos    = iv_rspos
      iv_commit   = iv_commit
      iv_betyp    = iv_betyp
      iv_benum    = iv_benum
    IMPORTING
      ev_tbnum    = ev_tbnum
      ev_tbpos    = ev_tbpos
      ev_success  = ev_success
      ev_message  = ev_message
    TABLES
      et_messages = et_messages.

ENDFUNCTION.