---
name: sap-test-validation
description: >
  Select and report validation for changes in this SAP CAP, SAPUI5, S/4HANA, and BTP
  project. Use when planning tests, diagnosing CI failures, preparing a change review,
  or updating WORKSTATUS.md with commands actually run.
paths:
  - "test/**"
  - ".github/workflows/**"
  - "package.json"
  - "app/fiori-app/package.json"
  - "WORKSTATUS.md"
---

# Project Test and Validation Workflow

Choose validation from the changed boundary and the commands defined by the repository.
Never report a test, build, deployment, or live SAP check as passed unless it was run and
its result was inspected. Follow `AGENTS.md` and maintain `WORKSTATUS.md`.

## Workflow

1. **Inspect the validation surface.** Read the relevant package scripts, test files, and
   `.github/workflows/ci.yml`. Do not invent commands. Preserve unrelated work.
2. **Map changes to checks.** Pick targeted unit and integration tests first, then relevant
   regression checks. Use the validation requirements in `AGENTS.md` for CAP, UI5,
   integration, and deployment changes.
3. **Run and inspect each command.** Capture its exit status and review failures, warnings,
   and stack traces. Fix or report the actual failure; do not hide it or claim success from
   partial output.
4. **Run applicable project checks.** Current root scripts include `npm test`,
   `npm run test:unit`, `npm run test:integration`, `npm run test:e2e`, `npm run lint`,
   and `npm run validate:mta`. The UI5 package and CI workflow define additional lint and
   build checks. Confirm scripts before relying on them.
5. **Validate the diff.** Run `git diff --check`, inspect `git diff`, and check `git status`
   for unrelated or unexpected files. For SAP writes, automated mocks do not replace the
   live persistence proof required by `AGENTS.md`.
6. **Record truthful results.** Add a timestamped `WORKSTATUS.md` entry for every change.
   Include affected files, reason, exact commands and outcomes, skipped checks and why,
   blockers, current status, and the exact next action. Update the entry after validation.

## Result language

- Say **PASS** only for a command that completed successfully and whose result was checked.
- Say **FAIL** with the relevant error when a command fails.
- Say **NOT RUN** with the reason when a check was unavailable or inapplicable.
- Keep live SAP, BTP, build, and test evidence distinct; one does not prove another.
