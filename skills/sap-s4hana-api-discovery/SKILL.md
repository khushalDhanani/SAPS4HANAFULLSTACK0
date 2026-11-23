---
name: sap-s4hana-api-discovery
description: >
  Discover and verify SAP S/4HANA OData or RFC capabilities before changing
  integrations, especially create, update, post, and delete flows. Use for
  srv/integration/s4hana/, SAP metadata, service catalogs, live SAP checks, and
  business API selection. CAP and UI5 MCP documentation does not define SAP contracts.
paths:
  - "srv/integration/s4hana/**"
  - "docs/*metadata*/**"
  - "tools/*sap*"
---

# SAP S/4HANA API Discovery

Prove the backend service contract before designing or changing application calls.
Follow the SAP API Discovery protocol in `AGENTS.md`; this skill is a focused checklist,
not an alternative to those rules.

## Workflow

1. **Trace the requested business operation.** Identify the CAP endpoint and adapter
   involved. Record the business object and whether the task is read-only or transactional.
2. **Identify the actual SAP API.** Use project metadata/discovery evidence and the target
   SAP system. Do not select an API from its name or from a similar read service.
3. **Inspect the contract.** For OData, inspect the exact service `$metadata`; verify the
   EntitySet, EntityType, navigation properties, operations, and relevant fields. For RFC,
   verify the callable function/module signature and behavior from authoritative system
   evidence. Record service URL and SAP client only in approved project documentation,
   never credentials or service keys.
4. **Verify authorization and connectivity.** Check the applicable destination, BTP
   Connectivity requirements, authentication, and XSUAA roles/scopes. Prefer a safe,
   read-only live request. Never bypass authorization, CSRF, certificate, or destination
   controls.
5. **Prove transactional capability before implementation.** Metadata or implementation
   evidence must show the operation is supported. For a create flow, follow `AGENTS.md`:
   make the minimal real SAP request, confirm SAP's generated identifier, and read the
   persisted object back from SAP before implementing the UI flow. For multi-step objects,
   verify each required persistence step and the complete read-back.
6. **Report evidence and gaps.** Separate confirmed facts from inference and unknowns.
   If the service contract or safe live proof is unavailable, stop the dependent
   implementation and state precisely what could not be verified.

## Boundaries

- Use cds-mcp and ui5-mcp only for their CAP and UI5 framework domains. They are not
  sources for SAP OData or RFC contracts.
- Do not invent service names, entity sets, navigation properties, payload fields, BAPIs,
  T-codes, or backend messages.
- Do not treat GET support, an active service, or local/mock persistence as proof of SAP
  create capability or persistence.
- Never expose SAP credentials or destination details to browser code.
