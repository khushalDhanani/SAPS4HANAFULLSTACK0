FUNCTION fp_function_module_name
  IMPORTING
    VALUE(i_name) TYPE fpname
  EXPORTING
    VALUE(e_funcname) TYPE funcname
    e_interface_type TYPE fpinterfacetype
    VALUE(ev_funcname_inbound) TYPE funcname
  RAISING
    cx_fp_api_repository
    cx_fp_api_usage
    cx_fp_api_internal.



  DATA lv_number   TYPE fpnumber.
  DATA lv_funcname TYPE funcname.

  CALL FUNCTION 'FP_FM_NAME_INTERNAL'
    EXPORTING
      i_name           = i_name
    IMPORTING
      e_funcname       = e_funcname
      e_interface_type = e_interface_type.

  IF e_interface_type = if_fp_interface=>c_interface_type_new.
    PERFORM rebuild_fm_name USING e_funcname lv_number.
    PERFORM build_fm_inbound_name using lv_number lv_funcname.
    CALL FUNCTION 'FUNCTION_EXISTS'
      EXPORTING
        funcname           = lv_funcname
      EXCEPTIONS
        function_not_exist = 1
        OTHERS             = 2.
    IF sy-subrc IS INITIAL.
      ev_funcname_inbound = lv_funcname.
    ENDIF.
  ENDIF.

  ENDFUNCTION.