/**
 * SapLogsService
 *
 * Read-only CAP service providing access to SM21 (System Log) and SM20 (Security Audit Log)
 * via RFC adapters. Restricted to the Admin role; no anonymous or generic authenticated access.
 *
 * Evidence (DS4/220, Phase 1 & 2 live verification, 2026-11-17):
 *   - RSLG_READ_SLG:         CONFIRMED readable via RFC.
 *   - RSAU_API_GET_LOG_DATA: CONFIRMED readable via RFC.
 *   - Timezone:              CONFIRMED IST (+330 minutes).
 *
 * Pagination & Windowing Rules:
 *   - Each page re-fetches the time window from SAP; there is no server-side cursor.
 *   - Callers MUST supply a fixed 'toUtc' parameter that is not in the future across consecutive paging calls.
 *   - Future 'toUtc' timestamps are rejected with HTTP 400.
 *
 * Config keys (process.env):
 *   SAPLOGS_MAX_SPAN_SM21_HOURS    — maximum allowed time span for SM21 queries (default: 24)
 *   SAPLOGS_MAX_SPAN_SM20_HOURS    — maximum allowed time span for SM20 queries (default: 6)
 *   SAPLOGS_DEFAULT_ROW_CAP        — default row limit per request (default: 500)
 *   SAPLOGS_SM21_TZ_OFFSET_MINUTES — server-local offset in minutes (default: 330)
 *   SAPLOGS_SM20_TZ_OFFSET_MINUTES — SM20 fallback conversion offset (default: 330)
 *   SAPLOGS_SM20_REJECT_ON_FALLBACK— reject when ET_LOG_UTC is empty (default: false)
 *   SAPLOGS_INCLUDE_USER           — return user IDs in log rows (default: false, for privacy)
 *
 * No log content is ever persisted (no DB, no files, no debug logs).
 * Access metadata (user, log type, window, row count) is logged via LOG.info() per request.
 */
@(requires: 'SapLogsReader')
service SapLogsService @(path: '/odata/v4/sap-logs', impl: './sapLogsService.js') {

    /**
     * Retrieve SM21 System Log entries.
     *
     * Parameters:
     *   fromUtc  — Required. ISO 8601 UTC datetime string for window start.
     *   toUtc    — Required. ISO 8601 UTC datetime string for window end. Must NOT be in the future.
     *              Maximum span: SAPLOGS_MAX_SPAN_SM21_HOURS (default 24 h).
     *   instance — Optional. Application server instance name.
     *              Defaults to all instances (queried sequentially, results merged and sorted by time).
     *   top      — Optional. Row limit 1–500 (default: SAPLOGS_DEFAULT_ROW_CAP / 500).
     *   skip     — Optional. Row offset for pagination (0+, default 0).
     *
     * Returns:
     *   entries   — Allow-listed, sanitized log rows.
     *   count     — Number of entries returned.
     *   truncated — true when the RFC result was larger than the row cap.
     *   nextSkip  — skip value to use in the next page request.
     */
    function getSystemLog(
        fromUtc  : String,
        toUtc    : String,
        instance : String,
        top      : Integer,
        skip     : Integer
    ) returns {
        entries  : array of {
            entryType      : String;
            timestamp      : String;   // ISO 8601 UTC timestamp (converted from server time)
            serverTimestamp: String;   // Raw server-local YYYYMMDDHHMMSS00 (16 chars)
            processId      : String;
            client         : String;
            mode           : String;
            tcode          : String;
            program        : String;
            message        : String;   // sanitized SLGDATA variable parameter values
            messageText    : String;   // EXPERIMENTAL / UNVERIFIED: English template with substituted parameters; null by default unless SAPLOGS_ENABLE_MESSAGE_TEXT=true and all placeholders resolve cleanly
            instance       : String;
            user           : String;   // only populated when SAPLOGS_INCLUDE_USER=true
        };
        count    : Integer;
        truncated: Boolean;
        nextSkip : Integer;
    };

    /**
     * Retrieve SM20 Security Audit Log entries.
     *
     * Parameters:
     *   fromUtc  — Required. ISO 8601 UTC datetime string for window start.
     *   toUtc    — Required. ISO 8601 UTC datetime string for window end. Must NOT be in the future.
     *              Maximum span: SAPLOGS_MAX_SPAN_SM20_HOURS (default 6 h).
     *   top      — Optional. Row limit 1–500 (default: SAPLOGS_DEFAULT_ROW_CAP / 500).
     *   skip     — Optional. Row offset for pagination (0+, default 0).
     *   user     — Optional. Filter by SAP username.
     *
     * Returns:
     *   entries   — Allow-listed, sanitized log rows.
     *   count     — Number of entries returned.
     *   truncated — true when the RFC result was larger than the row cap.
     *   nextSkip  — skip value to use in the next page request.
     *   warnings  — Non-fatal warnings and fallback notices.
     */
    function getSecurityAuditLog(
        fromUtc  : String,
        toUtc    : String,
        top      : Integer,
        skip     : Integer,
        user     : String
    ) returns {
        entries  : array of {
            systemId    : String;
            instance    : String;
            date        : String;   // UTC YYYYMMDD
            time        : String;   // UTC HHMMSS
            serverDate  : String;   // Raw server date
            serverTime  : String;   // Raw server time
            client      : String;
            area        : String;
            subId       : String;
            eventId     : String;
            eventText   : String;
            severity    : Integer;
            severityText: String;
            tcode       : String;
            program     : String;
            message     : String;   // sanitized; raw SAL_DATA not returned
            taskType    : String;
            taskNo      : String;
            utcTimestamp: String;   // LOG_TSTMP decimal UTC timestamp
            user        : String;   // only populated when SAPLOGS_INCLUDE_USER=true
        };
        count    : Integer;
        truncated: Boolean;
        nextSkip : Integer;
        warnings : array of String;
    };
}
