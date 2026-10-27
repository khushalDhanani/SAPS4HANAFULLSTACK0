# Current ZQUAR quarantine label: what the repo proves (2026-10-27)

Purpose: the baseline for "SAME label as today, only the size changes" (4 x 6 in, 101.6 x 152.4 mm, 288 x 432 pt; the user's size decision: "Size will be my").

Source rule: files in this repo only, no SAP calls. Anything not proven by a cited file is **NOT DETERMINED**.

> **Update 2026-10-27:** the user first chose a new design ("I need Fully Customised. understand."), then asked for the SAME label at 4 x 6 with a bigger barcode, measured from their sample. The measured layout is below; the earlier "NOT DETERMINED" rows are replaced by it.

## Result (before the sample)

**From the repo alone, the current layout could not be determined.**
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

## Current layout — MEASURED (2026-10-27)

Source: the user's sample label PDF, measured by the user and given in their task (the "MEASURED" column). The sample is **not** in the repo and must not be committed: it holds real business data. I spot-checked it locally without copying or printing its values ("Checked" column).
- **Units and origin:** pt; origin top-left; y = top of the text box.
- **Fonts:** Helvetica and Helvetica-Bold only (checked).
- **Pages:** the file checked (`14_6ZQuran0SAPS4HANAFiori.pdf`, 2,132 bytes) has **1 page** (`/Count 1`). The task describes 10 pages, so the 10-page file was not checked.

| Item | MEASURED (user) | Checked in the sample |
| --- | --- | --- |
| Page | 288 x 288 pt; content area x 36..274; left strip x 0..36 | MediaBox `0 0 288 288` |
| Vertical rule | x 36.7, y -0.2..227.1, 0.5 pt | x 36.72, y -0.25..227.05, 0.5 pt |
| Horizontal rule | y 34.5, x 35.8..273.9, 0.5 pt | y 34.51, x 35.75..273.85, 0.5 pt |
| Title "Aether Industries Limited" | Helvetica-Bold 16, centred over x 36..274, top 13.2 | 16 pt bold, starts x 58.3 |
| Strip: "QUARANTINE" | bold ~14 pt, rotated 90° counter-clockwise, x 5..19, y 66..160, static | 14 pt bold, rotated |
| Strip: form number "F-06-00-SOP-WH-002-01/09/2016" | Helvetica ~7 pt, rotated, x 23..31, y 52..170, static | **8 pt** regular, rotated |
| Captions | Helvetica-Bold 9.5 at x 38.8 | 9.5 pt bold, x 38.8 |
| Values | Helvetica 9.5 at x 102.9 (9.0 for the GRN values) | 9.5 pt at x 102.9; GRN values 9 pt |
| Material Name | top 38.8 | — |
| GRN No. | top 67.6 | — |
| GRN Date | caption x 173.8 top 68.4, value x 226.2 | caption x 173.8, value x 226.2 (9 pt) |
| INW. No | top 83.4 | — |
| Qty. Received | top 100.8 | — |
| Container No | caption x 169.9, value x 230.7 = "n OF total", top 100.8 | value x 230.7 |
| Manufacturer | top 117.5; value may be empty; 26.5 pt reserved | — |
| Supplier | top 144.0, up to 2 lines | — |
| Batch No | top 166.2 | — |
| Date columns, captions top 181 | "Mfg. Date" x 38.8, "Expiry Date" x 114.4, "Net Weight" x 208.4 (9.0) | x 38.8 / – / 208.4 (9 pt) |
| Date columns, values top 193.9 | x 38.8, 119.8, 214.4 (9.0) | x 38.8, 119.8, 214.4 (9 pt) |
| Prepared by | caption top 212.5; value area blank (handwriting) | caption x 38.8 |
| Barcode | x 37.2..157.9, y 234..261 (27 pt), 40 bars, 1–4 modules, module 0.844 pt | 40 bars, 145 modules, module 0.844 pt, bars y 234..261; **bar edges x 36.36..158.74** |
| Barcode symbology | INFERRED: Code 128 B, 10 characters | **Decoded:** start code B, 10 data characters (all digits), valid checksum, valid stop pattern |
| Barcode content | INFERRED: same number as printed below | **Decoded value equals the printed number**; that number appears nowhere else on the label, so the data field it comes from is UNKNOWN |
| Human-readable number | Helvetica 11, x 47.8, top 263.5 | 11 pt regular, x 47.8 |
| Known defects (user) | "Qty. Received" touches its value; "Container No" touches "1 OF 14" | confirmed by width: Qty. Received ends x 101.6 (value 102.9); Container No ends x 229.5 (value 230.7) |
| Further defects found | — | "Material Name" at 9.5 pt ends x 103.2, **overlapping** its value at 102.9; "Manufacturer" ends x 99.0, gap 3.9 pt; the barcode has **no left quiet zone** (first bar at x 36.36, left of the vertical rule) |

Caption widths are Helvetica-Bold AFM widths (the metrics the renderer uses). The barcode was decoded with the Code 128 table in `app/fiori-app/webapp/modules/wm/handling-unit/util/Barcode.js`; the decoded value was never printed or stored.

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
