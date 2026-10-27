# 4 x 6 in quarantine label: copy of Adobe form ZMM_AF_017

For the ABAP developer. Draft, 2026-10-27. Nothing below has been created or changed in SAP.

## Decision and limits

- The user chose this route in their own words: "ZQUAR label from ZQUARAN, option 1".
- The user also set these limits: "Do NOT modify the original form, ZMM_R_062 or ZQUARAN. No SAP writes."
- Result: the 4 x 6 layout is a **new copy** of `ZMM_AF_017`. The original form, report `ZMM_R_062` and transaction `ZQUARAN` stay unchanged.

| Item | Value | Source |
| --- | --- | --- |
| Page | 101.6 x 152.4 mm (4 x 6 in), portrait | User request ("portrait unless I say otherwise") |
| New form name | **NOT PROVIDED** | Do not invent; the user names it |
| Printer resolution | **PENDING** (203 or 300 dpi) | Not given |
| Transport request | **NOT PROVIDED** | Needed only for the transportable route below |

## 1. What is known about ZMM_AF_017 (READ-ONLY, 2026-10-27)

Evidence: `docs/evidence/2026-10-27/zquaran-4x6/form-header-interface.json`. This was read with RFC_READ_TABLE only, after checking every field name in DD03L. No user, host or client values were stored.

| Object | Fact | Evidence |
| --- | --- | --- |
| Form | `ZMM_AF_017`, active (STATE `A`), interface `ZMM_FI_017`, last changed 2026-09-28 | FPCONTEXT, FPLAYOUT |
| Layout | Layout type `S`; English layout exists (FPLAYOUTT LANGUAGE `E`) | FPLAYOUT, FPLAYOUTT |
| Interface | `ZMM_FI_017`, active, last changed 2025-09-05 | FPINTERFACE |
| Data | One table `GT_FINAL` of type `ZMM_TT_026`; its row type is structure `ZMM_S_013` | DD40L; `docs/evidence/2026-10-26/zquaran/generated-form-contract.json` |
| Generated function | `/1BCDWB/SM00000137` | `docs/evidence/2026-10-26/zquaran/generated-form-contract.json` |

**Not readable over RFC, so not verified:** page size, margins, master pages, fonts, barcode type, which value is barcoded, and which `ZMM_S_013` fields are actually placed on the label.
- These are stored in raw-string (`RSTR`) fields: `FPLAYOUT-LAYOUT`, `FPCONTEXT-CONTEXT` and `FPINTERFACE-INTERFACE` (types confirmed in DD03L).
- RFC_READ_TABLE cannot return raw-string fields.
- Open the original in transaction SFP (display only) and record these before designing the copy.

### Fields available to the form (`ZMM_S_013`, DD03L)

"Filled by" refers to lines in `docs/abap/z_mm_quar_label.fugr.abap`, which ports the label rows of ZMM_R_062.

| Field | Type, length | Filled by | Long value? |
| --- | --- | --- | --- |
| MAKTX | CHAR 40 | material description (line 233) | yes, wrap |
| MBLNR | CHAR 10 | material document (224) | no |
| BUDAT_MKPF | DATS 8 | posting date (225) | no |
| ZZCUST_BATCH | CHAR 20 | batch `CHARG` (238) | maybe, shrink |
| MENGE | QUAN 13,3 | not set in the port | Not verified whether printed |
| ATWRT | CHAR 70 | characteristic value (258) | yes, wrap |
| LIFNR | CHAR 10 | not set in the port | Not verified whether printed |
| NAME1 | CHAR 40 | supplier name `NAME_ORG1` (244) | yes, wrap |
| HSDAT | DATS 8 | manufacturing date (228) | no |
| LICHA | CHAR 15 | supplier batch (239) | maybe, shrink |
| VEMNG | QUAN 15,3 | not set in the port | Not verified whether printed |
| LV_TEXT | QUAN 13,2 | = VSOLM (219) | no |
| MEINS | UNIT 3 | unit (218) | no |
| VSOLM | QUAN 13,3 | TO quantity (217) | no |
| CONT | CHAR 20 | "n OF total" container count (214) | no |
| TEXT | CHAR 50 | user text `IV_TEXT` (268) | yes, wrap |
| NLENR | CHAR 20 | destination storage unit (220) | maybe, shrink |
| DATE_FROM | DATS 8 | retest or expiry date (261, 264) | no |
| QTY_R | CHAR 100 | quantity text "qty unit" (227) | shrink (normally short) |
| ZDATE | CHAR 20 | caption "Retest Date" / "Expiry Date" (262, 265) | no |
| ERFME | UNIT 3 | not set in the port | Not verified whether printed |

**Rule: keep exactly the fields and captions the original prints.** Adding or removing a field needs the user's list; none has been given.

## 2. Create the copy (SFP)

1. SFP → Form `ZMM_AF_017` → Copy → new name **NOT PROVIDED**. Keep interface **`ZMM_FI_017`**. The wrapper only accepts forms on that interface (section 4).
2. In the copy's layout (Adobe LiveCycle Designer), set the master page:
   - paper type: custom;
   - width 101.6 mm, height 152.4 mm;
   - orientation: portrait.

   The exact Designer menu path on this system is Not verified.
3. Content area (safe margins): **5 mm on every side** (printable area 91.6 x 142.4 mm). This follows the HU label style (section 3a); it replaces the earlier 3 mm proposal. If the printer's stated unprintable margin is larger, use that instead (printer PENDING). No object may extend outside the content area.
4. Place the fields from section 1 in the same order and with the same captions as the original.
5. One label row = one page. Use the same pagination as the original: one `GT_FINAL` row per label. How the original paginates is Not verified; confirm it in SFP.

## 3. Long values: wrap or shrink, never overflow

| Field kind | Rule |
| --- | --- |
HU style (section 3a) sets the font sizes; this section says what happens when a value is too long.

| Field kind | Rule |
| --- | --- |
| Material description (MAKTX) | Level 2: 13 pt bold, fixed size. Wrap at word boundaries, at most 3 lines; if it still doesn't fit, the third line ends with "…". No shrinking (HU rule). |
| Other descriptive values (NAME1, ATWRT, TEXT) | Level 3: 10 pt regular, fixed size. Wrap, at most 2 lines (ATWRT 3); then "…" on the last line. |
| Identifiers (ZZCUST_BATCH, LICHA, NLENR, QTY_R) | Single line, never wrapped or cut with "…", because a partial batch or storage-unit number is misread. Shrink to fit, down to 7 pt. If it doesn't fit at 7 pt, the layout gives that field more width. The HU label treats its own identifier the same way (`HuLabelLayout.js:126`, `:216`). |
| Dates, units, quantities | Level 3, fixed size; short by type. |

Wrap, "…", shrink-to-fit and clipping in Adobe forms need field properties or a form script. How the installed ADS version behaves is Not verified, so the test in section 7 checks each rule with the long DEMO values.

## 3a. Visual design: HU label style (user decision)

The user chose: "SAP form, HU style (Recommended)". The SAP form copy keeps the data and fields of section 1, but its visual design copies the app's Handling Unit label (`wm/handling-unit`). The app keeps rendering nothing itself: the PDF still comes from SAP.

Reference implementation (browser, jsPDF): `app/fiori-app/webapp/modules/wm/handling-unit/util/HuLabelLayout.js`, `HuLabelPdf.js`, `Barcode.js`. The HU label has no 4 x 6 size; the closest is size **E**, 100 x 100 mm, the same width class (`HuLabelLayout.js:43`). The rules below take size E's values and extend them to the taller 152.4 mm page.

| HU rule | Value to use on the 4 x 6 form | HU source |
| --- | --- | --- |
| Margin (pad) | 5 mm on every side | `HuLabelLayout.js:43` (E pad 5) |
| Colour | Pure black only, no grey (thermal printers dither grey) | `HuLabelLayout.js:23-24` comment; `HuLabelPdf.js` sets black fill/text |
| Font | Helvetica (Arial is metric-compatible) | `HuLabelLayout.js:50` comment |
| Level 1, main identifier under the barcode | 20 pt bold; may shrink to 70 % (not below 6.5 pt) to fit; never truncated | `HuLabelLayout.js:30` (E huNumber 20 pt), `:126` |
| Level 2, material description (MAKTX) | 13 pt bold, line height 1.15, at most 3 lines | `HuLabelLayout.js:30`, `:43` (materialLines 3) |
| Level 3, other values | 10 pt regular | `HuLabelLayout.js:30` |
| Level 4, captions | 7.5 pt bold, upper case, above each value | `HuLabelLayout.js:30` |
| Order, top to bottom | material description block → barcode → level-1 value directly under the barcode → caption/value rows | `HuLabelLayout.js:141-143` |
| Spacing | at least 0.8 mm between blocks; level-1 value 1.0 mm under the barcode | `HuLabelLayout.js:11-12` |
| Barcode | Code 128, height 37 mm, centred, quiet zone 10 modules each side | `HuLabelLayout.js:43` (barcodeH 37), `Barcode.js:4`, `:18` |
| Barcode bar width | narrow bar = whole number of printer dots, at least 3 dots and at least 0.25 mm; never scaled to an in-between width | `HuLabelLayout.js:16-18`, `:43` (minBarMm 0.25), `:202` |
| Long text | wrap at word boundaries; a single over-long word is broken by character; when lines run out, the last line ends with "…" | `HuLabelLayout.js:88` (`wrap`), `:76` (`ellipsize`) |
| Barcode and its digits | never shrunk or truncated; if the value is too dense for the width, the layout is wrong, not the data | `HuLabelLayout.js:216` (`fits`) |
| Values in a two-column row | each value is kept inside its half and ends with "…" if too long — **for descriptive values only**; identifiers follow section 3 and are never cut | `HuLabelPdf.js:56` comment |

**Still to decide, NOT PROVIDED:**
- **Which quarantine field is the level-1 identifier and is barcoded.** The HU label uses the HU number. For the quarantine label, the original form's barcoded field is Not verified (section 4), and the user has not named one.
- **Which section-1 fields go in the caption/value rows, and in what order.** Keep the original's fields (section 1); only their arrangement changes.

**Not verified in Adobe forms:** automatic "…" truncation and word/character wrap like `wrap()` are not standard text-field behaviour. They need a script in the form or a fixed-size field that clips. Check this in the SFP test (section 7); if "…" isn't possible, a clipped value inside its own box is the fallback (section 3).

**Finding (not changed):** the HU label's captions ("MATERIAL NAME", "CREATED DATE", "SR NO") are fixed English strings in `HuLabelPdf.js:37, 59, 64` and `HuLabelPrinter.js:121, 140, 144`, not i18n. The quarantine form takes its captions from the SAP form's own texts.

## 4. Barcode

- **Type and value:** HU style uses Code 128 (section 3a). The original form's barcode type and barcoded field are Not verified (they're in the layout; read them in SFP). If the original is not Code 128, or its barcoded field differs from the one the user names, the user decides which to follow.
- **Module width:** the narrow bar must be a whole number of printer dots. Otherwise a thermal printer rounds the bars and the code can become unreadable.

  | Printer | 1 dot | Narrow bar, 2 dots | Narrow bar, 3 dots |
  | --- | --- | --- | --- |
  | 203 dpi | 0.125 mm | 0.250 mm | 0.375 mm |
  | 300 dpi | 0.0847 mm | 0.169 mm | 0.254 mm |

  The dpi is **PENDING**, so pick the column after the user confirms the printer.
- **Quiet zone:** at least 10 x narrow bar on both sides for a linear (Code 128 type) code. The barcode plus quiet zones must fit inside the 95.6 mm content width.
- **Height:** at least 12.7 mm for a linear code. The human-readable text stays under the bars, and its font may shrink only down to 7 pt.

## 5. Wrapper change (draft in `docs/abap/z_mm_quar_label.fugr.abap`)

- `Z_MM_QUAR_LABEL_PDF` gets a new import parameter: `IV_FORM TYPE FPNAME DEFAULT 'ZMM_AF_017'` (optional by its default).
  - Callers that omit it get the current form, so the change is backward compatible.
  - The CAP app sends `IV_FORM` only when a form is configured for the plant.
- **Guard:** `IV_FORM` must be an active form whose `FPCONTEXT-INTERFACE` is `ZMM_FI_017`; otherwise `EV_RESULT = INVALID_INPUT`. A caller therefore cannot render an unrelated form with label data.
- **Messages:** they now name `IV_FORM` instead of the fixed form name.
- **SAP status:** the version active in DEV client 220 since 2026-10-26 does **not** have `IV_FORM`. `tools/adt-create-quar-label.js` only creates objects, so the ABAP developer applies this change in SE37/ADT. Activating it is an SAP write and needs a separate written go.

## 6. CAP / Fiori configuration (this repo)

- **Per-plant settings** (BusinessConfig, admin API `/odata/v4/business-config`):
  - `QuarantineLabelForm`: the new form name (A–Z, 0–9, `_`, `/`, at most 30 characters).
  - `QuarantineLabelSize`: `4x6`.
  - Both empty (the default): the current form and no size check.
  - If a document spans plants with different settings, the request is refused (HTTP 409); the app doesn't pick one.
- **Order matters:** configure `QuarantineLabelForm` only after the wrapper with `IV_FORM` is active. The currently active wrapper does not accept the parameter, so that call would fail.
- **PDF and size warning:**
  - The PDF is passed through unchanged.
  - `srv/wm/quarantine-label/labelOutput.js` reads the first MediaBox (`pdfPageSize`).
  - If `4x6` is configured and the page is not 288 x 432 pt (± 1 pt), the screen shows warning `qlPageSizeMismatch`, or `qlPageSizeUnknown` if the size can't be read. Preview, print and download stay available.
- **Local dev database:** run `db-migrate-20261027-quarantine-label.sql` on `db.sqlite` (back it up first); deployed HANA gets the columns on deploy.

## 7. Test in SAP (preview only, no printing)

1. SFP → the copy → Activate → Test, or SE37 on its generated function. Use synthetic `GT_FINAL` rows only (e.g. MAKTX `DEMO MATERIAL WITH A VERY LONG DESCRIPTION 40C`, ZZCUST_BATCH `DEMO-BATCH-0000001`, TEXT 50 x `W`). Print preview only; don't send to a printer.
2. Check:
   - the PDF document properties show the page size as 4.00 x 6.00 in;
   - one label per page;
   - nothing is clipped at the content-area edge;
   - long values wrap or shrink as in section 3;
   - the barcode scans.
3. After the wrapper change is active and the plant is configured, preview in the app. The message must say the labels are ready with no size warning (PageSizeOk true).
4. Print one test label at 100% scale ("actual size", no fit-to-page, browser headers/footers off) on the 4 x 6 printer. Measure it.

## 8. Transport

- **Copy of the form:** create it in package **ZAMM**. ZAMM is transportable: TDEVC read READ-ONLY on 2026-10-26 shows DLVUNIT HOME, parent ZDS4. Record it on a workbench request (number **NOT PROVIDED**).
- **Wrapper function group `ZMM_QUAR_LABEL`:** it is currently in `$TMP` (local, cannot be transported). Before QA/production it must be reassigned to ZAMM on a request (SE03 object directory entry, or re-create it in ZAMM). Which of these to use is the user's decision.
- **Release order:** form (SFPF) and function group on the same request, or the form first. Release in SE09/SE10, import with STMS. Repeat the test in section 7 in QA.
- **CAP side:** set the two BusinessConfig fields per plant only in each environment where the transport has been imported.
