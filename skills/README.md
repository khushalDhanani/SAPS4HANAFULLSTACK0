# Agent skills workspace

Skills are small, on-demand playbooks (`SKILL.md`) that AI coding agents load when a task
matches their `description`. Pattern follows SAP's "skills workspace for CAP development"
blog post (community.sap.com, June 2026).

## Shared instructions and IDE support

- `AGENTS.md` is the canonical project policy. `WORKSTATUS.md` remains the source of truth for change history and validation.
- IDE-specific instruction files are thin entry points that point back to `AGENTS.md` and this catalog. Do not duplicate project policy in them.
- Each skill is authored once at `skills/<name>/SKILL.md`. Agent skill discovery uses symlinks to these canonical directories; never copy skills into IDE configuration folders.
- Current repository entry points:

| IDE / agent | Project entry point | Skill discovery |
| --- | --- | --- |
| Codex | Root `AGENTS.md` | `.agents/skills/<name>` |
| Antigravity IDE / CLI | Root `AGENTS.md` | `.agents/skills/<name>` |
| Claude Code | Root `AGENTS.md` plus `.claude/` discovery | `.claude/skills/<name>` |
| OpenCode | `.opencode/` discovery and root instructions | `.opencode/skills/<name>` (also compatible with `.agents/skills/` and `.claude/skills/`) |
| Cursor | `.cursor/rules/project.mdc` and root `AGENTS.md` | Read a matching skill from `skills/` when its description applies |
| GitHub Copilot Chat | `.github/copilot-instructions.md` | Read a matching skill from `skills/` when its description applies |
| Gemini CLI | Root `GEMINI.md` imports `AGENTS.md` and this catalog | Read a matching skill from `skills/` when its description applies |

For another IDE or agent, configure its repository instruction feature to include `AGENTS.md`, then tell it to consult this catalog and load only the relevant `skills/<name>/SKILL.md`. If that tool cannot discover skills, the instructions remain usable by opening the relevant file directly. IDE integrations and skill auto-discovery are version-dependent; verify them in the target IDE after setup rather than assuming they are active.

## Conventions

- **Frontmatter is the trigger:** `name` and `description` are required; write the description as a classifier (when to use, synonyms, file areas).
- **Keep skills small** (1–6k tokens). Split rather than grow.
- **MCP servers** for live docs/model lookups are registered in `.mcp.json` (`cds-mcp`, `ui5-mcp`). Skills say *when* to query them.
- **Evals/scratch:** directories matching `*-workspace/` are gitignored.
- Project rules in `AGENTS.md` apply regardless of which IDE or skill is active.

## Catalog

| Skill | Use when | Source / licence |
| --- | --- | --- |
| `sap-cap` | CDS models, CAP services and handlers in `db/`, `srv/` | adapted from SAP-samples/cap-agentic-engineered (Apache-2.0) |
| `sap-ui5` | Freestyle SAPUI5 views, fragments, controllers in `app/fiori-app` | adapted from SAP-samples/cap-agentic-engineered (Apache-2.0) |
| `sap-fiori-guidelines` | Fiori design decisions: floorplans, controls, messages, a11y | copied verbatim from SAP/ai-skills-library (Apache-2.0) |
| `sap-s4hana-api-discovery` | Verify SAP OData/RFC contracts and backend capability before integration changes | project-authored |
| `sap-s4hana-integration` | Implement adapters and safe S/4 calls after the contract is verified | project-authored |
| `sap-test-validation` | Select project checks and record verified results in `WORKSTATUS.md` | project-authored |
| `sap-ai-integration-privacy` | Review AI provider integration, prompt boundaries, and data privacy in the CAP AI flow | project-authored |

## Adding a skill

1. Create `skills/<name>/SKILL.md` with frontmatter and the one workflow that works.
2. Add discovery symlinks for each supported skills directory: `.agents/skills/`, `.claude/skills/`, and `.opencode/skills/`.
   From each directory, link `<name>` to `../../skills/<name>`.
3. Add a row to the catalog above and a `WORKSTATUS.md` entry.
4. After real sessions, fold what the agent got wrong back into the skill.
