# Cloud Foundry Native RFC Runtime Dependency & Deployment Proof

## 1. Executive Summary & Purpose (Finding MTA-01)

This document establishes the architecture, deployment proof, and operational certification criteria for **Finding MTA-01: Native RFC runtime dependency needs deployment proof (P1)**.

### The Architecture Problem
Several administrative, warehouse, and logistics capabilities in this platform interface with SAP S/4HANA via RFC function modules (such as `RFC_READ_TABLE`, `TH_SERVER_LIST`, `RSLG_READ_SLG`, `RSAU_API_GET_LOG_DATA`, and BAPIs for user and handling unit management).
The underlying client uses `node-rfc`, an asynchronous Node-API (N-API) C++ addon that requires the proprietary **SAP NetWeaver RFC SDK 7.50** (`libsapnwrfc.so` and accompanying shared libraries on Linux x86_64).

In SAP BTP Cloud Foundry, the standard `nodejs_buildpack` on stack `cflinuxfs4` (Ubuntu 22.04 LTS) does **not** include the proprietary SAP NW RFC SDK.
`package.json` places `"node-rfc": "^3.3.1"` in `optionalDependencies`, which allows standard CI runners and development environments without the SDK to install dependencies without failing `npm ci`.
However, a standard Cloud Foundry buildpack deployment (`cf push` or MTA deployment via `cf deploy`) without native library provisioning means:
1. `node-rfc` fails to load during runtime.
2. Any RFC-dependent application functionality throws errors or crashes unless properly gated.
3. Successful MTA build (`mbt build`) does not prove that the Cloud Foundry container can load the dynamic libraries or connect to SAP.

This guide provides the complete runtime provisioning specification, configuration, verification tooling, and deployment certification gate.

---

## 2. Cloud Foundry NW RFC SDK Provisioning Patterns

Because the SAP NW RFC SDK 7.50 is proprietary SAP software requiring an active SAP customer license and S-User credentials to download from the SAP Support Portal, the SDK archives cannot be placed into public repositories, Git, or public buildpacks.

Two approved deployment patterns are supported:

### Pattern A: Multi-Buildpack Pipeline with Private Supply Buildpack (Recommended for CF Droplets)

Cloud Foundry supports chaining buildpacks using the **Multi-Buildpack** specification. A private supply buildpack runs first to unpack the native libraries into the droplet dependency directory, followed by the standard `nodejs_buildpack`.

#### 1. MTA Module Configuration (`mta.yaml` & `mta/extensions/prod/prod.mtaext`)
In `mta.yaml` and `mta/extensions/prod/prod.mtaext`:
```yaml
modules:
  - name: saps4hana-srv
    type: nodejs
    path: gen/srv
    parameters:
      memory: 1024M
      instances: 2
      # Multi-buildpack pipeline: Supply buildpack unpacks SDK into $DEPS_DIR/0/nwrfcsdk
      buildpacks:
        - ((sap-nwrfc-supply-buildpack-url))  # Hosted on enterprise authenticated artifact store
        - nodejs_buildpack
      readiness-health-check-type: http
      readiness-health-check-http-endpoint: /health/ready
    properties:
      SAPNWRFC_HOME: /home/vcap/deps/0/nwrfcsdk
      LD_LIBRARY_PATH: /home/vcap/deps/0/nwrfcsdk/lib:/usr/sap/nwrfcsdk/lib:/home/vcap/app/lib:$LD_LIBRARY_PATH
      S4_RFC_DESTINATION_NAME: S4HANA_RFC
      S4_RFC_TIMEOUT_MS: 30000
      S4_RFC_MAX_CONCURRENT: 10
      S4_RFC_POOL_ENABLED: "true"
```

#### 2. Enterprise Supply Buildpack Architecture
The private supply buildpack (`sap-nwrfc-supply-buildpack`) performs the following contract during droplet staging:
1. **Fetch Archive**: Downloads `nwrfc750P_XX-linuxx86_64.zip` from an internal corporate artifact manager (e.g. Artifactory, Nexus, or a private BTP Object Store instance) using corporate build credentials.
2. **Unpack to Dependency Directory**: Unzips the SDK into `$DEPS_DIR/<idx>/nwrfcsdk` (standard location `/home/vcap/deps/0/nwrfcsdk`).
   - Headers: `$DEPS_DIR/<idx>/nwrfcsdk/include/`
   - Shared libraries: `$DEPS_DIR/<idx>/nwrfcsdk/lib/`
3. **Generate Staging & Runtime Environment Scripts**:
   - Creates `$DEPS_DIR/<idx>/profile.d/000_nwrfcsdk.sh`:
     ```bash
     #!/bin/sh
     export SAPNWRFC_HOME="$DEPS_DIR/0/nwrfcsdk"
     export LD_LIBRARY_PATH="$DEPS_DIR/0/nwrfcsdk/lib:/home/vcap/app/lib:$LD_LIBRARY_PATH"
     ```
   - Sets `$SAPNWRFC_HOME` in the staging environment so subsequent buildpacks (`nodejs_buildpack`) can compile or validate native C++ addons during `npm ci`.

---

### Pattern B: Container Deployment (Cloud Foundry Docker / Kyma Runtime)

When deploying via container runtime rather than standard buildpack droplets:
- Specification: `docker/cap/Dockerfile`
- Pre-stage runtime configuration:
  ```dockerfile
  ENV RFC_SDK_PATH=/usr/sap/nwrfcsdk \
      LD_LIBRARY_PATH=/usr/sap/nwrfcsdk/lib
  ```
- The proprietary SDK is mounted read-only at `/usr/sap/nwrfcsdk` from an enterprise container image layer or persistent volume.
- Startup verification hook: `tools/docker/runtime.js` verifies ELF Machine 62 (x86-64) before launching the application.

---

## 3. Dynamic Library Paths & Linker Resolution

On Linux systems, the dynamic linker (`ld-linux-x86-64.so.2`) resolves shared libraries in this sequence:
1. `DT_RPATH` / `DT_RUNPATH` embedded within the ELF binary.
2. `LD_LIBRARY_PATH` environment variable.
3. System cache (`/etc/ld.so.cache`) and trusted directories (`/lib`, `/usr/lib`).

### Required Shared Object Files
The SAP NW RFC SDK 7.50 dynamic linker dependencies comprise:
- `libsapnwrfc.so` (Core RFC client library)
- `libsapucum.so` (Unicode conversion library)
- `libicudata.so.57` (ICU data library)
- `libicui18n.so.57` (ICU internationalization)
- `libicuuc.so.57` (ICU common)

### Path Hierarchy in Cloud Foundry
To ensure libraries resolve regardless of execution environment (droplet vs container vs local):
```
LD_LIBRARY_PATH=/home/vcap/deps/0/nwrfcsdk/lib:/usr/sap/nwrfcsdk/lib:/home/vcap/app/lib:$LD_LIBRARY_PATH
```
- `/home/vcap/deps/0/nwrfcsdk/lib`: Standard multi-buildpack droplet supply path.
- `/usr/sap/nwrfcsdk/lib`: Standard container mount path.
- `/home/vcap/app/lib`: Droplet application root fallback.

---

## 4. Node.js & ABI Compatibility Baseline

| Component | Target Version | Compatibility Evidence |
| :--- | :--- | :--- |
| **Node.js Runtime** | Node 22 (LTS) / `>=22.0.0` | Project `package.json` specifies `"node": ">=22.0.0"`. Verified on Node 22. |
| **Node-API (N-API)** | N-API Version 8+ | `node-rfc` 3.3.x uses Node-API. Node-API provides binary ABI stability across major Node versions without recompilation. |
| **Operating System** | Cloud Foundry `cflinuxfs4` | Based on Ubuntu 22.04 LTS (Jammy Jellyfish). |
| **C Library (glibc)**| GNU C Library 2.35 | SAP NW RFC SDK 7.50 requires glibc 2.14+. glibc 2.35 on `cflinuxfs4` fully satisfies all symbol requirements. |
| **Architecture** | `linux/amd64` (ELF Machine 62) | Verified: ELF Machine 62 (Little-Endian 64-bit AMD/Intel x86-64). |

---

## 5. Native Module Loading & Linker Verification

### Loading Sequence
1. Application requires `srv/integration/s4hana/RfcClient.js`.
2. When an RFC operation or availability check occurs, `RfcClient.isAvailable()` or `RfcClient.session()` executes `loader()`.
3. `node-rfc` uses `node-gyp-build` to locate the prebuilt binary matching the platform:
   `node_modules/node-rfc/prebuilds/linux-x64/node.napi.node`.
4. The OS kernel dynamic loader invokes `dlopen()` on `node.napi.node`.
5. `dlopen()` inspects `node.napi.node`'s `DT_NEEDED` entries:
   ```sh
   $ readelf -d node.napi.node | grep NEEDED
    0x0000000000000001 (NEEDED)             Shared library: [libsapnwrfc.so]
    0x0000000000000001 (NEEDED)             Shared library: [libsapucum.so]
    0x0000000000000001 (NEEDED)             Shared library: [libstdc++.so.6]
    0x0000000000000001 (NEEDED)             Shared library: [libm.so.6]
    0x0000000000000001 (NEEDED)             Shared library: [libgcc_s.so.1]
    0x0000000000000001 (NEEDED)             Shared library: [libc.so.6]
   ```
6. If `libsapnwrfc.so` is located in `LD_LIBRARY_PATH`, loading succeeds and returns the native module.
7. If any library is missing, `dlopen()` fails with:
   `libnwrfcsdk.so: cannot open shared object file: No such file or directory`.
8. `RfcClient` catches this exception cleanly, returning `false` for `isAvailable()` and throwing a structured HTTP 503 error for operations, preventing process crash.

---

## 6. Restart Behavior & Droplet Lifecycle

### Staging vs Container Execution
1. **Droplet Persistence**: In Cloud Foundry droplet architecture, all files placed into `$DEPS_DIR` during staging are captured in the final droplet archive (`droplet.tgz`). When a container instance stops, crashes, or is restarted (`cf restart` or rolling blue-green deployment), the droplet is unpacked intact into the fresh container instance.
2. **Environment Variable Injection**: Environment variables specified in MTA `properties` and `.profile.d/000_nwrfcsdk.sh` are executed by the container shell on every instance startup.

### Multi-Instance Isolation (High Availability)
- In `mta/extensions/prod/prod.mtaext`, `saps4hana-srv` runs with `instances: 2`.
- Each Cloud Foundry instance is a distinct OS container with its own process memory and network loopback.
- **Connection Pools**: Connection pooling (`noderfc.Pool`) is strictly instance-local. Instance 1 and Instance 2 each maintain their own independent pools (`low: 2`, `high: 10`).
- **Concurrency Queuing**: The FIFO concurrency queue (`_withConcurrency`) is process-local. If Instance 1 is at capacity (10 concurrent requests), incoming requests routed by Cloud Foundry GoRouter to Instance 2 use Instance 2's available capacity.
- **Graceful Shutdown**: On container shutdown (`SIGTERM`), Cloud Foundry provides a 10-second termination window. `RfcClient.close()` closes all pooled connections cleanly, releasing dialog work processes on SAP S/4HANA.

---

## 7. BTP RFC Destination Binding

In production environments (`NODE_ENV=production`), RFC credentials in environment variables or `.env` files are **strictly forbidden** (failing closed immediately). All RFC parameters must originate from the BTP Destination service:

### Cloud Foundry Service Binding
- Module `saps4hana-srv` requires resource `saps4hana-destination` (service `destination`, plan `lite`).
- Bound credentials are provided via `VCAP_SERVICES.destination[0].credentials`.

### Destination Property Resolution (`RfcClient.resolveConnectionParams()`)
`RfcClient` queries `@sap-cloud-sdk/connectivity` for destination `S4_RFC_DESTINATION_NAME` (default `S4HANA_RFC`) and validates:
1. **Application Server (Direct)**: Requires `ashost` (or `jco.client.ashost`) and `sysnr` (`jco.client.sysnr`).
2. **Message Server (Load Balanced)**: Requires `mshost` (`jco.client.mshost`), `r3name` (`jco.client.r3name`), and `group` (`jco.client.group`).
3. **Logon Credentials**: Requires `client` (`jco.client.client`), `user` (`jco.client.user`), and `passwd` (`jco.client.passwd`).
4. **Caching**: Resolved connection parameters are cached in-memory with a 5-minute TTL (`DESTINATION_PARAMS_TTL_MS = 300,000 ms`). Passwords are never logged or exposed.

---

## 8. Deployment Certification Gate & Degradation Matrix

### The 3-Point Certification Gate
The deployed Cloud Foundry application is certified for RFC-dependent business operations **ONLY IF** all three criteria are satisfied:

```
┌─────────────────────────────────────────────────────────────────┐
│                   RFC DEPLOYMENT CERTIFICATION                  │
├─────────────────────────────────────────────────────────────────┤
│ 1. Native SDK Dynamic Libraries Loaded (libsapnwrfc.so)         │
│    -> RfcClient.isAvailable() === true                         │
│    -> /health/dependencies reports rfcSdk: "UP"                │
│                                                                 │
│ 2. BTP Destination Binding Verified                             │
│    -> S4_RFC_DESTINATION_NAME resolves in Destination service   │
│    -> Complete RFC properties present (ashost/mshost, sysnr, ...)│
│                                                                 │
│ 3. SAP Backend Preflight Read Validated                         │
│    -> tools/rfc-preflight.js returns PASS [ok]                  │
│    -> Read-only T000 check succeeds on expected S4_CLIENT       │
└─────────────────────────────────────────────────────────────────┘
```

### Operational Status & Degradation Matrix

| Condition | `/health/ready` | `/health/dependencies` | RFC Functions | Core HTTP/OData Services | Certified for Production RFC? |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **All Gates Passed** | 200 `UP` | 200 `UP` | Operational | Operational | **YES (CERTIFIED)** |
| **SDK Missing / Unloadable** | 200 `UP` | 200 `DEGRADED` (`rfcSdk: DOWN`) | Fails closed: 503 `UNAVAILABLE` | Operational | **NO (NOT CERTIFIED)** |
| **Destination Missing / Invalid** | 200 `UP` | 200 `DEGRADED` | Fails closed: 503 `UNAVAILABLE` | Operational | **NO (NOT CERTIFIED)** |
| **SAP Host Unreachable** | 200 `UP` | 200 `DEGRADED` | Fails fast: 503 `NETWORK_TIMEOUT` | Operational | **NO (BLOCKED)** |
| **HANA DB Unavailable** | 503 `DOWN` | 200 `DEGRADED` (`database: DOWN`) | Blocked | Blocked | **NO** |

> **Key Architectural Guarantee**:
> When the native RFC SDK is absent in Cloud Foundry, `/health/ready` remains `UP` (since database readiness governs application liveness). The application does **NOT** crash or flap in GoRouter; it serves all non-RFC HTTP and OData V2/V4 services normally, while RFC-dependent operations fail closed with HTTP 503.

---

## 9. Verification & Operational Tooling Runbook

### Tool 1: Cloud Foundry Runtime Diagnostic Tool (`tools/verify-cf-rfc-runtime.js`)
An automated, read-only diagnostic tool executable directly inside a deployed Cloud Foundry container (`cf ssh`) or during CI:
```sh
npm run check:rfc-runtime
```
Checks:
- Platform & CPU architecture
- Environment variables (`LD_LIBRARY_PATH`, `SAPNWRFC_HOME`, `S4_RFC_DESTINATION_NAME`)
- File existence of `libsapnwrfc.so` in library search paths
- `node-rfc` load test via `RfcClient.isAvailable()`
- BTP Destination binding presence in `VCAP_SERVICES`
- Emits explicit certification decision: `RFC_RUNTIME_CERTIFIED` or `RFC_RUNTIME_NOT_CERTIFIED [reason]`

### Tool 2: BTP Service Connectivity Check
```sh
npm run check:connectivity
```
Validates security guardrails, destination configurations, and production flags.

### Tool 3: Read-Only SAP Preflight Probe
In an SAP-connected environment:
```sh
ALLOW_LIVE_SAP_TOOLS=1 node tools/rfc-preflight.js --allow-live-sap
```
Performs a single read-only `RFC_READ_TABLE` on `T000`, diagnosing exact failure stage (`sdk`, `config`, `auth`, `network`, `client`, or `ok`).

### Tool 4: Automated Regression Suites
Zero SAP connection required (runs in standard sandbox mode):
```sh
npx jest test/unit/rfcClientDestination.test.js --runInBand
npx jest test/unit/s4HttpClient.test.js --runInBand
npx jest test/unit/tools/verifyCfRfcRuntime.test.js --runInBand
```
