# SAP S/4HANA SM21 (System Log) and SM20 (Security Audit Log) Discovery Report

**Target System:** `S4HANA_DEV` | **Client:** `220` | **Host:** `https://[s4-host]:44300`  
**Execution Timestamp:** 2026-11-17T08:00:00Z  
**Mode:** READ-ONLY (Live SAP Discovery with `ALLOW_LIVE_SAP_TOOLS=1`)

---

## 1. Executive Summary & Evidence Table

Every check below was performed directly against `S4HANA_DEV` (Client 220) or verified against the repository baseline.

| Check | Target / Method | Result | Evidence Level |
| :--- | :--- | :--- | :--- |
| **OData V4 Catalog Check** | `/sap/opu/odata4/iwfnd/config/default/iwfnd/catalog/0002` | HTTP 307 redirect to trailing slash, then **HTTP 404 Not Found** (`/IWBEP/CM_V4_COS/014`: `Service group '/IWFND/CONFIG' not published`). Zero services discovered. | **CONFIRMED (live SAP)** |
| **OData V2 Catalog Check** | `/sap/opu/odata/IWFND/CATALOGSERVICE;v=2/ServiceCollection` | **Zero services** matching `SM21`, `SM20`, `SYSLOG`, `SYSTEMLOG`, or `System Log`. Only unrelated Application Log (`ZAPL_LOG_MANAGEMENT_SRV` / SLG1) exists. | **CONFIRMED (live SAP)** |
| **Host RFC Runtime** | Node.js + `node-rfc` on macOS ARM64 | `libsapnwrfc.dylib` is loaded from `$HOME/nwrfcsdk/lib` using `DYLD_LIBRARY_PATH`. SDK version: `7500.0.20`. `tools/rfc-preflight.js` returned `PASS [ok]: Connected to client 220 (Pre-Test)`. | **CONFIRMED (live SAP)** |
| **SM21 Candidate FMs** | `RFC_FUNCTION_SEARCH` & `TFDIR` (`RSLG*`, `*SYSLOG*`, `*SYSTEM_LOG*`) | `RSLG_READ_SLG` (Group `RSLG`) is **remote-enabled** (`FMODE = 'R'`). `RSLG_READ_ENTRIES` **does not exist** in `TFDIR`. | **CONFIRMED (live SAP)** |
| **SM20 Candidate FMs** | `RFC_FUNCTION_SEARCH` & `TFDIR` (`RSAU*`, `*AUDIT_LOG*`) | `RSAU_API_GET_LOG_DATA` (Group `RSAU_LOG`) is **remote-enabled** (`FMODE = 'R'`). | **CONFIRMED (live SAP)** |
| **Technical User Authorizations** | Table queries on `USR02`, `UST04`, `AGR_USERS` | Technical User `[DEV_USER]`: Dialog user, active (`UFLAG = '0'`). Assigned profile **`SAP_ALL`** (in `UST04`) and role **`ZBASIS_ADMIN`** (in `AGR_USERS`). | **CONFIRMED (live SAP)** |
| **Scope Boundary (Path B)** | `ZAPL_LOG_MANAGEMENT_SRV` (SLG1) | Application Log management only (`BALHDR`/`BALM`). Does **not** contain system logs or logon audit events. | **CONFIRMED (live SAP)** |

---

## 2. OData V4 Service Catalog Results

* **Endpoint Queried:** `https://[s4-host]:44300/sap/opu/odata4/iwfnd/config/default/iwfnd/catalog/0002`
* **HTTP Status:** `404 Not Found` (initial URL returns `307 Temporary Redirect` to trailing slash, which returns `404`).
* **Exact Backend Error Payload:**
  ```json
  {
    "error": {
      "code": "/IWBEP/CM_V4_COS/014",
      "message": "Service group '/IWFND/CONFIG' not published",
      "@SAP__common.longtextUrl": "../../../../default/iwbep/common/0001/T100Longtexts(MessageClass='%2FIWBEP%2FCM_V4_COS',MessageNumber='014',Variable1='%2FIWFND%2FCONFIG',Variable2='',Variable3='',Variable4='')/Documentation",
      "@SAP__common.ExceptionCategory": "Configuration_Error",
      "innererror": {
        "ErrorDetails": {
          "@SAP__common.Application": {
            "ServiceRepository": "DEFAULT",
            "ServiceId": "/IWFND/CATALOG",
            "ServiceVersion": "0002"
          }
        }
      }
    }
  }
  ```
* **Conclusion:** The standard Gateway V4 catalog service group `/IWFND/CONFIG` is not published on this SAP system. In accordance with constraints, no alternate V4 catalog paths were guessed.

---

## 3. RFC Function Module Discovery & Interface Inspection

A search across `TFDIR`, `ENLFDIR`, and `TFTIT` was conducted for the requested patterns: `RSLG*`, `*SYSLOG*`, `*SYSTEM_LOG*`, `RSAU*`, and `*AUDIT_LOG*`. A total of 49 remote-enabled (`FMODE = 'R'`) modules were identified and inspected using `RFC_GET_FUNCTION_INTERFACE`.

### 3.1 Primary Candidates for SM21 (System Log)

#### A. Candidate 1: `RSLG_READ_SLG` (Recommended for SM21)
* **Function Group:** `RSLG`
* **Program Name:** `SAPLRSLG`
* **Remote-Enabled:** `YES` (`FMODE = 'R'`)
* **Short Description:** "Read raw syslog from any instance."
* **Parameters & Interface:**
  | Parameter | Class | Type / Structure | Optional | Description |
  | :--- | :--- | :--- | :--- | :--- |
  | `IM_INSTANCENAME` | `IMPORTING` | `MSNAME2` | No | Target Application Server instance name |
  | `IM_FILTER_DATETIME_FROM` | `IMPORTING` | `RSLGTIME` | No | System log start timestamp (`YYYYMMDDHHMMSS00`) |
  | `IM_FILTER_DATETIME_TO` | `IMPORTING` | `RSLGTIME` | No | System log end timestamp (`YYYYMMDDHHMMSS00`) |
  | `IM_POS` | `IMPORTING` | `I` | No | Cursor position (pagination offset) |
  | `IM_WRAPCOUNT` | `IMPORTING` | `I` | No | Buffer wrap count |
  | `EX_MAXSIZE` | `EXPORTING` | `I` | - | Maximum size |
  | `EX_POS` | `EXPORTING` | `I` | - | Result position |
  | `EX_WRAPCOUNT` | `EXPORTING` | `I` | - | Buffer wrap count |
  | `T_SYSLOG_ENTRIES` | `TABLES` | `RSLGENTR_NEW_TAB` | No | Internal table of system log entries |
  | `EXCEPTIONS` | None declared | - | - | Returns table / runtime exceptions |

#### B. Candidate 2: `SXMI_XMB_SYSLOG_READ` (Alternative for SM21)
* **Function Group:** `SXMB`
* **Program Name:** `SAPLSXMB`
* **Remote-Enabled:** `YES` (`FMODE = 'R'`)
* **Short Description:** "Reading a System Log Section"

#### C. Candidate 3: `RSLG_READ_FILE`
* **Function Group:** `SLO2`
* **Remote-Enabled:** `YES` (`FMODE = 'R'`)
* **Short Description:** "Import system log file into an internal table"

#### D. Non-Existent Function Modules:
* **`RSLG_READ_ENTRIES`:** Queried directly in `TFDIR` (`FUNCNAME = 'RSLG_READ_ENTRIES'`). **Result: 0 rows**. This module does **not** exist in S/4HANA release on Client 220 (**CONFIRMED live SAP**).

---

## 4. Primary Candidates for SM20 (Security Audit Log)

#### A. Candidate 1: `RSAU_API_GET_LOG_DATA` (Recommended for SM20)
* **Function Group:** `RSAU_LOG`
* **Program Name:** `SAPLRSAU_LOG`
* **Remote-Enabled:** `YES` (`FMODE = 'R'`)
* **Short Description:** "Get log data of security audit log"
* **Parameters & Interface:**
  | Parameter | Class | Type / Structure | Optional | Description |
  | :--- | :--- | :--- | :--- | :--- |
  | `IS_INTERVAL` | `IMPORTING` | `RSAU_SEL_INTV` | No | Selection time interval (`FROM_DATE`, `TO_DATE`, `FROM_TIME`, `TO_TIME`) |
  | `ID_FILE_SEL_SIMPLE` | `IMPORTING` | `BOOLE_D` | Yes | 'X' for simplified file selection |
  | `IT_R_USER` | `IMPORTING` | `SUSR_T_RANGE_4_XUBNAME` | Yes | Range table for Username selection |
  | `IT_R_MANDT` | `IMPORTING` | `AUT_T_MANDT_RANGE` | Yes | Range table for Client selection |
  | `IT_R_TCD` | `IMPORTING` | `AUT_T_TCODE_RANGE` | Yes | Range table for Transaction Code selection |
  | `IT_R_MSG` | `IMPORTING` | `RSAU_SEL_OPT_T_EVTS` | Yes | Range table for Audit Event/Message ID selection |
  | `IT_R_INSTANCE` | `IMPORTING` | `RSDSSELOPT_T` | Yes | Range table for Application Server Instance |
  | `IT_R_REPS` | `IMPORTING` | `AUT_T_PROGN_RANGE` | Yes | Range table for ABAP Program name |
  | `ET_LOG` | `EXPORTING` | `RSAU_T_RESULT` | No | Audit log records (System local timestamp) |
  | `ET_LOG_UTC` | `EXPORTING` | `RSAU_T_RESULT_UTC` | No | Audit log records (UTC timestamp) |
  | `ET_FSTAT` | `EXPORTING` | `RSAU_T_FILE_INFO` | No | Audit file statistical information |
  | `ET_RETURN` | `EXPORTING` | `BAPIRET2_T` | No | Return messages / BAPI return codes |

---

## 5. Technical User Authorization Status

Live inspection of tables `USR02`, `UST04`, and `AGR_USERS` was executed for user `[DEV_USER]` on Client 220:

1. **User Status:** `USTYP = 'A'` (Dialog User), `UFLAG = '0'` (Active / Not locked).
2. **Assigned Profiles (`UST04`):** Assigned profile **`SAP_ALL`** (**CONFIRMED live SAP**).
3. **Assigned Roles (`AGR_USERS`):** Assigned role **`ZBASIS_ADMIN`** (**CONFIRMED live SAP**).
4. **Authorization Assessment:**
   * `S_RFC` for function groups `RSLG`, `RSAU_LOG`, `THFB`, `RFC1`: **Granted** (covered by `SAP_ALL`).
   * `S_ADMI_FCD` with value `SYSL` (System Log reading): **Granted** (covered by `SAP_ALL`).
   * `S_ADMI_FCD` with values `AUDD`, `AUDA` (Security Audit Log display/config): **Granted** (covered by `SAP_ALL`).

---

## 6. Explicit Scope Clarification: Path B (SLG1) Out of Scope

In the earlier OData Gateway scan, service `ZAPL_LOG_MANAGEMENT_SRV` was identified:
* **Purpose:** SAP Application Log management (Transaction **SLG1**, tables `BALHDR`, `BALM`, `BALDAT`).
* **Scope Decision:** **OUT OF SCOPE.** Application logs record business application log entries created by application code via function module `APPL_LOG_WRITE_MESSAGES`. They do **not** contain SAP System Log events (kernel errors, work process crashes) or SAP Security Audit Log events (RFC logon failures, unauthorized transaction calls, user locks).

---

## 7. Blockers & Mitigation

| Layer | Item | Detail | Status |
| :--- | :--- | :--- | :--- |
| **OData V4 Catalog** | `/sap/opu/odata4/iwfnd/config/...` | `/IWBEP/CM_V4_COS/014`: Service group `/IWFND/CONFIG` not published. | Non-blocking for RFC; rules out standard V4 catalog discovery. |
| **Local RFC Dynamic Linker** | Host Node.js loader | Requires `DYLD_LIBRARY_PATH="$HOME/nwrfcsdk/lib"` (SDK 7.50 PL20). | Solved for runtime execution; supplied in command/environment. |

---

## 8. Phase 1 Smoke Test Results (Live SAP Executions)

**Execution Date:** 2026-11-17 | **Client:** 220 | **Target Host:** `[instance_00]`  
**Security & Redaction:** All usernames, IP addresses, terminals, and hostnames are redacted.

### 8.1 Target Application Server Instances
* **Discovery Method:** Executed live RFC call `TH_SERVER_LIST`.
* **Available Instances:**
  - `[instance_00]` (Host: `[s4-host]`, State: Active)
* **Status:** **CONFIRMED (live call)**

### 8.2 SM21 Live Smoke Test (`RSLG_READ_SLG`)
* **Execution Status:** **SUCCESS — Zero exceptions**.
* **Returned Row Count:** **30 entries** in `T_SYSLOG_ENTRIES` (15-min window).
* **Sample Entry (Redacted):**
  ```json
  {
    "SLGTYPE": "lA03",
    "SLGDATTIM": "2026111707494400",
    "SLGPROC": "2096600044B2",
    "SLGLTRM": "[REDACTED_TERM]",
    "SLGUSER": "[REDACTED_USER]",
    "SLGTC": "S000",
    "SLGREPNA": "ZFI_R_041",
    "SLGMAND": "220",
    "SLGMODE": "1",
    "SLGDATA": "                                                    abstop  0592",
    "SLGPASSPORT": "E6A502D9234E02C0E006AB3D44484032",
    "SLGROOTCONTEXT": "89E4C19EA7C11FE1B0F696BCCACEB88D",
    "SLGCONNECTION": "00000000000000000000000000000000",
    "SLGCONNECTIONCOUNTER": "0000000000",
    "SLGTERMIDNEW": "[REDACTED_TERM]",
    "SLGDUMMY2": "**********************"
  }
  ```
* **Status:** **CONFIRMED (live call)**

### 8.3 SM20 Live Smoke Test (`RSAU_API_GET_LOG_DATA`)
* **Execution Status:** **SUCCESS — Zero exceptions**.
* **Returned Row Count:**
  - `ET_LOG`: **477 records** (1-hour window)
  - `ET_LOG_UTC`: `0 records` (on this local file-based audit log configuration)
* **Status:** **CONFIRMED (live call)**

---

## 9. Phase 2 Design Decisions & Verification Evidence

### 9.1 Time Zone & Live Verification Evidence

**Result: CONFIRMED (live SAP verification, 2026-11-17 14:31 IST / 09:01 UTC)**

* **Evidence Comparison:**
  1. Current Machine UTC: `2026-11-17T09:01:29.105Z`
  2. Newest SM20 Entry (`ET_LOG`):
     - `SAL_DATE` = `20261117`
     - `SAL_TIME` = `143129` (14:31:29 server local time)
     - `LOG_TSTMP` = `20261117090129.1775720` (09:01:29 UTC decimal timestamp)
     - Offset Calculation: `14:31:29` (local) minus `09:01:29` (UTC) = **+05:30:00 (+330 minutes)**.
  3. Newest SM21 Entry (`T_SYSLOG_ENTRIES`):
     - `SLGDATTIM` = `2026111714304400` (14:30:44 server local time) vs UTC `09:00:44` = **+05:30:00 (+330 minutes)**.
* **Architecture Implementation:**
  - Config key: `SAPLOGS_SM21_TZ_OFFSET_MINUTES` (defaults to `330`).
  - Config key: `SAPLOGS_SM20_TZ_OFFSET_MINUTES` (defaults to `330`).
  - In `SystemLogAdapter`: caller inputs are UTC; adapter converts UTC → server-local `RSLGTIME` for queries, and converts returned `SLGDATTIM` strings back to ISO 8601 UTC strings (`timestamp`: `YYYY-MM-DDTHH:mm:ss.sssZ`). Raw server local timestamp is preserved in `serverTimestamp`.

### 9.2 SM20 Fallback Behavior (`ET_LOG_UTC` Empty)

In `S4HANA_DEV`, `ET_LOG_UTC` returns 0 rows because audit logs are written to local file segments without inline UTC index tables.

* **Two Supported Paths (Unit-tested):**
  1. **Fallback with Conversion (Default):** Converts server-local `SAL_DATE` and `SAL_TIME` to UTC using `SAPLOGS_SM20_TZ_OFFSET_MINUTES` (330 min), sets UTC `date` and `time` in output, retains UTC `LOG_TSTMP` from SAP, and appends a notice to the `warnings` array:
     `"ET_LOG_UTC was empty; converted server-local timestamps in ET_LOG to UTC using offset 330 minutes."`
  2. **Strict Rejection:** If `SAPLOGS_SM20_REJECT_ON_FALLBACK=true` (or adapter option `rejectOnFallback: true`), the adapter throws HTTP 502:
     `"Security audit log returned local timestamps only (ET_LOG_UTC is empty) and fallback is rejected"`.

### 9.3 Authorization & Role Gating

* **Service Gating:** `@(requires: 'SapLogsReader')` is declared at the service level on `SapLogsService` in `srv/admin/sap-logs-service.cds`.
* **Where the Roles are Defined:**
  - CDS: `srv/admin/sap-logs-service.cds:29`: `@(requires: 'SapLogsReader')`
  - BTP XSUAA: `xs-security.json:35`: Scope `$XSAPPNAME.SapLogsReader`, dedicated Role Template `SapLogsReader` (line 120), Role Collection `SAPS4HANA_LogAuditor` (line 179). In addition, role template `Admin` (line 69) includes `$XSAPPNAME.SapLogsReader`.
  - Test Mock Users: Defined in `test/testUsers.js` (`CDS_CONFIG` in test runs) — `test-logs-reader` (`roles: ['SapLogsReader']`), `test-admin` (`roles: ['Admin', 'SapLogsReader']`), and `test-logs-viewer` (`roles: ['Viewer']`). In `package.json`, only `khushal` is defined under `[development]` and `[test]` (with `SapLogsReader` and `Admin`). In `[production]`, auth kind is `jwt` (XSUAA); no mock users exist in production.
* **Handler-level Verification:** Service handler enforces role check (`checkLogsReaderRole`), rejecting unauthenticated callers with 401 and non-SapLogsReader callers with 403. Real HTTP-level authorization pipeline tests via `cds.test` verify 401 for anonymous, 403 for `test-logs-viewer`, 200 for `test-logs-reader`, and 200 for `test-admin`.

### 9.4 SM21 Message Text & 3 Live Sample Rows

In SAP system log table `T_SYSLOG_ENTRIES`, `SLGDATA` does **not** contain full sentences. It stores the parameter variables (up to 64 chars) that the kernel substitutes into the message template defined for `SLGTYPE`.

#### 3 Redacted Sample Rows from Live Call (`RSLG_READ_SLG`, 2026-11-17):

1. **Row 1:**
   - `SLGTYPE`: `"lA03"` (Message template: "Transaction &1 finished" / "Report &1 ended")
   - `SLGREPNA`: `"ZFI_R_041"`
   - `SLGDATA`: `"                                                    abstop  0592"`
   - Output `message`: `"abstop  0592"`
2. **Row 2:**
   - `SLGTYPE`: `"xA14"` (Message template: "Report &1 started: &2 &3 &4")
   - `SLGREPNA`: `"ZFI_R_041"`
   - `SLGDATA`: `"ZFI_R_041_F01                           0006START-OF-SELECTION"`
   - Output `message`: `"ZFI_R_041_F01                           0006START-OF-SELECTION"`
3. **Row 3:**
   - `SLGTYPE`: `"lA03"`
   - `SLGREPNA`: `"ZFI_R_041"`
   - `SLGDATA`: `"                                                    abstop  0592"`
   - Output `message`: `"abstop  0592"`

#### Proposed Paths to Resolve Full Message Text (Awaiting User Decision):

- **Proposal A (Current baseline):** Return `entryType` (`SLGTYPE`), ABAP program `program` (`SLGREPNA`), and the sanitized parameters in `message`. This gives operators the structured raw parameters without unproven text lookups.
- **Proposal B (Basis catalog lookup):** Request the Basis team to provide a standard table or custom RFC function module that resolves `SLGTYPE` + language + `SLGDATA` into the full descriptive text.
- **Proposal C (Kernel text catalog table):** Investigate whether a system log message table (e.g. `TSL01T` or kernel message file) can be safely read read-only via `RFC_READ_TABLE` once identified by Basis.

*Action:* Awaiting user direction before implementing any additional text resolution mechanism.

### 9.5 User Field & Privacy Toggle

- **Config Key:** `SAPLOGS_INCLUDE_USER` (default: `false`).
- **Privacy Tradeoff:**
  - *Default (`false`):* Adheres to data minimization principles (GDPR / employee privacy). User IDs (`SLGUSER`) are omitted from output, and user tokens inside message text are redacted (`user=[user]`).
  - *Enabled (`true`):* Populates the `user` property for both SM21 and SM20 entries. Essential for security incident response and attribution, but requires strict administrative role restriction.
- **SM20 User Filtering:** `getSecurityAuditLog` accepts an optional `user` parameter mapped to RFC range `IT_USER` for targeted forensic queries.

### 9.6 Message Sanitization (`sanitizeMessage`)

Rules executed in sequence:
1. Treat null / undefined as empty string.
2. Strip null bytes (`\x00`).
3. Trim whitespace.
4. Replace runs of 4 or more `*` with `[redacted]` (star-masked credentials).
5. Replace IPv4 addresses with `[ip]`.
6. Replace IPv6 addresses (full, compressed `fe80::...`, bracketed `[...]`, and loopback `::1`) with `[ip]`.
7. When `redactUserTokens=true` (default when `includeUser=false`): replace `user=...` and `bname:...` patterns with `[user]`.
8. Truncate to 200 characters.

**What the Sanitizer Does NOT Catch (Explicit Limitations):**
- Arbitrary personal names in unstructured English/German text (e.g. "Sent to John Smith").
- Program names or transaction codes that match username patterns (e.g. `ZFI_R_041`, `RSUSR300`).
- Hexadecimal hashes, internal GUIDs, or UUIDs.
- Obfuscated IP addresses (hex-encoded, decimal integer, or URL-encoded).
- Non-standard terminals or hostnames not formatted as IP addresses (e.g. `pts/1`, `client01`).
- Passwords or tokens written in clear text that lack star masking.

### 9.7 Pagination Behavior & Window Guard

- **Re-fetch Behavior:** Each pagination request (`top`/`skip`) re-fetches the time window from SAP; there is no stateful cursor on the backend.
- **Fixed Snapshot Requirement:** Callers MUST supply a fixed `toUtc` timestamp that is not in the future across consecutive paging calls.
- **Future Window Guard:** The service strictly rejects `toUtc` timestamps in the future with HTTP 400 (`"toUtc cannot be in the future"`), preventing window drift during paging.

### 9.8 Configuration Keys Summary

| Key | Default | Description |
| :--- | :--- | :--- |
| `SAPLOGS_SM21_TZ_OFFSET_MINUTES` | `330` | Server-local timezone offset in minutes (330 = IST = UTC+05:30). |
| `SAPLOGS_SM20_TZ_OFFSET_MINUTES` | `330` | Fallback timezone offset for SM20 local-time timestamps. |
| `SAPLOGS_SM20_REJECT_ON_FALLBACK` | `false` | When true, rejects SM20 requests if `ET_LOG_UTC` is empty (HTTP 502). |
| `SAPLOGS_INCLUDE_USER` | `false` | When true, returns the SAP user ID in log entries (privacy toggle). |
| `SAPLOGS_MAX_SPAN_SM21_HOURS` | `24` | Maximum query span for SM21 (hours). |
| `SAPLOGS_MAX_SPAN_SM20_HOURS` | `6` | Maximum query span for SM20 (hours). |
| `SAPLOGS_DEFAULT_ROW_CAP` | `500` | Default and maximum row limit per request (`top`). |

---

## 10. Minimum Authorization Requirements (UNVERIFIED)

> [!CAUTION]
> **UNVERIFIED** — Phase 1 and Phase 2 discovery and testing ran with user `[DEV_USER]`, which holds `SAP_ALL` and `ZBASIS_ADMIN`. The authorization list below is derived from RFC interface analysis. It **must be verified** by running live smoke tests with the dedicated technical user `S4LOGS_SRV` once provisioned by Basis.

### 10.1 Required Authorization Objects

| Object | Field | Values | Purpose |
|--------|-------|--------|---------|
| `S_RFC` | `ACTVT` | `16` (Execute) | RFC function execution |
| `S_RFC` | `RFC_TYPE` | `FUGR` | Restricts to function groups |
| `S_RFC` | `RFC_NAME` | `RSLG` | `RSLG_READ_SLG` (SM21 read) |
| `S_RFC` | `RFC_NAME` | `THFB` | `TH_SERVER_LIST` (instance discovery) |
| `S_RFC` | `RFC_NAME` | `RSAU_LOG` | `RSAU_API_GET_LOG_DATA`, `RSAU_API_GET_AUDIT_CONFIG` (SM20) |
| `S_RFC` | `RFC_NAME` | `RFC1` or `SRFC` | RFC ping / connection setup |
| `S_ADMI_FCD` | `S_ADMI_FCD` | `SYSL` | Read SAP System Log (SM21) |
| `S_ADMI_FCD` | `S_ADMI_FCD` | `AUDD` | Display Security Audit Log (SM20) |

### 10.2 Basis Handoff Note — Dedicated Technical User Request

**To:** SAP Basis Team  
**Re:** New read-only technical RFC user for SAP Log Monitoring service

Please create a dedicated technical user for the CAP Log Monitoring service with the following properties:

- **User type:** System (`B`)
- **Suggested username:** `S4LOGS_SRV`
- **Client:** 220 (DS4)
- **Purpose:** Read-only RFC access to SM21 System Log and SM20 Security Audit Log for the CAP admin service. No dialog logon, no write access.

**Assign the following authorization objects** (least-privilege, UNVERIFIED):

```text
S_RFC      ACTVT=16, RFC_TYPE=FUGR, RFC_NAME IN (RSLG, THFB, RSAU_LOG, RFC1)
S_ADMI_FCD S_ADMI_FCD IN (SYSL, AUDD)
```

After creating the user, update RFC connection credentials in `.env.local` / BTP destination and run:

```bash
ALLOW_LIVE_SAP_TOOLS=1 DYLD_LIBRARY_PATH="$HOME/nwrfcsdk/lib" \
  npx jest test/unit/admin/sapLogsLive.test.js --runInBand
```

**Do not grant `SAP_ALL` or `ZBASIS_ADMIN` to this user.**

---

## 11. Leak Scan & Redaction Record

*Scan completed 2026-11-17 across `SAP_SYSLOG_DISCOVERY.md`, `WORKSTATUS.md`, and test suites:*

- **Hostnames:** S/4HANA application server hostnames and instance labels were scanned and replaced with `[s4-host]` and `[instance_00]`.
- **Usernames:** Personal development usernames were scanned and replaced with `[DEV_USER]` or `[SAMPLE_USER]`.
- **IP addresses & Terminals:** All live terminal names and IP addresses were confirmed redacted in logs, reports, and tests.
- **Exceptions Approved by Protocol:** Dedicated technical service account name `S4LOGS_SRV` and logical SAP system identifier `S4HANA_DEV` / `DS4` client 220 are retained for operational clarity.

---

## 12. SM21 Message Template Discovery & Static Lookup (Phase 2 Review)

### 12.1 Live Discovery of SM21 Template Table: `TSL1T`
- **Table Name:** `TSL1T` (**CONFIRMED live SAP**, queried via `DDIF_FIELDINFO_GET` and `RFC_READ_TABLE`).
- **Key Fields:**
  - `SPRAS`: LANG (1, Key `X`) — Language ID within the system log (e.g. `'E'`).
  - `AREA`: CHAR (2, Key `X`) — System Log: Group of 36 System Log Messages (e.g. `'A0'`, `'A1'`, `'PM'`, `'AB'`, `'D0'`, `'Q0'`).
  - `SUBID`: CHAR (1, Key `X`) — System Log: Third character of message name (e.g. `'0'`..`'9'`, `'A'`..`'Z'`).
- **Text Field:**
  - `TXT`: CHAR (78) — Text part of system log message with placeholders (`&` or `$`).
- **Live Redacted Samples:**
  - `E|A0|3` -> `Breakpoint &9&9&9&9&4 reached`
  - `E|A1|4` -> `> in program &4&9&9&9&9, line &4, event &2&9&9`
  - `E|PM|2` -> `Certificate with PSE type >&A< has been invalid for &B days`
  - `E|AB|0` -> `Runtime error "&a&b&c" occurred.`
  - `E|D0|1` -> `Transaction canceled &9&9&5 ( &a &b &c &d &e &f &g &h &i )`
  - `E|Q0|I` -> `Operating system call &5&5&4 failed (error no. &>E5)`

### 12.2 Static Template Map Generation
- In accordance with the user decision (static lookup, zero runtime RFC table queries or table authorizations), 2,166 English templates were extracted one-off using the dev-time SAP connection and stored at `srv/integration/s4hana/admin/sm21-templates.json`.
- Key mapping: `SLGTYPE` (e.g. `'lA03'`, `'xA14'`) -> strips the leading severity character to obtain the 3-character table key (e.g. `'A03'`, `'A14'`).

### 12.3 Message Text Substitution (EXPERIMENTAL / UNVERIFIED)

> [!WARNING]
> `messageText` resolution is **EXPERIMENTAL / UNVERIFIED**. The placeholder grammar (`&n`, `&a`, `&A`, `&>E5`, `$`) is INFERRED from SAP `TSL1T` records and ABAP kernel conventions; it is unverified against SAP kernel C/ABAP source or SM21 GUI display routines.
> **Severity labels** ('Warning', 'Info', 'Error', 'Cancel') in the sample table below were INFERRED from the first character of `SLGTYPE` (`m` / `' '` -> Warning, `s` / `p` / `x` -> Info, `l` -> Error, `n` -> Cancel) and are tagged **UNVERIFIED**.
> When `SAPLOGS_ENABLE_MESSAGE_TEXT` is `false` (default), `messageText` is always `null`.
>
> **Strict mode rule:**
> `messageText` is returned ONLY when:
> 1. Every placeholder in the template resolves cleanly under documented grammar.
> 2. Every non-empty `SLGDATA` parameter is consumed (no dropped data).
> 3. The SAP template is well-formed (no unclosed parenthesis or malformed syntax).
> If any data is dropped, any placeholder remains unresolved, or the template is malformed, `messageText` returns `null`. SAP templates are never edited.

| # | Type | Key | Severity (Inferred, UNVERIFIED) | Template (`TSL1T.TXT`) | Sample Raw `SLGDATA` (Redacted) | Formatted `messageText` (Strict Mode) | Strict Mode Resolution Status |
|---|---|---|---|---|---|---|---|
| 1 | ` PM2` | `PM2` | Warning | `Certificate with PSE type >&A< has been invalid for &B days` | `SSL Server Standard & 12 & & & &` | `Certificate with PSE type >SSL Server Standard< has been invalid for 12 days` | Resolved (all placeholders resolved; no dropped data) |
| 2 | `xA14` | `A14` | Info | `> in program &4&9&9&9&9, line &4, event &2&9&9` | `ZFI_R_041_F01                           0006START-OF-SELECTION` | `> in program ZFI_R_041_F01, line 0006, event START-OF-SELECTION` | Resolved (positional fields fully consumed) |
| 3 | `lAB0` | `AB0` | Error | `Runtime error "&a&b&c" occurred.` | `jfunc_back                                          abfunc  9116` | `null` | Returns `null` (trailing data `abfunc 9116` unconsumed; `&b`, `&c` unresolved) |
| 4 | `nD01` | `D01` | Cancel | `Transaction canceled &9&9&5 ( &a &b &c &d &e &f &g &h &i )` | `IP                  710` | `null` | Returns `null` (parameter list `&a`..`&i` unresolved; partial match disallowed) |
| 5 | `mQ0I` | `Q0I` | Warning | `Operating system call &5&5&4 failed (error no. &>E5)` | `          recv104                     NiIReadrecv   nixxi.cp5628` | `null` | Returns `null` (trailing data unconsumed) |
| 6 | `mS23` | `S23` | Warning | `Connection to CPI-C client $$$ was closed` | `601                                   GwDiscoclient gwxxrd.c1225` | `null` | Returns `null` (trailing data `GwDiscoclient...` unconsumed) |
| 7 | `mQ04` | `Q04` | Info | `Connection to terminal &a closed (user = &b, logon ID = &c)` | `Terminal_01 800` | `null` | Returns `null` (incomplete: 2 values for 3 placeholders `&a`, `&b`, `&c`) |
| 8 | `mR47` | `R47` | Warning | `Delete ABAP session &a (Info = &b` | `WARNING-SESSION-SOFT_CANCEL           ThResFrdelete thxxmode1168` | `null` | Returns `null` (SAP template is malformed with unclosed parenthesis; not edited) |
| 9 | `mR48` | `R48` | Warning | `> Reason for Soft Cancel: &a` | `SAP_GUI_DISCONNECT                    ThResFrdelete thxxmode1224` | `null` | Returns `null` (trailing data unconsumed) |
| 10 | `sAB1` | `AB1` | Error | `> Short dump "&6 &6 &8&8&8&8 &6&6" created.` | `261117115840app-server-01_DS4_00          TEST_USER_A` | `> Short dump "261117 115840 [instance] [user]" created.` | Resolved (all 4 slots consumed; host and user redacted when `includeUser=false`) |

Sanitization is executed **AFTER** parameter substitution. When `messageText` is `null` (by default, or when strict mode rejects partial/dropped resolution), the caller relies on the `message` field, which contains the allow-listed, sanitized parameter values with slot-mapped user and instance redaction.

---

## 13. Scope Implementation (`SapLogsReader`)

To enforce least-privilege access in production without overloading the generic `Admin` role, the scope is configured as follows:

### 13.1 `xs-security.json` Configuration
- Scope: `$XSAPPNAME.SapLogsReader` (Read access to SAP SM21 system logs and SM20 security audit logs).
- Role template: `SapLogsReader` referencing `$XSAPPNAME.SapLogsReader`.
- Included in role template: `Admin` (references `$XSAPPNAME.SapLogsReader`).
- Role collection: `SAPS4HANA_LogAuditor` (references `$XSAPPNAME.SapLogsReader`).

### 13.2 CDS Model Configuration
Annotated in [srv/admin/sap-logs-service.cds](srv/admin/sap-logs-service.cds):
```cds
@(requires: 'SapLogsReader')
service SapLogsService @(path: '/odata/v4/sap-logs', impl: './sapLogsService.js') { ... }
```

### 13.3 BTP Administrator Assignment
In SAP BTP Cockpit (Subaccount -> Security -> Users / Role Collections):
- Assign role collection **`SAPS4HANA_LogAuditor`** to security/audit operators requiring log read access.
- Existing administrators assigned **`Admin`** role collection automatically inherit the `SapLogsReader` role-template.

---

## 14. Timezone & Non-Circular Freshness Verification

### 14.1 Proof of Non-Circularity
1. **Freshness:** Asserts that the newest returned record's UTC timestamp is within 30 minutes of current physical wall-clock UTC (`Date.now()`).
2. **Cross-Check:** Asserts that SM21 newest UTC timestamp and SM20 newest UTC timestamp (derived from SAP kernel's independent `LOG_TSTMP`) differ by no more than 5 minutes.
3. **Proof of Failure (Executed Live):**
   - When executed with `SAPLOGS_SM21_TZ_OFFSET_MINUTES=0`:
     - SM20 Freshness failed: `Expected <= 1800000 ms, Received: 20131487 ms` (~5.59 hours old).
     - Cross-check failed: `Expected <= 5 min, Received: 329.76 min` (~5.5 hours discrepancy).
   - When executed with verified offset `330` (IST):
     - Both SM21 and SM20 freshness passed (within 30m of current UTC).
     - Cross-check passed: delta was `0.49 minutes` (~29 seconds).

### 14.2 `LOG_TSTMP` vs Local Time Verification
Verified against 5 live entries from `RSAU_API_GET_LOG_DATA` on `S4HANA_DEV`:
- `SAL_DATE/TIME` (local IST) minus 330 minutes equals `LOG_TSTMP` (UTC) with **0s difference** across all 5 rows.

### 14.3 `RSAU_API_GET_LOG_DATA` Interface Inspection
Inspected live via `RFC_GET_FUNCTION_INTERFACE`:
- Exporting: `ET_FSTAT`, `ET_LOG`, `ET_LOG_UTC`, `ET_RETURN`.
- Importing: `ID_FILE_SEL_SIMPLE`, `IS_INTERVAL`, `IT_R_INSTANCE`, `IT_R_MANDT`, `IT_R_MSG`, `IT_R_REPS`, `IT_R_TCD`, `IT_R_USER`.
- Finding: **CONFIRMED (Live SAP)** that no importing flag or parameter exists on `RSAU_API_GET_LOG_DATA` to request `ET_LOG_UTC` vs `ET_LOG`.
- Storage Format Claim: **UNVERIFIED**. The assertion that `ET_LOG_UTC` is populated only when audit logging is configured in database format is unverified against SAP kernel source. Live inspection of `RSAU_API_GET_AUDIT_CONFIG` on `S4HANA_DEV` returned fields: `ED_ENABLE` ('X'), `ED_FILESTATUS` (1), `ED_CURFILENUM` (1), `ED_SIZEOFFILE` (395264), `ED_MAXFILESIZE` (2146304), `ED_POSITION` (2446), `ED_SLOTCNT` (3), `ED_USER_SELECTION` (1), `ED_VERSION` (16), and `ET_SLOT_INFO` (3 slots). None of the returned fields explicitly specify a storage format enum ("FILE" vs "DB"). While file-related properties (`ED_CURFILENUM`, `ED_SIZEOFFILE`, `ED_MAXFILESIZE`) are populated, whether `ET_LOG_UTC` is populated exclusively for DB storage remains **UNVERIFIED**. On this system, `ET_LOG` is returned with kernel-written `LOG_TSTMP` providing native UTC.
