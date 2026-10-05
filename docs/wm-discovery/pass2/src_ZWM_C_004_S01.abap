*&---------------------------------------------------------------------*
*& Include          ZWM_C_004_S01
*&---------------------------------------------------------------------*
SELECTION-SCREEN: BEGIN OF BLOCK b1 WITH FRAME TITLE TEXT-001 ##TEXT_POOL.
  PARAMETERS : p_file TYPE rlgrap-filename.
SELECTION-SCREEN: END OF BLOCK b1.

AT SELECTION-SCREEN ON VALUE-REQUEST FOR p_file.
  PERFORM get_filename CHANGING p_file.