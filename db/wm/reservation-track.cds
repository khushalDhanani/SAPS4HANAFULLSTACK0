namespace saps4hana.wm;

using { cuid, managed } from '@sap/cds/common';

/**
 * Status Code List for Reservation & WM Lifecycle
 */
@cds.odata.valuelist
entity ReservationStatus {
    key code  : String(10);
    name      : String(50);
    descr     : String(120);
    criticality : Integer; // 1: Red (Error), 2: Yellow (In Progress), 3: Green (Completed), 0: Neutral
}

/**
 * Core Tracking Table: ZRES_TRACK
 * Mirrors ABAP transparent table ZRES_TRACK
 */
@assert.unique: { resItem: [ReservationNo, ReservationItem] }
entity ReservationTrack : managed {
    key ReservationNo       : String(10);    // RSNUM
    key ReservationItem     : String(4);     // RSPOS
    MovementType            : String(3);     // MOVE_TYPE / BWART (201, 241, 311, 301)
    WarehouseNumber         : String(3);     // LGNUM
    Plant                   : String(4);     // WERKS
    StorageLocation         : String(4);     // LGORT
    Material                : String(40);    // MATNR
    MaterialName            : String(40);    // MAKTX
    Quantity                : Decimal(13,3); // MENGE
    Unit                    : String(3);     // MEINS
    ReservationDate         : Date;          // RES_DATE (MB21)
    CreatedByUser           : String(12);    // USNAM (RKPF-USNAM / Creator User)
    ReceivingPlant          : String(4);     // UMWRK (301)
    ReceivingStorageLocation: String(4);     // UMLGO (311)
    CostCenter              : String(10);    // KOSTL (201)
    AssetNo                 : String(12);    // ANLN1 (241)
    SubNumber               : String(4);     // ANLN2 (241)
    OrderID                 : String(12);    // AUFNR (261)
    OrderType               : String(4);     // AUART (261, e.g. ZEMP)
    TransferRequirement     : String(10);    // TBNUM (LB01)
    TransferOrder           : String(10);    // TANUM (LT04)
    MaterialDocument        : String(10);    // MBLNR (MIGO)
    MaterialDocYear         : String(4);     // MJAHR (MIGO)
    WithdrawnQuantity       : Decimal(13,3); // ENMNG (MIGO)
    RemainingQuantity       : Decimal(13,3); // BDMNG - ENMNG
    CompletelyProcessed     : Boolean;       // true when remaining == 0 or KZEAR = 'X'
    ProcessStatus           : String(35);    // PROCESS_STATUS (CREATED, RESERVATION_CREATED, TR_CREATED, TR_VERIFIED, TO_CREATED, TO_CONFIRMED, MIGO_POSTED, STOCK_VERIFIED, COMPLETED, FAILED_*)
    MigoBusinessKey         : String(120);   // Idempotency business key (RES:xxx/yy#TO:zzz#PID:ppp)
    LogHandle               : String(22);    // BALLOGHNDL (SLG1 Application Log Handle)
    ExternalId              : String(100);   // BALEXTN (SLG1 External ID)
    Status                  : Association to ReservationStatus; // STATUS
    ErrorMessage            : String(255);   // ERR_MSG
    ErrorStep               : String(10);    // ERROR_STEP (LB01 | LT04 | LT12 | MIGO)
    ProcessId               : UUID;          // PROCESS_ID of the current TO/GI step (see ReservationLog.ProcessId)
    Logs                    : Association to many ReservationLog
                                  on Logs.ReservationNo = ReservationNo
                                 and Logs.ReservationItem = ReservationItem;
}

/**
 * Step-Wise Log Table: ZRES_LOG
 * Mirrors ABAP transparent log table ZRES_LOG with SLG1 Application Log fields
 */
entity ReservationLog : cuid, managed {
    ReservationNo   : String(10);    // RSNUM
    ReservationItem : String(4);     // RSPOS
    LogHandle       : String(22);    // BALLOGHNDL (SLG1 Application Log Handle)
    ExternalId      : String(100);   // BALEXTN (SLG1 External ID)
    SubObject       : String(20);    // BALSUBOBJ (e.g. TRACK, PROCESS)
    Step            : String(10);    // MB21 | LB01 | LT04 | LT12 | MIGO
    Status          : String(10);    // Status at time of step
    ProcessStatus   : String(35);    // Process Status at time of step
    MigoBusinessKey : String(120);   // Idempotency business key (RES:xxx/yy#TO:zzz#PID:ppp)
    MessageType     : String(1);     // S | E | W | I
    MessageId       : String(20);    // Message Class (e.g. M7, L3)
    MessageNo       : String(3);     // Message Number (e.g. 060, 529)
    MessageText     : String(255);   // Descriptive message text
    ProcessId       : UUID;          // PROCESS_ID of the TO/GI step this row belongs to (one per TO / goods movement)
    DocumentNo      : String(10);    // TANUM / MBLNR produced by the step
    Track           : Association to ReservationTrack
                          on Track.ReservationNo = ReservationNo
                         and Track.ReservationItem = ReservationItem;
}

/**
 * Step 7.7: one row per reservation-create attempt, written in its own transaction BEFORE
 * BAPI_RESERVATION_CREATE1 so that a timeout, crash or local failure after the SAP commit leaves a
 * record with the SAP document number and the exact stage. Never a business document (ADR-0001).
 * Stage: RESERVATION_PENDING | RESERVATION_CREATED | RESERVATION_REJECTED | RESERVATION_UNKNOWN |
 *        RESERVATION_CREATED_MISMATCH | RESERVATION_ALREADY_TRACKED | LOCAL_PERSIST_FAILED |
 *        TR_CREATED | TR_FAILED (the TR phase runs under RESERVATION_CREATED and is written when the request ends)
 */
@assert.unique: { attemptKey: [AttemptKey] }
entity ReservationCreateAttempt : cuid, managed {
    AttemptKey          : String(80);    // RequestHash (business key of the intent) + ':' + generation
    ClientAttemptId     : String(36);    // audit only: which UI form instance submitted
    RequestHash         : String(64);    // SHA-256 of the canonical payload + user = the reservation intent
    RequestUser         : String(255);
    MovementType        : String(3);
    Plant               : String(4);
    StorageLocation     : String(4);
    Material            : String(40);
    Quantity            : Decimal(13,3);
    Unit                : String(3);
    Stage               : String(30);
    ReservationNo       : String(10);    // RSNUM as soon as SAP returns it
    ReservationItem     : String(4);
    TransferRequirement : String(10);
    LastError           : String(500);
    ResolvedAt          : Timestamp;
}
