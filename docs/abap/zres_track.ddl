/**
 * ABAP DDL & DDIC Specification for Reservation & WM Tracking
 * System: SAP S/4HANA (ABAP Platform 2023)
 * Package: ZRES_WM
 * Author: Antigravity / Khushal
 */

/* ====================================================================== */
/* 1. DOMAIN: ZRES_STATUS                                                 */
/* ====================================================================== */
/*
   Transaction: SE11 -> Domain -> ZRES_STATUS
   Short Description: Reservation & WM Processing Status
   Data Type: CHAR, Length: 2
   Output Length: 2

   Fixed Values (F4 Value Help):
   -------------------------------------------------------------
   Value | Short Text                    | Long Text
   -------------------------------------------------------------
   01    | Reservation Created           | Reservation Created (MB21)
   02    | TR Created                    | Transfer Requirement Created (LB01)
   03    | TO Created                    | Transfer Order Created (LT04)
   04    | TO Confirmed                  | Transfer Order Confirmed (LT12)
   05    | Goods Issue Posted            | Material Document Posted (MIGO)
   99    | Error / Exception             | Processing Failed
   -------------------------------------------------------------
*/

/* ====================================================================== */
/* 2. DATA ELEMENT: ZRES_STATUS                                           */
/* ====================================================================== */
/*
   Transaction: SE11 -> Data Element -> ZRES_STATUS
   Short Description: Reservation Processing Status
   Elementary Type: Domain ZRES_STATUS
   Field Labels:
     Short (10):   Status
     Medium (20):  Proc Status
     Long (40):    Processing Status
     Heading (55): Reservation WM Status
*/

/* ====================================================================== */
/* 3. DATABASE TABLE: ZRES_TRACK (ABAP DDL define table)                  */
/* ====================================================================== */
/*
   In Eclipse ADT: New -> Database Table -> Name: ZRES_TRACK
   Package: ZRES_WM
   Paste the following DDL code:
*/

@EndUserText.label : 'Reservation & WM Tracking Table'
@AbapCatalog.enhancement.category : #EXTENSIBLE_CHARACTER_NUMERIC
@AbapCatalog.tableCategory : #TRANSPARENT
@AbapCatalog.deliveryClass : #A
@AbapCatalog.dataMaintenance : #ALLOWED
define table zres_track {

  key mandt     : mandt not null;
  key rsnum     : rsnum not null;
  key rspos     : rspos not null;
  move_type     : bwart;
  lgnum         : lgnum;
  tbnum         : tbnum;
  tanum         : tanum;
  mblnr         : mblnr;
  mjahr         : mjahr;
  status        : zres_status;
  err_msg       : bapi_msg;
  created_by    : ernam;
  created_on    : erdat;
  created_at    : erzet;
  changed_by    : aenam;
  changed_on    : aedat;
  changed_at    : aezet;

}

/* ====================================================================== */
/* 4. DATABASE TABLE: ZRES_LOG (ABAP DDL define table)                    */
/* ====================================================================== */
/*
   In Eclipse ADT: New -> Database Table -> Name: ZRES_LOG
   Package: ZRES_WM
   Paste the following DDL code:
*/

@EndUserText.label : 'Reservation & WM Step-Wise Log Table'
@AbapCatalog.enhancement.category : #EXTENSIBLE_CHARACTER_NUMERIC
@AbapCatalog.tableCategory : #TRANSPARENT
@AbapCatalog.deliveryClass : #A
@AbapCatalog.dataMaintenance : #ALLOWED
define table zres_log {

  key mandt     : mandt not null;
  key log_id    : sysuuid_c32 not null;
  rsnum         : rsnum;
  rspos         : rspos;
  step          : char10;
  status        : zres_status;
  msgty         : bapi_mtype;
  msgid         : symsgid;
  msgno         : symsgno;
  message       : bapi_msg;
  created_by    : ernam;
  created_on    : erdat;
  created_at    : erzet;

}

/* ====================================================================== */
/* 5. ABAP TEST DATA INSERT REPORT: ZRES_TRACK_INSERT_TEST                */
/* ====================================================================== */
/*
REPORT zres_track_insert_test.

DATA: ls_track TYPE zres_track,
      ls_log   TYPE zres_log.

" 1. Insert Track Record for live proven Reservation 0000524979
CLEAR ls_track.
ls_track-rsnum      = '0000524979'.
ls_track-rspos      = '0001'.
ls_track-move_type  = '311'.
ls_track-lgnum      = 'W01'.
ls_track-status     = '01'. " Reservation Created
ls_track-created_by = sy-uname.
ls_track-created_on = sy-datum.
ls_track-created_at = sy-uzeit.
MODIFY zres_track FROM ls_track.

" 2. Insert Initial Log Entry
CLEAR ls_log.
TRY.
    ls_log-log_id = cl_system_uuid=>create_uuid_c32_static( ).
  CATCH cx_uuid_error.
ENDTRY.
ls_log-rsnum      = '0000524979'.
ls_log-rspos      = '0001'.
ls_log-step       = 'MB21'.
ls_log-status     = '01'.
ls_log-msgty      = 'S'.
ls_log-msgid      = 'M7'.
ls_log-msgno      = '060'.
ls_log-message    = 'Document 0000524979 posted'.
ls_log-created_by = sy-uname.
ls_log-created_on = sy-datum.
ls_log-created_at = sy-uzeit.
MODIFY zres_log FROM ls_log.

WRITE: / 'Test data successfully inserted into ZRES_TRACK and ZRES_LOG for Reservation 0000524979'.
*/
