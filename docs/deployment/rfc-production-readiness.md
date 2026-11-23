# SAP RFC Production Readiness Architecture & Operational Guide

## 1. Executive Summary & Context (Finding SAP-01)

This document addresses **Finding SAP-01: RFC production readiness is not fully established (P1)**.
Several administrative and warehouse capabilities in this platform currently interface with SAP S/4HANA via RFC function modules (such as `RFC_READ_TABLE`, `TH_SERVER_LIST`, `RSLG_READ_SLG`, `RSAU_API_GET_LOG_DATA`, and BAPIs for user and handling unit operations).

Because `node-rfc` is a native C++ addon requiring the proprietary SAP NetWeaver RFC SDK (`libsapnwrfc.so` on Linux, `libsapnwrfc.dylib` on macOS), deploying an MTA package to SAP BTP Cloud Foundry with standard `nodejs_buildpack` does not automatically furnish the required native dynamic libraries.

This guide establishes the production readiness baseline across:
1. **Cloud Foundry Runtime Provisioning** of the SAP NW RFC SDK.
2. **Native Library Compatibility & Verification** across Linux stacks.
3. **BTP RFC Destination Mapping** for live production Destination Service instances.
4. **SAP ABAP Authorization Requirements** (least-privilege matrix).
5. **Connection Lifecycle & Connection Pooling** (`noderfc.Pool` and LUW session scoping).
6. **Concurrency Limits & RFC Timeout Protection**.
7. **Read-Only Preflight & Health Verification Runbook**.

---

## 2. Cloud Foundry NW RFC SDK Provisioning

### Why Standard Buildpacks Are Insufficient
The standard Cloud Foundry Node.js buildpack (`nodejs_buildpack` on `cflinuxfs4` / Ubuntu 22.04 LTS) runs on an open container root filesystem. The SAP NW RFC SDK is proprietary SAP software requiring an active SAP customer license and S-User download from the SAP Support Portal / Software Download Center. Consequently:
- SAP NW RFC SDK cannot be mirrored to public npm or open repositories.
- `package.json` retains `"node-rfc": "^3.3.1"` as an `optionalDependency` so non-RFC developer machines and standard CI runners (`ubuntu-24.04`) can execute `npm ci` without native compilation failures.
- A standard `mbt build` and `cf push` with `nodejs_buildpack` will omit the dynamic libraries, causing runtime calls to `node-rfc` to fail closed with status 503.

### Production Provisioning Strategies

#### Option A: Cloud Foundry Multi-Buildpack with Private Supply Buildpack (Recommended for Native MTA)
In BTP Cloud Foundry, configure a multi-buildpack pipeline in `mta.yaml` or a production MTA extension:

```yaml
modules:
  - name: saps4hana-srv
    type: nodejs
    path: gen/srv
    parameters:
      buildpacks:
        - https://<internal-corporate-repo>/buildpacks/sap-nwrfcsdk-supply-buildpack.zip
        - nodejs_buildpack
      memory: 1024M
      instances: 2
```

**Supply Buildpack Behavior:**
1. Downloads the approved, licensed `nwrfc750P_XX-linuxx86_64.zip` from an authenticated internal enterprise artifact repository (e.g. Artifactory, Nexus, or private BTP Object Store).
2. Extracts headers to `$DEPS_DIR/<idx>/nwrfcsdk/include` and shared libraries to `$DEPS_DIR/<idx>/nwrfcsdk/lib`.
3. Creates `.profile.d/000_nwrfcsdk.sh` exporting:
   ```sh
   export RFC_SDK_PATH="$DEPS_DIR/<idx>/nwrfcsdk"
   export LD_LIBRARY_PATH="$DEPS_DIR/<idx>/nwrfcsdk/lib:$LD_LIBRARY_PATH"
   ```
4. During staging, `node-rfc` detects the headers and compiles or validates the Linux x86-64 prebuilt. At runtime, the dynamic linker loads `libsapnwrfc.so`.

#### Option B: Container Deployment (Cloud Foundry Docker / Kyma Runtime)
Where container runtime is preferred over droplet staging, use the repository's native Docker container specification:
- Dockerfile: `docker/cap/Dockerfile`
- Container Startup & Verification Guard: `tools/docker/runtime.js`
- Configuration:
  ```dockerfile
  ENV RFC_SDK_PATH=/usr/sap/nwrfcsdk \
      LD_LIBRARY_PATH=/usr/sap/nwrfcsdk/lib
  ```
- The proprietary SDK is mounted read-only at `/usr/sap/nwrfcsdk` from a persistent volume or internal image layer, keeping secrets and proprietary binaries outside Git.

#### Option C: Strategic OData Migration (SAP Target Architecture)
As documented in `RfcClient.js` and SAP Note 329 on `node-rfc`, SAP has declared `node-rfc` non-strategic. The long-term architecture is to migrate remaining RFC operations to S/4HANA OData V2/V4 services or RAP facades. `RfcClient.js` serves as a migration facade until ABAP services are deployed.

---

## 3. Native Library Compatibility & Verification

In production Linux environments (Cloud Foundry `cflinuxfs4` Ubuntu 22.04 LTS x86_64):
- **Node.js**: Node 22 (LTS)
- **Linux Architecture**: `linux/amd64` (ELF Machine 62 / x86-64)
- **Required Dynamic Libraries** in `LD_LIBRARY_PATH`:
  - `libsapnwrfc.so` (SAP NW RFC SDK 7.50 PL 12+)
  - `libsapucum.so`
  - `libicudata.so.57`
  - `libicui18n.so.57`
  - `libicuuc.so.57`
- **Verification Hook**:
  `tools/docker/runtime.js` (`checkRfcSdk`) inspects the ELF header of `libsapnwrfc.so`, verifying machine architecture `62` before attempting to load `node-rfc`.
- **Graceful Failure**:
  If the SDK is missing or incompatible, `RfcClient.isAvailable()` returns `false`. `/health/dependencies` reports `rfcSdk: "DOWN"`, while the CAP application continues serving non-RFC HTTP and OData traffic.

---

## 4. Production RFC Destination Properties Resolution

In SAP BTP Destination Service, RFC destinations can be defined using standard SAP Java Connector (JCo) conventions, logon load-balancing parameters, or simplified aliases. `RfcClient.js` supports all proven enterprise property formats:

### Supported BTP Destination Formats

| Property Type | Standard JCo Name | Alias / Simplified Name | Example / Notes |
| :--- | :--- | :--- | :--- |
| **Application Server Host** | `jco.client.ashost` | `ashost` | `s4app01.internal.corp` |
| **System Number** | `jco.client.sysnr` | `sysnr` | `00` |
| **Message Server Host** | `jco.client.mshost` | `mshost` | `s4ms01.internal.corp` (load balancing) |
| **Logon Group** | `jco.client.group` | `group` | `PUBLIC` or `DIAL` |
| **System ID (SID)** | `jco.client.r3name` | `r3name` | `S4H` or `PRD` |
| **Message Server Service** | `jco.client.msserv` | `msserv` | `3600` |
| **SAP Gateway Host** | `jco.client.gwhost` | `gwhost` | Optional gateway override |
| **SAP Gateway Service** | `jco.client.gwserv` | `gwserv` | `sapgw00` |
| **SAP Client** | `jco.client.client` | `client` | `100` or `220` |
| **RFC Technical User** | `jco.client.user` | `user`, `username` | `RFC_TECH_USER` |
| **RFC Password** | `jco.client.passwd` | `passwd`, `password` | Vault-injected secret |
| **Logon Language** | `jco.client.lang` | `lang` | Default `EN` |
| **SDK Trace Level** | `jco.client.trace` | `trace` | Default `0` (off) |
| **Pool Capacity** | `jco.destination.pool_capacity` | `pool_capacity` | Maximum idle pooled connections |
| **Peak Limit** | `jco.destination.peak_limit` | `peak_limit` | Maximum active concurrent connections |

### Destination Caching & Security
- Destination properties are retrieved via `@sap-cloud-sdk/connectivity` `getDestination({ destinationName: S4_RFC_DESTINATION_NAME })`.
- Parameters are cached in-memory with a 5-minute TTL (`DESTINATION_PARAMS_TTL_MS = 300000 ms`).
- Passwords are scrubbed from all logs, error messages, and thrown exceptions.
- In production (`NODE_ENV=production`), `RfcClient.resolveConnectionParams()` strictly forbids local environment credentials, failing closed if `S4_RFC_DESTINATION_NAME` is absent or the destination lacks required connection keys.

---

## 5. SAP ABAP Backend RFC Authorization Matrix

To establish production least-privilege security, the technical user designated in the BTP RFC destination must be assigned a role with the following authorizations:

### 1. `S_RFC` (RFC Execution Authorization)
- `ACTVT`: `16` (Execute)
- `RFC_TYPE`: `FUGR` (Function Group)
- `RFC_NAME`:
  - `SDST`: `RFC_READ_TABLE` (Read-only table queries)
  - `RFC1`: `RFC_GET_FUNCTION_INTERFACE` (Function metadata lookup)
  - `THFB`: `TH_SERVER_LIST` (Active application server listing)
  - `RSLG`: `RSLG_READ_SLG` (System Log / SM21)
  - `RSAU_LOG`: `RSAU_API_GET_LOG_DATA` (Security Audit Log / SM20)
  - `SU01`, `USER`: `BAPI_USER_GET_DETAIL`, `BAPI_USER_GETLIST`, `BAPI_USER_LOCK`, `BAPI_USER_UNLOCK` (User administration)
  - `BAPI`: `BAPI_TRANSACTION_COMMIT`, `BAPI_TRANSACTION_ROLLBACK` (Transaction boundaries)
  - `V55K`: `BAPI_INB_DELIVERY_CONFIRM_DEC` — **no longer called** since the Goods Receipt feature was removed on 2026-11-21. **The group name `V55K` is wrong for the connected system:** `ENLFDIR` shows the module in function group `V50I` (see "Verified on the dev sandbox" below).
  - `HU_BAPI`: `BAPI_HU_CREATE`, `BAPI_HU_PACK`, `BAPI_HU_UNPACK`, `BAPI_HU_DELETE` (Handling Unit management)

#### Verified on the dev sandbox (client 220), 2026-11-21, READ-ONLY (`RFC_READ_TABLE` on `ENLFDIR`, `TFDIR`, `USOBX_C`)

The function-group names in the list above were written from documentation and several do not match the connected system. For `S_RFC` with `RFC_TYPE = FUGR`, the group is what counts:

| Function module(s) the code calls | Function group on the system | Listed above as |
| --- | --- | --- |
| `RFC_READ_TABLE` | `SDTX` | `SDST` |
| `RFC_GET_FUNCTION_INTERFACE` | `RFC1` | `RFC1` |
| `TH_SERVER_LIST` | `THFB` | `THFB` |
| `RSLG_READ_SLG` | `RSLG` | `RSLG` |
| `RSAU_API_GET_LOG_DATA` | `RSAU_LOG` | `RSAU_LOG` |
| `BAPI_USER_GETLIST`, `BAPI_USER_GET_DETAIL`, `BAPI_USER_LOCK`, `BAPI_USER_UNLOCK` | `SU_USER` | `SU01`, `USER` |
| `BAPI_TRANSACTION_COMMIT`, `BAPI_TRANSACTION_ROLLBACK` | `BAPT` | `BAPI` |
| `BAPI_HU_CREATE`, `BAPI_HU_PACK`, `BAPI_HU_UNPACK`, `BAPI_HU_DELETE` | `HU_BASIC_BAPIS` | `HU_BAPI` |
| `BAPI_INQUIRY_CREATEFROMDATA2` | `2030` | not listed |
| `BAPI_CUSTOMERRETURN_CREATE` | `2102` | not listed |
| `Z_MM_QUAR_LABEL_PDF` | `ZMM_QUAR_LABEL` | not listed |
| `Z_MM_MIB_LABEL_PDF` | no `ENLFDIR` row: the module does not exist on this system | not listed |
| `BAPI_INB_DELIVERY_CONFIRM_DEC` (removed feature) | `V50I` | `V55K` |

**Authorization to review for withdrawal (Goods Receipt removed):**

- `S_RFC`: `ACTVT = 16`, `RFC_TYPE = FUGR`, `RFC_NAME = V50I` — or, if the role grants by module, `RFC_TYPE = FUNC`, `RFC_NAME = BAPI_INB_DELIVERY_CONFIRM_DEC`. SAP's check-indicator data (`USOBX_C`) lists only `S_RFC` for this module. No function module the remaining code calls is in `V50I`, so withdrawing it does not affect another feature of this application.
- `S_TABU_NAM` / `S_TABU_DIS`, `ACTVT = 03`: table `LIKP` was read only by the removed code. `LIPS` (outbound delivery), `MATDOC` (quarantine labels), `VEKP` and `VEPO` (handling units) are still read and must stay.
- OData start authorization (`S_SERVICE`) for `MMIM_GR4PO_DL_SRV` and `LO_BM_BATCH_SRV`: no remaining code calls these services. The exact `S_SERVICE` values (service hash) were **not read** and are Not verified.
- Business authorizations checked inside the delivery-confirm BAPI (delivery, goods movement, plant, storage location) are **Not verified**: they are not in `USOBX_C` for the module and were not traced. Review the technical user's role for goods-movement objects that no remaining function needs.

Which role the technical user actually has was not read. Nothing was changed in SAP.

### 2. `S_TABU_DIS` / `S_TABU_NAM` (Table Access for RFC_READ_TABLE)
- `ACTVT`: `03` (Display)
- Tables allowed:
  - System/Tenant: `T000`
  - Warehouse/Logistics: `LTAK`, `LTAP`, `MAKT`, `AFPO`, `VEKP`, `VEPO`
  - Sales/Customer: `KNVV`, `T001W`
  - User/Security: `USH02`, `USR02`

### 3. `S_ADMI_FCD` (System Administrative Functions)
- `SYSL`: Required for SM21 System Log reads (`RSLG_READ_SLG`)
- `AUDD`: Required for SM20 Security Audit Log reads (`RSAU_API_GET_LOG_DATA`)

---

## 6. Connection Lifecycle, Concurrency Limits & Timeouts

### Connection Lifecycle & SAP LUW Isolation
- **Single Calls (`call`)**: A connection is acquired, the function module is executed, and the connection is returned to the pool or closed.
- **Sessions / SAP LUW (`session`)**: SAP LUWs require that chained calls (such as `BAPI_HU_CREATE` followed by `BAPI_TRANSACTION_COMMIT`) execute on the **exact same ABAP work process and connection**. The session wrapper guarantees that the BAPI and its commit/rollback execute sequentially on the same connection.
- **Faulted State Isolation**: If any call inside a session throws an error, times out, or fails, the connection is marked **faulted** (`isFaulted = true`). Faulted connections are forcefully closed and never returned to the pool, guaranteeing that uncommitted SAP locks or dirty rollback state cannot pollute subsequent requests.

### Connection Pooling (`noderfc.Pool`)
- Controlled via `S4_RFC_POOL_ENABLED=true` (or `mta/extensions/prod/prod.mtaext`).
- When enabled, `RfcClient` initializes `noderfc.Pool` with `low` (default 2) and `high` (default `peak_limit` or `maxConcurrent`).
- Connection acquisition is guarded by `withTimeout` to prevent indefinite blocking under connection starvation.

### Concurrency Throttling & Wait Queue
- Controlled via `S4_RFC_MAX_CONCURRENT` (default 10).
- When active RFC sessions reach `maxConcurrent`, incoming callers enter an asynchronous FIFO wait queue (`_waitQueue`).
- As running sessions complete, the queue head is dispatched immediately.
- If queue wait exceeds `timeoutMs`, the request fails fast with status 503 (`RFC concurrency limit reached (...) and wait queue timed out`).

### RFC Call Timeout
- Controlled via `S4_RFC_TIMEOUT_MS` (default 30,000 ms, aligned with `S4HttpClient`).
- Protects both individual function module invocations and overall sessions against network hangs or frozen ABAP dialog work processes.

---

## 7. Verification & Operational Runbook

### Step 1: Automated Unit & Destination Regression Suites
Run in any development or CI environment (zero SAP connection required):
```sh
npx jest test/unit/rfcClientDestination.test.js --runInBand
npx jest test/unit/s4HttpClient.test.js --runInBand
npx jest test/unit/tools/verifyCfRfcRuntime.test.js --runInBand
npx jest test/unit/networkSafety.test.js --runInBand
```

### Step 2: Cloud Foundry RFC Runtime Dependency & Deployment Certification Check
Verify whether the running environment satisfies all native dynamic library, platform, and destination prerequisites:
```sh
npm run check:rfc-runtime
```
(See `docs/deployment/cf-native-rfc-runtime-proof.md` for the full deployment proof and multi-buildpack provisioning specification).

### Step 3: Post-Deployment Service Connectivity Check
Run post-deployment to verify security guardrails and destination configuration:
```sh
npm run check:connectivity
```

### Step 4: Read-Only Live RFC Preflight Probe
In an SAP-connected environment (with NW RFC SDK installed and authorized read-only target):
```sh
ALLOW_LIVE_SAP_TOOLS=1 node tools/rfc-preflight.js --allow-live-sap
```
**Preflight Diagnostic Classification Stages:**
- `sdk`: Native `node-rfc` or `libsapnwrfc.so` not loadable in runtime.
- `config`: Connection parameters missing from BTP destination or `.env.local`.
- `auth`: SAP logon rejected (invalid user/password or locked account).
- `network`: SAP host unreachable (`RFC_COMMUNICATION_FAILURE`, timeout, or port 33XX closed).
- `client`: Connected, but specified SAP client does not exist in `T000`.
- `ok`: Successful read-only read from `T000`.
