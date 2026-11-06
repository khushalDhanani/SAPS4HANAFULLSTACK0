/**
 * UserManagementService
 *
 * Provides Admin-only access to SAP SU01 user data via RFC BAPIs: list and detail reads, lock and unlock.
 * The RFC connection user holds S_USER_GRP activity 05 on DS4/220 (AUTHORITY_CHECK, 2026-11-05) — see WORKSTATUS.md.
 *
 * Gated to the Admin role only. No data is accessible to any other role.
 */
@(requires: 'Admin')
service UserManagementService @(path: '/odata/v4/user-management') {

    /**
     * List SAP users.
     * Returns up to `maxRows` users (default 200), optionally filtered by `search`
     * (case-insensitive substring match on USERNAME).
     * Backed by BAPI_USER_GETLIST with client-side filtering and BAPI_USER_GET_DETAIL enrichment.
     * A row with detailsAvailable=false has unknown detail fields and must not expose lock actions.
     * CONFIRMED READ-ONLY: 2026-11-03 DS4/220.
     */
    function listUsers(search: String, maxRows: Integer) returns array of {
        username        : String;
        firstName       : String;
        lastName        : String;
        fullName        : String;
        detailsAvailable: Boolean;
        isLocked        : Boolean;
        userType        : String;
        validFrom       : String;
        validTo         : String;
        lastChanged     : String;
        lastChangedBy   : String;
        protectedReason : String;   // why the user cannot be locked: self, connection, type, or empty
        pwdLastChanged  : String;
        pwdExpiresAt    : String;
        pwdDaysRemaining: Integer;
        pwdStatus       : String;   // valid | expiring_soon | expired | initial | exempt
    };

    /**
     * Get full detail for a single SAP user.
     * Backed by BAPI_USER_GET_DETAIL (import param USERNAME).
     * CONFIRMED READ-ONLY: 2026-11-03 DS4/220.
     */
    function getUserDetail(username: String) returns {
        username     : String;
        firstName    : String;
        lastName     : String;
        fullName     : String;
        email        : String;
        phone        : String;   // ADDRESS.TEL1_NUMBR + TEL1_EXT
        department   : String;   // ADDRESS.DEPARTMENT
        jobFunction  : String;   // ADDRESS.FUNCTION
        company      : String;   // COMPANY.COMPANY
        createdBy    : String;   // ADMINDATA.ANAME
        createdOn    : String;   // ADMINDATA.ERDAT
        lastLogonDate: String;   // ADMINDATA.TRDAT
        lastLogonTime: String;   // LOGONDATA.LTIME
        language     : String;   // DEFAULTS.LANGU
        dateFormat   : String;   // DEFAULTS.DATFM
        decimalFormat: String;   // DEFAULTS.DCPFM
        costCenter   : String;   // DEFAULTS.KOSTL
        timeZone     : String;   // LOGONDATA.TZONE
        userType     : String;   // LOGONDATA.USTYP: A=Dialog, B=System, C=Comm, S=Service, L=Reference
        validFrom    : String;   // LOGONDATA.GLTGV (00000000 = no restriction)
        validTo      : String;   // LOGONDATA.GLTGB (00000000 = no restriction)
        userGroup    : String;   // LOGONDATA.CLASS
        lockedWrong  : String;   // ISLOCKED.WRNG_LOGON
        lockedNoPw   : String;   // ISLOCKED.NO_USER_PW
        lockedGlobal : String;   // ISLOCKED.GLOB_LOCK
        lockedLocal  : String;   // ISLOCKED.LOCAL_LOCK
        isLocked     : Boolean;  // true if any lock flag is set (L or X)
        roleCount    : Integer;
        profileCount : Integer;
        lastChanged  : String;   // LASTMODIFIED.MODDATE
        protectedReason: String; // why the user cannot be locked: self, connection, type, or empty
        lastChangedTime: String; // LASTMODIFIED.MODTIME
        lastChangedBy: String;   // LASTMODIFIED.MODIFIER
        pwdLastChanged : String;
        pwdExpiresAt   : String;
        pwdDaysRemaining: Integer;
        pwdStatus      : String; // valid | expiring_soon | expired | initial | exempt
        roles        : array of {   // ACTIVITYGROUPS
            name       : String;
            description: String;
            validFrom  : String;
            validTo    : String;
        };
        profiles     : array of {   // PROFILES
            name       : String;
            description: String;
        };
    };

    type ActionResult {
        success : Boolean;
        message : String;
        username: String;
        status  : String;   // success or warning, from the BAPI RETURN table
        messages: array of {   // BAPI RETURN
            type   : String;
            id     : String;
            number : String;
            message: String;
        };
    };

    /**
     * Lock an SAP user account.
     * Backed by BAPI_USER_LOCK + BAPI_TRANSACTION_COMMIT in a single session.
     * Refuses protected users (srv/admin/protectedUsers.js), including the active RFC connection user (fail-closed).
     */
    action lockUser(username: String, reason: String, bulkRunId: String) returns ActionResult;

    /**
     * Unlock an SAP user account.
     * Backed by BAPI_USER_UNLOCK + BAPI_TRANSACTION_COMMIT in a single session.
     */
    action unlockUser(username: String, reason: String) returns ActionResult;

    /**
     * The lock monitor, for the SU01 header. State is off, starting, ok, failed, or stale.
     */
    function getLockMonitor() returns {
        state                       : String;
        lastCheckedAt               : Timestamp;
        errorMessage                : String;
        recipient                   : String;
        pollIntervalSec             : Integer;
        maxPerEmail                 : Integer;
        pendingEmails               : Integer;
        lastSuccessfulPollAt        : Timestamp;
        lastFailedPollAt            : Timestamp;
        pollDurationMs              : Integer;
        lastNotificationDispatchedAt: Timestamp;
        pendingNotificationCount    : Integer;
        failedNotificationCount     : Integer;
    };

    /**
     * Whether the lock monitor has emailed a bulk run: queued, sent, retrying, or not_configured.
     */
    function getBulkLockEmailStatus(bulkRunId: String) returns {
        status: String;
    };

    /**
     * Aggregated password expiry metrics for dashboard KPI cards.
     */
    function getPasswordExpirySummary() returns {
        totalMonitored   : Integer;
        valid            : Integer;
        expiringSoon     : Integer;   // <= 14 days
        criticalExpiring : Integer;   // <= 3 days
        expired          : Integer;   // < 0 days or GLTGB past
        initialPassword  : Integer;   // never changed / 00000000
        exempt           : Integer;   // System / Service types
        policyDays       : Integer;   // configured expiration period in days
        warningDays      : Integer;   // configured warning threshold in days
    };

    /**
     * Filtered list of users with password expiry details.
     */
    function getPasswordExpiryList(search: String, status: String, maxRows: Integer) returns array of {
        username        : String;
        fullName        : String;
        userType        : String;
        isLocked        : Boolean;
        validFrom       : String;
        validTo         : String;
        lastLogonDate   : String;
        lastLogonTime   : String;
        pwdLastChanged  : String;
        pwdExpiresAt    : String;
        pwdDaysRemaining: Integer;
        pwdStatus       : String;
    };

    /**
     * Operational health of the password expiry monitor daemon.
     */
    function getPasswordExpiryMonitor() returns {
        state                       : String;       // ok | failed | stale | off
        lastRunAt                   : Timestamp;
        lastStatus                  : String;
        lastRunDurationMs           : Integer;
        totalMonitoredUsers         : Integer;
        expiringSoonCount           : Integer;
        expiredCount                : Integer;
        initialPasswordCount        : Integer;
        exemptCount                 : Integer;
        lastNotificationDispatchedAt: Timestamp;
        pendingNotificationCount    : Integer;
        failedNotificationCount     : Integer;
        errorMessage                : String;
    };
}
