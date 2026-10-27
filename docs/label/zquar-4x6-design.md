# App-drawn 4 x 6 in quarantine label: design and comparison

Status 2026-10-27: built and tested in the app with synthetic data. The label data is rebuilt in CAP from read-only SAP table reads (no ABAP change). A live read against SAP data has not been run yet.

## User decisions (quoted)

| Decision | User's words |
| --- | --- |
| Size | "Size will be my" (4 x 6 in) |
| Design | "I need Fully Customised. understand." |
| Fields | "All fields SAP fills (Recommended)" |
| Barcode | "Storage unit (NLENR)" |
| Data source | First "Option 1: ABAP note (Recommended)", then reversed: "Do this : Option 2: CAP reads the SAP tables directly, with no ABAP change." |

**My design choices, not the user's** (change on request):
- the inverted "QUARANTINE" title band;
- the caption texts;
- the field order and two-column grid;
- ISO dates (yyyy-mm-dd);
- the "-" empty marker;
- the 5 mm safe area.

## Files

| Part | File |
| --- | --- |
| Layout (sizes, dpi, geometry, fitting, draw list) | `app/fiori-app/webapp/modules/wm/quarantine-label/util/QuarLabelLayout.js` |
| PDF (jsPDF, one label per page) | `app/fiori-app/webapp/modules/wm/quarantine-label/util/QuarLabelPdf.js` |
| Screen action | `QuarantineLabels.controller.js` `on4x6Labels`, button `ql4x6` |
| Data | CAP action `QuarantineLabelService.labelRows` → `QuarantineLabelAdapter.labelRows` / `readLabelRows` → RFC_READ_TABLE on MSEG, LTAP, MCH1, MAKT, BUT000, AUSP (fields checked in DD03L: `docs/evidence/2026-10-27/zquaran-4x6/label-source-tables-dd03l.json`) |
| Sample (synthetic DEMO, 3 labels) | `docs/label/samples/zquar-4x6-DEMO.pdf`, regenerate with `node tools/generate-quar-label-sample.js` |

Reused from the HU label: Code 128 encoder (`Barcode.js`), Helvetica metrics and word wrap (`HuLabelLayout.js`), jsPDF loader (`HuLabelPdf.js`).

## Page and print

- **Size:** inches are the source of truth in `SIZES` (`4x6` = 4 x 6 in). From them, mm (101.6 x 152.4) and pt (288 x 432) are derived. The PDF page is created in pt, so the MediaBox is exactly `[0 0 288 432]` on every page.
- **Size per plant:** `BusinessConfig.QuarantineLabelSize`; empty means the default `4x6`. Another size is a new `SIZES` entry: the layout scales from the 4 x 6 design (unit test with 3 x 5 in).
- **Printer:** 203 dpi (`PRINTER_DPI`), 300 allowed; the Code 128 narrow bar is a whole number of printer dots.
- **Pages:** one label per page, several labels per PDF.
- **Printing:** the PDF asks viewers not to scale it (`/PrintScaling /None`). It is a PDF, so browser page headers and footers do not apply. Print at "Actual size / 100 %" if the viewer still offers scaling.

## Layout (top to bottom, safe area 5 mm, never under 4 mm)

1. Title band: black, "QUARANTINE" in white, 20 pt bold.
2. Material (MAKTX): 14 pt bold, up to 2 lines.
3. Storage unit (NLENR): caption, Code 128 barcode (height 12–26 mm, depending on free space), value under it in 16 pt bold.
4. Two-column grid of captions (7 pt bold, upper case) and values (10 pt):

| Row | Left | Right |
| --- | --- | --- |
| 1 | Material Document (MBLNR) | Posting Date (BUDAT_MKPF) |
| 2 | Batch (ZZCUST_BATCH) | Supplier Batch (LICHA) |
| 3 | Supplier (NAME1), 2 lines | |
| 4 | Batch Characteristics (ATWRT), 2 lines | |
| 5 | Manufacturing Date (HSDAT) | Retest Date or Expiry Date (`DateKind`, caption from i18n) + AUSP DATE_FROM |
| 6 | Posted Quantity (QTY_R) | Container Quantity (VSOLM + MEINS) |
| 7 | Container (CONT, "n OF total") | |
| 8 | Remark (TEXT), 2 lines | |

## How CAP rebuilds the rows (report ZMM_R_062_F01, read-only)

1. **MSEG** for the document number **and year** → items (lowest ZEILE first).
2. For each material/batch pair, **LTAP** in storage types 920/902 (F01:78, :95). Matched by inbound delivery when the first MSEG item has one, otherwise by document number (`WENUM`). One label per TO item.
3. **MCH1** (supplier batch, classification object), **MAKT** in language E, **BUT000** (supplier name from MSEG-LIFNR).
4. **AUSP** for the batch object (`CUOBJ_BM` padded to 18):
   - characteristics 818 + 828 → "Batch characteristics";
   - 820 → retest date, otherwise 9999999400 → expiry date (F01:295–313).
5. Counter "n OF total" per material/batch; posted quantity rounded half up to two decimals ("120.00 KG", F01:177, :251–252).

Fixed values (storage types, characteristic numbers) are named constants in the adapter that cite the report line. The captions come from i18n.

**Differences from the report** (none changes which labels exist for a correct document):
- MSEG is restricted to the year. The report reads by number only, as `Z_MM_QUAR_LABEL_DATA` already did (accepted earlier as a documented deviation).
- "First row" reads use the lowest MSEG item and the first row SAP returns; the report's order is the database's.
- Labels sort by material, batch, TO number, TO item. The report's second `SORT` is not stable.
- Data the report reads but never prints is not read: LFA1, VEPO, VEKP.
- When an MSEG match is missing, the report keeps the previous row's supplier. CAP leaves the field empty instead.
- **INFERRED, not run for this flow:** reading MSEG through RFC_READ_TABLE works. Other adapters already do it (`GoodsIssueDashboardClient.js:225`, `ReservationProcessAdapter.js:1151`).
- **Not verified:** whether characteristics 818/828 and the "date from" of 820/9999999400 mean what the captions say is also not verified: the report uses AUSP-DATE_FROM, and the label copies it.

## Long and missing values

- **Long values:** wrap within the field's lines, then shrink down to 6 pt, then cut with "…".
- **Missing values:** a missing value prints "-".
- **Warnings:** a cut value, a missing storage unit (no barcode), a barcode too dense for whole 3-dot bars, or characters Code 128 cannot encode each produce a warning on screen. The PDF is still shown.

## Comparison with the current SAP label (ZMM_AF_017), field by field

The current label's layout is **NOT DETERMINED**: no sample in the repo, and the SAP layout cannot be read over RFC (`docs/label/zquar-current-layout.md`). The "current" column therefore shows only what the data proves.

| Field (ZMM_S_013) | Current SAP label | New 4 x 6 label |
| --- | --- | --- |
| MAKTX material description | sent to the form; printed? NOT DETERMINED | Material, 14 pt bold, top |
| NLENR storage unit | sent; printed / barcoded? NOT DETERMINED | Code 128 barcode + 16 pt value |
| MBLNR material document | sent; NOT DETERMINED | grid row 1 left |
| BUDAT_MKPF posting date | sent; NOT DETERMINED | grid row 1 right |
| ZZCUST_BATCH batch | sent; NOT DETERMINED | grid row 2 left |
| LICHA supplier batch | sent; NOT DETERMINED | grid row 2 right |
| NAME1 supplier | sent; NOT DETERMINED | grid row 3 |
| ATWRT batch characteristics | sent; NOT DETERMINED | grid row 4 (meaning of characteristics 818/828 Not verified) |
| HSDAT manufacturing date | sent; NOT DETERMINED | grid row 5 left |
| ZDATE + DATE_FROM retest/expiry | sent; NOT DETERMINED | grid row 5 right, ZDATE as caption |
| QTY_R posted quantity | sent; NOT DETERMINED | grid row 6 left |
| VSOLM + MEINS container quantity | sent; NOT DETERMINED | grid row 6 right |
| CONT container n OF total | sent; NOT DETERMINED | grid row 7 |
| TEXT remark (user text) | sent; NOT DETERMINED | grid row 8 |
| LV_TEXT | sent (= VSOLM) | not shown separately (duplicate of VSOLM) |
| MENGE, LIFNR, VEMNG, ERFME | never filled | not shown |
| Logo, lines, boxes | NOT DETERMINED | none, except the title band |
| Barcode type | NOT DETERMINED | Code 128 |
