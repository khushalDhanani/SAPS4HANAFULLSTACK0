# ZMIB Material Issued To Batch Sticker — RFC Wrapper Specification

> **Status:** Proposal for Review — Source: [`docs/abap/z_mm_mib_label.fugr.abap`](file:///Users/khushaldhanani/Desktop/SAPS4HANAFULLSTACK0/docs/abap/z_mm_mib_label.fugr.abap).
> **Reference:** Parallels [`docs/zquaran-pdf-wrapper.md`](file:///Users/khushaldhanani/Desktop/SAPS4HANAFULLSTACK0/docs/zquaran-pdf-wrapper.md).

---

## 1. Context & Motivation

Transaction **`ZMIB`** in SAP executes report **`ZMM_R_067`** with selection screen:
- `P_LGNUM` (Warehouse Number, Obligatory)
- `P_TANUM` (Transfer Order Number, Obligatory)
- `P_BNAME` (Weighted By, Obligatory)
- `P_BNAME1` (Checked By, Obligatory)

In standard execution, `ZMM_R_067_F01` invokes Adobe Form **`ZMM_AF_021`** with `FP_JOB_OPEN` in spool/print dialog mode. It does not return binary PDF bytes to external callers.

To support digital preview, in-browser printing, and PDF download in modern Fiori applications without physical printer spool dependencies, remote-enabled RFC wrapper **`Z_MM_MIB_LABEL_PDF`** is specified.

---

## 2. Technical Interface: `Z_MM_MIB_LABEL_PDF`

- **Processing Type:** Remote-Enabled Module (RFC)
- **Function Group:** `ZMM_MIB_LABEL` (Package `ZAMM` or `$TMP`)

### Parameters

| Direction | Parameter | Type | Optional | Description |
| :--- | :--- | :--- | :--- | :--- |
| **IMPORTING** | `IV_LGNUM` | `LTAP-LGNUM` | No | Warehouse Number (e.g. `W01`) |
| **IMPORTING** | `IV_TANUM` | `LTAP-TANUM` | No | Transfer Order Number (10 digits) |
| **IMPORTING** | `IV_BNAME` | `USR21-BNAME` | Yes | Weighted By user name/ID |
| **IMPORTING** | `IV_BNAME1` | `USR21-BNAME` | Yes | Checked By user name/ID |
| **EXPORTING** | `EV_RESULT` | `CHAR20` | No | Result code (`OK`, `INVALID_INPUT`, `NOT_FOUND`, `FORM_ERROR`, `EMPTY_PDF`) |
| **EXPORTING** | `EV_MESSAGE` | `STRING` | No | Descriptive diagnostic message |
| **EXPORTING** | `EV_LABEL_COUNT` | `I` | No | Number of sticker lines rendered |
| **EXPORTING** | `EV_PDF` | `XSTRING` | No | Binary rendered PDF stream |

---

## 3. Data Dictionary Dependencies

All referenced dictionary objects are **CONFIRMED** existing in SAP DEV system DS4/220:

| Object | Type | Package | Description |
| :--- | :--- | :--- | :--- |
| `ZMM_AF_021` | `SFPF` | `ZAMM` | Adobe Form for Material Issued To Batch Sticker |
| `ZMM_FI_021` | `SFPI` | `Z001` | Form Interface for `ZMM_AF_021` |
| `ZMM_TT_025` | `TTYP` | `ZAMM` | Table type of `ZMM_S_012` |
| `ZMM_S_012` | `TABL` | `ZAMM` | Row structure (`MATNR`, `MAKTX`, `CHARG`, `BDATU`, `BENUM`, `TBNUM`, `LV_TEXT`, `VLENR`, `WEIGHT_BY`, `CHCK_BY`) |
