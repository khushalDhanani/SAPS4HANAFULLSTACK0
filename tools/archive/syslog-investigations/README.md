# Archived SAP Syslog & Security Audit Log Investigation Tools

This directory preserves one-off discovery, inspection, and verification scripts used during the initial research into SAP System Log (SM21) and Security Audit Log (SM20/RSAU) remote function modules (RFCs).

These scripts are **not** application entry points, CI tasks, or supported operations commands. They have no callers in the application runtime or package scripts. Their findings and results were consolidated into `SAP_SYSLOG_DISCOVERY.md` and culminated in the production implementation of `srv/admin/sap-logs-service.cds`, `srv/admin/sapLogsService.js`, `SystemLogAdapter.js`, and `SecurityAuditLogAdapter.js`.

## Inventory of Archived Files

| Script / Artifact | Description & Historical Role |
| :--- | :--- |
| `check-tfdir-patterns.js` | Checked TFDIR table patterns for available remote-enabled function modules related to syslog in SAP. |
| `check-user-auth.js` | Probed S/4 user authorizations for syslog and audit log RFC execution. |
| `discover-syslog-fms.js` | Discovered candidate function modules for SM21 reading across application servers. |
| `discovery_results.json` | Captured output of initial RFC module discovery. |
| `inspect-remote-fms.js` | Inspected interface signatures (import/export/tables) of remote syslog function modules. |
| `inspect-sm21-rows.js` | Extracted and inspected sample raw SM21 log entries and field formats. |
| `inspect-sm21-templates.js` | Analyzed SM21 message templates and variable token replacement. |
| `phase1_smoke_results.json` | Validation output from early smoke tests against SAP Gateway. |
| `prep-phase1.js` | Setup helper for initial diagnostic checks. |
| `remote_fms_details.json` | Full parameter and structure dump for candidate function modules (`RSLG_READ_SLG`, `TH_SERVER_LIST`, `RSAU_API_GET_LOG_DATA`). |
| `test-phase1-smoke.js` | Executed read-only smoke probe against SAP RFC endpoints. |
| `verify-tz-live.js` | Probed server-local vs UTC timestamp behavior in ET_LOG and ET_LOG_UTC structures. |
