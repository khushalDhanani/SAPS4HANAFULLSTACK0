*&---------------------------------------------------------------------*
*& Include          SAPMZWM_E_001_I01
*&---------------------------------------------------------------------*
*&---------------------------------------------------------------------*
*&      Module  USER_COMMAND_9001  INPUT
*&---------------------------------------------------------------------*
*       text
*----------------------------------------------------------------------*
MODULE user_command_9001 INPUT.

  DATA(ok_code) = ok_code_9001.

  IF ok_code = fcode_clear.
    CLEAR ok_code.
    PERFORM clear_all.
    EXIT.
  ENDIF.

  IF ok_code IS INITIAL.
    EXIT.
  ENDIF.

  CALL FUNCTION 'AUTHORITY_CHECK_TCODE'
    EXPORTING
      tcode  = sy-tcode
    EXCEPTIONS
      ok     = 0
      not_ok = 2
      OTHERS = 3.
  IF sy-subrc <> 0.
    MESSAGE e172(00) WITH sy-tcode.
  ENDIF.

  CASE ok_code.
    WHEN fcode_enter.
      PERFORM get_tr_details.
    WHEN fcode_create.
      PERFORM create_to.
    WHEN fcode_back OR fcode_exit.
      LEAVE TO SCREEN 0.
  ENDCASE.

ENDMODULE.

*&---------------------------------------------------------------------*
*&      Module  USER_COMMAND_9999  INPUT
*&---------------------------------------------------------------------*
*       text
*----------------------------------------------------------------------*
MODULE user_command_9999 INPUT.
  ok_code = ok_code_9999.
  CASE ok_code.
    WHEN 'BACK' OR 'CLOSE' OR 'EXIT'.
      IF gs_mess-error = 'E'.
        LEAVE TO SCREEN 0.
      ENDIF.
    WHEN 'OK'.
      IF gs_mess-error = 'E'.
        LEAVE TO SCREEN 0.
        ELSEIF gs_mess-error = 'S'.
          PERFORM clear_all.
          LEAVE TO SCREEN 0.
      ENDIF.
  ENDCASE.
ENDMODULE.
*&---------------------------------------------------------------------*
*&      Module  EXIT_MENU  INPUT
*&---------------------------------------------------------------------*
*       text
*----------------------------------------------------------------------*
MODULE exit_menu INPUT.
  DATA: lv_trm_ext_call TYPE flag.
  CASE ok_code_9001.
    WHEN fcode_back.
      LEAVE PROGRAM.
    WHEN OTHERS.
      EXIT.
  ENDCASE.
ENDMODULE.
*&---------------------------------------------------------------------*
*&      Module  VALIDATE  INPUT
*&---------------------------------------------------------------------*
*       text
*----------------------------------------------------------------------*
MODULE validate INPUT.
  PERFORM validate.
ENDMODULE.