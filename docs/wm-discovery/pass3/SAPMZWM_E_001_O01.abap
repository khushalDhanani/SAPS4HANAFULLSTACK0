*&---------------------------------------------------------------------*
*& Include          SAPMZWM_E_001_O01
*&---------------------------------------------------------------------*
*&---------------------------------------------------------------------*
*& Module STATUS_9001 OUTPUT
*&---------------------------------------------------------------------*
*&
*&---------------------------------------------------------------------*
MODULE status_9001 OUTPUT.
 SET PF-STATUS 'PF_9001'.
 SET TITLEBAR 'TIT_9001'.

IF GV_TR IS NOT INITIAL.
 LOOP AT SCREEN.
   IF screen-name = 'GV_TR'.
     SCREEN-INPUT = 0.
     MODIFY SCREEN.
   ENDIF.
 ENDLOOP.
ENDIF.

ENDMODULE.

*&---------------------------------------------------------------------*
*& Module STATUS_9999 OUTPUT
*&---------------------------------------------------------------------*
*&
*&---------------------------------------------------------------------*
MODULE status_9999 OUTPUT.

  SET PF-STATUS 'PF_9999'.
  SET TITLEBAR 'PF_9999'.
  CLEAR ok_code_9999.

  IF gs_mess-error = 'E'.
    gv_icon_name  = 'ICON_RED_LIGHT'.
    gv_text       = 'error'.

  ELSEIF gs_mess-error = 'W'.
    gv_icon_name = 'ICON_LED_YELLOW'.
    gv_text       = 'Warning'.

  ELSEIF gs_mess-error = 'S'.
    gv_icon_name = 'ICON_GREEN_LIGHT'.
    gv_text       = 'Success'.
  ENDIF.

  CALL FUNCTION 'ICON_CREATE'
    EXPORTING
      name       = gv_icon_name
*     text       = gv_text
      info       = 'Status'
      add_stdinf = 'X'
    IMPORTING
      result     = gv_icon_9999.
ENDMODULE.