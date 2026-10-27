# Current ZQUAR quarantine label: what the repo proves (2026-10-27)

Purpose: the baseline for "SAME label as today, only the size changes" (4 x 6 in, 101.6 x 152.4 mm, 288 x 432 pt; the user's size decision: "Size will be my").

Source rule: files in this repo only, no SAP calls. Anything not proven by a cited file is **NOT DETERMINED**.

> **Update 2026-10-27:** the user then chose a new design instead of a copy: "I need Fully Customised. understand." So this baseline no longer blocks the build. It remains the record of what is unknown about the SAP label. The new label: `docs/label/zquar-4x6-design.md`.

## Result

**The current layout cannot be determined from the repo, so the build is stopped.**
- The label is drawn by the Adobe form `ZMM_AF_017` in SAP.
- Its layout (`FPLAYOUT-LAYOUT`), context (`FPCONTEXT-CONTEXT`) and interface (`FPINTERFACE-INTERFACE`) are raw-string (RSTR) fields, which RFC_READ_TABLE cannot read (`docs/evidence/2026-10-27/zquaran-4x6/form-header-interface.json`).
- The repo has no sample PDF, screenshot or photo of the label.
- `Z_MM_QUAR_LABEL_PDF` has never rendered one: no proof run has been done (WORKSTATUS.md, 2026-10-26).

## What is proven

| Item | Value | Evidence |
| --- | --- | --- |
| Transaction → program | ZQUARAN → ZMM_R_062, screen 1000 | `docs/evidence/2026-10-26/zquaran/program-identity.json` |
| Input | material document (`P_MBLNR`, required), text (`P_TEXT`, CHAR 50, optional) | `ZMM_R_062_S01.abap:6-7` |
| Form | `ZMM_AF_017`, interface `ZMM_FI_017`, layout type `S`, English layout present | `form-header-interface.json` |
| Data passed to the form | table `GT_FINAL` (`ZMM_TT_026`, row `ZMM_S_013`, 22 fields) | `generated-form-contract.json`, `form-header-interface.json` |
| Material description language | logon language (`SPRAS = SY-LANGU`) | `ZMM_R_062_F01.abap:32` |
| Date caption values | `ZDATE` = "Retest Date", or "Expiry Date" when no retest date exists (sent as data) | `ZMM_R_062_F01.abap:310, 313` |
| Container counter | `CONT` = "<n> OF <total>" | `docs/abap/z_mm_quar_label.fugr.abap:214` |
| Rows per document | one `GT_FINAL` row per transfer-order item from storage types 920/902 | `docs/abap/z_mm_quar_label.fugr.abap` (port of F01) |

Fields of `ZMM_S_013` and which the report fills: see `docs/abap/zmm_af_017_4x6-spec.md`, section 1. MENGE, LIFNR, VEMNG and ERFME are never filled; MENGE's assignment is commented out (`ZMM_R_062_F01.abap:248`).

## What the requested baseline needs, and its status

| Required for "same label" | Status |
| --- | --- |
| Page size of the current label | NOT DETERMINED |
| Which of the 22 fields are printed | NOT DETERMINED |
| Caption text of each printed field | NOT DETERMINED (only ZDATE's caption comes as data) |
| Position, font, size, weight, alignment of each field | NOT DETERMINED |
| Order / reading flow | NOT DETERMINED |
| Barcode type, encoded field, size | NOT DETERMINED |
| Logo, lines, boxes, frames | NOT DETERMINED |
| Labels per page | NOT DETERMINED (one row = one label is INFERRED from the data, not seen) |
| Static wording (titles, e.g. "QUARANTINE") | NOT DETERMINED |
| Language of captions | NOT DETERMINED (English layout exists; other languages not checked) |

## What would determine it (any one is enough to start)

1. A **PDF of a current label** (from ZQUARAN print preview, or a stored copy), with real values blacked out or replaced by DEMO values.
2. A **photo or scan** of a printed label, with real values blacked out, plus its physical size.
3. The details read from SFP in display mode: the field bindings, captions, barcode settings and page size. These are the same steps as for finding the barcode field.

## How the data reaches the app today (Step 1)

- The app receives **only a finished PDF**. `QuarantineLabelAdapter` calls `Z_MM_QUAR_LABEL_PDF`, which exports `EV_PDF`; the label rows stay inside SAP.
- `Z_MM_QUAR_LABEL_DATA` builds the rows, but it is a normal function module: TFDIR FMODE is blank (READ-ONLY check, 2026-10-26). The app can't call it.
- Smallest read-only data source options, none built:
  1. **Make `Z_MM_QUAR_LABEL_DATA` remote-enabled** and add a CAP function that returns its `ET_FINAL` rows, behind the existing plant authorization.
     - One source of truth for the label data, identical to the SAP form.
     - Setting the RFC flag is an **SAP write** to `Z_MM_QUAR_LABEL_DATA`. That object is not on the list of objects you said not to touch, but the task says "No SAP writes", so it needs your written go.
  2. **Rebuild the rows in CAP** from read-only table reads (`MATDOC`/`MSEG`, `LTAP`, `MAKT`, `MCH1`, `BUT00`, `AUSP`), mirroring ZMM_R_062.
     - No SAP write.
     - Duplicates the ABAP logic in JavaScript, so the two can drift apart.
     - Field names of those tables are Not verified for this system until a DD03L check.
