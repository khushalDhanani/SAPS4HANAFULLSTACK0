/**
 * UserManagementService — Phase 1 (read-only)
 *
 * Provides Admin-only access to SAP SU01 user data via RFC BAPIs.
 * All operations are read-only in Phase 1. Write operations (lock, create, etc.)
 * require S_USR_ADM authority on the RFC connection user — see WORKSTATUS.md.
 *
 * Gated to the Admin role only. No data is accessible to any other role.
 */
@(requires: 'Admin')
service UserManagementService @(path: '/odata/v4/user-management') {

    /**
     * List SAP users.
     * Returns up to `maxRows` users (default 200), optionally filtered by `search`
     * (case-insensitive substring match on USERNAME).
     * Backed by BAPI_USER_GETLIST with client-side filtering.
     * CONFIRMED READ-ONLY: 2026-11-03 DS4/220.
     */
    function listUsers(search: String, maxRows: Integer) returns array of {
        username     : String;
        firstName    : String;
        lastName     : String;
        fullName     : String;
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
        lastChangedBy: String;   // LASTMODIFIED.MODUSER
    };
}

