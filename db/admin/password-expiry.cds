namespace saps4hana.admin;

/*
 * State of the password expiry monitor. Operational tracking and milestone deduplication only.
 * SAP stays the system of record for users and credentials (ADR-0001).
 * Hash columns are never stored or referenced anywhere in this model.
 */

/** Last calculated password status per SAP user. */
entity UserPasswordSnapshot {
    key username        : String(40);
    userType            : String(1);
    pwdLastChanged      : String(8);    // YYYYMMDD
    pwdExpiresAt        : String(8);    // YYYYMMDD
    pwdDaysRemaining    : Integer;
    pwdStatus           : String(20);   // valid | expiring_soon | expired | initial | exempt
    validFrom           : String(8);    // YYYYMMDD (GLTGV)
    validTo             : String(8);    // YYYYMMDD (GLTGB)
    uflag               : Integer;
    lastLogonDate       : String(8);    // YYYYMMDD (TRDAT)
    seenAt              : Timestamp;
}

/** Milestone notification event to ensure at most one notification is dispatched per milestone */
entity UserPasswordNotification {
    key username        : String(40);
    key milestone       : String(20);   // 14_days | 7_days | 3_days | 1_day | expired | initial
    key cycleDate       : String(8);    // YYYYMMDD of detection
    fullName            : String(255);
    userType            : String(1);
    daysRemaining       : Integer;
    expiryDate          : String(8);
    status              : String(20);   // pending | processing | sent | failed
    attempts            : Integer;
    failureAudited      : Boolean;
    detectedAt          : Timestamp;
    sentAt              : Timestamp;
    lastError           : String(60);   // error code only, never credentials or sensitive text
    claimOwner          : String(120);  // worker ID holding current processing lease
    claimedAt           : Timestamp;
    claimExpiresAt      : Timestamp;
    nextRetryAt         : Timestamp;
}

/** Operational monitor tracking daemon runs and health */
entity PasswordExpiryMonitor {
    key id                          : String(20);
    lastRunAt                       : Timestamp;
    lastStatus                      : String(10);   // ok | failed
    lastRunDurationMs               : Integer;
    totalMonitoredUsers             : Integer;
    validCount                      : Integer;
    expiringSoonCount               : Integer;
    expiredCount                    : Integer;
    initialPasswordCount            : Integer;
    exemptCount                     : Integer;
    lastNotificationDispatchedAt    : Timestamp;
    pendingNotificationCount        : Integer;
    failedNotificationCount         : Integer;
    errorMessage                    : String(255);
}

