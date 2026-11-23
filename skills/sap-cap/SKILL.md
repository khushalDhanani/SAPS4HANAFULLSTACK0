---
name: sap-cap
description: >
  Query the CAP MCP server (cds-mcp) before writing or changing CDS entities, types,
  aspects, services, or CAP Node.js service handlers. Use when touching db/*.cds,
  srv/*.cds, srv/*.js, cds CLI commands, or CAP runtime APIs (cds.ql, cds.Service,
  req.reject, cds.test). Not for S/4 OData payloads — see AGENTS.md discovery protocol.
paths:
  - "db/**/*.cds"
  - "srv/**/*.cds"
  - "srv/**/*.js"
---

# CAP MCP-First Development

Before writing, modifying, debugging, or fixing CDS entities, service definitions,
or CAP service handlers, you MUST query the CAP MCP server and apply its guidance.

## Tools

Use `mcp__cds-mcp__*` tools — `mcp__cds-mcp__search_docs` and `mcp__cds-mcp__search_model`.
The server is registered in `.mcp.json`.

## Workflow

1. **Query before coding** — call `mcp__cds-mcp__search_model` for existing definitions and
   `mcp__cds-mcp__search_docs` for syntax, patterns, or conventions. Only if the server fails
   MAY you read `*.cds` files directly.
2. **Trust MCP over training knowledge** — if guidance conflicts with what you know, follow MCP.
3. **Prefer the simplest pattern** when MCP returns multiple valid approaches.
4. **Validate** with the project commands: `npx cds compile srv/`, `npm run lint`,
   `npm run test:unit` (targeted Jest files first), then log the result in `WORKSTATUS.md`.

## Scope

This skill covers:
- CDS entity definitions, types, aspects (`db/`)
- Service definitions and projections (`srv/*.cds`)
- Service handlers, actions, functions, events (`srv/*.js`)
- CDS built-in types, key patterns, virtual fields, declarative `@assert` constraints

This skill does **not** cover:
- S/4HANA OData/RFC technical calls (`srv/integration/s4hana/`) — governed by the
  "SAP API Discovery" protocol in `AGENTS.md`; never derive S/4 payloads from CAP docs.
- SAPUI5 views/controllers — see the `sap-ui5` skill.
