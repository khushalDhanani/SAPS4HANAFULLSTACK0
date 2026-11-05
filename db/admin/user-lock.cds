namespace saps4hana.admin;

/**
 * Last lock state seen per SAP user, so the notification job can tell a new lock from an old one.
 * An operational marker, never a business document: SAP stays the system of record (ADR-0001).
 */
entity UserLockSnapshot {
    key username : String(40);
    uflag        : Integer;     // USR02.UFLAG: 32 global by admin, 64 local by admin, 128 incorrect logons
    appLockUntil : Timestamp;   // the app is locking this user: the job leaves it alone until then
    seenAt       : Timestamp;
}

/** One lock notification. The key stops the same lock being reported twice. */
entity UserLockNotification {
    key username   : String(40);
    key lockedAt   : String(14);   // YYYYMMDDHHMMSS: USH02 MODDA + MODTI, or detection time in UTC
    lockedAtSource : String(10);   // sap | detected
    lockType       : String(20);   // admin-global | admin-local | wrong-password
    lockedBy       : String(255);
    fullName       : String(255);
    source         : String(10);   // app | SAP | auto
    reason         : String(500);
    actor          : String(255);  // who may finish the run; system for the job
    bulkRunId      : String(64);   // events of one run go in one email
    status         : String(20);   // pending | sending | sent | failed
    claimId        : String(36);
    claimedAt      : Timestamp;
    attempts       : Integer;
    sentAt         : Timestamp;
    lastError      : String(60);   // an error code only, never message text that could hold SMTP details
    createdAt      : Timestamp;
}
