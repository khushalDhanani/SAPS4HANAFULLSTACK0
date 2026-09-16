
# Changes Log

> **Historical changes**: See [logs/2026-09-archive.md](logs/2026-09-archive.md) for all entries prior to 2026-09-16 12:00 IST.

## 2026-09-16 12:00 IST
- **Agent**: Antigravity
- **Change**: Repository hygiene cleanup — moved root-level S/4 metadata dumps to `srv/external/`, rotated WORKSTATUS.md (876 KB / 9,034 lines → archived to `logs/2026-09-archive.md`), untracked 28 PNG screenshots (8.3 MB) from `docs/`, updated `.gitignore` with screenshot and trace rules.
  - **Files moved**:
    - `simple_inb_dlv_metadata.xml` → `srv/external/simple_inb_dlv_metadata.xml` (228 KB)
    - `sap_all_services.json` → `srv/external/sap_all_services.json` (124 KB)
  - **Files archived**:
    - `WORKSTATUS.md` changes log (239 entries, lines 2–7985) → `logs/2026-09-archive.md` (856 KB)
    - Embedded AGENTS.md copy (lines 7986–9034) stripped — redundant with standalone `AGENTS.md`
  - **Files untracked from git**:
    - 28 PNG files in `docs/` and `docs/screenshots/` (~8.3 MB total)
    - Files remain on disk locally but are excluded from future commits
  - **`.gitignore` updated**:
    - Added `docs/screenshots/`, `docs/*.png`, `dev_*`, `rfc*.trc` rules
  - **Root cause**: WORKSTATUS.md at 876 KB was approaching 1 MB, metadata dumps at root cluttered the project structure, tracked screenshots inflated the repo by 8.3 MB, and the last push failed until the git buffer was raised.
  - **Validation**:
    - `npm test`: **72 passed, 72 total test suites; 941 passed, 941 total tests (100% green)** in 46.1 s.
    - `cd app/fiori-app && npm run lint`: 0 findings detected.
    - `cd app/fiori-app && npm run build`: Succeeded in 1.09 s.
    - `npx cds compile srv`: Succeeded with 0 errors.
    - `git diff --check`: Clean (0 errors).
  - **Next recommended action**: Stage and commit hygiene cleanup to `feature/CL01`.