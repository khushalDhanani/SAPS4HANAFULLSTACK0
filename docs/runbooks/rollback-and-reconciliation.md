# Production Runbook: Application Rollback & SAP Transaction Reconciliation Procedures

**Document ID:** RUNBOOK-PROD-004  
**Classification:** Enterprise Production Assurance  
**Target Architecture:** SAP BTP Cloud Foundry + SAP HANA Cloud + SAP S/4HANA (AnyPremise / Cloud)  
**Applicable Movement Types:** 201 (Cost Center), 241 (Asset), 311 (SLoc Transfer), 301 (Plant Transfer), 261 (Process Order)  

---

## 1. Executive Summary & Architecture Context

Per [ADR-0001: S/4HANA-Centric Integration Façade](../decisions/ADR-0001-s4-centric-integration-facade.md), this application operates as a **pure integration façade**:
1. **SAP S/4HANA is the Single System of Record (SoR)** for all business transactions, document numbering, inventory valuation, and warehouse bin quant balances across DDIC transparent tables (`RKPF`, `RESB`, `LTBK`, `LTBP`, `LTAK`, `LTAP`, `MATDOC`, `MARD`, `LQUA`, `AFKO`).
2. **CAP Persistence (HDI Container)** owns only application-level logs: the in-flight Goods Issue posting attempts (`saps4hana.wm.GoodsIssuePostingAttempt`).
3. **Zero Synthetic State**: The application never generates synthetic document numbers, never fakes transaction success, and never stores business documents in local tables as substitutes for SAP persistence.

When production incidents occur (such as network partitioning, SAP Gateway work process exhaustion, incomplete multi-step WM staging, or failed MTA deployments), operators must execute the standardized rollback and reconciliation procedures defined in this runbook.

---

## 2. Post-Deployment Smoke Testing & Readiness Criteria

Following any Cloud Foundry deployment, MTA upgrade, or maintenance window, execute the automated verification test suites before opening traffic to end users.

### 2.1 Automated Smoke Test Runner (`tools/smoke-test-deployment.js`)

Run the smoke test runner against the target deployment URL:

```bash
# Local development or port-forwarded deployment:
npm run test:smoke

# Remote Cloud Foundry staging or production approuter:
node tools/smoke-test-deployment.js --url=https://saps4hana-approuter-<space>.cfapps.<region>.hana.ondemand.com
```

#### Readiness Assertions:
1. **Readiness Probe (`GET /health`)**: Returns `HTTP 200 OK`, JSON payload `{"status":"UP"}`, and header `Cache-Control: no-store`.
2. **Unauthenticated Security Gating**: Accessing `/odata/v4/purchase-order/$metadata` without credentials returns `HTTP 401 Unauthorized`.
3. **Core OData Metadata Availability**: Authenticated reads of `$metadata` for `purchase-order`, `reservation-entry`, `tr-to`, and `auth` return valid EDMX XML schemas.
4. **Session & Scope Resolution (`GET /odata/v4/auth/getUserInfo()`)**: Resolves caller principal, role collections, and system identifier without errors.
5. **UI5 Flexibility & Preload Assets**: Confirms `/sap/bc/lrep/flex/settings` and `/Component-preload.js` respond with `HTTP 200`.
6. **AI Assistant Streaming Route**: Validates `/ai/chat/stream` is mounted and responsive.

### 2.2 Service Connectivity & Security Guard Verification (`tools/check-service-connectivity.js`)

Validate backend S/4HANA connectivity, destination bindings, and runtime security:

```bash
# Configuration and security guard check:
npm run check:connectivity

# With live safe read-only S/4HANA RFC probe (sandbox/dev environments only):
node tools/check-service-connectivity.js --allow-live-sap
```

#### Verification Criteria:
- **Zero Illegal Dev Flags**: `productionGuard.assertDevFlagsOff` confirms mock authentication and development token issuers are disabled.
- **Zero Raw Credentials**: `productionGuard.assertS4ConnectionConfig` confirms credentials come exclusively from BTP service bindings (`destination`, `connectivity`, `xsuaa`), with zero plain-text passwords in environment variables.
- **S/4HANA RFC Connectivity**: Validates RFC ping and confirms client identity against DDIC table `T000` (e.g. Client 220) and plant master table `T001W` (Plant 1120).

---

## 3. Production Monitoring & Alerting Architecture

### 3.1 Distributed Tracing & Correlation IDs

Every inbound HTTP request to the CAP service receives or generates a unique correlation ID (`cds.context.id` or header `x-correlation-id`). 

- **Logger Format**:
  - Development / Text Mode: `[module] [correlation-id] - message`
  - Production JSON Mode (`cds.env.log.format = 'json'`): Emits structured JSON events containing `correlation_id`, `timestamp`, `level`, `logger`, and `msg`.
- **Log Ingestion**: Structured JSON logs are streamed automatically to **SAP Cloud ALM**, **Dynatrace**, or **SAP BTP Application Logging Service** for anomaly detection.

### 3.2 Failure Taxonomy & Alert Triggers

The system categorizes all transactional errors into four operational categories via `classifyPostingError`:

| Error Category | HTTP / System Codes | Operational Meaning | Action / Alert Rule |
| :--- | :--- | :--- | :--- |
| `never_reached` | 503, Gateway Inactive (`/IWFND/MED/170`), Connection Refused, DNS Failure | Request never reached SAP S/4HANA. Zero SAP state created. | **Safe to retry immediately.** Alert if rate > 5% in 5 min. |
| `auth_error` | 401, 403, `CX_SADL_AUTH_FAILED` | Missing XSUAA role, expired SSO token, or SAP SU53 authorization failure. | **Do NOT retry blindly.** Inspect user role assignments. |
| `unknown_outcome` | 504 Gateway Timeout, Socket Reset mid-call, TCP ETIMEDOUT | Request reached SAP, but response was dropped. Transaction outcome is indeterminate. | **CRITICAL ALERT.** Block automatic re-posting; trigger background re-check. |
| `rejected_by_sap` | 400, 422, Business Rejections (e.g. M7/021 deficit, M7/036 locked) | SAP rejected transaction with validated business diagnostic. | Surface message directly to user; unlock UI form. |

### 3.3 Supervisor Alerting State (`needs-attention`)

The in-memory and database attempt store (`GoodsIssueAttemptStore`) monitors all in-flight postings:
- **Age < 3 minutes**: Attempt is too young; ignored by background re-check to allow SAP DB commits to finish.
- **Age 3 to 15 minutes**: Re-checked against SAP. If still not found, remains `unconfirmed` / `sending`.
- **Age > 15 minutes (without document)**: Marked as `not_posted` (confirmed absent in SAP).
- **Age > 30 minutes (with document unconfirmed)**: Transitioned to status **`needs-attention`**.
- **Alert Hook**: Any transaction entering `needs-attention` fires an immediate P2 alert to the Warehouse Supervisor dashboard.

---

## 4. Application Rollback Procedures

If an MTA deployment fails smoke tests or introduces runtime regressions, follow these rollback steps.

### 4.1 Cloud Foundry Blue-Green Deployment Rollback

When using Blue-Green deployments (`cf bg-deploy` or CF zero-downtime rolling deploys):

```bash
# 1. Cancel active deployment and retain previous droplet
cf cancel-deployment SAPS4HANAFULLSTACK-srv

# 2. Or rollback to previous known-good droplet version
cf rollback SAPS4HANAFULLSTACK-srv

# 3. Verify previous instances are healthy
cf app SAPS4HANAFULLSTACK-srv
curl -s https://<app-domain>/health
```

### 4.2 Multi-Target Application (MTA) Archive Rollback

If blue-green rollback is unavailable, deploy the previous versioned MTA archive:

```bash
# 1. Target target org and space
cf target -o <org-name> -s <space-name>

# 2. Deploy previous known-good MTAR with production extension
cf deploy SAPS4HANAFULLSTACK_1.0.0.mtar -e mta/extensions/prod/prod.mtaext --delete-services=false

# 3. Validate deployment status
cf apps | grep SAPS4HANA
```

### 4.3 HTML5 Application Repository Rollback

If the frontend bundle in `html5-apps-repo` exhibits UI defects:
1. Re-deploy the previous `saps4hana-app-deployer` artifact archive.
2. In the SAP BTP Cockpit, navigate to **HTML5 Applications** -> select application -> **Revert to Version**.
3. Flush browser caches or increment approuter cache-busting timestamp in `xs-app.json`.

---

## 5. Persistence & Schema Rollback Procedures

### 5.1 HDI Container Compatibility Policy

The application's SAP HANA Cloud HDI Container (`saps4hana-db`) stores **only** dispatch queue entities (`saps4hana.wm.GoodsIssuePostingAttempt`).
- **Rule of Non-Destructive Migrations**: All CDS entity modifications MUST be purely additive (new optional columns or new tables).
- **Zero Column Deletions**: Never drop columns or rename existing tables in production CDS definitions.
- **Backward Compatibility**: If a new version of `saps4hana-srv` is rolled back, the existing HDI container schema remains fully compatible with the older version.

### 5.2 Emergency Schema Recovery (Local Development / SQLite)

If `db.sqlite` becomes corrupted or exhibits schema mismatch:
```bash
# 1. Back up corrupt database
mkdir -p .backup-db-recovery
cp db.sqlite .backup-db-recovery/db-corrupt-$(date +%Y%m%d%H%M%S).sqlite

# 2. Re-deploy schema via CDS CLI
npx cds deploy --to sqlite:db.sqlite

# 3. Verify health
npm run test:smoke
```

---

## 6. End-to-End SAP Transaction Reconciliation Procedures

Because the application interacts with SAP S/4HANA via a multi-step orchestration chain (Reservation -> TR -> TO -> Confirmation -> MIGO), failures can occur between stages. Use the following standard operating procedures (SOPs).

### 6.1 Transaction State Matrix

```text
[CLIENT REQUEST]
       │
       ▼
[STATUS: sending] ──────── (Process dies or network drops)
       │                                │
       ▼                                ▼
[SAP POSTING]                     [BACKGROUND RE-CHECK]
  ├── Success ──────────────► [STATUS: posted]
  ├── SAP Business Error ───► [STATUS: rejected]
  ├── Outbound Delivery ────► [STATUS: delivery_created]
  └── Timeout / Drop ──────► [STATUS: unconfirmed]
                                       │
                      ┌────────────────┴────────────────┐
                      ▼                                 ▼
             (Age > 15 min & absent)        (Age > 30 min & unconfirmed)
                      │                                 │
                      ▼                                 ▼
              [STATUS: not_posted]             [STATUS: needs-attention]
                                                        │
                                                        ▼
                                             [SUPERVISOR INTERVENTION]
```

---

### 6.2 Movement 201: Goods Issue to Cost Center

- **SAP Components**: Reservation (`RKPF`/`RESB`), TR (`LTBK`/`LTBP`), TO (`LTAK`/`LTAP`), Quant (`LQUA`), Material Document (`MATDOC`).
- **Interim Storage Bin**: Storage Type `911`, Bin `<CostCenter>` (e.g. `911/1011201301`).

#### Failure Scenarios & Resolution:
1. **Scenario 1: Reservation & TR Created, TO Failed or Unconfirmed**
   - *State*: Reservation `0000533316` and TR `0001000904` exist in SAP (`STATU: ''`). No confirmed TO.
   - *Diagnosis*: Check TR status in transaction `LB03`. Stock is still in source bin (`1011103003`).
   - *Action*: Retry Step 2 (`POST /odata/v4/tr-to/createTOFromTR`) supplying the existing `tbnum`. If canceling, delete reservation in `MB22` and cancel TR in `LB02`.
2. **Scenario 2: TO Confirmed, but MIGO Failed or Timed Out**
   - *State*: TO `0001037381` confirmed (`KQUIT: 'X'`). Stock moved physically to interim bin `911/1011201301`. MIGO document missing.
   - *Diagnosis*: Check bin stock in transaction `LS24` or `LS26` for Storage Type `911`. Quant exists with material quantity.
   - *Action*: Run MIGO Goods Issue against the reservation. The quant at `911` will be consumed.
   - *Reconciliation*: Do NOT create a new TO; doing so will double-pick physical stock.
3. **Scenario 3: MIGO Posted in SAP, but CAP Status Unconfirmed**
   - *State*: Material Document `4900050304` exists in `MATDOC`. CAP attempt status is `unconfirmed`.
   - *Action*: Run background re-check. The re-check reads `RESB` (`ENMNG = BDMNG` and `KZEAR = 'X'`) and automatically promotes status to `posted`.

---

### 6.3 Movement 241: Goods Issue to Asset

- **SAP Components**: Asset (`ANLN1`/`ANLN2`), Reservation (`RESB`), TR (`BWLVS: 241`), TO (`LTAK`), Quant (`LQUA`), Material Document (`MATDOC`).
- **Interim Storage Bin**: Storage Type `912`, Bin `<AssetNumber>` (e.g. `912/0000400001`).

#### Failure Scenarios & Resolution:
1. **Scenario 1: Asset Master Locked or Inactive**
   - *Diagnostic Error*: `AA/001` "Asset is deactivated" or `AA/400` "Asset locked".
   - *Resolution*: Check Asset Master Record in transaction `AS03`. Verify asset capitalization date and status. Unlock asset in `AS02`.
2. **Scenario 2: Stock Staged at Interim Bin `912`**
   - *Diagnosis*: Check `LS24` for Storage Type `912`.
   - *Resolution*: Complete MIGO Goods Issue with Movement 241 specifying Asset `400001` / Subnumber `0000`. If aborting, cancel TO via `LT15` to return stock to source bin.

---

### 6.4 Movement 311: Storage Location Transfer (SLoc-to-SLoc)

- **SAP Components**: Dual-Line `MATDOC` (Line 1: Debit Issuing SLoc; Line 2: Credit Receiving SLoc).
- **Interim Storage Bin**: Storage Type `921`, Bin `TRANSFER`.

#### Failure Scenarios & Resolution:
1. **PP-WM Quantity Reduction (Staging without TO)**:
   - When material already resides in the destination bin, SAP automatically completes the TR (`STATU='E'`, `ELIKZ='X'`) without generating an extra TO.
   - *Adapter Handling*: `TrToAdapter.js` detects `trCompletedWithoutTo` and returns `TransferOrder: 'NONE'`, `Confirmed: true`.
   - *Resolution*: Proceed directly to Step 3 (MIGO 311 posting).
2. **Dual-Line Inventory Imbalance**:
   - *Diagnosis*: Check `MATDOC` for document number. Confirm both Line 1 (`SHKZG: 'H'`, Issuing SLoc) and Line 2 (`SHKZG: 'S'`, Receiving SLoc) are present.
   - *Resolution*: If MIGO failed, verify stock in issuing SLoc via `MB52` / `MMBE`.

---

### 6.5 Movement 301: Plant-to-Plant Transfer Posting

- **SAP Components**: Dual-Line `MATDOC` across plants (e.g. Plant 1120 -> Plant 1110); transparent table `MARD`.
- **Interim Storage Bin**: Storage Type `920`, Bin `TRANSFER`.

#### Failure Scenarios & Resolution:
1. **Material Not Extended in Receiving Plant**:
   - *Diagnostic Error*: `M7/053` "Material not maintained in plant 1110".
   - *Resolution*: In SAP GUI, extend material to target plant via transaction `MM01` (views: Purchasing, Plant Data/Storage).
2. **Post-Transfer Inventory Audit**:
   - Query table `MARD` via RFC:
     - Verify issuing plant balance (`WERKS: 1120`, `LGORT: CS01`) decreased by withdrawn quantity.
     - Verify receiving plant balance (`WERKS: 1110`, `LGORT: CS01`) increased by received quantity.

---

### 6.6 Movement 261: Goods Issue to Process / Production Order

- **SAP Components**: Process Order (`AFKO`/`AFPO`), Component Reservation (`RESB`), TR (`BWLVS: 261`, `BETYP: 'F'`), TO (`LTAK`), Quant (`LQUA`), Material Document (`MATDOC`).
- **Interim Storage Bin**: Storage Type `914`, Bin `<OrderID>` (e.g. `914/0001002790`).

#### Failure Scenarios & Resolution:
1. **Order Status Locked in JEST (`LKD`, `TECO`, `CLSD`)**:
   - *Diagnostic Error*: `BS/013` "Order status TECO forbids goods movement".
   - *Resolution*: Inspect order status in transaction `COR3` (Process Order) or `CO03` (Production Order). If technically completed or locked, revoke status in `COR2`/`CO02` before attempting goods issue.
2. **Outbound Delivery Generated Instead of Material Document (SAP Message `L9/514`)**:
   - In certain WM-managed configurations, SAP automatically routes goods issue to an outbound delivery instead of posting MIGO directly.
   - *System Behavior*: `GoodsIssueAttemptStore` detects message `L9/514` and transitions attempt to `delivery_created`, recording `DeliveryNumber`.
   - *Resolution*: Query delivery in transaction `VL02N` / `VL03N`. Execute Post Goods Issue (PGI) on the outbound delivery via `executeDeliveryPgi.js` or SAP GUI.

---

## 7. Incident Escalation & Response Playbooks

### 7.1 Severity Definitions

- **Severity 1 (P1 - Critical)**: Total application unavailability, auth failure across all users, or data inconsistency affecting inventory valuation.
- **Severity 2 (P2 - Major)**: Specific movement type failing consistently, background re-check job stalled, or `needs-attention` queue exceeding 10 transactions.
- **Severity 3 (P3 - Minor)**: UI formatting anomalies, non-critical value-help latency, single isolated transient failure.

### 7.2 Escalation Matrix

| Role | Contact / Channel | Responsibilities |
| :--- | :--- | :--- |
| **L1 Operations / NOC** | Cloud Monitoring Dashboard / Pager | Acknowledge alerts; run `npm run test:smoke`; execute blue-green CF restart if pods are unhealthy. |
| **L2 Application Support** | CAP Full-Stack Engineering Team | Inspect `GoodsIssueAttemptStore`; run background re-check jobs; reconcile orphan reservations and TOs in interim bins. |
| **L3 SAP Functional / Basis** | SAP ERP & Gateway Competence Center | Check RFC destination, work process locks in `SM50`/`SM66`, system aliases in `/IWFND/MAINT_SERVICE`, and DDIC locks in `SM12`. |
