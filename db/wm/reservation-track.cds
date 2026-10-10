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
    TransferRequirement     : String(10);    // TBNUM (LB01)
    TransferOrder           : String(10);    // TANUM (LT04)
    MaterialDocument        : String(10);    // MBLNR (MIGO)
    MaterialDocYear         : String(4);     // MJAHR (MIGO)
    Status                  : Association to ReservationStatus; // STATUS
    ErrorMessage            : String(255);   // ERR_MSG
    Logs                    : Association to many ReservationLog
                                  on Logs.ReservationNo = ReservationNo
                                 and Logs.ReservationItem = ReservationItem;
}

/**
 * Step-Wise Log Table: ZRES_LOG
 * Mirrors ABAP transparent log table ZRES_LOG
 */
entity ReservationLog : cuid, managed {
    ReservationNo   : String(10);    // RSNUM
    ReservationItem : String(4);     // RSPOS
    Step            : String(10);    // MB21 | LB01 | LT04 | LT12 | MIGO
    Status          : String(10);    // Status at time of step
    MessageType     : String(1);     // S | E | W | I
    MessageId       : String(20);    // Message Class (e.g. M7, L3)
    MessageNo       : String(3);     // Message Number (e.g. 060, 529)
    MessageText     : String(255);   // Descriptive message text
    Track           : Association to ReservationTrack
                          on Track.ReservationNo = ReservationNo
                         and Track.ReservationItem = ReservationItem;
}
