# Release Evidence Checklist & Validation Protocol

## 1. Executive Summary & Purpose (Finding CI-03)

This document establishes the official **Release Evidence Checklist and Validation Protocol** for the SAP S/4HANA Full-Stack Cloud Application, resolving **Finding CI-03: SAP-dependent validation remains separate (P1)**.

### Architectural Principle: Separation of SAP-Free and SAP-Dependent Gates
The continuous integration (CI) pipeline deliberately and strictly separates **automated SAP-free testing** from **manually controlled SAP validation**:
- **Automatic on Push / Pull Request**: Every code push and pull request runs automated, isolated tests with zero SAP network egress and all SAP writes stubbed or mocked.
- **Strictly Guarded on Demand**: Live SAP-connected validation, and especially live transactional write operations, are **NEVER run automatically on every push**.

> [!CAUTION]
> **Strict Non-Negotiable Rule**: Live SAP write tests must **NEVER** run automatically on code push or pull request.
> Automatic live writes against shared SAP systems risk data corruption, inventory locking, document number exhaustion, orphaned transactional artifacts, and violation of SAP auditing policies.

### The Production Readiness Evidence Baseline
A passing automated CI run alone proves software buildability, lint conformance, unit/integration contracts, and browser UI mechanics—it does **not** prove live SAP persistence or deployed Cloud Foundry infrastructure readiness.
Full production release certification requires documented evidence across all **Five Distinct Verification Tiers**:

```
┌────────────────────────────────────────────────────────────────────────┐
│                   5-TIER RELEASE EVIDENCE ARCHITECTURE                  │
├────────────────────────────────────────────────────────────────────────┤
│ TIER 1: Automated SAP-Free Verification (Continuous CI Release Gate)   │
│         -> 100% automated on push/PR; 0 SAP egress; writes mocked     │
│                                                                        │
│ TIER 2: Read-Only SAP Integration Verification (Staging Probe)         │
│         -> Live SAP reads; T000 preflight; RFC runtime check; 0 writes │
│                                                                        │
│ TIER 3: Explicitly Authorized SAP Write Verification (Live Gateway)     │
│         -> Written user GO; singleWriteHandler; real SAP transaction   │
│                                                                        │
│ TIER 4: Direct SAP Document Read-Back (Persistence Proof)              │
│         -> Read back from SAP database tables (EKKO, VBAK, MATDOC...)   │
│                                                                        │
│ TIER 5: Deployment Smoke Verification (Runtime & Platform Health)      │
│         -> /health, /health/ready, /health/dependencies on deployed CF │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Tier 1: Automated SAP-Free Verification (Continuous CI Release Gate)

### Objectives & Safety Boundaries
- **Execution Mode**: Continuous and automatic on every commit, push, and pull request.
- **Target Environment**: GitHub-hosted runner (`ubuntu-24.04`) or local development workstation.
- **Runtime Profile**: `NODE_ENV=test`, in-memory SQLite (`:memory:`), mock authentication (`ENABLE_DEV_TOKEN_ISSUER=true`).
- **Network Boundaries**: Outbound SAP network egress is blocked (`assertSapUnreachable`). SAP-backed OData/RFC calls return HTTP 502 / simulated unreachable. All write operations are caught and mocked by `test/e2e/support/writeGuard.js`.

### Required Verification Surface & Commands

| Stage / Test Suite | Exact Command | Success Criteria |
| :--- | :--- | :--- |
| **Static Code Analysis** | `npm run lint` | 0 ESLint errors, 0 warnings. |
| **Fiori UI5 Conformance** | `npm --prefix app/fiori-app run lint` | 0 UI5 linter findings. |
| **Secret Leak Prevention** | `npm run scan:secrets` | 0 credential or key leaks detected. |
| **Dependency Audit** | `npm run scan:dependencies` | 0 high or critical vulnerability findings. |
| **Automated Test Suite** | `npx jest --runInBand --ci --coverage` | All unit, adapter, domain, and CAP service tests pass; meets coverage thresholds. |
| **Performance Benchmarks**| `npm run test:performance` | PO creation and list screens load within calibrated baselines. |
| **Fiori Accessibility** | `npm run test:a11y` | axe-core WCAG 2.1 AA conformance with 0 critical violations. |
| **Monitoring & Alerting** | `npm run test:monitoring` | Alerting thresholds, health probes, and log metrics verified. |
| **Local Process Smoke** | `node tools/smoke-test-deployment.js --wait=30` | `/health` and `/health/ready` return 200 on isolated test server. |
| **MTA Descriptor Check** | `npm run validate:mta` | `mbt validate -x paths` reports 0 errors. |
| **MTA Archive Build** | `npm run build:mta` | MTAR archive generated containing `saps4hana-srv`, `approuter`, `app-deployer`, `db-deployer`. |
| **SAP-Free Browser E2E** | `npm run test:e2e:sap-free` | All 6 Playwright suites pass: Negative UI, Admin menu, Ask AI, Write auth, Quarantine labels, MIB labels. |

---

## 3. Tier 2: Read-Only SAP Integration Verification (Controlled Staging Probe)

### Objectives & Safety Boundaries
- **Execution Mode**: Manually controlled via GitHub Actions `workflow_dispatch` (`run_sap_validation: true`) or pre-release execution by an authorized engineer.
- **Target Environment**: SAP-connected non-production environment (Dev Sandbox / Quality Assurance).
- **Safety Rule**: **STRICTLY READ-ONLY**. Gated by `ALLOW_LIVE_SAP_TOOLS=1` and `--allow-live-sap`. Zero transactional mutations or database writes.

### Required Verification Surface & Commands

| Verification Step | Command | Diagnostic Scope | Pass Criteria |
| :--- | :--- | :--- | :--- |
| **1. RFC Dynamic Library & Linker Check** | `npm run check:rfc-runtime` | Inspects OS platform (`linux/x64`), `LD_LIBRARY_PATH`, `libsapnwrfc.so` file existence, and Node-API module loading. | Reports `CERTIFIED` (or explains exact missing library/path). |
| **2. SAP RFC Preflight Read** | `ALLOW_LIVE_SAP_TOOLS=1 node tools/rfc-preflight.js --allow-live-sap` | Executes read-only `RFC_READ_TABLE` on tenant table `T000`. Diagnoses exact layer: `sdk`, `config`, `auth`, `network`, `client`, or `ok`. | Reports `RFC PREFLIGHT PASS [ok]`, connected to expected client (e.g. `220`). |
| **3. Service Connectivity Check** | `npm run check:connectivity` | Resolves BTP destinations, certificates, system labels, and AI service provider configuration without mutations. | Reports `Overall Service Connectivity Status: HEALTHY`. |
| **4. Live OData Metadata Verification** | `npm run validate:sap:sandbox` | Reads `$metadata` for all required S/4HANA OData services (`C_PURCHASEORDER_FS_SRV`, `MM_PUR_PO_MAINT_V2_SRV`, `SD_F2370_INQY_WL_SRV`, `SD_F1873_SO_WL_SRV`). | HTTP 200 OK for all metadata endpoints. |
| **5. Read-Only System Log Audit** | `ALLOW_LIVE_SAP_TOOLS=1 node tools/check-sap-logs.js` (or unit live suite) | Tests read-only RFC function modules `RSLG_READ_SLG` (SM21) and `RSAU_API_GET_LOG_DATA` (SM20). | Returns recent log records within configured UTC window. |
| **6. 6-Stage Integration Diagnostic (MON-01)** | `npm run check:sap-diagnostic` (or `GET /admin/diagnostics/sap`) | Separately controlled diagnostic reporting 6 distinct states: Configured, Reachable, Authenticated, Authorized, Metadata verified, Functionally verified across OData and RFC using approved technical identity. | All stages `PASSED` (Overall Status: `HEALTHY`); zero writes. Unauthenticated health probes prohibited from logging on to SAP. |

---

## 4. Tier 3: Explicitly Authorized SAP Write Verification (Guarded Transactional Proof)

### Objectives & Safety Boundaries
- **Execution Mode**: Guarded manual execution. **NEVER run automatically in CI on push.**
- **Prerequisites & Mandatory Authorizations**:
  1. **Written User Authorization**: Explicit written user "go" naming the specific target SAP system (e.g. `S4HANA_DEV - Client 220`), business transaction type, and test data scope.
  2. **Security Environment Flags**:
     ```sh
     export ALLOW_LIVE_SAP_TOOLS=1
     export E2E_SAP_WRITE_FLOWS=purchaseOrder  # Comma-separated list of explicitly authorized flows
     export E2E_SAP_LIVE_TARGET="S4HANA_DEV - Client 220"
     ```
  3. **Verified Non-Placeholder Test Data**: `test/e2e/live/testData.json` must contain valid master data (valid supplier, material, plant, purchasing org, sales org) with **zero placeholder values** (`TODO`, `___`, `xxxxx`, samples).
  4. **Single-Write Execution Guard**: `test/e2e/support/liveWriteGate.js` enforces `singleWriteHandler`, permitting exactly one write call per run and immediately aborting any duplicate attempts.

### Transactional Round-Trip Test Suites (`npm run test:e2e:sap`)

| Business Flow | E2E Round-Trip Suite | Action / Interface | Target Business Document |
| :--- | :--- | :--- | :--- |
| **Purchase Order** | `test/e2e/mm/roundTripPurchaseOrder.e2e.js` | `createPurchaseOrder` (OData `MM_PUR_PO_MAINT_V2_SRV` / BAPI fallback) | Purchase Order (e.g. `300002151`) |
| **Sales Order** | `test/e2e/sd/roundTripSalesOrder.e2e.js` | `createSalesOrder` (Lean Order OData / BAPI) | Standard Sales Order (e.g. `5000534`) |
| **Goods Receipt** | `test/e2e/wm/roundTripGoodsReceipt.e2e.js` | `postGoodsReceiptWithStorageUnit` (Movement 101/261 via BAPI) | Material Document (e.g. `5000005789`) |
| **Sales Inquiry** | `test/e2e/sd/roundTripSalesInquiry.e2e.js` | `createSalesInquiry` (OData `SD_F2369_INQY_FS_SRV`) | Sales Inquiry document |
| **Customer Return** | `test/e2e/sd/roundTripCustomerReturn.e2e.js` | `createCustomerReturn` (Return Order BAPI) | Return Order with pricing |
| **Handling Unit** | `test/e2e/wm/roundTripHandlingUnit.e2e.js` | `create`, `pack`, `unpack` (`BAPI_HU_CREATE`) | Handling Unit number |
| **Packing Instruction**| `test/e2e/wm/roundTripPackingInstruction.e2e.js`| `create` (`BAPI_PACKING_INSTRUCTION_CREATE`) | Packing Instruction number |
| **User Management** | `test/e2e/admin/roundTripUserManagement.e2e.js` | `lockUser`, `unlockUser` (`BAPI_USER_LOCK`) | ABAP User lock indicator |

### Pass Criteria
- Response returns HTTP 201/200 with an authentic SAP backend document number generated by SAP internal number ranges.
- Zero client-side or backend mock fallbacks utilized.
- UI displays the SAP-persisted document.

---

## 5. Tier 4: Direct SAP Document Read-Back (Persistence Proof)

### Objectives & Safety Boundaries
- **Execution Mode**: Executed immediately following a Tier 3 transactional write.
- **Core Governance Rule**: Frontend HTTP success or local CAP state is **NOT** evidence of SAP persistence. The document must be read back directly from the real SAP backend database tables via an independent query channel.

### Direct SAP Read-Back Mapping Table

| Transactional Document | SAP Database Tables | Verification Fields Queried (via `RFC_READ_TABLE` or independent OData GET) | Validation Rule |
| :--- | :--- | :--- | :--- |
| **Purchase Order** | `EKKO` (Header)<br>`EKPO` (Item) | `EBELN`, `BSART`, `LIFNR`, `EKORG`, `EKGRP`, `BUKRS`<br>`EBELP`, `MATNR`, `MENGE`, `MEINS`, `NETPR`, `WERKS` | `EBELN` exists; Supplier, Plant, Material, and Net Price match submitted payload. |
| **Sales Order** | `VBAK` (Header)<br>`VBAP` (Item)<br>`VBKD` (Commercial) | `VBELN`, `AUART`, `VKORG`, `VTWEG`, `SPART`, `KUNNR`<br>`POSNR`, `MATNR`, `KWMENG`, `VRKME`, `NETPR`<br>`INCO1`, `INCO2`, `ZTERM` | `VBELN` exists; Sold-to party, currency, and line item quantities match submitted order. |
| **Goods Receipt / MIGO**| `MATDOC` / `MKPF`<br>`EKBE` (History)<br>`MARD` (Stock) | `MBLNR`, `MJAHR`, `BWART`, `MATNR`, `WERKS`, `LGORT`<br>`EBELN`, `EBELP`, `VGABE` (1 = Goods Receipt)<br>`LABST` (Unrestricted Stock) | `MBLNR` exists with movement type `101` or `261`; PO history updated; stock balance adjusted. |
| **Customer Return** | `VBAK` (Return Header)<br>`VBAP` (Return Item)<br>`VBFA` (Doc Flow) | `VBELN`, `AUART`, `KUNNR`, `NETWR`<br>`POSNR`, `MATNR`, `KWMENG`<br>`VBELV` (Preceding Order), `VBELN` (Subsequent Return) | Return document exists; links to preceding reference order in `VBFA`; pricing is non-zero. |
| **Transfer Order** | `LTAK` (Header)<br>`LTAP` (Items) | `LGNUM`, `TANUM`, `BWLVS`, `BWTAR`, `BDATU`<br>`TAPOS`, `MATNR`, `VSOLA`, `MEINS`, `VLTYP`, `NLTYP` | `TANUM` exists; movement type, source storage type, and destination bin match transfer spec. |
| **Handling Unit** | `VEKP` (Header)<br>`VEPO` (Items) | `EXIDV`, `VHILM`, `STATUS`, `TARAG`, `GEWIC`<br>`VENUM`, `VELIN`, `VBELN`, `POSNR` | `EXIDV` exists in `VEKP`; packaging material assigned; items packed in `VEPO`. |
| **Packing Instruction**| `PACKKP` (Header)<br>`PACKPO` (Items) | `PACKNR`, `POBJID`, `PACKTYP`, `PTEXT`<br>`PAITEMTYPE`, `MATNR`, `TRGQTY`, `BASEUOM` | `PACKNR` exists; packaging components and target quantities match instruction specification. |

### Pass Criteria
- Independent read-back query returns the persisted record directly from the underlying SAP tables.
- All submitted business attributes (items, units, pricing, partner keys) match the persisted SAP database state.

---

## 6. Tier 5: Deployment Smoke Verification (Runtime & Infrastructure Health)

### Objectives & Safety Boundaries
- **Execution Mode**: Post-deployment verification run immediately after deployment to SAP BTP Cloud Foundry, Kyma cluster, or container runtime.
- **Target URL**: The deployed CAP backend service route (or approuter protected route).

### Required Verification Surface & Commands

| Health Probe / Check | Target Endpoint | Pass Criteria | Operational Consequence If Failing |
| :--- | :--- | :--- | :--- |
| **1. Process Liveness** | `GET /health` | HTTP 200 OK<br>`{ "status": "UP" }` | Container process has failed or crashed. Cloud Foundry restarts container. |
| **2. Durable Database Readiness** | `GET /health/ready` | HTTP 200 OK<br>`{ "status": "UP" }` | SAP HANA HDI container is unavailable. Returns HTTP 503 `DOWN`. Prevents premature GoRouter routing. |
| **3. Dependency Diagnostics** | `GET /health/dependencies` | HTTP 200 OK<br>`{ "status": "UP" \| "DEGRADED", "dependencies": { "database": "UP", "s4Destination": "CONFIGURED", "rfcSdk": "UP" } }` | If `database` is not `UP`, app is not ready. If `rfcSdk` is `DOWN`, app degrades gracefully (RFC blocked with 503, HTTP/OData core stays operational). |
| **4. Approuter & XSUAA Gate** | `GET /saps4hana-fiori-app/` | HTTP 200 OK or 302 redirect to XSUAA logon page. | Approuter configuration or XSUAA service binding error. |
| **5. Automated Smoke Runner** | `node tools/smoke-test-deployment.js --target=<deployed-url>` | Passes both liveness and readiness waits, and reports zero deployment smoke failures. | Deployment rollback runbook triggered. |

---

## 7. Pre-Release Evidence Gate Matrix & Sign-Off Checklist

Before any production deployment or milestone release certification, the release manager must complete and record this verification checklist:

| Verification Tier | Scope | Status | Evidence Location / Tool | Release Sign-Off Gate |
| :--- | :--- | :---: | :--- | :--- |
| **Tier 1: SAP-Free CI Gate** | Code quality, lint, security scans, unit & integration tests, browser E2E (writes mocked) | 🟢 PASS | GitHub Actions Run (e.g. `44480177488`) | **Mandatory for PR merge** |
| **Tier 2: Read-Only SAP Integration** | RFC preflight, service connectivity, CF RFC runtime, OData metadata | 🟢 PASS / 🟡 READY | `tools/rfc-preflight.js`<br>`tools/verify-cf-rfc-runtime.js`<br>`tools/check-service-connectivity.js` | **Mandatory before Staging deploy** |
| **Tier 3: Authorized SAP Write** | Live transactional flows (PO, SO, GR, Return, HU) with single-write protection | 🟡 GUARDED | `npm run test:e2e:sap`<br>`test/e2e/live/testData.json` | **Requires written user "go" per call** |
| **Tier 4: Direct SAP Read-Back** | Direct SQL/RFC read from underlying SAP tables (`EKKO`, `VBAK`, `MATDOC`...) | 🟡 VERIFIED PER FLOW | `RFC_READ_TABLE`<br>Historical PO/SO/GR proof recorded | **Mandatory for SAP-persisted features** |
| **Tier 5: Deployment Smoke** | Live Cloud Foundry `/health`, `/health/ready`, `/health/dependencies` probes | 🟡 DEPLOY-READY | `tools/smoke-test-deployment.js` | **Mandatory immediately post-deploy** |

---

## 8. Summary of Active Architectural Blockers & Next Actions

1. **RFC Runtime in Cloud Foundry**:
   - Multi-buildpack pipeline configured in `mta.yaml` and `mta/extensions/prod/prod.mtaext`.
   - Deployment certification requires provisioning the enterprise-hosted SAP NW RFC SDK 7.50 Linux x86-64 archive in the target space and verifying via `npm run check:rfc-runtime`.
2. **SAP-Only Persistence Migration**:
   - Status remains **BLOCKED** per `docs/decisions/sap-only-persistence-migration.md`.
   - Durable SAP HANA persistence via HDI container (`saps4hana-db`) must be retained to enforce atomic posting claims, duplicate prevention, and restart recovery until the SAP-side atomic claim contract is proven.
3. **Full Live SAP Write Round Trips**:
   - Kept strictly separate from automated CI.
   - Any live SAP write execution requires user's explicit written authorization naming the target system, business flow, and approved test data.
