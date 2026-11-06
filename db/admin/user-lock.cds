namespace saps4hana.admin;

/*
 * State of the lock monitor. Operational markers only, never business documents: SAP stays the system of
 * record for users and locks (ADR-0001). The monitor is the only writer of the snapshot and the notifications.
 */

/** Last lock state seen per SAP user. Empty means the monitor has not stored its baseline yet. */
entity UserLockSnapshot {
    key username : String(40);
    uflag        : Integer;     // USR02.UFLAG, 0 when not locked
    seenAt       : Timestamp;
}

/** Who is locking a user through the app, and why. Written before the BAPI, read when the monitor sees the lock. */
entity UserLockContext {
    key username : String(40);
    actor        : String(255);
    reason       : String(500);
    bulkRunId    : String(64);
    at           : Timestamp;
    historyKey   : String(255);
}

/** One detected lock. The key stops the same lock being emailed twice, even after a restart. */
entity UserLockNotification {
    key username   : String(40);
    key lockedAt   : String(14);   // YYYYMMDDHHMMSS: USH02 MODDA + MODTI, or detection time in UTC
    uflag          : Integer;
    lockType       : String(120);
    lockedBy       : String(255);
    fullName       : String(255);
    source         : String(30);
    reason         : String(500);
    bulkRunId      : String(64);
    status         : String(20);   // pending | sent
    attempts       : Integer;
    failureAudited : Boolean;
    detectedAt     : Timestamp;
    sentAt         : Timestamp;
    lastError      : String(60);   // an error code only, never message text that could hold SMTP details
}

/** The last check, shared by all instances: only one runs the monitor, but any may answer the screen. */
entity UserLockMonitor {
    key id              : String(20);
    lastCheckedAt       : Timestamp;
    lastStatus          : String(10);    // ok | failed
    ush02At             : String(14);
    ush02Key            : String(255);
    cursorStallCount    : Integer;
    errorMessage        : String(255);
}
