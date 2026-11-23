---
name: sap-s4hana-integration
description: >
  Implement or review verified SAP S/4HANA integration adapters, clients, and service
  mappings in srv/integration/s4hana/. Use after the actual SAP contract is established;
  for discovering that contract, use sap-s4hana-api-discovery and AGENTS.md.
paths:
  - "srv/integration/s4hana/**/*.js"
  - "srv/integration/s4hana/**/*.json"
  - "config/connectivity/**"
  - "config/destinations/**"
---

# SAP S/4HANA Integration Patterns

Keep SAP technical communication inside `srv/integration/s4hana/` and map between the
CAP domain contract and the verified SAP contract. Follow architecture and security rules
in `AGENTS.md`.

## Workflow

1. **Require verified inputs.** Before implementation, locate evidence for the SAP
   service/API contract, CAP contract, destination and auth model, and operation semantics.
   If any required detail is unknown, return to `sap-s4hana-api-discovery`; do not fill the
   gap with a guessed payload or endpoint.
2. **Trace existing patterns.** Find the current service, adapter, and callers. Preserve
   working read flows and reuse the established client and dependency-injection patterns.
   Do not create a second S/4 client stack.
3. **Map at the adapter boundary.** Translate explicit CAP fields and types to the verified
   SAP request and response. Keep UI concerns and publication/business workflow rules out
   of the technical adapter. Keep S/4 calls out of UI controllers and direct persistence
   out of the UI.
4. **Handle failures by layer.** Preserve useful SAP status and message context without
   leaking secrets. Distinguish path/metadata mismatch, unsupported operations,
   authorization/CSRF failures, and backend/business errors. Follow existing project
   error conventions; do not turn an unknown failure into a success response.
5. **Treat writes safely.** Understand commit and read-back behavior. Retry only when the
   operation's idempotency is established; do not blindly retry a create or post. Never
   report success until the required SAP persistence and read-back checks succeed.
6. **Validate the boundary.** Use controlled fixtures for automated tests. Run an approved
   safe live check when required and available; report unavailable credentials or SAP
   services as blockers rather than claiming validation.

## Security and configuration

- Use BTP Destination, Connectivity, and XSUAA bindings for deployed environments; use
  local environment variables only for local development.
- Keep secrets out of code, logs, test fixtures, and documentation.
- Preserve certificate validation, authorization, CSRF protection, and destination
  routing.
- Keep environment-specific deployment values in the appropriate MTA extension.
