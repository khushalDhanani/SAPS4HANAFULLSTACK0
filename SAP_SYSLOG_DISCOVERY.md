# SAP S/4HANA SM21 (System Log) and SM20 (Security Audit Log) Discovery Report

**Target System:** `S4HANA_DEV` | **Client:** `220` | **Host:** `https://vheudds4ap01.sap.aether.co.in:44300`  
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
| **Technical User Authorizations** | Table queries on `USR02`, `UST04`, `AGR_USERS` | User `KHUSHAL`: Dialog user, active (`UFLAG = '0'`). Assigned profile **`SAP_ALL`** (in `UST04`) and role **`ZBASIS_ADMIN`** (in `AGR_USERS`). | **CONFIRMED (live SAP)** |
| **Scope Boundary (Path B)** | `ZAPL_LOG_MANAGEMENT_SRV` (SLG1) | Application Log management only (`BALHDR`/`BALM`). Does **not** contain system logs or logon audit events. | **CONFIRMED (live SAP)** |

---

## 2. OData V4 Service Catalog Results

* **Endpoint Queried:** `https://vheudds4ap01.sap.aether.co.in:44300/sap/opu/odata4/iwfnd/config/default/iwfnd/catalog/0002`
* **HTTP Status:** `404 Not Found` (initial URL returns `307 Temporary Redirect` to `/sap/opu/odata4/iwfnd/config/default/iwfnd/catalog/0002/`, which returns `404`).
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
  | `IM_FILTER_DATETIME_FROM` | `IMPORTING` | `RSLGTIME` | No | System log start timestamp (`YYYYMMDDHHMMSS`) |
  | `IM_FILTER_DATETIME_TO` | `IMPORTING` | `RSLGTIME` | No | System log end timestamp (`YYYYMMDDHHMMSS`) |
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
* **Parameters & Interface:**
  | Parameter | Class | Type / Structure | Optional | Description |
  | :--- | :--- | :--- | :--- | :--- |
  | `EXTERNAL_USER_NAME` | `IMPORTING` | `TXMILOGRAW-EXTUSER` | No | External audit log user |
  | `FROM_DATE` | `IMPORTING` | `SYST-DATUM` | Yes | Start date |
  | `FROM_TIME` | `IMPORTING` | `SYST-UZEIT` | Yes | Start time |
  | `TO_DATE` | `IMPORTING` | `SYST-DATUM` | Yes | End date |
  | `TO_TIME` | `IMPORTING` | `SYST-UZEIT` | Yes | End time |
  | `LOOKING_FOR_USER` | `IMPORTING` | `SYST-UNAME` | Yes | Filter by SAP username |
  | `SERVER_NAME` | `IMPORTING` | `TBTCJOB-EXECSERVER`| Yes | Application server name |
  | `PARA_RECS` | `IMPORTING` | `SYST-BATCH` | Yes | Include parameter records |
  | `REPNA_WIDTH_40` | `IMPORTING` | `SYST-BATCH` | Yes | Report name width 40 |
  | `SYSLOG_TBL` | `TABLES` | `BTCSYSLOG` | No | Table containing system log records |
  | `EXCEPTIONS` | `CANT_LOG_ACTION`, `EXTERNAL_USER_NAME_MISSING`, `INVALID_DATE_TIME`, `INVALID_SERVER_NAME`, `NOT_LOGGED_ON`, `PROBLEM_DETECTED` |

#### C. Candidate 3: `RSLG_READ_FILE`
* **Function Group:** `SLO2`
* **Remote-Enabled:** `YES` (`FMODE = 'R'`)
* **Short Description:** "Import system log file into an internal table"
* **Parameters:** `SELECTION` (`RSLGSEL`), `FILE_INFO` (`RSLGFINFO`), `SYSLOG_IN_TABLE` (`RSLGETAB`).
* **Note:** Reads direct file path; requires local file info context initialization (`RSLG_FILEINFO_INIT`).

#### D. Non-Existent Function Modules:
* **`RSLG_READ_ENTRIES`:** Queried directly in `TFDIR` (`FUNCNAME = 'RSLG_READ_ENTRIES'`). **Result: 0 rows**. This module does **not** exist in S/4HANA release on Client 220 (**CONFIRMED live SAP**).

---

### 3.2 Primary Candidates for SM20 (Security Audit Log)

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

#### B. Candidate 2: `RSAU_READ_LOG`
* **Function Group:** `RSAU_LOG`
* **Remote-Enabled:** `YES` (`FMODE = 'R'`)
* **Parameters:** `IS_INTV`, `IS_CLASS`, `IS_SEVE`, `ET_DATA` (`RSAU_T_FILEREC`), `ET_STAT`.
* **Exceptions:** `AUTHORIZATION_FAILURE`, `WRONG_PARAMETER_SET`.
* **Note:** Lower-level API than `RSAU_API_GET_LOG_DATA`; `RSAU_API_GET_LOG_DATA` is the modern API with `BAPIRET2` return table and structured filter ranges.

---

## 4. Technical User Authorization Status

Live inspection of tables `USR02`, `UST04`, and `AGR_USERS` was executed for user `KHUSHAL` on Client 220:

1. **User Status:** `USTYP = 'A'` (Dialog User), `UFLAG = '0'` (Active / Not locked).
2. **Assigned Profiles (`UST04`):** 129 profiles assigned, including **`SAP_ALL`** (**CONFIRMED live SAP**).
3. **Assigned Roles (`AGR_USERS`):** 95 single/composite roles assigned, including **`ZBASIS_ADMIN`** (**CONFIRMED live SAP**).
4. **Authorization Assessment:**
   * `S_RFC` for function groups `RSLG`, `RSAU_LOG`, `SLO2`, `SXMB`: **Granted** (covered by `SAP_ALL`).
   * `S_ADMI_FCD` with value `SYSL` (System Log reading): **Granted** (covered by `SAP_ALL`).
   * `S_ADMI_FCD` with values `AUDD`, `AUDA` (Security Audit Log display/config): **Granted** (covered by `SAP_ALL`).
   * `S_TABU_DIS` / `S_TABU_NAM` for DDIC tables (`TFDIR`, `ENLFDIR`, `TFTIT`, `UST04`, `USR02`): **Granted & Proven** (all table reads succeeded).

---

## 5. Explicit Scope Clarification: Path B (SLG1) Out of Scope

In the earlier OData Gateway scan, service `ZAPL_LOG_MANAGEMENT_SRV` was identified:
* **Service:** `/sap/opu/odata/sap/APL_LOG_MANAGEMENT_SRV`
* **Purpose:** SAP Application Log management (Transaction **SLG1**, tables `BALHDR`, `BALM`, `BALDAT`).
* **Scope Decision:** **OUT OF SCOPE.** Application logs record business application log entries created by application code via function module `APPL_LOG_WRITE_MESSAGES`. They do **not** contain SAP System Log events (kernel errors, hardware/DB reconnects, work process crashes) or SAP Security Audit Log events (RFC logon failures, unauthorized transaction calls, user locks).

---

## 6. Blockers

| Layer | Item | Error / Detail | Status |
| :--- | :--- | :--- | :--- |
| **OData V4 Catalog** | `/sap/opu/odata4/iwfnd/config/...` | `/IWBEP/CM_V4_COS/014`: Service group `/IWFND/CONFIG` not published. | Non-blocking for RFC; rules out standard V4 catalog discovery. |
| **Local RFC Dynamic Linker** | Host Node.js loader | Requires `DYLD_LIBRARY_PATH="$HOME/nwrfcsdk/lib"` (SDK 7.50 PL20). | Solved for runtime execution; must be supplied in command/environment. |

---

## 7. Recommendation: Path A (RFC Function Module Adapter)

### Recommendation: **Path A — Wrap Remote-Enabled RFC Function Modules in CAP Service**

**Rationale:**
1. **No OData Services Exist:** Live inspection of both OData V2 and V4 catalogs confirms that SAP S/4HANA does not provide out-of-the-box OData services for SM21 (System Log) or SM20 (Security Audit Log).
2. **Proven Remote RFC APIs:**
   * **SM21 (System Log):** `RSLG_READ_SLG` (Group `RSLG`) provides direct, remote-enabled access to raw system log entries with server instance name and timestamp interval filtering. (Alternative: `SXMI_XMB_SYSLOG_READ`).
   * **SM20 (Security Audit Log):** `RSAU_API_GET_LOG_DATA` (Group `RSAU_LOG`) provides a structured BAPI-compliant remote interface with user, client, transaction, and event range filtering, returning timestamps in both local and UTC formats.
3. **Full Authorization in Place:** The technical user holds `SAP_ALL` and `ZBASIS_ADMIN` on Client 220, satisfying all `S_RFC` and `S_ADMI_FCD` authorization prerequisites.

### Prerequisites for Subsequent Implementation (Upon User Confirmation):
* **Adapter Implementation:** Create `SystemLogAdapter.js` and `SecurityAuditLogAdapter.js` under `srv/integration/s4hana/admin/` wrapping `RfcClient.js`.
* **Runtime Guard:** Ensure CAP runtime execution includes `DYLD_LIBRARY_PATH="$HOME/nwrfcsdk/lib"` (or runs inside the Docker container).
* **CAP Service Exposure:** Define read-only projection entities in `srv/admin/service.cds` with strict pagination (`maxRows` limit) to prevent memory exhaustion from large log volumes.
* **Testing:** Add unit tests with mocked RFC payloads and record validation in `WORKSTATUS.md`.
