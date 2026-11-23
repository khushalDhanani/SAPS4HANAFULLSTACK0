# Local RFC connect failure diagnosis — 2026-10-26

No SAP call was made for this diagnosis. The saved prior read-only AUFK attempt record is `261-order-1002318-readonly-attempt.raw.json`.

The captured CPIC error is at the transport connection stage: system call `connect`, errno 1, `Operation not permitted`. There is no SAP response, logon failure, RFC authorization denial, or destination lookup error in that result.

Repository trace:

- `srv/integration/s4hana/RfcClient.js:10–16` defines configured RFC input names and property mapping.
- `RfcClient.resolveConnectionParams()` at lines 36–68 resolves local inputs or a named BTP destination; it does not contain an application “live SAP” opt-in gate for a direct client call.
- `RfcClient.readTable()` at lines 132–150 invokes only `RFC_READ_TABLE` and converts `DATA[].WA` delimiter text to strings. The saved DD03L metadata records `DBTABLOG-LOGDATA` as `LRAW`; the prior LOGDATA read was rejected by SAP's RFC_READ_TABLE parser. No alternate SAP log reader is configured in this repository.
- The local `node-rfc` call proceeds after parameter resolution; the CPIC socket denial therefore occurs below the application's destination/configuration resolution, before SAP can evaluate credentials or authorization.
- `test/liveSapGate.js` gates Jest live-SAP suites only. The earlier direct read-only AUFK probe did not import it. `tools/reconcile-open-261.js` uses a separate tool gate, but that gate is not the source of this captured CPIC connect error.

Conclusion: the evidenced blocker is the execution environment's network/socket permission for the RFC connection, not a proven bad SAP destination or SAP credential. The LOGDATA attempt has a separate limitation: DBTABLOG-LOGDATA is LRAW, the configured RFC_READ_TABLE path rejected it, and no supported alternate reader is configured/available. No bypass was attempted. The exact lower-level policy that enforces the socket denial is not exposed in repository evidence and remains **Not verified**.
