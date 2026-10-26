# SAP S/4HANA Full-Stack Engineering Instructions

These instructions apply to every agent and every change in this repository.

## Evidence, uncertainty, and approval

- Treat a fact as **CONFIRMED** only when it comes from the user, this file, or evidence you inspected or verified. Mark conclusions based on incomplete evidence **INFERRED**; mark missing information **UNKNOWN**. Never present either as confirmed.
- Explicitly identify every business, SAP, API, configuration, or integration assumption before implementation; never silently turn UNKNOWN or INFERRED information into code. If critical evidence remains unavailable after investigation, mark it **UNKNOWN/BLOCKED** and stop the dependent change.
- Never invent SAP configuration, T-codes, tables, BAPI parameters, service contracts, or messages. Label unverified SAP details **Not verified**.
- **Stop rule**: When an unknown could change business behavior, security/privacy, an SAP contract or payload, production configuration, or cause a destructive/external side effect, **first try to find the information using any agent** (inspect repository files, configuration, code, tests, SAP metadata, safe read-only queries, tools/MCP servers, subagents, or documentation). **Only after trying to find and not getting the information ("after not get"), then stop** before taking the action and ask a concise question with **Context, Doubt, Options and consequences, Recommendation** (maximum five questions).
- For clear, reversible work directly requested by the user, use established project patterns and proceed. State any material assumption in the plan or report; do not ask about inconsequential implementation details.
- Give a brief plan before non-trivial changes. Wait for approval when scope is ambiguous, the change is destructive, or it causes an external side effect. A request to edit code or documentation does not authorize a live SAP write, deployment, or other external mutation.
- Do only the requested work. Do not fix, clean up, or refactor unrelated issues during the task, even when they are obvious; report them separately as findings without acting on them.
- Never proceed past an unanswered BLOCKER. Never put a message number, field name, table, or storage type in a table unless it appears in this repo (cite file:line) or user answers. Otherwise write **Not verified**. "Assumptions made: None" is only allowed if every row is proven.
- Reject placeholder input. If a value looks like a sample (`___`, `xxxxx`, `"exact message"`, `"text"`), treat it as **NOT PROVIDED**, stop, and ask. Never analyze a template or example as if it were a live result.
- Never run any live write (BAPI, RFC, POST, DB write) without the user's explicit written "go" for that specific call. A choice between options is not a "go". Default is read-only. State "READ-ONLY" or "WRITE" before every SAP call.
- Before reporting, check for unresolved assumptions and list them accurately; say **Assumptions: none** only when there are none. Use the final report format below.

## Non-negotiable workflow

Follow this sequence for every task:

```text
Inspect → Plan → Change → Test → Validate → Review → Report
```

Completion requires evidence: **PASS** = implementation + applicable tests + integration verification + verified business result; **PARTIAL** = implementation exists but validation is incomplete; **BLOCKED** = required evidence, environment, service, credential, or dependency is unavailable. **FAIL** records an observed failure; **NOT VERIFIED** records an untested claim. A successful command alone does not prove business behavior.

## WORKSTATUS.md is mandatory

`WORKSTATUS.md` is this project's single source of truth for work history, current status, validation, unresolved issues, and next steps.

Before making a change, every agent must:

1. Read `AGENTS.md`.
2. Read `WORKSTATUS.md`.
3. Understand the current status and unresolved issues.
4. Plan the change before editing any file.

After every change, update `WORKSTATUS.md` in the same work session. Record the change, affected files, reason, executed commands/tests and results, errors/warnings/blockers, and the exact next recommended action. Keep **Current Status** and **Next Steps** current.

- **Every independently reviewable change requires a log entry.** Related edits that deliver one coherent outcome may share an entry; unrelated work must not be bundled.
- Record the change first, then append the executed validation result to that entry. Never claim validation before running it.
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

Hard pre-flight gate. No code is written until every step below is done and its result is stated in the plan:

```text
BEFORE CODE:
  Read AGENTS.md
  Read WORKSTATUS.md
  Check git status
  Search existing implementation
  Identify affected flow
  Identify tests
  Identify unknowns
THEN code
```

Before modifying anything:

- Read the request completely and inspect all relevant files, configuration, tests, documentation, and call sites.
- Check `git status` and preserve unrelated user changes. Never overwrite, revert, or reformat unrelated work.
- Identify affected flows and existing tests before editing. Trace and verify the complete affected round trip through applicable layers: UI → Controller → CAP → Backend → S/4 → SAP Result → Backend Response → UI, including persistence/domain logic and BTP services where involved.
- Before adding any file, service, helper, controller, fragment, model, API client, validator, dependency, or abstraction, search the repository. Reuse existing implementations and installed dependencies; create new code only when they cannot satisfy the requirement.
- Do not guess about APIs, package versions, configuration, service contracts, authentication, or runtime behavior. Obtain evidence from source, metadata, documentation, commands, or controlled tests.

### 2. Plan

- State the intended behavior, affected boundaries, files, dependencies, risks, and validation approach before changing code.
- Make the smallest coherent change that satisfies the request. Do not add speculative abstractions, files, dependencies, frameworks, services, or architecture.
- Confirm dependency and configuration compatibility with the installed versions and current runtime architecture before adding or upgrading a package.
- For a bug, reproduce it and identify the root cause before proposing a fix. Fix the source of the problem, not a symptom or a single caller.
- Root-cause fixing is universal, not bug-only: never patch a symptom (a caller, a retry, a default, a try/catch, a UI guard) when the underlying boundary or contract is the actual failure. Fix the boundary once in the shared code, or report why that is out of scope.
- Do not modify a working configuration blindly. Compare it with the current project state and validate every assumption.

### 3. Preserve architecture boundaries

Keep responsibilities separated according to this repository structure:

| Area | Responsibility | Must not contain |
| --- | --- | --- |
| `app/fiori-app/` | SAPUI5/Fiori presentation, view models, presentation logic | Credentials, persistence, direct database access, S/4 technical calls, business workflows |
| `db/` | CAP CDS persistence model and controlled seed data | UI logic, HTTP calls, environment-specific configuration |
| `srv/` | CAP APIs, authorization, validation, orchestration | UI implementation or duplicate integration clients |
| `srv/integration/s4hana/` | S/4 clients, API services, adapters, technical mappings | UI behavior or CAP business workflows |
| `config/` | Version-safe service configuration templates | Secrets or production-only values |
| `mta/` and `mta.yaml` | Deployment topology and environment extensions | Credentials or duplicate modules/resources |

- UI5 communicates only through defined HTTP/OData APIs.
- CAP business logic must not be duplicated in UI controllers or integration adapters.
- S/4 technical communication belongs exclusively in `srv/integration/s4hana/`.
- Use adapters to translate between CAP domain models and S/4 OData payloads.
- Keep modules independently testable through explicit interfaces and dependency injection where appropriate.

## Agent skills and MCP servers

- `AGENTS.md` is the repository-wide source of project rules. IDE-specific instruction entry points must stay as short pointers to this file rather than copied rule sets.
- Project skills have one source of truth at `skills/<name>/SKILL.md`. Discovery links for supported agents live under `.agents/skills/`, `.claude/skills/`, and `.opencode/skills/`; do not copy skill content into IDE-specific directories.
- Read `skills/README.md` for the supported IDE/agent setup matrix and conventions before adding or editing skills or adapters. Validate every discovery link resolves to its canonical skill.
- MCP servers `cds-mcp` (`@cap-js/mcp-server@0.0.8`) and `ui5-mcp` (`@ui5/mcp-server@0.3.2`) are configured for supported agents in `.mcp.json`, `.codex/config.toml`, `.cursor/mcp.json`, `.gemini/settings.json`, `.agents/mcp_config.json`, and `opencode.json`. Keep these native configurations in sync when changing server definitions. The root `.mcp.json` is used by Claude Code and portable Copilot clients.
- When available, search CDS definitions (entities, fields, services, and HTTP endpoints) with cds-mcp first. If the server/tool is unavailable or the search fails, state that limitation and inspect project `*.cds` files as the fallback; do not imply the MCP search succeeded.
- Before creating/modifying CDS models or relying on CAP APIs/CLI behavior, check CAP guidance with cds-mcp when available. If unavailable, use version-matched local documentation or official CAP documentation where accessible; if material behavior remains unverified, stop that dependent change and report what is missing.
- These servers cover CAP and UI5 framework knowledge only. S/4HANA service contracts are never taken from them; follow the SAP API Discovery protocol below.

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

Do not implement integration code from assumed entity names or payloads. Do not expose destination credentials to the browser. Do not introduce a second S/4 client outside `srv/integration/s4hana/`. A real SAP write (including a proof/test POST) requires explicit user authorization for the target environment and data scope; without it, stop before sending the write and report that live proof remains pending. Read-only metadata and connectivity checks do not authorize writes.

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
   Before implementing the UI Create flow, and only after explicit authorization for the target environment and test data, perform a minimal real SAP POST:
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

10. **Reject placeholder input**
    If a value looks like a sample (`___`, `xxxxx`, `"exact message"`, `"text"`), treat it as NOT PROVIDED, stop, and ask. Never analyze a template or example as if it were a live result.

11. **Strict write-gate**
    Never run any live write (BAPI, RFC, POST, DB write) without explicit written "go" from the user for that specific call. A choice between options is not a "go". Default is read-only. State "READ-ONLY" or "WRITE" before every SAP call.

### Definition of Done

A SAP Create feature is NOT complete until:
1. Actual SAP API/service identified.
2. `$metadata` inspected.
3. EntitySet verified.
4. Relevant navigation properties verified.
5. CREATE capability verified.
6. Real SAP POST tested with explicit authorization for the target environment and data scope.
7. SAP-generated document number confirmed, when the API generates one.
8. Every component actually required by the verified business object/API contract (such as items or pricing) is persisted and confirmed.
9. Document read back directly from SAP.
10. Frontend displays the SAP-persisted result.
11. No mock/local-only persistence is used.
12. Existing READ/list/detail functionality remains working.
13. Tests and validation pass.

If the agent cannot prove the SAP backend capability, STOP implementation and report exactly what SAP capability is missing. Do not invent an API, payload, endpoint, navigation property, or local workaround.

## Change and test rules

- Prefer a focused, reviewable diff. Avoid unnecessary renames, formatting churn, generated files, and unrelated refactors.
- **No test = no completion.** Missing tests are never silently treated as not applicable. Every meaningful change states exactly one test impact decision in the plan and in the report:

  ```text
  TEST ADDED
  TEST UPDATED
  EXISTING TEST SUFFICIENT — name the test
  TEST NOT POSSIBLE — reason
  ```

  Without a stated decision the change is **PARTIAL** at best; `TEST NOT POSSIBLE` must give the concrete missing prerequisite and the change cannot be reported as **PASS**.
- Add or update tests before or with behavior changes. For every meaningful change, run applicable static validation, unit, integration, regression, negative/error-path and E2E tests, plus real SAP verification for SAP functionality. Protect existing READ/list/detail flows when adding CREATE/UPDATE behavior; report each untested required layer without claiming PASS.
- Unit tests cover isolated domain, handler, formatter, adapter, and validation behavior.
- Integration tests cover CAP-to-S/4 boundaries with controlled fixtures/mocks; never depend on mutable production data.
- E2E tests verify the applicable complete round trip and actual business result. A working UI, passing build/unit test, HTTP 200, or successful mock is insufficient. Mocks/demo data are allowed only in explicitly appropriate test/demo environments and must never masquerade as real SAP functionality or persistence.
- Read errors, warnings, and stack traces completely. Investigate the failing boundary and root cause before changing implementation.
- If a prerequisite tool, service, credential, or environment is unavailable, do not claim success. Report the exact unavailable validation and its reason.

## Dead-code and unused-code review

Check the affected scope for duplicate services, helpers, controllers, fragments, models, dependencies, mocks, debug code, and unreachable code. Do not leave a superseded implementation behind when replacing it: prove safe removal or report unresolved use as a blocker to replacement.

Treat dead-code findings as **candidates** until reachability and runtime use are checked. Before removing code, trace static references and relevant dynamic entry points, including CAP service/handler registration, CDS definitions, UI5 routes and manifests, fragments, configuration/environment keys, scripts/jobs, dependency injection or reflection, generated files, extension points, and tests. Check whether the code is intentionally dormant behind a feature flag or used by an external SAP/platform integration.

Dependency cleanup is part of this review:

- If a dependency is added, prove why it is required: name the requirement no installed dependency or existing code satisfies, and record that evidence in the plan and `WORKSTATUS.md`.
- If code is removed, check whether its dependencies (packages, config keys, scripts, fixtures, mocks) are now unused and can also be removed under the same reachability rules; report any that remain and why.

Lint warnings or a text search alone do not prove code is safe to remove. Use existing project tooling; do not add a dead-code package unless the user asks. Remove code only when evidence shows it is unreachable, removal is within the requested scope, and focused tests plus relevant lint/build validation pass. If dynamic or external use cannot be ruled out, leave the candidate in place and report the evidence and uncertainty.

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

1. Inspect `git diff`, `git diff --check`, and `git status`; confirm scope, architecture boundaries, configuration compatibility, secret handling, and dependency necessity.
2. Review dead-code/duplicates and run applicable tests, build/lint/type checks, integration and regression validation. Verify the business result, including SAP persistence/read-back where required; never bypass the SAP write-gate.
3. Verify `WORKSTATUS.md` records only executed validation and actual outcomes; implementation alone never warrants completion.
4. Report **CHANGED**, **TEST DECISION** (ADDED / UPDATED / EXISTING SUFFICIENT / NOT POSSIBLE with reason), **TESTED**, **VERIFIED**, **NOT VERIFIED**, **BLOCKED**, **ASSUMPTIONS**, **REGRESSION**, and **FINAL STATUS** (PASS/PARTIAL/BLOCKED/FAIL). Include affected files/behavior, exact commands and outcomes, S/4/BTP checks without secrets, skipped checks and reasons, unresolved failures, and next action. Explain non-applicable checks; every result must match inspected evidence or actual execution.

Never describe a change as complete, working, deployed, secure, or production-ready when relevant validation has not passed.

## Creatable-services workbook (`creatable-services.xlsx`)

`creatable-services.xlsx` is the single reference for which SAP OData services are creatable (Summary, All, one sheet per module).
It is generated — never hand-edit it. Whenever service/creatable findings change:

1. `ALLOW_LIVE_SAP_TOOLS=1 python3 tools/find-creatable.py --allow-live-sap` — explicitly opt in to re-scan live `$metadata` (GET only) → `catalog-creatable.csv`
2. `python3 tools/build-creatable-xlsx.py` — rebuild the workbook
3. Wrong module for a service → add it to `OVERRIDES` (or adjust `RULES`) in `tools/build-creatable-xlsx.py`, then rebuild.
