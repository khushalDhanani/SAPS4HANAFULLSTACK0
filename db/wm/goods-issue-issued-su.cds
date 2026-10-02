namespace saps4hana.wm;

using { cuid, managed } from '@sap/cds/common';

/**
 * Tracks Storage Units issued in an Inventory Management (IM) 261 Goods Issue
 * whose Warehouse Management (WM) Transfer Order has not yet been confirmed in LQUA.
 * Prevents double-allocation across concurrent or subsequent reservations.
 */
@cds.persistence.indexes: {
    ClaimLookupIdx: { element: [Material, Plant, StorageLocation, Status] }
}
entity GoodsIssueIssuedStorageUnit : cuid, managed {
    MaterialDocument : String(10);
    MaterialDocYear  : String(4);
    ReservationNo    : String(10);
    ReservationItem  : String(4);
    ReferenceDocument: String(16);
    StorageUnit      : String(20);
    Material         : String(40);
    Plant            : String(4);
    StorageLocation  : String(4);
    IssuedQty        : Decimal(13, 3);
    PreIssueStock    : Decimal(13, 3);
    // 'claiming' | 'issued' | 'released' | 'needs-attention'
    // 'needs-attention': stale claiming row that exceeded the manual-resolve threshold;
    //   operator must call resolveClaimManual(id, 'posted'|'not-posted') to clear.
    Status           : String(20) default 'claiming';
    ReleasedAt       : Timestamp;
    ReleaseReason    : String(50);
    // Set true when the claim has exceeded GI_CLAIMING_NEEDS_ATTENTION_MS without
    // conclusive SAP confirmation. Visible to operators via the Claims admin view.
    NeedsAttention   : Boolean default false;
    Confirmed        : Boolean default true;
    // Operator-supplied resolution: 'posted' (→ issued) or 'not-posted' (→ deleted).
    ManualResolveAction : String(20);
}

/**
 * Per-SU advisory lock row used by acquireClaims to upgrade the re-sum
 * inside READ COMMITTED to a serializable critical section.
 *
 * Protocol (acquireClaims):
 *   1. UPSERT a row for each StorageUnit (idempotent; only one row ever exists per SU).
 *   2. UPDATE the row inside the transaction — the exclusive row lock blocks
 *      any concurrent tx that also tries to UPDATE the same row.
 *   3. INSERT own claiming rows + re-sum + conditional DELETE inside the same tx.
 *   4. Commit (lock released).
 *
 * Isolation level: READ COMMITTED (CAP default for HANA, SQLite, Postgres).
 * The UPDATE-as-mutex converts the critical section to serializable for the SU
 * without requiring SERIALIZABLE isolation on the entire connection, which would
 * cause excessive lock contention on unrelated tables.
 *
 * Notes:
 *   - HANA: UDPATE takes an exclusive row lock; blocked readers wait until commit.
 *   - SQLite (dev/test): UPDATE takes a write lock on the table; blocked ops wait.
 *   - Postgres: UPDATE on an existing row takes a row-level exclusive lock.
 *   - Lock bootstrap: On first claim for an SU, INSERT may hit a unique-key
 *     violation if another tx runs concurrently; handled by retrying as UPDATE.
 *   - Stale lock rows with no active claims can be periodically purged by purgeStaleLocks.
 */
entity GoodsIssueSuLock {
    key StorageUnit : String(20);
    LockVersion     : Integer default 1;
    updatedAt       : Timestamp;
}
