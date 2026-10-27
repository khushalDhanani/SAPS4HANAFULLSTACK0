# 4 x 6 in quarantine label: copy of Adobe form ZMM_AF_017

For the ABAP developer. Draft, 2026-10-27. Nothing below has been created or changed in SAP; no SAP call was made to write it.

## Decisions and limits

User decisions, in the user's words:
- "Size will be my": 4 x 6 in.
- "Increase size of barcode".
- "get the same as from the programme": the label comes from the SAP Adobe form, not from a browser rebuild.
- "10 pt everywhere (Recommended)": resolves a width conflict in the layout proposal (section 3).
- "printer dpi stays 203".
- Earlier: "ZQUAR label from ZQUARAN, option 1".

Limits set by the user:
- Do not modify `ZMM_AF_017`, `ZMM_R_062`, `ZQUARAN` or `Z_MM_QUAR_LABEL_PDF` in SAP.
- The 4 x 6 label is a **new copy** of `ZMM_AF_017`.

The mm values in section 3 are a design proposal, not user decisions. Adjust them in the Designer preview but keep the principles.

| Item | Value | Status |
| --- | --- | --- |
| Page | 101.6 x 152.4 mm (288 x 432 pt), portrait | user decision |
| New form name | — | **NOT PROVIDED / PENDING** (user / developer; do not invent) |
| Printer | 203 dpi | user: "printer dpi stays 203"; model **PENDING** |
| Output device, page format in SPAD | — | **PENDING** (Basis) |
| Transport request | — | **PENDING** (developer) |
| Package of the copy | ZAMM proposed (transportable: TDEVC READ-ONLY 2026-10-26, DLVUNIT HOME, parent ZDS4) | **PENDING** (developer) |

## 1. What is known about the original

| Fact | Evidence |
| --- | --- |
| `ZMM_AF_017`: active, interface `ZMM_FI_017`, layout type `S`, English layout | `docs/evidence/2026-10-27/zquaran-4x6/form-header-interface.json` (READ-ONLY) |
| Data: one table `GT_FINAL` (`ZMM_TT_026`, row `ZMM_S_013`); generated function `/1BCDWB/SM00000137` | `docs/evidence/2026-10-26/zquaran/generated-form-contract.json` |
| Current layout: page, every text, the rules and the barcode, MEASURED from the user's sample PDF | `docs/label/zquar-current-layout.md` |
| Barcode: Code 128 **subset B**, 10 digit characters, valid checksum. The printed number equals the encoded value. | MEASURED (decoded locally from the sample's 40 bars). It was INFERRED until decoded; decoding was done without printing the value. |

**Which `ZMM_S_013` field the barcode is bound to is not verified.** Copying the form keeps every field binding, so the copy prints the same fields and the same barcode content without re-binding. Read the binding in SFP if needed (Object palette → Binding).

## 2. Create the copy (SFP)

1. **Copy the form:** SFP → Form `ZMM_AF_017` → Copy → new name (**PENDING**). Keep interface **`ZMM_FI_017`**: the wrapper only accepts forms on that interface (section 6).
2. **Keep everything except the layout:**
   - all fields, bindings, captions/static texts and their wording and order;
   - the barcode's symbology and bound field.

   Only geometry changes: page, positions, font sizes, barcode size.
3. **Master page:** custom paper 101.6 x 152.4 mm, portrait. The exact Designer menu path on this system is Not verified.

## 3. Layout proposal (mm, origin top-left, "top" = top of the text field)

**Principles (keep them when adjusting):**
- one font size for captions and values, **10 pt** (user: "10 pt everywhere");
- caption and value of a row on a **shared baseline**;
- at least **4 pt (1.41 mm)** between a caption and its value;
- the three date columns left-align header and value to the same x;
- empty values keep their space;
- minimum font size 9 pt;
- 4 mm safe margin on the page edges;
- nothing overlaps.

**Why 10 pt, not 11:**
- At 11 pt the row "Qty. Received + Container No" needs 89.0 mm of the 83.0 mm content width with 4 pt gaps (Helvetica-Bold/Helvetica metrics).
- At 10 pt it needs 81.3 mm.
- At 11 pt, "Material Name" (26.3 mm) also doesn't fit before a value column at x 36.3.

| Element | Proposal |
| --- | --- |
| Strip | x 0..12.7. Texts inside the 4 mm margin, x 4.0..12.7. "QUARANTINE" bold ~14 pt and the form number "F-06-00-SOP-WH-002-01/09/2016" regular 9 pt, both rotated 90° counter-clockwise (read bottom to top), centred on the strip height (y 0..112 → centre 56). Sizes are a proposal: two bands fit in 8.7 mm only up to about 15 pt + 9 pt. |
| Vertical rule | x 12.9, y 0..112, 0.5 pt |
| Content | x 13.7..96.7 (83.0 mm) |
| Title "Aether Industries Limited" | Helvetica/Arial Bold 18 pt, centred over the content, top 4.5 (width 76.6 mm of 83) |
| Horizontal rule | y 18.0, x 13.7..96.7, 0.5 pt |
| Left captions / values | captions x 13.7 bold 10 pt; values x **39.1** regular 10 pt (widest caption "Material Name" 23.9 mm + 1.41 mm) |
| Right pair, GRN row | "GRN Date" caption x **60.2**, value x **78.1** (GRN No. value up to 10 digits; date ends 95.8) |
| Right pair, Qty row | "Container No" caption x **57.6**, value x **81.2** ("99 OF 99" ends 95.9; Qty value room 17.1 mm) |
| Row tops | Material Name 21.0 (2-line slot 11); GRN No. / GRN Date 33.0; INW. No 40.5; Qty. Received / Container No 48.0; Manufacturer 55.5 (2-line slot 11); Supplier 66.5 (2-line slot 11); Batch No 77.5; date headers 86.0, date values 91.5; Prepared by 102.0 (blank area for handwriting) |
| Date columns | Mfg. Date x 13.7, Expiry Date x **39.1**, Net Weight x **66.0**; header and value at the same x |
| Barcode | bars top 117, height 22; narrow bar 0.5 mm (4 dots at 203 dpi); 145 modules = 72.5 mm for 10 characters; quiet zone ≥ 5 mm (10 modules) each side, inside x 13.7..96.7; same symbology (Code 128 B) and content. A longer value must not get a module below 0.375 mm (3 dots). |
| Human-readable number | 13 pt regular, directly below the bars, centred on the bars (top about 140, ends about 144.6; bottom margin about 7.8 mm) |

**Long values:**
- Material Name, Manufacturer and Supplier wrap to 2 lines, then shrink to 9 pt, then are cut.
- Other values shrink to 9 pt, then are cut.
- Adobe text fields: fixed-size field, "Allow multiple lines" for the three 2-line fields, and auto font size with a 9 pt minimum. How the installed ADS version behaves is Not verified, so check it in the SFP preview (section 7).

## 4. Barcode details (for the Designer barcode object)

- **Type:** Code 128, subset B (as decoded from today's label). Keep the original barcode object's binding.
- **Module:** narrow bar 0.5 mm; at 203 dpi that is 4 dots (0.5005 mm). Never set a module that isn't a whole number of printer dots.
- **Size:** 10 characters = 11 x (10 + 2) + 13 = 145 modules = 72.5 mm, plus 2 x 5 mm quiet zone = 82.5 mm. That fits the 83.0 mm content width.
- **Human-readable text:** 13 pt below the bars, centred on them. Turn off the barcode object's built-in text if it prints a second copy.

## 5. Optional: ZMM_R_062 and the new form (developer's decision; options only)

1. Leave `ZMM_R_062` / `ZQUARAN` on `ZMM_AF_017`; only the Fiori app uses the copy (through the wrapper, sections 6 and 7). No change to the report.
2. Give `ZMM_R_062` a selection-screen parameter for the form name, default `ZMM_AF_017`. This changes the report, which the user ruled out for now.
3. Copy `ZMM_R_062` to a new report and transaction for the 4 x 6 form. This is a new object; it leaves the original untouched.

## 6. Wrapper (draft in `docs/abap/z_mm_quar_label.fugr.abap`, not activated)

`Z_MM_QUAR_LABEL_PDF` gets an optional import parameter **`IV_FORM TYPE FPNAME DEFAULT 'ZMM_AF_017'`**:
- **Backward compatible:** callers that omit it get the current form.
- **Guard:** `IV_FORM` must be an active form whose `FPCONTEXT-INTERFACE` is `ZMM_FI_017`; otherwise `EV_RESULT = INVALID_INPUT`. A caller can't render an unrelated form with label data.
- **Messages** name the form used.
- **SAP status:** the version active in DEV client 220 (2026-10-26) does **not** have `IV_FORM`. Activating the draft is an SAP write by the developer (the user doesn't want `Z_MM_QUAR_LABEL_PDF` changed by this repo's tools). Transport it together with the form copy.

## 7. CAP / Fiori configuration (this repo)

- **Per-plant settings** (BusinessConfig, admin API `/odata/v4/business-config`):
  - `QuarantineLabelForm` = the new form name;
  - `QuarantineLabelSize` = `4x6`.
  - Both empty (default): the current form and no size check.
- **`IV_FORM` is sent only when a form is configured.** Before sending it, CAP checks the wrapper's interface (`RFC_GET_FUNCTION_INTERFACE`). If the active wrapper has no `IV_FORM`, the request fails with a clear error and nothing is printed.
- **The PDF is passed through unchanged.** With `4x6` configured, a PDF that isn't 288 x 432 pt (± 1 pt) shows a warning on screen (`qlPageSizeMismatch`).

## 8. Test plan

| # | Test | Who | Status |
| --- | --- | --- | --- |
| 1 | SFP preview of the copy with **synthetic** data (e.g. MAKTX "DEMO MATERIAL WITH A VERY LONG DESCRIPTION 40C", supplier "DEMO SUPPLIER WITH A LONG NAME", 50 x "W" in the text field, 10-digit DEMO barcode value); print preview only | developer | PENDING |
| 2 | `python3 tools/check-label-pdf.py <preview.pdf>` on the synthetic preview PDF: page, fonts, positions, baselines, gaps, barcode bars, module, quiet zones | developer / app team | PENDING |
| 3 | Print test on the 4 x 6 printer at 100 % (no fit-to-page), measure the label | user / Basis | PENDING |
| 4 | Scan test of the barcode at working distance with the warehouse scanner; the scanned value equals the printed number | user | PENDING |
| 5 | Output device and page format (SPAD, 4 x 6 portrait, 203 dpi) | Basis | PENDING |
| 6 | App: BusinessConfig for one DEV plant, preview via Quarantine Labels → no size warning | app team | PENDING (needs the activated wrapper and form) |

**Never commit or share a PDF with real values.** Preview and test PDFs for this repo must use synthetic data.

## 9. Transport

1. Create the form copy in a transportable package (ZAMM proposed, **PENDING**) on a workbench request (**PENDING**).
2. The wrapper function group `ZMM_QUAR_LABEL` is currently in `$TMP`. Reassign it to the transportable package (SE03 object directory entry, or re-create it there) and put it on the same request.
3. Release in SE09/SE10, import with STMS, and repeat tests 1–5 in QA.
4. Set the BusinessConfig fields per plant only in environments where the transport is imported.
