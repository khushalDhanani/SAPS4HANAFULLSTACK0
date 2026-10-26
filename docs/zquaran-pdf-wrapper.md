# ZQUARAN quarantine labels over RFC — PDF wrapper proposal

> **Status**: proposal for review — 26 Oct 2026. Source: `docs/abap/z_mm_quar_label.fugr.abap`.
> Nothing is created, activated or transported in SAP; the function modules have never run.
> Plan: `docs/zquaran-fiori-implementation-plan.md` (Phase 1, step 4). Evidence: `docs/evidence/2026-10-26/zquaran/`.

## 1. Why a wrapper

Transaction `ZQUARAN` runs report `ZMM_R_062` (selection `P_MBLNR` mandatory, `P_TEXT` CHAR50), which builds label
rows and prints Adobe form `ZMM_AF_017`. It cannot serve Fiori: it is a dialog report, its PDF capture is commented
out, and it reads the material document by number only (no year). No existing remote wrapper was found
(`wrapper-function-discovery.json` = `[]`).

## 2. Agreed decisions (user, 26 Oct 2026)

- The new interface **requires the document year** (`IV_MJAHR`).
- Allowed roles: **WarehouseClerk, WarehouseManager, Admin**.
- Non-admin users are restricted to **their plants**; this is enforced in CAP before the RFC call (the RFC runs
  under the technical communication user, so an SAP-side check cannot see the end user).

## 3. Proposed interface — `Z_MM_QUAR_LABEL_PDF` (remote-enabled)

| Parameter | Type | Meaning |
| --- | --- | --- |
| `IV_MBLNR` | `MBLNR` | Material document number (required) |
| `IV_MJAHR` | `MJAHR` | Material document year (required) |
| `IV_TEXT` | `CHAR50` | Optional label text, same as `P_TEXT` (business meaning of the text still to be confirmed) |
| `EV_RESULT` | `CHAR20` | `OK`, `INVALID_INPUT`, `NOT_FOUND`, `NOT_AUTHORIZED`, `NO_LABEL_ROWS`, `FORM_ERROR`, `EMPTY_PDF` |
| `EV_MESSAGE` | `STRING` | Human-readable reason |
| `EV_PDF` | `XSTRING` | The rendered PDF (only when `OK`) |
| `EV_LABEL_COUNT` | `I` | Number of label rows rendered |

Flow: validate keys → plants of the document from `MATDOC` → `AUTHORITY-CHECK M_MSEG_WMB` per plant (RFC user) →
`Z_MM_QUAR_LABEL_DATA` (label rows) → `FP_FUNCTION_MODULE_NAME('ZMM_AF_017')` → `FP_JOB_OPEN` (no dialog, get PDF,
no printer) → generated form function → `FP_JOB_CLOSE` (always, also after a render error) → PDF. No database update,
no `COMMIT`, no printer dispatch.

`Z_MM_QUAR_LABEL_DATA` is a 1:1 port of `ZMM_R_062_F01` up to the form call, so the labels match the report.

## 4. Evidence status

| Item | Status | Evidence |
| --- | --- | --- |
| `ZQUARAN` → `ZMM_R_062`, screen 1000 | CONFIRMED | `program-identity.json` (live TSTC/TSTCT) |
| Report includes, selection, label assembly, form call | CONFIRMED | `ZMM_R_062*.abap` (ADT source) |
| `ZMM_S_013` fields used: `cont, vsolm, meins, lv_text, nlenr, mblnr, budat_mkpf, qty_r, hsdat, maktx, zzcust_batch, licha, name1, atwrt, date_from, zdate, text` | CONFIRMED (active compiled report) | `ZMM_R_062_F01.abap` |
| `MSEG-MJAHR` | CONFIRMED (selected by the report) | `ZMM_R_062_F01.abap:6` |
| `ZMM_AF_017` → interface `ZMM_FI_017` → `/1BCDWB/SM00000137`: `GT_FINAL TYPE ZMM_TT_026`, `/1BCDWB/DOCPARAMS TYPE SFPDOCPARAMS` (optional), `/1BCDWB/FORMOUTPUT TYPE FPFORMOUTPUT`, exceptions `USAGE_ERROR/SYSTEM_ERROR/INTERNAL_ERROR` | CONFIRMED | `form-contract.json`, `generated-form-contract.json` |
| `FP_JOB_OPEN`, `FP_FUNCTION_MODULE_NAME`, `FP_JOB_CLOSE` exist; their exceptions | CONFIRMED | `form-rfc-metadata.json`, report calls, `fp-function-source.abap` |
| `MATDOC` fields `MBLNR, MJAHR, WERKS` | CONFIRMED (read live by working adapter) | `srv/integration/s4hana/wm/TrToAdapter.js:1458` |
| `M_MSEG_WMB` fields `ACTVT, WERKS` ("Material Documents: Plant") | CONFIRMED | `docs/evidence/2026-10-26/261-auth-objects.raw.json` (TOBJ) |
| `ACTVT = '03'` (display) permitted for `M_MSEG_WMB` | CONFIRMED (permitted: 01, 02, 03, 04, 06, 69, F4) | `dictionary-sfp-fpformoutput-tactz.json` (TACTZ) |
| `SFPOUTPUTPARAMS-NODIALOG`, `-GETPDF` (both `CHAR1`) | CONFIRMED | `dictionary-sfp-fpformoutput-tactz.json` (DD03L, 58 fields) |
| `FPFORMOUTPUT-PDF` (`RSTR`, returned as `XSTRING`) | CONFIRMED | `dictionary-sfp-fpformoutput-tactz.json` (DD03L: PDL, XML, PDF, PAGES, LANGU) |
| Rendering without spool/output records when `GETPDF` is set and no device/destination is given | **Not verified** | needs the proof run (§6, step 4) |
| Function group/module names, package `ZAMM` | Proposal | `ZAMM` is the package of `ZQUARAN` (`docs/wm-discovery/tran_Z.xml:1`); confirm naming convention |

The three dictionary items were confirmed by the user-approved READ-ONLY read on 26 Oct 2026 (RFC_READ_TABLE on
DD03L and TACTZ). Still open before CAP/Fiori: rendering side effects, which only the proof run can show.

## 5. Deviations from the report (for review)

1. **Year**: the MSEG read adds `AND mjahr = @iv_mjahr`. The LTAP read still matches `WENUM = MBLNR` (no year in
   LTAP's key there), exactly as the report; reused document numbers across years could still match old transfer
   order items. Confirm whether that matters for these storage types (920/902).
2. **Stale name**: in the report `lv_name` is declared inside the loop but never reset, so a batch without
   characteristic `0818`/`0828` gets the previous row's name. The port clears it per row. Confirm with the business
   that the report's behaviour is a defect.
3. **Removed**: two `BREAK` statements (`sjena`, `STRIPATHY`) and commented-out code. The unused reads of `LFA1`,
   `VEPO`/`VEKP` and the first `AUSP` set are kept to stay 1:1 with the report.
4. **Empty result**: no rows → `NO_LABEL_ROWS` and no rendering (the report renders an empty form).

## 6. Gates before CAP/Fiori wiring

1. Review this source and §5 with the ABAP owner; approve names/package.
2. ~~READ-ONLY dictionary check~~ — done 26 Oct 2026, all three items confirmed (§4).
3. Create/activate in DEV (transport) — **separate written go**.
4. Proof run with an approved reference document (READ-ONLY by design, but it executes rendering — **written go per
   call**): `EV_RESULT = 'OK'`, PDF bytes start with `%PDF`, label count and content match the report's printed output
   for the same document; check spool (`TSP01`) and output records before/after to confirm no side effects.
5. Only then: CAP service + adapter (`srv/integration/s4hana/mm/`), plant/role checks, Fiori screen, tests, E2E.
