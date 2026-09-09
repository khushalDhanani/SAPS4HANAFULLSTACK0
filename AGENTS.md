# SAP S/4HANA Full-Stack Engineering Instructions

These instructions apply to every agent and every change in this repository.

## Non-negotiable workflow

Follow this sequence for every task:

```text
Inspect → Plan → Change → Test → Validate → Review → Report
```

No implementation change is complete until its applicable tests and validation commands pass. Do not skip a step because a change appears small.

## WORKSTATUS.md is mandatory

`WORKSTATUS.md` is this project's single source of truth for work history, current status, validation, unresolved issues, and next steps.

Before making a change, every agent must:

1. Read `AGENTS.md`.
2. Read `WORKSTATUS.md`.
3. Understand the current status and unresolved issues.
4. Plan the change before editing any file.

After every change, update `WORKSTATUS.md` in the same work session. Record the change, affected files, reason, executed commands/tests and results, errors/warnings/blockers, and the exact next recommended action. Keep **Current Status** and **Next Steps** current.

- **Every individual change requires its own log entry.** If multiple agents make six changes in total, `WORKSTATUS.md` must contain all six changes. Grouping, replacing, or omitting changes is prohibited.
- Apply this order to every change: **Every change → Log it → Test it → Record the result.** A change is incomplete until its entry contains the verified validation result.
- Append to **Changes Log**; never overwrite historical entries or remove an issue without recording its resolution.
- Use a timestamp for every work-session/change entry.
- Never hide a failed test, error, warning, blocker, or skipped validation.
- Mark incomplete work as **In Progress** or **Blocked**.
- The final response must match `WORKSTATUS.md` exactly. Before reporting completion, follow:

  ```text
  Inspect → Plan → Change → Test → Validate → Review → Update WORKSTATUS.md → Report
  ```

- `WORKSTATUS.md` must never claim a test, build, deployment, or validation passed unless the agent actually ran and verified it.

### 1. Inspect

Before modifying anything:

- Read the request completely and inspect all relevant files, configuration, tests, documentation, and call sites.
- Check `git status` and preserve unrelated user changes. Never overwrite, revert, or reformat unrelated work.
- Trace the affected flow end to end: Fiori/UI5 → CAP service → domain/persistence → Publish capability → S/4HANA integration → BTP services.
- Verify what is already implemented. Reuse established project patterns and installed dependencies where they fit.
- Do not guess about APIs, package versions, configuration, service contracts, authentication, or runtime behavior. Obtain evidence from source, metadata, documentation, commands, or controlled tests.

### 2. Plan

- State the intended behavior, affected boundaries, files, dependencies, risks, and validation approach before changing code.
- Make the smallest coherent change that satisfies the request. Do not add speculative abstractions, files, dependencies, frameworks, services, or architecture.
- Confirm dependency and configuration compatibility with the installed versions and current runtime architecture before adding or upgrading a package.
- For a bug, reproduce it and identify the root cause before proposing a fix. Fix the source of the problem, not a symptom or a single caller.
- Do not modify a working configuration blindly. Compare it with the current project state and validate every assumption.

### 3. Preserve architecture boundaries

Keep responsibilities separated according to this repository structure:

| Area | Responsibility | Must not contain |
| --- | --- | --- |
| `app/fiori-app/` | SAPUI5/Fiori presentation, view models, presentation logic | Credentials, persistence, direct database access, S/4 technical calls, business workflows |
| `db/` | CAP CDS persistence model and controlled seed data | UI logic, HTTP calls, environment-specific configuration |
| `srv/` | CAP APIs, authorization, validation, orchestration | UI implementation or duplicate integration clients |
| `srv/integration/s4hana/` | S/4 clients, API services, adapters, technical mappings | UI behavior or Publish business rules |
| `publish/` | Publication domain logic, workflow, status, retries, jobs | A second S/4 integration stack |
| `config/` | Version-safe service configuration templates | Secrets or production-only values |
| `mta/` and `mta.yaml` | Deployment topology and environment extensions | Credentials or duplicate modules/resources |

- UI5 communicates only through defined HTTP/OData APIs.
- CAP business logic must not be duplicated in UI controllers, publish handlers, or integration adapters.
- S/4 technical communication belongs exclusively in `srv/integration/s4hana/`.
- Use adapters to translate between CAP domain models and S/4 OData payloads.
- Keep modules independently testable through explicit interfaces and dependency injection where appropriate.

## Security and environment rules

- Never hardcode or commit usernames, passwords, client secrets, OAuth tokens, API keys, certificates, private keys, URLs, SAP clients, or environment-specific values.
- Treat `.env`, `.env.*`, credential files, service keys, and local configuration as secrets. Do not display their values in logs, test output, error reports, commits, or documentation.
- Use local environment variables only for local development. Use BTP Destination, Connectivity, and XSUAA service bindings for deployed environments.
- Place environment-specific deployment configuration under `mta/extensions/dev/`, `mta/extensions/test/`, or `mta/extensions/prod/`; production secrets must remain outside Git.
- Do not bypass certificate validation, authorization checks, CSRF protection, or destination/connectivity mechanisms merely to make a request work.

## SAP S/4HANA integration discipline

Before changing S/4 integration code or its configuration, verify and document:

1. The actual required business OData service—not just `/sap/opu/odata` or the Gateway catalog.
2. Its technical service name, active service URL, `$metadata` URL, SAP client, required entity sets, operations, and request/response contract.
3. Authentication and authorization behavior using a safe read-only request where possible.
4. Destination name and properties, Connectivity requirements, and XSUAA scopes/roles for the target environment.
5. The relevant CAP service contract, adapter mapping, timeout/error behavior, and retry/idempotency requirements.

Do not implement integration code from assumed entity names or payloads. Do not expose destination credentials to the browser. Do not introduce a second S/4 client outside `srv/integration/s4hana/`.

## SAP API Discovery — Non-Negotiable Protocol

Before implementing or modifying ANY SAP create/update/post transaction, the agent MUST first discover and prove the real SAP backend capability.

### Required Workflow

```text
Inspect SAP → Verify Metadata → Verify Operation → Test Live SAP → Implement → Validate
```

1. **NEVER assume from service names**
   Do NOT assume that a service such as `*_FS_SRV`, `*_WL_SRV`, Object Page service, List Report service, or Catalog service supports CREATE/POST simply because it supports READ/GET. A read service is NOT automatically a transactional/create API.

2. **Inspect the actual SAP service**
   Before writing frontend/backend application code:
   - Identify the exact OData service.
   - Inspect its `$metadata`.
   - Identify the actual EntitySet, EntityType, and NavigationProperty.
   - Determine whether CREATE/UPDATE/DELETE is actually supported.
   - Do not invent entity names or navigation properties.
   - Do not copy a GET `$expand` structure and assume it is valid for POST/deep insert.

3. **Search for the real SAP business API**
   If the requested operation is not supported by the initially discovered service:
   - Search the actual SAP system for an appropriate API/service.
   - Check the relevant SAP business object/API, `/IWFND/MAINT_SERVICE`, and service implementation.
   - Check SAP Gateway metadata and backend implementation.
   - Check whether the API is read-only or transactional.
   - Do NOT randomly enable services until the correct API is identified.

4. **Prove CREATE directly against SAP**
   Before implementing the UI Create flow, perform a minimal real SAP POST:
   ```text
   POST Header → Verify HTTP success → Verify SAP-generated document number → Read document back from SAP
   ```
   A successful HTTP response alone is not sufficient. The document MUST actually exist in SAP.

5. **Multi-step SAP transactions**
   If the SAP business object requires sequential creation, implement the actual proven sequence:
   ```text
   Header CREATE → Confirm SAP document number → Item CREATE → Confirm item persistence → Pricing CREATE → Confirm pricing persistence → Read back complete document
   ```
   Do not report the operation as successfully completed until all required SAP operations succeed.

6. **NEVER use local/mock persistence as a substitute**
   For SAP transactional features: Frontend/local state ≠ SAP persistence.
   Do NOT:
   - fake a successful creation;
   - insert a local record and call it SAP-created;
   - generate a fake document number;
   - store the document only in frontend/backend local state;
   - return success when SAP did not persist the document.
   The final validation MUST read the created document back from SAP.

7. **Error classification**
   When SAP rejects a request, identify the actual layer before changing code:
   - `404 / URI_NOT_MATCHING` → Wrong service/entity/navigation path or metadata mismatch.
   - `405` → Operation may not be supported (e.g. `CX_SADL_ENTITY_CUD_DISABLED`).
   - `501 CREATE_ENTITY not implemented` → Backend DPC CREATE implementation is missing.
   - `403` → Authorization / CSRF / permission issue.
   - `500` → Backend/business/configuration/application error.
   Do not respond to every failure with "activate the service."

8. **Protect existing working functionality**
   If listing, Object Page, item, pricing, or other READ functionality already works:
   - DO NOT replace or modify it unnecessarily.
   - Separate READ capability from CREATE capability.
   - Investigate the failing operation independently.

9. **No assumptions**
   The agent MUST NOT assume:
   - an Object Page service supports POST;
   - a navigation property supports deep insert;
   - GET and POST use the same URL;
   - a Catalog Service is a transactional API;
   - an SAP business object has a single OData POST;
   - local success means SAP success;
   - a service being active means CREATE is implemented.
   Every such capability must be verified from the actual SAP metadata, implementation, or live SAP test.

### Definition of Done

A SAP Create feature is NOT complete until:
1. Actual SAP API/service identified.
2. `$metadata` inspected.
3. EntitySet verified.
4. Navigation properties verified.
5. CREATE capability verified.
6. Real SAP POST tested.
7. SAP-generated document number confirmed.
8. Required items persisted in SAP.
9. Required pricing persisted in SAP.
10. Document read back directly from SAP.
11. Frontend displays the SAP-persisted result.
12. No mock/local-only persistence is used.
13. Existing READ/list/detail functionality remains working.
14. Tests and validation pass.

If the agent cannot prove the SAP backend capability, STOP implementation and report exactly what SAP capability is missing. Do not invent an API, payload, endpoint, navigation property, or local workaround.

## Change and test rules

- Prefer a focused, reviewable diff. Avoid unnecessary renames, formatting churn, generated files, and unrelated refactors.
- Add or update tests before or with behavior changes. Test the affected behavior and likely regression paths.
- Unit tests cover isolated domain, handler, formatter, adapter, and validation behavior.
- Integration tests cover CAP-to-S/4 boundaries with controlled fixtures/mocks; never depend on mutable production data.
- E2E tests cover the applicable Fiori → CAP → backend flow.
- Read errors, warnings, and stack traces completely. Investigate the failing boundary and root cause before changing implementation.
- If a prerequisite tool, service, credential, or environment is unavailable, do not claim success. Report the exact unavailable validation and its reason.

## Required validation

Run applicable commands after each meaningful layer and again before completion. Do not invent commands: inspect `package.json`, `ui5.yaml`, CI workflows, and installed tooling first.

| Change area | Required validation when available |
| --- | --- |
| All changes | `git diff --check`, targeted tests, relevant regression tests, `git status` |
| CAP model/service/handlers | `cds --version`, CDS compile/serve/test commands defined by the project, CAP unit and integration tests |
| UI5/Fiori | `cd app/fiori-app && npm install`, configured UI5 lint/test/build commands, relevant UI5 unit/integration tests |
| S/4 integration | Safe connectivity/authentication/metadata checks, adapter and service integration tests with controlled inputs |
| MTA or BTP resources | `mbt validate`, validate module/resource references and the relevant environment extension |
| Dependencies | lockfile consistency, package compatibility, build and affected tests |
| Deployment/CI | configured build, test, MTA validation, and dry-run-safe deployment checks |

The current project may not yet define every command or provision every service. In that case, validate everything that exists, identify the missing command or prerequisite precisely, and do not mark the related layer validated.

## Final review and report

Before finishing:

1. Re-read the diff and verify it meets the request without changing unrelated behavior.
2. Confirm architecture boundaries, configuration compatibility, secret handling, and dependency necessity.
3. Run the complete applicable validation/build/test pass.
4. Report exactly:
   - files changed and the behavior delivered;
   - tests and validation commands run, with pass/fail results;
   - S/4/BTP checks performed, without leaking secrets;
   - known limitations, skipped checks, unresolved failures, and required follow-up.

Never describe a change as complete, working, deployed, secure, or production-ready when relevant validation has not passed.
