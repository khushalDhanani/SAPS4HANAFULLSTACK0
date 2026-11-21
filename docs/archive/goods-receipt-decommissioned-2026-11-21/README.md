# Goods Receipt — decommissioned 2026-11-21

Documents that described only the removed Goods Receipt feature (movement 101), kept as historical record.

| File | What it was |
| --- | --- |
| `posting-attempt-lifecycle.md` | Lifecycle and storage contract of the posting-attempt store, moved from `docs/architecture/`. |

Related evidence that stays where it is:

- `docs/e2e-coverage-matrix.md`, section "Decommissioned flows": the live post of 2026-11-02 (delivery 0180000137, document 5000005789/2026).
- `docs/sap-metadata-reference/MMIM_GR4PO_DL_SRV.edmx`: SAP service metadata, unchanged.
- `docs/abap/zwm_post_attempt.*` and `tools/adt-create-post-attempt.js`: prepared SAP table for posting attempts; obsolete, see `docs/decisions/sap-only-persistence-migration.md`.

The source code is in Git history before commit `ef2f5be3` on `feature01`.
