# Agent skills workspace

Skills are small, on-demand playbooks (`SKILL.md`) that AI coding agents load when a task
matches their `description`. Pattern follows SAP's "skills workspace for CAP development"
blog post (community.sap.com, June 2026).

## Conventions

- **Single source of truth:** author and edit skills only in `skills/<name>/SKILL.md`.
- **Discovery by symlink:** `.claude/skills/<name>` → `../../skills/<name>`. Never create
  or copy a skill inside `.claude/`; add a symlink. Other agents (`.agents/`, `.opencode/`)
  can be added the same way when needed.
- **Frontmatter is the trigger:** `name` and `description` are required; write the
  description as a classifier (when to use, synonyms, file areas).
- **Keep skills small** (1–6k tokens). Split rather than grow.
- **MCP servers** for live docs/model lookups are registered in `.mcp.json`
  (`cds-mcp`, `ui5-mcp`). Skills say *when* to query them.
- **Evals/scratch:** directories matching `*-workspace/` are gitignored.
- **Project rules still win:** `AGENTS.md` (Zero-Assumption Protocol, SAP API Discovery
  Protocol, `WORKSTATUS.md` logging) applies on top of every skill.

## Catalog

| Skill | Use when | Source / licence |
| --- | --- | --- |
| `sap-cap` | CDS models, CAP services and handlers in `db/`, `srv/` | adapted from SAP-samples/cap-agentic-engineered (Apache-2.0) |
| `sap-ui5` | Freestyle SAPUI5 views, fragments, controllers in `app/fiori-app` | adapted from SAP-samples/cap-agentic-engineered (Apache-2.0) |
| `sap-fiori-guidelines` | Fiori design decisions: floorplans, controls, messages, a11y | copied verbatim from SAP/ai-skills-library (Apache-2.0) |
| `sap-s4hana-api-discovery` | Verify SAP OData/RFC contracts and backend capability before integration changes | project-authored |
| `sap-s4hana-integration` | Implement adapters and safe S/4 calls after the contract is verified | project-authored |
| `sap-test-validation` | Select project checks and record verified results in `WORKSTATUS.md` | project-authored |

## Adding a skill

1. Create `skills/<name>/SKILL.md` with frontmatter and the one workflow that works.
2. `ln -s ../../skills/<name> .claude/skills/<name>`
3. Add a row to the catalog above and a `WORKSTATUS.md` entry.
4. After real sessions, fold what the agent got wrong back into the skill.
