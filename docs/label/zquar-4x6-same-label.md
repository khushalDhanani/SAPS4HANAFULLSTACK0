# ZQUAR quarantine label at 4 x 6 in (same label, bigger barcode)

Status 2026-10-27: Phase A (renderer, tests, DEMO sample) and Phase B (data mapping, screen action) done with synthetic data. No SAP calls; live SAP data not yet read through this path.

## User decisions (quoted)

| Decision | User's words |
| --- | --- |
| Size | "Size will be my", "I want to change this size 4*6" (4 x 6 in = 288 x 432 pt) |
| Barcode | "Increase size of barcode" |
| Caption rule conflict | "9 pt captions, +1 pt x (Recommended)" |
| Strip texts | "Stretch length x1.5 (Recommended)" |

The numbers in the task are the design, not decisions.

## Files

| Part | File |
| --- | --- |
| Layout (measured base, sizes, dpi, fitting, barcode, draw list) | `app/fiori-app/webapp/modules/wm/quarantine-label/util/ZquarLabelLayout.js` |
| PDF (jsPDF, pt, one label per page) | `app/fiori-app/webapp/modules/wm/quarantine-label/util/ZquarLabelPdf.js` |
| Code 128 subset B on request (HU default unchanged) | `app/fiori-app/webapp/modules/wm/handling-unit/util/Barcode.js` |
| Static texts and captions | i18n `zq*`, both bundles |
| Tests | `test/unit/wm/zquarLabel.test.js` (22) |
| Sample (synthetic DEMO, 14 containers) | `docs/label/samples/zquar-4x6-same-DEMO.pdf`; PNGs `…-p1.png`, `…-p2-long.png`, `…-p3-empty.png`; regenerate with `node tools/generate-zquar-label-sample.js [--dpi 300]` |

## Field-by-field: current (measured, 288 x 288) vs new (rendered, 288 x 432)

Positions in pt, top-left origin, "top" = text-box top. The "new" column is read from the layout code, not copied from the task.

| Element | Current (MEASURED) | New 4 x 6 (rendered) | Change |
| --- | --- | --- | --- |
| Page | 288 x 288 | 288 x 432, MediaBox `[0 0 288 432]` | size (decision) |
| Vertical rule | x 36.7, y -0.2..227.1, 0.5 | x 36.7, y 0..336, 0.5 | longer strip |
| Horizontal rule | y 34.5, x 35.8..273.9, 0.5 | y 51.75, x 35.8..273.9, 0.5 | y x 1.5 |
| Title | Bold 16, centred x 36..274, top 13.2 | Bold 18, centred x 36..274, top 19.8 (width 217 of 238) | bigger |
| QUARANTINE (strip) | bold ~14, rotated, x 5..19, y 66..160 | bold 14, rotated, stretched x 1.5, x 11.3..24.3, y 98..238 (centred) | decision; 4 mm edge margin |
| Form number (strip) | ~7 (checked: 8), rotated, x 23..31, y 52..170 | 9, rotated, stretched x 1.5, x 25.8..34.1, y 64.8..271.2 | 9 pt minimum |
| Material Name | caption 9.5 x 38.8 / value 9.5 x 102.9, top 38.8 | caption 9 x 38.8 / value 11 x 103.9, top 58.2; 2 lines | gap 4.1 pt |
| GRN No. | top 67.6, value 9.0 | top 101.4, value 10.5, ends ≤ 169.8 | |
| GRN Date | caption x 173.8 top 68.4, value 9.0 x 226.2 | caption x 173.8 top 102.6, value 10.5 x 226.2 | |
| INW. No | top 83.4 | top 125.1 | |
| Qty. Received | top 100.8 (caption touches value) | top 151.2, value ends ≤ 165.9, gap 5.6 | collision fixed |
| Container No | caption x 169.9, value x 230.7, top 100.8 (touches "1 OF 14") | same x, top 151.2, gap 4.3 | collision fixed |
| Manufacturer | top 117.5, 26.5 pt reserved, may be empty | top 176.3, 2 lines, empty keeps its space | |
| Supplier | top 144.0, up to 2 lines | top 216.0, 2 lines | |
| Batch No | top 166.2 | top 249.3 | |
| Mfg. / Expiry / Net Weight captions | top 181 at x 38.8 / 114.4 / 208.4 | top 271.8, same x, 9 pt | |
| Date values | top 193.9 at x 38.8 / 119.8 / 214.4 | top 290.9, same x; 11 / 11 / 10.5 pt | |
| Prepared by | caption top 212.5, blank area | caption top 318.8, blank area | |
| Barcode | Code 128 B, 10 chars, 40 bars, module 0.844 pt, bars x 36.36..158.74, y 234..261 (27 high), no left quiet zone | Code 128 B, 40 bars, module 1.4187 pt = 4 dots @ 203 dpi (0.5 mm), quiet zone from x 38.7, bars x 52.8..258.5, y 340..402 (62 high), 10-module quiet zones | bigger (decision); quiet zones added |
| Human-readable | Helvetica 11, x 47.8, top 263.5 | Helvetica 13, x 63.4 (10.6 from bar start), top 405..418 | bigger |
| Bottom margin | — | 14 pt below the number | ≥ 10 pt |

**Deviations from "same" (all agreed or forced by the rules):**
- A 4 pt caption–value gap. To make room, captions are 9 pt and the left value column moved +1 pt (your decision).
- The strip texts are stretched along the strip (your decision) and moved inside the 4 mm edge margin.
- The form number grew from 8 to 9 pt (9 pt minimum).
- The barcode now has quiet zones (today it has none on the left).

## Rules and limits

- **Long values:** Material Name, Manufacturer and Supplier wrap to 2 lines, then shrink to 9 pt, then end with "…". Single-line values shrink to 9 pt, then "…". A shortened value produces a warning.
- **Barcode width:** the 0.5 mm target, else the largest whole-dot module that fits, never below 0.375 mm. If even that doesn't fit, it fails with a clear error; it never squeezes or scales.
  - **300 dpi:** the 6-dot target (1.44 pt) does not fit 10 characters, because 165 modules need 237.6 pt and only 235 pt is available. The renderer uses **5 dots (0.423 mm)**, following the fallback rule; the task's "6 dots at 300 dpi" holds only for values up to about 9 characters.
- **Pages:** one page per row; rows are one per container ("n OF total"). Every page's MediaBox is exactly 288 x 432; `/PrintScaling /None`.
- **Static texts and captions:** title, QUARANTINE and the form number come from i18n (`zq*`). They are not in the renderer.

## INFERRED / not verified

- The baseline offset 0.79 x font size (text-box top → baseline) is INFERRED from three texts in the sample: the title, GRN No. and the barcode number.
- Which data field the barcode encodes: UNKNOWN. In the sample the number appears only under the barcode.
- Phase A checks are on-screen only. A physical print at 100 % and a scan with a real scanner are not done; nor is a second sample page (the attached file has 1 page, not 10).

## Phase B — data source and screen action

**Data source** (user's words): "Phase B: use option 2 (CAP read-only table reads, already committed). Map the new label fields to it, add the print/download action, printer dpi stays 203."
- Rows come from `QuarantineLabelService.labelRows`: read-only RFC_READ_TABLE, one row per container (`docs/label/zquar-4x6-design.md`, "How CAP rebuilds the rows").
- `ZquarLabelRows.toLabels` maps them to label fields: `app/fiori-app/webapp/modules/wm/quarantine-label/util/ZquarLabelRows.js`.

**Mapping.** The format shapes were measured in the user's sample without reading values; digits are shown as 9 and letters as A.

| Label field | Source (CAP row ← SAP) | Format on the label | Evidence / decision |
| --- | --- | --- | --- |
| Material Name | MaterialDescription ← MAKT-MAKTX | as is | INFERRED, confirmed: "Yes, use them" |
| GRN No. | MaterialDocument ← MSEG-MBLNR | 9999999999 | shape matches MBLNR CHAR 10; confirmed |
| GRN Date | PostingDate ← MSEG-BUDAT_MKPF | DD/MM/YYYY | shape 99/99/9999; day first MEASURED (a first part > 12) |
| INW. No | Text ← the screen's "Label Text" input (report P_TEXT) | as typed | user: "The Label Text input" |
| Qty. Received | PostedQuantity ← MSEG-MENGE (2 decimals) + " " + MEINS | 999.99 UoM | shape `999.99 AA` matches the report's QTY_R |
| Container No | Container ← "n OF total" | 9 OF 99 | MEASURED |
| Manufacturer | BatchCharacteristics ← AUSP 818 + 828 | as is | user: "Batch characteristics" (meaning of 818/828 not verified) |
| Supplier | SupplierName ← BUT000-NAME_ORG1 | as is | INFERRED, confirmed |
| Batch No | SupplierBatch ← MCH1-LICHA | as is | user: "Supplier batch (LICHA)" |
| Mfg. Date | ManufacturingDate ← MSEG-HSDAT | DD/MM/YYYY | INFERRED, confirmed |
| Expiry Date | DateValue ← AUSP 9999999400 (or 820 retest) | DD/MM/YYYY | confirmed; a retest date prints the caption "Retest Date" (INFERRED from the report's ZDATE) |
| Net Weight | ContainerQuantity ← LTAP-VSOLM, 2 decimals half up + MEINS, no space | 99.99UoM | shape `99.99AA` matches LV_TEXT (QUAN 13,2); confirmed |
| Barcode + number | StorageUnit ← LTAP-NLENR, leading zeros removed (numeric only) | 10 digits in the sample | elimination (printed nowhere else); confirmed |

**Screen:**
- The existing **"4x6 Labels"** button, beside the unchanged **"Preview Labels"** (SAP PDF), now draws this label.
- Print and Download act on the shown PDF.
- Printer dpi is the layout's 203 default.
- A storage unit too long for the barcode stops the whole PDF with "Label n: the storage unit is too long…" (i18n). Nothing is squeezed.

**Removed (superseded):** the fully customised renderer (`QuarLabelLayout.js`, `QuarLabelPdf.js`), its test, sample tool, sample PDF and 21 i18n keys.

**Browser check:** the bundled browser jsPDF (2.5.2) generated a 2-page PDF from mocked DEMO rows. Every MediaBox is 288 x 432, and the stretch (`150 Tz`) applies only to the strip texts. Render: `docs/label/samples/zquar-4x6-same-DEMO-browser.png`.
