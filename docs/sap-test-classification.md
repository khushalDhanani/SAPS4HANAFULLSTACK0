# SAP-dependent test classification

Which test layers may touch SAP, how each is gated, and what to run first. Source of the Jest rule: `test/liveSapGate.js`.

| Class | Command | SAP access | Gate |
| --- | --- | --- | --- |
| Jest unit / integration / performance / a11y / smoke | `npm test`, `npm run test:unit`, `npm run test:integration` | **Never.** `test/setupEnv.js` scrubs `S4_*`, `SAP_*`, `RFC_*` and `VCAP_SERVICES`; `jest.config.js` maps `node-rfc` to `test/mocks/node-rfc.js`; `test/outboundNetworkGuard.js` blocks non-loopback sockets. | `shouldRunLiveSapTests()` returns `false` under Jest, so the `describe` blocks marked live always skip. |
| Browser E2E, SAP-free (PR gate) | `npm run test:e2e:sap-free` | **Never.** Own `NODE_ENV=test` server with SAP variables stripped; `assertSapUnreachable()` runs before any suite; only `sapFree` suites run. | CI `browser-e2e-sap-free` job on every push/PR. |
| Browser E2E (Tier A/B) | `npm run test:e2e` | CAP server reads only; every write is aborted by `test/e2e/support/writeGuard.js` or answered by a mock. | Needs a running server. |
| Tier C round trip, dry-run | `npm run test:e2e:sap` | CAP server reads; the one write action is stubbed. | Default mode. |
| Tier C round trip, live | `ALLOW_LIVE_SAP_TOOLS=1 E2E_SAP_WRITE_FLOWS=<flow> E2E_SAP_LIVE_TARGET=<label> npm run test:e2e:sap -- --allow-live-sap` | One real SAP write per flow. | `test/e2e/support/liveWriteGate.js` + **RFC preflight** (below) + the user's written go per run (AGENTS.md). |
| Live tools | `ALLOW_LIVE_SAP_TOOLS=1 node tools/<tool>.js --allow-live-sap` | Read-only unless the tool says otherwise. | `tools/live-sap-gate.js`; the CI sandbox stage adds `RUN_LIVE_SAP=1` and a non-prod `SAP_SYSTEM_TYPE`. |

## RFC preflight

`npm run preflight:rfc -- --allow-live-sap` (with `ALLOW_LIVE_SAP_TOOLS=1`) runs one READ-ONLY `RFC_READ_TABLE T000` and reports the first broken layer:

| Stage | Meaning | Fix |
| --- | --- | --- |
| `sdk` | `node-rfc` or the SAP NW RFC SDK is not loadable | install the SDK, `npm install node-rfc` |
| `config` | `.env.local` keys or the BTP RFC destination are missing | see `.env.example` |
| `auth` | SAP rejected the logon | correct `S4_USERNAME` / `S4_PASSWORD`, check the user lock |
| `network` | host not reachable | VPN / `S4_DESTINATION_URL` / `S4_RFC_SYSNR` |
| `client` | connected, but `S4_CLIENT` is not in T000 | correct `S4_CLIENT` |

The same check runs inside `npm run check:connectivity` (live mode), `npm run validate:sap:sandbox`, and automatically before any live Tier C flow in `npm run test:e2e:sap`, which then runs no flow at all when the preflight fails. The Tier C preflight checks this machine's `.env.local`; the CAP server under test must use the same configuration.
