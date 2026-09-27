FUNCTION L_TO_CREATE_TR
  IMPORTING
    VALUE(I_LGNUM) LIKE LTAK-LGNUM
    VALUE(I_TBNUM) LIKE LTAK-TBNUM
    VALUE(I_REFNR) LIKE LTAK-REFNR DEFAULT SPACE
    VALUE(I_SQUIT) LIKE RL03T-SQUIT DEFAULT SPACE
    VALUE(I_NIDRU) LIKE RL03A-NIDRU DEFAULT SPACE
    VALUE(I_DRUKZ) LIKE T329F-DRUKZ DEFAULT SPACE
    VALUE(I_LDEST) LIKE LTAP-LDEST DEFAULT SPACE
    VALUE(I_TBELI) LIKE RL03T-TBELI DEFAULT SPACE
    VALUE(I_NOSPL) LIKE RL03A-NOSPL DEFAULT SPACE
    VALUE(I_UPDATE_TASK) LIKE RL03A-VERBU DEFAULT SPACE
    VALUE(I_COMMIT_WORK) LIKE RL03B-COMIT DEFAULT 'X'
    VALUE(I_BNAME) LIKE LTAK-BNAME DEFAULT SY-UNAME
    VALUE(I_TEILK) LIKE T340D-TEILV DEFAULT SPACE
    VALUE(I_SOLEX) LIKE LTAK-SOLEX DEFAULT 0
    VALUE(I_PERNR) LIKE LTAK-PERNR DEFAULT 0
    VALUE(I_RSNUM) LIKE LTAK-RSNUM DEFAULT SPACE
    VALUE(I_LDEST_LANG) LIKE TSP03L-LNAME DEFAULT SPACE
    VALUE(IT_TRITE) TYPE L03B_TRITE_T OPTIONAL
  EXPORTING
    VALUE(E_TANUM) LIKE LTAK-TANUM
    VALUE(E_TEILK) LIKE T340D-TEILV
  TABLES
    T_LTAK LIKE LTAK_VB OPTIONAL
    T_LTAP_VB LIKE LTAP_VB OPTIONAL
    T_WMGRP_MSG LIKE WMGRP_MSG OPTIONAL
  EXCEPTIONS
    FOREIGN_LOCK
    QM_RELEVANT
    TR_COMPLETED
    XFELD_WRONG
    LDEST_WRONG
    DRUKZ_WRONG
    TR_WRONG
    SQUIT_FORBIDDEN
    NO_TO_CREATED
    UPDATE_WITHOUT_COMMIT
    NO_AUTHORITY
    PREALLOCATED_STOCK
    PARTIAL_TRANSFER_REQ_FORBIDDEN
    INPUT_ERROR.



* Wegen Form Daten_Sammelgang_1 als Dummy Inputparameter
  DATA:   LT_VBELN_SAM LIKE VBELN_TAB_SAMM OCCURS 0 WITH HEADER LINE.
  CLEAR   LT_VBELN_SAM.
  REFRESH LT_VBELN_SAM.

*........Initialisierung................................................

  CALL FUNCTION 'L_SAPLL03A_INIT_INT'.
  PERFORM SAPML03T_INIT(SAPML03T).
  CALL FUNCTION 'L_WMPP_INITIALIZATION'.                      "n_1737612
  CALL FUNCTION 'HU_PACKING_REFRESH'.
  FLG_KEINE_DYNPROS = CON_TRUE.
  CLEAR: E_TEILK.

*........Steuertabellen lesen...........................................

  PERFORM T340_LESEN(SAPML03T) USING CON_TCODE_TA_ZUM_TB.
* PERFORM BERECHTIGUNG_TCODE(SAPFL000) USING CON_TCODE_TA_ZUM_TB.

  PERFORM T300_LESEN(SAPML03T) USING I_LGNUM.
  PERFORM T340D_LESEN(SAPML03T) USING I_LGNUM.
  PERFORM BERECHTIGUNG_LGNUM(SAPFL000) USING CON_BER_MP I_LGNUM.

*........TB lesen und sperren...........................................

  PERFORM DATEN_TA_ZUM_TB_INIT.
  PERFORM TB_LESEN(SAPML03T) USING I_LGNUM I_TBNUM INIT_TBPOS.
  PERFORM D0131_TB_BEARBEITEN(SAPML03T).

*........Prüfung der Übergabeparameter..................................

* Change long name of the device into short name for further process.
  IF ( NOT I_LDEST_LANG IS INITIAL ) AND
     ( I_LDEST IS INITIAL ).
    SELECT PADEST
       INTO (I_LDEST)
       FROM TSP03L
       WHERE LNAME = I_LDEST_LANG.

      EXIT.
    ENDSELECT.
    IF I_LDEST IS INITIAL.
      MESSAGE E338 WITH I_LDEST RAISING LDEST_WRONG.
    ENDIF.

  ENDIF.

* >>> Positionsvorgaben bei L_TO_CREATE_TR
  PERFORM TA_ZUM_TB_PRUEFEN USING IT_TRITE.
  PERFORM TBP_BEARBEITEN TABLES TBP
                         USING  IT_TRITE.

*........Erzeugen über Funktionsbausteine...............................

  PERFORM TA_ZUM_TB_ERZEUGEN.

  APPEND LINES OF T_GRP_MSG TO T_WMGRP_MSG.

*........Sammelgangextras Teil 1........................................
  PERFORM DATEN_SAMMELGANG_1(SAPML03T) TABLES LT_VBELN_SAM.

*........ sichern der iltbl auf iltbl_sav ..............................

  loop at iltbl.                                           "v_n_798522
     move-corresponding iltbl to iltbl_sav.
     append iltbl_sav.
  endloop.                                                 "^_n_798522

*........Aufruf der Verbuchung..........................................

  RL03A-NIDRU = I_NIDRU.
  RL03A-VERBU = I_UPDATE_TASK.
  RL03A-NOSPL = I_NOSPL.
  RL03A-TBELI = I_TBELI.

   loop at ilqals.                                           "v_n_898234
    loop at int_stich where qplos = ilqals-qplos and
                      not   KZSKIPLOT is initial.
      if ilqals-lgtyp is initial and
         int_stich-lvs_stikz <> con_stikz_im_lager.
        ilqals-lgtyp = int_stich-lgtyp.
        ilqals-lgpla = int_stich-lgpla.
        if int_stich-lvs_stikz = con_stikz_we_zone.
          ilqals-stawe = con_x.
        else.
          ilqals-stawe = int_stich-lvs_stikz.
        endif.
      endif.
      modify ilqals.
    endloop.
  endloop.                                                  "^_n_898234

  CALL FUNCTION 'L_TO_CREATE_INT'
    EXPORTING
      I_RL03A   = RL03A
    IMPORTING
      E_TANUM   = E_TANUM
    TABLES
      T_LTAK    = T_LTAK
      T_LTAP_VB = T_LTAP_VB
      T_LTBL    = ILTBL
      T_LQALS   = ILQALS.

  DESCRIBE TABLE T_LTAK LINES CNT_LINES.
  IF CNT_LINES > 1.
    CLEAR: E_TANUM.
  ENDIF.
  IF E_TANUM IS INITIAL AND CNT_LINES = 0.
    DESCRIBE TABLE ILTBL_sav LINES CNT_LINES.              "n_798522
    IF CNT_LINES = 0.
      MESSAGE E332 RAISING NO_TO_CREATED.
    ENDIF.
    refresh iltbl_sav.                                     "n_798522
  ENDIF.

*........Sammelgangextras Teil 2........................................

* LTAK-TANUM = E_TANUM.
  PERFORM DATEN_SAMMELGANG_2(SAPML03T) TABLES T_LTAK.

  PERFORM COMMIT_WORK.

ENDFUNCTION.