# Docker deployment

The Docker deployment reuses the CAP application and existing integration
clients without changing the BTP MTA, BTP approuter configuration, or BTP
service bindings. The `dev` profile is deliberately local-only; `qa` and `prod`
retain XSUAA and external HANA/HDI.

## Local development profile

The local profile uses the repository's `NODE_ENV=test` configuration: mocked
CAP auth, a local development login, and in-memory SQLite. Data is discarded on
restart. It does not mount BTP bindings or the RFC SDK, and its CAP container
does not join the SAP egress network. The router and CAP API are published only
through the loopback-bound local approuter; this profile must not be used for
shared or deployed environments.

Create a separate local login secret file. Do not pass the project `.env` into
the container because it may contain SAP credentials:

```sh
umask 077
printf 'LOCAL_AUTH_SECRET=%s\nLOCAL_DEV_PASSWORD=%s\n' \
  "$(openssl rand -hex 32)" \
  "$(openssl rand -hex 24)" > .env.docker.local
```

The generated password is the local login password for `khushal`; it is not an
SAP password. The JWT signing secret stays in that ignored host file and is
never baked into the image or printed by the startup code. Start the local app:

```sh
docker compose --env-file .env.example --profile dev up --build
```

Set `PLATFORM` and `ROUTER_PORT` in a separate non-secret Compose env file as
needed. Open `http://127.0.0.1:5000` and log in with username `khushal` and the
generated local password.

## QA and production profiles

### Opt-in SAP-connected local development

The default local profile cannot load real SAP dashboard data. To enable OData
and RFC reads, set `S4_DESTINATION_URL`, `S4_USERNAME`, `S4_PASSWORD`, `S4_CLIENT`,
and the verified `S4_RFC_SYSNR` in
the ignored `.env.docker.local`, and export `SAP_DEV_CA_FILE` with the absolute
path to your trusted SAP CA PEM file. Set `RFC_SDK_HOST_PATH` to your existing
Linux x86-64 SDK directory (including `include/` and `lib/`). Use `PLATFORM=linux/amd64`
for the packaged node-rfc 3.3.1 Linux prebuilt binary. macOS dylib libraries are not compatible.
Do not disable TLS verification.

Use the explicit override for all commands against this connected local stack:

```sh
docker compose --env-file .env.example -f compose.yaml -f compose.sap-dev.yaml --profile dev up --build -d --force-recreate cap-dev approuter-dev
```

Recreation reloads the environment file and clears the local in-memory database.
This override adds SAP egress and a read-only CA mount; local authentication,
loopback-only browser access, and the test database remain unchanged. The
existing server bootstrap replaces test service URLs with the configured SAP
destination. This is local development only, not QA/production deployment.
The SDK stays on the host and is mounted read-only, never copied into the image.
The override retains the lockfile-pinned node-rfc prebuilt during npm installation;
its SDK load test is deferred to the startup guard, which checks architecture,
module loading and required RFC settings. Other npm install scripts still run.
The offline profile remains SDK-free. Connecting to
SAP does not authorize any business write; live writes require a specific go.

### Deployed profiles

For QA or production, obtain protected `xsuaa.json`, `destination.json`, and
`hana.json` binding files as described in [`secrets/README.md`](../../secrets/README.md).
Do not put binding files in source control. Place the licensed RFC SDK at the
read-only mount path when RFC is required, and optionally install the approved
CA bundle as `certs/ca-bundle.pem`. Then start only the matching profile, for
example:

```sh
docker compose --env-file .env --profile qa up --build -d
# or --profile prod for the separately approved production target
```

The production approuter is published only on
`127.0.0.1:${ROUTER_PORT:-5000}`. Put the approved TLS-terminating reverse
proxy in front of it for remote access. CAP is not published on a host port.
The `application` network is internal; QA/production CAP also joins
`sap-egress` to reach external HANA and SAP endpoints. Docker networking does
not create a VPN or private route; host routing and egress controls must provide
those paths.

After the intended non-production SAP target, bindings, network, and RFC SDK
have been confirmed, the existing RFC preflight can be run with the runtime
binding loader. This is a **READ-ONLY** SAP T000 check and still requires the
repository's explicit live-tool gate and user authorization for the target:

```sh
docker compose exec -e ALLOW_LIVE_SAP_TOOLS=1 cap \
  node tools/docker/runtime.js node tools/rfc-preflight.js --allow-live-sap
```

## Architecture and RFC SDK

`PLATFORM` defaults to `linux/amd64` and is used as the Compose target and
Docker build argument. To select ARM64, set `PLATFORM=linux/arm64` in `.env`
before building. The container checks that Node and
`/usr/sap/nwrfcsdk/lib/libsapnwrfc.so` match the selected architecture and
attempts to load `node-rfc` before CAP starts. Missing SDK files, ELF
architecture mismatches, and native module load errors fail startup without
printing credentials.

The licensed SAP NW RFC SDK is deliberately not copied into either image. Mount
the host SDK read-only at `/usr/sap/nwrfcsdk`; `.env.example` provides
`RFC_SDK_HOST_PATH` for the source directory. Compose creates the host directory
if it is missing, so the container can start its preflight and report a clear
missing-library error rather than failing before container startup. Replace that
empty directory with the licensed SDK. Use an SDK supported for the selected
Linux architecture and verify that the host's network can reach SAP. The image
build does not prove SDK or SAP connectivity.

## Bindings and CA certificates

The entrypoint reads individual, read-only binding files from `/run/secrets`,
validates their service labels, and builds `VCAP_SERVICES` for the existing CAP,
Cloud SDK, and XSUAA consumers. CAP requires `xsuaa`, `destination`, and `hana`;
the approuter requires `xsuaa`. Missing or malformed files stop startup with a
service-specific message. File values are never logged.

Custom CA material is optional. Mount `certs/ca-bundle.pem` read-only under
`/run/certs`; the entrypoint sets `NODE_EXTRA_CA_CERTS` only when the file is
present. An explicitly configured `CUSTOM_CA_CERT_FILE` must exist.

## Container safety and limits of verification

Both images use exact Node base-image tags, run as the unprivileged `node` user,
drop Linux capabilities, use a read-only root filesystem with a small `/tmp`,
and define health checks. The production approuter's `localDir` route serves
the built Fiori application; its API routes require XSUAA and forward the token
to CAP. In contrast, the `dev` profile uses a separate router config with auth
disabled and must remain loopback-only. Its mock/test roles are for local
development, not an authorization or production-security validation. A
successful image build or health check does not verify XSUAA login, role
enforcement, HANA persistence, SAP TLS, or RFC connectivity.
