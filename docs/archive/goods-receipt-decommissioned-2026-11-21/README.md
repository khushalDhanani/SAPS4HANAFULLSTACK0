# Goods Receipt — decommissioned 2026-11-21

Documents that described only the removed Goods Receipt feature (movement 101), kept as historical record.

| File | What it was |
| --- | --- |
| `posting-attempt-lifecycle.md` | Lifecycle and storage contract of the posting-attempt store, moved from `docs/architecture/`. |
| `zwm_post_attempt.tabl.ddl`, `zwm_post_attempt.fugr.abap` | Proposed SAP table and RFC modules that were to replace the attempt entity, moved from `docs/abap/`. Never created in SAP (checked read-only on 2026-11-21: no row in `TADIR`, `DD02L`, `TFDIR`). |

Related evidence that stays where it is:

- `docs/e2e-coverage-matrix.md`, section "Decommissioned flows": the live post of 2026-11-02 (delivery 0180000137, document 5000005789/2026).
- `docs/sap-metadata-reference/MMIM_GR4PO_DL_SRV.edmx`: SAP service metadata, unchanged.
- The create tool `tools/adt-create-post-attempt.js` and its test were deleted in the final audit; see `docs/decisions/sap-only-persistence-migration.md`.

The source code is in Git history before commit `ef2f5be3` on `feature01`.
