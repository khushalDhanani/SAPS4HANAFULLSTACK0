---
name: sap-ui5
description: >
  Query the UI5 MCP server (ui5-mcp) before writing or changing SAPUI5 XML views,
  fragments, controllers, formatters, or model bindings in the freestyle Fiori app under
  app/fiori-app. Use when touching webapp/view, webapp/fragment, webapp/controller,
  webapp/modules/**, manifest.json routing, or when ui5lint reports deprecated APIs.
paths:
  - "app/fiori-app/webapp/**/*.xml"
  - "app/fiori-app/webapp/controller/**/*.js"
  - "app/fiori-app/webapp/modules/**/*.js"
  - "app/fiori-app/webapp/manifest.json"
---

# UI5 MCP-First Development

Before writing, modifying, debugging, or fixing SAPUI5 controllers, XML views,
or control bindings, you MUST query the UI5 MCP server and apply its guidance.

## Tools

Use `mcp__ui5-mcp__*` tools — primarily `mcp__ui5-mcp__get_api_reference`,
`mcp__ui5-mcp__get_guidelines`, `mcp__ui5-mcp__run_ui5_linter`, and `mcp__ui5-mcp__get_project_info`.
The server is registered in `.mcp.json`.

## Workflow

1. **Query before coding** — call `mcp__ui5-mcp__get_api_reference` for control APIs, or
   `mcp__ui5-mcp__get_guidelines` for project-level patterns. Target `minUI5Version` from `manifest.json`.
2. **Trust MCP over training knowledge** — if guidance conflicts with what you know, follow MCP.
3. **Lint after changes** — run `npm --prefix app/fiori-app run lint` (ui5lint) and fix every finding.
4. **Prefer the simplest pattern** when MCP returns multiple valid approaches.

## Scope

This skill covers:
- XML views and fragments with `sap.m`, `sap.f`, `sap.uxap` namespaces
- Freestyle controllers (`webapp/controller/`, `webapp/modules/<module>/`)
- Model bindings, formatters, event handlers, routing targets in `manifest.json`

This skill does **not** cover CAP services or S/4 calls: the UI talks only to the CAP
OData endpoints (see `AGENTS.md` architecture boundaries).

## UI5 Code Standards

- XML views only — no JavaScript views
- `sap.ui.define` for all modules — no globals
- Async loading: `data-sap-ui-async="true"`
- i18n for all user-facing text
- No deprecated APIs (`jQuery.sap.*`, sync loading, `sap.ui.getCore()`)
- No credentials, S/4 URLs, or business workflow logic in controllers
