# ZQUARAN Fiori implementation plan

Status: proposed implementation; no application or SAP changes authorized by this planning request.

## Intended result

Add a **Print Quarantine Labels** screen to the existing freestyle Fiori app. A user enters a material document number and optional text, requests a preview, and prints or downloads the resulting SAP-generated PDF. Reuse the existing Adobe form where its interface and rendering behavior are proven. Proposed first release: one material document per request, browser printing, no custom label designer or direct SAP printer dispatch.

Browser printing is the working proposal from the conversation, not a confirmed printer-policy decision. Business users must confirm the output destination before implementation of dependent behavior.

## Confirmed evidence

- Live read-only transaction lookup: `ZQUARAN` → report `ZMM_R_062`, initial screen `1000`, description Quarantine.
- Report includes: `ZMM_R_062_T01` (declarations), `ZMM_R_062_S01` (selection screen), `ZMM_R_062_F01` (data assembly and form call).
- S01 lines 6–7: required `P_MBLNR` material document number; optional `P_TEXT`, CHAR50. The displayed business label for P_TEXT is not yet verified.
- F01 lines 332–377: form-processing job open, lookup of `ZMM_AF_017`, generated form call with `GT_FINAL`, job close. PDF-output capture is commented out; this report is not a proven PDF-returning API.
- F01 lines 21–22 filter by document number without a fiscal-year predicate. The correct year-disambiguation behavior must be established before implementing a new contract.
- Source evidence and live-query results are recorded in `WORKSTATUS.md` under the 2026-10-26 program discovery entry. Retrieved sources remain in `/private/tmp/zquaran-ZMM_R_062*.abap`; preserve reviewed evidence in the implementation session before relying on temporary files.
- Prior live V2 catalog search found no direct matching service name/description; inspected print/label candidates did not prove a ZQUARAN mapping. V4 catalog checks returned 404; absence of all possible service bindings is not proven.
- Existing project patterns: `BaseController.js`, `service/ODataClient.js`, Dashboard/App controllers, manifest routing, HU print utilities, server-side plant scope, and Playwright E2E runner. Existing HU label geometry is not evidence for the quarantine-label layout.

## Phase 1 — Prove the SAP output contract

1. Inspect the actual `ZMM_AF_017` form interface and layout, including page dimensions, fonts, barcodes if present, language, pagination and expected label count. Obtain an approved reference output.
2. Search existing ABAP service bindings/wrappers for this report/form. Verify exact interface, input keys, authorization, response type, errors, timeouts, and whether rendering creates spool/output records. Do not invent a service name or generated function name.
3. Resolve material-document year ambiguity, the meaning of optional text, multi-plant documents, permitted access roles, and whether reprinting needs a reason/audit record. Inspect existing policy/configuration first; ask the business owner only where evidence is missing.
4. If an existing interface returns the required PDF, reuse it. Otherwise prepare a minimal ABAP interface proposal that reuses the existing data/form logic and returns a PDF without printer dispatch. Do not blindly execute/SUBMIT the dialog report or duplicate its business queries in JavaScript. Any required source correction belongs at its verified SAP boundary and requires separately authorized scope.
5. Prove rendering with approved reference inputs only after side effects are understood. Every live SAP POST/RFC write, print job, deployment or output-record mutation requires explicit written go for that specific call and data scope. Metadata/source reads alone do not prove renderability.

Exit evidence: verified business inputs, form/output contract, authorization and side effects; actual rendered output compared with the reference. Stop dependent application implementation if this evidence is unavailable. No generic label service or locally fabricated PDF substitutes for the verified SAP form.

## Phase 2 — CAP and S/4 boundary

Proposed round trip:

```text
Fiori selection → CAP validation and authorization → S/4 integration adapter
→ verified SAP PDF interface / Adobe form → PDF response → Fiori preview
```

- Keep request validation and authorization in CAP; S/4 calls and technical mappings stay in `srv/integration/s4hana/`. Reuse the configured integration client and Destination/Connectivity/XSUAA mechanisms.
- Validate required keys and optional text on both UI and server; retain document identifiers as strings. Derive exact lengths/types from the verified interface. Add year only after the approved key contract is established.
- Derive allowed plants from the authenticated identity, resolve the document's actual plants in SAP, and authorize every included item before exposing label data or PDF. No authorization based solely on a browser-supplied plant. Confirm cross-plant and reprint policy rather than copying HU role assignments blindly.
- Select a supported authenticated binary/media response compatible with installed CAP. Preserve PDF bytes, use a safe filename/content type, prevent shared caching, and avoid leaking sensitive input in URLs/logs. Do not persist generated PDFs or introduce database tables unless a verified audit requirement needs them.
- Define responses for invalid input, no matching document, no eligible label rows, unauthorized access, SAP failure, renderer failure and timeout. Reject empty/non-PDF output; never show an old preview as the current request's result.
- Prevent duplicate submission; do not automatically retry any operation with unknown or write side effects. If a write interface is required, adopt verified idempotency/outcome-recovery semantics at that boundary.

Exit evidence: agreed CAP contract and controlled adapter/service tests; real SAP output proof remains separately required. Exact endpoint names and payloads remain unassigned until Phase 1.

## Phase 3 — Fiori screen

- Proposed placement: MM navigation, since the discovered report is an MM label report. Confirm navigation/access policy before wiring the tile. Proposed module name: `modules/mm/quarantine-label`.
- Use a compact responsive form with Material Document and optional text, one primary **Preview Labels** action, and a PDF preview area/dialog. Add a year field only if Phase 1 establishes that contract. Do not introduce an item-selection table unless SAP's verified interface supports selective printing and the business needs it.
- Display validation next to inputs, busy state during generation, no-data/error messages with retry where safe, and an accessible download fallback where embedded preview is unavailable.
- Invalidate the preview when inputs change. Prevent rapid duplicate requests and stale responses replacing a newer preview; clean up preview resources on navigation/session expiry. Do not expose SAP credentials or direct SAP URLs to the browser.
- Reuse `sap.m.PDFViewer` if supported by the configured UI5 version and the chosen authenticated response flow. Printing/downloading must use the same generated artifact. Report print-dialog invocation accurately; it is not proof of physical printing.
- Reuse shell, navigation/back behavior, BaseController, i18n and existing HTTP error handling where compatible. Update all existing locales. Reuse HU presentation utilities only if their requirements match; do not copy HU label layout, fabricate quarantine data, or change the working HU flow.

Exit evidence: accessible browser flow with controlled responses, correct PDF preview/download, no stale result or unauthorized content.

## Proposed affected files and boundaries

Paths below are implementation proposals, not existing APIs or committed new modules. Recheck for reusable implementations before adding files.

- `app/fiori-app/webapp/modules/mm/quarantine-label/`: focused XML view/controller and only necessary supporting UI files.
- `app/fiori-app/webapp/manifest.json`, `view/Dashboard.view.xml`, `controller/Dashboard.controller.js`, `controller/App.controller.js`, `i18n/i18n*.properties`: route, navigation, shell title and translations.
- `srv/mm/quarantine-label/`: proposed CAP contract and handler; `srv/integration/s4hana/mm/`: minimal adapter for the proven SAP interface. Existing client/configuration boundaries remain authoritative.
- `test/unit/`, `test/integration/`, `test/e2e/mm/`, `test/e2e/runAllE2E.js`, `docs/e2e-coverage-matrix.md`: validation and route coverage. Use `runSapRoundTrips.js` only if the proven operation is a SAP write.
- `WORKSTATUS.md`: per-phase evidence and unresolved decisions. SAP-side files/transports and deployment changes are conditional on Phase 1, not authorized by this plan.

No new package is currently justified. Installed CAP is 10.1.1, UI5 CLI 4.0.71; manifest minimum UI5 version is 1.136.0. UI5 MCP API lookup attempted SDK 1.136.5 and failed because its version resource was unavailable. Verify PDFViewer APIs against the actual runtime before coding. CAP MCP model search confirmed HandlingUnitService; media guidance describes standard media resources and a beta custom-streaming option. Do not assume beta streaming compatibility without checking the installed runtime.

## Phase 4 — Validation and business acceptance

Implementation **TEST DECISION: TEST ADDED**. Add feature tests alongside behavior, update existing shell/matrix tests where affected, and run relevant regressions.

- Unit: input validation, identifier preservation, 50-character limit, agreed year handling, role/plant checks, adapter mapping, PDF response validation, stale-preview suppression and duplicate requests.
- Controlled integration: actual agreed contract with SAP fixtures; unauthorized/cross-plant input, empty output, non-PDF response, SAP 4xx/5xx, timeout, renderer failure and session errors. Fixtures are explicitly test-only.
- Playwright: tile/route → input → preview → download/print-dialog request; empty/invalid fields, unknown document, missing SAP data, denied access, SAP/backend errors, double-click, changed inputs during loading, reload/back navigation and session expiry. Add an existing-suite citation to the route matrix in the same change and register the suite in the runner. Stubbed tests must not be described as SAP rendering proof.
- Business verification: compare Fiori's actual SAP-rendered PDF with approved output from the same inputs: content, text, label count, page dimensions and any verified barcode behavior. Physical print acceptance uses the target printer/stock if required; automated browser tests alone cannot verify paper output.
- Preserve existing HU list/detail/print behavior and shared shell/API behavior. No change to existing SAP create/update flows.

Planned commands (not executed as feature validation during planning): `npx cds --version`, `npx cds compile srv/`, targeted Jest suites, `npm run test:integration`, `npm run lint`, UI5 dependency installation with lockfile review, `npm --prefix app/fiori-app run lint`, `npm --prefix app/fiori-app run build`, `npm run test:e2e`, `git diff --check`, and `git status`. Use the existing project's safe write guards; live write tests require per-call go. Run MTA validation only if deployment topology changes. Run relevant broader regression before completing implementation.

## Delivery gates

1. SAP contract and reference-output evidence resolved.
2. Backend contract implemented and controlled tests passed.
3. Fiori flow implemented, route matrix updated and browser E2E executed.
4. Real SAP output and agreed business/print acceptance verified; existing flows remain working.
5. Review a focused diff and truthful WORKSTATUS before any separately authorized deployment.

Implementation is PARTIAL if required browser or real SAP output verification is missing, and BLOCKED when a required contract/environment decision is unavailable. This document completes planning only; it does not establish a working Fiori feature.
